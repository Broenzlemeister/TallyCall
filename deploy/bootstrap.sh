#!/usr/bin/env bash
# Einmalige Einrichtung eines frischen Ubuntu/Debian-VPS für Tallycall.
# Als root ausführen:  bash bootstrap.sh --domain regie.example.com --key "ssh-ed25519 AAAA... tallycall-actions"
# Was passiert: Docker, Firewall (22/80/443), automatische Sicherheitsupdates, fail2ban, Deploy-Benutzer mit nur dem
# übergebenen SSH-Schlüssel, Ordner /opt/tallycall mit .env, tägliches Backup per Cron.
set -euo pipefail
DOMAIN=""; KEY=""; USER_NAME="deploy"; APP_DIR="/opt/tallycall"
while [ $# -gt 0 ]; do case "$1" in
  --domain) DOMAIN="$2"; shift 2;; --key) KEY="$2"; shift 2;; --user) USER_NAME="$2"; shift 2;; --dir) APP_DIR="$2"; shift 2;;
  *) echo "Unbekannte Option $1"; exit 1;; esac; done
[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen."; exit 1; }
[ -n "$DOMAIN" ] || { echo "Bitte --domain angeben (die Domain muss per A-Record auf diesen Server zeigen)."; exit 1; }
[ -n "$KEY" ] || { echo "Bitte --key mit dem öffentlichen SSH-Schlüssel für GitHub Actions angeben."; exit 1; }
case "$KEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "Der Schlüssel muss ein öffentlicher SSH-Schlüssel sein."; exit 1;; esac

export DEBIAN_FRONTEND=noninteractive
echo "==> Pakete"
apt-get update -y
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades rsync cron
if ! command -v docker >/dev/null; then echo "==> Docker"; curl -fsSL https://get.docker.com | sh; fi
docker compose version >/dev/null 2>&1 || apt-get install -y docker-compose-plugin
systemctl enable --now docker cron fail2ban

echo "==> Benutzer $USER_NAME"
id "$USER_NAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
grep -qF "$KEY" "/home/$USER_NAME/.ssh/authorized_keys" 2>/dev/null || echo "$KEY" >> "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"; chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"

echo "==> Firewall"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> App-Ordner $APP_DIR"
install -d -o "$USER_NAME" -g "$USER_NAME" "$APP_DIR" "$APP_DIR/backups"
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

echo "==> Tägliches Backup (03:15)"
cat > /etc/cron.d/tallycall-backup <<CRON
15 3 * * * $USER_NAME $APP_DIR/deploy/backup.sh >> $APP_DIR/backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/tallycall-backup

echo
echo "Fertig. Nächste Schritte:"
echo " 1) DNS: A-Record für $DOMAIN auf diese Server-IP (falls noch nicht geschehen)."
echo " 2) In GitHub die Secrets setzen (siehe docs/DEPLOY.md) und auf main pushen: Der Workflow lädt den Code nach $APP_DIR und startet Tallycall."
echo " 3) Danach läuft die App unter https://$DOMAIN (das Zertifikat holt Caddy automatisch)."
