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
| **4 – KI** | Anbieter-Adapter (Anthropic, OpenAI-kompatibel inkl. lokaler Modelle), Schlüssel im OS-Tresor mit Rust-Proxy, Kostenvorschau, Verfeinerung unsicherer Zuordnungen, Figuren zusammenführen, Aussprachevorschläge; Qualitätsmessung an geprüften Büchern | **erledigt** |
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

## Bekannte Grenzen

- PDF: Mehrspaltensatz, Fußnoten und Scans (OCR) werden nicht unterstützt. Ein neuer Absatz
  oben auf einer Seite ist nur am Einzug erkennbar.
- Sprecherzuordnung: rund ein Drittel der Redeteile ist nach den Regeln geraten (Nähe,
  Wechselrede). Prüf-Warteschlange und KI helfen; wie gut echte Modelle sind, ist noch nicht an einem
  geprüften Buch gemessen.
- KI: keine Batch-API (halber Preis, asynchron) und kein Prompt-Caching; ein laufender Auftrag
  lässt sich abbrechen, die gerade laufende Anfrage wird aber noch zu Ende bezahlt. Die
  Tokenschätzung ist grob (Zeichen ÷ 3).
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
