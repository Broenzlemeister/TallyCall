#!/usr/bin/env bash
# Einmalige Einrichtung eines frischen Ubuntu-VPS (22.04 oder 24.04 LTS) für Tallycall.
# Als root ausführen:  bash bootstrap.sh --domain tallycall.com [--key "ssh-ed25519 AAAA..."]  (ohne --key wird ein Schlüssel erzeugt und angezeigt)
# Was passiert: Docker, Firewall (22/80/443), automatische Sicherheitsupdates, fail2ban, Deploy-Benutzer mit nur dem
# übergebenen SSH-Schlüssel, Ordner /opt/tallycall mit .env, tägliches Backup per Cron.
set -euo pipefail
DOMAIN=""; KEY=""; USER_NAME="deploy"; APP_DIR="/opt/tallycall"; REPO="Broenzlemeister/tallycall"
while [ $# -gt 0 ]; do case "$1" in
  --domain) DOMAIN="$2"; shift 2;; --key) KEY="$2"; shift 2;; --user) USER_NAME="$2"; shift 2;; --dir) APP_DIR="$2"; shift 2;; --repo) REPO="$2"; shift 2;;
  *) echo "Unbekannte Option $1"; exit 1;; esac; done
[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen."; exit 1; }
[ -n "$DOMAIN" ] || { echo "Bitte --domain angeben (die Domain muss per A-Record auf diesen Server zeigen)."; exit 1; }
GENKEY=0
if [ -z "$KEY" ]; then
  # Kein Schlüssel übergeben: auf dem Server erzeugen und am Ende ausgeben (für das GitHub-Secret VPS_SSH_KEY).
  GENKEY=1; GK=$(mktemp -d); ssh-keygen -q -t ed25519 -N "" -C tallycall-actions -f "$GK/k"; KEY=$(cat "$GK/k.pub")
fi
case "$KEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "Der Schlüssel muss ein öffentlicher SSH-Schlüssel sein."; exit 1;; esac

. /etc/os-release 2>/dev/null || true
if [ "${ID:-}" != "ubuntu" ]; then echo "Hinweis: Das Skript ist für Ubuntu 22.04/24.04 gedacht (gefunden: ${PRETTY_NAME:-unbekannt}). Es sollte auch auf Debian laufen, ist dort aber nicht getestet."; fi
export DEBIAN_FRONTEND=noninteractive
echo "==> Pakete"
apt-get update -y
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades cron
if ! command -v docker >/dev/null; then echo "==> Docker"; curl -fsSL https://get.docker.com | sh; fi
docker compose version >/dev/null 2>&1 || apt-get install -y docker-compose-plugin
systemctl enable --now docker cron fail2ban

echo "==> Benutzer $USER_NAME"
id "$USER_NAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
grep -qF "$KEY" "/home/$USER_NAME/.ssh/authorized_keys" 2>/dev/null || echo "command=\"tallycall-update\",restrict $KEY" >> "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"; chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"

echo "==> Firewall"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> Code von GitHub holen ($REPO)"
install -d -o "$USER_NAME" -g "$USER_NAME" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  if git ls-remote "https://github.com/$REPO.git" HEAD >/dev/null 2>&1; then
    URL="https://github.com/$REPO.git"      # öffentliches Repo
  else
    # Privates Repo: Nur-Lese-Deploy-Key auf dem Server erzeugen, in GitHub eintragen lassen
    DK="/home/$USER_NAME/.ssh/github_deploy"
    [ -f "$DK" ] || sudo -u "$USER_NAME" ssh-keygen -q -t ed25519 -N "" -C "tallycall-server" -f "$DK"
    printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' "$DK" > "/home/$USER_NAME/.ssh/config"
    chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/config"; chmod 600 "/home/$USER_NAME/.ssh/config"
    echo; echo "=== Das Repo ist privat. Trage diesen Schlüssel in GitHub ein: ==="
    echo "Repo https://github.com/$REPO -> Settings -> Deploy keys -> Add deploy key"
    echo "Titel: Server, Schlüssel (Haken 'Allow write access' NICHT setzen):"; echo; cat "$DK.pub"; echo
    until sudo -u "$USER_NAME" git ls-remote "git@github.com:$REPO.git" HEAD >/dev/null 2>&1; do
      read -r -p "Eingetragen? Enter drücken zum Prüfen... " _ </dev/tty
    done
    URL="git@github.com:$REPO.git"
  fi
  sudo -u "$USER_NAME" git clone "$URL" "$APP_DIR"
fi
install -d -o "$USER_NAME" -g "$USER_NAME" "$APP_DIR/backups"
ln -sf "$APP_DIR/deploy/update.sh" /usr/local/bin/tallycall-update
chmod +x "$APP_DIR/deploy/update.sh" "$APP_DIR/deploy/backup.sh"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<ENV
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
# Nach dem Anlegen der ersten Konten auf 0 setzen, dann nur noch per Einladung:
ALLOW_SIGNUP=1
TZ_SHOW=Europe/Berlin
SESSION_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')
ENV
  chown "$USER_NAME:$USER_NAME" "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
fi
echo "==> Erster Start"
sudo -u "$USER_NAME" "$APP_DIR/deploy/update.sh" || echo "Erster Start fehlgeschlagen. Details: cd $APP_DIR && docker compose logs"

echo "==> Tägliches Backup (03:15)"
cat > /etc/cron.d/tallycall-backup <<CRON
15 3 * * * $USER_NAME $APP_DIR/deploy/backup.sh >> $APP_DIR/backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/tallycall-backup

if [ "$GENKEY" = 1 ]; then
  echo; echo "=================== GitHub-Secrets (einmalig eintragen) ==================="
  echo "VPS_HOST = $(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | cut -d' ' -f1)"
  echo "VPS_SSH_KEY = (alles zwischen den Linien, inklusive BEGIN/END-Zeilen)"
  echo "-----"; cat "$GK/k"; echo "-----"
  rm -rf "$GK"
  echo "Dieser private Schlüssel wird nur jetzt angezeigt. Kopiere ihn sofort nach GitHub."
  echo "==========================================================================="
fi
echo
echo "Fertig. Tallycall wurde bereits gestartet. Nächste Schritte:"
echo " 1) DNS: A-Record für $DOMAIN und www.$DOMAIN auf diese Server-IP (falls noch nicht geschehen)."
echo " 2) In GitHub die Secrets setzen (siehe docs/DEPLOY.md) und auf main pushen: Der Workflow ruft dann auf dem Server tallycall-update auf (git pull + Neubau)."
echo " 3) Danach läuft die App unter https://$DOMAIN (das Zertifikat holt Caddy automatisch)."
