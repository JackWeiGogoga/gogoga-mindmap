/**
 * 编辑框里的「实时预览」：算出文字里哪些段落带格式、两头的标记符在哪。
 * 规则直接用节点渲染的 TOKEN_RE，编辑时看到的效果和提交后渲染出来的一致；只认会改变文字外观的几种，
 * 链接、公式、图片、标签这些在编辑时照旧显示源码。不碰 DOM，方便单测。
 */

import { highlightColor, type HighlightColor } from "./format";
import { TOKEN_RE } from "./inline";

export type SpanKind = "strong" | "em" | "mark" | "del" | "code" | "color" | "bg";

export interface FormatSpan {
  kind: SpanKind;
  /** 整段（含两头的标记符） */
  from: number;
  to: number;
  /** 中间的文字 */
  innerFrom: number;
  innerTo: number;
  /** 文字颜色 / 荧光笔的颜色 */
  color?: string;
  /** ==🔴文字== 的高亮颜色（emoji 算在开头的标记符里） */
  highlight?: HighlightColor;
  /** 标记是 HTML 标签（颜色、<mark>）：很长，露出来会把排版整个挤开，编辑时始终藏着 */
  html?: boolean;
}

/** TOKEN_RE 里带格式的分组：分组号 → 种类、收尾标记的长度、里面能不能再套格式 */
const GROUPS: { group: number; kind: SpanKind; close: number; nested: boolean; colorGroup?: number; html?: boolean }[] = [
  { group: 10, kind: "strong", close: 2, nested: true },
  { group: 11, kind: "strong", close: 2, nested: true },
  { group: 12, kind: "code", close: 1, nested: false },
  { group: 13, kind: "del", close: 2, nested: true },
  { group: 14, kind: "mark", close: 2, nested: true },
  { group: 15, kind: "em", close: 1, nested: true },
  { group: 16, kind: "em", close: 1, nested: true },
  { group: 22, kind: "color", close: "</span>".length, nested: true, colorGroup: 21, html: true },
  { group: 24, kind: "bg", close: "</mark>".length, nested: true, colorGroup: 23, html: true },
  { group: 25, kind: "mark", close: "</mark>".length, nested: true, html: true },
];

/** 编辑框文字（换行是 \n）里所有带格式的段落，外层在前 */
export function formatSpans(text: string): FormatSpan[] {
  const out: FormatSpan[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    scan(line, offset, out);
    offset += line.length + 1;
  }
  return out;
}

function scan(text: string, offset: number, out: FormatSpan[]): void {
  for (const m of text.matchAll(TOKEN_RE)) {
    const g = GROUPS.find((x) => m[x.group] !== undefined);
    if (!g) continue;
    const hc = g.group === 14 ? highlightColor(m[g.group]) : null;
    const inner = hc ? m[g.group].slice(hc.length) : m[g.group];
    const from = offset + (m.index ?? 0);
    const to = from + m[0].length;
    const innerTo = to - g.close;
    const innerFrom = innerTo - inner.length;
    out.push({
      kind: g.kind,
      from,
      to,
      innerFrom,
      innerTo,
      ...(g.colorGroup ? { color: m[g.colorGroup] } : {}),
      ...(hc ? { highlight: hc.color } : {}),
      ...(g.html ? { html: true } : {}),
    });
    if (g.nested) scan(inner, innerFrom, out);
  }
}

/**
 * 要不要露出这一段的源码。HTML 标签（颜色、<mark>）始终藏着。Markdown 标记（** == ~~ ` *）在光标或选区的
 * 一头落在这一段里（含紧贴两头）时露出，从点进去到拖选一直露着，不会忽开忽收；
 * 选区把整段都包进去（比如进入编辑时的全选）时不露，看到的仍是效果
 */
export function revealed(span: FormatSpan, ranges: readonly { from: number; to: number }[]): boolean {
  if (span.html) return false;
  const inside = (p: number) => p >= span.from && p <= span.to;
  return ranges.some((r) => (r.from === r.to ? inside(r.from) : !(r.from <= span.from && r.to >= span.to) && (inside(r.from) || inside(r.to))));
}
