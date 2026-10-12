// Gemeinsame Client-Logik: Live-Verbindung, Zeitabgleich mit dem Server, Cues und Verzug.
// Setzt shared.js (CLS) voraus.
const CL = (() => {
  let raw = null, state = null, offset = 0, listeners = [], statusCb = () => {}, role = null;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // URL-Parameter: Vorgaben aus einem Freigabe-Link (CL_SEARCH), überschrieben von der echten Adresse
  const params = new URLSearchParams(window.CL_SEARCH || "");
  for (const [k, v] of new URLSearchParams(location.search)) params.set(k, v);
  // Kontext: Projektseite (/p/<id>/...), Freigabe-Link (/s/<token>) oder Demo (eingebettet)
  const ctx = (() => {
    let m = /^\/p\/([^/]+)/.exec(location.pathname);
    if (m) return { kind: "project", pid: m[1], base: "/p/" + m[1], api: "/api/p/" + m[1] };
    m = /^\/s\/([^/]+)/.exec(location.pathname);
    if (m) return { kind: "share", token: m[1], base: "", api: "/api/s/" + m[1], view: window.CL_SHARE?.view };
    return { kind: "demo", base: "", api: "/api/demo" };
  })();

  // ?preview=1: Ansicht auf Basis des Entwurfs (nur mit Admin-Passwort), Laufzeit bleibt live
  const isPreview = () => params.get("preview") === "1"; // dynamisch, damit Ansichten es ohne Neuladen umschalten können
  let draftCache = { rev: -1, data: null };
  function banner(text, bad) {
    let b = document.getElementById("pvbanner");
    if (!text) return b && b.remove();
    if (!b) { b = document.createElement("div"); b.id = "pvbanner"; document.body.appendChild(b); }
    b.className = "pvbanner" + (bad ? " bad" : ""); b.textContent = text;
  }
  async function withDraft(s) {
    if (!isPreview()) { banner(""); return s; }
    if (!s.hasDraft) { banner("VORSCHAU · kein Entwurf offen, zeigt den Live-Stand"); return s; }
    try {
      if (draftCache.rev !== s.draftRev) {
        const r = await fetch(ctx.api + "/draft");
        if (!r.ok) throw new Error("auth");
        const j = await r.json(); draftCache = { rev: j.rev, data: j.draft };
      }
      const d = draftCache.data;
      banner("VORSCHAU · Entwurf, noch nicht live");
      return { ...s, show: d.show, gewerke: d.gewerke, days: d.days, settings: { ...d.settings, roll: s.settings.roll } };
    } catch (_) { banner("VORSCHAU nicht möglich (nur für Projektmitglieder). Zeigt den Live-Stand.", true); return s; }
  }
  async function refresh() { if (raw) { state = await withDraft(raw); listeners.forEach((f) => f(state)); } } // z. B. nach Umschalten der Vorschau
  let connected = false;
  function connect() {
    if (connected) return; connected = true; // idempotent: mehrere Bausteine dürfen verbinden
    const es = new EventSource(ctx.api + "/events");
    es.onmessage = async (m) => {
      raw = JSON.parse(m.data);
      offset = raw.serverTime - Date.now();
      state = await withDraft(raw);
      listeners.forEach((f) => f(state));
      statusCb(true);
    };
    es.onerror = () => statusCb(false);
  }
  const now = () => Date.now() + offset;
  // Datum und Uhrzeit in der Zeitzone der Show
  const clock = (s = state) => CLS.nowParts(now(), s.settings.timezone);
  // Sekunden seit Mitternacht mit Nachkommastellen (damit berechnete Zeiten nicht springen)
  const clockExact = (s = state) => clock(s).sec + (now() % 1000) / 1000;

  const find = (id, s = state) => { for (const d of s.days) { const e = d.events.find((x) => x.id === id); if (e) return { day: d, e }; } return null; };
  const current = (s = state) => find(s.runtime.currentId, s)?.e || null;
  const gewerk = (id, s = state) => s.gewerke.find((g) => g.id === id);
  // Der Tag, den eine Ansicht zeigt: ?day=<id|datum>, sonst der laufende, sonst der heutige, sonst der erste
  function viewDay(s = state) {
    const q = params.get("day");
    return s.days.find((d) => d.id === q || d.date === q) || find(s.runtime.currentId, s)?.day
      || s.days.find((d) => d.id === s.runtime.dayId) || s.days.find((d) => d.date === clock(s).date) || s.days[0];
  }
  const upcoming = (s = state) => {
    const f = find(s.runtime.currentId, s); if (!f) return null;
    const list = f.day.events.filter((e) => e.type !== "group" && !CLS.effSkip(f.day.events, e));
    return list[list.indexOf(f.e) + 1] || null;
  };
  function elapsed(s = state) { const r = s.runtime; return r.pausedElapsed + (r.status === "running" ? now() - r.startedAt : 0); }
  // Restzeit in ms (negativ = Überzeit)
  const remaining = (s = state) => { const c = current(s); return c ? c.duration * 1000 + s.runtime.added - elapsed(s) : 0; };
  function level(s = state) {
    const ms = remaining(s), w = s.settings;
    return ms < 0 ? "over" : ms <= w.warnRed * 1000 ? "danger" : ms <= w.warnYellow * 1000 ? "warn" : "ok";
  }

  // Voraussichtlicher Ablauf des angezeigten Tages (mit Verzug des laufenden Punkts)
  function projection(s = state, day = viewDay(s)) {
    const f = find(s.runtime.currentId, s);
    if (f && f.day.id === day.id) return CLS.projection(day, f.e.id, clockExact(s) + remaining(s) / 1000, clockExact(s) - elapsed(s) / 1000);
    return CLS.projection(day, null, 0);
  }
  // Voraussichtliches Ende des Tages und Verzug des laufenden Punkts in Sekunden
  function dayEnd(s = state, day = viewDay(s)) {
    const rows = projection(s, day).filter((r) => !r.group && !r.skip);
    if (!rows.length) return null;
    const f = find(s.runtime.currentId, s), live = f && f.day.id === day.id;
    return { end: rows[rows.length - 1].pEnd, plannedEnd: rows[rows.length - 1].end, late: live ? (rows.find((r) => r.e.id === f.e.id)?.endLate ?? 0) : 0, live };
  }

  // Cues ab dem laufenden Punkt (oder ab Tagesbeginn), mit Restzeit bis zum Cue in ms und Zustand:
  // done (vorbei) | go (gerade fällig) | standby (kurz davor) | wait
  function cues(s = state, gid = null, max = 12) {
    const day = viewDay(s), proj = projection(s, day), c = clock(s), stand = s.settings.standby * 1000;
    const f = find(s.runtime.currentId, s), live = f && f.day.id === day.id, el = live ? elapsed(s) : 0;
    const out = [];
    for (const r of proj) {
      if (r.group || r.skip) continue;
      const isCur = live && r.e.id === f.e.id;
      if (live && !isCur && proj.indexOf(r) < proj.findIndex((x) => x.e.id === f.e.id)) continue; // schon gelaufen
      for (const q of [...r.e.cues].sort((a, b) => a.offset - b.offset)) {
        if (gid && q.gewerk !== gid) continue;
        const inMs = isCur ? q.offset * 1000 - el : (r.pStart + q.offset - clockExact(s)) * 1000;
        const st = inMs <= -4000 ? "done" : inMs <= 0 ? "go" : inMs <= stand ? "standby" : "wait";
        out.push({ q, e: r.e, at: r.pStart + q.offset, inMs, state: st, cur: isCur });
      }
    }
    return { all: out, upcoming: out.filter((x) => x.state !== "done").slice(0, max) };
  }

  // Aktion an den Server. Ohne Anmeldung geht es zur Login-Seite, Fehler kommen als Exception.
  async function post(path, body) {
    const r = await fetch(ctx.api + path, { method: "POST", headers: { "Content-Type": "application/json", "x-cl": "1" }, body: JSON.stringify(body) });
    if (r.status === 401 && ctx.kind === "project") { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search); throw new Error("abgebrochen"); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 402 && j.upgrade) document.dispatchEvent(new CustomEvent("cl-upgrade", { detail: j.error }));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  const api = (action) => post("/action", action);
  const admin = (body) => post("/admin", body);

  // Alle Ansichten rendern ~10x pro Sekunde, damit der Countdown flüssig läuft
  function run(render) {
    listeners.push(render);
    setInterval(() => state && render(state), 100);
    connect();
  }
  // Anzeige-Hilfen: Typ-Kennzeichen und Palette
  const typeIcon = (e) => (e.type === "group" ? "▣" : e.type === "break" ? "⏸" : "");
  const gChips = (list, s = state) => [...new Set(list.map((q) => q.gewerk))].map((id) => { const g = gewerk(id, s); return g ? `<span class="chip" style="--c:${esc(g.color)}">${esc(g.short || g.name)}</span>` : ""; }).join("");

  return { ...CLS, ctx, post, admin, refresh, connect, run, esc, now, clock, clockExact, elapsed, current, find, gewerk, viewDay, upcoming, remaining, level, projection, dayEnd, cues, api, params, gChips, typeIcon, onStatus: (f) => (statusCb = f), get state() { return state; } };
})();

// Vollbild per F / Doppelklick, Bildschirm anlassen
(() => {
  document.addEventListener("dblclick", (e) => { if (e.target.closest("input,textarea,button,select")) return; document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); });
  document.addEventListener("keydown", (e) => { if (e.key === "f" && !e.target.closest("input,textarea,select")) document.dispatchEvent(new MouseEvent("dblclick")); });
  document.addEventListener("click", () => navigator.wakeLock?.request("screen").catch(() => {}), { once: true });
})();
