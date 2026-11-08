/**
 * 写回时只改变了的那几个字：Obsidian 实时预览背后的原生表格看到改动全落在单个格子里时走局部更新，
 * 整段替换则整张重建（2 万格约 10 秒）。行数没变时逐行比，每行一处改动（对齐模式下一列变宽会动到整列，
 * 每行各自一小段）；行数变了（插删行）就整体取公共前后缀，一处改动。
 */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

const isHigh = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff;
};
const isLow = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
};

/** a → b 的一处最小改动（相对 a 的偏移）；相同时返回 null。不会把一个 emoji 的两半拆开 */
export function diffOne(a: string, b: string): TextChange | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && isHigh(a, p - 1)) p--;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0 && isLow(a, a.length - s)) s--;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}

/** oldText → newText 的改动列表（位置相对 base，按从前到后排，互不重叠），可直接交给 CM6 的 changes */
export function diffText(oldText: string, newText: string, base = 0): TextChange[] {
  if (oldText === newText) return [];
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length !== b.length) {
    const d = diffOne(oldText, newText)!;
    return [{ from: base + d.from, to: base + d.to, insert: d.insert }];
  }
  const out: TextChange[] = [];
  let at = base;
  for (let i = 0; i < a.length; i++) {
    const d = diffOne(a[i], b[i]);
    if (d) out.push({ from: at + d.from, to: at + d.to, insert: d.insert });
    at += a[i].length + 1;
  }
  return out;
}

/** 把改动套到文字上（测试用，也用来自检） */
export function applyChanges(text: string, changes: TextChange[], base = 0): string {
  let out = "";
  let pos = 0;
  for (const c of changes) {
    out += text.slice(pos, c.from - base) + c.insert;
    pos = c.to - base;
  }
  return out + text.slice(pos);
}
