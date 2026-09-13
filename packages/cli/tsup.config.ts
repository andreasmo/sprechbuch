import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  // Der Kern wird mitgebündelt; pdf.js bleibt eine normale Abhängigkeit (Worker, Schriftdaten).
  noExternal: ["@sprechbuch/core"],
  external: ["pdfjs-dist"],
  banner: { js: "#!/usr/bin/env node" },
});
