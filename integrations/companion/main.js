// Bitfocus Companion module for Tallycall.
// Three ways to connect: connection code (one paste, per project, revocable), account login (email + password + project), or local server (no login).
// Presets are generated from the project and update live: a new lower third, department, day or rundown item becomes a new preset within seconds.
const { InstanceBase, InstanceStatus, combineRgb, runEntrypoint } = require("@companion-module/base");
const http = require("http");
const https = require("https");

const RED = combineRgb(255, 93, 93), GREEN = combineRgb(63, 214, 143), YELLOW = combineRgb(245, 185, 66), BLACK = combineRgb(0, 0, 0), WHITE = combineRgb(255, 255, 255), BLUE = combineRgb(124, 156, 255), DARK = combineRgb(24, 28, 36);
const clip = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

class TallycallInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.state = null; // last status object
    this.target = null; // { base, headers(post), project }
    this.cookie = "";
    this.es = null; this.pollTimer = null; this.reconnectTimer = null; this.tickTimer = null; this.defSig = "";
  }

  async init(config) { this.config = config; this.initDefinitions(); this.connect(); }
  async destroy() { this.disconnect(); clearInterval(this.tickTimer); }
  async configUpdated(config) { this.config = config; this.disconnect(); this.state = null; this.defSig = ""; this.initDefinitions(); this.connect(); }

  getConfigFields() {
    return [
      { type: "static-text", id: "info", width: 12, label: "How it connects", value: "Pick how this connection logs in. The connection code is the easiest: open your project in Tallycall → Trigger → “Create key” and paste the code. Buttons (presets) are built from your project automatically, and new lower thirds, departments, days and items appear as new presets by themselves." },
      { type: "dropdown", id: "mode", label: "Login", width: 12, default: "code", choices: [{ id: "code", label: "Connection code (recommended)" }, { id: "account", label: "Tallycall account (email + password)" }, { id: "local", label: "Local server (no login)" }] },
      { type: "textinput", id: "code", label: "Connection code", width: 12, isVisibleExpression: "$(options:mode) == 'code'" },
      { type: "textinput", id: "url", label: "Server address", width: 8, default: "https://tallycall.com", isVisibleExpression: "$(options:mode) != 'code'" },
      { type: "textinput", id: "email", label: "Email", width: 6, isVisibleExpression: "$(options:mode) == 'account'" },
      { type: "textinput", id: "password", label: "Password", width: 6, isVisibleExpression: "$(options:mode) == 'account'" },
      { type: "textinput", id: "project", label: "Project (name or id, empty = the only one)", width: 8, isVisibleExpression: "$(options:mode) != 'code'" },
      { type: "number", id: "poll", label: "Fallback poll interval (s, 0 = live stream only)", width: 4, default: 5, min: 0, max: 60 },
    ];
  }

  // ---- HTTP ----
  raw(method, url, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(url); } catch (_) { return reject(new Error("Invalid server address")); }
      const lib = u.protocol === "https:" ? https : http, data = body ? JSON.stringify(body) : null;
      const req = lib.request(u, { method, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers }, timeout: 8000 }, (res) => {
        let t = ""; res.on("data", (c) => (t += c));
        res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (_) {} if (res.statusCode >= 400) { const e = new Error(j?.error || "HTTP " + res.statusCode); e.status = res.statusCode; reject(e); } else resolve({ json: j, headers: res.headers }); });
      });
      req.on("timeout", () => req.destroy(new Error("Timeout"))); req.on("error", reject); req.end(data);
    });
  }
  authHeaders(post) { const c = this.target; return c.token ? { Authorization: "Bearer " + c.token } : { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(post ? { "x-cl": "1" } : {}) }; }
  async req(method, path, body) { return (await this.raw(method, this.target.base + path, { headers: this.authHeaders(method === "POST"), body })).json; }

  async cmd(name, params = {}) {
    if (!this.target) return;
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")).toString(), path = `/cmd/${name}${q ? "?" + q : ""}`;
    try { const r = await this.req(this.target.token ? "GET" : "POST", path); if (r && r.show !== undefined) this.applyStatus(r); }
    catch (e) { this.log("error", `${name}: ${e.message}`); if (e.status === 401 || e.status === 403) this.scheduleReconnect(); else this.updateStatus(InstanceStatus.UnknownWarning, e.message); }
  }

  // ---- Login and project selection ----
  async resolveTarget() {
    const c = this.config, mode = c.mode || "code";
    if (mode === "code") {
      const raw = String(c.code || "").trim().replace(/^tallycall:/, "").replace(/^tc1\./, "");
      let o; try { o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch (_) { throw Object.assign(new Error("The connection code is not valid. Copy it again from Tallycall → Trigger."), { bad: true }); }
      if (!o.u || !o.p || !o.k) throw Object.assign(new Error("The connection code is incomplete."), { bad: true });
      return { base: `${String(o.u).replace(/\/$/, "")}/api/p/${encodeURIComponent(o.p)}`, token: o.k, project: o.p };
    }
    const url = String(c.url || "").replace(/\/$/, "");
    if (!url) throw Object.assign(new Error("Server address is required"), { bad: true });
    this.cookie = "";
    if (mode === "account") {
      if (!c.email || !c.password) throw Object.assign(new Error("Email and password are required"), { bad: true });
      const r = await this.raw("POST", url + "/api/login", { headers: { "x-cl": "1" }, body: { email: c.email, password: c.password } });
      const sc = r.headers["set-cookie"]; this.cookie = (Array.isArray(sc) ? sc : [sc]).filter(Boolean).map((x) => x.split(";")[0]).join("; ");
    }
    const me = (await this.raw("GET", url + "/api/me", { headers: this.cookie ? { Cookie: this.cookie } : {} })).json, list = me.projects || [];
    const want = String(c.project || "").trim().toLowerCase();
    const p = want ? list.find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want) || list.find((x) => x.name.toLowerCase().includes(want)) : list.length === 1 ? list[0] : null;
    if (!p) throw Object.assign(new Error(list.length ? `Pick a project: ${list.map((x) => x.name).join(", ")}` : "This account has no project yet"), { bad: true });
    return { base: `${url}/api/p/${p.id}`, token: "", project: p.id };
  }

  // ---- Live stream ----
  async connect() {
    this.updateStatus(InstanceStatus.Connecting);
    try {
      this.target = await this.resolveTarget();
      const st = await this.req("GET", "/status"); this.applyStatus(st); this.updateStatus(InstanceStatus.Ok);
      this.openStream();
      if (this.config.poll > 0) this.pollTimer = setInterval(() => this.req("GET", "/status").then((s) => this.applyStatus(s)).catch(() => {}), this.config.poll * 1000);
    } catch (e) {
      this.updateStatus(e.bad ? InstanceStatus.BadConfig : e.status === 401 || e.status === 403 ? InstanceStatus.AuthenticationFailure : InstanceStatus.ConnectionFailure, e.message);
      if (!e.bad) this.scheduleReconnect();
    }
  }
  openStream() {
    let u; try { u = new URL(this.target.base + "/events"); } catch (_) { return; }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { headers: { ...this.authHeaders(false), Accept: "text/event-stream" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); this.scheduleReconnect(); return; }
      let buf = ""; res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c; let i;
        while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const line = block.split("\n").find((l) => l.startsWith("data:")); if (line) { try { this.applyState(JSON.parse(line.slice(5))); } catch (_) {} } }
      });
      res.on("end", () => this.scheduleReconnect()); res.on("error", () => this.scheduleReconnect());
    });
    req.on("error", () => this.scheduleReconnect()); req.end(); this.es = req;
  }
  scheduleReconnect() { if (this.reconnectTimer) return; this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.disconnect(false); this.connect(); }, 3000); }
  disconnect(clearReconnect = true) { if (this.es) { try { this.es.destroy(); } catch (_) {} this.es = null; } clearInterval(this.pollTimer); this.pollTimer = null; if (clearReconnect) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }

  // Full state from the stream → the same compact shape as GET /status
  applyState(s) {
    const r = s.runtime, find = (id) => { for (const d of s.days) { const e = d.events.find((x) => x.id === id); if (e) return { e, d }; } return null; };
    const f = find(r.currentId), e = f?.e || null, serverNow = s.serverTime || Date.now();
    const elapsed = r.pausedElapsed + (r.status === "running" ? serverNow - r.startedAt : 0), rem = e ? e.duration * 1000 + r.added - elapsed : 0;
    const skipped = (d, x) => { for (let g = x; g; g = g.parent && d.events.find((y) => y.id === g.parent)) if (g.skip) return true; return false; };
    let next = null; if (f) { const list = f.d.events.filter((x) => x.type !== "group" && !skipped(f.d, x)); next = list[list.indexOf(e) + 1] || null; }
    const fmt = (ms) => { const neg = ms < 0, t = Math.floor(Math.abs(ms) / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60, p = (n) => String(n).padStart(2, "0"); return (neg ? "-" : "") + (h ? `${p(h)}:` : "") + `${p(m)}:${p(sec)}`; };
    const items = s.days.flatMap((d) => d.events.filter((x) => x.type !== "group" && !skipped(d, x)).map((x) => ({ id: x.id, title: x.title, type: x.type, dayId: d.id, day: d.name, color: x.color })));
    const lw = s.lowers.find((q) => q.title === s.lower.title && q.subtitle === s.lower.subtitle);
    this.applyStatus({ show: s.show.name, project: this.target?.project, items, status: e ? r.status : "idle", current: e, next, remaining: Math.round(rem / 1000), remainingText: fmt(rem), elapsed: Math.round(elapsed / 1000), added: Math.round(r.added / 1000),
      level: !e ? "ok" : rem < 0 ? "over" : rem <= s.settings.warnRed * 1000 ? "danger" : rem <= s.settings.warnYellow * 1000 ? "warn" : "ok",
      roll: s.settings.roll, message: s.message, lower: { id: lw?.id || "", title: s.lower.title, subtitle: s.lower.subtitle, visible: s.lower.visible }, ready: Object.fromEntries(s.gewerke.map((g) => [g.id, s.ready?.[g.id]?.state || ""])),
      gewerke: s.gewerke, lowers: s.lowers, days: s.days.map((d) => ({ id: d.id, name: d.name })), day: f ? { id: f.d.id, name: f.d.name } : { id: r.dayId, name: s.days.find((d) => d.id === r.dayId)?.name || "" }, hasDraft: s.hasDraft,
      _startedAt: r.startedAt, _pausedElapsed: r.pausedElapsed, _added: r.added, _duration: e?.duration || 0, _offset: serverNow - Date.now() });
    this.updateStatus(InstanceStatus.Ok);
  }
  applyStatus(st) {
    this.state = st;
    const sig = JSON.stringify([st.gewerke, st.lowers, st.days, (st.items || []).map((i) => [i.id, i.title, i.day, i.color]), st.show]);
    if (sig !== this.defSig) { this.defSig = sig; this.initDefinitions(); }
    this.setVariableValues({
      project: st.show, status: st.status, title: st.current?.title || "", subtitle: st.current?.subtitle || "", presenter: st.current?.presenter || "", next: st.next?.title || "", day: st.day?.name || "",
      remaining: st.remainingText, remaining_sec: st.remaining, elapsed: st.elapsed, added: st.added, level: st.level, roll: st.roll ? "on" : "off", message: st.message?.visible ? st.message.text : "", lower: st.lower?.visible ? st.lower.title : "",
      ...Object.fromEntries((st.gewerke || []).map((g) => ["ready_" + g.id, st.ready?.[g.id] || ""])),
    });
    this.checkFeedbacks();
    clearInterval(this.tickTimer);
    if (st.status === "running" && st._startedAt) this.tickTimer = setInterval(() => { // keep the countdown moving between pushes
      const el = st._pausedElapsed + (Date.now() + st._offset - st._startedAt), rem = st._duration * 1000 + st._added - el;
      const p = (n) => String(n).padStart(2, "0"), t = Math.floor(Math.abs(rem) / 1000);
      this.setVariableValues({ remaining: (rem < 0 ? "-" : "") + (t >= 3600 ? p(Math.floor(t / 3600)) + ":" : "") + p(Math.floor((t % 3600) / 60)) + ":" + p(t % 60), remaining_sec: Math.round(rem / 1000), elapsed: Math.round(el / 1000) });
      st.remaining = Math.round(rem / 1000); this.checkFeedbacks("level");
    }, 1000);
  }

  // ---- Actions, feedbacks, variables, presets ----
  initDefinitions() {
    const st = this.state || {}, gw = st.gewerke || [], lowers = st.lowers || [], days = st.days || [], items = st.items || [];
    const gwChoices = gw.map((g) => ({ id: g.id, label: g.name })), lowChoices = lowers.map((l) => ({ id: l.id, label: l.title + (l.subtitle ? " · " + l.subtitle : "") })), dayChoices = days.map((d) => ({ id: d.id, label: d.name }));
    const itemChoices = items.slice(0, 400).map((i) => ({ id: i.id, label: `${i.day}: ${i.title}` }));
    this.setActionDefinitions({
      start: { name: "Start / resume", options: [], callback: () => this.cmd("start") },
      pause: { name: "Pause", options: [], callback: () => this.cmd("pause") },
      toggle: { name: "Start / pause (toggle)", options: [], callback: () => this.cmd("toggle") },
      next: { name: "Next item (starts the first item when nothing is loaded)", options: [], callback: () => this.cmd(!this.state || this.state.status === "idle" ? "start" : "next") },
      prev: { name: "Previous item", options: [], callback: () => this.cmd("prev") },
      stop: { name: "Reset current item", options: [], callback: () => this.cmd("stop") },
      addTime: { name: "Add / remove time", options: [{ type: "number", id: "min", label: "Minutes (negative removes)", default: 1, min: -120, max: 120 }], callback: (a) => this.cmd(a.options.min < 0 ? "sub" : "add", { min: Math.abs(a.options.min) }) },
      gotoItem: { name: "Start item", options: [{ type: "dropdown", id: "id", label: "Item", choices: itemChoices, default: itemChoices[0]?.id }], callback: (a) => this.cmd("start", { id: a.options.id }) },
      load: { name: "Load item (no start)", options: [{ type: "dropdown", id: "id", label: "Item", choices: itemChoices, default: itemChoices[0]?.id }], callback: (a) => this.cmd("load", { id: a.options.id }) },
      day: { name: "Select day", options: [{ type: "dropdown", id: "id", label: "Day", choices: dayChoices, default: dayChoices[0]?.id }], callback: (a) => this.cmd("day", { id: a.options.id }) },
      roll: { name: "Roll mode (by clock)", options: [{ type: "dropdown", id: "on", label: "State", choices: [{ id: "1", label: "On" }, { id: "0", label: "Off" }], default: "1" }], callback: (a) => this.cmd("roll", { on: a.options.on }) },
      ready: { name: "Department ready state", options: [{ type: "dropdown", id: "g", label: "Department", choices: gwChoices, default: gwChoices[0]?.id }, { type: "dropdown", id: "state", label: "State", choices: [{ id: "ready", label: "Ready" }, { id: "wait", label: "Not ready" }, { id: "", label: "Clear" }], default: "ready" }], callback: (a) => this.cmd("ready", { g: a.options.g, state: a.options.state }) },
      readyReset: { name: "Clear all ready states", options: [], callback: () => this.cmd("readyReset") },
      message: { name: "Show message on screens", options: [{ type: "textinput", id: "text", label: "Text", useVariables: true }], callback: async (a) => this.cmd("message", { text: await this.parseVariablesInString(a.options.text), visible: "1" }) },
      messageHide: { name: "Hide message", options: [], callback: () => this.cmd("message", { text: "", visible: "0" }) },
      lower: { name: "Show saved lower third", options: [{ type: "dropdown", id: "id", label: "Lower third", choices: lowChoices, default: lowChoices[0]?.id }], callback: (a) => this.cmd("lower", { id: a.options.id, visible: "1" }) },
      lowerToggle: { name: "Toggle saved lower third (show / hide)", options: [{ type: "dropdown", id: "id", label: "Lower third", choices: lowChoices, default: lowChoices[0]?.id }], callback: (a) => { const l = this.state?.lower, lw = (this.state?.lowers || []).find((q) => q.id === a.options.id); const on = l?.visible && lw && l.title === lw.title && l.subtitle === lw.subtitle; return this.cmd("lower", on ? { visible: "0" } : { id: a.options.id, visible: "1" }); } },
      lowerText: { name: "Show lower third (free text)", options: [{ type: "textinput", id: "title", label: "Title", useVariables: true }, { type: "textinput", id: "subtitle", label: "Subtitle", useVariables: true }], callback: async (a) => this.cmd("lower", { title: await this.parseVariablesInString(a.options.title), subtitle: await this.parseVariablesInString(a.options.subtitle), visible: "1" }) },
      lowerHide: { name: "Hide lower third", options: [], callback: () => this.cmd("lower", { visible: "0" }) },
    });
    const idOpt = { type: "textinput", id: "id", label: "Id" };
    this.setFeedbackDefinitions({
      running: { type: "boolean", name: "Show is running", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => this.state?.status === "running" },
      paused: { type: "boolean", name: "Show is paused", defaultStyle: { bgcolor: YELLOW, color: BLACK }, options: [], callback: () => this.state?.status === "paused" },
      level: { type: "boolean", name: "Timer warning level", defaultStyle: { bgcolor: RED, color: WHITE }, options: [{ type: "dropdown", id: "level", label: "Level", choices: [{ id: "warn", label: "Yellow (ending soon)" }, { id: "danger", label: "Red (last seconds)" }, { id: "over", label: "Over time" }], default: "over" }], callback: (fb) => { const s = this.state; if (!s || s.status !== "running") return false; const lv = s.remaining < 0 ? "over" : s.level; return fb.options.level === "over" ? lv === "over" : fb.options.level === "danger" ? lv === "danger" : lv === "warn" || lv === "danger"; } },
      ready: { type: "boolean", name: "Department is ready", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [{ type: "dropdown", id: "g", label: "Department", choices: gwChoices, default: gwChoices[0]?.id }], callback: (fb) => this.state?.ready?.[fb.options.g] === "ready" },
      notReady: { type: "boolean", name: "Department is NOT ready", defaultStyle: { bgcolor: RED, color: WHITE }, options: [{ type: "dropdown", id: "g", label: "Department", choices: gwChoices, default: gwChoices[0]?.id }], callback: (fb) => this.state?.ready?.[fb.options.g] === "wait" },
      roll: { type: "boolean", name: "Roll mode is on", defaultStyle: { bgcolor: BLUE, color: BLACK }, options: [], callback: () => !!this.state?.roll },
      lowerVisible: { type: "boolean", name: "Any lower third is visible", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => !!this.state?.lower?.visible },
      lowerIs: { type: "boolean", name: "This lower third is visible", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [{ type: "dropdown", id: "id", label: "Lower third", choices: lowChoices, default: lowChoices[0]?.id }], callback: (fb) => { const l = this.state?.lower, lw = (this.state?.lowers || []).find((q) => q.id === fb.options.id); return !!(l?.visible && lw && l.title === lw.title && l.subtitle === lw.subtitle); } },
      messageVisible: { type: "boolean", name: "Message is visible", defaultStyle: { bgcolor: YELLOW, color: BLACK }, options: [], callback: () => !!this.state?.message?.visible },
      itemCurrent: { type: "boolean", name: "This item is the current one", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [{ type: "dropdown", id: "id", label: "Item", choices: itemChoices, default: itemChoices[0]?.id }], callback: (fb) => this.state?.current?.id === fb.options.id && this.state?.status === "running" },
      itemLoaded: { type: "boolean", name: "This item is loaded (not started)", defaultStyle: { bgcolor: YELLOW, color: BLACK }, options: [{ type: "dropdown", id: "id", label: "Item", choices: itemChoices, default: itemChoices[0]?.id }], callback: (fb) => this.state?.current?.id === fb.options.id && this.state?.status !== "running" },
      itemNext: { type: "boolean", name: "This item is next", defaultStyle: { bgcolor: BLUE, color: BLACK }, options: [{ type: "dropdown", id: "id", label: "Item", choices: itemChoices, default: itemChoices[0]?.id }], callback: (fb) => this.state?.next?.id === fb.options.id },
      dayIs: { type: "boolean", name: "This day is selected", defaultStyle: { bgcolor: BLUE, color: BLACK }, options: [{ type: "dropdown", id: "id", label: "Day", choices: dayChoices, default: dayChoices[0]?.id }], callback: (fb) => this.state?.day?.id === fb.options.id },
    });
    this.setVariableDefinitions([
      { variableId: "project", name: "Project name" }, { variableId: "status", name: "Status (idle/running/paused/stopped)" }, { variableId: "title", name: "Current item" }, { variableId: "subtitle", name: "Current subtitle" }, { variableId: "presenter", name: "Current presenter" },
      { variableId: "next", name: "Next item" }, { variableId: "day", name: "Current day" }, { variableId: "remaining", name: "Remaining time (mm:ss)" }, { variableId: "remaining_sec", name: "Remaining seconds" }, { variableId: "elapsed", name: "Elapsed seconds" },
      { variableId: "added", name: "Added seconds" }, { variableId: "level", name: "Warning level (ok/warn/danger/over)" }, { variableId: "roll", name: "Roll mode (on/off)" }, { variableId: "message", name: "Visible message" }, { variableId: "lower", name: "Visible lower third title" },
      ...gw.map((g) => ({ variableId: "ready_" + g.id, name: `Ready state: ${g.name}` })),
    ]);
    this.setPresetDefinitions(this.buildPresets({ gw, lowers, days, items }));
  }

  buildPresets({ gw, lowers, days, items }) {
    const btn = (category, name, text, down, feedbacks = [], style = {}) => ({ type: "button", category, name, style: { text, size: "auto", color: WHITE, bgcolor: DARK, ...style }, steps: [{ down, up: [] }], feedbacks });
    const act = (actionId, options = {}) => [{ actionId, options }];
    const P = {
      next: btn("Transport", "Next", "NEXT\n$(tallycall:next)", act("next"), [], { size: "14", bgcolor: BLACK }),
      prev: btn("Transport", "Previous", "PREV", act("prev"), [], { size: "18", bgcolor: BLACK }),
      toggle: btn("Transport", "Start / Pause", "$(tallycall:remaining)", act("toggle"), [{ feedbackId: "running", style: { bgcolor: GREEN, color: BLACK } }, { feedbackId: "paused", style: { bgcolor: YELLOW, color: BLACK } }, { feedbackId: "level", options: { level: "warn" }, style: { bgcolor: YELLOW, color: BLACK } }, { feedbackId: "level", options: { level: "over" }, style: { bgcolor: RED, color: WHITE } }], { size: "18", bgcolor: BLACK }),
      stop: btn("Transport", "Reset item", "RESET", act("stop"), [], { size: "18", bgcolor: BLACK }),
      current: btn("Info", "Current item", "$(tallycall:title)\n$(tallycall:remaining)", [], [{ feedbackId: "level", options: { level: "over" }, style: { bgcolor: RED, color: WHITE } }], { size: "auto" }),
      following: btn("Info", "Next item (info)", "NEXT\n$(tallycall:next)", [], [], { size: "auto" }),
      plus1: btn("Time", "+1 min", "+1\nMIN", act("addTime", { min: 1 }), [], { size: "18" }), minus1: btn("Time", "−1 min", "−1\nMIN", act("addTime", { min: -1 }), [], { size: "18" }),
      plus5: btn("Time", "+5 min", "+5\nMIN", act("addTime", { min: 5 }), [], { size: "18" }), minus5: btn("Time", "−5 min", "−5\nMIN", act("addTime", { min: -5 }), [], { size: "18" }),
      roll: btn("Transport", "Roll mode", "ROLL\n$(tallycall:roll)", act("roll", { on: "1" }), [{ feedbackId: "roll", style: { bgcolor: BLUE, color: BLACK } }], { size: "14" }),
      messageOff: btn("Message", "Hide message", "MSG\nOFF", act("messageHide"), [{ feedbackId: "messageVisible", style: { bgcolor: YELLOW, color: BLACK } }], { size: "14" }),
      readyReset: btn("Departments", "Clear ready states", "CLEAR\nREADY", act("readyReset"), [], { size: "14" }),
      lowerOff: btn("Lower thirds", "Hide lower third", "LT\nOFF", act("lowerHide"), [{ feedbackId: "lowerVisible", style: { bgcolor: GREEN, color: BLACK } }], { size: "18" }),
    };
    for (const l of lowers) P["lower_" + l.id] = btn("Lower thirds", `Lower third: ${l.title}`, `LT\n${clip(l.title, 14)}${l.subtitle ? "\n" + clip(l.subtitle, 14) : ""}`, act("lowerToggle", { id: l.id }), [{ feedbackId: "lowerIs", options: { id: l.id }, style: { bgcolor: GREEN, color: BLACK } }], { size: "14" });
    for (const g of gw) {
      P["ready_" + g.id] = btn("Departments", `Ready: ${g.name}`, `${g.short || clip(g.name, 4)}\nREADY`, act("ready", { g: g.id, state: "ready" }), [{ feedbackId: "ready", options: { g: g.id }, style: { bgcolor: GREEN, color: BLACK } }, { feedbackId: "notReady", options: { g: g.id }, style: { bgcolor: RED, color: WHITE } }], { size: "14", bgcolor: BLACK });
      P["wait_" + g.id] = btn("Departments", `Not ready: ${g.name}`, `${g.short || clip(g.name, 4)}\nWAIT`, act("ready", { g: g.id, state: "wait" }), [{ feedbackId: "notReady", options: { g: g.id }, style: { bgcolor: RED, color: WHITE } }], { size: "14", bgcolor: BLACK });
    }
    for (const d of days) P["day_" + d.id] = btn("Days", `Day: ${d.name}`, clip(d.name, 16), act("day", { id: d.id }), [{ feedbackId: "dayIs", options: { id: d.id }, style: { bgcolor: BLUE, color: BLACK } }], { size: "auto" });
    for (const i of items.slice(0, 200)) P["item_" + i.id] = btn(`Rundown: ${clip(i.day, 24)}`, `Start: ${i.title}`, `${i.type === "break" ? "⏸ " : ""}${clip(i.title, 30)}`, act("gotoItem", { id: i.id }), [{ feedbackId: "itemCurrent", options: { id: i.id }, style: { bgcolor: GREEN, color: BLACK } }, { feedbackId: "itemLoaded", options: { id: i.id }, style: { bgcolor: YELLOW, color: BLACK } }, { feedbackId: "itemNext", options: { id: i.id }, style: { bgcolor: BLUE, color: BLACK } }], { size: "auto" });
    return P;
  }
}
runEntrypoint(TallycallInstance, []);
