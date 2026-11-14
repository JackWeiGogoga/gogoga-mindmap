/**
 * 格子的输入框。表格只有一个，跟着选中的格子走：选中没编辑时它看不见，但拿着键盘焦点，
 * 直接打字、输入法组字都从这里开始（开始打字就进入编辑）；编辑时它盖在格子上。
 *
 * 两种实现，接口一样（名字照着 textarea 起，编辑器不用关心是哪种）：
 * - TextareaInput：普通 textarea，格式标记原样显示
 * - CodeMirrorInput：CodeMirror 6（Obsidian 自带的那份），加粗、颜色、荧光笔……直接显示效果，
 *   标签藏起来、删字时保持成对，和脑图节点的编辑框一样（规则在 core/cm-format.ts）
 */

import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { formatPreview, insertFormatBreak, visibleSelection } from "../core/cm-format";

export interface CellInputHandlers {
  keydown(ev: KeyboardEvent): void;
  copy(ev: ClipboardEvent): void;
  cut(ev: ClipboardEvent): void;
  paste(ev: ClipboardEvent): void;
  /** 用户改了文字（打字、删字、粘贴、组字） */
  input(): void;
  /** 选区变了 */
  select(): void;
  compositionstart(): void;
  /** 焦点离开了输入框 */
  blur(): void;
}

export interface CellInput {
  /** 放进格子里的元素（带 ggt-input 类）。CodeMirror 那种第一次取的时候才建 */
  readonly el: HTMLElement;
  /** 从格子里拿走（没选中格子时）；还没建出来就什么都不做 */
  detach(): void;
  /** 编辑中改文字（能撤销），光标放到最后；接着通常会 setSelectionRange */
  value: string;
  /** 开始一段新的编辑 / 清空：换掉文字，不进撤销记录 */
  reset(text: string): void;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  /** 选中的字（去掉两头藏起来的标记符）：加格式用 */
  visibleSelection(): { from: number; to: number };
  focus(): void;
  hasFocus(): boolean;
  contains(node: Node | null): boolean;
  /** 格子按这段文字的高度排版（编辑框盖在上面，自己不占位置） */
  sizingText(): string;
  /** 输入法正在组字（这时不能改文字，不然打断组字） */
  readonly composing: boolean;
  bind(h: CellInputHandlers): void;
  /** 撤销 / 重做编辑框里的输入（手机上没有键盘快捷键，工具条上的按钮用） */
  undo(): void;
  redo(): void;
  destroy(): void;
}

export class TextareaInput implements CellInput {
  readonly el: HTMLTextAreaElement;
  private readonly cleanups: (() => void)[] = [];

  constructor(doc: Document) {
    this.el = doc.createElement("textarea");
    this.el.className = "ggt-input";
    this.el.rows = 1;
    this.el.spellcheck = false;
    this.el.setAttribute("autocapitalize", "off");
  }

  get value(): string {
    return this.el.value;
  }
  set value(v: string) {
    this.el.value = v;
  }
  reset(text: string): void {
    this.el.value = text;
  }
  get selectionStart(): number {
    return this.el.selectionStart;
  }
  get selectionEnd(): number {
    return this.el.selectionEnd;
  }
  setSelectionRange(start: number, end: number): void {
    this.el.setSelectionRange(start, end);
  }
  detach(): void {
    this.el.remove();
  }
  visibleSelection(): { from: number; to: number } {
    return { from: this.el.selectionStart, to: this.el.selectionEnd };
  }
  focus(): void {
    this.el.focus({ preventScroll: true });
  }
  hasFocus(): boolean {
    return this.el.ownerDocument.activeElement === this.el;
  }
  contains(node: Node | null): boolean {
    return node === this.el;
  }
  sizingText(): string {
    return this.el.value;
  }
  private comp = false;
  get composing(): boolean {
    return this.comp;
  }

  bind(h: CellInputHandlers): void {
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (ev: HTMLElementEventMap[K]) => void) => {
      this.el.addEventListener(type, fn);
      this.cleanups.push(() => this.el.removeEventListener(type, fn));
    };
    on("keydown", (ev) => h.keydown(ev));
    on("copy", (ev) => h.copy(ev));
    on("cut", (ev) => h.cut(ev));
    on("paste", (ev) => h.paste(ev));
    on("input", () => h.input());
    for (const type of ["select", "keyup", "mouseup"] as const) on(type, () => h.select());
    on("compositionstart", () => {
      this.comp = true;
      h.compositionstart();
    });
    // 组字结束：组字时的 input 没处理补全（比如输入法打出来的「【【」），结束后再看一次
    on("compositionend", () => {
      this.comp = false;
      h.input();
    });
    on("blur", () => h.blur());
  }

  undo(): void {
    this.el.focus();
    this.el.ownerDocument.execCommand("undo");
  }

  redo(): void {
    this.el.focus();
    this.el.ownerDocument.execCommand("redo");
  }

  destroy(): void {
    for (const fn of this.cleanups.splice(0)) fn();
    this.el.remove();
  }
}

export class CodeMirrorInput implements CellInput {
  /**
   * 编辑器等到第一次选中这张表的格子才建：一篇笔记里几十张表、只点其中一两张的话，就只建一两个；
   * 滚动时重新画的表格也不用每张都建一个（建的那一下会让刚画出来的表格晚一帧吸顶）
   */
  private _view: EditorView | null = null;
  private readonly doc: Document;
  private handlers: CellInputHandlers | null = null;
  private readonly extensions: Extension[];
  /** reset() 正在换文字：这次改动不算用户输入 */
  private resetting = false;

  constructor(doc: Document) {
    this.doc = doc;
    const later = (fn: () => void) => queueMicrotask(() => this.handlers && fn());
    this.extensions = [
      // 宿主的按键、复制粘贴排在编辑器自己的前面：处理了（preventDefault）CodeMirror 就不再管
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (ev) => {
            this.handlers?.keydown(ev);
            return ev.defaultPrevented;
          },
          copy: (ev) => {
            this.handlers?.copy(ev);
            return ev.defaultPrevented;
          },
          cut: (ev) => {
            this.handlers?.cut(ev);
            return ev.defaultPrevented;
          },
          paste: (ev) => {
            this.handlers?.paste(ev);
            return ev.defaultPrevented;
          },
          compositionstart: () => {
            this.handlers?.compositionstart();
            return false;
          },
          compositionend: () => {
            later(() => this.handlers?.input());
            return false;
          },
          blur: () => {
            // 焦点挪到编辑框里的别处不算；挪到外面或者整个窗口失焦才算
            queueMicrotask(() => {
              if (!this.handlers) return;
              const d = this.view.dom.ownerDocument;
              if (!d.hasFocus() || !this.view.dom.contains(d.activeElement)) this.handlers.blur();
            });
            return false;
          },
        }),
      ),
      history(),
      // Enter、Tab、Esc 归表格（提交、走格）；格子里换行用 Shift+Enter
      keymap.of([{ key: "Shift-Enter", run: insertFormatBreak }, ...historyKeymap, ...defaultKeymap.filter((b) => b.key !== "Enter" && b.key !== "Mod-Enter")]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
      // 编辑器根元素的类名由 CodeMirror 管着，直接加会被它改回去
      EditorView.editorAttributes.of({ class: "ggt-input ggt-input-cm" }),
      ...formatPreview("ggt-ed", false),
      EditorView.updateListener.of((u) => {
        if (this.resetting) return;
        if (u.docChanged) later(() => this.handlers?.input());
        if (u.docChanged || u.selectionSet) later(() => this.handlers?.select());
      }),
    ];
  }

  get view(): EditorView {
    if (!this._view) {
      this._view = new EditorView({ root: this.doc, state: EditorState.create({ doc: "", extensions: this.extensions }) });
      // 测试和调试用：从拿着焦点的元素找回输入框（textarea 本身就是）
      (this._view.contentDOM as HTMLElement & { cellInput?: CellInput }).cellInput = this;
    }
    return this._view;
  }

  get el(): HTMLElement {
    return this.view.dom;
  }

  get composing(): boolean {
    return !!this._view?.composing;
  }

  detach(): void {
    this._view?.dom.remove();
  }

  get value(): string {
    return this._view ? this._view.state.doc.toString() : "";
  }
  set value(v: string) {
    if (v === this.value) return;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: v }, selection: EditorSelection.cursor(v.length), userEvent: "input.format" });
  }
  reset(text: string): void {
    if (!this._view && !text) return;
    this.resetting = true;
    try {
      // 新的一段编辑：撤销记录从这里开始
      this.view.setState(EditorState.create({ doc: text, selection: EditorSelection.cursor(text.length), extensions: this.extensions }));
    } finally {
      this.resetting = false;
    }
  }
  get selectionStart(): number {
    return this._view?.state.selection.main.from ?? 0;
  }
  get selectionEnd(): number {
    return this._view?.state.selection.main.to ?? 0;
  }
  setSelectionRange(start: number, end: number): void {
    const len = this.view.state.doc.length;
    this.view.dispatch({ selection: EditorSelection.single(Math.min(start, len), Math.min(end, len)) });
  }
  visibleSelection(): { from: number; to: number } {
    return visibleSelection(this.view);
  }
  focus(): void {
    this.syncRoot();
    this.view.contentDOM.focus({ preventScroll: true });
  }
  /**
   * 编辑器跟着它现在所在的 document 走：白板卡片编辑时 Obsidian 先在主窗口建好表格、再挪进卡片的 iframe，
   * 编辑器还当自己在主窗口，点格子里的字时 CodeMirror 把 iframe 当成别处的焦点让它失焦，这一格就保存退出了，
   * 光标挪不到想要的位置（B站反馈：白板里改格子只能全删重打）
   */
  private syncRoot(): void {
    const v = this._view;
    if (v && v.dom.isConnected && v.root !== v.dom.ownerDocument) v.setRoot(v.dom.ownerDocument);
  }
  hasFocus(): boolean {
    return !!this._view?.hasFocus;
  }
  contains(node: Node | null): boolean {
    return !!node && !!this._view?.dom.contains(node);
  }
  /** 藏起来的标签不占位置：按看得见的字排版 */
  sizingText(): string {
    return this.view.contentDOM.innerText.replace(/\n$/, "");
  }

  bind(h: CellInputHandlers): void {
    this.handlers = h;
  }

  undo(): void {
    undo(this.view);
  }

  redo(): void {
    redo(this.view);
  }

  destroy(): void {
    this.handlers = null;
    this._view?.destroy();
    this._view = null;
  }
}
