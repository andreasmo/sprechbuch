import { isLocalUrl } from "@sprechbuch/core";
import { isAppleMobile, isTouch, LESE_APP } from "../edition";
import { readBrowserFile } from "./file";
import { ACCEPT, ShareNeedsTapError, type AiBridge, type FileKind, type Platform } from "./types";

/** Web: Schlüssel nur im Arbeitsspeicher dieser Seite – nach dem Neuladen neu eingeben */
const keys = new Map<string, { baseUrl: string; key: string }>();
const POLICY_KEY = "sprechbuch:ai-cloud";

function storedAllowCloud(): boolean {
  try {
    return localStorage.getItem(POLICY_KEY) === "erlaubt";
  } catch {
    return false;
  }
}

const denied = (message: string) => ({ status: 403, body: JSON.stringify({ error: { message } }) });

const ai: AiBridge = {
  keyStorage: "memory",
  async keyStatus(provider) {
    const k = keys.get(provider);
    return k ? { baseUrl: k.baseUrl, hint: k.key.slice(-4) } : null;
  },
  async setKey(provider, baseUrl, key) {
    keys.set(provider, { baseUrl: baseUrl.replace(/\/+$/, ""), key: key.trim() });
  },
  async deleteKey(provider) {
    keys.delete(provider);
  },
  async allowCloud() {
    return storedAllowCloud();
  },
  async setAllowCloud(allow) {
    if (allow && !storedAllowCloud()
      && !window.confirm("Mit Cloud-KI kann Kapiteltext an Anbieter wie Anthropic oder OpenAI gehen – bei jedem Buch erst nach einer eigenen Einwilligung. Unveröffentlichte Manuskripte sind oft vertraulich.\n\nCloud-KI in diesem Browser erlauben?")) {
      return false;
    }
    try {
      if (allow) localStorage.setItem(POLICY_KEY, "erlaubt");
      else localStorage.removeItem(POLICY_KEY);
    } catch {
      /* ohne Speicher gilt wieder „nur lokal“ */
    }
    return storedAllowCloud();
  },
  async transport(req, signal) {
    if (!isLocalUrl(req.url) && !storedAllowCloud()) {
      return denied(`Nur lokale KI ist eingeschaltet – ${new URL(req.url).host} liegt nicht auf diesem Rechner oder im lokalen Netz.`);
    }
    const headers: Record<string, string> = { ...req.headers };
    const stored = keys.get(req.provider);
    if (req.auth !== "none") {
      if (!stored) return { status: 401, body: JSON.stringify({ error: { message: "Kein Schlüssel eingegeben." } }) };
      if (!req.url.startsWith(stored.baseUrl)) return denied(`Der Schlüssel gilt nur für ${stored.baseUrl}.`);
      if (req.auth === "x-api-key") {
        headers["x-api-key"] = stored.key;
        // Anthropic erlaubt Browser-Anfragen nur mit diesem ausdrücklichen Hinweis
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      } else headers.authorization = `Bearer ${stored.key}`;
    }
    const res = await fetch(req.url, { method: req.method, headers, ...(req.body ? { body: req.body } : {}), ...(signal ? { signal } : {}) });
    const retry = Number(res.headers.get("retry-after"));
    return { status: res.status, body: await res.text(), ...(retry > 0 ? { retryAfter: retry } : {}) };
  },
};

/** Teilen-Menü statt Download: nur auf Touch-Geräten, die Dateien teilen können */
const sharesFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && isTouch();

export const webPlatform: Platform = {
  kind: "web",
  canOverwrite: false,
  sharesFiles,
  ai,

  pickFile(kind: FileKind) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      // iPadOS/iOS kennen „.hbook“ nicht und grauen solche Dateien bei einem Filter aus – dort ohne Filter
      const wanted = LESE_APP && kind === "any" ? "hbook" : kind;
      if (!isAppleMobile()) input.accept = ACCEPT[wanted].extensions.map((e) => `.${e}`).join(",");
      input.addEventListener("change", () => {
        const f = input.files?.[0];
        resolve(f ? readBrowserFile(f) : null);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  },

  async saveFile(bytes, suggestedName, kind) {
    if (sharesFiles) {
      // Neutraler Typ, damit „In Dateien sichern“ den Namen samt .hbook behält
      const file = new File([bytes as Uint8Array<ArrayBuffer>], suggestedName, { type: kind === "hbook" ? "application/octet-stream" : ACCEPT[kind].mime });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return suggestedName;
        } catch (err) {
          const name = err instanceof DOMException ? err.name : "";
          if (name === "AbortError") return null;
          if (name === "NotAllowedError") throw new ShareNeedsTapError();
          // sonst: herunterladen
        }
      }
    }
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ACCEPT[kind].mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return suggestedName;
  },
};
