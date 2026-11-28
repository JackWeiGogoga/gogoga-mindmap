/**
 * （和 gogoga-table 的 src/core/cm-format.ts 是同一份，表格插件那份由脑图同步过去）
 * CodeMirror 编辑框里的「所见即所得」：加粗、斜体、高亮、颜色、下划线……直接显示效果，
 * 标记符藏起来（Markdown 记号光标挨着时露出，HTML 颜色标签一直藏着，规则见 live-preview.ts），
 * 删字、打字碰到藏着的标记时保持成对。脑图的节点编辑框和表格的格子编辑框共用
 */

import { EditorSelection, EditorState, Facet, findClusterBreak, StateEffect, Transaction, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { balancedSlice, formatBreak, formatSpans, guardHiddenMarks, revealed, type FormatSpan, type TextEdit } from "./live-preview";

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
/** 装饰用的类名前缀：脑图是 mm-ed，表格是 ggt-ed（各自的样式表给它们上样式） */
const prefixFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? "mm-ed" });
const marksCache = new Map<string, { syntax: Decoration; kinds: Record<"strong" | "em" | "mark" | "del" | "code" | "u", Decoration> }>();
function marksFor(prefix: string) {
  let m = marksCache.get(prefix);
  if (!m) {
    const d = (k: string) => Decoration.mark({ class: `${prefix}-${k}` });
    m = { syntax: d("syntax"), kinds: { strong: d("strong"), em: d("em"), mark: d("mark"), del: d("del"), code: d("code"), u: d("u") } };
    marksCache.set(prefix, m);
  }
  return m;
}

const linkMarks = new Map<string, Decoration>();
function linkMark(prefix: string): Decoration {
  let d = linkMarks.get(prefix);
  if (!d) linkMarks.set(prefix, (d = Decoration.mark({ class: `${prefix}-link` })));
  return d;
}

/** 颜色值来自 COLOR_OPEN_SRC 的匹配（十六进制、颜色名、rgba(数字)），放进 style 是安全的 */
function contentMark(span: FormatSpan, prefix: string): Decoration {
  if (span.kind === "color") return Decoration.mark({ attributes: { style: `color: ${span.color}` } });
  if (span.highlight) return Decoration.mark({ class: `${prefix}-mark`, attributes: { "data-highlight": span.highlight } });
  if (span.kind === "bg") return Decoration.mark({ class: `${prefix}-mark`, attributes: { style: `background: ${span.color}` } });
  return marksFor(prefix).kinds[span.kind];
}

/** 编辑框里的一个链接：[a, b) 是方括号、圆括号这些记号（变淡），[textFrom, textTo) 是链接文字（链接色） */
export interface LinkRange {
  syntax: [number, number][];
  textFrom: number;
  textTo: number;
}

/**
 * 编辑框里的链接，和 Obsidian 编辑器一样显示成链接色（B 站 FORMORE：输入 [[ 后打的字是白的，官方是紫的）：
 * [[笔记]]、[[笔记|别名]]、![[图片]]、[文字](网址)；还有光标前没写完的 [[…（正在打、补全列表开着的那段）。
 * 行内代码里的不算
 */
export function linkRanges(text: string, caret: number | null, code: readonly { from: number; to: number }[] = []): LinkRange[] {
  const out: LinkRange[] = [];
  const inCode = (p: number) => code.some((c) => p >= c.from && p < c.to);
  const re = /!?\[\[([^[\]\n]*)\]\]|\[([^[\]\n]+)\]\(([^()\s]+)\)/g;
  let lastEnd = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    const a = m.index;
    const b = a + m[0].length;
    if (inCode(a)) continue;
    lastEnd = Math.max(lastEnd, b);
    if (m[1] !== undefined) {
      const open = m[0].startsWith("!") ? 3 : 2;
      out.push({ syntax: [[a, a + open], [b - 2, b]], textFrom: a + open, textTo: b - 2 });
    } else {
      const labelEnd = a + 1 + m[2].length;
      out.push({ syntax: [[a, a + 1], [labelEnd, b]], textFrom: a + 1, textTo: labelEnd });
    }
  }
  if (caret !== null) {
    // 没写完的 [[：光标前最后一个 [[ 后面到光标之间没有 ]]、不换行，也不在已经认出来的链接里
    const before = text.slice(0, caret);
    const open = before.lastIndexOf("[[");
    if (open >= lastEnd && open >= 0 && !inCode(open)) {
      const q = before.slice(open + 2);
      if (!q.includes("]]") && !q.includes("\n") && !out.some((l) => open >= l.syntax[0][0] && open < l.syntax[l.syntax.length - 1][1])) {
        const from = open > 0 && text[open - 1] === "!" ? open - 1 : open;
        out.push({ syntax: [[from, open + 2]], textFrom: open + 2, textTo: caret });
      }
    }
  }
  return out;
}

function build(state: EditorState): { deco: DecorationSet; atomic: DecorationSet } {
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const all = state.facet(hideAll);
  const prefix = state.facet(prefixFacet);
  const SYNTAX = marksFor(prefix).syntax;
  const text = state.doc.toString();
  const spans = formatSpans(text);
  const sel = state.selection.main;
  const LINK = linkMark(prefix);
  for (const l of linkRanges(text, sel.empty ? sel.head : null, spans.filter((x) => x.kind === "code"))) {
    for (const [a, b] of l.syntax) if (b > a) deco.push(SYNTAX.range(a, b));
    if (l.textTo > l.textFrom) deco.push(LINK.range(l.textFrom, l.textTo));
  }
  for (const span of spans) {
    deco.push(contentMark(span, prefix).range(span.innerFrom, span.innerTo));
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

/** 松开鼠标后按最后的选区重新决定标记的显隐 */
const dragEnded = StateEffect.define<null>();

const livePreview = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    atomic: DecorationSet;
    /**
     * 按着鼠标拖选中。这期间选区变了也不改标记的显隐（#45）：拖到刚好把一段 **加粗** 整个包住时标记会藏起来，
     * 后面的字往左挪，CodeMirror 按鼠标位置重算选区又没包住、标记露出来、字又挪回去……一直来回闪。松手再更新
     */
    dragging = false;
    readonly onDown = (ev: MouseEvent) => {
      if (ev.button === 0) this.dragging = true;
    };
    readonly onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // 松手这一下不在 CodeMirror 的更新流程里：另起一次空的更新，让显隐跟上最后的选区
      queueMicrotask(() => this.view.dom.isConnected && this.view.dispatch({ effects: dragEnded.of(null) }));
    };
    constructor(readonly view: EditorView) {
      ({ deco: this.deco, atomic: this.atomic } = build(view.state));
      view.contentDOM.addEventListener("mousedown", this.onDown);
      view.dom.ownerDocument.addEventListener("mouseup", this.onUp, true);
    }
    update(update: ViewUpdate) {
      const ended = update.transactions.some((tr) => tr.effects.some((e) => e.is(dragEnded)));
      if (update.docChanged || ended || (update.selectionSet && !this.dragging)) ({ deco: this.deco, atomic: this.atomic } = build(update.state));
    }
    destroy() {
      this.view.contentDOM.removeEventListener("mousedown", this.onDown);
      this.view.dom.ownerDocument.removeEventListener("mouseup", this.onUp, true);
    }
  },
  {
    decorations: (v) => v.deco,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

/** prefix：装饰的类名前缀；hideAllSyntax：Markdown 记号也一直藏着（脑图设置「隐藏 Markdown 标记」） */
export function formatPreview(prefix: string, hideAllSyntax: boolean): Extension[] {
  return [prefixFacet.of(prefix), hideAll.of(hideAllSyntax), livePreview, keepMarksPaired, balancedCopy];
}

/** 复制、剪切：选中的那段格式补完整（见 balancedSlice），粘到别处还是一段完整的带格式文字 */
const balancedCopy = EditorView.domEventHandlers({
  copy: (ev, view) => copySel(ev, view, false),
  cut: (ev, view) => copySel(ev, view, true),
});

function copySel(ev: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to || !ev.clipboardData) return false;
  const text = view.state.doc.toString();
  const out = balancedSlice(text, from, to);
  if (out === text.slice(from, to)) return false;
  ev.preventDefault();
  ev.clipboardData.setData("text/plain", out);
  if (cut) view.dispatch({ changes: { from, to }, userEvent: "delete.cut" });
  return true;
}

/** 在带格式的文字里换行：先收尾、换行、再接上（见 breakInsideFormats）。Shift+Enter 用它 */
export function insertFormatBreak(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const b = formatBreak(text.slice(0, from) + text.slice(to), from);
  // 换行挪到了标签外面：选区先删掉，再在挪过去的位置插（位置都按删掉选区之后的文字算）
  const changes = from === to ? [{ from: b.pos, insert: b.insert }] : [{ from, to }, { from: b.pos <= from ? b.pos : b.pos + (to - from), insert: b.insert }];
  view.dispatch({ changes, selection: { anchor: b.pos + b.insert.length }, userEvent: "input" });
  return true;
}

/**
 * 主选区去掉两头藏起来的标记符：用户看见选中了哪几个字，就是哪几个字。
 * 从末尾往回选很容易带上看不见的 </span> 或 **，拿去上格式会把标签弄交错
 */
export function visibleSelection(view: EditorView): { from: number; to: number } {
  let { from, to } = view.state.selection.main;
  const hidden = view.plugin(livePreview)?.atomic;
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
