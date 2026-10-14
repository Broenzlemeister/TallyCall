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
  const srv = spawn("node", ["server.js"], { cwd: process.env.TC_ROOT || path.join(__dirname, ".."), env: { ...process.env, PORT, DATA_DIR: DATA, TALLYCALL_AUTH: "on", ALLOW_SIGNUP: "1", OSC_PORT: String(PORT + 1000), STRIPE_WEBHOOK_SECRET: "whsec_smoke" }, stdio: "ignore" });
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
    // v2: Verschachtelung, Pausen, API-Schlüssel, Kommandos, Trigger-Schutz, Verwaltung, Lizenzen
    const st2 = (await req("GET", base + "/state", null, c)).json, d1 = st2.days[0], grp = d1.events.find((e) => e.type === "group"), brk = d1.events.find((e) => e.type === "break");
    ok(grp && brk && d1.events.some((e) => e.parent === grp.id), "Beispielshow hat Gruppen, Verschachtelung und Pause");
    const addR = await req("POST", base + "/action", { type: "add", dayId: d1.id, parent: grp.id, index: 0, data: { type: "break", title: "Umbau" } }, c);
    ok(addR.status === 200 && addR.json.id, "Pause in Gruppe anlegen liefert Id");
    ok((await req("POST", base + "/action", { type: "move", id: grp.id, parent: grp.id, index: 0 }, c)).status === 400, "Gruppe in sich selbst verschieben wird abgelehnt");
    ok((await req("POST", base + "/action", { type: "targetAdd", data: { name: "Lokal", type: "http", url: U + "/api/health", method: "GET" } }, c)).status === 200, "Trigger-Ziel anlegen");
    const tid = (await req("GET", base + "/state", null, c)).json.integrations.targets[0].id;
    const tt = await req("POST", base + "/trigtest", { id: tid, payload: "" }, c); ok(tt.status === 400 && /privaten Netz/.test(tt.json.error), "Online-Modus blockt private Trigger-Ziele");
    const tk = await req("POST", base + "/admin", { type: "tokenCreate", name: "Companion" }, c); ok(tk.status === 200 && tk.json.token.startsWith("tc_"), "API-Schlüssel erstellen");
    ok((await req("GET", base + "/cmd/next?token=" + tk.json.token)).json.current?.title, "Kommando per URL mit Schlüssel");
    ok((await req("GET", base + "/status", null, null, { authorization: "Bearer " + tk.json.token })).json.status !== "idle", "Status per Bearer-Schlüssel");
    ok((await req("POST", base + "/action", { type: "add" }, null, { authorization: "Bearer " + tk.json.token })).status === 403, "Schlüssel darf nicht planen");
    ok((await req("GET", base + "/status?token=tc_falsch")).status === 401, "Falscher Schlüssel wird abgelehnt");
    ok((await req("POST", base + "/admin", { type: "tokenRevoke", id: tk.json.id }, c)).status === 200 && (await req("GET", base + "/status?token=" + tk.json.token)).status === 401, "Widerrufener Schlüssel ist ungültig");
    const me = (await req("GET", "/api/me", null, c)).json; ok(me.user.siteAdmin === true && me.user.plan === "pro", "Erstes Konto ist Server-Admin mit Pro");
    const meB = (await req("GET", "/api/me", null, b.cookie)).json; ok(!meB.user.siteAdmin && meB.user.plan === "free", "Zweites Konto ist Free");
    ok((await req("POST", "/api/projects", { name: "B1" }, b.cookie)).status === 200 && (await req("POST", "/api/projects", { name: "B2" }, b.cookie)).status === 402, "Free-Plan: ein eigenes Projekt");
    ok((await req("GET", "/api/admin/overview", null, b.cookie)).status === 403, "Verwaltung nur für Server-Admins");
    const ov = (await req("GET", "/api/admin/overview", null, c)).json; ok(ov.stats.users === 2 && ov.users.length === 2, "Verwaltung zeigt Nutzer");
    ok((await req("POST", "/api/admin/plan", { userId: meB.user.id, plan: "pro", months: 12 }, c)).json.user.plan === "pro" && (await req("GET", "/api/me", null, b.cookie)).json.user.plan === "pro", "Admin schaltet Pro frei");
    ok((await req("GET", "/api/admin/overview", null, c)).json.purchases.length === 1, "Freischaltung erscheint unter Käufe");
    // Rechtstexte, Einstellungen, Zahlung, OSC, Exporte, Doku
    const imp0 = await req("GET", "/impressum"); ok(imp0.status === 200 && /Impressum|Legal notice/.test(imp0.text), "Impressum ist öffentlich erreichbar");
    ok((await req("GET", "/datenschutz?lang=de")).text.includes("Datenschutzerklärung"), "Datenschutzerklärung ist öffentlich erreichbar");
    ok((await req("POST", "/api/admin/legal", { legal: { name: "Max <Muster>", street: "Weg 1", zip: "12345", city: "Stadt", email: "m@x.de" } }, b.cookie)).status === 403, "Rechtliches ändern nur als Server-Admin");
    const lg = await req("POST", "/api/admin/legal", { legal: { name: "Max <Muster>", street: "Weg 1", zip: "12345", city: "Stadt", email: "m@x.de", logDays: 5 } }, c); ok(lg.status === 200 && lg.json.legalMissing.length === 0, "Rechtliches speichern, Pflichtangaben vollständig");
    const imp = await req("GET", "/impressum"); ok(imp.text.includes("Max &lt;Muster&gt;") && !imp.text.includes("<Muster>") && imp.text.includes("Weg 1"), "Impressum zeigt die Angaben, HTML ist maskiert");
    ok((await req("GET", "/datenschutz?lang=de")).text.includes("5 Tagen"), "Datenschutz übernimmt die Log-Dauer");
    ok((await req("POST", "/api/admin/settings", { priceAmount: "9,99", priceNote: "inkl. MwSt.", payLink: "https://buy.stripe.com/test" }, c)).status === 200 && (await req("GET", "/api/config")).json.price.amount === "9,99", "Preis und Zahlungslink speichern, Konfiguration liefert den Preis");
    ok((await req("POST", "/api/admin/settings", { payLink: "http://evil" }, c)).status === 400, "Zahlungslink muss https sein");
    ok((await req("POST", "/api/admin/settings", { portalLink: "https://billing.stripe.com/p/login/x" }, c)).status === 200 && (await req("GET", "/api/config")).json.portalLink.startsWith("https://billing"), "Kundenportal-Link speichern und ausliefern");
    ok((await req("POST", "/api/admin/settings", { priceAmount: "7,99" }, c)).status === 200, "Preis zurück auf 7,99");
    const crypto = require("crypto"), sendHook = async (ev) => { const body = JSON.stringify(ev), ts = Math.floor(Date.now() / 1000); return fetch(U + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${ts},v1=` + crypto.createHmac("sha256", "whsec_smoke").update(ts + "." + body).digest("hex") }, body }); };
    const invoice = { id: "evt_a", type: "invoice.paid", data: { object: { id: "in_1", customer_email: "c@t.de", amount_paid: 799, currency: "eur" } } };
    const cc = await req("POST", "/api/signup", { email: "c@t.de", name: "Cleo", password: "geheim1234" });
    ok((await sendHook(invoice)).status === 200 && (await req("GET", "/api/me", null, cc.cookie)).json.user.plan === "pro", "Stripe invoice.paid schaltet Pro frei");
    await sendHook(invoice); ok((await req("GET", "/api/admin/overview", null, c)).json.purchases.filter((x) => x.ref === "in_1").length === 1, "Doppelte Zahlungsmeldung wird nicht doppelt gebucht");
    ok((await fetch(U + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body: "{}" })).status === 400, "Stripe-Webhook mit falscher Signatur wird abgelehnt");
    // OSC mit Schlüssel
    const dgram = require("dgram"), osc = (addr) => new Promise((r) => { const b = Buffer.concat([Buffer.from(addr + "\0".repeat(4 - (addr.length % 4))), Buffer.from(",\0\0\0")]); const u = dgram.createSocket("udp4"); u.send(b, PORT + 1000, "127.0.0.1", () => { u.close(); setTimeout(r, 400); }); });
    const pc = (await req("POST", "/api/projects", { name: "OSC-Show", template: "concert" }, cc.cookie)).json.id, tkc = (await req("POST", `/api/p/${pc}/admin`, { type: "tokenCreate", name: "OSC" }, cc.cookie)).json.token;
    await osc(`/tallycall/${tkc}/start`); ok((await req("GET", `/api/p/${pc}/state`, null, cc.cookie)).json.runtime.status === "running", "OSC-Befehl mit Schlüssel startet die Show");
    await osc(`/tallycall/tc_falsch/pause`); ok((await req("GET", `/api/p/${pc}/state`, null, cc.cookie)).json.runtime.status === "running", "OSC mit falschem Schlüssel wird ignoriert");
    await osc(`/tallycall/${pc}/pause`); ok((await req("GET", `/api/p/${pc}/state`, null, cc.cookie)).json.runtime.status === "running", "OSC mit Projekt-ID statt Schlüssel wird online ignoriert");
    await osc(`/tallycall/${tkc}/pause`); ok((await req("GET", `/api/p/${pc}/state`, null, cc.cookie)).json.runtime.status === "paused", "OSC pause mit Schlüssel");
    const csv = await fetch(`${U}/api/p/${pc}/export.csv?kind=plan`, { headers: { cookie: cc.cookie } }); const ct = await csv.text(); ok(csv.status === 200 && ct.includes("Hauptact") && ct.startsWith("Tag;"), "Plan-CSV exportieren");
    const act = await (await fetch(`${U}/api/p/${pc}/export.csv?kind=actual`, { headers: { cookie: cc.cookie } })).text(); ok(act.includes("Linecheck und Soundcheck"), "Ist-Zeiten-CSV enthält den gestarteten Punkt");
    ok((await req("GET", "/docs/osc")).text.includes("OSC mit Tallycall einrichten"), "OSC-Anleitung wird als Seite ausgeliefert");
    ok((await fetch(U + "/downloads/companion-module-tallycall.tgz")).status === 200, "Companion-Modul ist herunterladbar");
    ok((await req("GET", "/")).text.includes("7,99") && (await req("GET", "/")).text.includes("companion-module-tallycall.tgz"), "Landingpage zeigt Preis und Companion-Download");
    ok((await req("GET", "/api/p/" + pc + "/state", null, b.cookie)).status === 404, "Fremde Nutzer sehen das Projekt nicht");
    ok((await req("GET", "/api/me", null, c)).json.others.some((x) => x.id === pc), "Server-Admin sieht fremde Projekte unter „Alle Projekte“");
    {
      const A = (a) => req("POST", base + "/action", a, c), S = async () => (await req("GET", base + "/state", null, c)).json;
      ok((await A({ type: "designSave", name: "Test", params: { skew: 999, accent: "#ff1f1f", evil: 1 } })).status === 200, "Design speichern");
      let st = await S(), dz = st.lowerDesigns[0];
      ok(dz && dz.params.skew === 40 && dz.params.accent === "#ff1f1f" && !("evil" in dz.params), "Design-Werte werden begrenzt und bereinigt");
      ok((await A({ type: "designSave", name: "  ", params: {} })).status !== 200, "Design ohne Namen wird abgelehnt");
      await A({ type: "lowerSave", title: "Design-Test", subtitle: "x", designId: dz.id }); st = await S();
      const lw = st.lowers.find((q) => q.title === "Design-Test"); ok(lw && lw.designId === dz.id, "Bauchbinde bekommt Design zugewiesen");
      await A({ type: "lower", data: { id: lw.id, visible: true } }); st = await S(); ok(st.lower.design && st.lower.design.accent === "#ff1f1f", "Live-Bauchbinde übernimmt das Design");
      await A({ type: "lowerMove", id: lw.id, to: 0 }); st = await S(); ok(st.lowers[0].id === lw.id, "Bauchbinde umsortiert");
      await A({ type: "designDelete", id: dz.id }); st = await S(); ok(st.lowerDesigns.length === 0 && st.lowers.find((q) => q.id === lw.id).designId === "", "Design löschen entfernt Zuweisung");
    }
    ok((await req("GET", "/admin", null, c)).status === 200 && (await req("GET", "/admin", null, b.cookie)).status === 403, "Verwaltungsseite nur für Admins");
  } catch (e) { console.error(e); failed++; }
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nAlle Prüfungen bestanden");
  process.exit(failed ? 1 : 0);
})();
