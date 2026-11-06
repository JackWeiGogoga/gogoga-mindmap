/**
 * 在一篇笔记里找表格：哪几行是表格、下面有没有我们的注释。
 * 注释放在表格下面：放在上面紧贴着时，没装插件的 Obsidian 实时预览不把它当表格。
 * 表格下面已经有别人的东西时，原样留着、我们的注释排在后面（2026-11-06 实测）：
 * - Advanced Tables 的公式 `<!-- TBLFM: ... -->` 紧跟在表格下面：我们的注释接在公式后面
 * - 块标识 `^id` 紧跟在表格下面：它后面必须是空行才算这张表的块标识，所以是「表格、^id、空行、我们的注释」
 * 顶格的表格，加上列表项下面缩进写的表格（脑图节点下的表格就是这样存的）：每行缩进一样，
 * 往上找到的第一行缩进更少的必须是列表项（它就是这张表的主人），表格紧跟在这一项后面或者隔一个空行。
 * Obsidian 自己在列表里：实时预览不显示表格（露出源码），阅读视图只认前面空一行的。
 * 代码块、frontmatter、引用和 callout（> 开头）里的跳过，不在列表里的缩进（缩进代码块）也跳过。
 */

import { isDelimiterRow, parseMetaLine, parseTable as parseTableRows, serializeBlock, splitRow, type Table, type TableMeta } from "./table";

export interface TableBlock {
  /** 表头所在行（从 0 开始） */
  start: number;
  /** 表格最后一行的下一行 */
  end: number;
  /** 表格下面紧跟的注释所在行；没有注释是 null */
  metaLine: number | null;
  /** 整块（表格 + 夹在中间的行 + 注释）最后一行的下一行；写回时替换 [start, stop) */
  stop: number;
  meta: TableMeta | null;
  /** 表格和我们的注释之间要原样留着的行（公式注释、块标识和它后面的空行），已去掉缩进 */
  tail: string[];
  /** 每行前面的缩进（列表里的表格）；顶格的是空串 */
  indent: string;
  /** 列表里的表格：它所属的列表项在第几行；顶格的是 null */
  owner: number | null;
}

const TBLFM_RE = /^<!--\s*TBLFM:.*-->\s*$/;
const BLOCK_ID_RE = /^\^[A-Za-z0-9-]+\s*$/;

// 列表里的代码块也是缩进的，围栏前面允许任意缩进
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const LIST_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

/** 缩进有多宽（tab 算 4） */
function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 4 : 1;
  return w;
}

/** 这一行去掉 indent 以后的内容；缩进不是正好 indent 就返回 null */
function strip(line: string | undefined, indent: string): string | null {
  if (line === undefined || !line.startsWith(indent)) return null;
  const rest = line.slice(indent.length);
  return /^\s/.test(rest) ? null : rest;
}

/** 缩进的表格往上找主人：第一行缩进更少的非空行得是列表项，返回它的行号 */
function ownerOf(lines: readonly string[], i: number, indent: string): number | null {
  const w = indentWidth(indent);
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.trim()) continue;
    if (indentWidth(indentOf(l)) < w) return LIST_RE.test(l) ? j : null;
  }
  return null;
}

/** 能当表格行的：不缩进、不是引用，有竖线、不是空行 */
function rowLike(line: string): boolean {
  if (!line.trim() || !line.includes("|")) return false;
  if (/^\s/.test(line) || line.startsWith(">") || line.startsWith("<!--")) return false;
  return true;
}

/** 表格上一行是这些时，Obsidian 一定把它当表格：空行、标题、单独一行的 HTML 注释 */
function blockBoundary(line: string): boolean {
  const t = line.trim();
  return t === "" || /^#{1,6}\s/.test(t) || (t.startsWith("<!--") && t.endsWith("-->"));
}

export function findTables(lines: readonly string[]): TableBlock[] {
  const out: TableBlock[] = [];
  let i = 0;
  // frontmatter
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, j) => j > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (close > 0) i = close + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1].trim()) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const indent = indentOf(line);
    const head = line.slice(indent.length);
    const delim = strip(lines[i + 1], indent);
    if (!rowLike(head) || delim === null || !isDelimiterRow(delim)) continue;
    if (splitRow(head).length !== splitRow(delim).length) continue;
    let owner: number | null = null;
    if (indent) {
      // 列表里的：紧跟在所属的列表项后面，或者隔一个空行；夹着别的文字时 Obsidian 当成那段文字，不动
      owner = ownerOf(lines, i, indent);
      if (owner === null || indentWidth(indent) <= indentWidth(indentOf(lines[owner]))) continue;
      if (i - 1 !== owner && lines[i - 1].trim() !== "") continue;
    } else if (i > 0 && !blockBoundary(lines[i - 1])) {
      // 紧跟在一段文字后面的不算（拿不准 Obsidian 会不会当表格，交给它原样处理）：上一行得是空行、标题、注释或笔记开头
      continue;
    }
    let end = i + 2;
    for (;;) {
      const row = strip(lines[end], indent);
      if (row === null || !rowLike(row)) break;
      end++;
    }
    // 表格下面别人的行：公式注释（可以好几行），或者块标识（后面跟空行）
    const tail: string[] = [];
    let k = end;
    const at = (n: number) => strip(lines[n], indent);
    if (k < lines.length && BLOCK_ID_RE.test(at(k) ?? "")) {
      tail.push(at(k++)!);
      if (k < lines.length && lines[k].trim() === "") {
        tail.push("");
        k++;
      }
    } else {
      while (k < lines.length && TBLFM_RE.test(at(k) ?? "")) tail.push(at(k++)!);
    }
    // 块标识后面没有空行时，我们的注释不能紧贴着放（放了块标识就失效），这时不认后面的注释
    const blockIdNoBlank = tail.length === 1 && BLOCK_ID_RE.test(tail[0]);
    const metaText = k < lines.length ? at(k) : null;
    const meta = !blockIdNoBlank && metaText !== null ? parseMetaLine(metaText) : null;
    const metaLine = meta ? k : null;
    const stop = meta ? k + 1 : k;
    out.push({ start: i, end, metaLine, meta, stop, tail, indent, owner });
    i = stop - 1;
  }
  return out;
}

/** 表格那几行（去掉缩进），交给 parseTable */
export function blockRows(lines: readonly string[], b: TableBlock): string[] {
  return lines.slice(b.start, b.end).map((l) => l.slice(b.indent.length));
}

/** 这张表的 Markdown（含表格下面的注释），换掉 [start, stop)；列表里的表格每行补回缩进（空行不补） */
export function writeBlock(t: Table, b: Pick<TableBlock, "tail" | "indent">): string[] {
  return serializeBlock(t, b.tail).map((l) => (l === "" ? l : b.indent + l));
}

/** 读出这一块的表 */
export function blockTable(lines: readonly string[], b: TableBlock): Table | null {
  return parseTableRows(blockRows(lines, b), b.meta);
}
