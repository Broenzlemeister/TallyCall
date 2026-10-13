// Trigger: Nachrichten an Ziele (HTTP, OSC, TCP, UDP) senden und OSC-Befehle empfangen. Nur Node-Bordmittel.
// Ablauf: evaluate(h) vergleicht den Projektzustand mit dem letzten Stand und feuert Regeln, Punkt-Aktionen und Cue-Aktionen.
const http = require("http");
const https = require("https");
const net = require("net");
const dgram = require("dgram");
const dns = require("dns").promises;
const CLS = require("../public/shared.js");

// ---- OSC ----
const pad4 = (b) => { const r = (4 - (b.length % 4)) % 4; return r ? Buffer.concat([b, Buffer.alloc(r)]) : b; };
const oscStr = (s) => pad4(Buffer.concat([Buffer.from(String(s), "utf8"), Buffer.alloc(1)]));
// "/adresse 1 2.5 text "mit leerzeichen"" -> OSC-Paket. Zahlen werden zu int32/float32, Rest zu Strings.
function oscEncode(line) {
  const parts = tokenize(line);
  const addr = (parts.shift() || { v: "/" }).v;
  const tags = [","], bufs = [];
  for (const p of parts) {
    if (p.q) { tags.push("s"); bufs.push(oscStr(p.v)); }
    else if (/^-?\d+$/.test(p.v)) { const b = Buffer.alloc(4); b.writeInt32BE(Number(p.v)); tags.push("i"); bufs.push(b); }
    else if (/^-?\d*\.\d+$/.test(p.v)) { const b = Buffer.alloc(4); b.writeFloatBE(Number(p.v)); tags.push("f"); bufs.push(b); }
    else if (p.v === "true" || p.v === "false") tags.push(p.v === "true" ? "T" : "F");
    else { tags.push("s"); bufs.push(oscStr(p.v)); }
  }
  return Buffer.concat([oscStr(addr), oscStr(tags.join("")), ...bufs]);
}
function oscDecode(buf) {
  let i = 0;
  const str = () => { const e = buf.indexOf(0, i); const s = buf.toString("utf8", i, e < 0 ? buf.length : e); i = (e < 0 ? buf.length : e + 1); i = Math.ceil(i / 4) * 4; return s; };
  const addr = str(); if (!addr.startsWith("/")) return null;
  const tags = i < buf.length && buf[i] === 44 ? str().slice(1) : "";
  const args = [];
  for (const t of tags) {
    if (t === "i") { args.push(buf.readInt32BE(i)); i += 4; }
    else if (t === "f") { args.push(buf.readFloatBE(i)); i += 4; }
    else if (t === "s") args.push(str());
    else if (t === "T") args.push(true); else if (t === "F") args.push(false);
    else break;
  }
  return { addr, args };
}
function tokenize(line) {
  const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(String(line || "")))) out.push(m[1] != null ? { v: m[1], q: true } : { v: m[2], q: false });
  return out;
}

// ---- Zielschutz: online darf der Server keine privaten Adressen ansprechen (SSRF) ----
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)/i];
async function resolveHost(host, policy) {
  if (policy === "off") throw new Error("Trigger sind auf diesem Server abgeschaltet");
  const h = String(host || "").trim().replace(/^\[|\]$/g, "");
  if (!h) throw new Error("Kein Host");
  let addr = h;
  if (!net.isIP(h)) { const r = await dns.lookup(h); addr = r.address; }
  if (policy !== "all" && (PRIVATE.some((re) => re.test(addr)) || /^localhost$/i.test(h))) throw new Error(`Ziel ${h} liegt im privaten Netz. Online nur öffentliche Adressen, oder Companion/lokalen Server nutzen`);
  return addr;
}

// ---- Versand ----
const sockets = { udp: null };
function udpSocket() { if (!sockets.udp) { sockets.udp = dgram.createSocket("udp4"); sockets.udp.on("error", () => {}); sockets.udp.unref(); } return sockets.udp; }
const unescape = (s) => String(s).replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\t/g, "\t");

async function send(target, text, policy) {
  const t = target;
  if (t.type === "http") {
    const u = new URL(t.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("Nur http(s)-Adressen");
    await resolveHost(u.hostname, policy);
    const headers = { "User-Agent": "Tallycall" };
    for (const line of String(t.headers || "").split("\n")) { const i = line.indexOf(":"); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    const method = t.method || "POST", body = method === "GET" ? "" : String(text ?? "");
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["Content-Type"] = /^\s*[{[]/.test(body) ? "application/json" : "text/plain; charset=utf-8";
    return new Promise((resolve, reject) => {
      const req = (u.protocol === "https:" ? https : http).request(u, { method, headers, timeout: 5000 }, (res) => { res.resume(); res.on("end", () => (res.statusCode < 400 ? resolve(`HTTP ${res.statusCode}`) : reject(new Error(`HTTP ${res.statusCode}`)))); });
      req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
      req.on("error", reject);
      req.end(body);
    });
  }
  const addr = await resolveHost(t.host, policy), port = Number(t.port) || 0;
  if (!port) throw new Error("Kein Port");
  if (t.type === "osc" || t.type === "udp") {
    const buf = t.type === "osc" ? oscEncode(text) : Buffer.from(unescape(text), "utf8");
    return new Promise((resolve, reject) => udpSocket().send(buf, port, addr, (e) => (e ? reject(e) : resolve(`${t.type.toUpperCase()} ${buf.length} B`))));
  }
  if (t.type === "tcp") {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: addr, port, timeout: 4000 }, () => { s.end(Buffer.from(unescape(text), "utf8")); });
      s.on("timeout", () => s.destroy(new Error("Zeitüberschreitung"))); s.on("error", reject); s.on("close", (err) => !err && resolve("TCP gesendet"));
    });
  }
  throw new Error("Unbekannter Zieltyp");
}

// ---- Auswertung je Projekt ----
// h.trig = { snap, fired:Set, log:[] }. onLog(entry) für Audit/Anzeige.
function evaluate(h, policy, nowMs = Date.now()) {
  const s = h.state, r = s.runtime, eng = h.engine;
  const T = h.trig || (h.trig = { snap: null, fired: new Set(), log: [], budget: [] });
  const f = eng.findEvent(r.currentId), e = f ? f.e : null;
  const runKey = r.currentId + ":" + r.startedAt;
  const snap = { currentId: r.currentId, status: r.status, runKey, msg: s.message.visible ? s.message.text : "", lower: s.lower.visible ? s.lower.title + "\n" + s.lower.subtitle : "", ready: JSON.stringify(s.ready), roll: s.settings.roll, day: r.dayId };
  const prev = T.snap; T.snap = snap;
  if (!prev) return; // erster Lauf: nur merken
  const fire = [];
  const vars = baseVars(h, e, f);
  if (snap.runKey !== prev.runKey && e && r.status === "running") fire.push({ on: "start", e, vars });
  if (snap.runKey !== prev.runKey && prev.currentId && prev.currentId !== snap.currentId) { // vorheriger Punkt zu Ende
    const pf = eng.findEvent(prev.currentId); if (pf) fire.push({ on: "end", e: pf.e, vars: baseVars(h, pf.e, pf), endOf: true });
    fire.push({ on: snap.currentId && r.status !== "stopped" ? "next" : "stop", e, vars });
  }
  if (snap.runKey === prev.runKey && prev.status === "running" && r.status === "paused") fire.push({ on: "pause", e, vars });
  if (snap.runKey === prev.runKey && prev.status === "paused" && r.status === "running") fire.push({ on: "start", e, vars, resume: true });
  if (snap.runKey === prev.runKey && prev.status !== "stopped" && r.status === "stopped" && snap.currentId === prev.currentId) fire.push({ on: "stop", e, vars });
  if (snap.msg !== prev.msg && snap.msg) fire.push({ on: "message", e, vars: { ...vars, message: snap.msg } });
  if (snap.lower !== prev.lower && snap.lower) fire.push({ on: "lower", e, vars: { ...vars, lowerTitle: s.lower.title, lowerSubtitle: s.lower.subtitle } });
  if (snap.ready !== prev.ready) { const was = JSON.parse(prev.ready), now = s.ready; for (const [gid, v] of Object.entries(now)) if (JSON.stringify(was[gid]) !== JSON.stringify(v)) { const g = s.gewerke.find((x) => x.id === gid); fire.push({ on: "ready", e, gid, vars: { ...vars, gewerk: g?.name || gid, gewerkShort: g?.short || "", ready: v.state || "" } }); } }
  if (snap.roll !== prev.roll) fire.push({ on: "roll", e, vars: { ...vars, roll: snap.roll ? "1" : "0" } });
  // Cues des laufenden Punkts, deren Zeit erreicht ist
  if (e && r.status === "running") {
    const el = eng.elapsed() / 1000;
    for (const c of e.cues) {
      const key = runKey + ":" + c.id;
      if (c.offset <= el && !T.fired.has(key)) { T.fired.add(key); const g = s.gewerke.find((x) => x.id === c.gewerk); fire.push({ on: "cue", e, c, gid: c.gewerk, vars: { ...vars, cue: c.text, gewerk: g?.name || "", gewerkShort: g?.short || "" } }); }
    }
    if (T.fired.size > 2000) T.fired = new Set([...T.fired].slice(-500));
  }
  for (const ev of fire) dispatch(h, ev, policy, nowMs);
}
function evaluateAll(h, policy, nowMs = Date.now()) { evaluate(h, policy, nowMs); feedback(h, policy, nowMs); }
function baseVars(h, e, f) {
  const s = h.state, r = s.runtime, rem = e ? e.duration * 1000 + r.added - h.engine.elapsed() : 0;
  const day = f ? f.day : s.days.find((d) => d.id === r.dayId);
  let next = "";
  if (f) { const list = f.day.events.filter((x) => x.type !== "group" && !CLS.effSkip(f.day.events, x)); next = list[list.indexOf(f.e) + 1]?.title || ""; }
  return { event: "", show: s.show.name, day: day?.name || "", id: e?.id || "", title: e?.title || "", subtitle: e?.subtitle || "", presenter: e?.presenter || "", type: e?.type || "", status: r.status, remaining: CLS.fmt(rem), remainingSec: String(Math.round(rem / 1000)), clock: CLS.hhmmss(CLS.nowParts(Date.now(), s.settings.timezone).sec), next, cue: "", gewerk: "", gewerkShort: "", message: s.message.text, lowerTitle: s.lower.title, lowerSubtitle: s.lower.subtitle, ready: "", roll: s.settings.roll ? "1" : "0" };
}
function dispatch(h, ev, policy, nowMs) {
  const s = h.state, vars = { ...ev.vars, event: ev.on };
  const jobs = [];
  for (const ru of s.integrations.rules) {
    if (!ru.enabled || ru.on !== ev.on || !ru.targetId) continue;
    if ((ev.on === "cue" || ev.on === "ready") && ru.gewerk && ru.gewerk !== ev.gid) continue;
    if (ev.resume && ru.on === "start") continue; // "Weiter nach Pause" ist kein neuer Start
    jobs.push({ targetId: ru.targetId, payload: ru.payload, what: "Regel " + ev.on });
  }
  if (ev.e && (ev.on === "start" && !ev.resume || ev.on === "end")) for (const a of ev.e.actions || []) if (a.on === ev.on && a.targetId) jobs.push({ targetId: a.targetId, payload: a.payload, what: `${ev.on === "end" ? "Ende" : "Start"} „${ev.e.title}“` });
  if (ev.on === "cue" && ev.c) for (const a of ev.c.actions || []) if (a.targetId) jobs.push({ targetId: a.targetId, payload: a.payload, what: `Cue „${ev.c.text}“` });
  for (const j of jobs) {
    const t = s.integrations.targets.find((x) => x.id === j.targetId);
    if (!t || !t.enabled) continue;
    fireOne(h, t, CLS.fill(j.payload, vars), j.what, policy, nowMs);
  }
}
function fireOne(h, t, text, what, policy, nowMs = Date.now()) {
  const T = h.trig || (h.trig = { snap: null, fired: new Set(), log: [], budget: [] });
  T.budget = T.budget.filter((x) => nowMs - x < 1000);
  const entry = { t: nowMs, target: t.name, type: t.type, what, text: String(text).slice(0, 200), ok: null, info: "" };
  T.log.unshift(entry); T.log.length = Math.min(T.log.length, 80);
  if (T.budget.length >= 30) { entry.ok = false; entry.info = "Zu viele Trigger pro Sekunde"; return Promise.resolve(entry); }
  T.budget.push(nowMs);
  return send(t, text, policy).then((info) => { entry.ok = true; entry.info = String(info); }, (err) => { entry.ok = false; entry.info = err.message; }).then(() => entry);
}

// ---- OSC-Feedback: Zustand laufend an OSC/UDP-Ziele senden (für TouchOSC, Anzeigen, Pulte) ----
// Nachrichten (Präfix je Ziel, Standard /tallycall): status, title, subtitle, presenter, next, day, level, running (0/1),
// remaining (mm:ss), remaining/sec, elapsed/sec, progress (0..1), message, lower, roll (0/1), ready/<gewerk-id>
function feedback(h, policy, nowMs = Date.now()) {
  const s = h.state, targets = (s.integrations?.targets || []).filter((t) => t.enabled && t.feedback && (t.type === "osc"));
  if (!targets.length) return;
  const T = h.trig || (h.trig = { snap: null, fired: new Set(), log: [], budget: [] });
  const r = s.runtime, f = h.engine.findEvent(r.currentId), e = f ? f.e : null, v = baseVars(h, e, f);
  const rem = e ? e.duration * 1000 + r.added - h.engine.elapsed() : 0, total = e ? e.duration * 1000 + r.added : 0;
  const level = !e ? "ok" : rem < 0 ? "over" : rem <= s.settings.warnRed * 1000 ? "danger" : rem <= s.settings.warnYellow * 1000 ? "warn" : "ok";
  const slow = { status: e ? r.status : "idle", title: v.title, subtitle: v.subtitle, presenter: v.presenter, next: v.next, day: v.day, level, running: r.status === "running" ? 1 : 0, message: s.message.visible ? s.message.text : "", lower: s.lower.visible ? s.lower.title : "", roll: s.settings.roll ? 1 : 0 };
  for (const g of s.gewerke) slow["ready/" + g.id] = s.ready[g.id]?.state || "";
  const sec = Math.round(rem / 1000), fast = { remaining: v.remaining, "remaining/sec": sec, "elapsed/sec": Math.round(h.engine.elapsed() / 1000), progress: total ? Math.max(0, Math.min(1, 1 - rem / total)) : 0 };
  const fb = T.fb || (T.fb = { slow: {}, fast: {}, err: {} });
  for (const t of targets) {
    const pre = t.prefix || "/tallycall", key = t.id;
    const out = [];
    const prevSlow = fb.slow[key] || {}, prevFast = fb.fast[key];
    for (const [k, val] of Object.entries(slow)) if (prevSlow[k] !== val) out.push([k, val]);
    if (!prevFast || prevFast["remaining/sec"] !== fast["remaining/sec"] || prevFast.status !== slow.status) for (const [k, val] of Object.entries(fast)) out.push([k, val]);
    if (!out.length) continue;
    fb.slow[key] = { ...slow }; fb.fast[key] = { ...fast, status: slow.status };
    for (const [k, val] of out) {
      const text = `${pre}/${k} ${typeof val === "string" ? JSON.stringify(val) : val}`;
      send(t, text, policy).catch((err) => { if (nowMs - (fb.err[key] || 0) > 30000) { fb.err[key] = nowMs; T.log.unshift({ t: nowMs, target: t.name, type: t.type, what: "Feedback", text: text.slice(0, 200), ok: false, info: err.message }); T.log.length = Math.min(T.log.length, 80); } });
    }
  }
}

// ---- OSC-Eingang: /tallycall/<schlüssel-oder-projekt>/<befehl> [args] ----
// onCommand(segmente nach "tallycall", args) ; gibt die Socket zurück (close() zum Abschalten), onReady/onError für die Anzeige
function listenOsc(port, onCommand, { onReady, onError } = {}) {
  const sock = dgram.createSocket("udp4");
  sock.on("message", (msg) => {
    const m = oscDecode(msg); if (!m) return;
    const seg = m.addr.split("/").filter(Boolean);
    if (seg[0] !== "tallycall" || seg.length < 2) return;
    try { onCommand(seg.slice(1), m.args); } catch (_) {}
  });
  sock.on("error", (e) => { onError && onError(e); try { sock.close(); } catch (_) {} });
  sock.bind(port, () => onReady && onReady());
  return sock;
}

module.exports = { send, evaluate: evaluateAll, fireOne, listenOsc, oscEncode, oscDecode, resolveHost };
