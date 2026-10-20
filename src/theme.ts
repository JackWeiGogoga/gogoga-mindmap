import { t } from "./i18n";
import { LayoutOptions } from "./layout";

export type ThemeName = "snow" | "rainbow" | "business" | "warm" | "mono" | "line" | "forest";
export type EdgeStyle = "curve" | "elbow" | "straight";
export const EDGE_STYLES: EdgeStyle[] = ["curve", "elbow", "straight"];
export function isEdgeStyle(s: unknown): s is EdgeStyle {
  return EDGE_STYLES.includes(s as EdgeStyle);
}

/** frontmatter 里的 mindmap-edge / mindmap-edge-dash → EdgeOptions */
export function edgeFromFrontmatter(get: (key: string) => string | null | undefined): EdgeOptions {
  const shape = get("mindmap-edge");
  const dash = get("mindmap-edge-dash");
  return { shape: isEdgeStyle(shape) ? shape : undefined, dashed: dash === "true", sharp: get("mindmap-edge-corner") === "sharp" };
}

/** 单篇覆盖主题的连线：形状不设就跟主题，dashed 为虚线 */
export interface EdgeOptions {
  shape?: EdgeStyle;
  dashed?: boolean;
  /** 折线拐角不倒圆角 */
  sharp?: boolean;
}

export interface Theme {
  name: ThemeName;
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
    rootEdge: "curve",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: {},
  },
  rainbow: {
    name: "rainbow",
    rootEdge: "curve",
    edge: "curve",
    branchColors: true,
    underlineFromDepth: 2,
    layout: { gapLevel: 44, gapSibling: 10, gapMain: 32 },
  },
  business: {
    name: "business",
    rootEdge: "elbow",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 40, gapSibling: 14, gapMain: 36 },
  },
  warm: {
    name: "warm",
    rootEdge: "curve",
    edge: "curve",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 40, gapSibling: 14 },
  },
  mono: {
    name: "mono",
    rootEdge: "elbow",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 34, gapSibling: 10, gapMain: 30 },
  },
  line: {
    name: "line",
    rootEdge: "elbow",
    edge: "elbow",
    branchColors: false,
    underlineFromDepth: null,
    layout: { gapLevel: 30, gapSibling: 14, gapMain: 18 },
  },
  forest: {
    name: "forest",
    rootEdge: "curve",
    edge: "curve",
    branchColors: true,
    underlineFromDepth: null,
    layout: { gapLevel: 40, gapSibling: 12 },
  },
};

export const THEME_LIST: Theme[] = Object.values(THEMES);

/** 主题的短名（雪松 / Snow），用在工具栏提示里；用到时才查字典，跟随界面语言 */
export function themeShortLabel(name: ThemeName): string {
  return t(`theme.${name}`);
}

/** 菜单和设置里显示的完整名字：短名 · 一句说明 */
export function themeLabel(name: ThemeName): string {
  return t("theme.label", { name: themeShortLabel(name), desc: t(`theme.${name}.desc`) });
}

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && v in THEMES;
}

export const BRANCH_COLOR_COUNT = 6;
