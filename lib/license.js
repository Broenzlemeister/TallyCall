// Lizenzschlüssel: Ed25519-signiert. Der private Schlüssel liegt nur auf dem Lizenzserver (tallycall.com),
// die Kundenversion enthält nur den öffentlichen Schlüssel und prüft Schlüssel offline.
// Format: TC1-<Nutzdaten base64url>.<Signatur base64url>
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const GRACE = 7 * 86400000; // Nachfrist nach Ablauf
const TRIAL_DAYS = 7;
const b64 = (b) => Buffer.from(b).toString("base64url");

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { pub: publicKey.export({ type: "spki", format: "pem" }), priv: privateKey.export({ type: "pkcs8", format: "pem" }) };
}
const publicFrom = (privPem) => crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: "spki", format: "pem" });

// payload: { id, name, email, exp (ms, 0 = unbefristet), max (Installationen), inst (feste Instanz-ID oder "") }
function sign(payload, privPem) {
  const body = b64(JSON.stringify({ v: 1, ed: "pro", iat: Date.now(), ...payload }));
  return "TC1-" + body + "." + b64(crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(privPem)));
}
function parse(key) {
  const m = /^TC1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || "").replace(/\s+/g, ""));
  if (!m) return null;
  try { return { body: m[1], sig: m[2], payload: JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) }; } catch (_) { return null; }
}
// Ergebnis: { ok, reason?, payload?, state: "valid"|"grace"|"expired"|"invalid"|"instance", daysLeft }
function verify(key, pubPem, { now = Date.now(), instance = "" } = {}) {
  const p = parse(key);
  if (!p || !pubPem) return { ok: false, state: "invalid", reason: "Der Lizenzschlüssel ist ungültig" };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(p.body), crypto.createPublicKey(pubPem), Buffer.from(p.sig, "base64url")); } catch (_) {}
  if (!good || p.payload.v !== 1 || !p.payload.id) return { ok: false, state: "invalid", reason: "Der Lizenzschlüssel ist ungültig" };
  const { payload } = p;
  if (payload.inst && instance && payload.inst !== instance) return { ok: false, state: "instance", payload, reason: "Dieser Schlüssel gehört zu einer anderen Installation" };
  const exp = Number(payload.exp) || 0, left = exp ? Math.ceil((exp - now) / 86400000) : Infinity;
  if (exp && now > exp + GRACE) return { ok: false, state: "expired", payload, daysLeft: left, reason: "Die Lizenz ist abgelaufen" };
  return { ok: true, state: exp && now > exp ? "grace" : "valid", payload, daysLeft: isFinite(left) ? left : null };
}

// Stabile ID dieser Installation (liegt im Datenordner) und Teststart
function instanceFile(dir) { return path.join(dir, "instance.json"); }
function loadInstance(dir) {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(instanceFile(dir), "utf8")); } catch (_) {}
  if (!j || !j.id) { j = { id: crypto.randomBytes(8).toString("hex"), trialStart: Date.now() }; try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(instanceFile(dir), JSON.stringify(j)); } catch (_) {} }
  return j;
}
const trial = (inst, now = Date.now()) => { const left = Math.ceil((inst.trialStart + TRIAL_DAYS * 86400000 - now) / 86400000); return { active: left > 0, daysLeft: Math.max(0, left) }; };

module.exports = { generateKeyPair, publicFrom, sign, parse, verify, loadInstance, trial, GRACE, TRIAL_DAYS };
