import { applyInlineFormat, type FormatResult, type InlineFormat } from "./format";

/** 行首不该包进格式的记号：缩进、列表符号（带任务框）、编号、引用、标题 */
const LINE_PREFIX = /^[ \t]*(?:(?:>[ \t]?)+)?(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+|#{1,6}[ \t]+)?/;

/**
 * 多行文字（备注）里给选中的一段上格式：按行分开套（** 、<span> 跨行在 Markdown 里不成立），
 * 每行跳过行首的列表、引用、标题记号。没选字返回 null（不给整段上格式）；返回新文字和新选区
 */
export function formatLines(text: string, from: number, to: number, fmt: InlineFormat): FormatResult | null {
  const [a, b] = [Math.min(from, to), Math.max(from, to)];
  if (a === b) return null;
  const lines = text.split("\n");
  const out: string[] = [];
  let pos = 0;
  let newPos = 0;
  let start = -1;
  let end = -1;
  for (const line of lines) {
    const lineEnd = pos + line.length;
    let next = line;
    if (lineEnd >= a && pos <= b) {
      const prefix = LINE_PREFIX.exec(line)?.[0].length ?? 0;
      const s = Math.max(a - pos, prefix);
      const e = Math.min(b - pos, line.length);
      if (s < e && line.slice(s, e).trim()) {
        const r = applyInlineFormat(line, s, e, fmt);
        next = r.text;
        if (start < 0) start = newPos + r.start;
        end = newPos + r.end;
      }
    }
    out.push(next);
    pos = lineEnd + 1;
    newPos += next.length + 1;
  }
  if (start < 0) return null;
  return { text: out.join("\n"), start, end };
}
