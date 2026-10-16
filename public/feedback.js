// Feedback-Fenster unten links: Fehler, Ideen und Fragen gehen direkt an den Admin.
(() => {
  if (window.__tcFb) return; window.__tcFb = true;
  const t = (k, p) => (typeof I18N !== "undefined" ? I18N.t(k, p) : k), E = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  fetch("/api/config").then((r) => r.json()).then((c) => { if (c && c.auth) mount(c); }).catch(() => {});
  function mount() {
    const css = document.createElement("style");
    css.textContent = `
.tcfb{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:60;font-family:inherit}
.tcfb-btn{display:flex;align-items:center;gap:8px;height:44px;padding:0 16px 0 14px;background:#f2f3f5;color:#0a0a0a;border:0;font:700 14px/1 inherit;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.45);letter-spacing:-.01em}
.tcfb-btn i{width:10px;height:10px;background:#ff1f1f;display:block}
.tcfb-btn:hover{background:#fff}
.tcfb-pop{position:absolute;left:0;bottom:56px;width:min(340px,calc(100vw - 32px));background:#101216;color:#e9ebef;border:1px solid #2a2d34;box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;transform-origin:left bottom;animation:tcfbpop .22s cubic-bezier(.16,1,.3,1)}
@keyframes tcfbpop{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
.tcfb-pop[hidden]{display:none}
.tcfb-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#0a0a0a;border-bottom:1px solid #2a2d34;font-weight:700;font-size:14px}
.tcfb-head button{background:none;border:0;color:#9aa0ac;font-size:20px;line-height:1;cursor:pointer;padding:0 4px}
.tcfb-log{padding:14px;display:flex;flex-direction:column;gap:10px;max-height:240px;overflow:auto;font-size:13.5px;line-height:1.45}
.tcfb-b{padding:10px 12px;max-width:86%;white-space:pre-wrap;word-break:break-word}
.tcfb-b.in{background:#1a1d24;align-self:flex-start;border-left:3px solid #ff1f1f}
.tcfb-b.out{background:#262a33;align-self:flex-end}
.tcfb-form{padding:0 14px 14px;display:grid;gap:8px}
.tcfb-types{display:flex;gap:6px}
.tcfb-types button{flex:1;padding:7px 4px;background:#14171c;border:1px solid #2a2d34;color:#c9ccd3;font:600 12.5px inherit;cursor:pointer}
.tcfb-types button[aria-pressed="true"]{background:#fff;color:#0a0a0a;border-color:#fff}
.tcfb-form textarea,.tcfb-form input{width:100%;box-sizing:border-box;background:#0b0d10;color:#fff;border:1px solid #2a2d34;padding:9px 10px;font:14px inherit;resize:vertical}
.tcfb-form textarea{min-height:84px}
.tcfb-send{background:#ff1f1f;color:#fff;border:0;padding:11px;font:700 14px inherit;cursor:pointer}
.tcfb-send:disabled{opacity:.5;cursor:default}
@media print{.tcfb{display:none}}`;
    document.head.appendChild(css);
    const box = document.createElement("div"); box.className = "tcfb";
    let type = "bug", sent = [];
    try { sent = JSON.parse(sessionStorage.getItem("tcfb") || "[]"); } catch (_) {}
    box.innerHTML = `<div class="tcfb-pop" hidden role="dialog" aria-label="${E(t("Feedback"))}"><div class="tcfb-head"><span>${E(t("Feedback"))}</span><button type="button" data-x aria-label="${E(t("Schließen"))}">×</button></div>
      <div class="tcfb-log" data-log></div>
      <form class="tcfb-form" novalidate><div class="tcfb-types"><button type="button" data-t="bug" aria-pressed="true">${E(t("Fehler"))}</button><button type="button" data-t="idea" aria-pressed="false">${E(t("Idee"))}</button><button type="button" data-t="other" aria-pressed="false">${E(t("Sonstiges"))}</button></div>
      <textarea name="text" maxlength="2000" placeholder="${E(t("Was ist passiert oder was wünschst du dir?"))}" required></textarea>
      <input name="email" type="email" maxlength="120" placeholder="${E(t("E-Mail für Rückfragen (optional)"))}" autocomplete="email" hidden>
      <button class="tcfb-send" type="submit">${E(t("Senden"))}</button></form></div>
      <button type="button" class="tcfb-btn" data-open><i></i>${E(t("Feedback"))}</button>`;
    document.body.appendChild(box);
    const pop = box.querySelector(".tcfb-pop"), log = box.querySelector("[data-log]"), form = box.querySelector("form"), mail = form.email;
    const bubble = (txt, cls) => { const d = document.createElement("div"); d.className = "tcfb-b " + cls; d.textContent = txt; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    const greet = () => { log.innerHTML = ""; bubble(t("Hallo! Hast du einen Fehler gefunden, eine Idee oder eine Frage? Schreib sie hier rein. Wir lesen jede Nachricht."), "in"); sent.forEach((m) => { bubble(m, "out"); }); if (sent.length) bubble(t("Danke! Das ist angekommen."), "in"); };
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j || !j.user) mail.hidden = false; }).catch(() => { mail.hidden = false; });
    const open = (on) => { pop.hidden = !on; if (on) { greet(); setTimeout(() => form.text.focus(), 50); } };
    box.querySelector("[data-open]").onclick = () => open(pop.hidden);
    box.querySelector("[data-x]").onclick = () => open(false);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) open(false); });
    box.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { type = b.dataset.t; box.querySelectorAll("[data-t]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const text = form.text.value.trim(); if (!text) { form.text.focus(); return; }
      const btn = form.querySelector(".tcfb-send"); btn.disabled = true;
      try {
        const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json", "x-cl": "1" }, body: JSON.stringify({ type, text, email: mail.hidden ? "" : mail.value, page: location.pathname + location.search.replace(/token=[^&]*/g, ""), lang: typeof I18N !== "undefined" ? I18N.lang : "", screen: `${innerWidth}x${innerHeight}` }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Das hat nicht geklappt");
        sent.push(text.length > 140 ? text.slice(0, 140) + "…" : text); try { sessionStorage.setItem("tcfb", JSON.stringify(sent.slice(-5))); } catch (_) {}
        form.text.value = ""; greet();
      } catch (err) { bubble(t(err.message), "in"); }
      btn.disabled = false;
    });
    if (typeof I18N !== "undefined" && I18N.apply) I18N.apply(box);
  }
})();
