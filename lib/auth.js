// Passwort-Hashing (scrypt), signierte Sitzungs-Cookies, Cookie-Parser. Nur Node-Bordmittel.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function loadSecret(dir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(dir, "secret.key");
  try { return fs.readFileSync(f, "utf8").trim(); } catch (_) {}
  const s = crypto.randomBytes(48).toString("base64url");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${h.toString("base64url")}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || "").split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "base64url");
  const got = crypto.scryptSync(pw, Buffer.from(s, "base64url"), want.length);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const MAXAGE = 30 * 24 * 3600; // Sekunden
function makeSession(secret, user) {
  const body = `${user.id}.${user.sv || 0}.${Math.floor(Date.now() / 1000) + MAXAGE}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
// Gibt { uid, sv } zurück oder null
function readSession(secret, token) {
  const p = String(token || "").split(".");
  if (p.length !== 4) return null;
  const body = p.slice(0, 3).join(".");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(p[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(p[2]) < Date.now() / 1000) return null;
  return { uid: p[0], sv: Number(p[1]) };
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, { secure, maxAge = MAXAGE } = {}) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
const token = (n = 24) => crypto.randomBytes(n).toString("base64url");
const id = (n = 6) => crypto.randomBytes(n).toString("hex");

module.exports = { loadSecret, hashPassword, verifyPassword, makeSession, readSession, parseCookies, cookie, token, id, MAXAGE };
