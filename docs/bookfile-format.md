# Das `.hbook`-Format

Version 1 · Quelle der Wahrheit: [`packages/core/src/book/schema.ts`](../packages/core/src/book/schema.ts)

Eine `.hbook`-Datei enthält den Text eines Buches und alle Markierungen dazu. Sie ist
unabhängig vom Speicherort, kann verschoben und weitergegeben werden und wird von der App
automatisch aktualisiert.

## Container

`.hbook` ist ein ZIP-Archiv (wie EPUB oder DOCX):

| Eintrag | Inhalt |
|---|---|
| `mimetype` | `application/vnd.sprechbuch.book+zip` – **erster Eintrag, unkomprimiert** (erlaubt Erkennung ohne Entpacken) |
| `book.json` | das Buch (dieses Dokument) |
| `source/<Dateiname>` | optional die Originaldatei (EPUB/PDF), um später neu analysieren zu können |
| `changes.json` | optional das **Übergabe-Protokoll** eines Geräts ohne Dateizugriff (iPad, Browser) – unkomprimiert, siehe unten |

Zusätzlich lässt sich `book.json` einzeln exportieren und wieder importieren
(`sprechbuch export-json`, `sprechbuch import-json`).

## Grundregeln

1. **Text und Markierungen sind getrennt.** Kapitel enthalten Blöcke mit Text; Markierungen
   stehen in einer eigenen Liste und verweisen auf `block` + Zeichenpositionen.
2. **Stabile IDs statt Positionen.** Blöcke (`b00001`), Markierungen (`a000001`), Figuren
   (`bones`) und Kapitel (`ch002`) haben IDs, die sich beim Bearbeiten nicht ändern.
3. **Offsets sind UTF-16-Codeeinheiten** – also JavaScript-String-Indizes. Bereiche sind
   halboffen: `start` gehört dazu, `end` nicht.
4. **Herkunft an jeder Markierung:** `rule` (Regelanalyse), `llm` (KI), `user` (von Hand).
   Eine erneute automatische Analyse darf `rule`/`llm` ersetzen, **niemals `user`**.
5. **Unbekannte Felder bleiben erhalten.** Wer eigene Daten ablegen will, nutzt Feldnamen mit
   Präfix `x_` (z. B. `x_studio`). Sprechbuch liest und schreibt sie unverändert mit.
6. **Lese-Einstellungen gehören nicht ins Buch** (Schriftgröße, Thema sind pro Gerät). Nur
   Buchbezogenes – etwa eine fest vergebene Figurenfarbe – steht hier.

## Aufbau von `book.json`

```jsonc
{
  "format": "sprechbuch",
  "schemaVersion": 1,
  "id": "3f7c0e3a-…",                 // bleibt beim Verschieben/Umbenennen gleich
  "meta": {
    "title": "Am großen Strom",
    "author": "Edgar Wallace",
    "language": "de",
    "source": {
      "fileName": "am-grossen-strom.epub",
      "format": "epub",                // epub | pdf | docx | html | txt
      "size": 148013,
      "sha256": "…",
      "embedded": true                 // liegt unter source/ in der .hbook
    },
    "quoteStyle": { "name": "guillemets_de", "open": "»", "close": "«" },
    "createdWith": "sprechbuch-core/0.1.0",
    "createdAt": "2026-09-13T19:20:00.000Z",
    "modifiedAt": "2026-09-13T19:20:00.000Z"
  },

  "cast": [
    {
      "id": "bones", "name": "Bones", "aliases": ["Leutnant Tibbetts"],
      "gender": "m",                   // m | f | ?
      "color": 0,                      // Markerslot, null = Farbe je Kapitel
      "badge": "Bo",
      "voiceNote": "hoch, hektisch",
      "kind": "name",                  // name | np (»der Häuptling«) | pron
      "origin": "rule"
    }
  ],

  "chapters": [
    {
      "id": "ch002", "title": "I – Bones und die Bienen",
      "blocks": [
        {
          "id": "b00004", "type": "p", // h1 | h2 | p | quote | verse
          "text": "»Ich sehe dich, mein Herr Sandi«, begrüßte Makara den Bezirksamtmann. Seine Stimme klang müde.",
          "sentences": [[0, 71], [72, 99]],
          "format": [{ "start": 12, "end": 16, "kind": "em" }]   // optional: Kursiv/Fett der Quelle
        }
      ]
    }
  ],

  "annotations": [
    { "type": "speech", "id": "a000001", "block": "b00004", "start": 0, "end": 32,
      "speaker": "makara", "origin": "rule", "confidence": 0.95, "via": "inquit_after" },
    { "type": "quote",  "id": "a000002", "block": "b00009", "start": 14, "end": 20, "origin": "rule" }
  ],

  "chapterColors": { "ch002": { "makara": 3 } },

  "emphasisLabels": ["langsamer"],    // optional: Bedeutung der Stiftfarben in diesem Buch

  "pronunciations": [
    { "term": "Kobala'ba", "kind": "foreign", "count": 19, "hint": "", "ipa": "",
      "origin": "rule", "verified": false }
  ],

  "progress": null                     // { "block": "b00104", "sentence": 2 }
}
```

## Markierungstypen

| `type` | Felder | Bedeutung |
|---|---|---|
| `speech` | `start`, `end`, `speaker` (Figur-ID oder `null`), `confidence` 0–1, `via`, `continued?`, `suggestion?` | Direkte Rede |
| `quote` | `start`, `end` | Zitat innerhalb einer Rede (›…‹) – erbt die Figur der umgebenden Rede |
| `emphasis` | `start`, `end`, `color?` | Betonung; `color` ist die Stiftfarbe (Index in `PEN_SLOTS`), ohne sie schlicht |
| `retake` | `start`, `end`, `note?` | Stelle neu aufnehmen |
| `bookmark` | `start`, `end` | Lesezeichen |
| `note` | `start`, `end`, `text`, `ink?` | Notiz; `text` darf leer sein, wenn `ink` (Handschrift) dabei ist |
| `pause` | `at`, `length` (`short`/`long`) | Pause setzen |
| `breath` | `at` | Atemzeichen |

Alle tragen `id`, `block` und `origin`.

### `via` – wie eine Rede zugeordnet wurde

In absteigender Verlässlichkeit: `inquit_after` (»…«, sagte X) · `inquit_before`
(X sagte: »…«) · `same_paragraph` · `continuation` · `pronoun` (»…«, sagte er) ·
`inquit_paragraph` · `proximity` · `alternation` · `unknown`. `llm` heißt: die KI hat die Figur
bestimmt. Die App zeigt alles unter `confidence` 0,5 als „zur Prüfung“.

### `origin` und `suggestion` – Regeln, KI und Mensch

- `origin: "rule"` – automatische Analyse. `"llm"` – von der KI bestimmt oder bestätigt.
  `"user"` – Entscheidung des Menschen; wird von keiner Automatik überschrieben.
- `suggestion` (optional) hält eine abweichende Einschätzung fest, die in der Prüfung angeboten
  wird: `{ "speaker": "sanders" | null, "confidence": 0.85, "source": "llm" | "rule",
  "notSpeech"?: true, "note"?: "Anrede Sandi → Sanders" }`.
  - `source: "llm"`: Die Regel-Zuordnung bleibt, die KI sieht es anders.
  - `source: "rule"`: Die KI hat übernommen, die frühere Regel-Zuordnung bleibt als Alternative.
  - Eine Entscheidung des Menschen entfernt den Vorschlag.
- Aussprachen mit `origin: "llm"` sind Vorschläge der KI und bleiben `verified: false`, bis der
  Mensch sie abhakt.

## Farben

`cast[].color` ist ein Index in die Textmarker-Palette
([`MARKER_SLOTS`](../packages/core/src/pipeline/palette.ts), 12 Farben). Figuren mit
`color: null` bekommen ihre Farbe pro Kapitel aus `chapterColors` – so ist innerhalb eines
Kapitels keine Farbe doppelt vergeben.

Betonungen haben ihre **eigene Palette** (`PEN_SLOTS` in derselben Datei, fünf Stiftfarben mit je
eigener Linienart: Rot doppelt, Blau gewellt, Grün gepunktet, Orange gestrichelt, Violett kräftig).
Was eine Farbe in diesem Buch bedeutet, steht in `emphasisLabels` – ein Feld je Farbe, leer heißt
„nur der Farbname“:

```jsonc
"emphasisLabels": ["langsamer", "", "leiser"]
```

Eine `color`, die eine spätere Version nicht kennt, gilt als schlichte Betonung – die Datei bleibt
lesbar.

## Handschrift (`note.ink`)

Eine Notiz kann handschriftlich sein. Die Striche stehen **normiert auf die Breite der
Schreibfläche** (0–1000), y in derselben Einheit; oben und unten ist auf die Schrift zugeschnitten.
So zeigt der Rand dieselbe Schrift bei jeder Schriftgröße, Spaltenbreite und auf jedem Gerät –
größer oder kleiner, nie verzerrt.

```jsonc
{ "type": "note", "id": "a000123", "block": "b00042", "start": 0, "end": 96,
  "text": "",                          // optional getippt – für Suche, Liste und Export
  "ink": {
    "h": 157,                          // Höhe in Tausendsteln der Breite
    "w": 12,                           // Strichstärke, ebenso
    "strokes": [[40, 12, 58, 96, 61, 140]]   // je Strich x,y im Wechsel, ganzzahlig
  },
  "origin": "user" }
```

Die Punkte sind beim Speichern ausgedünnt (Ramer–Douglas–Peucker) und gerundet; eine Notiz fasst
höchstens 40 000 Zahlen. Wer `ink` nicht kennt, zeigt die Notiz als Text – das Feld bleibt erhalten.

## Gültigkeit

Beim Lesen wird geprüft:

- das Schema (Typen, Pflichtfelder, erlaubte Werte),
- eindeutige Block- und Markierungs-IDs,
- dass jede Markierung auf einen existierenden Block verweist und innerhalb seines Textes liegt,
- dass `speech.speaker` auf eine existierende Figur verweist,
- dass Satzgrenzen innerhalb des Blocktextes liegen.

## Übergabe-Protokoll (`changes.json`)

Die Lese-App im Browser bzw. auf dem iPad kann eine Datei nicht an ihren Platz zurückschreiben –
sie gibt eine neue `.hbook` über „Teilen“ bzw. als Download zurück. Dabei kann sie nicht prüfen, ob
die Datei inzwischen auf dem Desktop weiterbearbeitet wurde. Deshalb legt sie ihre Änderungen als
Befehle bei:

```jsonc
{
  "format": "sprechbuch-changes",
  "version": 1,
  "base": "9dcee62e…",          // SHA-256 der .hbook, von der das Gerät ausging
  "device": "iPad",
  "updatedAt": "2026-09-15T08:00:00.000Z",
  "edits": [                    // alle Befehle seit `base`, in Reihenfolge; null = nicht lückenlos
    { "edit": { "type": "addMark", "mark": { "type": "retake", "block": "b00009", "start": 0, "end": 69 } }, "created": "a001153" }
  ]
}
```

- `book.json` enthält den Stand des Geräts **mit** diesen Änderungen; `changes.json` sagt, wie er
  entstanden ist. Gibt das Gerät mehrmals zurück, bleibt `base` gleich und `edits` wächst.
- **Desktop-App**, wenn eine solche Datei eintrifft (die eigene Datei wurde ersetzt, oder eine Kopie
  wie „Buch 2.hbook“ wird geöffnet):
  - `base` ist genau der eigene Stand und hier ist nichts offen → Datei laden.
  - sonst → die Befehle auf den eigenen, neueren Stand übertragen (wie beim Zusammenführen in
    Phase 3) und speichern. Bei einer Kopie fragt die App vorher, ob sie in die eigentliche Datei
    übernehmen soll.
  - `edits: null` → die App fragt, welche Fassung gilt.
- Die Desktop-App schreibt nie ein Übergabe-Protokoll; nach dem Übernehmen steht es nicht mehr in der Datei.
- Befehle sind dieselben wie in der Rückgängig-Historie ([`edits.ts`](../packages/core/src/edit/edits.ts)).
  Ein beschädigtes oder unbekanntes Protokoll macht die Datei nicht unlesbar – es wird ignoriert.

## Versionen und Migration

- `schemaVersion` steigt bei jeder inkompatiblen Änderung.
- Dateien mit **älterer** Version werden beim Öffnen schrittweise migriert
  ([`migrate.ts`](../packages/core/src/book/migrate.ts)). Bestehende Migrationsschritte werden
  nie verändert; jeder neue Schritt bekommt einen Test mit einer Datei im alten Format.
- Dateien mit **neuerer** Version werden mit dem Hinweis abgelehnt, Sprechbuch zu aktualisieren –
  lieber nicht öffnen als beim Speichern Daten verlieren.
- Neue *optionale* Felder brauchen keine neue Version, neue Markierungstypen schon.
