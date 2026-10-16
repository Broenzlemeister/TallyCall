// Prüft die Übersetzungen: Struktur (Spalten, Platzhalter), Aktualität der erzeugten Dateien und Abdeckung der gesammelten Texte.
const fs = require("fs"), path = require("path");
const { execSync } = require("child_process");
try { execSync("node " + path.join(__dirname, "i18n-build.js"), { stdio: "pipe" }); } catch (e) { console.error(e.stderr?.toString() || e.message); process.exit(1); }
const keys = require("./i18n-keys.json");
const exact = new Set(keys);
const pats = keys.filter((k) => /\{\w+\}/.test(k)).map((k) => new RegExp("^" + k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, "(.+?)") + "$", "s"));
const covered = (s) => exact.has(s) || pats.some((p) => p.test(s));
const ignore = [/^Tallycall – Show-calling for live events$/, /^\/(api|tallycall)\//, /^(progress|remaining)$/, /^\{"/, /^#[0-9a-f]{3,8}$/i, /^[A-Z][a-z]+\/[A-Za-z_]+$/, /^UTC$/, /^[^\p{L}]+$/u, /^\d/, /· Tallycall$/, /@/, /^(AU|LX|VI|BÜ|CA|NG|A|N|G|P|Tallycall|HTTP|OSC|TCP|UDP|GET|POST|PUT|Pro|Free|Companion|Stripe|Pixera|Enter|QLab|Reaper|ETC Eos|Resolume Arena|grandMA3|Pixera \(JSON-RPC\)|Companion \(HTTP\)|vMix \(HTTP\))$/, /^[A-Z_]+(=.*)?$/, /^\{\w+\}$/, /^\\n$/, /^[a-z.]+\/[a-z./]+$/, /^https?:\/\//, /^\.env$/, /^Tag \d$/,
  /^(Anna Beispiel|Keynote Speaker|Outro-Loop|Outro-Musik|Cue \d.*|Gala 2026|Anna Test|Ben Muster|Moderation|Gäste|Test|Geändert|Hallo|Workshop-Block [AB]|Mittagessen|Kaffeepause|Keynote|Podium|Schlusswort|Einlass & Begrüßung|Vormittag|Nachmittag|Umbau Bühne|Interview|Neuer Tag|Neues Gewerk|Neuer Punkt|Tag 1 · Konferenz|z\. B\. .*|du@beispiel\.de|\.\/start\.sh|docker compose up -d)$/,
  /^(Geändert|Neu|Gelöscht|Neuer Tag|Neues Gewerk|Start|Weiter|Zurück|Geladen|Punkt „.*“ bearbeitet|Licht|Ton|Video|Catering|Bühne): /, /^(Licht|Ton|Video|Catering|Bühne) · /, /^[~＋−] /, /^von [^,]+, /, /^Tuesday|^Wednesday|\d{4} · /, /\.png: |\.webm: /];
const collected = fs.existsSync(path.join(__dirname, "i18n-collected.json")) ? require("./i18n-collected.json") : [];
const missing = collected.filter((s) => !ignore.some((r) => r.test(s)) && !covered(s));
if (missing.length) { console.error(`${missing.length} gesammelte Texte ohne Übersetzung:\n` + missing.map((s) => "  " + JSON.stringify(s)).join("\n")); process.exit(1); }
console.log(`OK: ${keys.length} Texte in 7 Sprachen, alle gesammelten Texte abgedeckt (${collected.length} geprüft).`);
