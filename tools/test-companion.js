// Testet das Companion-Modul gegen echte Tallycall-Server, ohne Companion: @companion-module/base wird durch eine Attrappe ersetzt.
// Prüft Verbindungscode, Konto-Login und Lokal-Modus sowie die automatisch erzeugten Presets (neue Bauchbinde = neues Preset).
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
let failed = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let Captured;
const mock = {
  InstanceBase: class { constructor() { this.statuses = []; this.vars = {}; this.presets = {}; this.actions = {}; this.feedbacks = {}; this.logs = []; } updateStatus(s, m) { this.statuses.push([s, m]); } log(l, m) { this.logs.push([l, m]); } setVariableValues(v) { Object.assign(this.vars, v); } setActionDefinitions(a) { this.actions = a; } setFeedbackDefinitions(f) { this.feedbacks = f; } setVariableDefinitions() {} setPresetDefinitions(p) { this.presets = p; } checkFeedbacks() {} async parseVariablesInString(s) { return s; } },
  InstanceStatus: { Ok: "ok", Connecting: "connecting", BadConfig: "bad", ConnectionFailure: "fail", AuthenticationFailure: "auth", UnknownWarning: "warn" },
  combineRgb: (r, g, b) => (r << 16) | (g << 8) | b, runEntrypoint: (c) => { Captured = c; },
};
const load = Module._load; Module._load = function (req, ...a) { return req === "@companion-module/base" ? mock : load.call(this, req, ...a); };
require("../integrations/companion/main.js"); Module._load = load;

async function boot(env) {
  const port = 5100 + Math.floor(Math.random() * 800), data = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cm-"));
  const srv = spawn("node", ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: port, DATA_DIR: data, ...env }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch (_) {} await sleep(100); }
  return { port, U: `http://127.0.0.1:${port}`, srv, data };
}
const api = (U, cookie) => async (p, body) => { const r = await fetch(U + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-cl": "1", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
async function mod(config) { const m = new Captured({}); await m.init({ poll: 2, ...config }); await sleep(900); return m; }
const stop = (b, ...m) => { m.forEach((x) => x && x.destroy()); b.srv.kill(); fs.rmSync(b.data, { recursive: true, force: true }); };

(async () => {
  // 1) Lokal ohne Login
  let b = await boot({ TALLYCALL_AUTH: "off" }), A = api(b.U), m;
  try {
    m = await mod({ mode: "local", url: b.U });
    const pid = (await A("/api/me")).json.projects[0].id;
    ok(m.statuses.some((s) => s[0] === "ok"), "Lokal: verbunden ohne Login");
    ok(Object.keys(m.presets).filter((k) => k.startsWith("item_")).length >= 7, "Lokal: Presets für Ablaufpunkte (" + Object.keys(m.presets).filter((k) => k.startsWith("item_")).length + ")");
    ok(Object.keys(m.presets).filter((k) => k.startsWith("lower_")).length === 3, "Lokal: ein Preset je gespeicherte Bauchbinde");
    ok(Object.keys(m.presets).filter((k) => k.startsWith("ready_")).length === 5 && Object.keys(m.presets).some((k) => k.startsWith("day_")), "Lokal: Presets für Gewerke und Tage");
    await m.actions.next.callback({ options: {} }); await sleep(500);
    ok(m.vars.title === "Einlass & Begrüßung" && m.vars.status === "running", "Lokal: Aktion „Weiter“ wirkt, Variable title = " + m.vars.title);
    await A(`/api/p/${pid}/action`, { type: "lowerSave", title: "Neue Gast Bauchbinde", subtitle: "Vor Ort" }); await sleep(900);
    ok(Object.keys(m.presets).filter((k) => k.startsWith("lower_")).length === 4 && Object.values(m.presets).some((p) => p.name.includes("Neue Gast")), "Neue Bauchbinde erzeugt automatisch ein neues Preset");
    const lw = (await A(`/api/p/${pid}/status`)).json.lowers.find((q) => q.title === "Neue Gast Bauchbinde");
    await m.actions.lowerToggle.callback({ options: { id: lw.id } }); await sleep(500);
    ok(m.vars.lower === "Neue Gast Bauchbinde" && m.feedbacks.lowerIs.callback({ options: { id: lw.id } }) === true, "Bauchbinden-Preset blendet ein, Feedback leuchtet");
    await m.actions.lowerToggle.callback({ options: { id: lw.id } }); await sleep(500);
    ok(m.vars.lower === "", "Bauchbinden-Preset blendet wieder aus");
    await A(`/api/p/${pid}/action`, { type: "gewerkAdd", data: { name: "Pyro", short: "PY" } }); await sleep(900);
    ok(Object.keys(m.presets).some((k) => k.startsWith("ready_")) && Object.values(m.presets).some((p) => p.name === "Ready: Pyro"), "Neues Gewerk erzeugt Bereit-Presets");
    await m.actions.addTime.callback({ options: { min: 2 } }); await sleep(400);
    ok(m.vars.added === 120, "Zeit +2 Min");
  } catch (e) { console.error(e); failed++; }
  stop(b, m);

  // 2) Online mit Konto: Verbindungscode und Konto-Login
  b = await boot({ TALLYCALL_AUTH: "on", ADMIN_EMAIL: "chef@t.de" }); m = null; let m2 = null, m3 = null;
  try {
    const guest = await api(b.U)("/api/signup", { email: "gast@t.de", name: "Gast", password: "geheim1234" });
    ok(guest.json.user.siteAdmin === false, "ADMIN_EMAIL: das erste Konto ist NICHT automatisch Admin");
    const su = await api(b.U)("/api/signup", { email: "chef@t.de", name: "Chef", password: "geheim1234" }), A2 = api(b.U, su.cookie);
    ok(su.json.user.siteAdmin === true, "ADMIN_EMAIL: nur die genannte Adresse ist Admin");
    ok((await api(b.U, guest.cookie)("/api/admin/overview")).status === 403, "ADMIN_EMAIL: Gast hat keinen Zugriff auf die Verwaltung");
    ok((await A2("/api/admin/siteAdmin", { userId: guest.json.user.id, on: true })).status === 400, "ADMIN_EMAIL: Admin-Rechte lassen sich nicht weitergeben");
    const pid = (await A2("/api/projects", { name: "Show A", template: "concert" })).json.id;
    const tk = (await A2(`/api/p/${pid}/admin`, { type: "tokenCreate", name: "Companion", scope: "control" })).json.token;
    const code = "tc1." + Buffer.from(JSON.stringify({ u: b.U, p: pid, k: tk })).toString("base64url");
    m = await mod({ mode: "code", code });
    ok(m.statuses.some((s) => s[0] === "ok") && m.vars.project === "Show A", "Code: verbunden, Projekt " + m.vars.project);
    ok(Object.keys(m.presets).filter((k) => k.startsWith("item_")).length >= 6, "Code: Presets aus dem Projekt (Konzert-Vorlage)");
    await m.actions.next.callback({ options: {} }); await sleep(400);
    ok(m.vars.status === "running", "Code: Weiter startet die Show");
    m2 = await mod({ mode: "account", url: b.U, email: "chef@t.de", password: "geheim1234", project: "show a" });
    ok(m2.statuses.some((s) => s[0] === "ok") && m2.vars.project === "Show A", "Konto-Login: verbunden über Projektname");
    await m2.actions.pause.callback({ options: {} }); await sleep(500);
    ok(m2.vars.status === "paused" && m.vars.status === "paused", "Konto-Login: Aktion wirkt, beide Verbindungen sehen sie");
    m3 = await mod({ mode: "account", url: b.U, email: "chef@t.de", password: "falsch", project: "" });
    ok(m3.statuses.some((s) => s[0] === "fail" || s[0] === "auth"), "Konto-Login mit falschem Passwort scheitert");
    const gm = (await api(b.U, guest.cookie)("/api/me")).json; ok(gm.projects.length === 0 && !gm.others.length, "Gast sieht keine fremden Projekte");
    ok((await api(b.U, guest.cookie)(`/api/p/${pid}/status`)).status === 404, "Gast kann das Projekt nicht öffnen (404)");
    const cm = (await A2("/api/me")).json; ok(cm.projects.length === 1, "Admin: eigene Projektliste");
    await api(b.U, guest.cookie)("/api/projects", { name: "Gast-Show" });
    const cm2 = (await A2("/api/me")).json; ok(cm2.others.length === 1 && cm2.others[0].name === "Gast-Show", "Server-Admin sieht das Projekt des Gastes unter „Alle Projekte“");
    ok((await A2(`/api/p/${cm2.others[0].id}/status`)).status === 200 && (await A2(`/api/p/${cm2.others[0].id}/meta`)).json.viaAdmin === true, "Server-Admin darf das fremde Projekt öffnen (viaAdmin)");
    const m4 = await mod({ mode: "code", code: "kaputt" }); ok(m4.statuses.some((s) => s[0] === "bad"), "Ungültiger Code wird gemeldet"); m4.destroy();
  } catch (e) { console.error(e); failed++; }
  stop(b, m, m2, m3);
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nCompanion-Modul: alle Prüfungen bestanden");
  process.exit(failed ? 1 : 0);
})();
