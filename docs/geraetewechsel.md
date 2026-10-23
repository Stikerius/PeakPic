# Zwischen Rechnern wechseln

Was du ausser `git pull` tun musst, damit PeakPic auf einem anderen Rechner gleich läuft.

Stand: 23.10.2026 (wird bei jeder Änderung am Setup nachgeführt)

## Kurz: jedes Mal nach dem Wechsel

```bash
git pull
npm install                  # im Hauptordner
cd admin-web && npm install && cd ..
npx expo start               # oder: npx expo start --tunnel
```

Danach prüfen, ob du in Supabase noch etwas nachholen musst (siehe „Gemeinsam für alle Rechner“).

## Einmal pro neuem Rechner

1. **Werkzeuge installieren:**
   - Node.js 24 (zuletzt verwendet: v24.16.0)
   - Git
   - VS Code (die empfohlenen Erweiterungen stehen in `.vscode/extensions.json`)
2. **Repository holen:** `git clone …` und `cd PeakPic`.
3. **`.env` im Hauptordner anlegen:** Kopie von `.env.example`. Sie braucht:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   Beide Werte findest du in Supabase → Project Settings → API. Hierher gehören nur öffentliche Werte, nie der `service_role`-Key.
4. **`admin-web/.env` anlegen:** Kopie von `admin-web/.env.example`, mit `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` (dieselben Werte).
5. **Pakete installieren:** `npm install` im Hauptordner und in `admin-web/`.
   - Nie `--force` oder `--legacy-peer-deps`, kein `npm audit fix`.
   - Neue Pakete nur mit `npx expo install <paket>`.
6. **Supabase CLI** (nur für Edge Functions nötig):

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   ```

   Den `project-ref` siehst du in der Adresse des Supabase-Dashboards. Der Ordner `supabase/.temp/` ist absichtlich nicht im Git.
7. **EAS** (nur für Builds und Updates): `npx eas-cli@latest login`.
8. **iPhone:** Expo Go für SDK 57. Ist das iPhone nicht im selben WLAN wie der Rechner, starte mit `npx expo start --tunnel`.

## Gemeinsam für alle Rechner (nicht pro Rechner wiederholen)

Datenbank, Edge Functions und Storage liegen bei Supabase. Sie sind für alle Rechner gleich und müssen nur einmal nachgezogen werden, wenn sich etwas geändert hat.

- **Datenbank:** Hat sich `supabase/schema.sql` seit deinem letzten Ausführen geändert, führe die komplette Datei im Supabase SQL-Editor aus, danach `notify pgrst, 'reload schema';`. Die letzten Änderungen siehst du mit:

  ```bash
  git log --oneline -- supabase/schema.sql
  ```

- **Edge Functions:** Hat sich etwas in `supabase/functions/` geändert, die betroffene Function neu deployen:

  ```bash
  npx supabase functions deploy delete_account
  npx supabase functions deploy send_legal_notice_email
  npx supabase functions deploy login_with_username
  ```

  Prüfen kannst du das mit `git log --oneline -- supabase/functions`.
- **Skripte für den SQL-Editor**, die nicht Teil von `schema.sql` sind:
  - `supabase/admin-setup.sql`: Rollen für das Dashboard.
  - `supabase/seed-legal.sql`: Rechtstexte.
  - `supabase/backfill-usage.sql`: einmalig.
  - `supabase/maintenance.sql`: Aufräumen, nach Bedarf.
  - `supabase/test-notifications.sql`: nur mit Testkonten.
  - `supabase/seed-testaccount.sql`: zwei Monate Verlauf für ein Testkonto.

  Diese musst du beim Rechnerwechsel nicht erneut ausführen.

## Was nur auf einem Gerät liegt

- **Auf dem Rechner, nicht im Git:**
  - `.env` und `admin-web/.env`
  - `node_modules/`
  - `.expo/` (Cache, wird neu erzeugt)
  - `supabase/.temp/` (Supabase-Verknüpfung)
  - deine Logins bei Supabase CLI und EAS
- **Auf dem iPhone in der App, nicht auf dem Server:**
  - ein laufender Trainingsentwurf
  - Chat-Hintergründe
  - Pausentimer
  - der Schalter „Anonyme Nutzungsstatistik“

  Ein Rechnerwechsel ändert daran nichts. Bei einem neuen iPhone sind diese Dinge weg.

## Wenn etwas nicht stimmt

- **Die App zeigt alte Stände oder seltsame Fehler:** `npx expo start -c` leert den Cache.
- **Typen oder Tests prüfen:** `npx tsc --noEmit`, `npm test`, `npx expo lint`.
- **Abhängigkeiten prüfen:** `npx expo-doctor`. Bekannt: Drei Patch-Versionen sind veraltet. Das behebt `npx expo install --fix`; danach erneut `npm install` auf den anderen Rechnern.
- **Dashboard starten:** `cd admin-web && npm run dev` (läuft auf http://127.0.0.1:5174).

## Aktuell offen

- Edge Function `login_with_username` deployen (siehe oben), sonst geht die Anmeldung mit Username nicht.
- `supabase/schema.sql` ausführen, falls noch nicht nach dem letzten Commit geschehen.
- Den früher versehentlich geteilten Expo-Token widerrufen (expo.dev → Account → Access Tokens).
- `npx expo install --fix` für die drei Patch-Versionen.
