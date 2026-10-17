// Tallycall-Engine: Ablauflogik eines Projekts (Tage, Gruppen, Punkte, Pausen, Cues, Timer, Roll-Modus, Entwurf, Trigger-Ziele).
// Läuft im Node-Server und in der Browser-Demo. Ohne Abhängigkeiten.
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(require("../public/shared.js")); else root.Engine = factory(root.CLS); })(this, function (CLS) {
  const rnd = () => {
    const a = new Uint8Array(4);
    (globalThis.crypto || require("crypto").webcrypto).getRandomValues(a);
    return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const TYPES = ["event", "group", "break"];
  const END_ACTIONS = ["", "over", "next", "stop"]; // "" = Vorgabe aus den Einstellungen
  const ev = (title, min, extra = {}) => ({ id: rnd(), type: "event", parent: "", title, subtitle: "", presenter: "", note: "", duration: min * 60, color: CLS.COLOR.event, skip: false, start: "chain", fixedStart: 0, endAction: "", lowerId: "", cues: [], actions: [], ...extra });
  const grp = (title, extra = {}) => ev(title, 0, { type: "group", color: CLS.COLOR.group, ...extra });
  const brk = (title, min, extra = {}) => ev(title, min, { type: "break", color: CLS.COLOR.break, ...extra });
  const cue = (gewerk, text, offset = 0, extra = {}) => ({ id: rnd(), gewerk, text, offset, actions: [], ...extra });

  // Bauchbinden: Stile, Positionen und Standardwerte (Renderer: public/lowerthird.js)
  const LOWER_STYLES = ["balken", "glas", "linie", "karte", "block", "streifen"];
  const LOWER_POS = ["left", "center", "right"];
  const LOWER_DEFAULT = () => ({ title: "", subtitle: "", visible: false, style: "balken", accent: "#7c9cff", key: "none", pos: "left", design: null });

  // Trigger-Ziele (Integrationen) und Regeln
  const TARGET_TYPES = ["http", "osc", "tcp", "udp"];
  const RULE_EVENTS = ["start", "end", "next", "prev", "pause", "stop", "cue", "message", "lower", "ready", "roll"];

  const GEWERKE = () => [
    { id: "licht", name: "Licht", short: "LX", color: "#f5b942" },
    { id: "ton", name: "Ton", short: "AX", color: "#4fd1a1" },
    { id: "video", name: "Video", short: "VX", color: "#6ea8ff" },
    { id: "buehne", name: "Bühne", short: "BÜ", color: "#b58cff" },
    { id: "catering", name: "Catering", short: "CA", color: "#ff7a7a" },
  ];

  // Neues Projekt: leer (ein leerer Tag) oder mit Beispielshow
  const STALE_MS = 7 * 24 * 3600 * 1000;
  function createState({ name = "Neues Projekt", timezone = "Europe/Berlin", sample = false, template = "" } = {}) {
    if (!template && sample) template = "conference";
    const today = CLS.nowParts(Date.now(), timezone).date;
    const s = {
      show: { name },
      settings: { timezone, warnYellow: 120, warnRed: 30, standby: 10, roll: false, endAction: "over" },
      gewerke: GEWERKE(),
      days: [{ id: "tag1", name: "Tag 1", date: today, startTime: 9 * 3600, events: [] }],
      runtime: { dayId: "tag1", currentId: null, status: "stopped", startedAt: 0, pausedElapsed: 0, added: 0 },
      ready: {}, message: { text: "", visible: false }, lower: LOWER_DEFAULT(), lowers: [], lowerDesigns: [],
      integrations: { targets: [], rules: [] },
      log: [], actuals: {}, draft: null, draftRev: 0,
    };
    if (!template || template === "empty") return s;
    if (template === "concert") return concert(s, today);
    const vm = grp("Vormittag"), nm = grp("Nachmittag"), kn = grp("Keynote-Block", { parent: vm.id, color: "#5ad7e6" });
    s.lowers = [{ id: rnd(), title: "Anna Beispiel", subtitle: "Keynote Speaker" }, { id: rnd(), title: "Ben Muster", subtitle: "Moderation" }, { id: rnd(), title: "Podium", subtitle: "Mit vier Gästen" }];
    s.days = [
      { id: "tag1", name: "Tag 1 · Konferenz", date: today, startTime: 9 * 3600, events: [
        vm,
        ev("Einlass & Begrüßung", 10, { parent: vm.id, presenter: "Moderation", color: "#4fd1a1", lowerId: s.lowers[1].id, cues: [cue("ton", "Walk-in-Musik aus, Moderationsmikro auf"), cue("licht", "Cue 1: Saal Begrüßung"), cue("video", "Willkommen-Slide", 30), cue("buehne", "Moderation im Gang bereit")] }),
        kn,
        ev("Keynote", 30, { parent: kn.id, presenter: "Anna Beispiel", subtitle: "Die Zukunft der Events", lowerId: s.lowers[0].id, cues: [cue("licht", "Cue 2: Keynote-Look"), cue("video", "Folien Keynote Seite 1"), cue("ton", "Headset Anna auf"), cue("video", "Outro-Loop starten", 1740), cue("licht", "Cue 3: Applaus-Look", 1790)] }),
        ev("Fragen aus dem Publikum", 10, { parent: kn.id, color: "#5ad7e6", cues: [cue("ton", "2 Saalmikros scharf"), cue("licht", "Cue 3b: Saal halb hell")] }),
        brk("Kaffeepause", 15, { parent: vm.id, cues: [cue("catering", "Kaffee freigeben"), cue("ton", "Pausenmusik"), cue("licht", "Cue 4: Pausenlicht"), cue("buehne", "Podium umbauen", 60)] }),
        nm,
        ev("Podium", 45, { parent: nm.id, presenter: "Gäste", color: "#b58cff", start: "fixed", fixedStart: 10 * 3600 + 30 * 60, note: "Vier Gäste, Moderation links außen.", lowerId: s.lowers[2].id, cues: [cue("buehne", "Sessel und Tisch stehen"), cue("ton", "4 Handmikrofone scharf"), cue("licht", "Cue 5: Podium"), cue("video", "Namenseinblendungen", 60)] }),
        ev("Schlusswort", 5, { parent: nm.id, presenter: "Moderation", color: "#ff7a7a", cues: [cue("licht", "Cue 6: Finale"), cue("ton", "Abspann-Musik", 270)] }),
      ] },
      { id: "tag2", name: "Tag 2 · Workshops", date: CLS.addDays(today, 1), startTime: 10 * 3600, events: [
        ev("Workshop-Block A", 90, { cues: [cue("licht", "Raumlicht hell"), cue("video", "Beamer Raum 1–3")] }),
        brk("Mittagessen", 60, { cues: [cue("catering", "Buffet eröffnen")] }),
        ev("Workshop-Block B", 90),
      ] },
    ];
    s.lower = { ...LOWER_DEFAULT(), title: "Anna Beispiel", subtitle: "Keynote Speaker" };
    return s;
  }

  // Vorlage Konzert / Live-Show
  function concert(s, today) {
    const aufbau = grp("Aufbau und Checks", { color: "#94a3b8" }), einlass = grp("Einlass", { color: "#5ad7e6" }), show = grp("Show", { color: "#f472b6" });
    s.lowers = [{ id: rnd(), title: "Support Act", subtitle: "" }, { id: rnd(), title: "Hauptact", subtitle: "" }];
    s.days = [{ id: "tag1", name: "Showtag", date: today, startTime: 14 * 3600, events: [
      aufbau,
      ev("Linecheck und Soundcheck", 60, { parent: aufbau.id, color: "#4fd1a1", cues: [cue("ton", "Linecheck FOH und Monitor"), cue("licht", "Fokus und Looks prüfen"), cue("video", "Playback testen")] }),
      ev("Catering und Umziehen", 45, { parent: aufbau.id, color: "#ff7a7a", cues: [cue("catering", "Backstage-Catering offen")] }),
      einlass,
      ev("Einlass", 45, { parent: einlass.id, color: "#5ad7e6", start: "fixed", fixedStart: 18 * 3600 + 30 * 60, cues: [cue("ton", "Einlassmusik an"), cue("licht", "Saallicht Einlass"), cue("buehne", "Security bereit")] }),
      show,
      ev("Support Act", 40, { parent: show.id, color: "#f5b942", start: "fixed", fixedStart: 20 * 3600, lowerId: s.lowers[0].id, cues: [cue("licht", "Look Support"), cue("ton", "Mikro Support scharf"), cue("video", "Support-Visuals")] }),
      brk("Umbau", 20, { parent: show.id, cues: [cue("buehne", "Umbau Hauptact"), cue("licht", "Arbeitslicht an"), cue("ton", "Linecheck Hauptact")] }),
      ev("Hauptact", 75, { parent: show.id, color: "#f472b6", lowerId: s.lowers[1].id, cues: [cue("licht", "Intro-Look"), cue("video", "Intro-Film starten"), cue("ton", "Intro-Playback"), cue("licht", "Finale-Look", 4200)] }),
      ev("Zugabe", 10, { parent: show.id, color: "#b58cff", cues: [cue("licht", "Zugabe-Look"), cue("video", "Outro-Loop", 540)] }),
    ] }];
    s.runtime.dayId = "tag1"; s.lower = { ...LOWER_DEFAULT(), title: "Hauptact" };
    return s;
  }

  // Ältere Projekte auf das aktuelle Format heben (fehlende Felder, Verschachtelung)
  function upgrade(state) {
    state.lower = { ...LOWER_DEFAULT(), ...state.lower };
    if (!Array.isArray(state.lowers)) state.lowers = [];
    if (!state.actuals) state.actuals = {};
    if (!Array.isArray(state.lowerDesigns)) state.lowerDesigns = [];
    if (!state.integrations) state.integrations = { targets: [], rules: [] };
    state.integrations.targets = state.integrations.targets || []; state.integrations.rules = state.integrations.rules || [];
    if (!("endAction" in state.settings)) state.settings.endAction = "over";
    for (const src of [state, state.draft]) if (src) for (const d of src.days || []) {
      for (const e of d.events) {
        if (!TYPES.includes(e.type)) e.type = "event";
        if (!("parent" in e)) e.parent = "";
        if (!("endAction" in e)) e.endAction = "";
        if (!("lowerId" in e)) e.lowerId = "";
        if (!Array.isArray(e.actions)) e.actions = [];
        for (const c of e.cues || []) if (!Array.isArray(c.actions)) c.actions = [];
      }
      d.events = CLS.normalize(d.events);
    }
    return state;
  }

  // Engine für einen Projektzustand.
  function create(state, { now = () => Date.now() } = {}) {
    upgrade(state);
    const rt = () => state.runtime;
    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const str = (v, max = 300) => String(v ?? "").slice(0, max);
    const isColor = (v) => /^#[0-9a-f]{6}$/i.test(v);
    const dayById = (id) => state.days.find((d) => d.id === id);
    const playable = (day, e) => e.type !== "group" && !CLS.effSkip(day.events, e);
    function findEvent(id) {
      for (const day of state.days) { const i = day.events.findIndex((e) => e.id === id); if (i >= 0) return { day, e: day.events[i], i }; }
      return null;
    }
    function log(text) { state.log.unshift({ t: now(), text: str(text, 200) }); state.log.length = Math.min(state.log.length, 150); }
    const clearRt = () => Object.assign(rt(), { currentId: null, status: "stopped", pausedElapsed: 0, added: 0 });
    const elapsed = () => rt().pausedElapsed + (rt().status === "running" ? now() - rt().startedAt : 0);
    const total = (e) => e.duration * 1000 + rt().added;

    const designOf = (id) => state.lowerDesigns.find((x) => x.id === id);
    function showLower(e) {
      const q = e.lowerId && state.lowers.find((x) => x.id === e.lowerId);
      if (q) { Object.assign(state.lower, { title: q.title, subtitle: q.subtitle, visible: true }); const dz = q.designId && designOf(q.designId); if (dz) state.lower.design = { ...dz.params }; }
    }
    // Ist-Zeiten: wann ein Punkt tatsächlich begann und endete (für den Bericht)
    function markEnd(id) { const a = state.actuals[id]; if (a && !a.end) a.end = now(); }
    function markStart(f) { state.actuals[f.e.id] = { start: now(), end: 0, title: f.e.title, dayId: f.day.id, n: Object.keys(state.actuals).length }; }
    function loadEvent(id, run) {
      const f = findEvent(id);
      if (!f || !playable(f.day, f.e)) return;
      if (rt().currentId && rt().currentId !== id) markEnd(rt().currentId);
      if (run) markStart(f); else delete state.actuals[id];
      Object.assign(rt(), { dayId: f.day.id, currentId: id, status: run ? "running" : "stopped", startedAt: now(), pausedElapsed: 0, added: 0 });
      if (run) showLower(f.e);
      log(`${run ? "Start" : "Geladen"}: ${f.e.title}`);
    }
    function step(dir) {
      const f = findEvent(rt().currentId);
      const day = f ? f.day : dayById(rt().dayId) || state.days[0];
      const list = day.events.filter((e) => playable(day, e));
      const i = f ? list.indexOf(f.e) : -1;
      const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
      if (n < 0 || n >= list.length) { if (dir > 0 && f) { markEnd(f.e.id); rt().status = "stopped"; log(`Ende des Tages: ${day.name}`); } return; }
      loadEvent(list[n].id, rt().status === "running");
    }

    const targetOk = (id) => !id || state.integrations.targets.some((t) => t.id === id);
    function cleanActions(list, max = 20) {
      return (Array.isArray(list) ? list : []).slice(0, max).filter((a) => a && targetOk(a.targetId) && a.targetId).map((a) => ({
        id: str(a.id, 16) || rnd(), targetId: str(a.targetId, 16), on: a.on === "end" ? "end" : "start", payload: str(a.payload, 2000),
      }));
    }
    function cleanCues(list) {
      return (Array.isArray(list) ? list : []).slice(0, 80).map((c) => ({
        id: str(c.id, 16) || rnd(),
        gewerk: state.gewerke.some((g) => g.id === c.gewerk) ? c.gewerk : "",
        text: str(c.text, 200),
        offset: Math.max(0, Math.min(86400, Math.round(num(c.offset)))),
        actions: cleanActions(c.actions, 10).map(({ on, ...rest }) => rest),
      }));
    }
    function applyEventFields(e, d) {
      if ("title" in d) e.title = str(d.title, 120);
      if ("subtitle" in d) e.subtitle = str(d.subtitle, 160);
      if ("presenter" in d) e.presenter = str(d.presenter, 120);
      if ("note" in d) e.note = str(d.note, 1500);
      if ("duration" in d) e.duration = Math.max(0, Math.min(86400, Math.round(num(d.duration, e.duration))));
      if ("color" in d && isColor(d.color)) e.color = d.color;
      if ("skip" in d) e.skip = !!d.skip;
      if ("type" in d && TYPES.includes(d.type) && e.type !== "group" && d.type !== "group") e.type = d.type; // Gruppe ↔ Punkt wird nicht umgewandelt
      if ("start" in d) e.start = d.start === "fixed" ? "fixed" : "chain";
      if ("fixedStart" in d) e.fixedStart = Math.max(0, Math.min(86399, Math.round(num(d.fixedStart))));
      if ("endAction" in d && END_ACTIONS.includes(d.endAction)) e.endAction = d.endAction;
      if ("lowerId" in d) e.lowerId = state.lowers.some((q) => q.id === d.lowerId) ? d.lowerId : "";
      if ("cues" in d) e.cues = cleanCues(d.cues);
      if ("actions" in d) e.actions = cleanActions(d.actions);
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
      if ("color" in d && isColor(d.color)) g.color = d.color;
    }
    function applySettings(d) {
      const t = state.settings;
      if ("timezone" in d) { try { new Intl.DateTimeFormat("de", { timeZone: d.timezone }); t.timezone = d.timezone; } catch (_) { throw new Error("Unbekannte Zeitzone"); } }
      for (const k of ["warnYellow", "warnRed", "standby"]) if (k in d) t[k] = Math.max(0, Math.min(3600, Math.round(num(d[k], t[k]))));
      if ("roll" in d) t.roll = !!d.roll;
      if ("endAction" in d && ["over", "next", "stop"].includes(d.endAction)) t.endAction = d.endAction;
    }
    function applyTarget(t, d) {
      if ("name" in d) t.name = str(d.name, 60);
      if ("type" in d && TARGET_TYPES.includes(d.type)) t.type = d.type;
      if ("url" in d) t.url = str(d.url, 500);
      if ("method" in d) t.method = ["GET", "POST", "PUT"].includes(String(d.method).toUpperCase()) ? String(d.method).toUpperCase() : "POST";
      if ("headers" in d) t.headers = str(d.headers, 1000);
      if ("host" in d) t.host = str(d.host, 200).trim();
      if ("port" in d) t.port = Math.max(1, Math.min(65535, Math.round(num(d.port, 1))));
      if ("enabled" in d) t.enabled = !!d.enabled;
      if ("feedback" in d) t.feedback = !!d.feedback;
      if ("prefix" in d) t.prefix = "/" + str(d.prefix, 60).replace(/[^A-Za-z0-9_\-/]/g, "").replace(/^\/+|\/+$/g, "");
    }
    function applyRule(r, d) {
      if ("on" in d && RULE_EVENTS.includes(d.on)) r.on = d.on;
      if ("targetId" in d && targetOk(d.targetId)) r.targetId = str(d.targetId, 16);
      if ("payload" in d) r.payload = str(d.payload, 2000);
      if ("gewerk" in d) r.gewerk = state.gewerke.some((g) => g.id === d.gewerk) ? d.gewerk : "";
      if ("enabled" in d) r.enabled = !!d.enabled;
    }

    // Einfügeposition: als Kind von parent an Stelle index (unter den direkten Geschwistern)
    function insertAt(day, e, parent, index) {
      const ev = day.events;
      if (parent) {
        const g = ev.find((x) => x.id === parent && x.type === "group");
        if (!g) throw new Error("Gruppe nicht gefunden");
        if (e.type === "group" && CLS.depthOf(ev, g) >= CLS.MAX_DEPTH - 1) throw new Error("Zu tief verschachtelt");
        if (e.type !== "group" && CLS.depthOf(ev, g) >= CLS.MAX_DEPTH) throw new Error("Zu tief verschachtelt");
      }
      e.parent = parent || "";
      const sib = CLS.children(ev, parent);
      let pos;
      if (index == null || index >= sib.length) {
        if (sib.length) pos = CLS.blockOf(ev, sib[sib.length - 1].id)[1];
        else pos = parent ? ev.findIndex((x) => x.id === parent) + 1 : ev.length;
      } else pos = ev.indexOf(sib[Math.max(0, index)]);
      ev.splice(pos, 0, e);
    }

    // Planungsaktionen. Mit offenem Entwurf laufen sie gegen den Entwurf, nie gegen die Live-Show.
    const PLAN = new Set(["add", "update", "delete", "move", "dayAdd", "dayUpdate", "dayDelete", "dayMove", "gewerkAdd", "gewerkUpdate", "gewerkDelete", "gewerkMove", "import", "settings"]);
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
          const id = f && f.day.id === day.id ? f.e.id : day.events.find((e) => playable(day, e))?.id;
          if (id) loadEvent(id, true);
          break;
        }
        case "pause": if (r.status === "running") { r.pausedElapsed = elapsed(); r.status = "paused"; r.pausedAt = now(); log("Pause"); } break;
        case "toggle": return run({ type: r.status === "running" ? "pause" : "start", dayId: a.dayId });
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
          if (d.id) { const q = state.lowers.find((x) => x.id === d.id); if (!q) throw new Error("Bauchbinde nicht gefunden"); l.title = q.title; l.subtitle = q.subtitle; const dz = q.designId && designOf(q.designId); if (dz) l.design = { ...dz.params }; }
          if ("design" in d) l.design = d.design ? CLS.cleanDesign(d.design) : null;
          if (d.designId) { const dz = designOf(d.designId); if (dz) l.design = { ...dz.params }; }
          if ("title" in d) l.title = str(d.title, 120);
          if ("subtitle" in d) l.subtitle = str(d.subtitle, 160);
          if ("visible" in d) l.visible = !!d.visible;
          if ("style" in d && LOWER_STYLES.includes(d.style)) l.style = d.style;
          if ("pos" in d && LOWER_POS.includes(d.pos)) l.pos = d.pos;
          if ("accent" in d && isColor(d.accent)) l.accent = d.accent;
          if ("key" in d && (d.key === "none" || isColor(d.key))) l.key = d.key;
          break;
        }
        case "lowerSave": {
          if (state.lowers.length >= 200) throw new Error("Maximal 200 Bauchbinden");
          const x = state.lowers.find((q) => q.id === a.id);
          const did = "designId" in a ? (designOf(a.designId) ? a.designId : "") : undefined;
          if (x) { if ("title" in a) x.title = str(a.title, 120); if ("subtitle" in a) x.subtitle = str(a.subtitle, 160); if (did !== undefined) x.designId = did; }
          else state.lowers.push({ id: rnd(), title: str(a.title, 120), subtitle: str(a.subtitle, 160), designId: did || "" });
          break;
        }
        case "lowerDelete": state.lowers = state.lowers.filter((q) => q.id !== a.id); break;
        case "lowerMove": { const i = state.lowers.findIndex((q) => q.id === a.id); if (i < 0) break; const [q] = state.lowers.splice(i, 1); state.lowers.splice(Math.max(0, Math.min(state.lowers.length, num(a.to, i))), 0, q); break; }
        case "designSave": {
          const name = str(a.name, 40).trim(); if (!name) throw new Error("Bitte einen Namen eingeben");
          const params = CLS.cleanDesign(a.params), x = a.id && designOf(a.id);
          if (x) { x.name = name; x.params = params; }
          else { if (state.lowerDesigns.length >= 40) throw new Error("Maximal 40 Designs"); state.lowerDesigns.push({ id: rnd(), name, params }); }
          break;
        }
        case "designDelete": state.lowerDesigns = state.lowerDesigns.filter((x) => x.id !== a.id); for (const q of state.lowers) if (q.designId === a.id) q.designId = ""; break;
        case "ready": {
          const g = state.gewerke.find((x) => x.id === a.gewerk);
          if (!g) throw new Error("Unbekanntes Gewerk");
          const v = ["ready", "wait"].includes(a.state) ? a.state : "";
          state.ready[a.gewerk] = { state: v, at: now() };
          log(`${g.name}: ${v === "ready" ? "bereit" : v === "wait" ? "nicht bereit" : "zurückgesetzt"}`);
          break;
        }
        case "readyReset": state.ready = {}; break;
        case "actualsReset": state.actuals = {}; log("Ist-Zeiten zurückgesetzt"); break;
        // --- Integrationen (sofort live, nicht Teil des Entwurfs) ---
        case "targetAdd": {
          if (state.integrations.targets.length >= 40) throw new Error("Maximal 40 Ziele");
          const t = { id: rnd(), name: "Neues Ziel", type: "http", url: "", method: "POST", headers: "", host: "", port: 8000, enabled: true, feedback: false, prefix: "/tallycall" };
          applyTarget(t, a.data || {}); state.integrations.targets.push(t);
          break;
        }
        case "targetUpdate": { const t = state.integrations.targets.find((x) => x.id === a.id); if (!t) throw new Error("Ziel nicht gefunden"); applyTarget(t, a.data || {}); break; }
        case "targetDelete": {
          state.integrations.targets = state.integrations.targets.filter((t) => t.id !== a.id);
          state.integrations.rules = state.integrations.rules.filter((x) => x.targetId !== a.id);
          for (const src of [state, state.draft]) if (src) for (const d of src.days) for (const e of d.events) { e.actions = (e.actions || []).filter((x) => x.targetId !== a.id); for (const c of e.cues) c.actions = (c.actions || []).filter((x) => x.targetId !== a.id); }
          break;
        }
        case "ruleAdd": {
          if (state.integrations.rules.length >= 100) throw new Error("Maximal 100 Regeln");
          const ru = { id: rnd(), on: "start", targetId: state.integrations.targets[0]?.id || "", payload: "", gewerk: "", enabled: true };
          applyRule(ru, a.data || {}); state.integrations.rules.push(ru);
          break;
        }
        case "ruleUpdate": { const ru = state.integrations.rules.find((x) => x.id === a.id); if (!ru) throw new Error("Regel nicht gefunden"); applyRule(ru, a.data || {}); break; }
        case "ruleDelete": state.integrations.rules = state.integrations.rules.filter((x) => x.id !== a.id); break;
        // --- Planung ---
        case "settings": applySettings(a.data || {}); break;
        case "add": {
          const day = dayById(a.dayId) || state.days[0], d = a.data || {};
          const e = d.type === "group" ? grp("Neue Gruppe") : d.type === "break" ? brk("Pause", 15) : ev("Neuer Punkt", 10);
          applyEventFields(e, d);
          let parent = a.parent, index = a.index;
          if (a.after) { // hinter diesem Punkt (samt Block) als Geschwister
            const ref = day.events.find((x) => x.id === a.after); if (!ref) throw new Error("Punkt nicht gefunden");
            parent = ref.parent || ""; index = CLS.children(day.events, parent).indexOf(ref) + 1;
          }
          insertAt(day, e, parent || "", index);
          return e.id;
        }
        case "update": { const f = findEvent(a.id); if (f) applyEventFields(f.e, a.data || {}); break; }
        case "delete": {
          const f = findEvent(a.id);
          if (!f) break;
          const [i, j] = CLS.blockOf(f.day.events, a.id);
          if (a.withChildren || f.e.type !== "group") {
            const gone = new Set(f.day.events.slice(i, j).map((x) => x.id));
            f.day.events.splice(i, j - i);
            if (gone.has(r.currentId)) clearRt();
          } else { // Gruppe auflösen: Inhalte rücken eine Ebene hoch
            for (const x of f.day.events) if (x.parent === a.id) x.parent = f.e.parent || "";
            f.day.events.splice(i, 1);
          }
          break;
        }
        case "move": {
          const f = findEvent(a.id), to = dayById(a.dayId) || f?.day;
          if (!f) break;
          if (a.parent && (a.parent === a.id || CLS.isDesc(to.events, to.events.find((x) => x.id === a.parent) || {}, a.id))) throw new Error("Eine Gruppe kann nicht in sich selbst verschoben werden");
          const [i, j] = CLS.blockOf(f.day.events, a.id), block = f.day.events.splice(i, j - i);
          try { insertAt(to, block[0], a.parent || "", a.index); }
          catch (e2) { f.day.events.splice(i, 0, ...block); throw e2; }
          const pos = to.events.indexOf(block[0]);
          to.events.splice(pos + 1, 0, ...block.slice(1));
          if (f.day !== to && block.some((x) => x.id === r.currentId)) { clearRt(); r.dayId = to.id; }
          break;
        }
        case "dayAdd": state.days.push(newDay(a.data || {})); break;
        case "dayUpdate": { const d = dayById(a.id); if (d) applyDayFields(d, a.data || {}); break; }
        case "dayMove": { const i = state.days.findIndex((d) => d.id === a.id); if (i < 0) break; const [d] = state.days.splice(i, 1); state.days.splice(Math.max(0, Math.min(state.days.length, num(a.to, i))), 0, d); break; }
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
        case "gewerkMove": { const i = state.gewerke.findIndex((g) => g.id === a.id); if (i < 0) break; const [g] = state.gewerke.splice(i, 1); state.gewerke.splice(Math.max(0, Math.min(state.gewerke.length, num(a.to, i))), 0, g); break; }
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
            day.events = (Array.isArray(x.events) ? x.events : []).slice(0, 800).map((y) => { const e = ev("", 0, { id: str(y.id, 16) || rnd(), type: TYPES.includes(y.type) ? y.type : "event", parent: str(y.parent, 16) }); applyEventFields(e, y); return e; });
            day.events = CLS.normalize(day.events);
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
      let out;
      try { out = fn(); } finally { state.draft = planOf(state); Object.assign(state, keep); }
      state.draftRev++;
      return out;
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

    // Jede halbe Sekunde: Roll-Modus (Punkt nach Uhr starten) und Ende-Verhalten (automatisch weiter / anhalten). true = etwas hat sich geändert.
    function tick() {
      const r = rt();
      let changed = false;
      if (state.settings.roll && r.status !== "paused") {
        const { date, sec } = CLS.nowParts(now(), state.settings.timezone);
        const day = state.days.find((d) => d.date === date);
        if (day) {
          const row = CLS.schedule(day).find((x) => !x.group && !x.skip && sec >= x.start && sec < x.end);
          if (row && !(r.currentId === row.e.id && r.status === "running")) {
            if (r.currentId && r.currentId !== row.e.id) markEnd(r.currentId);
            markStart({ e: row.e, day });
            Object.assign(r, { dayId: day.id, currentId: row.e.id, status: "running", startedAt: now() - (sec - row.start) * 1000, pausedElapsed: 0, added: 0 });
            showLower(row.e);
            log(`Roll: ${row.e.title}`);
            changed = true;
          }
        }
      }
      // Vergessene Show: läuft ein Punkt 7 Tage über sein Ende hinaus (oder ist 7 Tage pausiert), wird er zurückgesetzt
      if (r.currentId && ((r.status === "running" && !state.settings.roll && (() => { const g = findEvent(r.currentId); return g && elapsed() - total(g.e) > STALE_MS; })()) || (r.status === "paused" && r.pausedAt && now() - r.pausedAt > STALE_MS))) {
        loadEvent(r.currentId, false); log("Automatisch gestoppt (7 Tage ohne Bedienung)");
        return true;
      }
      const f = r.status === "running" && findEvent(r.currentId);
      if (f && !state.settings.roll && elapsed() >= total(f.e)) {
        const mode = f.e.endAction || state.settings.endAction;
        if (mode === "next") { step(1); changed = true; }
        else if (mode === "stop") { r.pausedElapsed = total(f.e); r.status = "paused"; r.pausedAt = now(); log(`Ende: ${f.e.title}`); changed = true; }
      }
      return changed;
    }
    // Zustand ohne Entwurf (der geht nur an Mitglieder), mit Hinweis ob einer offen ist
    const pub = () => { const { draft, actuals, ...rest } = state; return { ...rest, hasDraft: !!draft }; };

    return { act, tick, pub, state, PLAN, findEvent, elapsed };
  }

  return { create, createState, upgrade, rnd, LOWER_STYLES, LOWER_POS, TARGET_TYPES, RULE_EVENTS, TYPES };
});
