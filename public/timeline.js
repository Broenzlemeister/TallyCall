// Timeline mit Balken: Ablauf-Spur, Prognose bei Verzug, Gewerke-Spuren mit Cue-Markern, Tage-Modus.
// Setzt common.js (CL) voraus. Bearbeiten (editable) meldet Änderungen über onAction, schreibt aber nie selbst.
const Timeline = (() => {
  const E = (s) => CL.esc(s);
  const H = { ruler: 30, group: 22, event: 60, prog: 22, gewerk: 38, day: 54, cEvent: 46, cRuler: 24 };
  const q5 = (v) => Math.round(v / 5) * 5; // Prognose auf 5 s runden, damit nicht jede Sekunde neu gebaut wird

  function create(el, opts = {}) {
    const o = { compact: false, mode: "gewerke", editable: false, onAction: null, onSelect: null, ...opts };
    let zoom = 1, follow = !o.compact, sig = "", M = null, dragging = false, selected = null, userScroll = 0, lastFast = 0, R = {}, availW = 0;
    el.innerHTML = `<div class="tl${o.compact ? " compact" : ""}"><div class="tl-labels"></div><div class="tl-scroll"><div class="tl-canvas"></div></div></div>`;
    const labels = el.querySelector(".tl-labels"), scroll = el.querySelector(".tl-scroll"), canvas = el.querySelector(".tl-canvas");
    scroll.addEventListener("scroll", () => { if (!R.autoScrolling) userScroll = Date.now(); });
    scroll.addEventListener("wheel", (e) => {
      if (!e.ctrlKey || o.compact) return;
      e.preventDefault();
      const rect = scroll.getBoundingClientRect(), mx = e.clientX - rect.left, tAt = (scroll.scrollLeft + mx) / (M?.ppm || 1);
      zoom = Math.max(0.5, Math.min(40, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); sig = ""; api.render(CL.state);
      scroll.scrollLeft = tAt * (M?.ppm || 1) - mx;
    }, { passive: false });

    // ---- Modell: Achsen, Spuren, Positionen ----
    function compute(s) {
      const clock = CL.clock(s), dayV = CL.viewDay(s), gewerke = s.gewerke;
      const days = o.mode === "days" ? s.days : [dayV];
      let tmin = Infinity, tmax = -Infinity;
      const dd = days.map((day) => {
        const rows = CL.projection(s, day).map((r) => ({ ...r, pStart: q5(r.pStart), pEnd: q5(r.pEnd) }));
        for (const r of rows) {
          if (r.group || r.skip) continue;
          tmin = Math.min(tmin, r.start, r.pStart); tmax = Math.max(tmax, r.end, r.pEnd);
          if (o.mode !== "days" && !o.compact) for (const c of r.e.cues) tmax = Math.max(tmax, r.pStart + c.offset + 120);
        }
        return { day, rows };
      });
      if (!isFinite(tmin)) { tmin = dayV.startTime; tmax = tmin + 3600; }
      tmin = Math.floor((tmin - 300) / 900) * 900; tmax = Math.ceil((tmax + 300) / 900) * 900;
      if (tmax - tmin < 3600) tmax = tmin + 3600;
      const spanMin = (tmax - tmin) / 60, labW = o.compact ? 0 : 150;
      availW = Math.max(300, (el.clientWidth || 900) - labW - 2);
      const fit = availW / spanMin, ppm = fit * (o.compact ? 1 : zoom), width = Math.max(availW, spanMin * ppm);
      return { s, clock, dayV, dd, gewerke, tmin, tmax, ppm: width / spanMin, width, labW };
    }
    const X = (sec) => ((sec - M.tmin) / 60) * M.ppm;
    const evMap = () => { const m = new Map(); for (const { day, rows } of M.dd) for (const r of rows) m.set(r.e.id, { e: r.e, day }); return m; };

    // ---- Aufbau (nur wenn sich Plan, Zoom oder Größe ändern) ----
    function signature(m) {
      return JSON.stringify([o.mode, o.compact, o.editable, zoom, Math.round(availW / 20), m.tmin, m.tmax, selected,
        m.dd.map(({ day, rows }) => [day.id, day.name, rows.map((r) => [r.e.id, r.e.title, r.e.type, r.e.color, r.e.skip, r.e.start, r.e.duration, r.start, r.end, r.pStart, r.pEnd, r.over, r.e.cues.map((c) => [c.id, c.gewerk, c.offset, c.text])])]),
        m.gewerke.map((g) => [g.id, g.name, g.short, g.color]), !!CL.current(m.s)]);
    }
    function build(m) {
      M = m;
      const lanes = []; let y = 0;
      const lane = (key, h, label, html, extra = {}) => { lanes.push({ key, y, h, label, html, ...extra }); y += h; };
      lane("ruler", o.compact ? H.cRuler : H.ruler, "", "");
      const live = !!CL.current(m.s);
      if (o.mode === "days") {
        for (const { day, rows } of m.dd) lane("day:" + day.id, H.day, `<div translate="no"><b>${E(day.name)}</b><div class="hint mono">${E(day.date.split("-").reverse().join("."))} · ${CL.hhmm(day.startTime)}</div></div>`, rows.filter((r) => !r.group).map((r) => bar(r, H.day)).join(""), { dayDate: day.date });
      } else {
        const rows = m.dd[0].rows;
        if (!o.compact && rows.some((r) => r.group)) {
          const evs = rows.filter((r) => !r.group && !r.skip), end = evs.length ? Math.max(...evs.map((r) => r.end)) : m.tmax;
          const gs = rows.filter((r) => r.group);
          lane("groups", H.group, '<span class="hint">Gruppen</span>', gs.map((g, i) => { const nxt = gs[i + 1]; const x1 = X(g.start), x2 = X(nxt ? nxt.start : end);
            return `<div class="tl-grp" translate="no" style="left:${x1}px;width:${Math.max(4, x2 - x1 - 2)}px" title="${E(g.e.title)}">${E(g.e.title)}</div>`; }).join(""));
        }
        lane("events", o.compact ? H.cEvent : H.event, '<span class="fg2">Ablauf</span>', rows.filter((r) => !r.group).map((r) => bar(r, o.compact ? H.cEvent : H.event)).join(""));
        if (live && !o.compact) {
          const ci = rows.findIndex((r) => r.e.id === m.s.runtime.currentId);
          lane("prog", H.prog, '<span class="hint">Prognose</span>', rows.filter((r, i) => !r.group && !r.skip && i >= ci && ci >= 0).map((r) => { const x1 = X(r.pStart), x2 = X(r.pEnd), late = r.late;
            return `<div class="tl-pbar ${late > 30 ? "late" : late < -30 ? "early" : ""}" translate="no" style="left:${x1}px;width:${Math.max(3, x2 - x1)}px" title="${E(r.e.title)}: ${CL.hhmm(r.pStart)}–${CL.hhmm(r.pEnd)} (${CL.signed(late)})">${Math.abs(late) >= 30 ? CL.signed(late) : ""}</div>`; }).join(""));
        }
        if (!o.compact) {
          const gTop = y;
          for (const g of m.gewerke) {
            const cues = rows.filter((r) => !r.group && !r.skip).flatMap((r) => r.e.cues.filter((c) => c.gewerk === g.id).map((c) => ({ c, r, at: r.pStart + c.offset }))).sort((a, b) => a.at - b.at);
            const mk = cues.map((k, i) => { const x = X(k.at), nx = cues[i + 1] ? X(cues[i + 1].at) : Infinity, room = Math.min(nx - x - 18, 220);
              return `<div translate="no" class="tl-cue${selected === k.c.id ? " sel" : ""}" data-eid="${E(k.r.e.id)}" data-cid="${E(k.c.id)}" data-at="${k.at}" style="left:${x}px;--c:${E(g.color)}" title="${E(g.name)} · ${CL.hhmmss(k.at)}\n${E(k.c.text)}"></div>${room > 44 ? `<span class="tl-cuelab" translate="no" style="left:${x + 11}px;max-width:${room}px">${E(k.c.text)}</span>` : ""}`; }).join("");
            lane("g:" + g.id, H.gewerk, `<span translate="no" style="display:contents"><span class="chip" style="--c:${E(g.color)}">${E(g.short)}</span><span class="fg2">${E(g.name)}</span></span>`, mk, { gewerk: true });
          }
          R.evlinesTop = gTop;
        }
      }
      // Raster, Stundenmarken, Ereignislinien
      const total = y, ticks = [];
      const stepMin = M.ppm >= 8 ? 5 : M.ppm >= 3 ? 15 : M.ppm >= 1.2 ? 30 : 60;
      for (let t = M.tmin; t <= M.tmax; t += stepMin * 60) { const major = t % 3600 === 0; ticks.push(`<div class="tl-tick${major ? " maj" : ""}" style="left:${X(t)}px;height:${lanes[0].h}px"><span>${major || M.ppm >= 3 ? CL.hhmm(t) : ""}</span></div><div class="tl-vline${major ? " maj" : ""}" style="left:${X(t)}px;top:${lanes[0].h}px;height:${total - lanes[0].h}px"></div>`); }
      const evlines = o.mode === "gewerke" && !o.compact && R.evlinesTop != null ? M.dd[0].rows.filter((r) => !r.group && !r.skip).map((r) => `<div class="tl-evline" style="left:${X(r.pStart)}px;top:${R.evlinesTop}px;height:${total - R.evlinesTop}px"></div>`).join("") : "";
      labels.style.width = M.labW + "px";
      labels.innerHTML = lanes.map((l) => `<div class="tl-lab${l.key === "ruler" ? " ruler" : ""}" style="height:${l.h}px">${l.label}</div>`).join("");
      canvas.style.width = M.width + "px"; canvas.style.height = total + "px";
      canvas.innerHTML = ticks.join("") + evlines + lanes.map((l) => `<div class="tl-row${l.gewerk ? " gl" : ""}" data-lane="${E(l.key)}" style="top:${l.y}px;height:${l.h}px">${l.html}</div>`).join("") + '<div class="tl-now" hidden></div>';
      R.lanes = lanes; R.now = canvas.querySelector(".tl-now"); R.cues = [...canvas.querySelectorAll(".tl-cue")]; R.bars = [...canvas.querySelectorAll(".tl-bar")];
      R.laneEls = Object.fromEntries([...canvas.querySelectorAll(".tl-row")].map((e) => [e.dataset.lane, e]));
    }
    function bar(r, h) {
      const e = r.e, x1 = X(r.start), x2 = X(r.end), w = Math.max(3, x2 - x1), cur = M.s.runtime.currentId === e.id;
      const over = r.over ? `<div class="tl-over" style="width:${Math.max(3, (r.over / 60) * M.ppm)}px" title="${E(I18N.t("Überschneidung: {d} Platz fehlt vor dem festen Start", { d: CL.fmtDur(r.over) }))}"></div>` : "";
      return `<div translate="no" class="tl-bar${r.skip ? " skip" : ""}${cur ? " cur" : ""}${w < 46 ? " narrow" : ""}${selected === e.id ? " sel" : ""}" data-id="${E(e.id)}" style="left:${x1}px;width:${w}px;--c:${E(e.color)}"
        title="${E(e.title)}\n${CL.hhmm(r.start)}–${CL.hhmm(r.end)} · ${CL.fmtDur(e.duration)}${e.presenter ? "\n" + E(e.presenter) : ""}${e.start === "fixed" ? "\n" + I18N.t("Feste Uhrzeit") : ""}">
        <div class="tl-prog"></div>${over}<div class="tl-t" translate="no">${E(e.title)}${e.start === "fixed" ? " 📌" : ""}</div>${h > 40 ? `<div class="tl-s mono">${CL.fmtDur(e.duration)} · ${CL.hhmm(r.start)}</div>` : ""}${o.editable ? `<div class="tl-h" title="${E(I18N.t("Ziehen: Dauer ändern"))}"></div>` : ""}</div>`;
    }

    // ---- Laufende Teile (Jetzt-Linie, Fortschritt, Cue-Zustand, Folgen), mehrmals pro Sekunde ----
    function live(s) {
      const nowSec = CL.clockExact(s), today = CL.clock(s).date;
      const showNow = (laneDate) => laneDate === today;
      if (o.mode === "days") {
        // Linie nur in der Spur des heutigen Tages
        const l = R.lanes.find((x) => x.dayDate === today);
        R.now.hidden = !l || nowSec < M.tmin || nowSec > M.tmax;
        if (l) { R.now.style.top = l.y + "px"; R.now.style.height = l.h + "px"; R.now.style.left = X(nowSec) + "px"; R.now.dataset.t = CL.hhmmss(nowSec); }
      } else {
        const on = M.dayV.date === today && nowSec >= M.tmin && nowSec <= M.tmax;
        R.now.hidden = !on;
        if (on) { R.now.style.top = "0"; R.now.style.height = "100%"; R.now.style.left = X(nowSec) + "px"; R.now.dataset.t = CL.hhmmss(nowSec); }
      }
      const f = CL.find(s.runtime.currentId, s), total = f ? f.e.duration * 1000 + s.runtime.added : 0;
      for (const b of R.bars) { const p = b.querySelector(".tl-prog"); p.style.width = f && b.dataset.id === f.e.id && total ? Math.min(100, (CL.elapsed(s) / total) * 100) + "%" : "0"; }
      // Cue-Zustand: erledigt / als Nächstes
      const nextPerLane = new Set();
      for (const c of R.cues) {
        const at = Number(c.dataset.at), done = M.dayV.date === today && at < nowSec - 2;
        c.classList.toggle("done", done);
        const lane = c.parentElement.dataset.lane;
        const isNext = !done && !nextPerLane.has(lane) && M.dayV.date === today; if (isNext) nextPerLane.add(lane);
        c.classList.toggle("nxt", isNext);
      }
      if (follow && !R.now.hidden && !dragging && Date.now() - userScroll > 6000) {
        const x = X(nowSec), want = x - scroll.clientWidth * 0.3;
        if (Math.abs(scroll.scrollLeft - want) > scroll.clientWidth * 0.2) { R.autoScrolling = true; scroll.scrollTo({ left: Math.max(0, want), behavior: "smooth" }); setTimeout(() => (R.autoScrolling = false), 700); }
      }
    }

    // ---- Interaktion ----
    const snap = (v, step) => Math.round(v / step) * step;
    canvas.addEventListener("click", (e) => {
      if (dragging) return;
      const cue = e.target.closest(".tl-cue"), bar = e.target.closest(".tl-bar");
      const id = cue ? cue.dataset.cid : bar ? bar.dataset.id : null;
      selected = id; sig = ""; api.render(CL.state);
      o.onSelect?.(cue ? { type: "cue", eventId: cue.dataset.eid, cueId: cue.dataset.cid } : bar ? { type: "event", eventId: bar.dataset.id } : null);
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (!o.editable || e.button !== 0) return;
      const h = e.target.closest(".tl-h"), cue = e.target.closest(".tl-cue");
      if (!h && !cue) return;
      e.preventDefault();
      const target = h ? h.closest(".tl-bar") : cue, x0 = e.clientX, em = evMap();
      const eid = h ? target.dataset.id : target.dataset.eid, info = em.get(eid); if (!info) return;
      const ev = info.e, startDur = ev.duration, startLeft = parseFloat(target.style.left), startW = parseFloat(target.style.width);
      const cueObj = cue ? ev.cues.find((c) => c.id === target.dataset.cid) : null, startOff = cueObj ? cueObj.offset : 0;
      let val = h ? startDur : startOff;
      dragging = true; target.setPointerCapture?.(e.pointerId); target.classList.add("drag");
      const tip = document.createElement("div"); tip.className = "tl-tip"; canvas.appendChild(tip);
      const move = (ev2) => {
        const dMin = (ev2.clientX - x0) / M.ppm, step = ev2.shiftKey ? 15 : h ? 60 : 15;
        if (h) { val = Math.max(0, snap(startDur + dMin * 60, step)); target.style.width = Math.max(3, (val / 60) * M.ppm) + "px"; tip.textContent = "Dauer " + CL.fmtDur(val); tip.style.left = startLeft + (val / 60) * M.ppm + "px"; }
        else { val = Math.max(0, snap(startOff + dMin * 60, step)); const nx = startLeft + ((val - startOff) / 60) * M.ppm; target.style.left = nx + "px"; tip.textContent = `+${CL.fmtDur(val)} · ${CL.hhmmss(Number(target.dataset.at) + val - startOff)}`; tip.style.left = nx + "px"; }
        tip.style.top = (target.closest(".tl-row")?.offsetTop || 0) - 22 + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        tip.remove(); dragging = false; target.classList.remove("drag");
        if (h && val !== startDur) o.onAction?.({ type: "update", id: eid, data: { duration: val } });
        else if (cue && val !== startOff) o.onAction?.({ type: "update", id: eid, data: { cues: ev.cues.map((c) => (c.id === cueObj.id ? { ...c, offset: val } : c)) } });
        else { sig = ""; }
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });

    const api = {
      render(s) {
        if (dragging || !s) return;
        const m = compute(s), sg = signature(m);
        if (sg !== sig) { sig = sg; const keep = scroll.scrollLeft; build(m); scroll.scrollLeft = keep; } else M = m;
        const now = Date.now(); if (now - lastFast > 200) { lastFast = now; live(s); }
      },
      get zoom() { return zoom; },
      setZoom(z) { const keep = scroll.scrollLeft / (M?.ppm || 1); zoom = Math.max(0.5, Math.min(40, z)); sig = ""; api.render(CL.state); if (M) scroll.scrollLeft = keep * M.ppm; },
      fit() { zoom = 1; sig = ""; api.render(CL.state); scroll.scrollLeft = 0; },
      setMode(m) { o.mode = m; sig = ""; R = {}; api.render(CL.state); },
      setEditable(b) { o.editable = !!b; sig = ""; api.render(CL.state); },
      setFollow(b) { follow = !!b; userScroll = 0; if (b) lastFast = 0; },
      scrollToNow() { userScroll = 0; const was = follow; follow = true; lastFast = 0; api.render(CL.state); follow = was; },
      select(id) { selected = id; sig = ""; api.render(CL.state); },
    };
    return api;
  }
  return { create };
})();
