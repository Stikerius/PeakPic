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

Sounds gibt es in der App noch nicht, deshalb hat das Dashboard dafür keine Warteschlange.

## Vor einem Online-Betrieb

Das Dashboard ist für den lokalen Betrieb gebaut. Bevor es öffentlich erreichbar wird, sind unter anderem zu klären:

- Hosting und Domain. Die CSP und Sicherheits-Header gehören dann als HTTP-Header gesetzt, nicht nur als Meta-Tag (z.B. `frame-ancestors 'none'`, HSTS).
- Zugang zusätzlich absichern (z.B. IP-Beschränkung, VPN oder Zugangsschutz vor der Seite).
- Supabase: erlaubte Redirect-URLs, Rate Limits und Passwortregeln prüfen.
- Überwachung des Audit-Logs und ein Vorgehen bei verlorenen Zugängen.
