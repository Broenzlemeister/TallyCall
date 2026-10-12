# Tallycall auf einem eigenen VPS betreiben

Ziel: Jeder Push auf `main` testet den Code in GitHub Actions und lädt ihn danach automatisch auf deinen Server. HTTPS und Zertifikate übernimmt Caddy.

## Was du brauchst
- Ein VPS mit **Ubuntu 24.04 LTS** (22.04 geht auch), mindestens 1 vCPU und 1 GB RAM (2 GB sind komfortabel).
- Die Domain **tallycall.com**: A-Record für `@` und `www` auf die IP des VPS (bei IPv6 zusätzlich AAAA). `www` leitet auf die Hauptdomain um. Stand 12.10.2026 ist die Domain per DNS noch nicht delegiert, also zuerst registrieren.
- Root-Zugang per SSH für die einmalige Einrichtung.

## 1. SSH-Schlüssel nur für das Deployment erzeugen (auf deinem Rechner)
```sh
ssh-keygen -t ed25519 -f tallycall-deploy -C "tallycall-actions" -N ""
```
Das erzeugt `tallycall-deploy` (privat, geheim) und `tallycall-deploy.pub` (öffentlich).

## 2. VPS einmalig einrichten
Per SSH als root auf dem VPS, mit dem Inhalt von `tallycall-deploy.pub`:
```sh
curl -fsSL https://raw.githubusercontent.com/Broenzlemeister/tallycall/main/deploy/bootstrap.sh -o bootstrap.sh   # bei privatem Repo: Datei stattdessen per scp hochladen
bash bootstrap.sh --domain tallycall.com --key "ssh-ed25519 AAAA… tallycall-actions"
```
Bei einem **privaten Repo** funktioniert die `curl`-Zeile nicht ohne Anmeldung. Lade `deploy/bootstrap.sh` dann einfach per `scp deploy/bootstrap.sh root@DEINE-IP:` hoch.

Das Skript installiert Docker, schaltet die Firewall auf 22/80/443, aktiviert Sicherheitsupdates und fail2ban, legt den Benutzer `deploy` an (nur mit deinem Schlüssel), erzeugt `/opt/tallycall/.env` und richtet ein tägliches Backup ein.

## 3. Geheimnisse in GitHub eintragen
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Inhalt |
|---|---|
| `VPS_HOST` | IP oder Hostname des VPS |
| `VPS_SSH_KEY` | kompletter Inhalt der **privaten** Datei `tallycall-deploy` |
| `VPS_USER` | `deploy` (Standard, kann entfallen) |
| `VPS_PORT` | nur falls SSH nicht auf Port 22 läuft |
| `VPS_KNOWN_HOSTS` | empfohlen: Ausgabe von `ssh-keyscan -H DEINE-IP`, damit der Server-Fingerabdruck fest hinterlegt ist |

Optional unter **Settings → Environments → production** Freigabe durch dich verlangen, dann deployt GitHub erst nach deinem Klick.

## 4. Erstes Deployment
Auf `main` pushen (oder **Actions → CI und Deployment → Run workflow**). Der Ablauf: Tests → Code per rsync nach `/opt/tallycall` → `docker compose up -d --build` → Health-Check. Danach läuft Tallycall unter `https://tallycall.com`. Das erste Zertifikat dauert einige Sekunden.

## 5. Erstes Konto und Registrierung schließen
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
