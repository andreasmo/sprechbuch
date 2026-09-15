/**
 * Lese-App offline: Service Worker registrieren und eine neue Version erst auf Wunsch aktivieren.
 *
 * Eine neue Version wartet, bis man sie ausdrücklich lädt – so wechselt die App nie mitten in der
 * Aufnahme, und eine offene Seite behält die Dateien ihrer eigenen Version im Cache.
 */
import { LESE_APP } from "./edition";

export const appUpdate = $state({ ready: false });

let waiting: ServiceWorker | null = null;

export function registerServiceWorker(): void {
  if (!LESE_APP || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  void navigator.serviceWorker.register("./sw.js").then((reg) => {
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        // Nur ein Update zählt – beim allerersten Besuch gibt es noch keinen aktiven Worker
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          waiting = worker;
          appUpdate.ready = true;
        }
      };
      check();
      worker.addEventListener("statechange", check);
    };
    watch(reg.waiting);
    reg.addEventListener("updatefound", () => watch(reg.installing));
  }).catch((err) => console.warn("Service Worker nicht registriert", err));
}

export function applyUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  waiting.postMessage("aktivieren");
}
