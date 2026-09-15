/**
 * Ausgabe der App und Eigenschaften des Geräts.
 *
 * Die **Lese-App** (`VITE_EDITION=lesen`, z. B. auf GitHub Pages fürs iPad) liest, nimmt auf und
 * markiert – ohne Import von EPUB/PDF und ohne KI. Aufbereitet wird in der Desktop-App.
 */
export const LESE_APP = import.meta.env.VITE_EDITION === "lesen";

/** Bedienung vor allem mit dem Finger (Tablet, Telefon) */
export const isTouch = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** iPad oder iPhone – iPadOS meldet sich im Browser als Mac, verrät sich aber über die Touchpunkte */
export const isAppleMobile = (): boolean =>
  typeof navigator !== "undefined"
  && (/iPad|iPhone/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** Als App vom Home-Bildschirm gestartet? Dann löscht Safari die gespeicherten Daten nicht nach Tagen ohne Besuch. */
export const isStandalone = (): boolean =>
  typeof matchMedia === "function"
  && (matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
