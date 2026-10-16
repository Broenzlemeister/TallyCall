// Prüft den E-Mail-Versand Ende zu Ende gegen einen Test-Mailserver: Passwort zurücksetzen, Willkommen, Ankündigungen, Abmelden,
// sowie den SMTP-Client mit Klartext, STARTTLS und TLS samt Anmeldung.
const { spawn, execFileSync } = require("child_process");
const net = require("net"), tls = require("tls"), fs = require("fs"), os = require("os"), path = require("path");
const Mail = require("../lib/mail.js");
let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-mail-"));
let key, cert; try { execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-subj", "/CN=localhost", "-days", "2"], { stdio: "pipe" }); key = fs.readFileSync(path.join(tmp, "k.pem")); cert = fs.readFileSync(path.join(tmp, "c.pem")); } catch (_) {}

// Test-SMTP-Server: sammelt Mails; mode: "plain" | "starttls" | "tls"; auth: { user, pass } oder null
function fakeSmtp(mode, auth) {
  const mails = [], seen = { auth: 0, tls: 0 };
  const onSocket = (sock0) => {
    let sock = sock0, buf = "", data = null, mail = { to: [] }, authed = !auth;
    const w = (l) => sock.write(l + "\r\n");
    const lineIn = (line) => {
      if (data !== null) { if (line === ".") { mail.raw = data.join("\r\n"); mails.push(mail); mail = { to: [] }; data = null; return w("250 queued"); } data.push(line.startsWith("..") ? line.slice(1) : line); return; }
      const c = line.toUpperCase();
      if (c.startsWith("EHLO")) { sock.write(["250-localhost", ...(mode === "starttls" && !sock.encrypted ? ["250-STARTTLS"] : []), ...(auth ? ["250-AUTH PLAIN LOGIN"] : []), "250 OK"].join("\r\n") + "\r\n"); return; }
      if (c === "STARTTLS") { w("220 go ahead"); sock.removeAllListeners("data"); const s = new tls.TLSSocket(sock, { isServer: true, key, cert }); seen.tls++; sock = s; s.on("data", feed); s.on("error", () => {}); return; }
      if (c.startsWith("AUTH PLAIN")) { const [, u, p] = Buffer.from(line.split(" ")[2], "base64").toString().split("\0"); if (u === auth.user && p === auth.pass) { authed = true; seen.auth++; return w("235 ok"); } return w("535 bad credentials"); }
      if (c.startsWith("MAIL FROM")) { if (!authed) return w("530 auth required"); mail.from = line.slice(10); return w("250 ok"); }
      if (c.startsWith("RCPT TO")) { mail.to.push(line.slice(8).replace(/[<>]/g, "")); return w("250 ok"); }
      if (c === "DATA") { data = []; return w("354 go"); }
      if (c === "QUIT") { w("221 bye"); return sock.end(); }
      w("502 unknown");
    };
    const feed = (chunk) => { buf += chunk.toString(); let i; while ((i = buf.indexOf("\r\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); lineIn(l); } };
    sock.on("data", feed); sock.on("error", () => {}); w("220 test ESMTP");
  };
  const srv = mode === "tls" ? tls.createServer({ key, cert }, onSocket) : net.createServer(onSocket);
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port, mails, seen })));
}
const parts = (raw) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) => Buffer.from(m[1].replace(/\s/g, ""), "base64").toString("utf8"));
const decode = (raw) => parts(raw)[0] || raw, decodeHtml = (raw) => parts(raw)[1] || "";
const link = (raw, re) => (re.exec(decode(raw)) || [])[0];

(async () => {
  const procs = [];
  try {
    // --- SMTP-Client ---
    const msg = { from: "Tallycall <no-reply@example.com>", to: "a@example.com", subject: "Grüße äöü", text: "Zeile 1\n.Punkt am Anfang\nZeile 3", html: "<p>Hi</p>" };
    let s1 = await fakeSmtp("plain", { user: "u", pass: "p" });
    await Mail.smtpSend({ host: "127.0.0.1", port: s1.port, secure: "none", user: "u", pass: "p" }, msg);
    ok(s1.mails.length === 1 && s1.seen.auth === 1 && s1.mails[0].to[0] === "a@example.com" && /Subject: =\?UTF-8\?B\?/.test(s1.mails[0].raw), "SMTP: Klartext mit Anmeldung, Umlaute im Betreff kodiert");
    ok(decode(s1.mails[0].raw).includes("\n.Punkt am Anfang"), "SMTP: Zeile mit Punkt am Anfang bleibt erhalten");
    let bad = null; await Mail.smtpSend({ host: "127.0.0.1", port: s1.port, secure: "none", user: "u", pass: "falsch" }, msg).catch((e) => (bad = e));
    ok(bad && /535/.test(bad.message), "SMTP: falsches Passwort wird gemeldet");
    s1.srv.close();
    if (key) {
      const s2 = await fakeSmtp("starttls", { user: "u", pass: "p" });
      await Mail.smtpSend({ host: "127.0.0.1", port: s2.port, secure: "starttls", user: "u", pass: "p", insecureTls: true }, msg);
      ok(s2.mails.length === 1 && s2.seen.tls === 1, "SMTP: STARTTLS mit Anmeldung");
      let strict = null; await Mail.smtpSend({ host: "127.0.0.1", port: s2.port, secure: "starttls", user: "u", pass: "p" }, msg).catch((e) => (strict = e));
      ok(!!strict, "SMTP: unbekanntes Zertifikat wird ohne SMTP_INSECURE_TLS abgelehnt");
      s2.srv.close();
      const s3 = await fakeSmtp("tls", { user: "u", pass: "p" });
      await Mail.smtpSend({ host: "127.0.0.1", port: s3.port, secure: "tls", user: "u", pass: "p", insecureTls: true }, msg);
      ok(s3.mails.length === 1, "SMTP: TLS (Port 465) mit Anmeldung");
      s3.srv.close();
    }

    // --- Server ---
    const smtp = await fakeSmtp("plain", { user: "mailer", pass: "geheim" });
    const PORT = 7600 + Math.floor(Math.random() * 300), U = `http://127.0.0.1:${PORT}`;
    procs.push(spawn("node", ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT, DATA_DIR: path.join(tmp, "data"), TALLYCALL_AUTH: "on", ALLOW_SIGNUP: "1", OSC_PORT: "0", PUBLIC_URL: "https://tallycall.test", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_SECURE: "none", SMTP_USER: "mailer", SMTP_PASS: "geheim", SMTP_FROM: "Tallycall <no-reply@tallycall.test>" }, stdio: "ignore" }));
    await new Promise((r) => setTimeout(r, 1500));
    const req = async (method, p, body, cookie) => { const r = await fetch(U + p, { method, redirect: "manual", headers: { "content-type": "application/json", ...(method === "POST" ? { "x-cl": "1" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} const sc = r.headers.get("set-cookie"); return { status: r.status, json: j, text: t, cookie: sc ? sc.split(";")[0] : null }; };
    const wait = async (cond, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

    ok((await req("GET", "/api/config")).json.mail === true, "Server meldet: E-Mail ist eingerichtet");
    const adm = await req("POST", "/api/signup", { name: "Chef", email: "chef@example.com", password: "geheim1234", news: true, lang: "en" });
    const ben = await req("POST", "/api/signup", { name: "Ben", email: "ben@example.com", password: "geheim1234", news: false, lang: "de" });
    const cleo = await req("POST", "/api/signup", { name: "Cleo", email: "cleo@example.com", password: "geheim1234", news: true, lang: "en" });
    ok(await wait(() => smtp.mails.length >= 3), "Willkommens-Mails werden verschickt");
    ok(smtp.mails.some((m) => m.to[0] === "ben@example.com" && /Willkommen/.test(decode(m.raw))), "Willkommens-Mail in der Sprache des Kontos");
    ok(!/^From:.*\r\n.*\r\n/.test("") && smtp.mails.every((m) => /From: Tallycall <no-reply@tallycall\.test>/.test(m.raw)), "Absender kommt aus den Einstellungen");

    // Passwort vergessen
    const before = smtp.mails.length;
    ok((await req("POST", "/api/forgot", { email: "unbekannt@example.com" })).status === 200, "Passwort vergessen: unbekannte Adresse bekommt dieselbe Antwort");
    await new Promise((r) => setTimeout(r, 400));
    ok(smtp.mails.length === before, "Passwort vergessen: an unbekannte Adressen geht keine Mail");
    ok((await req("POST", "/api/forgot", { email: "ben@example.com", lang: "en" })).status === 200 && (await wait(() => smtp.mails.length === before + 1)), "Passwort vergessen: Mail geht raus");
    const rm = smtp.mails[smtp.mails.length - 1], url = link(rm.raw, /https:\/\/tallycall\.test\/reset\?token=[A-Za-z0-9_-]+/);
    ok(!!url && rm.to[0] === "ben@example.com", "Mail enthält den Link mit der Adresse aus PUBLIC_URL");
    const token = url.split("token=")[1];
    ok((await req("POST", "/api/forgot", { email: "ben@example.com" })).status === 200, "Passwort vergessen: zweite Anfrage innerhalb einer Minute ist still begrenzt");
    await new Promise((r) => setTimeout(r, 300));
    ok(smtp.mails.length === before + 1, "Begrenzung: keine zweite Mail innerhalb einer Minute");
    ok((await req("POST", "/api/reset", { token: "falsch", password: "neuespasswort1" })).status === 400, "Zurücksetzen: falscher Token wird abgelehnt");
    ok((await req("POST", "/api/reset", { token, password: "kurz" })).status === 400, "Zurücksetzen: zu kurzes Passwort wird abgelehnt");
    ok((await req("POST", "/api/reset", { token, password: "neuespasswort1" })).status === 200, "Zurücksetzen mit gültigem Token");
    ok((await req("POST", "/api/reset", { token, password: "nochmalneu123" })).status === 400, "Zurücksetzen: Token funktioniert nur einmal");
    ok((await req("POST", "/api/login", { email: "ben@example.com", password: "geheim1234" })).status === 401 && (await req("POST", "/api/login", { email: "ben@example.com", password: "neuespasswort1" })).status === 200, "Neues Passwort gilt, altes nicht");
    ok((await req("GET", "/api/me", null, ben.cookie)).status === 401, "Alte Sitzungen sind beendet");
    ok(await wait(() => smtp.mails.some((m) => m.to[0] === "ben@example.com" && /Passwort geändert|Password changed/.test(decode(m.raw)))), "Hinweis „Passwort geändert“ wird verschickt");

    // Ankündigungen
    const send = (aud, subject = "Neu: Test", body = "Hallo {name},\n\nes gibt Neuigkeiten https://tallycall.com/news") => req("POST", "/api/admin/mail-send", { audience: aud, subject, body }, adm.cookie);
    ok((await req("POST", "/api/admin/mail-send", { audience: "news", subject: "x", body: "y" }, cleo.cookie)).status === 403, "Ankündigung: nur Server-Admins");
    let st = (await req("GET", "/api/admin/mail", null, adm.cookie)).json;
    ok(st.configured && st.counts.news === 2 && st.counts.all === 3, "Verwaltung: Empfängerzahlen (Newsletter 2 von 3)");
    const n0 = smtp.mails.length;
    ok((await send("news")).status === 200, "Ankündigung an Newsletter-Abonnenten starten");
    ok(await wait(() => smtp.mails.length >= n0 + 2) && (await new Promise((r) => setTimeout(r, 700)), smtp.mails.length === n0 + 2), "Ankündigung geht nur an Abonnenten (2 von 3)");
    const ann = smtp.mails.slice(n0), a1 = ann.find((m) => m.to[0] === "cleo@example.com");
    ok(a1 && /List-Unsubscribe: <https:\/\/tallycall\.test\/unsubscribe\?u=/.test(a1.raw) && /Hallo Cleo,/.test(decode(a1.raw)), "Ankündigung: Name eingesetzt, Abmelde-Header gesetzt");
    ok(/unsubscribe\?u=[a-f0-9]+&t=[A-Za-z0-9_-]+/.test(decode(a1.raw)) && /href="https:\/\/tallycall\.com\/news"/.test(decodeHtml(a1.raw)) && /href="https:\/\/tallycall\.test\/unsubscribe/.test(decodeHtml(a1.raw)), "Ankündigung: Abmelde-Link im Text, Links klickbar");
    const un = (/unsubscribe\?u=[a-f0-9]+&t=[A-Za-z0-9_-]+/.exec(decode(a1.raw)) || [])[0];
    ok((await req("GET", "/" + un.replace(/t=.*/, "t=" + "x".repeat(32)))).status === 400, "Abmelden: gefälschter Link wird abgelehnt");
    ok((await req("GET", "/" + un)).status === 200, "Abmelden: Link funktioniert ohne Anmeldung");
    st = (await req("GET", "/api/admin/mail", null, adm.cookie)).json;
    ok(st.counts.news === 1, "Nach dem Abmelden zählt Cleo nicht mehr zu den Abonnenten");
    const login = await req("POST", "/api/login", { email: "ben@example.com", password: "neuespasswort1" });
    ok((await req("POST", "/api/account", { news: true }, login.cookie)).json.user.news === true, "Im Konto lässt sich der Newsletter wieder einschalten");
    await new Promise((r) => setTimeout(r, 500));
    const n1 = smtp.mails.length;
    ok((await send("me", "Nur ich")).status === 200 && (await wait(() => smtp.mails.length === n1 + 1)) && smtp.mails[n1].to[0] === "chef@example.com", "Testversand „Nur ich“ geht nur an den Admin");

    // Einstellungen
    ok((await req("POST", "/api/admin/mail-settings", { host: "bad host!" }, adm.cookie)).status === 400, "Einstellungen: ungültiger Servername wird abgelehnt");
    ok((await req("POST", "/api/admin/mail-test", {}, adm.cookie)).status === 200 && (await wait(() => smtp.mails.some((m) => /test email|Testmail/.test(decode(m.raw))))), "Testmail an den Admin");
    const cfg = (await req("GET", "/api/admin/mail", null, adm.cookie)).json.cfg;
    ok(cfg.hasPass === true && !JSON.stringify(cfg).includes("geheim"), "Das Passwort wird nie an den Browser zurückgegeben");
    ok(/Forgot password|reset/i.test((await req("GET", "/forgot")).text), "Seite „Passwort vergessen“ wird ausgeliefert");
    // --- Feedback-Fenster ---
    const fbBefore = smtp.mails.length;
    ok((await req("POST", "/api/feedback", { type: "bug", text: "" })).status === 400, "Feedback: leere Nachricht wird abgelehnt");
    const f1 = await req("POST", "/api/feedback", { type: "bug", text: "Der Timer springt beim Pausieren", page: "/p/abc/?token=geheim", lang: "de", screen: "390x844" }, cleo.cookie);
    const f2 = await req("POST", "/api/feedback", { type: "idea", text: "Bitte Dark Mode für die Website", email: "gast@example.com" });
    ok(f1.status === 200 && f2.status === 200, "Feedback: Konto und Gast können Nachrichten senden");
    ok((await req("GET", "/api/admin/feedback", null, cleo.cookie)).status === 403, "Feedback: Liste nur für Server-Admins");
    let fb = (await req("GET", "/api/admin/feedback", null, adm.cookie)).json;
    ok(fb.items.length === 2 && fb.news === 2 && fb.items[1].name === "Cleo" && fb.items[1].email === "cleo@example.com" && fb.items[0].email === "gast@example.com", "Admin sieht beide Nachrichten, Name und E-Mail kommen vom Konto");
    ok((await req("GET", "/api/me", null, adm.cookie)).json.user.feedbackNew === 2 && (await req("GET", "/api/me", null, cleo.cookie)).json.user.feedbackNew === undefined, "Zähler für neue Nachrichten nur für den Admin");
    ok(await wait(() => smtp.mails.length === fbBefore + 1) && smtp.mails[fbBefore].to[0] === "chef@example.com" && /Der Timer springt/.test(decode(smtp.mails[fbBefore].raw)), "Admin bekommt eine Benachrichtigung per Mail");
    await new Promise((r) => setTimeout(r, 400)); ok(smtp.mails.length === fbBefore + 1, "Benachrichtigung ist gebündelt: nicht eine Mail pro Nachricht");
    const gid = fb.items[0].id, rep = await req("POST", "/api/admin/feedback-reply", { id: gid, text: "Danke, kommt im nächsten Update." }, adm.cookie);
    ok(rep.status === 200 && (await wait(() => smtp.mails.some((m) => m.to[0] === "gast@example.com" && /nächsten Update|next update/.test(decode(m.raw))))), "Antwort geht per Mail an die Adresse im Feedback");
    fb = (await req("GET", "/api/admin/feedback", null, adm.cookie)).json;
    ok(fb.items[0].status === "done" && fb.items[0].replies.length === 1 && fb.news === 1, "Beantwortete Nachricht gilt als erledigt");
    ok((await req("POST", "/api/admin/feedback-reply", { id: fb.items[1].id, text: "Hallo" }, adm.cookie)).status === 200, "Antwort an ein Konto funktioniert");
    ok((await req("POST", "/api/admin/feedback-delete", { id: gid }, adm.cookie)).json.news === 0 && (await req("GET", "/api/admin/feedback", null, adm.cookie)).json.items.length === 1, "Nachricht löschen");
    let many = 0; for (let i = 0; i < 8; i++) many = (await req("POST", "/api/feedback", { type: "other", text: "Spam " + i })).status; ok(many === 429, "Feedback von Gästen ist pro Adresse begrenzt");
    ok(/Feedback/.test((await req("GET", "/feedback.js")).text), "Feedback-Fenster wird ausgeliefert");

    // --- Mails rund um die Testphase (zweiter Server mit sehr kurzer Testphase) ---
    const smtp2 = await fakeSmtp("plain", null), PORT2 = PORT + 400;
    procs.push(spawn("node", ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: PORT2, DATA_DIR: path.join(tmp, "data2"), TALLYCALL_AUTH: "on", ALLOW_SIGNUP: "1", OSC_PORT: "0", PUBLIC_URL: "https://tallycall.test", TRIAL_DAYS: "0.00005", TC_MAIL_TICK_MS: "400", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp2.port), SMTP_SECURE: "none", SMTP_FROM: "no-reply@tallycall.test" }, stdio: "ignore" }));
    await new Promise((r) => setTimeout(r, 1500));
    const R2 = (p, body) => fetch(`http://127.0.0.1:${PORT2}${p}`, { method: "POST", headers: { "content-type": "application/json", "x-cl": "1" }, body: JSON.stringify(body) });
    await R2("/api/signup", { name: "Chef", email: "chef2@example.com", password: "geheim1234" }); // Server-Admin bekommt keine Testphasen-Mails
    await R2("/api/signup", { name: "Tina", email: "tina@example.com", password: "geheim1234", lang: "en" });
    ok(await wait(() => smtp2.mails.filter((m) => m.to[0] === "tina@example.com").length >= 3, 9000), "Testphase: Willkommen, „endet bald“ und „abgelaufen“ werden automatisch gesendet");
    const tm = smtp2.mails.filter((m) => m.to[0] === "tina@example.com").map((m) => decode(m.raw));
    ok(/Welcome to Tallycall/.test(tm[0]) && /trial ends/.test(tm[1]) && /trial has ended|trial ended/.test(tm[2]), "Testphase: Reihenfolge Willkommen, endet bald, abgelaufen");
    ok(/https:\/\/tallycall\.test\/app\?upgrade=1/.test(tm[2]) && /€7\.99|7,99 €|7\.99/.test(tm[2]), "Abgelaufen-Mail: Link zum Kauf und Preis");
    await new Promise((r) => setTimeout(r, 1500));
    ok(smtp2.mails.filter((m) => m.to[0] === "tina@example.com").length === 3 && !smtp2.mails.some((m) => m.to[0] === "chef2@example.com" && /trial/i.test(decode(m.raw))), "Jede Mail nur einmal, Server-Admin bekommt keine Testphasen-Mails");

  } catch (e) { console.error(e); failed++; }
  procs.forEach((p) => p.kill());
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nE-Mail: alle Prüfungen bestanden");
  process.exit(failed ? 1 : 0);
})();
