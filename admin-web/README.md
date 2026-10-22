# PeakPic Moderation (admin-web)

Kleines Web-Dashboard für Moderatoren und Admins. Eigenes Projekt (Vite, React, TypeScript), getrennt von der App. **Läuft vorerst nur lokal**; es gibt kein Deployment und kein Hosting-Setup.

Das Dashboard ruft ausschliesslich die Datenbank-Funktionen (`mod_*`, `admin_*`) und Policies auf. Jede Berechtigung prüft die Datenbank selbst (Rolle und Zwei-Faktor-Sitzung). Der Browser bekommt nur die öffentliche Projekt-URL und den Anon-Key.

> **Der service_role-Key gehört niemals in dieses Projekt**, auch nicht in `.env`, als Konstante oder in Logs.

## Starten

```bash
cd admin-web
npm install
cp .env.example .env    # Werte eintragen, siehe unten
npm run dev             # http://127.0.0.1:5174
```

Weitere Befehle: `npm run build` (Typprüfung und Build nach `dist/`), `npm run lint`.

## Env-Variablen (`admin-web/.env`)

| Variable | Wert |
|---|---|
| `VITE_SUPABASE_URL` | Projekt-URL, z.B. `https://abcd.supabase.co` (Supabase → Project Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | der **anon / public** Key (nicht service_role) |

`.env` ist per `.gitignore` ausgeschlossen. Die Projekt-URL wird beim Start auch in die Content-Security-Policy geschrieben: nach einer Änderung `npm run dev` neu starten.

## Ersten Admin anlegen

1. `supabase/schema.sql` ist ausgeführt.
2. Supabase → Authentication → **Multi-Factor**: TOTP aktivieren.
3. Das Konto existiert (z.B. in der App registriert) und die E-Mail ist bestätigt.
4. In `supabase/admin-setup.sql` das Beispiel für die Admin-Rolle kopieren, E-Mail-Adresse ersetzen und im SQL-Editor ausführen.

Es gibt bewusst keine Oberfläche, um Rollen zu vergeben.

## Zwei-Faktor (TOTP) einrichten

- Beim **ersten Login** zeigt das Dashboard nach dem Passwort einen QR-Code. Mit einer Authenticator-App scannen (z.B. die Passwörter-App von iOS, 1Password, Google Authenticator) und den 6-stelligen Code eingeben.
- Bei **jedem weiteren Login** wird nach dem Passwort der Code abgefragt.
- Ohne bestätigten zweiten Faktor (`aal2`) und ohne Rolle gibt es nur die Login-Seite; die Datenbank lehnt ohnehin jede Staff-Funktion ab.
- Geht das Gerät mit der Authenticator-App verloren: den Faktor in Supabase → Authentication → Users → Nutzer → MFA-Faktoren entfernen und neu einrichten.

## Sicherheit im Browser

- Sitzung **nur im Speicher**: nichts in localStorage oder Cookies. Neu laden heisst neu anmelden.
- **Automatisches Abmelden nach 30 Minuten** ohne Eingabe. Danach wird die Seite neu geladen, damit keine Daten im Speicher bleiben.
- Strenge Content-Security-Policy (keine Inline-Skripte, keine Drittanbieter, Verbindungen nur zum eigenen Supabase-Projekt), `noindex`, kein Referrer.
- Bilder nur über signierte URLs mit 60 Sekunden Lebensdauer, und nur für gemeldete oder moderierte Inhalte.
- Nutzerinhalte werden nur als Text ausgegeben (React escaped). `dangerouslySetInnerHTML` ist per Lint-Regel verboten.
- Im Entwicklungsmodus erlaubt die CSP zusätzlich Inline-Styles und die Verbindung zum Vite-Dev-Server; der Build ist strikt.

## Seiten

- **Übersicht**: offene Meldungen, in Prüfung, älteste offene Meldung, Quarantäne.
- **Warteschlange**: Filter nach Status, Typ, Grund und Alter, sortierbar. Tastatur: `j`/`k` oder Pfeile, `Enter` öffnet, `r` lädt neu.
- **Meldungs-Detail**: Inhalt mit Bildern, Melder, betroffenes Konto mit Verlauf und die Aktionen. Jede Aktion verlangt eine Begründung (mindestens 10 Zeichen). Bann, Wiederherstellen und Quarantäne fragen noch einmal nach.
- **Nutzer**: Suche nach Username, Anzeigename oder ID; Konto-Detail mit Verlauf. Die E-Mail-Adresse sehen nur Admins, mit Begründung und Protokoll.
- **Audit-Log** (nur Admins): durchsuchbar, nur lesend.
- **Rechtstexte** (nur Admins): Versionen pro Text mit Zahlen (bestätigt, ausstehend, überfällig). Entwürfe in Markdown bearbeiten, mit Vorschau (gleicher Parser wie die App) und Vergleich zur Vorversion. Veröffentlichen zeigt die Zahl betroffener Konten und fragt Bestätigungspflicht und „blockierend“ noch einmal ab. Veröffentlichte Versionen sind unveränderlich.
- **Offene Bestätigungen** (nur Admins): Konten, deren Prüfung fällig ist (5 Tage nach Ankündigung, danach 5 Tage nach jeder Aktion). Pro Zeile erinnern, E-Mail, zurückstellen (mit Notiz) oder sperren (einzeln, mit Begründung). Sammelaktionen nur für Erinnerungen.
- Auf der **Übersicht** sehen Admins zusätzlich „Konten überfällig“, im **Nutzer-Detail** die Bestätigungs-Historie (Abruf wird protokolliert).

Sounds gibt es in der App noch nicht, deshalb hat das Dashboard dafür keine Warteschlange.

## E-Mail-Anbieter anbinden (Erinnerungen zu Rechtstexten)

Erinnerungs-E-Mails verschickt die Edge Function `supabase/functions/send_legal_notice_email`. Sie nutzt **nicht** den Supabase-Standardversand (der ist nur für Anmelde-Mails gedacht und stark begrenzt), sondern einen eigenen Anbieter. Vorgesehen ist [Resend](https://resend.com); jeder Anbieter mit gleicher HTTP-API geht über `EMAIL_API_URL`.

1. Beim Anbieter ein Konto anlegen, die Absender-Domain verifizieren (SPF/DKIM) und einen API-Key erstellen.
2. Secrets in Supabase setzen (Dashboard → Edge Functions → Secrets, oder per CLI):
   ```bash
   npx supabase secrets set EMAIL_API_KEY=... EMAIL_FROM="PeakPic <noreply@deine-domain.ch>" ADMIN_ORIGIN=http://127.0.0.1:5174
   ```
   Optional `EMAIL_API_URL` (Standard: `https://api.resend.com/emails`).
3. Deployen: `npx supabase functions deploy send_legal_notice_email`

`SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase der Function selbst bereit. Der service_role-Key wird nur dort verwendet, um die E-Mail-Adresse über die Auth-Admin-API zu lesen. Er gehört nie in `admin-web/.env` oder ins Repo.

Die Function prüft das JWT und die Admin-Rolle (`is_admin()`, mit Zwei-Faktor), nimmt höchstens 50 Empfänger pro Aufruf, schickt nur an Konten, die tatsächlich offen sind, und protokolliert jede Mail als Aktion. Der Text ist neutral und enthält keine Links (Schutz vor Phishing-Verwechslung). Adressen werden nicht geloggt. Ist nichts eingerichtet, sind die E-Mail-Knöpfe deaktiviert und zeigen den Grund.

## Vor einem Online-Betrieb

Das Dashboard ist für den lokalen Betrieb gebaut. Bevor es öffentlich erreichbar wird, sind unter anderem zu klären:

- Hosting und Domain. Die CSP und Sicherheits-Header gehören dann als HTTP-Header gesetzt, nicht nur als Meta-Tag (z.B. `frame-ancestors 'none'`, HSTS).
- Zugang zusätzlich absichern (z.B. IP-Beschränkung, VPN oder Zugangsschutz vor der Seite).
- Supabase: erlaubte Redirect-URLs, Rate Limits und Passwortregeln prüfen.
- Überwachung des Audit-Logs und ein Vorgehen bei verlorenen Zugängen.
