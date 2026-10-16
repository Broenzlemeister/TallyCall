# E-Mail einrichten

Tallycall verschickt E-Mails für **Passwort zurücksetzen**, **Willkommen**, **Hinweis nach einer Passwortänderung** und **Ankündigungen**. Dafür braucht der Server Zugang zu einem Mailserver (SMTP). Tallycall bringt bewusst keinen eigenen Mailserver mit: Mails von einem frischen VPS landen sehr oft im Spam. Besser ist ein Postfach oder ein Versanddienst, der das schon sauber kann.

## 1. Zugangsdaten besorgen
Du brauchst Server, Port, Benutzername, Passwort und eine Absenderadresse auf deiner Domain (zum Beispiel `no-reply@tallycall.com`).

| Anbieter | Server | Port und Verschlüsselung | Benutzername |
|---|---|---|---|
| IONOS (Mail-Postfach) | `smtp.ionos.de` | 587, STARTTLS (oder 465, TLS) | die ganze Postfach-Adresse |
| Brevo | `smtp-relay.brevo.com` | 587, STARTTLS | SMTP-Login aus dem Konto |
| Mailgun | `smtp.mailgun.org` (EU: `smtp.eu.mailgun.org`) | 587, STARTTLS | `postmaster@mg.deine-domain` |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587, STARTTLS | SMTP-Zugangsdaten aus SES |

Die Absenderadresse muss beim Anbieter freigegeben sein (Postfach angelegt oder Domain verifiziert).

## 2. In Tallycall eintragen
**Verwaltung → Mail**: Server, Port, Verschlüsselung, Benutzername, Passwort und Absender eintragen, **Speichern**, dann **Testmail an mich senden**. Kommt sie an, ist alles bereit.

Alternativ per Umgebung (`.env`): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`starttls`, `tls` oder `none`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_REPLY_TO`. Was in der Verwaltung eingetragen ist, hat Vorrang. Wer ein selbst signiertes Zertifikat im internen Netz nutzt, setzt `SMTP_INSECURE_TLS=1`. `PUBLIC_URL` muss auf die echte Adresse zeigen (zum Beispiel `https://tallycall.com`), weil die Links in den Mails daraus gebaut werden.

## 3. Damit die Mails ankommen (DNS)
Beim Domain-Anbieter müssen für die Absender-Domain drei Einträge stimmen. Der Mailanbieter nennt die genauen Werte:
- **SPF** (TXT): erlaubt dem Anbieter, für deine Domain zu senden.
- **DKIM** (TXT oder CNAME): signiert die Mails.
- **DMARC** (TXT auf `_dmarc`): zum Beispiel `v=DMARC1; p=none; rua=mailto:du@deine-domain` für den Start.

Ohne diese Einträge landen Passwort-Mails bei Gmail und Outlook häufig im Spam.

## Was verschickt wird
- **Passwort vergessen:** Link auf der Anmeldeseite. Der Link gilt 1 Stunde und genau einmal, danach sind alle bestehenden Sitzungen beendet. Die Antwort ist immer gleich, damit niemand prüfen kann, welche Adressen ein Konto haben.
- **Passwort geändert:** Hinweis an die Konto-Adresse (nach Zurücksetzen oder Änderung im Konto).
- **Willkommen:** nach der Registrierung, mit dem Hinweis auf die Testphase.
- **Ankündigungen:** Verwaltung → Mail. Produktneuigkeiten gehen nur an Nutzer, die sich dafür angemeldet haben (Häkchen bei der Registrierung oder im Konto), mit Abmelde-Link und Impressumsangaben im Fuß. „Alle Nutzer“ ist für wichtige Betriebshinweise gedacht (Wartung, geänderte Bedingungen), nicht für Werbung. Der Versand läuft nacheinander mit kurzer Pause, damit der Anbieter nicht drosselt.

Die Mailtexte gibt es auf Deutsch und Englisch, je nach Sprache des Kontos.

## Rechtliches
- Werbliche Mails brauchen eine Einwilligung (Double-Opt-In ist in Deutschland üblich). Tallycall fragt per Häkchen bei der Registrierung und bietet einen Abmelde-Link. Ob dir das reicht, klärst du mit deiner Rechtsberatung.
- Der Mailanbieter ist Auftragsverarbeiter. Trage ihn in der Datenschutzerklärung ein (Verwaltung → Rechtliches, „Zusatztext Datenschutz“) und schließe einen Vertrag zur Auftragsverarbeitung ab.

## Fehlersuche
Die letzten Versuche samt Fehlermeldung stehen in Verwaltung → Mail unter „Letzte Mails“.
- `Anmeldung: 535 …`: Benutzername oder Passwort falsch (bei IONOS die ganze Adresse als Benutzername).
- `Der Server bietet kein STARTTLS an`: Port oder Verschlüsselung passen nicht zusammen (587 mit STARTTLS, 465 mit TLS).
- `RCPT TO: 550 …` oder `MAIL FROM: 553 …`: Die Absenderadresse ist beim Anbieter nicht freigegeben.
- Zeitüberschreitung: Der Server erreicht den Mailserver nicht (Firewall des Hosters sperrt manchmal Port 25 und 465, 587 ist meist offen).
