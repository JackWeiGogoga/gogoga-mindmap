/**
 * 布局引擎：不依赖 DOM，节点尺寸由调用方测量后传入。
 *
 *   logic-right  逻辑图（向右）：子节点垂直堆叠在父节点右侧，对父节点居中
 *   mindmap      思维导图：主主题左右分布，顺时针
 *   org-down     组织结构图：子节点水平排在父节点下方
 *   tree-right   树形图：子节点在父节点下方向右缩进，像文件树
 */

import { t } from "./i18n";
import { boxGroups, MindNode, summaryGroups, visibleChildren } from "./model";

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

/** 概要：括号离被括内容的距离、括号的厚度、括号尖到文字的距离 */
export const SUMMARY_GAP = 10;
export const BRACE_W = 12;
export const SUMMARY_LABEL_GAP = 6;

/** 标注气泡和节点之间的距离（尖角画在这段空隙里） */
export const CALLOUT_GAP = 12;

/** 展开的备注和节点之间的距离 */
export const NOTE_GAP = 6;

export interface Placed {
  node: MindNode;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
  /**
   * 节点下方挂着展开的备注时，备注连同间距的高度。组织结构图和树形图的子节点连线从备注底下出来，
   * 不从备注里穿过；其余结构连线从节点侧面出，用不上
   */
  stem?: number;
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

/**
 * 概要：括号画在一组兄弟（连同分支、外框）的外侧，文字跟在括号尖后面。
 * 这一组在堆叠方向上独占一段，所以放在外侧不会压到别的节点，也不用改节点的位置
 */
export interface PlacedSummary {
  start: MindNode;
  members: MindNode[];
  side: Side;
  /** 括号所占的矩形；right / tree 朝右开口在左，left 镜像，down 横着画在下方 */
  brace: Bounds;
  /** 文字的位置；同一个概要在思维导图里被左右拆开时只有第一段有文字 */
  label: Bounds | null;
}

/**
 * 标注气泡：dir = up 时在节点上方（尖角朝下指向节点顶边），right 时在节点右边（组织结构图）
 */
export interface PlacedCallout extends Bounds {
  node: MindNode;
  dir: "up" | "right";
}

/** 展开的备注：放在节点下方；far 表示离节点较远（放到了整个分支下面），要画一根引线指回节点 */
export interface PlacedNote extends Bounds {
  node: MindNode;
  far: boolean;
}

export interface LayoutResult {
  placed: Map<string, Placed>;
  /** 显示中的标注；没传 measureCallout（或都没有标注）时为空 */
  callouts: PlacedCallout[];
  /** 展开显示的备注；没传 measureNote 时为空 */
  notes: PlacedNote[];
  /** 由内向外排列：先画外层再画内层时倒着遍历 */
  boxes: PlacedBox[];
  summaries: PlacedSummary[];
  bounds: Bounds;
  /** 按自由主题排的节点（中心主题的直接子节点）：不和中心主题连线 */
  floating?: Set<MindNode>;
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

export function layoutTree(
  root: MindNode,
  measure: (node: MindNode) => Size,
  opts: LayoutOptions,
  /** 概要文字的尺寸（起始节点）；不给就按空文字算 */
  measureSummary?: (start: MindNode) => Size,
  /** 不参与这棵树排布的根的子节点（自由主题，另外单独排） */
  skip?: Set<MindNode>,
  /** 标注气泡的尺寸；返回 null（或不给）就当没有标注，排布和以前完全一样 */
  measureCallout?: (node: MindNode) => Size | null,
  /** 展开的备注的尺寸；返回 null（或不给）就当不展开 */
  measureNote?: (node: MindNode) => Size | null,
): LayoutResult {
  /** 根的子节点里去掉 skip 的；没有 skip 时原样返回，和以前完全一样 */
  const childrenOf = (p: MindNode): MindNode[] => (skip?.size && p === root ? p.children.filter((c) => !skip.has(c)) : p.children);
  const sizes = new Map<string, Size>();
  const extents = new Map<string, number>();
  /** 水平结构：节点中心往上 / 往下各占多少；组织结构图：往左 / 往右各占多少 */
  const halfCache = new Map<string, { up: number; down: number; kids: number; wide: boolean; noteFar: boolean }>();
  const wHalfCache = new Map<string, { left: number; right: number }>();
  const placed = new Map<string, Placed>();
  /** 相对布局根的深度：聚焦某个分支时它就是根 */
  const depthOf = (n: MindNode) => n.depth - root.depth;

  const calloutSizes = new Map<string, Size | null>();
  const calloutOf = (n: MindNode): Size | null => {
    // 空字符串是刚加上、正在输入的标注，也要留位置
    if (n.callout === undefined || !measureCallout) return null;
    let c = calloutSizes.get(n.id);
    if (c === undefined) {
      c = measureCallout(n);
      calloutSizes.set(n.id, c);
    }
    return c;
  };
  const callouts: PlacedCallout[] = [];
  const calloutRects = new Map<string, Bounds>();
  const addCallout = (n: MindNode, b: Bounds, dir: PlacedCallout["dir"]) => {
    callouts.push({ node: n, dir, ...b });
    calloutRects.set(n.id, b);
  };
  const noteSizes = new Map<string, Size | null>();
  const noteOf = (n: MindNode): Size | null => {
    if (!n.note || !measureNote) return null;
    let c = noteSizes.get(n.id);
    if (c === undefined) {
      c = measureNote(n);
      noteSizes.set(n.id, c);
    }
    return c;
  };
  const notes: PlacedNote[] = [];
  const noteRects = new Map<string, Bounds>();
  const addNote = (n: MindNode, b: Bounds, far = false) => {
    notes.push({ node: n, far, ...b });
    noteRects.set(n.id, b);
  };
  /**
   * 组织结构图里标注在节点右边、从节点顶边往下长：备注宽到伸进标注下面、标注又比节点高时，
   * 备注要从标注底下开始，多让出的这一段
   */
  const noteLift = (n: MindNode): number => {
    if (opts.structure !== "org-down") return 0;
    const no = noteOf(n);
    const co = calloutOf(n);
    const s = sizeOf(n);
    return no && co && no.w > s.w + 2 * CALLOUT_GAP && co.h > s.h ? co.h - s.h : 0;
  };
  /** 组织结构图、树形图：备注挂在节点下面，子节点那一排跟着往下让 */
  const stemOf = (n: MindNode): number | undefined => {
    const no = noteOf(n);
    return no ? noteLift(n) + NOTE_GAP + no.h : undefined;
  };

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
      g = boxGroups(childrenOf(p));
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
  /** 父节点 id → 它子节点里的外框 / 概要（按排布顺序，一段连续的同组兄弟为一个） */
  type Run = { start: MindNode; members: MindNode[]; side: Side };
  const runs = new Map<string, Run[]>();
  const summaryRuns = new Map<string, Run[]>();
  const summaryCache = new Map<string, Map<string, MindNode>>();
  const summaryOf = (n: MindNode): MindNode | undefined => {
    const p = n.parent;
    if (!p || n === root) return undefined;
    let g = summaryCache.get(p.id);
    if (!g) {
      g = summaryGroups(childrenOf(p));
      summaryCache.set(p.id, g);
    }
    return g.get(n.id);
  };
  function collect(into: Map<string, Run[]>, of: (n: MindNode) => MindNode | undefined, parent: MindNode, list: MindNode[], side: Side): void {
    let cur: Run | null = null;
    for (const c of list) {
      const g = of(c);
      if (!g) {
        cur = null;
        continue;
      }
      if (!cur || cur.start !== g) {
        cur = { start: g, members: [], side };
        const arr = into.get(parent.id) ?? [];
        arr.push(cur);
        into.set(parent.id, arr);
      }
      cur.members.push(c);
    }
  }
  function recordRuns(parent: MindNode, list: MindNode[], side: Side): void {
    collect(runs, groupOf, parent, list, side);
    collect(summaryRuns, summaryOf, parent, list, side);
  }

  const rs = sizeOf(root);
  const vertical = opts.structure === "org-down" || opts.structure === "tree-right";
  placed.set(root.id, { node: root, x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: "right", stem: vertical ? stemOf(root) : undefined });
  const kids = root.folded ? [] : childrenOf(root);

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
    const v = halves(n);
    return v.up + v.down;
  }
  /**
   * 节点中心往上、往下各占多少。没有标注时上下一样（子树整体对节点居中，和以前一样）；
   * 有标注时上半截加高放气泡。气泡比节点宽、而子节点又排到了气泡底边以上时，
   * 贴着节点放会压到连向子节点的线，就放到整个分支的上方（wide），尖角拉长指回节点
   */
  function halves(n: MindNode): { up: number; down: number; kids: number; wide: boolean; noteFar: boolean } {
    const cached = halfCache.get(n.id);
    if (cached) return cached;
    const s = sizeOf(n);
    const k = visibleChildren(n);
    const kids = k.length ? extentOfList(k, gapFor(n)) / 2 : 0;
    const half = Math.max(s.h / 2, kids);
    let up = half;
    let wide = false;
    const co = calloutOf(n);
    if (co) {
      wide = co.w > s.w && kids > s.h / 2 + CALLOUT_GAP;
      up = wide ? half + CALLOUT_GAP + co.h : Math.max(half, s.h / 2 + CALLOUT_GAP + co.h);
    }
    // 备注放在节点下面，同样的道理：比节点宽、子节点又排到了备注顶边以下时，放到整个分支的下面
    let down = half;
    let noteFar = false;
    const no = noteOf(n);
    if (no) {
      noteFar = no.w > s.w && kids > s.h / 2 + NOTE_GAP;
      down = noteFar ? half + NOTE_GAP + no.h : Math.max(half, s.h / 2 + NOTE_GAP + no.h);
    }
    const v = { up, down, kids, wide, noteFar };
    halfCache.set(n.id, v);
    return v;
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
      const v = halves(c);
      const e = v.up + v.down;
      const ccy = y + v.up;
      const x = side === "right" ? p.x + p.w + gapH : p.x - gapH - s.w;
      placed.set(c.id, { node: c, x, y: ccy - s.h / 2, w: s.w, h: s.h, side });
      const co = calloutOf(c);
      if (co) {
        // 右侧左对齐、左侧右对齐：气泡不伸到连向父节点的那一侧
        const cx = side === "left" ? x + s.w - co.w : x;
        const top = v.wide ? ccy - Math.max(s.h / 2, v.kids) : ccy - s.h / 2;
        addCallout(c, { x: cx, y: top - CALLOUT_GAP - co.h, w: co.w, h: co.h }, "up");
      }
      const no = noteOf(c);
      if (no) {
        const nx = side === "left" ? x + s.w - no.w : x;
        const bottom = v.noteFar ? ccy + Math.max(s.h / 2, v.kids) : ccy + s.h / 2;
        addNote(c, { x: nx, y: bottom + NOTE_GAP, w: no.w, h: no.h }, v.noteFar);
      }
      placeColumn(c, visibleChildren(c), side, ccy);
      y += e + after[i] + gapV;
    });
  }

  // ---- 组织结构图：子树宽度自底向上，子节点水平排在父节点下方并居中 ----
  function hGapFor(parent: MindNode): number {
    return depthOf(parent) === 0 ? opts.gapMain : opts.gapSibling * 2;
  }
  function extentW(n: MindNode): number {
    const v = wHalves(n);
    return v.left + v.right;
  }
  /** 组织结构图：节点中心往左、往右各占多少。标注放在节点右边，只加宽右半边 */
  function wHalves(n: MindNode): { left: number; right: number } {
    const cached = wHalfCache.get(n.id);
    if (cached) return cached;
    const s = sizeOf(n);
    const k = visibleChildren(n);
    const half = k.length ? Math.max(s.w / 2, (k.reduce((sum, c, i) => sum + extentW(c) + (i > 0 ? hGapFor(n) : 0), 0) + sidePads(k)) / 2) : s.w / 2;
    const co = calloutOf(n);
    // 备注在节点正下方居中，比节点宽时两边都要让
    const nh = (noteOf(n)?.w ?? 0) / 2;
    const v = { left: Math.max(half, nh), right: Math.max(co ? Math.max(half, s.w / 2 + CALLOUT_GAP + co.w) : half, nh) };
    wHalfCache.set(n.id, v);
    return v;
  }
  /**
   * 组织结构图里下一排离节点顶边多远。标注和节点顶边对齐、往下长；比节点高时下一排往下让，
   * 并且让连线的横段（在两排正中间）落在气泡下面，不从气泡里穿过
   */
  function rowDrop(p: Placed, gapV: number): number {
    const co = calloutOf(p.node);
    const stem = p.stem ?? 0;
    const base = p.h + stem + gapV;
    return co ? Math.max(base, 2 * (co.h + 4) - p.h - stem) : base;
  }
  function layoutDown(parent: MindNode, list: MindNode[]): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    const gapV = depthOf(parent) === 0 ? Math.round(opts.gapRoot * 0.6) : opts.gapLevel + 8;
    const gapX = hGapFor(parent);
    const total = list.reduce((sum, c, i) => sum + extentW(c) + (i > 0 ? gapX : 0), 0) + sidePads(list);
    let x = p.x + p.w / 2 - total / 2;
    const y = p.y + rowDrop(p, gapV);
    // 横向排布时标题在框顶，不占横向空间，左右只留 BOX_PAD
    const gs = list.map(groupOf);
    recordRuns(parent, list, "down");
    list.forEach((c, i) => {
      if (gs[i] && gs[i] !== gs[i - 1]) x += BOX_PAD;
      const s = sizeOf(c);
      const v = wHalves(c);
      const e = v.left + v.right;
      const ccx = x + v.left;
      placed.set(c.id, { node: c, x: ccx - s.w / 2, y, w: s.w, h: s.h, side: "down", stem: stemOf(c) });
      const co = calloutOf(c);
      if (co) addCallout(c, { x: ccx + s.w / 2 + CALLOUT_GAP, y, w: co.w, h: co.h }, "right");
      const no = noteOf(c);
      if (no) addNote(c, { x: ccx - no.w / 2, y: y + s.h + noteLift(c) + NOTE_GAP, w: no.w, h: no.h });
      layoutDown(c, visibleChildren(c));
      x += e + gapX + (gs[i] && gs[i] !== gs[i + 1] ? BOX_PAD : 0);
    });
  }

  // ---- 树形图：子节点在父节点下方向右缩进，逐个向下堆叠 ----
  function treeExtent(n: MindNode): number {
    const cached = extents.get(n.id);
    if (cached !== undefined) return cached;
    const k = visibleChildren(n);
    const co = calloutOf(n);
    const e = (co ? co.h + CALLOUT_GAP : 0) + sizeOf(n).h + (stemOf(n) ?? 0) + k.reduce((sum, c) => sum + opts.gapSibling + treeExtent(c), 0) + padTotal(k);
    extents.set(n.id, e);
    return e;
  }
  function layoutTreeRight(parent: MindNode, list: MindNode[]): void {
    if (!list.length) return;
    const p = placed.get(parent.id)!;
    let y = p.y + p.h + (p.stem ?? 0) + opts.gapSibling;
    const x = p.x + TREE_INDENT;
    const { before, after } = boxPads(list);
    recordRuns(parent, list, "tree");
    list.forEach((c, i) => {
      y += before[i];
      const s = sizeOf(c);
      // 标注占这个节点前面的一段，节点往下让
      const co = calloutOf(c);
      const top = co ? y + co.h + CALLOUT_GAP : y;
      if (co) addCallout(c, { x, y, w: co.w, h: co.h }, "up");
      placed.set(c.id, { node: c, x, y: top, w: s.w, h: s.h, side: "tree", stem: stemOf(c) });
      const no = noteOf(c);
      if (no) addNote(c, { x, y: top + s.h + NOTE_GAP, w: no.w, h: no.h });
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
    let b: Bounds | null = union(union({ x: p.x, y: p.y, w: p.w, h: p.h }, calloutRects.get(n.id) ?? null), noteRects.get(n.id) ?? null);
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
      for (const m of run.members) boxBounds.set(m.id, box);
      b = union(b, box);
    }
    // 概要在外框之后：括住的内容含成员的分支和套在它们外面的外框；算进 b，外层外框和适应画布都会带上它
    for (const run of summaryRuns.get(n.id) ?? []) {
      let inner: Bounds | null = null;
      for (const m of run.members) inner = union(inner, union(subtree.get(m.id) ?? null, boxBounds.get(m.id) ?? null));
      if (!inner) continue;
      const first = !labelled.has(run.start.id);
      labelled.add(run.start.id);
      const ls = first ? (measureSummary?.(run.start) ?? { w: 0, h: 0 }) : null;
      const s = placeSummary(run, inner, ls);
      summaries.push(s);
      b = union(union(b, s.brace), s.label);
    }
    return b;
  }
  /** 外框成员 id → 外框（成员被外框套住时，概要要括到外框外面） */
  const boxBounds = new Map<string, Bounds>();
  const summaries: PlacedSummary[] = [];
  const labelled = new Set<string>();
  function placeSummary(run: Run, inner: Bounds, ls: Size | null): PlacedSummary {
    const base = { start: run.start, members: run.members, side: run.side };
    if (run.side === "down") {
      const brace = { x: inner.x, y: inner.y + inner.h + SUMMARY_GAP, w: inner.w, h: BRACE_W };
      const label = ls && { x: inner.x + inner.w / 2 - ls.w / 2, y: brace.y + BRACE_W + SUMMARY_LABEL_GAP, w: ls.w, h: ls.h };
      return { ...base, brace, label };
    }
    const cy = inner.y + inner.h / 2;
    if (run.side === "left") {
      const brace = { x: inner.x - SUMMARY_GAP - BRACE_W, y: inner.y, w: BRACE_W, h: inner.h };
      const label = ls && { x: brace.x - SUMMARY_LABEL_GAP - ls.w, y: cy - ls.h / 2, w: ls.w, h: ls.h };
      return { ...base, brace, label };
    }
    const brace = { x: inner.x + inner.w + SUMMARY_GAP, y: inner.y, w: BRACE_W, h: inner.h };
    const label = ls && { x: brace.x + BRACE_W + SUMMARY_LABEL_GAP, y: cy - ls.h / 2, w: ls.w, h: ls.h };
    return { ...base, brace, label };
  }
  // 根节点的标注：组织结构图放右边，其余放上方居中（树形图左对齐）；
  // 太宽会伸到两侧的主题那里时，放到整张图的最上面
  const rootCo = calloutOf(root);
  if (rootCo) {
    if (opts.structure === "org-down") {
      addCallout(root, { x: rs.w / 2 + CALLOUT_GAP, y: -rs.h / 2, w: rootCo.w, h: rootCo.h }, "right");
    } else if (opts.structure === "tree-right") {
      addCallout(root, { x: -rs.w / 2, y: -rs.h / 2 - CALLOUT_GAP - rootCo.h, w: rootCo.w, h: rootCo.h }, "up");
    }
  }
  // 根节点的备注：组织结构图居中、树形图左对齐，直接挂在下面（子节点已经让开了）
  const rootNo = noteOf(root);
  if (rootNo && vertical) {
    const nx = opts.structure === "org-down" ? -rootNo.w / 2 : -rs.w / 2;
    addNote(root, { x: nx, y: rs.h / 2 + noteLift(root) + NOTE_GAP, w: rootNo.w, h: rootNo.h });
  }
  let all = boundsOf(root) ?? { x: 0, y: 0, w: 0, h: 0 };
  if (rootCo && opts.structure !== "org-down" && opts.structure !== "tree-right") {
    const wide = rootCo.w > rs.w && all.y < -rs.h / 2 - CALLOUT_GAP;
    const bottom = wide ? all.y : -rs.h / 2;
    const rect = { x: -rootCo.w / 2, y: bottom - CALLOUT_GAP - rootCo.h, w: rootCo.w, h: rootCo.h };
    addCallout(root, rect, "up");
    all = union(all, rect)!;
  }
  // 水平结构：思维导图居中、逻辑图左对齐（子节点都在右边）；太宽会伸到下面的分支那里时放到整张图的最下面
  if (rootNo && !vertical) {
    const nx = opts.structure === "mindmap" ? -rootNo.w / 2 : -rs.w / 2;
    const far = rootNo.w > rs.w && all.y + all.h > rs.h / 2 + NOTE_GAP;
    const top = (far ? all.y + all.h : rs.h / 2) + NOTE_GAP;
    const rect = { x: nx, y: top, w: rootNo.w, h: rootNo.h };
    addNote(root, rect, far);
    all = union(all, rect)!;
  }
  return { placed, boxes, summaries, callouts, notes, bounds: all };
}

/**
 * 整张图的布局：主树照常排（不含自由主题）；每个自由主题按自己的位置单独排成一棵小树，
 * 结构跟随整张图（左右分布时，摆在中心主题左边的向左展开）。没有自由主题时就是 layoutTree
 */
export function layoutMap(
  root: MindNode,
  measure: (node: MindNode) => Size,
  opts: LayoutOptions,
  measureSummary?: (start: MindNode) => Size,
  measureCallout?: (node: MindNode) => Size | null,
  measureNote?: (node: MindNode) => Size | null,
): LayoutResult {
  // 只有真正的中心主题下才有自由主题（聚焦某个分支时不算）
  const floats = root.parent ? [] : visibleChildren(root).filter((c) => c.float);
  if (!floats.length) return layoutTree(root, measure, opts, measureSummary, undefined, measureCallout, measureNote);
  const main = layoutTree(root, measure, opts, measureSummary, new Set(floats), measureCallout, measureNote);
  const floating = new Set<MindNode>(floats);
  const structure: Structure = opts.structure === "org-down" || opts.structure === "tree-right" ? opts.structure : "logic-right";
  let bounds = main.bounds;
  for (const f of floats) {
    // 自由主题是主主题那一层：它和子节点之间按普通层级的间距，不用中心主题那么宽
    const sub = layoutTree(f, measure, { ...opts, structure, gapRoot: opts.gapLevel, gapMain: opts.gapSibling }, measureSummary, undefined, measureCallout, measureNote);
    const mirror = opts.structure === "mindmap" && f.float!.x < 0;
    const dx = f.float!.x;
    const dy = f.float!.y;
    const mx = (x: number, w: number) => (mirror ? -(x + w) : x) + dx;
    const flip = (side: Side): Side => (mirror && side === "right" ? "left" : side);
    for (const p of sub.placed.values()) main.placed.set(p.node.id, { ...p, x: mx(p.x, p.w), y: p.y + dy, side: flip(p.side) });
    for (const b of sub.boxes) main.boxes.push({ ...b, x: mx(b.x, b.w), y: b.y + dy, side: flip(b.side) });
    for (const c of sub.callouts) main.callouts.push({ ...c, x: mx(c.x, c.w), y: c.y + dy });
    for (const c of sub.notes) main.notes.push({ ...c, x: mx(c.x, c.w), y: c.y + dy });
    for (const s of sub.summaries) {
      main.summaries.push({
        ...s,
        side: flip(s.side),
        brace: { ...s.brace, x: mx(s.brace.x, s.brace.w), y: s.brace.y + dy },
        label: s.label && { ...s.label, x: mx(s.label.x, s.label.w), y: s.label.y + dy },
      });
    }
    const b = sub.bounds;
    const fb = { x: mx(b.x, b.w), y: b.y + dy, w: b.w, h: b.h };
    const x = Math.min(bounds.x, fb.x);
    const y = Math.min(bounds.y, fb.y);
    bounds = { x, y, w: Math.max(bounds.x + bounds.w, fb.x + fb.w) - x, h: Math.max(bounds.y + bounds.h, fb.y + fb.h) - y };
  }
  return { ...main, bounds, floating };
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
      return { parent, child, x1: parent.x + parent.w / 2, y1: parent.y + parent.h + (parent.stem ?? 0), x2: child.x + child.w / 2, y2: child.y };
    case "tree":
      return {
        parent,
        child,
        x1: parent.x + Math.min(TREE_INDENT / 2, parent.w / 2),
        y1: parent.y + parent.h + (parent.stem ?? 0),
        x2: child.x,
        y2: child.y + child.h / 2,
      };
  }
}

/** 按子节点方向选路径：水平/垂直 S 曲线、圆角折线、树形图的竖干折线 */
/** radius：折线拐角的圆角半径，0 为尖角 */
export function edgePath(e: EdgeGeometry, style: "curve" | "elbow" | "straight", radius = 8): string {
  if (e.child.side === "tree") return treePath(e, radius);
  if (style === "straight") return `M${r(e.x1)},${r(e.y1)} L${r(e.x2)},${r(e.y2)}`;
  if (e.child.side === "down") return style === "curve" ? curvePathVertical(e) : elbowPathVertical(e, radius);
  return style === "curve" ? curvePath(e) : elbowPath(e, radius);
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
