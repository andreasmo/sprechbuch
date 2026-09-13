# Sprechbuch

Bücher so aufbereiten, dass man sie laut lesen kann – für Hörbuch-Sprecherinnen und -Sprecher.

Sprechbuch liest ein **EPUB oder PDF**, erkennt Sätze und direkte Rede, ordnet jede Rede einer
Figur zu und markiert sie mit einer eigenen **Textmarker-Farbe**. Das Ergebnis ist eine
**`.hbook`-Datei**: ein Paket aus Text und allen Markierungen, das man verschieben, sichern und
weitergeben kann. Geöffnet wird sie in der Sprechbuch-App (Desktop oder Browser).

> **Status: Phase 1 (Kern).** Import, Analyse und Buchformat sind fertig und getestet; die App
> zeigt Übersicht und Vorschau. Editor, Aufnahmemodus und KI-Unterstützung folgen – siehe
> [docs/PLAN.md](docs/PLAN.md).

## Was es schon kann

- **EPUB und PDF importieren** (Word folgt). PDF-Absätze werden aus Koordinaten rekonstruiert:
  Kopf-/Fußzeilen und Seitenzahlen fallen weg, Silbentrennungen werden aufgelöst.
- **Sätze** mit deutschen Besonderheiten (»…«, sagte er. ist *ein* Satz; *z. B.*, *am 3. Oktober*).
- **Direkte Rede** in allen gängigen Anführungsstilen, inklusive Zitat in der Rede und
  Rede über mehrere Absätze.
- **Sprecherzuordnung** mit Verlässlichkeit je Redeteil: Inquit, Absatzbindung, Pronomen,
  Anrede-Ausschluss, Nähe, Wechselrede. Unsichere Stellen sind als solche markiert.
- **Textmarker-Farben**: Hauptfiguren buchweit fest, Nebenfiguren kapitelweise – innerhalb
  eines Kapitels nie doppelt. Dazu Initialen-Kürzel, damit es nicht allein an der Farbe hängt.
- **Aussprache-Kandidaten**: Eigennamen und fremde Wörter, die vor der Aufnahme geklärt werden sollten.
- **`.hbook`-Format** mit Schema, Querverweisprüfung und Migrationen – siehe
  [docs/bookfile-format.md](docs/bookfile-format.md).

Alles läuft lokal. Es wird nichts hochgeladen.

## Aufbau

```
packages/core     Import, Analyse, Buchformat – TypeScript, läuft in Browser, Web Worker und Node
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
