/**
 * 表格缩进：把整张表（连同下面的注释）挂到上面的列表项下（成为这一项的备注，脑图里就是这个节点的备注），
 * 或者从列表里移出来。实时预览里表格被我们画的表格盖着，编辑器的 Tab 碰不到这几行，只能从菜单做
 */
import { blockTable, findTables, writeBlock, type TableBlock } from "./find";

const LIST_RE = /^([ \t]*)((?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$))/;

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

function width(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 4 : 1;
  return w;
}

/** 表格上面最近的列表项：中间只隔空行，或者是这个列表项缩进更深的内容；上面是顶格的正文就没有 */
function itemAbove(lines: readonly string[], start: number): number | null {
  let j = start - 1;
  while (j >= 0 && !lines[j].trim()) j--;
  if (j < 0) return null;
  for (let k = j; k >= 0; k--) {
    const l = lines[k];
    if (!l.trim()) continue;
    if (LIST_RE.test(l)) return k;
    if (!width(indentOf(l))) return null;
  }
  return null;
}

/** 挂到列表项下面时用的缩进：列表用 Tab 缩进就加一个 Tab，用空格就加和文件里一样多的空格；看不出来按 Obsidian 默认用 Tab */
function unitFor(lines: readonly string[], item: string): string {
  const own = indentOf(item);
  if (own.includes("\t")) return "\t";
  let spaces = 0;
  for (const l of lines) {
    const m = LIST_RE.exec(l);
    if (!m || !m[1]) continue;
    if (m[1].includes("\t")) return "\t";
    if (!spaces || m[1].length < spaces) spaces = m[1].length;
  }
  return spaces ? " ".repeat(spaces) : "\t";
}

/** 这张表现在能不能往里缩（挂到上面最近的列表项下）、往外移（移出列表） */
export function canIndent(lines: readonly string[], block: TableBlock, dir: 1 | -1): boolean {
  if (dir < 0) return block.owner !== null;
  const item = itemAbove(lines, block.start);
  return item !== null && item !== block.owner;
}

/**
 * 缩进或移出后的整个文件（按行）；做不了返回 null。
 * - 往里缩：挂到上面最近的列表项下，缩进比它深一层，和列表项之间的空行去掉（和脑图存备注的写法一样，紧跟着列表项）
 * - 往外移：放到这个列表结束的地方（列表后面的子项还留在列表里，表格不会把它们隔成代码块），前后各空一行
 */
export function indentTable(lines: readonly string[], block: TableBlock, dir: 1 | -1): string[] | null {
  if (!canIndent(lines, block, dir)) return null;
  const table = blockTable(lines, block);
  if (!table) return null;
  if (dir > 0) {
    const item = itemAbove(lines, block.start)!;
    const indent = indentOf(lines[item]) + unitFor(lines, lines[item]);
    const body = writeBlock(table, { tail: block.tail, indent });
    // 列表项和表格之间只有空行时去掉空行，紧跟着列表项
    let from = block.start;
    while (from - 1 > item && !lines[from - 1].trim()) from--;
    const out = [...lines.slice(0, from), ...body, ...lines.slice(block.stop)];
    // 表格后面紧跟着顶格的正文：空一行，不然会被当成表格的续行
    const next = from + body.length;
    if (next < out.length && out[next].trim() && !width(indentOf(out[next])) && !LIST_RE.test(out[next])) out.splice(next, 0, "");
    return out;
  }
  const body = writeBlock(table, { tail: block.tail, indent: "" });
  // 去掉原来的几行；前后都是空行时再去一个
  const rest = [...lines.slice(0, block.start), ...lines.slice(block.stop)];
  let at = block.start;
  if (at > 0 && at < rest.length && !rest[at - 1].trim() && !rest[at].trim()) rest.splice(at, 1);
  // 列表在哪里结束：往下找第一行顶格、又不是列表项的正文
  let end = at;
  for (; end < rest.length; end++) {
    const l = rest[end];
    if (l.trim() && !width(indentOf(l)) && !LIST_RE.test(l)) break;
  }
  // 停在列表最后一个非空行后面
  while (end > 0 && !rest[end - 1].trim()) end--;
  at = end;
  const ins = [...body];
  if (at > 0) ins.unshift("");
  // 后面紧跟着正文时空一行（后面本来是空行就不用加）
  if (at < rest.length && rest[at].trim()) ins.push("");
  rest.splice(at, 0, ...ins);
  return rest;
}

/** 文件里第 line 行所在（或从这一行开始）的表格 */
export function tableBlockAt(lines: readonly string[], line: number): TableBlock | null {
  const all = findTables(lines);
  return all.find((b) => b.start <= line && line < b.stop) ?? null;
}
