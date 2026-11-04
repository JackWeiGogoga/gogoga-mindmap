import { Compartment, EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewline, isolateHistory } from "@codemirror/commands";
import { colorEditing, colorSourceChange } from "./color-editing";
import { dropEmptyColors } from "./color-source";
import { t } from "./i18n";

/** One source-backed editor exists only for the node currently being edited. */
export class NodeEditor {
  readonly view: EditorView;
  private mode = new Compartment();
  private source = false;
  private dead = false;

  constructor(host: HTMLElement, text: string, caretAtEnd: boolean, onChange: (changed: boolean, geometryChanged: boolean) => void, onBlur: () => void, onKey: (ev: KeyboardEvent) => void) {
    host.replaceChildren();
    const button = host.createEl("button", { cls: "mm-editor-mode", text: t("format.editSource") });
    button.type = "button";
    button.setAttribute("aria-label", t("format.editSource"));
    button.addEventListener("mousedown", (ev) => ev.preventDefault());
    button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.source = !this.source;
      button.textContent = t(this.source ? "format.editVisual" : "format.editSource");
      button.setAttribute("aria-label", button.textContent);
      this.view.dispatch({ effects: this.mode.reconfigure(this.source ? [] : colorEditing()) });
      this.view.focus();
      onChange(false, true);
    });
    this.view = new EditorView({
      parent: host,
      root: host.getRootNode() as Document | ShadowRoot,
      state: EditorState.create({
        doc: text,
        selection: caretAtEnd ? EditorSelection.cursor(text.length) : EditorSelection.range(0, text.length),
        extensions: [
          history(),
          // Let node commands and link suggestions handle Enter/Tab/arrows before CM keymaps.
          Prec.highest(EditorView.domEventHandlers({ keydown: (ev) => { onKey(ev); return ev.defaultPrevented; } })),
          this.mode.of(colorEditing()),
          EditorView.lineWrapping,
          EditorView.editorAttributes.of({ class: "mm-node-editor" }),
          keymap.of([{ key: "Shift-Enter", run: insertNewline }, ...historyKeymap, ...defaultKeymap.filter((b) => b.key !== "Enter")]),
          EditorView.contentAttributes.of({ "aria-label": t("format.nodeText") }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet || update.geometryChanged) queueMicrotask(() => { if (!this.dead) onChange(update.docChanged, update.geometryChanged); });
          }),
          EditorView.domEventHandlers({
            blur: () => {
              queueMicrotask(() => { if (!this.dead && !host.contains(host.ownerDocument.activeElement)) onBlur(); });
              return false;
            },
          }),
        ],
      }),
    });
    this.view.focus();
  }

  get text(): string { return this.view.state.doc.toString(); }
  get savedText(): string { return dropEmptyColors(this.text); }
  get selection(): { start: number; end: number } {
    const range = this.view.state.selection.main;
    return { start: range.from, end: range.to };
  }
  get caret(): number { return this.view.state.selection.main.head; }
  get composing(): boolean { return this.view.composing; }

  selectionRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } | null {
    const { from, to, empty } = this.view.state.selection.main;
    if (empty || !this.view.hasFocus) return null;
    const start = this.view.coordsAtPos(from, 1);
    const end = this.view.coordsAtPos(to, -1);
    if (!start || !end) return null;
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  setSelection(start: number, end = start): void {
    this.view.dispatch({ selection: EditorSelection.range(start, end) });
  }

  replace(text: string, start: number, end = start): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.range(start, end),
      annotations: [colorSourceChange.of(true), Transaction.userEvent.of("input.format"), isolateHistory.of("full")],
    });
  }

  destroy(): void {
    this.dead = true;
    this.view.destroy();
  }
}
