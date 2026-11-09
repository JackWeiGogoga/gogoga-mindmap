/**
 * （和 gogoga-table 的 src/core/cm-format.ts 是同一份，表格插件那份由脑图同步过去）
 * CodeMirror 编辑框里的「所见即所得」：加粗、斜体、高亮、颜色、下划线……直接显示效果，
 * 标记符藏起来（Markdown 记号光标挨着时露出，HTML 颜色标签一直藏着，规则见 live-preview.ts），
 * 删字、打字碰到藏着的标记时保持成对。脑图的节点编辑框和表格的格子编辑框共用
 */

import { EditorSelection, EditorState, Facet, findClusterBreak, Transaction, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { formatSpans, guardHiddenMarks, revealed, type FormatSpan, type TextEdit } from "./live-preview";

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

/** 颜色值来自 COLOR_OPEN_SRC 的匹配（十六进制、颜色名、rgba(数字)），放进 style 是安全的 */
function contentMark(span: FormatSpan, prefix: string): Decoration {
  if (span.kind === "color") return Decoration.mark({ attributes: { style: `color: ${span.color}` } });
  if (span.highlight) return Decoration.mark({ class: `${prefix}-mark`, attributes: { "data-highlight": span.highlight } });
  if (span.kind === "bg") return Decoration.mark({ class: `${prefix}-mark`, attributes: { style: `background: ${span.color}` } });
  return marksFor(prefix).kinds[span.kind];
}

function build(state: EditorState): { deco: DecorationSet; atomic: DecorationSet } {
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const all = state.facet(hideAll);
  const prefix = state.facet(prefixFacet);
  const SYNTAX = marksFor(prefix).syntax;
  for (const span of formatSpans(state.doc.toString())) {
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

/** prefix：装饰的类名前缀；hideAllSyntax：Markdown 记号也一直藏着（脑图设置「隐藏 Markdown 标记」） */
export function formatPreview(prefix: string, hideAllSyntax: boolean): Extension[] {
  return [prefixFacet.of(prefix), hideAll.of(hideAllSyntax), livePreview, keepMarksPaired];
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
