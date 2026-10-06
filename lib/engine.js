// Tallycall-Engine: Ablauflogik eines Projekts (Tage, Gewerke, Cues, Timer, Roll-Modus, Entwurf).
// Läuft im Node-Server und in der Browser-Demo. Ohne Abhängigkeiten.
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(require("../public/shared.js")); else root.Engine = factory(root.CLS); })(this, function (CLS) {
  const rnd = () => {
    const a = new Uint8Array(4);
    (globalThis.crypto || require("crypto").webcrypto).getRandomValues(a);
    return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const ev = (title, min, extra = {}) => ({ id: rnd(), type: "event", title, subtitle: "", presenter: "", note: "", duration: min * 60, color: "#7c9cff", skip: false, start: "chain", fixedStart: 0, cues: [], ...extra });
  const grp = (title) => ev(title, 0, { type: "group", color: "#64748b" });
  const cue = (gewerk, text, offset = 0) => ({ id: rnd(), gewerk, text, offset });

  // Bauchbinden: Stile, Positionen und Standardwerte (Renderer: public/lowerthird.js)
  const LOWER_STYLES = ["balken", "glas", "linie", "karte", "block", "streifen"];
  const LOWER_POS = ["left", "center", "right"];
  const LOWER_DEFAULT = () => ({ title: "", subtitle: "", visible: false, style: "balken", accent: "#7c9cff", key: "none", pos: "left" });

  const GEWERKE = () => [
    { id: "licht", name: "Licht", short: "LX", color: "#f5b942" },
    { id: "ton", name: "Ton", short: "AU", color: "#4fd1a1" },
    { id: "video", name: "Video", short: "VI", color: "#6ea8ff" },
    { id: "buehne", name: "Bühne", short: "BÜ", color: "#b58cff" },
    { id: "catering", name: "Catering", short: "CA", color: "#ff7a7a" },
  ];

  // Neues Projekt: leer (ein leerer Tag) oder mit Beispielshow
  function createState({ name = "Neues Projekt", timezone = "Europe/Berlin", sample = false } = {}) {
    const today = CLS.nowParts(Date.now(), timezone).date;
    const s = {
      show: { name },
      settings: { timezone, warnYellow: 120, warnRed: 30, standby: 10, roll: false },
      gewerke: GEWERKE(),
      days: [{ id: "tag1", name: "Tag 1", date: today, startTime: 9 * 3600, events: [] }],
      runtime: { dayId: "tag1", currentId: null, status: "stopped", startedAt: 0, pausedElapsed: 0, added: 0 },
      ready: {}, message: { text: "", visible: false }, lower: LOWER_DEFAULT(), lowers: [],
      log: [], draft: null, draftRev: 0,
    };
    if (!sample) return s;
    s.days = [
      { id: "tag1", name: "Tag 1 · Konferenz", date: today, startTime: 9 * 3600, events: [
        grp("Vormittag"),
        ev("Einlass & Begrüßung", 10, { presenter: "Moderation", color: "#4fd1a1", cues: [cue("ton", "Walk-in-Musik aus, Moderationsmikro auf"), cue("licht", "Cue 1: Saal Begrüßung"), cue("video", "Willkommen-Slide", 30), cue("buehne", "Moderation im Gang bereit")] }),
        ev("Keynote", 30, { presenter: "Anna Beispiel", subtitle: "Die Zukunft der Events", cues: [cue("licht", "Cue 2: Keynote-Look"), cue("video", "Folien Keynote Seite 1"), cue("ton", "Headset Anna auf"), cue("video", "Outro-Loop starten", 1740), cue("licht", "Cue 3: Applaus-Look", 1790)] }),
        ev("Kaffeepause", 15, { color: "#f5b942", cues: [cue("catering", "Kaffee freigeben"), cue("ton", "Pausenmusik"), cue("licht", "Cue 4: Pausenlicht"), cue("buehne", "Podium umbauen", 60)] }),
        grp("Nachmittag"),
        ev("Podium", 45, { presenter: "Gäste", color: "#b58cff", start: "fixed", fixedStart: 10 * 3600, note: "Vier Gäste, Moderation links außen.", cues: [cue("buehne", "Sessel und Tisch stehen"), cue("ton", "4 Handmikrofone scharf"), cue("licht", "Cue 5: Podium"), cue("video", "Namenseinblendungen", 60)] }),
        ev("Schlusswort", 5, { presenter: "Moderation", color: "#ff7a7a", cues: [cue("licht", "Cue 6: Finale"), cue("ton", "Abspann-Musik", 270)] }),
      ] },
      { id: "tag2", name: "Tag 2 · Workshops", date: CLS.addDays(today, 1), startTime: 10 * 3600, events: [
        ev("Workshop-Block A", 90, { cues: [cue("licht", "Raumlicht hell"), cue("video", "Beamer Raum 1–3")] }),
        ev("Mittagessen", 60, { color: "#f5b942", cues: [cue("catering", "Buffet eröffnen")] }),
        ev("Workshop-Block B", 90),
      ] },
    ];
    s.lowers = [{ id: rnd(), title: "Anna Beispiel", subtitle: "Keynote Speaker" }, { id: rnd(), title: "Ben Muster", subtitle: "Moderation" }, { id: rnd(), title: "Podium", subtitle: "Mit vier Gästen" }];
    s.lower = { ...LOWER_DEFAULT(), title: "Anna Beispiel", subtitle: "Keynote Speaker" };
    return s;
  }

  // Engine für einen Projektzustand. onLog(text) wird bei Protokolleinträgen aufgerufen.
  function create(state, { now = () => Date.now() } = {}) {
    state.lower = { ...LOWER_DEFAULT(), ...state.lower }; // ältere Projekte ohne Stil-Felder
    if (!Array.isArray(state.lowers)) state.lowers = [];
    const rt = () => state.runtime;
    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const str = (v, max = 300) => String(v ?? "").slice(0, max);
    const dayById = (id) => state.days.find((d) => d.id === id);
    const playable = (e) => e.type !== "group" && !e.skip;
    function findEvent(id) {
      for (const day of state.days) { const i = day.events.findIndex((e) => e.id === id); if (i >= 0) return { day, e: day.events[i], i }; }
      return null;
    }
    function log(text) { state.log.unshift({ t: now(), text: str(text, 200) }); state.log.length = Math.min(state.log.length, 150); }
    const clearRt = () => Object.assign(rt(), { currentId: null, status: "stopped", pausedElapsed: 0, added: 0 });
    const elapsed = () => rt().pausedElapsed + (rt().status === "running" ? now() - rt().startedAt : 0);

    function loadEvent(id, run) {
      const f = findEvent(id);
      if (!f || !playable(f.e)) return;
      Object.assign(rt(), { dayId: f.day.id, currentId: id, status: run ? "running" : "stopped", startedAt: now(), pausedElapsed: 0, added: 0 });
      log(`${run ? "Start" : "Geladen"}: ${f.e.title}`);
    }
    function step(dir) {
      const f = findEvent(rt().currentId);
      const day = f ? f.day : dayById(rt().dayId) || state.days[0];
      const list = day.events.filter(playable);
      const i = f ? list.indexOf(f.e) : -1;
      const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
      if (n < 0 || n >= list.length) { if (dir > 0 && f) { rt().status = "stopped"; log(`Ende des Tages: ${day.name}`); } return; }
      loadEvent(list[n].id, rt().status === "running");
    }

    function cleanCues(list) {
      return (Array.isArray(list) ? list : []).slice(0, 80).map((c) => ({
        id: str(c.id, 16) || rnd(),
        gewerk: state.gewerke.some((g) => g.id === c.gewerk) ? c.gewerk : "",
        text: str(c.text, 200),
        offset: Math.max(0, Math.min(86400, Math.round(num(c.offset)))),
      }));
    }
    function applyEventFields(e, d) {
      if ("title" in d) e.title = str(d.title, 120);
      if ("subtitle" in d) e.subtitle = str(d.subtitle, 160);
      if ("presenter" in d) e.presenter = str(d.presenter, 120);
      if ("note" in d) e.note = str(d.note, 1500);
      if ("duration" in d) e.duration = Math.max(0, Math.min(86400, Math.round(num(d.duration, e.duration))));
      if ("color" in d && /^#[0-9a-f]{6}$/i.test(d.color)) e.color = d.color;
      if ("skip" in d) e.skip = !!d.skip;
      if ("type" in d) e.type = d.type === "group" ? "group" : "event";
      if ("start" in d) e.start = d.start === "fixed" ? "fixed" : "chain";
      if ("fixedStart" in d) e.fixedStart = Math.max(0, Math.min(86399, Math.round(num(d.fixedStart))));
      if ("cues" in d) e.cues = cleanCues(d.cues);
    }
    function applyDayFields(day, d) {
      if ("name" in d) day.name = str(d.name, 80);
      if ("date" in d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) day.date = d.date;
      if ("startTime" in d) day.startTime = Math.max(0, Math.min(86399, Math.round(num(d.startTime))));
    }
    function newDay(d = {}) {
      const last = state.days[state.days.length - 1];
      const day = { id: rnd(), name: "Neuer Tag", date: last ? CLS.addDays(last.date, 1) : CLS.nowParts(now(), state.settings.timezone).date, startTime: 9 * 3600, events: [] };
      applyDayFields(day, d);
      return day;
    }
    function applyGewerk(g, d) {
      if ("name" in d) g.name = str(d.name, 40);
      if ("short" in d) g.short = str(d.short, 4);
      if ("color" in d && /^#[0-9a-f]{6}$/i.test(d.color)) g.color = d.color;
    }
    function applySettings(d) {
      const t = state.settings;
      if ("timezone" in d) { try { new Intl.DateTimeFormat("de", { timeZone: d.timezone }); t.timezone = d.timezone; } catch (_) { throw new Error("Unbekannte Zeitzone"); } }
      for (const k of ["warnYellow", "warnRed", "standby"]) if (k in d) t[k] = Math.max(0, Math.min(3600, Math.round(num(d[k], t[k]))));
      if ("roll" in d) t.roll = !!d.roll;
    }

    // Planungsaktionen. Mit offenem Entwurf laufen sie gegen den Entwurf, nie gegen die Live-Show.
    const PLAN = new Set(["add", "update", "delete", "move", "dayAdd", "dayUpdate", "dayDelete", "gewerkAdd", "gewerkUpdate", "gewerkDelete", "import", "settings"]);
    const planOf = (x) => ({ show: x.show, gewerke: x.gewerke, days: x.days, settings: x.settings });

    function run(a) {
      const r = rt();
      switch (a.type) {
        // --- Steuerung ---
        case "start": {
          if (a.id) return loadEvent(a.id, true);
          if (r.status === "paused") { r.status = "running"; r.startedAt = now(); log(`Weiter: ${findEvent(r.currentId)?.e.title}`); break; }
          if (r.status === "running") break;
          const day = dayById(a.dayId || r.dayId) || state.days[0];
          const f = findEvent(r.currentId);
          const id = f && f.day.id === day.id ? f.e.id : day.events.find(playable)?.id;
          if (id) loadEvent(id, true);
          break;
        }
        case "pause": if (r.status === "running") { r.pausedElapsed = elapsed(); r.status = "paused"; log("Pause"); } break;
        case "stop": if (r.currentId) { loadEvent(r.currentId, false); log("Reset"); } break;
        case "load": loadEvent(a.id, false); break;
        case "next": step(1); break;
        case "prev": step(-1); break;
        case "addTime": r.added += Math.round(num(a.ms)); log(`Zeit ${a.ms > 0 ? "+" : "−"}${Math.abs(a.ms) / 60000} Min`); break;
        case "setDay": if (dayById(a.dayId)) { if (r.status !== "running") clearRt(); r.dayId = a.dayId; } break;
        case "roll": state.settings.roll = !!a.on; if (a.on) clearRt(); log(`Roll-Modus ${a.on ? "an" : "aus"}`); break;
        case "message": state.message = { text: str(a.text, 300), visible: !!a.visible }; if (a.visible) log(`Nachricht: ${a.text}`); break;
        case "lower": {
          const l = state.lower, d = a.data || a; // data: nur die übergebenen Felder ändern
          if ("title" in d) l.title = str(d.title, 120);
          if ("subtitle" in d) l.subtitle = str(d.subtitle, 160);
          if ("visible" in d) l.visible = !!d.visible;
          if ("style" in d && LOWER_STYLES.includes(d.style)) l.style = d.style;
          if ("pos" in d && LOWER_POS.includes(d.pos)) l.pos = d.pos;
          if ("accent" in d && /^#[0-9a-f]{6}$/i.test(d.accent)) l.accent = d.accent;
          if ("key" in d && (d.key === "none" || /^#[0-9a-f]{6}$/i.test(d.key))) l.key = d.key;
          break;
        }
        case "lowerSave": {
          if (state.lowers.length >= 200) throw new Error("Maximal 200 Bauchbinden");
          const x = state.lowers.find((q) => q.id === a.id);
          if (x) { if ("title" in a) x.title = str(a.title, 120); if ("subtitle" in a) x.subtitle = str(a.subtitle, 160); }
          else state.lowers.push({ id: rnd(), title: str(a.title, 120), subtitle: str(a.subtitle, 160) });
          break;
        }
        case "lowerDelete": state.lowers = state.lowers.filter((q) => q.id !== a.id); break;
        case "ready": {
          const g = state.gewerke.find((x) => x.id === a.gewerk);
          if (!g) throw new Error("Unbekanntes Gewerk");
          const v = ["ready", "wait"].includes(a.state) ? a.state : "";
          state.ready[a.gewerk] = { state: v, at: now() };
          log(`${g.name}: ${v === "ready" ? "bereit" : v === "wait" ? "nicht bereit" : "zurückgesetzt"}`);
          break;
        }
        case "readyReset": state.ready = {}; break;
        // --- Planung ---
        case "settings": applySettings(a.data || {}); break;
        case "add": {
          const day = dayById(a.dayId) || state.days[0];
          const e = ev(a.data?.type === "group" ? "Neue Gruppe" : "Neuer Punkt", 10);
          applyEventFields(e, a.data || {});
          if (e.type === "group") e.color = "#64748b";
          const i = a.after ? day.events.findIndex((x) => x.id === a.after) : -1;
          day.events.splice(i < 0 ? day.events.length : i + 1, 0, e);
          break;
        }
        case "update": { const f = findEvent(a.id); if (f) applyEventFields(f.e, a.data || {}); break; }
        case "delete": {
          const f = findEvent(a.id);
          if (!f) break;
          f.day.events.splice(f.i, 1);
          if (r.currentId === a.id) clearRt();
          break;
        }
        case "move": {
          const f = findEvent(a.id), to = dayById(a.dayId) || f?.day;
          if (!f) break;
          f.day.events.splice(f.i, 1);
          to.events.splice(Math.max(0, Math.min(to.events.length, num(a.to, to.events.length))), 0, f.e);
          if (r.currentId === a.id) { clearRt(); r.dayId = to.id; }
          break;
        }
        case "dayAdd": state.days.push(newDay(a.data || {})); break;
        case "dayUpdate": { const d = dayById(a.id); if (d) applyDayFields(d, a.data || {}); break; }
        case "dayDelete": {
          if (state.days.length <= 1) throw new Error("Der letzte Tag kann nicht gelöscht werden");
          const d = dayById(a.id);
          if (!d) break;
          state.days = state.days.filter((x) => x !== d);
          if (r.dayId === d.id) { clearRt(); r.dayId = state.days[0].id; }
          break;
        }
        case "gewerkAdd": {
          if (state.gewerke.length >= 30) throw new Error("Maximal 30 Gewerke");
          const g = { id: rnd(), name: "Neues Gewerk", short: "NG", color: "#94a3b8" };
          applyGewerk(g, a.data || {});
          state.gewerke.push(g);
          break;
        }
        case "gewerkUpdate": { const g = state.gewerke.find((x) => x.id === a.id); if (g) applyGewerk(g, a.data || {}); break; }
        case "gewerkDelete":
          state.gewerke = state.gewerke.filter((g) => g.id !== a.id);
          for (const d of state.days) for (const e of d.events) e.cues = e.cues.filter((c) => c.gewerk !== a.id);
          delete state.ready[a.id];
          break;
        case "import": {
          const d = a.data || {};
          if (!Array.isArray(d.days) || !d.days.length || d.days.length > 60) throw new Error("Ungültiges Format");
          state.gewerke = (Array.isArray(d.gewerke) ? d.gewerke : []).slice(0, 30).map((x) => { const g = { id: str(x.id, 16) || rnd(), name: "", short: "", color: "#94a3b8" }; applyGewerk(g, x); return g; });
          state.days = d.days.map((x) => {
            const day = newDay(x); day.id = str(x.id, 16) || rnd();
            day.events = (Array.isArray(x.events) ? x.events : []).slice(0, 800).map((y) => { const e = ev("", 0, { id: str(y.id, 16) || rnd() }); applyEventFields(e, y); return e; });
            return day;
          });
          if (d.settings) applySettings({ ...d.settings, roll: false });
          state.ready = {};
          clearRt(); rt().dayId = state.days[0].id;
          log("Plan importiert");
          break;
        }
        default: throw new Error("Unbekannte Aktion");
      }
    }

    function withDraft(fn) {
      const keep = { ...planOf(state), runtime: state.runtime, ready: state.ready, log: state.log };
      Object.assign(state, planOf(state.draft), { runtime: { ...keep.runtime }, ready: {}, log: [] });
      try { fn(); } finally { state.draft = planOf(state); Object.assign(state, keep); }
      state.draftRev++;
    }
    function draftOp(a) {
      if (a.type === "draftStart") { if (!state.draft) { state.draft = JSON.parse(JSON.stringify(planOf(state))); state.draftRev++; log("Vorschau-Modus gestartet"); } return; }
      if (a.type === "draftDiscard") { state.draft = null; state.draftRev++; log("Entwurf verworfen"); return; }
      if (!state.draft) throw new Error("Kein Entwurf offen");
      const roll = state.settings.roll, d = state.draft, name = state.show.name;
      Object.assign(state, { show: { ...d.show, name }, gewerke: d.gewerke, days: d.days, settings: { ...d.settings, roll } });
      state.draft = null; state.draftRev++;
      const r = rt();
      if (!findEvent(r.currentId)) clearRt();
      if (!dayById(r.dayId)) r.dayId = state.days[0].id;
      for (const id of Object.keys(state.ready)) if (!state.gewerke.some((g) => g.id === id)) delete state.ready[id];
      log("Änderungen veröffentlicht (live)");
    }
    function act(a) {
      if (typeof a?.type !== "string") throw new Error("Ungültige Aktion");
      if (a.type.startsWith("draft")) return draftOp(a);
      if (PLAN.has(a.type) && state.draft) return withDraft(() => run(a));
      return run(a);
    }

    // Roll-Modus: Der Punkt, dessen Zeitfenster jetzt läuft, wird automatisch gestartet. Gibt true zurück, wenn sich etwas änderte.
    function tick() {
      if (!state.settings.roll || rt().status === "paused") return false;
      const { date, sec } = CLS.nowParts(now(), state.settings.timezone);
      const day = state.days.find((d) => d.date === date);
      if (!day) return false;
      const row = CLS.schedule(day).find((x) => !x.group && !x.skip && sec >= x.start && sec < x.end);
      if (!row || (rt().currentId === row.e.id && rt().status === "running")) return false;
      Object.assign(rt(), { dayId: day.id, currentId: row.e.id, status: "running", startedAt: now() - (sec - row.start) * 1000, pausedElapsed: 0, added: 0 });
      log(`Roll: ${row.e.title}`);
      return true;
    }
    // Zustand ohne Entwurf (der geht nur an Mitglieder), mit Hinweis ob einer offen ist
    const pub = () => { const { draft, ...rest } = state; return { ...rest, hasDraft: !!draft }; };

    return { act, tick, pub, state, PLAN };
  }

  return { create, createState, rnd, LOWER_STYLES, LOWER_POS };
});
