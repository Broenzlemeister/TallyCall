// Tallycall: Ablaufregie für Shows und Events. Konten, Projekte mit Rollen, Freigabe-Links, Live-Sync, Trigger, API-Schlüssel, Lizenzen.
// Keine Abhängigkeiten. Start: node server.js
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const Engine = require("./lib/engine.js");
const CLS = require("./public/shared.js");
const auth = require("./lib/auth.js");
const Trig = require("./lib/triggers.js");

const PORT = Number(process.env.PORT) || 4001;
const HOST = process.env.HOST || "0.0.0.0";
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const AUTH_ON = (process.env.TALLYCALL_AUTH || "on") !== "off"; // "off" = lokaler Betrieb ohne Login
const SIGNUP = process.env.ALLOW_SIGNUP !== "0";
const TZ_DEFAULT = process.env.TZ_SHOW || "Europe/Berlin";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
// Trigger-Politik: all (jede Adresse, lokaler Betrieb) | public (nur öffentliche Adressen, online) | off
const TRIGGERS = process.env.TALLYCALL_TRIGGERS || (AUTH_ON ? "public" : "all");
const OSC_PORT = Number(process.env.OSC_PORT) || 0; // OSC-Eingang, 0 = aus
// Lizenzen: on = Free/Pro mit Grenzen, off = alles frei. Server-Admins haben immer Pro.
const PLANS = (process.env.TALLYCALL_PLANS || (AUTH_ON ? "on" : "off")) === "on";
const PAY_LINK = process.env.PAY_LINK || ""; // z. B. Stripe Payment Link
const PLAN_MONTHS = Number(process.env.PLAN_MONTHS) || 12;
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const ADMIN_EMAILS = String(process.env.ADMIN_EMAIL || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
const LIMITS = { free: { projects: 1, days: 2, shares: 3, integrations: false, tokens: false }, pro: { projects: Infinity, days: Infinity, shares: Infinity, integrations: true, tokens: true } };
const PUB = path.join(__dirname, "public");
const VIEWS_DIR = path.join(__dirname, "views");
const store = require("./lib/store.js").open(DATA);
const SECRET = auth.loadSecret(DATA);

// Ansichten: Mitglieder-Seiten und Seiten, die per Link geteilt werden dürfen
const MEMBER_VIEWS = new Set(["regie", "editor", "grafik", "settings", "integrations"]);
const SHARE_VIEWS = new Set(["timer", "stage", "backstage", "public", "clock", "lower", "gewerk", "timeline", "print"]);
const SHARE_PARAMS = ["g", "day", "mode"];
// Aktionen, die ein API-Schlüssel (Companion, Stream Deck) auslösen darf: Steuerung, keine Planung
const API_ACTIONS = new Set(["start", "pause", "toggle", "stop", "load", "next", "prev", "addTime", "setDay", "roll", "message", "lower", "ready", "readyReset"]);
const LOCAL_USER = { id: "local", name: "Lokal", email: "", local: true, siteAdmin: true };

// ---------- Daten ----------
const users = store.loadUsers();
const purchases = store.loadPurchases();
const userById = (id) => users.find((u) => u.id === id);
const userByEmail = (e) => users.find((u) => u.email === String(e).trim().toLowerCase());
const hosts = new Map();
function addHost({ meta, state }) {
  const h = { meta, state, engine: Engine.create(state), clients: new Set(), trig: null };
  meta.members = meta.members || []; meta.invites = meta.invites || []; meta.shares = meta.shares || []; meta.audit = meta.audit || []; meta.tokens = meta.tokens || [];
  hosts.set(meta.id, h);
  return h;
}
for (const p of store.loadProjects()) addHost(p);

function newProject({ name, timezone, sample, owner }) {
  const state = Engine.createState({ name, timezone, sample });
  const meta = { id: auth.id(6), name, created: Date.now(), updated: Date.now(), members: owner && !owner.local ? [{ userId: owner.id, role: "admin" }] : [], invites: [], shares: [], audit: [], tokens: [] };
  const h = addHost({ meta, state });
  store.saveProject(h);
  return h;
}
if (!AUTH_ON && !hosts.size) newProject({ name: "Beispielshow", timezone: TZ_DEFAULT, sample: true });

const roleIn = (h, user) => (!AUTH_ON ? "admin" : user ? h.meta.members.find((m) => m.userId === user.id)?.role || null : null);
const touch = (h) => { h.meta.updated = Date.now(); store.saveProject(h); };

// ---------- Lizenzen ----------
const isSiteAdmin = (u) => !!u && (u.siteAdmin || u.local);
const planOf = (u) => (!PLANS || isSiteAdmin(u) || (u && u.plan === "pro" && (!u.planUntil || u.planUntil > Date.now())) ? "pro" : "free");
const limits = (u) => LIMITS[planOf(u)];
const planInfo = (u) => ({ plan: planOf(u), until: u?.planUntil || 0, enforced: PLANS, payLink: PAY_LINK, limits: { ...limits(u), projects: isFinite(limits(u).projects) ? limits(u).projects : 0, days: isFinite(limits(u).days) ? limits(u).days : 0, shares: isFinite(limits(u).shares) ? limits(u).shares : 0 } });
const ownedProjects = (u) => [...hosts.values()].filter((h) => h.meta.members.some((m) => m.userId === u.id && m.role === "admin")).length;
function grantPlan(u, months, { source = "manual", ref = "", amount = 0, currency = "", by = "" } = {}) {
  const base = Math.max(Date.now(), u.planUntil || 0);
  u.plan = "pro"; u.planUntil = months > 0 ? base + months * 30.44 * 86400000 : 0;
  purchases.unshift({ id: auth.id(5), t: Date.now(), userId: u.id, email: u.email, plan: "pro", months, source, ref, amount, currency, by });
  purchases.length = Math.min(purchases.length, 5000);
  store.savePurchases(purchases); store.saveUsers(users);
}
// Käufe, die vor der Registrierung eingingen, beim ersten Login einlösen
function applyPendingPurchases(u) {
  let changed = false;
  for (const p of purchases) if (!p.userId && p.email === u.email) { p.userId = u.id; const base = Math.max(Date.now(), u.planUntil || 0); u.plan = "pro"; u.planUntil = p.months > 0 ? base + p.months * 30.44 * 86400000 : 0; changed = true; }
  if (changed) { store.savePurchases(purchases); store.saveUsers(users); }
}

// Einladungen, die auf diese E-Mail warten, beim Registrieren einlösen
function applyInvites(user) {
  for (const h of hosts.values()) {
    const i = h.meta.invites.findIndex((x) => x.email === user.email);
    if (i < 0) continue;
    const inv = h.meta.invites.splice(i, 1)[0];
    if (!h.meta.members.some((m) => m.userId === user.id)) h.meta.members.push({ userId: user.id, role: inv.role });
    touch(h);
  }
}

// ---------- Live-Verbindungen ----------
const payload = (h, share) => { const p = { ...h.engine.pub(), serverTime: Date.now() }; if (share) { p.log = []; p.integrations = { targets: [], rules: [] }; } return JSON.stringify(p); };
function broadcast(h) {
  const full = `data: ${payload(h, false)}\n\n`, shared = `data: ${payload(h, true)}\n\n`;
  for (const c of h.clients) c.res.write(c.share ? shared : full);
  touch(h);
  try { Trig.evaluate(h, TRIGGERS); } catch (e) { console.error("Trigger:", e.message); }
}
setInterval(() => { for (const h of hosts.values()) for (const c of h.clients) c.res.write(": ping\n\n"); }, 15000);
setInterval(() => { for (const h of hosts.values()) { if (h.engine.tick()) broadcast(h); else try { Trig.evaluate(h, TRIGGERS); } catch (_) {} } }, 500);
function sse(req, res, h, share) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`retry: 2000\ndata: ${payload(h, share)}\n\n`);
  const c = { res, share };
  h.clients.add(c);
  req.on("close", () => h.clients.delete(c));
}

// ---------- Aktivitätsprotokoll ----------
function audit(h, user, text) {
  const a = h.meta.audit, who = user?.name || "?", last = a[0];
  if (last && last.user === who && last.text === text && Date.now() - last.t < 90000) { last.t = Date.now(); last.n = (last.n || 1) + 1; }
  else { a.unshift({ t: Date.now(), user: who, text }); a.length = Math.min(a.length, 300); }
}
function titleOf(h, id) {
  for (const src of [h.state.draft, h.state]) for (const d of src?.days || []) { const e = d.events.find((x) => x.id === id); if (e) return e.title || "(ohne Titel)"; }
  return "";
}
// Kurzbeschreibung einer Aktion für das Protokoll (null = nicht protokollieren)
function describe(h, a, pre) {
  const cur = () => titleOf(h, h.state.runtime.currentId);
  const t = a.id ? pre.title || titleOf(h, a.id) : "";
  switch (a.type) {
    case "start": return a.id || h.state.runtime.status === "running" ? `Start: ${cur()}` : null;
    case "toggle": return h.state.runtime.status === "running" ? `Start: ${cur()}` : "Pause";
    case "next": return `Weiter: ${cur() || "Ende"}`;
    case "prev": return `Zurück: ${cur()}`;
    case "pause": return "Pause";
    case "stop": return "Reset";
    case "roll": return `Roll-Modus ${a.on ? "an" : "aus"}`;
    case "message": return a.visible ? `Nachricht: ${a.text}` : null;
    case "lower": return (a.data || a).visible === true ? "Bauchbinde eingeblendet" : (a.data || a).visible === false ? "Bauchbinde ausgeblendet" : null;
    case "add": return `Punkt hinzugefügt${a.data?.type === "group" ? " (Gruppe)" : a.data?.type === "break" ? " (Pause)" : ""}`;
    case "update": return `Punkt „${t}“ bearbeitet`;
    case "delete": return `Punkt „${t}“ gelöscht`;
    case "move": return `Punkt „${t}“ verschoben`;
    case "dayAdd": return "Tag hinzugefügt";
    case "dayUpdate": return "Tag bearbeitet";
    case "dayDelete": return "Tag gelöscht";
    case "dayMove": return "Tage umsortiert";
    case "gewerkAdd": case "gewerkUpdate": case "gewerkDelete": case "gewerkMove": return "Gewerke geändert";
    case "settings": return "Einstellungen geändert";
    case "import": return "Plan importiert";
    case "draftStart": return "Vorschau-Modus gestartet";
    case "draftDiscard": return "Entwurf verworfen";
    case "draftPublish": return "Entwurf live geschaltet";
    case "lowerSave": case "lowerDelete": return "Bauchbinden-Liste geändert";
    case "targetAdd": case "targetUpdate": case "targetDelete": return "Trigger-Ziele geändert";
    case "ruleAdd": case "ruleUpdate": case "ruleDelete": return "Trigger-Regeln geändert";
    default: return null;
  }
}

// ---------- HTTP-Helfer ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".jpg": "image/jpeg", ".webp": "image/webp" };
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers }); res.end(JSON.stringify(obj)); };
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
const secureReq = (req) => !!req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
const baseUrl = (req) => PUBLIC_URL || `${secureReq(req) ? "https" : "http"}://${req.headers.host}`;
function readRaw(req, limit = 4e6) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > limit) { reject(new Error("Anfrage zu groß")); req.destroy(); } });
    req.on("end", () => resolve(b));
  });
}
async function readBody(req, limit) { const b = await readRaw(req, limit); try { return b ? JSON.parse(b) : {}; } catch (_) { throw new Error("Ungültige Anfrage"); } }
function sendFile(res, file, { inject } = {}) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    let out = buf;
    if (inject) out = Buffer.from(buf.toString().replace("<head>", "<head>" + inject));
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(out);
  });
}
const page = (res, code, title, text) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/app.css"><body class="msgpage"><div><h1>${title}</h1><p>${text}</p><p><a class="btn" href="/app">Zu meinen Projekten</a></p></div><script src="/i18n.js"></script>`); };

const fails = new Map(); // Bremse gegen Passwort-Raten: Schlüssel -> {n, until}
const blocked = (k) => { const f = fails.get(k); return f && f.n >= 10 && Date.now() < f.until; };
const fail = (k) => { const f = fails.get(k) || { n: 0 }; f.n++; f.until = Date.now() + 60000; fails.set(k, f); };

function currentUser(req) {
  if (!AUTH_ON) return LOCAL_USER;
  const s = auth.readSession(SECRET, auth.parseCookies(req.headers.cookie).cl);
  const u = s && userById(s.uid);
  return u && (u.sv || 0) === s.sv ? u : null;
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, local: !!u.local, siteAdmin: isSiteAdmin(u), ...planInfo(u) });
function projectSummary(h, user) {
  const days = h.state.days, r = h.state.runtime, cur = h.state.days.flatMap((d) => d.events).find((e) => e.id === r.currentId);
  return { id: h.meta.id, name: h.meta.name, role: roleIn(h, user), days: days.length, events: days.reduce((n, d) => n + d.events.filter((e) => e.type !== "group").length, 0),
    firstDate: days.map((d) => d.date).sort()[0], lastDate: days.map((d) => d.date).sort().pop(), members: h.meta.members.length, updated: h.meta.updated,
    live: cur && r.status !== "stopped" ? { status: r.status, title: cur.title } : null };
}
const shareView = (req, s) => ({ id: s.id, view: s.view, params: s.params, label: s.label, by: s.by, created: s.created, url: `${baseUrl(req)}/s/${s.token}` });

// API-Schlüssel: "tc_" + 32 Zeichen; gespeichert wird nur der Hash
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
function tokenAuth(req, url, h) {
  const m = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || ""), t = m ? m[1] : url.searchParams.get("token");
  if (!t) return null;
  const k = h.meta.tokens.find((x) => x.hash === hashToken(t) && !x.revoked);
  if (k) { k.lastUsed = Date.now(); }
  return k || null;
}
// Kurzbefehle per GET (Stream Deck „Website öffnen“, Companion, Browser): /api/p/<id>/cmd/<befehl>?token=…
function command(name, q) {
  const v = (k) => q.get(k) ?? "";
  switch (name) {
    case "start": case "pause": case "toggle": case "stop": case "next": case "prev": case "readyReset": return { type: name, dayId: v("day") || undefined };
    case "go": return { type: "next" };
    case "load": return { type: "load", id: v("id") };
    case "add": case "addTime": return { type: "addTime", ms: Number(v("ms")) || Number(v("min")) * 60000 || 60000 };
    case "sub": return { type: "addTime", ms: -(Number(v("ms")) || Number(v("min")) * 60000 || 60000) };
    case "day": return { type: "setDay", dayId: v("id") };
    case "roll": return { type: "roll", on: ["1", "on", "true"].includes(v("on")) };
    case "ready": return { type: "ready", gewerk: v("g") || v("gewerk"), state: v("state") };
    case "message": return { type: "message", text: v("text"), visible: !["0", "off", "false"].includes(v("visible") || "1") };
    case "lower": return { type: "lower", data: { ...(v("id") ? { id: v("id") } : {}), ...(v("title") ? { title: v("title") } : {}), ...(v("subtitle") ? { subtitle: v("subtitle") } : {}), visible: !["0", "off", "false", "hide"].includes(v("visible") || v("show") || "1") } };
    default: return null;
  }
}
// Kompakter Zustand für Companion und Co. (kleiner als der volle Zustand)
function status(h) {
  const s = h.state, r = s.runtime, f = h.engine.findEvent(r.currentId), e = f?.e || null;
  const rem = e ? e.duration * 1000 + r.added - h.engine.elapsed() : 0;
  let next = null;
  if (f) { const list = f.day.events.filter((x) => x.type !== "group" && !CLS.effSkip(f.day.events, x)); next = list[list.indexOf(f.e) + 1] || null; }
  const day = f ? f.day : s.days.find((d) => d.id === r.dayId) || s.days[0];
  return { show: s.show.name, status: e ? r.status : "idle", day: day ? { id: day.id, name: day.name, date: day.date } : null,
    current: e ? { id: e.id, title: e.title, subtitle: e.subtitle, presenter: e.presenter, type: e.type, duration: e.duration, color: e.color } : null,
    next: next ? { id: next.id, title: next.title, type: next.type } : null,
    remaining: Math.round(rem / 1000), remainingText: CLS.fmt(rem), elapsed: Math.round(h.engine.elapsed() / 1000), added: Math.round(r.added / 1000),
    level: !e ? "ok" : rem < 0 ? "over" : rem <= s.settings.warnRed * 1000 ? "danger" : rem <= s.settings.warnYellow * 1000 ? "warn" : "ok",
    clock: CLS.hhmmss(CLS.nowParts(Date.now(), s.settings.timezone).sec), roll: s.settings.roll, message: s.message, lower: { title: s.lower.title, subtitle: s.lower.subtitle, visible: s.lower.visible },
    ready: Object.fromEntries(s.gewerke.map((g) => [g.id, s.ready[g.id]?.state || ""])), gewerke: s.gewerke.map((g) => ({ id: g.id, name: g.name, short: g.short, color: g.color })),
    lowers: s.lowers, days: s.days.map((d) => ({ id: d.id, name: d.name, date: d.date })), hasDraft: !!s.draft, serverTime: Date.now() };
}

// ---------- API ----------
async function api(req, res, url, segs, user) {
  const ip = req.socket.remoteAddress, post = req.method === "POST";
  const [a, b, c, d2] = segs;
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cl", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }); return res.end(); }

  if (a === "health") return send(res, 200, { ok: true });
  if (a === "config") return send(res, 200, { auth: AUTH_ON, signup: SIGNUP, plans: PLANS, payLink: PAY_LINK });
  if (a === "stripe" && b === "webhook" && post) return stripeWebhook(req, res);

  // Projekt-API mit Schlüssel (Companion, Stream Deck): kein Cookie, kein CSRF-Header nötig
  if (a === "p" && hosts.get(b)) {
    const h = hosts.get(b), key = tokenAuth(req, url, h);
    if (key) {
      if (c === "status") return send(res, 200, status(h));
      if (c === "state") return send(res, 200, JSON.parse(payload(h, true)));
      if (c === "events") return sse(req, res, h, true);
      if (c === "cmd") {
        const act = command(d2, url.searchParams);
        if (!act) return send(res, 404, { error: "Unbekannter Befehl" });
        if (key.scope === "read") return send(res, 403, { error: "Dieser Schlüssel darf nur lesen" });
        try { h.engine.act(act); } catch (e) { return send(res, 400, { error: e.message }); }
        const text = describe(h, act, { title: act.id ? titleOf(h, act.id) : "" }); if (text) audit(h, { name: "API " + key.name }, text);
        broadcast(h);
        return send(res, 200, { ok: true, ...status(h) });
      }
      if (c === "action" && post) {
        if (key.scope === "read") return send(res, 403, { error: "Dieser Schlüssel darf nur lesen" });
        const act = await readBody(req);
        if (!API_ACTIONS.has(act.type)) return send(res, 403, { error: "Diese Aktion ist per API-Schlüssel nicht erlaubt" });
        try { h.engine.act(act); } catch (e) { return send(res, 400, { error: e.message }); }
        const text = describe(h, act, { title: act.id ? titleOf(h, act.id) : "" }); if (text) audit(h, { name: "API " + key.name }, text);
        broadcast(h);
        return send(res, 200, { ok: true, ...status(h) });
      }
      return send(res, 404, { error: "Nicht gefunden" });
    }
  }
  if (post && !req.headers["x-cl"]) return send(res, 403, { error: "Ungültige Anfrage" });

  // --- Konto ---
  if (a === "signup" && post) {
    if (!AUTH_ON) return send(res, 400, { error: "Anmeldung ist im lokalen Modus nicht nötig" });
    if (!SIGNUP) return send(res, 403, { error: "Die Registrierung ist auf diesem Server geschlossen" });
    if (blocked("su:" + ip)) return send(res, 429, { error: "Zu viele Versuche, bitte kurz warten" });
    const d = await readBody(req), email = String(d.email || "").trim().toLowerCase(), name = String(d.name || "").trim().slice(0, 60);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return send(res, 400, { error: "Bitte eine gültige E-Mail-Adresse eingeben" });
    if (!name) return send(res, 400, { error: "Bitte einen Namen eingeben" });
    if (String(d.password || "").length < 8) return send(res, 400, { error: "Das Passwort braucht mindestens 8 Zeichen" });
    if (userByEmail(email)) { fail("su:" + ip); return send(res, 409, { error: "Mit dieser E-Mail gibt es schon ein Konto" }); }
    // Das erste Konto und die in ADMIN_EMAIL genannten Adressen verwalten den Server
    const u = { id: auth.id(6), email, name, pass: auth.hashPassword(d.password), sv: 0, created: Date.now(), lastLogin: Date.now(), siteAdmin: !users.length || ADMIN_EMAILS.includes(email), plan: "free", planUntil: 0 };
    users.push(u); store.saveUsers(users); applyInvites(u); applyPendingPurchases(u);
    return send(res, 200, { user: publicUser(u) }, { "Set-Cookie": auth.cookie("cl", auth.makeSession(SECRET, u), { secure: secureReq(req) }) });
  }
  if (a === "login" && post) {
    if (!AUTH_ON) return send(res, 400, { error: "Anmeldung ist im lokalen Modus nicht nötig" });
    const d = await readBody(req), email = String(d.email || "").trim().toLowerCase(), k = "li:" + ip + ":" + email;
    if (blocked(k) || blocked("li:" + ip)) return send(res, 429, { error: "Zu viele Fehlversuche, bitte eine Minute warten" });
    const u = userByEmail(email);
    if (!u || !auth.verifyPassword(String(d.password || ""), u.pass)) { fail(k); fail("li:" + ip); return send(res, 401, { error: "E-Mail oder Passwort stimmt nicht" }); }
    if (u.disabled) return send(res, 403, { error: "Dieses Konto ist gesperrt" });
    if (ADMIN_EMAILS.includes(email)) u.siteAdmin = true;
    u.lastLogin = Date.now(); store.saveUsers(users);
    applyInvites(u); applyPendingPurchases(u);
    return send(res, 200, { user: publicUser(u) }, { "Set-Cookie": auth.cookie("cl", auth.makeSession(SECRET, u), { secure: secureReq(req) }) });
  }
  if (a === "logout" && post) return send(res, 200, { ok: true }, { "Set-Cookie": auth.cookie("cl", "", { secure: secureReq(req), maxAge: 0 }) });

  // --- Geteilte Ansichten (per Link, ohne Login) ---
  if (a === "s") {
    const h = [...hosts.values()].find((x) => x.meta.shares.some((s) => s.token === b && !s.revoked));
    const share = h?.meta.shares.find((s) => s.token === b);
    if (!h) return send(res, 404, { error: "Dieser Link ist ungültig oder wurde widerrufen" });
    if (c === "events") return sse(req, res, h, true);
    if (c === "state") return send(res, 200, JSON.parse(payload(h, true)));
    if (c === "meta") return send(res, 200, { name: h.meta.name, view: share.view, params: share.params });
    if (c === "action" && post) {
      const d = await readBody(req);
      if (d.type !== "ready" || share.view !== "gewerk") return send(res, 403, { error: "Mit diesem Link ist nur ansehen möglich" });
      try { h.engine.act({ type: "ready", gewerk: d.gewerk, state: d.state }); } catch (e) { return send(res, 400, { error: e.message }); }
      broadcast(h);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Nicht gefunden" });
  }

  // Ab hier nur mit Konto
  if (!user) return send(res, 401, { error: "Bitte anmelden" });

  if (a === "me") {
    const list = [...hosts.values()].filter((h) => roleIn(h, user)).sort((x, y) => y.meta.updated - x.meta.updated).map((h) => projectSummary(h, user));
    return send(res, 200, { user: publicUser(user), projects: list, auth: AUTH_ON });
  }
  if (a === "account" && post) {
    if (user.local) return send(res, 400, { error: "Im lokalen Modus gibt es kein Konto" });
    const d = await readBody(req);
    if ("name" in d) { const n = String(d.name).trim().slice(0, 60); if (!n) return send(res, 400, { error: "Bitte einen Namen eingeben" }); user.name = n; }
    let headers = {};
    if (d.password) {
      if (!auth.verifyPassword(String(d.current || ""), user.pass)) return send(res, 401, { error: "Das aktuelle Passwort stimmt nicht" });
      if (String(d.password).length < 8) return send(res, 400, { error: "Das neue Passwort braucht mindestens 8 Zeichen" });
      user.pass = auth.hashPassword(d.password); user.sv = (user.sv || 0) + 1; // andere Sitzungen enden
      headers = { "Set-Cookie": auth.cookie("cl", auth.makeSession(SECRET, user), { secure: secureReq(req) }) };
    }
    store.saveUsers(users);
    return send(res, 200, { user: publicUser(user) }, headers);
  }
  if (a === "projects" && post) {
    const d = await readBody(req), name = String(d.name || "").trim().slice(0, 80);
    if (!name) return send(res, 400, { error: "Bitte einen Namen eingeben" });
    if (!user.local && ownedProjects(user) >= limits(user).projects) return send(res, 402, { error: "Im Free-Plan ist ein eigenes Projekt möglich. Für mehr Projekte auf Pro wechseln.", upgrade: true });
    let tz = String(d.timezone || TZ_DEFAULT);
    try { new Intl.DateTimeFormat("de", { timeZone: tz }); } catch (_) { tz = TZ_DEFAULT; }
    const h = newProject({ name, timezone: tz, sample: !!d.sample, owner: user });
    return send(res, 200, { id: h.meta.id });
  }
  if (a === "admin") return siteAdminApi(req, res, segs.slice(1), user);

  // --- Projekt ---
  if (a === "p") {
    const h = hosts.get(b), role = h && roleIn(h, user);
    if (!h || !role) return send(res, 404, { error: "Projekt nicht gefunden" });
    if (c === "events") return sse(req, res, h, false);
    if (c === "state") return send(res, 200, JSON.parse(payload(h, false)));
    if (c === "status") return send(res, 200, status(h));
    if (c === "draft") return send(res, 200, { draft: h.state.draft, rev: h.state.draftRev });
    if (c === "meta") {
      const admin = role === "admin";
      return send(res, 200, {
        id: h.meta.id, name: h.meta.name, role, user: publicUser(user), auth: AUTH_ON, triggers: TRIGGERS, oscPort: OSC_PORT, apiBase: `${baseUrl(req)}/api/p/${h.meta.id}`,
        members: h.meta.members.map((m) => { const u = userById(m.userId); return { userId: m.userId, role: m.role, name: u?.name || "?", email: admin ? u?.email : undefined }; }),
        invites: admin ? h.meta.invites : [], shares: h.meta.shares.filter((s) => !s.revoked).map((s) => shareView(req, s)), audit: admin ? h.meta.audit.slice(0, 120) : [],
        tokens: admin ? h.meta.tokens.filter((t) => !t.revoked).map(({ hash, ...t }) => t) : [], trigLog: h.trig?.log || [],
      });
    }
    if (c === "action" && post) {
      const act = await readBody(req);
      const pre = { title: act.id ? titleOf(h, act.id) : "" };
      if (!user.local && PLANS) {
        const L = limits(user);
        if (act.type === "dayAdd" && (h.state.draft || h.state).days.length >= L.days) return send(res, 402, { error: `Im Free-Plan sind ${L.days} Tage je Projekt möglich. Für mehr Tage auf Pro wechseln.`, upgrade: true });
        if (/^(target|rule)Add$/.test(act.type) && !L.integrations) return send(res, 402, { error: "Trigger und Integrationen gibt es im Pro-Plan.", upgrade: true });
      }
      let out; try { out = h.engine.act(act); } catch (e) { return send(res, 400, { error: e.message }); }
      const text = describe(h, act, pre);
      if (text) audit(h, user, text);
      broadcast(h);
      return send(res, 200, { ok: true, id: typeof out === "string" ? out : undefined });
    }
    if (c === "admin" && post) return projectAdmin(req, res, h, role, user, await readBody(req));
    if (c === "trigtest" && post) { // ein Ziel von Hand testen
      const d = await readBody(req), t = h.state.integrations.targets.find((x) => x.id === d.id);
      if (!t) return send(res, 404, { error: "Ziel nicht gefunden" });
      const entry = await Trig.fireOne(h, t, CLS.fill(d.payload ?? "", { title: "Test", event: "test", show: h.state.show.name, clock: CLS.hhmmss(CLS.nowParts(Date.now(), h.state.settings.timezone).sec) }), "Test", TRIGGERS);
      return send(res, entry.ok ? 200 : 400, entry.ok ? { ok: true, info: entry.info } : { error: entry.info });
    }
  }
  return send(res, 404, { error: "Nicht gefunden" });
}

// Verwaltung eines Projekts: Name, Mitglieder, Einladungen, Freigaben, API-Schlüssel, Kopie, Löschen
function projectAdmin(req, res, h, role, user, d) {
  const admin = role === "admin", m = h.meta;
  const adminCount = () => m.members.filter((x) => x.role === "admin").length;
  const deny = () => send(res, 403, { error: "Das darf nur ein Admin" });
  const ok = (extra = {}) => { touch(h); send(res, 200, { ok: true, ...extra }); };
  switch (d.type) {
    case "rename": {
      if (!admin) return deny();
      const name = String(d.name || "").trim().slice(0, 80);
      if (!name) return send(res, 400, { error: "Bitte einen Namen eingeben" });
      m.name = name; h.state.show.name = name; if (h.state.draft) h.state.draft.show.name = name;
      audit(h, user, `Projekt umbenannt in „${name}“`); broadcast(h);
      return ok();
    }
    case "memberAdd": {
      if (!admin) return deny();
      const email = String(d.email || "").trim().toLowerCase(), r = d.role === "admin" ? "admin" : "editor";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "Bitte eine gültige E-Mail-Adresse eingeben" });
      const u = userByEmail(email);
      if (u) {
        if (m.members.some((x) => x.userId === u.id)) return send(res, 409, { error: "Diese Person ist schon Mitglied" });
        m.members.push({ userId: u.id, role: r });
        audit(h, user, `${u.name} als ${r === "admin" ? "Admin" : "Editor"} hinzugefügt`);
        return ok({ added: true });
      }
      if (!m.invites.some((x) => x.email === email)) m.invites.push({ email, role: r, by: user.name, t: Date.now() });
      audit(h, user, `Einladung an ${email} (${r === "admin" ? "Admin" : "Editor"})`);
      return ok({ invited: true });
    }
    case "memberRole": {
      if (!admin) return deny();
      const x = m.members.find((q) => q.userId === d.userId);
      if (!x) return send(res, 404, { error: "Mitglied nicht gefunden" });
      const r = d.role === "admin" ? "admin" : "editor";
      if (x.role === "admin" && r !== "admin" && adminCount() <= 1) return send(res, 400, { error: "Ein Projekt braucht mindestens einen Admin" });
      x.role = r; audit(h, user, `Rolle von ${userById(x.userId)?.name} auf ${r === "admin" ? "Admin" : "Editor"} gesetzt`);
      return ok();
    }
    case "memberRemove": {
      const self = d.userId === user.id;
      if (!admin && !self) return deny();
      const x = m.members.find((q) => q.userId === d.userId);
      if (!x) return send(res, 404, { error: "Mitglied nicht gefunden" });
      if (x.role === "admin" && adminCount() <= 1) return send(res, 400, { error: "Das ist der letzte Admin. Erst eine andere Person zum Admin machen" });
      m.members = m.members.filter((q) => q !== x);
      audit(h, user, self ? "Projekt verlassen" : `${userById(x.userId)?.name} entfernt`);
      return ok({ left: self });
    }
    case "inviteRemove": if (!admin) return deny(); m.invites = m.invites.filter((x) => x.email !== d.email); return ok();
    case "shareCreate": {
      if (!SHARE_VIEWS.has(d.view)) return send(res, 400, { error: "Diese Ansicht lässt sich nicht teilen" });
      const params = {};
      for (const k of SHARE_PARAMS) if (d.params && d.params[k]) params[k] = String(d.params[k]).slice(0, 40);
      if (params.g && !h.state.gewerke.some((g) => g.id === params.g)) return send(res, 400, { error: "Unbekanntes Gewerk" });
      let s = m.shares.find((x) => !x.revoked && x.view === d.view && JSON.stringify(x.params) === JSON.stringify(params));
      if (!s) {
        if (!user.local && m.shares.filter((x) => !x.revoked).length >= limits(user).shares) return send(res, 402, { error: `Im Free-Plan sind ${limits(user).shares} Freigabe-Links möglich. Für mehr auf Pro wechseln.`, upgrade: true });
        s = { id: auth.id(4), token: auth.token(18), view: d.view, params, label: String(d.label || "").slice(0, 60), by: user.name, created: Date.now() };
        m.shares.push(s); audit(h, user, `Freigabe-Link erstellt: ${d.view}${params.g ? " (" + params.g + ")" : ""}`);
      }
      return ok({ share: shareView(req, s) });
    }
    case "shareRevoke": {
      const s = m.shares.find((x) => x.id === d.id);
      if (!s) return send(res, 404, { error: "Link nicht gefunden" });
      s.revoked = true; audit(h, user, `Freigabe-Link widerrufen: ${s.view}`);
      for (const c of [...h.clients]) if (c.share) { c.res.end(); h.clients.delete(c); } // offene geteilte Verbindungen schließen
      return ok();
    }
    case "tokenCreate": {
      if (!admin) return deny();
      if (!user.local && !limits(user).tokens) return send(res, 402, { error: "API-Schlüssel gibt es im Pro-Plan.", upgrade: true });
      if (m.tokens.filter((t) => !t.revoked).length >= 20) return send(res, 400, { error: "Maximal 20 Schlüssel" });
      const raw = "tc_" + auth.token(24), t = { id: auth.id(4), name: String(d.name || "Companion").slice(0, 40), scope: d.scope === "read" ? "read" : "control", hash: hashToken(raw), prefix: raw.slice(0, 7), by: user.name, created: Date.now(), lastUsed: 0 };
      m.tokens.push(t); audit(h, user, `API-Schlüssel „${t.name}“ erstellt`);
      return ok({ token: raw, id: t.id });
    }
    case "tokenRevoke": {
      if (!admin) return deny();
      const t = m.tokens.find((x) => x.id === d.id); if (!t) return send(res, 404, { error: "Schlüssel nicht gefunden" });
      t.revoked = true; audit(h, user, `API-Schlüssel „${t.name}“ widerrufen`);
      return ok();
    }
    case "duplicate": {
      if (!user.local && ownedProjects(user) >= limits(user).projects) return send(res, 402, { error: "Im Free-Plan ist ein eigenes Projekt möglich. Für mehr Projekte auf Pro wechseln.", upgrade: true });
      const copy = newProject({ name: `${m.name} (Kopie)`, timezone: h.state.settings.timezone, sample: false, owner: user });
      const s = JSON.parse(JSON.stringify(h.state));
      Object.assign(s, { show: { name: copy.meta.name }, runtime: copy.state.runtime, ready: {}, log: [], draft: null, draftRev: 0, message: { text: "", visible: false } });
      s.runtime = { dayId: s.days[0].id, currentId: null, status: "stopped", startedAt: 0, pausedElapsed: 0, added: 0 };
      s.settings.roll = false;
      copy.state = s; copy.engine = Engine.create(s); store.saveProject(copy);
      return send(res, 200, { ok: true, id: copy.meta.id });
    }
    case "delete": {
      if (!admin) return deny();
      if (String(d.confirm || "") !== m.name) return send(res, 400, { error: "Der Projektname stimmt nicht überein" });
      for (const c of h.clients) c.res.end();
      hosts.delete(m.id); store.deleteProject(m.id);
      return send(res, 200, { ok: true });
    }
    default: return send(res, 400, { error: "Unbekannte Aktion" });
  }
}

// ---------- Server-Verwaltung (nur Server-Admins): Nutzer, Pläne, Käufe ----------
async function siteAdminApi(req, res, segs, user) {
  if (!isSiteAdmin(user)) return send(res, 403, { error: "Nur für Server-Admins" });
  const post = req.method === "POST", [a] = segs;
  const row = (u) => ({ id: u.id, name: u.name, email: u.email, siteAdmin: !!u.siteAdmin, disabled: !!u.disabled, plan: planOf(u), planSet: u.plan || "free", planUntil: u.planUntil || 0, created: u.created, lastLogin: u.lastLogin || 0,
    projects: [...hosts.values()].filter((h) => h.meta.members.some((m) => m.userId === u.id)).length, owned: ownedProjects(u) });
  if (a === "overview") {
    const now = Date.now(), live = [...hosts.values()].filter((h) => h.state.runtime.status === "running").length;
    const revenue = purchases.reduce((n, p) => n + (Number(p.amount) || 0), 0);
    return send(res, 200, {
      config: { auth: AUTH_ON, signup: SIGNUP, plans: PLANS, payLink: PAY_LINK, stripe: !!STRIPE_SECRET, triggers: TRIGGERS, oscPort: OSC_PORT, planMonths: PLAN_MONTHS, adminEmails: ADMIN_EMAILS, publicUrl: PUBLIC_URL, dataDir: DATA, version: require("./package.json").version },
      stats: { users: users.length, pro: users.filter((u) => planOf(u) === "pro" && !isSiteAdmin(u)).length, admins: users.filter((u) => u.siteAdmin).length, projects: hosts.size, live, newWeek: users.filter((u) => now - u.created < 7 * 86400000).length, purchases: purchases.length, revenue, currency: purchases.find((p) => p.currency)?.currency || "" },
      users: users.map(row).sort((x, y) => y.created - x.created),
      purchases: purchases.slice(0, 300),
      projects: [...hosts.values()].map((h) => ({ id: h.meta.id, name: h.meta.name, members: h.meta.members.length, owner: userById(h.meta.members.find((m) => m.role === "admin")?.userId)?.email || "", days: h.state.days.length, updated: h.meta.updated, status: h.state.runtime.status })).sort((x, y) => y.updated - x.updated),
    });
  }
  if (!post) return send(res, 404, { error: "Nicht gefunden" });
  const d = await readBody(req), u = userById(d.userId);
  if (a === "plan") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    if (d.plan === "free") { u.plan = "free"; u.planUntil = 0; purchases.unshift({ id: auth.id(5), t: Date.now(), userId: u.id, email: u.email, plan: "free", months: 0, source: "manual", ref: "", amount: 0, currency: "", by: user.name }); store.savePurchases(purchases); store.saveUsers(users); }
    else grantPlan(u, Number(d.months) || 0, { source: "manual", by: user.name, ref: String(d.note || "").slice(0, 80), amount: Number(d.amount) || 0, currency: String(d.currency || "").slice(0, 3).toUpperCase() });
    return send(res, 200, { ok: true, user: row(u) });
  }
  if (a === "siteAdmin") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    if (u.id === user.id && !d.on) return send(res, 400, { error: "Du kannst dir nicht selbst die Verwaltung entziehen" });
    u.siteAdmin = !!d.on; store.saveUsers(users);
    return send(res, 200, { ok: true, user: row(u) });
  }
  if (a === "disable") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    if (u.id === user.id) return send(res, 400, { error: "Du kannst dich nicht selbst sperren" });
    u.disabled = !!d.on; if (u.disabled) u.sv = (u.sv || 0) + 1; store.saveUsers(users);
    return send(res, 200, { ok: true, user: row(u) });
  }
  if (a === "password") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    const pw = auth.token(9); u.pass = auth.hashPassword(pw); u.sv = (u.sv || 0) + 1; store.saveUsers(users);
    return send(res, 200, { ok: true, password: pw });
  }
  if (a === "deleteUser") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    if (u.id === user.id) return send(res, 400, { error: "Du kannst dich nicht selbst löschen" });
    for (const h of hosts.values()) { const before = h.meta.members.length; h.meta.members = h.meta.members.filter((m) => m.userId !== u.id); if (h.meta.members.length !== before) touch(h); }
    users.splice(users.indexOf(u), 1); store.saveUsers(users);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "Nicht gefunden" });
}

// Stripe: checkout.session.completed schaltet Pro frei. Signatur: t=…,v1=HMAC-SHA256(secret, `${t}.${body}`)
async function stripeWebhook(req, res) {
  if (!STRIPE_SECRET) return send(res, 503, { error: "Stripe ist nicht eingerichtet (STRIPE_WEBHOOK_SECRET)" });
  const raw = await readRaw(req), sig = String(req.headers["stripe-signature"] || "");
  const t = /t=(\d+)/.exec(sig)?.[1], v1s = [...sig.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) return send(res, 400, { error: "Ungültige Signatur" });
  const want = crypto.createHmac("sha256", STRIPE_SECRET).update(`${t}.${raw}`).digest("hex");
  if (!v1s.some((v) => v.length === want.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(want)))) return send(res, 400, { error: "Ungültige Signatur" });
  let ev; try { ev = JSON.parse(raw); } catch (_) { return send(res, 400, { error: "Ungültige Anfrage" }); }
  if (ev.type === "checkout.session.completed" || ev.type === "invoice.paid") {
    const o = ev.data?.object || {}, email = String(o.customer_details?.email || o.customer_email || "").toLowerCase(), ref = String(o.id || ev.id || "");
    const months = Number(o.metadata?.months) || PLAN_MONTHS, amount = (Number(o.amount_total ?? o.amount_paid) || 0) / 100, currency = String(o.currency || "").toUpperCase();
    if (purchases.some((p) => p.ref === ref)) return send(res, 200, { ok: true, duplicate: true });
    const u = email && userByEmail(email);
    if (u) grantPlan(u, months, { source: "stripe", ref, amount, currency });
    else { purchases.unshift({ id: auth.id(5), t: Date.now(), userId: "", email, plan: "pro", months, source: "stripe", ref, amount, currency, by: "" }); store.savePurchases(purchases); }
  }
  return send(res, 200, { ok: true });
}

// ---------- OSC-Eingang ----------
if (OSC_PORT) Trig.listenOsc(OSC_PORT, (pid, cmd, args) => {
  const list = pid ? [hosts.get(pid)].filter(Boolean) : [...hosts.values()];
  const q = new URLSearchParams();
  const a0 = args[0] != null ? String(args[0]) : "", a1 = args[1] != null ? String(args[1]) : "";
  if (cmd === "load" || cmd === "day") q.set("id", a0); if (cmd === "add" || cmd === "sub") q.set("min", a0 || "1"); if (cmd === "roll") q.set("on", a0);
  if (cmd === "ready") { q.set("g", a0); q.set("state", a1); } if (cmd === "message") { q.set("text", a0); q.set("visible", a1 || "1"); } if (cmd === "lower") { if (a0 === "hide") q.set("visible", "0"); else if (a0 && a0 !== "show") q.set("id", a0); }
  const act = command(cmd, q); if (!act) return;
  for (const h of list) { try { h.engine.act(act); audit(h, { name: "OSC" }, describe(h, act, { title: "" }) || cmd); broadcast(h); } catch (_) {} }
});

// ---------- Seiten ----------
function memberPage(req, res, url, segs, user) {
  const h = hosts.get(segs[1]);
  if (!user) return redirect(res, "/login?next=" + encodeURIComponent(url.pathname + url.search));
  if (!h || !roleIn(h, user)) return page(res, 404, "Projekt nicht gefunden", "Dieses Projekt gibt es nicht, oder du bist kein Mitglied. Bitte den Admin des Projekts um eine Einladung.");
  if (segs.length === 2 && !url.pathname.endsWith("/")) return redirect(res, `/p/${segs[1]}/${url.search}`);
  const view = segs[2] || "regie";
  if (!MEMBER_VIEWS.has(view) && !SHARE_VIEWS.has(view)) return page(res, 404, "Seite nicht gefunden", "Diese Seite gibt es nicht.");
  return sendFile(res, path.join(VIEWS_DIR, view + ".html"));
}
function sharePage(req, res, url, segs) {
  const h = [...hosts.values()].find((x) => x.meta.shares.some((s) => s.token === segs[1] && !s.revoked));
  const s = h?.meta.shares.find((x) => x.token === segs[1]);
  if (!s) return page(res, 404, "Link ungültig", "Dieser Freigabe-Link ist ungültig oder wurde widerrufen.");
  const qs = new URLSearchParams(s.params).toString();
  const inject = `<script>window.CL_SHARE=${JSON.stringify({ view: s.view })};window.CL_SEARCH=${JSON.stringify(qs ? "?" + qs : "")};</script>`;
  return sendFile(res, path.join(VIEWS_DIR, s.view + ".html"), { inject });
}

async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  const url = new URL(req.url, "http://x"), segs = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const user = currentUser(req), top = segs[0];
  if (top === "api") return api(req, res, url, segs.slice(1), user);
  if (top === "p") return memberPage(req, res, url, segs, user);
  if (top === "s") return sharePage(req, res, url, segs);
  if (!top) return !AUTH_ON ? redirect(res, "/app") : sendFile(res, path.join(PUB, "index.html"));
  if (top === "login" || top === "signup") return user && AUTH_ON ? redirect(res, url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next") : "/app") : !AUTH_ON ? redirect(res, "/app") : sendFile(res, path.join(PUB, "login.html"));
  if (top === "app" && segs.length === 1) return AUTH_ON && !user ? redirect(res, "/login?next=/app") : sendFile(res, path.join(PUB, "app.html"));
  if (top === "admin" && segs.length === 1) return !user ? redirect(res, "/login?next=/admin") : !isSiteAdmin(user) ? page(res, 403, "Kein Zugriff", "Diese Seite ist nur für Server-Admins.") : sendFile(res, path.join(PUB, "admin.html"));
  // Statische Dateien (nur Assets, keine HTML-Seiten)
  const file = path.join(PUB, path.normalize(url.pathname));
  const ext = path.extname(file);
  if (!file.startsWith(PUB + path.sep) || !ext || ext === ".html") { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
  return sendFile(res, file);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e && /zu groß|Ungültige Anfrage/.test(e.message)) { if (!res.headersSent) send(res, 400, { error: e.message }); return; }
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Serverfehler" }); else res.end();
  });
});
const lanUrls = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && (i.family === "IPv4" || i.family === 4) && !i.internal).map((i) => `http://${i.address}:${PORT}`);
if (require.main === module) server.listen(PORT, HOST, () => {
  console.log(`Tallycall läuft auf Port ${PORT} (${hosts.size} Projekt${hosts.size === 1 ? "" : "e"}, Daten: ${DATA})`);
  for (const u of lanUrls()) console.log(`  im Netzwerk: ${u}`);
  console.log(AUTH_ON ? `  Konten: an${SIGNUP ? " (Registrierung offen, ALLOW_SIGNUP=0 schließt sie)" : " (Registrierung geschlossen)"}, Lizenzen: ${PLANS ? "an" : "aus"}` : "  ACHTUNG: lokaler Modus ohne Login. Jeder im Netzwerk kann alles ändern. Online nie so betreiben.");
  console.log(`  Trigger: ${TRIGGERS}${OSC_PORT ? "" : " (OSC-Eingang aus, OSC_PORT setzt ihn)"}`);
});
module.exports = { server };
