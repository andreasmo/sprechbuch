# Beispiel: Effi Briest, erstes Kapitel

Theodor Fontane, *Effi Briest* (Buchausgabe 1896). Fontane starb 1898 – der Text ist **gemeinfrei**.
Textgrundlage ist die Ausgabe bei Project Gutenberg (eBook #5323), übernommen ohne deren Lizenzkopf;
Rechtschreibung und Zeichensetzung wie dort.

| Datei | Inhalt |
|---|---|
| `kapitel-1.txt` | der Text des ersten Kapitels, ein Absatz pro Zeile |
| `make-epub.mjs` | baut daraus `effi-briest-kapitel-1.epub` |
| `effi-briest-kapitel-1.epub` | kleines EPUB 3 – zum Ausprobieren des Imports |
| `effi-briest-kapitel-1.hbook` | das Ergebnis, so wie die App es öffnet: Regeln, danach mit lokaler KI (Ollama) den Figuren zugeordnet |

Das Kapitel ist ein guter Prüfstein: Effi, ihre Mutter und drei Freundinnen reden schnell
durcheinander, oft ohne „sagte sie“. Die Regeln raten dort viel (Wechselrede) – genau dafür gibt
es die Prüf-Warteschlange und die KI-Unterstützung.

In der App: auf der Startseite **„Beispiel ansehen“** – auch in der Lese-App auf dem iPad.

Neu erzeugen:

```bash
node examples/effi-briest/make-epub.mjs
npm run build:cli
node packages/cli/dist/cli.js import examples/effi-briest/effi-briest-kapitel-1.epub
# optional: Figuren mit lokaler KI zuordnen (Ollama muss laufen)
node packages/cli/dist/cli.js ai examples/effi-briest/effi-briest-kapitel-1.hbook
```
