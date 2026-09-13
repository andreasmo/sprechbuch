# Plan

Stand: 13.09.2026

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
| **2 – Editor & Reader** | Markierungen ändern und hinzufügen (Sprecher per Klick/Taste 1–9, Rede setzen/entfernen/teilen, Satzgrenzen, Betonung, Pause, Notiz, Retake); Figurenverwaltung (umbenennen, zusammenführen, Farbe, Stimmnotiz); **Prüf-Warteschlange**; Rückgängig/Wiederholen; Aufnahmemodus aus dem früheren Studio-Reader (Prompter, Satzvorschau, Fortschritt); Autosave (IndexedDB-Journal); JSON-Import/-Export in der App | offen |
| **3 – Desktop** | atomares Speichern neben der Quelle, Erkennung fremder Änderungen (Cloud-Sync), `.hbook`-Dateiverknüpfung, zuletzt geöffnete Bücher, Installer (NSIS/DMG/AppImage), Auto-Update über GitHub Releases | offen |
| **4 – KI** | Anbieter-Adapter (Anthropic, OpenAI-kompatibel inkl. lokaler Modelle), Schlüssel im OS-Tresor mit Rust-Proxy, Kostenvorschau, Verfeinerung unsicherer Zuordnungen, Figuren zusammenführen, Aussprachevorschläge; Qualitätsmessung an geprüften Büchern | offen |
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

## Bekannte Grenzen

- PDF: Mehrspaltensatz, Fußnoten und Scans (OCR) werden nicht unterstützt. Ein neuer Absatz
  oben auf einer Seite ist nur am Einzug erkennbar.
- Sprecherzuordnung: rund ein Drittel der Redeteile ist geraten (Nähe, Wechselrede) – dafür
  kommen Prüf-Warteschlange (Phase 2) und KI (Phase 4).
- Speichern auf dem Desktop ist noch nicht atomar (Phase 3).
- Der Claude-Skill aus dem Prototyp wird auf die neue CLI umgestellt, sobald die App den
  Aufnahmemodus hat (Phase 2).
