/**
 * 演示模式的纯逻辑：讲解顺序、现在讲到哪、按键 / 点击 / 滑动怎么走、哪些节点正常显示、镜头框哪些节点。
 * 不依赖 obsidian 和 DOM（单测直接 import），画面由 canvas.ts 按这里的结果画。
 *
 * 讲解顺序：按原文顺序（先序），只走有显示中的子节点的节点，中心主题总是第一步；叶子不单独占一步
 * （设置 presentLeaves 打开后叶子也各占一步）。折叠的分支按文件里的样子算：折起来的就不往里讲，
 * 想讲先在图里展开 —— 演示不改折叠，也就不会把折叠状态写进文件。
 * 讲完最后一步是全图，当作结尾。
 */

export interface PresentNode {
  id: string;
  children: PresentNode[];
  parent: PresentNode | null;
  folded?: boolean;
  hidden?: boolean;
}

export interface RouteOptions {
  /** 叶子也各占一步 */
  leaves?: boolean;
  /** 只讲到第几层（中心主题是第 0 层，只讲 depth < limit 的节点）；null / 0 不限 */
  limit?: number | null;
}

/** 显示中的子节点：折叠的没有，隐藏的不算 */
export function shownChildren<N extends PresentNode>(n: N): N[] {
  return n.folded ? [] : (n.children.filter((c) => !c.hidden) as N[]);
}

/** 讲解顺序 */
export function presentRoute<N extends PresentNode>(root: N, opts: RouteOptions = {}): N[] {
  const out: N[] = [];
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  const walk = (n: N, depth: number) => {
    const kids = shownChildren(n);
    if (n === root || (depth < limit && (kids.length > 0 || opts.leaves))) out.push(n);
    if (depth + 1 >= limit && !opts.leaves) return;
    for (const c of kids) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

/**
 * 讲到哪了。pos 是讲解顺序里的第几步（0 起），pos === route.length 是结尾的全图；
 * peek：讲到一半按 O 看一眼全图（再按 O、前进、后退都回到这一步）；
 * ring：点了一个不在讲解顺序里的节点（叶子），从它所在那一步讲、给它加个圈
 */
export interface PresentState {
  pos: number;
  peek: boolean;
  ring: string | null;
}

export type PresentAction = "next" | "prev" | "first" | "last" | "overview" | "exit";

/** 某个节点在讲解顺序里属于第几步：它自己在里面就是它，不然找最近的上级；都没有就第 0 步 */
export function stepOf<N extends PresentNode>(route: N[], node: N): number {
  for (let n: PresentNode | null = node; n; n = n.parent) {
    const i = route.indexOf(n as N);
    if (i >= 0) return i;
  }
  return 0;
}

export function startState<N extends PresentNode>(route: N[], from: N | null): PresentState {
  if (!from) return { pos: 0, peek: false, ring: null };
  const pos = stepOf(route, from);
  return { pos, peek: false, ring: route[pos] === from ? null : from.id };
}

export function step(s: PresentState, a: Exclude<PresentAction, "exit">, len: number): PresentState {
  switch (a) {
    case "next":
      if (s.peek) return { ...s, peek: false };
      return s.pos < len ? { pos: s.pos + 1, peek: false, ring: null } : s;
    case "prev":
      if (s.peek) return { ...s, peek: false };
      // 加了圈的叶子是在它那一步里看的：后退先只是去掉圈
      if (s.ring) return { ...s, ring: null };
      return s.pos > 0 ? { pos: s.pos - 1, peek: false, ring: null } : s;
    case "first":
      return { pos: 0, peek: false, ring: null };
    case "last":
      return { pos: len, peek: false, ring: null };
    case "overview":
      // 已经在结尾的全图上：O 没事可做
      return s.pos >= len ? s : { ...s, peek: !s.peek };
  }
}

/** 点了一个节点：在讲解顺序里的就跳到那一步；不在的（叶子）从它所在那一步讲，给它加圈 */
export function clickNode<N extends PresentNode>(route: N[], node: N): PresentState {
  return startState(route, node);
}

/**
 * 图变了（别处改了文本、重新解析）：current 是原来讲到的节点从中心主题到它的 id 链。
 * 新图里还在的，留在它那一步；不在了就退到最近的还在的上级；都没有回第 0 步。
 * 圈只在那个叶子还是现在这一步的子节点时留着
 */
export function reanchor<N extends PresentNode>(route: N[], s: PresentState, path: string[], oldLen: number): PresentState {
  if (s.pos >= oldLen) return { pos: route.length, peek: false, ring: null };
  for (let i = path.length - 1; i >= 0; i--) {
    const pos = route.findIndex((n) => n.id === path[i]);
    if (pos < 0) continue;
    const ring = s.ring && shownChildren(route[pos]).some((c) => c.id === s.ring) ? s.ring : null;
    return { pos, peek: s.peek, ring };
  }
  return { pos: 0, peek: false, ring: null };
}

export interface PresentLook {
  /** 正常显示的节点 id；null 是全部（全图） */
  normal: Set<string> | null;
  /** 加圈的节点 */
  rings: string[];
  /** 镜头要框住的节点；null 是整张图 */
  frame: string[] | null;
}

/** 现在这一步怎么画：讲到的节点、它的上级和显示中的子节点正常，其余淡掉；镜头框住它、子节点和父节点 */
export function presentLook<N extends PresentNode>(route: N[], s: PresentState): PresentLook {
  const cur = route[s.pos];
  if (!cur || s.peek) return { normal: null, rings: [], frame: null };
  const normal = new Set<string>();
  for (let n: PresentNode | null = cur; n; n = n.parent) normal.add(n.id);
  const kids = shownChildren(cur);
  for (const c of kids) normal.add(c.id);
  const frame = [cur.id, ...kids.map((c) => c.id)];
  if (cur.parent) frame.push(cur.parent.id);
  return { normal, rings: s.ring ? [cur.id, s.ring] : [cur.id], frame };
}

/** 进度：第几步 / 一共几步；结尾的全图和偷看全图时 null */
export function presentProgress(s: PresentState, len: number): { at: number; of: number } | null {
  if (s.peek || s.pos >= len) return null;
  return { at: s.pos + 1, of: len };
}

/** 演示时按键做什么；带 ⌘ / Ctrl / Alt 的不管（交给 Obsidian），其余不认识的返回 null */
export function presentKey(key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }): PresentAction | null {
  if (mods.meta || mods.ctrl || mods.alt) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case "Enter":
      return "next";
    case " ":
      return mods.shift ? "prev" : "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "o":
    case "O":
      return "overview";
    case "Escape":
      return "exit";
  }
  return null;
}

/** 手指横着划了 dx、dy（屏幕像素）：往左划下一步，往右划上一步；太短、偏竖直的不算 */
export function presentSwipe(dx: number, dy: number): "next" | "prev" | null {
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "prev";
}

/** 镜头：把 bounds 放进 view 里（留 pad），缩放夹在 [minK, maxK] */
export function frameView(
  bounds: { x: number; y: number; w: number; h: number },
  view: { w: number; h: number; top?: number; bottom?: number },
  opts: { pad: number; minK: number; maxK: number },
): { k: number; tx: number; ty: number } {
  const top = (view.top ?? 0) + opts.pad;
  const bottom = (view.bottom ?? 0) + opts.pad;
  const w = Math.max(1, view.w - opts.pad * 2);
  const h = Math.max(1, view.h - top - bottom);
  const k = Math.max(opts.minK, Math.min(opts.maxK, w / Math.max(1, bounds.w), h / Math.max(1, bounds.h)));
  return { k, tx: view.w / 2 - (bounds.x + bounds.w / 2) * k, ty: top + h / 2 - (bounds.y + bounds.h / 2) * k };
}
