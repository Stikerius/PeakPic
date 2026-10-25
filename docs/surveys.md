# Umfragen und offizielle Beiträge

Eine **Umfrage** („Survey“) besteht aus bis zu 10 Fragen. Veröffentlichte Umfragen und ihre
Auswertungen sind **offizielle Beiträge** des offiziellen Kontos. Dieses Dokument beschreibt das
Datenmodell und die Server-Regeln (Phase 3). App-Ansichten und Dashboard folgen in eigenen
Abschnitten.

## Offizielles Konto

- Tabelle `official_account` mit genau einer Zeile (`id` ist immer `true`): `user_id`, `bio`
  (Beschreibung im Profil, bis 300 Zeichen).
- Gesetzt von Hand mit `supabase/official-account-setup.sql` (nicht Teil von `schema.sql`).
  Standard: das eigene Admin-Konto. Ein zweiter Lauf mit einem anderen Benutzernamen verschiebt die
  Rolle.
- Schutz, alles serverseitig:
  - Kein neuer Chat mit dem Konto (`get_or_create_direct_conversation` → `chat_not_possible`), keine
    Nachrichten von anderen in einen bestehenden Chat mit ihm (Trigger `messages_official_guard`).
    Servernachrichten wie Markierungshinweise bleiben möglich.
  - Keine Follower und keine Follow-Anfragen (`follow_not_possible`).
  - Niemand kann es blockieren (`block_not_possible`, Trigger auf `user_blocks`); frühere
    Blockierungen werden beim Ausführen des Schemas und des Setup-Skripts entfernt. Das offizielle
    Konto selbst darf andere blockieren.
  - Die App kennt nur seine Kennung (`get_official_account_id`) und zeigt dort weder „Folgen“ noch
    „Nachricht“ noch „Blockieren“, dafür das Abzeichen „Offiziell“. In einem älteren Chat mit ihm
    steht statt des Eingabefelds „Diesem Konto kann man nicht schreiben.“
  - In der Bereinigung geschützt (`reset_protection` = `protected`, Chats wie bei geschützten Konten).
  - Nicht löschbar, solange offiziell (`account_deletion_blocker` = `official`,
    `admin_request_account_deletion` → `cannot_delete_official`).
- Nach aussen nur öffentliche Profilfelder (`get_official_profile`): Benutzername, Name, Bild,
  Beschreibung, Abzeichen. Nie E-Mail-Adresse oder andere Kontodaten.

## Tabellen

Alle mit RLS und ohne direkten Zugriff für Clients. Einzige Ausnahme: `survey_item_views` darf jedes
Konto lesen, aber nur die eigenen Zeilen.

| Tabelle | Inhalt |
|---|---|
| `surveys` | Titel (3–120), Thema „Worum geht es“ (10–1000), Start, Ende (Pflicht zum Veröffentlichen, 1 Stunde bis 90 Tage nach dem Start), Abbruch (Zeit, Begründung, Antworten behalten ja/nein), `pin_until_answered`, `allow_text`, Anzeige im Feed (1–90 Tage, Standard 7) und im Profil (1–3650 Tage oder unbegrenzt, Standard 90), erreichbare Konten bei Start und Ende |
| `survey_questions` | Position 0–9 (also höchstens 10), Art `single`, `multiple`, `scale`, `yes_no`, `text`, Frage (3–200), Pflicht, Optionen (2–10, je 1–80, ohne Doppelte), `max_choices`, Skala 1–5, 1–10 oder 0–10, Freitext 20–280 Zeichen |
| `survey_media` | Bilder (`survey/{survey_id}/…` im Bucket `survey-media`) oder Logos aus der Logo-Bibliothek, Alternativtext 1–140 (Pflicht), Reihenfolge; höchstens 4 Bilder und 3 Logos je Umfrage und Bereich (`survey` oder `results`) |
| `survey_participation` | wer teilgenommen hat und wann (verhindert doppelte Teilnahme) |
| `survey_responses` | anonyme Antwort: zufällige Kennung, Umfrage, nur der Tag |
| `survey_answers` | Wert je Frage, dazu „verborgen“ (für die Auswertung) |
| `survey_items` | offizielle Beiträge: `survey` oder `results`, Veröffentlichung, sichtbar im Feed bis, im Profil bis (oder unbegrenzt), oben anheften, Status `visible`/`withdrawn`, bei Auswertungen ein unveränderlicher Snapshot |
| `survey_item_views` | je Konto und Beitrag: zuerst gesehen, ausgeblendet, beantwortet |
| `survey_counters` | Tagessummen je Umfrage und Ereignis, ohne Nutzer-ID |
| `survey_event_rate` | globaler Minutenzähler gegen Fluten, ohne Nutzer-ID |

## Anonymität

- Teilnahme (`survey_participation`) und Antworten (`survey_responses`, `survey_answers`) sind
  getrennt. Die Antworten haben keine Spalte mit Bezug zu einem Konto und keine Uhrzeit (nur den
  Tag in Europe/Zurich), die Kennung ist zufällig. Ein Test und die SQL-Prüfliste prüfen die
  Spalten.
- `submit_survey_response` schreibt Teilnahme und Antworten in einer Transaktion und gibt nur
  „Danke“ zurück. Antworten lassen sich danach nicht ändern (Trigger, auch für den Service-Key).
- Konto löschen und die Bereinigungs-Kategorie „Umfragen“ entfernen die Teilnahme; die anonymen
  Antworten bleiben.
- Restrisiko: Antworten nur eines Tages mit sehr wenigen Teilnahmen könnten über den Tag einer
  Teilnahme zugeordnet werden. Darum zeigt das Dashboard Auswertungen erst ab 5 Antworten ohne
  Warnung und veröffentlicht sie erst dann (Phase 5).

## Status

Ohne Hintergrunddienst bei jedem Lesen aus den Zeitstempeln berechnet (`survey_state`, gleich
`surveyState` in `shared/surveys.ts`):

| Status | Bedingung |
|---|---|
| Entwurf | nicht veröffentlicht |
| Geplant | veröffentlicht, Start noch nicht erreicht |
| Aktiv | ab dem Start (einschliesslich) bis zum Ende (ausschliesslich) |
| Beendet | Ende erreicht |
| Abgebrochen | `cancelled_at` gesetzt (gilt immer zuerst) |

Ebenso enden die Anzeige im Feed (`feed_until`) und im Profil (`profile_until`) ohne Dienst.

## Sichtbarkeit und Feed

Offizielle Beiträge sieht jedes aktive Konto, unabhängig vom Folgen, ausser über eine Blockierung
(in beide Richtungen) mit dem offiziellen Konto. Umfrage-Beiträge abgebrochener Umfragen und
zurückgezogene Beiträge sind für niemanden sichtbar.

`get_official_feed_items()` liefert `{top, items}`:

- **Oben** steht höchstens eine Umfrage und eine Auswertung: neu (noch nicht gesehen) oder bei
  „oben anheften bis beantwortet“ bis zur Antwort oder zum Ausblenden. Ältere Kandidaten fallen auf
  ihren normalen Platz. Beantwortete oder nicht mehr aktive Umfragen stehen nie oben.
- **items**: alle übrigen bis `feed_until`, nach Veröffentlichung sortiert (die App mischt sie nach
  Datum in den Feed).
- `mark_item_seen` (die App ruft es nach einer Sekunde Sichtbarkeit) setzt „gesehen“; beim nächsten
  Laden rückt die Karte an ihren Platz. Das erste Sehen zählt für die Reichweite (`card_shown`).
- `dismiss_item` blendet eine Karte aus. Laufende Umfragen bleiben unter Einstellungen erreichbar
  (`get_active_surveys`, mit Zähler offener Umfragen).
- Profil: `get_official_profile`, `get_official_profile_items(tab, before, limit)`.
- Teilnahme: `get_survey(id)` liefert die Fragen (ohne etwas über andere), `submit_survey_response`.

Alle Lesefunktionen geben nur die Felder zurück, die Nutzer sehen dürfen: nie E-Mail-Adressen, nie
Kennungen von Teilnehmenden, nie Rohantworten. Ein Test durchsucht ihre Antworten danach.

## Zähler

`track_survey_event(survey_id, event)` mit der Erlaubnisliste `card_shown`, `card_opened`,
`started`, `dismissed`, `results_shown`, `results_opened`, `profile_tab_opened`,
`settings_list_opened` (die letzten beiden ohne Umfrage). Es zählt nur Umfragen, die der Aufrufer
sehen kann, und speichert nichts über ihn. Grenzen: höchstens 3000 Ereignisse pro Minute insgesamt
und je Umfrage und Tag höchstens 30 je erreichbarem Konto (mindestens 500). „Abgeschickt“ kommt nie
aus Zählern, sondern aus `survey_participation`. Allgemeine Nutzungszähler: `survey_card_opened`,
`results_opened` (App) und `survey_submitted` (Server).

## Verwaltung (Admin mit Zwei-Faktor, alles protokolliert)

| Funktion | Regel |
|---|---|
| `admin_survey_list`, `admin_survey_get` | Liste mit Status, Teilnahmen, Quote; Details mit Fragen, Medien, Sperre |
| `admin_survey_save(id, survey)` | Entwurf anlegen oder ändern, alles wird erneut geprüft. Veröffentlicht ohne Antworten: Texte und Fragen änderbar, Start, Ende und Anzeigedauer bleiben. Ab der ersten Antwort gesperrt (`survey_locked`, auch per Trigger für den Service-Key) |
| `admin_survey_publish(id, 'VERÖFFENTLICHEN')` | Bestätigungswort und frische Zwei-Faktor-Bestätigung (höchstens 5 Minuten alt); offizielles Konto, 1–10 gültige Fragen, Ende gesetzt, Start jetzt oder geplant; setzt die erreichbaren Konten und legt den Beitrag an |
| `admin_survey_extend(id, ende)` | nur ein späteres Ende, höchstens 90 Tage nach dem Start |
| `admin_survey_cancel(id, grund, behalten)` | Begründung 10–500 Zeichen. Behalten: Antworten bleiben für die interne Auswertung. Verwerfen: Antworten, Teilnahmen und Zähler werden gelöscht. Der Umfrage-Beitrag verschwindet |
| `admin_survey_delete(id)` | nur Entwürfe |
| `admin_item_withdraw(id)` | zieht einen Beitrag sofort zurück |
| `admin_survey_media_*` | Logos hinzufügen, Alternativtext und Reihenfolge, entfernen (Medien einer veröffentlichten Auswertung bleiben) |

Das Protokoll enthält Titel, Zeiten und Prüfwerte (Hash) von Thema und Fragen, nie Antworten.

## Bilder

- Privater Bucket `survey-media`, Pfade `survey/{survey_id}/{bereich}-{zufall}.{png|jpg|webp}`.
- Lesen: Admins immer (Vorschau), Nutzer nur für Bilder eines Beitrags, den sie sehen
  (Storage-Policy mit `survey_media_readable`, signierte URLs mit kurzer Lebensdauer).
- Schreiben und Löschen nur über die Edge Function `survey_media_upload` (Admin mit Zwei-Faktor):
  prüft die Datei an ihren Bytes (PNG, JPEG oder WebP, höchstens 2 MB und 1600 Pixel je Seite, kein
  SVG), speichert unter zufälligem Pfad, registriert in `survey_media`. Der ursprüngliche Dateiname
  wird weder benutzt noch gespeichert. Nicht registrierte Dateien (älter als 10 Minuten) werden bei
  jedem Aufruf entfernt.
- Das Dashboard verkleinert und kodiert Bilder vor dem Upload im Browser neu (dabei verschwinden
  EXIF-Daten), Phase 5.

## Tests

- `src/lib/__tests__/surveys.test.ts`: Status an den genauen Grenzen, Fragen- und Antwortregeln,
  Bildprüfung.
- Datenbanktest (PGlite): TS- und SQL-Regeln stimmen an 1800 gültigen und manipulierten Fällen
  überein; doppelte Teilnahme unmöglich, Pflichtfragen, ungültige Optionen, nach Fristende keine
  Antwort, keine Verbindung zwischen Konto und Antworten (Spalten und Fremdschlüssel geprüft), keine
  Uhrzeit, Abbrechen mit „verwerfen“ löscht, Nutzer sehen nur erlaubte Felder und keine E-Mail,
  offizielles Konto nicht anschreibbar und nicht folgbar, Moderatoren und Nutzer verwalten nichts,
  Fragen nach der ersten Antwort gesperrt, Feed-Reihenfolge, Bereinigung, Storage-Leserechte.
- `supabase/reset-checks.sql`: Rechte, RLS, keine Personen- und Zeitspalten in den Antworten,
  Bucket privat, keine Schreib-Policies, jede Veröffentlichung protokolliert.

## Offene Punkte

- Median der Ausfülldauer: noch nicht erfasst (bräuchte eigene Zähler, Phase 5).
- Auswertung und ihr Snapshot (`admin_survey_results`, Veröffentlichen einer Auswertung): Phase 5.
