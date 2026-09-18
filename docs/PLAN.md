# Plan

Stand: 17.09.2026

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
| Plattformen | Desktop für Windows, macOS und Linux; auf dem iPad (und in jedem aktuellen Browser) die Web-App zum Lesen, Aufnehmen und für Markierungen, Sprecher und Notizen – keine Änderungen am Buchtext, kein Import, keine KI |
| Vertraulichkeit | Unveröffentlichte Bücher sind vertraulich. **Nur lokale KI** ist Standard; Cloud-KI muss auf dem Gerät ausdrücklich erlaubt werden (Rust sperrt sonst jede nicht lokale Adresse) und zusätzlich pro Buch |
| Hosting | Bücher werden nie gehostet. Die **Lese-App** (nur Code) liegt auf GitHub Pages, damit sie aufs iPad kommt; `.hbook`-Dateien kommen per Dropbox o. ä. |
| Repository | öffentlich: <https://github.com/andreasmo/sprechbuch>; Lese-App unter <https://andreasmo.github.io/sprechbuch/>; macOS- und Linux-Builds über GitHub Actions (kein Mac vorhanden) |
| Testgeräte | Windows 11 (Ryzen AI 7 PRO 350, 92 GB, ohne dedizierte GPU), iPad mit iPadOS 26.6.2 |

## Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| **1 – Kern** | TypeScript-Port der Analyse mit Paritätstests; EPUB- und PDF-Import; `.hbook`-Format mit Schema, Querverweisprüfung und Migrationen; CLI; App-Gerüst (Tauri + Svelte) mit Import im Web Worker, Übersicht und Kapitelvorschau | **erledigt** |
| **2 – Editor & Reader** | Markierungen ändern und hinzufügen (Sprecher per Klick/Taste 1–9, Rede setzen/entfernen/teilen, Satzgrenzen, Betonung, Pause, Notiz, Retake); Figurenverwaltung (umbenennen, zusammenführen, Farbe, Stimmnotiz); **Prüf-Warteschlange**; Rückgängig/Wiederholen; Aufnahmemodus mit allen Funktionen des früheren Studio-Readers (Prompter, Satzvorschau, Fortschritt, Seitenmodus, Suche, Figur isolieren, Satznummern, Atemstellen, Timer); Markierungsliste mit CSV-Export; Autosave (IndexedDB); JSON-Import/-Export in der App | **erledigt** |
| **3 – Desktop** | atomares Speichern (Vorschlag neben der Quelle), automatisches Speichern in die Datei, Erkennung fremder Änderungen (Cloud-Sync) mit **Zusammenführen**, `.hbook`-Dateiverknüpfung, Öffnen per Doppelklick/„Öffnen mit“/Drag & Drop, eine Instanz, Nachfrage beim Schließen | **erledigt** |
| **4 – KI** | Anbieter-Adapter (Anthropic, OpenAI-kompatibel inkl. lokaler Modelle), Schlüssel im OS-Tresor mit Rust-Proxy, Kostenvorschau, Verfeinerung unsicherer Zuordnungen, Figuren zusammenführen, Aussprachevorschläge; Qualitätsmessung an geprüften Büchern | **erledigt** |
| **5a – Lokale KI** | eigener Ollama-Adapter mit passendem Kontextfenster, Abschnitte nach Kontextgröße, Zeitschätzung aus gemessener Geschwindigkeit, echtes Abbrechen, Fortsetzen; „Nur lokale KI“ als Standard mit Sperre in Rust; Test mit echten lokalen Modellen | **erledigt** (Qualitätsmessung an einem geprüften Kapitel offen) |
| **5b – iPad/Web** | Lese-App (ohne Import/KI) für GitHub Pages: offline, Touch-Bedienung, Bildschirm bleibt an, `.hbook` hin und zurück (Teilen → Dateien/Dropbox) mit Übergabe-Protokoll, das die Desktop-App auf ihren Stand überträgt | **erledigt** (Test auf dem echten iPad offen) |
| **5c – Builds** | Installer für Windows, macOS, Linux über GitHub Actions (**erledigt**, Workflow *Release*); Ausweichlösung, wenn es unter Linux keinen Schlüsselspeicher gibt | teilweise |
| **5d – Veröffentlichung** | öffentliches Repository und Lese-App auf GitHub Pages (**erledigt**, mit gemeinfreiem Beispielkapitel); Release-Seite (**erledigt**, Version 0.1.0); abschaltbarer Update-Hinweis | teilweise |
| **6 – Stift und Farben** | farbige Betonungen mit eigener Bedeutung je Buch (Legende, Markierungsliste, CSV); handschriftliche Randnotizen mit dem Stift (Apple Pencil, Surface Pen), umbruchfest gespeichert; Stiftgesten, die zu echten Markierungen werden | **erledigt** (Test mit echtem Stift offen) |

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

## Ergebnis Phase 4

**Grundsatz:** Regeln zuerst (kostenlos, offline, sofort), die KI nur dort, wo Regeln unsicher
sind. Nutzerentscheidungen sind unantastbar. Keine Betonungs- oder Emotionsvorschläge – eine
falsche Markierung liest die Sprecherin sonst ab.

**Kern** (`packages/core/src/llm`, ohne Abhängigkeit von Tauri oder Browser):

- **Zwei Protokolle, viele Anbieter:** Anthropic Messages API mit strukturierten Antworten
  (`output_config.format`, JSON-Schema) und OpenAI-kompatibel (`/chat/completions`) für OpenAI,
  OpenRouter, Ollama, LM Studio und eigene Endpunkte. Kann ein Server kein JSON-Schema, stuft der
  Client selbst auf JSON-Modus bzw. reine Anweisung herunter. Vorlagen mit Preisen für Claude
  Opus 5 (Standard), Sonnet 5, Haiku 4.5 und Fable 5.1.
- **Robust:** Wiederholung bei 429/5xx (mit `retry-after`), sofortiger Abbruch bei falschem
  Schlüssel, Erkennung abgeschnittener und abgelehnter Antworten, JSON auch aus Codeblöcken.
- **Aufgaben:**
  1. *Sprecher* – kapitelweise mit ganzem Kapitel als Kontext; nur unsichere Redeteile sind als
     `⟦R12⟧` zu bestimmen, sichere stehen als `⟦Name⟧` zur Orientierung dabei (Wechselreden).
     Sehr lange Kapitel werden mit Überlappung geteilt.
  2. *Doppelte Figuren* – Vorschläge mit Begründung, Ketten werden aufgelöst; angewendet wird
     erst nach Auswahl durch den Menschen.
  3. *Aussprache* – deutsche Umschrift mit betonter Silbe, optional IPA, als „KI, ungeprüft“.
- **Einarbeiten** (`applySpeakerSuggestions`, ein Rückgängig-Schritt je Kapitel): einig →
  Konfidenz steigt; Regel unsicher und KI deutlich sicherer → KI übernimmt, Regel bleibt als
  Vorschlag; KI widerspricht sicher (≥ 70 %) → zur Prüfung mit KI-Vorschlag; KI rät nur →
  Vorschlag hängt dran, die Warteschlange bleibt ruhig. „Keine Rede“ wird nie automatisch
  entfernt, nur vorgeschlagen.
- **Kosten:** Schätzung vor jedem Lauf, Obergrenze je Lauf (startet keine weitere Anfrage),
  tatsächlicher Verbrauch aus den Antworten.
- **Qualität messen** (`compareSpeakers`): Ein geprüftes Buch ist ein Testsatz. Verglichen wird
  mit einer frisch erzeugten Regel-Fassung und optional mit Regeln + KI; die Absätze werden über
  ihren Text zugeordnet. Wichtigste Zahl: *still falsch* – falsch zugeordnet und nicht zur Prüfung
  vorgesehen.

**Desktop** (`apps/desktop/src-tauri/src/ai.rs`):

- Schlüssel im Windows-Anmeldeinformationsspeicher, macOS-Schlüsselbund bzw. Secret Service.
  Die Oberfläche sieht nur, *ob* einer da ist, und seine letzten vier Zeichen.
- Anfragen laufen über Rust, das den Schlüssel erst dort anhängt (umgeht CORS, auch für Ollama).
  Ein Schlüssel ist an die Adresse gebunden, für die er gespeichert wurde. Unverschlüsseltes HTTP
  nur zu diesem Rechner oder ins lokale Netz. Zugangsheader aus der Oberfläche werden verworfen.
- Web-Version: Schlüssel nur im Arbeitsspeicher der Seite.

**App:** Einrichtungsdialog (Anbieter, Adresse, Schlüssel, Modell mit „Modelle laden“, Preise,
Obergrenze, Verbindungstest), KI-Bereich in der Übersicht mit Einwilligung pro Buch („Text geht an
api.anthropic.com“ – bei lokalen Modellen entfällt sie), Kapitelauswahl, Schätzung, Fortschritt,
Abbrechen und Ergebnis. In der Prüfung und im Editor erscheint der Vorschlag mit „Übernehmen“
(Taste `V`). Aussprachevorschläge sind in der Tabelle als „KI“ markiert.

**Kommandozeile:** `sprechbuch ai buch.hbook` (Schlüssel aus der Umgebung, Schätzung,
Rückfrage oder `--yes`) und `sprechbuch eval geprüft.hbook [--provider …]` für die
Qualitätsmessung.

**Geprüft:** 15 Kern-Tests (Anfragen beider Protokolle, Herunterstufen, Wiederholung,
Auswertung, Einarbeitungsregeln, Figuren, Aussprache, Parallelität, Kostengrenze, Abbruch,
Qualitätsmessung), Rust-Tests für Adress- und Schlüsselbindung – und mit einer KI-Attrappe
(`tools/fake-llm.mjs`, beide Protokolle) in CLI und echter Desktop-App: Schlüssel in den Tresor,
Verbindungstest über den Rust-Proxy, Sprecherprüfung über 12 Kapitel, Vorschlag mit `V`
übernehmen, Figuren zusammenführen, Aussprachen und Rückgängig, Schlüssel geht nicht an eine fremde
Adresse, Schlüssel steht weder in localStorage noch in IndexedDB.

**Noch nicht gemessen:** die Qualität echter Modelle an einem vollständig geprüften Buch – dafür
braucht es ein von Hand geprüftes Buch und einen Schlüssel. Ablauf: Buch in der App prüfen, dann
`sprechbuch eval buch.hbook --provider anthropic --model claude-opus-5` (bzw. Sonnet, lokal).

## Ergebnis Phase 5a

**Befund vorab:** Über Ollamas OpenAI-kompatible Schnittstelle rechnet Ollama mit seinem
Standard-Kontext von 4 096 Token und schneidet längere Anfragen **stillschweigend** ab – bei einem
Kapitel mit ~10 000 Token kam nur ein Fünftel an, die Antwort war falsch. Über die eigene
Schnittstelle mit gesetztem `num_ctx` wurde der ganze Text gelesen und richtig beantwortet.

**Kern** (`packages/core/src/llm`):

- **Ollama als eigenes Protokoll** (`/api/chat`, `/api/show`, `/api/tags`): Kontextfenster je
  Anfrage (`num_ctx`, Einstellung begrenzt durch das Modell), Antwortschema über `format`,
  „Nachdenken“ abgeschaltet (kostet lokal Minuten, hilft bei der Zuordnung kaum), Temperatur 0,2.
  Zu lange Abschnitte werden vor dem Senden abgelehnt, abgeschnittene Antworten erkannt, fehlende
  Modelle mit „ollama pull …“ gemeldet. Alte Einstellungen (`…/v1`) werden umgestellt.
- **Andere lokale Server** (LM Studio, vLLM): Verarbeitet der Server deutlich weniger Token, als
  geschickt wurden, gilt die Antwort als abgeschnitten – mit Hinweis auf die Kontextlänge im Server.
- **Abschnitte nach Kontextgröße** (`speakerChunkChars`): gut die Hälfte des Fensters für
  Anweisung, Figurenliste und Kapiteltext, der Rest für die Antwort (32 768 Token → ~47 000 Zeichen).
- **Zeitschätzung:** Ollama meldet getrennt, wie lange Einlesen und Schreiben dauerten. Daraus
  entsteht je Rechner und Modell ein Geschwindigkeitsprofil (Probeanfrage beim Verbindungstest,
  danach mit jeder echten Anfrage gewichtet nachgeführt); daraus Dauer vor dem Start und
  „voraussichtlich fertig gegen …“ während des Laufs.
- **Fortsetzen:** Schon von der KI eingeschätzte Redeteile (übernommen, bestätigt oder mit
  KI-Vorschlag) werden nur mit „erneut prüfen“ wieder gefragt – ein neuer Lauf nach einem Abbruch
  macht also dort weiter.

**Nur lokale KI** (Standard):

- Desktop: Rust (`ai.rs`) lehnt jede Anfrage an eine Adresse außerhalb dieses Rechners bzw. des
  lokalen Netzes ab, solange Cloud-KI nicht erlaubt ist – unabhängig davon, was die Oberfläche
  schickt. Die Einstellung liegt als `ai-policy.json` im Konfigurationsordner der App. Erlauben
  geht nur über eine native Rückfrage; zurück zu „nur lokal“ ohne. Lokal heißt: Loopback, private
  und Link-Local-Adressen (IPv4/IPv6), Rechnernamen ohne Punkt, `.local`, `.lan`, `.home.arpa`,
  `.internal` – gleiche Regeln in Rust und TypeScript, beide getestet.
- Cloud-Anbieter erscheinen im Einrichtungsdialog als „gesperrt“; mit Erlaubnis braucht jedes Buch
  weiter eine eigene Einwilligung. Vorgeschlagen wird Ollama.
- Web-Version: gleiche Sperre im Transport, Erlauben per Browser-Rückfrage. CLI: Cloud nur mit
  `--allow-cloud`.

**Abbrechen und lange Läufe:** Die Desktop-App bricht die laufende Anfrage in Rust ab und schließt
die Verbindung – Ollama hört dann auf zu rechnen. Lokale Anfragen haben keine Zeitgrenze mehr
(vorher 15 min), Cloud-Anfragen weiter 15 min. Die CLI schickt lokale Anfragen ohne die
5-Minuten-Grenze von `fetch`, bricht mit Strg+C sauber ab, speichert Erreichtes und sichert lange
Läufe alle zwei Minuten zwischendurch.

**Gemessen mit echtem Ollama** (Windows-Laptop, Ryzen AI 7 PRO 350, 92 GB, Modell läuft auf der CPU):

| | Einlesen | Schreiben | Kapitel „II – Der Schwätzer“ (24 000 Zeichen, 66 unsichere Redeteile) |
|---|---|---|---|
| `gemma4:26b` | 41 Token/s | 5,8 Token/s | 13 min, 8 429 + 3 182 Token, 64 eingeschätzt: 35 bestätigt, 28 geändert, 1 × „keine Rede“, 2 neue Figuren |
| `qwen3.8` (27B) | 3 Token/s | 3,1 Token/s | 70 min, 8 741 + 4 337 Token, 66 eingeschätzt: 35 bestätigt, 30 geändert, 1 × „keine Rede“, 2 neue Figuren |

- Beide Modelle kommen unabhängig voneinander bei 59 von 64 Redeteilen zum selben Ergebnis; die
  5 Abweichungen betreffen Nebenfiguren („die vier Leute“ gegen „Leoparden“). Beide räumen eine von
  den Regeln erfundene Figur („seiner bestürzten Hörer“) ab. Übereinstimmung ist noch keine
  Trefferquote, aber ein gutes Zeichen.
- Auf CPU ist `gemma4:26b` die brauchbare Wahl; `qwen3.8` liest hier mehr als zehnmal langsamer.
- Bei `gemma4:26b` dominiert das Schreiben (~9 von 13 min). Die kurze Probe beim Verbindungstest misst schneller
  (46/10 Token/s), weil lange Abschnitte pro Token langsamer werden – die erste Schätzung ist daher
  zu optimistisch und wird nach dem ersten Kapitel korrigiert. Ein ganzer Roman: grob 2–3 Stunden.
- Stichprobe der 28 Änderungen: überwiegend erkennbar richtig (u. a. eine Rede direkt vor „fragte
  Hamilton“, die die Regeln Sanders zugeordnet hatten; Anreden wie „alter Ham“). Das Modell gibt fast
  überall 90 % an – zu selbstsicher, deshalb landete nichts in der Prüfung. Ob das stimmt, zeigt erst
  die Messung an einem von Hand geprüften Kapitel.

**Geprüft:** 79 Kern-Tests (neu: Ollama-Anfragen und -Antworten, Kontextbegrenzung, zu lange
Abschnitte, fehlendes Modell, abgelehntes `think`, abgeschnittene Eingaben bei LM Studio, lokale
Adressen, Umstellung alter Einstellungen, Abschnittsgröße, Fortsetzen, Zeitschätzung), 10 Rust-Tests
(neu: lokale Adressen, Sperre, gespeicherte Einstellung) – und in der echten Desktop-App:
Ollama-Attrappe (23 Prüfungen: Voreinstellung „nur lokal“, Cloud-Vorlagen gesperrt, Modelle aus
`/api/tags`, Geschwindigkeitsmessung, Dauer vor dem Start, „fertig gegen“, Abbrechen schließt die
Verbindung, zweiter Lauf fragt nur die übrigen Kapitel, Rust sperrt Cloud-Adressen auch am Dialog
vorbei, native Rückfrage abgelehnt/bestätigt, zurück ohne Rückfrage), echtes Ollama über den
Rust-Proxy (Modellliste, Verbindungstest mit Messung), Phase-4-Ablauf mit Anthropic-Protokoll
(21 Prüfungen) sowie Speichern/Sync und Neustart ohne Rückschritte. Web-Version im Browser: Sperre,
gesperrte Vorlagen, Modellliste direkt vom lokalen Ollama.

## Ergebnis Phase 5b

**Lese-App** (`npm run build:web` → `apps/desktop/dist-web`, veröffentlicht über
`.github/workflows/pages.yml`):

- Dieselbe App, gebaut mit `VITE_EDITION=lesen`: öffnet nur `.hbook`, kein Import, keine KI.
  Übersicht, Bearbeiten (Sprecher, Markierungen, Notizen, Pausen – nie der Buchtext), Prüfen und
  Aufnehmen wie auf dem Desktop.
- **Nichts nach außen:** strenge Content Security Policy in der Seite (`connect-src 'self'`) –
  technisch kann sie keine Daten an andere Adressen schicken. Bücher liegen nur in IndexedDB des
  Geräts; `navigator.storage.persist()` wird angefragt.
- **Offline:** Service Worker legt alle App-Dateien vorab in den Cache (pdf.js ausgenommen, das nur
  der Import braucht – im Worker jetzt erst bei Bedarf geladen). Eine neue Version wartet und wird
  erst über „Jetzt neu laden“ auf der Startseite aktiv – nie mitten in der Aufnahme. Relative Pfade:
  läuft unter jedem Pfad, z. B. `https://<name>.github.io/sprechbuch/`.
- **Installierbar:** Manifest, Symbole; auf dem iPad Hinweis „Teilen → Zum Home-Bildschirm“ (dann
  keine Löschung nach Tagen ohne Besuch).
- **Datei hin und zurück:** Öffnen über die Dateien-App (auf iPadOS ohne Dateifilter, der „.hbook“
  sonst ausgraut). „Sichern …“ öffnet auf Touch-Geräten das Teilen-Menü („In Dateien sichern“,
  Dropbox), sonst Download. Die Datei wird im Hintergrund vorbereitet, weil Safari das Teilen-Menü nur
  direkt nach dem Tippen erlaubt; dauert es doch zu lange, genügt ein zweites Tippen.

**Übergabe-Protokoll** (`changes.json`, siehe [Buchformat](bookfile-format.md)): Die Lese-App legt
jeder gesicherten Datei ihre Befehle seit der Ausgangsfassung bei. Die Desktop-App überträgt sie auf
ihren eigenen Stand, statt ihn zu ersetzen – egal ob die Datei im Cloud-Ordner ersetzt wurde (auch
bei geöffnetem Buch) oder als Kopie „Buch 2.hbook“ ankommt (dann mit Rückfrage). Nebenbei behoben:
Beim Zusammenführen galten zwei *verschiedene* Notizen am selben Satz als dieselbe.

**Touch:** fingergroße Bedienflächen, keine Tastenkürzel-Hinweise, kein Doppeltipp-Zoom; Aufnehmen
mit Wischen (Seitenmodus blättert, sonst Satz vor/zurück) und großen Transportknöpfen; Bearbeiten
per Antippen (Pause, Atem, Satz teilen ohne Alt-Taste) und lange drücken zum Markieren (Menü unter
der Auswahl, weil iOS darüber sein eigenes zeigt); Sicherheitsabstände für Home-Balken und
Querformat. **Bildschirm bleibt an** im Aufnahmemodus (Screen Wake Lock, auch auf dem Desktop).
SHA-256 funktioniert auch ohne Web Crypto (Test auf dem Tablet über http im lokalen Netz).

**Geprüft:** Kern-Tests (Übergabe-Protokoll lesen/schreiben/beschädigt, SHA-256 ohne Web Crypto,
Notizen beim Zusammenführen), App-Tests (Entscheidung beim Eintreffen, Pfade, Gerätename) – im
Browser als Tablet (744 × 1133, Touch): Lese-Ausgabe ohne KI, Kopfzeile passt, Wischen im Scroll-
und Seitenmodus, Retake/Marker, gesicherte Datei enthält das Protokoll mit gleicher Ausgangsfassung
und wachsenden Befehlen, Antippen- und Markier-Menü, Update-Hinweis mit Neuladen, **Start und
Weiterlesen ohne Server** aus dem Cache – und in der echten Desktop-App (14 Prüfungen): Desktop
arbeitet weiter, iPad ersetzt die Datei mit altem Stand → beides steht in der Datei, Protokoll
entfernt; iPad-Fassung auf aktuellem Stand wird still geladen; Kopie „Strom 2.hbook“ → native
Rückfrage → in „Strom.hbook“ übernommen, Kopie unverändert. Speichern/Sync, Neustart, Reader und
KI-Ablauf ohne Rückschritte.

**Nicht geprüft:** echtes iPad (Safari/WebKit, Teilen-Menü, „In Dateien sichern“ in Dropbox,
Home-Bildschirm-App, Wake Lock) – das geht erst mit der veröffentlichten Seite.

## Version 0.1.0

Erste Veröffentlichung mit Installern für Windows (NSIS, ohne Adminrechte), macOS (Universal-DMG ab
13.3, ad hoc signiert, damit die App auf Apple Silicon startet) und Linux (AppImage, .deb, gebaut auf
Ubuntu 22.04). Der Workflow *Release* baut sie bei jedem Tag `v*` in einen Entwurf, der nach dem
Prüfen veröffentlicht wird.

Dazu **Randnotizen**: Notizen stehen beim Bearbeiten und Aufnehmen links neben der Zeile, in der sie
beginnen – beim Einsprechen aus dem Augenwinkel sichtbar. Dicht folgende Notizen stapeln sich, der
Fokus-Modus dimmt nur den Text, im Seitenmodus rutscht keine Notiz auf die nächste Seite. Das
Beispielkapitel ist mit lokaler KI den Figuren zugeordnet.

**Geprüft:** Kern- und App-Tests, Typprüfung; Randnotizen in Chromium im Scroll- und Seitenmodus, im
Fokus-Modus, beim Bearbeiten (Antippen öffnet die Notiz), als iPad hochkant, Handy und im dunklen
Thema; die lokal gebaute Release-App (WebView2) mit Beispiel und Notiz; der Windows-Installer baut.

## Version 0.1.1

Korrekturen nach dem ersten Test auf dem iPad: Menüs, die weder unter noch über den Tippunkt passen,
liegen vollständig im Fenster, statt mit unsichtbarer Scrollleiste abgeschnitten zu wirken; beim
Antippen einer Rede stehen „Stimmt“, „Ab hier andere Figur“ und „Keine Rede“ vor der Figurenliste.
Die automatische Sicherung öffnet die Verbindung zum App-Speicher neu, wenn Safari sie nach einem
Tab-Wechsel getrennt hat, und meldet sonst den echten Grund statt „null“ (geprüft mit simuliert
getrennter Verbindung und abgebrochener Transaktion; auf dem echten iPad noch zu bestätigen).

## Phase 6 – Stift und Farben

Zwei Dinge, die zusammengehören: Betonungen bekommen über die Farbe eine Bedeutung, und wer ein iPad
mit Stift hat, schreibt Randnotizen von Hand und markiert mit dem Stift statt mit dem Finger. Beides
liegt vollständig im Web-Teil, läuft also auch in der Lese-App auf dem iPad und offline.

### Farbige Betonungen

Heute ist eine Betonung ein Schalter: Unterstreichung und halbfett, sonst nichts. Künftig trägt sie
eine Farbe, und was die Farbe bedeutet, legt man je Buch selbst fest – „rot = langsamer“, „blau =
leiser“. Jede Sprecherin hat ihr eigenes System; die App gibt die Farben vor, nicht den Sinn.

- **Eigene Stiftpalette**, nicht die Markerfarben der Figuren: Ein Unterstrich in derselben Farbe wie
  das Markerband darüber wäre verwirrend. Fünf bis sechs klar unterscheidbare Töne genügen, jeder mit
  hellem und dunklem Wert wie in `MARKER_SLOTS`.
- **Farbe und Linienart gehören zusammen** (durchgezogen, doppelt, gewellt, gepunktet). So bleiben
  die Betonungen im Studio-Thema, bei Farbsehschwäche und im Schwarzweißdruck unterscheidbar.
- **Die Bedeutung steht im Buch**, nicht in den Geräte-Einstellungen: Sie gehört zum Buch wie die
  fest vergebene Figurenfarbe (Grundregel 6 in `bookfile-format.md`). Neues Feld `emphasisLabels`
  mit einem Namen je Farbe.
- **Legende und Liste:** Die Legende zeigt die im Kapitel belegten Farben mit ihrer Bedeutung.
  Betonungen fehlen bisher ganz in der Markierungsliste; mit Farbe und Bedeutung lohnt sich der
  Eintrag dort und im CSV-Export.
- **Auswählen** über eine schmale Farbleiste im Bearbeiten- und Aufnahmemodus. Ohne Auswahl bleibt
  es bei der heutigen farblosen Betonung.
- Bestehende Betonungen ohne Farbe bleiben gültig und sehen aus wie bisher (`color` ist optional).

### Was der Stift kann – und was nicht

Der Text fließt um: Schriftgröße, Zeilenabstand, Spaltenbreite, Schriftart, Seiten- oder Scrollmodus
und das Drehen des iPads verschieben jedes Wort. Striche in Bildschirmkoordinaten lägen nach der
ersten Änderung an der falschen Stelle. Deshalb nur zwei Anwendungen – und eine ausdrücklich nicht:

1. **Handschrift im Rand.** Der Bereich dafür existiert seit 0.1.0: Die Randnotiz hängt an Block und
   Zeichenbereich und ist schriftgrößenrelativ breit, wächst also bereits mit. Der Stift schreibt
   hinein, die Handschrift skaliert mit.
2. **Gesten statt Tinte im Text.** Der Strich wird ausgewertet und in eine Markierung verwandelt, die
   es im Format längst gibt; der Strich selbst wird danach verworfen. Die Zeichenpositionen liefert
   ein Treffertest gegen die vorhandenen `data-start`/`data-end`-Stücke im Text.

   | Geste | wird zu |
   |---|---|
   | waagerecht durch oder unter Wörtern | `emphasis` in der gewählten Farbe |
   | Kringel um Wörter | dasselbe |
   | senkrechter Strich links neben Zeilen | `retake` oder `bookmark` für diese Sätze |
   | Häkchen bzw. Schrägstrich zwischen Wörtern | `breath` bzw. `pause` |

   Der Gewinn gegenüber Tinte: Das Ergebnis überlebt jeden Umbruch, steht in der Markierungsliste
   und im CSV, ist durchsuchbar, lässt sich zusammenführen, und die KI kann es lesen.
3. **Freies Malen über dem Text – nein.** Ehrlich ginge das nur mit eingefrorenem Layout (feste
   Schriftgröße und Spaltenbreite je Buch), und das widerspricht den Lese-Einstellungen. Blockweise
   normieren hilft nicht: Der Block wird bei anderer Schriftgröße höher, der Kringel verzerrt. Wer
   Pfeile malen will, bekommt dafür die Randspur.

### Anker und Koordinaten

Kein neuer Mechanismus: derselbe Anker wie bei allen Markierungen, `block` plus `start`/`end`, mit
`origin: "user"`. Damit greifen Rebase, Zusammenführen, Übergabe-Protokoll und Rückgängig wie gehabt.
Die Striche stehen **normiert auf die Breite der Randnotiz** – x von 0 bis 1000, y in derselben
Einheit, damit das Seitenverhältnis erhalten bleibt. Gezeichnet wird als SVG mit
`viewBox="0 0 1000 h"` und `width: 100%`; dasselbe Bild gilt dann für jede Schriftgröße, jedes Gerät
und jede Spalte im Seitenmodus. Die Strichstärke skaliert mit, nach unten begrenzt, sonst verschwindet
sie beim Verkleinern. Die Nachrück-Logik `fitMarginNotes` misst nur Höhen und bleibt unverändert.

```jsonc
{ "type": "ink", "id": "a000123", "block": "b00042", "start": 0, "end": 96,
  "h": 620,                           // Höhe in Tausendsteln der Breite
  "strokes": [[0,120,14,131,22,140]], // x,y im Wechsel, ganzzahlig quantisiert
  "text": "",                         // optional getippt – für Suche und Liste
  "origin": "user" }
```

Beim Bauen ist daraus etwas Besseres geworden: **Die Handschrift hängt als Feld `ink` an der
vorhandenen Notiz**, statt eine eigene Markierungsart zu sein. Neue *optionale Felder* brauchen keine
neue `schemaVersion` (Grundregel 5), also bleiben Dateien auch für ältere Fassungen lesbar – wichtig,
weil auf dem iPad eine ältere Lese-App im Cache liegen kann, bis man „Neue Version“ antippt. Eine
handschriftliche Notiz ist ohnehin eine Notiz: mit Handschrift, wahlweise zusätzlich getippt.

### Bedienung und Technik

- Nur `pointerType === "pen"` zeichnet, der Finger scrollt weiter – das ist zugleich die
  Handballenerkennung. `touch-action: none` ausschließlich auf der Tintenebene, `setPointerCapture`.
- **Groß schreiben, klein anzeigen:** Der Rand ist bei Standardgröße rund 155 px breit, dort schreibt
  niemand mit dem Pencil. Antippen öffnet ein Schreibblatt über die volle Breite, im Rand steht das
  Ergebnis verkleinert. Durch die Normierung ist das ohne Zusatzaufwand zu haben.
- `getCoalescedEvents()` für die 120 Hz des Pencils. Die Strichstärke bleibt gleichmäßig: Im Rand
  verkleinert läge der Unterschied durch den Druck unter einem Pixel, kostete aber ein Drittel mehr
  Daten in der Datei.
- Laufender Strich auf Canvas (Verzögerung), fertiger Strich als SVG-Pfad – so skaliert er mit und
  folgt dem Thema.
- Löschen über einen Treffertest auf die Strich-Rechtecke, Rückgängig über das vorhandene Journal.
- Eine Geste muss sicher erkannt werden, sonst schadet sie mehr, als sie nützt: gerade/waagerecht,
  gerade/senkrecht, geschlossene Schleife, Häkchen – mehr nicht, und im Zweifel keine Markierung.

### Reihenfolge

1. **Farbige Betonungen.** Klein, sofort nützlich, unabhängig vom Stift und auch mit Maus und Finger.
2. **Handschriftliche Randnotizen.** In sich geschlossen, nutzt den Rand aus 0.1.0, kein
   Erkennungsrisiko.
3. **Eine Geste als Probe** – Streichen durch einen Satz wird Betonung in der gewählten Farbe. Erst
   wenn sich das im echten Gebrauch bewährt, die übrigen Gesten dazu.

### Preis

Handschrift ist nicht durchsuchbar, und die KI kann sie nicht lesen. Ein Buch voller Tintennotizen
verliert genau das, was Sprechbuch von einem PDF-Reader unterscheidet. Deshalb kann eine Notiz beides
tragen: Handschrift **und** optional getippten Text; in Liste und CSV steht sie sonst als
„(Handschrift)“. Außerdem wachsen `book.json` und das Übergabe-Protokoll fürs iPad spürbar –
ausgedünnte, gerundete Ganzzahlen statt Fließkomma sind dort kein Detail (ein handgeschriebenes Wort
sind rund 60 Zahlen).

### Ergebnis

Alle drei Schritte sind gebaut.

**Farbige Betonungen:** fünf Stiftfarben mit je eigener Linienart (`PEN_SLOTS`), ihre Bedeutung je
Buch in `emphasisLabels`. Farbleiste im Bearbeiten-Modus (mit ✎ für die Bedeutungen) und als Legende
beim Aufnehmen; im Auswahlmenü und am angetippten Unterstrich wählt man die Farbe direkt. Dieselbe
Stelle noch einmal betont färbt um, statt zwei Striche zu stapeln. Betonungen stehen jetzt auch in
der Markierungsliste, im CSV (neue Spalte *Farbe*) und in der Zwischenablage.

**Handschrift:** „✍ Mit Stift schreiben“ öffnet ein liniertes Schreibblatt (Stift oder Finger,
Handballen wird ignoriert, sobald ein Stift schreibt), mit Radierer, Rückgängig, Vorschau in echter
Randgröße und optionalem getippten Text. Im Rand steht die Handschrift verkleinert, im Seitenmodus
neben ihrer Zeile.

**Stiftgeste:** Waagerecht durch oder unter Wörtern streichen setzt eine Betonung in der gewählten
Farbe – beim Bearbeiten wie beim Aufnehmen; der Strich wird beim Ziehen mitgezeichnet und danach
verworfen. Antippen wirkt wie mit dem Finger. Gekritzeltes, zu kurze oder zu steile Striche ergeben
keine Markierung, sondern einen Hinweis.

Zwei Dinge sind beim Bauen aufgefallen und gelöst:

- Der Browser unterdrückt nach abgefangenem `pointerdown` den Klick – ein Stift-Tipper löst ihn
  deshalb selbst aus, und ein danach doch noch gemeldeter echter Klick wird verworfen.
- Ein Unterstrich beginnt gern knapp neben der Textspalte. Die Stifterkennung hängt darum am Fenster
  und prüft die Nähe zum Text, statt nur auf Ereignisse im Textbereich zu warten.

**Geprüft** (Chromium, simulierter Stift über das Debug-Protokoll): Farbwahl im Menü und Umfärben
derselben Stelle, Bedeutungen festlegen, Streichen im Bearbeiten- und Aufnahmemodus (Rückmeldung mit
Farbnamen, Leseposition bleibt stehen), Kritzeln wird abgelehnt, Antippen öffnet das Menü bzw. setzt
die Leseposition, Schreibblatt mit Radierer und Rückgängig, Randnotiz im Scroll- und Seitenmodus,
Markierungsliste, dunkles Thema (dunkle Farbtöne) und iPad-Maße hochkant. Kern- und App-Tests,
Typprüfung. **Nicht geprüft:** ein echter Apple Pencil auf dem iPad – dort hängt die Erkennung an
`touchType === "stylus"` und am abgefangenen `touchstart`.

## Bekannte Grenzen

- PDF: Mehrspaltensatz, Fußnoten und Scans (OCR) werden nicht unterstützt. Ein neuer Absatz
  oben auf einer Seite ist nur am Einzug erkennbar.
- Sprecherzuordnung: rund ein Drittel der Redeteile ist nach den Regeln geraten (Nähe,
  Wechselrede). Prüf-Warteschlange und KI helfen; wie gut echte Modelle sind, ist noch nicht an einem
  geprüften Buch gemessen.
- KI: keine Batch-API (halber Preis, asynchron) und kein Prompt-Caching. Abbrechen schließt die
  Verbindung; ein lokales Modell hört auf zu rechnen, ein Cloud-Anbieter berechnet die angefangene
  Anfrage womöglich trotzdem. Die Tokenschätzung ist grob (Zeichen ÷ 3; gemessen bei Gemma 4 für
  deutschen Text: 3,07).
- Lokale KI: Die Zeitschätzung beruht auf der gemessenen Geschwindigkeit; lange Abschnitte lesen
  sich pro Token etwas langsamer als die kurze Probe, die Ladezeit des Modells ist nicht enthalten.
  Wie gut lokale Modelle zuordnen, ist noch nicht an einem von Hand geprüften Buch gemessen.
- In der Web-Version heißt Speichern Herunterladen – eine vorhandene Datei kann dort nicht
  überschrieben werden. Beim erneuten Öffnen erkennt die App die heruntergeladene Fassung am Hash
  wieder.
- Die Dateiverknüpfung für `.hbook` richten erst die Installer ein; mit den Installern selbst ist
  sie noch nicht ausprobiert, nur „Öffnen mit“ auf die `sprechbuch.exe` und Hineinziehen.
- Die macOS- und Linux-Pakete baut GitHub Actions; auf echten Geräten sind sie noch nicht getestet.
  macOS: nur ad hoc signiert, nicht notarisiert.
- Der macOS-Weg (`RunEvent::Opened`) ist geschrieben, aber mangels Mac noch nicht ausprobiert.
- Zusammenführen kennt keine Zeichen-genauen Konflikte: Haben beide Seiten dieselbe Rede
  unterschiedlich zugeordnet, gewinnt die eigene Entscheidung ohne Rückfrage.
- Eine erneute automatische Analyse eines bereits bearbeiteten Buches (unter Beibehaltung der
  eigenen Entscheidungen) gibt es noch nicht.
- Die nativen Datei-Dialoge (Öffnen, Speichern unter, Rückfrage beim Schließen) und das native
  Drag & Drop sind nicht per Klick automatisiert getestet.
- Der Prompter läuft nur im Scrollmodus. Isolierte Figur, Suche und Timer gelten für die
  laufende Sitzung und werden nicht gespeichert.
- Der Stift ist nur mit simulierten Stift-Ereignissen in Chromium geprüft, nicht mit einem echten
  Apple Pencil oder Surface Pen. Handschrift ist nicht durchsuchbar und für die KI nicht lesbar.
  Freies Malen über dem Text gibt es bewusst nicht (siehe Phase 6); von den geplanten Stiftgesten ist
  bisher nur das Streichen umgesetzt.
- Suchtreffer im Text hervorheben braucht die CSS Custom Highlight API (WebView2 und aktuelle
  Browser; ältere WebKitGTK-Versionen unter Linux springen nur zum Treffer, ohne Markierung).
- Der Claude-Skill aus dem Prototyp ist noch nicht auf die neue CLI umgestellt.
