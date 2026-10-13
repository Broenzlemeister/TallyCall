// Baut das Companion-Modul als importierbares Paket und legt es für den Download auf der Website ab.
// Aufruf: node tools/build-companion.js   (braucht Internet für npm install)
const { execSync } = require("child_process");
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "integrations", "companion"), out = path.join(__dirname, "..", "public", "downloads");
const run = (c) => execSync(c, { cwd: dir, stdio: "inherit" });
run("npm install --no-audit --no-fund");
run("npx companion-module-check");
run("npx companion-module-build");
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
const built = path.join(dir, `tallycall-${pkg.version}.tgz`);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(built, path.join(out, "companion-module-tallycall.tgz"));
fs.unlinkSync(built);
console.log("Fertig: public/downloads/companion-module-tallycall.tgz");
