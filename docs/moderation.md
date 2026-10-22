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
- Unveränderlich: Update, Delete und Truncate werden per Trigger abgelehnt, auch für Admins.
- Referenzen auf Konten sind reine UUIDs ohne Fremdschlüssel, damit das Löschen eines Kontos nicht blockiert wird.

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

## Spätere Phasen

- Datenexport für Nutzer (nicht umgesetzt).
