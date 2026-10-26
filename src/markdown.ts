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
  // x= / y= 只跟着 float 出现；单独出现说明不是我们的标记，整段当普通文字
  if (!isFloat && (fx !== undefined || fy !== undefined)) return { text: text.trimEnd(), marker: { folded: false } };
  if (isFloat) marker.float = { x: fx ?? 0, y: fy ?? 0 };
  return { text: text.slice(0, m.index).trimEnd(), marker };
}

export function formatMarker(node: Pick<MindNode, "color" | "folded" | "box" | "summary" | "width" | "side" | "float" | "callout">): string {
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
  | { t: "list"; ws: string; bullet: string; text: string }
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
      out.push({ t: "list", ws: l[1], bullet: l[2], text: l[3] });
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

/** 备注里是否有会被解析成节点的行（代码块内的不算） */
export function noteNeedsEscape(note: string): boolean {
  if (!note) return false;
  return tokenize(note.split("\n")).some((t) => t.t === "heading" || t.t === "list");
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
export function normalizeNote(plain: string): string {
  return noteNeedsEscape(plain) ? escapeNote(plain) : plain;
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

export interface ParseOptions {
  /** 没有一级标题时用作根节点标签（通常是文件名） */
  fallbackTitle?: string;
  style?: Partial<DocStyle>;
  /** 传进来就记下每个节点在源文本里的行号（0 起，含 frontmatter） */
  lines?: Map<MindNode, number>;
}

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
  const rootFromHeading = h1Count === 1 && firstHeading?.t === "heading" && firstHeading.level === 1;

  const preamble: string[] = [];
  const headingStack: MindNode[] = [root];
  let listStack: { indent: number; node: MindNode }[] = [];
  const noteBuf = new Map<MindNode, string[]>();
  const tailBuf = new Map<MindNode, string[]>();
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
    const tok = tokens[ti];
    // tokenize 一行出一个 token，所以 token 序号加上 frontmatter 的行数就是源文本行号
    const lineNo = start + ti;
    if (tok.t === "heading") {
      const { text, marker } = splitMarker(tok.text);
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
        const node = createNode({ parent, kind: "heading", level: tok.level, text, color: marker.color, folded: marker.folded, box: marker.box, summary: marker.summary, width: marker.width, side: marker.side, float: marker.float, callout: marker.callout });
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
      const node = createNode({ parent, kind: "list", level: 0, text, color: marker.color, folded: marker.folded, box: marker.box, summary: marker.summary, width: marker.width, side: marker.side, float: marker.float, callout: marker.callout, bullet: tok.bullet, blockId });
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
      if (!prevWasBlank && lastListItem) {
        // 紧跟在列表项后面的非空行：懒延续，归该项
        push({ node: lastListItem, buf: noteBuf }, raw);
      } else {
        while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
        if (listStack.length) {
          const item = listStack[listStack.length - 1].node;
          lastListItem = item;
          target = { node: item, buf: noteBuf };
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
    const t = tailBuf.get(node);
    if (t) node.tail = joinNote(t);
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
    out.push(`${"#".repeat(level)} ${node.text}${formatMarker(node)}`.trimEnd());
    if (node.note) {
      ensureBlank();
      pushBlock(normalizeNote(node.note));
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
      pushBlock(normalizeNote(node.tail));
    }
    for (const c of headingKids) emitHeading(c, level + 1);
  };

  const emitList = (node: MindNode, depth: number) => {
    const bullet = node.bullet || style.bullet;
    const blockId = node.blockId ? ` ^${node.blockId}` : "";
    out.push(`${style.indent.repeat(depth)}${bullet} ${node.text}${formatMarker(node)}${blockId}`.trimEnd());
    if (node.note) {
      for (const l of normalizeNote(node.note).split("\n")) out.push(l === "" ? "" : `${style.indent.repeat(depth + 1)}${l}`);
    }
    for (const c of node.children) emitList(c, depth + 1);
  };

  const root = doc.root;
  if (doc.rootFromHeading) {
    emitHeading(root, 1);
  } else {
    if (root.note) {
      ensureBlank();
      pushBlock(normalizeNote(root.note));
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
      pushBlock(normalizeNote(root.tail));
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

// ---------- 节点 ⇄ 行号 ----------
// 脑图和 Markdown 之间来回跳：节点用路径（pathOf）标识，按同一份文本重新解析一遍就能对上行号

/** 路径对应的节点在文本里的行号（0 起）；没有一级标题时根节点没有自己的行，给正文第一行 */
export function lineOfPath(src: string, path: string): number | null {
  const lines = new Map<MindNode, number>();
  const doc = parseMarkdown(src, { lines });
  const node = findByPath(doc.root, path);
  if (!node) return null;
  const line = lines.get(node);
  if (line !== undefined) return line;
  if (node === doc.root) return doc.frontmatter ? doc.frontmatter.split("\n").length : 0;
  return null;
}

/** 某一行属于哪个节点（节点行，或它下面的备注 / 段落）；在 frontmatter 或第一个节点之前返回 null */
export function pathAtLine(src: string, line: number): string | null {
  const lines = new Map<MindNode, number>();
  parseMarkdown(src, { lines });
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
