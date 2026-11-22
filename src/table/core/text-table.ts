import { fromTSV } from "./clipboard";

/**
 * 一段文字按什么分列，切成一行行格子（「文字转表格」用）。依次试：
 * 制表符（从表格软件复制来的）→ 竖线（Markdown 表格的样子，分隔行 |---| 去掉）→ 逗号（CSV，支持双引号）
 * → 两个以上空格或全角空格（AI 对话、网页上复制来的对齐文字）→ 单个空格。
 * 逗号、空格这几种要每行都切出两格以上、各行列数一样才算；都不像就按逗号切（以前的做法）
 */
export function splitTextRows(text: string): string[][] {
  const raw = text.replace(/\r\n?/g, "\n").trim();
  if (!raw) return [];
  if (raw.includes("\t")) return fromTSV(raw);
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.every((l) => l.includes("|"))) {
    return lines
      .filter((l) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l))
      .map((l) => splitPipes(l.trim()));
  }
  const even = (rows: string[][]) => rows.every((r) => r.length >= 2) && new Set(rows.map((r) => r.length)).size === 1;
  const csv = lines.map(splitCSV);
  if (even(csv)) return csv;
  const wide = lines.map((l) => l.trim().split(/ {2,}|\u3000+/));
  if (even(wide)) return wide;
  const single = lines.map((l) => l.trim().split(/\s+/));
  if (even(single)) return single;
  return csv;
}

/** 一行 Markdown 表格切成格子：去掉两头的竖线，\| 是格子里的竖线（不用后行断言：iOS 16.4 以前的 Safari 不支持） */
function splitPipes(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  // 两头的竖线切出来的空格子去掉
  if (line.startsWith("|")) out.shift();
  if (line.endsWith("|") && !line.endsWith("\\|")) out.pop();
  return out;
}

export function splitCSV(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) q = true;
    else if (ch === "," || ch === "，") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
