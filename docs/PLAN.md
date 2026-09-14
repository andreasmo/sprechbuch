# Plan

Stand: 14.09.2026

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Eingaben | EPUB, PDF; Word (.docx) später |
| Ausgabe | immer die **`.hbook`-Datei** und die App (lokal oder gehostet). Keine EPUB-/HTML-Ausgabe. |
| Sprache | TypeScript für Kern, CLI und Oberfläche |
| Oberfläche | Svelte 5 + Vite |
| Desktop-Hülle | Tauri 2 – alle Betriebssystem-Zugriffe hinter `Platform` (`apps/desktop/src/lib/platform`), dadurch auch als reine Web-App lauffähig |
| Lizenz | MIT, Open Source |
| Signatur | keine; die SmartScreen- bzw. Gatekeeper-Warnung bei unsignierten Installern wird vorerst akzeptiert |
| Speicherort Entwicklung | außerhalb synchronisierter Cloud-Ordner (Rust-Build und node_modules) |

## Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| **1 – Kern** | TypeScript-Port der Analyse mit Paritätstests; EPUB- und PDF-Import; `.hbook`-Format mit Schema, Querverweisprüfung und Migrationen; CLI; App-Gerüst (Tauri + Svelte) mit Import im Web Worker, Übersicht und Kapitelvorschau | **erledigt** |
| **2 – Editor & Reader** | Markierungen ändern und hinzufügen (Sprecher per Klick/Taste 1–9, Rede setzen/entfernen/teilen, Satzgrenzen, Betonung, Pause, Notiz, Retake); Figurenverwaltung (umbenennen, zusammenführen, Farbe, Stimmnotiz); **Prüf-Warteschlange**; Rückgängig/Wiederholen; Aufnahmemodus mit allen Funktionen des früheren Studio-Readers (Prompter, Satzvorschau, Fortschritt, Seitenmodus, Suche, Figur isolieren, Satznummern, Atemstellen, Timer); Markierungsliste mit CSV-Export; Autosave (IndexedDB); JSON-Import/-Export in der App | **erledigt** |
| **3 – Desktop** | atomares Speichern (Vorschlag neben der Quelle), automatisches Speichern in die Datei, Erkennung fremder Änderungen (Cloud-Sync) mit **Zusammenführen**, `.hbook`-Dateiverknüpfung, Öffnen per Doppelklick/„Öffnen mit“/Drag & Drop, eine Instanz, Nachfrage beim Schließen | **erledigt** |
| **3b – Verteilung Desktop** | Installer (Windows, macOS, Linux) und Updates – **zurückgestellt**, wird zusammen mit macOS neu gedacht | offen |
| **4 – KI** | Anbieter-Adapter (Anthropic, OpenAI-kompatibel inkl. lokaler Modelle), Schlüssel im OS-Tresor mit Rust-Proxy, Kostenvorschau, Verfeinerung unsicherer Zuordnungen, Figuren zusammenführen, Aussprachevorschläge; Qualitätsmessung an geprüften Büchern | offen |
| **5 – Verteilung** | Release-Seite, Web-Version hosten, Tablet-Nutzung in der Kabine (Web-App/PWA mit `.hbook`) | offen |

## Ergebnis Phase 1

- **Parität:** Auf dem Referenzbuch (51 570 Wörter, 13 Kapitel) liefert der Kern exakt die
  Ergebnisse des Python-Prototyps – Text, 3 556 Satzgrenzen, 1 152 Redespannen mit Sprecher,
  Konfidenz und Verfahren, 62 Figuren, alle Farben.
- **Tempo:** Import und Analyse des Referenzbuchs in rund 0,5–0,9 s (Desktop-App bzw. CLI).
- **Tests:** 40 Tests (Kern, Buchformat, EPUB, PDF, Rendering) plus Paritätstest;
  Desktop-App über das DevTools-Protokoll in der echten WebView2 geprüft (EPUB, PDF, `.hbook`,
  CSP, Dateizugriffs-Scope).
- **Sicherheit:** Die App darf nur Dateien lesen und schreiben, die im Dateidialog gewählt
  wurden; alles andere scheitert am Scope.

## Ergebnis Phase 2

- **Bearbeitungsbefehle im Kern** (`packages/core/src/edit`): 14 serialisierbare Befehle
  (Sprecher setzen/bestätigen, Rede setzen/teilen/entfernen, sechs Markierungsarten, Satzgrenzen,
  Figuren anlegen/ändern/färben/zusammenführen, Aussprache). Rückgängig/Wiederholen über
  Immer-Patches; jede Änderung ist mit Gültigkeitsprüfung und exaktem Rückweg getestet.
  Kapitelfarben werden nach jeder Änderung kollisionsfrei nachgeführt.
- **App**: vier Ansichten – Übersicht (mit Figuren- und Ausspracheverwaltung), Bearbeiten,
  Prüfen, Aufnehmen. Automatische Sicherung jeder Änderung in IndexedDB, Liste „Zuletzt
  bearbeitet“, Schutz vor dem Überschreiben ungespeicherter Änderungen beim erneuten Öffnen
  einer Datei. Lese-Einstellungen (Thema, Schrift, Tempo) pro Gerät.
- **Geprüft** im Browser und in der echten Desktop-App (WebView2, echte Tastatureingaben über
  das DevTools-Protokoll): Prüfen per Tastatur, Rückgängig, Aufnahmemodus, Speichern und
  Wiederöffnen mit allen Markierungen, Wiederherstellung nach Beenden der App.

### Studio-Reader vollständig übernommen

- **Seitenmodus** (<kbd>m</kbd>): Blättern statt Scrollen, auf breiten Bildschirmen als Doppelseite.
  Beim Blättern springt die Leseposition auf den ersten Satz der neuen Seite, beim Weiterlesen
  blättert die Seite von selbst.
- **Volltextsuche** (<kbd>Strg</kbd>+<kbd>F</kbd>) im ganzen Buch, tolerant gegenüber
  typografischen Anführungszeichen; Treffer werden über die CSS Custom Highlight API markiert,
  ohne den Text neu zu rendern. Im Aufnahmemodus setzt ein Treffer die Leseposition.
- **Figur isolieren** über die Legende oder <kbd>1</kbd>–<kbd>9</kbd>, abblenden mit
  <kbd>⇧</kbd>+Klick; <kbd>.</kbd>/<kbd>,</kbd> springt zur nächsten/vorigen Redepassage der Figur,
  auch über Kapitelgrenzen – zum Einsprechen einer Stimme am Stück.
- **Satznummern, Atemstellen an Kommata, lange Sätze** (> 28 Wörter) als Darstellungsoptionen;
  dazu Schriftwahl, Wortabstand und Spaltenbreite.
- **Aufnahme-Timer** (<kbd>z</kbd>) mit gemessenem Sprechtempo, übernehmbar für Restzeit und Prompter.
- **Markierungsliste** in der Übersicht: alle Retakes, Lesezeichen und Notizen mit Kapitel und
  Satznummer, anspringbar im Aufnahme- oder Bearbeitungsmodus, kopierbar und als CSV exportierbar
  (die frühere „Export“-Funktion – jetzt direkt aus der Buchdatei).
- **Tastenübersicht** (<kbd>?</kbd>).
- Geprüft mit Unit-Tests (Suche, Sprung zur nächsten Rede, Atemstellen, Satznummern,
  Markierungsliste, CSV) sowie im Browser und in der echten Desktop-App mit echten Tastatureingaben.

## Ergebnis Phase 3

**Speichern**

- **Atomar:** Die App schreibt in eine temporäre Datei im selben Ordner, bringt sie mit
  `sync_all` auf die Platte und benennt sie dann über die alte Datei um (unter Windows mit
  Wiederholungen, falls Virenscanner oder Sync-Client die Datei kurz sperren). Ein Absturz oder
  voller Datenträger hinterlässt nie eine halbe `.hbook`.
- **Automatisch:** Sobald ein Buch einen Speicherort hat, landen Änderungen nach 2,5 s in der
  Datei, das Weiterlesen (Leseposition) nach 15 s – so entstehen in Cloud-Ordnern keine
  Upload-Stürme. Abschaltbar im Menü „⋯“. Beim Schließen des Buches oder der App wird
  Ausstehendes geschrieben; was keinen Speicherort hat, fragt vor dem Schließen nach.
- **Neben der Quelle:** Der erste Speichern-Dialog schlägt den Ordner der EPUB/PDF vor.

**Fremde Änderungen (Cloud-Sync, zweites Gerät)**

- Jede Datei hat einen Stempel (Größe, Änderungszeit, SHA-256). Die App prüft beim Zurückkehren
  ins Fenster und alle 10 s die Größe und Zeit; nur wenn die sich ändern, wird der Inhalt gehasht.
  Beim Speichern schickt sie den Hash der Fassung mit, auf der die Änderungen beruhen – passt er
  nicht mehr, wird nicht überschrieben.
- **Hier nichts offen:** Die neuere Fassung wird still geladen (mit Hinweis).
- **Beide Seiten geändert:** Die App bietet an: *Zusammenführen*, *Fassung aus der Datei laden*,
  *Meine Fassung behalten* oder *Meine als Kopie speichern*.
- **Zusammenführen** (`packages/core/src/edit/rebase.ts`): Weil jede Änderung ein
  serialisierbarer Befehl ist, werden die eigenen Befehle seit dem gemeinsamen Stand auf der neuen
  Fassung wiederholt. Bei derselben Stelle gilt die eigene Entscheidung; schon Erledigtes zählt als
  erledigt; neu angelegte IDs werden umgeschrieben; was es nicht mehr gibt, wird mit Grund
  gemeldet. Satzgrenzen werden über ihren Offset gefunden, nicht über die Satznummer. Das Journal
  liegt mit in der Absturzsicherung – Zusammenführen klappt also auch nach einem Absturz oder
  Neustart.
- **Datei verschwunden** (verschoben, umbenannt, gelöscht): *Wieder dort speichern*,
  *Speichern unter* oder *ohne Datei weiterarbeiten*.

**Öffnen**

- `.hbook`-Dateiverknüpfung in der Bundle-Konfiguration (Windows, macOS mit exportiertem Typ
  `org.sprechbuch.hbook`, Linux). Die App nimmt Dateien als Programmargument (Windows, Linux),
  als `RunEvent::Opened` (macOS) und – über das Single-Instance-Plugin – von einem zweiten
  Programmstart entgegen, der sich dann sofort beendet.
- Drag & Drop in der Desktop-App liefert jetzt echte Pfade (Speicherort, Konfliktprüfung).
- „Zuletzt bearbeitet“ gleicht beim Öffnen mit der Datei ab: gleiche Fassung → weiterarbeiten,
  Datei neuer → Datei laden, beide geändert → Konflikt.

**Sicherheit:** Buchdateien liest und schreibt die App über eigene Rust-Befehle
(`apps/desktop/src-tauri/src/files.rs`): nur absolute Pfade, lesen nur `.hbook`, `.epub`, `.pdf`,
`.json`, schreiben nur `.hbook`. Das allgemeine Leserecht des Dateisystem-Plugins ist entfernt;
Exporte (CSV, JSON) laufen weiter nur in dialoggewählte Dateien.

**Geprüft:** Rust-Tests (atomares Schreiben ohne Reste, Stempel, Pfadprüfung, Argumente,
URI-Dekodierung), Kern-Tests fürs Zusammenführen, App-Tests für die Öffnen-Entscheidung – und in
der echten Desktop-App mit Testdateien: Öffnen per Argument, Autosave auf die Platte, stilles
Nachladen, Konflikt mit Zusammenführen (beide Änderungen landen in der Datei), zweiter
Programmstart, verschwundene Datei in einem Ordner mit Umlaut und Leerzeichen, Schließen per
`WM_CLOSE`, Wiederherstellung und Zusammenführen nach einem harten Abbruch der App.

## Bekannte Grenzen

- PDF: Mehrspaltensatz, Fußnoten und Scans (OCR) werden nicht unterstützt. Ein neuer Absatz
  oben auf einer Seite ist nur am Einzug erkennbar.
- Sprecherzuordnung: rund ein Drittel der Redeteile ist geraten (Nähe, Wechselrede) – dafür
  kommen Prüf-Warteschlange (Phase 2) und KI (Phase 4).
- In der Web-Version heißt Speichern Herunterladen – eine vorhandene Datei kann dort nicht
  überschrieben werden. Beim erneuten Öffnen erkennt die App die heruntergeladene Fassung am Hash
  wieder.
- Die Dateiverknüpfung wirkt erst mit einem Installer (zurückgestellt). Bis dahin: „Öffnen mit“
  auf die `sprechbuch.exe` oder Datei ins Fenster ziehen.
- Der macOS-Weg (`RunEvent::Opened`) ist geschrieben, aber mangels Mac noch nicht ausprobiert.
- Zusammenführen kennt keine Zeichen-genauen Konflikte: Haben beide Seiten dieselbe Rede
  unterschiedlich zugeordnet, gewinnt die eigene Entscheidung ohne Rückfrage.
- Eine erneute automatische Analyse eines bereits bearbeiteten Buches (unter Beibehaltung der
  eigenen Entscheidungen) gibt es noch nicht.
- Die nativen Datei-Dialoge (Öffnen, Speichern unter, Rückfrage beim Schließen) und das native
  Drag & Drop sind nicht per Klick automatisiert getestet.
- Der Prompter läuft nur im Scrollmodus. Isolierte Figur, Suche und Timer gelten für die
  laufende Sitzung und werden nicht gespeichert.
- Suchtreffer im Text hervorheben braucht die CSS Custom Highlight API (WebView2 und aktuelle
  Browser; ältere WebKitGTK-Versionen unter Linux springen nur zum Treffer, ohne Markierung).
- Der Claude-Skill aus dem Prototyp ist noch nicht auf die neue CLI umgestellt.
