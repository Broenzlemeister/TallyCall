# Lizenzen und Code-Schutz

## Grundsatz
Was auf dem Rechner eines anderen läuft, lässt sich nie vollständig schützen. Tallycall setzt deshalb auf mehrere Schichten, die Kopieren aufwendig und riskant machen, und auf Technik plus Vertrag.

| Wo läuft der Code? | Schutz |
|---|---|
| **Online (tallycall.com)** | Der Server-Code verlässt den Server nie. Das Docker-Image enthält nur V8-Bytecode, keinen lesbaren Quelltext. Zum Browser gehen nur minimierte und verschleierte Skripte. Die Seiten-Logik, Konten, Zahlung, Lizenzen und Daten liegen auf dem Server. |
| **Kunde hostet selbst** | Geschützte Kundenversion: Bytecode, verschleierte Browser-Skripte, Lizenzprüfung fest eingebaut. Ohne Schlüssel 7 Tage Test mit allen Funktionen, danach Free (eine Show mit höchstens 60 Minuten Inhalt, keine Trigger und API-Schlüssel). |

Ehrlich gesagt: Entschlossene Fachleute können Browser-Code lesen und Bytecode umgehen. Das Ziel ist, dass sich Kopieren und Umgehen weniger lohnt als Kaufen (7,99 € im Monat), und dass du bei Verstößen den Rechtsweg hast. Wichtig dafür:
- **Repository privat lassen.** Der Quelltext darf nur auf deinem Server und bei dir liegen. Kunden bekommen nie das Repo, nur das Paket.
- Urheberrechtshinweis und Nutzungsbedingungen (AGB/Lizenzvertrag) mit Verbot von Weitergabe und Rückbau. Das Paket nennt das in der LIESMICH.
- Wertvolles bleibt auf dem Server: Zahlung, Konten, Cloud-Funktionen, Updates und Support gibt es nur mit Lizenz.

## Online-Dienst
Der Docker-Build ist zweistufig (`Dockerfile`). Die erste Stufe führt `tools/build-protect.js` aus und erzeugt den Bytecode und die verschleierten Browser-Skripte. Nur dieses Ergebnis kommt ins laufende Image. Jeder `tallycall-update` baut so.

Der Browser braucht die Skripte, sie lassen sich also nie ganz verbergen. Sie sind minimiert, Namen und Texte sind verschleiert, und es gibt keine Source-Maps.

## Lizenzschlüssel
- Format `TC1-…`: signiert mit Ed25519. Der private Schlüssel liegt nur auf dem Lizenzserver (Datenordner, `license-private.pem`, bitte in die Sicherung). Die Kundenversion enthält nur den öffentlichen Schlüssel und prüft offline. Ein Schlüssel lässt sich nicht fälschen oder in der Laufzeit ändern.
- Inhalt: Kunde, E-Mail, Ablaufdatum (oder unbefristet), Anzahl erlaubter Installationen, optional feste Installations-ID.
- Nach Ablauf gibt es 7 Tage Nachfrist, dann gelten die Free-Grenzen.
- **Abgleich** alle 12 Stunden, wenn Internet da ist: Verlängerungen kommen automatisch an (neuer Schlüssel), gesperrte Schlüssel werden erkannt, und der Schlüssel bindet sich an die Installation. Eine zweite Installation mit demselben Schlüssel wird gesperrt (Standard: eine Installation). Ohne Internet läuft die Lizenz bis zum Ablaufdatum.

## Einrichten (einmalig)
1. Verwaltung (`/admin`) → Reiter **Lizenz** → **Lizenzausstellung einrichten**. Sicherung des Datenordners nicht vergessen.
2. Kunde anlegen: Name, Laufzeit (Monate, 0 = unbefristet), Anzahl Installationen → **Schlüssel ausstellen**, Schlüssel kopieren.
3. Paket bauen, auf dem Server im Projektordner: `./deploy/package.sh` → `packages/tallycall-local.tgz` (mit `--portable` statt Bytecode verschleierter JavaScript-Code, läuft auf jeder Node-Version und Architektur). Per `scp` herunterladen und an den Kunden senden, den Schlüssel getrennt.
4. Der Kunde trägt den Schlüssel unter Verwaltung → Lizenz ein (oder `TALLYCALL_LICENSE`).

Verlängern: Reiter Lizenz → „+1 Monat“. Online verbundene Installationen holen den neuen Schlüssel von selbst. Umzug auf eine andere Maschine: „Zurücksetzen“ gibt die Installationen frei.

## Automatisch verkaufen
Bisher stellst du Schlüssel von Hand aus. Für Selbstbedienung kann ein zweites Stripe-Produkt („Tallycall Lokal“) per Webhook einen Schlüssel erzeugen und per E-Mail senden. Das ist der nächste Schritt, sobald es sich lohnt.

## Entwicklung
- `node tools/build-protect.js --out DIR` baut die geschützte Ausgabe (Online). `--dist --pub KEY.pem` baut die Kundenversion.
- `node tools/test-license.js` testet Schlüssel, Lizenzserver, Aktivierung, Sperre, Verlängerung und den geschützten Build.
- Quelltext-Start (`node server.js`) hat keine Lizenzprüfung. Sie ist nur in der Kundenversion eingebaut (Konstante `TC_BUILD`).
