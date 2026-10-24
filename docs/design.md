# Design: Logos, Animationen und Dashboard-Gestaltung

Diese Datei beschreibt das Design-System des Admin-Dashboards (`admin-web/`), die Logo-Bibliothek
und die Logo-Animation im Anmeldebildschirm der App. Für die App selbst gelten weiter die
Design-Regeln in `AGENTS.md`.

## Überblick

| Teil | Wo | Was |
|---|---|---|
| Gemeinsame Logik | `shared/brand/` | Logo-Spezifikation, Presets, Ablauf der Animation, Paletten, öffentliche Konfiguration. Ohne React, ohne Plattform-APIs; App (Metro) und Dashboard (Vite) importieren denselben Ordner. |
| App-Login | `src/components/brand-animation/`, `src/app/login.tsx`, `src/lib/loginDesign.ts` | Logo-Animation hinter dem Formular (Reanimated und react-native-svg). |
| Dashboard | `admin-web/src/` | Tokens, Stile, Seiten „Logos“ und „Design“, Hintergrundanimationen. |
| Server | `supabase/schema.sql` (Abschnitt „brand“), Edge Function `logo_import` | Bibliothek, Presets, Zuordnung der Ziele, Konfiguration des App-Logins, SVG-Prüfung. |

Die Edge Function nutzt eine identische Kopie der Logo-Spezifikation
(`supabase/functions/_shared/brandLogoSpec.ts`), weil geteilter Code laut Supabase in
`supabase/functions/_shared` liegt. Ein Test prüft, dass beide Dateien Zeichen für Zeichen gleich
sind. Änderungen immer in `shared/brand/logoSpec.ts` machen und die Datei kopieren.

## Tokens und Stile (Dashboard)

- **Eine Quelle für Farben:** `admin-web/src/lib/tokens.ts`. Die Werte werden als CSS-Variablen über
  das CSSOM gesetzt (`element.style.setProperty`), was die strenge CSP erlaubt. `styles.css`
  schreibt nie selbst eine Farbe (Test: keine Hex-, `rgb()`- oder `hsl()`-Werte in `styles.css`).
- **Tokens:** `bg`, `surface`, `raised`, `chrome` (Seitenleiste und Kopfleiste), `border`,
  `divider`, `row-hover`, `text`, `text-2`, `text-3`, `accent`, `on-accent`, `accent-soft`, `focus`,
  `danger`, `success`, `warn-bg`, `warn-text`, `diff-added`, `diff-removed`, `backdrop`, `skeleton`,
  `qr-bg`, `muted-dot`, `ambient-line`, `ambient-alert`.
- **Nicht-Farben pro Stil** (Radien, Breite der Seitenleiste, Übergänge) stehen in `styles.css` unter
  `:root[data-style="…"]`.
- **Stile:** „Neu“ (Standard) und „Klassisch“ (das erste Aussehen). Beide nutzen dasselbe Markup;
  der Stil wählt Tokens und eine Handvoll Layoutregeln.
- **Kontrast:** Ein Test prüft für jede Kombination aus Stil, Modus und Palette WCAG AA (Text 4,5:1,
  Bedienelemente und Fokus 3:1), auch für Text auf dem Seitengrund unter einer Linie der
  Hintergrundanimation bei voller Deckkraft (0,18).

### Neu: Gestaltungsprinzipien

Tiefschwarzer Grund im Dunkelmodus, warmes Hellgrau im Hellmodus, 1-Pixel-Linien statt Schatten,
Systemschrift, tabellarische Ziffern, Tabellen mit sichtbarem Zeilen-Hover, schmale Seitenleiste mit
Icons und Beschriftung (mit `[` oder dem Pfeil auf Icons einklappbar), Kopfleiste mit Bereich und
Seite, Befehlspalette (Strg+K), Tastaturkürzel (`?`), Übergänge 150 bis 200 ms, Skeletons statt
Spinner, klare leere Zustände, deutliche Fokusringe, auf Touch-Geräten mindestens 44 px Ziele. Keine
Leuchteffekte, keine farbigen Schatten, keine dekorativen Verläufe. Seitenleiste und Kopfleiste sind
leicht transparent; die Unschärfe dahinter ist aus, solange Hintergrundanimationen laufen (sie müsste
sonst jedes Bild neu berechnet werden).

### Paletten

| Palette | Modus | Akzent | Text auf Akzent |
|---|---|---|---|
| Hauptfarbe | Dunkel | `#ff5a36` | `#1b0f0a` |
| Hauptfarbe | Hell | `#f2481f` | `#1b0f0a` |
| Schwarz-Weiss | Dunkel | `#fafafa` | `#1b0f0a` |
| Schwarz-Weiss | Hell | `#18181b` | `#ffffff` |

Grundfarben der Logo-Animation: Dunkel Grund `#09090b`, Linien `#27272a`, gedämpfte Punkte
`#3a3a40`; Hell Grund `#f7f7f5`, Linien `#e4e4e0`, gedämpfte Punkte `#cfcfc8`. Quelle:
`shared/brand/palettes.ts`; die App gibt sie in `src/constants/theme.ts` als Tokens weiter.

### Hauptfarben (Farbsätze)

Die Palette „Hauptfarbe“ nimmt ihren Akzent aus einem **Farbsatz** (Tabelle `brand_colors`):
Name (1–40 Zeichen), Akzent für Dunkel und für Hell (`#rrggbb`), optional bis 8 Diagrammfarben
(sonst abgeleitet). „Schwarz-Weiss“ hängt von keinem Farbsatz ab. Eingebaut und nicht löschbar:

| Farbsatz | Dunkel | Hell | Text auf Akzent (Dunkel / Hell) |
|---|---|---|---|
| Orange (Standard) | `#ff5a36` | `#f2481f` | `#1b0f0a` / `#1b0f0a` |
| Blau | `#4d9fff` | `#1f6fd6` | `#1b0f0a` / `#ffffff` |
| Grün | `#34c77b` | `#14804a` | `#1b0f0a` / `#ffffff` |
| Violett | `#a78bfa` | `#7c3aed` | `#1b0f0a` / `#ffffff` |
| Rot | `#ff6b6b` | `#d62839` | `#1b0f0a` / `#ffffff` |

**Lesbarkeit** (gleiche Regeln in `shared/brand/colors.ts` und `brand_color_set_problem()` in der
Datenbank, ein Check auf der Tabelle; der Editor zeigt bei Verstoss einen korrigierten Vorschlag):

- Akzent mindestens 3 : 1 gegen jeden Hintergrund seines Modus (`REFERENCE_BACKGROUNDS`).
- Text auf dem Akzent ist `#1b0f0a` oder `#ffffff`, je nachdem, was mehr Kontrast hat; mindestens 4,5 : 1.
- Links nutzen `--accent-text`: der Akzent, falls nötig abgedunkelt oder aufgehellt auf 4,5 : 1.
- Diagrammfarben mindestens 3 : 1 auf hellen und dunklen Hintergründen; Diagramme zeigen zusätzlich
  Muster und die Werte als Text (`PatternChart`), Farbe ist nie die einzige Unterscheidung.

**Ziele:** `dashboard_colors` (Dashboard aller Staff-Konten, auch die Anmeldeseite) und
`app_login_colors` (nur Anmeldebildschirm und Logo-Animation der App, nur bei der Palette
„Hauptfarbe“; der Rest der App bleibt beim Flammen-Orange). Beide kommen öffentlich über
`get_public_design_config()` (`colors`, `dashboard_colors`: Name, zwei Akzente, Diagrammfarben, keine
IDs). App und Dashboard prüfen die Werte erneut und fallen auf „Orange“ zurück.

**Verwaltung** (Design → Hauptfarben, nur Admins mit Zwei-Faktor): `admin_color_list`,
`admin_color_save` (Neu, Duplizieren, Bearbeiten, Umbenennen; höchstens 20 eigene), `admin_color_delete`
(nicht eingebaute, nicht aktive), `admin_color_activate`. Jede Änderung steht mit Vorher-Nachher in
`moderation_actions` (`color_create`, `color_update`, `color_delete`, `color_activate`).

### Wahl im Dashboard

Pro Browser gespeichert (`localStorage`, ohne Bezug zur Person): Stil, Modus (System, Hell, Dunkel),
Farbe (Hauptfarbe, Schwarz-Weiss), Hintergrundanimationen (An, Ruhig = Standbild, Aus). Standard:
Neu, System, Schwarz-Weiss, An. Eine fehlende oder kaputte Einstellung fällt Wert für Wert auf den
Standard zurück. Die Anmeldeseite hat ein kleines Menü „Darstellung“ für Modus und Farbe. Das Logo
kommt nie aus einer lokalen Wahl, sondern aus der Bibliothek (aktives Logo des Ziels „Dashboard“).

## Logo-Bibliothek

### Logo-Spezifikation

Logos werden nie als SVG-Text gespeichert oder gezeichnet, sondern als geprüfte JSON-Struktur:

```json
{
  "version": 1,
  "viewBox": [minX, minY, breite, höhe],
  "shapes": [
    { "type": "path", "d": "M…Z", "role": "fill", "transform": [a, b, c, d, e, f], "fillRule": "evenodd" },
    { "type": "circle", "cx": 0, "cy": 0, "r": 10, "role": "cutout", "transform": [1, 0, 0, 1, 0, 0] },
    { "type": "polyline", "points": [0, 0, 10, 10], "role": "stroke", "strokeWidth": 2, "transform": [1, 0, 0, 1, 0, 0] }
  ]
}
```

- **Formtypen:** `path`, `circle`, `ellipse`, `rect` (mit `rx`, `ry`), `line`, `polygon`,
  `polyline`.
- **Rollen:** `fill` („Fläche“), `cutout` („Ausschnitt“, wird über eine Maske aus den Flächen
  ausgeschnitten, nie mit der Hintergrundfarbe übermalt), `stroke` („Nur Linie“).
- **Optional:** `strokeWidth` (0,01 bis 1000), `fillRule` (`nonzero` oder `evenodd`).
- **Grenzen:** höchstens 100 Formen, 20 000 Zeichen und 4000 Befehle je Pfad, insgesamt 8000
  Befehle und 100 000 Pfadzeichen, Zahlen betragsmässig höchstens 100 000, Matrix-Anteile a bis d
  höchstens 1000, Matrix nicht entartet. Pfaddaten nur aus `MmLlHhVvCcSsQqTtAaZz`, Ziffern,
  Leerzeichen, Komma, Punkt, Minus, `e`, `E`.
- **Prüfung:** `validateLogoSpec` (TypeScript) und `brand_logo_spec_valid` (SQL) prüfen dieselben
  Regeln; ein Test vergleicht beide an manipulierten Strukturen. Vor jedem Zeichnen wird erneut
  geprüft; bei einem Fehler erscheint das eingebaute App-Logo.
- **Farbe:** Alle Logos erscheinen einfarbig in der Akzentfarbe der gewählten Palette; Farben aus
  der Datei werden nicht übernommen (sie dienen beim Import nur als Hinweis für Ausschnitte).
- **Darstellung:** nur über React-Elemente (Dashboard) bzw. react-native-svg (App), nie über
  `img`, `innerHTML`, `dangerouslySetInnerHTML` oder Daten-URLs.

### Eingebaute Logos

- **App-Logo:** die Formen von `assets/peakpic-icons/svg-quellen/default_bw.svg` (Arm, Linse,
  Kappe, ausgeschnittener Innenkreis), ohne das quadratische Hintergrundfeld. Ein Test vergleicht
  sie mit der Datei.
- **Flamme:** PLATZHALTER. Der Anmeldebildschirm zeigte das Ionicons-Zeichen „flame“ (eine
  Schriftglyphe, keine Vektordatei im Projekt). Bis eine Vektordatei der Flamme vorliegt, ist die
  Platzhalterform hinterlegt (in `shared/brand/logoSpec.ts` und in `schema.sql` markiert).

Eingebaute Logos lassen sich nicht löschen; bei ihnen lässt sich nur das Preset ändern.

### Presets (Animation)

| Parameter | Bereich | Standard |
|---|---|---|
| Dauer des Durchlaufs (Sekunden) | 4 bis 16 | 8 |
| Linie zeichnen | an/aus | an |
| Zeichen-Anteil | 0,1 bis 0,5 | 0,30 |
| Linienstärke | 1 bis 6 | 2,4 |
| Füllen | an/aus | an |
| Füll-Art | Einblenden, Wischen von unten, Wischen von links, Aufblühen | Einblenden |
| Glanz, Breite, Neigung | an/aus, 20 bis 120, −30 bis +30 Grad | an, 50, 12 |
| Welle, Stärke, Endskalierung | an/aus, 0,3 bis 1, 3 bis 8 | an, 0,95, 6 |
| Punktraster, Abstand, Punktradius, Leuchtpunktradius, Randausblendung | an/aus, 12 bis 28, 0,8 bis 2,2, 1,2 bis 2,6, 0,2 bis 0,8 | an, 18, 1,1, 1,6, 0,35 |
| Atmen, Stärke (Prozent) | an/aus, 0 bis 4 | an, 2 |
| Halten (Anteil des Durchlaufs) | 0 bis 0,4 | 0,20 |
| Ausblenden | Ausblenden, Schrumpfen, keines | Ausblenden |
| Easing | weich, knackig, linear | weich |

„Füllen“ ist zusätzlich zur ursprünglichen Liste nötig, damit „Nur Zeichnen“ möglich ist.
„Halten“ ist die Zeit zwischen dem Ende der Welle und dem Ausblenden.

**Standard-Ablauf** (abgenommen, per Test festgehalten): 0 bis 30 % Kontur zeichnen
(cubic-bezier(0.45,0,0.2,1)), 25 bis 42 % Füllung einblenden (0,97 auf 1, ease-out), 36 bis 48 %
Kontur ausblenden, 40 bis 62 % Punktewelle (Ring mit konstanter Linienbreite 90, Radius 60,
Skalierung 0,15 auf 6, Deckkraft 0,95 bei 42 %), 42 bis 62 % Glanz (50 breit, 12 Grad), 50 bis 80 %
Atmen (1,02 bei 65 %), 82 bis 95 % ausblenden, danach Pause. Andere Parameter verschieben die Phasen
anteilig; würde der Durchlauf über 95 % hinausgehen, werden alle Phasen gestaucht.

Eingebaute Presets: „Standard“, „Ruhig“ (nur Einblenden und Punktraster), „Lebendig“ (Aufblühen,
Glanz, kräftige Welle, 6 Sekunden), „Nur Zeichnen“. Eigene Presets lassen sich anlegen, duplizieren,
umbenennen und löschen, letzteres nur, wenn kein Logo sie verwendet.

Diese Parameter (v1) bleiben die Grundlage des Tabs „Einfach“. Gespeichert und abgespielt wird seit
dem Animations-Editor immer „Animation v2“ (nächster Abschnitt).

### Animation v2 (Editor)

Eine Animation ist eine Zeitleiste mit Spuren (`shared/brand/animation.ts`, Typ `AnimationSpec`):
`{ version: 2, duration, strokeWidth, tracks }`. Nur feste Spurarten mit Zahlen in festen Bereichen,
kein Code, keine Ausdrücke, keine freien Texte (nur der Name des Presets).

| Spurart | Wert der Keyframes | Weitere Einstellungen |
|---|---|---|
| Linie zeichnen | gezeichnet 0 bis 1 | – |
| Füllen | gefüllt 0 bis 1 | Einblenden, Aufblühen, Wischen von unten/oben/links/rechts |
| Glanz | Position 0 bis 1 | Breite 20 bis 120, Neigung ±30°, Stärke 0,1 bis 0,8 |
| Welle (mehrere möglich) | Deckkraft 0 bis 1 | Endgrösse 3 bis 8, Easing des Wachsens |
| Punktraster (höchstens eines) | Leuchten 0 bis 1 | Leuchten oder Verlauf, Abstand, Radien, Randausblendung |
| Funken | Flug 0 bis 1 | Anzahl (alle Spuren zusammen höchstens 40), Seed, Grösse, Flugweite |
| Atmen | Grösse ±0,1 (±10 %) | – |
| Drehen | Winkel ±360° | – |
| Schweben | Verschiebung ±30 Einheiten | waagrecht oder senkrecht |
| Ausblenden | 0 bis 1 | Ausblenden oder Schrumpfen, ganzes Logo, nur Linie oder nur Füllung |
| Farbwechsel | Mischung 0 bis 1 | von/nach: Akzent, Akzent hell, Akzent dunkel, Neutral |

Jede Spur hat: Ziel (alle Formen, eine Form, Formen einer Rolle; Glanz, Welle, Punktraster und
Funken wirken immer auf alles), 1 bis 12 Keyframes (Zeit 0 bis 1 aufsteigend, Wert, Easing des
folgenden Segments), Staffelung (keine, in Reihenfolge, von der Mitte, zufällig mit Seed; Versatz 0
bis 0,5 des Durchlaufs) und Wiederholung 1 bis 4 innerhalb des Durchlaufs. Vor dem ersten und nach
dem letzten Keyframe gilt dessen Wert; Glanz, Wellen und Funken sind nur zwischen erstem und letztem
Keyframe sichtbar. Spuren für alle Formen ohne Staffelung wirken auf ganze Ebenen (Logo, Füllung,
Linie), die übrigen zusätzlich auf einzelne Formen.

**Easing** (`shared/brand/easing.ts`): Auswahl (Linear, Weich, Knackig, Ein, Aus, Ein und Aus, je
auch stark), eigene Kurve (cubic-bezier, x 0 bis 1, y −1 bis 2), Feder (Dämpfung 0,2 bis 1, 1 bis 6
Schwünge), Abpraller (1 bis 4, Höhe 0,2 bis 0,8), Halten; jede Kurve auch „umgekehrt“ (in der Zeit
gespiegelt).

**Grenzen** (gleich in `validateAnimationSpec` und `brand_animation_problem()`, ein Test vergleicht
beide an über 1400 gültigen und manipulierten Specs): Dauer 2 bis 30 Sekunden, Linienstärke 1 bis
6, höchstens 16 Spuren und 12 Keyframes je Spur, alle Zahlen endlich und in ihren Bereichen, Seeds
ganze Zahlen, unbekannte Felder werden abgelehnt.

**Kosten**: Anzahl animierter Elemente mal Aufwand der Spurart (Linie 1 je Form, Füllen 2, Glanz 4,
Welle 6, Punktraster 3 bzw. 5 als Verlauf, Funke 1, Farbe 2, sonst 1; Spuren auf einzelnen Formen
zählen die erreichten Formen, dazu einmal eine Ebene je Form). Warnung ab 80, Grenze 160 (bei 24
Formen gerechnet, mehr Formen werden nicht einzeln animiert). Über der Warnung starten App und
Dashboard gleich eine Stufe leichter. Zur Laufzeit schalten beide bei zu vielen langsamen Bildern
weiter herunter (`limitAnimation`): Stufe 1 höchstens 12 Funken, 2 Wellen, Verlauf als Leuchten,
weitere Punkte; Stufe 2 keine Funken und kein Glanz, eine Welle, ruhiges Raster. Zeichnen, Füllen,
Bewegung und Ausblenden bleiben, der Ablauf ändert sich nicht.

**Migration**: v1-Presets werden mit `migrateV1` umgewandelt; jede Phase von `brandTimeline` wird
eine Spur mit denselben Zeiten, Kurven und Werten. Ein Test vergleicht „Standard“, alle eingebauten
und 120 zufällige v1-Presets an je über 400 Zeitpunkten mit `brandFrame`: alle Werte sind exakt
gleich (`Object.is`). Die Datenbank hat `animation_presets.spec_version` und `spec`; eingebaute
Presets sind v2 (Seeds im Schema, per Test gleich der Migration), ältere eigene Presets bleiben v1
lesbar und werden beim Lesen umgewandelt, beim nächsten Speichern v2.

**Editor** (Logos → Animation, Tab „Editor“; der Tab „Einfach“ zeigt die Standard-Parameter):
Vorschau mit Abspielen, Pause, Bild für Bild, Tempo 0,25 bis 2, Bereich als Schleife, Bildrate und
Kosten; A-B-Vergleich, Hell/Dunkel, Hauptfarbe/Schwarz-Weiss, Standbild-Test und Vorschau für
„Bewegung reduzieren“. Zeitleiste mit Zoom, Raster zum Einrasten und Abspielkopf (Maus und Tastatur);
Spuren hinzufügen, solo, stumm, umsortieren, duplizieren, löschen; Keyframes ziehen, mehrfach
auswählen, kopieren, einfügen, löschen; Rückgängig und Wiederholen (100 Schritte). Eigenschaften je
Spur und Keyframe, Easing-Werkzeug mit zwei Ziehpunkten, Formenliste (hervorgehoben in der
Vorschau), Werkzeuge „Staffeln“, „Zufall“ (innerhalb der Bereiche, mit Seed), „Zeit spiegeln“,
„Tempo skalieren“; Vorlagen (die vier eingebauten Presets sowie „Pulsieren“, „Funkeln“,
„Wellenstart“, „Zeichnen und Drehen“); Export und Import als JSON (höchstens 64 KB, geprüft wie ein
Upload); Versionsverlauf (letzte 10 Speicherungen je Preset in `preset_versions`, „In den Editor
laden“, dann speichern).

**Bedienung ohne Maus**: Tab wechselt die Spur, ←/→ verschiebt die gewählten Keyframes (Umschalt
10-fach), ↑/↓ ändert den Wert, Alt+←/→ oder [ ] wählt den vorigen/nächsten, Enter legt einen beim
Abspielkopf an, Entf löscht, Strg+C/V, Strg+Z/Y, Leertaste. Im Lineal ←/→ ein Bild, Bild↑/↓ 10 %.
Ausgewählte Keyframes sind grösser und gefüllt, stumme Spuren gestrichelt und mit „stumm“
beschriftet (nie nur über Farbe).

**Server** (`admin_preset_save(id, name, spec, params)`, `admin_preset_delete`,
`admin_preset_versions`; Admin mit Zwei-Faktor): prüft die Spec erneut und lehnt Ungültiges ab
(`invalid_spec`), speichert eine Version (die letzten 10 bleiben), protokolliert Name, Hash der Spec,
Dauer und Spurzahl vorher und nachher (nie die ganze Spec). `get_public_design_config()` und
`get_dashboard_logo()` liefern bei v2-Presets die Spec, sonst die v1-Parameter; App und Dashboard
prüfen erneut und fallen auf „Standard“ zurück.

### Ziele und Aktivieren

- **App-Anmeldung** (`app_login`): Logo-Animation im Anmeldebildschirm der App.
- **Dashboard** (`dashboard`): Anmeldeseite, Ladebildschirm, Kopf der Seitenleiste.

Jedes Ziel hat genau ein aktives Logo; das Logo bringt sein Preset mit. Beim Aktivieren sind
standardmässig alle Ziele angehakt, die das bisher aktive Logo (das der App-Anmeldung) verwenden.
Aktivieren, Speichern, Löschen und Presets laufen nur über die `admin_logo_*`- und
`admin_preset_*`-Funktionen (Admin mit Zwei-Faktor) und werden in `moderation_actions` protokolliert.
Ein aktives Logo lässt sich nicht löschen; höchstens 30 hochgeladene Logos, 50 eigene Presets.

### Konfiguration des App-Logins

`app_design_config` (genau eine Zeile): Palette, Modus (System, Hell, Dunkel), Animation (an/aus).
Geändert über die Seite „Design“ (`set_app_design_config`, protokolliert mit Vorher und Nachher).
Die App liest `get_public_design_config()` (öffentlich, nur Palette, Modus, Animation, Logo und
Preset) beim Öffnen des Anmeldebildschirms mit 2,5 Sekunden Zeitlimit, speichert den letzten Stand
lokal und fällt sonst auf diesen Stand oder die eingebauten Standardwerte zurück. Der Login wartet
nie darauf. Der Modus gilt nur für den Anmeldebildschirm; nach der Anmeldung gilt wieder die eigene
Einstellung.

## Sicherheitsregeln für Uploads

Die Edge Function `logo_import` (Admin mit Zwei-Faktor, höchstens 10 Prüfungen pro Admin und
Stunde) behandelt jede Datei als feindlich:

- eigener, strenger XML-Leser, keine DOM-Bibliothek, keine Entitäten-Expansion
- abgelehnt: DOCTYPE, ENTITY, Verarbeitungsanweisungen (ausser der XML-Deklaration am Anfang),
  CDATA, unbekannte Entitäten, mehr als 200 KB, mehr als 12 Ebenen, verschachtelte `svg`
- erlaubt sind nur `svg`, `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`,
  `title` und `desc` (ignoriert) sowie ein leeres `defs`; alles andere wird mit Grund abgelehnt
  (Text, Bilder, Skripte, Stile, Verweise, Effekte, Masken, Muster, Verläufe, Animationen, Links,
  Editor-Daten)
- abgelehnt: Ereignis-Attribute (`on…`), `style`-Attribute, `href`/`xlink:href`, Werte mit `url(`,
  `javascript:`, `data:`; alle übrigen Attribute ausser Geometrie, `transform`, `fill-rule`,
  `stroke-width`, `fill`, `stroke`, `display`, `visibility` werden ignoriert
- Zahlen werden streng geparst und begrenzt (keine NaN, keine Unendlich, keine relativen Einheiten),
  Transformationen (auch verschachtelt) zu einer Matrix zusammengerechnet und begrenzt
- zurück geht nur die normalisierte Struktur, nie der Dateitext; Fehlermeldungen zitieren die Datei
  nie. Gespeichert werden nur die Struktur, eine Prüfsumme der Datei und der bereinigte Dateiname im
  Protokoll.

**Ein abgelehntes Logo vorbereiten:** Text in Pfade umwandeln, Linien bei Bedarf in Flächen umwandeln
(„Konturen erweitern“), Masken, Effekte, Verläufe und eingebettete Bilder anwenden oder entfernen,
als einfaches SVG ohne CSS und ohne Editor-Daten exportieren (zum Beispiel „Optimiertes SVG“ in
Inkscape oder SVG-Export in Figma ohne Text).

## Hintergrundanimationen (Dashboard)

| Variante | Seiten | Zweck |
|---|---|---|
| Logo-Animation | Anmeldeseite, Ladebildschirm | Marke |
| Höhenlinien und Pulsringe (`contours`) | Übersicht | Lage auf einen Blick |
| Radar (`radar`) | Warteschlange | „Es wird gesucht“ |
| Netz (`network`) | Nutzer, Konto-Detail | Verbindungen zwischen Konten |
| Datenströme (`streams`) | Nutzung | Zahlen im Fluss |
| Protokollzeilen (`ledger`) | Audit-Log | Protokoll |
| Papier (`paper`) | Rechtstexte, Rechtstext bearbeiten, Offene Bestätigungen | Text |
| Flugbahn mit Papierflieger (`flight`) | Mitteilungen | Versand |
| Warnstreifen am Rand (`hazard`) | Bereinigung, Auftrag | Vorsicht |
| Punktraster, still (`dots`) | Logos, Design | ruhiger Grund für Vorschauen |
| keine (`still`) | Meldungs-Detail mit Chat-Kopien | Konzentration bei sensiblen Inhalten |

Jede Variante ist eine eigene Datei in `admin-web/src/components/ambient/` mit der Schnittstelle
`AmbientProps` (aktiv, Modus, Palette, reduzierte Bewegung). `AmbientBackground` legt sie als feste
Ebene hinter den Inhalt.

### Regeln für neue Animationen

1. Nur im Hintergrund: `aria-hidden`, nie fokussierbar, keine Zeiger-Ereignisse, keine Elemente wie
   Links oder Knöpfe (Test prüft das für alle Dateien in `components/ambient/`).
2. Inhaltsflächen (Karten, Tabellen, Formulare, Dialoge, Filterleiste) haben eine deckende Fläche.
   Text direkt auf dem Seitengrund muss AA auch unter einer Linie bei voller Deckkraft halten
   (Kontrasttest mit `ambient-line` und `ambient-alert`).
3. Höchstens 0,18 Deckkraft (`--ambient-opacity`, Test).
4. Nur `transform` und `opacity` animieren (Test für alle `@keyframes amb-*`), keine Farben,
   keine Pfade, keine Filter.
5. Pause bei verstecktem Tab, Standbild bei „Bewegung reduzieren“ und „Ruhig“, nichts bei „Aus“.
6. Leistung: wenige Elemente, statisches SVG, Bewegung aus CSS; Nebenebenen mit `amb-secondary`
   markieren, sie fallen auf langsamen Geräten weg. Ziel unter 3 % CPU im Leerlauf, im Browser mit
   der Leistungsansicht prüfen.
7. Variante in `lib/ambient.ts` einer Seite zuordnen und in `AmbientBackground` registrieren.

Dieselben Regeln gelten für die Logo-Animation in der App: Sie liegt hinter dem Formular, ist für
Bedienungshilfen unsichtbar, pausiert ausserhalb des Bildschirms und bei inaktiver App, zeigt bei
„Bewegung reduzieren“ (live) ein Standbild, dimmt bei offener Tastatur auf etwa 30 % und lässt auf
langsamen Geräten Welle und Glanz weg.

## Erweitern

**Ein weiteres Ziel** (Ort, an dem ein Logo erscheint):

1. `design_assignments.target` im Check um den neuen Namen erweitern, in `admin_logo_activate` und
   im Seed ergänzen.
2. Eine öffentliche Lesefunktion wie `get_dashboard_logo()` anlegen, falls der Ort ohne Anmeldung
   gebraucht wird (nur Logo und Preset zurückgeben).
3. `DESIGN_TARGETS` in `admin-web/src/lib/logoLibrary.ts` und `TARGET_LABELS` in `api.ts` ergänzen.
4. Dort, wo das Logo erscheinen soll, `BrandLogo` (Dashboard) oder `BrandAnimation` (App) verwenden.

**Ein weiterer Stil:**

1. Eintrag in `STYLES` (`admin-web/src/lib/appearance.ts`).
2. Neutrale Farben für Hell und Dunkel in `tokens.ts` (`NEUTRALS`); der Kontrasttest prüft sie
   automatisch.
3. Layoutregeln in `styles.css` unter `:root[data-style="<id>"]`.

## Offene Punkte

- Die Flamme ist ein Platzhalter, bis eine Vektordatei vorliegt (siehe oben).
- Die CPU-Last der Hintergrundanimationen ist im Browser zu messen; Audit-Log und Rechtstexte
  bewegen die meisten Elemente.
