/**
 * 节点里的表格（%%table%%）：表格就存在节点的备注里，是一张标准 Markdown 表格加表格下面一行
 * `<!-- gogoga-table: … -->` 注释（和 gogoga-table 插件同一种格式），离开脑图照样是表格。
 * 这里只管在备注文字里找到、换掉、删掉、新加这张表；画和编辑用 src/table 里同步过来的表格编辑器。
 * 一个备注里有好几张表时只管第一张，其余的留在备注里。
 */

import { blockTable, findTables, writeBlock } from "./table/core/find";
import { emptyTable, serializeBlock, type Table } from "./table/core/table";
import { MARKER_RE, normalizeNote, parseMarkdown, pathAtLine, unescapeNote, type RootRule } from "./markdown";
import { findByPath, type MindNode } from "./model";

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
  // 表格的块标识（「拷贝块链接」时 Obsidian 写在表格下面，隔一个空行单独一行 ^id）是这张表的，跟着表格不显示；
  // 紧贴表格的那种已经算在表格块里（tail）。只影响显示，原文不动
  let stop = nt.stop;
  let k = stop;
  while (k < nt.lines.length && nt.lines[k].trim() === "") k++;
  if (k > stop && k < nt.lines.length && BLOCK_ID_LINE.test(nt.lines[k].slice(nt.indent.length))) stop = k + 1;
  return tidy([...nt.lines.slice(0, nt.start), ...nt.lines.slice(stop)]);
}

const BLOCK_ID_LINE = /^\^[A-Za-z0-9-]+[ \t]*$/;

/** 在备注最前面加一张空表（表头 + 两行，三列）；备注里原来的文字空一行接在后面 */
export function addTable(note: string, inList: boolean, rows = 3, cols = 3): string {
  const table = emptyTable(rows, cols);
  const block = serializeBlock(table, []);
  const rest = unescapeNote(note);
  return normalizeNote(rest.trim() ? [...block, "", rest].join("\n") : block.join("\n"), inList);
}

/** 备注拆成几段：表格那段交给脑图的表格组件画（合并、底色、列宽才显示得出来），其余照常当 Markdown 渲染 */
export type NotePart = { md: string } | { table: Table };

/**
 * 备注（已去掉标注块包装）里顶格的表格单独拿出来，和节点表格一样用 gogoga 表格的样子画；
 * 列表里的表格留在 Markdown 里交给 Obsidian（拆出来会把列表断开）。没有要拿的就返回一整段
 */
export function splitNoteTables(md: string): NotePart[] {
  if (!md.includes("|")) return [{ md }];
  const lines = md.split("\n");
  const out: NotePart[] = [];
  let from = 0;
  const pushMd = (to: number) => {
    const text = lines.slice(from, to).join("\n");
    if (text.trim()) out.push({ md: text });
  };
  for (const b of findTables(lines)) {
    if (b.indent) continue;
    const table = blockTable(lines, b);
    if (!table) continue;
    pushMd(b.start);
    out.push({ table });
    from = b.stop;
  }
  pushMd(lines.length);
  return out.length ? out : [{ md }];
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

const FENCE_LINE = /^\s*(`{3,}|~{3,})/;
const TABLE_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s.*%%(?:[^%]|%(?!%))*\btable\b(?:[^%]|%(?!%))*%%/;

/**
 * 带 %%table%% 的列表项后面紧跟着表格时，中间补一个空行：没装表格插件的 Obsidian 阅读视图要有空行才认得出表格。
 * 写回时「保留原格式」会把原文缺的空行当格式留着（0.46.0 写的就没有），所以保存时统一补上；别的行一概不动
 */
export function blankBeforeNodeTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    if (FENCE_LINE.test(l)) fence = !fence;
    if (fence || !TABLE_ITEM.test(l)) continue;
    const next = lines[i + 1];
    // 补和表格同样缩进的空白行：Markdown 里是空行，Outliner 不会把列表从这里断开
    if (next !== undefined && /^\s+\|/.test(next)) out.push(next.match(/^[ \t]*/)![0]);
  }
  return out.join("\n");
}

/**
 * 在 Markdown 里把光标所在的表格设为（或取消）节点表格：给这张表所属的节点那一行加上 / 去掉 %%table%%
 * （群友反馈：在 Markdown 里写的表格没法变成脑图里的节点表格，只能手写 %%table%%）。
 * line 是光标所在行（0 起）；这一行不在某个节点（列表项、标题）备注里的表格上，或那是中心主题，返回 null。
 * 只改节点那一行：已有标记就在里面加减 table，没有就在行尾（块标识 ^id 前面）加 %%table%%
 */
export function toggleTableMarkerAt(src: string, line: number, rule: RootRule = {}): { line: number; text: string; on: boolean } | null {
  const srcLines = src.replace(/\r\n?/g, "\n").split("\n");
  if (!/^\s*\|/.test(srcLines[line] ?? "")) return null;
  const path = pathAtLine(src, line, rule);
  if (!path) return null;
  const lines = new Map<MindNode, number>();
  const doc = parseMarkdown(src, { lines, ...rule });
  const node = findByPath(doc.root, path);
  const at = node ? lines.get(node) : undefined;
  if (!node || node === doc.root || at === undefined || at >= line || !noteTable(node.note)) return null;
  const on = !node.table;
  const orig = srcLines[at];
  const hard = / {2}$/.test(orig) ? "  " : "";
  let body = hard ? orig.slice(0, -2) : orig;
  const id = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/.exec(body);
  const idPart = id ? body.slice(id.index) : "";
  if (id) body = body.slice(0, id.index);
  const m = MARKER_RE.exec(body);
  if (m) {
    const tokens = m[1].split(/\s+/).filter((x) => x && x.toLowerCase() !== "table");
    if (on) tokens.push("table");
    const head = body.slice(0, m.index);
    body = tokens.length ? `${head} %%${tokens.join(" ")}%%` : head.trimEnd();
  } else if (on) body = `${body.trimEnd()} %%table%%`;
  return { line: at, text: body + idPart + hard, on };
}
