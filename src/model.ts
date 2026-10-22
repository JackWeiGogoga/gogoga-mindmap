/**
 * 思维导图的内存模型。Markdown 是唯一数据源，这里只是它的树形视图；
 * 所有编辑操作先改树，再整棵序列化回 Markdown。
 */

export type NodeKind = "heading" | "list";

export interface MindNode {
  /** 会话内稳定的 id，重新解析后会变；跨解析请用 pathOf() */
  id: string;
  /** 标签的原始行内 Markdown（不含 %% 标记） */
  text: string;
  /** 标签下面的备注（原始 Markdown，已去掉首尾空行），无则为空串 */
  note: string;
  /** 仅标题节点：列表子节点之后、下一个标题之前的段落 */
  tail: string;
  /** 颜色名或 #hex，来自 %%red%% 这类标记 */
  color?: string;
  /** 折叠状态，用 %%fold%% 持久化 */
  folded: boolean;
  /** 外框：框住本节点及其后 span-1 个兄弟（连同各自的分支），用 %%box%% / %%box=3 "标题"%% 持久化 */
  box?: Boundary;
  /** 概要：本节点及其后 span-1 个兄弟外侧画一个大括号，挂一段概括文字；%%summary=3 "文字"%% */
  summary?: Summary;
  /** 手动拖出来的节点宽度（px），文字按它换行；用 %%w=240%% 持久化，没有就按内容自适应 */
  width?: number;
  /** 思维导图结构里主主题固定在哪一边；%%left%% / %%right%%，没有就按数量自动分 */
  side?: "left" | "right";
  kind: NodeKind;
  /** 标题节点的级别 1..6；合成根节点为最小标题级别 - 1 */
  level: number;
  /** 列表节点的原始项目符号（"-"、"*"、"1." 等），新节点为空则用文档默认值 */
  bullet: string;
  /** Obsidian 块引用 id（列表项末尾的 ^abc123），用于 [[笔记#^id]] */
  blockId?: string;
  children: MindNode[];
  parent: MindNode | null;
  depth: number;
}

export const NODE_MIN_WIDTH = 60;
export const NODE_MAX_WIDTH = 1200;

export interface Boundary {
  /** 框住的兄弟数，含本节点，至少 1 */
  span: number;
  title: string;
}

export interface Summary {
  /** 括住的兄弟数，含本节点，至少 1 */
  span: number;
  text: string;
}

export interface DocStyle {
  /** 列表缩进单位："\t" 或若干空格 */
  indent: string;
  /** 新列表节点的项目符号 */
  bullet: string;
  /** 标题与其下列表之间是否空一行 */
  blankBeforeList: boolean;
  /** 深于这个级别的标题节点，新建子节点时改用列表 */
  maxHeadingLevel: number;
}

export interface MindDoc {
  root: MindNode;
  /** 原始 frontmatter（含两行 ---），不含结尾换行；无则空串 */
  frontmatter: string;
  /** frontmatter 与 H1 之间的文本（罕见），原样保留 */
  preamble: string;
  /** 根节点是否来自文件里的一级标题 */
  rootFromHeading: boolean;
  style: DocStyle;
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `n${counter}`;
}

export function createNode(init: Partial<MindNode> & { parent: MindNode | null }): MindNode {
  const parent = init.parent;
  const node: MindNode = {
    id: init.id ?? newId(),
    text: init.text ?? "",
    note: init.note ?? "",
    tail: init.tail ?? "",
    color: init.color,
    folded: init.folded ?? false,
    box: init.box,
    summary: init.summary,
    width: init.width,
    side: init.side,
    kind: init.kind ?? "list",
    level: init.level ?? 0,
    bullet: init.bullet ?? "",
    blockId: init.blockId,
    children: init.children ?? [],
    parent,
    depth: parent ? parent.depth + 1 : 0,
  };
  return node;
}

/** 深度优先遍历（含自身），folded 节点的子树不跳过 */
export function walk(node: MindNode, fn: (n: MindNode) => void): void {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

/** 外框 / 概要的跨度不能超出后面剩下的兄弟（删掉兄弟后收窄）；根节点没有兄弟 */
export function normalizeBoxes(root: MindNode): void {
  walk(root, (n) => {
    if (!n.box && !n.summary) return;
    const siblings = n.parent?.children;
    const rest = siblings ? siblings.length - siblings.indexOf(n) : 1;
    if (n.box) n.box.span = Math.max(1, Math.min(n.box.span, rest));
    if (n.summary) n.summary.span = Math.max(1, Math.min(n.summary.span, rest));
  });
}

/**
 * 一组兄弟里的外框：返回 节点 id → 所属外框的起始节点。
 * 起始节点落在前一个外框范围里的那个外框忽略（同一层不嵌套，跨层可以）。
 */
export function boxGroups(siblings: MindNode[]): Map<string, MindNode> {
  const out = new Map<string, MindNode>();
  for (let i = 0; i < siblings.length; i++) {
    const start = siblings[i];
    if (!start.box || out.has(start.id)) continue;
    const end = Math.min(siblings.length, i + Math.max(1, start.box.span));
    for (let j = i; j < end; j++) out.set(siblings[j].id, start);
  }
  return out;
}

/** 同 boxGroups，换成概要：节点 id → 所属概要的起始节点 */
export function summaryGroups(siblings: MindNode[]): Map<string, MindNode> {
  const out = new Map<string, MindNode>();
  for (let i = 0; i < siblings.length; i++) {
    const start = siblings[i];
    if (!start.summary || out.has(start.id)) continue;
    const end = Math.min(siblings.length, i + Math.max(1, start.summary.span));
    for (let j = i; j < end; j++) out.set(siblings[j].id, start);
  }
  return out;
}

export function visibleChildren(node: MindNode): MindNode[] {
  return node.folded ? [] : node.children;
}

/** 跨解析稳定的定位键：子节点下标路径，如 "0/2/1"；根为 "" */
export function pathOf(node: MindNode): string {
  const parts: number[] = [];
  let cur = node;
  while (cur.parent) {
    parts.unshift(cur.parent.children.indexOf(cur));
    cur = cur.parent;
  }
  return parts.join("/");
}

export function findByPath(root: MindNode, path: string): MindNode | null {
  if (path === "") return root;
  let cur: MindNode | undefined = root;
  for (const p of path.split("/")) {
    cur = cur?.children[Number(p)];
    if (!cur) return null;
  }
  return cur;
}

export function findById(root: MindNode, id: string): MindNode | null {
  let found: MindNode | null = null;
  walk(root, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

export function countDescendants(node: MindNode): number {
  let n = 0;
  walk(node, () => n++);
  return n - 1;
}

export function isAncestor(maybeAncestor: MindNode, node: MindNode): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = cur.parent;
  }
  return false;
}

function refreshDepth(node: MindNode): void {
  walk(node, (n) => {
    n.depth = n.parent ? n.parent.depth + 1 : 0;
  });
}

/** 新节点应当以标题还是列表写回：先跟随兄弟，否则看父节点能否再降一级标题 */
export function kindForNewChild(parent: MindNode, style: DocStyle): { kind: NodeKind; level: number } {
  const sibling = parent.children[0];
  if (sibling) return { kind: sibling.kind, level: sibling.level };
  if (parent.kind === "heading" && parent.level + 1 <= Math.min(6, style.maxHeadingLevel)) {
    return { kind: "heading", level: parent.level + 1 };
  }
  return { kind: "list", level: 0 };
}

export function addChild(parent: MindNode, style: DocStyle, text = "", index?: number): MindNode {
  const { kind, level } = kindForNewChild(parent, style);
  const node = createNode({ parent, text, kind, level });
  const at = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(at, 0, node);
  return node;
}

export function addSibling(node: MindNode, text = "", after = true): MindNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const idx = parent.children.indexOf(node);
  const sibling = createNode({ parent, text, kind: node.kind, level: node.level, bullet: node.bullet });
  parent.children.splice(after ? idx + 1 : idx, 0, sibling);
  return sibling;
}

export function removeNode(node: MindNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const idx = parent.children.indexOf(node);
  if (idx < 0) return false;
  parent.children.splice(idx, 1);
  node.parent = null;
  return true;
}

/** 移动节点到新父节点的 index 位置；禁止移到自己的子树里 */
export function moveNode(node: MindNode, newParent: MindNode, index: number, style: DocStyle): boolean {
  if (node === newParent || isAncestor(node, newParent) || !node.parent) return false;
  const oldParent = node.parent;
  const oldIdx = oldParent.children.indexOf(node);
  oldParent.children.splice(oldIdx, 1);
  if (oldParent === newParent && index > oldIdx) index -= 1;
  const at = Math.max(0, Math.min(index, newParent.children.length));
  newParent.children.splice(at, 0, node);
  node.parent = newParent;
  const { kind, level } = kindForNewChild(newParent, style);
  // 换了父节点后，写回方式跟随新位置的兄弟；子树里的标题级别在序列化时统一重算
  const ref = newParent.children.find((c) => c !== node);
  node.kind = ref ? ref.kind : kind;
  node.level = ref ? ref.level : level;
  refreshDepth(node);
  return true;
}

/** 父节点之下应当用什么写法：不看兄弟，只看父节点 */
function kindBelow(parent: MindNode, style: DocStyle): { kind: NodeKind; level: number } {
  if (parent.kind === "heading" && parent.level + 1 <= Math.min(6, style.maxHeadingLevel)) {
    return { kind: "heading", level: parent.level + 1 };
  }
  return { kind: "list", level: 0 };
}

/** 把一棵游离的子树（粘贴、导入得到的）挂到 parent 下，并按新位置重算 kind/level/depth */
export function attachSubtree(node: MindNode, parent: MindNode, style: DocStyle, index?: number): void {
  const top = kindForNewChild(parent, style);
  node.parent = parent;
  const at = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(at, 0, node);
  node.kind = top.kind;
  node.level = top.level;
  node.depth = parent.depth + 1;
  const fix = (n: MindNode) => {
    const k = kindBelow(n, style);
    for (const c of n.children) {
      c.parent = n;
      c.kind = k.kind;
      c.level = k.level;
      c.depth = n.depth + 1;
      fix(c);
    }
  };
  fix(node);
}

/** 深拷贝一棵子树（不含 parent 指针的循环），用于历史或测试 */
export function cloneTree(node: MindNode, parent: MindNode | null = null): MindNode {
  const copy = createNode({
    parent,
    text: node.text,
    note: node.note,
    tail: node.tail,
    color: node.color,
    folded: node.folded,
    box: node.box && { ...node.box },
    summary: node.summary && { ...node.summary },
    width: node.width,
    side: node.side,
    kind: node.kind,
    level: node.level,
    bullet: node.bullet,
    blockId: node.blockId,
  });
  copy.children = node.children.map((c) => cloneTree(c, copy));
  return copy;
}
