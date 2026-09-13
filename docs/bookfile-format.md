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
| `speech` | `start`, `end`, `speaker` (Figur-ID oder `null`), `confidence` 0–1, `via`, `continued?` | Direkte Rede |
| `quote` | `start`, `end` | Zitat innerhalb einer Rede (›…‹) – erbt die Figur der umgebenden Rede |
| `emphasis` | `start`, `end` | Betonung |
| `retake` | `start`, `end`, `note?` | Stelle neu aufnehmen |
| `bookmark` | `start`, `end` | Lesezeichen |
| `note` | `start`, `end`, `text` | Notiz |
| `pause` | `at`, `length` (`short`/`long`) | Pause setzen |
| `breath` | `at` | Atemzeichen |

Alle tragen `id`, `block` und `origin`.

### `via` – wie eine Rede zugeordnet wurde

In absteigender Verlässlichkeit: `inquit_after` (»…«, sagte X) · `inquit_before`
(X sagte: »…«) · `same_paragraph` · `continuation` · `pronoun` (»…«, sagte er) ·
`inquit_paragraph` · `proximity` · `alternation` · `unknown`. Die App zeigt alles unter
`confidence` 0,5 als „zur Prüfung“.

## Farben

`cast[].color` ist ein Index in die Textmarker-Palette
([`MARKER_SLOTS`](../packages/core/src/pipeline/palette.ts), 12 Farben). Figuren mit
`color: null` bekommen ihre Farbe pro Kapitel aus `chapterColors` – so ist innerhalb eines
Kapitels keine Farbe doppelt vergeben.

## Gültigkeit

Beim Lesen wird geprüft:

- das Schema (Typen, Pflichtfelder, erlaubte Werte),
- eindeutige Block- und Markierungs-IDs,
- dass jede Markierung auf einen existierenden Block verweist und innerhalb seines Textes liegt,
- dass `speech.speaker` auf eine existierende Figur verweist,
- dass Satzgrenzen innerhalb des Blocktextes liegen.

## Versionen und Migration

- `schemaVersion` steigt bei jeder inkompatiblen Änderung.
- Dateien mit **älterer** Version werden beim Öffnen schrittweise migriert
  ([`migrate.ts`](../packages/core/src/book/migrate.ts)). Bestehende Migrationsschritte werden
  nie verändert; jeder neue Schritt bekommt einen Test mit einer Datei im alten Format.
- Dateien mit **neuerer** Version werden mit dem Hinweis abgelehnt, Sprechbuch zu aktualisieren –
  lieber nicht öffnen als beim Speichern Daten verlieren.
- Neue *optionale* Felder brauchen keine neue Version, neue Markierungstypen schon.
