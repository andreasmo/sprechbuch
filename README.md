# Sprechbuch

Bücher so aufbereiten, dass man sie laut lesen kann – für Hörbuch-Sprecherinnen und -Sprecher.

Sprechbuch liest ein **EPUB oder PDF**, erkennt Sätze und direkte Rede, ordnet jede Rede einer
Figur zu und markiert sie mit einer eigenen **Textmarker-Farbe**. Das Ergebnis ist eine
**`.hbook`-Datei**: ein Paket aus Text und allen Markierungen, das man verschieben, sichern und
weitergeben kann. Geöffnet wird sie in der Sprechbuch-App (Desktop oder Browser).

> **Status: Phase 2 (Editor & Aufnahme).** Import, Analyse, Buchformat, Bearbeiten, Prüfen und
> Aufnahmemodus samt allen Funktionen des früheren Studio-Readers sind fertig und getestet. Als Nächstes: Desktop-Komfort (atomares Speichern,
> Dateiverknüpfung, Installer) und KI-Unterstützung – siehe [docs/PLAN.md](docs/PLAN.md).

## Was es kann

**Import und Analyse**

- **EPUB und PDF** (Word folgt). PDF-Absätze werden aus Koordinaten rekonstruiert:
  Kopf-/Fußzeilen und Seitenzahlen fallen weg, Silbentrennungen werden aufgelöst.
- **Sätze** mit deutschen Besonderheiten (»…«, sagte er. ist *ein* Satz; *z. B.*, *am 3. Oktober*).
- **Direkte Rede** in allen gängigen Anführungsstilen, inklusive Zitat in der Rede und
  Rede über mehrere Absätze.
- **Sprecherzuordnung** mit Verlässlichkeit je Redeteil: Inquit, Absatzbindung, Pronomen,
  Anrede-Ausschluss, Nähe, Wechselrede.
- **Textmarker-Farben**: Hauptfiguren buchweit fest, Nebenfiguren kapitelweise – innerhalb
  eines Kapitels nie doppelt. Dazu Initialen-Kürzel, damit es nicht allein an der Farbe hängt.
- **Aussprache-Kandidaten**: Eigennamen und fremde Wörter, die vor der Aufnahme geklärt werden sollten.

**In der App**

| Ansicht | Was man dort tut |
|---|---|
| **Übersicht** | Umfang, Sprechdauer, Qualität der Zuordnung; Figuren umbenennen, zusammenführen, Farbe und Kürzel festlegen, Stimmnotiz; Aussprache klären; Liste aller Retakes, Lesezeichen und Notizen zum Anspringen, Kopieren oder als CSV für den Schnitt |
| **Bearbeiten** | Rede anklicken → Sprecher ändern, bestätigen, teilen, entfernen · Text markieren → als Rede setzen, Betonung, Retake, Lesezeichen, Notiz · <kbd>Alt</kbd>+Klick → Satz teilen, Pause, Atemzeichen · Pipe `\|` anklicken → Sätze verbinden |
| **Prüfen** | Alle unsicheren Zuordnungen nacheinander mit Kontext: <kbd>Enter</kbd> stimmt, <kbd>1</kbd>–<kbd>9</kbd> andere Figur, <kbd>N</kbd> keine Rede, <kbd>→</kbd> überspringen |
| **Aufnehmen** | Satz für Satz lesen (<kbd>Leertaste</kbd>/<kbd>←</kbd>), scrollen oder **blättern** (<kbd>m</kbd>, auf breiten Bildschirmen als Doppelseite), Prompter mit Tempo, Vorschau auf den nächsten Satz, Fortschritt und Restzeit · **Figurenlegende**: <kbd>1</kbd>–<kbd>9</kbd> isoliert eine Figur, <kbd>.</kbd>/<kbd>,</kbd> springt zu ihrer nächsten/vorigen Rede · Retake <kbd>r</kbd>, Lesezeichen <kbd>b</kbd>, Notiz <kbd>n</kbd> · **Aufnahme-Timer** <kbd>z</kbd> misst das echte Sprechtempo und übernimmt es für die Restzeit · Fokus <kbd>f</kbd>, Themen inklusive blendarmem Studio-Modus <kbd>t</kbd> |

Überall: <kbd>Strg</kbd>+<kbd>F</kbd> Volltextsuche im ganzen Buch, <kbd>Strg</kbd>+<kbd>Z</kbd> /
<kbd>Strg</kbd>+<kbd>Y</kbd> Rückgängig/Wiederholen, <kbd>Strg</kbd>+<kbd>S</kbd> Speichern, <kbd>?</kbd> alle
Tastenkürzel. Unter **Aa** lässt sich die Darstellung einstellen: Schrift (auch gut lesbar für
Legasthenie), Größe, Zeilen- und Wortabstand, Spaltenbreite, Pipes, Satznummern, Atemstellen an
Kommata, Markierung langer Sätze. Jede Änderung wird sofort im App-Speicher gesichert – nach
einem Absturz oder Neustart steht das Buch unter „Zuletzt bearbeitet“ bereit. Von Hand
getroffene Entscheidungen überschreibt keine automatische Analyse.

Alles läuft lokal. Es wird nichts hochgeladen.

## Aufbau

```
packages/core     Import, Analyse, Buchformat, Bearbeitungsbefehle – läuft in Browser, Worker und Node
packages/cli      Kommandozeile: sprechbuch import | info | validate | export-json | import-json
apps/desktop      App: Svelte 5 + Vite; als Desktop-App über Tauri 2, ohne Tauri als Web-App
reference/python  Python-Prototyp als Referenz für Paritätstests
docs/             Plan, Buchformat
fixtures/local    lokale Testbücher (nicht im Repository)
```

## Entwickeln

Voraussetzungen: **Node.js ≥ 20.19**, für die Desktop-App zusätzlich **Rust (stable)** und die
[Tauri-Systemvoraussetzungen](https://tauri.app/start/prerequisites/) (Windows: MSVC Build Tools
und WebView2; macOS: Xcode Command Line Tools; Linux: webkit2gtk).

```bash
npm install
npm test                 # alle Tests (Kern + App)
npm run typecheck        # TypeScript + svelte-check
npm run desktop          # Desktop-App im Entwicklungsmodus
npm run dev -w @sprechbuch/desktop   # nur Web-App unter http://localhost:1420
```

Kommandozeile:

```bash
npm run build:cli
node packages/cli/dist/cli.js import mein-buch.epub
node packages/cli/dist/cli.js info mein-buch.hbook
```

Desktop-Installer bauen (unsigniert – Windows zeigt beim ersten Start eine SmartScreen-Warnung):

```bash
npm run tauri -w @sprechbuch/desktop -- build
```

### Paritätstest gegen die Python-Referenz

Der TypeScript-Kern ist ein Port des Python-Prototyps und liefert auf Referenzbüchern
identische Ergebnisse. Dafür ein EPUB nach `fixtures/local/` legen und:

```bash
npm run golden   # erzeugt fixtures/local/<buch>.golden.json mit Python
npm test         # der Paritätstest läuft automatisch mit, sobald Referenzdaten da sind
```

Testbücher und Referenzdaten enthalten vollständige Buchtexte und werden **nie committet**.
Die übrigen Tests erzeugen ihre EPUBs und PDFs selbst.

## Lizenz

[MIT](LICENSE)
