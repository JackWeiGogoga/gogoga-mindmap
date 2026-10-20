/**
 * 布局引擎：不依赖 DOM，节点尺寸由调用方测量后传入。
 *
 *   logic-right  逻辑图（向右）：子节点垂直堆叠在父节点右侧，对父节点居中
 *   mindmap      思维导图：主主题左右分布，顺时针
 *   org-down     组织结构图：子节点水平排在父节点下方
 *   tree-right   树形图：子节点在父节点下方向右缩进，像文件树
 */

import { t } from "./i18n";
import { boxGroups, MindNode, visibleChildren } from "./model";

export type Structure = "logic-right" | "mindmap" | "org-down" | "tree-right";
/** label 是 getter：模块加载时界面语言还没定，用到时再取 */
export const STRUCTURES: { id: Structure; readonly label: string }[] = [
  { id: "logic-right", get label() { return t("structure.logicRight"); } },
  { id: "mindmap", get label() { return t("structure.mindmap"); } },
  { id: "org-down", get label() { return t("structure.orgDown"); } },
  { id: "tree-right", get label() { return t("structure.treeRight"); } },
];
export function isStructure(s: unknown): s is Structure {
  return STRUCTURES.some((x) => x.id === s);
}

/** 子节点相对父节点的方向；连线和折叠徽章都按它画 */
export type Side = "right" | "left" | "down" | "tree";

export interface Size {
  w: number;
  h: number;
}

export interface LayoutOptions {
  structure: Structure;
  /** 根节点到主主题的距离 */
  gapRoot: number;
  /** 其余层级之间的距离 */
  gapLevel: number;
  /** 兄弟节点之间的距离 */
  gapSibling: number;
  /** 主主题之间的距离 */
  gapMain: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  structure: "logic-right",
  gapRoot: 96,
  gapLevel: 36,
  gapSibling: 12,
  gapMain: 40,
};

/** 树形图的缩进；连线的竖干画在缩进的一半处 */
export const TREE_INDENT = 32;

/** 外框到框内内容的留白；有标题时顶部再多留一行 */
export const BOX_PAD = 10;
export const BOX_TITLE_H = 24;

export interface Placed {
  node: MindNode;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedBox extends Bounds {
  /** 外框的起始节点（%%box%% 标记所在的节点） */
  start: MindNode;
  members: MindNode[];
  side: Side;
}

export interface LayoutResult {
  placed: Map<string, Placed>;
  /** 由内向外排列：先画外层再画内层时倒着遍历 */
  boxes: PlacedBox[];
  bounds: Bounds;
}

/**
 * 思维导图结构里主主题的左右分配：标了 %%left%% / %%right%% 的固定在那一边，
 * 其余按文档顺序先填右边、填满一半再放左边（全都没标时就是以前的「前一半在右」）
 */
export function splitSides(kids: MindNode[]): { right: MindNode[]; left: MindNode[] } {
  const half = Math.ceil(kids.length / 2);
  let r = kids.filter((k) => k.side === "right").length;
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  for (const k of kids) {
    if (k.side === "right") right.push(k);
    else if (k.side === "left") left.push(k);
    else if (r < half) {
      right.push(k);
      r++;
    } else left.push(k);
  }
  return { right, left };
}

export function layoutTree(root: MindNode, measure: (node: MindNode) => Size, opts: LayoutOptions): LayoutResult {
  const sizes = new Map<string, Size>();
  const extents = new Map<string, number>();
  const placed = new Map<string, Placed>();
  /** 相对布局根的深度：聚焦某个分支时它就是根 */
  const depthOf = (n: MindNode) => n.depth - root.depth;

  const sizeOf = (n: MindNode): Size => {
    let s = sizes.get(n.id);
    if (!s) {
      s = measure(n);
      sizes.set(n.id, s);
    }
    return s;
  };

  // ---- 外框：一组相邻兄弟占的空间在堆叠方向上前后各多留 BOX_PAD（有标题再加一行） ----
  const groupCache = new Map<string, Map<string, MindNode>>();
  const groupOf = (n: MindNode): MindNode | undefined => {
    const p = n.parent;
    if (!p || n === root) return undefined;
    let g = groupCache.get(p.id);
    if (!g) {
      g = boxGroups(p.children);
      groupCache.set(p.id, g);
    }
    return g.get(n.id);
  };
  const boxTop = (start: MindNode) => BOX_PAD + (start.box?.title ? BOX_TITLE_H : 0);
  /** list 按排布顺序；before[i]/after[i] 是第 i 个节点前后要让出的外框留白 */
  function boxPads(list: MindNode[]): { before: number[]; after: number[] } {
    const gs = list.map(groupOf);
    return {
      before: gs.map((g, i) => (g && g !== gs[i - 1] ? boxTop(g) : 0)),
      after: gs.map((g, i) => (g && g !== gs[i + 1] ? BOX_PAD : 0)),
    };
  }
  const padTotal = (list: MindNode[]) => {
    const { before, after } = boxPads(list);
    return before.reduce((a, b) => a + b, 0) + after.reduce((a, b) => a + b, 0);
  };
  /** 横向排布：每段外框左右各 BOX_PAD */
  const sidePads = (list: MindNode[]) => {
    const gs = list.map(groupOf);
    return gs.reduce((sum, g, i) => sum + (g && g !== gs[i - 1] ? 2 * BOX_PAD : 0), 0);
  };
  /** 父节点 id → 它子节点里的外框（按排布顺序，一段连续的同组兄弟为一个） */
  const runs = new Map<string, { start: MindNode; members: MindNode[]; side: Side }[]>();
  function recordRuns(parent: MindNode, list: MindNode[], side: Side): void {
    let cur: { start: MindNode; members: MindNode[]; side: Side } | null = null;
    for (const c of list) {
      const g = groupOf(c);
      if (!g) {
        cur = null;
        continue;
      }
      if (!cur || cur.start !== g) {
        cur = { start: g, members: [], side };
        const arr = runs.get(parent.id) ?? [];
        arr.push(cur);
        runs.set(parent.id, arr);
      }
      cur.members.push(c);
    }
  }

  const rs = sizeOf(root);
  placed.set(root.id, { node: root, x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: "right" });
  const kids = visibleChildren(root);

  if (opts.structure === "org-down") {
    layoutDown(root, kids);
  } else if (opts.structure === "tree-right") {
    layoutTreeRight(root, kids);
  } else if (opts.structure === "mindmap" && (kids.length > 1 || kids.some((k) => k.side === "left"))) {
    const { right, left } = splitSides(kids);
    placeColumn(root, right, "right", 0);
    // 左侧顺时针：从下往上排，所以堆叠顺序取反
    placeColumn(root, left.reverse(), "left", 0);
  } else {
    placeColumn(root, kids, "right", 0);
  }

  // ---- 水平结构：子树高度自底向上，子节点垂直堆叠并对父节点居中 ----
  function gapFor(parent: MindNode): number {
    return depthOf(parent) === 0 ? opts.gapMain : opts.gapSibling;
  }
  function extentOfList(nodes: MindNode[], gap: number): number {
    return nodes.reduce((sum, c, i) => sum + extentH(c) + (i > 0 ? gap : 0), 0) + padTotal(nodes);
  }
  function extentH(n: MindNode): number {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const own = sizeOf(n).h;
    const k = visibleChildren(n);
    const e = k.length ? Math.max(own, extentOfList(k, gapFor(n))) : own;
    extents.set(n.id, e);
    return e;
  }
  function placeColumn(parent: MindNode, list: MindNode[], side: Side, cy: number): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    const gapH = depthOf(parent) === 0 ? opts.gapRoot : opts.gapLevel;
    const gapV = gapFor(parent);
    let y = cy - extentOfList(list, gapV) / 2;
    const { before, after } = boxPads(list);
    recordRuns(parent, list, side);
    list.forEach((c, i) => {
      y += before[i];
      const s = sizeOf(c);
      const e = extentH(c);
      const ccy = y + e / 2;
      const x = side === "right" ? p.x + p.w + gapH : p.x - gapH - s.w;
      placed.set(c.id, { node: c, x, y: ccy - s.h / 2, w: s.w, h: s.h, side });
      placeColumn(c, visibleChildren(c), side, ccy);
      y += e + after[i] + gapV;
    });
  }

  // ---- 组织结构图：子树宽度自底向上，子节点水平排在父节点下方并居中 ----
  function hGapFor(parent: MindNode): number {
    return depthOf(parent) === 0 ? opts.gapMain : opts.gapSibling * 2;
  }
  function extentW(n: MindNode): number {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const own = sizeOf(n).w;
    const k = visibleChildren(n);
    const e = k.length ? Math.max(own, k.reduce((sum, c, i) => sum + extentW(c) + (i > 0 ? hGapFor(n) : 0), 0) + sidePads(k)) : own;
    extents.set(n.id, e);
    return e;
  }
  function layoutDown(parent: MindNode, list: MindNode[]): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    const gapV = depthOf(parent) === 0 ? Math.round(opts.gapRoot * 0.6) : opts.gapLevel + 8;
    const gapX = hGapFor(parent);
    const total = list.reduce((sum, c, i) => sum + extentW(c) + (i > 0 ? gapX : 0), 0) + sidePads(list);
    let x = p.x + p.w / 2 - total / 2;
    const y = p.y + p.h + gapV;
    // 横向排布时标题在框顶，不占横向空间，左右只留 BOX_PAD
    const gs = list.map(groupOf);
    recordRuns(parent, list, "down");
    list.forEach((c, i) => {
      if (gs[i] && gs[i] !== gs[i - 1]) x += BOX_PAD;
      const s = sizeOf(c);
      const e = extentW(c);
      const ccx = x + e / 2;
      placed.set(c.id, { node: c, x: ccx - s.w / 2, y, w: s.w, h: s.h, side: "down" });
      layoutDown(c, visibleChildren(c));
      x += e + gapX + (gs[i] && gs[i] !== gs[i + 1] ? BOX_PAD : 0);
    });
  }

  // ---- 树形图：子节点在父节点下方向右缩进，逐个向下堆叠 ----
  function treeExtent(n: MindNode): number {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const k = visibleChildren(n);
    const e = sizeOf(n).h + k.reduce((sum, c) => sum + opts.gapSibling + treeExtent(c), 0) + padTotal(k);
    extents.set(n.id, e);
    return e;
  }
  function layoutTreeRight(parent: MindNode, list: MindNode[]): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    let y = p.y + p.h + opts.gapSibling;
    const x = p.x + TREE_INDENT;
    const { before, after } = boxPads(list);
    recordRuns(parent, list, "tree");
    list.forEach((c, i) => {
      y += before[i];
      const s = sizeOf(c);
      placed.set(c.id, { node: c, x, y, w: s.w, h: s.h, side: "tree" });
      layoutTreeRight(c, visibleChildren(c));
      y += treeExtent(c) + after[i] + opts.gapSibling;
    });
  }

  // 外框自底向上：子树范围（含里层外框）外扩留白
  const boxes: PlacedBox[] = [];
  const union = (a: Bounds | null, b: Bounds | null): Bounds | null => {
    if (!a) return b;
    if (!b) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  const subtree = new Map<string, Bounds | null>();
  function boundsOf(n: MindNode): Bounds | null {
    const p = placed.get(n.id);
    if (!p) return null;
    let b: Bounds | null = { x: p.x, y: p.y, w: p.w, h: p.h };
    for (const c of visibleChildren(n)) {
      const cb = boundsOf(c);
      subtree.set(c.id, cb);
      b = union(b, cb);
    }
    for (const run of runs.get(n.id) ?? []) {
      let inner: Bounds | null = null;
      for (const m of run.members) inner = union(inner, subtree.get(m.id) ?? null);
      if (!inner) continue;
      const top = boxTop(run.start);
      const box: PlacedBox = {
        start: run.start,
        members: run.members,
        side: run.side,
        x: inner.x - BOX_PAD,
        y: inner.y - top,
        w: inner.w + 2 * BOX_PAD,
        h: inner.h + top + BOX_PAD,
      };
      boxes.push(box);
      b = union(b, box);
    }
    return b;
  }
  const all = boundsOf(root) ?? { x: 0, y: 0, w: 0, h: 0 };
  return { placed, boxes, bounds: all };
}

export interface EdgeGeometry {
  parent: Placed;
  child: Placed;
  /** 父节点出线点 */
  x1: number;
  y1: number;
  /** 子节点入线点 */
  x2: number;
  y2: number;
}

export function edgeGeometry(parent: Placed, child: Placed): EdgeGeometry {
  switch (child.side) {
    case "right":
      return { parent, child, x1: parent.x + parent.w, y1: parent.y + parent.h / 2, x2: child.x, y2: child.y + child.h / 2 };
    case "left":
      return { parent, child, x1: parent.x, y1: parent.y + parent.h / 2, x2: child.x + child.w, y2: child.y + child.h / 2 };
    case "down":
      return { parent, child, x1: parent.x + parent.w / 2, y1: parent.y + parent.h, x2: child.x + child.w / 2, y2: child.y };
    case "tree":
      return {
        parent,
        child,
        x1: parent.x + Math.min(TREE_INDENT / 2, parent.w / 2),
        y1: parent.y + parent.h,
        x2: child.x,
        y2: child.y + child.h / 2,
      };
  }
}

/** 按子节点方向选路径：水平/垂直 S 曲线、圆角折线、树形图的竖干折线 */
export function edgePath(e: EdgeGeometry, style: "curve" | "elbow" | "straight"): string {
  if (e.child.side === "tree") return treePath(e);
  if (style === "straight") return `M${r(e.x1)},${r(e.y1)} L${r(e.x2)},${r(e.y2)}`;
  if (e.child.side === "down") return style === "curve" ? curvePathVertical(e) : elbowPathVertical(e);
  return style === "curve" ? curvePath(e) : elbowPath(e);
}

/** S 形三次贝塞尔：两端水平出入 */
export function curvePath(e: EdgeGeometry): string {
  const dx = (e.x2 - e.x1) * 0.5;
  return `M${r(e.x1)},${r(e.y1)} C${r(e.x1 + dx)},${r(e.y1)} ${r(e.x2 - dx)},${r(e.y2)} ${r(e.x2)},${r(e.y2)}`;
}

export function curvePathVertical(e: EdgeGeometry): string {
  const dy = (e.y2 - e.y1) * 0.5;
  return `M${r(e.x1)},${r(e.y1)} C${r(e.x1)},${r(e.y1 + dy)} ${r(e.x2)},${r(e.y2 - dy)} ${r(e.x2)},${r(e.y2)}`;
}

/** 圆角折线：父节点水平出线到中线，沿中线竖直，再水平进入子节点 */
export function elbowPath(e: EdgeGeometry, radius = 8): string {
  const dir = e.x2 >= e.x1 ? 1 : -1;
  const midX = e.x1 + (e.x2 - e.x1) * 0.5;
  const dy = e.y2 - e.y1;
  if (Math.abs(dy) < 1) return `M${r(e.x1)},${r(e.y1)} L${r(e.x2)},${r(e.y2)}`;
  const rad = Math.min(radius, Math.abs(dy) / 2, Math.abs(e.x2 - e.x1) / 4);
  const sy = dy > 0 ? 1 : -1;
  return [
    `M${r(e.x1)},${r(e.y1)}`,
    `L${r(midX - dir * rad)},${r(e.y1)}`,
    `Q${r(midX)},${r(e.y1)} ${r(midX)},${r(e.y1 + sy * rad)}`,
    `L${r(midX)},${r(e.y2 - sy * rad)}`,
    `Q${r(midX)},${r(e.y2)} ${r(midX + dir * rad)},${r(e.y2)}`,
    `L${r(e.x2)},${r(e.y2)}`,
  ].join(" ");
}

/** 圆角折线（垂直）：父节点向下到中线，沿中线水平，再向下进入子节点 */
export function elbowPathVertical(e: EdgeGeometry, radius = 8): string {
  const dx = e.x2 - e.x1;
  const midY = e.y1 + (e.y2 - e.y1) * 0.5;
  if (Math.abs(dx) < 1) return `M${r(e.x1)},${r(e.y1)} L${r(e.x2)},${r(e.y2)}`;
  const rad = Math.min(radius, Math.abs(dx) / 2, Math.abs(e.y2 - e.y1) / 4);
  const sx = dx > 0 ? 1 : -1;
  return [
    `M${r(e.x1)},${r(e.y1)}`,
    `L${r(e.x1)},${r(midY - rad)}`,
    `Q${r(e.x1)},${r(midY)} ${r(e.x1 + sx * rad)},${r(midY)}`,
    `L${r(e.x2 - sx * rad)},${r(midY)}`,
    `Q${r(e.x2)},${r(midY)} ${r(e.x2)},${r(midY + rad)}`,
    `L${r(e.x2)},${r(e.y2)}`,
  ].join(" ");
}

/** 树形图：从父节点下方的竖干向下，到子节点的高度后转向右进入 */
export function treePath(e: EdgeGeometry, radius = 8): string {
  const rad = Math.min(radius, Math.max(0, e.y2 - e.y1) / 2, Math.max(0, e.x2 - e.x1) / 2);
  return [`M${r(e.x1)},${r(e.y1)}`, `L${r(e.x1)},${r(e.y2 - rad)}`, `Q${r(e.x1)},${r(e.y2)} ${r(e.x1 + rad)},${r(e.y2)}`, `L${r(e.x2)},${r(e.y2)}`].join(" ");
}

function r(n: number): string {
  return String(Math.round(n * 100) / 100);
}
