/** 「笔记里的脑图节点标记」的显示部分：藏着的标记画成一个小灰点（悬停看原文，点一下露出原文），或者什么都不画（规则见 note-markers-core） */

import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { allHidden, markerGuards } from "./note-markers-core";

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

/** 完全隐藏时也留一个看不见的零宽元素：标记那里什么 DOM 都没有时，输入法在行尾组字会把拼音留在正文里 */
class HiddenMarker extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    return createSpan({ cls: "mm-note-marker-hidden" });
  }
  ignoreEvent(): boolean {
    return true;
  }
}
const NOTHING = Decoration.replace({ widget: new HiddenMarker() });

function build(state: EditorState, mode: "dot" | "hide", active: (s: EditorState) => boolean): DecorationSet {
  if (!active(state)) return Decoration.none;
  const deco: Range<Decoration>[] = [];
  for (const r of allHidden(state)) {
    const raw = state.doc.sliceString(r.from, r.to).trim();
    deco.push((mode === "hide" ? NOTHING : Decoration.replace({ widget: new MarkerDot(raw, r.inner - r.from) })).range(r.from, r.to));
  }
  return Decoration.set(deco, true);
}

/** mode：dot 画成小圆点（点一下露出原文）；hide 什么都不画。两种都一样防改坏。
 * 标题下面的标记行要连换行一起藏，跨行的替换只能由 StateField 提供（ViewPlugin 不行） */
export function noteMarkersExtension(mode: "dot" | "hide", active: (s: EditorState) => boolean): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, mode, active),
    update: (deco, tr) => (tr.docChanged || tr.selection || active(tr.state) !== active(tr.startState) ? build(tr.state, mode, active) : deco),
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });
  return [field, markerGuards(active)];
}
