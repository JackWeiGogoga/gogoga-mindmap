/**
 * 缩略图的纯逻辑（单测从这里 import）：什么时候显示、整张图缩到多小、视口框画在哪、点缩略图上一点镜头该去哪。
 * 画在画布左下角一个小 canvas 上，canvas.ts 负责画和接鼠标。
 */

export type MinimapMode = "auto" | "always" | "never";

/** 「自动」时节点数到这么多才显示：小图一屏看得全，缩略图只是占地方 */
export const MINIMAP_AUTO_NODES = 150;
/** 缩略图最大的宽高（CSS 像素），内边距 */
export const MINIMAP_W = 200;
export const MINIMAP_H = 140;
export const MINIMAP_PAD = 6;
/** 很窄 / 很扁的图：缩略图至少这么宽、这么高，图在里面居中（不然只剩一条线，点不中） */
export const MINIMAP_MIN = 48;

/** 图在缩略图里的左上角偏移（内边距，加上图太窄 / 太扁时居中多出来的） */
export interface Offset {
  x: number;
  y: number;
}
const PADDED: Offset = { x: MINIMAP_PAD, y: MINIMAP_PAD };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function minimapShown(
  mode: MinimapMode,
  s: { nodes: number; viewW: number; viewH: number; embedded?: boolean; presenting?: boolean },
): boolean {
  if (mode === "never" || s.embedded || s.presenting) return false;
  // 窗格太小（分屏、侧栏里）放不下，会盖住图
  if (s.viewW < 480 || s.viewH < 320) return false;
  return mode === "always" || s.nodes >= MINIMAP_AUTO_NODES;
}

/** 整张图缩进缩略图：比例 s，缩略图的实际宽高（按图的长宽比，不超过最大值、不小于最小值），图的左上角偏移 */
export function minimapScale(bounds: Rect, maxW = MINIMAP_W, maxH = MINIMAP_H, pad = MINIMAP_PAD, min = MINIMAP_MIN): { s: number; w: number; h: number; ox: number; oy: number } {
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);
  const s = Math.min((maxW - pad * 2) / bw, (maxH - pad * 2) / bh);
  const w = Math.max(min, Math.round(bw * s + pad * 2));
  const h = Math.max(min, Math.round(bh * s + pad * 2));
  return { s, w, h, ox: (w - bw * s) / 2, oy: (h - bh * s) / 2 };
}

/** 图上的坐标 → 缩略图里的坐标 */
export function toMini(bounds: Rect, s: number, x: number, y: number, o: Offset = PADDED): { x: number; y: number } {
  return { x: (x - bounds.x) * s + o.x, y: (y - bounds.y) * s + o.y };
}

/** 现在画布上看得到的那一块，在缩略图里的框 */
export function viewRect(bounds: Rect, s: number, view: { w: number; h: number; tx: number; ty: number; k: number }, o: Offset = PADDED): Rect {
  const a = toMini(bounds, s, -view.tx / view.k, -view.ty / view.k, o);
  return { x: a.x, y: a.y, w: (view.w / view.k) * s, h: (view.h / view.k) * s };
}

/** 点了缩略图里的 (mx, my)：让图上那一点到画布正中，缩放不变 */
export function centerAt(bounds: Rect, s: number, mx: number, my: number, view: { w: number; h: number; k: number }, o: Offset = PADDED): { tx: number; ty: number } {
  const wx = (mx - o.x) / s + bounds.x;
  const wy = (my - o.y) / s + bounds.y;
  return { tx: view.w / 2 - wx * view.k, ty: view.h / 2 - wy * view.k };
}
