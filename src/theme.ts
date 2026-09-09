import { LayoutOptions } from "./layout";

export type ThemeName = "snow" | "rainbow" | "business" | "warm" | "mono" | "line" | "forest";
export type EdgeStyle = "curve" | "elbow";

export interface Theme {
  name: ThemeName;
  /** 菜单和设置里显示的名字 */
  label: string;
  /** 根到主主题的连线 */
  rootEdge: EdgeStyle;
  /** 其余层级的连线 */
  edge: EdgeStyle;
  /** 主分支各自一个颜色，主主题用分支色填充 */
  branchColors: boolean;
  /** 深于此层级的节点用「下划线式」：连线贴着文字底边 */
  underlineFromDepth: number | null;
  layout: Partial<LayoutOptions>;
}

/**
 * 主题只描述「行为」：连线形状、是否彩虹分支、下划线层级、间距。
 * 具体配色、圆角、字号在 styles.css 的 [data-theme="…"] 块里，
 * 加主题 = 这里加一条 + 样式表加一块。
 */
export const THEMES: Record<ThemeName, Theme> = {
  snow: {
    name: "snow",
    label: "雪松 · 深色中心，灰底节点",
    rootEdge: "curve",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: {},
  },
  rainbow: {
    name: "rainbow",
    label: "彩虹 · 分支各一色，曲线",
    rootEdge: "curve",
    edge: "curve",
    branchColors: true,
    underlineFromDepth: 2,
    layout: { gapLevel: 44, gapSibling: 10, gapMain: 32 },
  },
  business: {
    name: "business",
    label: "商务 · 蓝色系，直角折线",
    rootEdge: "elbow",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 40, gapSibling: 14, gapMain: 36 },
  },
  warm: {
    name: "warm",
    label: "暖阳 · 橙调，大圆角曲线",
    rootEdge: "curve",
    edge: "curve",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 40, gapSibling: 14 },
  },
  mono: {
    name: "mono",
    label: "极简 · 黑白描边，细线",
    rootEdge: "elbow",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 34, gapSibling: 10, gapMain: 30 },
  },
  line: {
    name: "line",
    label: "线条 · 纯文字节点，细折线",
    rootEdge: "elbow",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 30, gapSibling: 14, gapMain: 18 },
  },
  forest: {
    name: "forest",
    label: "森林 · 绿调分支，曲线",
    rootEdge: "curve",
    edge: "curve",
    branchColors: true,
    underlineFromDepth: null,
    layout: { gapLevel: 40, gapSibling: 12 },
  },
};

export const THEME_LIST: Theme[] = Object.values(THEMES);

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && v in THEMES;
}

export const BRANCH_COLOR_COUNT = 6;
