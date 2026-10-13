#!/bin/bash
# Update auf dem Server (läuft als Benutzer "deploy"). Bootstrap verlinkt es als /usr/local/bin/tallycall-update.
# GitHub Actions ruft nur diesen Befehl per SSH auf. Der Server zieht den Code selbst aus GitHub.
set -e
cd "$(dirname "$(readlink -f "$0")")/.."
# Als root gestartet? Dann als Besitzer des Ordners weiterlaufen (git verweigert sonst "dubious ownership").
OWNER=$(stat -c %U .)
if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ]; then exec sudo -u "$OWNER" -H "$(readlink -f "$0")" "$@"; fi
grep -q "^ADMIN_EMAIL=." .env 2>/dev/null || echo "HINWEIS: In .env fehlt ADMIN_EMAIL. Ohne sie ist das erste registrierte Konto Server-Admin. Eintragen: echo ADMIN_EMAIL=deine@adresse.de >> $(pwd)/.env"
echo "Sicherung der Daten."
./deploy/backup.sh || echo "  Sicherung übersprungen"
echo "Hole Änderungen."
git fetch origin main
git reset --hard origin/main
export TALLYCALL_COMMIT="$(git rev-parse --short=12 HEAD)"
echo "Baue Stand ${TALLYCALL_COMMIT}."
docker compose up -d --build --remove-orphans
sleep 6
docker compose ps
docker compose exec -T app wget -qO- http://localhost:4001/api/health && echo
docker image prune -f >/dev/null
echo "Fertig. Stand ${TALLYCALL_COMMIT}."
