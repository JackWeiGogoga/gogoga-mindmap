/** 「在笔记里隐藏脑图节点标记」的显示部分：藏着的标记画成一个小灰点，悬停看原文，点一下露出原文（规则见 note-markers-core） */

import { type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { fencedLines } from "./fence";
import { markerGuards, markerInLine, revealedMarker } from "./note-markers-core";

class MarkerDot extends WidgetType {
  constructor(
    readonly raw: string,
    readonly innerOffset: number,
  ) {
    super();
  }
  eq(o: MarkerDot): boolean {
    return o.raw === this.raw && o.innerOffset === this.innerOffset;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = createSpan({ cls: "mm-note-marker" });
    el.setAttribute("aria-label", this.raw.trim());
    el.title = this.raw.trim();
    el.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // 光标放进开头的 %% 后面：标记露出原文
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: pos + this.innerOffset } });
      view.focus();
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function build(view: EditorView, active: (s: EditorState) => boolean): { deco: DecorationSet; atomic: DecorationSet } {
  const deco: Range<Decoration>[] = [];
  const st = view.state;
  if (active(st)) {
    const doc = st.doc;
    const ranges = view.visibleRanges;
    const skip = ranges.length ? fencedLines((i) => doc.line(i + 1).text, doc.lineAt(ranges[ranges.length - 1].to).number) : [];
    for (const { from, to } of ranges) {
      for (let pos = from; pos <= to; ) {
        const line = doc.lineAt(pos);
        pos = line.to + 1;
        if (skip[line.number - 1]) continue;
        const r = markerInLine(line.text, line.from);
        if (!r || revealedMarker(r, st.selection)) continue;
        const raw = doc.sliceString(r.from, r.to);
        deco.push(Decoration.replace({ widget: new MarkerDot(raw, r.inner - r.from) }).range(r.from, r.to));
      }
    }
  }
  const set = Decoration.set(deco, true);
  return { deco: set, atomic: set };
}

export function noteMarkersExtension(active: (s: EditorState) => boolean): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      deco: DecorationSet;
      atomic: DecorationSet;
      constructor(view: EditorView) {
        ({ deco: this.deco, atomic: this.atomic } = build(view, active));
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || active(u.state) !== active(u.startState)) ({ deco: this.deco, atomic: this.atomic } = build(u.view, active));
      }
    },
    {
      decorations: (v) => v.deco,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
    },
  );
  return [plugin, markerGuards(active)];
}
