// Erzeugt eine geschützte Ausgabe des Programms: Server als gebündelter Bytecode, Browser-Skripte minimiert und verschleiert.
// Der lesbare Quelltext ist darin nicht mehr enthalten. Genutzt vom Docker-Build (Online-Dienst) und für Kundenversionen.
//   node tools/build-protect.js --out DIR                       Online-Dienst (keine Lizenz nötig)
//   node tools/build-protect.js --out DIR --dist --pub KEY.pem  Kundenversion mit Lizenzprüfung
//        [--issuer https://tallycall.com] [--buy https://tallycall.com/#preise] [--no-bytecode] [--no-obfuscate]
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const Obf = require("javascript-obfuscator");

const ROOT = path.join(__dirname, "..");
const arg = (n, d = "") => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true; };
const OUT = path.resolve(arg("out", path.join(ROOT, "dist")));
const DIST = !!arg("dist"), BYTECODE = !arg("no-bytecode"), OBF = !arg("no-obfuscate");
let build = null;
if (DIST) {
  const pubFile = arg("pub");
  if (!pubFile || pubFile === true) { console.error("--dist braucht --pub <öffentlicher Schlüssel.pem>"); process.exit(1); }
  build = { pub: fs.readFileSync(pubFile, "utf8"), issuer: String(arg("issuer", "https://tallycall.com")), buy: String(arg("buy", "https://tallycall.com/#preise")) };
}
const OBF_OPTS = { compact: true, simplify: true, identifierNamesGenerator: "hexadecimal", renameGlobals: false, stringArray: true, stringArrayThreshold: 0.8, stringArrayEncoding: [], rotateStringArray: true, shuffleStringArray: true, splitStrings: false, numbersToExpressions: false, controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false, unicodeEscapeSequence: false, target: "browser" };
const protect = (code) => {
  const min = esbuild.transformSync(code, { minify: true, target: "es2020", legalComments: "none" }).code;
  return OBF ? Obf.obfuscate(min, OBF_OPTS).getObfuscatedCode() : min;
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---- Browser: public/ und views/ ----
function copyTree(src, dst, fn) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d, fn); else fn(s, d, e.name);
  }
}
const htmlInline = (html) => html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, body) => (/type=["']?(application\/json|text\/template)/.test(attrs) || !body.trim() ? m : `<script${attrs}>${protect(body)}</script>`))
  .replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (m, a, css) => `<style${a}>${esbuild.transformSync(css, { loader: "css", minify: true }).code.trim()}</style>`);
let nJs = 0, nHtml = 0;
const handle = (s, d, name) => {
  if (name.endsWith(".js") && !s.includes(path.sep + "lang" + path.sep)) { fs.writeFileSync(d, protect(fs.readFileSync(s, "utf8"))); nJs++; }
  else if (name.endsWith(".js")) fs.writeFileSync(d, esbuild.transformSync(fs.readFileSync(s, "utf8"), { minify: true, legalComments: "none" }).code); // Sprachdateien nur minimieren
  else if (name.endsWith(".html")) { fs.writeFileSync(d, htmlInline(fs.readFileSync(s, "utf8"))); nHtml++; }
  else if (name.endsWith(".css")) fs.writeFileSync(d, esbuild.transformSync(fs.readFileSync(s, "utf8"), { loader: "css", minify: true }).code);
  else fs.copyFileSync(s, d);
};
copyTree(path.join(ROOT, "public"), path.join(OUT, "public"), handle);
copyTree(path.join(ROOT, "views"), path.join(OUT, "views"), handle);
copyTree(path.join(ROOT, "docs"), path.join(OUT, "docs"), (s, d) => fs.copyFileSync(s, d));
fs.copyFileSync(path.join(ROOT, "package.json"), path.join(OUT, "package.json"));

// ---- Server: ein Bündel, minimiert, optional als V8-Bytecode ----
const bundle = esbuild.buildSync({
  entryPoints: [path.join(ROOT, "server.js")], bundle: true, platform: "node", target: "node18", minify: true, write: false, legalComments: "none",
  define: build ? { TC_BUILD: JSON.stringify(build) } : {}, logLevel: "error",
}).outputFiles[0].text;
const tmp = path.join(OUT, "server.bundle.js");
fs.writeFileSync(tmp, bundle);
if (BYTECODE) {
  const bytenode = require("bytenode");
  bytenode.compileFile({ filename: tmp, output: path.join(OUT, "server.jsc") });
  fs.rmSync(tmp);
  const bn = path.join(ROOT, "node_modules", "bytenode");
  copyTree(bn, path.join(OUT, "node_modules", "bytenode"), (s, d) => fs.copyFileSync(s, d));
  fs.writeFileSync(path.join(OUT, "server.js"), 'process.env.TC_BOOT = "1"; require("bytenode"); require("./server.jsc");\n');
} else {
  fs.renameSync(tmp, path.join(OUT, "server.js"));
}
fs.writeFileSync(path.join(OUT, "build.txt"), `${DIST ? "Kundenversion" : "Online"} ${require(path.join(ROOT, "package.json")).version}, ${new Date().toISOString()}, Node ${process.version}\n`);
console.log(`Fertig: ${OUT} (${nJs} Skripte, ${nHtml} Seiten, Server ${BYTECODE ? "als Bytecode" : "gebündelt"}, ${DIST ? "mit Lizenzprüfung" : "ohne Lizenzprüfung"})`);
