# Testbücher

`fixtures/local/` ist für **lokale** Testbücher und daraus erzeugte Referenzdaten
(`*.golden.json`, `*.hbook`). Der Ordner ist in `.gitignore` – Bücher enthalten vollständige
Texte, deren Urheberrecht nicht ohne Weiteres geklärt ist.

- EPUB hineinlegen, `npm run golden` ausführen, `npm test` – der Paritätstest läuft dann mit.
- Alle anderen Tests erzeugen ihre EPUBs und PDFs selbst (`packages/core/test/helpers.ts`).

Wer ein Buch mit gesichert freier Lizenz (z. B. gemeinfrei *und* ohne geschützte Übersetzung)
dauerhaft als Fixture aufnehmen möchte, legt es mit Quellen- und Lizenzangabe in einen eigenen
Ordner außerhalb von `local/`.
