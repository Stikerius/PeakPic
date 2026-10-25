# App-Ansicht im Dashboard: Machbarkeit und Entscheidung (Phase 7)

Ziel: das eigene Admin-Konto im Dashboard bedienen wie in der App (gleiche Optik, gleiche
Funktionen, im Browser). Umfragen und offizielle Beiträge laufen weiter über die Dashboard-Seiten.
Dieses Dokument vergleicht drei Wege, belegt sie mit einem Probe-Build und schliesst mit einer
Empfehlung und den Fragen, die du entscheiden musst. **Gebaut wurde nichts Produktives**: Die
Probe lief in einer Kopie im Scratchpad. Das Repository enthält nur dieses Dokument.

## Kurzfassung

- **Empfehlung: Weg C** (die echte App als Web-Build für alle Nutzerfunktionen, auf einem eigenen
  Ursprung; alle Verwaltungsfunktionen bleiben Dashboard-Seiten mit Zwei-Faktor).
- **Eingebettet im Dashboard** (iframe mit `sandbox`), mit einer `frame-src`-Ausnahme für genau den
  Ursprung der Web-App. Ohne deine Freigabe öffnet ein Knopf die Web-App in einem neuen Tab; dann
  gehen „Neu laden“ und „Hell/Dunkel“ nur über die Adresse.
- Die Probe zeigt: Die App läuft im Browser und sieht aus wie auf dem iPhone (Login-Screenshot
  identisch, animiertes Logo). Sie läuft unter einer strengen CSP **ohne** `unsafe-inline` und
  ohne `unsafe-eval`. Nötig sind dafür zwei Hashes für Stile, und für das Fotobearbeiten (Skia)
  zusätzlich `'wasm-unsafe-eval'`.
- `frame-ancestors` als Header verhindert zuverlässig die Einbettung durch fremde Seiten (getestet).
- Die vorgegebene Sicherheitsarchitektur (a–f) ist umsetzbar. Abweichungen und Ergänzungen stehen
  unten.

## Die drei Wege

| | A: Web-Build der App | B: Nachbau in React DOM | C: Mischform (Empfehlung) |
|---|---|---|---|
| Was | `npx expo export --platform web`, eigener Ursprung, im Dashboard eingebettet oder neuer Tab | App-Oberfläche als Dashboard-Seiten neu bauen | wie A für alle Nutzerfunktionen; Verwaltung bleibt Dashboard-Seiten |
| Optik und Verhalten | identisch (gleicher Code) | Nachbau, weicht ab | identisch |
| Codebasen | eine (plus Plattformweichen `.web.ts`) | zwei | eine (plus Plattformweichen) |
| Umfang | ~36 000 Zeilen App-Code wiederverwendet; nur Web-Lücken schliessen | 49 Screens und 81 Komponenten neu, dazu Gesten, Kamera, Chat-Realtime, Editor | wie A |
| Sitzung | eigene Nutzer-Sitzung auf eigenem Ursprung (aal1) | dieselbe Sitzung wie das Dashboard (aal2): Nutzer- und Admin-Rechte vermischt | getrennt: Web-App aal1, Dashboard aal2 |
| CSP Dashboard | unverändert, ausser `frame-src` für einen Ursprung (nur mit Freigabe) | unverändert | wie A |
| Pflege | jede App-Änderung ist sofort auch im Web | jede App-Änderung doppelt | wie A |
| Aufwand Phase 8–10 | mittel | sehr gross | mittel |
| Risiko | Web-Lücken einzelner Pakete (bekannt, siehe unten) | Verhaltensabweichungen, doppelte Fehler, vermischte Rechte | wie A |

A und C unterscheiden sich nur darin, dass C ausdrücklich festhält, dass in der Web-App **keine**
Verwaltung stattfindet. Das entspricht deiner Vorgabe (a), darum C.

B scheidet praktisch aus: Der Aufwand ist ein Vielfaches, und die Dashboard-Sitzung (aal2, Admin)
würde Nutzerfunktionen ausführen. Das widerspricht der Trennung in (a) und (b).

## Probe-Build (Messwerte)

Gebaut am 25.10.2026 mit Expo SDK 57, `react-native-web` 0.21.4, React 19.2.3, in einer Kopie des
Projekts im Scratchpad. Getestet in Microsoft Edge (Chromium, headless) auf 390 × 844 px, über einen
kleinen Node-Server mit strenger CSP als Header.

| Messung | Wert |
|---|---|
| `web.output: "static"` (heutiger Wert in `app.json`) | **bricht ab**: Beim Vorrendern in Node greift Supabase (Sitzung aus AsyncStorage) auf `window` zu |
| `web.output: "single"` (Single-Page-App) | baut ohne Fehler, 35 s |
| Hauptbundle | 4,15 MB, gzip 1,04 MB (+ 45 KB und 1 KB für Routen) |
| Assets (Bilder, Schriften) | 0,7 MB |
| Skia (CanvasKit, nur falls geladen) | 6,9 MB, gzip 2,9 MB |
| Laden lokal (DOMContentLoaded) | ca. 330 ms (ohne Kompression, localhost) |
| Übertragung beim ersten Laden | 4,07 MB unkomprimiert, mit gzip ca. 1,1 MB |
| JS-Speicher nach dem Login-Screen | 16–19 MB |
| Login-Screen | identisch mit dem iPhone (Logo-Animation, Farbsatz, Schrift), siehe Probe-Screenshots |
| Direktlink `/legal/privacy` | lädt den Rechtstext von Supabase (REST über `connect-src`) |
| Schlüssel im Bundle | nur Projekt-URL und Publishable Key; kein `service_role`, kein Secret Key (der Treffer `sb_secret_` ist eine Präfix-Prüfung in supabase-js, kein Schlüssel) |
| `eval` im Bundle | zwei Stellen (UUID-Fallback nur ohne `crypto`; Metro-Nachlader für geteilte Bundles), im Browser nicht ausgeführt; unter `script-src 'self'` kein Verstoss |

### CSP-Prüfung (ohne `unsafe-inline`)

Mit `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:
https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; font-src
'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors <Dashboard>`:

| Variante | Ergebnis |
|---|---|
| ganz streng | Seite lädt, aber **ohne Stile** (0 CSS-Regeln): Zwei Verstösse, das Reset-`<style>` von Expo in `index.html` und das leere `<style>`-Element, das react-native-web anlegt und danach per `insertRule` füllt |
| `style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' 'sha256-<Reset>'` | **keine Verstösse**, 481 CSS-Regeln, Layout korrekt |

- `sha256-47DEQ…` ist der Hash des **leeren** Textes. Er erlaubt nur ein leeres `<style>`-Element;
  die Regeln kommen per CSSOM (`insertRule`), und das schränkt die CSP nicht ein. Fremde Inline-Stile
  bleiben verboten.
- Den Reset-Block verschieben wir in Phase 8 in eine eigene CSS-Datei (eigene `index.html`
  als Vorlage). Dann bleibt nur der Leer-Hash.
- Dynamische Stile setzt React DOM über `element.style` (CSSOM). Das verlangt kein `unsafe-inline`.
  Darum muss die Web-App eine Single-Page-App sein: Vorgerenderte `style="…"`-Attribute würde die
  CSP blockieren.
- Skripte: nur das gebündelte Skript vom eigenen Ursprung, kein Inline-Skript (geprüft in
  `index.html`).
- **Skia** (Story-Ring, Fotobearbeitung) braucht im Web CanvasKit (WebAssembly). Unter der CSP
  muss `script-src` dafür `'wasm-unsafe-eval'` erlauben. Das ist eng begrenzt (nur WebAssembly,
  kein `eval`). Alternative: Story-Ring per SVG, und die Fotobearbeitung im Web mit weniger
  Funktionen oder ausgeblendet.
- **Die Web-App muss auf einem eigenen Ursprung laufen.** Sie braucht eine eigene Richtlinie
  (Supabase-`connect-src`, `wss`, Storage-Bilder, Stil-Hash), die das Dashboard nicht haben soll.
  Ausserdem trennt nur ein eigener Ursprung Speicher und Sitzung (b). Die CSP des Dashboards bleibt
  dabei unverändert, mit Ausnahme von `frame-src` (f).

### Einbettung

| Test | Ergebnis |
|---|---|
| Fremder Ursprung bettet die Web-App ein (`frame-ancestors` erlaubt nur das Dashboard) | **verweigert**: „Framing … violates … frame-ancestors“ |
| Erlaubter Ursprung bettet ein, `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` | läuft, Login sichtbar, keine Verstösse |
| `frame-ancestors` per `<meta>` | wirkt nicht (Browser ignorieren es in Meta-Angaben): Der Auslieferungsserver muss den **Header** setzen |

### Gefundene Fehler im Web (in Phase 8 zu beheben)

- `Appearance.setColorScheme` gibt es im Web nicht: Absturz beim Start (`src/lib/theme.tsx`). In
  der Probe mit `?.` überbrückt; danach lief die App.
- Reanimated meldet „useAnimatedKeyboard is not available on web“ (nur eine Warnung; Tastatur-
  Ausweichen braucht im Browser keine Animation).
- `web.output` muss auf `"single"` (siehe oben).

## Paketliste (aus package.json)

Status: **läuft** · **eingeschränkt** (mit Ersatz) · **nicht verfügbar** (ausblenden oder ersetzen).
„Dateien“ zählt die App-Dateien, die das Paket verwenden.

| Paket | Dateien | Status im Web | Ersatz / Hinweis |
|---|---|---|---|
| expo-router | 69 | läuft | Single-Page-App mit Weiterleitung aller Pfade auf `index.html` (in der Probe: Direktlink funktioniert) |
| react-native-web, react-dom | – | läuft | 0.21.4 / 19.2.3 installiert |
| @expo/vector-icons (Ionicons) | 74 | läuft | Schrift wird gebündelt (`font-src 'self'`) |
| @supabase/supabase-js | 5 | läuft | REST, Auth, Storage über `connect-src`; Sitzung im `localStorage` des eigenen Ursprungs |
| Realtime (Chats, Eingang) | 5 Kanäle | läuft | WebSocket `wss://<projekt>.supabase.co` in `connect-src` |
| Signierte URLs (Fotos, Umfragebilder) | 2 | läuft | `img-src https://<projekt>.supabase.co` |
| @react-native-async-storage/async-storage | 10 | läuft | im Web `localStorage` des Web-App-Ursprungs (in der Probe: `peakpic.loginDesign`) |
| react-native-reanimated | 14 | läuft | `useAnimatedKeyboard` nur Warnung |
| react-native-worklets | 5 | läuft | im Web normales JavaScript |
| react-native-gesture-handler | 15 | eingeschränkt | Wischen und Ziehen mit Maus und Touch; „langes Drücken“ geht mit Maus. Rechtsklick-Menü, Pfeiltasten im Story-Viewer und Escape kommen als Web-Ergänzung |
| react-native-svg | 6 | läuft | Logo-Animation im Probe-Login sichtbar |
| react-native-safe-area-context | 18 | läuft | Ränder 0 im Browser |
| @shopify/react-native-skia | 4 (Story-Ring, Fotobearbeitung) | eingeschränkt | CanvasKit-WASM (6,9 MB) nur bei Bedarf laden, `'wasm-unsafe-eval'`; oder Story-Ring als SVG und die Bearbeitung im Web vereinfachen |
| expo-image | 19 | läuft | `<img>` |
| expo-image-picker | 4 | läuft | Dateiauswahl des Browsers |
| expo-camera | 1 | eingeschränkt | `getUserMedia` mit Browser-Erlaubnis, nur über HTTPS bzw. localhost; sonst Dateiauswahl |
| expo-image-manipulator | 2 | läuft | Canvas im Browser (`blob:`/`data:` in `img-src`) |
| expo-file-system | 5 (Upload, lokales Fotoarchiv, Chat-Hintergründe, Bearbeiten, Konto löschen) | nicht verfügbar | im Web nur Platzhalter: `new File(uri).bytes()` liefert nichts. Ersatz: `fetch(uri).blob()` für Uploads; IndexedDB für Chat-Hintergründe und lokale Fotos, oder ausblenden |
| expo-keep-awake | 1 (Training) | läuft | Screen Wake Lock des Browsers, wo vorhanden |
| expo-haptics | 1 | läuft (ohne Wirkung) | keine Haptik im Browser |
| expo-status-bar, expo-system-ui | 8 / 1 | läuft (ohne Wirkung) | Hintergrundfarbe über CSS |
| expo-constants | 1 | läuft | |
| expo-alternate-app-icons (App-Icon wählen) | 1 Bildschirm | nicht verfügbar | Einstellung im Web ausblenden |
| @expo/ui, expo-device, expo-font, expo-glass-effect, expo-linking, expo-splash-screen, expo-symbols, expo-web-browser, react-native-screens | 0 direkt | – | werden nicht direkt verwendet; react-native-screens nutzt Expo Router intern (im Web ohne native Screens) |

Bedienung: Tastatur- und Maus-Bedienung kommen über react-native-web (Fokus, `role`/`aria-*` aus
`accessibilityRole`/`accessibilityLabel`). Hover-Zustände, Pfeiltasten in Karussellen,
Rechtsklick-Menüs und Escape ergänzt Phase 8. „Bewegung reduzieren“ kommt im Web aus
`prefers-reduced-motion` (Reanimated `useReducedMotion`).

## Sicherheitsarchitektur (a–f): umsetzbar?

| Vorgabe | Umsetzbar | Befund / Abweichung |
|---|---|---|
| a) Web-App als gewöhnlicher Nutzer, eigene Sitzung, kein aal2 | ja | Die Web-App fragt keinen zweiten Faktor ab, die Sitzung bleibt aal1. Alle Admin-Funktionen verlangen serverseitig `is_admin()` **und** aal2 (`require_admin()`): Mit der Web-App-Sitzung werden sie abgelehnt, auch beim Admin-Konto. Nachweis per Test in Phase 10 |
| b) Admin nur im Dashboard (aal2), keine geteilten Speicher/Sitzungen | ja | Eigener Ursprung = eigener `localStorage`. Supabase nutzt keine Cookies. **Hinweis:** Liegen Dashboard und Web-App später auf verschiedenen *Sites* (nicht nur Subdomains derselben Domain), partitionieren Browser den Speicher eingebetteter Seiten: Die eingebettete Web-App hätte dann eine andere Sitzung als im eigenen Tab. Empfehlung: gleiche Hauptdomain (z. B. `admin.…` und `app.…`) |
| c) iframe-sandbox und eng begrenzte Nachrichten | ja | `allow-scripts allow-same-origin allow-forms allow-popups`, ohne `allow-top-navigation*` und ohne `allow-popups-to-escape-sandbox`. `allow-same-origin` ist hier sicher, weil die Web-App einen **anderen** Ursprung hat als das Dashboard (getestet). Nachrichten nur Dashboard → Web-App: `{type:"reload"}`, `{type:"theme", value:"light"|"dark"|"system"}`; die Web-App prüft `event.origin`, `event.source === window.parent`, Typ und Grösse. Keine Antworten mit Daten. Für die Anzeige „angemeldet als …“ (Phase 9) schlage ich **keine** Nachricht vor: Das Dashboard zeigt nur sein eigenes Konto und den Hinweis, dass die App-Ansicht ihr eigenes Login hat (siehe offene Fragen) |
| d) Web-App mit `frame-ancestors` nur für das Dashboard | ja | Muss ein HTTP-Header sein (Meta wirkt nicht); getestet: fremde Ursprünge werden abgewiesen |
| e) keine Anmeldung als anderes Konto | ja | Es gibt keine solche Funktion; Phase 9/10 prüfen es per Test |
| f) `frame-src` im Dashboard nur für diesen Ursprung, nur mit Freigabe | ja | Heute steht `frame-src 'none'`. Mit Freigabe: `frame-src <Ursprung der Web-App>` (lokal z. B. `http://localhost:8088`, später `https://app.<domain>`), sonst nichts geändert. Ohne Freigabe: Knopf „In neuem Tab öffnen“ (`noopener`), Thema per Adresse (`?theme=dark`) |

Zusätzlich vorgesehen: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Opener-Policy: same-origin` (getestet, stört die Einbettung nicht) für die Web-App.
Für Kamera und Mikrofon (nur Kamera wird gebraucht) eine `Permissions-Policy`. Im iframe zusätzlich
`allow="camera"`, falls die Kamera eingebettet nutzbar sein soll.

## Risiken

- **Skia/CanvasKit:** 2,9 MB zusätzlich (gzip) und `'wasm-unsafe-eval'`. Ohne Skia fehlen im Web
  Fotofilter und Overlays des Editors. Entscheidung siehe offene Fragen.
- **expo-file-system:** Hochladen von Fotos braucht im Web einen eigenen Weg (`fetch(uri).blob()`).
  Das lokale Fotoarchiv und die Chat-Hintergründe brauchen IndexedDB oder werden ausgeblendet.
- **Bundle 1 MB gzip:** gut für ein Dashboard-Werkzeug. Für langsame Netze in Phase 10
  Kompression (gzip/brotli) im Auslieferungsserver und langes Caching der gehashten Dateien.
- **Gesten:** Story-Viewer, Wischen zum Schliessen und Chat-Wischgesten sind für Touch gebaut. Im
  Web braucht es Tastatur- und Maus-Alternativen (Pfeile, Escape, Kontextmenü).
- **Kamera:** nur in sicherem Kontext (HTTPS oder localhost). Im iframe zusätzlich mit
  `allow="camera"` und Erlaubnis des Browsers.
- **Speicherpartitionierung** bei unterschiedlichen Sites (siehe b).
- **Expo-Updates:** Ein späteres SDK könnte die Web-Ausgabe ändern (SDK 58 setzt in Vorlagen
  `server` als Standard). `single` bleibt laut Doku verfügbar.

## Aufwandsschätzung (Phase 8 bis 10)

| Phase | Inhalt | Schätzung |
|---|---|---|
| 8 | `web.output: single`, eigene `index.html` (Reset als CSS-Datei), Auslieferungsskript mit Headern (CSP, `frame-ancestors`, nosniff, Referrer), `npm run web:build` / `web:serve` (eigener Port, z. B. 8088); Web-Weichen: Theme, Upload ohne file-system, IndexedDB für Chat-Hintergründe und lokale Fotos (oder ausblenden), App-Icon ausblenden, Skia-Entscheidung, Tastatur/Maus im Story-Viewer und Chat-Menü; Unit-Tests der Weichen, Lückenliste, grep im Bundle | gross (umfangreichste Phase) |
| 9 | Dashboard-Seite „App-Ansicht“ (Rahmen 360/390/430/frei, Hoch/Quer), Seitenleiste mit Schnellaktionen und Meldungszähler, `postMessage` (2 Nachrichten), Ankündigungen (Datenmodell, Server, Dashboard-Reiter, App-Karte, Profil-Tab), Nutzungsereignisse, Tests | gross |
| 10 | Sicherheitsprüfung mit Nachweisen (CSP vorher/nachher, Sandbox, Nachrichtentests, Admin-Funktion mit Web-Sitzung abgelehnt, keine Tokens in URLs/Logs, grep, `frame-ancestors`), Barrierefreiheit, Leistung (Sichtbarkeit: Animationen und Realtime pausieren), Dokumentation, Testcheckliste | mittel |

## Offene Fragen (deine Entscheidung)

1. **Weg:** A, B oder C? Empfehlung: **C**.
2. **Einbettung oder neuer Tab?** Empfehlung: **Einbettung**. Sie braucht die Freigabe einer
   `frame-src`-Ausnahme im Dashboard für genau den Ursprung der Web-App (lokal
   `http://localhost:8088`, später deine App-Subdomain), sonst nichts. Ohne Freigabe: neuer Tab.
3. **Skia im Web:** (a) CanvasKit nur bei Bedarf laden (voller Funktionsumfang, +2,9 MB beim
   ersten Bearbeiten, `'wasm-unsafe-eval'` in der CSP der **Web-App**, nicht des Dashboards), oder
   (b) ohne Skia: Story-Ring per SVG, Fotobearbeitung im Web nur Zuschneiden/ohne Filter.
   Empfehlung: **(a)**, weil die Optik identisch bleibt und die Ausnahme nur WebAssembly betrifft.
4. **Port** der Web-App lokal: Vorschlag 8088 (Dashboard bleibt 5174, Expo-Dev-Server 8081
   bleibt unberührt).
5. **Anzeige „angemeldet als …“ (Phase 9):** Die Vorgabe will den Benutzernamen in der Seitenleiste.
   Dafür müsste die Web-App ihn per Nachricht ans Dashboard schicken (eine Nachricht *mit* Daten,
   Richtung Web-App → Dashboard). Vorschlag: genau eine Nachricht `{type:"account", username}`
   (nur der öffentliche Benutzername, keine ID, keine Tokens). Sonst zeigt das Dashboard nur
   „eigenes Login in der App-Ansicht“. Bitte bestätigen.
6. **Spätere Domain:** Dashboard und Web-App unter derselben Hauptdomain (Speicher-
   partitionierung, siehe b)?
