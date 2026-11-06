/**
 * 在一篇笔记里找表格：哪几行是表格、下面有没有我们的注释。
 * 注释放在表格下面：放在上面紧贴着时，没装插件的 Obsidian 实时预览不把它当表格。
 * 表格下面已经有别人的东西时，原样留着、我们的注释排在后面（2026-11-06 实测）：
 * - Advanced Tables 的公式 `<!-- TBLFM: ... -->` 紧跟在表格下面：我们的注释接在公式后面
 * - 块标识 `^id` 紧跟在表格下面：它后面必须是空行才算这张表的块标识，所以是「表格、^id、空行、我们的注释」
 * 第一版只管顶格写的表格；代码块、frontmatter、引用和 callout（> 开头）、缩进 4 格以上的都跳过，
 * 这些地方的表格仍由 Obsidian 原生显示。
 */

import { isDelimiterRow, parseMetaLine, splitRow, type TableMeta } from "./table";

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
  /** 表格和我们的注释之间要原样留着的行（公式注释、块标识和它后面的空行） */
  tail: string[];
}

const TBLFM_RE = /^<!--\s*TBLFM:.*-->\s*$/;
const BLOCK_ID_RE = /^\^[A-Za-z0-9-]+\s*$/;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

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
    if (!rowLike(line) || i + 1 >= lines.length || !isDelimiterRow(lines[i + 1]) || /^\s/.test(lines[i + 1])) continue;
    if (splitRow(line).length !== splitRow(lines[i + 1]).length) continue;
    // 紧跟在一段文字后面的不算（拿不准 Obsidian 会不会当表格，交给它原样处理）：上一行得是空行、标题、注释或笔记开头
    if (i > 0 && !blockBoundary(lines[i - 1])) continue;
    let end = i + 2;
    while (end < lines.length && rowLike(lines[end])) end++;
    // 表格下面别人的行：公式注释（可以好几行），或者块标识（后面跟空行）
    const tail: string[] = [];
    let k = end;
    if (k < lines.length && BLOCK_ID_RE.test(lines[k])) {
      tail.push(lines[k++]);
      if (k < lines.length && lines[k].trim() === "") tail.push(lines[k++]);
    } else {
      while (k < lines.length && TBLFM_RE.test(lines[k])) tail.push(lines[k++]);
    }
    // 块标识后面没有空行时，我们的注释不能紧贴着放（放了块标识就失效），这时不认后面的注释
    const blockIdNoBlank = tail.length === 1 && BLOCK_ID_RE.test(tail[0]);
    const meta = !blockIdNoBlank && k < lines.length ? parseMetaLine(lines[k]) : null;
    const metaLine = meta ? k : null;
    const stop = meta ? k + 1 : k;
    out.push({ start: i, end, metaLine, meta, stop, tail });
    i = stop - 1;
  }
  return out;
}
