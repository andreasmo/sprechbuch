import { readBrowserFile } from "./file";
import { ACCEPT, type FileKind, type Platform } from "./types";

export const webPlatform: Platform = {
  kind: "web",
  canOverwrite: false,

  pickFile(kind: FileKind) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ACCEPT[kind].extensions.map((e) => `.${e}`).join(",");
      input.addEventListener("change", () => {
        const f = input.files?.[0];
        resolve(f ? readBrowserFile(f) : null);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  },

  async saveFile(bytes, suggestedName, kind) {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ACCEPT[kind].mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return suggestedName;
  },
};
