// Mehrsprachigkeit: Die deutschen Texte sind der Schlüssel. Übersetzt wird im Browser, auch dynamisch erzeugter Inhalt.
// - exakte Treffer ("Weiter") und Muster mit Platzhaltern ("Punkt „{t}“ bearbeitet")
// - Bereiche mit translate="no" (Nutzerdaten wie Titel oder Namen) bleiben unangetastet
// - t("Schlüssel", {param}) für Texte, die nicht im DOM landen (confirm, document.title)
const I18N = (() => {
  const LANGS = [
    { id: "de", name: "Deutsch", locale: "de-DE" }, { id: "en", name: "English", locale: "en-GB" }, { id: "es", name: "Español", locale: "es-ES" },
    { id: "fr", name: "Français", locale: "fr-FR" }, { id: "it", name: "Italiano", locale: "it-IT" }, { id: "pt", name: "Português", locale: "pt-PT" },
    { id: "zh", name: "中文", locale: "zh-CN" }, { id: "ja", name: "日本語", locale: "ja-JP" },
  ];
  const ids = LANGS.map((l) => l.id);
  const dicts = (window.I18N_DICTS = window.I18N_DICTS || {}); // lang -> { deutscher Schlüssel: Übersetzung }
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };

  function detect() {
    const q = new URLSearchParams(window.CL_SEARCH || "").get("lang"), q2 = new URLSearchParams(location.search).get("lang");
    if (q2 && ids.includes(q2)) { store.set("cl_lang", q2); return q2; } // ausdrücklich in der Adresse gewählt: merken
    for (const c of [q, store.get("cl_lang")]) if (c && ids.includes(c)) return c;
    for (const l of navigator.languages || [navigator.language || "en"]) { const p = String(l).toLowerCase().slice(0, 2); if (ids.includes(p)) return p; }
    return "en";
  }
  const lang = window.I18N_FORCE || detect();
  const locale = LANGS.find((l) => l.id === lang).locale;
  document.documentElement.lang = lang;

  // Wörterbuch der Sprache vor allem anderen laden (blockierend), außer Deutsch (Quellsprache)
  if (lang !== "de" && !dicts[lang] && document.readyState === "loading") document.write(`<script src="/lang/${lang}.js"><\/script>`);
  const add = (l, d) => { dicts[l] = Object.assign(dicts[l] || {}, d); patterns = null; };

  // Muster aus Schlüsseln mit {platzhalter}: längere feste Anteile zuerst
  let patterns = null;
  function build() {
    const d = dicts[lang] || {};
    patterns = Object.keys(d).filter((k) => /\{\w+\}/.test(k)).map((k) => {
      const names = []; const src = k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return "(.+?)"; });
      return { re: new RegExp("^" + src + "$", "s"), names, to: d[k], weight: k.replace(/\{\w+\}/g, "").length };
    }).sort((a, b) => b.weight - a.weight);
  }
  const fill = (s, p) => s.replace(/\{(\w+)\}/g, (m, n) => (p && n in p ? p[n] : m));
  const lookupInner = (v) => { const r = /^[\d\s:.,+\-–−×/%·()#]+$/.test(v) ? null : lookup(v); return r == null ? v : r; }; // erfasste Teile ihrerseits übersetzen
  function lookup(s) {
    if (lang === "de") return null;
    const d = dicts[lang]; if (!d) return null;
    if (Object.prototype.hasOwnProperty.call(d, s)) return d[s];
    if (!patterns) build();
    for (const p of patterns) { const m = p.re.exec(s); if (m) return fill(p.to, Object.fromEntries(p.names.map((n, i) => [n, lookupInner(m[i + 1])]))); }
    return null;
  }
  // Für Texte außerhalb des DOM: t("Punkt „{t}“ löschen?", { t: titel })
  function t(key, params) { const tr = lang === "de" ? null : dicts[lang]?.[key]; return fill(tr ?? key, params); }

  // ---- DOM ----
  const ATTRS = ["placeholder", "title", "aria-label", "alt"], NUM = /^[\d\s:.,+\-–−×/%·()#]+$/;
  const done = new WeakMap(), seen = new Set(); // Knoten -> zuletzt gesetzter Text; für den Bericht: unübersetzte Texte
  const skipEl = (el) => !el || el.closest?.('[translate="no"],script,style,textarea');
  function text(node) {
    const raw = node.nodeValue; if (done.get(node) === raw) return;
    const s = raw.trim(); if (!s || NUM.test(s) || skipEl(node.parentElement)) return;
    const tr = lookup(s);
    if (tr == null) { if (lang !== "de") seen.add(s); return; }
    const out = raw.replace(s, tr); if (out !== raw) node.nodeValue = out; done.set(node, out);
  }
  function attrs(el) {
    if (el.nodeName === "META" && el.getAttribute("name") === "description") { const tr = lookup(el.content.trim()); if (tr != null) el.content = tr; return; }
    if (skipEl(el)) return;
    for (const a of ATTRS) { const v = el.getAttribute?.(a); if (!v || NUM.test(v)) continue; const key = "__i" + a; if (el[key] === v) continue; const tr = lookup(v.trim()); if (tr != null) { el.setAttribute(a, tr); el[key] = tr; } else if (lang !== "de") seen.add(v.trim()); }
  }
  function walk(n) {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(n.nodeName)) return;
    if (n.getAttribute("translate") === "no") return;
    attrs(n); for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  function apply(root = document.documentElement) { if (lang === "de") return; walk(root); }
  let mo = null;
  function start() {
    if (lang === "de" || mo) return;
    apply();
    mo = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === "childList") r.addedNodes.forEach(walk);
        else if (r.type === "characterData") text(r.target);
        else if (r.type === "attributes") attrs(r.target);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // Seite erstmal einmal übersetzen, sobald das Wörterbuch da ist, danach beobachten
  if (lang !== "de") { document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start(); }

  // ---- Sprachwahl ----
  function set(id) { if (!ids.includes(id)) return; store.set("cl_lang", id); const u = new URL(location.href); u.searchParams.delete("lang"); location.href = u.pathname === "srcdoc" ? location.href : u.toString(); }
  function mountSelect(sel) {
    if (!sel) return;
    sel.setAttribute("translate", "no");
    sel.innerHTML = LANGS.map((l) => `<option value="${l.id}"${l.id === lang ? " selected" : ""}>${l.name}</option>`).join("");
    sel.onchange = () => I18N.set(sel.value); // über das Objekt, damit eingebettete Umgebungen es ersetzen können
  }
  // Auf der Webseite: Auswahl automatisch füllen, falls vorhanden
  document.addEventListener("DOMContentLoaded", () => mountSelect(document.getElementById("langSel")));
  if (document.readyState !== "loading") mountSelect(document.getElementById("langSel"));

  return { LANGS, lang, locale, add, t, apply, set, mountSelect, missing: () => [...seen].sort(), lookup, dicts };
})();

