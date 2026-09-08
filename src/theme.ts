import { LayoutOptions } from "./layout";

export type ThemeName = "snow" | "rainbow";
export type EdgeStyle = "curve" | "elbow";

export interface Theme {
  name: ThemeName;
  /** 根到主主题的连线 */
  rootEdge: EdgeStyle;
  /** 其余层级的连线 */
  edge: EdgeStyle;
  /** 是否按主分支着色（彩虹分支） */
  branchColors: boolean;
  /** 深于此层级的节点用「下划线式」：连线贴着文字底边 */
  underlineFromDepth: number | null;
  layout: Partial<LayoutOptions>;
}

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
};

export const BRANCH_COLOR_COUNT = 6;
