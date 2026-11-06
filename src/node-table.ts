/**
 * 节点里的表格（%%table%%）：表格就存在节点的备注里，是一张标准 Markdown 表格加表格下面一行
 * `<!-- gogoga-table: … -->` 注释（和 gogoga-table 插件同一种格式），离开脑图照样是表格。
 * 这里只管在备注文字里找到、换掉、删掉、新加这张表；画和编辑用 src/table 里同步过来的表格编辑器。
 * 一个备注里有好几张表时只管第一张，其余的留在备注里。
 */

import { blockTable, findTables, writeBlock } from "./table/core/find";
import { emptyTable, serializeBlock, type Table } from "./table/core/table";
import { normalizeNote, unescapeNote } from "./markdown";

export interface NoteTable {
  table: Table;
  /** 备注原文（去掉标注块包装后）按行拆开 */
  lines: string[];
  /** 表格这一块在 lines 里的范围 [start, stop)（含表格下面的注释） */
  start: number;
  stop: number;
  tail: string[];
  indent: string;
}

/** 备注里的第一张表 */
export function noteTable(note: string): NoteTable | null {
  if (!note || !note.includes("|")) return null;
  const lines = unescapeNote(note).split("\n");
  for (const b of findTables(lines)) {
    const table = blockTable(lines, b);
    if (table) return { table, lines, start: b.start, stop: b.stop, tail: b.tail, indent: b.indent };
  }
  return null;
}

/** 前后的空行收掉，中间连着的空行并成一个 */
function tidy(lines: string[]): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

/** 把备注里的第一张表换成 table；没有表就什么都不改 */
export function withTable(note: string, table: Table, inList: boolean): string {
  const nt = noteTable(note);
  if (!nt) return note;
  const lines = [...nt.lines.slice(0, nt.start), ...writeBlock(table, nt), ...nt.lines.slice(nt.stop)];
  return normalizeNote(lines.join("\n"), inList);
}

/** 去掉第一张表（连同它的注释）之后的备注 */
export function withoutTable(note: string, inList: boolean): string {
  const nt = noteTable(note);
  if (!nt) return note;
  return normalizeNote(tidy([...nt.lines.slice(0, nt.start), ...nt.lines.slice(nt.stop)]), inList);
}

/** 备注去掉节点里那张表以后剩下的原文（展开备注、备注图标看的是它） */
export function noteRest(note: string): string {
  const nt = noteTable(note);
  if (!nt) return unescapeNote(note);
  return tidy([...nt.lines.slice(0, nt.start), ...nt.lines.slice(nt.stop)]);
}

/** 在备注最前面加一张空表（表头 + 两行，三列）；备注里原来的文字空一行接在后面 */
export function addTable(note: string, inList: boolean, rows = 3, cols = 3): string {
  const table = emptyTable(rows, cols);
  const block = serializeBlock(table, []);
  const rest = unescapeNote(note);
  return normalizeNote(rest.trim() ? [...block, "", rest].join("\n") : block.join("\n"), inList);
}

/** 表格的 Markdown（比较是不是同一张用） */
export function tableSource(table: Table): string {
  return serializeBlock(table, []).join("\n");
}

/** 只留第一张表（连同注释），表格以外的备注都去掉 */
export function noteOnlyTable(note: string): string {
  const nt = noteTable(note);
  if (!nt) return note;
  return nt.lines.slice(nt.start, nt.stop).join("\n");
}
