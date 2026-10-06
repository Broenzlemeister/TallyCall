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
  const font = (c, wt, px) => { c.font = `${wt} ${px}px ${FONT}`; };
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

  // Zeichnet die Bauchbinde. p = Animationsfortschritt (0 weg, 1 voll sichtbar). o.key = Hintergrund ("none" = transparent).
  function draw(c, W, H, o, p = 1) {
    c.save(); c.clearRect(0, 0, W, H);
    if (o.key && o.key !== "none") { c.fillStyle = o.key; c.fillRect(0, 0, W, H); }
    const title = (o.title || "").trim(), sub = (o.subtitle || "").trim();
    if ((title || sub) && p > 0) {
      const e = 1 - Math.pow(1 - Math.min(1, p), 3);
      c.globalAlpha = Math.min(1, p * 2.2); c.textBaseline = "alphabetic";
      (FN[o.style] || FN.balken)(c, W, H, H / 1080, { title, sub, accent: /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : "#7c9cff", pos: o.pos || "left", e });
    }
    c.restore();
  }

  // ---- Export ----
  const slug = (t) => String(t || "leer").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "leer";
  const fileName = (o, ext) => `bauchbinde-${slug(o.title)}-${o.style}.${ext}`;
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function ready() { try { await Promise.all([document.fonts.load(`600 40px ${FONT}`), document.fonts.load(`400 40px ${FONT}`)]); } catch (_) {} }
  async function exportPNG(o, { w = 3840, h = 2160 } = {}) {
    await ready();
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h, o, 1);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    if (!blob) throw new Error("Bild konnte nicht erzeugt werden");
    download(blob, fileName(o, "png")); return { w, h, bytes: blob.size, name: fileName(o, "png") };
  }
  // Animation (rein, halten, raus) als WebM. Mit Keying-Farbe immer sicher, Transparenz hängt vom Browser ab.
  async function exportWebM(o, { w = 3840, h = 2160, hold = 3, fps = 30, onProgress } = {}) {
    if (typeof MediaRecorder === "undefined") throw new Error("Dieser Browser kann keine Videos aufnehmen. Bitte Chrome oder Edge nutzen.");
    await ready();
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const c = cv.getContext("2d");
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("Kein WebM-Format verfügbar");
    const rec = new MediaRecorder(cv.captureStream(fps), { mimeType: mime, videoBitsPerSecond: 60e6 }), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const IN = 0.7, OUT = 0.7, T = IN + hold + OUT;
    draw(c, w, h, o, 0); rec.start(250);
    const t0 = performance.now();
    await new Promise((resolve) => {
      (function frame() {
        const t = (performance.now() - t0) / 1000;
        draw(c, w, h, o, t < IN ? t / IN : t < IN + hold ? 1 : Math.max(0, 1 - (t - IN - hold) / OUT));
        onProgress?.(Math.min(1, t / T));
        if (t >= T) return resolve();
        requestAnimationFrame(frame);
      })();
    });
    await new Promise((r) => setTimeout(r, 150)); rec.stop(); await done;
    const blob = new Blob(chunks, { type: "video/webm" }); download(blob, fileName(o, "webm"));
    return { w, h, bytes: blob.size, name: fileName(o, "webm") };
  }

  return { STYLES, KEYS, draw, exportPNG, exportWebM, FONT };
})();
