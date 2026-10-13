# OSC mit Tallycall einrichten

OSC (Open Sound Control) ist ein einfaches Netzwerkprotokoll über UDP. Tallycall kann damit in beide Richtungen arbeiten:

- **Eingang:** Ein Pult, TouchOSC, Companion oder QLab steuert Tallycall (weiter, pausieren, Zeit, Bauchbinde …).
- **Ausgang:** Tallycall sendet bei Ereignissen Befehle an Geräte (QLab starten, Resolume-Clip, grandMA-Sequenz) und kann den Zustand (Restzeit, Titel, Fortschritt) laufend an Anzeigen schicken (Feedback).

> OSC läuft im Netzwerk vor Ort am besten über einen **lokalen** Tallycall-Server (`./start.sh` im Showbüro-Netz). Ein Server im Internet erreicht Geräte in einem Veranstaltungsnetz nicht, dort übernimmt **Companion** als Brücke (siehe Abschnitt „Online-Server“).

## 1. Eingang: Tallycall per OSC steuern

### Einschalten
1. **Server-Admin:** *Verwaltung → Server → OSC-Eingang* einen UDP-Port eintragen (z. B. `9000`) und speichern. Alternativ beim Start `OSC_PORT=9000 node server.js`. Der Port muss im Netzwerk erreichbar sein (Firewall: UDP 9000 erlauben, bei Docker `9000:9000/udp` freigeben).
2. **Projekt:** *Trigger → API-Schlüssel erstellen* (Bereich „Steuern“). Der Schlüssel `tc_…` wird einmal angezeigt. Er steht in der OSC-Adresse und bestimmt das Projekt. Wer den Schlüssel nicht kennt, kann nichts steuern. API-Schlüssel gehören zum Pro-Plan, im lokalen Modus ist alles freigeschaltet.

### Adresse
```
/tallycall/<API-Schlüssel>/<befehl> [argumente]
```
Beispiel: `/tallycall/tc_AbCd…/next`

Im **lokalen Modus ohne Konten** geht zusätzlich `/tallycall/<befehl>` (wirkt auf alle Projekte) und `/tallycall/<projekt-id>/<befehl>`.

### Befehle
| Befehl | Argumente | Wirkung |
|---|---|---|
| `next` / `prev` | – | nächster / vorheriger Punkt (läuft weiter, wenn die Show läuft) |
| `start` | optional Punkt-ID | Start oder Weiter nach Pause. Mit ID diesen Punkt starten |
| `pause` | – | Pause |
| `toggle` | – | Start/Pause umschalten |
| `stop` | – | aktuellen Punkt zurücksetzen |
| `add` / `sub` | Minuten (Standard 1) | Zeit dazugeben / abziehen |
| `load` | Punkt-ID | Punkt laden, ohne zu starten |
| `day` | Tag-ID | Tag wählen |
| `roll` | `0` oder `1` | Roll-Modus (Start nach Uhr) |
| `ready` | Gewerk-ID, `ready`/`wait`/leer | Bereit-Meldung eines Gewerks |
| `readyReset` | – | alle Bereit-Meldungen löschen |
| `message` | Text, optional `0`/`1` | Nachricht auf allen Screens zeigen (0 = ausblenden) |
| `lower` | Bauchbinden-ID, `show` oder `hide` | Bauchbinde einblenden / ausblenden |

Argumente sind normale OSC-Argumente (String, Integer, Float). IDs findest du in der Adresse der Planungsseite (`?sel=<id>`) oder unter `GET /api/p/<projekt>/status`.

### Beispiele
- **TouchOSC:** Taste mit Nachricht `/tallycall/tc_…/next`, Host = Server-IP, Port = OSC-Port.
- **QLab:** Netzwerk-Cue, Typ OSC, Ziel `Server-IP:9000`, Nachricht `/tallycall/tc_…/start`.
- **Companion (Generic OSC):** Aktion „Send message“, Pfad `/tallycall/tc_…/next`, Host/Port wie oben.
- **Reaper / Ableton / Max / Node-RED:** gleiche Adresse, UDP.

## 2. Ausgang: Tallycall sendet OSC

### Ziel anlegen
*Trigger → Ziele → + Ziel*: Typ **OSC**, Host (IP des Geräts), Port. Mit **Vorlage** setzt du Name und Standard-Port; die Beispielnachrichten stehen darunter. Die Ports sind Standardwerte, bitte am Gerät prüfen.

| Gerät | Port (Standard) | Beispielnachrichten |
|---|---|---|
| QLab | 53000 | `/go`, `/cue/12/start`, `/stop`, `/panic` |
| Resolume Arena | 7000 | `/composition/layers/1/clips/1/connect 1`, `/composition/columns/2/connect 1` |
| grandMA3 | 8000 | `/cmd "Go+ Sequence 1"`, `/cmd "Goto Cue 5 Sequence 1"` |
| ETC Eos | 8000 | `/eos/cue/1/fire`, `/eos/cue/1/5/fire` |
| Reaper | 8000 | `/action/1007` (Play), `/action/1016` (Stop) |

In QLab muss unter *Settings → Network* OSC-Zugriff erlaubt sein, in Resolume unter *Preferences → OSC* der Eingang aktiv, bei grandMA3 unter *Menu → In & Out → OSC* ein Eintrag mit Port und Zugriffsrechten, bei Eos unter *Setup → System → Show Control* OSC RX aktiviert.

### Wann senden
- **Regeln** (*Trigger → Regeln*): bei Ereignis X Nachricht Y an Ziel Z, für alle Punkte. Ereignisse: Punkt startet/endet, Weiter, Pause, Reset, Cue fällig (optional nur ein Gewerk), Nachricht, Bauchbinde, Bereit-Meldung, Roll-Modus.
- **Am Punkt** (*Planung → Punkt → Trigger*): beim Start oder am Ende dieses Punkts.
- **Am Cue** (*Planung → Cue → ⚡*): genau dann, wenn der Cue fällig wird.

Platzhalter in der Nachricht: `{title}` `{subtitle}` `{presenter}` `{id}` `{day}` `{show}` `{next}` `{remaining}` `{remainingSec}` `{clock}` `{cue}` `{gewerk}` `{gewerkShort}` `{message}` `{lowerTitle}` `{ready}` `{event}`

Beispiele:
- `/cue/{id}/start` → QLab-Cue mit der ID des Tallycall-Punkts (bei gleichen IDs)
- `/composition/layers/1/clips/3/connect 1` am Cue „Intro-Film starten“
- `/cmd "Go+ Sequence 5"` als Regel „Cue fällig“ für das Gewerk Licht

**Typen der Argumente:** ganze Zahlen werden als Integer gesendet, Dezimalzahlen mit Punkt als Float, `true`/`false` als Boolean, alles andere als String. Leerzeichen in Strings mit Anführungszeichen: `/cue/name "Keynote Anna"`.

### Feedback: Zustand laufend senden
Am OSC-Ziel **„Zustand laufend senden (Feedback)“** einschalten. Tallycall sendet dann bei jeder Änderung (und die Restzeit jede Sekunde) diese Adressen mit dem eingestellten Präfix (Standard `/tallycall`):

| Adresse | Typ | Inhalt |
|---|---|---|
| `/tallycall/status` | String | `idle`, `running`, `paused`, `stopped` |
| `/tallycall/title` `subtitle` `presenter` | String | laufender Punkt |
| `/tallycall/next` | String | nächster Punkt |
| `/tallycall/day` | String | aktueller Tag |
| `/tallycall/level` | String | `ok`, `warn`, `danger`, `over` |
| `/tallycall/running` | Integer | 1 = läuft |
| `/tallycall/remaining` | String | Restzeit `mm:ss` |
| `/tallycall/remaining/sec` | Integer | Restzeit in Sekunden (negativ = Überzeit) |
| `/tallycall/elapsed/sec` | Integer | abgelaufene Sekunden |
| `/tallycall/progress` | Float | 0 bis 1 |
| `/tallycall/message` `lower` | String | sichtbare Nachricht / Bauchbinde |
| `/tallycall/roll` | Integer | 1 = Roll-Modus |
| `/tallycall/ready/<gewerk-id>` | String | `ready`, `wait` oder leer |

In **TouchOSC** legst du Label-Elemente mit diesen Adressen an (Empfangsport = Port des Ziels in Tallycall), `progress` steuert einen Fader oder Balken.

## 3. Online-Server und Companion

Läuft Tallycall unter `tallycall.com` und stehen Pixera, QLab & Co. im Veranstaltungsnetz, erreicht der Server diese Geräte nicht (der Server sendet bewusst nur an öffentliche Adressen). So geht es trotzdem:

1. **Companion** auf einem Rechner im Venue-Netz installieren und das **Tallycall-Modul** importieren (Download auf der Website unter „Companion“).
2. In Companion Trigger anlegen: bei Variablenänderung `$(tallycall:title)` oder bei der Rückmeldung „Gewerk bereit“ die Aktion des Gerätemoduls ausführen (OSC, Pixera, QLab …).
3. Steuerung zurück: Stream-Deck-Tasten rufen die Tallycall-Aktionen auf, ohne dass ein Port geöffnet werden muss.

## 4. Fehlersuche
| Problem | Lösung |
|---|---|
| Status zeigt „Port konnte nicht geöffnet werden“ | Port belegt oder unter 1024. Anderen Port wählen. |
| Nichts passiert bei Eingangsbefehlen | Schlüssel richtig? Bereich „Steuern“? UDP-Port in der Firewall frei? Unter *Aktivität* in den Projekteinstellungen erscheint „OSC: …“, sobald ein Befehl ankam. |
| Ausgang kommt nicht an | Sendeprotokoll prüfen (*Trigger → Sendeprotokoll*). Bei Online-Servern sind private Adressen gesperrt. |
| Feedback ruckelt | Das Ziel empfängt nur auf seinem Port. Prüfen, dass kein anderes Programm denselben Port belegt. |
| Mit `wireshark` testen | Filter `udp.port == 9000`. Pakete beginnen mit `/tallycall/…`. |
