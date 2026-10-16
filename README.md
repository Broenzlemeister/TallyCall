# Tallycall

Ablaufregie für Shows, Konferenzen und Live-Events im Browser. Tallycall plant mehrere Tage, gibt jedem Gewerk eigene Cues und hält alle Screens live im Takt. Ein Node-Server ohne Abhängigkeiten, Live-Sync per Server-Sent Events.

## Was drin ist
- **Mehrere Tage** mit Datum und Beginn. Punkte laufen nacheinander oder starten zu einer **festen Uhrzeit** 📌, Überschneidungen zeigt der Editor mit ⚠. **Gruppen** gliedern den Tag und lassen sich bis drei Ebenen tief verschachteln, **Pausen** sind eigene Punkte. Alles per Drag & Drop, auch in Gruppen hinein und zwischen Tagen.
- **Planung** mit Rundown-Liste und Inspector: Titel, Farbe aus der Palette, Dauer, Start, Ende-Verhalten (Überzeit zählen, automatisch weiter, anhalten), Bauchbinde beim Start, Notiz, Cues (sortierbar) und Trigger je Punkt und Cue.
- **Gewerke** (Licht, Ton, Video, Bühne, Catering … frei anlegbar). Jeder Punkt hat **Cues** pro Gewerk, mit Zeit nach Punktbeginn.
- **Regie-Pult** (`/p/<id>/`): laufender Punkt mit Restzeit, Nächster, Verzug zum Plan, voraussichtliches Ende, Transport (Start/Pause, Weiter, Zurück, ±Zeit), Streifen-Timeline um „Jetzt“, Cues des laufenden Punkts, Rundown mit Gruppen, Bereit-Status der Gewerke, Nachrichten, Bauchbinden, Protokoll. Der **Roll-Modus** startet Punkte nach der Uhr.
- **Timeline** mit Balken: Ablauf-Spur, Prognose bei Verzug, Gewerke-Spuren mit Cue-Markern, Jetzt-Linie, Zoom, Ansicht über alle Tage. Im Bearbeiten-Modus lassen sich Balkenenden und Cues ziehen.
- **Gewerk-Ansicht**: nächster Cue groß mit Countdown (Standby gelb, JETZT grün) und Bereit-Taste.
- **Bauchbinden**: sechs Stile, Akzentfarbe, Position, Keying-Hintergrund (transparent oder Farbe), gespeicherte Liste, Export als **PNG und WebM in 4K** (auch Full HD oder 8K).
- **Vorschau-Modus**: Planungsänderungen gehen in einen Entwurf, die laufende Show bleibt unberührt. Mit „Live schalten“ wird der Entwurf übernommen. Ansichten zeigen den Entwurf mit `?preview=1`.
- **Screens teilen**: Timer, Bühne, Backstage, Publikum, Uhr, Bauchbinde, Timeline, Druck und jedes Gewerk lassen sich per Link ohne Konto freigeben. Links sind jederzeit widerrufbar.
- **Konten und Rollen** pro Projekt: **Admin** (Mitglieder, Freigaben, Einstellungen) und **Editor** (planen, steuern, Links erstellen). Ein Konto kann in mehreren Projekten arbeiten. Aktivitätsprotokoll pro Projekt.
- **Sprachen**: Deutsch, English, Español, Français, Italiano, Português, 中文, 日本語. Standardsprache ist Englisch (unabhängig von der Browsersprache); sie lässt sich in der App, auf Website und Login umstellen und wird gemerkt. Freigabe-Links tragen die Sprache mit (`?lang=`).
- **Trigger**: bei Ereignissen (Start, Ende, Cue fällig, Nachricht, Bauchbinde, Bereit …) Nachrichten an **HTTP, OSC, TCP, UDP**-Ziele senden, z. B. Pixera, QLab, grandMA, Resolume, Companion. Regeln für alle Punkte sowie Trigger direkt an Punkten und Cues. Sendeprotokoll. Siehe [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).
- **Steuerung von außen**: API-Schlüssel je Projekt, Kommandos per URL (`/api/p/<id>/cmd/next?token=…`), Status und Live-Strom, **Companion-Modul** für Stream Deck (`integrations/companion`), OSC-Eingang für lokale Server.
- **E-Mail:** eigener SMTP-Client (STARTTLS/TLS) für Passwort zurücksetzen, Willkommen, Hinweis bei Passwortänderung und Ankündigungen mit Abmelde-Link, eingerichtet unter Verwaltung → Mail, siehe [docs/MAIL.md](docs/MAIL.md).
- **Feedback-Fenster:** unten links in der App und auf der Website, Nachrichten (Fehler, Idee, Sonstiges) landen in Verwaltung → Feedback mit Antwort per Mail.
- **Lizenzen und Code-Schutz:** signierte Lizenzschlüssel für lokal gehostete Installationen, Lizenzserver in der Verwaltung, geschützter Build (Bytecode, verschleierte Skripte), siehe [docs/LICENSING.md](docs/LICENSING.md).
- **Server-Verwaltung** (`/admin`, nur die Adresse aus `ADMIN_EMAIL`): Nutzer, Pläne (Free/Pro), Käufe, alle Projekte, Preis und Zahlungslink, OSC-Port, **Impressum und Datenschutz** (Vorlagen aus deinen Angaben, de/en) und Konfiguration. Jeder Nutzer sieht nur eigene und geteilte Projekte, der Server-Admin sieht alle. Pro (7,99 € pro Monat) per Stripe-Abo und Webhook oder manuell.
- **OSC komplett**: Eingang `/tallycall/<API-Schlüssel>/<befehl>`, Ausgang mit Vorlagen für QLab, Resolume, grandMA3, Eos, Reaper, TouchOSC-Feedback, Pixera, Companion, vMix. Anleitung: [`docs/OSC.md`](docs/OSC.md) (auch unter `/docs/osc`).
- **Mehr**: Projektvorlagen (Konferenz, Konzert), Ist-Zeiten-Bericht und CSV-Export, Countdown bis zum Beginn auf der Bühnen-Ansicht.
- **Companion-Modul** zum Download auf der Website (`/downloads/companion-module-tallycall.tgz`): Verbindungscode, Konto-Login oder lokaler Server, Presets entstehen automatisch aus dem Projekt (jede neue Bauchbinde wird ein neues Preset).
- Druckansicht pro Tag und Gewerk, Import/Export des Plans als JSON.

## Lokaler Betrieb
```sh
./start.sh            # Windows: start.bat, oder: TALLYCALL_AUTH=off node server.js
```
Node.js ≥ 18. Der Server nennt beim Start alle Adressen im Netzwerk (z. B. `http://192.168.1.20:4001`). Der lokale Modus (`TALLYCALL_AUTH=off`) arbeitet **ohne Login**: Jeder im Netzwerk hat vollen Zugriff. Gedacht für ein vertrauenswürdiges Showbüro-Netz. Soll auch lokal mit Konten gearbeitet werden: `TALLYCALL_AUTH=on ./start.sh`.

## Online-Betrieb (eigener Server mit HTTPS)
```sh
cp .env.example .env   # DOMAIN, PUBLIC_URL eintragen
docker compose up -d
```
Caddy holt das Zertifikat automatisch. Der DNS-Eintrag der Domain muss auf den Server zeigen, Ports 80 und 443 müssen offen sein. Das erste Konto legst du über `/signup` an. Danach `ALLOW_SIGNUP=0` setzen, dann kommen neue Mitglieder nur noch per Einladung ins Projekt. Ohne Docker: `node server.js` hinter einem Reverse Proxy (Pufferung für `/events` abschalten, sonst kommen Updates verzögert an).

Eine Schritt-für-Schritt-Anleitung für ein eigenes VPS mit automatischem Deployment über GitHub Actions steht in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Einstellungen (Umgebungsvariablen)
| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT`, `HOST` | Port und Adresse des Servers | `4001`, `0.0.0.0` |
| `DATA_DIR` | Ordner für Konten und Projekte | `./data` |
| `TALLYCALL_AUTH` | `on` mit Konten, `off` lokal ohne Login | `on` |
| `ALLOW_SIGNUP` | `0` schließt die Registrierung | offen |
| `PUBLIC_URL` | Öffentliche Adresse für Freigabe-Links | aus der Anfrage |
| `TZ_SHOW` | Zeitzone, die neue Projekte vorschlagen | `Europe/Berlin` |
| `SESSION_SECRET` | Schlüssel für Sitzungen | wird in `DATA_DIR` erzeugt |
| `TALLYCALL_TRIGGERS` | `public` nur öffentliche Ziele, `all` auch LAN, `off` aus | `public` mit Konten, sonst `all` |
| `OSC_PORT` | UDP-Port für den OSC-Eingang, leer = aus | aus |
| `ADMIN_EMAIL` | Die einzigen Server-Admins (Komma-getrennt). **Setzen!** Ohne die Variable wird das erste registrierte Konto Admin | – |
| `TALLYCALL_PLANS` | `on` Free/Pro mit Grenzen (1 Show mit höchstens 60 Minuten Inhalt, keine Trigger und API-Schlüssel; neue Konten testen 7 Tage alles, `TRIAL_DAYS` ändert das), `off` alles frei | `on` mit Konten |
| `PAY_LINK`, `PLAN_MONTHS`, `STRIPE_WEBHOOK_SECRET` | Bezahlung für Pro (Stripe Payment Link, Monate je Zahlung, Webhook-Signatur `invoice.paid`). Link, Preis und OSC-Port lassen sich auch unter Verwaltung → Einstellungen setzen | – / 1 / – |

## Sicherheit
- Passwörter werden mit scrypt gehasht, Sitzungen sind signierte Cookies (HttpOnly, SameSite=Lax, Secure hinter HTTPS). Nach 10 Fehlversuchen wird eine Minute gesperrt. Schreibende Anfragen brauchen einen eigenen Header gegen fremde Seiten (CSRF).
- Freigabe-Links sind lange Zufallswerte und nur lesend. Gewerk-Links erlauben zusätzlich die Bereit-Meldung. Widerrufene Links hören sofort auf zu funktionieren, offene Verbindungen werden geschlossen.
- Der Entwurf geht nur an Projektmitglieder, nie an Freigabe-Links.
- Daten liegen als JSON in `DATA_DIR` (`users.json`, `projects/<id>.json`), mit Backup alle 10 Minuten (`*.bak.json`).

## Struktur
`server.js` (HTTP, Konten, Projekte, Freigaben, API-Schlüssel, Verwaltung, Stripe), `lib/engine.js` (Ablauflogik, läuft auch im Browser), `lib/triggers.js` (HTTP/OSC/TCP/UDP-Versand, OSC-Eingang), `lib/auth.js`, `lib/store.js`, `public/rundown.js` und `public/timeline.js` (Rundown-Liste, Timeline), `integrations/companion/` (Companion-Modul), `views/` (Projektseiten), `public/` (Website, Login, Übersicht, gemeinsame Skripte), `public/lang/` (Übersetzungen, erzeugt aus `tools/i18n/`), `tools/` (Übersetzungs-Werkzeuge, Rauchtest), `deploy/` (Server-Einrichtung, Backup), `docs/` (Anleitungen), `.github/workflows/` (Tests und Deployment).

## Übersetzungen pflegen
Die deutschen Texte sind der Schlüssel. Neue Texte in `tools/i18n/*.js` als Zeile `[de, en, es, fr, it, pt, zh, ja]` ergänzen, dann `node tools/i18n-build.js` ausführen. `node tools/i18n-check.js` prüft, dass alle Sprachen vollständig sind und Platzhalter wie `{n}` übereinstimmen. `node tools/i18n-collect.js` fährt die App ab und listet Texte, die noch fehlen.

## Tests
`npm test` prüft die Übersetzungen, das Companion-Modul (gegen echte Server mit einer Attrappe der Companion-API) und startet einen Rauchtest (Konten, Rollen, Freigaben, Seiten, Verschachtelung, API-Schlüssel, Trigger-Schutz, Verwaltung, Lizenzen). In GitHub läuft das bei jedem Push.

## Umbenennen
`node tools/rename.js "NeuerName"` ersetzt den Namen überall (Texte in allen Sprachen, Umgebungsvariablen, Docker, Doku), baut die Sprachdateien neu und prüft sie. Mit `--folder` wird auch der Projektordner umbenannt.

## Noch nicht enthalten
Mehrere Rollen unterhalb von Editor (z. B. nur Steuern), E-Mail-Versand für Einladungen und Passwort-Reset, AGB und Widerrufsbelehrung. Das Companion-Modul ist mit einer Attrappe der Companion-API getestet, aber noch nicht in einer echten Companion-Installation. Die Rechtstexte sind Vorlagen und keine Rechtsberatung.
