#!/bin/bash
# Baut das Kundenpaket (geschützter Code mit Lizenzprüfung) auf dem Server. Ergebnis: packages/tallycall-local.tgz
# Voraussetzung: Unter Verwaltung → Lizenz ist die Lizenzausstellung eingerichtet.
# Mit --portable entsteht statt Bytecode verschleierter JavaScript-Code, der auf jeder Node-Version und Architektur läuft.
set -e
cd "$(dirname "$(readlink -f "$0")")/.."
VOL=$(docker volume ls -q | grep -m1 'tallycall-data$' || true)
[ -n "$VOL" ] || { echo "Datenvolume nicht gefunden. Läuft die App (docker compose up -d)?"; exit 1; }
mkdir -p packages
docker run --rm -v "$PWD":/src -w /src -v "$VOL":/data:ro -e DATA_DIR=/data node:22-alpine \
  sh -c "npm ci --no-audit --no-fund >/dev/null && node tools/build-customer.js --out /src/packages/tallycall-local $*"
echo "Fertig: $(pwd)/packages/tallycall-local.tgz"
