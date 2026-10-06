// Rauchtest ohne Abhängigkeiten: startet den Server mit leerem Datenordner und prüft Konten, Rollen, Freigaben und Seiten.
// Aufruf: node tools/smoke.js   (Node 18 oder neuer)
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const PORT = 4300 + Math.floor(Math.random() * 500), U = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "tallycall-smoke-"));
let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
async function req(method, p, body, cookie, headers = {}) {
  const r = await fetch(U + p, { method, redirect: "manual", headers: { "content-type": "application/json", ...(method === "POST" ? { "x-cl": "1" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
  const sc = r.headers.get("set-cookie");
  return { status: r.status, json, text, cookie: sc ? sc.split(";")[0] : null };
}
(async () => {
  const srv = spawn("node", ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT, DATA_DIR: DATA, TALLYCALL_AUTH: "on", ALLOW_SIGNUP: "1" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {} await new Promise((r) => setTimeout(r, 100)); }
    ok((await req("GET", "/api/health")).json?.ok === true, "Server startet, /api/health antwortet");
    for (const p of ["/", "/login", "/signup", "/app.css", "/common.js", "/lang/en.js"]) ok((await req("GET", p)).status === 200 || p === "/app", `Seite ${p} erreichbar`);
    ok((await req("GET", "/app")).status === 302, "/app ohne Login leitet zur Anmeldung um");
    ok((await req("POST", "/api/signup", { email: "a@t.de", name: "A", password: "kurz" })).status === 400, "Zu kurzes Passwort wird abgelehnt");
    const a = await req("POST", "/api/signup", { email: "a@t.de", name: "Anna", password: "geheim1234" }); ok(a.status === 200 && a.cookie, "Registrierung A");
    ok((await req("POST", "/api/signup", { email: "a@t.de", name: "X", password: "geheim1234" })).status === 409, "Doppelte E-Mail wird abgelehnt");
    ok((await req("POST", "/api/login", { email: "a@t.de", password: "falsch" })).status === 401, "Falsches Passwort wird abgelehnt");
    ok((await fetch(U + "/api/login", { method: "POST", body: "{}" })).status === 403, "POST ohne Schutz-Header wird abgelehnt");
    const c = a.cookie, proj = await req("POST", "/api/projects", { name: "Test", sample: true }, c); ok(proj.status === 200 && proj.json.id, "Projekt anlegen");
    const base = "/api/p/" + proj.json.id;
    ok((await req("GET", base + "/state")).status === 401, "Projekt-API ohne Login gesperrt");
    ok((await req("POST", base + "/action", { type: "start" }, c)).status === 200, "Show starten");
    const st = (await req("GET", base + "/state", null, c)).json; ok(st.runtime.status === "running" && !("draft" in st), "Zustand läuft, ohne Entwurf in der Antwort");
    ok((await req("POST", base + "/action", { type: "draftStart" }, c)).status === 200 && (await req("GET", base + "/draft", null, c)).json.draft, "Vorschau-Modus legt Entwurf an");
    ok((await req("POST", base + "/action", { type: "draftDiscard" }, c)).status === 200, "Entwurf verwerfen");
    const sh = (await req("POST", base + "/admin", { type: "shareCreate", view: "gewerk", params: { g: "licht" } }, c)).json.share; ok(sh && sh.url.includes("/s/"), "Freigabe-Link erstellen");
    const tok = sh.url.split("/s/")[1];
    ok((await req("GET", "/api/s/" + tok + "/state")).status === 200, "Freigabe-Link ohne Login lesbar");
    ok((await req("POST", "/api/s/" + tok + "/action", { type: "ready", gewerk: "licht", state: "ready" })).status === 200, "Gewerk-Link darf Bereit melden");
    ok((await req("POST", "/api/s/" + tok + "/action", { type: "start" })).status === 403, "Freigabe-Link darf nicht steuern");
    ok((await req("GET", "/s/" + tok)).status === 200, "Freigabe-Seite lädt");
    ok((await req("POST", base + "/admin", { type: "shareRevoke", id: sh.id }, c)).status === 200 && (await req("GET", "/api/s/" + tok + "/state")).status === 404, "Widerrufener Link ist ungültig");
    const b = await req("POST", "/api/signup", { email: "b@t.de", name: "Ben", password: "geheim1234" });
    ok((await req("POST", base + "/admin", { type: "memberAdd", email: "b@t.de", role: "editor" }, c)).status === 200, "Editor hinzufügen");
    ok((await req("POST", base + "/action", { type: "pause" }, b.cookie)).status === 200, "Editor darf steuern");
    ok((await req("POST", base + "/admin", { type: "delete", confirm: "Test" }, b.cookie)).status === 403, "Editor darf das Projekt nicht löschen");
    ok((await req("GET", "/p/" + proj.json.id + "/", null, c)).status === 200, "Regie-Seite lädt für Mitglied");
    ok((await req("GET", "/p/" + proj.json.id + "/")).status === 302, "Regie-Seite ohne Login leitet um");
  } catch (e) { console.error(e); failed++; }
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nAlle Prüfungen bestanden");
  process.exit(failed ? 1 : 0);
})();
