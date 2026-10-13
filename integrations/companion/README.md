# Tallycall für Bitfocus Companion (Stream Deck)

Steuert Tallycall von einem Stream Deck aus, zeigt Restzeit und Zustände auf den Tasten und **baut die Tasten aus deinem Projekt automatisch**. Legst du eine neue Bauchbinde, ein neues Gewerk oder einen neuen Tag an, erscheint wenige Sekunden später ein neues Preset.

## Installation
1. Modul herunterladen: auf tallycall.com unter „Trigger und Steuerung“ oder im Projekt unter **Trigger → Companion-Modul**. Die Datei heißt `companion-module-tallycall.tgz`.
2. In Companion: **Modules → Import module package** und die Datei auswählen. Danach unter **Connections → Add connection** nach „Tallycall“ suchen.

## Verbinden (drei Wege)
| Weg | Wann | Was du einträgst |
|---|---|---|
| **Verbindungscode** (empfohlen) | Online-Server oder lokal, ein Projekt je Verbindung | In Tallycall: Projekt → **Trigger → Schlüssel / Code erstellen**, den Code kopieren und einfügen. Der Code enthält Server, Projekt und Schlüssel. Er lässt sich im Projekt jederzeit widerrufen. Erfordert den Pro-Plan des Projekt-Besitzers. |
| **Konto-Login** | Du willst dich einfach mit deinem Konto anmelden | Serveradresse, E-Mail, Passwort und Projektname (oder leer, wenn dein Konto nur ein Projekt hat). |
| **Lokaler Server** | Tallycall läuft im Showbüro-Netz ohne Login | Serveradresse (z. B. `http://192.168.1.20:4001`) und Projektname, falls mehrere. |

Pro Projekt legst du eine eigene Verbindung an. So hat jede Show ihre eigene Tastenseite.

## Automatisch erzeugte Presets
Unter **Presets** findest du, nach Kategorien sortiert:
- **Transport:** Weiter, Zurück, Start/Pause mit Restzeit, Reset, Roll-Modus
- **Zeit:** ±1 und ±5 Minuten
- **Info:** laufender Punkt mit Restzeit, nächster Punkt
- **Bauchbinden:** ein Preset je gespeicherter Bauchbinde (schaltet ein und aus, leuchtet grün, solange sie live ist) und „Bauchbinde aus“
- **Gewerke:** „Bereit“ und „Nicht bereit“ je Gewerk, grün/rot nach Zustand
- **Tage:** ein Preset je Tag
- **Ablauf je Tag:** ein Preset je Programmpunkt: grün = läuft, gelb = geladen, blau = als Nächstes
- **Nachricht:** Nachricht ausblenden

Presets ziehst du auf die Tastenseiten. Sie aktualisieren sich live, ohne dass du etwas neu importieren musst.

## Aktionen
Start, Pause, Start/Pause, Weiter (startet den ersten Punkt, wenn nichts geladen ist), Zurück, Reset, Zeit ±, Punkt starten, Punkt laden, Tag wählen, Roll-Modus, Bereit-Meldung, Bereit-Meldungen löschen, Nachricht ein/aus, Bauchbinde (gespeichert, umschalten oder Freitext) ein/aus.

## Rückmeldungen
Läuft, pausiert, Warnstufe (gelb/rot/Überzeit), Gewerk bereit / nicht bereit, Roll-Modus, Bauchbinde sichtbar (beliebige oder genau diese), Nachricht sichtbar, Punkt läuft / geladen / kommt als Nächstes, Tag gewählt.

## Variablen
`$(tallycall:remaining)`, `title`, `subtitle`, `presenter`, `next`, `day`, `status`, `level`, `elapsed`, `remaining_sec`, `added`, `message`, `lower`, `roll`, `project`, `ready_<gewerk-id>`.

## Geräte vor Ort triggern (Pixera, QLab …)
Läuft Tallycall online und die Geräte stehen im Veranstaltungsnetz, ist Companion die Brücke: Ein Companion-Trigger auf die Variable `$(tallycall:title)` oder die Rückmeldung „Gewerk bereit“ führt die Aktion des Gerätemoduls aus (OSC, Pixera, QLab, grandMA …).

## Selbst bauen
`node tools/build-companion.js` im Repo erzeugt `public/downloads/companion-module-tallycall.tgz` (braucht Internet für `npm install`).

Das Modul ist gegen die Companion-Modul-API 1.14 geschrieben und mit einer Attrappe der API gegen echte Tallycall-Server getestet (`node tools/test-companion.js`). Ein Test mit einer echten Companion-Installation steht noch aus.
