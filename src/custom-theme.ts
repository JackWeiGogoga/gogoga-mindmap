/**
 * 用户自定义主题：在某个内置主题的基础上，按 4 档层级（中心主题 / 主主题 / 子主题 / 第 3 层及以下）
 * 改字体、外形、边框、宽度和连线。不依赖 obsidian，画布和设置页都能用。
 *
 * 落地方式：画布根元素仍挂内置主题的 data-theme（配色兜底），另挂 data-custom="<id>"；
 * 这里生成一段样式表（浅色 + 自动推算的深色）注入页面，用更高的选择器优先级盖掉对应部分。
 * 节点颜色标记（has-color）、手动拖出来的宽度（has-width）、每篇的连线设置仍然优先。
 */

import type { EdgeStyle, ThemeName } from "./theme";

export type Spacing = "compact" | "normal" | "loose";

export interface TierStyle {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  /** 背景色；null 为透明 */
  fill: string | null;
  /** 下划线式：没有底色，文字下面一条线（线由连线画过去） */
  underline: boolean;
  radius: number;
  borderStyle: "none" | "solid" | "dashed";
  borderWidth: number;
  borderColor: string;
  /** 固定宽度；null 为按内容自适应 */
  width: number | null;
  /** 连到这一层的线；中心主题这一档不用 */
  lineColor: string;
  lineWidth: number;
}

export interface CustomTheme {
  id: string;
  name: string;
  base: ThemeName;
  edge: EdgeStyle;
  sharp: boolean;
  dashed: boolean;
  branchColors: boolean;
  spacing: Spacing;
  /** 0 中心主题 · 1 主主题 · 2 子主题 · 3 第 3 层及以下 */
  tiers: TierStyle[];
}

export const CUSTOM_PREFIX = "custom-";
export const PREVIEW_ID = "custom-preview";

export const SPACING_LAYOUT: Record<Spacing, { gapRoot: number; gapLevel: number; gapSibling: number; gapMain: number }> = {
  compact: { gapRoot: 72, gapLevel: 26, gapSibling: 8, gapMain: 26 },
  normal: { gapRoot: 96, gapLevel: 36, gapSibling: 12, gapMain: 40 },
  loose: { gapRoot: 120, gapLevel: 50, gapSibling: 18, gapMain: 56 },
};

let registry: CustomTheme[] = [];
let preview: CustomTheme | null = null;

export function setCustomThemes(list: CustomTheme[]): void {
  registry = list;
}

export function getCustomThemes(): CustomTheme[] {
  return registry;
}

/** 编辑器的实时预览用一个临时主题，不进设置 */
export function setPreviewTheme(theme: CustomTheme | null): void {
  preview = theme ? { ...theme, id: PREVIEW_ID } : null;
}

export function getCustomTheme(id: string): CustomTheme | undefined {
  if (id === PREVIEW_ID) return preview ?? undefined;
  return registry.find((t) => t.id === id);
}

export function newCustomThemeId(): string {
  return CUSTOM_PREFIX + Math.random().toString(36).slice(2, 8);
}

// ---------- 颜色 ----------

function parseColor(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export function toHex(c: string): string {
  const v = parseColor(c);
  return v ? "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("") : c;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/**
 * 深色模式自动推算：浅底变深底（保留色相、降饱和），深字变浅字，太暗的线和边框提亮。
 * 本来就深的底色（比如中心主题的深蓝）、本来就浅的文字不动。
 */
export function darkVariant(c: string, role: "fill" | "text" | "stroke"): string {
  const v = parseColor(c);
  if (!v) return c;
  const [h, s, l] = rgbToHsl(v);
  if (role === "fill") return l > 0.55 ? hsl(h, s * 0.45, 0.16 + (1 - l) * 0.35) : c;
  if (role === "text") return l < 0.5 ? hsl(h, Math.min(s, 0.25), 0.88) : c;
  return l < 0.45 ? hsl(h, s * 0.7, 0.68) : c;
}

// ---------- 样式表 ----------

function tierRules(sel: string, t: TierStyle, depth: number, theme: CustomTheme, dark: boolean): string {
  const col = (c: string, role: "fill" | "text" | "stroke") => (dark ? darkVariant(c, role) : c);
  const node = `${sel} .mm-node[data-depth="${depth}"]`;
  const out: string[] = [];
  if (!dark) {
    const border = t.borderStyle === "none" || t.underline ? "none" : `${t.borderWidth}px ${t.borderStyle} ${t.borderColor}`;
    out.push(
      `${node} { font-size: ${t.fontSize}px; font-weight: ${t.bold ? 600 : 400}; font-style: ${t.italic ? "italic" : "normal"}; }`,
      `${node}:not(.is-underline) { border-radius: ${t.radius}px; border: ${border}; }`,
    );
    if (t.width) out.push(`${node}:not(.has-width) { width: ${t.width}px; max-width: none; }`);
  } else if (t.borderStyle !== "none" && !t.underline) {
    out.push(`${node}:not(.is-underline) { border-color: ${col(t.borderColor, "stroke")}; }`);
  }
  // 彩虹分支打开时主主题用分支色填充，这里不抢
  const branchFill = theme.branchColors && depth === 1;
  if (!branchFill) {
    out.push(`${node}:not(.has-color):not(.is-underline) { background: ${t.fill ? col(t.fill, "fill") : "transparent"}; color: ${col(t.color, "text")}; }`);
  }
  out.push(`${node}.is-underline:not(.has-color) { color: ${col(t.color, "text")}; }`);
  if (depth > 0) out.push(`${sel} .mm-edge[data-depth="${depth}"] { stroke: ${col(t.lineColor, "stroke")}; stroke-width: ${t.lineWidth}px; }`);
  return out.join("\n");
}

export function customThemeCss(themes: CustomTheme[]): string {
  const parts: string[] = [];
  for (const th of themes) {
    const sel = `.mm-root[data-custom="${th.id}"]`;
    th.tiers.forEach((t, depth) => {
      parts.push(tierRules(sel, t, depth, th, false));
      parts.push(tierRules(`.theme-dark ${sel}`, t, depth, th, true));
    });
  }
  return parts.join("\n");
}

/** 层级在 4 档里的位置：第 3 层及更深都归最后一档 */
export function tierOf(relDepth: number): number {
  return Math.min(Math.max(relDepth, 0), 3);
}
