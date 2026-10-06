#!/usr/bin/env bash
# Sichert die Daten (Konten, Projekte) aus dem Docker-Volume nach backups/ und behält die letzten 14 Sicherungen.
# Wiederherstellen: docker compose stop app && docker run --rm -v tallycall_tallycall-data:/data -v $PWD/backups:/b alpine sh -c "rm -rf /data/* && tar xzf /b/DATEI.tgz -C /data" && docker compose start app
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
VOL="$(docker volume ls -q | grep -E 'tallycall-data$' | head -1)"
[ -n "$VOL" ] || { echo "$(date -Is) Kein Datenvolumen gefunden (App noch nicht gestartet?)"; exit 0; }
F="backups/tallycall-$(date +%Y%m%d-%H%M).tgz"
docker run --rm -v "$VOL":/data:ro -v "$PWD/backups":/b alpine tar czf "/b/$(basename "$F")" -C /data .
ls -1t backups/tallycall-*.tgz | tail -n +15 | xargs -r rm --
echo "$(date -Is) Backup $F ($(du -h "$F" | cut -f1))"
