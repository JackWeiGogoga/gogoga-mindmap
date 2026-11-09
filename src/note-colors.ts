/**
 * 「在笔记里显示节点颜色」（设置，默认关）：脑图笔记里节点的颜色（%%red%%、%%#ff8800%%）存在注释里，Markdown 本来看不到。
 * 打开后实时预览和阅读视图里，带颜色的标题、列表项的文字铺一层同色的淡底（导出 PDF 走阅读视图，也带上）。
 * 只显示，不改文件；改颜色还是在脑图里改
 */

import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { MarkdownPostProcessorContext } from "obsidian";
import { colorRanges, sectionColors, type NodeColor } from "./note-colors-core";

function attrs(c: NodeColor): Record<string, string> {
  return c.named ? { class: "mm-note-node-color", "data-color": c.color } : { class: "mm-note-node-color", style: `--mm-note-color: ${c.color}` };
}

/** 实时预览：active(state) 为真（实时预览、脑图笔记）时铺颜色 */
export function noteColorsExtension(active: (view: EditorView) => boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable) || u.transactions.some((t) => t.reconfigured))
          this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        if (!active(view)) return b.finish();
        const doc = view.state.doc;
        const last = view.visibleRanges.length ? doc.lineAt(view.visibleRanges[view.visibleRanges.length - 1].to).number : doc.lines;
        const first = view.visibleRanges.length ? view.visibleRanges[0].from : 0;
        for (const r of colorRanges(doc, last)) {
          if (r.to < first) continue;
          b.add(r.from, r.to, Decoration.mark({ attributes: attrs(r.color) }));
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** 把元素自己的文字（不含子列表）包进一个上色的 span */
function paint(el: HTMLElement, c: NodeColor): void {
  if (el.querySelector(":scope > .mm-note-node-color")) return;
  const doc = el.ownerDocument;
  const span = doc.createElement("span");
  const a = attrs(c);
  span.className = a.class;
  if (a["data-color"]) span.dataset.color = a["data-color"];
  if (a.style) span.setAttribute("style", a.style);
  const kids = [...el.childNodes];
  // 列表项里：折叠箭头、列表符号、任务框留在外面；子列表、子块（ul/ol/div/p 以外的行内内容才包）也留在外面
  const skip = (n: ChildNode) =>
    n instanceof HTMLElement &&
    (n.matches("ul, ol, .list-collapse-indicator, .collapse-indicator, .list-bullet, input.task-list-item-checkbox, .heading-collapse-indicator, div, p, blockquote, pre, table") || n.classList.contains("mm-note-node-color"));
  const inline = kids.filter((n) => !skip(n));
  // 段落包着的列表项（松散列表 <li><p>文字</p></li>）：给第一个段落里的文字上色
  if (!inline.some((n) => (n.textContent ?? "").trim())) {
    const p = el.querySelector<HTMLElement>(":scope > p");
    if (p) paint(p, c);
    return;
  }
  // 两头的空白不包进去
  const first = inline.findIndex((n) => (n.textContent ?? "").trim());
  let last = inline.length - 1;
  while (last > first && !(inline[last].textContent ?? "").trim()) last--;
  const part = inline.slice(first, last + 1);
  part[0].before(span);
  span.append(...part);
}

/** 阅读视图：按这一段在原文里的行，找出带颜色的标题、列表项，按顺序对上渲染出来的元素 */
export function paintNoteColors(el: HTMLElement, ctx: MarkdownPostProcessorContext, isMindMap: (text: string) => boolean): void {
  const info = ctx.getSectionInfo(el);
  if (!info || !isMindMap(info.text)) return;
  const { headings, items } = sectionColors(info.text, info.lineStart, info.lineEnd);
  if (!headings.size && !items.size) return;
  if (headings.size) {
    const hs = el.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    headings.forEach((c, i) => hs[i] && paint(hs[i], c));
  }
  if (items.size) {
    const lis = el.querySelectorAll<HTMLElement>("li");
    items.forEach((c, i) => lis[i] && paint(lis[i], c));
  }
}
