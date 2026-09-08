/**
 * 布局引擎：自底向上算每棵子树的高度，子节点垂直堆叠并对父节点居中。
 * 与 XMind 的「逻辑图（右）」和「思维导图（左右分布，顺时针）」一致。
 * 不依赖 DOM，节点尺寸由调用方测量后传入。
 */

import { MindNode, visibleChildren } from "./model";

export type Structure = "logic-right" | "mindmap";
export type Side = "right" | "left";

export interface Size {
  w: number;
  h: number;
}

export interface LayoutOptions {
  structure: Structure;
  /** 根节点到主主题的水平距离 */
  gapRoot: number;
  /** 其余层级之间的水平距离 */
  gapLevel: number;
  /** 兄弟节点之间的垂直距离 */
  gapSibling: number;
  /** 主主题之间的垂直距离 */
  gapMain: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  structure: "logic-right",
  gapRoot: 96,
  gapLevel: 36,
  gapSibling: 12,
  gapMain: 40,
};

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

  const gapFor = (parent: MindNode) => (parent.depth === 0 ? opts.gapMain : opts.gapSibling);

  const extentOfList = (nodes: MindNode[], gap: number): number =>
    nodes.reduce((sum, c, i) => sum + extent(c) + (i > 0 ? gap : 0), 0);

  const extent = (n: MindNode): number => {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const own = sizeOf(n).h;
    const kids = visibleChildren(n);
    const e = kids.length ? Math.max(own, extentOfList(kids, gapFor(n))) : own;
    extents.set(n.id, e);
    return e;
  };

  /** 把 kids 垂直堆叠在 (x, cy) 一侧，cy 为堆叠块的中心 */
  const placeColumn = (parent: MindNode, kids: MindNode[], side: Side, cy: number) => {
    if (!kids.length) return;
    const p = placed.get(parent.id)!;
    const gapH = parent.depth === 0 ? opts.gapRoot : opts.gapLevel;
    const gapV = gapFor(parent);
    let y = cy - extentOfList(kids, gapV) / 2;
    for (const c of kids) {
      const s = sizeOf(c);
      const e = extent(c);
      const ccy = y + e / 2;
      const x = side === "right" ? p.x + p.w + gapH : p.x - gapH - s.w;
      placed.set(c.id, { node: c, x, y: ccy - s.h / 2, w: s.w, h: s.h, side });
      placeColumn(c, visibleChildren(c), side, ccy);
      y += e + gapV;
    }
  };

  const rs = sizeOf(root);
  placed.set(root.id, { node: root, x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: "right" });
  const kids = visibleChildren(root);
  if (opts.structure === "mindmap" && kids.length > 1) {
    const split = Math.ceil(kids.length / 2);
    placeColumn(root, kids.slice(0, split), "right", 0);
    // 左侧顺时针：从下往上排，所以堆叠顺序取反
    placeColumn(root, kids.slice(split).reverse(), "left", 0);
  } else {
    placeColumn(root, kids, "right", 0);
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
  const y1 = parent.y + parent.h / 2;
  const y2 = child.y + child.h / 2;
  if (child.side === "right") {
    return { parent, child, x1: parent.x + parent.w, y1, x2: child.x, y2 };
  }
  return { parent, child, x1: parent.x, y1, x2: child.x + child.w, y2 };
}

/** S 形三次贝塞尔：两端水平出入 */
export function curvePath(e: EdgeGeometry): string {
  const dx = (e.x2 - e.x1) * 0.5;
  return `M${r(e.x1)},${r(e.y1)} C${r(e.x1 + dx)},${r(e.y1)} ${r(e.x2 - dx)},${r(e.y2)} ${r(e.x2)},${r(e.y2)}`;
}

/** 圆角折线：父节点水平出线到中线，沿中线竖直，再水平进入子节点 */
export function elbowPath(e: EdgeGeometry, radius = 8): string {
  const dir = e.x2 >= e.x1 ? 1 : -1;
  const midX = e.x1 + ((e.x2 - e.x1) * 0.5);
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

function r(n: number): string {
  return String(Math.round(n * 100) / 100);
}
