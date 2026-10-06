// Benennt das Produkt um: node tools/rename.js "Neuer Name" [--folder]
// Ersetzt den Anzeigenamen (Tallycall), das Kürzel in Kleinbuchstaben (tallycall) und das Umgebungs-Präfix (TALLYCALL_) in allen Dateien,
// baut danach die Sprachdateien neu und prüft sie. Mit --folder wird auch der Projektordner umbenannt.
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).name; // aktueller Kürzel-Name, z. B. "tallycall"
const name = process.argv[2];
if (!name || !/^[A-Za-z][A-Za-z0-9]{2,23}$/.test(name)) { console.error('Bitte einen Namen aus 3 bis 24 Buchstaben/Ziffern ohne Leerzeichen angeben, z. B.: node tools/rename.js "Fermata"'); process.exit(1); }
const display = name, slug = name.toLowerCase(), upper = name.toUpperCase();
const oldDisplay = cur[0].toUpperCase() + cur.slice(1), oldUpper = cur.toUpperCase();
if (slug === cur) { console.log("Der Name ist bereits " + display); process.exit(0); }
const EXT = /\.(js|html|css|md|json|yml|sh|bat|svg|example)$/, NAMES = new Set(["Dockerfile", "Caddyfile", ".env.example"]);
let files = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "data"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!EXT.test(e.name) && !NAMES.has(e.name)) continue;
    const s = fs.readFileSync(p, "utf8"), o = s.replace(new RegExp(oldDisplay, "g"), display).replace(new RegExp(oldUpper, "g"), upper).replace(new RegExp(cur, "g"), slug);
    if (o !== s) { fs.writeFileSync(p, o); files++; }
  }
})(ROOT);
console.log(`${files} Dateien angepasst: ${oldDisplay} → ${display}`);
execSync("node " + path.join(__dirname, "i18n-build.js"), { stdio: "inherit" });
execSync("node " + path.join(__dirname, "i18n-check.js"), { stdio: "inherit" });
if (process.argv.includes("--folder")) { const to = path.join(path.dirname(ROOT), slug); fs.renameSync(ROOT, to); console.log("Ordner umbenannt: " + to); }
console.log("Fertig. Danach committen. Website und Demo (Artifacts) neu bauen, falls veröffentlicht.");
