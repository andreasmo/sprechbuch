# Python-Referenz

Der ursprüngliche Prototyp (Python, nur Standardbibliothek). Er bleibt als **Orakel** im
Repository: `dump_golden.py` erzeugt Referenzdaten, gegen die der TypeScript-Kern in
`packages/core/test/parity.test.ts` Feld für Feld verglichen wird.

```bash
python reference/python/dump_golden.py fixtures/local
```

Hier wird nicht weiterentwickelt. Neue Funktionen entstehen im TypeScript-Kern.

## Bewusste Abweichungen des Kerns

Diese Punkte sind im Kern korrigiert; auf den bisherigen Referenzbüchern ändern sie das
Ergebnis nicht, deshalb bleibt der Paritätstest grün.

| Stelle | Referenz | Kern |
|---|---|---|
| Kursiv/Fett-Offsets | vor dem Zusammenfassen von Leerraum berechnet – verschoben | exakt auf dem gespeicherten Text |
| Anführungsstil | braucht > 10 Zeichen, kurze Texte bekommen keine Redeerkennung | dominanter Stil nach Anzahl |
| Inhaltsverzeichnis-Titel | Links nicht relativ zur nav-Datei aufgelöst | korrekt aufgelöst |
| Spine-Einträge ohne HTML (z. B. Bilder) | mitgelesen | übersprungen |
| PDF | externe Werkzeuge, zeilenbasiertes Reflow | pdf.js mit Koordinaten (Einzug, Abstände, Schriftgröße) |
| `\w`, `\b` | Unicode (Python) | in JavaScript nur ASCII – nachgebildet in `text.ts` |
