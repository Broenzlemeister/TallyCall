// UI-Bausteine für alle Projektseiten: App-Leiste, Screens-Menü mit Teilen, Nutzermenü, Toasts, Dialoge.
// Setzt common.js (CL) voraus.
const UI = (() => {
  const E = (s) => CL.esc(s);
  const ctx = CL.ctx, isMember = ctx.kind === "project" || ctx.kind === "demo";
  const $ = (sel, el = document) => el.querySelector(sel);

  // Schrift nachladen (nur online, sonst Systemschrift). Blockiert nie das Rendern.
  (() => {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap";
    document.head.appendChild(l);
    const f = document.createElement("link"); f.rel = "icon"; f.href = "/favicon.svg"; document.head.appendChild(f);
  })();

  function toast(msg, bad) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    try { const i = document.createElement("textarea"); i.value = text; document.body.appendChild(i); i.select(); const ok = document.execCommand("copy"); i.remove(); return ok; } catch (_) { return false; }
  }
  function modal({ title, html, actions = [] }) {
    const bg = document.createElement("div"); bg.className = "modalbg";
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${E(title)}</h2><div class="mbody">${html}</div><div class="row2" style="margin-top:16px;justify-content:flex-end"></div></div>`;
    const bar = $(".row2", bg);
    const close = () => bg.remove();
    for (const a of actions) { const b = document.createElement("button"); b.className = "btn " + (a.cls || ""); b.textContent = a.label; b.onclick = () => a.onClick?.(close, bg) ?? close(); bar.appendChild(b); }
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    return { close, el: bg };
  }

  // Freigabe-Link für eine Ansicht erzeugen und kopieren
  async function share(view, params = {}, label = "") {
    try {
      const r = await CL.admin({ type: "shareCreate", view, params, label });
      const ok = await copy(r.share.url);
      if (ok) toast("Link kopiert. Jeder mit dem Link kann diese Ansicht sehen.");
      else modal({ title: "Freigabe-Link", html: `<input readonly value="${E(r.share.url)}" onfocus="this.select()" autofocus><p class="hint">Link markieren und kopieren. Jeder mit dem Link kann diese Ansicht sehen.</p>`, actions: [{ label: "Schließen", cls: "primary" }] });
      return r.share;
    } catch (e) { if (e.message !== "abgebrochen") toast(e.message, true); }
  }

  const SCREENS = [
    ["timer", "Timer", "Großer Countdown"], ["stage", "Bühne", "Timer, Titel, Nachrichten"], ["backstage", "Backstage", "Ablauf mit Uhrzeiten"],
    ["timeline", "Timeline", "Balken, Gewerke-Spuren"], ["public", "Publikum", "Programm ohne Timer"], ["clock", "Uhr", "Uhrzeit der Show"],
    ["lower", "Bauchbinde", "Transparent / Keying für OBS, vMix"], ["print", "Druck", "Ablauf als PDF"],
  ];
  const href = (view, params) => `${ctx.base}/${view}${params ? "?" + new URLSearchParams(params) : ""}`;

  function pop(anchor, html, { align = "left", width } = {}) {
    document.querySelectorAll(".pop").forEach((p) => p.remove());
    const p = document.createElement("div"); p.className = "pop"; p.innerHTML = html;
    const r = anchor.getBoundingClientRect();
    p.style.top = r.bottom + 8 + window.scrollY + "px";
    if (width) p.style.minWidth = width + "px";
    document.body.appendChild(p);
    const w = p.offsetWidth;
    p.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, align === "right" ? r.right - w : r.left)) + "px";
    setTimeout(() => document.addEventListener("mousedown", function h(e) { if (!p.contains(e.target) && !anchor.contains(e.target)) { p.remove(); document.removeEventListener("mousedown", h); } }), 0);
    return p;
  }

  function screensMenu(anchor) {
    const s = CL.state, gw = s ? s.gewerke : [];
    const row = (view, name, sub, params, chip) => `<div class="it" data-view="${view}" data-params='${E(JSON.stringify(params || {}))}'>
      ${chip ? `<span class="chip" style="--c:${E(chip.color)}" translate="no">${E(chip.short)}</span>` : ""}<span class="nm"><span${chip ? ' translate="no"' : ""}>${E(name)}</span><div class="hint">${E(sub)}</div></span>
      <span class="acts"><a class="btn sm" href="${href(view, params)}" target="_blank" title="Öffnen">↗</a><button class="sm" data-act="copy" title="Freigabe-Link kopieren">Link</button></span></div>`;
    const p = pop(anchor, `<h4>Screens</h4>${SCREENS.map(([v, n, d]) => row(v, n, d)).join("")}<hr><h4>Gewerke</h4>${gw.map((g) => row("gewerk", g.name, "Cues und Bereit-Taste", { g: g.id }, g)).join("") || '<div class="it hint">Noch keine Gewerke</div>'}
      <hr><div class="it hint">„Link“ erzeugt einen Freigabe-Link ohne Login. In den Projekteinstellungen lassen sich Links widerrufen.</div>`, { align: "right", width: 340 });
    p.addEventListener("click", (e) => { const b = e.target.closest('[data-act="copy"]'); if (!b) return; const it = b.closest(".it"); share(it.dataset.view, JSON.parse(it.dataset.params)); });
  }

  function userMenu(anchor, me) {
    const p = pop(anchor, `<div class="it"><span class="nm"><b translate="no">${E(me.name)}</b><div class="hint" translate="no">${me.email ? E(me.email) : ""}</div>${me.email ? "" : "<div class=\"hint\">Lokaler Modus</div>"}</span></div><hr>
      <div class="it"><span class="nm hint">Sprache</span><select id="uiLang" style="width:auto"></select></div>
      <a class="it" href="/app">Alle Projekte</a>${me.local ? "" : '<button class="it ghost" id="uiLogout" style="width:100%;justify-content:flex-start">Abmelden</button>'}`, { align: "right", width: 240 });
    I18N.mountSelect($("#uiLang", p));
    $("#uiLogout", p)?.addEventListener("click", async () => { await fetch("/api/logout", { method: "POST", headers: { "x-cl": "1" } }); location.href = "/"; });
  }

  // App-Leiste für Projektseiten. active = aktuelle Seite.
  async function bar(active) {
    const host = document.getElementById("appbar");
    if (!host || !isMember) return;
    CL.connect(); // Zustand für das Screens-Menü (Gewerke)
    let meta = { name: "Demo", role: "admin", user: { name: "Demo", email: "", local: true } };
    try { if (ctx.kind === "project") meta = await (await fetch(ctx.api + "/meta")).json(); } catch (_) {}
    if (meta.error) { location.href = "/app"; return; }
    document.title = `${meta.name} · ${I18N.t(document.title.split("·").pop().trim())} · Tallycall`;
    const tabs = [["", "Regie", "regie"], ["editor", "Planung", "editor"], ["timeline", "Timeline", "timeline"], ["grafik", "Bauchbinden", "grafik"], ["gewerk", "Gewerke", "gewerk"], ["integrations", "Trigger", "integrations"]];
    host.className = "appbar";
    host.innerHTML = `<a class="brand" href="/app" title="Alle Projekte"><img src="/logo.svg" alt="">Tallycall</a><span class="sep">/</span>
      <span class="proj"><b translate="no">${E(meta.name)}</b>${meta.role === "admin" ? "" : '<span class="badge">Editor</span>'}</span>
      <nav class="tabs" aria-label="Bereiche">${tabs.map(([p, n, k]) => `<a href="${ctx.base}/${p}" ${k === active ? 'aria-current="page"' : ""}>${n}</a>`).join("")}</nav><span class="sp"></span>
      <span id="draftChip" class="draftchip" hidden>Entwurf offen</span>
      <button class="btn sm" id="uiScreens">Screens teilen</button>
      ${meta.role === "admin" ? `<a class="btn sm ghost" href="${ctx.base}/settings" title="Projekteinstellungen" ${active === "settings" ? 'aria-current="page"' : ""}>Einstellungen</a>` : ""}
      <span class="dot on" id="dot"></span>
      <button class="avatar" id="uiUser" translate="no" title="${E(meta.user.name)}">${E((meta.user.name || "?").trim().slice(0, 1).toUpperCase())}</button>`;
    CL.onStatus((ok) => $("#dot", host).classList.toggle("on", ok));
    $("#uiScreens", host).onclick = (e) => screensMenu(e.currentTarget);
    $("#uiUser", host).onclick = (e) => userMenu(e.currentTarget, meta.user);
    return meta;
  }

  // Schwebende Leiste auf Vollbild-Ansichten (nur für Mitglieder), blendet bei Ruhe aus
  function floating(view, params) {
    if (!isMember || ctx.kind !== "project" || CL.params.get("clean") === "1") return;
    const f = document.createElement("div"); f.className = "floatbar idle";
    f.innerHTML = `<a class="btn sm ghost" href="${ctx.base}/">← Regie</a><button class="btn sm" id="fbShare">Teilen</button><button class="btn sm ghost" id="fbMenu">Screens</button>`;
    document.body.appendChild(f);
    let t; const wake = () => { f.classList.remove("idle"); clearTimeout(t); t = setTimeout(() => f.classList.add("idle"), 3000); };
    document.addEventListener("mousemove", wake); document.addEventListener("touchstart", wake);
    $("#fbShare", f).onclick = () => share(view, params || Object.fromEntries(["g", "day", "mode"].filter((k) => CL.params.get(k)).map((k) => [k, CL.params.get(k)])));
    $("#fbMenu", f).onclick = (e) => screensMenu(e.currentTarget);
  }

  // Farbwahl aus der Palette plus freie Farbe. onPick(hex) bei Auswahl.
  function palette(cur, onPick, { el } = {}) {
    const host = el || document.createElement("div"); host.className = "pal";
    host.innerHTML = CLS.PALETTE.map(([c, n]) => `<button type="button" title="${E(n)}" style="--c:${c}" data-c="${c}" aria-pressed="${String(c).toLowerCase() === String(cur || "").toLowerCase()}"></button>`).join("") + `<input type="color" value="${E(cur || "#7c9cff")}" title="${E(I18N.t("Eigene Farbe"))}">`;
    host.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) onPick(b.dataset.c); };
    host.querySelector("input").onchange = (e) => onPick(e.target.value);
    return host;
  }
  // Hinweis bei Lizenzgrenzen (Antwort 402 vom Server)
  document.addEventListener("cl-upgrade", async (e) => {
    let link = ""; try { link = (await (await fetch("/api/config")).json()).payLink || ""; } catch (_) {}
    modal({ title: "Pro-Plan nötig", html: `<p>${E(e.detail || "")}</p><p class="hint">${link ? "" : "Dieser Server hat noch keine Bezahlung eingerichtet. Bitte den Betreiber kontaktieren."}</p>`, actions: [{ label: "Schließen" }, ...(link ? [{ label: "Auf Pro wechseln", cls: "primary", onClick: () => window.open(link, "_blank") }] : [])] });
  });
  // Einfache Reiter innerhalb einer Karte: host enthält .ptabs-Knöpfe mit data-tab und Bereiche mit data-pane
  function tabs(host, key) {
    const btns = [...host.querySelectorAll(".ptabs [data-tab]")], panes = [...host.querySelectorAll("[data-pane]")];
    const show = (id) => { btns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.tab === id)); panes.forEach((p) => (p.hidden = p.dataset.pane !== id)); try { localStorage.setItem("tab:" + key, id); } catch (_) {} };
    btns.forEach((b) => (b.onclick = () => show(b.dataset.tab)));
    let init = null; try { init = localStorage.getItem("tab:" + key); } catch (_) {}
    show(btns.some((b) => b.dataset.tab === init) ? init : btns[0]?.dataset.tab);
    return show;
  }
  return { toast, copy, modal, share, bar, floating, pop, screensMenu, href, palette, tabs };
})();
