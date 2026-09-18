/**
 * Offsets im Absatztext ↔ DOM. Jedes kleinste Element mit `data-start` enthält genau
 * einen Textknoten (plus ggf. ein Sprecherkürzel), dessen Zeichen bei `data-start` beginnen.
 */

function textNodeOf(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".badge") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  return walker.nextNode() as Text | null;
}

function pointAt(para: Element, offset: number, isEnd: boolean): { node: Text; offset: number } | null {
  for (const el of para.querySelectorAll<HTMLElement>("[data-start]")) {
    if (el.querySelector("[data-start]")) continue;
    const s = Number(el.dataset.start);
    const e = Number(el.dataset.end);
    if (isEnd ? offset > s && offset <= e : offset >= s && offset < e) {
      const node = textNodeOf(el);
      if (node) return { node, offset: Math.min(node.length, offset - s) };
    }
  }
  return null;
}

/** Laufender Stiftstrich über allem – nur als Rückmeldung beim Zeichnen, verblasst nach dem Absetzen */
export function strokeOverlay(color: string, width: number): { add: (x: number, y: number) => void; done: () => void } {
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed", left: "0", top: "0", width: `${window.innerWidth}px`, height: `${window.innerHeight}px`,
    pointerEvents: "none", zIndex: "60", transition: "opacity 0.25s ease",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
    Object.assign(ctx, { strokeStyle: color, lineWidth: width, lineCap: "round", lineJoin: "round", globalAlpha: 0.8 });
  }
  let last: { x: number; y: number } | null = null;
  return {
    add(x, y) {
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(last?.x ?? x, last?.y ?? y);
      ctx.lineTo(x, y);
      ctx.stroke();
      last = { x, y };
    },
    done() {
      canvas.style.opacity = "0";
      setTimeout(() => canvas.remove(), 280);
    },
  };
}

/** DOM-Range für einen Textbereich eines Absatzes, null wenn nicht (mehr) dargestellt. */
export function rangeFor(root: ParentNode, block: string, start: number, end: number): Range | null {
  const para = root.querySelector(`[data-block="${CSS.escape(block)}"]`);
  if (!para) return null;
  const a = pointAt(para, start, false);
  const b = pointAt(para, Math.max(end, start + 1), true);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/**
 * Seitenmodus (Spalten): Passt eine Randnotiz nicht mehr unter ihre Zeile, schiebt der Browser sie
 * auf die nächste Seite – zu spät, um vorzuwarnen. Solche Notizen enden stattdessen auf Höhe ihrer Zeile.
 */
export function fitMarginNotes(root: ParentNode, lineHeight: number): void {
  const notes = [...root.querySelectorAll<HTMLElement>(".mnote")];
  for (const n of notes) n.style.removeProperty("margin-block");
  for (const n of notes) {
    let anchor = n.nextElementSibling;
    while (anchor && !anchor.hasAttribute("data-start")) anchor = anchor.nextElementSibling;
    const line = anchor?.getClientRects()[0];
    const box = n.getBoundingClientRect();
    // In derselben Spalte steht die Notiz immer links vom Text
    if (!line || box.left <= line.left) continue;
    n.style.setProperty("margin-block", `${Math.min(0, lineHeight - box.height)}px 0px`);
  }
}

const canHighlight = () => typeof Highlight !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS;

/** CSS Custom Highlight setzen – markiert Text, ohne das DOM anzufassen. */
export function setHighlight(name: string, ranges: Range[]): void {
  if (!canHighlight()) return;
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}
