# Testcheckliste: Farbsätze, Animation v2, Umfragen (Phasen 1 bis 6)

Für einen Durchgang nach dem Einspielen von `supabase/schema.sql`. Konten:

- **Admin**: Staff-Konto mit Rolle `admin` und Zwei-Faktor (Dashboard im Browser). Es ist zugleich das
  offizielle Konto (`supabase/official-account-setup.sql`), ausser du wählst ein anderes.
- **A, B, C, D**: vier gewöhnliche Konten in der App (Expo Go auf dem iPhone; zum Wechseln abmelden
  und neu anmelden, oder ein zweites Gerät).
- **Moderator**: ein Staff-Konto mit Rolle `moderator` (für den Zugriffstest).

Für die Auswertung braucht es mindestens 5 Antworten: dafür zusätzlich zwei weitere Konten (E, F)
oder die Testdaten-Konten.

## Vorbereitung

1. `supabase/schema.sql` komplett im SQL-Editor ausführen, danach `notify pgrst, 'reload schema';`.
2. Einmalig `supabase/official-account-setup.sql` mit dem Benutzernamen des offiziellen Kontos.
3. Edge Functions deployen (Liste in der Antwort zu Phase 6 bzw. unten).
4. Optional: `supabase/reset-checks.sql` ausführen; jede Zeile muss `true` zeigen.

## Farbsätze (Phase 1)

- [ ] Dashboard → Design → Hauptfarben: neuen Farbsatz anlegen, speichern. Erscheint in der Liste.
- [ ] Einen unlesbaren Akzent eingeben (z. B. sehr helles Gelb für Hell): Speichern ist gesperrt,
      der Editor zeigt die verletzte Regel und einen korrigierten Vorschlag. Vorschlag übernehmen →
      speicherbar.
- [ ] Farbsatz für das Dashboard aktivieren (Zwei-Faktor-Bestätigung): Akzent ändert sich in allen
      Seiten und auf der Anmeldeseite (abmelden und ansehen). In Hell und Dunkel lesbar.
- [ ] Farbsatz für den App-Login aktivieren (wirkt nur, wenn der App-Login die Farbe „Hauptfarbe“ nutzt): in der App abmelden, der Anmeldebildschirm zeigt den
      neuen Akzent (Knopf, Logo-Animation); der Rest der App bleibt beim Flammen-Orange.
- [ ] Palette „Schwarz-Weiss“ im Dashboard: unabhängig vom Farbsatz.
- [ ] Eingebaute Farbsätze und der aktive lassen sich nicht löschen.
- [ ] Audit-Log zeigt `color_create`, `color_activate` mit Vorher-Nachher.

## Animation v2 (Phase 2)

- [ ] Dashboard → Logos → bei einem Logo „Animation bearbeiten“: eigenes Preset aus „Standard“ duplizieren, Spuren hinzufügen
      (z. B. Drehen, Funken), Keyframes ziehen und per Tastatur verschieben (←/→, Umschalt = gross,
      ↑/↓ Wert), Rückgängig/Wiederholen, A-B-Vergleich. Speichern.
- [ ] Preset für den App-Login aktivieren; in der App abmelden: die neue Animation läuft auf dem
      Anmeldebildschirm.
- [ ] iPhone: Einstellungen → Bedienungshilfen → Bewegung → „Bewegung reduzieren“ an: Standbild.
- [ ] Das eingebaute Preset „Standard“ ist unverändert (nicht bearbeitbar, sieht aus wie vorher).
- [ ] Ungültige Werte (z. B. 17 Spuren, Kosten über der Grenze) werden abgelehnt.

## Umfragen: anlegen und veröffentlichen (Phasen 3 bis 5)

- [ ] Dashboard → Umfragen → „Neue Umfrage“: Titel, Thema, Ende in 2 Tagen → „Weiter“ speichert
      den Entwurf. Medien (Bild und Logo mit Alternativtext), Fragen (eine Einzelauswahl, eine Skala
      0–10, ein Ja/Nein, ein Freitext mit „Freitext erlauben“), Anzeige (im Feed 7 Tage), Vorschau.
- [ ] Veröffentlichen: Bestätigung und Zwei-Faktor-Code. Die Liste zeigt „Aktiv“ und die Zahl
      erreichbarer Konten.
- [ ] **A** öffnet den Feed: die Umfragekarte steht oben, mit Abzeichen „Offiziell“ und Restzeit,
      ohne Likes, Kommentare oder Teilen. Nach einer Sekunde Sichtbarkeit und erneutem Laden rückt sie
      an ihren Platz nach Datum.
- [ ] **B** nimmt teil: Pflichtfragen verlangen eine Antwort, Zurück funktioniert, Abschicken nach
      Bestätigung, Dank. Danach zeigt die Karte „Teilgenommen“.
- [ ] **B** versucht es erneut (Karte oder Einstellungen → Umfragen): keine zweite Teilnahme möglich.
- [ ] **C** blendet die Karte über das Menü aus: sie verschwindet aus dem Feed.
- [ ] **D** findet die Umfrage unter Einstellungen → Umfragen (mit Restzeit, Status „offen“).
- [ ] Nach der ersten Antwort sind die Fragen im Editor gesperrt (Hinweis), Verlängern geht noch.
- [ ] Verlängern auf ein späteres Ende: Liste und App zeigen das neue Ende.

## Abbrechen, Fristende

- [ ] Zweite Umfrage veröffentlichen, eine Antwort abgeben, dann **Abbrechen mit „verwerfen“**
      (Begründung ≥ 10 Zeichen): verschwindet aus der App, die Auswertung hat 0 Antworten.
- [ ] Dritte Umfrage, eine Antwort, **Abbrechen mit „behalten“**: verschwindet aus der App, die
      Auswertung zeigt die Antwort (mit Warnung „Weniger als 5 Antworten“).
- [ ] **Fristende:** eine Umfrage mit Ende in 1 Stunde (kürzeste Dauer); danach zeigt die App keine
      Teilnahme mehr („beendet“), ein Absenden einer offenen Teilnahme schlägt mit klarer Meldung fehl.

## Auswertung und Veröffentlichung

- [ ] Auswertung mit weniger als 5 Antworten: Warnung, „Auswertung veröffentlichen“ gesperrt.
- [ ] Mit mindestens 5 Antworten nach dem Ende: Diagramm und „Als Tabelle“ zeigen dieselben
      Zahlen; einen Freitext verbergen (er ist danach nicht als Zitat wählbar).
- [ ] Export JSON und CSV: nur zusammengefasste Zahlen, keine einzelnen Antworten oder Zeiten.
- [ ] Veröffentlichen: Fragen wählen, ein Zitat, Fazit, Anzeige im Feed 1 Tag, im Profil 2 Tage,
      Vorschau, Bestätigung. In der App: Karte „Ergebnis ansehen“ mit denselben Zahlen.
- [ ] Nach Ablauf (am nächsten Tag) ist die Karte aus dem Feed verschwunden, im Profil des
      offiziellen Kontos bis zum Ende der Profil-Frist sichtbar. „Zurückziehen“ entfernt sie sofort.
- [ ] Übersicht → „Umfragen und Aktivität“: Zahlen passen zum Zeitraum.

## Datenschutz und Rechte

- [ ] Offizielles Profil in der App (über das Abzeichen einer Karte oder die Suche): nur Name,
      Bild, Beschreibung, Abzeichen und die Tabs „Umfragen“ und „Auswertungen“. Kein Folgen, keine
      Nachricht, kein Blockieren, keine Follower-Zahlen, Aktivitäten, Statistik oder E-Mail.
- [ ] Die E-Mail-Adresse erscheint nirgends in der App (Profil, Karten, Auswertung, Einstellungen).
- [ ] Nutzer erkennen nicht, was andere geantwortet haben: Karten und Profil zeigen keine
      Antworten; Auswertungen nur Summen ab 5 Antworten.
- [ ] **Moderator** im Dashboard: kein Menüpunkt „Umfragen“, „Design“ oder „Logos“; ein direkter
      Aufruf von `#/surveys` zeigt keine Umfragen-Seite, und der Server verweigert jede Umfrage-Funktion (`not_authorized`).
- [ ] Konto **D** löschen (Einstellungen → Konto löschen): klappt ohne Fehler; die anonymen
      Antworten bleiben in der Auswertung, D's Teilnahme und gesehene Karten sind weg.
- [ ] Bereinigung (Dashboard → Bereinigung) mit der Kategorie „Umfragen“ für ein
      Testkonto: Teilnahme weg, Antworten und Umfragen bleiben.
- [ ] Optional: `select public.survey_purge_expired_answers(12);` im SQL-Editor: löscht nichts,
      solange keine Umfrage seit 12 Monaten beendet ist (Ergebnis `"surveys": 0`).

## Darstellung

- [ ] Alle neuen Ansichten in Hell und Dunkel (App: Einstellungen → Darstellung; Dashboard: Design).
- [ ] App mit grosser Systemschrift auf einem kleinen iPhone: Karten, Teilnahme und Auswertung
      bleiben lesbar und bedienbar.
- [ ] Dashboard nur mit der Tastatur: Umfrage-Editor, Fragen umsortieren (↑/↓-Knöpfe), Dialoge
      (Esc schliesst), Animations-Editor.
- [ ] Flugmodus in der App: Feed lädt ohne Umfragekarten (kein Fehler), Einstellungen → Umfragen
      und Auswertung zeigen „Erneut versuchen“, eine Teilnahme behält die Eingaben für „Erneut senden“.
