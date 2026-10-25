# Runbook: Datenbereinigung („App-Neustart“)

Schritt-für-Schritt-Anleitung für den Einsatz im Dashboard unter **Bereinigung**. Die Regeln dahinter (Kategorien, Schutz, was nie gelöscht wird) stehen in [moderation.md](moderation.md) unter „Datenbereinigung“.

> Eine Bereinigung lässt sich nicht rückgängig machen. Gelöschte Dateien im Storage sind weg.

## Voraussetzungen

1. `supabase/schema.sql` ist ausgeführt, danach `notify pgrst, 'reload schema';`.
2. Die Edge Function ist deployt: `npx supabase functions deploy run_data_reset`.
3. Du bist im Dashboard als **Admin** mit Zwei-Faktor angemeldet. Moderatoren sehen die Seite nicht.
4. Kein anderer Auftrag ist bestätigt oder läuft (die Liste „Frühere Aufträge“ zeigt das).

## Chats und Benachrichtigung: die Regeln

- **Chats werden für alle beendet.** Mit der Kategorie „Chats“ (und beim kompletten Löschen) verschwindet jede Unterhaltung der ausgewählten Personen für alle Beteiligten, auch für Konten, die nicht ausgewählt sind. Geteilte Beiträge bleiben, Kopien gemeldeter Nachrichten und das Audit-Log auch.
- **Ausnahme geschützte Konten:** Ist ein geschütztes Konto (Hauptkonto, Testkonto, Admin, Moderator) in der Unterhaltung, bleibt sie bestehen. Dort verschwinden nur die Nachrichten und die Mitgliedschaft der ausgewählten Person; das geschützte Konto sieht eine neutrale Zeile „Eine Person ist nicht mehr in diesem Chat.“ und „Nicht mehr im Chat“ statt eines Namens. Die Option „Chats mit geschützten Konten ebenfalls beenden“ in der Vorschau ändert das (eigene Bestätigung, steht im Audit-Log, verlangt einen neuen Trockenlauf).
- **Umfragen:** Die Kategorie „Umfragen“ löscht nur, dass die Person teilgenommen hat, und welche Umfragekarten sie gesehen oder ausgeblendet hat. Die anonymen Antworten bleiben in den Auswertungen (sie haben keinen Bezug zur Person). Eine Person, deren Teilnahme gelöscht wurde, kann an einer noch laufenden Umfrage erneut teilnehmen. Das offizielle Konto ist wie ein geschütztes Konto nicht auswählbar.
- **Mitbetroffene:** Wer nicht ausgewählt ist, aber eine Unterhaltung verliert, steht in der Vorschau unter „Mitbetroffene Konten“. Sie sind nicht abwählbar.
- **Benachrichtigung:** Nur wer tatsächlich etwas verliert, wird informiert: ausgewählte Personen mit Löschungen und Mitbetroffene. Wer sein Konto behält, bekommt eine Mitteilung in der App und eine E-Mail; gelöschte Konten nur die E-Mail. Mitbetroffene bekommen einen eigenen Text ohne Namen der anderen Person. Ohne Mail-Dienst gibt es nur die Mitteilung in der App; gelöschte Konten erfahren dann nichts (Hinweis im Assistenten).
- **Kontingent:** Reicht das Tageskontingent des Mail-Dienstes nicht, warten die übrigen Mails. Am nächsten Tag im Auftrag **Offene Mails senden**. Adressen werden nach dem Versand gelöscht, spätestens nach 7 Tagen.

## 1. Schutz eintragen

1. In `supabase/reset-config.sql` die Benutzernamen eintragen, die nie gelöscht werden dürfen (Hauptkonto, Testkonten). Admins und Moderatoren sind immer geschützt, du selbst auch.
2. Im SQL-Editor ausführen. Die Tabelle am Ende zeigt alle geschützten Konten und den Wert von `allow_full_reset`. Steht dort „NICHT GEFUNDEN“, ist ein Name falsch geschrieben.
3. Die echten Benutzernamen nicht ins Repository committen. In der Datei stehen nur Platzhalter.
4. Optional `supabase/reset-checks.sql` ausführen. Es ist nur lesend, alle Zeilen sollten `ok = true` zeigen.

## 2. Auftrag anlegen und Trockenlauf

1. **Bereinigung → Neuer Auftrag.**
2. **Umfang:** „Nur Daten löschen“ mit den Kategorien, oder „Konten komplett löschen“. Ist `allow_full_reset` aus, ist nur „Nur Daten löschen“ möglich, und oben steht ein Hinweis.
3. **Nutzer:** Personen ankreuzen oder „Alle ausser geschützte auswählen“ (mit Bestätigungsdialog und Anzahl). Geschützte Konten sind mit einem Schloss gesperrt. Markierte Konten (gesperrt, gebannt, offene Meldungen, Quarantäne) brauchen eine eigene Bestätigung. Ihre moderierten Inhalte bleiben als Beweis erhalten.
4. **Trockenlauf ausführen.** Die Vorschau zeigt je Person und Kategorie, was gelöscht würde, dazu die Summen und die Anzahl Dateien. Es wird nichts gelöscht. Die Vorschau lässt sich als JSON herunterladen.
5. Stimmen die Zahlen nicht, mit **Zurück** die Auswahl ändern. Danach braucht es einen neuen Trockenlauf.

## 3. Begründung und Mitteilung

1. **Begründung** (mindestens 10 Zeichen). Sie steht im Audit-Log und in der E-Mail.
2. **Betreff und Text** der E-Mail an die Betroffenen, mit den Platzhaltern `{{kategorien}}` und `{{begruendung}}`. Die Vorschau zeigt den fertigen Text.
3. Eine E-Mail bekommen nur Personen, bei denen tatsächlich etwas gelöscht wird.

## 4. Sicherung und Bestätigung

1. **Sicherung als JSON herunterladen.** Sie enthält die betroffenen Tabellenzeilen, aber keine Dateien aus dem Storage, keine Chat-Texte und keine E-Mail-Adressen. Der Export steht im Audit-Log. Die Datei an einem sicheren Ort ablegen und nach der Prüfung löschen.
2. Supabase-Backups prüfen: Ob und wie lange Supabase selbst Backups aufbewahrt, hängt vom Tarif ab (Dashboard → Database → Backups). Vor einer grossen Bereinigung kontrollieren, dass ein aktuelles Backup existiert.
3. Haken **„Ich habe eine Sicherung“** setzen, **NEUSTART** eingeben und einen **frischen Zwei-Faktor-Code** eingeben.
4. **Auftrag bestätigen** → Dialog mit Anzahl → **Endgültig bestätigen**. Ab jetzt sind Umfang und Auswahl eingefroren. Ist der Code älter als 5 Minuten, verlangt das Dashboard einen neuen.

## 5. Ausführen

1. Auf der Seite des Auftrags **Jetzt ausführen …** → Dialog mit Anzahl → **Jetzt ausführen**. Bis dahin kann der Auftrag noch abgebrochen werden, danach nicht mehr.
2. Die Seite offen lassen. Das Dashboard ruft `run_data_reset` in Batches von höchstens 25 Personen auf, bis alle verarbeitet sind. Der Fortschritt zeigt verarbeitete Personen, Fehler und übersprungene Personen.
3. Übersprungen wird, wer in der Zwischenzeit geschützt oder Admin wurde, oder wer bei „Nur Daten löschen“ gerade gelöscht wird.

## 6. Prüfen

1. **Ergebnis:** Zahlen je Kategorie (Vorschau und tatsächlich gelöscht), Status und Mail-Status je Person (ohne Adressen). Den Bericht als JSON herunterladen.
2. Stichprobe in der App: Bei einer betroffenen Person fehlen die gewählten Daten, alles andere ist noch da.
3. Bei kompletter Löschung: `supabase/check-deleted-user.sql` mit der alten ID (aus der Sicherung) ausführen.
4. **Audit-Log:** Einträge `reset_confirmed`, `reset_exported`, `reset_started` und `reset_finished` mit der Begründung, ohne Namen.
5. `supabase/reset-checks.sql` erneut ausführen.

## Bei Fehlern

- **Status „Mit Fehlern“ oder „Läuft“, aber nichts passiert** (Seite geschlossen, Verbindung weg): Auftrag öffnen und **Fortsetzen**. Jede Person hat ihren eigenen Zustand. Nichts wird doppelt gelöscht, und nichts fehlt. Fehlgeschlagene Personen werden bis zu 5-mal neu versucht, hängengebliebene Schritte nach 10 Minuten wieder aufgenommen.
- **„Ein anderer Auftrag läuft bereits“:** zuerst den anderen Auftrag beenden (fortsetzen) oder, falls noch nicht gestartet, abbrechen.
- **„Ausführung fehlgeschlagen. Ist die Edge Function run_data_reset deployt?“:** Deploy prüfen (`npx supabase functions deploy run_data_reset`) und die Logs der Function im Supabase-Dashboard ansehen. Dort stehen nur Fehlercodes, keine Namen.
- **Fehlercode `storage_remove_failed` oder `storage_list_failed`:** Storage-Problem. Später fortsetzen. Die Zeilen sind dann schon gelöscht, die Dateien folgen beim Fortsetzen.
- **Fehlercode `auth_delete_failed` oder `finish_failed`:** Das Konto steht auf „Wird gelöscht“ und ist unsichtbar. Fortsetzen schliesst die Löschung ab.
- **Komplettes Löschen wurde ausgeschaltet, während ein Auftrag bestätigt war:** Der Auftrag lässt sich nicht starten. Entweder `allow_full_reset` vorübergehend wieder einschalten oder den Auftrag abbrechen.

## Testliste: Chats und Benachrichtigung

Vorbereitung mit vier Testkonten und einem Admin mit Zwei-Faktor:

- **A** (wird ausgewählt), **B** (nicht ausgewählt), **C** (geschützt, in `reset-config.sql`), **D** (wird ausgewählt, hat aber keine Benachrichtigungen).
- A hat je einen Chat mit B und mit C, in beiden einige Nachrichten. In den Chat A–B einen Beitrag teilen.
- B und C haben die App geöffnet, B im Chat mit A.

1. Auftrag „Nur Daten löschen“, Kategorie **Chats**, Auswahl **A**. Die Vorschau zeigt unter „Mitbetroffene Konten“ **B** (1 Unterhaltung), nicht C. Hinweis: 1 Chat mit geschütztem Konto bleibt.
2. Bestätigen und ausführen.
   - B: Der offene Chat schliesst sich mit „Dieser Chat wurde beendet.“, die Chat-Liste zeigt ihn nicht mehr, der Ungelesen-Zähler stimmt. Der geteilte Beitrag existiert weiter.
   - C: Der Chat mit A ist noch da, ohne die Nachrichten von A, mit der Zeile „Eine Person ist nicht mehr in diesem Chat.“ und „Nicht mehr im Chat“ als Name (nicht „Gelöschtes Konto“, weil A noch existiert).
   - Ergebnis: Vorschau und gelöschte Zahlen stimmen überein, auch bei B.
3. Benachrichtigung:
   - **B** bekommt eine Mitteilung in der App und eine E-Mail „Unterhaltungen beendet“ (ohne den Namen von A).
   - **A** bekommt Mitteilung und E-Mail mit Betreff und Text des Auftrags.
   - **C** bekommt nichts.
4. Zweiter Auftrag „Nur Daten löschen“, Kategorie **Benachrichtigungen**, Auswahl **D** (ohne Benachrichtigungen). Ergebnis: Bei D steht „E-Mail: –“, keine Mitteilung, keine E-Mail.
5. Dritter Auftrag: Kategorie Chats, Auswahl **A** mit einem neuen Chat A–C, Option **„Chats mit geschützten Konten ebenfalls beenden“** an. Die Option verlangt eine Bestätigung und einen neuen Trockenlauf; C steht jetzt unter „Mitbetroffene“. Nach dem Lauf ist der Chat für C weg, C wird benachrichtigt, und im Audit-Log steht `reset_protected_chats_on`.
6. Nur für die Testphase: Auftrag „Konten komplett löschen“ für ein Wegwerfkonto mit einem Chat mit C. Danach zeigt der Chat bei C „Gelöschtes Konto“.
7. Kontingent: Wenn es erreicht ist, zeigt der Auftrag „Kontingent erreicht“ und „Offene Mails senden (n)“. Später erneut senden; danach steht der Mail-Status auf „Gesendet“.
8. `supabase/reset-checks.sql` ausführen: alle Zeilen `ok = true`.

## Vor dem echten Start

Komplettes Löschen von Konten ausschalten (Kategorien bleiben möglich):

```sql
update public.app_settings set value = 'false', updated_at = now() where key = 'allow_full_reset';
```

Danach zeigt die Seite „Bereinigung“ oben einen Hinweis, und die Option „Konten komplett löschen“ ist deaktiviert. Auch die Datenbank und die Edge Function lehnen es dann ab.
