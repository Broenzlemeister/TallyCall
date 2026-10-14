// Baut ein Paket für Kunden, die Tallycall selbst hosten: geschützter Code mit Lizenzprüfung, Docker-Dateien und Anleitung.
//   node tools/build-customer.js [--data DIR] [--issuer URL] [--buy URL] [--portable] [--out DIR]
// Der öffentliche Schlüssel wird aus dem privaten Schlüssel des Lizenzservers abgeleitet (DATA_DIR/license-private.pem oder LICENSE_PRIVATE_KEY).
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const License = require("../lib/license.js");
const arg = (n, d = "") => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true; };
const DATA = path.resolve(arg("data", process.env.DATA_DIR || path.join(__dirname, "..", "data")));
let priv = (process.env.LICENSE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!priv) try { priv = fs.readFileSync(path.join(DATA, "license-private.pem"), "utf8"); } catch (_) {}
if (!priv) { console.error("Kein Lizenzschlüssel-Generator gefunden. In der Verwaltung unter „Lizenzen“ einrichten (oder LICENSE_PRIVATE_KEY setzen)."); process.exit(1); }
const ver = require("../package.json").version, out = path.resolve(arg("out", path.join(DATA, "dist", "tallycall-local-" + ver)));
const pubFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tc-pub-")), "pub.pem"); fs.writeFileSync(pubFile, License.publicFrom(priv));
const args = [path.join(__dirname, "build-protect.js"), "--out", out, "--dist", "--pub", pubFile, "--issuer", String(arg("issuer", "https://tallycall.com")), "--buy", String(arg("buy", "https://tallycall.com/#preise"))];
if (arg("portable")) args.push("--no-bytecode");
execFileSync("node", args, { stdio: "inherit" });
fs.rmSync(path.dirname(pubFile), { recursive: true, force: true });

fs.writeFileSync(path.join(out, "Dockerfile"), 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nENV PORT=4001 DATA_DIR=/data TALLYCALL_AUTH=off\nVOLUME /data\nEXPOSE 4001\nCMD ["node", "server.js"]\n');
fs.writeFileSync(path.join(out, "docker-compose.yml"), `# Tallycall lokal: docker compose up -d --build, dann http://SERVER:4001 öffnen.
# Mit Benutzerkonten statt offenem Zugriff im Netz: TALLYCALL_AUTH auf "on" setzen.
services:
  tallycall:
    build: .
    restart: unless-stopped
    ports: [ "4001:4001", "9000:9000/udp" ]   # Weboberfläche, OSC-Eingang
    environment: [ "TALLYCALL_AUTH=off", "TALLYCALL_TRIGGERS=all", "OSC_PORT=9000" ]
    volumes: [ "tallycall-data:/data" ]
volumes:
  tallycall-data:
`);
fs.writeFileSync(path.join(out, "start.sh"), '#!/bin/sh\n# Start ohne Docker (Node.js 22 nötig). Daten liegen im Ordner "data".\ncd "$(dirname "$0")" && TALLYCALL_AUTH="${TALLYCALL_AUTH:-off}" TALLYCALL_TRIGGERS=all exec node server.js\n', { mode: 0o755 });
fs.writeFileSync(path.join(out, "start.bat"), '@echo off\r\nrem Start ohne Docker (Node.js 22 nötig). Daten liegen im Ordner "data".\r\ncd /d "%~dp0"\r\nset TALLYCALL_AUTH=off\r\nset TALLYCALL_TRIGGERS=all\r\nnode server.js\r\n');
fs.writeFileSync(path.join(out, "LIESMICH.md"), `# Tallycall lokal betreiben

## Starten
- **Docker:** \`docker compose up -d --build\`, danach \`http://SERVER:4001\` öffnen.
- **Ohne Docker:** Node.js 22 installieren, dann \`./start.sh\` (Windows: \`start.bat\`).

Beim ersten Start läuft Tallycall **7 Tage mit allen Funktionen zum Testen**. Danach gelten die Free-Grenzen (1 Show mit höchstens 60 Minuten Inhalt, keine Trigger und API-Schlüssel), bis ein Lizenzschlüssel eingetragen ist.

## Lizenzschlüssel eintragen
1. Oberfläche öffnen → oben rechts das Konto-Menü → **Verwaltung** → Reiter **Lizenz**.
2. Schlüssel (beginnt mit \`TC1-\`) einfügen und aktivieren. Alternativ als Umgebungsvariable \`TALLYCALL_LICENSE\`.
3. Die **Installations-ID** auf derselben Seite brauchst du, wenn du den Schlüssel auf eine andere Maschine umziehen willst.

Der Schlüssel wird offline geprüft. Gelegentlich (alle 12 Stunden, sofern Internet da ist) gleicht die Installation mit dem Lizenzserver ab: Verlängerungen kommen so automatisch an, gesperrte Schlüssel werden erkannt. Ohne Internet läuft die Lizenz bis zu ihrem Ablaufdatum plus 7 Tage Nachfrist weiter. Für Spielorte ohne Internet gibt es unbefristete oder lang laufende Schlüssel auf Anfrage.

Ein Schlüssel gilt für die vereinbarte Anzahl Installationen (Standard: eine).

## Daten und Updates
Alle Projekte liegen im Datenordner (\`/data\` im Container, sonst \`data/\`). Sicherung = diesen Ordner kopieren. Ein Update ist eine neue Version dieses Pakets: Ordner ersetzen, Daten bleiben erhalten.

Dieses Paket ist urheberrechtlich geschützt. Weitergabe, Kopie und Rückbau sind ohne schriftliche Erlaubnis nicht gestattet.
`);
const tgz = out + ".tgz";
execFileSync("tar", ["-czf", tgz, "-C", path.dirname(out), path.basename(out)]);
console.log("Paket:", tgz);
