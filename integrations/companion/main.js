// Bitfocus Companion module for Tallycall. Talks to a Tallycall server over HTTP with a project API key.
// Live state arrives over SSE (/events); every action is a GET /cmd/<name> or POST /action.
const { InstanceBase, InstanceStatus, Regex, combineRgb, runEntrypoint } = require("@companion-module/base");
const http = require("http");
const https = require("https");

class TallycallInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.state = null; // last status object from the server
    this.es = null; // open SSE request
    this.pollTimer = null;
    this.reconnectTimer = null;
  }

  async init(config) {
    this.config = config;
    this.initDefinitions();
    this.connect();
  }
  async destroy() { this.disconnect(); }
  async configUpdated(config) { this.config = config; this.disconnect(); this.initDefinitions(); this.connect(); }

  getConfigFields() {
    return [
      { type: "static-text", id: "info", width: 12, label: "Setup", value: "In Tallycall open the project → Trigger → create an API key (scope: control). Paste server address, project id and key below." },
      { type: "textinput", id: "url", label: "Server address", width: 8, default: "https://tallycall.com", regex: Regex.SOMETHING },
      { type: "textinput", id: "project", label: "Project id (from the address bar, /p/<id>/)", width: 4, regex: Regex.SOMETHING },
      { type: "textinput", id: "token", label: "API key (tc_…)", width: 8, regex: Regex.SOMETHING },
      { type: "number", id: "poll", label: "Fallback poll interval (s, 0 = live stream only)", width: 4, default: 2, min: 0, max: 60 },
    ];
  }

  // ---- HTTP ----
  base() { return `${String(this.config.url || "").replace(/\/$/, "")}/api/p/${encodeURIComponent(this.config.project || "")}`; }
  request(method, path, body) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(this.base() + path); } catch (e) { return reject(new Error("Invalid server address")); }
      const lib = u.protocol === "https:" ? https : http;
      const data = body ? JSON.stringify(body) : null;
      const req = lib.request(u, { method, headers: { Authorization: "Bearer " + (this.config.token || ""), "Content-Type": "application/json", "Content-Length": data ? Buffer.byteLength(data) : 0 }, timeout: 6000 }, (res) => {
        let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (_) {} if (res.statusCode >= 400) reject(new Error(j?.error || "HTTP " + res.statusCode)); else resolve(j); });
      });
      req.on("timeout", () => req.destroy(new Error("Timeout"))); req.on("error", reject);
      req.end(data);
    });
  }
  async cmd(name, params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")).toString();
    try { const r = await this.request("GET", `/cmd/${name}${q ? "?" + q : ""}`); if (r && r.show !== undefined) this.applyStatus(r); }
    catch (e) { this.log("error", `${name}: ${e.message}`); this.updateStatus(InstanceStatus.ConnectionFailure, e.message); }
  }

  // ---- Live stream ----
  connect() {
    if (!this.config.url || !this.config.project || !this.config.token) { this.updateStatus(InstanceStatus.BadConfig, "Server, project id and API key are required"); return; }
    this.updateStatus(InstanceStatus.Connecting);
    this.request("GET", "/status").then((s) => { this.applyStatus(s); this.updateStatus(InstanceStatus.Ok); this.openStream(); }).catch((e) => { this.updateStatus(InstanceStatus.ConnectionFailure, e.message); this.scheduleReconnect(); });
    if (this.config.poll > 0) this.pollTimer = setInterval(() => this.request("GET", "/status").then((s) => this.applyStatus(s)).catch(() => {}), this.config.poll * 1000);
  }
  openStream() {
    let u; try { u = new URL(this.base() + "/events"); } catch (_) { return; }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { headers: { Authorization: "Bearer " + this.config.token, Accept: "text/event-stream" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); this.scheduleReconnect(); return; }
      let buf = "";
      res.on("data", (c) => {
        buf += c;
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
          try { this.applyState(JSON.parse(line.slice(5))); } catch (_) {}
        }
      });
      res.on("end", () => this.scheduleReconnect()); res.on("error", () => this.scheduleReconnect());
    });
    req.on("error", () => this.scheduleReconnect()); req.end();
    this.es = req;
  }
  scheduleReconnect() { if (this.reconnectTimer) return; this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.disconnect(false); this.connect(); }, 3000); }
  disconnect(clearReconnect = true) { if (this.es) { try { this.es.destroy(); } catch (_) {} this.es = null; } clearInterval(this.pollTimer); this.pollTimer = null; if (clearReconnect) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }

  // Full state from the stream → compact status (same shape as /status)
  applyState(s) {
    const r = s.runtime, find = (id) => { for (const d of s.days) { const e = d.events.find((x) => x.id === id); if (e) return { e, d }; } return null; };
    const f = find(r.currentId), e = f?.e || null;
    const serverNow = s.serverTime || Date.now();
    const elapsed = r.pausedElapsed + (r.status === "running" ? serverNow - r.startedAt : 0);
    const rem = e ? e.duration * 1000 + r.added - elapsed : 0;
    let next = null; if (f) { const skipOf = (x) => x.skip || (x.parent && f.d.events.find((g) => g.id === x.parent)?.skip); const list = f.d.events.filter((x) => x.type !== "group" && !skipOf(x)); next = list[list.indexOf(e) + 1] || null; }
    const fmt = (ms) => { const neg = ms < 0, t = Math.floor(Math.abs(ms) / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60, p = (n) => String(n).padStart(2, "0"); return (neg ? "-" : "") + (h ? `${p(h)}:` : "") + `${p(m)}:${p(sec)}`; };
    this.applyStatus({ show: s.show.name, status: e ? r.status : "idle", current: e, next, remaining: Math.round(rem / 1000), remainingText: fmt(rem), elapsed: Math.round(elapsed / 1000), added: Math.round(r.added / 1000),
      level: !e ? "ok" : rem < 0 ? "over" : rem <= s.settings.warnRed * 1000 ? "danger" : rem <= s.settings.warnYellow * 1000 ? "warn" : "ok",
      roll: s.settings.roll, message: s.message, lower: s.lower, ready: Object.fromEntries(s.gewerke.map((g) => [g.id, s.ready?.[g.id]?.state || ""])), gewerke: s.gewerke, lowers: s.lowers, days: s.days.map((d) => ({ id: d.id, name: d.name })), day: f ? { name: f.d.name } : null, hasDraft: s.hasDraft, _startedAt: r.startedAt, _pausedElapsed: r.pausedElapsed, _added: r.added, _duration: e?.duration || 0, _offset: serverNow - Date.now() });
    this.updateStatus(InstanceStatus.Ok);
  }
  applyStatus(st) {
    const changedLists = !this.state || JSON.stringify(this.state.gewerke) !== JSON.stringify(st.gewerke) || JSON.stringify(this.state.lowers) !== JSON.stringify(st.lowers);
    this.state = st;
    if (changedLists) this.initDefinitions();
    this.setVariableValues({
      status: st.status, title: st.current?.title || "", subtitle: st.current?.subtitle || "", presenter: st.current?.presenter || "", next: st.next?.title || "", day: st.day?.name || "",
      remaining: st.remainingText, remaining_sec: st.remaining, elapsed: st.elapsed, added: st.added, level: st.level, roll: st.roll ? "on" : "off", message: st.message?.visible ? st.message.text : "", lower: st.lower?.visible ? st.lower.title : "",
      ...Object.fromEntries((st.gewerke || []).map((g) => ["ready_" + g.id, st.ready?.[g.id] || ""])),
    });
    this.checkFeedbacks();
    // keep the countdown ticking between server pushes
    clearInterval(this.tickTimer);
    if (st.status === "running" && st._startedAt) this.tickTimer = setInterval(() => {
      const el = st._pausedElapsed + (Date.now() + st._offset - st._startedAt), rem = st._duration * 1000 + st._added - el;
      const p = (n) => String(n).padStart(2, "0"), t = Math.floor(Math.abs(rem) / 1000);
      this.setVariableValues({ remaining: (rem < 0 ? "-" : "") + (t >= 3600 ? p(Math.floor(t / 3600)) + ":" : "") + p(Math.floor((t % 3600) / 60)) + ":" + p(t % 60), remaining_sec: Math.round(rem / 1000), elapsed: Math.round(el / 1000) });
      st.remaining = Math.round(rem / 1000); this.checkFeedbacks("level", "running");
    }, 1000);
  }

  // ---- Definitions ----
  initDefinitions() {
    const gw = this.state?.gewerke || [], lowers = this.state?.lowers || [], days = this.state?.days || [];
    const gwChoices = gw.map((g) => ({ id: g.id, label: g.name })), lowChoices = lowers.map((l) => ({ id: l.id, label: l.title + (l.subtitle ? " · " + l.subtitle : "") })), dayChoices = days.map((d) => ({ id: d.id, label: d.name }));
    this.setActionDefinitions({
      start: { name: "Start / resume", options: [], callback: () => this.cmd("start") },
      pause: { name: "Pause", options: [], callback: () => this.cmd("pause") },
      toggle: { name: "Start / pause (toggle)", options: [], callback: () => this.cmd("toggle") },
      next: { name: "Next item", options: [], callback: () => this.cmd("next") },
      prev: { name: "Previous item", options: [], callback: () => this.cmd("prev") },
      stop: { name: "Reset current item", options: [], callback: () => this.cmd("stop") },
      addTime: { name: "Add / remove time", options: [{ type: "number", id: "min", label: "Minutes (negative removes)", default: 1, min: -120, max: 120 }], callback: (a) => this.cmd(a.options.min < 0 ? "sub" : "add", { min: Math.abs(a.options.min) }) },
      load: { name: "Load item by id (no start)", options: [{ type: "textinput", id: "id", label: "Item id" }], callback: (a) => this.cmd("load", { id: a.options.id }) },
      day: { name: "Select day", options: [{ type: "dropdown", id: "id", label: "Day", choices: dayChoices, default: dayChoices[0]?.id }], callback: (a) => this.cmd("day", { id: a.options.id }) },
      roll: { name: "Roll mode (by clock)", options: [{ type: "dropdown", id: "on", label: "State", choices: [{ id: "1", label: "On" }, { id: "0", label: "Off" }], default: "1" }], callback: (a) => this.cmd("roll", { on: a.options.on }) },
      ready: { name: "Department ready state", options: [{ type: "dropdown", id: "g", label: "Department", choices: gwChoices, default: gwChoices[0]?.id }, { type: "dropdown", id: "state", label: "State", choices: [{ id: "ready", label: "Ready" }, { id: "wait", label: "Not ready" }, { id: "", label: "Clear" }], default: "ready" }], callback: (a) => this.cmd("ready", { g: a.options.g, state: a.options.state }) },
      readyReset: { name: "Clear all ready states", options: [], callback: () => this.cmd("readyReset") },
      message: { name: "Show message on screens", options: [{ type: "textinput", id: "text", label: "Text", useVariables: true }], callback: async (a) => this.cmd("message", { text: await this.parseVariablesInString(a.options.text), visible: "1" }) },
      messageHide: { name: "Hide message", options: [], callback: () => this.cmd("message", { text: "", visible: "0" }) },
      lower: { name: "Show saved lower third", options: [{ type: "dropdown", id: "id", label: "Lower third", choices: lowChoices, default: lowChoices[0]?.id }], callback: (a) => this.cmd("lower", { id: a.options.id, visible: "1" }) },
      lowerText: { name: "Show lower third (free text)", options: [{ type: "textinput", id: "title", label: "Title", useVariables: true }, { type: "textinput", id: "subtitle", label: "Subtitle", useVariables: true }], callback: async (a) => this.cmd("lower", { title: await this.parseVariablesInString(a.options.title), subtitle: await this.parseVariablesInString(a.options.subtitle), visible: "1" }) },
      lowerHide: { name: "Hide lower third", options: [], callback: () => this.cmd("lower", { visible: "0" }) },
    });
    const RED = combineRgb(255, 93, 93), GREEN = combineRgb(63, 214, 143), YELLOW = combineRgb(245, 185, 66), BLACK = combineRgb(0, 0, 0), WHITE = combineRgb(255, 255, 255);
    this.setFeedbackDefinitions({
      running: { type: "boolean", name: "Show is running", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => this.state?.status === "running" },
      paused: { type: "boolean", name: "Show is paused", defaultStyle: { bgcolor: YELLOW, color: BLACK }, options: [], callback: () => this.state?.status === "paused" },
      level: { type: "boolean", name: "Timer warning level", defaultStyle: { bgcolor: RED, color: WHITE }, options: [{ type: "dropdown", id: "level", label: "Level", choices: [{ id: "warn", label: "Yellow (ending soon)" }, { id: "danger", label: "Red (last seconds)" }, { id: "over", label: "Over time" }], default: "over" }], callback: (fb) => { const s = this.state; if (!s || s.status !== "running") return false; const lv = s.remaining < 0 ? "over" : s.level; return fb.options.level === "over" ? lv === "over" : fb.options.level === "danger" ? lv === "danger" : lv === "warn" || lv === "danger"; } },
      ready: { type: "boolean", name: "Department is ready", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [{ type: "dropdown", id: "g", label: "Department", choices: gwChoices, default: gwChoices[0]?.id }], callback: (fb) => this.state?.ready?.[fb.options.g] === "ready" },
      notReady: { type: "boolean", name: "Department is NOT ready", defaultStyle: { bgcolor: RED, color: WHITE }, options: [{ type: "dropdown", id: "g", label: "Department", choices: gwChoices, default: gwChoices[0]?.id }], callback: (fb) => this.state?.ready?.[fb.options.g] === "wait" },
      roll: { type: "boolean", name: "Roll mode is on", defaultStyle: { bgcolor: combineRgb(124, 156, 255), color: BLACK }, options: [], callback: () => !!this.state?.roll },
      lowerVisible: { type: "boolean", name: "Lower third is visible", defaultStyle: { bgcolor: GREEN, color: BLACK }, options: [], callback: () => !!this.state?.lower?.visible },
      messageVisible: { type: "boolean", name: "Message is visible", defaultStyle: { bgcolor: YELLOW, color: BLACK }, options: [], callback: () => !!this.state?.message?.visible },
    });
    this.setVariableDefinitions([
      { variableId: "status", name: "Status (idle/running/paused/stopped)" }, { variableId: "title", name: "Current item" }, { variableId: "subtitle", name: "Current subtitle" }, { variableId: "presenter", name: "Current presenter" },
      { variableId: "next", name: "Next item" }, { variableId: "day", name: "Current day" }, { variableId: "remaining", name: "Remaining time (mm:ss)" }, { variableId: "remaining_sec", name: "Remaining seconds" }, { variableId: "elapsed", name: "Elapsed seconds" },
      { variableId: "added", name: "Added seconds" }, { variableId: "level", name: "Warning level (ok/warn/danger/over)" }, { variableId: "roll", name: "Roll mode (on/off)" }, { variableId: "message", name: "Visible message" }, { variableId: "lower", name: "Visible lower third title" },
      ...gw.map((g) => ({ variableId: "ready_" + g.id, name: `Ready state: ${g.name}` })),
    ]);
    this.setPresetDefinitions({
      next: { type: "button", category: "Transport", name: "Next", style: { text: "NEXT\\n$(tallycall:next)", size: "14", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "next", options: {} }], up: [] }], feedbacks: [] },
      toggle: { type: "button", category: "Transport", name: "Start / Pause", style: { text: "$(tallycall:remaining)", size: "18", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "toggle", options: {} }], up: [] }], feedbacks: [{ feedbackId: "running", style: { bgcolor: GREEN, color: BLACK } }, { feedbackId: "level", options: { level: "warn" }, style: { bgcolor: YELLOW, color: BLACK } }, { feedbackId: "level", options: { level: "over" }, style: { bgcolor: RED, color: WHITE } }] },
      prev: { type: "button", category: "Transport", name: "Previous", style: { text: "PREV", size: "14", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "prev", options: {} }], up: [] }], feedbacks: [] },
      plus1: { type: "button", category: "Time", name: "+1 min", style: { text: "+1 MIN", size: "14", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "addTime", options: { min: 1 } }], up: [] }], feedbacks: [] },
      minus1: { type: "button", category: "Time", name: "−1 min", style: { text: "−1 MIN", size: "14", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "addTime", options: { min: -1 } }], up: [] }], feedbacks: [] },
      title: { type: "button", category: "Info", name: "Current item", style: { text: "$(tallycall:title)", size: "auto", color: WHITE, bgcolor: BLACK }, steps: [], feedbacks: [] },
      lowerHide: { type: "button", category: "Lower thirds", name: "Hide lower third", style: { text: "LT OFF", size: "14", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "lowerHide", options: {} }], up: [] }], feedbacks: [{ feedbackId: "lowerVisible", style: { bgcolor: GREEN, color: BLACK } }] },
      ...Object.fromEntries(gw.map((g) => ["ready_" + g.id, { type: "button", category: "Departments", name: `Ready: ${g.name}`, style: { text: g.short || g.name, size: "18", color: WHITE, bgcolor: BLACK }, steps: [{ down: [{ actionId: "ready", options: { g: g.id, state: "ready" } }], up: [] }], feedbacks: [{ feedbackId: "ready", options: { g: g.id }, style: { bgcolor: GREEN, color: BLACK } }, { feedbackId: "notReady", options: { g: g.id }, style: { bgcolor: RED, color: WHITE } }] }])),
    });
  }
}
runEntrypoint(TallycallInstance, []);
