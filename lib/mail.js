// E-Mail-Versand ohne Abhängigkeiten: kleiner SMTP-Client (TLS, STARTTLS, AUTH PLAIN/LOGIN), Vorlagen und Warteschlange.
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const os = require("os");

const clean = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
const addrOf = (s) => { const m = /<([^<>\s]+)>/.exec(String(s)); return clean(m ? m[1] : s); };
const b64lines = (buf) => Buffer.from(buf).toString("base64").replace(/(.{76})/g, "$1\r\n");
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

// Nachricht: { from, to, subject, text, html, replyTo, headers }
function build(m) {
  const boundary = "tc" + crypto.randomBytes(12).toString("hex");
  const domain = (addrOf(m.from).split("@")[1] || os.hostname() || "localhost").replace(/[^a-z0-9.-]/gi, "");
  const head = [
    `From: ${clean(m.from)}`, `To: ${clean(m.to)}`, `Subject: ${encWord(clean(m.subject))}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomBytes(12).toString("hex")}@${domain}>`, "MIME-Version: 1.0", ...(m.replyTo ? [`Reply-To: ${clean(m.replyTo)}`] : []),
    ...Object.entries(m.headers || {}).map(([k, v]) => `${clean(k)}: ${clean(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(body)}\r\n`;
  return head.join("\r\n") + "\r\n\r\n" + part("text/plain", m.text || "") + (m.html ? part("text/html", m.html) : "") + `--${boundary}--\r\n`;
}

// cfg: { host, port, secure: "starttls" | "tls" | "none", user, pass, insecureTls, timeout }
function smtpSend(cfg, m) {
  const timeout = cfg.timeout || 20000, from = addrOf(m.from), to = addrOf(m.to);
  return new Promise((resolve, reject) => {
    let sock, buf = "", waiting = null, done = false;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); try { sock && sock.destroy(); } catch (_) {} err ? reject(err) : resolve(); };
    const timer = setTimeout(() => finish(new Error("SMTP-Zeitüberschreitung")), timeout);
    const feed = (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0 || (i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + (buf[i] === "\r" ? 2 : 1));
        const mm = /^(\d{3})([ -])(.*)$/.exec(line); if (!mm) continue;
        (reply.lines = reply.lines || []).push(mm[3]);
        if (mm[2] === " " && waiting) { const w = waiting; waiting = null; const r = { code: Number(mm[1]), lines: reply.lines }; reply.lines = []; w(r); }
      }
    };
    const reply = { lines: [] };
    const read = () => new Promise((res) => { waiting = res; });
    const expect = async (codes, what) => { const r = await read(); if (!codes.includes(r.code)) throw new Error(`SMTP ${what}: ${r.code} ${r.lines.join(" ")}`.slice(0, 300)); return r; };
    const cmd = async (line, codes, what) => { const p = read(); sock.write(line + "\r\n"); const r = await p; if (!codes.includes(r.code)) throw new Error(`SMTP ${what}: ${r.code} ${r.lines.join(" ")}`.slice(0, 300)); return r; };
    const attach = (s) => { sock = s; s.on("data", feed); s.on("error", finish); s.on("close", () => finish(new Error("SMTP-Verbindung unerwartet beendet"))); };
    const tlsOpts = (host) => ({ servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !cfg.insecureTls });
    (async () => {
      const port = Number(cfg.port) || (cfg.secure === "tls" ? 465 : 587), name = os.hostname() || "localhost";
      const greeting = new Promise((res, rej) => { waiting = res; });
      if (cfg.secure === "tls") attach(tls.connect({ host: cfg.host, port, ...tlsOpts(cfg.host) })); else attach(net.connect({ host: cfg.host, port }));
      let r = await greeting; if (r.code !== 220) throw new Error(`SMTP Begrüßung: ${r.code} ${r.lines.join(" ")}`);
      r = await cmd(`EHLO ${name}`, [250], "EHLO");
      if (cfg.secure === "starttls") {
        if (!r.lines.some((l) => /^STARTTLS/i.test(l))) throw new Error("Der Server bietet kein STARTTLS an");
        await cmd("STARTTLS", [220], "STARTTLS");
        sock.removeAllListeners("data"); sock.removeAllListeners("close"); sock.removeAllListeners("error");
        const raw = sock; raw.on("error", finish); buf = ""; reply.lines = [];
        const secure = tls.connect({ socket: raw, ...tlsOpts(cfg.host) });
        await new Promise((res, rej) => { secure.once("secureConnect", res); secure.once("error", rej); });
        attach(secure);
        r = await cmd(`EHLO ${name}`, [250], "EHLO");
      }
      if (cfg.user) {
        const mech = r.lines.find((l) => /^AUTH\b/i.test(l)) || "";
        if (/PLAIN/i.test(mech) || !mech) await cmd("AUTH PLAIN " + Buffer.from(`\0${cfg.user}\0${cfg.pass || ""}`).toString("base64"), [235], "Anmeldung");
        else { await cmd("AUTH LOGIN", [334], "Anmeldung"); await cmd(Buffer.from(cfg.user).toString("base64"), [334], "Anmeldung"); await cmd(Buffer.from(cfg.pass || "").toString("base64"), [235], "Anmeldung"); }
      }
      await cmd(`MAIL FROM:<${from}>`, [250], "MAIL FROM");
      await cmd(`RCPT TO:<${to}>`, [250, 251], "RCPT TO");
      await cmd("DATA", [354], "DATA");
      const body = build(m).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      const p = read(); sock.write(body + "\r\n.\r\n"); r = await p;
      if (r.code !== 250) throw new Error(`SMTP Versand: ${r.code} ${r.lines.join(" ")}`.slice(0, 300));
      try { sock.write("QUIT\r\n"); } catch (_) {}
      finish();
    })().catch(finish);
  });
}

// ---------- Vorlagen ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const linkify = (html) => html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#d41414">$1</a>');
// Nur Text: Absätze durch Leerzeilen, einfache Umbrüche, Links werden klickbar
const textToHtml = (t) => String(t || "").trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px;line-height:1.6">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`).join("");

// opts: { title, body (Text), button: { label, url }, footer (Text), lang }
function layout({ title, body, button, footer, brand = "Tallycall" }) {
  const btn = button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#d41414;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px">${esc(button.label)}</a></p><p style="margin:0 0 16px;color:#666;font-size:13px;line-height:1.5;word-break:break-all">${esc(button.url)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f3f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff"><tr><td style="background:#0a0a0a;color:#fff;padding:18px 28px;font-size:20px;font-weight:800;letter-spacing:-.02em"><span style="display:inline-block;width:12px;height:12px;background:#ff1f1f;margin-right:10px"></span>${esc(brand)}</td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 18px;font-size:22px;letter-spacing:-.02em">${esc(title)}</h1>${textToHtml(body)}${btn}</td></tr>${footer ? `<tr><td style="padding:0 28px 26px;color:#777;font-size:12px;line-height:1.5">${linkify(esc(footer)).replace(/\n/g, "<br>")}</td></tr>` : ""}</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${String(body || "").trim()}\n${button ? `\n${button.label}: ${button.url}\n` : ""}${footer ? `\n--\n${footer}\n` : ""}`;
  return { html, text };
}

const TEXTS = {
  en: {
    resetSubject: "Reset your Tallycall password", resetTitle: "Reset your password", resetBody: (n) => `Hi ${n},\n\nsomeone asked to reset the password of your Tallycall account. Use the button below to choose a new one. The link works once and expires in 1 hour.\n\nIf this wasn't you, you can ignore this email. Your password stays the same.`, resetButton: "Choose a new password",
    changedSubject: "Your Tallycall password was changed", changedTitle: "Password changed", changedBody: (n) => `Hi ${n},\n\nthe password of your Tallycall account was just changed and all other sessions were signed out.\n\nIf this was you, there is nothing to do. If not, reset your password right away and contact us.`, changedButton: "Reset password",
    welcomeSubject: "Welcome to Tallycall", welcomeTitle: "Welcome to Tallycall", welcomeBody: (n, d) => `Hi ${n},\n\nyour account is ready. ${d ? `You can try every feature for ${d} days. After that, Free stays: one show with up to 60 minutes of content. Pro unlocks everything.` : "Free includes one show with up to 60 minutes of content. Pro unlocks everything."}\n\nCreate your first show and share the timer or lower thirds with your crew.`, welcomeButton: "Open Tallycall",
    testSubject: "Tallycall test email", testTitle: "It works", testBody: () => "This is a test email from your Tallycall server. Your mail settings are fine.",
    unsubscribe: "You get this email because you asked for product news. Unsubscribe", service: "This is a service message about your Tallycall account.",
  },
  de: {
    resetSubject: "Tallycall-Passwort zurücksetzen", resetTitle: "Passwort zurücksetzen", resetBody: (n) => `Hallo ${n},\n\njemand hat angefragt, das Passwort deines Tallycall-Kontos zurückzusetzen. Wähle mit dem Button unten ein neues. Der Link funktioniert einmal und gilt 1 Stunde.\n\nWenn du das nicht warst, ignoriere diese E-Mail. Dein Passwort bleibt unverändert.`, resetButton: "Neues Passwort wählen",
    changedSubject: "Dein Tallycall-Passwort wurde geändert", changedTitle: "Passwort geändert", changedBody: (n) => `Hallo ${n},\n\ndas Passwort deines Tallycall-Kontos wurde gerade geändert, alle anderen Sitzungen wurden abgemeldet.\n\nWenn du das warst, musst du nichts tun. Wenn nicht, setze das Passwort sofort zurück und melde dich bei uns.`, changedButton: "Passwort zurücksetzen",
    welcomeSubject: "Willkommen bei Tallycall", welcomeTitle: "Willkommen bei Tallycall", welcomeBody: (n, d) => `Hallo ${n},\n\ndein Konto ist bereit. ${d ? `Du kannst ${d} Tage lang alle Funktionen testen. Danach bleibt Free: eine Show mit bis zu 60 Minuten Inhalt. Pro schaltet alles frei.` : "Free enthält eine Show mit bis zu 60 Minuten Inhalt. Pro schaltet alles frei."}\n\nLege deine erste Show an und teile Timer oder Bauchbinden mit deiner Crew.`, welcomeButton: "Tallycall öffnen",
    testSubject: "Tallycall-Testmail", testTitle: "Es funktioniert", testBody: () => "Das ist eine Testmail von deinem Tallycall-Server. Die Mail-Einstellungen sind in Ordnung.",
    unsubscribe: "Du bekommst diese E-Mail, weil du Produktneuigkeiten wolltest. Abbestellen", service: "Das ist eine Servicemitteilung zu deinem Tallycall-Konto.",
  },
};
const T = (lang) => TEXTS[lang] || TEXTS.en;

module.exports = { smtpSend, build, layout, textToHtml, T, esc, addrOf };
