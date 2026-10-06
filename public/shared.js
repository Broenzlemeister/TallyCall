// Gemeinsame Zeit- und Ablauflogik, läuft im Browser und im Node-Server.
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CLS = factory(); })(this, function () {
  const p2 = (n) => String(n).padStart(2, "0");
  const cache = {};

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

  // Geplanter Ablauf eines Tages. Punkte mit fester Uhrzeit ("fixed") starten dann, egal was davor passiert.
  // over = Sekunden, um die der Vorgänger in einen festen Start hineinragt (Planungsfehler).
  function schedule(day) {
    let t = day.startTime || 0;
    return day.events.map((e) => {
      if (e.type === "group") return { e, start: t, end: t, group: true };
      if (e.skip) return { e, start: t, end: t + e.duration, skip: true };
      let start = t, over = 0;
      if (e.start === "fixed") { over = Math.max(0, t - e.fixedStart); start = e.fixedStart; }
      const end = start + e.duration;
      t = end;
      return { e, start, end, over };
    });
  }

  // Voraussichtlicher Ablauf, wenn der aktuelle Punkt (curId) um curEnd endet und tatsächlich um curStart begonnen hat.
  // late = Start-Verzug gegenüber Plan, endLate = Verzug des Endes (nur beim laufenden Punkt gesetzt).
  function projection(day, curId, curEnd, curStart) {
    const rows = schedule(day), idx = rows.findIndex((r) => r.e.id === curId);
    let t = curEnd;
    return rows.map((r, i) => {
      const base = { ...r, pStart: r.start, pEnd: r.end, late: 0, endLate: 0 };
      if (r.group || r.skip || idx < 0 || i < idx) return base;
      if (i === idx) { t = curEnd; const st = curStart == null ? r.start : curStart; return { ...base, pStart: st, pEnd: curEnd, late: Math.round(st - r.start), endLate: Math.round(curEnd - r.end) }; }
      const pStart = r.e.start === "fixed" ? Math.max(r.e.fixedStart, t) : t;
      t = pStart + r.e.duration;
      return { ...base, pStart, pEnd: t, late: Math.round(pStart - r.start), endLate: Math.round(t - r.end) };
    });
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

  return { nowParts, addDays, schedule, projection, fmt, hhmm, hhmmss, parseHHMM, parseDur, fmtDur, signed };
});
