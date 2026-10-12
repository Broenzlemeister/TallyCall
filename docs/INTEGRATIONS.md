# Trigger, API und Integrationen

Tallycall kann zwei Richtungen: **ausgehend** sendet es bei Ereignissen Nachrichten an Geräte und Dienste (Pixera, QLab, grandMA, Resolume, Companion, Webhooks). **Eingehend** lässt es sich per API-Schlüssel, Companion (Stream Deck) oder OSC steuern.

## Ausgehend: Ziele und Regeln

Alles unter **Projekt → Trigger**.

**Ziel** = ein Gerät oder Dienst:

| Typ | Felder | Typische Geräte |
|---|---|---|
| HTTP | URL, Methode (GET/POST/PUT), Header | Webhooks, Companion (HTTP-API, Port 8000), Home Assistant, Node-RED |
| OSC | Host, Port | QLab (53000), Resolume (7000), grandMA3, Reaper, TouchOSC |
| TCP | Host, Port | Pixera (1400, JSON-RPC), Medienserver, Lichtpulte mit Telnet-Protokoll |
| UDP | Host, Port | Einfache Textprotokolle |

**Regel** = bei Ereignis X die Nachricht Y an Ziel Z. Ereignisse: Punkt startet, Punkt endet, Weiter, Pause, Reset/Ende, Cue fällig (optional nur ein Gewerk), Nachricht gezeigt, Bauchbinde eingeblendet, Bereit-Meldung, Roll-Modus.

Zusätzlich lassen sich Trigger direkt an **einzelne Punkte** (beim Start / am Ende) und an **einzelne Cues** hängen: in der Planung den Punkt anklicken, dann „+ Trigger“ oder das ⚡ am Cue.

### Nachrichtenformat
- **OSC:** `/adresse arg1 arg2 …`. Ganzzahlen werden als int32, Dezimalzahlen als float32, `true`/`false` als Boolean, alles andere als String gesendet. Mit Anführungszeichen bleiben Leerzeichen erhalten: `/cue/name "Keynote Anna"`.
- **TCP/UDP:** Text wie eingegeben. `\n`, `\r`, `\t` werden zu Steuerzeichen.
- **HTTP:** Body wie eingegeben (bei GET ohne Body). Beginnt er mit `{` oder `[`, wird `Content-Type: application/json` gesetzt. Platzhalter gelten auch in der URL.

### Platzhalter
`{title}` `{subtitle}` `{presenter}` `{id}` `{type}` `{day}` `{show}` `{next}` `{remaining}` (mm:ss) `{remainingSec}` `{clock}` `{status}` `{cue}` `{gewerk}` `{gewerkShort}` `{message}` `{lowerTitle}` `{lowerSubtitle}` `{ready}` `{roll}` `{event}`

### Beispiele
Pixera, Timeline abspielen (Ziel TCP, Port 1400):
```
{"jsonrpc":"2.0","id":1,"method":"Pixera.Timelines.Timeline.play","params":{"handle":12345}}\n
```
Die Handle-Nummer liefert Pixera über `Pixera.Timelines.getTimelineFromName`. Alternativ Pixera-HTTP-API: Ziel HTTP, `http://IP:1400/api`, POST, gleicher Body.

QLab, Cue starten (Ziel OSC, Port 53000): `/cue/12/start` · grandMA3: `/cmd "Go+ Sequence 5"` · Resolume Clip: `/composition/layers/1/clips/3/connect 1`

Companion-Taste drücken (Ziel HTTP, `http://COMPANION-IP:8000/api/location/1/2/3/press`, POST, Body leer).

### Sicherheit
- Online-Server (`TALLYCALL_TRIGGERS=public`, Standard mit Konten): nur öffentliche Adressen. Private Netze (10.x, 192.168.x, 127.x, …) werden abgewiesen, damit niemand über den Server in fremde Netze funkt.
- Lokaler Server (`TALLYCALL_TRIGGERS=all`, Standard ohne Konten): alle Adressen, auch LAN.
- `TALLYCALL_TRIGGERS=off` schaltet den Versand ab.
- Maximal 30 Nachrichten pro Sekunde je Projekt, 5 s Zeitlimit je Nachricht. Das Sendeprotokoll zeigt Erfolg und Fehler.

**Online-Server + Gerät im Veranstaltungsnetz:** Der Server erreicht das LAN nicht. Dann triggert Companion vor Ort (siehe unten) oder ein lokaler Tallycall-Server (Docker/`start.sh` im Venue-Netz).

## Eingehend: API-Schlüssel

Projekt → Trigger → **Schlüssel erstellen** (Admin). Bereich „Steuern“ oder „Nur lesen“. Der Schlüssel `tc_…` wird einmal angezeigt.

Alle Aufrufe mit `Authorization: Bearer tc_…` oder `?token=tc_…`:

| Aufruf | Zweck |
|---|---|
| `GET /api/p/<id>/status` | Kompakter Zustand (laufender Punkt, Restzeit, Nächster, Bereit-Stand, Tage, Bauchbinden) |
| `GET /api/p/<id>/state` | Voller Zustand |
| `GET /api/p/<id>/events` | Live-Strom (Server-Sent Events) |
| `GET /api/p/<id>/cmd/<befehl>` | Befehl ausführen, Antwort = Status |
| `POST /api/p/<id>/action` | Aktion als JSON, z. B. `{"type":"next"}` |

Befehle für `cmd`: `next` `prev` `start` `pause` `toggle` `stop` `add?min=1` `sub?min=1` `load?id=…` `day?id=…` `roll?on=1` `ready?g=licht&state=ready` `message?text=…&visible=1` `lower?id=…` `lower?visible=0` `readyReset`

Per Schlüssel sind nur Steueraktionen erlaubt, keine Planungsänderungen. Stream Deck ohne Companion: Aktion „System → Website“ mit der `cmd`-URL inklusive `?token=`.

## Companion (Stream Deck)

Modul unter `integrations/companion` (siehe README dort). Aktionen, Rückmeldungen (Farben) und Variablen für Tasten. Companion übernimmt dann auch das Triggern von Pixera & Co. im LAN über seine eigenen Module.

## OSC-Eingang (lokaler Server)

`OSC_PORT=9000` beim Start setzen. Adressen: `/tallycall/<projekt-id>/<befehl>` oder `/tallycall/<befehl>` (alle Projekte). Befehle wie oben, Argumente als OSC-Argumente: `/tallycall/abc123/add 2`, `/tallycall/ready licht ready`, `/tallycall/message "Bitte Ende" 1`, `/tallycall/lower hide`.
