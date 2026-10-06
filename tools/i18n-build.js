// Erzeugt public/lang/<sprache>.js aus tools/i18n/*.js (Zeilen: [de, en, es, fr, it, pt, zh, ja]).
const fs = require("fs"), path = require("path");
const LANGS = ["de", "en", "es", "fr", "it", "pt", "zh", "ja"];
const dir = path.join(__dirname, "i18n");
const rows = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort().flatMap((f) => require(path.join(dir, f)).map((r) => ({ r, f })));
const problems = [], seen = new Map();
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const { r, f } of rows) {
  if (r.length !== LANGS.length) { problems.push(`${f}: "${r[0]}" hat ${r.length} statt ${LANGS.length} Spalten`); continue; }
  r.forEach((v, i) => { if (typeof v !== "string" || !v.trim()) problems.push(`${f}: "${r[0]}" leer in ${LANGS[i]}`); });
  if (seen.has(r[0])) problems.push(`${f}: doppelter Schlüssel "${r[0]}" (auch in ${seen.get(r[0])})`); seen.set(r[0], f);
  const p0 = ph(r[0]); r.forEach((v, i) => { if (ph(v) !== p0) problems.push(`${f}: "${r[0]}" Platzhalter in ${LANGS[i]} weichen ab (${ph(v)} statt ${p0})`); });
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
fs.mkdirSync(path.join(__dirname, "..", "public", "lang"), { recursive: true });
LANGS.slice(1).forEach((l, li) => {
  const obj = {}; for (const { r } of rows) obj[r[0]] = r[li + 1]; // auch identische Texte ablegen, damit "fehlend" eindeutig bleibt
  fs.writeFileSync(path.join(__dirname, "..", "public", "lang", l + ".js"), `// Erzeugt von tools/i18n-build.js. Nicht von Hand ändern.\nI18N.add(${JSON.stringify(l)}, ${JSON.stringify(obj, null, 0)});\n`);
});
fs.writeFileSync(path.join(__dirname, "i18n-keys.json"), JSON.stringify(rows.map(({ r }) => r[0]), null, 1));
console.log(`${rows.length} Texte in ${LANGS.length - 1} Sprachen erzeugt`);
