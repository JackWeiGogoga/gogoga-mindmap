/**
 * Markdown ⇄ 树 的双向转换。
 *
 * 映射规则：
 *   # 一级标题        → 根节点（没有则用文件名，根节点合成）
 *   ##…###### 标题    → 各级节点
 *   - 列表项（缩进嵌套）→ 更深的节点
 *   标签末尾 %%red fold%% → 节点颜色 / 折叠状态（Obsidian 注释语法，阅读模式不可见）
 *   标题或列表项下方的普通段落 → 节点备注，原样保留
 *
 * 目标是往返无损：serialize(parse(x)) 对规范格式的文件与 x 完全一致，
 * 对非规范格式的文件只规范化空行和缩进，不丢内容。
 */

import { Boundary, createNode, findByPath, FloatPos, pathOf, Summary, DocStyle, MindDoc, MindNode, NODE_MAX_WIDTH, NODE_MIN_WIDTH, NodeKind, normalizeBoxes } from "./model";

export const COLOR_NAMES = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
// 标记里允许单个 %（概要文字里的链接会有 %E4 这种编码），只有 %% 才是注释的结尾
const MARKER_RE = /[ \t]*%%[ \t]*((?:[^%]|%(?!%))*?)[ \t]*%%[ \t]*$/;
const BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;

/** 摘出行尾的 Obsidian 块 id（^abc123） */
export function splitBlockId(text: string): { text: string; blockId?: string } {
  const m = BLOCK_ID_RE.exec(text);
  if (!m) return { text };
  return { text: text.slice(0, m.index).trimEnd(), blockId: m[1] };
}

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 8);
}
// 色值在文件里不带 #：写成 %%#a3e5a2%% 的话，Obsidian 会把 #a3e5a2 当成标签索引进标签面板，
// 即使它在 %% 注释里也一样。读的时候两种都认，写的时候一律去掉 #。
const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const DEFAULT_STYLE: DocStyle = {
  indent: "\t",
  bullet: "-",
  blankBeforeList: false,
  maxHeadingLevel: 3,
};

interface Marker {
  color?: string;
  folded: boolean;
  box?: Boundary;
  summary?: Summary;
  width?: number;
  side?: "left" | "right";
  float?: FloatPos;
  callout?: string;
  calloutColor?: string;
}

/** 标记里的一项：box、box=3、summary=2、callout 可带一个 "文字"（文字里不能有 " 和 %%），其余按空白切 */
const MARKER_TOKEN_RE = /(box|summary|callout)(?:=(\d+))?(?:[ \t]*"((?:[^"%]|%(?!%))*)")?(?=\s|$)|\S+/g;

/** 写进标记的文字：去掉会截断标记的 " 和 %%（单个 % 留着） */
export function markerText(s: string): string {
  return s.replace(/"/g, "").replace(/%{2,}/g, "%").replace(/[\r\n]+/g, " ").trim();
}

/** 从标签末尾摘出我们认识的 %% 标记；不认识的注释原样留在文本里 */
/**
 * 标注文字 → 标记里的样子：换行写成 <br>；英文双引号会截断标记，换成中文引号（左右交替），%% 换成 %
 */
export function calloutToMarker(s: string): string {
  let open = false;
  return s
    .replace(/"/g, () => {
      open = !open;
      return open ? "\u201c" : "\u201d";
    })
    .replace(/%{2,}/g, "%")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .join("<br>")
    .replace(/^(<br>)+|(<br>)+$/g, "")
    .trim();
}

/** 标记里的标注文字 → 内存里的（<br> 还原成换行） */
export function calloutFromMarker(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").trim();
}

export function splitMarker(text: string): { text: string; marker: Marker } {
  const m = MARKER_RE.exec(text);
  const marker: Marker = { folded: false };
  if (!m) return { text: text.trimEnd(), marker };
  const tokens = [...m[1].matchAll(MARKER_TOKEN_RE)];
  if (tokens.length === 0) return { text: text.trimEnd(), marker };
  let sw: number | undefined;
  let isFloat = false;
  let fx: number | undefined;
  let fy: number | undefined;
  for (const tok of tokens) {
    const t = tok[0];
    const lower = t.toLowerCase();
    if (tok[1] === "box") {
      marker.box = { span: Math.max(1, Number(tok[2] ?? 1)), title: tok[3]?.trim() ?? "" };
    } else if (tok[1] === "summary") {
      marker.summary = { span: Math.max(1, Number(tok[2] ?? 1)), text: tok[3]?.trim() ?? "" };
    } else if (tok[1] === "callout") {
      // 带数字的 callout=2 不是我们写的，整段当普通文字
      if (tok[2] !== undefined) return { text: text.trimEnd(), marker: { folded: false } };
      const c = calloutFromMarker(tok[3] ?? "");
      if (c) marker.callout = c;
    } else if (/^cc=/.test(lower) && ((COLOR_NAMES as readonly string[]).includes(lower.slice(3)) || HEX_RE.test(lower.slice(3)))) {
      const c = lower.slice(3);
      marker.calloutColor = c.startsWith("#") || (COLOR_NAMES as readonly string[]).includes(c) ? c : `#${c}`;
    } else if (/^sw=\d{1,6}$/.test(lower)) {
      sw = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, Number(lower.slice(3))));
    } else if (/^w=\d{1,6}$/.test(lower)) {
      marker.width = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, Number(lower.slice(2))));
    } else if (lower === "left" || lower === "right") {
      marker.side = lower;
    } else if (lower === "float") {
      isFloat = true;
    } else if (/^[xy]=-?\d{1,6}$/.test(lower)) {
      if (lower[0] === "x") fx = Number(lower.slice(2));
      else fy = Number(lower.slice(2));
    } else if (lower === "fold") marker.folded = true;
    else if ((COLOR_NAMES as readonly string[]).includes(lower)) marker.color = lower;
    // 内存里保留 # 前缀，直接当 CSS 颜色用
    else if (HEX_RE.test(t)) marker.color = lower.startsWith("#") ? lower : `#${lower}`;
    else return { text: text.trimEnd(), marker: { folded: false } };
  }
  if (sw && marker.summary) marker.summary.width = sw;
  // cc= 只跟着 callout 出现才算数
  if (!marker.callout) delete marker.calloutColor;
  // x= / y= 只跟着 float 出现；单独出现说明不是我们的标记，整段当普通文字
  if (!isFloat && (fx !== undefined || fy !== undefined)) return { text: text.trimEnd(), marker: { folded: false } };
  if (isFloat) marker.float = { x: fx ?? 0, y: fy ?? 0 };
  return { text: text.slice(0, m.index).trimEnd(), marker };
}

/** 两处标记合在一起：b 里写了的以 b 为准，折叠任一处有就算 */
function mergeMarker(a: Marker, b: Marker): Marker {
  const out: Marker = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof Marker, Marker[keyof Marker]][]) if (v !== undefined && k !== "folded") (out as unknown as Record<string, unknown>)[k] = v;
  out.folded = a.folded || b.folded;
  return out;
}

export function formatMarker(node: Pick<MindNode, "color" | "folded" | "box" | "summary" | "width" | "side" | "float" | "callout" | "calloutColor">): string {
  const parts: string[] = [];
  if (node.color) parts.push(node.color.startsWith("#") ? node.color.slice(1) : node.color);
  if (node.folded) parts.push("fold");
  if (node.width) parts.push(`w=${Math.round(node.width)}`);
  if (node.side) parts.push(node.side);
  if (node.box) {
    const title = node.box.title.replace(/["%]/g, "").trim();
    parts.push(`box${node.box.span > 1 ? `=${node.box.span}` : ""}${title ? ` "${title}"` : ""}`);
  }
  if (node.summary) {
    const text = markerText(node.summary.text);
    parts.push(`summary${node.summary.span > 1 ? `=${node.summary.span}` : ""}${text ? ` "${text}"` : ""}`);
    if (node.summary.width) parts.push(`sw=${Math.round(node.summary.width)}`);
  }
  if (node.float) parts.push(`float x=${Math.round(node.float.x)} y=${Math.round(node.float.y)}`);
  const callout = node.callout ? calloutToMarker(node.callout) : "";
  if (callout) parts.push(`callout "${callout}"`);
  if (callout && node.calloutColor) parts.push(`cc=${node.calloutColor.startsWith("#") ? node.calloutColor.slice(1) : node.calloutColor}`);
  return parts.length ? ` %%${parts.join(" ")}%%` : "";
}

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 4 : 1;
  return w;
}

function leadingWs(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/** 去掉各行共同的最小缩进（空行不参与） */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const l of lines) {
    if (l.trim() === "") continue;
    min = Math.min(min, leadingWs(l).length);
  }
  if (!isFinite(min) || min === 0) return lines;
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(min)));
}

function joinNote(lines: string[]): string {
  return trimBlankLines(lines).join("\n");
}

type Token =
  | { t: "heading"; level: number; text: string }
  | { t: "list"; ws: string; bullet: string; text: string; raw: string }
  | { t: "line"; raw: string };

function tokenize(lines: string[]): Token[] {
  const out: Token[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const raw of lines) {
    const f = FENCE_RE.exec(raw);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && raw.trim() === f[1]) fence = null;
      out.push({ t: "line", raw });
      continue;
    }
    if (f) {
      fence = { char: f[1][0], len: f[1].length };
      out.push({ t: "line", raw });
      continue;
    }
    const h = HEADING_RE.exec(raw);
    if (h) {
      out.push({ t: "heading", level: h[1].length, text: h[2] ?? "" });
      continue;
    }
    const l = LIST_RE.exec(raw);
    if (l) {
      out.push({ t: "list", ws: l[1], bullet: l[2], text: l[3], raw });
      continue;
    }
    out.push({ t: "line", raw });
  }
  return out;
}

// ---------- 备注转义 ----------
// 备注里若有列表项或标题，写回文件后会被当成子节点。这种备注整段包成 Obsidian 标注块存储：
//   > [!note]
//   > 正文
// 编辑和展示时再去掉包装，用户看到的始终是原文。

const NOTE_CALLOUT = "> [!note]";

/**
 * 备注里是否有会被解析成节点的行（代码块内的不算）。
 * inList：备注写在列表项下面（缩进）。不在列表里时，按 CommonMark 紧跟在文字后面的「2026. 年底」这类
 * 不从 1 开始的有序项、空列表项只是续行，不会变成节点，不用包 —— 包了会渲染成引用块，显示就变了
 */
export function noteNeedsEscape(note: string, inList = true): boolean {
  if (!note) return false;
  const tokens = tokenize(note.split("\n"));
  return tokens.some((t, i) => {
    if (t.t === "heading") return true;
    if (t.t !== "list") return false;
    if (inList || !cannotInterrupt(t, tokens[i - 1])) return true;
    tokens[i] = { t: "line", raw: t.raw };
    return false;
  });
}

/** 不从 1 开始的有序项、空列表项，紧跟在一行文字（不是代码围栏）后面：不能新开列表，只是那段文字的续行 */
function cannotInterrupt(tok: { bullet: string; text: string }, prev: Token | undefined): boolean {
  const afterText = prev?.t === "line" && prev.raw.trim() !== "" && !FENCE_RE.test(prev.raw);
  return afterText && ((/^\d/.test(tok.bullet) && parseInt(tok.bullet, 10) !== 1) || tok.text.trim() === "");
}

export function isEscapedNote(note: string): boolean {
  const lines = note.split("\n");
  return lines[0]?.trim() === NOTE_CALLOUT && lines.slice(1).every((l) => l === "" || l.startsWith(">"));
}

export function escapeNote(plain: string): string {
  return [NOTE_CALLOUT, ...plain.split("\n").map((l) => (l === "" ? ">" : `> ${l}`))].join("\n");
}

/** 存储形式 → 用户看到的原文 */
export function unescapeNote(note: string): string {
  if (!isEscapedNote(note)) return note;
  return note
    .split("\n")
    .slice(1)
    .map((l) => l.replace(/^> ?/, ""))
    .join("\n");
}

/** 用户输入的原文 → 存储形式（只在必要时包装） */
export function normalizeNote(plain: string, inList = true): string {
  return noteNeedsEscape(plain, inList) ? escapeNote(plain) : plain;
}

// ---------- 剪贴板 ----------

/** 把子树写成缩进列表：复制节点时放进剪贴板，任何地方都能粘贴成 Markdown */
export function subtreeToList(node: MindNode, indent = "\t"): string {
  const lines: string[] = [];
  const walk = (n: MindNode, depth: number) => {
    lines.push(`${indent.repeat(depth)}- ${n.text}${formatMarker(n)}`.trimEnd());
    if (n.note) {
      for (const l of normalizeNote(n.note).split("\n")) lines.push(l === "" ? "" : `${indent.repeat(depth + 1)}${l}`);
    }
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return lines.join("\n") + "\n";
}

/** 剪贴板文本 → 游离的节点列表：有标题/列表结构就按结构来，纯文本则每行一个节点 */
export function parseClipboard(text: string): MindNode[] {
  const trimmed = text.replace(/\r/g, "").trim();
  if (!trimmed) return [];
  const quoted = parseQuoteBlocks(trimmed);
  if (quoted) return quoted;
  const doc = parseMarkdown(trimmed, { fallbackTitle: "" });
  if (doc.rootFromHeading) {
    doc.root.parent = null;
    return [doc.root];
  }
  const nodes: MindNode[] = [];
  if (doc.root.note) {
    for (const line of doc.root.note.split("\n")) {
      const t = line.trim();
      if (t) nodes.push(createNode({ parent: null, text: t, kind: "list" }));
    }
  }
  for (const c of doc.root.children) {
    c.parent = null;
    nodes.push(c);
  }
  return nodes;
}

/** PDF 里的选区链接 [[文件.pdf#page=…&selection=…|显示文字]] */
const PDF_SELECTION_RE = /\[\[([^\]|]+\.pdf#[^\]|]*selection=[^\]|]*)(?:\|([^\]]*))?\]\]/i;
/** PDF++ 的截区嵌入 ![[文件.pdf#page=…&rect=…]] */
const PDF_CROP_RE = /!\[\[[^\]|]+\.pdf#[^\]|]*rect=[^\]]*\]\]/i;

/**
 * 整段剪贴板都是引用块（`>` 开头，空行隔开的几块）时，每块合成一个节点，不再一行一个、
 * 拆出一堆只有 `>` 的空节点。PDF++ 复制的选区就是这种：
 *   > [!PDF|yellow] [[书.pdf#page=3&selection=…|书, p.3]]
 *   > > 选中的原文
 * 变成一个节点「原文」，整个链接到 PDF 里那段选区（点它跳回去高亮）。截区嵌入原样做节点（显示裁切的图）。
 * 别的引用块：标注 [!type] 标题 取标题（没标题取类型）、普通引用取第一行做节点，其余做备注。
 * 有一行不是引用就返回 null，按普通 Markdown 解析
 */
function parseQuoteBlocks(text: string): MindNode[] | null {
  const lines = text.split("\n");
  if (!lines.every((l) => !l.trim() || /^ {0,3}>/.test(l))) return null;
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const l of lines) {
    if (!l.trim()) {
      cur = null;
      continue;
    }
    if (!cur) blocks.push((cur = []));
    cur.push(l.replace(/^ {0,3}> ?/, ""));
  }
  const nodes: MindNode[] = [];
  for (const block of blocks) {
    const body = block.join("\n");
    const crop = PDF_CROP_RE.exec(body);
    const sel = PDF_SELECTION_RE.exec(body);
    if (crop && !sel) {
      nodes.push(createNode({ parent: null, text: crop[0], kind: "list" }));
      continue;
    }
    if (sel) {
      // 链接以外的文字就是选中的原文：去掉标注头、内层引用符号、链接本身和链接外面留下的空括号
      const rest = body
        .replace(sel[0], "")
        .replace(/\[![^\]]*\][+-]?/, "")
        .split("\n")
        .map((l) => l.replace(/^(?: {0,3}> ?)+/, "").trim())
        .join(" ")
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      // 显示文字里不能有 ] 和 |，否则链接就断了
      const label = (rest || sel[2] || sel[1]).replace(/\|/g, "/").replace(/\]/g, ")").replace(/\[/g, "(");
      nodes.push(createNode({ parent: null, text: `[[${sel[1]}|${label}]]`, kind: "list" }));
      continue;
    }
    const inner = block.map((l) => l.replace(/^(?: {0,3}> ?)+/, ""));
    const head = /^\[!([^\]]*)\][+-]?\s*(.*)$/.exec(inner[0].trim());
    let title: string;
    let rest: string[];
    if (head) {
      title = head[2].trim() || head[1].split("|")[0].trim();
      rest = inner.slice(1);
    } else {
      const first = inner.findIndex((l) => l.trim());
      if (first < 0) continue;
      title = inner[first].trim();
      rest = inner.slice(first + 1);
    }
    const note = rest.join("\n").trim();
    if (!title && !note) continue;
    nodes.push(createNode({ parent: null, text: title || note.split("\n")[0], kind: "list", note: note && title ? normalizeNote(note) : "" }));
  }
  return nodes.length ? nodes : null;
}

/** CommonMark 里能打断段落的 HTML 块（第 1–6 类）开头的标签名 */
const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const INTERRUPT_RE = new RegExp(
  [
    `^ {0,3}<(?:script|pre|style|textarea)(?:\\s|>|$)`,
    `^ {0,3}<(?:!--|\\?|![A-Za-z]|!\\[CDATA\\[)`,
    `^ {0,3}</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`,
    "^ {0,3}(?:```|~~~)",
    "^ {0,3}>",
    "^ {0,3}([-*_])(?:[ \\t]*\\1){2,}[ \\t]*$",
  ].join("|"),
  "i",
);

/**
 * 这一行会不会另起一个块：HTML 块（如 <!-- 注释 -->）、代码围栏、引用、分隔线。
 * 这些紧跟在列表项后面也不是它的懒续行，而是结束了列表、属于外面那一层 ——
 * 归进列表项的话，写回时会被缩进进列表项里，渲染出来就变了（比如 Fav Sync 的 <!-- fav-sync:end --> 被挪进最后一项）
 */
export function interruptsParagraph(line: string): boolean {
  return INTERRUPT_RE.test(line);
}

/** 文本里的标题文字（Obsidian 链接 [[笔记#标题]] 用的那个），代码围栏里的不算 */
export function headingTexts(src: string): string[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
    if (end > 0) start = end + 1;
  }
  return tokenize(lines.slice(start)).flatMap((t) => (t.t === "heading" ? [t.text.replace(/[ \t]+#+[ \t]*$/, "").trim()] : []));
}

/**
 * 写回前后标题文字的变化里，哪些只是去掉了行末的 %%标记%%（老写法迁到新写法）：旧标题 → 新标题。
 * 别的笔记里 [[笔记#旧标题]] 的链接要跟着改，不然就断了
 */
export function strippedMarkerRenames(before: string, after: string): Map<string, string> {
  const old = headingTexts(before);
  const now = new Set(headingTexts(after));
  const out = new Map<string, string>();
  for (const h of old) {
    if (!h.includes("%%") || now.has(h)) continue;
    const clean = h.replace(/[ \t]*%%(?:[^%]|%(?!%))*?%%[ \t]*$/, "").trim();
    if (clean && clean !== h && now.has(clean)) out.set(h, clean);
  }
  return out;
}

export interface ParseOptions {
  /** 没有一级标题时用作根节点标签（通常是文件名） */
  fallbackTitle?: string;
  style?: Partial<DocStyle>;
  /** 传进来就记下每个节点在源文本里的行号（0 起，含 frontmatter） */
  lines?: Map<MindNode, number>;
  /** 唯一的一级标题升格为中心主题（默认）；false 时中心主题始终是 fallbackTitle，一级标题作为它的子节点 */
  rootFromH1?: boolean;
}

/** 节点路径和行号互查时要和视图用同一种根节点规则，否则路径对不上 */
export type RootRule = Pick<ParseOptions, "rootFromH1">;

export function parseMarkdown(src: string, opts: ParseOptions = {}): MindDoc {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  let frontmatter = "";
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
    if (end > 0) {
      frontmatter = lines.slice(0, end + 1).join("\n");
      start = end + 1;
    }
  }

  const tokens = tokenize(lines.slice(start));

  // 根节点先按合成处理，若第一个标题是唯一的 H1 就升格为根
  const root = createNode({ parent: null, kind: "heading", level: 0, text: opts.fallbackTitle ?? "" });
  const h1Count = tokens.filter((t) => t.t === "heading" && t.level === 1).length;
  const firstHeading = tokens.find((t) => t.t === "heading");
  const rootFromHeading = (opts.rootFromH1 ?? true) && h1Count === 1 && firstHeading?.t === "heading" && firstHeading.level === 1;

  const preamble: string[] = [];
  const headingStack: MindNode[] = [root];
  let listStack: { indent: number; node: MindNode }[] = [];
  const noteBuf = new Map<MindNode, string[]>();
  const tailBuf = new Map<MindNode, string[]>();
  const leadBuf = new Map<MindNode, string[]>();
  let target: { node: MindNode; buf: Map<MindNode, string[]> } = { node: root, buf: noteBuf };
  let seenRoot = false;
  let prevWasBlank = true;
  let lastListItem: MindNode | null = null;

  const push = (t: { node: MindNode; buf: Map<MindNode, string[]> }, line: string) => {
    const arr = t.buf.get(t.node) ?? [];
    arr.push(line);
    t.buf.set(t.node, arr);
  };

  const indents: string[] = [];
  const bullets: string[] = [];
  let blankBeforeList: boolean | null = null;
  let prevTokenWasHeading = false;
  let blankSinceHeading = false;

  for (let ti = 0; ti < tokens.length; ti++) {
    let tok = tokens[ti];
    // CommonMark：不从 1 开始的有序列表、空的列表项不能打断段落，新开列表时紧跟在一行文字后面就只是那段文字的续行。
    // 不照这条认，删掉「1.」之后剩下的「2. 3.」挨着上面的文字写回，渲染出来列表就没了，我们却以为还是列表。
    // 已经在列表里（同一个列表的下一项、备注后面的下一项）不受这条限制
    if (tok.t === "list" && !listStack.length && cannotInterrupt(tok, tokens[ti - 1])) {
      // 改写回 tokens：下一行的「3.」看到的前一行就是文字，同样算续行
      tok = tokens[ti] = { t: "line", raw: tok.raw };
    }
    // tokenize 一行出一个 token，所以 token 序号加上 frontmatter 的行数就是源文本行号
    const lineNo = start + ti;
    if (tok.t === "heading") {
      const split = splitMarker(tok.text);
      const { text } = split;
      let { marker } = split;
      // 标题的标记写在下一行（只有 %%…%% 的一行）：标题行保持干净，[[笔记#标题]] 的链接才对得上。
      // 老写法（标记在标题行末尾）照样认；两处都有时以下一行为准
      const next = tokens[ti + 1];
      if (next?.t === "line" && next.raw.trim() !== "") {
        const own = splitMarker(next.raw.trim());
        if (own.text === "") {
          marker = mergeMarker(marker, own.marker);
          ti++;
        }
      }
      if (!seenRoot && rootFromHeading) {
        seenRoot = true;
        root.text = text;
        root.color = marker.color;
        root.folded = marker.folded;
        root.box = marker.box;
        root.summary = marker.summary;
        root.width = marker.width;
        // 中心主题上的 float 没有意义，但原样保留，写回不改用户的文本
        root.float = marker.float;
        root.callout = marker.callout;
        root.calloutColor = marker.calloutColor;
        root.level = 1;
        root.kind = "heading";
        opts.lines?.set(root, lineNo);
        // 根之前的文本是 preamble
        const pre = noteBuf.get(root) ?? [];
        preamble.push(...pre);
        noteBuf.delete(root);
        target = { node: root, buf: noteBuf };
      } else {
        while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= tok.level) headingStack.pop();
        const parent = headingStack[headingStack.length - 1];
        const node = createNode({ parent, kind: "heading", level: tok.level, text, color: marker.color, folded: marker.folded, box: marker.box, summary: marker.summary, width: marker.width, side: marker.side, float: marker.float, callout: marker.callout, calloutColor: marker.calloutColor });
        parent.children.push(node);
        headingStack.push(node);
        opts.lines?.set(node, lineNo);
        target = { node, buf: noteBuf };
      }
      listStack = [];
      lastListItem = null;
      prevWasBlank = false;
      prevTokenWasHeading = true;
      blankSinceHeading = false;
      continue;
    }

    if (tok.t === "list") {
      const indent = indentWidth(tok.ws);
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      const parent = listStack.length ? listStack[listStack.length - 1].node : headingStack[headingStack.length - 1];
      const { text: withoutId, blockId } = splitBlockId(tok.text);
      const { text, marker } = splitMarker(withoutId);
      const node = createNode({ parent, kind: "list", level: 0, text, color: marker.color, folded: marker.folded, box: marker.box, summary: marker.summary, width: marker.width, side: marker.side, float: marker.float, callout: marker.callout, calloutColor: marker.calloutColor, bullet: tok.bullet, blockId });
      if (/\S {2,}$/.test(tok.text)) node.hardBreak = true;
      // 父节点的子节点后面先来了一段文字、接着又来列表项：那段文字夹在两个列表项之间，是这一项的前置段落
      const pending = tailBuf.get(parent);
      if (pending?.some((l) => l.trim() !== "")) {
        leadBuf.set(node, pending);
        tailBuf.delete(parent);
      }
      parent.children.push(node);
      listStack.push({ indent, node });
      opts.lines?.set(node, lineNo);
      target = { node, buf: noteBuf };
      lastListItem = node;
      if (tok.ws) indents.push(tok.ws);
      bullets.push(tok.bullet);
      if (prevTokenWasHeading && blankBeforeList === null) blankBeforeList = blankSinceHeading;
      prevWasBlank = false;
      prevTokenWasHeading = false;
      continue;
    }

    const raw = tok.raw;
    const blank = raw.trim() === "";
    if (blank) {
      push(target, "");
      prevWasBlank = true;
      if (prevTokenWasHeading) blankSinceHeading = true;
      continue;
    }
    prevTokenWasHeading = false;
    if (listStack.length) {
      const indent = indentWidth(leadingWs(raw));
      if (!prevWasBlank && lastListItem && !interruptsParagraph(raw)) {
        // 紧跟在列表项后面的非空行：懒延续，归该项（能打断段落的块不算，见 interruptsParagraph）
        push({ node: lastListItem, buf: noteBuf }, raw);
      } else {
        while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
        if (listStack.length) {
          const item = listStack[listStack.length - 1].node;
          lastListItem = item;
          // 已经有子列表了：这段在子列表后面，不是备注（备注写在子列表前面，归过去顺序就反了）
          target = { node: item, buf: item.children.length ? tailBuf : noteBuf };
          push(target, raw);
        } else {
          lastListItem = null;
          target = { node: headingStack[headingStack.length - 1], buf: tailBuf };
          push(target, raw);
        }
      }
    } else {
      push(target, raw);
    }
    prevWasBlank = false;
  }

  // 把缓冲区落到节点上
  const finalize = (node: MindNode) => {
    const n = noteBuf.get(node);
    if (n) node.note = joinNote(node.kind === "list" ? dedent(trimBlankLines(n)) : n);
    // 列表项的 tail / lead 带着所在层的缩进，去掉；标题下的不缩进
    const plain = (lines: string[], inList: boolean) => joinNote(inList ? dedent(trimBlankLines(lines)) : lines);
    const t = tailBuf.get(node);
    if (t) node.tail = plain(t, node.kind === "list");
    const l = leadBuf.get(node);
    if (l) node.lead = plain(l, node.parent?.kind === "list");
    for (const c of node.children) finalize(c);
  };
  finalize(root);

  if (!rootFromHeading) {
    const minLevel = root.children.reduce((m, c) => (c.kind === "heading" ? Math.min(m, c.level) : m), 7);
    root.level = minLevel === 7 ? 1 : minLevel - 1;
  }

  const style: DocStyle = {
    ...DEFAULT_STYLE,
    ...opts.style,
    indent: detectIndent(indents) ?? opts.style?.indent ?? DEFAULT_STYLE.indent,
    bullet: mostCommon(bullets.filter((b) => /^[-*+]$/.test(b))) ?? opts.style?.bullet ?? DEFAULT_STYLE.bullet,
    blankBeforeList: blankBeforeList ?? opts.style?.blankBeforeList ?? DEFAULT_STYLE.blankBeforeList,
  };

  return { root, frontmatter, preamble: joinNote(preamble), rootFromHeading, style };
}

function detectIndent(samples: string[]): string | null {
  if (!samples.length) return null;
  if (samples.some((s) => s.includes("\t"))) return "\t";
  const min = Math.min(...samples.map((s) => s.length));
  return " ".repeat(Math.max(1, min));
}

function mostCommon(items: string[]): string | null {
  if (!items.length) return null;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function serializeMarkdown(doc: MindDoc): string {
  normalizeKinds(doc);
  normalizeBoxes(doc.root);
  const out: string[] = [];
  const ensureBlank = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };
  const pushBlock = (text: string) => {
    if (!text) return;
    out.push(...text.split("\n"));
  };

  if (doc.frontmatter) out.push(...doc.frontmatter.split("\n"));
  if (doc.preamble) {
    ensureBlank();
    pushBlock(doc.preamble);
  }

  const { style } = doc;

  const emitHeading = (node: MindNode, level: number) => {
    ensureBlank();
    out.push(`${"#".repeat(level)} ${node.text}`.trimEnd());
    // 标记单独一行写在标题下面，不进标题文字（见解析处的说明）
    const marker = formatMarker(node).trim();
    if (marker) out.push(marker);
    if (node.note) {
      ensureBlank();
      pushBlock(normalizeNote(node.note, false));
    }
    const kids = node.children;
    const headingKids = kids.filter((c) => c.kind === "heading" && level < 6);
    // 列表子节点先于标题子节点写出（标题会吞掉后面所有列表，顺序只能如此）
    const listKids = kids.filter((c) => !headingKids.includes(c));
    if (listKids.length) {
      if (node.note || style.blankBeforeList) ensureBlank();
      for (const c of listKids) emitList(c, 0);
    }
    if (node.tail) {
      ensureBlank();
      pushBlock(normalizeNote(node.tail, false));
    }
    for (const c of headingKids) emitHeading(c, level + 1);
  };

  /** 一段属于某一层的文字（列表项里的要缩进到那一层），前后空一行，和列表分开 */
  const emitBlock = (text: string, depth: number) => {
    ensureBlank();
    for (const l of normalizeNote(text, depth > 0).split("\n")) out.push(l === "" ? "" : `${style.indent.repeat(depth)}${l}`);
    ensureBlank();
  };

  const emitList = (node: MindNode, depth: number) => {
    if (node.lead) emitBlock(node.lead, depth);
    const bullet = node.bullet || style.bullet;
    const blockId = node.blockId ? ` ^${node.blockId}` : "";
    out.push(`${style.indent.repeat(depth)}${bullet} ${node.text}${formatMarker(node)}${blockId}`.trimEnd() + (node.hardBreak ? "  " : ""));
    if (node.note) {
      for (const l of normalizeNote(node.note).split("\n")) out.push(l === "" ? "" : `${style.indent.repeat(depth + 1)}${l}`);
    }
    for (const c of node.children) emitList(c, depth + 1);
    if (node.tail) emitBlock(node.tail, depth + 1);
  };

  const root = doc.root;
  if (doc.rootFromHeading) {
    emitHeading(root, 1);
  } else {
    if (root.note) {
      ensureBlank();
      pushBlock(normalizeNote(root.note, false));
    }
    const level = Math.max(1, root.level + 1);
    const headingKids = root.children.filter((c) => c.kind === "heading");
    const listKids = root.children.filter((c) => c.kind !== "heading");
    if (listKids.length) {
      if (root.note) ensureBlank();
      for (const c of listKids) emitList(c, 0);
    }
    if (root.tail) {
      ensureBlank();
      pushBlock(normalizeNote(root.tail, false));
    }
    for (const c of headingKids) emitHeading(c, Math.min(level, 6));
  }

  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

/** 让树里每个节点的 kind/level 与其位置一致：标题不能深过 6 级，标题下的列表保持列表 */
export function normalizeKinds(doc: MindDoc): void {
  const fix = (node: MindNode, parentLevel: number, parentIsHeading: boolean) => {
    if (node.kind === "heading") {
      if (!parentIsHeading || parentLevel >= 6) node.kind = "list";
      else node.level = parentLevel + 1;
    }
    for (const c of node.children) fix(c, node.level, node.kind === "heading");
  };
  const rootLevel = doc.rootFromHeading ? 1 : doc.root.level;
  doc.root.level = rootLevel;
  for (const c of doc.root.children) fix(c, rootLevel, true);
}

/** 把某个节点的整层兄弟统一改成标题或列表；返回是否可行 */
export function convertLevelKind(node: MindNode, kind: NodeKind, style: DocStyle): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (kind === "heading") {
    if (parent.kind !== "heading" || parent.level + 1 > 6) return false;
    for (const c of parent.children) {
      c.kind = "heading";
      c.level = parent.level + 1;
    }
  } else {
    for (const c of parent.children) c.kind = "list";
  }
  void style;
  return true;
}

export function frontmatterValue(frontmatter: string, key: string): string | null {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:[ \\t]*(.*?)[ \\t]*$`, "m");
  const m = re.exec(frontmatter);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/** 设置或替换 frontmatter 里的一个标量键 */
export function setFrontmatterValue(frontmatter: string, key: string, value: string | null): string {
  const lines = frontmatter ? frontmatter.split("\n") : ["---", "---"];
  const body = lines.slice(1, -1).filter((l) => !new RegExp(`^${key}:`).test(l));
  if (value !== null) body.push(`${key}: ${value}`);
  if (body.length === 0) return "";
  return ["---", ...body, "---"].join("\n");
}

/**
 * 新建脑图的模板：替换 {{title}} {{date}} {{time}}，也认 {{date:YYYY-MM-DD}} 这种带格式的写法，
 * 和核心插件「模板」一样；format 按 moment 的格式串出日期。其余文字原样保留（Templater 的 <% %> 交给它自己处理）
 */
export function fillTemplate(template: string, title: string, format: (pattern: string) => string): string {
  return template.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_, key: string, pattern?: string) => {
    const k = key.toLowerCase();
    if (k === "title") return title;
    return format(pattern?.trim() || (k === "date" ? "YYYY-MM-DD" : "HH:mm"));
  });
}

/** 往文本的 frontmatter 里补上几个键（没有 frontmatter 就新建一个）；keep 里的键已经有了就不动 */
export function withFrontmatter(content: string, values: [key: string, value: string][], keep: string[] = []): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  let fm = m ? m[0].replace(/\r?\n$/, "").replace(/\r\n/g, "\n") : "";
  const rest = m ? content.slice(m[0].length) : content;
  for (const [key, value] of values) {
    if (keep.includes(key) && frontmatterValue(fm, key) !== null) continue;
    fm = setFrontmatterValue(fm, key, value);
  }
  return `${fm}\n${m ? "" : "\n"}${rest}`;
}

// ---------- 节点 ⇄ 行号 ----------
// 脑图和 Markdown 之间来回跳：节点用路径（pathOf）标识，按同一份文本重新解析一遍就能对上行号

/** 路径对应的节点在文本里的行号（0 起）；没有一级标题时根节点没有自己的行，给正文第一行 */
export function lineOfPath(src: string, path: string, rule: RootRule = {}): number | null {
  const lines = new Map<MindNode, number>();
  const doc = parseMarkdown(src, { lines, ...rule });
  const node = findByPath(doc.root, path);
  if (!node) return null;
  const line = lines.get(node);
  if (line !== undefined) return line;
  if (node === doc.root) return doc.frontmatter ? doc.frontmatter.split("\n").length : 0;
  return null;
}

/** 某一行属于哪个节点（节点行，或它下面的备注 / 段落）；在 frontmatter 或第一个节点之前返回 null */
export function pathAtLine(src: string, line: number, rule: RootRule = {}): string | null {
  const lines = new Map<MindNode, number>();
  parseMarkdown(src, { lines, ...rule });
  let best: MindNode | null = null;
  let bestLine = -1;
  for (const [node, l] of lines) {
    if (l <= line && l > bestLine) {
      best = node;
      bestLine = l;
    }
  }
  return best ? pathOf(best) : null;
}
