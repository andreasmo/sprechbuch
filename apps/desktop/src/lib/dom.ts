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

const canHighlight = () => typeof Highlight !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS;

/** CSS Custom Highlight setzen – markiert Text, ohne das DOM anzufassen. */
export function setHighlight(name: string, ranges: Range[]): void {
  if (!canHighlight()) return;
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}
