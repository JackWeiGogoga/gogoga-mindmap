/**
 * 嵌入脑图的写回：在宿主笔记文本里找到 ```mindmap（或 ```gogoga-mindmap）代码块并替换其内容。
 * 优先用渲染时拿到的行号，行号对不上（上文被编辑过、块被移动）就按内容找唯一匹配。
 */

const OPEN_RE = /^\s{0,3}(`{3,}|~{3,})\s*(?:gogoga-)?mindmap(?![\w-])/;
const CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/;

export interface BlockRange {
  /** 开围栏所在行（0 起） */
  lineStart: number;
  /** 闭围栏所在行 */
  lineEnd: number;
}

function stripTrailingNewline(s: string): string {
  return s.replace(/\n$/, "");
}

/** 列出文本里所有 mindmap 代码块 */
export function findMindmapBlocks(text: string): (BlockRange & { inner: string })[] {
  const lines = text.split("\n");
  const blocks: (BlockRange & { inner: string })[] = [];
  let open: { line: number; fence: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (open) {
      const m = CLOSE_RE.exec(l);
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length) {
        blocks.push({ lineStart: open.line, lineEnd: i, inner: lines.slice(open.line + 1, i).join("\n") });
        open = null;
      }
      continue;
    }
    const m = OPEN_RE.exec(l);
    if (m) open = { line: i, fence: m[1] };
  }
  return blocks;
}

/**
 * 定位要写回的块：hint 行号处若正好是一个内容等于 expectedInner 的 mindmap 块就用它，
 * 否则在全文里找内容相同的块，唯一才算数。
 */
export function locateBlock(text: string, hint: BlockRange | null, expectedInner: string): BlockRange | null {
  const expected = stripTrailingNewline(expectedInner);
  const blocks = findMindmapBlocks(text);
  if (hint) {
    const hit = blocks.find((b) => b.lineStart === hint.lineStart && b.lineEnd === hint.lineEnd);
    if (hit && stripTrailingNewline(hit.inner) === expected) return { lineStart: hit.lineStart, lineEnd: hit.lineEnd };
  }
  const same = blocks.filter((b) => stripTrailingNewline(b.inner) === expected);
  if (same.length === 1) return { lineStart: same[0].lineStart, lineEnd: same[0].lineEnd };
  if (same.length === 0 && hint) {
    // 内容对不上但行号处确实是个 mindmap 块（比如上一次写回后缓存没刷新），也接受
    const hit = blocks.find((b) => b.lineStart === hint.lineStart && b.lineEnd === hint.lineEnd);
    if (hit) return { lineStart: hit.lineStart, lineEnd: hit.lineEnd };
  }
  return null;
}

/** 用 nextInner 替换 range 里的块内容，返回新文本 */
export function replaceBlock(text: string, range: BlockRange, nextInner: string): string {
  const lines = text.split("\n");
  const inner = stripTrailingNewline(nextInner);
  const body = inner === "" ? [] : inner.split("\n");
  return [...lines.slice(0, range.lineStart + 1), ...body, ...lines.slice(range.lineEnd)].join("\n");
}
