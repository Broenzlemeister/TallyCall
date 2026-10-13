// Bauchbinden-Renderer (Canvas). Live-Ansicht, Vorschau und 4K-Export nutzen denselben Code, damit alles gleich aussieht.
const LT = (() => {
  const STYLES = [
    { id: "balken", name: "Balken" }, { id: "glas", name: "Glas" }, { id: "linie", name: "Linie" },
    { id: "karte", name: "Karte" }, { id: "block", name: "Block" }, { id: "streifen", name: "Streifen" },
  ];
  const KEYS = [
    { id: "none", name: "Transparent" }, { id: "#00ff00", name: "Grün" }, { id: "#0000ff", name: "Blau" },
    { id: "#ff00ff", name: "Magenta" }, { id: "#000000", name: "Schwarz" },
  ];
  const FONT = '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const lerp = (a, b, t) => a + (b - a) * t;

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  let fam = FONT; // aktuelle Schriftfamilie (freie Designs wechseln sie pro Zeichnung)
  const font = (c, wt, px) => { c.font = `${wt} ${px}px ${fam}`; };
  // Textgröße so verkleinern, dass der Text in maxW passt
  function fit(c, text, wt, px, maxW) { font(c, wt, px); const w = c.measureText(text).width; return w > maxW ? px * maxW / w : px; }
  const tw = (c, text, wt, px) => { font(c, wt, px); return c.measureText(text).width; };

  // x-Position und senkrechter Versatz je nach Position und Animationsfortschritt e
  function place(W, u, w, pos, e) {
    const m = 96 * u;
    if (pos === "right") return { x: lerp(W, W - m - w, e), yoff: 0 };
    if (pos === "center") return { x: (W - w) / 2, yoff: (1 - e) * 140 * u };
    return { x: lerp(-w, m, e), yoff: 0 };
  }
  // Gemeinsame Messung: Titel und Untertitel auf verfügbare Breite anpassen
  function measure(c, u, W, d, tPx, sPx, tWt = 600, sWt = 400, pad = 0) {
    const maxW = W - 2 * 96 * u - pad;
    const t = d.title ? fit(c, d.title, tWt, tPx * u, maxW) : 0, s = d.sub ? fit(c, d.sub, sWt, sPx * u, maxW) : 0;
    return { t, s, tw: d.title ? tw(c, d.title, tWt, t) : 0, sw: d.sub ? tw(c, d.sub, sWt, s) : 0 };
  }

  const FN = {
    balken(c, W, H, u, d) {
      const padX = 38 * u, padY = 24 * u, gap = 8 * u, bar = 14 * u, m = measure(c, u, W, d, 54, 30, 600, 400, padX * 2 + bar);
      const w = Math.max(m.tw, m.sw) + padX * 2 + bar, h = padY * 2 + m.t + (m.s ? gap + m.s : 0);
      const { x, yoff } = place(W, u, w, d.pos, d.e), y = H - 110 * u - h + yoff;
      c.fillStyle = "rgba(10,12,16,.94)"; c.fillRect(x, y, w, h);
      c.fillStyle = d.accent; c.fillRect(x, y, bar, h);
      c.textBaseline = "alphabetic"; c.textAlign = "left"; c.fillStyle = "#fff"; font(c, 600, m.t);
      c.fillText(d.title, x + bar + padX, y + padY + m.t * 0.82);
      if (m.s) { c.fillStyle = "rgba(255,255,255,.72)"; font(c, 400, m.s); c.fillText(d.sub, x + bar + padX, y + padY + m.t + gap + m.s * 0.82); }
    },
    glas(c, W, H, u, d) {
      const padX = 40 * u, padY = 26 * u, gap = 8 * u, m = measure(c, u, W, d, 52, 29, 600, 400, padX * 2 + 30 * u);
      const w = Math.max(m.tw, m.sw) + padX * 2 + 30 * u, h = padY * 2 + m.t + (m.s ? gap + m.s : 0);
      const { x, yoff } = place(W, u, w, d.pos, d.e), y = H - 110 * u - h + yoff;
      c.save(); c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 40 * u; c.shadowOffsetY = 12 * u;
      rr(c, x, y, w, h, 22 * u); c.fillStyle = "rgba(16,20,28,.68)"; c.fill(); c.restore();
      const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "rgba(255,255,255,.14)"); g.addColorStop(.5, "rgba(255,255,255,0)");
      rr(c, x, y, w, h, 22 * u); c.fillStyle = g; c.fill();
      c.lineWidth = 1.6 * u; c.strokeStyle = "rgba(255,255,255,.24)"; rr(c, x + .8 * u, y + .8 * u, w - 1.6 * u, h - 1.6 * u, 22 * u); c.stroke();
      c.fillStyle = d.accent; c.beginPath(); c.arc(x + padX + 6 * u, y + padY + m.t * 0.5, 7 * u, 0, 7); c.fill();
      c.textAlign = "left"; c.fillStyle = "#fff"; font(c, 600, m.t); c.fillText(d.title, x + padX + 30 * u, y + padY + m.t * 0.82);
      if (m.s) { c.fillStyle = "rgba(255,255,255,.74)"; font(c, 400, m.s); c.fillText(d.sub, x + padX + 30 * u, y + padY + m.t + gap + m.s * 0.82); }
    },
    linie(c, W, H, u, d) {
      const gap = 10 * u, m = measure(c, u, W, d, 60, 32, 600, 400), w = Math.max(m.tw, m.sw, 260 * u), h = 24 * u + m.t + (m.s ? gap + m.s : 0);
      const { x, yoff } = place(W, u, w, d.pos, d.e), y = H - 110 * u - h + yoff;
      c.save(); c.shadowColor = "rgba(0,0,0,.75)"; c.shadowBlur = 18 * u; c.shadowOffsetY = 3 * u;
      c.fillStyle = d.accent; c.fillRect(x, y, w * d.e, 6 * u);
      c.textAlign = "left"; c.fillStyle = "#fff"; font(c, 600, m.t); c.fillText(d.title, x, y + 24 * u + m.t * 0.82);
      if (m.s) { c.fillStyle = "rgba(255,255,255,.86)"; font(c, 400, m.s); c.fillText(d.sub, x, y + 24 * u + m.t + gap + m.s * 0.82); }
      c.restore();
    },
    karte(c, W, H, u, d) {
      const padX = 36 * u, padY = 24 * u, gap = 6 * u, tab = 18 * u, m = measure(c, u, W, d, 50, 28, 650, 400, padX * 2 + tab);
      const w = Math.max(m.tw, m.sw) + padX * 2 + tab, h = padY * 2 + m.t + (m.s ? gap + m.s : 0);
      const { x, yoff } = place(W, u, w, d.pos, d.e), y = H - 110 * u - h + yoff;
      c.save(); c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 44 * u; c.shadowOffsetY = 16 * u; rr(c, x, y, w, h, 16 * u); c.fillStyle = "#f5f6f8"; c.fill(); c.restore();
      c.save(); rr(c, x, y, w, h, 16 * u); c.clip(); c.fillStyle = d.accent; c.fillRect(x, y, tab, h); c.restore();
      c.textAlign = "left"; c.fillStyle = "#0b0d11"; font(c, 650, m.t); c.fillText(d.title, x + tab + padX, y + padY + m.t * 0.82);
      if (m.s) { c.fillStyle = "#555b69"; font(c, 400, m.s); c.fillText(d.sub, x + tab + padX, y + padY + m.t + gap + m.s * 0.82); }
    },
    block(c, W, H, u, d) {
      const skew = 26 * u, padX = 40 * u, m = measure(c, u, W, d, 58, 30, 700, 500, padX * 2 + skew * 2);
      const w1 = m.tw + padX * 2 + skew, h1 = 22 * u * 2 + m.t, w2 = m.sw + padX * 2 + skew, h2 = m.s ? 14 * u * 2 + m.s : 0, w = Math.max(w1, w2 + 30 * u);
      const { x, yoff } = place(W, u, w, d.pos, d.e), y = H - 110 * u - h1 - h2 + yoff;
      c.fillStyle = d.accent; c.beginPath(); c.moveTo(x + skew, y); c.lineTo(x + w1, y); c.lineTo(x + w1 - skew, y + h1); c.lineTo(x, y + h1); c.closePath(); c.fill();
      c.textAlign = "left"; c.fillStyle = lum(d.accent) > 0.6 ? "#0b0d11" : "#fff"; font(c, 700, m.t); c.fillText(d.title, x + skew + padX * 0.6, y + 22 * u + m.t * 0.82);
      if (m.s) {
        const x2 = x + 30 * u;
        c.fillStyle = "rgba(10,12,16,.95)"; c.beginPath(); c.moveTo(x2 + skew, y + h1); c.lineTo(x2 + w2, y + h1); c.lineTo(x2 + w2 - skew, y + h1 + h2); c.lineTo(x2, y + h1 + h2); c.closePath(); c.fill();
        c.fillStyle = "#fff"; font(c, 500, m.s); c.fillText(d.sub, x2 + skew + padX * 0.6, y + h1 + 14 * u + m.s * 0.82);
      }
    },
    streifen(c, W, H, u, d) {
      const m = measure(c, u, W, d, 56, 30, 600, 400), gap = 8 * u, h = 30 * u * 2 + m.t + (m.s ? gap + m.s : 0);
      const y = H - 90 * u - h + (1 - d.e) * (h + 110 * u);
      c.fillStyle = "rgba(8,10,14,.95)"; c.fillRect(0, y, W, h); c.fillStyle = d.accent; c.fillRect(0, y, W, 6 * u);
      const align = d.pos === "center" ? "center" : d.pos === "right" ? "right" : "left", x = d.pos === "center" ? W / 2 : d.pos === "right" ? W - 96 * u : 96 * u;
      c.textAlign = align; c.fillStyle = "#fff"; font(c, 600, m.t); c.fillText(d.title, x, y + 30 * u + m.t * 0.82);
      if (m.s) { c.fillStyle = "rgba(255,255,255,.74)"; font(c, 400, m.s); c.fillText(d.sub, x, y + 30 * u + m.t + gap + m.s * 0.82); }
    },
  };

  // ---- Freies Design (Editor) ----
  const FAMS = {
    sans: FONT,
    serif: '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    condensed: FONT,
    rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Hiragino Maru Gothic ProN", system-ui, sans-serif',
  };
  const imgs = new Map(), imgSubs = new Set();
  function img(src) {
    if (!src) return null;
    let i = imgs.get(src);
    if (!i) { i = new Image(); i.onload = () => imgSubs.forEach((f) => f()); i.src = src; imgs.set(src, i); }
    return i.complete && i.naturalWidth ? i : null;
  }
  const onImage = (f) => imgSubs.add(f);
  const preload = (src) => new Promise((r) => { if (!src) return r(); const i = new Image(); i.onload = i.onerror = () => { imgs.set(src, i); r(); }; i.src = src; });
  function boxPath(c, x, y, w, h, skew, r) {
    if (skew > 0) { c.beginPath(); c.moveTo(x + skew, y); c.lineTo(x + w, y); c.lineTo(x + w - skew, y + h); c.lineTo(x, y + h); c.closePath(); }
    else rr(c, x, y, w, h, r);
  }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

  function drawFree(c, W, H, u, o, e) {
    const d = CLS.cleanDesign(o.design), pos = o.pos || "left", accent = d.accent;
    fam = FAMS[d.font] || FONT;
    const tx = (t) => (d.upper ? t.toUpperCase() : t), title = tx(o.title), sub = tx(o.sub);
    const sk = d.skew * u, padX = d.padX * u, padY = d.padY * u, gap = d.gap * u;
    const barW = d.accentMode === "left" ? d.accentSize * u : 0, barH = d.accentMode === "top" || d.accentMode === "bottom" ? Math.max(2, d.accentSize * u * 0.45) : 0;
    const dotW = d.accentMode === "dot" ? d.accentSize * u * 0.9 + padX * 0.45 : 0;
    const im = img(d.logo), lh = d.logo ? d.logoSize * u : 0, lw = im ? lh * Math.min(2.5, im.naturalWidth / im.naturalHeight) : d.logo ? lh : 0, lgap = lw ? padX * 0.6 : 0;
    c.fontStretch = d.font === "condensed" ? "condensed" : "normal";
    c.letterSpacing = `${d.track * u}px`;
    const maxBox = Math.max(200 * u, W * d.maxW), avail = Math.max(60 * u, maxBox - padX * 2 - barW - dotW - lw - lgap - sk);
    const t = title ? fit(c, title, d.titleWeight, d.titleSize * u, avail) : 0, s = sub ? fit(c, sub, d.subWeight, d.subSize * u, avail) : 0;
    const tW = title ? tw(c, title, d.titleWeight, t) : 0, sW = sub ? tw(c, sub, d.subWeight, s) : 0, txtW = Math.max(tW, sW), txtH = t + (s ? (t ? gap : 0) + s : 0);
    let w = txtW + padX * 2 + barW + dotW + lw + lgap + sk, h = Math.max(txtH + padY * 2, lh ? lh + padY : 0) + barH;
    w = Math.max(w, d.minW * W); if (d.full) w = W;
    let x = pos === "right" ? W - 96 * u - w : pos === "center" ? (W - w) / 2 : 96 * u;
    let y = H - 110 * u - h;
    if (d.full) x = 0; else x += d.ox * W;
    y += d.oy * H;
    // Animation
    let alpha = Math.min(1, e * 1.6), ox2 = 0, oy2 = 0, scale = 1, clip = 0;
    const A = d.anim;
    if (A === "slide") { alpha = Math.min(1, e * 3); if (pos === "center" || d.full) oy2 = (1 - e) * (h + 110 * u); else ox2 = pos === "right" ? (1 - e) * (W - x) : -(1 - e) * (x + w); }
    else if (A === "rise") oy2 = (1 - e) * 60 * u;
    else if (A === "zoom") scale = 0.86 + 0.14 * e;
    else if (A === "wipe") { alpha = 1; clip = e; }
    else if (A === "none") alpha = 1;
    c.save(); c.globalAlpha *= alpha;
    if (clip) { c.beginPath(); c.rect(pos === "right" ? x + w * (1 - clip) : x, y - 40 * u, w * clip, h + 80 * u); c.clip(); }
    c.translate(x + ox2 + w / 2, y + oy2 + h / 2); c.scale(scale, scale); c.translate(-(x + w / 2), -(y + h / 2));
    // Box
    const hasBg = d.bgAlpha > 0.01 || d.glass;
    if (hasBg || d.border) {
      const ba = d.glass ? Math.min(d.bgAlpha, 0.72) : d.bgAlpha;
      c.save();
      if (d.shadow > 0 && hasBg) { c.shadowColor = `rgba(0,0,0,${d.shadow})`; c.shadowBlur = 40 * u; c.shadowOffsetY = 12 * u; }
      boxPath(c, x, y, w, h, sk, d.radius * u); c.fillStyle = rgba(d.bg, hasBg ? ba : 0); c.fill(); c.restore();
      if (d.glass) { const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "rgba(255,255,255,.16)"); g.addColorStop(.55, "rgba(255,255,255,0)"); boxPath(c, x, y, w, h, sk, d.radius * u); c.fillStyle = g; c.fill(); if (!d.border) { c.lineWidth = 1.6 * u; c.strokeStyle = "rgba(255,255,255,.24)"; boxPath(c, x + .8 * u, y + .8 * u, w - 1.6 * u, h - 1.6 * u, sk, d.radius * u); c.stroke(); } }
      if (d.border) { const b = d.border * u; c.lineWidth = b; c.strokeStyle = d.borderColor; boxPath(c, x + b / 2, y + b / 2, w - b, h - b, sk, d.radius * u); c.stroke(); }
    }
    // Akzent
    c.save(); boxPath(c, x, y, w, h, sk, d.radius * u); c.clip();
    c.fillStyle = accent;
    if (d.accentMode === "left") c.fillRect(x, y, barW + (sk ? sk * 0.5 : 0), h);
    else if (d.accentMode === "top") c.fillRect(x, y, w, barH);
    else if (d.accentMode === "bottom") c.fillRect(x, y + h - barH, w, barH);
    c.restore();
    // Inhalt
    let cx = x + sk * 0.5 + padX * (d.accentMode === "left" ? 0.9 : 1) + barW;
    const cy = y + (d.accentMode === "top" ? barH : 0), ch = h - barH;
    const innerRight = x + w - padX - sk * 0.5;
    if (d.logo && d.logoSide === "left") { drawLogo(c, im, cx, cy + (ch - lh) / 2, lw, lh, d.logoRound); cx += lw + lgap; }
    let rightEdge = innerRight;
    if (d.logo && d.logoSide === "right") { rightEdge -= lw + lgap; drawLogo(c, im, rightEdge + lgap, cy + (ch - lh) / 2, lw, lh, d.logoRound); }
    const ty = cy + (ch - txtH) / 2;
    if (dotW) { c.fillStyle = accent; c.beginPath(); c.arc(cx + d.accentSize * u * 0.45, ty + t * 0.5, d.accentSize * u * 0.45, 0, 7); c.fill(); cx += dotW; }
    const areaL = cx, areaR = rightEdge;
    const ax = d.align === "center" ? (areaL + areaR) / 2 : d.align === "right" ? areaR : areaL;
    c.textAlign = d.align; c.textBaseline = "alphabetic";
    if (d.textShadow) { c.shadowColor = "rgba(0,0,0,.75)"; c.shadowBlur = 18 * u; c.shadowOffsetY = 3 * u; }
    if (title) { c.fillStyle = d.titleColor; font(c, d.titleWeight, t); c.fillText(title, ax, ty + t * 0.82); }
    if (sub) { c.fillStyle = d.subColor; font(c, d.subWeight, s); c.fillText(sub, ax, ty + (title ? t + gap : 0) + s * 0.82); }
    c.restore();
    c.letterSpacing = "0px"; c.fontStretch = "normal"; fam = FONT;
  }
  function drawLogo(c, im, x, y, w, h, round) {
    c.save();
    if (round) { c.beginPath(); c.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, 7); c.clip(); }
    if (im) { const k = Math.min(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k; c.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
    else { c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(x, y, w, h); }
    c.restore();
  }

  // Fertige Vorlagen für den Editor (Teilmengen von CLS.DESIGN)
  const PRESETS = [
    { id: "tally", name: "Tally", p: { bg: "#0a0a0a", bgAlpha: 1, accent: "#ff1f1f", accentMode: "left", accentSize: 12, upper: true, track: 2, titleWeight: 700, subWeight: 500, subColor: "#c9c9c9", titleSize: 50, subSize: 26, font: "condensed", shadow: 0.3 } },
    { id: "weiss", name: "Weiß eckig", p: { bg: "#ffffff", bgAlpha: 1, titleColor: "#0a0a0a", subColor: "#555555", accent: "#ff1f1f", accentMode: "bottom", accentSize: 14, titleWeight: 700, upper: true, track: 1, font: "condensed", shadow: 0.35 } },
    { id: "balken", name: "Balken", p: { bg: "#0a0c10", bgAlpha: 0.94, accentMode: "left", accentSize: 14, shadow: 0 } },
    { id: "glas", name: "Glas", p: { bg: "#10141c", bgAlpha: 0.68, glass: true, radius: 22, accentMode: "dot", accentSize: 14, padX: 40, padY: 26, shadow: 0.45 } },
    { id: "linie", name: "Linie", p: { bgAlpha: 0, accentMode: "top", accentSize: 14, textShadow: true, titleSize: 60, subSize: 32, padX: 0, padY: 12, shadow: 0, subColor: "#e5e7ec" } },
    { id: "karte", name: "Karte", p: { bg: "#f5f6f8", bgAlpha: 1, radius: 16, accentMode: "left", accentSize: 18, titleColor: "#0b0d11", subColor: "#555b69", titleWeight: 650, titleSize: 50, subSize: 28, shadow: 0.5 } },
    { id: "block", name: "Block", p: { bg: "#7c9cff", bgAlpha: 1, skew: 26, accentMode: "none", titleColor: "#0b0d11", subColor: "#1a2033", titleWeight: 700, titleSize: 58, subSize: 30, shadow: 0 } },
    { id: "kante", name: "Kante", p: { bg: "#111111", bgAlpha: 1, skew: 18, accentMode: "dot", accent: "#ff1f1f", accentSize: 16, titleWeight: 700, upper: true, track: 1, shadow: 0.35 } },
    { id: "streifen", name: "Streifen", p: { full: true, bg: "#080a0e", bgAlpha: 0.95, accentMode: "top", accentSize: 14, padX: 96, padY: 30, titleSize: 56, subSize: 30, shadow: 0 } },
    { id: "rahmen", name: "Rahmen", p: { bgAlpha: 0.35, bg: "#000000", border: 3, borderColor: "#ffffff", accentMode: "none", titleWeight: 600, track: 1, shadow: 0 } },
    { id: "serif", name: "Serif", p: { bgAlpha: 0, accentMode: "bottom", accentSize: 5, font: "serif", textShadow: true, titleSize: 60, subSize: 32, titleWeight: 500, padX: 0, padY: 14, anim: "fade", shadow: 0 } },
  ];
  const presetDesign = (id, extra) => CLS.cleanDesign({ ...(PRESETS.find((x) => x.id === id)?.p || {}), ...extra });
  const timing = (o) => { const d = o.design ? CLS.cleanDesign(o.design) : null; return { IN: d ? d.tIn : 0.7, HOLD: d ? d.tHold : 3, OUT: d ? d.tOut : 0.7 }; };
  const phase = (t, tm) => (t < tm.IN ? t / tm.IN : t < tm.IN + tm.HOLD ? 1 : Math.max(0, 1 - (t - tm.IN - tm.HOLD) / tm.OUT));

  // Zeichnet die Bauchbinde. p = Animationsfortschritt (0 weg, 1 voll sichtbar). o.key = Hintergrund ("none" = transparent).
  function draw(c, W, H, o, p = 1) {
    c.save(); c.clearRect(0, 0, W, H);
    if (o.key && o.key !== "none") { c.fillStyle = o.key; c.fillRect(0, 0, W, H); }
    const title = (o.title || "").trim(), sub = (o.subtitle || "").trim();
    if ((title || sub) && p > 0) {
      const e = 1 - Math.pow(1 - Math.min(1, p), 3);
      c.globalAlpha = o.design ? 1 : Math.min(1, p * 2.2); c.textBaseline = "alphabetic";
      const q = { title, sub, accent: /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : "#7c9cff", pos: o.pos || "left", e, design: o.design };
      if (o.design) drawFree(c, W, H, H / 1080, q, e); else (FN[o.style] || FN.balken)(c, W, H, H / 1080, q);
    }
    c.restore();
  }

  // ---- Export ----
  const slug = (t) => String(t || "leer").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "leer";
  const fileName = (o, ext) => `bauchbinde-${slug(o.title)}-${o.design ? "design" : o.style}.${ext}`;
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function ready(o) { try { if (o?.design?.logo) await preload(o.design.logo); await Promise.all([document.fonts.load(`600 40px ${FONT}`), document.fonts.load(`400 40px ${FONT}`)]); } catch (_) {} }
  async function exportPNG(o, { w = 3840, h = 2160 } = {}) {
    await ready(o);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h, o, 1);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    if (!blob) throw new Error("Bild konnte nicht erzeugt werden");
    download(blob, fileName(o, "png")); return { w, h, bytes: blob.size, name: fileName(o, "png") };
  }
  // Animation (rein, halten, raus) als WebM. Mit Keying-Farbe immer sicher, Transparenz hängt vom Browser ab.
  async function exportWebM(o, { w = 3840, h = 2160, hold = 3, fps = 30, onProgress } = {}) {
    if (typeof MediaRecorder === "undefined") throw new Error("Dieser Browser kann keine Videos aufnehmen. Bitte Chrome oder Edge nutzen.");
    await ready(o);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const c = cv.getContext("2d");
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("Kein WebM-Format verfügbar");
    const rec = new MediaRecorder(cv.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 60e6 }), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const tm = timing(o); if (!o.design) tm.HOLD = hold; const T = tm.IN + tm.HOLD + tm.OUT;
    draw(c, w, h, o, 0); rec.start(250);
    const t0 = performance.now();
    await new Promise((resolve) => {
      (function frame() {
        const t = (performance.now() - t0) / 1000;
        draw(c, w, h, o, phase(t, tm));
        onProgress?.(Math.min(1, t / T));
        if (t >= T) return resolve();
        requestAnimationFrame(frame);
      })();
    });
    await new Promise((r) => setTimeout(r, 150)); rec.stop(); await done;
    const blob = new Blob(chunks, { type: "video/webm" }); download(blob, fileName(o, "webm"));
    return { w, h, bytes: blob.size, name: fileName(o, "webm") };
  }

  return { STYLES, KEYS, PRESETS, presetDesign, draw, exportPNG, exportWebM, FONT, onImage, preload, timing, phase };
})();
