/**
 * 「在笔记里隐藏格式标签」（设置，默认关）：Markdown 笔记的实时预览里，把脑图写进文字的格式标签
 * （文字颜色 <span style="color:…">、荧光笔 <mark style="background:…">、<mark>、下划线 <u>）藏起来，
 * 直接显示成效果，和脑图节点编辑框里一样。认标签的规则和节点渲染共用（formatSpans），脑图里能显示的这里都能藏。
 * 源码模式、代码块、行内代码、公式、frontmatter 里不动（行内代码、公式由 formatSpans 的分词自然跳过）。藏起来的标签是原子范围，删字、打字只动看得见的字，标签保持成对
 *
 * 光标不在这段标签里时：Obsidian 自己会把整段行内 HTML 换成一块原样显示的 HTML（cm-html-embed），里面的 **加粗**、==高亮== 不解析，
 * 星号原样露出来。这里用最高优先级、和它同一范围的部件盖过去，按脑图节点的渲染（renderInline）画出来，标签里的 Markdown 也显示成效果。
 * 光标碰到这段（和 Obsidian 一样）就不画部件，露出源码，标签照旧藏着、只显示文字
 */

import { EditorSelection, EditorState, type Extension, Prec, type Range, Transaction, findClusterBreak } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField, finishRenderMath, renderMath } from "obsidian";
import { renderInline } from "./inline";
import { fencedLines } from "./fence";
import { formatSpans, guardHiddenMarks, type FormatSpan, type TextEdit } from "./live-preview";

const HIDE = Decoration.replace({});
const U = Decoration.mark({ class: "mm-note-u" });
const MARK = Decoration.mark({ class: "mm-note-mark" });

const livePreview = (state: EditorState) => state.field(editorLivePreviewField, false) ?? false;

/** 第 1～n 行里哪几行在代码块、公式块、frontmatter 里（下标是行号 - 1） */
function fenced(state: EditorState, upToLine: number): boolean[] {
  const doc = state.doc;
  return fencedLines((i) => doc.line(i + 1).text, Math.min(upToLine, doc.lines));
}

/** 这一行里藏着标签的几段（只要 HTML 标签那几种；** == 这些 Markdown 标记交给 Obsidian 自己） */
function lineSpans(lineFrom: number, text: string): FormatSpan[] {
  if (!text.includes("<")) return [];
  return formatSpans(text)
    .filter((s) => s.html)
    .map((s) => ({ ...s, from: s.from + lineFrom, to: s.to + lineFrom, innerFrom: s.innerFrom + lineFrom, innerTo: s.innerTo + lineFrom }));
}

/** 颜色值来自 COLOR_OPEN_SRC 的匹配（十六进制、颜色名、rgba(数字)），放进 style 是安全的 */
function contentMark(span: FormatSpan): Decoration {
  if (span.kind === "color") return Decoration.mark({ attributes: { style: `color: ${span.color}` } });
  if (span.kind === "bg") return Decoration.mark({ class: "mm-note-mark", attributes: { style: `background: ${span.color}` } });
  return span.kind === "u" ? U : MARK;
}

/** 光标不在里面的一整段标签：按脑图节点的样子画出来（颜色、荧光笔、下划线连同里面的加粗、高亮、链接） */
class TagsWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(other: TagsWidget): boolean {
    return other.src === this.src;
  }
  toDOM(): HTMLElement {
    const el = createSpan({ cls: "mm-note-tags" });
    renderInline(el, this.src, {
      renderMath: (tex) => {
        const m = renderMath(tex, false);
        void finishRenderMath();
        return m;
      },
    });
    return el;
  }
  /** 点它：交给编辑器放光标，光标进到这段后露出源码 */
  ignoreEvent(): boolean {
    return false;
  }
}

/** 选区碰到 [from, to]（含两头）：和 Obsidian 露出行内 HTML 源码的条件一样 */
function touched(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function build(view: EditorView): { deco: DecorationSet; atomic: DecorationSet } {
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  if (livePreview(view.state)) {
    const doc = view.state.doc;
    const ranges = view.visibleRanges;
    const skip = ranges.length ? fenced(view.state, doc.lineAt(ranges[ranges.length - 1].to).number) : [];
    for (const { from, to } of ranges) {
      for (let pos = from; pos <= to; ) {
        const line = doc.lineAt(pos);
        if (skip[line.number - 1]) {
          pos = line.to + 1;
          continue;
        }
        const spans = lineSpans(line.from, line.text);
        // 最外层的标签段（不在别的标签段里面）：光标不在里面就整段画成部件，里面套着的标签一起交给它
        const drawn: FormatSpan[] = [];
        for (const span of spans) {
          if (spans.some((o) => o !== span && o.from <= span.from && o.to >= span.to && (o.from < span.from || o.to > span.to))) continue;
          if (touched(view, span.from, span.to)) continue;
          drawn.push(span);
          deco.push(Decoration.replace({ widget: new TagsWidget(view.state.sliceDoc(span.from, span.to)) }).range(span.from, span.to));
        }
        for (const span of spans) {
          if (drawn.some((d) => d.from <= span.from && d.to >= span.to)) continue;
          deco.push(contentMark(span).range(span.innerFrom, span.innerTo));
          const marks = [HIDE.range(span.from, span.innerFrom), HIDE.range(span.innerTo, span.to)];
          deco.push(...marks);
          atomic.push(...marks);
        }
        pos = line.to + 1;
      }
    }
  }
  return { deco: Decoration.set(deco, true), atomic: Decoration.set(atomic, true) };
}

const tagsPlugin = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ deco: this.deco, atomic: this.atomic } = build(view));
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || livePreview(u.state) !== livePreview(u.startState)) {
        ({ deco: this.deco, atomic: this.atomic } = build(u.view));
      }
    }
  },
  {
    decorations: (v) => v.deco,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

/** 删字、打字碰到藏着的标签时只动看得见的字（规则见 guardHiddenMarks）；只管改动都在同一行里的情况 */
const keepTagsPaired = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input.type") || tr.isUserEvent("input.paste"))) return tr;
  const st = tr.startState;
  if (st.selection.ranges.length > 1 || !livePreview(st)) return tr;
  const edits: TextEdit[] = [];
  tr.changes.iterChanges((from, to, _a, _b, ins) => edits.push({ from, to, insert: ins.toString() }));
  const line = st.doc.lineAt(edits[0].from);
  if (edits.some((e) => e.from < line.from || e.to > line.to)) return tr;
  const hidden = lineSpans(line.from, line.text);
  if (!hidden.length || fenced(st, line.number)[line.number - 1]) return tr;
  const off = line.from;
  const local = (s: FormatSpan): FormatSpan => ({ ...s, from: s.from - off, to: s.to - off, innerFrom: s.innerFrom - off, innerTo: s.innerTo - off });
  const text = line.text;
  const backward = tr.isUserEvent("delete.backward") ? true : tr.isUserEvent("delete.forward") ? false : null;
  const fixed = guardHiddenMarks(
    text,
    hidden.map(local),
    edits.map((e) => ({ from: e.from - off, to: e.to - off, insert: e.insert })),
    backward,
    (p) => findClusterBreak(text, p, false),
    (p) => findClusterBreak(text, p, true),
  );
  if (!fixed) return tr;
  if (!fixed.length) return [];
  const changes = st.changes(fixed.map((e) => ({ from: e.from + off, to: e.to + off, insert: e.insert })));
  const first = fixed[0];
  return {
    changes,
    selection: EditorSelection.cursor(changes.mapPos(first.from + off, -1) + first.insert.length),
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: tr.scrollIntoView,
  };
});

export function noteTagsExtension(): Extension {
  // 最高优先级：和 Obsidian 的行内 HTML 部件同一范围时，画的是我们的
  return [Prec.highest(tagsPlugin), keepTagsPaired];
}
