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
const Legal = require("./lib/legal.js");
const Md = require("./lib/md.js");
const License = require("./lib/license.js");
const Mail = require("./lib/mail.js");

const PORT = Number(process.env.PORT) || 4001;
const HOST = process.env.HOST || "0.0.0.0";
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const AUTH_ON = (process.env.TALLYCALL_AUTH || "on") !== "off"; // "off" = lokaler Betrieb ohne Login
const SIGNUP_ENV = process.env.ALLOW_SIGNUP !== "0";
const TZ_DEFAULT = process.env.TZ_SHOW || "Europe/Berlin";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
// Trigger-Politik: all (jede Adresse, lokaler Betrieb) | public (nur öffentliche Adressen, online) | off
const TRIGGERS = process.env.TALLYCALL_TRIGGERS || (AUTH_ON ? "public" : "all");
const OSC_ENV = Number(process.env.OSC_PORT) || 0; // OSC-Eingang, 0 = aus (änderbar unter Verwaltung → Server)
// Kundenversion: tools/build-dist.js setzt TC_BUILD ({ pub, issuer, buy }) fest in den Code. Im Quelltext (Online-Dienst, Entwicklung) ist es null.
const BUILD = typeof TC_BUILD !== "undefined" ? TC_BUILD : null;
const DIST = !!BUILD;
// Lizenzen: on = Free/Pro mit Grenzen, off = alles frei. Server-Admins haben immer Pro. Die Kundenversion braucht immer einen Lizenzschlüssel.
const PLANS = DIST || (process.env.TALLYCALL_PLANS || (AUTH_ON ? "on" : "off")) === "on";
const PAY_LINK_ENV = process.env.PAY_LINK || ""; // z. B. Stripe Payment Link (änderbar unter Verwaltung → Server)
const PLAN_MONTHS = Number(process.env.PLAN_MONTHS) || 1; // Laufzeit je Zahlung (Monatsabo)
const PLAN_GRACE = 3 * 86400000; // Nachfrist nach Ablauf, bis die Verlängerung eintrifft
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const ADMIN_EMAILS = String(process.env.ADMIN_EMAIL || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
// Free: eine Show mit höchstens einer Stunde Inhalt (Summe aller Punkte und Pausen). Pro: unbegrenzt. Neue Konten und neue Kundeninstallationen testen 7 Tage lang alles.
const LIMITS = { free: { projects: 1, days: Infinity, shares: Infinity, integrations: false, tokens: false, content: 3600 }, pro: { projects: Infinity, days: Infinity, shares: Infinity, integrations: true, tokens: true, content: Infinity } };
const TRIAL_DAYS = process.env.TRIAL_DAYS != null && process.env.TRIAL_DAYS !== "" ? Math.max(0, Number(process.env.TRIAL_DAYS) || 0) : License.TRIAL_DAYS;
const PUB = path.join(__dirname, "public");
const VIEWS_DIR = path.join(__dirname, "views");
const store = require("./lib/store.js").open(DATA);
const SECRET = auth.loadSecret(DATA);

// Server-Einstellungen, die der Admin im Browser ändert (data/site.json): Rechtstexte, Preis, Zahlungslink, OSC-Port, Registrierung
const site = (() => {
  const d = { legal: Legal.DEFAULTS(), payLink: "", price: { amount: "7,99", currency: "EUR" }, oscPort: null, signup: null, mail: {} }, s = store.loadSite() || {};
  return { ...d, ...s, legal: { ...d.legal, ...(s.legal || {}) }, price: { ...d.price, ...(s.price || {}) }, mail: { ...(s.mail || {}) } };
})();
const saveSite = () => store.saveSite(site);
const payLink = () => (DIST && BUILD.buy) || site.payLink || PAY_LINK_ENV;
const portalLink = () => site.portalLink || process.env.PORTAL_LINK || "";
const signupOpen = () => (site.signup == null ? SIGNUP_ENV : !!site.signup);
const oscPortNow = () => (site.oscPort != null && site.oscPort !== "" ? Number(site.oscPort) || 0 : OSC_ENV);

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
// Bestehende Installationen: Konten aus ADMIN_EMAIL werden Admin; gibt es keinen Admin, wird das älteste Konto Admin
if (!ADMIN_EMAILS.length && users.length && !users.some((u) => u.siteAdmin)) { users.slice().sort((x, y) => x.created - y.created)[0].siteAdmin = true; store.saveUsers(users); }
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

function newProject({ name, timezone, sample, template, owner }) {
  const state = Engine.createState({ name, timezone, sample, template });
  const meta = { id: auth.id(6), name, created: Date.now(), updated: Date.now(), members: owner && !owner.local ? [{ userId: owner.id, role: "admin" }] : [], invites: [], shares: [], audit: [], tokens: [] };
  const h = addHost({ meta, state });
  store.saveProject(h);
  return h;
}
if (!AUTH_ON && !hosts.size) newProject({ name: "Beispielshow", timezone: TZ_DEFAULT, sample: true });

const isMember = (h, user) => !!user && h.meta.members.some((m) => m.userId === user.id);
// Der Server-Admin darf jedes Projekt öffnen und verwalten; alle anderen sehen nur ihre eigenen und geteilte Projekte
const roleIn = (h, user) => (!AUTH_ON ? "admin" : user ? h.meta.members.find((m) => m.userId === user.id)?.role || (isSiteAdmin(user) ? "admin" : null) : null);
const touch = (h) => { h.meta.updated = Date.now(); store.saveProject(h); };

// ---------- Lizenzschlüssel (Kundenversion) und Lizenzserver ----------
const licInst = License.loadInstance(DATA);
const lic = store.loadJson("license.json", {}); // { key, checked, revoked, msg }
if (!lic.key && process.env.TALLYCALL_LICENSE) lic.key = String(process.env.TALLYCALL_LICENSE).trim();
let licMemo = null;
const licSave = () => { licMemo = null; store.saveJson("license.json", lic); };
function licState() {
  if (!DIST) return { state: "online", pro: true };
  if (licMemo && Date.now() - licMemo.t < 30000) return licMemo.v;
  let v;
  if (lic.revoked) v = { state: "revoked", pro: false, reason: lic.msg || "Die Lizenz wurde gesperrt" };
  else {
    const r = lic.key ? License.verify(lic.key, BUILD.pub, { instance: licInst.id }) : null;
    if (r && r.ok) v = { state: r.state, pro: true, payload: r.payload, daysLeft: r.daysLeft };
    else if (r) v = { state: r.state, pro: false, payload: r.payload, reason: r.reason };
    else { const t = License.trial(licInst); v = t.active ? { state: "trial", pro: true, daysLeft: t.daysLeft } : { state: "none", pro: false }; }
  }
  licMemo = { t: Date.now(), v }; return v;
}
// Anfrage an den Lizenzserver: Sperrung, Verlängerung (neuer Schlüssel) und Bindung an diese Installation
function licCheck() {
  if (!DIST || !lic.key || !BUILD.issuer) return Promise.resolve();
  const u = new URL(BUILD.issuer.replace(/\/$/, "") + "/api/license/check"), body = JSON.stringify({ key: lic.key, instance: licInst.id, version: require("./package.json").version });
  return new Promise((resolve) => {
    const rq = (u.protocol === "https:" ? require("https") : http).request(u, { method: "POST", timeout: 8000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (r) => {
      let t = ""; r.on("data", (c) => (t += c)); r.on("end", () => {
        try {
          const j = JSON.parse(t); lic.checked = Date.now();
          if (j.revoked || j.invalid || j.reason === "instance") { lic.revoked = true; lic.msg = j.message || j.reason || "Die Lizenz wurde gesperrt"; }
          else if (j.ok) { lic.revoked = false; lic.msg = ""; if (j.key && License.verify(j.key, BUILD.pub, { instance: licInst.id }).ok) lic.key = j.key; }
          licSave();
        } catch (_) {}
        resolve();
      });
    });
    rq.on("error", () => resolve()); rq.on("timeout", () => { rq.destroy(); resolve(); }); rq.end(body);
  });
}
if (DIST) { setTimeout(licCheck, 20000).unref(); setInterval(licCheck, 12 * 3600000).unref(); }
// Lizenzserver (nur dort, wo der private Schlüssel liegt)
let ISSUER_PRIV = (process.env.LICENSE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const ISSUER_FILE = path.join(DATA, "license-private.pem");
if (!ISSUER_PRIV) { try { ISSUER_PRIV = fs.readFileSync(ISSUER_FILE, "utf8"); } catch (_) {} }
const issuerPub = () => (ISSUER_PRIV ? License.publicFrom(ISSUER_PRIV) : "");
const licRecords = (store.loadJson("licenses.json", { records: [] }).records) || [];
const saveRecords = () => store.saveJson("licenses.json", { records: licRecords });
const recKey = (r) => License.sign({ id: r.id, name: r.customer, email: r.email, exp: r.until || 0, max: r.max || 1, inst: r.inst || "" }, ISSUER_PRIV);
const checkHits = new Map();
function licenseCheck(req, res, ip) {
  if (!ISSUER_PRIV) return send(res, 404, { error: "Kein Lizenzserver" });
  const n = (checkHits.get(ip) || []).filter((t) => Date.now() - t < 60000); n.push(Date.now()); checkHits.set(ip, n);
  if (n.length > 20) return send(res, 429, { error: "Zu viele Anfragen" });
  return readBody(req, 20000).then((d) => {
    const v = License.verify(d.key, issuerPub(), { instance: "" }), rec = v.payload && licRecords.find((r) => r.id === v.payload.id);
    if (!rec || (!v.ok && v.state !== "expired")) return send(res, 200, { ok: false, invalid: true, message: "Der Lizenzschlüssel ist ungültig" });
    if (rec.revoked) return send(res, 200, { ok: false, revoked: true, message: "Die Lizenz wurde gesperrt. Bitte beim Anbieter melden." });
    const instance = String(d.instance || "").slice(0, 40), now = Date.now();
    let slot = rec.instances.find((x) => x.id === instance);
    if (!slot) {
      if (rec.instances.length >= (rec.max || 1)) return send(res, 200, { ok: false, reason: "instance", message: "Dieser Schlüssel ist bereits auf der erlaubten Anzahl Installationen aktiv." });
      slot = { id: instance, first: now, last: now, version: "" }; rec.instances.push(slot);
    }
    slot.last = now; slot.version = String(d.version || "").slice(0, 20); rec.lastSeen = now; saveRecords();
    const renew = rec.until !== (Number(v.payload.exp) || 0) && (!rec.until || rec.until > (Number(v.payload.exp) || 0));
    return send(res, 200, { ok: true, until: rec.until, ...(renew ? { key: License.sign({ id: rec.id, name: rec.customer, email: rec.email, exp: rec.until, max: rec.max || 1, inst: v.payload.inst || "" }, ISSUER_PRIV) } : {}) });
  }).catch((e) => send(res, 400, { error: e.message }));
}

// ---------- E-Mail (SMTP) ----------
// Einstellungen: Verwaltung → Mail oder Umgebungsvariablen SMTP_HOST, SMTP_PORT, SMTP_SECURE (starttls|tls|none), SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO
const mailCfg = () => {
  const m = site.mail || {}, e = process.env;
  const secure = ["starttls", "tls", "none"].includes(m.secure) ? m.secure : ["starttls", "tls", "none"].includes(e.SMTP_SECURE) ? e.SMTP_SECURE : "starttls";
  return { host: m.host || e.SMTP_HOST || "", port: Number(m.port || e.SMTP_PORT) || (secure === "tls" ? 465 : 587), secure, user: m.user ?? e.SMTP_USER ?? "", pass: m.pass || e.SMTP_PASS || "", from: m.from || e.SMTP_FROM || "", replyTo: m.replyTo || e.SMTP_REPLY_TO || "", insecureTls: process.env.SMTP_INSECURE_TLS === "1" };
};
const mailOn = () => { const c = mailCfg(); return !!(c.host && c.from); };
const mailLog = []; // letzte Versandergebnisse für die Verwaltung
const mailQueue = []; let mailBusy = false;
function mailPump() {
  if (mailBusy || !mailQueue.length) return; mailBusy = true;
  const job = mailQueue.shift();
  const attempt = (n) => Mail.smtpSend(mailCfg(), job.msg).then(() => { mailLog.unshift({ t: Date.now(), to: job.msg.to, subject: job.msg.subject, ok: true }); job.resolve(true); }, (err) => {
    if (n < 2) return new Promise((r) => setTimeout(r, n ? 5000 : 2000)).then(() => attempt(n + 1));
    mailLog.unshift({ t: Date.now(), to: job.msg.to, subject: job.msg.subject, ok: false, error: err.message }); job.resolve(false, err);
  }).finally(() => { mailLog.length = Math.min(mailLog.length, 100); });
  attempt(0).finally(() => { mailBusy = false; setTimeout(mailPump, job.gap || 0); });
}
// Legt eine Mail in die Warteschlange. Gibt ein Versprechen zurück: true = gesendet, false = fehlgeschlagen (nach 3 Versuchen).
function sendMail(to, subject, parts, { headers, gap } = {}) {
  const c = mailCfg(); if (!(c.host && c.from)) return Promise.resolve(false);
  const { html, text } = Mail.layout({ title: parts.title || subject, body: parts.body, button: parts.button, footer: parts.footer });
  return new Promise((resolve) => { mailQueue.push({ msg: { from: c.from, to, subject, text, html, replyTo: c.replyTo, headers }, resolve: (ok) => resolve(ok), gap }); mailPump(); });
}
const LANG_IDS = ["en", "de", "es", "fr", "it", "pt", "zh", "ja"];
const userLang = (u) => (u && u.lang === "de" ? "de" : "en"); // Mailtexte gibt es auf Deutsch und Englisch
const unsubToken = (u) => crypto.createHmac("sha256", SECRET).update("unsub:" + u.id).digest("base64url").slice(0, 32);
const unsubUrl = (req, u) => `${baseUrl(req)}/unsubscribe?u=${u.id}&t=${unsubToken(u)}`;
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const hits = new Map(); // einfache Zeitfenster-Bremse: Schlüssel -> Zeitpunkte
const rate = (k, max, win) => { const n = (hits.get(k) || []).filter((t) => Date.now() - t < win); n.push(Date.now()); hits.set(k, n); return n.length > max; };
const legalLine = () => { const l = site.legal || {}; return ["Tallycall", [l.name, l.street, [l.zip, l.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" · "); };
const fmtDate = (ms, u) => new Date(ms).toLocaleDateString(userLang(u) === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
function mailWelcome(req, u) {
  const t = Mail.T(userLang(u)), end = PLANS && !DIST && TRIAL_DAYS ? fmtDate(u.created + TRIAL_DAYS * 86400000, u) : "";
  return sendMail(u.email, t.welcomeSubject, { title: t.welcomeTitle, body: t.welcomeBody(u.name, end), button: { label: t.welcomeButton, url: baseUrl(req) + "/app" }, footer: t.service + "\n" + legalLine() });
}
function mailPasswordChanged(req, u) {
  const t = Mail.T(userLang(u));
  return sendMail(u.email, t.changedSubject, { title: t.changedTitle, body: t.changedBody(u.name), button: { label: t.changedButton, url: baseUrl(req) + "/forgot" }, footer: t.service + "\n" + legalLine() });
}
let mailJob = null; // laufender oder letzter Rundversand
function mailAudience(kind) {
  const act = users.filter((u) => !u.disabled && u.email);
  if (kind === "news") return act.filter((u) => u.mailNews === true);
  if (kind === "all") return act;
  if (kind === "pro") return act.filter((u) => planOf(u) === "pro" && !isSiteAdmin(u));
  if (kind === "free") return act.filter((u) => planOf(u) === "free");
  return [];
}
function mailAnnounce(req, subject, body, kind, me) {
  const list = kind === "me" ? [me] : mailAudience(kind), job = { id: auth.id(4), subject, kind, total: list.length, sent: 0, failed: 0, done: !list.length, started: Date.now() };
  mailJob = job;
  (async () => {
    for (const u of list) {
      const lang = userLang(u), t = Mail.T(lang), unsub = unsubUrl(req, u);
      const ok = await sendMail(u.email, subject, { title: subject, body: body.replace(/\{name\}/g, u.name), footer: (kind === "news" || kind === "me" ? `${t.unsubscribe}: ${unsub}` : t.service) + "\n" + legalLine() }, { headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, gap: 300 });
      ok ? job.sent++ : job.failed++;
    }
    job.done = true;
  })();
  return job;
}

// Automatische Mails rund um die Testphase: kurz vor dem Ende und nach dem Ende. Alte Konten bekommen nichts nachträglich.
const priceText = () => `${site.price.amount} ${({ EUR: "€", USD: "$", GBP: "£", CHF: "CHF" }[site.price.currency] || site.price.currency || "")}`.trim();
async function mailLifecycle() {
  if (!mailOn() || DIST || !PLANS || !TRIAL_DAYS || !PUBLIC_URL) return;
  const now = Date.now(), base = PUBLIC_URL, soonMs = Math.min(2, TRIAL_DAYS / 3) * 86400000;
  for (const u of users) {
    if (u.disabled || !u.email || isSiteAdmin(u) || (u.plan === "pro" && (!u.planUntil || u.planUntil > now))) continue;
    const end = u.created + TRIAL_DAYS * 86400000, left = end - now, m = (u.mails = u.mails || {}), t = Mail.T(userLang(u));
    const link = { label: "", url: `${base || ""}/app?upgrade=1` };
    if (!m.soon && left > 0 && left <= soonMs) {
      m.soon = now; store.saveUsers(users);
      await sendMail(u.email, t.soonSubject, { title: t.soonTitle, body: t.soonBody(u.name, fmtDate(end, u), priceText()), button: { ...link, label: t.soonButton }, footer: t.service + "\n" + legalLine() });
    } else if (!m.ended && left <= 0 && left > -3 * 86400000) {
      m.ended = now; m.soon = m.soon || now; store.saveUsers(users);
      await sendMail(u.email, t.endedSubject, { title: t.endedTitle, body: t.endedBody(u.name, priceText()), button: { ...link, label: t.endedButton }, footer: t.service + "\n" + legalLine() });
    } else if (left <= -3 * 86400000 && !m.ended) { m.ended = m.soon = -1; store.saveUsers(users); } // schon lange abgelaufen: nichts nachsenden
  }
}
if (require.main === module || process.env.TC_BOOT === "1") setInterval(() => mailLifecycle().catch((e) => console.error("Mail:", e.message)), Number(process.env.TC_MAIL_TICK_MS) || 600000).unref();

// ---------- Feedback-Fenster ----------
const fbStore = store.loadJson("feedback.json", { items: [] }), fbItems = fbStore.items || [];
const fbSave = () => store.saveJson("feedback.json", { items: fbItems });
const fbNew = () => fbItems.filter((x) => x.status === "new").length;
let fbNotified = 0;
function fbNotify(item) {
  if (!mailOn() || (site.mail || {}).notify === false || Date.now() - fbNotified < 600000) return;
  const to = (ADMIN_EMAILS.length ? ADMIN_EMAILS : users.filter(isSiteAdmin).map((u) => u.email)).filter(Boolean)[0]; if (!to) return;
  fbNotified = Date.now();
  const adm = users.find((u) => u.email === to), t = Mail.T(userLang(adm)), base = PUBLIC_URL || "";
  const who = item.name ? `${item.name} <${item.email || "–"}>` : item.email || "anonymous";
  sendMail(to, t.fbSubject(item.type), { title: t.fbTitle, body: `${item.type.toUpperCase()} · ${who}\n${item.page}\n\n${item.text}\n\n(${fbNew()} new in total)`, button: { label: "Admin", url: base + "/admin#feedback" } }).catch(() => {});
}

// ---------- Lizenzen ----------
// Mit ADMIN_EMAIL sind nur diese Adressen Server-Admin. Ohne die Variable gilt das Flag am Konto (das erste Konto bekommt es).
const isSiteAdmin = (u) => !!u && (!!u.local || (ADMIN_EMAILS.length ? ADMIN_EMAILS.includes(String(u.email).toLowerCase()) : !!u.siteAdmin));
const trialUntil = (u) => { if (DIST) { const t = licState(); return t.state === "trial" ? licInst.trialStart + License.TRIAL_DAYS * 86400000 : 0; } const e = !PLANS || !u || u.local || !TRIAL_DAYS ? 0 : u.created + TRIAL_DAYS * 86400000; return e > Date.now() ? e : 0; };
const planOf = (u) => (DIST ? (licState().pro ? "pro" : "free") : !PLANS || isSiteAdmin(u) || (u && u.plan === "pro" && (!u.planUntil || u.planUntil + PLAN_GRACE > Date.now())) || trialUntil(u) ? "pro" : "free");
const limits = (u) => LIMITS[planOf(u)];
const planInfo = (u) => ({ plan: planOf(u), until: u?.planUntil || 0, enforced: PLANS, license: DIST ? (({ state, daysLeft }) => ({ state, daysLeft }))(licState()) : null, payLink: payLink(), portalLink: portalLink(), price: site.price, trialUntil: DIST ? trialUntil(u) : planOf(u) === "pro" && !(u && u.plan === "pro") && !isSiteAdmin(u) ? trialUntil(u) : 0, limits: { ...limits(u), content: isFinite(limits(u).content) ? limits(u).content : 0, projects: isFinite(limits(u).projects) ? limits(u).projects : 0, days: isFinite(limits(u).days) ? limits(u).days : 0, shares: isFinite(limits(u).shares) ? limits(u).shares : 0 } });
// Plan-Grenzen gelten nach dem Besitzer des Projekts (erster Admin), nicht nach der Person, die gerade arbeitet
const ownerOf = (h) => { const m = h.meta.members.find((x) => x.role === "admin"); return m ? userById(m.userId) : null; };
const limitsOf = (h, fallback) => limits(ownerOf(h) || fallback);
const enforce = (u) => PLANS && !!u && (!u.local || DIST); // lokaler Modus ohne Lizenzprüfung bleibt unbegrenzt
const ownedCount = (u) => (u.local ? hosts.size : ownedProjects(u));
const contentSec = (st) => ((st && st.draft) || st).days.reduce((n, d) => n + d.events.reduce((m, e) => m + (e.type === "group" ? 0 : Number(e.duration) || 0), 0), 0);
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
  try { if (limitsOf(h, LOCAL_USER).integrations) Trig.evaluate(h, TRIGGERS); } catch (e) { console.error("Trigger:", e.message); }
}
setInterval(() => { for (const h of hosts.values()) for (const c of h.clients) c.res.write(": ping\n\n"); }, 15000);
setInterval(() => { for (const h of hosts.values()) { if (h.engine.tick()) broadcast(h); else try { if (limitsOf(h, LOCAL_USER).integrations) Trig.evaluate(h, TRIGGERS); } catch (_) {} } }, 500);
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
    case "lowerSave": case "lowerDelete": case "lowerMove": return "Bauchbinden-Liste geändert";
    case "designSave": case "designDelete": return "Bauchbinden-Designs geändert";
    case "targetAdd": case "targetUpdate": case "targetDelete": return "Trigger-Ziele geändert";
    case "ruleAdd": case "ruleUpdate": case "ruleDelete": return "Trigger-Regeln geändert";
    default: return null;
  }
}

// ---------- HTTP-Helfer ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".tgz": "application/gzip", ".zip": "application/zip" };
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
    const ext = path.extname(file), dl = ext === ".tgz" || ext === ".zip" ? { "Content-Disposition": `attachment; filename="${path.basename(file)}"` } : {};
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache", ...dl });
    res.end(out);
  });
}
const page = (res, code, title, text) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><link rel="stylesheet" href="/app.css"><body class="msgpage"><div><h1>${title}</h1><p>${text}</p><p><a class="btn" href="/app">Zu meinen Projekten</a></p></div><script src="/i18n.js"></script>`); };

const fails = new Map(); // Bremse gegen Passwort-Raten: Schlüssel -> {n, until}
const blocked = (k) => { const f = fails.get(k); return f && f.n >= 10 && Date.now() < f.until; };
const fail = (k) => { const f = fails.get(k) || { n: 0 }; f.n++; f.until = Date.now() + 60000; fails.set(k, f); };

function currentUser(req) {
  if (!AUTH_ON) return LOCAL_USER;
  const s = auth.readSession(SECRET, auth.parseCookies(req.headers.cookie).cl);
  const u = s && userById(s.uid);
  return u && (u.sv || 0) === s.sv ? u : null;
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, local: !!u.local, siteAdmin: isSiteAdmin(u), news: u.mailNews === true, ...(isSiteAdmin(u) ? { feedbackNew: fbNew() } : {}), ...planInfo(u) });
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
  if (k && !limitsOf(h, LOCAL_USER).tokens) return null;
  if (k) { k.lastUsed = Date.now(); }
  return k || null;
}
// Kurzbefehle per GET (Stream Deck „Website öffnen“, Companion, Browser): /api/p/<id>/cmd/<befehl>?token=…
function command(name, q) {
  const v = (k) => q.get(k) ?? "";
  switch (name) {
    case "start": return v("id") ? { type: "start", id: v("id") } : { type: "start", dayId: v("day") || undefined };
    case "pause": case "toggle": case "stop": case "next": case "prev": case "readyReset": return { type: name, dayId: v("day") || undefined };
    case "go": return { type: "next" };
    case "goto": return { type: "start", id: v("id") };
    case "messageoff": return { type: "message", text: "", visible: false };
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
  const items = s.days.flatMap((d) => d.events.filter((x) => x.type !== "group" && !CLS.effSkip(d.events, x)).map((x) => ({ id: x.id, title: x.title, type: x.type, dayId: d.id, day: d.name, color: x.color })));
  return { show: s.show.name, project: h.meta.id, items, status: e ? r.status : "idle", day: day ? { id: day.id, name: day.name, date: day.date } : null,
    current: e ? { id: e.id, title: e.title, subtitle: e.subtitle, presenter: e.presenter, type: e.type, duration: e.duration, color: e.color } : null,
    next: next ? { id: next.id, title: next.title, type: next.type } : null,
    remaining: Math.round(rem / 1000), remainingText: CLS.fmt(rem), elapsed: Math.round(h.engine.elapsed() / 1000), added: Math.round(r.added / 1000),
    level: !e ? "ok" : rem < 0 ? "over" : rem <= s.settings.warnRed * 1000 ? "danger" : rem <= s.settings.warnYellow * 1000 ? "warn" : "ok",
    clock: CLS.hhmmss(CLS.nowParts(Date.now(), s.settings.timezone).sec), roll: s.settings.roll, message: s.message,
    ready: Object.fromEntries(s.gewerke.map((g) => [g.id, s.ready[g.id]?.state || ""])), gewerke: s.gewerke.map((g) => ({ id: g.id, name: g.name, short: g.short, color: g.color })),
    lowers: s.lowers, lower: { id: s.lowers.find((q) => q.title === s.lower.title && q.subtitle === s.lower.subtitle)?.id || "", title: s.lower.title, subtitle: s.lower.subtitle, visible: s.lower.visible }, days: s.days.map((d) => ({ id: d.id, name: d.name, date: d.date })), hasDraft: !!s.draft, serverTime: Date.now() };
}

// ---------- API ----------
async function api(req, res, url, segs, user) {
  const ip = req.socket.remoteAddress, post = req.method === "POST";
  const [a, b, c, d2] = segs;
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cl", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }); return res.end(); }

  if (a === "health") return send(res, 200, { ok: true });
  if (a === "config") return send(res, 200, { auth: AUTH_ON, mail: mailOn(), signup: signupOpen(), plans: PLANS, payLink: payLink(), portalLink: portalLink(), price: site.price });
  if (a === "stripe" && b === "webhook" && post) return stripeWebhook(req, res);
  if (a === "license" && b === "check" && post) return licenseCheck(req, res, ip);

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
    if (!signupOpen()) return send(res, 403, { error: "Die Registrierung ist auf diesem Server geschlossen" });
    if (blocked("su:" + ip)) return send(res, 429, { error: "Zu viele Versuche, bitte kurz warten" });
    const d = await readBody(req), email = String(d.email || "").trim().toLowerCase(), name = String(d.name || "").trim().slice(0, 60);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return send(res, 400, { error: "Bitte eine gültige E-Mail-Adresse eingeben" });
    if (!name) return send(res, 400, { error: "Bitte einen Namen eingeben" });
    if (String(d.password || "").length < 8) return send(res, 400, { error: "Das Passwort braucht mindestens 8 Zeichen" });
    if (userByEmail(email)) { fail("su:" + ip); return send(res, 409, { error: "Mit dieser E-Mail gibt es schon ein Konto" }); }
    // Das erste Konto und die in ADMIN_EMAIL genannten Adressen verwalten den Server
    const u = { id: auth.id(6), email, name, pass: auth.hashPassword(d.password), sv: 0, created: Date.now(), lastLogin: Date.now(), siteAdmin: !ADMIN_EMAILS.length && !users.length, plan: "free", planUntil: 0, lang: LANG_IDS.includes(d.lang) ? d.lang : "en", mailNews: d.news === true };
    users.push(u); store.saveUsers(users); applyInvites(u); applyPendingPurchases(u);
    if (mailOn()) mailWelcome(req, u).catch(() => {});
    return send(res, 200, { user: publicUser(u) }, { "Set-Cookie": auth.cookie("cl", auth.makeSession(SECRET, u), { secure: secureReq(req) }) });
  }
  if (a === "login" && post) {
    if (!AUTH_ON) return send(res, 400, { error: "Anmeldung ist im lokalen Modus nicht nötig" });
    const d = await readBody(req), email = String(d.email || "").trim().toLowerCase(), k = "li:" + ip + ":" + email;
    if (blocked(k) || blocked("li:" + ip)) return send(res, 429, { error: "Zu viele Fehlversuche, bitte eine Minute warten" });
    const u = userByEmail(email);
    if (!u || !auth.verifyPassword(String(d.password || ""), u.pass)) { fail(k); fail("li:" + ip); return send(res, 401, { error: "E-Mail oder Passwort stimmt nicht" }); }
    if (u.disabled) return send(res, 403, { error: "Dieses Konto ist gesperrt" });
    u.lastLogin = Date.now(); store.saveUsers(users);
    applyInvites(u); applyPendingPurchases(u);
    return send(res, 200, { user: publicUser(u) }, { "Set-Cookie": auth.cookie("cl", auth.makeSession(SECRET, u), { secure: secureReq(req) }) });
  }
  if (a === "logout" && post) return send(res, 200, { ok: true }, { "Set-Cookie": auth.cookie("cl", "", { secure: secureReq(req), maxAge: 0 }) });

  // Passwort vergessen: immer dieselbe Antwort, damit sich nicht herausfinden lässt, welche Adressen ein Konto haben
  if (a === "forgot" && post) {
    if (!AUTH_ON) return send(res, 400, { error: "Anmeldung ist im lokalen Modus nicht nötig" });
    if (!mailOn()) return send(res, 503, { error: "Auf diesem Server ist der E-Mail-Versand nicht eingerichtet. Bitte den Admin bitten, das Passwort zurückzusetzen." });
    const d = await readBody(req), email = String(d.email || "").trim().toLowerCase();
    if (rate("fg:" + ip, 8, 600000)) return send(res, 429, { error: "Zu viele Versuche, bitte später erneut versuchen" });
    const u = userByEmail(email);
    if (u && !u.disabled && !rate("fgu:" + u.id, 1, 60000)) {
      const tok = auth.token(32); u.reset = { h: sha(tok), exp: Date.now() + 3600000 };
      if (LANG_IDS.includes(d.lang)) u.lang = d.lang;
      store.saveUsers(users);
      const t = Mail.T(userLang(u));
      sendMail(u.email, t.resetSubject, { title: t.resetTitle, body: t.resetBody(u.name), button: { label: t.resetButton, url: `${baseUrl(req)}/reset?token=${tok}` }, footer: t.service + "\n" + legalLine() }).catch(() => {});
    }
    return send(res, 200, { ok: true });
  }
  if (a === "reset" && post) {
    if (!AUTH_ON) return send(res, 400, { error: "Anmeldung ist im lokalen Modus nicht nötig" });
    if (rate("rs:" + ip, 20, 600000)) return send(res, 429, { error: "Zu viele Versuche, bitte später erneut versuchen" });
    const d = await readBody(req), h = sha(d.token || ""), u = users.find((x) => x.reset && x.reset.h === h);
    if (!u || u.reset.exp < Date.now() || u.disabled) return send(res, 400, { error: "Dieser Link ist ungültig oder abgelaufen. Bitte einen neuen anfordern." });
    if (String(d.password || "").length < 8) return send(res, 400, { error: "Das Passwort braucht mindestens 8 Zeichen" });
    u.pass = auth.hashPassword(d.password); u.sv = (u.sv || 0) + 1; delete u.reset; store.saveUsers(users);
    if (mailOn()) mailPasswordChanged(req, u).catch(() => {});
    return send(res, 200, { ok: true });
  }
  if (a === "feedback" && post) {
    const d = await readBody(req), text = String(d.text || "").trim().slice(0, 2000);
    if (!text) return send(res, 400, { error: "Bitte eine Nachricht eingeben" });
    if (rate("fb:" + ip, user ? 20 : 6, 3600000)) return send(res, 429, { error: "Zu viele Nachrichten, bitte später erneut versuchen" });
    const email = String(d.email || "").trim().slice(0, 120), item = { id: auth.id(5), t: Date.now(), type: ["bug", "idea", "other"].includes(d.type) ? d.type : "other", text, userId: user?.id || "", name: user?.name || "", email: user?.email || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""), page: String(d.page || "").slice(0, 200), lang: String(d.lang || "").slice(0, 5), screen: String(d.screen || "").slice(0, 12), ua: String(req.headers["user-agent"] || "").slice(0, 200), status: "new", replies: [] };
    fbItems.unshift(item); if (fbItems.length > 2000) fbItems.length = 2000; fbSave(); fbNotify(item);
    return send(res, 200, { ok: true });
  }
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
    const mine = [...hosts.values()].filter((h) => isMember(h, user) || !AUTH_ON).sort((x, y) => y.meta.updated - x.meta.updated).map((h) => projectSummary(h, user));
    const others = AUTH_ON && isSiteAdmin(user) ? [...hosts.values()].filter((h) => !isMember(h, user)).sort((x, y) => y.meta.updated - x.meta.updated).map((h) => ({ ...projectSummary(h, user), owner: userById(h.meta.members.find((m) => m.role === "admin")?.userId)?.email || "" })) : [];
    return send(res, 200, { user: publicUser(user), projects: mine, others, auth: AUTH_ON });
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
      if (mailOn()) mailPasswordChanged(req, user).catch(() => {});
    }
    if ("news" in d) user.mailNews = d.news === true;
    store.saveUsers(users);
    return send(res, 200, { user: publicUser(user) }, headers);
  }
  if (a === "projects" && post) {
    const d = await readBody(req), name = String(d.name || "").trim().slice(0, 80);
    if (!name) return send(res, 400, { error: "Bitte einen Namen eingeben" });
    if (enforce(user) && ownedCount(user) >= limits(user).projects) return send(res, 402, { error: "Im Free-Plan ist ein eigenes Projekt möglich. Für mehr Projekte auf Pro wechseln.", upgrade: true });
    let tz = String(d.timezone || TZ_DEFAULT);
    try { new Intl.DateTimeFormat("de", { timeZone: tz }); } catch (_) { tz = TZ_DEFAULT; }
    const tpl = ["conference", "concert", "empty"].includes(d.template) ? d.template : "";
    if (enforce(user) && isFinite(limits(user).content) && contentSec(Engine.createState({ name, timezone: tz, sample: !!d.sample, template: tpl })) > limits(user).content) return send(res, 402, { error: "Diese Vorlage hat mehr als 60 Minuten Inhalt. Im Free-Plan bitte „Leer“ wählen oder auf Pro wechseln." });
    const h = newProject({ name, timezone: tz, sample: !!d.sample, template: tpl, owner: user });
    return send(res, 200, { id: h.meta.id });
  }
  if (a === "admin") return siteAdminApi(req, res, segs.slice(1), user, url);

  // --- Projekt ---
  if (a === "p") {
    const h = hosts.get(b), role = h && roleIn(h, user);
    if (!h || !role) return send(res, 404, { error: "Projekt nicht gefunden" });
    if (c === "events") return sse(req, res, h, false);
    if (c === "state") return send(res, 200, JSON.parse(payload(h, false)));
    if (c === "status") return send(res, 200, status(h));
    if (c === "draft") return send(res, 200, { draft: h.state.draft, rev: h.state.draftRev });
    if (c === "export.csv") return exportCsv(res, h, url.searchParams.get("kind") === "actual" ? "actual" : "plan");
    if (c === "meta") {
      const admin = role === "admin";
      return send(res, 200, {
        id: h.meta.id, name: h.meta.name, role, user: publicUser(user), auth: AUTH_ON, triggers: TRIGGERS, oscPort: oscPortNow(), oscOk: oscState.ok, viaAdmin: AUTH_ON && !isMember(h, user), apiBase: `${baseUrl(req)}/api/p/${h.meta.id}`,
        members: h.meta.members.map((m) => { const u = userById(m.userId); return { userId: m.userId, role: m.role, name: u?.name || "?", email: admin ? u?.email : undefined }; }),
        invites: admin ? h.meta.invites : [], shares: h.meta.shares.filter((s) => !s.revoked).map((s) => shareView(req, s)), audit: admin ? h.meta.audit.slice(0, 120) : [],
        tokens: admin ? h.meta.tokens.filter((t) => !t.revoked).map(({ hash, ...t }) => t) : [], trigLog: h.trig?.log || [],
      });
    }
    if (c === "cmd" && post) { // wie GET /cmd mit Schlüssel, aber mit Konto (Cookie + Schutz-Header): für das Companion-Modul im Konto- oder Lokal-Modus
      const act = command(d2, url.searchParams);
      if (!act) return send(res, 404, { error: "Unbekannter Befehl" });
      try { h.engine.act(act); } catch (e) { return send(res, 400, { error: e.message }); }
      const text = describe(h, act, { title: act.id ? titleOf(h, act.id) : "" }); if (text) audit(h, user, text);
      broadcast(h);
      return send(res, 200, { ok: true, ...status(h) });
    }
    if (c === "action" && post) {
      const act = await readBody(req);
      const pre = { title: act.id ? titleOf(h, act.id) : "" };
      if (enforce(user)) {
        const L = limitsOf(h, user);
        if (act.type === "dayAdd" && (h.state.draft || h.state).days.length >= L.days) return send(res, 402, { error: `Im Free-Plan sind ${L.days} Tage je Projekt möglich. Für mehr Tage auf Pro wechseln.`, upgrade: true });
        if (/^(target|rule)Add$/.test(act.type) && !L.integrations) return send(res, 402, { error: "Trigger und Integrationen gibt es im Pro-Plan.", upgrade: true });
      }
      if (enforce(user) && isFinite(limitsOf(h, user).content)) { // Inhalt darf im Free-Plan nicht über die Grenze wachsen
        const L = limitsOf(h, user), before = contentSec(h.state);
        try { const probe = JSON.parse(JSON.stringify(h.state)); Engine.create(probe).act(JSON.parse(JSON.stringify(act))); const after = contentSec(probe); if (after > L.content && after > before) return send(res, 402, { error: "Im Free-Plan sind höchstens 60 Minuten Inhalt je Show möglich. Für mehr Inhalt auf Pro wechseln.", upgrade: true }); } catch (_) {}
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
        if (enforce(user) && m.shares.filter((x) => !x.revoked).length >= limitsOf(h, user).shares) return send(res, 402, { error: `Im Free-Plan sind ${limitsOf(h, user).shares} Freigabe-Links möglich. Für mehr auf Pro wechseln.`, upgrade: true });
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
      if (enforce(user) && !limitsOf(h, user).tokens) return send(res, 402, { error: "API-Schlüssel gibt es im Pro-Plan.", upgrade: true });
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
      if (enforce(user) && ownedCount(user) >= limits(user).projects) return send(res, 402, { error: "Im Free-Plan ist ein eigenes Projekt möglich. Für mehr Projekte auf Pro wechseln.", upgrade: true });
      const copy = newProject({ name: `${m.name} (Kopie)`, timezone: h.state.settings.timezone, sample: false, owner: user });
      const s = JSON.parse(JSON.stringify(h.state));
      Object.assign(s, { show: { name: copy.meta.name }, runtime: copy.state.runtime, ready: {}, log: [], actuals: {}, draft: null, draftRev: 0, message: { text: "", visible: false } });
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
async function siteAdminApi(req, res, segs, user, url) {
  if (!isSiteAdmin(user)) return send(res, 403, { error: "Nur für Server-Admins" });
  const post = req.method === "POST", [a] = segs;
  const row = (u) => ({ trial: !isSiteAdmin(u) && planOf(u) === "pro" && u.plan !== "pro" ? trialUntil(u) : 0, id: u.id, name: u.name, email: u.email, siteAdmin: isSiteAdmin(u), disabled: !!u.disabled, plan: planOf(u), planSet: u.plan || "free", planUntil: u.planUntil || 0, created: u.created, lastLogin: u.lastLogin || 0,
    projects: [...hosts.values()].filter((h) => h.meta.members.some((m) => m.userId === u.id)).length, owned: ownedProjects(u) });
  if (a === "legal-preview") {
    const kind = url.searchParams.get("kind") === "impressum" ? "impressum" : "privacy", lang = url.searchParams.get("lang") === "en" ? "en" : "de";
    return send(res, 200, { html: kind === "impressum" ? Legal.impressum(site.legal, lang) : Legal.privacy(site.legal, lang, { domain: legalDomain(), plans: PLANS }) });
  }
  if (a === "license") {
    const st = licState(), mask = (k) => (k ? k.slice(0, 10) + "…" + k.slice(-6) : "");
    return send(res, 200, { dist: DIST, state: st.state, pro: st.pro, reason: st.reason || "", daysLeft: st.daysLeft ?? null, customer: st.payload?.name || "", email: st.payload?.email || "", until: st.payload?.exp || 0, key: mask(lic.key), checked: lic.checked || 0, instance: licInst.id, buy: BUILD?.buy || "", issuer: { enabled: !!ISSUER_PRIV, pub: issuerPub(), url: PUBLIC_URL },
      records: ISSUER_PRIV ? licRecords.map((r) => ({ ...r })).sort((x, y) => y.created - x.created) : [] });
  }
  if (a === "mail") {
    const c = mailCfg(), m = site.mail || {};
    return send(res, 200, { configured: mailOn(), cfg: { host: c.host, port: c.port, secure: c.secure, user: c.user, from: c.from, replyTo: c.replyTo, hasPass: !!c.pass }, env: { host: !!process.env.SMTP_HOST, pass: !!process.env.SMTP_PASS && !m.pass }, log: mailLog, job: mailJob,
      counts: { news: mailAudience("news").length, all: mailAudience("all").length, pro: mailAudience("pro").length, free: mailAudience("free").length } });
  }
  if (a === "feedback") return send(res, 200, { items: fbItems, news: fbNew(), mail: mailOn() });
  if (a === "overview") {
    const now = Date.now(), live = [...hosts.values()].filter((h) => h.state.runtime.status === "running").length;
    const revenue = purchases.reduce((n, p) => n + (Number(p.amount) || 0), 0);
    return send(res, 200, {
      config: { auth: AUTH_ON, signup: signupOpen(), plans: PLANS, payLink: payLink(), stripe: !!STRIPE_SECRET, triggers: TRIGGERS, oscPort: oscPortNow(), planMonths: PLAN_MONTHS, adminEmails: ADMIN_EMAILS, adminLocked: ADMIN_EMAILS.length > 0, publicUrl: PUBLIC_URL, dataDir: DATA, version: require("./package.json").version },
      stats: { users: users.length, pro: users.filter((u) => planOf(u) === "pro" && !isSiteAdmin(u)).length, admins: users.filter(isSiteAdmin).length, projects: hosts.size, live, newWeek: users.filter((u) => now - u.created < 7 * 86400000).length, purchases: purchases.length, revenue, currency: purchases.find((p) => p.currency)?.currency || "" },
      site: { legal: site.legal, price: site.price, payLink: site.payLink || "", portalLink: site.portalLink || "", payLinkEnv: !!PAY_LINK_ENV, oscPort: site.oscPort ?? "", oscEnv: OSC_ENV, osc: oscState, signup: signupOpen(), signupEnv: SIGNUP_ENV, legalMissing: Legal.missing(site.legal) },
      users: users.map(row).sort((x, y) => y.created - x.created),
      purchases: purchases.slice(0, 300),
      projects: [...hosts.values()].map((h) => ({ id: h.meta.id, name: h.meta.name, members: h.meta.members.length, owner: userById(h.meta.members.find((m) => m.role === "admin")?.userId)?.email || "", days: h.state.days.length, updated: h.meta.updated, status: h.state.runtime.status })).sort((x, y) => y.updated - x.updated),
    });
  }
  if (!post) return send(res, 404, { error: "Nicht gefunden" });
  const d = await readBody(req), u = userById(d.userId);
  if (a === "license-init") {
    if (DIST || ISSUER_PRIV) return send(res, 400, { error: "Es gibt bereits einen Lizenzschlüssel-Generator" });
    const kp = License.generateKeyPair(); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(ISSUER_FILE, kp.priv, { mode: 0o600 }); ISSUER_PRIV = kp.priv;
    return send(res, 200, { ok: true, pub: kp.pub });
  }
  if (a.startsWith("license-") && a !== "license-activate" && a !== "license-check") {
    if (!ISSUER_PRIV) return send(res, 400, { error: "Auf diesem Server ist keine Lizenzausstellung eingerichtet" });
    const rec = licRecords.find((r) => r.id === d.id), mo = (n) => Math.max(0, Math.min(120, Number(n) || 0));
    if (a === "license-issue") {
      const customer = String(d.customer || "").trim().slice(0, 80); if (!customer) return send(res, 400, { error: "Bitte den Kundennamen eingeben" });
      const months = mo(d.months), r = { id: auth.id(5), customer, email: String(d.email || "").trim().toLowerCase().slice(0, 120), note: String(d.note || "").slice(0, 200), created: Date.now(), until: months ? Date.now() + months * 30.44 * 86400000 : 0, max: Math.max(1, Math.min(50, Number(d.max) || 1)), inst: String(d.inst || "").trim().slice(0, 40), instances: [], revoked: false, lastSeen: 0 };
      licRecords.unshift(r); saveRecords();
      return send(res, 200, { ok: true, id: r.id, key: recKey(r) });
    }
    if (!rec) return send(res, 404, { error: "Lizenz nicht gefunden" });
    if (a === "license-key") return send(res, 200, { ok: true, key: recKey(rec) });
    if (a === "license-extend") { if (rec.until) { rec.until = Math.max(Date.now(), rec.until) + mo(d.months || 1) * 30.44 * 86400000; saveRecords(); } return send(res, 200, { ok: true, key: recKey(rec) }); }
    if (a === "license-revoke") { rec.revoked = !!d.revoked; saveRecords(); return send(res, 200, { ok: true }); }
    if (a === "license-reset") { rec.instances = []; saveRecords(); return send(res, 200, { ok: true }); }
    if (a === "license-delete") { licRecords.splice(licRecords.indexOf(rec), 1); saveRecords(); return send(res, 200, { ok: true }); }
  }
  if (a === "license-activate") {
    if (!DIST) return send(res, 400, { error: "Diese Version braucht keinen Lizenzschlüssel" });
    const v = License.verify(d.key, BUILD.pub, { instance: licInst.id });
    if (!v.ok && v.state !== "expired") return send(res, 400, { error: v.reason || "Der Lizenzschlüssel ist ungültig" });
    lic.key = String(d.key).replace(/\s+/g, ""); lic.revoked = false; lic.msg = ""; licSave();
    await licCheck();
    return send(res, 200, { ok: true });
  }
  if (a === "license-check") { await licCheck(); return send(res, 200, { ok: true }); }
  if (a === "settings") {
    if ("payLink" in d) { const v = String(d.payLink || "").trim().slice(0, 300); if (v && !/^https:\/\//.test(v)) return send(res, 400, { error: "Der Zahlungslink muss mit https:// beginnen" }); site.payLink = v; }
    if ("portalLink" in d) { const v = String(d.portalLink || "").trim().slice(0, 300); if (v && !/^https:\/\//.test(v)) return send(res, 400, { error: "Der Kundenportal-Link muss mit https:// beginnen" }); site.portalLink = v; }
    if ("priceAmount" in d) { const v = String(d.priceAmount || "").trim().slice(0, 12); if (!/^\d{1,5}([.,]\d{1,2})?$/.test(v)) return send(res, 400, { error: "Bitte einen Preis wie 7,99 eingeben" }); site.price.amount = v; }
    if ("priceNote" in d) site.price.note = String(d.priceNote || "").trim().slice(0, 80);
    if ("priceCurrency" in d) site.price.currency = String(d.priceCurrency || "EUR").toUpperCase().slice(0, 3);
    if ("signup" in d) site.signup = d.signup === null ? null : !!d.signup;
    if ("oscPort" in d) { const v = d.oscPort === "" || d.oscPort == null ? null : Number(d.oscPort); if (v != null && !(Number.isInteger(v) && v >= 1024 && v <= 65535)) return send(res, 400, { error: "OSC-Port: Zahl zwischen 1024 und 65535 oder leer" }); site.oscPort = v; startOsc(); }
    saveSite();
    return send(res, 200, { ok: true, osc: oscState });
  }
  if (a === "feedback-status") { const it = fbItems.find((x) => x.id === d.id); if (!it) return send(res, 404, { error: "Nicht gefunden" }); it.status = d.status === "done" ? "done" : "new"; fbSave(); return send(res, 200, { ok: true, news: fbNew() }); }
  if (a === "feedback-delete") { const i = fbItems.findIndex((x) => x.id === d.id); if (i >= 0) fbItems.splice(i, 1); fbSave(); return send(res, 200, { ok: true, news: fbNew() }); }
  if (a === "feedback-reply") {
    const it = fbItems.find((x) => x.id === d.id), text = String(d.text || "").trim().slice(0, 4000);
    if (!it) return send(res, 404, { error: "Nicht gefunden" });
    if (!it.email) return send(res, 400, { error: "Diese Person hat keine E-Mail-Adresse angegeben" });
    if (!text) return send(res, 400, { error: "Bitte eine Antwort eingeben" });
    if (!mailOn()) return send(res, 400, { error: "Bitte zuerst den Mailserver einrichten" });
    const t = Mail.T(it.lang === "de" ? "de" : "en"), ok = await sendMail(it.email, t.replySubject, { title: t.replyTitle, body: `${text}\n\n— ${t.replyQuote}:\n${it.text}` });
    if (!ok) return send(res, 502, { error: "Versand fehlgeschlagen: " + (mailLog[0]?.error || "unbekannter Fehler") });
    it.replies.push({ t: Date.now(), by: user.name, text }); it.status = "done"; fbSave(); return send(res, 200, { ok: true, news: fbNew() });
  }
  if (a === "mail-settings") {
    const m = site.mail = site.mail || {}, str = (v, n) => String(v ?? "").trim().slice(0, n);
    if ("host" in d) { const v = str(d.host, 200); if (v && !/^[a-z0-9.-]+$/i.test(v)) return send(res, 400, { error: "Bitte einen gültigen Servernamen eingeben" }); m.host = v; }
    if ("port" in d) { const v = d.port === "" ? "" : Number(d.port); if (v !== "" && !(Number.isInteger(v) && v > 0 && v < 65536)) return send(res, 400, { error: "Bitte einen gültigen Port eingeben" }); m.port = v; }
    if ("secure" in d && ["starttls", "tls", "none"].includes(d.secure)) m.secure = d.secure;
    if ("user" in d) m.user = str(d.user, 200);
    if (d.pass) m.pass = String(d.pass).slice(0, 300); if (d.clearPass) m.pass = "";
    if ("from" in d) { const v = str(d.from, 200); if (v && !/^[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+$/.test(v)) return send(res, 400, { error: "Absender: bitte eine Adresse wie no-reply@tallycall.com oder Tallycall <no-reply@tallycall.com> eingeben" }); m.from = v; }
    if ("replyTo" in d) m.replyTo = str(d.replyTo, 200);
    saveSite(); return send(res, 200, { ok: true, configured: mailOn() });
  }
  if (a === "mail-test") {
    if (!mailOn()) return send(res, 400, { error: "Bitte zuerst Server und Absender eintragen" });
    const t = Mail.T(userLang(user)), ok = await sendMail(user.email || String(d.to || ""), t.testSubject, { title: t.testTitle, body: t.testBody(), footer: legalLine() });
    const last = mailLog[0];
    return ok ? send(res, 200, { ok: true }) : send(res, 502, { error: "Versand fehlgeschlagen: " + (last?.error || "unbekannter Fehler") });
  }
  if (a === "mail-send") {
    if (!mailOn()) return send(res, 400, { error: "Bitte zuerst den Mailserver einrichten" });
    if (mailJob && !mailJob.done) return send(res, 409, { error: "Es läuft bereits ein Versand" });
    const subject = String(d.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 150), body = String(d.body || "").trim().slice(0, 20000);
    if (!subject || !body) return send(res, 400, { error: "Bitte Betreff und Text eingeben" });
    const kind = ["news", "all", "pro", "free", "me"].includes(d.audience) ? d.audience : "me";
    if (kind === "me" && !user.email) return send(res, 400, { error: "Dein Konto hat keine E-Mail-Adresse" });
    if (kind !== "me" && !mailAudience(kind).length) return send(res, 400, { error: "Für diese Auswahl gibt es keine Empfänger" });
    return send(res, 200, { ok: true, job: mailAnnounce(req, subject, body, kind, user) });
  }
  if (a === "legal") {
    const L = d.legal || {}, cur = site.legal, def = Legal.DEFAULTS();
    for (const k of Object.keys(def)) if (k in L) cur[k] = typeof def[k] === "boolean" ? !!L[k] : typeof def[k] === "number" ? Math.max(1, Math.min(365, Number(L[k]) || def[k])) : String(L[k] ?? "").slice(0, k.startsWith("custom") ? 60000 : 600);
    saveSite();
    return send(res, 200, { ok: true, legalMissing: Legal.missing(cur) });
  }
  if (a === "plan") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    if (d.plan === "free") { u.plan = "free"; u.planUntil = 0; purchases.unshift({ id: auth.id(5), t: Date.now(), userId: u.id, email: u.email, plan: "free", months: 0, source: "manual", ref: "", amount: 0, currency: "", by: user.name }); store.savePurchases(purchases); store.saveUsers(users); }
    else grantPlan(u, Number(d.months) || 0, { source: "manual", by: user.name, ref: String(d.note || "").slice(0, 80), amount: Number(d.amount) || 0, currency: String(d.currency || "").slice(0, 3).toUpperCase() });
    return send(res, 200, { ok: true, user: row(u) });
  }
  if (a === "siteAdmin") {
    if (!u) return send(res, 404, { error: "Nutzer nicht gefunden" });
    if (ADMIN_EMAILS.length) return send(res, 400, { error: "Die Admins sind per ADMIN_EMAIL auf dem Server festgelegt" });
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
  // Abo: invoice.paid kommt bei der ersten Zahlung und bei jeder Verlängerung. Einmalzahlung: checkout.session.completed (mode=payment).
  const o = ev.data?.object || {};
  if (ev.type === "invoice.paid" || (ev.type === "checkout.session.completed" && o.mode === "payment")) {
    const email = String(o.customer_email || o.customer_details?.email || "").toLowerCase(), ref = String(o.id || ev.id || "");
    const months = Number(o.metadata?.months) || PLAN_MONTHS, amount = (Number(o.amount_paid ?? o.amount_total) || 0) / 100, currency = String(o.currency || "").toUpperCase();
    if (purchases.some((p) => p.ref === ref)) return send(res, 200, { ok: true, duplicate: true });
    const u = email && userByEmail(email);
    if (u) grantPlan(u, months, { source: "stripe", ref, amount, currency });
    else { purchases.unshift({ id: auth.id(5), t: Date.now(), userId: "", email, plan: "pro", months, source: "stripe", ref, amount, currency, by: "" }); store.savePurchases(purchases); }
  }
  return send(res, 200, { ok: true });
}

// ---------- OSC-Eingang ----------
// Adresse: /tallycall/<API-Schlüssel>/<befehl> [argumente]. Ohne Konten (lokaler Modus) zusätzlich /tallycall/<projekt-id>/<befehl> und /tallycall/<befehl> (alle Projekte).
let oscSock = null, oscState = { port: 0, ok: false, error: "" };
function tokenLookup(raw) {
  const hash = hashToken(raw);
  for (const h of hosts.values()) { const k = h.meta.tokens.find((x) => x.hash === hash && !x.revoked); if (k && limitsOf(h, LOCAL_USER).tokens) { k.lastUsed = Date.now(); return { h, key: k }; } }
  return null;
}
function oscCommand(seg, args) {
  const first = seg[0]; let list = [], cmd = "";
  if (/^tc_/.test(first)) { const f = tokenLookup(first); if (!f || f.key.scope === "read" || seg.length < 2) return; list = [f.h]; cmd = seg[1]; }
  else if (!AUTH_ON) { if (seg.length >= 2 && hosts.get(first)) { list = [hosts.get(first)]; cmd = seg[1]; } else if (seg.length === 1) { list = [...hosts.values()]; cmd = seg[0]; } else return; }
  else return;
  const q = new URLSearchParams(), a0 = args[0] != null ? String(args[0]) : "", a1 = args[1] != null ? String(args[1]) : "";
  cmd = cmd.toLowerCase();
  if (cmd === "start" || cmd === "goto" || cmd === "load" || cmd === "day") { if (a0) q.set("id", a0); }
  if (cmd === "add" || cmd === "sub") q.set("min", a0 || "1");
  if (cmd === "roll") q.set("on", a0 === "" ? "1" : a0);
  if (cmd === "ready") { q.set("g", a0); q.set("state", a1 || "ready"); }
  if (cmd === "message") { q.set("text", a0); q.set("visible", a1 || "1"); }
  if (cmd === "lower") { if (a0 === "hide" || a0 === "0") q.set("visible", "0"); else if (a0 && a0 !== "show") q.set("id", a0); }
  const act = command(cmd, q); if (!act) return;
  for (const h of list) { try { h.engine.act(act); audit(h, { name: "OSC" }, describe(h, act, { title: act.id ? titleOf(h, act.id) : "" }) || cmd); broadcast(h); } catch (_) {} }
}
function startOsc() {
  if (oscSock) { try { oscSock.close(); } catch (_) {} oscSock = null; }
  const port = oscPortNow(); oscState = { port, ok: false, error: "" };
  if (!port) return;
  oscSock = Trig.listenOsc(port, oscCommand, { onReady: () => { oscState.ok = true; console.log(`  OSC-Eingang auf UDP ${port} (/tallycall/<schlüssel>/<befehl>)`); }, onError: (e) => { oscState.ok = false; oscState.error = e.message; console.error("OSC-Eingang:", e.message); } });
}
if (require.main === module || process.env.TC_BOOT === "1") startOsc();

// ---------- Rechtliche Seiten und Exporte ----------
const legalDomain = () => { try { return new URL(PUBLIC_URL).hostname; } catch (_) { return ""; } };
function legalPage(req, res, url, kind, user) {
  const q = url.searchParams.get("lang"), lang = q === "de" ? "de" : "en"; // Standard: Englisch
  const html = Legal.render(kind === "impressum" ? "impressum" : "privacy", site.legal, lang, { domain: legalDomain(), plans: PLANS, incomplete: isSiteAdmin(user) && Legal.missing(site.legal).length > 0 });
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }); res.end(html);
}
const csvCell = (v) => { const t = String(v ?? "").replace(/\r?\n/g, " "); return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function exportCsv(res, h, kind) {
  const s = h.state, tz = s.settings.timezone, rows = [];
  const stamp = (ms) => { if (!ms) return ""; const p = CLS.nowParts(ms, tz); return `${p.date.split("-").reverse().join(".")} ${CLS.hhmmss(p.sec)}`; };
  const typeName = { event: "Punkt", group: "Gruppe", break: "Pause" };
  if (kind === "actual") {
    rows.push(["Tag", "Datum", "Titel", "Typ", "Plan Start", "Ist Start", "Abweichung Start (s)", "Plan Ende", "Ist Ende", "Plan Dauer", "Ist Dauer", "Abweichung Dauer (s)"]);
    for (const day of s.days) for (const r of CLS.schedule(day)) {
      const a = s.actuals[r.e.id]; if (r.group || !a || a.dayId !== day.id) continue;
      const ps = CLS.nowParts(a.start, tz), dev = ps.date === day.date ? ps.sec - r.start : "", dur = a.end ? Math.round((a.end - a.start) / 1000) : "";
      rows.push([day.name, day.date, r.e.title, typeName[r.e.type], CLS.hhmmss(r.start), stamp(a.start), dev, CLS.hhmmss(r.end), stamp(a.end), CLS.fmtDur(r.e.duration), dur === "" ? "" : CLS.fmtDur(dur), dur === "" ? "" : dur - r.e.duration]);
    }
  } else {
    rows.push(["Tag", "Datum", "Start", "Ende", "Dauer", "Typ", "Ebene", "Titel", "Untertitel", "Sprecher", "Notiz", "Cues"]);
    for (const day of s.days) for (const r of CLS.schedule(day)) {
      const cues = r.group ? "" : [...r.e.cues].sort((x, y) => x.offset - y.offset).map((c) => `${s.gewerke.find((g) => g.id === c.gewerk)?.short || "-"} +${CLS.fmtDur(c.offset)} ${c.text}`).join(" | ");
      rows.push([day.name, day.date, r.skip ? "" : CLS.hhmmss(r.start), r.group || r.skip ? "" : CLS.hhmmss(r.end), r.group ? "" : CLS.fmtDur(r.e.duration), typeName[r.e.type] + (r.skip ? " (entfällt)" : ""), r.depth, r.e.title, r.e.subtitle, r.e.presenter, r.e.note, cues]);
    }
  }
  const body = "\ufeff" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${(h.meta.name.replace(/[^\w.-]+/g, "_") || "projekt")}-${kind === "actual" ? "ist-zeiten" : "plan"}.csv"` });
  res.end(body);
}

const DOCS = { osc: ["OSC", "docs/OSC.md"], api: ["API und Trigger", "docs/INTEGRATIONS.md"], companion: ["Companion-Modul", "integrations/companion/README.md"], mail: ["E-Mail", "docs/MAIL.md"] };
function docsPage(res, name) {
  const d = DOCS[name]; if (!d) return page(res, 404, "Seite nicht gefunden", "Diese Anleitung gibt es nicht.");
  let md = ""; try { md = fs.readFileSync(path.join(__dirname, d[1]), "utf8"); } catch (_) { return page(res, 404, "Seite nicht gefunden", "Diese Anleitung gibt es nicht."); }
  const nav = Object.entries(DOCS).map(([k, v]) => `<a href="/docs/${k}"${k === name ? ' style="color:var(--fg)"' : ""}>${v[0]}</a>`).join("");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${d[0]} · Tallycall</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css">
<style>.lg { max-width:820px; margin:0 auto; padding:34px 20px 80px; } .lg h1 { font-size:32px; letter-spacing:-.03em; margin:26px 0 10px; } .lg h2 { font-size:21px; margin:34px 0 8px; letter-spacing:-.02em; } .lg h3 { font-size:16px; margin:22px 0 6px; } .lg p, .lg li { color:var(--fg2); line-height:1.65; } .lg li { margin:3px 0; } .lg a { color:var(--focus); } .lg blockquote { margin:14px 0; padding:10px 16px; border-left:3px solid var(--focus); background:var(--bg1); border-radius:0 10px 10px 0; color:var(--fg2); } .lg .code { margin:10px 0; overflow-x:auto; } .lg table { margin:12px 0; display:block; overflow-x:auto; max-width:100%; } .lg td, .lg th { padding:7px 8px; vertical-align:top; } .lg code { overflow-wrap:anywhere; } @media (max-width:600px) { .lg { padding:20px 14px 60px; } .lg h1 { font-size:26px; } .lgbar { gap:10px 14px; } .lgbar .sp { flex-basis:100%; height:0; } } .lgbar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; } .lgbar .sp { flex:1; }</style></head><body>
<div class="lg"><div class="lgbar"><a class="brand" href="/"><img src="/logo.svg" alt="">Tallycall</a><span class="sp"></span>${nav}</div>${Md.render(md)}</div></body></html>`);
}

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
  if (top === "docs" && segs.length === 2) return docsPage(res, segs[1]);
  if (top === "impressum" || top === "datenschutz") return legalPage(req, res, url, top, user);
  if (top === "p") return memberPage(req, res, url, segs, user);
  if (top === "s") return sharePage(req, res, url, segs);
  if (top === "unsubscribe") {
    const u = userById(url.searchParams.get("u") || ""), t = String(url.searchParams.get("t") || "");
    const ok = u && t.length === 32 && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(unsubToken(u)));
    if (ok) { u.mailNews = false; store.saveUsers(users); }
    if (req.method === "POST") { res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain" }); return res.end(ok ? "ok" : "invalid"); }
    return page(res, ok ? 200 : 400, ok ? "Abbestellt" : "Ungültiger Link", ok ? "Du bekommst keine Produktneuigkeiten von Tallycall mehr. Servicemitteilungen zu deinem Konto (zum Beispiel Passwort zurücksetzen) können weiterhin ankommen." : "Dieser Abmelde-Link ist nicht gültig.");
  }
  if (top === "forgot" || top === "reset") return !AUTH_ON ? redirect(res, "/app") : sendFile(res, path.join(PUB, "reset.html"));
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
if (require.main === module || process.env.TC_BOOT === "1") server.listen(PORT, HOST, () => {
  console.log(`Tallycall läuft auf Port ${PORT} (${hosts.size} Projekt${hosts.size === 1 ? "" : "e"}, Daten: ${DATA})`);
  for (const u of lanUrls()) console.log(`  im Netzwerk: ${u}`);
  console.log(AUTH_ON ? `  Konten: an${signupOpen() ? " (Registrierung offen, ALLOW_SIGNUP=0 schließt sie)" : " (Registrierung geschlossen)"}, Lizenzen: ${PLANS ? "an" : "aus"}` : "  ACHTUNG: lokaler Modus ohne Login. Jeder im Netzwerk kann alles ändern. Online nie so betreiben.");
  console.log(`  Trigger: ${TRIGGERS}${oscPortNow() ? "" : " (OSC-Eingang aus, Port unter Verwaltung → Server oder OSC_PORT)"}`);
});
module.exports = { server };
