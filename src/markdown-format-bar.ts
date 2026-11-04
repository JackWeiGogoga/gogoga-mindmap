import { EditorSelection, Transaction, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { colorSourceChange } from "./color-editing";
import { applyInlineFormat, type InlineFormat } from "./format";
import { buildFormatBar, type FormatPalette } from "./format-bar";

export function markdownFormatBar(enabled: (state: EditorState) => boolean, palette: () => FormatPalette) {
  return ViewPlugin.fromClass(class {
    private bar: HTMLElement | null = null;
    private paletteKey = "";
    private dead = false;
    constructor(readonly view: EditorView) { this.schedule(); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || update.focusChanged || update.transactions.some((tr) => tr.effects.length || tr.reconfigured)) this.schedule();
    }
    schedule(): void {
      this.view.requestMeasure({ key: this, read: () => {
        const range = this.view.state.selection.main;
        if (!this.view.hasFocus || range.empty || !enabled(this.view.state)) return null;
        const first = this.view.coordsAtPos(range.from, 1);
        const last = this.view.coordsAtPos(range.to, -1);
        const bounds = this.view.scrollDOM.getBoundingClientRect();
        if (!first || !last || Math.max(first.bottom, last.bottom) < bounds.top || Math.min(first.top, last.top) > bounds.bottom) return null;
        return { left: (first.left + last.right) / 2, top: Math.min(first.top, last.top), bottom: Math.max(first.bottom, last.bottom) };
      }, write: (rect) => {
        if (this.dead) return;
        if (!rect) { this.bar?.remove(); this.bar = null; return; }
        const colors = palette();
        const key = JSON.stringify(colors);
        if (!this.bar || key !== this.paletteKey) {
          this.bar?.remove();
          this.bar = buildFormatBar(colors, (format) => this.apply(format));
          this.bar.classList.add("mm-markdown-format-bar");
          this.view.dom.ownerDocument.body.append(this.bar);
          this.paletteKey = key;
        }
        const bar = this.bar;
        const win = this.view.dom.ownerDocument.defaultView;
        if (!win) return;
        const left = Math.max(4, Math.min(win.innerWidth - bar.offsetWidth - 4, rect.left - bar.offsetWidth / 2));
        const above = rect.top - bar.offsetHeight - 6;
        bar.style.left = `${left}px`;
        bar.style.top = `${Math.max(4, Math.min(win.innerHeight - bar.offsetHeight - 4, above >= 4 ? above : rect.bottom + 6))}px`;
      } });
    }
    apply(format: InlineFormat): void {
      const range = this.view.state.selection.main;
      if (range.empty || !enabled(this.view.state)) return;
      const result = applyInlineFormat(this.view.state.doc.toString(), range.from, range.to, format);
      // Replace only the changed segment so other selections/folds stay mapped correctly.
      const before = this.view.state.doc.toString();
      let from = 0;
      while (from < before.length && from < result.text.length && before[from] === result.text[from]) from++;
      let end = before.length, nextEnd = result.text.length;
      while (end > from && nextEnd > from && before[end - 1] === result.text[nextEnd - 1]) { end--; nextEnd--; }
      this.view.dispatch({ changes: { from, to: end, insert: result.text.slice(from, nextEnd) },
        selection: EditorSelection.range(result.start, result.end), scrollIntoView: true,
        annotations: [colorSourceChange.of(true), Transaction.userEvent.of("input.format"), isolateHistory.of("full")] });
      this.view.focus();
    }
    destroy(): void { this.dead = true; this.bar?.remove(); }
  }, { eventHandlers: { scroll() { this.schedule(); } } });
}
