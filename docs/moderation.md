# Moderation in PeakPic

> **Entwurf, keine Rechtsberatung.** Dieses Dokument beschreibt, wie Moderation technisch umgesetzt ist, und listet offene Rechtsfragen. Vor einer Veröffentlichung von einer Fachperson prüfen lassen.

## Rollen

| Rolle | Darf | Darf nicht |
|---|---|---|
| Nutzer | melden, blockieren, Status eigener Meldungen sehen | Meldungen anderer, Rollen, Kontostatus lesen oder setzen |
| Moderator | Warteschlange, Meldungen öffnen, Inhalte entfernen und in Quarantäne setzen, verwarnen, bis 7 Tage sperren, Meldungen abschliessen | bannen, wiederherstellen, unbefristet sperren, E-Mail-Adressen sehen, Audit-Log lesen |
| Admin | alles vom Moderator, plus bannen, entsperren, wiederherstellen, E-Mail-Adressen (protokolliert), Audit-Log | sich selbst oder andere Moderatoren/Admins sperren oder bannen, Rollen vergeben (nur von Hand per SQL) |

- Rollen stehen in `admin_roles` (kein Client-Zugriff). Vergabe nur von Hand: `supabase/admin-setup.sql`.
- Jede Staff-Funktion verlangt zusätzlich eine Zwei-Faktor-Sitzung (`aal2`, TOTP). Ohne zweiten Faktor ist alles gesperrt.

## Ablauf: von der Meldung zur Entscheidung

1. **Melden** (App): Nutzer wählt einen Grund aus der festen Liste, optional bis 500 Zeichen Text. Der Server prüft, dass der Nutzer den Inhalt sehen darf, begrenzt auf 20 Meldungen pro 24 Stunden und eine Meldung pro Ziel.
2. **Nachrichten**: Beim Melden einer Chat-Nachricht speichert der Server eine Kopie der Nachricht und bis zu 5 Nachrichten davor und danach (`report_snapshots`). Moderatoren sehen Chats **nur** über diese Kopien. Es gibt keine Funktion, Chats frei zu lesen oder aufzulisten.
3. **Warteschlange** (`admin_report_queue`): nur Metadaten (Typ, Grund, Alter, Anzahl Meldungen zum selben Ziel).
4. **Öffnen** (`admin_report_detail`): zeigt den Inhalt, den Melder und das betroffene Konto. Wird protokolliert und setzt die Meldung auf „Wird geprüft“. Bilder nur über kurzlebige signierte URLs, und nur für gemeldete oder moderierte Inhalte.
5. **Entscheidung**, jeweils mit Pflicht-Begründung (mindestens 10 Zeichen) und optional einer Nachricht an den Betroffenen:
   - Inhalt entfernen (`mod_remove_content`): ausgeblendet für alle, auch für den Besitzer. Nichts wird gelöscht, Dateien bleiben.
   - Verwarnen (`mod_warn_user`): Hinweis erscheint beim Nutzer unter „Mitteilungen“.
   - Sperren (`mod_suspend_user`): Moderator bis 7 Tage, Admin auch unbefristet. Der Nutzer sieht den Text auf dem Screen „Konto gesperrt“.
   - Bannen (`mod_ban_user`, nur Admin).
   - Meldung abschliessen (`mod_resolve_report`): erledigt oder abgewiesen, mit Notiz. Der Melder sieht nur den Status.
6. **Korrektur**: Wiederherstellen (`mod_restore_content`) und Entsperren (`mod_unban_user`) nur durch Admins.

## Was ein Moderator oder Admin sieht

- Gemeldete Beiträge, Storys, Kommentare und Profile mit Inhalt und Bildern.
- Bei gemeldeten Nachrichten nur die gespeicherte Kopie mit Kontext, nie den übrigen Chat.
- Verlauf eines Kontos: frühere Meldungen gegen das Konto, Verwarnungen und Aktionen.
- Nutzersuche nach Username, Anzeigename oder ID (öffentliche Profildaten).
- E-Mail-Adresse nur Admins, mit Begründung, jeder Abruf wird protokolliert.

## Protokoll (`moderation_actions`)

- Jede Aktion und jedes Öffnen privater Inhalte (Meldung, Konto-Verlauf, E-Mail) erzeugt einen Eintrag in derselben Transaktion.
- Unveränderlich: Update, Delete und Truncate werden per Trigger abgelehnt, auch für Admins. Einzige Ausnahme: Beim Löschen eines Kontos entfernt `finish_account_deletion()` in derselben Transaktion Klartext über die Person (Text an den Nutzer, Namen in der Begründung). Alle anderen Spalten bleiben gleich, Zeilen lassen sich nie löschen.
- Referenzen auf Konten sind reine UUIDs ohne Fremdschlüssel, damit das Löschen eines Kontos nicht blockiert wird.

## Konto löschen

Sofort und endgültig, ohne Karenzfrist. Ablauf in der Edge Function `delete_account` (jeder Schritt wiederholbar):

1. Prüfen und `account_status = 'deleting'` setzen. Das Konto ist sofort unsichtbar und kann nichts mehr schreiben. Selbstlöschung: frische Anmeldung (Token und letzte Anmeldung höchstens 5 Minuten alt), Ziel immer das eigene Konto aus dem JWT. Admin-Löschung: Admin mit Zwei-Faktor, Begründung, Username als Bestätigung, protokolliert als `delete_account`.
2. Alle Dateien unter `{user_id}/` in allen Buckets löschen (in Batches).
3. `finish_account_deletion()`: Logs pseudonymisieren, Eintrag in `account_deletions` (nur SHA-256 der alten ID, Zeitpunkt, wer gelöscht hat).
4. Auth-Nutzer löschen; alle Zeilen des Kontos verschwinden per `on delete cascade`.

Bricht etwas ab, bleibt der Status `deleting`. Die App zeigt dann „Löschung wird abgeschlossen“ mit „Erneut versuchen“ und „Abmelden“; Admins wiederholen die Aktion im Dashboard.

**Nicht selbst löschbar** (Meldung „Löschung gerade nicht möglich, bitte wende dich an den Support“): laufende Sperre, Bann, Inhalte in Quarantäne. Diese Konten löscht bei Bedarf ein Admin (Nutzer-Detail → „Konto endgültig löschen“). Moderatoren- und Admin-Konten lassen sich gar nicht löschen, bis die Rolle per SQL entfernt ist (`supabase/admin-setup.sql`).

**Was bleibt (pseudonymisiert):** `moderation_actions` (UUID, Texte zum Nutzer entfernt, Namen in Begründungen ersetzt durch „[gelöschtes Konto]“), `reports` mit `target_user_id` (Melder wird `null`, Namen in Details und Notizen ersetzt), `report_snapshots` (Kopien gemeldeter Nachrichten mit `sender_id`, Namen ersetzt), `account_deletions` (nur Hash). Entfernte Inhalte des Kontos werden mitgelöscht, auch ihre Dateien.

**Tabellen beim Löschen eines Kontos** (neue Tabellen hier ergänzen):

| Ergebnis | Tabellen |
|---|---|
| Gelöscht (`on delete cascade`) | `profiles`, `username_history` (Name wird frei), `posts`, `post_media`, `post_tags`, `post_likes`, `comments`, `comment_likes`, `follows`, `stories`, `story_likes`, `story_views`, `highlights`, `highlight_items`, `audience_restrictions`, `conversation_members` (eigene Zeile), `messages` (eigene), `message_reactions`, `workout_shares`, `post_reposts`, `content_hashtags`, `notifications`, `training_plans`, `plan_days`, `plan_exercises`, `planned_rest_uses`, `plan_adoptions` (als Übernehmer), `workouts`, `workout_exercises`, `workout_sets`, `rest_budgets`, `rest_day_uses`, `user_blocks`, `admin_roles`, `moderation_notices`, `legal_confirmations`, `confirmation_followups` |
| Auf `null` gesetzt | `reports.reporter_id`, `messages.pinned_by`, `conversations.created_by`, `training_plans.adopted_from_user_id` (Kopien anderer behalten ihren Plan, Herkunft „Gelöschtes Konto“), `plan_adoptions.owner_id` |
| Nur UUID, Texte pseudonymisiert | `moderation_actions`, `reports.target_user_id`, `report_snapshots.sender_id` |
| Bereinigt | `stories.mentioned_user_ids` / `mention_positions` anderer |
| Ohne Bezug zu Konten | `usage_counters`, `usage_event_types`, `usage_meta` (nur Tagessummen pro Ereignis, keine Nutzer-ID). Das Löschen eines Kontos erhöht den Zähler `account_deleted`. |
| Bleibt | `account_deletions` (nur Hash) |

**Prüfen nach dem Löschen:** `supabase/check-deleted-user.sql` durchsucht alle Tabellen nach der alten ID.

## Trainingspläne

- Sichtbarkeit pro Plan: „Nur ich“, „Follower“ (bestätigte Follower) oder „Alle“ (nur bei öffentlichem Profil, sonst Follower). Gesperrte, gebannte, gelöschte und blockierte Konten sowie verborgene Personen sehen nichts (`can_view_plan`).
- Pläne sind meldbar (`target_type = 'plan'`). Die Moderation kann sie entfernen oder in Quarantäne setzen: dann sieht und übernimmt sie niemand mehr, der Besitzer behält seinen Plan mit einem Hinweis.
- Übernehmen (`adopt_plan`) erzeugt eine private Kopie ohne Zielgewichte und Notizen. Höchstens 10 Übernahmen pro Tag und 10 eigene Pläne. Der Ersteller bekommt (abschaltbar) eine Mitteilung pro Übernehmer und Plan, aber keine Liste der Übernehmer. `plan_adoptions` ist für Clients nicht lesbar.

## Aktivitäten (aufgezeichnete Trainings)

- Sichtbarkeit pro Aktivität: „Nur ich“ (Standard, einstellbar unter Einstellungen → Training), „Follower“ oder „Alle“ (nur bei öffentlichem Profil). Zusätzlich sieht den Trainingsbericht, wer den verknüpften Beitrag sehen darf, wenn „Trainingsbericht beim Beitrag zeigen“ an ist (`can_view_workout`). Gesperrte, blockierte und verborgene Personen sehen nichts.
- Aktivitäten sind meldbar (`target_type = 'workout'`) und können entfernt oder in Quarantäne gesetzt werden. Entfernte Aktivitäten zählen nicht mehr für den Streak und sind auch für den Besitzer nicht mehr sichtbar.
- Fotos zu einem Training zählen nie selbst als Nachweis; der Nachweis ist das Training (mit den Plausibilitätsregeln). So machen nachträgliche Fotos keinen anderen Tag und kein unplausibles Training zum Trainingstag.

## Möglicherweise illegale Inhalte

- **Quarantäne** (`mod_quarantine_content`): Inhalt sofort für alle ausser Admins verbergen. Nichts löschen, keine Dateien entfernen.
- Beweise sichern: Der Inhalt, die Meldung und das Protokoll bleiben in der Datenbank. Kein Herunterladen auf private Geräte.
- **Vor einer Meldung an Behörden Rechtsrat einholen.** Inhalte nicht weiterleiten oder teilen, auch nicht intern per Chat oder E-Mail.
- TODO: Ansprechstelle und Vorgehen für Behördenanfragen festlegen.

## Sperren und gebannte Konten

- Wirkt über `profiles.account_status`, nicht über einen Auth-Bann, damit der Nutzer den Grund sieht.
- Ein nicht aktives Konto kann nichts schreiben und sieht ausser sich selbst niemanden. Für andere ist es unsichtbar, seine Inhalte werden nicht gelöscht.
- Befristete Sperren laufen von selbst ab (Prüfung bei jeder Abfrage, kein Hintergrunddienst).
- Bestehende Sitzungen müssen deshalb nicht beendet werden (keine Edge Function mit service_role nötig).

## Platzhalter vor einer Veröffentlichung

- `SUPPORT_EMAIL` in `src/constants/app.ts`
- Kontaktadresse für Einsprüche und Behördenanfragen
- Aufbewahrungsfristen für Meldungen, Kopien von Nachrichten und das Protokoll
- Platzhalter `{{…}}` und TODOs in `docs/legal/*.md` (und danach in den Entwürfen im Dashboard)
- `MIN_AGE_YEARS` in `src/constants/app.ts` (derzeit 16)

## Rechtstexte

Drei Texte: **Nutzungsbedingungen** (werden akzeptiert), **Datenschutzerklärung** und **Community-Richtlinien** (werden nur zur Kenntnis genommen; das ist eine Information, keine Einwilligung).

**Ablauf**

1. Entwürfe anlegen: `supabase/seed-legal.sql` im SQL-Editor ausführen (legt Version 1 jedes Textes als Entwurf an, veröffentlicht nichts) oder im Dashboard „Neuer Entwurf“ (kopiert die letzte Version).
2. Im Dashboard unter **Rechtstexte** bearbeiten: Markdown, Vorschau, Vergleich zur Vorversion, kurze Zusammenfassung „Was hat sich geändert“.
3. Juristisch prüfen lassen. Platzhalter und TODOs ersetzen.
4. **Veröffentlichen** (nur Admin, mit Begründung): Die Vorversion wird archiviert, der Text bekommt einen Hash und ist ab dann unveränderlich. Alle aktiven Konten bekommen eine Mitteilung in der App (keine Push-Mitteilung). Neue Registrierungen brauchen sofort die neue Version.
5. In der App: Nach dem Login erscheint jeder offene Text einzeln. „Später“ gibt es nur, wenn der Text nicht blockierend ist und die Person eine frühere Version bestätigt hat. Sonst nur bestätigen oder abmelden.
6. **Offene Bestätigungen**: 5 Tage (Frist pro Version einstellbar) nach der Ankündigung erscheint ein Konto dort. Erinnern, E-Mail, zurückstellen oder sperren verschiebt die nächste Prüfung um 5 Tage. Die Fälligkeit wird beim Lesen berechnet, es gibt keinen Hintergrunddienst.
7. Sperre wegen offener Bestätigung (`terms_pending`, nur Admin, einzeln): Die Person sieht den Sperrtext und kann die Texte direkt bestätigen. Dann wird die Sperre automatisch aufgehoben und protokolliert (`auto_unsuspend_terms`). Andere Sperren bleiben bestehen.

**Was gespeichert wird:** pro Bestätigung Konto, Version, Art, Serverzeit, Hash des Textes zum Zeitpunkt der Bestätigung und App-Version. Keine IP-Adresse, keine Gerätedaten. Bestätigungen lassen sich nicht ändern oder löschen, ausser zusammen mit dem Konto.

**Registrierung:** zwei leere Checkboxen (Nutzungsbedingungen akzeptieren; Datenschutzerklärung gelesen, erst anklickbar nach dem Öffnen des Textes) und die Altersbestätigung. Ohne veröffentlichte Nutzungsbedingungen und Datenschutzerklärung ist keine Registrierung möglich.

## Offene Rechtsfragen

- Aufbewahrungsdauer von Meldungen, Snapshots und `moderation_actions`, auch nach dem Löschen eines Kontos (bleiben pseudonymisiert stehen).
- Darf der Inhalt gemeldeter Nachrichten samt Kontext gespeichert und von Moderatoren eingesehen werden? Hinweis in der Datenschutzerklärung nötig.
- Pflichten nach Digital Services Act (Meldeverfahren, Begründung von Entscheidungen, Beschwerdeweg) und nach Schweizer Recht prüfen.
- Umgang mit Behördenanfragen und mit möglicherweise strafbaren Inhalten (Meldepflichten, Beweissicherung).
- Mindestalter und Umgang mit Konten Minderjähriger.
- Rechtstexte: Inhalt aller drei Entwürfe, insbesondere Haftung, Gerichtsstand, Rechtsgrundlagen, Auslandsübermittlung (Supabase, E-Mail-Anbieter) und Aufbewahrungsfristen.
- Reicht „zur Kenntnis genommen“ für die Datenschutzerklärung, und ist die Checkbox bei der Registrierung so zulässig (keine Kopplung an eine Einwilligung)?
- Reicht eine Mitteilung in der App für Änderungen der Nutzungsbedingungen, oder braucht es zusätzlich eine E-Mail? Ist die Sperre bis zur Annahme zulässig, oder braucht es ein Kündigungsrecht beziehungsweise eine Frist?
- Aufbewahrungsdauer der Bestätigungen (Nachweis) und Umgang damit nach dem Löschen eines Kontos.
- Wird das Alter nur bestätigt (wie jetzt) oder muss es geprüft werden?
- Kontolöschung: Ist es zulässig, `moderation_actions`, Meldungen und Kopien gemeldeter Nachrichten nach dem Löschen pseudonymisiert (UUID statt Name) aufzubewahren, und wie lange? Ist die UUID zusammen mit anderen Daten noch personenbezogen? Reicht das Entfernen von Namen in Freitexten?
- Kontolöschung: Inhalte, die als Beweis gesichert werden müssten (Quarantäne), blockieren die Selbstlöschung. Ist das zulässig, und wie lange darf eine Löschung so aufgeschoben werden?
- Anonyme Nutzungsstatistik: Reicht „berechtigtes Interesse“ für das Zählen von Bildschirmaufrufen ohne Personenbezug, und braucht es dafür eine Einwilligung (Standard an, abschaltbar)? Supabase führt zusätzlich eigene technische Zugriffsprotokolle (API-Anfragen); deren Inhalt und Aufbewahrung klären.
- Supabase führt eigene Auth-Protokolle (`auth.audit_log_entries`, mit Nutzer-ID und teils E-Mail). Aufbewahrung und Löschung dort klären.
- Erwähnungen (@username) in Texten anderer bleiben stehen. Weil der Username frei wird, kann er später auf ein neues Konto zeigen.

## Spätere Phasen

- Datenexport für Nutzer (Auskunft und Datenübertragbarkeit; nicht umgesetzt).
