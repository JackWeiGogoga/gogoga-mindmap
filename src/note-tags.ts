/**
 * 「在笔记里隐藏格式标签」（设置，默认关）：Markdown 笔记的实时预览里，把脑图写进文字的格式标签
 * （文字颜色 <span style="color:…">、荧光笔 <mark style="background:…">、<mark>、下划线 <u>）藏起来，
 * 直接显示成效果，和脑图节点编辑框里一样。认标签的规则和节点渲染共用（formatSpans），脑图里能显示的这里都能藏。
 * 源码模式、代码块、行内代码、公式、frontmatter 里不动（行内代码、公式由 formatSpans 的分词自然跳过）。藏起来的标签是原子范围，删字、打字只动看得见的字，标签保持成对
 */

import { EditorSelection, EditorState, type Extension, type Range, Transaction, findClusterBreak } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
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
        for (const span of lineSpans(line.from, line.text)) {
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
      if (u.docChanged || u.viewportChanged || livePreview(u.state) !== livePreview(u.startState)) {
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
  return [tagsPlugin, keepTagsPaired];
}
