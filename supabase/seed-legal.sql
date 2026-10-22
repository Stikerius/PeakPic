-- PeakPic: drafts of the legal texts (generated from docs/legal/*.md).
--
-- Inserts version 1 of each text as status 'draft' only. Nothing is published here:
-- publishing happens in the dashboard (Rechtstexte -> Veröffentlichen), after the texts have
-- been completed and reviewed. Idempotent: an existing version 1 is left alone.
-- Run in the Supabase SQL editor after supabase/schema.sql.

insert into public.legal_documents (doc_type, version, title, body_md, status, confirmation_type, requires_confirmation, blocking, grace_days)
values ('terms', 1, 'Nutzungsbedingungen', $legal$# Nutzungsbedingungen von PeakPic

> ENTWURF – nicht rechtlich geprüft. Vor der Veröffentlichung von einer Fachperson prüfen lassen. Platzhalter in doppelten geschweiften Klammern ersetzen.

Stand: {{DATUM}}

## 1. Wer wir sind

PeakPic wird betrieben von {{BETREIBER_NAME}}, {{BETREIBER_ADRESSE}} (im Folgenden „wir“). Kontakt: {{KONTAKT_EMAIL}}.

## 2. Worum es geht

PeakPic ist eine App, in der du Fotos deiner Trainings teilst, einen Streak und einen Trainingsplan führst und anderen Personen folgst. Diese Bedingungen regeln die Nutzung der App. Mit der Registrierung akzeptierst du sie.

## 3. Konto

- Du musst mindestens {{MINDESTALTER}} Jahre alt sein. TODO: Mindestalter rechtlich klären; muss zu MIN_AGE_YEARS in der App passen.
- Du brauchst eine gültige E-Mail-Adresse und ein Passwort. Halte dein Passwort geheim.
- Pro Person ein Konto. Der Username muss eindeutig sein und darf niemanden nachahmen.
- Du kannst dein Konto jederzeit in den Einstellungen löschen. TODO: erst nach Umsetzung der Kontolöschung so stehen lassen.

## 4. Deine Inhalte

- Du bist für die Fotos, Texte, Kommentare und Nachrichten verantwortlich, die du einstellst.
- Du darfst nur Inhalte einstellen, an denen du die nötigen Rechte hast, und nur Personen zeigen oder markieren, die damit einverstanden sind.
- Die Rechte an deinen Inhalten bleiben bei dir. Du gibst uns das einfache, kostenlose Recht, sie in der App zu speichern und den Personen anzuzeigen, die sie nach deinen Einstellungen sehen dürfen (zum Beispiel nur Follower bei einem privaten Profil). Dieses Recht endet, wenn du den Inhalt oder dein Konto löschst, ausser wir müssen ihn aus rechtlichen Gründen aufbewahren.
- Storys sind 24 Stunden sichtbar, ausser du speicherst sie in einem Highlight.

## 5. Verhalten

Es gelten die Community-Richtlinien. Insbesondere verboten sind: Belästigung, Drohungen, Hassrede, sexuelle Inhalte, Gewaltdarstellungen, Inhalte, die Minderjährige gefährden, Spam, Betrug, das Ausspähen anderer Konten und jede rechtswidrige Nutzung.

## 6. Melden, Blockieren, Moderation

- Du kannst Konten blockieren und Inhalte oder Konten melden.
- Wir prüfen Meldungen. Wir können Inhalte entfernen oder ausblenden, Verwarnungen aussprechen und Konten befristet oder dauerhaft sperren. Du erhältst in der App einen Hinweis mit Begründung.
- Gegen eine Entscheidung kannst du dich an {{KONTAKT_EMAIL}} wenden. TODO: Beschwerdeverfahren nach DSA klären (Frist, Ablauf).
- Akzeptierst du geänderte Nutzungsbedingungen nicht, können wir dein Konto sperren, bis du sie akzeptierst.

## 7. Verfügbarkeit

Wir bemühen uns um einen stabilen Betrieb, garantieren aber keine ständige Verfügbarkeit. Wir können Funktionen ändern oder einstellen.

## 8. Haftung

{{HAFTUNGSKLAUSEL}}

TODO: von einer Fachperson formulieren lassen (Schweiz und EU, Verbraucherrecht).

## 9. Änderungen

Wir können diese Bedingungen ändern. Über Änderungen informieren wir in der App. Du siehst, was sich geändert hat, und entscheidest, ob du akzeptierst. Ältere Versionen findest du in der App unter Einstellungen → Rechtliches.

## 10. Recht und Gerichtsstand

Es gilt {{ANWENDBARES_RECHT}}. Gerichtsstand ist {{GERICHTSSTAND}}, soweit gesetzlich zulässig. TODO: prüfen.
$legal$, 'draft', 'accept', true, false, 5)
on conflict (doc_type, version) do nothing;

insert into public.legal_documents (doc_type, version, title, body_md, status, confirmation_type, requires_confirmation, blocking, grace_days)
values ('privacy', 1, 'Datenschutzerklärung', $legal$# Datenschutzerklärung von PeakPic

> ENTWURF – nicht rechtlich geprüft. Vor der Veröffentlichung von einer Fachperson prüfen lassen. Platzhalter in doppelten geschweiften Klammern ersetzen.

Stand: {{DATUM}}

## 1. Verantwortlich

{{BETREIBER_NAME}}, {{BETREIBER_ADRESSE}}, {{KONTAKT_EMAIL}}.

TODO: Braucht es eine Vertretung in der EU oder Schweiz (DSGVO Art. 27, DSG Art. 14) oder eine Datenschutzberatung?

## 2. Welche Daten wir bearbeiten

**Konto:** E-Mail-Adresse, Passwort (nur verschlüsselt gespeichert, bei unserem Anbieter Supabase), Username, frühere Usernames (bleiben für dich reserviert), Anzeigename, Profilbild, Bio, ob dein Profil privat ist, Zeitpunkt der Registrierung.

**Was du teilst:** Workout-Fotos und Bildunterschriften, Storys (24 Stunden sichtbar, ausser in Highlights), Kommentare, Likes, Reposts, Hashtags, Markierungen und Erwähnungen anderer Personen, Follows und Follow-Anfragen.

**Training:** Streak, Trainingsplan, Ruhetage.

**Nachrichten:** Direktnachrichten und Reaktionen. Sie sind nur für die Beteiligten sichtbar. Moderatoren sehen sie nicht, ausser jemand meldet eine Nachricht: Dann wird eine Kopie der gemeldeten Nachricht mit wenigen Nachrichten davor und danach für die Prüfung gespeichert.

TODO: Anzahl der Kontextnachrichten und Aufbewahrungsdauer eintragen.

**Sicherheit und Moderation:** Blockierungen, Einschränkungen (wer deine Storys oder Beiträge nicht sieht), Meldungen, die du machst oder die dich betreffen, Entscheidungen der Moderation und deren Protokoll, Kontostatus (aktiv, gesperrt).

**Rechtstexte:** welche Version der Nutzungsbedingungen, der Datenschutzerklärung und der Richtlinien du wann bestätigt hast, und die App-Version dabei. Wir speichern dabei keine IP-Adresse und keine Gerätedaten.

**Mitteilungen in der App:** zum Beispiel neue Follower, Likes, Kommentare und Hinweise zu geänderten Rechtstexten. Die App sendet derzeit keine Push-Mitteilungen.

**E-Mails:** für die Anmeldung (Bestätigung, Passwort zurücksetzen) und gegebenenfalls eine Erinnerung, geänderte Rechtstexte zu bestätigen. Für Erinnerungen nutzen wir {{EMAIL_ANBIETER}}.

**Kamera und Fotos:** Die App greift nur auf Kamera oder Fotomediathek zu, wenn du ein Foto aufnimmst oder auswählst, und nur mit deiner Erlaubnis. Fotos werden vor dem Hochladen neu als JPEG gespeichert.

TODO: prüfen und bestätigen, dass dabei Standortdaten (EXIF) entfernt werden.

Wir verwenden keine Werbung, kein Tracking und keine Analysedienste.

## 3. Wozu und auf welcher Grundlage

- Bereitstellung der App und deines Kontos (Vertrag).
- Sicherheit, Moderation, Schutz anderer Nutzer, Bearbeitung von Meldungen (berechtigtes Interesse, rechtliche Pflichten).
- Nachweis, welche Rechtstexte du bestätigt hast (berechtigtes Interesse, rechtliche Pflichten).

TODO: Rechtsgrundlagen und Pflichten aus dem Digital Services Act prüfen.

## 4. Wer die Daten sieht

- Andere Nutzer sehen, was du teilst, je nach deinen Einstellungen (öffentliches oder privates Profil, Einschränkungen, Blockierungen).
- Moderatoren und Administratoren sehen gemeldete Inhalte und die für die Prüfung nötigen Kontodaten. Jeder Zugriff auf private Inhalte wird protokolliert. Deine E-Mail-Adresse sehen nur Administratoren, mit Begründung und Protokoll.
- Unser Hosting-Anbieter Supabase speichert die Daten in unserem Auftrag (Region: {{SUPABASE_REGION}}).
- {{EMAIL_ANBIETER}} für den Versand von Erinnerungs-E-Mails, falls eingerichtet.
- Behörden, wenn wir gesetzlich dazu verpflichtet sind.

TODO: Auftragsverarbeitungsverträge und Übermittlung ins Ausland (zum Beispiel USA) angeben.

## 5. Wie lange

- Solange dein Konto besteht. Storys sind nach 24 Stunden nicht mehr sichtbar.
- Nach dem Löschen deines Kontos löschen wir deine Daten. Einträge im Moderationsprotokoll und Meldungen bleiben ohne Bezug zu deiner Person (pseudonymisiert) für {{AUFBEWAHRUNG_MODERATION}} erhalten.
- Bestätigungen von Rechtstexten: {{AUFBEWAHRUNG_BESTAETIGUNGEN}}.

TODO: Werden Story-Dateien nach 24 Stunden gelöscht? Ablauf festlegen. Absatz zur Kontolöschung erst nach deren Umsetzung so stehen lassen.

## 6. Deine Rechte

Du kannst Auskunft, Berichtigung, Löschung, Einschränkung und Datenübertragung verlangen und der Bearbeitung widersprechen. Schreib an {{KONTAKT_EMAIL}}. Du kannst dich bei der zuständigen Aufsichtsbehörde beschweren ({{AUFSICHTSBEHOERDE}}).

TODO: Ein Datenexport ist in der App noch nicht umgesetzt.

## 7. Sicherheit

Die Verbindung ist verschlüsselt. Wer welche Daten sehen darf, ist in der Datenbank selbst geregelt. Zugänge für Moderation und Administration brauchen eine Zwei-Faktor-Anmeldung.

## 8. Änderungen

Wir informieren in der App über Änderungen. Ältere Versionen findest du unter Einstellungen → Rechtliches.
$legal$, 'draft', 'acknowledge', true, false, 5)
on conflict (doc_type, version) do nothing;

insert into public.legal_documents (doc_type, version, title, body_md, status, confirmation_type, requires_confirmation, blocking, grace_days)
values ('guidelines', 1, 'Community-Richtlinien', $legal$# Community-Richtlinien von PeakPic

> ENTWURF – nicht rechtlich geprüft. Platzhalter in doppelten geschweiften Klammern ersetzen.

Stand: {{DATUM}}

PeakPic ist ein Ort, an dem man sich gegenseitig beim Training motiviert. Damit das so bleibt, gelten diese Regeln für Fotos, Storys, Kommentare, Nachrichten, Usernames und Profile.

## Nicht erlaubt

- **Belästigung und Mobbing:** andere beleidigen, bedrängen, blossstellen oder wiederholt ungefragt kontaktieren.
- **Hass:** Herabsetzung wegen Herkunft, Religion, Geschlecht, sexueller Orientierung, Behinderung oder ähnlicher Merkmale.
- **Gewalt und Drohungen:** Gewaltdarstellungen, Drohungen, Aufrufe zu Gewalt.
- **Sexuelle Inhalte und Nacktheit.** Sportkleidung ist in Ordnung.
- **Gefährdung Minderjähriger:** jede Form, ohne Ausnahme.
- **Selbstgefährdung:** Inhalte, die zu Essstörungen, gefährlichem Doping oder Selbstverletzung ermutigen.
- **Fremde Inhalte und Personen:** Fotos ohne Rechte daran, Fotos von Personen ohne deren Einverständnis, Markierungen gegen den Willen der Markierten.
- **Täuschung:** falsche Identitäten, Nachahmung anderer, fremde oder alte Fotos, um den Streak zu manipulieren.
- **Spam und Werbung** ohne Zustimmung, Betrug, Links zu schädlichen Seiten.
- **Rechtswidriges** jeder Art.

TODO: Meldepflichten bei strafbaren Inhalten klären. Klären, ob Streak-Manipulation eine Regel sein soll.

## Was du tun kannst

- **Blockieren:** Die Person sieht danach nichts mehr von dir und kann dich nicht mehr kontaktieren. Sie wird nicht benachrichtigt.
- **Einschränken:** Wähle, wer deine Storys oder Beiträge nicht sieht.
- **Melden:** Inhalte und Konten über das Menü melden. Die gemeldete Person erfährt nicht, wer gemeldet hat.

## Was wir tun

Wir prüfen Meldungen und entscheiden nach diesen Richtlinien. Mögliche Folgen: Inhalt entfernen oder vorübergehend ausblenden, Verwarnung, befristete oder dauerhafte Sperre. Du erhältst in der App einen Hinweis mit Begründung. Bei Fragen oder Widerspruch: {{KONTAKT_EMAIL}}.
$legal$, 'draft', 'acknowledge', true, false, 5)
on conflict (doc_type, version) do nothing;
