import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

// Tauri erwartet einen festen Port und liest TAURI_* aus der Umgebung.
const host = process.env.TAURI_DEV_HOST;

/** Die Seite darf nur Dateien von sich selbst laden und nichts nach außen senden */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const ICONS = [
  { src: "icons/icon-512.png", from: "src-tauri/icons/icon.png", sizes: "512x512" },
  { src: "icons/icon-256.png", from: "src-tauri/icons/128x128@2x.png", sizes: "256x256" },
];

/** Manifest, Symbole und Service Worker für die Lese-App */
function leseApp(): Plugin {
  return {
    name: "sprechbuch-lese-app",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<title>Sprechbuch</title>",
        [
          "<title>Sprechbuch</title>",
          `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
          `<meta name="referrer" content="no-referrer" />`,
          `<link rel="manifest" href="./manifest.webmanifest" />`,
          `<link rel="icon" type="image/png" href="./icons/icon-256.png" />`,
          `<link rel="apple-touch-icon" href="./icons/icon-512.png" />`,
          `<meta name="apple-mobile-web-app-capable" content="yes" />`,
          `<meta name="apple-mobile-web-app-title" content="Sprechbuch" />`,
          `<meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)" />`,
          `<meta name="theme-color" content="#141517" media="(prefers-color-scheme: dark)" />`,
        ].join("\n    "),
      );
    },
    generateBundle(_options, bundle) {
      for (const icon of ICONS) {
        this.emitFile({ type: "asset", fileName: icon.src, source: readFileSync(new URL(icon.from, import.meta.url)) });
      }
      const manifest = {
        name: "Sprechbuch",
        short_name: "Sprechbuch",
        description: "Bücher lesen und einsprechen – mit Textmarker-Farben für jede Figur",
        lang: "de",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#f7f5f0",
        theme_color: "#f7f5f0",
        icons: ICONS.map(({ src, sizes }) => ({ src, sizes, type: "image/png", purpose: "any" })),
        file_handlers: [{ action: "./", accept: { "application/vnd.sprechbuch.book+zip": [".hbook"] } }],
      };
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(manifest, null, 2) });

      // Alles vorab in den Cache – außer pdf.js, das die Lese-App nie lädt
      const files = Object.keys(bundle).filter((f) => !/pdf/i.test(f) && !f.endsWith(".map"));
      const precache = ["./", ...files, "manifest.webmanifest", ...ICONS.map((i) => i.src)];
      // Version aus Dateiliste und Worker-Code – ändert sich eins davon, lädt das Gerät neu
      const version = createHash("sha256").update(precache.join("\n") + serviceWorker("", precache)).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorker(version, precache) });
    },
  };
}

function serviceWorker(version: string, precache: string[]): string {
  return `// Sprechbuch Lese-App – offline nutzbar. Version ${version}
// ignoreVary: Modul-Skripte schicken einen Origin-Header, Server antworten mit „Vary“ – der Cache soll trotzdem greifen
const CACHE = "sprechbuch-${version}";
const FILES = ${JSON.stringify(precache)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sprechbuch-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eine neue Version aktiviert sich erst auf Wunsch – nie mitten in der Aufnahme
self.addEventListener("message", (event) => {
  if (event.data === "aktivieren") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(caches.match("./", { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request)));
});
`;
}

// Lese-App fürs iPad (`vite build --mode lesen`, GitHub Pages): relative Pfade, offline, strenge CSP.
// VITE_EDITION kommt für die Oberfläche aus .env.lesen.
export default defineConfig(({ mode }) => ({
  base: mode === "lesen" ? "./" : "/",
  plugins: [svelte(), ...(mode === "lesen" ? [leseApp()] : [])],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  worker: { format: "es" },
  build: {
    // WebView2 (Windows) und WKWebView ab macOS 13.3 / iPadOS 16.4 – Lookbehind in RegExp nötig
    target: ["es2022", "chrome110", "safari16.4"],
    outDir: mode === "lesen" ? "dist-web" : "dist",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2000,
  },
}));
