/**
 * 「在笔记里显示节点颜色」的纯逻辑（不依赖 Obsidian，单测直接跑）：
 * 哪几行带节点颜色（行尾 %%red%%，或标题下面单独一行的 %%red%%），颜色铺在这行的哪一段文字上，
 * 阅读视图里一段（section）的第几个列表项、标题对应哪种颜色
 */

import { Text } from "@codemirror/state";
import { fencedLines } from "./fence";
import { COLOR_NAMES, splitMarker } from "./markdown";
import { lineContentRange } from "./note-format-core";

export interface NodeColor {
  /** 命名颜色（red…gray）或 #hex */
  color: string;
  named: boolean;
}

const LIST_LINE = /^\s*(?:>\s?)*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const HEADING_LINE = /^\s*#{1,6}(?:[ \t]|$)/;
const BLOCK_ID = /\s+\^[A-Za-z0-9-]+\s*$/;

export function isNamedColor(c: string): boolean {
  return (COLOR_NAMES as readonly string[]).includes(c);
}

/** 文档里每一行（行号从 1 数）带的节点颜色；代码块、公式块、frontmatter 里的不算 */
export function lineColors(doc: Text, upTo = doc.lines): Map<number, NodeColor> {
  const out = new Map<number, NodeColor>();
  const last = Math.min(upTo, doc.lines);
  // 标题的标记行在下一行：多看一行
  const fenced = fencedLines((i) => doc.line(i + 1).text, Math.min(last + 1, doc.lines));
  for (let n = 1; n <= last; n++) {
    if (fenced[n - 1]) continue;
    const text = doc.line(n).text;
    // 标题下面单独一行的标记：颜色算上一行（标题）的
    if (HEADING_LINE.test(text) && n < doc.lines && !fenced[n]) {
      const next = doc.line(n + 1).text.trim();
      if (next.startsWith("%%") && splitMarker(next).text === "") {
        const color = splitMarker(next).marker.color;
        if (color) out.set(n, { color, named: isNamedColor(color) });
      }
    }
    if (text.trim().startsWith("%%")) continue;
    // 行尾标记（后面可能还跟着 ^块编号）
    const body = text.replace(BLOCK_ID, "");
    if (!body.includes("%%")) continue;
    const sm = splitMarker(body);
    if (sm.text !== body.trimEnd() && sm.marker.color) out.set(n, { color: sm.marker.color, named: isNamedColor(sm.marker.color) });
  }
  return out;
}

/** 实时预览里要铺颜色的几段：[from, to) 是这行去掉列表符号、#、任务框、行尾标记以后的文字 */
export function colorRanges(doc: Text, upTo = doc.lines): { from: number; to: number; color: NodeColor }[] {
  const out: { from: number; to: number; color: NodeColor }[] = [];
  for (const [n, color] of lineColors(doc, upTo)) {
    const line = doc.line(n);
    const [s, e] = lineContentRange(line.text);
    if (s < e) out.push({ from: line.from + s, to: line.from + e, color });
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * 阅读视图的一段（行号 lineStart～lineEnd，从 0 数）里带颜色的标题、列表项：
 * 按它在这段里是第几个标题 / 第几个列表项记下来，渲染出来的元素按同样的顺序对上
 */
export function sectionColors(fullText: string, lineStart: number, lineEnd: number): { headings: Map<number, NodeColor>; items: Map<number, NodeColor> } {
  const doc = Text.of(fullText.split("\n"));
  const colors = lineColors(doc, Math.min(lineEnd + 1, doc.lines));
  const headings = new Map<number, NodeColor>();
  const items = new Map<number, NodeColor>();
  let h = 0;
  let li = 0;
  for (let i = lineStart; i <= lineEnd && i < doc.lines; i++) {
    const text = doc.line(i + 1).text;
    const c = colors.get(i + 1);
    if (HEADING_LINE.test(text)) {
      if (c) headings.set(h, c);
      h++;
    } else if (LIST_LINE.test(text)) {
      if (c) items.set(li, c);
      li++;
    }
  }
  return { headings, items };
}

/**
 * 按文字看这篇笔记是不是脑图笔记（frontmatter 里 mindmap 不是空、不是 false）。
 * 刚建好、刚改了属性的笔记，Obsidian 的元数据缓存还没更新，编辑器里的判断不能只靠缓存
 */
export function textIsMindMap(text: string): boolean {
  if (!text.startsWith("---")) return false;
  const end = text.indexOf("\n---", 3);
  const fm = end < 0 ? "" : text.slice(3, end);
  const m = /^mindmap:[ \t]*(.*?)[ \t]*$/m.exec(fm);
  if (!m) return false;
  const v = m[1].replace(/^["']|["']$/g, "");
  return v.length > 0 && v !== "false";
}
