# Tallycall auf einem eigenen VPS betreiben

Ziel: Jeder Push auf `main` testet den Code in GitHub Actions und lädt ihn danach automatisch auf deinen Server. HTTPS und Zertifikate übernimmt Caddy.

## Was du brauchst
- Ein VPS mit **Ubuntu 24.04 LTS** (22.04 geht auch), mindestens 1 vCPU und 1 GB RAM (2 GB sind komfortabel).
- Die Domain **tallycall.com**: A-Record für `@` und `www` auf die IP des VPS (bei IPv6 zusätzlich AAAA). `www` leitet auf die Hauptdomain um. Stand 12.10.2026 ist die Domain per DNS noch nicht delegiert, also zuerst registrieren.
- Root-Zugang per SSH für die einmalige Einrichtung.

## 1. VPS einmalig einrichten
Per SSH als root auf dem VPS (Repo öffentlich):
```sh
curl -fsSL https://raw.githubusercontent.com/Broenzlemeister/tallycall/main/deploy/bootstrap.sh | bash -s -- --domain tallycall.com --admin-email deine@adresse.de
```
Bei einem **privaten Repo** lädst du `deploy/bootstrap.sh` per `scp deploy/bootstrap.sh root@DEINE-IP:` hoch und startest `bash bootstrap.sh --domain tallycall.com --admin-email deine@adresse.de`.

Das Skript installiert Docker, schaltet die Firewall auf 22/80/443, aktiviert Sicherheitsupdates und fail2ban, legt den Benutzer `deploy` an und richtet das tägliche Backup ein. Danach holt es den Code selbst aus GitHub nach `/opt/tallycall`, erzeugt die `.env` und startet Tallycall.

- Ist das Repo privat, zeigt das Skript einen **Nur-Lese-Schlüssel** an. Trage ihn in GitHub unter *Repo → Settings → Deploy keys → Add deploy key* ein (ohne Schreibrecht) und drücke Enter.
- Am Ende zeigt es `VPS_HOST` und einen privaten Schlüssel für GitHub Actions an. Der Schlüssel kann auf dem Server **nur** den Befehl `tallycall-update` ausführen.

## 2. Geheimnisse in GitHub eintragen
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Inhalt |
|---|---|
| `VPS_HOST` | IP oder Hostname des VPS |
| `VPS_SSH_KEY` | der angezeigte private Schlüssel, komplett mit BEGIN/END-Zeilen |
| `VPS_USER` | `deploy` (Standard, kann entfallen) |
| `VPS_PORT` | nur falls SSH nicht auf Port 22 läuft |
| `VPS_KNOWN_HOSTS` | empfohlen: Ausgabe von `ssh-keyscan -H DEINE-IP` |

Optional unter **Settings → Environments → production** Freigabe durch dich verlangen.

## 3. Updates
Jeder Push auf `main` testet den Code und ruft danach per SSH `tallycall-update` auf dem Server auf. Der Server sichert die Daten, holt `main` aus GitHub (`git fetch` und `reset`), baut neu und prüft den Health-Check. Von Hand geht dasselbe auf dem Server mit `tallycall-update`.

## 4. Erstes Konto und Registrierung schließen
Öffne `https://tallycall.com/signup` und lege dein Konto an. Setze danach auf dem VPS in `/opt/tallycall/.env` den Wert `ALLOW_SIGNUP=0` und starte neu (`cd /opt/tallycall && docker compose up -d`). Weitere Personen kommen dann nur noch per Einladung in ein Projekt. Ein Admin lädt sie unter **Projekteinstellungen → Mitglieder** ein. Wer noch kein Konto hat, braucht dafür vorübergehend `ALLOW_SIGNUP=1`.

## Betrieb
- **Logs:** `cd /opt/tallycall && docker compose logs -f app`
- **Status:** `docker compose ps`
- **Update:** einfach auf `main` pushen.
- **Rollback:** den fehlerhaften Commit zurücknehmen (`git revert`) und pushen.
- **Backups:** täglich um 03:15 nach `/opt/tallycall/backups` (14 Stück). Zusätzlich regelmäßig an einen anderen Ort kopieren, z. B. `rsync` auf einen zweiten Server. Wiederherstellung steht im Kopf von `deploy/backup.sh`.
- **Daten:** liegen im Docker-Volume `tallycall_tallycall-data` (Konten, Projekte, Sitzungsschlüssel). Das Deployment fasst sie nie an.

## Sicherheit in Kürze
- Der Deploy-Schlüssel gehört nur zu diesem einen Benutzer ohne Passwort-Login. Gib ihn nirgends sonst ein.
- Root-Login per Passwort besser abschalten (`PermitRootLogin prohibit-password` und `PasswordAuthentication no` in `/etc/ssh/sshd_config`), sobald dein eigener Schlüssel funktioniert.
- Halte das System aktuell. Unattended-Upgrades ist aktiv, ein Neustart nach Kernel-Updates bleibt bei dir.

## Vor dem öffentlichen Start
- Impressum und Datenschutz auf der Landingpage sind noch Platzhalter (`#`). Echte Angaben eintragen.
- Marke "Tallycall" bei DPMA/EUIPO/USPTO prüfen und die Domain beim Registrar bestätigen.
- Das Deployment wurde noch nicht auf einem echten Server getestet. Beim ersten Lauf Logs beobachten.

## Eigenes SSL-Zertifikat (z. B. Wildcard)
Statt Let's Encrypt kannst du ein vorhandenes Zertifikat nutzen:
1. Auf dem VPS `/opt/tallycall/certs/fullchain.pem` (Zertifikat samt Zwischenzertifikaten) und `privkey.pem` (privater Schlüssel, `chmod 600`) ablegen. Der Ordner wird vom Deployment nie überschrieben und ist nicht im Git.
2. In `/opt/tallycall/.env` eintragen: `CADDYFILE=Caddyfile.cert`
3. `cd /opt/tallycall && docker compose up -d`
Das Zertifikat muss `tallycall.com` und `www.tallycall.com` abdecken (`*.tallycall.com` allein deckt die Hauptdomain nicht ab). Bei Verlängerung die Dateien ersetzen und `docker compose restart caddy` ausführen.

## Server-Admin, Preise und Rechtliches
- **Server-Admin:** Trage in `/opt/tallycall/.env` `ADMIN_EMAIL=deine@adresse.de` ein (das Setup-Skript macht das mit `--admin-email`). Nur diese Adresse sieht die Verwaltung (`/admin`), alle Projekte und alle Käufe. Alle anderen sehen nur eigene und mit ihnen geteilte Projekte. Danach `cd /opt/tallycall && docker compose up -d`.
- **Preis und Zahlung:** Unter *Verwaltung → Einstellungen* Preis (7,99 EUR), Hinweistext und den Stripe-Zahlungslink eintragen. In Stripe ein monatliches Produkt anlegen, einen Payment Link erzeugen, das Kundenportal aktivieren (damit Kunden selbst kündigen) und einen Webhook auf `https://tallycall.com/api/stripe/webhook` mit dem Ereignis `invoice.paid` anlegen. Das Signatur-Geheimnis kommt als `STRIPE_WEBHOOK_SECRET` in die `.env`.
- **Impressum und Datenschutz:** Unter *Verwaltung → Rechtliches* deine Angaben eintragen. Die Seiten `/impressum` und `/datenschutz` entstehen daraus (Deutsch und Englisch). Das sind Vorlagen, keine Rechtsberatung. Bei Verkauf an Verbraucher kommen ggf. AGB und Widerrufsbelehrung dazu.
- **OSC:** Port unter *Verwaltung → Einstellungen* setzen, siehe [`docs/OSC.md`](OSC.md).
