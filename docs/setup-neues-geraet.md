# PeakPic auf einem neuen Gerät einrichten

Vollständige Anleitung, um das Projekt auf einem anderen Rechner (z.B. einem zweiten PC) zum Laufen zu bringen und dort zu testen. Für den Wechsel zwischen zwei schon eingerichteten Rechnern genügt die Kurzfassung in [geraetewechsel.md](geraetewechsel.md).

Stand: 24.10.2026. Platzhalter in spitzen Klammern (`<PROJECT-REF>`, `<DEIN-TOKEN>`, `<DEINE-ADRESSE>`) ersetzt du durch deine eigenen Werte, und zwar nur im Terminal oder in den lokalen `.env`-Dateien, nie in Dateien, die ins Git gehen.

---

## 1. Überblick und Checkliste

### Was du wofür brauchst

| Teil | Nötig für | Pflicht? |
|---|---|---|
| App (Expo, `src/app`) | App auf dem iPhone testen | ja |
| Admin-Dashboard (`admin-web/`) | Moderation, Rechtstexte, Nutzung, Bereinigung | optional |
| Edge Functions (`supabase/functions/`) | Konto löschen, Anmeldung mit Username, E-Mails, Bereinigung | nur wer deployt |
| Mail-Dienst und Domain | E-Mails aus dem Dashboard | optional |
| Bereinigung (Reset) | Daten löschen aus dem Dashboard | optional |

### Konten

| Konto | Wofür |
|---|---|
| GitHub | Repository klonen und pushen |
| Expo | Anmeldung in der Expo-Go-App und im Terminal, Tunnel |
| Supabase | Datenbank, Auth, Storage, Edge Functions des Projekts (Zugang zum bestehenden Projekt genügt) |
| Resend | Versand der E-Mails (nur wenn du Mails einrichtest) |
| DNS-Anbieter der Domain | Einträge für die Verifizierung beim Mail-Dienst (nur für Mails) |

### Software auf dem Rechner

- **Node.js 24** (zuletzt verwendet: v24.16.0 mit npm 11). Eine Version ist im Repo nicht festgelegt (keine `.nvmrc`, kein `engines` in `package.json`).
- **Git**
- **VS Code**, empfohlene Erweiterung laut `.vscode/extensions.json`: `expo.vscode-expo-tools`
- **Docker: nicht nötig.** Edge Functions werden mit `--use-api` ohne Docker deployt (Abschnitt 8).

### Auf dem iPhone

- **Expo Go** aus dem App Store, passend zu **SDK 57** (`expo` ~57.0.x in `package.json`).
- Unterstützt die Store-Version von Expo Go SDK 57 nicht, erscheint beim Öffnen „Project is incompatible with this version of Expo Go“. Dann Expo Go aktualisieren. Für ältere SDKs gibt es im App Store keine Expo-Go-Version.

---

## 2. Vorbereitung unter Windows

1. **PowerShell darf lokale Skripte ausführen.** Ohne das bricht `npm` mit „npm.ps1 kann nicht geladen werden“ ab, weil npm unter Windows ein PowerShell-Skript ist. Die Einstellung gilt nur für dein Benutzerkonto und braucht kein Adminrecht:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

2. **Projekt nicht in einem OneDrive-Ordner ablegen** (auch nicht in „Dokumente“ oder „Desktop“, wenn diese synchronisiert werden). `node_modules` enthält zehntausende Dateien; die Synchronisierung bremst, sperrt Dateien und führt zu abgebrochenen Installationen. Ein Ordner ausserhalb, z.B. `C:\dev`:

   ```powershell
   New-Item -ItemType Directory -Force C:\dev
   cd C:\dev
   ```

---

## 3. Repository holen

1. Klonen per HTTPS (die Adresse findest du auf GitHub im Repository unter „Code“):

   ```powershell
   git clone https://github.com/<KONTO>/<REPOSITORY>.git PeakPic
   cd PeakPic
   ```

2. **Anmeldung bei GitHub:** Beim ersten Klonen oder Pushen öffnet der Git Credential Manager (bei Git für Windows dabei) den Browser. Dort anmelden, fertig.
3. **Alternative: Personal Access Token**, wenn die Browser-Anmeldung nicht geht:
   1. GitHub → Profilbild → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   2. Repository access: **Only select repositories**, nur dieses Repository.
   3. Permissions → Repository permissions → **Contents: Read and write**.
   4. Kurze Laufzeit wählen (z.B. 7 oder 30 Tage).
   5. Beim nächsten `git push` den Token statt des Passworts eingeben. Den Token nirgends speichern oder weitergeben.
4. **„Authentication failed“:** Meist ist eine alte Anmeldung gespeichert. Windows → **Anmeldeinformationsverwaltung** → Windows-Anmeldeinformationen → Eintrag `git:https://github.com` entfernen, dann erneut versuchen.

---

## 4. App einrichten

1. Pakete installieren (im Hauptordner):

   ```powershell
   npm install
   ```

   Nie `--force` oder `--legacy-peer-deps`, kein `npm audit fix`. Neue Pakete nur mit `npx expo install <paket>`.

2. `.env` aus der Vorlage anlegen:

   ```powershell
   Copy-Item .env.example .env
   ```

   macOS und Linux: `cp .env.example .env`

3. `.env` (nicht `.env.example`) öffnen und diese zwei Werte eintragen:

   | Variable | Woher |
   |---|---|
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Projekt → Project Settings → API (bzw. „Data API“): die Projekt-URL |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API Keys: der **öffentliche** Schlüssel (anon / publishable) |

   **Niemals den Secret- bzw. service_role-Schlüssel**, weder hier noch sonst in App, `admin-web` oder Repo. Alles mit `EXPO_PUBLIC_` landet in der App und ist damit öffentlich.

4. Expo liest `.env` nur beim Start. Nach jeder Änderung den Dev-Server mit leerem Cache neu starten:

   ```powershell
   npx expo start -c
   ```

5. Normal starten:

   ```powershell
   npx expo start
   ```

   Den QR-Code im Terminal mit der Kamera-App des iPhones scannen. Er öffnet Expo Go.

6. Optional: Testdaten.
   - `npm run seed` legt Fake-Nutzer mit Beiträgen an (`scripts/seed-fake-users.mjs`, liest `.env`). Voraussetzung: In Supabase ist „Confirm email“ aus (siehe Abschnitt 7).
   - `supabase/seed-testaccount.sql` füllt ein eigenes Testkonto (Abschnitt 7).

---

## 5. Netzwerk und Tunnel

1. **Rechner und iPhone im selben WLAN.** Gast- und Firmen-WLANs trennen die Geräte oft voneinander (Client-Isolation). Dann findet Expo Go den Rechner nicht; nimm den Tunnel (Schritt 3).
2. **Windows-Firewall freigeben** (braucht Adminrechte). Metro, der Dev-Server von Expo, nutzt den Expo-Standardport 8081 (im Repo nicht geändert). In einer PowerShell **als Administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "Expo Metro 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Private
   ```

   Das erlaubt eingehende Verbindungen auf Port 8081, nur in Netzwerken mit dem Profil „Privat“. Das Heim-WLAN muss in Windows als **privates Netzwerk** eingestellt sein.
3. **Ohne Adminrechte: Tunnel.** Der Datenverkehr läuft über einen Tunneldienst, WLAN und Firewall sind egal:

   ```powershell
   npx expo start --tunnel
   ```

   - `@expo/ngrok` ist im Projekt schon als devDependency eingetragen (`package.json`). Fragt Expo trotzdem nach dem Paket: im Projekt installieren, nicht global (`npm install` im Hauptordner reicht in der Regel).
   - **„Port belegt“:** Läuft schon ein anderer Expo-Server? Das andere Terminal schliessen. Sonst die Frage von Expo, einen anderen Port zu nehmen, mit Ja beantworten.
4. **Beim Expo-Konto anmelden, im Terminal und in der App mit demselben Konto:**
   - Terminal: `npx expo login`
   - Geht die Anmeldung im Browser nicht: auf expo.dev → Account settings → **Access tokens** einen Token erstellen und ihn nur im aktuellen Terminalfenster setzen (die Variable `EXPO_TOKEN` stammt aus der Expo-Dokumentation, nicht aus dem Repo):

     ```powershell
     $env:EXPO_TOKEN = "<DEIN-TOKEN>"
     ```

     macOS und Linux: `export EXPO_TOKEN="<DEIN-TOKEN>"`. Das Fenster nach der Arbeit schliessen und den Token löschen, wenn du ihn nicht mehr brauchst.
   - Expo Go auf dem iPhone: unten „Profile“ bzw. „Account“, mit demselben Konto anmelden. Dann erscheint der laufende Server auch in der Liste.
5. **iPhone:** Einstellungen → Datenschutz & Sicherheit → **Lokales Netzwerk** → Expo Go einschalten. Ohne diese Berechtigung findet Expo Go den Rechner im WLAN nicht (Erfahrungswert).

---

## 6. Admin-Dashboard (optional)

1. Installieren und `.env` anlegen:

   ```powershell
   cd admin-web
   npm install
   Copy-Item .env.example .env
   ```

2. In `admin-web/.env` eintragen (dieselben Quellen wie in Abschnitt 4, nur öffentliche Werte):

   | Variable | Wert |
   |---|---|
   | `VITE_SUPABASE_URL` | Projekt-URL |
   | `VITE_SUPABASE_ANON_KEY` | öffentlicher Schlüssel (anon / publishable) |

3. Starten:

   ```powershell
   npm run dev
   ```

   Das Dashboard läuft unter **http://127.0.0.1:5174** (fest eingestellt in `admin-web/vite.config.ts`: Host 127.0.0.1, Port 5174, `strictPort`). Ist der Port belegt, bricht Vite ab, statt einen anderen zu nehmen. Nach jeder Änderung an `admin-web/.env` neu starten, weil die URL auch in die Content-Security-Policy geschrieben wird.

4. **Admin-Rolle** (nur einmal pro Konto, nicht pro Gerät):
   1. Supabase → Authentication → Multi-Factor: **TOTP** einschalten (laut `admin-web/README.md`).
   2. Ein Konto in der App registrieren. Die E-Mail-Adresse muss bestätigt sein.
   3. In `supabase/admin-setup.sql` den Block „Give yourself the admin role“ kopieren. Im Supabase SQL-Editor die Platzhalter-Adresse durch die E-Mail-Adresse des Kontos ersetzen und ausführen. Die Datei selbst nicht mit echter Adresse speichern.
   4. Beim ersten Login im Dashboard erscheint ein QR-Code. Mit einer Authenticator-App scannen und den 6-stelligen Code eingeben. Den angezeigten Schlüssel zum Abtippen sicher aufbewahren (z.B. im Passwort-Manager). **Es gibt keine Wiederherstellungscodes.** Geht der Faktor verloren, hilft nur das Entfernen in Supabase → Authentication → Users → Nutzer → MFA-Faktoren.
5. **Zweites Gerät:** Du brauchst keinen neuen Faktor. Auf dem neuen Rechner meldest du dich mit Passwort und dem Code aus derselben Authenticator-App an (oder einer App, in die du den gesicherten Schlüssel übernommen hast).

---

## 7. Backend: nur beim allerersten Aufbau eines Projekts

Datenbank, Storage und Edge Functions liegen bei Supabase und sind für alle Rechner gleich. **Für ein neues Gerät ist hier nichts zu tun**, solange das Projekt schon läuft. Hat sich `supabase/schema.sql` seit dem letzten Ausführen geändert, gilt [geraetewechsel.md](geraetewechsel.md).

1. **`supabase/schema.sql` komplett im Supabase SQL-Editor ausführen** (Dashboard → SQL Editor → New query → ganzen Inhalt einfügen → Run). Nicht über die Run-Schaltflächen einer SQL-Erweiterung in VS Code: Die laufen gegen die dort eingestellte Verbindung, typischerweise eine lokale Datenbank, nicht gegen dein Supabase-Projekt. Die Datei ist idempotent und darf erneut laufen.
2. Danach im SQL-Editor:

   ```sql
   notify pgrst, 'reload schema';
   ```

3. **Optionale Dateien in dieser Reihenfolge** (alle von Hand im SQL-Editor, keine ist Teil von `schema.sql`):

   | Datei | Was sie tut |
   |---|---|
   | `supabase/seed-legal.sql` | Legt Version 1 der drei Rechtstexte als Entwurf an; veröffentlicht wird im Dashboard. Ohne veröffentlichte Nutzungsbedingungen und Datenschutzerklärung ist keine Registrierung möglich. |
   | `supabase/admin-setup.sql` | Vorlagen, um Rollen (Admin, Moderator) zu vergeben, zu prüfen und zu entfernen; einzelne Befehle von Hand ausführen. |
   | `supabase/reset-config.sql` | Trägt geschützte Konten für die Bereinigung ein und zeigt den Schalter `allow_full_reset`. Echte Benutzernamen nicht committen. |
   | `supabase/seed-testaccount.sql` | Füllt ein Testkonto mit zwei Monaten Verlauf; das Konto braucht vorher 3 eigene Beiträge mit Foto. |
   | `supabase/backfill-usage.sql` | Einmalig: füllt die Nutzungszähler aus schon vorhandenen Inhalten. Bei einem neuen, leeren Projekt ändert es nichts. |
   | `supabase/maintenance.sql` | Aufräumen nach Bedarf: löscht abgelaufene Benachrichtigungen. |

   Weitere Hilfsdateien, nicht für den Aufbau:
   - `supabase/reset-checks.sql`: nur lesende Prüfliste zur Bereinigung.
   - `supabase/check-deleted-user.sql`: sucht nach dem Löschen eines Kontos alle Reste der alten ID, nur lesend.
   - `supabase/test-notifications.sql`: legt zurückdatierte Testbenachrichtigungen an, nur mit Wegwerf-Testkonten.

4. **Auth-Einstellungen:**
   - In der Testphase ist „Confirm email“ aus (Supabase → Authentication → Sign In / Providers → Email). Das Fake-User-Skript setzt das voraus. **Vor dem echten Start einschalten.**
   - Vor dem echten Start die Anmelde-Mails von Supabase auf einen eigenen Mail-Dienst umstellen (Authentication → Emails → SMTP-Einstellungen). Der eingebaute Versand ist nur für Tests gedacht und stark begrenzt. Welche Werte dort einzutragen sind, ist im Repo nicht festgehalten: **noch zu klären**.
   - Vor dem echten Start auch `allow_full_reset` ausschalten (siehe [reset-runbook.md](reset-runbook.md)).
5. **Backups:** Im Free-Tarif gibt es keine automatischen Backups. Vor grösseren Änderungen selbst sichern.

---

## 8. Edge Functions und Secrets

Nur nötig, wenn du Functions deployst. Die Supabase-CLI läuft über `npx`, ohne globale Installation und ohne Docker.

1. **Anmelden:**

   ```powershell
   npx supabase login
   ```

   Geht der Browser nicht: Supabase Dashboard → Profilbild → Account preferences → **Access Tokens** → Token erstellen und nur im aktuellen Terminalfenster setzen:

   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = "<DEIN-TOKEN>"
   ```

   macOS und Linux: `export SUPABASE_ACCESS_TOKEN="<DEIN-TOKEN>"`

2. **Projekt verknüpfen.** Die Projekt-Referenz steht in der Adresse des Dashboards (`…/project/<PROJECT-REF>`) und unter Project Settings → General:

   ```powershell
   npx supabase link --project-ref <PROJECT-REF>
   ```

   Die Verknüpfung liegt in `supabase/.temp/` und ist per `.gitignore` ausgeschlossen. Sie gilt nur für diesen Rechner.

3. **Deployen** (bündelt auf dem Server, Docker nicht nötig):

   ```powershell
   npx supabase functions deploy --use-api
   ```

   Oder eine einzelne Function: `npx supabase functions deploy <NAME> --use-api`.

4. **Die Functions im Repo:**

   | Function | Zweck |
   |---|---|
   | `delete_account` | Löscht ein Konto endgültig: selbst aus der App oder durch einen Admin im Dashboard. |
   | `login_with_username` | Anmeldung mit Username und Passwort; die E-Mail-Adresse verlässt den Server nicht. |
   | `send_legal_notice_email` | E-Mail-Erinnerung an Konten, die geänderte Rechtstexte noch nicht bestätigt haben (nur Admins). |
   | `run_data_reset` | Führt einen bestätigten Bereinigungsauftrag in Batches aus (nur Admins). |

   `_shared/` enthält gemeinsamen Code und ist keine eigene Function.

   **Deploy-Flags:** Der Code verlangt keine besonderen Flags. Es gibt keine `supabase/config.toml`, die JWT-Prüfung bleibt also an (Standard). `login_with_username` sagt ausdrücklich: „verify_jwt stays on“; die Plattform prüft dort den öffentlichen Schlüssel der App. **Noch zu klären:** Ob das auch mit dem neuen Schlüsselformat („publishable key“) statt des klassischen anon-JWT funktioniert, ist im Repo nicht festgehalten. Klappt die Anmeldung mit Username nicht, das zuerst prüfen.

5. **Secrets** (Supabase Dashboard → Edge Functions → **Secrets**). Die Namen müssen exakt stimmen: Mit einem Tippfehler findet die Function das Secret nicht und verhält sich, als fehle es.

   | Secret | Zweck | Woher |
   |---|---|---|
   | `EMAIL_API_KEY` | API-Schlüssel des Mail-Dienstes (`send_legal_notice_email`) | Resend → API Keys, nur mit Senderecht |
   | `EMAIL_FROM` | Absender, z.B. `PeakPic <noreply@<DEINE-DOMAIN>>` | eine Adresse der beim Mail-Dienst verifizierten Domain |
   | `EMAIL_API_URL` | optional, anderer Anbieter mit gleicher HTTP-API (Standard im Code: Resend) | Dokumentation des Anbieters |
   | `ADMIN_ORIGIN` | optional, Adresse des Dashboards für CORS (Standard im Code: `http://127.0.0.1:5174`) | nur ändern, wenn das Dashboard woanders läuft |

   `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase den Functions selbst bereit; die trägst du nicht ein. Der service_role-Schlüssel gehört nie in App, `admin-web` oder Repo. Eine Support- bzw. Antwortadresse liest der Code derzeit noch nicht als Secret; sie kommt mit dem geplanten Mail-Modul (**noch zu klären**).

   Secrets leben nur auf dem Supabase-Server. Du musst sie nicht von Gerät zu Gerät kopieren.

---

## 9. Mail-Dienst und Domain (optional)

1. Bei Resend unter **Domains** die eigene Domain hinzufügen. Resend zeigt die nötigen DNS-Einträge an (SPF, DKIM, gegebenenfalls MX für Rückläufer).
2. Diese Einträge beim **DNS-Anbieter der Domain** anlegen. Viele Anbieter hängen den Domainnamen selbst an: Steht bei Resend z.B. `resend._domainkey.<DEINE-DOMAIN>`, trägst du als Namen nur `resend._domainkey` ein. Sonst entsteht ein doppelter Name.
3. Die Verifizierung dauert Minuten bis Stunden. Danach zeigt Resend die Domain als verifiziert.
4. **Aus lassen:** Empfang (Inbound) und Tracking (Öffnen, Klicks). Die Mails sollen keine Tracking-Pixel und keine umgeschriebenen Links enthalten.
5. **Postfach für die Support-Adresse separat einrichten.** Der Mail-Dienst versendet nur; Antworten von Nutzern brauchen ein echtes Postfach (z.B. beim Anbieter der Domain).
6. Weiteres: Rechtstexte in `docs/legal/`, Abläufe und Platzhalter vor einer Veröffentlichung in [moderation.md](moderation.md), Anbindung in `admin-web/README.md` („E-Mail-Anbieter anbinden“).

---

## 10. Fehlersuche

| Symptom | Ursache | Lösung |
|---|---|---|
| „npm.ps1 kann nicht geladen werden“ | PowerShell blockiert Skripte | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` (Abschnitt 2) |
| `ERESOLVE` beim Installieren | Abhängigkeiten passen nicht zusammen; im Projekt ist TypeScript `~6.0.3` festgelegt (`package.json`), nicht jedes Paket erlaubt diese Version (Erfahrungswert) | Nichts erzwingen. Mit `npm ci` genau die Versionen aus `package-lock.json` installieren; sonst Node-Version prüfen (Abschnitt 1) |
| „Project is incompatible with this version of Expo Go“ | Expo Go unterstützt SDK 57 nicht | Expo Go im App Store aktualisieren |
| Expo Go lädt ewig und bricht ab | Anderes WLAN, Client-Isolation, Firewall oder fehlende Berechtigung „Lokales Netzwerk“ | Abschnitt 5: Firewall-Regel, Berechtigung, oder `npx expo start --tunnel` |
| Rotes Fenster „Supabase ist nicht konfiguriert …“ | `.env` fehlt, heisst anders (z.B. `.env.txt`) oder wurde nach dem Start geändert (`src/lib/supabase.ts`) | `.env` im Hauptordner prüfen, dann `npx expo start -c` |
| `.env.example` statt `.env` bearbeitet | `git status` zeigt `M .env.example`; die App liest `.env.example` nicht | Werte nach `.env` übertragen, dann `git restore .env.example` |
| „Failed to compile … Ionicons.json“ | Paket `@expo/vector-icons` unvollständig installiert (Erfahrungswert) | `npx expo install @expo/vector-icons`, dann `npx expo start -c` |
| „Anmeldung fehlgeschlagen“ im Dashboard | `admin-web/.env` geändert ohne Neustart, falsche URL oder falscher Schlüssel | `npm run dev` neu starten; in der Browserkonsole (F12) nach CSP- oder Netzwerkfehlern sehen |
| „Ausführung fehlgeschlagen. Ist die Edge Function run_data_reset deployt?“ | Function nicht deployt oder nicht erreichbar | `npx supabase functions deploy run_data_reset --use-api`; Logs im Supabase-Dashboard unter Edge Functions |
| „Authentication failed“ bei `git push` | Alte oder abgelaufene Anmeldung gespeichert | Eintrag in der Anmeldeinformationsverwaltung entfernen (Abschnitt 3) |

---

## 11. Sicherheitsregeln für neue Geräte

- Tokens und Schlüssel nie in Git, in die README, in einen Chat oder in `.env.example`. In `.env.example` stehen nur Platzhalter.
- `.env` und `admin-web/.env` sind per `.gitignore` ausgeschlossen. Prüfen:

  ```powershell
  git check-ignore -v .env admin-web/.env
  ```

  Beide Zeilen müssen erscheinen (aus `.gitignore` bzw. `admin-web/.gitignore`). Erscheint eine nicht, die Datei auf keinen Fall committen.
- Terminalfenster, in denen ein Token gesetzt ist (`EXPO_TOKEN`, `SUPABASE_ACCESS_TOKEN`), nach der Arbeit schliessen. Tokens im jeweiligen Konto löschen, sobald du sie nicht mehr brauchst.
- Zwei-Faktor einschalten bei GitHub, Expo, Supabase, Resend und beim Domain-Anbieter.
- Keine Konten, Rollen oder Zugänge von Hand an andere vergeben. Rollen nur über `supabase/admin-setup.sql`, und nur für dich selbst oder bewusst bestimmte Personen.
- Der service_role- bzw. Secret-Schlüssel gehört nie in App, `admin-web` oder Repo, nur als von Supabase bereitgestellter Wert in die Edge Functions.
