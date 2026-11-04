/**
 * 画布上的行内编辑框（节点文字、标注、概要、关联线文字、外框标题）：CodeMirror 6。
 * Obsidian 自己的编辑器就是它，插件用 Obsidian 带的那份（构建时不打包，见 esbuild.config.mjs）。
 * 底层永远是源码，格式只在显示上藏起标记符、直接显示效果（哪些段见 live-preview.ts）；
 * 输入法组字、撤销、光标跳过藏起来的字符都交给 CodeMirror。
 */

import { EditorSelection, EditorState, Prec, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, placeholder, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { formatSpans, revealed, type FormatSpan } from "./live-preview";

export interface InlineEditorOptions {
  text: string;
  /** 进入时全选（打字直接替换）；否则光标放在末尾 */
  selectAll: boolean;
  /** Shift+Enter 换行；单行的（概要、关联线文字、外框标题）不开 */
  multiline: boolean;
  placeholder?: string;
  /** 按键先交给宿主：返回 true 表示处理过了，编辑框不再处理 */
  onKey?: (ev: KeyboardEvent) => boolean;
  /** 粘贴先交给宿主：返回 true 表示处理过了（比如图片存成附件），编辑框不再插入任何东西 */
  onPaste?: (ev: ClipboardEvent) => boolean;
  /** 一次输入落到文字之前：返回 true 表示宿主自己处理了（比如选中文字打【包成链接） */
  onInput?: (from: number, to: number, text: string) => boolean;
  /** 文字变了（输入法组字结束时也会来一次）。在这次更新结束后才调用，回调里可以接着改文字 */
  onChange?: () => void;
  /** 文字或选区变了；同样在更新结束后调用 */
  onSelect?: () => void;
  /** 焦点离开编辑框（窗口失焦也算，和原来一样就此提交） */
  onBlur?: () => void;
}

const HIDE = Decoration.replace({});
const SYNTAX = Decoration.mark({ class: "mm-ed-syntax" });
const KIND_MARKS = {
  strong: Decoration.mark({ class: "mm-ed-strong" }),
  em: Decoration.mark({ class: "mm-ed-em" }),
  mark: Decoration.mark({ class: "mm-ed-mark" }),
  del: Decoration.mark({ class: "mm-ed-del" }),
  code: Decoration.mark({ class: "mm-ed-code" }),
};

/** 颜色值来自 COLOR_OPEN_SRC 的匹配（十六进制、颜色名、rgba(数字)），放进 style 是安全的 */
function contentMark(span: FormatSpan): Decoration {
  if (span.kind === "color") return Decoration.mark({ attributes: { style: `color: ${span.color}` } });
  if (span.kind === "bg") return Decoration.mark({ class: "mm-ed-mark", attributes: { style: `background: ${span.color}` } });
  return KIND_MARKS[span.kind];
}

function build(state: EditorState): { deco: DecorationSet; atomic: DecorationSet } {
  const cursors = state.selection.ranges.filter((r) => r.empty).map((r) => r.head);
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  for (const span of formatSpans(state.doc.toString())) {
    deco.push(contentMark(span).range(span.innerFrom, span.innerTo));
    if (revealed(span, cursors)) {
      deco.push(SYNTAX.range(span.from, span.innerFrom), SYNTAX.range(span.innerTo, span.to));
    } else {
      // 藏起来的标记符做成原子范围：光标一步跳过，删除也是整个删，不会删出半个标签
      const marks = [HIDE.range(span.from, span.innerFrom), HIDE.range(span.innerTo, span.to)];
      deco.push(...marks);
      atomic.push(...marks);
    }
  }
  return { deco: Decoration.set(deco, true), atomic: Decoration.set(atomic, true) };
}

const livePreview = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ deco: this.deco, atomic: this.atomic } = build(view.state));
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) ({ deco: this.deco, atomic: this.atomic } = build(update.state));
    }
  },
  {
    decorations: (v) => v.deco,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

export class InlineEditor {
  readonly view: EditorView;
  private destroyed = false;

  constructor(
    readonly host: HTMLElement,
    opts: InlineEditorOptions,
  ) {
    const { text } = opts;
    // CodeMirror 不许在一次更新还没结束时再发起修改，回调统一推到这次更新之后
    const later = (fn?: () => void) => fn && queueMicrotask(() => !this.destroyed && fn());
    host.replaceChildren();
    host.classList.add("mm-has-editor");
    this.view = new EditorView({
      parent: host,
      // 独立窗口里的画布：编辑器要挂在那个窗口的 document 上
      root: host.ownerDocument,
      state: EditorState.create({
        doc: text,
        selection: opts.selectAll ? EditorSelection.single(0, text.length) : EditorSelection.cursor(text.length),
        extensions: [
          // 宿主的按键（回车提交、Esc、Tab、链接补全的上下键……）排在编辑器自己的按键前面
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (ev) => !!opts.onKey?.(ev),
              paste: (ev) => {
                if (!opts.onPaste?.(ev)) return false;
                ev.preventDefault();
                return true;
              },
            }),
          ),
          EditorView.inputHandler.of((_view, from, to, insert) => !!opts.onInput?.(from, to, insert)),
          history(),
          // 回车归宿主（提交）；能换行的用 Shift+Enter
          keymap.of([...(opts.multiline ? [{ key: "Shift-Enter", run: insertNewline }] : []), ...historyKeymap, ...defaultKeymap.filter((b) => b.key !== "Enter")]),
          EditorView.lineWrapping,
          livePreview,
          ...(opts.placeholder ? [placeholder(opts.placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) later(opts.onChange);
            if (update.docChanged || update.selectionSet) later(opts.onSelect);
          }),
          EditorView.domEventHandlers({
            // 组字中途不处理（Windows 输入法打「【」也走组字，中途把【【换成 [[ 会被输入法再补一个【），结束时补一次
            compositionend: () => {
              later(opts.onChange);
              return false;
            },
            blur: () => {
              // 焦点挪到编辑框里的别处（CodeMirror 自己的元素）不算；挪到外面或者整个窗口失焦才算
              queueMicrotask(() => {
                const doc = host.ownerDocument;
                if (this.destroyed) return;
                if (!doc.hasFocus() || !host.contains(doc.activeElement)) opts.onBlur?.();
              });
              return false;
            },
          }),
        ],
      }),
    });
    this.view.focus();
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  /** 主选区 */
  get selection(): { from: number; to: number } {
    const { from, to } = this.view.state.selection.main;
    return { from, to };
  }

  get composing(): boolean {
    return this.view.composing;
  }

  select(from: number, to = from): void {
    this.view.dispatch({ selection: EditorSelection.single(from, to) });
  }

  /** 把 [from, to) 换成 insert，换完选中 [selFrom, selTo)；进撤销历史，⌘Z 能撤回 */
  replace(from: number, to: number, insert: string, selFrom: number, selTo = selFrom): void {
    this.view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.single(selFrom, selTo),
      userEvent: "input",
      scrollIntoView: false,
    });
  }

  /**
   * 整段换成 next，换完选中 [selFrom, selTo)。只替换前后不同的那一段：撤销粒度对，没动到的装饰也不用重建
   */
  setText(next: string, selFrom: number, selTo = selFrom): void {
    const cur = this.text;
    let start = 0;
    while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
    let end = 0;
    while (end < cur.length - start && end < next.length - start && cur[cur.length - 1 - end] === next[next.length - 1 - end]) end++;
    this.replace(start, cur.length - end, next.slice(start, next.length - end), selFrom, selTo);
  }

  /** 某个位置在屏幕上的矩形（跟着光标弹补全列表、格式栏用） */
  coordsAt(pos: number): { left: number; right: number; top: number; bottom: number } | null {
    return this.view.coordsAtPos(pos);
  }

  /** 选中文字在屏幕上的范围；没选或编辑框没焦点时为 null */
  selectionRect(): { left: number; right: number; top: number; bottom: number; width: number } | null {
    const { from, to, empty } = this.view.state.selection.main;
    if (empty || !this.view.hasFocus) return null;
    const a = this.view.coordsAtPos(from, 1);
    const b = this.view.coordsAtPos(to, -1);
    if (!a || !b) return null;
    const left = Math.min(a.left, b.left);
    const right = Math.max(a.right, b.right);
    return { left, right, top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), width: right - left };
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.view.destroy();
    this.host.classList.remove("mm-has-editor");
  }
}
