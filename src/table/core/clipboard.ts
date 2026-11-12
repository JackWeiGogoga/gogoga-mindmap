/**
 * 和 Excel、飞书、Numbers 互相复制粘贴用的格式。
 * 复制时同时给纯文本（制表符分隔，Excel 认）和 HTML 表格（飞书、Word、网页认）；
 * 粘贴时优先读 HTML 表格（在编辑器层用 DOMParser），没有再按制表符分隔的文字读。
 */

/** 一格写成 TSV：有制表符、换行、双引号的用双引号包起来，里面的双引号写两遍（和 Excel 一样） */
function tsvCell(s: string): string {
  return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toTSV(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map(tsvCell).join("\t")).join("\n");
}

/**
 * 读制表符分隔的文字（Excel、飞书复制出来的纯文本）。带双引号的格子里可以有换行和制表符。
 * 末尾的空行去掉；只有一格时返回 1×1
 */
export function fromTSV(text: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  let atStart = true;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
      i++;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atStart = true;
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atStart = true;
      i++;
      continue;
    }
    cell += ch;
    atStart = false;
    i++;
  }
  row.push(cell);
  rows.push(row);
  while (rows.length > 1 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML 表格：格子里的换行写成 <br>，第一行用 <th> */
export function toHTML(grid: readonly (readonly string[])[], headerRow: boolean): string {
  const rows = grid.map((row, i) => {
    const tag = headerRow && i === 0 ? "th" : "td";
    return `<tr>${row.map((c) => `<${tag}>${esc(c).replace(/\n/g, "<br>")}</${tag}>`).join("")}</tr>`;
  });
  return `<table>${rows.join("")}</table>`;
}

/**
 * 复制时把这片格子的 Markdown 原文（表格 + 下面那行设置注释）藏进 HTML 表格的一个属性里：
 * 粘到 Obsidian 正文时原样还原颜色、列宽、合并；Excel、Word 不认识这个属性，照常按 HTML 粘
 */
export const SOURCE_ATTR = "data-ggt-src";

export function sourceAttr(lines: readonly string[]): string {
  return ` ${SOURCE_ATTR}="${encodeURIComponent(lines.join("\n"))}"`;
}

/** 从剪贴板的 HTML 里取回藏着的原文；没有、或者坏了返回 null */
export function sourceFromHTML(html: string): string[] | null {
  const m = new RegExp(`${SOURCE_ATTR}="([^"]*)"`).exec(html);
  if (!m) return null;
  try {
    const text = decodeURIComponent(m[1]);
    return text ? text.split("\n") : null;
  } catch {
    return null;
  }
}
