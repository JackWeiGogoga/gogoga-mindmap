/**
 * 展开的备注卡片只显示列表项（#31）：开着「只把标题当节点」时，标题下的大段解释和列表结论都进了备注，
 * 有人只想在脑图里看结论。这里从备注原文里挑出列表项（连同它下面缩进的子项、续行），其余不显示。
 * 只管显示：文件、弹窗、编辑框里都还是完整备注。
 */

export type NoteCardFilter = "all" | "list" | "ordered" | "unordered";

const ITEM_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])(?:[ \t]+|$)/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

/** 缩进宽度：tab 按 4 算 */
function width(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 4 - (w % 4) : 1;
  return w;
}

function leading(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

/** 去掉开头 n 格缩进（tab 按 4 格算；去不够就去掉全部空白） */
function dedent(line: string, n: number): string {
  let w = 0;
  let i = 0;
  while (i < line.length && w < n && (line[i] === " " || line[i] === "\t")) {
    w += line[i] === "\t" ? 4 - (w % 4) : 1;
    i++;
  }
  return line.slice(i);
}

/**
 * 按设置挑出卡片里要显示的部分，分成几段：原文里挨着的（中间只隔空行）算一段，不挨着的分开，
 * 免得两处各自从 1 开始的有序列表渲染时被接成一个列表。返回空数组表示没有可显示的。
 * mode 为 all 时原样返回整条备注
 */
export function noteCardParts(note: string, mode: NoteCardFilter): string[] {
  if (mode === "all") return note.trim() ? [note] : [];
  const lines = note.split("\n");
  const parts: string[] = [];
  let cur: string[] = [];
  let lastKept = -2;
  let fence: string | null = null;
  let i = 0;
  const flush = () => {
    while (cur.length && !cur[cur.length - 1].trim()) cur.pop();
    if (cur.length) parts.push(cur.join("\n"));
    cur = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    // 代码块里的「- 」不算列表项
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      i++;
      continue;
    }
    if (f) {
      fence = f[1];
      i++;
      continue;
    }
    const m = ITEM_RE.exec(line);
    const ordered = !!m?.[3];
    const hit = m && (mode === "list" || (mode === "ordered" ? ordered : !ordered));
    // 「---」「***」是分隔线，不是列表项
    if (!hit || /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) {
      i++;
      continue;
    }
    // 这一项连同下面缩进更深的行（子项、续行、项内代码块）一起留下，按这一项的缩进整体左移
    const base = width(m[1]);
    const block = [dedent(line, base)];
    let j = i + 1;
    let inner: string | null = null;
    while (j < lines.length) {
      const l = lines[j];
      const ff = FENCE_RE.exec(l);
      if (inner) {
        if (ff && ff[1][0] === inner[0] && ff[1].length >= inner.length) inner = null;
        block.push(dedent(l, base));
        j++;
        continue;
      }
      if (!l.trim()) {
        // 空行：后面还有更深缩进的内容才算这一项的
        let k = j + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && width(leading(lines[k])) > base) {
          for (; j < k; j++) block.push("");
          continue;
        }
        break;
      }
      if (width(leading(l)) <= base) break;
      if (ff) inner = ff[1];
      block.push(dedent(l, base));
      j++;
    }
    // 和上一段之间只隔空行：接着算同一段
    let gap = lastKept >= 0;
    for (let k = Math.max(0, lastKept + 1); gap && k < i; k++) if (lines[k].trim()) gap = false;
    if (!(lastKept >= 0 && gap)) flush();
    else if (i - lastKept > 1) cur.push("");
    cur.push(...block);
    lastKept = j - 1;
    i = j;
  }
  flush();
  return parts;
}
