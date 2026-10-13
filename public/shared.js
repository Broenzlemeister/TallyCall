// Gemeinsame Zeit- und Ablauflogik, läuft im Browser und im Node-Server.
// Ablaufpunkte liegen je Tag als flache Liste; Verschachtelung über e.parent (Id einer Gruppe weiter oben in der Liste).
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CLS = factory(); })(this, function () {
  const p2 = (n) => String(n).padStart(2, "0");
  const cache = {};
  const MAX_DEPTH = 3; // Gruppen in Gruppen in Gruppen, tiefer nicht

  // Farbpalette: abgestimmt auf den dunklen Hintergrund. name = Anzeigename (deutsch, wird übersetzt)
  const PALETTE = [
    ["#7c9cff", "Blau"], ["#5ad7e6", "Cyan"], ["#4fd1a1", "Grün"], ["#a3e635", "Limette"], ["#f5b942", "Gelb"], ["#ff9d5c", "Orange"],
    ["#ff7a7a", "Rot"], ["#f472b6", "Pink"], ["#b58cff", "Violett"], ["#c4b5fd", "Lavendel"], ["#94a3b8", "Grau"], ["#64748b", "Schiefer"],
  ];
  const COLOR = { group: "#64748b", break: "#8b95a7", event: "#7c9cff" };

  // Datum und Sekunden seit Mitternacht in der Zeitzone der Show (unabhängig von Server- und Geräte-Zeitzone)
  function nowParts(ms, tz) {
    tz = tz || "Europe/Berlin";
    let f = cache[tz];
    if (!f) {
      try {
        f = cache[tz] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } catch (_) { return nowParts(ms, "UTC"); }
    }
    const o = {};
    for (const x of f.formatToParts(ms)) o[x.type] = x.value;
    return { date: `${o.year}-${o.month}-${o.day}`, sec: (+o.hour % 24) * 3600 + +o.minute * 60 + +o.second };
  }
  function addDays(date, n) {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ---- Baumhelfer auf der flachen Liste ----
  const byId = (events, id) => events.find((e) => e.id === id);
  // Kette der Eltern (nah → fern), bricht bei Schleifen ab
  function ancestors(events, e) {
    const out = []; let p = e && e.parent;
    while (p && out.length < 8) { const g = byId(events, p); if (!g || g.type !== "group" || out.includes(g)) break; out.push(g); p = g.parent; }
    return out;
  }
  const depthOf = (events, e) => ancestors(events, e).length;
  const isDesc = (events, e, id) => ancestors(events, e).some((g) => g.id === id);
  // Zusammenhängender Block [i, j) eines Punkts samt allen Nachkommen
  function blockOf(events, id) {
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) return null;
    let j = i + 1;
    while (j < events.length && isDesc(events, events[j], id)) j++;
    return [i, j];
  }
  const children = (events, gid) => events.filter((e) => (e.parent || "") === (gid || ""));
  // Übersprungen, wenn der Punkt selbst oder eine Gruppe darüber übersprungen ist
  const effSkip = (events, e) => !!e.skip || ancestors(events, e).some((g) => g.skip);
  // Reihenfolge reparieren: Eltern müssen Gruppen sein, davor stehen, nicht zu tief; Nachkommen bleiben beisammen
  function normalize(events) {
    const seen = new Set();
    for (const e of events) {
      if (e.parent && (!seen.has(e.parent) || byId(events, e.parent)?.type !== "group" || e.type === "group" && depthOf(events, byId(events, e.parent)) >= MAX_DEPTH - 1)) e.parent = "";
      if (e.type !== "group" && depthOf(events, e) > MAX_DEPTH) e.parent = "";
      seen.add(e.id);
    }
    // Blöcke zusammenziehen: jedes Kind direkt hinter den Block seines Elternteils
    const out = [];
    const place = (parent) => { for (const e of events) if ((e.parent || "") === parent) { out.push(e); if (e.type === "group") place(e.id); } };
    place("");
    for (const e of events) if (!out.includes(e)) { e.parent = ""; out.push(e); }
    return out;
  }

  // Geplanter Ablauf eines Tages. Punkte mit fester Uhrzeit ("fixed") starten dann, egal was davor passiert.
  // over = Sekunden, um die der Vorgänger in einen festen Start hineinragt (Planungsfehler). Gruppen bekommen Start und Ende ihrer Inhalte.
  function schedule(day) {
    let t = day.startTime || 0;
    const ev = day.events;
    const rows = ev.map((e) => {
      const depth = depthOf(ev, e), skip = effSkip(ev, e);
      if (e.type === "group") return { e, start: t, end: t, group: true, depth, skip, empty: true };
      if (skip) return { e, start: t, end: t + e.duration, skip: true, depth, brk: e.type === "break" };
      let start = t, over = 0;
      if (e.start === "fixed") { over = Math.max(0, t - e.fixedStart); start = e.fixedStart; }
      const end = start + e.duration;
      t = end;
      return { e, start, end, over, depth, brk: e.type === "break" };
    });
    closeGroups(rows, "start", "end");
    return rows;
  }
  // Gruppenzeilen: Start = erster Inhalt, Ende = letztes Ende der Inhalte
  function closeGroups(rows, ks, ke) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]; if (!r.group) continue;
      let s = Infinity, en = -Infinity;
      for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j++) { const x = rows[j]; if (x.group || x.skip) continue; s = Math.min(s, x[ks]); en = Math.max(en, x[ke]); }
      if (isFinite(s)) { r[ks] = s; r[ke] = en; r.empty = false; } else { r[ke] = r[ks]; r.empty = true; }
    }
  }

  // Voraussichtlicher Ablauf, wenn der aktuelle Punkt (curId) um curEnd endet und tatsächlich um curStart begonnen hat.
  // late = Start-Verzug gegenüber Plan, endLate = Verzug des Endes (nur beim laufenden Punkt gesetzt).
  function projection(day, curId, curEnd, curStart) {
    const rows = schedule(day), idx = rows.findIndex((r) => r.e.id === curId);
    let t = curEnd;
    const out = rows.map((r, i) => {
      const base = { ...r, pStart: r.start, pEnd: r.end, late: 0, endLate: 0 };
      if (r.group || r.skip || idx < 0 || i < idx) return base;
      if (i === idx) { t = curEnd; const st = curStart == null ? r.start : curStart; return { ...base, pStart: st, pEnd: curEnd, late: Math.round(st - r.start), endLate: Math.round(curEnd - r.end) }; }
      const pStart = r.e.start === "fixed" ? Math.max(r.e.fixedStart, t) : t;
      t = pStart + r.e.duration;
      return { ...base, pStart, pEnd: t, late: Math.round(pStart - r.start), endLate: Math.round(t - r.end) };
    });
    closeGroups(out, "pStart", "pEnd");
    return out;
  }

  function fmt(ms, { hours } = {}) {
    const neg = ms < 0, t = Math.floor(Math.abs(ms) / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (neg ? "-" : "") + (h > 0 || hours ? `${p2(h)}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`);
  }
  const hhmm = (sec) => { sec = ((Math.round(sec) % 86400) + 86400) % 86400; return `${p2(Math.floor(sec / 3600))}:${p2(Math.floor((sec % 3600) / 60))}`; };
  const hhmmss = (sec) => { sec = ((Math.round(sec) % 86400) + 86400) % 86400; return `${hhmm(sec)}:${p2(sec % 60)}`; };
  const parseHHMM = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ""); return m ? Math.min(86399, +m[1] * 3600 + +m[2] * 60) : 0; };
  // "mm:ss", "h:mm:ss" oder Minuten
  const parseDur = (v) => { const p = String(v).trim().split(":").map(Number); if (!p.length || p.some((x) => !Number.isFinite(x) || x < 0)) return null; return p.length === 1 ? p[0] * 60 : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; };
  const fmtDur = (s) => fmt(s * 1000, { hours: s >= 3600 });
  const signed = (sec) => (sec === 0 ? "±0" : (sec > 0 ? "+" : "−") + fmt(Math.abs(sec) * 1000));

  // Platzhalter in Trigger-Texten: {title} {subtitle} {presenter} {id} {cue} {gewerk} {day} {show} {remaining} {clock}
  const fill = (tpl, vars) => String(tpl ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m));

  // ---- Bauchbinden-Design: Schema, Standardwerte, Bereinigung (Browser und Server nutzen dasselbe) ----
  // Eintrag: [Typ, Min/Auswahl, Max, Standard]
  const DESIGN = {
    skew: ["n", 0, 40, 0], radius: ["n", 0, 60, 0], full: ["b", 0, 0, false],
    bg: ["c", 0, 0, "#0a0c10"], bgAlpha: ["n", 0, 1, 0.94], glass: ["b", 0, 0, false],
    border: ["n", 0, 10, 0], borderColor: ["c", 0, 0, "#ffffff"], shadow: ["n", 0, 1, 0.35],
    accentMode: ["e", ["left", "top", "bottom", "dot", "none"], 0, "left"], accent: ["c", 0, 0, "#7c9cff"], accentSize: ["n", 0, 40, 14],
    titleColor: ["c", 0, 0, "#ffffff"], subColor: ["c", 0, 0, "#b8bdc9"], titleSize: ["n", 24, 140, 54], subSize: ["n", 14, 90, 30],
    titleWeight: ["n", 300, 900, 600], subWeight: ["n", 300, 900, 400], font: ["e", ["sans", "serif", "mono", "condensed", "rounded"], 0, "sans"],
    upper: ["b", 0, 0, false], track: ["n", -3, 14, 0], textShadow: ["b", 0, 0, false], align: ["e", ["left", "center", "right"], 0, "left"],
    padX: ["n", 6, 140, 38], padY: ["n", 4, 100, 24], gap: ["n", 0, 50, 8], minW: ["n", 0, 1, 0], maxW: ["n", 0.3, 1, 0.8],
    ox: ["n", -0.5, 0.5, 0], oy: ["n", -0.5, 0.5, 0],
    logo: ["l", 0, 0, ""], logoSize: ["n", 20, 240, 90], logoSide: ["e", ["left", "right"], 0, "left"], logoRound: ["b", 0, 0, false],
    anim: ["e", ["slide", "fade", "rise", "wipe", "zoom", "none"], 0, "slide"], tIn: ["n", 0.2, 2, 0.7], tHold: ["n", 1, 30, 3.2], tOut: ["n", 0.2, 2, 0.7],
  };
  const designDefault = () => Object.fromEntries(Object.entries(DESIGN).map(([k, v]) => [k, v[3]]));
  // Unbekannte Felder fallen weg, Werte werden begrenzt. Fehlende Felder bekommen den Standard (oder den Wert aus base).
  function cleanDesign(d, base = designDefault()) {
    const out = { ...base }; d = d && typeof d === "object" ? d : {};
    for (const [k, [t, a, b, def]] of Object.entries(DESIGN)) {
      if (!(k in d)) continue; const v = d[k];
      if (t === "n") { const n = Number(v); out[k] = Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : def; }
      else if (t === "b") out[k] = !!v;
      else if (t === "c") out[k] = /^#[0-9a-f]{6}$/i.test(v) ? String(v).toLowerCase() : def;
      else if (t === "e") out[k] = a.includes(v) ? v : def;
      else if (t === "l") out[k] = typeof v === "string" && v.length <= 90000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : "";
    }
    return out;
  }

  return { DESIGN, designDefault, cleanDesign, MAX_DEPTH, PALETTE, COLOR, nowParts, addDays, ancestors, depthOf, isDesc, blockOf, children, effSkip, normalize, schedule, projection, fmt, hhmm, hhmmss, parseHHMM, parseDur, fmtDur, signed, fill };
});
