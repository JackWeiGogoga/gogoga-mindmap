/**
 * 编辑框里的「实时预览」：算出文字里哪些段落带格式、两头的标记符在哪。
 * 规则直接用节点渲染的 TOKEN_RE，编辑时看到的效果和提交后渲染出来的一致；只认会改变文字外观的几种，
 * 链接、公式、图片、标签这些在编辑时照旧显示源码。不碰 DOM，方便单测。
 */

import { highlightColor, type HighlightColor } from "./format";
import { TOKEN_RE } from "./tokens";

export type SpanKind = "strong" | "em" | "mark" | "del" | "code" | "color" | "bg" | "u";

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
  /** 标记是 HTML 标签（颜色、<mark>、<u>）：很长，露出来会把排版整个挤开，编辑时始终藏着 */
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
  { group: 26, kind: "u", close: "</u>".length, nested: true, html: true },
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

/** 编辑框里的一处改动：把 [from, to) 换成 insert */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * 删字、打字碰到藏着的标记符时，改成只动看得见的字，标记符保持成对。
 * 藏着的标记是原子范围，在彩色字后面按退格，编辑器会把整个 </span> 删掉，留下没收尾的 <span>；
 * 选区从段里拖到段外再删或打字也一样。这里把改动里属于标记符的部分让出来：
 * - 整段都在改动范围里的照常删；
 * - 删的全是标记符（退格、Delete 正好落在标记上）时，改成删标记旁边那个看得见的字；
 * - 只删字时里面的字删光了，两头的标记也一起删，不留空的 ** 或空标签；打字替换时字留在原来的格式里。
 * backward：退格是 true、Delete 是 false、别的（删选区、打字）是 null。
 * nextBreak / prevBreak 给出一个字（含组合表情）的边界。不用改时返回 null
 */
export function guardHiddenMarks(
  text: string,
  hidden: readonly FormatSpan[],
  edits: readonly TextEdit[],
  backward: boolean | null,
  prevBreak: (pos: number) => number,
  nextBreak: (pos: number) => number,
): TextEdit[] | null {
  const marks = (s: FormatSpan): [number, number][] => [
    [s.from, s.innerFrom],
    [s.innerTo, s.to],
  ];
  const hits = (a: number, b: number) => hidden.some((s) => marks(s).some(([x, y]) => y > x && a < y && x < b && !(a <= s.from && b >= s.to)));
  // 只删字（不打字）把某段里面的字删光了：标记也得删
  const empties = (e: TextEdit) =>
    !e.insert && hidden.some((s) => s.innerTo > s.innerFrom && e.from <= s.innerFrom && e.to >= s.innerTo && !(e.from <= s.from && e.to >= s.to));
  const needs = (e: TextEdit) => e.to > e.from && (hits(e.from, e.to) || empties(e));
  if (!edits.some(needs)) return null;
  const covered = (pieces: [number, number][], a: number, b: number) => {
    let p = a;
    for (const [x, y] of pieces) if (x <= p && y > p) p = y;
    return p >= b;
  };
  const merge = (pieces: [number, number][]) => {
    pieces.sort((x, y) => x[0] - y[0]);
    const out: [number, number][] = [];
    for (const [a, b] of pieces) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else if (b > a) out.push([a, b]);
    }
    return out;
  };
  const out: TextEdit[] = [];
  for (const e of edits) {
    if (!needs(e)) {
      out.push(e);
      continue;
    }
    // 整段落在改动里的，它的标记照删；只碰到一头的，标记让出来
    const keep = hidden.filter((s) => !(e.from <= s.from && e.to >= s.to)).flatMap(marks);
    let pieces: [number, number][] = [[e.from, e.to]];
    for (const [x, y] of keep) {
      if (y <= x) continue;
      pieces = pieces.flatMap(([a, b]): [number, number][] =>
        b <= x || a >= y
          ? [[a, b]]
          : ([
              [a, x],
              [y, b],
            ] as [number, number][]).filter(([p, q]) => q > p),
      );
    }
    if (!pieces.length && !e.insert && backward !== null) {
      // 删的全是看不见的标记：跳过紧挨着的标记，删旁边那个字
      const all = hidden.flatMap(marks).filter(([x, y]) => y > x);
      if (backward) {
        let p = e.from;
        for (let m = all.find(([, y]) => y === p); m; m = all.find(([, y]) => y === p)) p = m[0];
        if (p > 0) pieces = [[prevBreak(p), p]];
      } else {
        let p = e.to;
        for (let m = all.find(([x]) => x === p); m; m = all.find(([x]) => x === p)) p = m[1];
        if (p < text.length) pieces = [[p, nextBreak(p)]];
      }
    }
    // 里面的字删光了：两头的标记一起删（外层的也可能跟着空掉，所以反复看）。打字替换时不删，字落在原来的格式里
    for (let grew = !e.insert; grew; ) {
      grew = false;
      pieces = merge(pieces);
      for (const s of hidden) {
        if (covered(pieces, s.from, s.to)) continue;
        if (s.innerTo > s.innerFrom && covered(pieces, s.innerFrom, s.innerTo)) {
          pieces.push([s.from, s.to]);
          grew = true;
        }
      }
    }
    pieces = merge(pieces);
    if (!pieces.length) {
      if (e.insert) out.push({ from: e.from, to: e.from, insert: e.insert });
      continue;
    }
    pieces.forEach(([a, b], i) => out.push({ from: a, to: b, insert: i === 0 ? e.insert : "" }));
  }
  return out;
}
