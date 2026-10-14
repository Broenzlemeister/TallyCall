// Prüft Lizenzschlüssel, Lizenzserver und die geschützte Kundenversion Ende zu Ende.
// Aufruf: node tools/test-license.js   (baut die Kundenversion in ein Temp-Verzeichnis)
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const License = require("../lib/license.js");
let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-lic-")), kp = License.generateKeyPair();
const pubFile = path.join(tmp, "pub.pem"); fs.writeFileSync(pubFile, kp.pub);
const PA = 7200 + Math.floor(Math.random() * 300), PB = PA + 400, PC = PA + 800;
const procs = [];
const start = (cwd, port, env) => { const d = fs.mkdtempSync(path.join(tmp, "d-")); procs.push(spawn("node", ["server.js"], { cwd, env: { ...process.env, PORT: port, DATA_DIR: d, TALLYCALL_AUTH: "off", OSC_PORT: "0", ...env }, stdio: "ignore" })); return d; };
const call = async (port, p, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-cl": "1" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  try {
    // Unit
    const exp = Date.now() + 5 * 864e5, k1 = License.sign({ id: "u1", name: "Kunde", exp }, kp.priv);
    ok(License.verify(k1, kp.pub).ok, "Gültiger Schlüssel wird akzeptiert");
    ok(!License.verify(k1.slice(0, -4) + "AAAA", kp.pub).ok, "Veränderte Signatur wird abgelehnt");
    ok(!License.verify(k1, License.generateKeyPair().pub).ok, "Schlüssel eines anderen Ausstellers wird abgelehnt");
    const forged = "TC1-" + Buffer.from(JSON.stringify({ v: 1, id: "u1", exp: 0 })).toString("base64url") + "." + k1.split(".")[1];
    ok(!License.verify(forged, kp.pub).ok, "Veränderte Laufzeit macht den Schlüssel ungültig");
    ok(License.verify(License.sign({ id: "g", exp: Date.now() - 864e5 }, kp.priv), kp.pub).state === "grace", "Nachfrist nach Ablauf");
    ok(License.verify(License.sign({ id: "g", exp: Date.now() - 9 * 864e5 }, kp.priv), kp.pub).state === "expired", "Nach der Nachfrist abgelaufen");

    // Lizenzserver (Quelltext) und Kundenversion
    start(path.join(__dirname, ".."), PA, { LICENSE_PRIVATE_KEY: kp.priv.replace(/\n/g, "\\n") });
    const out = path.join(tmp, "dist");
    execFileSync("node", [path.join(__dirname, "build-protect.js"), "--out", out, "--dist", "--pub", pubFile, "--issuer", `http://127.0.0.1:${PA}`, "--no-obfuscate"], { stdio: "pipe" });
    const dA = start(out, PB, {}); await wait(1500);
    let s = (await call(PB, "/api/admin/license")).json;
    ok(s.dist && s.state === "trial" && s.daysLeft >= 13, "Kundenversion startet mit 14 Tagen Test");
    ok(fs.statSync(path.join(out, "server.js")).size < 300 && !fs.readdirSync(out).some((f) => f.endsWith(".js") && f !== "server.js") && !/planOf|licState/.test(fs.readFileSync(path.join(out, "server.js"), "utf8")), "Kundenversion enthält keinen lesbaren Server-Quelltext");
    const iss = (await call(PA, "/api/admin/license-issue", { customer: "Testkunde", email: "k@x.de", months: 1 })).json;
    ok(iss.key && iss.key.startsWith("TC1-"), "Lizenzserver stellt Schlüssel aus");
    ok((await call(PB, "/api/admin/license-activate", { key: iss.key.slice(0, -3) + "AAA" })).status === 400, "Gefälschter Schlüssel lässt sich nicht aktivieren");
    ok((await call(PB, "/api/admin/license-activate", { key: iss.key })).status === 200, "Aktivierung mit gültigem Schlüssel");
    s = (await call(PB, "/api/admin/license")).json;
    ok(s.state === "valid" && s.customer === "Testkunde" && s.pro, "Lizenz gilt, Kunde wird angezeigt");
    let list = (await call(PA, "/api/admin/license")).json.records;
    ok(list[0].instances.length === 1, "Installation ist am Lizenzserver registriert");
    ok((await call(PB, "/api/me")).json.user.plan === "pro", "Mit Lizenz: Pro");

    // zweite Installation mit demselben Schlüssel
    start(out, PC, {}); await wait(1500);
    await call(PC, "/api/admin/license-activate", { key: iss.key });
    s = (await call(PC, "/api/admin/license")).json;
    ok(s.state === "revoked" && !s.pro, "Zweite Installation mit demselben Schlüssel wird gesperrt");
    ok((await call(PC, "/api/me")).json.user.plan === "free", "Gesperrt: nur Free");

    // Verlängerung kommt automatisch
    await call(PA, "/api/admin/license-extend", { id: list[0].id, months: 2 });
    await call(PB, "/api/admin/license-check", {});
    s = (await call(PB, "/api/admin/license")).json;
    ok(s.until > Date.now() + 60 * 864e5, "Verlängerung wird automatisch übernommen");

    // Sperren
    await call(PA, "/api/admin/license-revoke", { id: list[0].id, revoked: true });
    await call(PB, "/api/admin/license-check", {});
    s = (await call(PB, "/api/admin/license")).json;
    ok(s.state === "revoked" && !s.pro, "Gesperrte Lizenz wird beim nächsten Abgleich ungültig");
    await call(PA, "/api/admin/license-revoke", { id: list[0].id, revoked: false });
    await call(PB, "/api/admin/license-check", {});
    ok((await call(PB, "/api/admin/license")).json.state === "valid", "Entsperrt: wieder gültig");

    // Test abgelaufen, ohne Schlüssel
    const dD = start(out, PB + 1, {}); fs.writeFileSync(path.join(dD, "instance.json"), JSON.stringify({ id: "abc", trialStart: Date.now() - 20 * 864e5 })); await wait(1500);
    ok((await call(PB + 1, "/api/admin/license")).json.state === "none" && (await call(PB + 1, "/api/me")).json.user.plan === "free", "Test abgelaufen: Free-Grenzen");
    ok((await call(PA, "/api/license/check", { key: "x" })).json.invalid === true, "Lizenzserver weist ungültige Anfragen ab");
    ok((await call(PA, "/api/admin/license")).json.dist === false, "Online-Dienst braucht keine Lizenz");
  } catch (e) { console.error(e); failed++; }
  procs.forEach((p) => p.kill());
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nLizenz: alle Prüfungen bestanden");
  process.exit(failed ? 1 : 0);
})();
