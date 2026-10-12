# Tallycall für Bitfocus Companion (Stream Deck)

Steuert Tallycall von einem Stream Deck aus und zeigt den Live-Zustand auf den Tasten: Restzeit, laufender Punkt, Warnfarbe, Bereit-Meldungen.

## Einrichten
1. In Tallycall das Projekt öffnen → **Trigger** → API-Schlüssel erstellen (Bereich „Steuern“). Den Schlüssel kopieren, er wird nur einmal gezeigt.
2. Companion (Version 3.x) → **Settings → Developer modules path** auf den Ordner `integrations/companion` dieses Repos zeigen lassen (oder den Ordner kopieren). Companion neu starten. Vorher einmal `npm install` im Ordner ausführen.
3. **Connections → Add → Tallycall**: Serveradresse (z. B. `https://tallycall.com` oder `http://192.168.1.20:4001`), Projekt-ID (aus der Adresse `/p/<id>/`) und Schlüssel eintragen.
4. Unter **Presets** liegen fertige Tasten: Weiter, Start/Pause mit Restzeit, +1/−1 Minute, Bereit-Tasten je Gewerk, Bauchbinde aus.

## Aktionen
Start, Pause, Start/Pause, Weiter, Zurück, Reset, Zeit ±, Punkt laden, Tag wählen, Roll-Modus, Bereit-Meldung, Nachricht ein/aus, Bauchbinde (gespeichert oder Freitext) ein/aus.

## Rückmeldungen
Läuft, pausiert, Warnstufe (gelb/rot/Überzeit), Gewerk bereit / nicht bereit, Roll-Modus, Bauchbinde sichtbar, Nachricht sichtbar.

## Variablen
`$(tallycall:title)`, `next`, `remaining`, `remaining_sec`, `elapsed`, `added`, `status`, `level`, `day`, `message`, `lower`, `ready_<gewerk>`.

## Pixera und andere Geräte vor Ort
Läuft Tallycall online und das Gerät im Veranstaltungsnetz, nutzt Companion seine eigenen Module (Pixera, QLab, Resolume …) und Trigger: Companion-Trigger „Variable ändert sich“ auf `$(tallycall:title)` oder die Rückmeldung „Gewerk bereit“ → Aktion im Pixera-Modul. So bleibt Tallycall der Taktgeber, Companion ist die Brücke ins LAN.

Hinweis: Das Modul wurde gegen die Companion-Modul-API 1.11 geschrieben und noch nicht in einer Companion-Installation getestet. Rückmeldungen sind willkommen.
