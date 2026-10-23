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
- Bei gemeldeten Nachrichten nur die gespeicherte Kopie mit Kontext, nie den übrigen Chat. Löscht der Absender die Nachricht später „für alle“, bleibt die Kopie erhalten; das Dashboard zeigt dann einen Hinweis, und Entfernen oder Quarantäne sind nicht mehr nötig (das Original ist weg).
- Nachrichten löschen: „Für mich löschen“ blendet eine Nachricht nur für die Person aus (`message_hidden`). „Für alle löschen“ (`delete_message_for_everyone`) entfernt die eigene Nachricht endgültig und ohne Spur. Von der Moderation entfernte oder in Quarantäne gesetzte Nachrichten kann niemand selbst löschen oder wiederherstellen. Eine schon gelöschte Nachricht lässt sich nicht mehr melden.
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
| Gelöscht (`on delete cascade`) | `profiles`, `username_history` (Name wird frei), `posts`, `post_media`, `post_tags`, `post_likes`, `comments`, `comment_likes`, `follows`, `stories`, `story_likes`, `story_views`, `highlights`, `highlight_items`, `audience_restrictions`, `conversation_members` (eigene Zeile), `messages` (eigene), `message_reactions`, `message_hidden` (eigene „Für mich gelöscht“-Markierungen, und die anderer an den eigenen Nachrichten), `workout_shares`, `post_reposts`, `content_hashtags`, `notifications`, `training_plans`, `plan_days`, `plan_exercises`, `planned_rest_uses`, `plan_rounds` (Fortschritt im Durchlauf), `plan_deviations` (Fragen nach Abweichungen vom Plan), `plan_adoptions` (als Übernehmer), `workouts`, `workout_exercises`, `workout_sets`, `rest_budgets`, `rest_day_uses`, `user_blocks`, `admin_roles`, `moderation_notices`, `legal_confirmations`, `confirmation_followups`, `seed_markers` (Markierungen der Testdaten), `protected_accounts` |
| Auf `null` gesetzt | `reports.reporter_id`, `messages.pinned_by`, `conversations.created_by`, `training_plans.adopted_from_user_id` (Kopien anderer behalten ihren Plan, Herkunft „Gelöschtes Konto“), `plan_adoptions.owner_id`, `reset_jobs.created_by`, `reset_job_targets.user_id` (der Hash `user_hash` bleibt), `conversation_departures.user_id` (der Chat zeigt dann „Gelöschtes Konto“) |
| Nur UUID, Texte pseudonymisiert | `moderation_actions`, `reports.target_user_id`, `report_snapshots.sender_id` |
| Bereinigt | `stories.mentioned_user_ids` / `mention_positions` anderer |
| Ohne Bezug zu Konten | `usage_counters`, `usage_event_types`, `usage_meta` (nur Tagessummen pro Ereignis, keine Nutzer-ID). Das Löschen eines Kontos erhöht den Zähler `account_deleted`. `login_attempts` (fehlgeschlagene Anmeldungen mit Username, ohne Nutzer-ID, nach einem Tag gelöscht). |
| Bleibt | `account_deletions` (nur Hash), `app_settings` (ohne Bezug zu Konten) |

**Prüfen nach dem Löschen:** `supabase/check-deleted-user.sql` durchsucht alle Tabellen nach der alten ID.

## Datenbereinigung („App-Neustart“)

Admins (nur Rolle `admin` mit Zwei-Faktor, nie Moderatoren) löschen entweder **Konten komplett** oder nur **ausgewählte Datenkategorien** ausgewählter Nutzer. Alles läuft als Auftrag über die Funktionen `admin_reset_*` und die Edge Function `run_data_reset`. Bedient wird es im Dashboard unter **Bereinigung** (Assistent in 7 Schritten); die Anleitung für den Einsatz steht in [reset-runbook.md](reset-runbook.md). Clients haben keine Rechte auf die Tabellen `app_settings`, `protected_accounts`, `reset_jobs` und `reset_job_targets`.

**Ablauf:** Entwurf → Trockenlauf (`admin_reset_preview`, löscht nichts) → Sicherung (`admin_reset_export`: betroffene Zeilen als JSON, Chats nur mit IDs und Zeiten, ohne Texte, ohne Adressen und Dateien, protokolliert als `reset_exported`) → Bestätigen (`admin_reset_confirm`) → Ausführung in Batches von höchstens 25 Personen (`run_data_reset`) → `done` oder `failed`. Höchstens 500 Personen pro Auftrag, höchstens ein bestätigter oder laufender Auftrag gleichzeitig. Ändern, bestätigen, starten und abbrechen darf nur, wer den Auftrag erstellt hat.

**Bestätigen verlangt:** Zustand `draft`, einen Trockenlauf nach der letzten Änderung, eine Begründung mit mindestens 10 Zeichen, das Wort `NEUSTART` und einen frischen TOTP-Schritt (der letzte TOTP-Eintrag im `amr`-Claim des JWT höchstens 5 Minuten alt). Danach sind Umfang und Auswahl eingefroren.

**Schutz:** Nie auswählbar, auch nicht per manipuliertem Aufruf: Konten in `protected_accounts` (eintragen mit `supabase/reset-config.sql`), alle Konten mit einer Rolle in `admin_roles` und der Aufrufer selbst. Die Prüfung läuft beim Auswählen, beim Bestätigen und noch einmal vor jedem einzelnen Löschschritt (dann wird die Person übersprungen).

**Markierte Konten** (gesperrt, gebannt, im Löschen, offene Meldungen, Inhalte in Quarantäne) sind nur mit `include_flagged` wählbar. Das Dashboard fragt das gesondert ab, damit Beweise nicht versehentlich verschwinden. Konten im Status `deleting` sind nur beim kompletten Löschen wählbar; dort wird die Löschung zu Ende gebracht.

**`app_settings.allow_full_reset`** (Standard `true` für die Testphase): Bei `false` lehnen die Funktionen und die Edge Function das komplette Löschen von Konten ab, auch für schon bestätigte Aufträge. Kategorien bleiben möglich. **Vor dem echten Start ausschalten:**

```sql
update public.app_settings set value = 'false', updated_at = now() where key = 'allow_full_reset';
```

**Kategorien** (Schlüssel, betroffene Tabellen, Dateien im Bucket `photos`):

| Schlüssel | Bezeichnung | Gelöscht | Dateien |
|---|---|---|---|
| `chats` | Chats | Jede Unterhaltung der Person wird **für alle Mitglieder beendet**: `conversations` samt `conversation_members`, `messages` (auch Anheftungen), `message_reactions`, `message_hidden`. Geteilte Beiträge und Kommentare bleiben, nur die Nachrichtenkarte verschwindet. Ausnahme: Unterhaltungen mit einem geschützten Konto (`protected_accounts`, `admin_roles`) bleiben, ausser `include_protected_chats`; dort gehen nur die Nachrichten, Reaktionen und die Mitgliedschaft der Person, die anderen sehen eine neutrale Zeile (`messages.kind = 'notice'`) und „Nicht mehr im Chat“ (`conversation_departures`). | keine (Chats haben keine eigenen Dateien) |
| `activities` | Aktivitäten | `workouts` samt `workout_exercises`, `workout_sets`; `workout_shares`, in denen die Person verlinkt ist; `rest_day_uses` | – |
| `plans` | Pläne | `training_plans` samt `plan_days`, `plan_exercises`; `plan_rounds`, `plan_deviations`, `planned_rest_uses`, `plan_adoptions` (als Übernehmer) | – |
| `posts` | Beiträge | `posts` samt `post_media` und den Kommentaren, Likes, Markierungen, Verlinkungen und Reposts daran; eigene `comments`, `post_likes`, `comment_likes`, `post_reposts` und `post_tags` (wo die Person markiert ist) | `{user_id}/posts/...` der gelöschten Beiträge (Foto und Original) |
| `stories` | Storys | `stories` samt Likes und Aufrufen daran, alle `highlights` samt `highlight_items`; eigene `story_likes`, `story_views` | `{user_id}/stories/...` der gelöschten Storys |
| `social` | Follower und Gefolgte | `follows` in beide Richtungen (auch offene Anfragen), eigene `user_blocks` (als Blockierende), `audience_restrictions` (eigene „Verbergen vor“) | – |
| `notifications` | Benachrichtigungen | `notifications` der Person | – |
| `other` | Sonstiges | `reports.reporter_id` auf `null` (die Meldung bleibt), Einstellungen in `profiles` zurück auf Standard (Privatsphäre, Markieren, Mitteilungen, Sichtbarkeit von Aktivitäten und Statistik), `rest_budgets` | – |

- **Nie betroffen:** `moderation_actions`, `report_snapshots`, `legal_confirmations`, `usage_counters`, `account_deletions`, `admin_roles`, `moderation_notices`, die Reset-Tabellen selbst, Profilbild, Benutzername und Anzeigename.
- **Mitbetroffene Konten:** Wer nicht ausgewählt ist, aber eine beendete Unterhaltung verliert, steht in `reset_job_targets` mit `role = 'collateral'` und `selected = false` (beendete Unterhaltungen und eigene Nachrichten). Mitbetroffene sind nicht abwählbar, erscheinen in der Vorschau getrennt und werden wie Ausgewählte benachrichtigt. Mit `include_protected_chats` (eigene Bestätigung im Assistenten, protokolliert als `reset_protected_chats_on`) sind auch geschützte Konten mitbetroffen.
- **Komplett löschen** beendet vorher ebenfalls die Chats der Person (wie die Kategorie).
- **Benachrichtigung:** Wer tatsächlich etwas verliert (Zahlen > 0, Konto gelöscht oder mindestens eine beendete Unterhaltung), bekommt am Ende eine E-Mail; wer sein Konto behält, zusätzlich eine Mitteilung in der App (`moderation_notices`, Art `info`), auch ohne Mail-Dienst. Gelöschte Konten bekommen nur die E-Mail. Die Adresse liest die Datenbank erst unmittelbar vor der Löschung bzw. am Ende des Auftrags aus `auth.users`, hält sie in `reset_job_targets.email_address` bis zum Versand und löscht sie danach, spätestens nach 7 Tagen (`reset_purge_emails`). Nur die Edge Function mit der service_role liest die Warteschlange (`reset_mail_*`), nie der Browser. Erreicht der Mail-Dienst sein Kontingent, bleiben die übrigen Mails wartend; „Offene Mails senden“ im Auftrag verschickt den Rest. Ohne Mail-Dienst: `email_status = 'not_configured'`, Adressen werden sofort gelöscht.
- **Anzeige im Chat:** „Gelöschtes Konto“ erscheint nur, wenn das Konto der anderen Person nicht mehr existiert. Hat sie den Chat nur verlassen (Bereinigung mit geschütztem Konto), steht dort „Nicht mehr im Chat“, ohne Namen, Bild und Link (`get_chat_partner_states`). Ein beendeter Chat verschwindet in offenen Apps sofort (Realtime-Löschung von `conversations`, nur mit der ID).
- **Moderierte Inhalte bleiben** (entfernt oder in Quarantäne), samt dem, woran sie hängen: ein Beitrag mit moderiertem Kommentar, eine Unterhaltung mit moderierter Nachricht, ein Kommentar mit moderierter Antwort.
- **Dateien** werden mitgelöscht, nie nur die Datenbankzeile. Gelöscht wird nur im eigenen Ordner der Person und nur, was keine andere Zeile mehr nutzt (eine Story kann ihre Datei mit einem Beitrag teilen). Beim kompletten Löschen: alle Dateien unter `{user_id}/` in allen Buckets, wie bei `delete_account`.
- **Komplett löschen** nutzt die vorhandene Konto-Löschlogik: Status `deleting`, Dateien, `finish_account_deletion()` (pseudonymisiert die Logs, schreibt `account_deletions`), Auth-Nutzer löschen. Danach ist in `reset_job_targets` nur noch der Hash `user_hash` übrig.
- **Zählung:** Was ohnehin mit dem Inhalt einer anderen ausgewählten Person verschwindet (mein Like auf ihren Beitrag), zählt nur einmal, bei der Besitzerin. Vollständige Unterhaltungen und Follows zwischen zwei Ausgewählten zählen bei der Person mit der kleineren ID. So stimmen Trockenlauf und Ergebnis überein, solange sich dazwischen nichts ändert.
- **Fortsetzen:** Jede Person hat einen eigenen Zustand (`pending` → `claimed` → `files_pending` → `done` / `failed` / `skipped`). Jeder Schritt lässt sich wiederholen. Nach einem Abbruch denselben Auftrag erneut starten: Fehlgeschlagene werden bis zu 5-mal neu versucht, angefangene Schritte nach 10 Minuten wieder aufgenommen.
- **Protokoll** in `moderation_actions` (`target_type = 'reset_job'`): `reset_confirmed`, `reset_started`, `reset_resumed`, `reset_finished` (mit Summen je Kategorie und Fortschritt) und `reset_cancelled`, jeweils mit der Begründung, ohne Namen oder Nutzer-IDs.
- **Prüfen:** `supabase/reset-checks.sql` (nur lesend) prüft Rechte, RLS, Funktionen, Schutz und Protokoll.

## Testdaten (nur Testphase)

- `supabase/seed-testaccount.sql` (von Hand im SQL-Editor, nicht Teil von `schema.sql`) legt für **ein** Testkonto zwei Monate Verlauf an: Trainings, Beiträge, abgelaufene Storys mit Highlights, Pläne, Ruhetage und Abweichungen. Oben im Skript den Benutzernamen eintragen. Voraussetzung: Das Konto ist aktiv und hat 3 eigene Beiträge mit Foto; deren Dateien werden für alle Testbeiträge und Storys wiederverwendet.
- Jede erzeugte Zeile steht in `seed_markers` (kein Client-Zugriff). Ein erneuter Lauf löscht zuerst genau diese Zeilen des Kontos und legt dann alles neu an. Mit `peakpic.seed_remove_only = 'true'` werden die Testdaten nur entfernt. Andere Konten werden nicht verändert; Likes und Kommentare anderer Konten hängen an den Testbeiträgen und verschwinden mit ihnen.
- Die Nutzungsstatistik bleibt unverändert: Das Skript setzt für seine Transaktion `peakpic.skip_usage = 'on'`, die Zähl-Trigger (`on_usage_event`) zählen dann nichts.
- Testbeiträge und -storys teilen sich die Dateien der 3 Originalbeiträge. In der App keine Teststory löschen und keine Fotos eines Testbeitrags ersetzen, sonst ist die gemeinsame Datei weg. Zum Aufräumen das Skript verwenden.

## Trainingspläne

- Sichtbarkeit pro Plan: „Nur ich“, „Follower“ (bestätigte Follower) oder „Alle“ (nur bei öffentlichem Profil, sonst Follower). Gesperrte, gebannte, gelöschte und blockierte Konten sowie verborgene Personen sehen nichts (`can_view_plan`).
- Pläne sind meldbar (`target_type = 'plan'`). Die Moderation kann sie entfernen oder in Quarantäne setzen: dann sieht und übernimmt sie niemand mehr, der Besitzer behält seinen Plan mit einem Hinweis.
- Übernehmen (`adopt_plan`) erzeugt eine private Kopie ohne Zielgewichte und Notizen. Höchstens 10 Übernahmen pro Tag und 10 eigene Pläne. Der Ersteller bekommt (abschaltbar) eine Mitteilung pro Übernehmer und Plan, aber keine Liste der Übernehmer. `plan_adoptions` ist für Clients nicht lesbar.

## Aktivitäten (aufgezeichnete Trainings)

- Sichtbarkeit pro Aktivität: „Nur ich“ (Standard, einstellbar unter Einstellungen → Training), „Follower“ oder „Alle“ (nur bei öffentlichem Profil). Zusätzlich sieht den Trainingsbericht, wer den verknüpften Beitrag sehen darf, wenn „Trainingsbericht beim Beitrag zeigen“ an ist (`can_view_workout`). Gesperrte, blockierte und verborgene Personen sehen nichts.
- Aktivitäten sind meldbar (`target_type = 'workout'`) und können entfernt oder in Quarantäne gesetzt werden. Entfernte Aktivitäten zählen nicht mehr für den Streak und sind auch für den Besitzer nicht mehr sichtbar.
- Fotos zu einem Training zählen nie selbst als Nachweis; der Nachweis ist das Training (mit den Plausibilitätsregeln). So machen nachträgliche Fotos keinen anderen Tag und kein unplausibles Training zum Trainingstag.

## Trainingsstatistik

- Sichtbarkeit über `profiles.training_stats_visibility` (Standard „Nur ich“, einstellbar unter Einstellungen → Datenschutz). „Alle“ gilt nur bei öffentlichem Profil, sonst sehen sie nur Follower. Gesperrte, blockierte und verborgene Personen sehen nichts (`can_view_training_stats`).
- Gelesen wird nur über `get_my_training_stats(range)` und `get_training_stats(user_id, range)`. Sie liefern Summen pro Tag und pro Übung und Tag, die Verteilung nach Plantagen und die Streak-Längen, aber keine IDs, Titel, Notizen, Uhrzeiten oder einzelnen Sätze. Entfernte Aktivitäten zählen nicht mit.
- Keine eigene Tabelle: Beim Löschen des Kontos verschwindet die Statistik mit den Trainings (`workouts`, `workout_exercises`, `workout_sets`) und der Spalte in `profiles`.

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
- `app_settings.allow_full_reset` auf `false` setzen (siehe „Datenbereinigung“)

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
- Trainingsdaten (Gewichte, Wiederholungen, Dauer, Trainingshäufigkeit, Streak) können als Gesundheitsdaten beziehungsweise besonders schützenswerte Personendaten gelten (DSGVO Art. 9, DSG Art. 5 lit. c). Klären: Rechtsgrundlage (ausdrückliche Einwilligung nötig, wenn andere die Statistik sehen?), Hinweis in der Datenschutzerklärung, Datenschutz-Folgenabschätzung, und ob die Standardwerte „Nur ich“ für Aktivitäten und Statistik genügen.
- Erwähnungen (@username) in Texten anderer bleiben stehen. Weil der Username frei wird, kann er später auf ein neues Konto zeigen.

## Spätere Phasen

- Datenexport für Nutzer (Auskunft und Datenübertragbarkeit; nicht umgesetzt).
