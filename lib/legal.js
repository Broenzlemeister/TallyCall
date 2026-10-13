// Impressum und Datenschutzerklärung aus den Angaben unter Verwaltung → Rechtliches.
// Das sind Vorlagen und keine Rechtsberatung: Vor dem Livegang prüfen (lassen).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (s) => esc(s).replace(/\r?\n/g, "<br>");

const DEFAULTS = () => ({
  name: "", form: "", street: "", zip: "", city: "", country: "Deutschland", email: "", phone: "", vatId: "", register: "", represented: "", contentResp: "",
  hoster: "IONOS SE, Elgendorfer Str. 57, 56410 Montabaur", hosterNote: "", logDays: 7, stripe: true, authority: "", disputeResolution: "no", extraImpressum: "", extraPrivacy: "",
  useCustomImpressum: false, customImpressum: "", useCustomPrivacy: false, customPrivacy: "", updated: "",
});
const fill = (l) => ({ ...DEFAULTS(), ...(l || {}) });
const addr = (l) => [l.name + (l.form ? " (" + l.form + ")" : ""), l.street, [l.zip, l.city].filter(Boolean).join(" "), l.country].filter(Boolean);
const missing = (l) => ["name", "street", "city", "email"].filter((k) => !String(l[k] || "").trim());

function impressum(legal, lang = "de") {
  const l = fill(legal), de = lang === "de", a = addr(l);
  const T = de ? {
    h: "Impressum", info: "Angaben gemäß § 5 DDG", rep: "Vertreten durch", contact: "Kontakt", mail: "E-Mail", tel: "Telefon", vat: "Umsatzsteuer-ID", vatNote: "Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG", reg: "Registereintrag", content: "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV",
    disp: "Verbraucherstreitbeilegung", dispNo: "Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.", dispYes: "Wir sind bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
    liab: "Haftung für Inhalte", liabT: "Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Die von Nutzerinnen und Nutzern in ihren Projekten gespeicherten Inhalte sind Inhalte der jeweiligen Nutzer. Bei Bekanntwerden von Rechtsverletzungen entfernen wir solche Inhalte umgehend.",
    links: "Haftung für Links", linksT: "Unser Angebot enthält ggf. Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Für diese fremden Inhalte übernehmen wir keine Gewähr. Verantwortlich ist stets der jeweilige Anbieter."
  } : {
    h: "Legal notice", info: "Information pursuant to § 5 DDG (Germany)", rep: "Represented by", contact: "Contact", mail: "Email", tel: "Phone", vat: "VAT ID", vatNote: "VAT identification number pursuant to § 27 a UStG", reg: "Commercial register", content: "Responsible for content pursuant to § 18 (2) MStV",
    disp: "Consumer dispute resolution", dispNo: "We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.", dispYes: "We are willing to take part in dispute resolution proceedings before a consumer arbitration board.",
    liab: "Liability for content", liabT: "As a service provider we are responsible for our own content on these pages under general law. Content stored by users in their projects is the content of the respective user. Once we become aware of infringements we remove such content without delay.",
    links: "Liability for links", linksT: "Our offer may contain links to third-party websites whose content we cannot influence. We accept no liability for such content. The respective provider is always responsible."
  };
  let h = `<h1>${T.h}</h1><h2>${T.info}</h2><p>${a.map(esc).join("<br>")}</p>`;
  if (l.represented) h += `<p>${T.rep}: ${esc(l.represented)}</p>`;
  h += `<h2>${T.contact}</h2><p>${l.email ? `${T.mail}: <a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}${l.phone ? `<br>${T.tel}: ${esc(l.phone)}` : ""}</p>`;
  if (l.vatId) h += `<h2>${T.vat}</h2><p>${T.vatNote}:<br>${esc(l.vatId)}</p>`;
  if (l.register) h += `<h2>${T.reg}</h2><p>${nl(l.register)}</p>`;
  const cr = l.contentResp || [l.name, l.street, [l.zip, l.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  h += `<h2>${T.content}</h2><p>${esc(cr)}</p>`;
  h += `<h2>${T.disp}</h2><p>${l.disputeResolution === "yes" ? T.dispYes : T.dispNo}</p><h2>${T.liab}</h2><p>${T.liabT}</p><h2>${T.links}</h2><p>${T.linksT}</p>`;
  if (l.extraImpressum) h += `<p>${nl(l.extraImpressum)}</p>`;
  return h;
}

function privacy(legal, lang = "de", { domain = "", plans = true } = {}) {
  const l = fill(legal), de = lang === "de", a = addr(l);
  const ctrl = `${a.map(esc).join("<br>")}${l.email ? `<br>${de ? "E-Mail" : "Email"}: <a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}${l.phone ? `<br>${de ? "Telefon" : "Phone"}: ${esc(l.phone)}` : ""}`;
  const days = Math.max(1, Number(l.logDays) || 7);
  const hoster = esc(l.hoster || (de ? "[Hosting-Anbieter eintragen]" : "[enter hosting provider]"));
  const auth = l.authority ? esc(l.authority) : de ? "der für uns oder für Ihren Wohnort zuständigen Datenschutzaufsichtsbehörde" : "the data protection authority responsible for us or for your place of residence";
  const upd = esc(l.updated || new Date().toISOString().slice(0, 10).split("-").reverse().join("."));
  if (de) {
    let h = `<h1>Datenschutzerklärung</h1><p>Stand: ${upd}</p>
<h2>1. Verantwortlicher</h2><p>${ctrl}</p>
<h2>2. Worum es geht</h2><p>Tallycall${domain ? " (" + esc(domain) + ")" : ""} ist ein Werkzeug zur Planung und Steuerung von Live-Events. Diese Erklärung beschreibt, welche personenbezogenen Daten wir dabei verarbeiten, wofür und auf welcher Rechtsgrundlage (Datenschutz-Grundverordnung, DSGVO).</p>
<h2>3. Hosting</h2><p>Die Anwendung läuft auf einem Server bei ${hoster}. Mit dem Anbieter besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. ${esc(l.hosterNote)}</p>
<h2>4. Zugriffsdaten (Server-Logfiles)</h2><p>Beim Aufruf der Seiten verarbeitet der Webserver technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, angeforderte Adresse, Statuscode, übertragene Datenmenge und Browser-Kennung. Die Verarbeitung dient dem sicheren und stabilen Betrieb und der Abwehr von Missbrauch (Art. 6 Abs. 1 lit. f DSGVO). Protokolle werden rotiert und nach spätestens ${days} Tagen gelöscht oder überschrieben.</p>
<h2>5. Cookies und lokale Speicherung</h2><p>Wir setzen ausschließlich technisch notwendige Speicherungen ein (§ 25 Abs. 2 Nr. 2 TDDDG): ein Sitzungs-Cookie („cl“) hält Sie nach der Anmeldung angemeldet, gültig bis zu 30 Tage oder bis zur Abmeldung. Im lokalen Speicher Ihres Browsers merken wir uns Ihre Spracheinstellung und Anzeigeeinstellungen (zum Beispiel zugeklappte Gruppen). Es gibt keine Tracking-, Analyse- oder Werbe-Cookies. Die Seiten laden keine Schriften, Skripte oder Inhalte von Drittservern.</p>
<h2>6. Konto und Anmeldung</h2><p>Für ein Konto verarbeiten wir Ihre E-Mail-Adresse, Ihren Namen, ein gesichertes (gehashtes) Passwort sowie Zeitpunkte von Registrierung und letzter Anmeldung. Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO). Die Daten werden gelöscht, wenn das Konto gelöscht wird, soweit keine gesetzlichen Aufbewahrungspflichten bestehen.</p>
<h2>7. Projekte, Mitglieder und Freigabe-Links</h2><p>In Projekten speichern Nutzer Ablaufpläne, Namen von Beteiligten, Notizen und ähnliche Inhalte. Für diese Inhalte ist die jeweilige Projektleitung verantwortlich, wir handeln insoweit als Auftragsverarbeiter nach Art. 28 DSGVO (auf Anfrage schließen wir einen Vertrag). Projekte sind nur für ihre Mitglieder sichtbar. Wer einen Freigabe-Link kennt, sieht die freigegebene Ansicht ohne Konto; Links lassen sich jederzeit widerrufen. Ein Aktivitätsprotokoll speichert pro Projekt Name und Aktion der Mitglieder, um Änderungen nachvollziehbar zu machen (Art. 6 Abs. 1 lit. b und f DSGVO).</p>
<h2>8. Trigger und Integrationen</h2><p>Der Server sendet Nachrichten nur an Ziele, die Nutzer selbst eingerichtet haben (zum Beispiel Medienserver oder Webhooks). Welche Daten dabei übertragen werden, bestimmen die Nutzer über die Nachrichtenvorlagen. Die Verantwortung für diese Empfänger liegt bei den Nutzern.</p>`;
    if (l.stripe && plans) h += `<h2>9. Zahlungen (Stripe)</h2><p>Für den kostenpflichtigen Pro-Tarif nutzen wir den Zahlungsdienstleister Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Irland (Stripe). Die Zahlung erfolgt auf Seiten von Stripe; wir erhalten E-Mail-Adresse, Zahlungsstatus, Betrag und eine Referenz, keine vollständigen Zahlungsdaten. Rechtsgrundlagen sind die Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) und gesetzliche Aufbewahrungspflichten für Buchungsbelege (Art. 6 Abs. 1 lit. c DSGVO, bis zu zehn Jahre). Stripe kann Daten auch in den USA verarbeiten; dafür bestehen Standardvertragsklauseln und/oder eine Zertifizierung nach dem EU-US Data Privacy Framework. Datenschutzhinweise von Stripe: https://stripe.com/de/privacy.</p>`;
    h += `<h2>${l.stripe && plans ? "10" : "9"}. Kontakt</h2><p>Wenn Sie uns schreiben, verarbeiten wir Ihre Angaben zur Bearbeitung der Anfrage (Art. 6 Abs. 1 lit. b oder f DSGVO) und löschen sie, sobald die Anfrage erledigt ist und keine Aufbewahrungspflicht besteht.</p>
<h2>${l.stripe && plans ? "11" : "10"}. Ihre Rechte</h2><p>Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO). Erteilte Einwilligungen können Sie jederzeit mit Wirkung für die Zukunft widerrufen. Zur Ausübung genügt eine formlose Nachricht an die oben genannte Adresse. Außerdem haben Sie das Recht, sich bei ${auth} zu beschweren.</p>
<h2>${l.stripe && plans ? "12" : "11"}. Sicherheit</h2><p>Die Übertragung ist per TLS verschlüsselt. Passwörter werden nur als Hash (scrypt) gespeichert. Zugriffe auf Projekte sind auf deren Mitglieder beschränkt.</p>
<h2>${l.stripe && plans ? "13" : "12"}. Änderungen</h2><p>Wir passen diese Erklärung an, wenn sich der Dienst oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.</p>`;
    if (l.extraPrivacy) h += `<p>${nl(l.extraPrivacy)}</p>`;
    return h;
  }
  let h = `<h1>Privacy policy</h1><p>Last updated: ${upd}</p>
<h2>1. Controller</h2><p>${ctrl}</p>
<h2>2. Scope</h2><p>Tallycall${domain ? " (" + esc(domain) + ")" : ""} is a tool for planning and running live events. This policy explains which personal data we process, why, and on what legal basis (GDPR).</p>
<h2>3. Hosting</h2><p>The application runs on a server operated by ${hoster}. A data processing agreement under Art. 28 GDPR is in place. ${esc(l.hosterNote)}</p>
<h2>4. Access data (server logs)</h2><p>When you visit the site, the web server processes technically necessary data: IP address, date and time, requested address, status code, amount of data and browser identifier. This serves secure and stable operation and abuse prevention (Art. 6(1)(f) GDPR). Logs are rotated and deleted or overwritten after at most ${days} days.</p>
<h2>5. Cookies and local storage</h2><p>We only use technically necessary storage: a session cookie (“cl”) keeps you signed in for up to 30 days or until you sign out. Your browser’s local storage remembers your language and display preferences (for example collapsed groups). There are no tracking, analytics or advertising cookies, and the pages load no fonts, scripts or content from third-party servers.</p>
<h2>6. Account and sign-in</h2><p>For an account we process your email address, name, a hashed password and the times of registration and last sign-in. Legal basis: performance of the contract (Art. 6(1)(b) GDPR). Data is deleted when the account is deleted, unless retention duties apply.</p>
<h2>7. Projects, members and share links</h2><p>Users store run-of-show plans, names of participants, notes and similar content in projects. The project owner is responsible for this content; we act as processor under Art. 28 GDPR (a contract is available on request). Projects are visible to their members only. Anyone with a share link sees the shared view without an account; links can be revoked at any time. An activity log stores name and action of members per project (Art. 6(1)(b) and (f) GDPR).</p>
<h2>8. Triggers and integrations</h2><p>The server only sends messages to targets that users configured themselves (for example media servers or webhooks). Users decide which data is transmitted through the message templates and are responsible for the recipients.</p>`;
  let n = 9;
  if (l.stripe && plans) h += `<h2>${n++}. Payments (Stripe)</h2><p>For the paid Pro plan we use Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Ireland (Stripe). Payment takes place on Stripe’s side; we receive email address, payment status, amount and a reference, not full payment details. Legal bases: contract performance (Art. 6(1)(b) GDPR) and statutory retention of accounting records (Art. 6(1)(c) GDPR, up to ten years). Stripe may also process data in the USA, based on standard contractual clauses and/or EU-US Data Privacy Framework certification. See https://stripe.com/privacy.</p>`;
  h += `<h2>${n++}. Contact</h2><p>If you write to us we process your details to handle the request (Art. 6(1)(b) or (f) GDPR) and delete them once it is resolved and no retention duty applies.</p>
<h2>${n++}. Your rights</h2><p>You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20) and to object to processing based on legitimate interests (Art. 21 GDPR). You can withdraw consent at any time with effect for the future. An informal message to the address above is sufficient. You also have the right to lodge a complaint with ${auth}.</p>
<h2>${n++}. Security</h2><p>Transmission is encrypted with TLS. Passwords are stored only as hashes (scrypt). Access to projects is restricted to their members.</p>
<h2>${n++}. Changes</h2><p>We update this policy when the service or the law changes. The version published here applies.</p>`;
  if (l.extraPrivacy) h += `<p>${nl(l.extraPrivacy)}</p>`;
  return h;
}

// Komplette Seite (HTML-Dokument)
function render(kind, legal, lang, opts = {}) {
  const l = fill(legal), custom = kind === "impressum" ? l.useCustomImpressum && l.customImpressum : l.useCustomPrivacy && l.customPrivacy;
  const body = custom ? (kind === "impressum" ? l.customImpressum : l.customPrivacy) : kind === "impressum" ? impressum(l, lang) : privacy(l, lang, opts);
  const de = lang === "de", title = kind === "impressum" ? (de ? "Impressum" : "Legal notice") : (de ? "Datenschutz" : "Privacy");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,follow"><title>${title} · Tallycall</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css">
<style>.lg { max-width:760px; margin:0 auto; padding:34px 20px 80px; } .lg h1 { font-size:32px; letter-spacing:-.03em; margin:26px 0 8px; } .lg h2 { font-size:17px; margin:26px 0 6px; letter-spacing:-.01em; } .lg p { color:var(--fg2); line-height:1.65; margin:0 0 10px; } .lg a { color:var(--focus); } .lgbar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; } .lgbar .sp { flex:1; } @media (max-width:600px) { .lg { padding:20px 14px 60px; } .lg h1 { font-size:26px; } .lgbar { gap:10px 14px; } .lgbar .sp { flex-basis:100%; height:0; } } .warn2 { background:#241c0a; border:1px solid #5a4417; color:#f5d68a; border-radius:10px; padding:10px 14px; font-size:13.5px; margin-top:16px; }</style></head><body>
<div class="lg"><div class="lgbar"><a class="brand" href="/"><img src="/logo.svg" alt="">Tallycall</a><span class="sp"></span><a href="/impressum${de ? "" : "?lang=en"}">${de ? "Impressum" : "Legal notice"}</a><a href="/datenschutz${de ? "" : "?lang=en"}">${de ? "Datenschutz" : "Privacy"}</a><a href="?lang=${de ? "en" : "de"}">${de ? "English" : "Deutsch"}</a></div>
${opts.incomplete && !custom ? `<div class="warn2">${de ? "Hinweis für den Betreiber: Die Angaben sind noch unvollständig (Verwaltung → Rechtliches)." : "Note for the operator: details are incomplete (Admin → Legal)."}</div>` : ""}
${body}</div></body></html>`;
}

module.exports = { DEFAULTS, fill, impressum, privacy, render, missing };
