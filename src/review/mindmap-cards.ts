/**
 * 题目来源（脑图）：背诵模式里写的题变成复习卡片。纯函数，不碰 Obsidian，单测直接跑。
 * - 节点里有 ==高亮==（或 <mark>）：填空卡，挂在这个节点
 * - 子节点是 [x] / [ ] 的：选择题，挂在题目节点
 * - 带 🙈 的节点：问答卡，正面是它的上级，挂在 🙈 节点（一个上级下几个 🙈 就是几张）
 * 卡片按节点上的 %%rv=…%% 认（改字、挪位置都跟着）；还没有的由 assignReviewIds 补上。
 * 整张图加入复习写 frontmatter mindmap-review；只加入分支的在分支节点写 %%review%%。
 */
import { isAnswer, splitMarkers, taskState } from "../inline";
import { frontmatterValue } from "../markdown";
import type { MindDoc, MindNode } from "../model";

export const REVIEW_KEY = "mindmap-review";

export type CardKind = "cloze" | "choice" | "answer";

export interface MapCard {
  kind: CardKind;
  node: MindNode;
  /** 卡片 id：节点的 rv 加类型（k3j9x2:c）；节点还没有 rv 时为 null */
  id: string | null;
  /** 在图里的先后（新卡按它出） */
  order: number;
}

const KIND_CODE: Record<CardKind, string> = { cloze: "c", choice: "q", answer: "a" };

/** 节点里有没有能挖空的高亮：==文字==、==🔴文字==、<mark …>文字</mark> */
const CLOZE_RE = /==(?!\s)[^=\n]+?==|<mark\b[^>]*>[\s\S]*?<\/mark>/i;
export function hasCloze(text: string): boolean {
  return CLOZE_RE.test(splitMarkers(text).rest);
}

/** frontmatter 里的牌组 id；没加入复习返回 null，写的是 true（手写的）返回 "" */
export function deckIdOf(frontmatter: string): string | null {
  const v = frontmatterValue(frontmatter, REVIEW_KEY);
  if (v === null) return null;
  const s = v.trim().replace(/^["']|["']$/g, "");
  if (!s || s === "false") return null;
  return /^[a-z0-9]{4,32}$/i.test(s) && s !== "true" ? s : "";
}

/** 只加入了几个分支（有节点写了 %%review%%）：返回这些分支；整张图加入返回 null */
export function reviewBranches(doc: MindDoc): MindNode[] | null {
  const out: MindNode[] = [];
  const walk = (n: MindNode) => {
    if (n.review) out.push(n);
    for (const c of n.children) walk(c);
    if (n.summary?.topic) walk(n.summary.topic);
  };
  walk(doc.root);
  return out.length ? out : null;
}

/** 按图里的顺序列出卡片。只加入了分支时只看这些分支 */
export function extractCards(doc: MindDoc): MapCard[] {
  const branches = reviewBranches(doc);
  const out: MapCard[] = [];
  let order = 0;
  const seen = new Set<string>();
  const add = (kind: CardKind, node: MindNode) => {
    let id = node.reviewId ? `${node.reviewId}:${KIND_CODE[kind]}` : null;
    // 复制粘贴出来的节点带着同一个 rv：后出现的当成还没有，补 id 时换新的
    if (id && seen.has(id)) id = null;
    if (id) seen.add(id);
    out.push({ kind, node, id, order: order++ });
  };
  // inside：在 🙈 答案或选择题选项下面（这些内容是别的卡的背面，里面的高亮、题目不单独出）
  const walk = (n: MindNode, inScope: boolean, inside: boolean) => {
    const scope = inScope || !!n.review;
    const answer = isAnswer(n.text);
    const option = !!n.parent && !!taskState(n.text);
    if (scope && !inside) {
      if (isQuestion(n)) add("choice", n);
      if (answer && n.parent) add("answer", n);
      if (!answer && !option && hasCloze(n.text)) add("cloze", n);
    }
    const deeper = inside || answer || option;
    for (const c of n.children) walk(c, scope, deeper);
    if (n.summary?.topic) walk(n.summary.topic, scope, deeper);
  };
  walk(doc.root, branches === null, false);
  return out;
}

/** 子节点里有 [x] / [ ] 的就是选择题 */
export function isQuestion(n: MindNode): boolean {
  return n.children.some((c) => !!taskState(c.text));
}

/** 多选：正确选项不止一个 */
export function isMultiChoice(n: MindNode): boolean {
  return n.children.filter((c) => taskState(c.text) === "done").length > 1;
}

/** 新的卡片 id：6 位小写字母数字 */
export function newReviewId(taken: Set<string>): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < 6; i++) s += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)];
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
}

/** 还没有 id、或和前面的重复了的卡片节点补上新的 rv；改了返回 true */
export function assignReviewIds(doc: MindDoc): boolean {
  const cards = extractCards(doc);
  const taken = new Set<string>();
  const walk = (n: MindNode) => {
    if (n.reviewId) taken.add(n.reviewId);
    n.children.forEach(walk);
    if (n.summary?.topic) walk(n.summary.topic);
  };
  walk(doc.root);
  // 同一个节点可能有两张卡（题目里又有高亮）：一个节点只换一次
  const owner = new Map<string, MindNode>();
  let changed = false;
  for (const c of cards) {
    const rv = c.node.reviewId;
    const dup = rv !== undefined && owner.has(rv) && owner.get(rv) !== c.node;
    if (!rv || dup) {
      c.node.reviewId = newReviewId(taken);
      changed = true;
    }
    owner.set(c.node.reviewId!, c.node);
  }
  return changed;
}

/** 卡片上显示的文字：去掉开头的标记图标和 [x] */
export function displayText(text: string): string {
  return splitMarkers(text).rest.replace(/^\[( |x|X)\]\s+/, "");
}

/** 顶栏的路径：中心主题 › … › 上级（纯文字） */
export function crumbOf(node: MindNode): string[] {
  const out: string[] = [];
  for (let p = node.parent; p; p = p.parent) out.unshift(plain(displayText(p.text)));
  return out;
}

/** 去掉常见的 Markdown 记号，路径里显示 */
export function plain(md: string): string {
  return md
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[\[[^\]]*\]\]/g, "🖼")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~|\*|_|`)/g, "")
    .trim();
}
