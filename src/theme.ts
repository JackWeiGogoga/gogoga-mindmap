import { t } from "./i18n";
import { LayoutOptions } from "./layout";
import { CUSTOM_PREFIX, getCustomTheme, getCustomThemes, SPACING_LAYOUT, tierOf } from "./custom-theme";

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
  const corner = get("mindmap-edge-corner");
  // 没写就是 undefined：跟主题走（自定义主题可以默认虚线 / 尖角）
  return {
    shape: isEdgeStyle(shape) ? shape : undefined,
    dashed: dash === "true" ? true : dash === "false" ? false : undefined,
    sharp: corner === "sharp" ? true : corner === "round" ? false : undefined,
  };
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
  /** 自定义主题按 4 档分别指定是否下划线式；有它就不看 underlineFromDepth */
  underlineTiers?: boolean[];
  /** 自定义主题的拐角 / 虚线默认值（每篇的连线设置可以再覆盖） */
  sharp?: boolean;
  dashed?: boolean;
  layout: Partial<LayoutOptions>;
}

/** 内置主题名，或 custom-xxxx（用户自定义主题） */
export type ThemeId = ThemeName | `${typeof CUSTOM_PREFIX}${string}`;

/** 这一层（相对布局根的深度）是不是下划线式 */
export function isUnderlineAt(theme: Theme, rel: number): boolean {
  if (theme.underlineTiers) return !!theme.underlineTiers[tierOf(rel)];
  return theme.underlineFromDepth !== null && rel >= theme.underlineFromDepth;
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

/** 主题的行为：内置的直接取；自定义的按它的设置拼出来；找不到（比如设置没同步过来）退回雪松 */
export function resolveTheme(id: ThemeId): Theme {
  if (isThemeName(id)) return THEMES[id];
  const c = getCustomTheme(id);
  if (!c) return THEMES.snow;
  return {
    name: c.base,
    rootEdge: c.edge,
    edge: c.edge,
    branchColors: c.branchColors,
    underlineFromDepth: null,
    underlineTiers: c.tiers.map((x) => x.underline),
    sharp: c.sharp,
    dashed: c.dashed,
    layout: SPACING_LAYOUT[c.spacing],
  };
}

/** 画布根元素上 data-theme 用的内置主题（自定义主题取它的基础主题，配色兜底） */
export function baseThemeOf(id: ThemeId): ThemeName {
  if (isThemeName(id)) return id;
  return getCustomTheme(id)?.base ?? "snow";
}

export function isThemeId(v: unknown): v is ThemeId {
  return isThemeName(v) || (typeof v === "string" && v.startsWith(CUSTOM_PREFIX) && !!getCustomTheme(v));
}

/** 菜单里列出的全部主题：内置在前，自定义在后 */
export function themeIds(): ThemeId[] {
  return [...THEME_LIST.map((th) => th.name), ...getCustomThemes().map((c) => c.id as ThemeId)];
}

/** 主题的短名（雪松 / Snow），用在工具栏提示里；用到时才查字典，跟随界面语言 */
export function themeShortLabel(name: ThemeId): string {
  if (!isThemeName(name)) return getCustomTheme(name)?.name ?? t("theme.custom.missing");
  return t(`theme.${name}`);
}

/** 菜单和设置里显示的完整名字：短名 · 一句说明 */
export function themeLabel(name: ThemeId): string {
  if (!isThemeName(name)) return t("theme.label", { name: themeShortLabel(name), desc: t("theme.custom.desc") });
  return t("theme.label", { name: themeShortLabel(name), desc: t(`theme.${name}.desc`) });
}

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && v in THEMES;
}

export const BRANCH_COLOR_COUNT = 6;
