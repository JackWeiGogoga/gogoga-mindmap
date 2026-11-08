/**
 * 画布上的行内编辑框（节点文字、标注、概要、关联线文字、外框标题）：CodeMirror 6。
 * Obsidian 自己的编辑器就是它，插件用 Obsidian 带的那份（构建时不打包，见 esbuild.config.mjs）。
 * 底层永远是源码，格式只在显示上藏起标记符、直接显示效果（哪些段见 live-preview.ts）；
 * 输入法组字、撤销、光标跳过藏起来的字符都交给 CodeMirror。
 */

import { EditorSelection, EditorState, Facet, findClusterBreak, Prec, Transaction, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, placeholder, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { dropEmptyColors } from "./format";
import { formatSpans, guardHiddenMarks, revealed, type FormatSpan, type TextEdit } from "./live-preview";
import { isWebUrl, linkDestination, pastedLink } from "./paste-link";

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
  /**
   * 没选中文字时粘贴网页地址：给了就去抓标题，抓到后把刚粘进去的地址换成 [标题](网址)。
   * 返回 null 表示不抓（设置里关着）
   */
  linkTitle?: (url: string) => Promise<string | null> | null;
  /** 一次输入落到文字之前：返回 true 表示宿主自己处理了（比如选中文字打【包成链接） */
  onInput?: (from: number, to: number, text: string) => boolean;
  /** 文字变了（输入法组字结束时也会来一次）。在这次更新结束后才调用，回调里可以接着改文字 */
  onChange?: () => void;
  /** 文字或选区变了；同样在更新结束后调用 */
  onSelect?: () => void;
  /** 焦点离开编辑框（窗口失焦也算，和原来一样就此提交） */
  onBlur?: () => void;
  /** 光标挨着格式时也不露出 ** == 这些标记（设置里的开关，默认关） */
  hideSyntax?: boolean;
}

/** 这个编辑框里格式标记始终藏着 */
const hideAll = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

/** 现在藏着标记的那几段 */
function hiddenSpans(state: EditorState): FormatSpan[] {
  const all = state.facet(hideAll);
  return formatSpans(state.doc.toString()).filter((s) => all || !revealed(s, state.selection.ranges));
}

/** 删字、打字碰到藏着的标记时只动看得见的字（规则见 guardHiddenMarks） */
const keepMarksPaired = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input.type") || tr.isUserEvent("input.paste"))) return tr;
  const st = tr.startState;
  if (st.selection.ranges.length > 1) return tr;
  const hidden = hiddenSpans(st);
  if (!hidden.length) return tr;
  const edits: TextEdit[] = [];
  tr.changes.iterChanges((from, to, _a, _b, ins) => edits.push({ from, to, insert: ins.toString() }));
  const text = st.doc.toString();
  const backward = tr.isUserEvent("delete.backward") ? true : tr.isUserEvent("delete.forward") ? false : null;
  const fixed = guardHiddenMarks(
    text,
    hidden,
    edits,
    backward,
    (p) => findClusterBreak(text, p, false),
    (p) => findClusterBreak(text, p, true),
  );
  if (!fixed) return tr;
  if (!fixed.length) return [];
  const changes = st.changes(fixed);
  const first = fixed[0];
  return {
    changes,
    selection: EditorSelection.cursor(changes.mapPos(first.from, -1) + first.insert.length),
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: tr.scrollIntoView,
  };
});

const HIDE = Decoration.replace({});
const SYNTAX = Decoration.mark({ class: "mm-ed-syntax" });
const KIND_MARKS = {
  strong: Decoration.mark({ class: "mm-ed-strong" }),
  em: Decoration.mark({ class: "mm-ed-em" }),
  mark: Decoration.mark({ class: "mm-ed-mark" }),
  del: Decoration.mark({ class: "mm-ed-del" }),
  code: Decoration.mark({ class: "mm-ed-code" }),
  u: Decoration.mark({ class: "mm-ed-u" }),
};

/** 颜色值来自 COLOR_OPEN_SRC 的匹配（十六进制、颜色名、rgba(数字)），放进 style 是安全的 */
function contentMark(span: FormatSpan): Decoration {
  if (span.kind === "color") return Decoration.mark({ attributes: { style: `color: ${span.color}` } });
  if (span.highlight) return Decoration.mark({ class: "mm-ed-mark", attributes: { "data-highlight": span.highlight } });
  if (span.kind === "bg") return Decoration.mark({ class: "mm-ed-mark", attributes: { style: `background: ${span.color}` } });
  return KIND_MARKS[span.kind];
}

function build(state: EditorState): { deco: DecorationSet; atomic: DecorationSet } {
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const all = state.facet(hideAll);
  for (const span of formatSpans(state.doc.toString())) {
    deco.push(contentMark(span).range(span.innerFrom, span.innerTo));
    if (!all && revealed(span, state.selection.ranges)) {
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
  private readonly linkTitle: InlineEditorOptions["linkTitle"];

  constructor(
    readonly host: HTMLElement,
    opts: InlineEditorOptions,
  ) {
    const { text } = opts;
    this.linkTitle = opts.linkTitle;
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
                if (opts.onPaste?.(ev) || this.pasteLink(ev)) {
                  ev.preventDefault();
                  return true;
                }
                return false;
              },
            }),
          ),
          EditorView.inputHandler.of((_view, from, to, insert) => !!opts.onInput?.(from, to, insert)),
          history(),
          // 回车归宿主（提交）；能换行的用 Shift+Enter
          keymap.of([...(opts.multiline ? [{ key: "Shift-Enter", run: insertNewline }] : []), ...historyKeymap, ...defaultKeymap.filter((b) => b.key !== "Enter")]),
          EditorView.lineWrapping,
          livePreview,
          hideAll.of(!!opts.hideSyntax),
          keepMarksPaired,
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

  /** 粘贴网址或本地路径：选中了文字就包成链接；没选中、能抓标题的先照常粘上，标题到了再换。处理了返回 true */
  private pasteLink(ev: ClipboardEvent): boolean {
    const clip = ev.clipboardData?.getData("text/plain") ?? "";
    const view = this.view;
    const { from, to } = view.state.selection.main;
    if (from !== to) {
      const link = pastedLink(view.state.sliceDoc(from, to), clip);
      if (!link) return false;
      view.dispatch({ changes: { from, to, insert: link }, selection: { anchor: from + link.length }, userEvent: "input.paste" });
      return true;
    }
    if (!isWebUrl(clip)) return false;
    const url = clip.trim();
    const pending = this.linkTitle?.(url);
    if (!pending) return false;
    view.dispatch({ changes: { from, insert: url }, selection: { anchor: from + url.length }, userEvent: "input.paste" });
    void pending.then((title) => {
      if (!title || this.destroyed) return;
      // 等标题的这一会儿可能又打了字：地址还在原处就换原处，否则找文字里唯一的那一处
      const doc = this.view.state.doc.toString();
      const at = doc.slice(from, from + url.length) === url ? from : doc.indexOf(url);
      if (at < 0 || (at !== from && doc.indexOf(url, at + 1) >= 0)) return;
      const link = `[${title}](${linkDestination(url) ?? url})`;
      const sel = this.view.state.selection.main;
      const end = at + url.length;
      // 光标在地址后面的跟着挪，换完还在原来那个字后面
      const shift = (p: number) => (p >= end ? p + link.length - url.length : p);
      this.view.dispatch({
        changes: { from: at, to: end, insert: link },
        selection: { anchor: shift(sel.anchor), head: shift(sel.head) },
        userEvent: "input.paste",
      });
    });
    return true;
  }

  /** 拿去保存的文字：颜色标签编辑时藏着，把彩色字整个删掉会留下看不见的空标签，这里去掉 */
  get savedText(): string {
    return dropEmptyColors(this.text);
  }

  /** 主选区 */
  get selection(): { from: number; to: number } {
    const { from, to } = this.view.state.selection.main;
    return { from, to };
  }

  /**
   * 主选区去掉两头藏起来的标记符：用户看见选中了哪几个字，就是哪几个字。
   * 从末尾往回选很容易带上看不见的 </span> 或 **，拿去上格式会把标签弄交错
   */
  get visibleSelection(): { from: number; to: number } {
    let { from, to } = this.selection;
    const hidden = this.view.plugin(livePreview)?.atomic;
    if (from === to || !hidden) return { from, to };
    for (let moved = true; moved && from < to; ) {
      moved = false;
      hidden.between(from, to, (a, b) => {
        if (a === from && b <= to) {
          from = b;
          moved = true;
          return false;
        }
        return undefined;
      });
    }
    for (let moved = true; moved && from < to; ) {
      moved = false;
      hidden.between(from, to, (a, b) => {
        if (b === to && a >= from) {
          to = a;
          moved = true;
          return false;
        }
        return undefined;
      });
    }
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
