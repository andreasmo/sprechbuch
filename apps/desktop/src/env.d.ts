/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "lesen": Lese-App ohne Import und KI (siehe src/lib/edition.ts) */
  readonly VITE_EDITION?: "lesen";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
