# Sprechbuch

Bücher so aufbereiten, dass man sie laut lesen kann – für Hörbuch-Sprecherinnen und -Sprecher.

Sprechbuch liest ein **EPUB oder PDF**, erkennt Sätze und direkte Rede, ordnet jede Rede einer
Figur zu und markiert sie mit einer eigenen **Textmarker-Farbe**. Das Ergebnis ist eine
**`.hbook`-Datei**: ein Paket aus Text und allen Markierungen, das man verschieben, sichern und
weitergeben kann. Geöffnet wird sie in der Sprechbuch-App (Desktop oder Browser).

> **Status: Version 0.1 – die erste Veröffentlichung.** Import, Analyse, Buchformat, Bearbeiten,
> Prüfen, Aufnahmemodus, sicheres Speichern mit Cloud-Sync-Abgleich, KI-Unterstützung (bevorzugt
> lokal) und die Lese-App für Tablet und Browser sind fertig und unter Windows getestet. Installer
> gibt es unter [Releases](https://github.com/andreasmo/sprechbuch/releases/latest); was noch offen
> ist, steht in [docs/PLAN.md](docs/PLAN.md).

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
| **Aufnehmen** | Satz für Satz lesen (<kbd>Leertaste</kbd>/<kbd>←</kbd>), scrollen oder **blättern** (<kbd>m</kbd>, auf breiten Bildschirmen als Doppelseite), Prompter mit Tempo, Vorschau auf den nächsten Satz, Fortschritt und Restzeit · **Figurenlegende**: <kbd>1</kbd>–<kbd>9</kbd> isoliert eine Figur, <kbd>.</kbd>/<kbd>,</kbd> springt zu ihrer nächsten/vorigen Rede · Retake <kbd>r</kbd>, Lesezeichen <kbd>b</kbd>, Notiz <kbd>n</kbd> – Notizen stehen gut sichtbar am linken Rand neben ihrer Zeile · **Aufnahme-Timer** <kbd>z</kbd> misst das echte Sprechtempo und übernimmt es für die Restzeit · Fokus <kbd>f</kbd>, Themen inklusive blendarmem Studio-Modus <kbd>t</kbd> |

Überall: <kbd>Strg</kbd>+<kbd>F</kbd> Volltextsuche im ganzen Buch, <kbd>Strg</kbd>+<kbd>Z</kbd> /
<kbd>Strg</kbd>+<kbd>Y</kbd> Rückgängig/Wiederholen, <kbd>Strg</kbd>+<kbd>S</kbd> Speichern, <kbd>?</kbd> alle
Tastenkürzel. Unter **Aa** lässt sich die Darstellung einstellen: Schrift (auch gut lesbar für
Legasthenie), Größe, Zeilen- und Wortabstand, Spaltenbreite, Pipes, Satznummern, Atemstellen an
Kommata, Markierung langer Sätze. Jede Änderung wird sofort im App-Speicher gesichert – nach
einem Absturz oder Neustart steht das Buch unter „Zuletzt bearbeitet“ bereit. Von Hand
getroffene Entscheidungen überschreibt keine automatische Analyse.

**Speichern und mehrere Geräte (Desktop)**

- Gespeichert wird **atomar** – ein Absturz hinterlässt nie eine halbe Datei. Hat ein Buch einen
  Speicherort, schreibt die App Änderungen **automatisch** hinein (abschaltbar).
- Liegt die `.hbook` in einem **Cloud-Ordner** und wurde auf einem anderen Gerät weiterbearbeitet,
  merkt die App das. Ist hier nichts offen, lädt sie die neue Fassung; sind beide Seiten geändert,
  kann sie die eigenen Änderungen **zusammenführen** – auch nach einem Absturz.
- `.hbook`-Dateien öffnen per Doppelklick, „Öffnen mit“ oder Hineinziehen; eine bereits laufende
  App übernimmt die Datei.

**Lese-App für iPad und Browser**

- Zum Einsprechen am Tablet: dieselbe Oberfläche mit Übersicht, Bearbeiten (Sprecher, Retakes,
  Notizen, Pausen), Prüfen und Aufnehmen – ohne Import und KI. Läuft offline, lässt sich auf den
  Home-Bildschirm legen, der Bildschirm bleibt beim Aufnehmen an; Wischen blättert.
- `.hbook` aus Dropbox/iCloud Drive öffnen, mit **„Sichern …“** über das Teilen-Menü zurücklegen.
  Die Desktop-App übernimmt die Änderungen – auch wenn dort inzwischen weitergearbeitet wurde, und
  auch wenn die Datei als Kopie „Buch 2.hbook“ zurückkommt.
- Auf der Seite liegt nur der Code der App, nie ein Buch. Sie darf technisch nichts nach außen
  senden (Content Security Policy).

**KI – optional, standardmäßig nur lokal**

- **Nur lokale KI** ist voreingestellt: Unveröffentlichte Bücher sind vertraulich, deshalb geht
  Buchtext nur an Modelle auf diesem Rechner oder im lokalen Netz – **Ollama** (empfohlen) oder
  LM Studio. Die Sperre sitzt in der Desktop-App selbst (Rust), nicht nur in der Oberfläche.
- Cloud-Anbieter (Anthropic, OpenAI, OpenRouter, eigene Endpunkte) lassen sich nach einer
  ausdrücklichen Rückfrage erlauben – und brauchen dann trotzdem pro Buch eine Einwilligung.
- Die KI prüft nur, wo die Regeln unsicher sind: **Sprecherzuordnung**, **doppelte Figuren**
  (Vorschläge zum Bestätigen), **Aussprache** (als ungeprüfter Vorschlag). Abweichungen landen mit
  Begründung in der Prüfung und lassen sich mit <kbd>V</kbd> übernehmen.
- Lokal: Die App misst beim Verbindungstest, wie schnell das Modell auf diesem Rechner liest und
  schreibt, schätzt die Dauer eines Laufs und zeigt, wann er voraussichtlich fertig ist. Abbrechen
  stoppt das Modell sofort; ein neuer Lauf macht dort weiter, wo der letzte aufgehört hat.
- Cloud: Kostenschätzung und Obergrenze vor jedem Lauf; der Schlüssel liegt im Schlüsselspeicher
  des Betriebssystems und geht nur an die Adresse, für die er gespeichert wurde.

Ohne KI eingerichtet läuft alles lokal, es wird nichts hochgeladen.

**Lokale KI einrichten:** [Ollama](https://ollama.com) installieren, ein Modell laden (z. B.
`ollama pull gemma4:26b`), in der App „KI einrichten“ → Ollama → „Verbindung testen“. Modelle mit
rund 25–30 Mrd. Parametern brauchen etwa 20 GB freien Arbeitsspeicher. Auf Rechnern ohne
Grafikbeschleunigung hängt das Tempo stark vom Modell ab: Auf einem Laptop mit Ryzen AI 7 brauchte
`gemma4:26b` für ein Kapitel 13 Minuten, `qwen3.8` 70 Minuten – ein ganzer Roman ist etwas für
nebenbei oder über Nacht. Die App misst das beim Verbindungstest und zeigt die voraussichtliche Dauer.

## Installieren

Die Desktop-App gibt es unter **[Releases](https://github.com/andreasmo/sprechbuch/releases/latest)**.
Die Installer sind nicht signiert – das Betriebssystem warnt deshalb beim ersten Start.

| System | Datei | Beim ersten Start |
|---|---|---|
| Windows 10/11 | `Sprechbuch_…_x64-setup.exe` (installiert ohne Adminrechte) | SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“ |
| macOS ab 13.3, Apple Silicon und Intel | `Sprechbuch_…_universal.dmg` | Öffnen versuchen, dann Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“. Meldet macOS, die App sei beschädigt: `xattr -dr com.apple.quarantine /Applications/Sprechbuch.app`. Bisher nicht auf einem echten Mac getestet. |
| Linux (x86-64) | `Sprechbuch_…_amd64.AppImage` oder `.deb` | – (Schlüssel für Cloud-KI brauchen einen Schlüsselspeicher wie GNOME Schlüsselbund oder KWallet; lokale KI geht ohne) |

## Ausprobieren

Auf der Startseite öffnet **„Beispiel ansehen“** das erste Kapitel von Theodor Fontanes
*Effi Briest* (gemeinfrei) – mit allen Markierungen, Prüf-Warteschlange und Aufnahmemodus. Die
Dateien dazu liegen in [examples/effi-briest](examples/effi-briest).

**Lese-App im Browser oder auf dem iPad:** <https://andreasmo.github.io/sprechbuch/> – auf dem iPad in
Safari öffnen, „Teilen → Zum Home-Bildschirm“.

## Aufbau

```
packages/core     Import, Analyse, Buchformat, Bearbeitungsbefehle – läuft in Browser, Worker und Node
packages/cli      Kommandozeile: sprechbuch import | info | validate | export-json | import-json | ai | eval
apps/desktop      App: Svelte 5 + Vite; als Desktop-App über Tauri 2, ohne Tauri als Web-App bzw. Lese-App (--mode lesen)
reference/python  Python-Prototyp als Referenz für Paritätstests
tools/fake-llm    KI-Attrappe für Entwicklung und Tests (Anthropic-, OpenAI- und Ollama-Protokoll, ohne Kosten)
docs/             Plan, Buchformat
examples/         gemeinfreies Beispielkapitel (EPUB, .hbook)
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
npm run build:web        # Lese-App (offline, für GitHub Pages) nach apps/desktop/dist-web
npm run preview:web -w @sprechbuch/desktop   # gebaute Lese-App unter http://localhost:4173
```

Kommandozeile:

```bash
npm run build:cli
node packages/cli/dist/cli.js import mein-buch.epub
node packages/cli/dist/cli.js info mein-buch.hbook
```

KI über die Kommandozeile – standardmäßig mit Ollama; <kbd>Strg</kbd>+<kbd>C</kbd> bricht ab und
speichert, was fertig ist:

```bash
node packages/cli/dist/cli.js ai mein-buch.hbook --model gemma4:26b --chapters 2-5
```

Cloud-Anbieter nur mit `--allow-cloud` (Schlüssel aus `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY` oder `SPRECHBUCH_API_KEY`):

```bash
node packages/cli/dist/cli.js ai mein-buch.hbook --provider anthropic --model claude-sonnet-5 --allow-cloud
```

Qualität an einem in der App geprüften Buch messen – nur Regeln bzw. Regeln + KI:

```bash
node packages/cli/dist/cli.js eval mein-buch.hbook --provider ollama --model gemma4:26b
```

Ohne echten Anbieter entwickeln – die Attrappe spricht alle drei Protokolle:

```bash
node tools/fake-llm.mjs --port 8787 --key test
```

Desktop-Installer bauen (unsigniert – Windows zeigt beim ersten Start eine SmartScreen-Warnung):

```bash
npm run tauri -w @sprechbuch/desktop -- build
```

Release: Version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` und
den `package.json` erhöhen, Tag `vX.Y.Z` pushen. Der Workflow *Release* baut die Installer für alle
drei Systeme in einen Entwurf; nach dem Prüfen wird er auf GitHub veröffentlicht.

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
