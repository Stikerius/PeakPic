This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Design-Regeln

- **Immer `useTheme()` und die Tokens aus `src/constants/theme.ts` nutzen.** Styles, die Farben brauchen, werden mit `makeStyles(({ colors }) => StyleSheet.create({ … }))` aus `src/lib/theme.tsx` definiert und in der Komponente mit `const styles = useStyles();` geholt. Farben in JSX-Props (Icons, Indikatoren, Placeholder) kommen aus `const { colors } = useTheme();`.
- **Nie Hex-, `rgb()`- oder benannte Farben in Komponenten.** Einzige Ausnahme sind die Token-Gruppen `onPhoto` (UI über Fotos), `photoTextColors`, `storyRingGradient` und `flameColors` — auch diese werden nur aus `theme.ts` importiert, nicht neu definiert. Prüfen mit `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src` (Treffer nur in `src/constants/theme.ts`).
- **Foto-Oberflächen bleiben dunkel:** Kamera, Story-Viewer, Erstellen-Screens und Vollbild-Fotoviewer sind in `<DarkScheme>` eingepackt und setzen ihren Status-Bar-Stil selbst. Text auf der Akzentfarbe nutzt `colors.onAccent`, nicht `colors.text`.
- **Jede neue Ansicht in Hell UND Dunkel testen** (Einstellungen → Darstellung), dazu mit grosser Systemschrift (Dynamic Type) auf einem kleinen iPhone.
- **Design-Prinzipien für alles Neue:**
  - Ruhig und funktional: keine dekorativen Verläufe (Ausnahme: Ring ungesehener Storys), keine Glow-Effekte, keine farbigen Schatten, kein Glasmorphismus, keine Emojis als UI-Icons.
  - Eine Akzentfarbe (Flammen-Orange), sparsam: Hauptaktion, aktiver Tab, Streak-Flamme. Alles andere neutral.
  - Tiefe über 1px-Linien (`border`, `divider`) und Flächenabstufung (`background` → `surface` → `surfaceRaised`), nicht über Schatten. Listen mit feinen Trennlinien statt Karte-in-Karte.
  - Radius nur aus `radius` (8/12/16), Vollrunde nur bei Avataren und Pills. Abstände nur aus `spacing` (4/8/12/16/24/32), überall gleiche Seitenränder.
  - Typografie aus `typography` (Titel 28, Überschrift 20, Body 16, Caption 13, Label 12), keine Grossbuchstaben-Überschriften, Zahlen wie der Streak mit `typography.numeric` (tabular-nums).
  - Touch-Ziele mindestens 44pt. Icons nur aus Ionicons; aktiv gefüllt, inaktiv umrandet.
  - Animationen kurz und dezent (Press-Feedback: leicht abdunkeln/skalieren).
  - Echte Zustände: Skeletons für ladende Listen, leere Zustände mit kurzem sachlichem Text und klarer Aktion, verständliche Fehlertexte. Texte auf Deutsch, knapp und nüchtern.
