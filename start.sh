#!/bin/sh
# Lokaler Betrieb ohne Login (alle im Netzwerk haben vollen Zugriff). Mit Konten starten: TALLYCALL_AUTH=on ./start.sh
cd "$(dirname "$0")" && TALLYCALL_AUTH="${TALLYCALL_AUTH:-off}" exec node server.js
