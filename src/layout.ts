/**
 * 布局引擎：不依赖 DOM，节点尺寸由调用方测量后传入。
 *
 *   logic-right  逻辑图（向右）：子节点垂直堆叠在父节点右侧，对父节点居中
 *   mindmap      思维导图：主主题左右分布，顺时针
 *   org-down     组织结构图：子节点水平排在父节点下方
 *   tree-right   树形图：子节点在父节点下方向右缩进，像文件树
 */

import { MindNode, visibleChildren } from "./model";

export type Structure = "logic-right" | "mindmap" | "org-down" | "tree-right";
export const STRUCTURES: { id: Structure; label: string }[] = [
  { id: "logic-right", label: "逻辑图（向右）" },
  { id: "mindmap", label: "思维导图（左右分布）" },
  { id: "org-down", label: "组织结构图（向下）" },
  { id: "tree-right", label: "树形图" },
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

export interface LayoutResult {
  placed: Map<string, Placed>;
  bounds: Bounds;
}

export function layoutTree(root: MindNode, measure: (node: MindNode) => Size, opts: LayoutOptions): LayoutResult {
  const sizes = new Map<string, Size>();
  const extents = new Map<string, number>();
  const placed = new Map<string, Placed>();

  const sizeOf = (n: MindNode): Size => {
    let s = sizes.get(n.id);
    if (!s) {
      s = measure(n);
      sizes.set(n.id, s);
    }
    return s;
  };

  const rs = sizeOf(root);
  placed.set(root.id, { node: root, x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: "right" });
  const kids = visibleChildren(root);

  if (opts.structure === "org-down") {
    layoutDown(root, kids);
  } else if (opts.structure === "tree-right") {
    layoutTreeRight(root, kids);
  } else if (opts.structure === "mindmap" && kids.length > 1) {
    const split = Math.ceil(kids.length / 2);
    placeColumn(root, kids.slice(0, split), "right", 0);
    // 左侧顺时针：从下往上排，所以堆叠顺序取反
    placeColumn(root, kids.slice(split).reverse(), "left", 0);
  } else {
    placeColumn(root, kids, "right", 0);
  }

  // ---- 水平结构：子树高度自底向上，子节点垂直堆叠并对父节点居中 ----
  function gapFor(parent: MindNode): number {
    return parent.depth === 0 ? opts.gapMain : opts.gapSibling;
  }
  function extentOfList(nodes: MindNode[], gap: number): number {
    return nodes.reduce((sum, c, i) => sum + extentH(c) + (i > 0 ? gap : 0), 0);
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
    const gapH = parent.depth === 0 ? opts.gapRoot : opts.gapLevel;
    const gapV = gapFor(parent);
    let y = cy - extentOfList(list, gapV) / 2;
    for (const c of list) {
      const s = sizeOf(c);
      const e = extentH(c);
      const ccy = y + e / 2;
      const x = side === "right" ? p.x + p.w + gapH : p.x - gapH - s.w;
      placed.set(c.id, { node: c, x, y: ccy - s.h / 2, w: s.w, h: s.h, side });
      placeColumn(c, visibleChildren(c), side, ccy);
      y += e + gapV;
    }
  }

  // ---- 组织结构图：子树宽度自底向上，子节点水平排在父节点下方并居中 ----
  function hGapFor(parent: MindNode): number {
    return parent.depth === 0 ? opts.gapMain : opts.gapSibling * 2;
  }
  function extentW(n: MindNode): number {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const own = sizeOf(n).w;
    const k = visibleChildren(n);
    const e = k.length ? Math.max(own, k.reduce((sum, c, i) => sum + extentW(c) + (i > 0 ? hGapFor(n) : 0), 0)) : own;
    extents.set(n.id, e);
    return e;
  }
  function layoutDown(parent: MindNode, list: MindNode[]): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    const gapV = parent.depth === 0 ? Math.round(opts.gapRoot * 0.6) : opts.gapLevel + 8;
    const gapX = hGapFor(parent);
    const total = list.reduce((sum, c, i) => sum + extentW(c) + (i > 0 ? gapX : 0), 0);
    let x = p.x + p.w / 2 - total / 2;
    const y = p.y + p.h + gapV;
    for (const c of list) {
      const s = sizeOf(c);
      const e = extentW(c);
      const ccx = x + e / 2;
      placed.set(c.id, { node: c, x: ccx - s.w / 2, y, w: s.w, h: s.h, side: "down" });
      layoutDown(c, visibleChildren(c));
      x += e + gapX;
    }
  }

  // ---- 树形图：子节点在父节点下方向右缩进，逐个向下堆叠 ----
  function treeExtent(n: MindNode): number {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const e = sizeOf(n).h + visibleChildren(n).reduce((sum, c) => sum + opts.gapSibling + treeExtent(c), 0);
    extents.set(n.id, e);
    return e;
  }
  function layoutTreeRight(parent: MindNode, list: MindNode[]): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    let y = p.y + p.h + opts.gapSibling;
    const x = p.x + TREE_INDENT;
    for (const c of list) {
      const s = sizeOf(c);
      placed.set(c.id, { node: c, x, y, w: s.w, h: s.h, side: "tree" });
      layoutTreeRight(c, visibleChildren(c));
      y += treeExtent(c) + opts.gapSibling;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { placed, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
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
export function edgePath(e: EdgeGeometry, style: "curve" | "elbow"): string {
  if (e.child.side === "tree") return treePath(e);
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
