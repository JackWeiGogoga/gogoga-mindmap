/**
 * 画布：把树渲染成 HTML 节点 + SVG 连线，负责平移缩放、选择（多选/框选）、拖拽换父、
 * 内联编辑、备注编辑、键盘操作。不依赖 obsidian 模块，浏览器调试页和代码块渲染器共用。
 */

import {
  addChild,
  addSibling,
  attachSubtree,
  findByPath,
  isAncestor,
  MindDoc,
  MindNode,
  moveNode,
  boxGroups,
  NODE_MAX_WIDTH,
  NODE_MIN_WIDTH,
  pathOf,
  removeNode,
  visibleChildren,
  walk,
} from "./model";
import {
  BOX_PAD,
  Bounds,
  DEFAULT_LAYOUT,
  edgeGeometry,
  edgePath,
  layoutTree,
  LayoutOptions,
  LayoutResult,
  Placed,
  Size,
  Structure,
  STRUCTURES,
} from "./layout";
import {
  fromEditableText,
  IMAGE_MAX_WIDTH,
  FRAME_DEFAULT_H,
  FRAME_DEFAULT_W,
  FRAME_MAX,
  FRAME_MIN,
  IMAGE_MIN_WIDTH,
  MARKER_GROUPS,
  plainText,
  renderInline,
  setFrameSize,
  setImageWidth,
  splitMarkers,
  toEditableText,
  toggleMarker,
  toggleTask,
  wikilinkOf,
} from "./inline";
import { BRANCH_COLOR_COUNT, EdgeOptions, EdgeStyle, THEME_LIST, themeLabel, themeShortLabel, ThemeName, THEMES } from "./theme";
import { Key, t } from "./i18n";
import { COLOR_NAMES, convertLevelKind, newBlockId, normalizeNote, parseClipboard, subtreeToList, unescapeNote } from "./markdown";

export interface CanvasHost {
  /** 渲染节点备注（Obsidian 里用 MarkdownRenderer），缺省为纯文本 */
  renderNote?: (el: HTMLElement, markdown: string) => void;
  openLink?: (href: string, internal: boolean, ev: MouseEvent) => void;
  /** 内部链接悬停：Obsidian 用来弹页面预览 */
  hoverLink?: (ev: MouseEvent, linktext: string, targetEl: HTMLElement) => void;
  /** 让用户挑一篇笔记（或新建），返回笔记名；取消返回 null */
  pickNote?: (suggested: string) => Promise<string | null>;
  /** 渲染 $…$ 公式 */
  renderMath?: (tex: string) => HTMLElement | null;
  /** 一批节点渲染完之后（Obsidian 用来 finishRenderMath） */
  afterRender?: () => void;
  /** 把图片链接解析成 src */
  resolveImage?: (link: string) => string | null;
  /** 原生右键菜单（Obsidian 的 Menu）；没有就用画布自带的 */
  showMenu?: (entries: MenuEntry[], ev: MouseEvent) => void;
  /** 点了 #标签 */
  openTag?: (tag: string) => void;
  /** 正在被拖进来的 vault 文件（Obsidian 内部拖拽没有标准 dataTransfer） */
  getDraggedFiles?: () => DroppedFile[] | null;
  /** 把二进制存成附件，返回可用于 ![[…]] 的链接文字 */
  saveBinary?: (name: string, data: ArrayBuffer) => Promise<string>;
  /** 编辑节点时输入 [[ 弹出的候选：vault 里的文件，按最近修改排序 */
  listLinkTargets?: () => LinkTarget[];
  /** 当前文件名（不含扩展名），复制节点链接用 */
  fileBasename?: () => string;
  notice?: (message: string) => void;
  /** 用宿主的样式显示提示（Obsidian 的 setTooltip）；没有就退回原生 title */
  setTooltip?: (el: HTMLElement, text: string, placement: TooltipPlacement) => void;
}

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export interface LinkTarget {
  /** 列表里显示的名字 */
  name: string;
  /** 所在文件夹，帮着区分重名 */
  folder: string;
  /** 写进 [[ ]] 的文字 */
  linktext: string;
  /** Markdown 笔记；匹配程度一样时排在图片等附件前面 */
  isNote: boolean;
}

export interface MenuEntry {
  title?: string;
  icon?: string;
  disabled?: boolean;
  checked?: boolean;
  run?: () => void;
  separator?: boolean;
}

export interface DroppedFile {
  name: string;
  basename: string;
  linktext: string;
  isImage: boolean;
}

export interface CanvasOptions {
  structure: Structure;
  theme: ThemeName;
  editable: boolean;
  host?: CanvasHost;
  /** 树被编辑后调用（折叠、改文字、增删移节点、颜色、备注） */
  onChange?: (doc: MindDoc) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onStructureChange?: (structure: Structure) => void;
  onThemeChange?: (theme: ThemeName) => void;
  /** 单篇的连线样式（覆盖主题），改了之后回调去写 frontmatter */
  edge?: EdgeOptions;
  onEdgeChange?: (edge: EdgeOptions) => void;
  /** 每次布局完成后调用，可用来按内容定高度 */
  onLayout?: (bounds: Bounds) => void;
  /** 每次整体渲染完成后（树结构可能变了） */
  onRender?: () => void;
  /** 选中变化 */
  onSelectionChange?: (primary: MindNode | null, all: MindNode[]) => void;
  /** 提供则工具栏出现「大纲」按钮 */
  onToggleOutline?: () => void;
  /** 工具栏位置；提供 onToolbarPositionChange 后工具栏上右键可以切换 */
  toolbarPosition?: ToolbarPosition;
  onToolbarPositionChange?: (pos: ToolbarPosition) => void;
  /** 返回 true 时滚轮直接缩放、Shift+滚轮平移；每次滚动时读取，改设置立即生效 */
  wheelZoom?: () => boolean;
  /** 嵌在别的笔记里（代码块）：阻止事件冒泡到编辑器，工具栏带「编辑」开关，备注不做实时同步 */
  embedded?: boolean;
  /** 平移缩放变化时调用，用来在重新渲染后恢复视口 */
  onViewChange?: (state: ViewState) => void;
  onEditableChange?: (editable: boolean) => void;
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
/** label 用 getter：模块加载时界面语言还没定，用到时再查字典 */
const TOOLBAR_POSITION_LABELS: { id: ToolbarPosition; readonly label: string }[] = [
  { id: "bottom", get label() { return t("toolbarPos.bottom"); } },
  { id: "top", get label() { return t("toolbarPos.top"); } },
  { id: "left", get label() { return t("toolbarPos.left"); } },
  { id: "right", get label() { return t("toolbarPos.right"); } },
];

export interface ViewState {
  tx: number;
  ty: number;
  k: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const FIT_PADDING = 48;
const DRAG_THRESHOLD = 4;

const ICONS: Record<string, string> = {
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  center: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  logic: '<svg viewBox="0 0 24 24"><path d="M3 12h6M9 12v-6h6M9 12v6h6M9 12h6"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.21-1.79 4-4 4h-1.5a1.5 1.5 0 0 0-1.06 2.56A1.5 1.5 0 0 1 12 21Z"/><circle cx="7.5" cy="12" r="1"/><circle cx="9.5" cy="8" r="1"/><circle cx="14.5" cy="7.5" r="1"/><circle cx="17.5" cy="11" r="1"/></svg>',
  structure: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v4M6 17v-3h12v3"/></svg>',
  mindmap: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M15 12h6M9 12H3M14.5 9.5l4-4M14.5 14.5l4 4M9.5 9.5l-4-4M9.5 14.5l-4 4"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  outline: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  child: '<svg viewBox="0 0 24 24"><path d="M4 6h6M4 12h4M12 12h8M16 8v8"/></svg>',
  sibling: '<svg viewBox="0 0 24 24"><path d="M4 7h8M4 12h8M4 17h8M18 10v4M16 12h4"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>',
  marker: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.3l6-.8z"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  none: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  edge: '<svg viewBox="0 0 24 24"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18c6 0 4-12 10-12" stroke-dasharray="0"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1"/></svg>',
};

/** Obsidian 在 body 上标了平台（mod-macos / is-ios），按它来，不去读 navigator */
function isApple(): boolean {
  const cls = document.body.classList;
  return cls.contains("mod-macos") || cls.contains("is-ios");
}

/** 把 Mod/Shift/Alt 写成当前平台的样子：⌘⇧⌥ 或 Ctrl+Shift+Alt+ */
function sc(...keys: string[]): string {
  const map: Record<string, string> = isApple()
    ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵" }
    : { Mod: "Ctrl+", Shift: "Shift+", Alt: "Alt+", Enter: "Enter" };
  return keys.map((k) => map[k] ?? k).join("");
}

/** 颜色名（写进 %%color%% 的数据）→ 界面上显示的名字的字典键 */
const COLOR_LABEL_KEYS: Record<string, Key> = {
  red: "color.red",
  orange: "color.orange",
  yellow: "color.yellow",
  green: "color.green",
  teal: "color.teal",
  blue: "color.blue",
  purple: "color.purple",
  pink: "color.pink",
  gray: "color.gray",
};

function colorLabel(color: string): string {
  const key = COLOR_LABEL_KEYS[color];
  return key ? t(key) : color;
}

function icon(name: string): HTMLElement {
  const span = createSpan({ cls: "mm-icon" });
  // 图标是上面写死的 SVG 字符串，按 SVG 文档解析后挂上去，不走 innerHTML
  const markup = ICONS[name].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  span.append(new DOMParser().parseFromString(markup, "image/svg+xml").documentElement);
  return span;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function contrastText(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#1f1f1f" : "#ffffff";
}

interface DropTarget {
  parent: MindNode;
  index: number;
  /** 落在节点上（成为末尾子节点）还是落在子节点列之间（插入到指定位置） */
  kind: "node" | "gap";
  /** 思维导图结构里拖到中心主题的左边还是右边 */
  side?: "left" | "right";
  /** 有 side 时：插在那一侧从上往下第几个位置（画指示线用） */
  slot?: number;
}

export class MindMapCanvas {
  readonly el: HTMLElement;
  private viewport: HTMLElement;
  private svg: SVGSVGElement;
  private nodesEl: HTMLElement;
  private overlay: HTMLElement;
  private zoomLabel!: HTMLButtonElement;
  private toolbar!: HTMLElement;
  private toolbarPos: ToolbarPosition = "bottom";
  /** 记住每个按钮的提示文案；节点上的图标会随渲染反复重建，用 WeakMap 免得越积越多 */
  private tips = new WeakMap<HTMLElement, { text: string; zone: "toolbar" | "fixed"; placement?: TooltipPlacement }>();
  /** 工具栏按钮单独留一份引用，换位置时要重新按新方向应用 */
  private toolbarTips: HTMLElement[] = [];
  private positionMenu: HTMLElement | null = null;
  private structureButton: HTMLButtonElement | null = null;
  private structureSep: HTMLElement | null = null;
  private structureMenu: HTMLElement | null = null;
  private themeButton: HTMLButtonElement | null = null;
  private themeMenu: HTMLElement | null = null;
  private edgeButton: HTMLButtonElement | null = null;
  /** 拖节点 / 拖宽度时贴近画布边缘自动平移；tick 在每帧平移后重算拖拽状态 */
  private autoScroll: { raf: number; vx: number; vy: number; tick: () => void } | null = null;
  private compositionSel: { start: number; end: number; text: string } | null = null;
  private linkSuggest: { el: HTMLElement; items: LinkTarget[]; index: number; open: number } | null = null;
  private edgeMenu: HTMLElement | null = null;
  private editToggle: HTMLButtonElement | null = null;
  private nodebar: HTMLElement | null = null;

  private doc: MindDoc | null = null;
  private layout: LayoutResult | null = null;
  private els = new Map<string, HTMLElement>();
  private sizes = new Map<string, Size>();
  /** 节点内容的签名，用来判断能否原样复用元素 */
  private elSigs = new WeakMap<HTMLElement, string>();
  /** 只跟「节点里画什么」有关的签名；它没变就别动 DOM 子节点（iframe 重新插入会重新加载） */
  private elContent = new WeakMap<HTMLElement, string>();
  /** 每个节点当前活着的 iframe，按 id 存，重渲染时复用同一个元素 */
  private frames = new Map<string, HTMLIFrameElement>();
  /** 挡板已经放开的那个节点；跨域 iframe 里点了哪儿看不见，默认全挡住免得误跳转 */
  private liveFrame: string | null = null;
  /** 上次写进去的位置，避免重复写同样的值 */
  private lastPos = new WeakMap<HTMLElement, { x: number; y: number }>();
  /** 连线 path 的复用池 */
  private edgePaths: SVGPathElement[] = [];
  /** 外框：rect 放在连线下面的一个 g 里，按「外层先画」复用；标题是 nodes 层里的 HTML，按起始节点 id 复用 */
  private boxLayer!: SVGGElement;
  private boxRects: SVGRectElement[] = [];
  private boxTitles = new Map<string, HTMLElement>();
  private boxTitleStart = new WeakMap<HTMLElement, MindNode>();
  private editingBox: MindNode | null = null;

  private tx = 0;
  private ty = 0;
  private k = 1;
  private hasView = false;
  private needsRender = false;

  private selected = new Set<MindNode>();
  private primary: MindNode | null = null;
  private editing: MindNode | null = null;
  private editingIsNew = false;

  private pointers = new Map<number, { x: number; y: number }>();
  private pan: { x: number; y: number; tx: number; ty: number; moved: boolean; onNode?: boolean } | null = null;
  private pinch: { dist: number; k: number } | null = null;
  private pendingDrag: { node: MindNode; x: number; y: number } | null = null;
  private lastTap: { node: MindNode; time: number } | null = null;
  /** 这次按下是不是落在播放器挡板上；双击挡板是「激活播放器」，不是「编辑文字」 */
  private downOnShield = false;
  private pendingSelectPath: string | null = null;
  /** 触屏：按住节点不动一段时间才进入拖拽，期间手指移动视为平移 */
  private touchPress: { node: MindNode; timer: number; ev: PointerEvent } | null = null;
  private search: { bar: HTMLElement; input: HTMLInputElement; count: HTMLElement; matches: Set<MindNode>; list: MindNode[]; index: number } | null = null;
  private foldMenu: HTMLElement | null = null;
  private linkMenu: HTMLElement | null = null;
  private linking = false;
  private focusRoot: MindNode | null = null;
  private crumbs: HTMLElement | null = null;
  private markerPicker: HTMLElement | null = null;
  private markerPickerCleanup: (() => void) | null = null;
  private dropHover: HTMLElement | null = null;
  private imgHandle: HTMLElement | null = null;
  private widthHandle: HTMLElement | null = null;
  private widthResize: { node: MindNode; el: HTMLElement; startWorldX: number; startW: number; dir: 1 | -1 } | null = null;
  private imgResize: {
    node: MindNode;
    /** 图片或 iframe，两者都靠右下角那个手柄改大小 */
    box: HTMLImageElement | HTMLIFrameElement;
    frame: boolean;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    handle: HTMLElement;
  } | null = null;
  private clipboardText = "";
  private drag: { node: MindNode; ghost: HTMLElement; subtree: Set<MindNode>; target: DropTarget | null; indicator: HTMLElement } | null = null;
  private marquee: { x: number; y: number; el: HTMLElement; base: Set<MindNode> } | null = null;
  private popover: HTMLElement | null = null;
  private popoverSave: (() => void) | null = null;
  /** 备注编辑中：把文本框内容同步到节点上，返回是否有变化 */
  private popoverApply: (() => boolean) | null = null;
  private notifyTimer: number | null = null;
  private ro: ResizeObserver | null = null;
  private retryTimer: number | null = null;
  private retries = 0;
  private disposers: (() => void)[] = [];
  private opts: CanvasOptions;

  constructor(container: HTMLElement, opts: CanvasOptions) {
    this.opts = { ...opts };
    this.el = container;
    this.el.classList.add("mm-root");
    this.el.tabIndex = 0;
    this.el.dataset.theme = opts.theme;
    this.el.dataset.branchColors = THEMES[opts.theme].branchColors ? "true" : "false";
    this.el.dataset.structure = opts.structure;
    this.el.classList.toggle("is-editable", opts.editable);
    this.el.classList.toggle("is-embedded", !!opts.embedded);
    // Obsidian 移动端的边缘滑动手势会和单指平移抢事件，把侧边栏划出来。
    // 它的手势识别器见到祖先带 data-ignore-swipe 就整个跳过，这是官方留的退出口。
    this.el.dataset.ignoreSwipe = "true";
    this.toolbarPos = opts.toolbarPosition ?? "bottom";
    this.el.dataset.toolbar = this.toolbarPos;

    this.viewport = createDiv();
    this.viewport.className = "mm-viewport";
    this.svg = createSvg("svg");
    this.svg.setAttribute("class", "mm-edges");
    if (opts.edge?.dashed) this.svg.classList.add("is-dashed");
    this.boxLayer = createSvg("g");
    this.boxLayer.setAttribute("class", "mm-boxes");
    this.svg.append(this.boxLayer);
    this.nodesEl = createDiv();
    this.nodesEl.className = "mm-nodes";
    this.overlay = createDiv();
    this.overlay.className = "mm-overlay";
    this.viewport.append(this.svg, this.nodesEl, this.overlay);
    this.el.append(this.viewport);
    this.buildToolbar();
    this.bindEvents();

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => {
        if (this.needsRender) {
          this.render();
          return;
        }
        if (!this.hasView && this.fit()) this.hasView = true;
        this.positionNodebar();
      });
      this.ro.observe(this.el);
    }
  }

  // ---------- 公共 API ----------

  setDoc(doc: MindDoc): void {
    this.flush();
    const paths = [...this.selected].map(pathOf);
    const primaryPath = this.primary ? pathOf(this.primary) : null;
    const focusPath = this.focusRoot ? pathOf(this.focusRoot) : null;
    this.doc = doc;
    this.focusRoot = focusPath !== null ? findByPath(doc.root, focusPath) : null;
    if (this.focusRoot === doc.root) this.focusRoot = null;
    this.editing = null;
    this.selected = new Set(paths.map((p) => findByPath(doc.root, p)).filter((n): n is MindNode => !!n));
    this.primary = primaryPath !== null ? findByPath(doc.root, primaryPath) : null;
    if (this.primary && !this.selected.has(this.primary)) this.primary = null;
    this.render();
    if (this.search) this.runSearch(this.search.input.value, false);
  }

  getDoc(): MindDoc | null {
    return this.doc;
  }

  setStructure(structure: Structure): void {
    if (this.opts.structure === structure) return;
    this.opts.structure = structure;
    this.el.dataset.structure = structure;
    if (this.structureButton) this.tip(this.structureButton, this.structureTipText(), "toolbar");
    this.render();
  }

  setTheme(theme: ThemeName): void {
    this.opts.theme = theme;
    this.el.dataset.theme = theme;
    this.el.dataset.branchColors = THEMES[theme].branchColors ? "true" : "false";
    if (this.themeButton) this.tip(this.themeButton, this.themeTipText(), "toolbar");
    this.render();
  }

  setEdge(edge: EdgeOptions): void {
    this.opts.edge = { ...edge };
    this.svg.classList.toggle("is-dashed", !!edge.dashed);
    if (this.edgeButton) this.tip(this.edgeButton, this.edgeTipText(), "toolbar");
    if (this.doc) this.reflow();
  }

  private edgeTipText(): string {
    const shape = this.opts.edge?.shape;
    return t("canvas.edgeTip", { name: shape ? t(`edge.${shape}`) : t("edge.theme") });
  }

  private toggleEdgeMenu(anchor: HTMLElement): void {
    if (this.edgeMenu) {
      this.closeEdgeMenu();
      return;
    }
    const cur = this.opts.edge ?? {};
    const pick = (next: EdgeOptions) => {
      this.setEdge(next);
      this.opts.onEdgeChange?.(next);
    };
    const shapes: (EdgeStyle | undefined)[] = [undefined, "curve", "elbow", "straight"];
    this.edgeMenu = this.buildMenu(
      [
        ...shapes.map((shape) => ({
          label: shape ? t(`edge.${shape}`) : t("edge.theme"),
          active: cur.shape === shape,
          run: () => pick({ ...cur, shape }),
        })),
        { label: t("edge.dashed"), active: !!cur.dashed, run: () => pick({ ...cur, dashed: !cur.dashed }) },
        { label: t("edge.rounded"), active: !cur.sharp, run: () => pick({ ...cur, sharp: !cur.sharp }) },
      ],
      anchor,
      () => this.closeEdgeMenu(),
    );
  }

  private closeEdgeMenu(): void {
    this.edgeMenu?.remove();
    this.edgeMenu = null;
  }

  private themeTipText(): string {
    return t("canvas.themeTip", { name: themeShortLabel(this.opts.theme) });
  }

  private toggleThemeMenu(anchor: HTMLElement): void {
    if (this.themeMenu) {
      this.closeThemeMenu();
      return;
    }
    this.themeMenu = this.buildMenu(
      THEME_LIST.map((th) => ({
        label: themeLabel(th.name),
        active: th.name === this.opts.theme,
        run: () => {
          this.setTheme(th.name);
          this.opts.onThemeChange?.(th.name);
        },
      })),
      anchor,
      () => this.closeThemeMenu(),
    );
  }

  private closeThemeMenu(): void {
    this.themeMenu?.remove();
    this.themeMenu = null;
  }

  getBounds(): Bounds | null {
    return this.layout?.bounds ?? null;
  }

  /** 导出用：节点层与连线层 */
  get layers(): { nodes: HTMLElement; edges: SVGSVGElement } {
    return { nodes: this.nodesEl, edges: this.svg };
  }

  getSelection(): MindNode[] {
    return [...this.selected];
  }

  getSelectedPath(): string | null {
    return this.primary ? pathOf(this.primary) : null;
  }

  selectPath(path: string | null): void {
    if (!this.doc || path === null) return;
    const node = findByPath(this.doc.root, path);
    if (!node) return;
    if (this.els.has(node.id)) this.select(node);
    else this.pendingSelectPath = path;
  }

  getViewState(): ViewState {
    return { tx: this.tx, ty: this.ty, k: this.k };
  }

  /** 恢复视口；之后首次渲染不再自动适应画布 */
  setViewState(state: ViewState): void {
    this.tx = state.tx;
    this.ty = state.ty;
    this.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.k));
    this.hasView = true;
    this.applyTransform();
  }

  isEditable(): boolean {
    return this.opts.editable;
  }

  setToolbarPosition(pos: ToolbarPosition): void {
    this.toolbarPos = pos;
    this.el.dataset.toolbar = pos;
    if (this.toolbar) this.toolbar.dataset.pos = pos;
    // 弹出方向变了，工具栏上的提示要重新应用
    for (const el of this.toolbarTips) this.applyTip(el);
  }

  private structureTipText(): string {
    const label = STRUCTURES.find((s) => s.id === this.opts.structure)?.label ?? this.opts.structure;
    return t("canvas.structureTip", { name: label });
  }

  setEditable(editable: boolean): void {
    if (this.opts.editable === editable) return;
    if (!editable) this.flush();
    this.opts.editable = editable;
    this.el.classList.toggle("is-editable", editable);
    this.structureButton?.classList.toggle("is-hidden", !editable);
    this.themeButton?.classList.toggle("is-hidden", !editable);
    this.edgeButton?.classList.toggle("is-hidden", !editable);
    this.structureSep?.classList.toggle("is-hidden", !editable);
    if (this.editToggle) {
      this.editToggle.replaceChildren(icon(editable ? "check" : "pencil"));
      this.tip(this.editToggle, editable ? t("canvas.doneEditing") : t("canvas.editEmbedded"), "toolbar");
      this.editToggle.classList.toggle("is-active", editable);
    }
    if (!editable) this.select(null);
    this.positionNodebar();
    this.opts.onEditableChange?.(editable);
  }

  /**
   * 把进行中的编辑（标签、备注）同步到树上并通知，但不关闭编辑界面。
   * 视图自动保存前调用，保证写盘内容包含正在输入的文字。
   */
  /** 画布上正在改文字或备注：这时外面来的内容先不要覆盖 */
  isBusy(): boolean {
    return !!this.editing || !!this.popoverApply;
  }

  syncPending(): boolean {
    let changed = false;
    if (this.editing) {
      const label = this.els.get(this.editing.id)?.querySelector<HTMLElement>(".mm-label");
      const text = fromEditableText(label?.textContent ?? "");
      if (text && text !== this.editing.text) {
        this.editing.text = text;
        changed = true;
      }
    }
    if (this.popoverApply && this.popoverApply()) changed = true;
    if (changed) this.notify();
    return changed;
  }

  /** 结束所有进行中的编辑并落到树上；视图卸载或换文档前调用 */
  flush(): void {
    if (this.editing) this.commitEdit(false, false);
    if (this.popover) this.closePopover();
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  destroy(): void {
    this.ro?.disconnect();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    if (this.reflowTimer !== null) window.clearTimeout(this.reflowTimer);
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    if (this.touchPress) window.clearTimeout(this.touchPress.timer);
    for (const d of this.disposers) d();
    this.el.replaceChildren();
    this.el.classList.remove("mm-root");
    this.crumbs = null;
    this.structureMenu = null;
    this.themeMenu = null;
    this.themeButton = null;
    this.edgeMenu = null;
    this.edgeButton = null;
    this.markerPicker = null;
    this.markerPickerCleanup = null;
    this.edgePaths = [];
    for (const c of [...this.outsideCleanups]) c();
    this.toolbarTips = [];
  }

  /** 返回是否真的适应了：容器还没量出尺寸时会失败，调用方得再试一次 */
  fit(): boolean {
    if (!this.layout) return false;
    return this.fitBounds(this.layout.bounds);
  }

  /** maxK：整图适应时最大 100%，缩放到分支时允许放大 */
  private fitBounds(bounds: Bounds, maxK = 1): boolean {
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    if (!cw || !ch) return false;
    let k = Math.min(maxK, (cw - FIT_PADDING * 2) / bounds.w, (ch - FIT_PADDING * 2) / bounds.h);
    if (k > 0.96 && k < 1.04) k = 1;
    this.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
    this.tx = cw / 2 - (bounds.x + bounds.w / 2) * this.k;
    this.ty = ch / 2 - (bounds.y + bounds.h / 2) * this.k;
    this.applyTransform();
    return true;
  }

  /** 根节点居中，缩放归 100% */
  center(): void {
    this.k = 1;
    this.tx = this.el.clientWidth / 2;
    this.ty = this.el.clientHeight / 2;
    this.applyTransform();
  }

  zoomBy(factor: number, sx?: number, sy?: number): void {
    const cx = sx ?? this.el.clientWidth / 2;
    const cy = sy ?? this.el.clientHeight / 2;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.k * factor));
    const ratio = next / this.k;
    this.tx = cx - (cx - this.tx) * ratio;
    this.ty = cy - (cy - this.ty) * ratio;
    this.k = next;
    this.applyTransform();
  }

  // ---------- 渲染 ----------

  render(): void {
    if (!this.doc) return;
    if (!this.el.clientWidth && !this.el.clientHeight) {
      this.needsRender = true;
      return;
    }
    // 插件刚启用时 styles.css 可能晚于首次渲染注入，测出来的尺寸全是错的；等样式就绪再画
    if (getComputedStyle(this.viewport).position !== "absolute") {
      this.scheduleRetry();
      return;
    }
    this.needsRender = false;
    this.closePopover();
    this.editing = null;
    this.rebuild();
    this.reflow();
    // 代码块嵌入首次渲染时容器高度还是 0（真正的高度要等 onLayout 下一帧才写上去），
    // 这时 fit 量不出东西。失败就别置 hasView，等 ResizeObserver 拿到高度再适应一次。
    if (!this.hasView && this.fit()) this.hasView = true;
    if (this.pendingSelectPath !== null) {
      const path = this.pendingSelectPath;
      this.pendingSelectPath = null;
      this.selectPath(path);
    }
    this.positionNodebar();
    this.opts.onRender?.();
  }

  private scheduleRetry(): void {
    this.needsRender = true;
    if (this.retryTimer !== null || this.retries > 50) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.retries += 1;
      if (this.needsRender) this.render();
    }, 100);
  }

  /**
   * 重建可见节点的 DOM。大图上重新创建全部元素会让浏览器重算几千个节点的样式和布局
   * （3000 节点约 190ms），所以按节点 id 复用：内容签名没变的元素原样留着，只增删改差异部分。
   */
  private rebuild(): void {
    const doc = this.doc!;
    const theme = THEMES[this.opts.theme];
    const branchOf = new Map<string, number>();
    doc.root.children.forEach((c, i) => walk(c, (n) => branchOf.set(n.id, i % BRANCH_COLOR_COUNT)));
    const base = this.focusRoot ?? doc.root;
    const prev = this.els;
    const next = new Map<string, HTMLElement>();

    const visit = (node: MindNode) => {
      const rel = node.depth - base.depth;
      const branch = theme.branchColors ? branchOf.get(node.id) : undefined;
      // 内容签名管子节点，整体签名再叠上纯表现的部分（选中、配色、层级）；
      // 只有前者变了才重建 DOM，选一下节点不该把里面的 iframe 打回重载
      const contentSig = [node.text, node.note ? "n" : "", node.folded ? "f" : "", node.children.length, theme.name].join("\u0001");
      const sig = [
        contentSig,
        node.color ?? "",
        node.width ?? "",
        rel,
        branch ?? "",
        this.selected.has(node) ? "s" : "",
        this.search?.matches.has(node) ? (this.search.list[this.search.index] === node ? "M" : "m") : "",
      ].join("\u0001");
      const reused = prev.get(node.id);
      if (reused && this.elSigs.get(reused) === sig) {
        next.set(node.id, reused);
        for (const c of visibleChildren(node)) visit(c);
        return;
      }
      const el = reused ?? createDiv();
      const keepChildren = !!reused && this.elContent.get(reused) === contentSig;
      if (reused) {
        if (!keepChildren) el.replaceChildren();
        el.removeAttribute("style");
        el.removeAttribute("data-color");
        el.removeAttribute("data-branch");
        // 位置在 reflow 里重写，先清掉缓存免得被当成没变
        this.lastPos.delete(el);
      }
      this.elSigs.set(el, sig);
      this.elContent.set(el, contentSig);
      el.className = "mm-node";
      el.dataset.id = node.id;
      el.dataset.depth = String(Math.min(rel, 3));
      if (branch !== undefined) el.dataset.branch = String(branch);
      if (node.color) {
        if ((COLOR_NAMES as readonly string[]).includes(node.color)) {
          el.dataset.color = node.color;
        } else {
          el.style.setProperty("--mm-node-bg", node.color);
          el.style.setProperty("--mm-node-fg", contrastText(node.color));
          el.classList.add("has-custom-color");
        }
        el.classList.add("has-color");
      }
      if (node.width) {
        el.classList.add("has-width");
        el.style.width = `${node.width}px`;
      }
      if (theme.underlineFromDepth !== null && rel >= theme.underlineFromDepth && !node.color) {
        el.classList.add("is-underline");
      }
      if (this.selected.has(node)) el.classList.add("is-selected");
      if (this.search?.matches.has(node)) {
        el.classList.add("is-match");
        if (this.search.list[this.search.index] === node) el.classList.add("is-current-match");
      }

      if (!keepChildren) {
        const label = createDiv();
        label.className = "mm-label";
        renderInline(label, node.text || (node.depth === 0 ? t("canvas.centralTopic") : ""), {
          onLink: (href, internal, ev) => this.opts.host?.openLink?.(href, internal, ev),
          onHover: (href, ev, a) => this.opts.host?.hoverLink?.(ev, href, a),
          renderMath: this.opts.host?.renderMath,
          resolveImage: this.opts.host?.resolveImage,
          onImageLoad: () => this.scheduleReflow(),
          onTag: (tag) => this.opts.host?.openTag?.(tag),
          onTaskToggle: () => {
            if (!this.opts.editable) return;
            node.text = toggleTask(node.text);
            this.render();
            this.notify();
          },
          reuseFrame: (src) => {
            const f = this.frames.get(node.id);
            return f && f.src === src ? f : null;
          },
        });
        const frame = label.querySelector("iframe");
        if (frame) this.frames.set(node.id, frame);
        else this.frames.delete(node.id);
        const shield = label.querySelector<HTMLElement>(".mm-frame-shield");
        if (shield) {
          this.tip(shield, t("canvas.frameShield"), "fixed", "top");
          const activate = shield.querySelector<HTMLElement>(".mm-frame-activate");
          if (activate) {
            // 按钮上不要触发选中/拖拽，点完直接放开挡板
            activate.addEventListener("pointerdown", (ev) => ev.stopPropagation());
            activate.addEventListener("click", (ev) => {
              ev.stopPropagation();
              this.select(node);
              this.positionNodebar();
              this.setLiveFrame(node.id);
            });
          }
        }
        el.append(label);
      }
      if (el.querySelector("img")) el.classList.add("has-image");
      if (this.frames.has(node.id)) {
        el.classList.add("has-frame");
        if (this.liveFrame === node.id) el.classList.add("is-frame-live");
      }
      const link = wikilinkOf(node.text);
      if (link) {
        el.classList.add("is-linked");
        el.dataset.link = link.target;
      } else if (el.dataset.link) {
        delete el.dataset.link;
      }

      if (!keepChildren && node.note) {
        const n = icon("note");
        n.classList.add("mm-note-icon");
        this.tip(n, t("canvas.viewNote"));
        n.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        n.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleNotePopover(node);
        });
        el.append(n);
      }

      if (!keepChildren && node.children.length) {
        const toggle = createEl("button");
        toggle.className = "mm-toggle" + (node.folded ? " is-folded" : "");
        toggle.type = "button";
        if (node.folded) toggle.textContent = String(node.children.length);
        else toggle.append(icon("minus"));
        this.tip(toggle, node.folded ? t("canvas.expandChildren", { count: node.children.length }) : t("canvas.collapseBranch"));
        toggle.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleFold(node);
        });
        el.append(toggle);
      }

      if (!reused) this.nodesEl.append(el);
      next.set(node.id, el);
      for (const c of visibleChildren(node)) visit(c);
    };
    visit(base);
    for (const [id, el] of prev) {
      if (next.has(id)) continue;
      this.elSigs.delete(el);
      this.lastPos.delete(el);
      this.frames.delete(id);
      el.remove();
    }
    this.els = next;
    this.renderCrumbs();
    this.opts.host?.afterRender?.();
  }

  private reflowTimer: number | null = null;
  /** 图片陆续加载完时合并成一次重排 */
  private scheduleReflow(): void {
    if (this.reflowTimer !== null) return;
    this.reflowTimer = window.setTimeout(() => {
      this.reflowTimer = null;
      if (this.doc && this.els.size) {
        this.reflow();
        this.updateImageHandle();
      }
    }, 30);
  }

  /**
   * 测量 → 布局 → 定位 → 画线。编辑中输入文字时也会调用，所以不重建 DOM。
   * remeasure 传入某个节点时只重新测量它：打字只改变这一个节点的尺寸，
   * 读全部 3000 个节点的 offsetWidth 会触发整页强制布局（约 30ms）。
   */
  private reflow(remeasure?: MindNode): void {
    const doc = this.doc!;
    const theme = THEMES[this.opts.theme];
    if (remeasure && this.sizes.size === this.els.size) {
      const el = this.els.get(remeasure.id);
      if (el) this.sizes.set(remeasure.id, { w: el.offsetWidth, h: el.offsetHeight });
    } else {
      this.sizes.clear();
      for (const [id, el] of this.els) this.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    }
    const layoutOpts: LayoutOptions = { ...DEFAULT_LAYOUT, ...theme.layout, structure: this.opts.structure };
    const base = this.focusRoot ?? doc.root;
    this.layout = layoutTree(base, (n) => this.sizes.get(n.id) ?? { w: 40, h: 24 }, layoutOpts);

    for (const p of this.layout.placed.values()) {
      const el = this.els.get(p.node.id);
      if (!el) continue;
      // 只写真正变了的位置，避免无谓的样式失效
      const last = this.lastPos.get(el);
      if (!last || last.x !== p.x || last.y !== p.y) {
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        this.lastPos.set(el, { x: p.x, y: p.y });
      }
      if (el.dataset.side !== p.side) el.dataset.side = p.side;
    }

    let edgeIndex = 0;
    const underline = theme.underlineFromDepth;
    const anchorBottom = (p: Placed) => underline !== null && p.node.depth - base.depth >= underline && !p.node.color;
    for (const child of this.layout.placed.values()) {
      const parentNode = child.node.parent;
      if (!parentNode) continue;
      const parent = this.layout.placed.get(parentNode.id);
      if (!parent) continue;
      const g = edgeGeometry(parent, child);
      if (child.side === "right" || child.side === "left") {
        if (anchorBottom(parent)) g.y1 = parent.y + parent.h;
        if (anchorBottom(child)) g.y2 = child.y + child.h;
      }
      const style = this.opts.edge?.shape ?? (parentNode === base ? theme.rootEdge : theme.edge);
      // 复用已有的 path，只改变了的属性；重新创建几千个 SVG 元素会让布局整体失效
      let path = this.edgePaths[edgeIndex];
      if (!path) {
        path = createSvg("path");
        path.setAttribute("class", "mm-edge");
        this.svg.append(path);
        this.edgePaths.push(path);
      }
      edgeIndex += 1;
      // 下划线式节点：文字底下那条线由本条连线一路画过去，而不是再用 CSS 的 border-bottom 另画一条，
      // 否则两者的粗细和 y 坐标对不齐，接缝处会断开
      const tail = anchorBottom(child)
        ? ` L${round2(child.side === "left" ? child.x : child.x + child.w)},${round2(g.y2)}`
        : "";
      const d = edgePath(g, style, this.opts.edge?.sharp ? 0 : 8) + tail;
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
      const depth = String(Math.min(child.node.depth - base.depth, 3));
      if (path.dataset.depth !== depth) path.dataset.depth = depth;
      const branch = this.els.get(child.node.id)?.dataset.branch;
      const stroke = branch !== undefined ? `var(--mm-branch-${branch})` : "";
      if (path.style.stroke !== stroke) path.style.stroke = stroke;
      if (path.style.display) path.setCssStyles({ display: "" });
    }
    for (let i = edgeIndex; i < this.edgePaths.length; i++) {
      if (!this.edgePaths[i].style.display) this.edgePaths[i].setCssStyles({ display: "none" });
    }
    this.drawBoxes();
    this.updateZoomLabel();
    this.opts.onLayout?.(this.layout.bounds);
  }

  /** 外框的 rect 和标题；layout.boxes 是由内向外，倒过来画让里层压在外层上面 */
  private drawBoxes(): void {
    const boxes = [...this.layout!.boxes].reverse();
    const titled = new Set<string>();
    boxes.forEach((b, i) => {
      let rect = this.boxRects[i];
      if (!rect) {
        rect = createSvg("rect");
        rect.setAttribute("class", "mm-box");
        rect.setAttribute("rx", "10");
        this.boxLayer.append(rect);
        this.boxRects.push(rect);
      }
      const attrs: Record<string, string> = { x: String(round2(b.x)), y: String(round2(b.y)), width: String(round2(b.w)), height: String(round2(b.h)) };
      for (const [k, v] of Object.entries(attrs)) if (rect.getAttribute(k) !== v) rect.setAttribute(k, v);
      const branch = this.els.get(b.start.id)?.dataset.branch;
      const color = branch !== undefined ? `var(--mm-branch-${branch})` : "";
      if (rect.style.getPropertyValue("--mm-box-color") !== color) rect.style.setProperty("--mm-box-color", color);
      if (rect.style.display) rect.setCssStyles({ display: "" });

      // 思维导图结构里一组兄弟可能被左右拆开，标题只挂第一段
      const title = b.start.box?.title ?? "";
      if (!title || titled.has(b.start.id)) return;
      titled.add(b.start.id);
      let el = this.boxTitles.get(b.start.id);
      if (!el) {
        el = this.createBoxTitle();
        this.boxTitles.set(b.start.id, el);
      }
      this.boxTitleStart.set(el, b.start);
      if (this.editingBox !== b.start && el.textContent !== title) el.textContent = title;
      el.style.left = `${round2(b.x + BOX_PAD)}px`;
      el.style.top = `${round2(b.y + 4)}px`;
      el.style.maxWidth = `${round2(Math.max(40, b.w - 2 * BOX_PAD))}px`;
      if (el.style.getPropertyValue("--mm-box-color") !== color) el.style.setProperty("--mm-box-color", color);
    });
    for (let i = boxes.length; i < this.boxRects.length; i++) {
      if (!this.boxRects[i].style.display) this.boxRects[i].setCssStyles({ display: "none" });
    }
    for (const [id, el] of this.boxTitles) {
      if (titled.has(id)) continue;
      el.remove();
      this.boxTitles.delete(id);
    }
  }

  private createBoxTitle(): HTMLElement {
    const el = createDiv();
    el.className = "mm-box-title";
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const start = this.boxTitleStart.get(el);
      if (start && this.editingBox !== start) this.selectBoxMembers(start);
    });
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const start = this.boxTitleStart.get(el);
      if (start && this.opts.editable) this.editBoxTitle(start);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const start = this.boxTitleStart.get(el);
      if (!start || this.editingBox === start) return;
      this.selectBoxMembers(start);
      this.showContextMenu(this.opts.editable ? this.boxMenuEntries(start) : [], ev);
    });
    this.nodesEl.append(el);
    return el;
  }

  /** node 所在外框的起始节点 */
  private boxOf(node: MindNode): MindNode | null {
    if (!node.parent) return null;
    return boxGroups(node.parent.children).get(node.id) ?? null;
  }

  private boxMembers(start: MindNode): MindNode[] {
    const siblings = start.parent?.children ?? [start];
    const i = siblings.indexOf(start);
    return siblings.slice(i, i + Math.max(1, start.box?.span ?? 1));
  }

  private selectBoxMembers(start: MindNode): void {
    const members = this.boxMembers(start);
    this.select(members[0]);
    for (const m of members.slice(1)) this.select(m, "add");
    this.positionNodebar();
  }

  private boxMenuEntries(start: MindNode): MenuEntry[] {
    return [
      { title: start.box?.title ? t("menu.editBoxTitle") : t("menu.addBoxTitle"), icon: "type", run: () => this.editBoxTitle(start) },
      { title: t("menu.removeBox"), icon: "square-dashed", run: () => this.removeBox(start) },
    ];
  }

  /** 给选中的节点加外框：同一父节点下相邻的合成一个，其余各自一个；已在外框里的跳过 */
  addBoxToSelected(): void {
    if (!this.opts.editable) return;
    const byParent = new Map<MindNode, number[]>();
    for (const n of this.selected) {
      if (!n.parent || this.boxOf(n)) continue;
      const arr = byParent.get(n.parent) ?? [];
      arr.push(n.parent.children.indexOf(n));
      byParent.set(n.parent, arr);
    }
    if (!byParent.size) return;
    for (const [parent, idx] of byParent) {
      idx.sort((a, b) => a - b);
      for (let i = 0; i < idx.length; ) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
        parent.children[idx[i]].box = { span: idx[j] - idx[i] + 1, title: "" };
        i = j + 1;
      }
    }
    this.render();
    this.notify();
  }

  /** 工具栏按钮 / ⌘⇧B：选中的节点有在外框里的就移除这些外框，否则加外框 */
  toggleBoxOnSelected(): void {
    if (!this.opts.editable || !this.selected.size) return;
    const starts = new Set<MindNode>();
    for (const n of this.selected) {
      const s = this.boxOf(n);
      if (s) starts.add(s);
    }
    if (!starts.size) {
      this.addBoxToSelected();
      return;
    }
    for (const s of starts) s.box = undefined;
    this.render();
    this.notify();
  }

  removeBox(start: MindNode): void {
    if (!this.opts.editable || !start.box) return;
    start.box = undefined;
    this.render();
    this.notify();
  }

  /** 原地编辑外框标题；没有标题时先给个默认字样并全选，清空即去掉标题 */
  editBoxTitle(start: MindNode): void {
    if (!this.opts.editable || !start.box) return;
    const before = start.box.title;
    if (!before) {
      start.box.title = t("canvas.boxTitleDefault");
      this.render();
    }
    const el = this.boxTitles.get(start.id);
    if (!el) return;
    this.editingBox = start;
    el.classList.add("is-editing");
    el.setAttribute("contenteditable", "plaintext-only");
    if (!el.isContentEditable) el.setAttribute("contenteditable", "true");
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.removeAttribute("contenteditable");
      el.classList.remove("is-editing");
      this.editingBox = null;
      if (!start.box) return;
      const text = commit ? (el.textContent ?? "").replace(/["%\r\n]/g, "").trim() : before;
      const changed = text !== before;
      start.box.title = text;
      el.textContent = text;
      this.render();
      if (changed) this.notify();
      this.el.focus({ preventScroll: true });
    };
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Enter" && !ev.isComposing) {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  private settleTimer: number | null = null;

  /**
   * 平移/缩放期间把画布提成独立合成层，拖起来才跟手。
   * 但合成层是按「提层那一刻」的比例栅格化的，一直挂着 will-change 的话，放大后看到的
   * 就是被 GPU 拉伸的位图 —— 文字发虚。所以手一停就摘掉，让浏览器按当前比例重新栅格化。
   */
  private holdLayer(): void {
    if (this.viewport.style.willChange !== "transform") this.viewport.setCssStyles({ willChange: "transform" });
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      this.viewport.setCssStyles({ willChange: "" });
    }, 200);
  }

  private applyTransform(): void {
    this.viewport.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.k})`;
    this.holdLayer();
    this.updateZoomLabel();
    this.positionNodebar();
    this.closePopover();
    this.opts.onViewChange?.(this.getViewState());
  }

  private updateZoomLabel(): void {
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.k * 100)}%`;
  }

  private screenRectOf(node: MindNode): DOMRect | null {
    const el = this.els.get(node.id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    return new DOMRect(r.left - host.left, r.top - host.top, r.width, r.height);
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const host = this.el.getBoundingClientRect();
    return { x: (clientX - host.left - this.tx) / this.k, y: (clientY - host.top - this.ty) / this.k };
  }

  // ---------- 工具栏 ----------

  private outsideCleanups = new Set<() => void>();

  /**
   * 点到 el 外面就关闭。不能用 once：点面板内部时监听器也会被消耗掉，
   * 之后就再也关不掉了（标记面板最初的 bug）。
   */
  private dismissOnOutside(el: HTMLElement, close: () => void): () => void {
    const onDown = (ev: PointerEvent) => {
      if (el.contains(ev.target as Node)) return;
      cleanup();
      close();
    };
    const cleanup = () => {
      document.removeEventListener("pointerdown", onDown, true);
      this.outsideCleanups.delete(cleanup);
    };
    document.addEventListener("pointerdown", onDown, true);
    this.outsideCleanups.add(cleanup);
    return cleanup;
  }

  /** 供外部面板（大纲）复用同一套提示 */
  tipFor(el: HTMLElement, text: string, placement: TooltipPlacement = "top"): void {
    this.tip(el, text, "fixed", placement);
  }

  /** 给按钮加提示。zone 为 toolbar 的会跟随工具栏位置改变弹出方向 */
  private tip(el: HTMLElement, text: string, zone: "toolbar" | "fixed" = "fixed", placement?: TooltipPlacement): void {
    this.tips.set(el, { text, zone, placement });
    if (zone === "toolbar" && !this.toolbarTips.includes(el)) this.toolbarTips.push(el);
    this.applyTip(el);
  }

  private applyTip(el: HTMLElement): void {
    const t = this.tips.get(el);
    if (!t) return;
    const placement = t.zone === "toolbar" ? this.toolbarTipPlacement() : (t.placement ?? "top");
    if (this.opts.host?.setTooltip) {
      el.removeAttribute("title");
      this.opts.host.setTooltip(el, t.text, placement);
    } else {
      el.title = t.text;
    }
  }

  /** 工具栏贴着哪条边，提示就往画布里侧弹 */
  private toolbarTipPlacement(): TooltipPlacement {
    switch (this.toolbarPos) {
      case "top":
        return "bottom";
      case "left":
        return "right";
      case "right":
        return "left";
      default:
        return "top";
    }
  }

  private buildToolbar(): void {
    const bar = createDiv();
    bar.className = "mm-toolbar";
    bar.dataset.pos = this.toolbarPos;
    this.toolbar = bar;
    if (this.opts.onToolbarPositionChange) {
      this.tip(bar, t("canvas.toolbarContextTip"), "toolbar");
      bar.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.positionMenu) return;
        const anchor = (ev.target as HTMLElement).closest<HTMLElement>(".mm-tool") ?? bar;
        this.positionMenu = this.buildMenu(
          TOOLBAR_POSITION_LABELS.map((p) => ({
            label: p.label,
            active: p.id === this.toolbarPos,
            run: () => {
              this.setToolbarPosition(p.id);
              this.opts.onToolbarPositionChange?.(p.id);
            },
          })),
          anchor,
          () => {
            this.positionMenu?.remove();
            this.positionMenu = null;
          },
        );
      });
    }
    const btn = (name: string, title: string, onClick: () => void) => {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-tool";
      b.dataset.tool = name;
      this.tip(b, title, "toolbar");
      b.append(icon(name));
      b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onClick();
      });
      bar.append(b);
      return b;
    };
    if (this.opts.onToggleOutline) {
      btn("outline", t("canvas.outline"), () => this.opts.onToggleOutline?.());
      const sep0 = createSpan();
      sep0.className = "mm-tool-sep";
      bar.append(sep0);
    }
    if (this.opts.embedded) {
      this.editToggle = btn(this.opts.editable ? "check" : "pencil", this.opts.editable ? t("canvas.doneEditing") : t("canvas.editEmbedded"), () =>
        this.setEditable(!this.opts.editable),
      );
      this.editToggle.classList.toggle("is-active", this.opts.editable);
    }
    if (this.opts.editable || this.opts.embedded) {
      const sb = btn("structure", "", () => this.toggleStructureMenu(sb));
      this.tip(sb, this.structureTipText(), "toolbar");
      sb.classList.toggle("is-hidden", !this.opts.editable);
      this.structureButton = sb;
      const tb = btn("palette", "", () => this.toggleThemeMenu(tb));
      this.tip(tb, this.themeTipText(), "toolbar");
      tb.classList.toggle("is-hidden", !this.opts.editable);
      this.themeButton = tb;
      const eb = btn("edge", "", () => this.toggleEdgeMenu(eb));
      this.tip(eb, this.edgeTipText(), "toolbar");
      eb.classList.toggle("is-hidden", !this.opts.editable);
      this.edgeButton = eb;
      const sep = createSpan();
      sep.className = "mm-tool-sep";
      sep.classList.toggle("is-hidden", !this.opts.editable);
      bar.append(sep);
      this.structureSep = sep;
    }
    btn("minus", t("canvas.zoomOut", { key: sc("Mod", "-") }), () => this.zoomBy(1 / 1.2));
    this.zoomLabel = createEl("button");
    this.zoomLabel.type = "button";
    this.zoomLabel.className = "mm-tool mm-zoom-label";
    this.zoomLabel.dataset.tool = "zoom";
    this.tip(this.zoomLabel, t("canvas.zoomLevel"), "toolbar");
    this.zoomLabel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this.zoomLabel.addEventListener("click", () => this.zoomBy(1 / this.k));
    bar.append(this.zoomLabel);
    btn("plus", t("canvas.zoomIn", { key: sc("Mod", "+") }), () => this.zoomBy(1.2));
    btn("fit", t("canvas.fit", { key: sc("Mod", "0") }), () => this.fit());
    btn("center", t("canvas.center"), () => this.center());
    const sep2 = createSpan();
    sep2.className = "mm-tool-sep";
    bar.append(sep2);
    if (this.opts.onUndo) {
      btn("undo", t("canvas.undo", { key: sc("Mod", "Z") }), () => this.opts.onUndo?.());
      btn("redo", t("canvas.redo", { key: sc("Mod", "Shift", "Z") }), () => this.opts.onRedo?.());
      const sep3 = createSpan();
      sep3.className = "mm-tool-sep";
      bar.append(sep3);
    }
    btn("search", t("canvas.search", { key: sc("Mod", "F") }), () => this.openSearch());
    const layers = btn("layers", t("canvas.foldLevels"), () => this.toggleFoldMenu(layers));
    this.el.append(bar);
    this.updateZoomLabel();
  }

  private changeStructure(s: Structure): void {
    this.setStructure(s);
    this.opts.onStructureChange?.(s);
  }

  private toggleStructureMenu(anchor: HTMLElement): void {
    if (this.structureMenu) {
      this.closeStructureMenu();
      return;
    }
    const menu = this.buildMenu(
      STRUCTURES.map((s) => ({ label: s.label, active: s.id === this.opts.structure, run: () => this.changeStructure(s.id) })),
      anchor,
      () => this.closeStructureMenu(),
    );
    this.structureMenu = menu;
  }

  private closeStructureMenu(): void {
    this.structureMenu?.remove();
    this.structureMenu = null;
  }

  /** 工具栏上方的小菜单，点外面自动关闭 */
  private buildMenu(
    items: { label: string; active?: boolean; run: () => void }[],
    anchor: HTMLElement | null,
    close: () => void,
    point?: { x: number; y: number },
  ): HTMLElement {
    const menu = createDiv();
    menu.className = "mm-menu";
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    let cleanup = () => undefined as void;
    const closeAll = () => {
      cleanup();
      close();
    };
    for (const it of items) {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-menu-item" + (it.active ? " is-active" : "");
      b.textContent = it.label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeAll();
        it.run();
      });
      menu.append(b);
    }
    this.el.append(menu);
    const host = this.el.getBoundingClientRect();
    const clampX = (x: number) => Math.max(4, Math.min(x, host.width - menu.offsetWidth - 4));
    const clampY = (y: number) => Math.max(4, Math.min(y, host.height - menu.offsetHeight - 4));
    if (!anchor) {
      menu.style.left = `${clampX(point?.x ?? 0)}px`;
      menu.style.top = `${clampY(point?.y ?? 0)}px`;
    } else {
    const r = anchor.getBoundingClientRect();
    // 工具栏里的按钮按工具栏位置决定弹出方向；其他地方（节点工具栏）一律向上弹
    const pos: ToolbarPosition = anchor.closest(".mm-toolbar") ? this.toolbarPos : "bottom";
    if (pos === "left" || pos === "right") {
      menu.style.left = `${clampX(pos === "left" ? r.right - host.left + 8 : r.left - host.left - menu.offsetWidth - 8)}px`;
      menu.style.top = `${clampY(r.top - host.top + r.height / 2 - menu.offsetHeight / 2)}px`;
    } else {
      menu.style.left = `${clampX(r.left - host.left + r.width / 2 - menu.offsetWidth / 2)}px`;
      menu.style.top = `${clampY(pos === "top" ? r.bottom - host.top + 6 : r.top - host.top - menu.offsetHeight - 6)}px`;
    }
    }
    cleanup = this.dismissOnOutside(menu, closeAll);
    return menu;
  }

  // ---------- 节点浮动工具栏 ----------

  private buildNodebar(): HTMLElement {
    const bar = createDiv();
    bar.className = "mm-nodebar";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const swatch = (color: string | null) => {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-swatch";
      this.tip(b, color ? t("canvas.colorTip", { color: colorLabel(color) }) : t("canvas.clearColor"));
      if (color) b.style.setProperty("--swatch", `var(--mm-c-${color})`);
      else b.append(icon("none"));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.applyColor(color);
      });
      bar.append(b);
    };
    swatch(null);
    for (const c of COLOR_NAMES) swatch(c);
    const sep = createSpan();
    sep.className = "mm-tool-sep";
    bar.append(sep);
    const tool = (name: string, title: string, onClick: () => void) => {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-tool";
      b.dataset.tool = name;
      this.tip(b, title);
      b.append(icon(name));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onClick();
      });
      bar.append(b);
    };
    tool("child", t("canvas.addChildTip", { key: "Tab" }), () => this.addChildToSelected());
    tool("sibling", t("canvas.addSiblingTip", { key: sc("Enter") }), () => this.addSiblingToSelected(false));
    tool("marker", t("canvas.markersTip"), () => this.toggleMarkerPicker());
    tool("note", t("canvas.noteTip"), () => {
      if (this.primary) this.toggleNotePopover(this.primary, true);
    });
    tool("box", t("canvas.boxTip", { key: sc("Mod", "Shift", "B") }), () => this.toggleBoxOnSelected());
    if (this.opts.host?.pickNote) tool("link", t("canvas.linkTip", { key: sc("Mod", "K") }), () => void this.linkSelectedToNote());
    tool("copy", t("canvas.copyTip", { key: sc("Mod", "C") }), () => this.copySelection());
    tool("paste", t("canvas.pasteTip", { key: sc("Mod", "V") }), () => void this.pasteFromClipboard());
    tool("trash", t("canvas.deleteTip", { key: "Delete" }), () => this.deleteSelected());
    return bar;
  }

  private positionNodebar(): void {
    this.updateImageHandle();
    if (!this.opts.editable) return;
    const show = this.primary && this.selected.size > 0 && !this.editing && !this.drag && !this.marquee && this.els.has(this.primary.id);
    if (!show) {
      this.nodebar?.remove();
      this.nodebar = null;
      return;
    }
    if (!this.nodebar) {
      this.nodebar = this.buildNodebar();
      this.el.append(this.nodebar);
    }
    const r = this.screenRectOf(this.primary!);
    if (!r) return;
    // 先取消隐藏再测量，display:none 时 offsetHeight 是 0，算出来的位置会压在节点上
    this.nodebar.classList.remove("is-hidden");
    const bw = this.nodebar.offsetWidth;
    const bh = this.nodebar.offsetHeight;
    const left = Math.max(4, Math.min(r.x + r.width / 2 - bw / 2, this.el.clientWidth - bw - 4));
    let top = r.y - bh - 10;
    if (top < 4) top = r.y + r.height + 10;
    this.nodebar.style.left = `${left}px`;
    this.nodebar.style.top = `${top}px`;
    const hidden = r.y + r.height < 0 || r.y > this.el.clientHeight || r.x + r.width < 0 || r.x > this.el.clientWidth;
    this.nodebar.classList.toggle("is-hidden", hidden);
  }

  private applyColor(color: string | null): void {
    if (!this.selected.size) return;
    for (const n of this.selected) n.color = color ?? undefined;
    this.render();
    this.notify();
  }

  // ---------- 事件 ----------

  /** 合成事件没有活动指针，setPointerCapture 会抛 NotFoundError；真实指针不受影响 */
  private capture(ev: PointerEvent): void {
    try {
      this.el.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
  }

  private on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    type: K,
    handler: (ev: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private bindEvents(): void {
    const el = this.el;

    this.on(el, "pointerdown", (ev) => {
      if (this.opts.embedded) ev.stopPropagation();
      const target = ev.target as HTMLElement;
      if (target.closest(".mm-toolbar, .mm-popover, .mm-nodebar")) return;
      // 双击有两条路（原生 dblclick 和 pointerup 自判定），两条都得知道有没有落在挡板上
      this.downOnShield = !!target.closest(".mm-frame-shield");
      const nodeEl = target.closest<HTMLElement>(".mm-node");
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: this.k };
        this.pan = null;
        this.pendingDrag = null;
        this.cancelTouchPress();
        return;
      }
      if (nodeEl) {
        const node = this.nodeFromEl(nodeEl);
        if (!node) return;
        if (this.editing === node) return;
        if (this.editing) this.commitEdit();
        this.closePopover();
        if (ev.shiftKey) this.select(node, "add");
        else if (ev.metaKey || ev.ctrlKey) this.select(node, "toggle");
        else if (!this.selected.has(node)) this.select(node, "replace");
        else this.setPrimary(node);
        this.el.focus({ preventScroll: true });
        if (ev.pointerType === "touch") {
          // 触屏没有悬停，按住 400ms 不动才拖节点；一动就当作平移画布
          this.cancelTouchPress();
          const timer = window.setTimeout(() => {
            const tp = this.touchPress;
            this.touchPress = null;
            this.pan = null;
            if (tp && this.opts.editable && node.depth > 0) {
              this.startDrag(node, tp.ev);
              this.capture(tp.ev);
            }
          }, 400);
          this.touchPress = { node, timer, ev };
          this.pan = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, moved: false, onNode: true };
        } else if (ev.button === 0) {
          this.pendingDrag = { node, x: ev.clientX, y: ev.clientY };
        }
        return;
      }
      if (ev.button !== 0 && ev.button !== 1) return;
      if (this.editing) this.commitEdit();
      this.closePopover();
      this.el.focus({ preventScroll: true });
      this.capture(ev);
      if (ev.shiftKey && ev.button === 0) {
        this.startMarquee(ev);
        return;
      }
      this.pan = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, moved: false };
    });

    this.on(el, "pointermove", (ev) => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = el.getBoundingClientRect();
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (this.pinch.k * dist) / this.pinch.dist));
        this.zoomBy(next / this.k, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        return;
      }
      if (this.marquee) {
        this.updateMarquee(ev);
        return;
      }
      if (this.drag) {
        this.updateDrag(ev);
        const at = { clientX: ev.clientX, clientY: ev.clientY };
        this.updateAutoScroll(ev.clientX, ev.clientY, () => this.updateDrag(at));
        return;
      }
      if (this.touchPress && this.pan && Math.hypot(ev.clientX - this.pan.x, ev.clientY - this.pan.y) >= DRAG_THRESHOLD) {
        this.cancelTouchPress();
      }
      if (this.pendingDrag) {
        if (Math.hypot(ev.clientX - this.pendingDrag.x, ev.clientY - this.pendingDrag.y) >= DRAG_THRESHOLD) {
          const node = this.pendingDrag.node;
          this.pendingDrag = null;
          if (this.opts.editable && node.depth > 0) {
            this.startDrag(node, ev);
            if (this.drag) this.capture(ev);
          }
        }
        return;
      }
      if (!this.pan) return;
      const dx = ev.clientX - this.pan.x;
      const dy = ev.clientY - this.pan.y;
      if (!this.pan.moved && Math.hypot(dx, dy) < 3) return;
      this.pan.moved = true;
      this.tx = this.pan.tx + dx;
      this.ty = this.pan.ty + dy;
      this.applyTransform();
    });

    const endPointer = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.marquee) this.endMarquee();
      if (this.drag) this.endDrag(ev.type === "pointerup");
      const touched = this.touchPress?.node ?? null;
      this.cancelTouchPress();
      const tapped = this.pendingDrag?.node ?? touched;
      this.pendingDrag = null;
      if (tapped && ev.type === "pointerup") {
        const now = performance.now();
        if (this.lastTap && this.lastTap.node === tapped && now - this.lastTap.time < 400) {
          this.lastTap = null;
          if (this.downOnShield) this.setLiveFrame(tapped.id);
          else this.editOnDoubleTap(tapped);
        } else {
          this.lastTap = { node: tapped, time: now };
        }
      } else if (ev.type === "pointerup") {
        this.lastTap = null;
      }
      if (this.pan) {
        if (!this.pan.moved && !this.pan.onNode) this.select(null, "replace");
        this.pan = null;
      }
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    };
    this.on(el, "pointerup", endPointer);
    this.on(el, "pointercancel", endPointer);

    this.on(
      el,
      "wheel",
      (ev) => {
        if ((ev.target as HTMLElement).closest(".mm-popover")) return;
        ev.preventDefault();
        if (this.opts.embedded) ev.stopPropagation();
        const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
        const rect = el.getBoundingClientRect();
        if (ev.ctrlKey || ev.metaKey) {
          // 触控板捏合也走这里（浏览器会带上 ctrlKey）
          this.zoomBy(Math.exp(-ev.deltaY * scale * 0.01), ev.clientX - rect.left, ev.clientY - rect.top);
        } else if (!ev.shiftKey && this.opts.wheelZoom?.()) {
          // 鼠标一格 deltaY 约 100，限幅后每格约 1.2 倍，和工具栏 +/- 一致
          const d = Math.max(-100, Math.min(100, ev.deltaY * scale));
          this.zoomBy(Math.exp(-d * 0.0018), ev.clientX - rect.left, ev.clientY - rect.top);
        } else {
          this.tx -= ev.deltaX * scale;
          this.ty -= ev.deltaY * scale;
          this.applyTransform();
        }
      },
      { passive: false },
    );

    this.on(el, "dblclick", (ev) => {
      if (this.opts.embedded) ev.stopPropagation();
      const nodeEl = (ev.target as HTMLElement).closest<HTMLElement>(".mm-node");
      const node = nodeEl && this.nodeFromEl(nodeEl);
      if (!node) return;
      ev.preventDefault();
      if ((ev.target as HTMLElement).closest(".mm-frame-shield")) this.setLiveFrame(node.id);
      else this.editOnDoubleTap(node);
    });

    // 链接节点的悬停预览：用一个委托监听，元素复用时不会重复绑定
    this.on(el, "mouseover", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest("a.internal-link")) return;
      const nodeEl = target.closest<HTMLElement>(".mm-node.is-linked");
      const linktext = nodeEl?.dataset.link;
      // 预览插件会盯着 targetEl 判断鼠标是否还停着，所以传节点本身
      if (nodeEl && linktext) this.opts.host?.hoverLink?.(ev, linktext, nodeEl);
    });

    this.on(el, "keydown", (ev) => this.onKeyDown(ev));

    this.on(el, "contextmenu", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".mm-toolbar, .mm-popover, .mm-nodebar, .mm-search, .mm-menu, .mm-crumbs")) return;
      ev.preventDefault();
      if (this.opts.embedded) ev.stopPropagation();
      const nodeEl = target.closest<HTMLElement>(".mm-node");
      const node = nodeEl ? this.nodeFromEl(nodeEl) : null;
      if (node) {
        if (this.editing === node) return;
        if (this.editing) this.commitEdit();
        if (!this.selected.has(node)) this.select(node);
        else this.setPrimary(node);
        this.showContextMenu(this.nodeMenuEntries(node), ev);
      } else {
        this.showContextMenu(this.backgroundMenuEntries(), ev);
      }
    });

    // 拖入笔记 / 图片文件
    this.on(el, "dragover", (ev) => {
      if (!this.opts.editable) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      const nodeEl = (ev.target as HTMLElement).closest<HTMLElement>(".mm-node");
      if (this.dropHover !== nodeEl) {
        this.dropHover?.classList.remove("is-drop-target");
        this.dropHover = nodeEl;
        nodeEl?.classList.add("is-drop-target");
      }
    });
    this.on(el, "dragleave", (ev) => {
      if ((ev.relatedTarget as Node | null) && el.contains(ev.relatedTarget as Node)) return;
      this.dropHover?.classList.remove("is-drop-target");
      this.dropHover = null;
    });
    this.on(el, "drop", (ev) => {
      if (!this.opts.editable) return;
      ev.preventDefault();
      if (this.opts.embedded) ev.stopPropagation();
      const targetEl = this.dropHover ?? (ev.target as HTMLElement).closest<HTMLElement>(".mm-node");
      this.dropHover?.classList.remove("is-drop-target");
      this.dropHover = null;
      const target = (targetEl && this.nodeFromEl(targetEl)) ?? this.primary ?? this.doc?.root ?? null;
      if (target) void this.handleDrop(ev, target);
    });

    this.on(el, "paste", (ev) => {
      if (!this.opts.editable || this.editing) return;
      const t = ev.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;
      const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      const text = ev.clipboardData?.getData("text/plain") ?? "";
      if (!files.length && !text.trim()) return;
      ev.preventDefault();
      if (this.opts.embedded) ev.stopPropagation();
      if (files.length) void this.insertImageFiles(files, this.primary ?? this.doc?.root ?? null);
      else this.pasteText(text);
    });

    this.on(el, "input", (ev) => {
      if (this.editing && (ev.target as HTMLElement).classList.contains("mm-label")) {
        // 输入法组字中不要改文字：Windows 输入法打「【」也走组字，中途把【【换成 [[ 的话，
        // 组字结束时输入法会再补一个【，就成了 [[【。等 compositionend 再处理
        if (!(ev as InputEvent).isComposing) this.updateLinkSuggest();
        this.reflow(this.editing);
      }
    });
    // 选中文字再打【或 [：包成【文字】/[文字]，再打一次变成 [[文字]] 链接（同 Easy Typing 的习惯）
    this.on(el, "beforeinput", (ev) => {
      const ie = ev;
      if (!this.editing || ie.isComposing || ie.inputType !== "insertText" || (ie.data !== "【" && ie.data !== "[")) return;
      const label = this.editingLabel();
      const range = label && this.selectionRange(label);
      if (!label || !range || range.start === range.end) return;
      ev.preventDefault();
      this.wrapSelection(label, range.start, range.end, ie.data);
    });
    this.on(el, "compositionstart", () => {
      const label = this.editingLabel();
      const range = label && this.selectionRange(label);
      this.compositionSel = label && range && range.start !== range.end ? { ...range, text: (label.textContent ?? "").slice(range.start, range.end) } : null;
    });
    this.on(el, "compositionend", (ev) => {
      const label = this.editingLabel();
      const saved = this.compositionSel;
      this.compositionSel = null;
      if (!label || !this.editing) return;
      const data = ev.data;
      if (saved && (data === "【" || data === "[")) {
        // 组字开始时选中的文字已经被输入法替换成了「【」，按原来的选区复原再包起来
        const cur = label.textContent ?? "";
        if (cur.slice(saved.start, saved.start + data.length) === data) {
          label.textContent = cur.slice(0, saved.start) + saved.text + cur.slice(saved.start + data.length);
          this.wrapSelection(label, saved.start, saved.start + saved.text.length, data);
          return;
        }
      }
      this.updateLinkSuggest();
      this.reflow(this.editing);
    });

    this.on(
      el,
      "blur",
      (ev) => {
        const t = ev.target as HTMLElement;
        if (this.editing && t.classList?.contains("mm-label")) this.commitEdit();
      },
      { capture: true },
    );
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.opts.embedded) {
      this.handleKeyEmbedded(ev);
      return;
    }
    this.handleKey(ev);
    // 处理过的快捷键不再交给 Obsidian 的全局热键（否则视图 Scope 里的 ⌘F/⌘K 会再触发一次）
    if (ev.defaultPrevented) ev.stopPropagation();
  }

  /** 嵌入模式：凡是我们处理了（preventDefault）的按键都不再冒泡给外层编辑器 */
  private handleKeyEmbedded(ev: KeyboardEvent): void {
    this.handleKey(ev);
    if (ev.defaultPrevented || this.editing || (ev.target as HTMLElement).tagName === "TEXTAREA") ev.stopPropagation();
  }

  /** 双击节点：可编辑就进入编辑；只读的嵌入图先打开编辑开关 */
  private editOnDoubleTap(node: MindNode): void {
    if (!this.opts.editable) {
      if (!this.opts.embedded) return;
      this.setEditable(true);
    }
    this.startEdit(node);
  }

  private handleKey(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    const target = ev.target as HTMLElement;
    if (target.closest(".mm-search")) return;
    if (target.tagName === "TEXTAREA") {
      if (ev.key === "Escape" || (ev.key === "Enter" && mod)) {
        ev.preventDefault();
        this.closePopover();
        this.el.focus({ preventScroll: true });
      }
      return;
    }
    if (this.editing && this.linkSuggest && !ev.isComposing) {
      const s = this.linkSuggest;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        s.index = (s.index + (ev.key === "ArrowDown" ? 1 : -1) + s.items.length) % s.items.length;
        this.paintLinkSuggest();
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        this.chooseLinkSuggest(s.index);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.closeLinkSuggest();
        return;
      }
    }
    if (this.editing) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        this.commitEdit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.commitEdit(true);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        this.commitEdit();
        this.addChildToSelected();
      }
      return;
    }
    if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this.opts.onRedo?.();
      else this.opts.onUndo?.();
      return;
    }
    if (mod && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      this.openSearch();
      return;
    }
    if (mod && ev.key.toLowerCase() === "k") {
      if (this.opts.editable && this.opts.host?.pickNote && this.primary) {
        ev.preventDefault();
        void this.linkSelectedToNote();
      }
      return;
    }
    if (mod && ev.key.toLowerCase() === "c") {
      if (this.copySelection()) ev.preventDefault();
      return;
    }
    if (mod && ev.key.toLowerCase() === "x") {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        this.cutSelection();
      }
      return;
    }
    if (mod && ev.key.toLowerCase() === "v") {
      // 交给 paste 事件：它能拿到剪贴板里的图片文件
      return;
    }
    if (mod && ev.shiftKey && ev.key.toLowerCase() === "b") {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        this.toggleBoxOnSelected();
      }
      return;
    }
    if (mod && (ev.key.toLowerCase() === "b" || ev.key.toLowerCase() === "i")) {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        this.toggleInlineStyle(ev.key.toLowerCase() === "b" ? "**" : "*");
      }
      return;
    }
    if (mod && (ev.key === "=" || ev.key === "+")) {
      ev.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (mod && ev.key === "-") {
      ev.preventDefault();
      this.zoomBy(1 / 1.2);
      return;
    }
    if (mod && ev.shiftKey && (ev.key === "0" || ev.code === "Digit0")) {
      ev.preventDefault();
      if (this.primary) this.fitBranch(this.primary);
      return;
    }
    // 数字键：只显示到第 N 层（1 = 只看主主题），0 = 全部展开。⌘1–9 是 Obsidian 切标签页，不占
    if (!mod && !ev.altKey && !ev.shiftKey && /^Digit[0-9]$/.test(ev.code)) {
      ev.preventDefault();
      const n = Number(ev.code.slice(5));
      this.setFoldLevel(n === 0 ? null : n);
      return;
    }
    if (mod && ev.key === "0") {
      ev.preventDefault();
      this.fit();
      return;
    }
    if (ev.key === "Escape") {
      this.closePopover();
      this.closeMarkerPicker();
      if (!this.selected.size && this.focusRoot) {
        this.exitFocus();
        return;
      }
      this.select(null, "replace");
      return;
    }
    const sel = this.primary;
    if (!sel) return;
    if (ev.altKey && this.opts.editable && ev.key.startsWith("Arrow")) {
      // Alt+↑↓ 在兄弟间排序，Alt+←→ 升降级
      ev.preventDefault();
      if (ev.key === "ArrowUp") this.moveSibling(sel, -1);
      else if (ev.key === "ArrowDown") this.moveSibling(sel, 1);
      else if (ev.key === "ArrowLeft") this.outdentNode(sel);
      else this.indentNode(sel);
      this.ensureVisible(this.primary);
      return;
    }
    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        ev.preventDefault();
        this.navigate(sel, ev.key);
        this.ensureVisible(this.primary);
        return;
      case " ":
      case "F2":
        if (!this.opts.editable) return;
        ev.preventDefault();
        this.startEdit(sel);
        return;
      case "Tab":
        if (!this.opts.editable) return;
        ev.preventDefault();
        this.addChildToSelected();
        return;
      case "Enter":
        if (!this.opts.editable) return;
        ev.preventDefault();
        if (!sel.parent) this.addChildToSelected();
        else this.addSiblingToSelected(ev.shiftKey);
        return;
      case "Delete":
      case "Backspace":
        if (!this.opts.editable) return;
        ev.preventDefault();
        this.deleteSelected();
        return;
      case "/":
        ev.preventDefault();
        if (sel.children.length) this.toggleFold(sel);
        return;
      default:
        return;
    }
  }

  // ---------- 选择与导航 ----------

  private nodeFromEl(el: HTMLElement): MindNode | null {
    const id = el.dataset.id;
    if (!id || !this.doc) return null;
    let found: MindNode | null = null;
    walk(this.doc.root, (n) => {
      if (n.id === id) found = n;
    });
    return found;
  }

  select(node: MindNode | null, mode: "replace" | "add" | "toggle" = "replace"): void {
    if (node && this.focusRoot && node !== this.focusRoot && !isAncestor(this.focusRoot, node)) this.exitFocus(false);
    if (mode === "replace") {
      this.selected.clear();
      this.primary = null;
    }
    if (this.liveFrame && node?.id !== this.liveFrame) this.setLiveFrame(null);
    if (node) {
      if (mode === "toggle" && this.selected.has(node)) {
        this.selected.delete(node);
        if (this.primary === node) this.primary = [...this.selected].pop() ?? null;
      } else {
        this.selected.add(node);
        this.primary = node;
      }
    }
    this.syncSelectionClasses();
  }

  private setPrimary(node: MindNode): void {
    this.primary = node;
    this.positionNodebar();
  }

  private selectAll(): void {
    if (!this.doc) return;
    this.selected.clear();
    walk(this.doc.root, (n) => {
      if (n.depth > 0 && this.els.has(n.id)) this.selected.add(n);
    });
    this.primary = this.primary && this.selected.has(this.primary) ? this.primary : [...this.selected][0] ?? null;
    this.syncSelectionClasses();
  }

  private syncSelectionClasses(): void {
    for (const [id, el] of this.els) {
      let node: MindNode | null = null;
      for (const s of this.selected) if (s.id === id) node = s;
      el.classList.toggle("is-selected", node !== null);
    }
    this.positionNodebar();
    this.opts.onSelectionChange?.(this.primary, [...this.selected]);
  }

  getPrimary(): MindNode | null {
    return this.primary;
  }

  private navigate(node: MindNode, key: string): void {
    if (!this.layout) return;
    const p = this.layout.placed.get(node.id);
    if (!p) return;
    const structure = this.opts.structure;
    if (structure === "org-down") {
      // 向下结构：上下是父子，左右在兄弟间找最近的
      if (key === "ArrowDown") {
        const kids = visibleChildren(node);
        if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
        return;
      }
      if (key === "ArrowUp") {
        if (node.parent) this.select(node.parent);
        return;
      }
      this.selectNearest(p, key === "ArrowLeft" ? "left" : "right");
      return;
    }
    if (structure === "tree-right") {
      if (key === "ArrowRight") {
        const kids = visibleChildren(node);
        if (kids.length) this.select(kids[0]);
        return;
      }
      if (key === "ArrowLeft") {
        if (node.parent) this.select(node.parent);
        return;
      }
      this.selectNearest(p, key === "ArrowUp" ? "up" : "down");
      return;
    }
    const towardChildren = (key === "ArrowRight" && p.side === "right") || (key === "ArrowLeft" && p.side === "left");
    if (key === "ArrowLeft" || key === "ArrowRight") {
      if (node.depth === 0) {
        const kids = visibleChildren(node).filter((c) => this.layout!.placed.get(c.id)?.side === (key === "ArrowRight" ? "right" : "left"));
        if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
        return;
      }
      if (towardChildren) {
        const kids = visibleChildren(node);
        if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
      } else if (node.parent) {
        this.select(node.parent);
      }
      return;
    }
    this.selectVertical(node, p, key === "ArrowUp" ? -1 : 1);
  }

  /**
   * 横向结构里的上下键：先在同一父节点、同一侧的兄弟里按屏幕顺序走；走到头再去相邻分支找
   * 同一层、最近的节点。对齐按节点贴着父节点的那条边算，不用中心点 —— 兄弟左对齐，
   * 文字长短不一时中心点会偏得很远，以前就因此从 2-2 跳去了别的分支。
   */
  private selectVertical(node: MindNode, p: Placed, dir: -1 | 1): void {
    if (!this.layout || !node.parent) return;
    const placed = this.layout.placed;
    const sibs = visibleChildren(node.parent)
      .map((c) => placed.get(c.id))
      .filter((q): q is Placed => !!q && q.side === p.side)
      .sort((a, b) => a.y - b.y);
    const next = sibs[sibs.indexOf(p) + dir];
    if (next) {
      this.select(next.node);
      return;
    }
    const edge = (q: Placed) => (q.side === "left" ? q.x + q.w : q.x);
    const cy = p.y + p.h / 2;
    let best: Placed | null = null;
    let bestScore = Infinity;
    for (const q of placed.values()) {
      if (q === p || q.side !== p.side) continue;
      const qy = q.y + q.h / 2;
      if (dir < 0 ? qy >= cy - 1 : qy <= cy + 1) continue;
      // 同层优先：层级不同的加一大截惩罚；其次纵向最近，再次贴边对齐
      const score = Math.abs(q.node.depth - node.depth) * 10000 + Math.abs(qy - cy) + Math.abs(edge(q) - edge(p)) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
    }
    if (best) this.select(best.node);
  }

  /** 朝某个方向找最近的节点（主轴距离为主，侧向偏移加权） */
  private selectNearest(p: Placed, dir: "up" | "down" | "left" | "right"): void {
    if (!this.layout) return;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    let best: Placed | null = null;
    let bestScore = Infinity;
    for (const q of this.layout.placed.values()) {
      if (q === p) continue;
      const qx = q.x + q.w / 2;
      const qy = q.y + q.h / 2;
      const ahead = dir === "up" ? qy < cy - 1 : dir === "down" ? qy > cy + 1 : dir === "left" ? qx < cx - 1 : qx > cx + 1;
      if (!ahead) continue;
      const main = dir === "up" || dir === "down" ? Math.abs(qy - cy) : Math.abs(qx - cx);
      const cross = dir === "up" || dir === "down" ? Math.abs(qx - cx) : Math.abs(qy - cy);
      const score = main + cross * 2;
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
    }
    if (best) this.select(best.node);
  }

  // ---------- 框选 ----------

  private startMarquee(ev: PointerEvent): void {
    const host = this.el.getBoundingClientRect();
    const box = createDiv();
    box.className = "mm-marquee";
    this.el.append(box);
    this.marquee = { x: ev.clientX - host.left, y: ev.clientY - host.top, el: box, base: new Set(this.selected) };
    this.positionNodebar();
  }

  private updateMarquee(ev: PointerEvent): void {
    if (!this.marquee) return;
    const host = this.el.getBoundingClientRect();
    const x2 = ev.clientX - host.left;
    const y2 = ev.clientY - host.top;
    const left = Math.min(this.marquee.x, x2);
    const top = Math.min(this.marquee.y, y2);
    const w = Math.abs(x2 - this.marquee.x);
    const h = Math.abs(y2 - this.marquee.y);
    Object.assign(this.marquee.el.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    this.selected = new Set(this.marquee.base);
    for (const el of this.els.values()) {
      const r = el.getBoundingClientRect();
      const rx = r.left - host.left;
      const ry = r.top - host.top;
      if (rx < left + w && rx + r.width > left && ry < top + h && ry + r.height > top) {
        const node = this.nodeFromEl(el);
        if (node && node.depth > 0) this.selected.add(node);
      }
    }
    for (const [id, el] of this.els) {
      let hit = false;
      for (const s of this.selected) if (s.id === id) hit = true;
      el.classList.toggle("is-selected", hit);
    }
  }

  private endMarquee(): void {
    if (!this.marquee) return;
    this.marquee.el.remove();
    this.marquee = null;
    this.primary = [...this.selected].pop() ?? null;
    this.syncSelectionClasses();
  }

  // ---------- 拖拽 ----------

  private startDrag(node: MindNode, ev: PointerEvent): void {
    const el = this.els.get(node.id);
    if (!el || !this.doc) return;
    const subtree = new Set<MindNode>();
    walk(node, (n) => subtree.add(n));
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("mm-ghost");
    ghost.classList.remove("is-selected");
    ghost.querySelector(".mm-toggle")?.remove();
    ghost.style.transform = `scale(${this.k})`;
    this.el.append(ghost);
    const indicator = createDiv();
    indicator.className = "mm-drop-indicator";
    this.overlay.append(indicator);
    for (const n of subtree) this.els.get(n.id)?.classList.add("is-dragging");
    this.drag = { node, ghost, subtree, target: null, indicator };
    this.el.classList.add("is-dragging-node");
    this.positionNodebar();
    this.updateDrag(ev);
  }

  private updateDrag(ev: { clientX: number; clientY: number }): void {
    if (!this.drag) return;
    const host = this.el.getBoundingClientRect();
    this.drag.ghost.style.left = `${ev.clientX - host.left + 12}px`;
    this.drag.ghost.style.top = `${ev.clientY - host.top + 12}px`;
    const w = this.toWorld(ev.clientX, ev.clientY);
    const target = this.findDropTarget(w.x, w.y, this.drag.subtree);
    this.drag.target = target;
    for (const el of this.els.values()) el.classList.remove("is-drop-target");
    const ind = this.drag.indicator;
    ind.setCssStyles({ display: "none" });
    if (!target || !this.layout) return;
    if (target.kind === "node") {
      this.els.get(target.parent.id)?.classList.add("is-drop-target");
      return;
    }
    const kids = visibleChildren(target.parent)
      .filter((c) => !this.drag!.subtree.has(c))
      .map((c) => this.layout!.placed.get(c.id)!)
      .filter((k) => k && (!target.side || k.side === target.side))
      .sort((a, b) => (target.side ? a.y - b.y : 0));
    if (!kids.length) return;
    const gap = target.parent.depth === 0 ? DEFAULT_LAYOUT.gapMain : DEFAULT_LAYOUT.gapSibling;
    const side = kids[0].side;
    const pos =
      target.slot !== undefined
        ? target.slot >= kids.length
          ? -1
          : target.slot
        : kids.findIndex((k) => target.parent.children.indexOf(k.node) >= target.index);
    ind.classList.toggle("is-vertical", side === "down");
    if (side === "down") {
      let x: number;
      if (pos === -1) x = kids[kids.length - 1].x + kids[kids.length - 1].w + gap;
      else if (pos === 0) x = kids[0].x - gap;
      else x = (kids[pos - 1].x + kids[pos - 1].w + kids[pos].x) / 2;
      ind.setCssStyles({ display: "block", left: `${x - 2}px`, top: `${kids[0].y}px` });
      return;
    }
    let y: number;
    if (pos === -1) y = kids[kids.length - 1].y + kids[kids.length - 1].h + gap / 2;
    else if (pos === 0) y = kids[0].y - gap / 2;
    else y = (kids[pos - 1].y + kids[pos - 1].h + kids[pos].y) / 2;
    const x = side === "left" ? kids[0].x + kids[0].w - 48 : kids[0].x;
    ind.setCssStyles({ display: "block", left: `${x}px`, top: `${y - 2}px` });
  }

  /**
   * 拖拽落点，按优先级：
   *   1. 正落在某个节点的方框里 → 成为它的子节点（不再往里缩，下划线主题的细节点也好对准）
   *   2. 某个节点「屁股后面」的空白 → 成为它的最后一个子节点
   *   3. 左右分布结构里中心主题两侧的主主题列
   *   4. 相邻两个兄弟之间的那条窄带 → 插到它们之间
   * 第 4 步只看相邻两个兄弟本身的方框围出来的带子，多个命中取最窄的。以前用整列子节点的外接矩形，
   * 列里有一个很宽的节点、某个兄弟的分支又很高时，这个矩形会罩住大片深层节点，祖先先被查到，
   * 落点就被截走了 —— 子节点一多就「选不中」。
   */
  private findDropTarget(wx: number, wy: number, exclude: Set<MindNode>): DropTarget | null {
    if (!this.layout) return null;
    const placed = [...this.layout.placed.values()].filter((p) => !exclude.has(p.node));
    let hit: Placed | null = null;
    for (const p of placed) {
      if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h && (!hit || p.w * p.h < hit.w * hit.h)) hit = p;
    }
    if (hit) return { parent: hit.node, index: hit.node.children.length, kind: "node" };
    const behind = this.behindTarget(placed, wx, wy);
    if (behind) return behind;

    const base = this.focusRoot ?? this.doc?.root;
    const kidsOf = (p: Placed) =>
      visibleChildren(p.node)
        .filter((c) => !exclude.has(c))
        .map((c) => this.layout!.placed.get(c.id))
        .filter((k): k is Placed => !!k);
    if (this.opts.structure === "mindmap" && base) {
      const rp = this.layout.placed.get(base.id);
      const kids = rp ? kidsOf(rp) : [];
      const side = rp && wx < rp.x + rp.w / 2 ? "left" : "right";
      const col = kids.filter((k) => k.side === side);
      const pad = DEFAULT_LAYOUT.gapMain;
      const inCol =
        col.length &&
        wx >= Math.min(...col.map((k) => k.x)) - 12 &&
        wx <= Math.max(...col.map((k) => k.x + k.w)) + 12 &&
        wy >= Math.min(...col.map((k) => k.y)) - pad &&
        wy <= Math.max(...col.map((k) => k.y + k.h)) + pad;
      const nearRoot = rp && !col.length && Math.abs(wy - (rp.y + rp.h / 2)) < 80 && (side === "left" ? wx < rp.x : wx > rp.x + rp.w);
      if (rp && (inCol || nearRoot)) return this.sideDropTarget(rp, kids, wx, wy);
    }

    let best: { t: DropTarget; size: number } | null = null;
    for (const p of placed) {
      if (this.opts.structure === "mindmap" && p.node === base) continue;
      const kids = kidsOf(p);
      if (!kids.length) continue;
      const across = kids[0].side === "down";
      // 沿堆叠方向排好：纵向排的按 y，横向排的（组织结构图）按 x
      kids.sort((a, b) => (across ? a.x - b.x : a.y - b.y));
      const edgeGap = p.node === base ? DEFAULT_LAYOUT.gapMain : 24;
      for (let i = 0; i <= kids.length; i++) {
        const a = kids[i - 1];
        const b = kids[i];
        const two = [a, b].filter((k): k is Placed => !!k);
        let inBand: boolean;
        let size: number;
        if (!across) {
          const top = a ? a.y + a.h : b.y - edgeGap;
          const bottom = b ? b.y : a.y + a.h + edgeGap;
          const left = Math.min(...two.map((k) => k.x)) - 12;
          const right = Math.max(...two.map((k) => k.x + k.w)) + 12;
          inBand = wy >= top && wy <= bottom && wx >= left && wx <= right;
          size = bottom - top;
        } else {
          const left = a ? a.x + a.w : b.x - edgeGap;
          const right = b ? b.x : a.x + a.w + edgeGap;
          const top = Math.min(...two.map((k) => k.y)) - 12;
          const bottom = Math.max(...two.map((k) => k.y + k.h)) + 12;
          inBand = wx >= left && wx <= right && wy >= top && wy <= bottom;
          size = right - left;
        }
        if (!inBand || (best && size >= best.size)) continue;
        const index = b ? p.node.children.indexOf(b.node) : p.node.children.indexOf(a.node) + 1;
        best = { t: { parent: p.node, index, kind: "gap" }, size };
      }
    }
    return best?.t ?? null;
  }

  /**
   * 节点「屁股后面」：在它那一行（纵向不超出节点本身）、子节点会长出来的那一侧的空白处，
   * 拖到这里就挂成它的最后一个子节点。已经有子节点的，范围只到子节点那一列为止，
   * 再往外就是在子节点之间插入了。先于「兄弟之间的空隙」判断 —— 同一列里有很长的兄弟时，
   * 那一列的空隙范围会把短节点后面的空白也包进去。
   */
  private behindTarget(placed: Placed[], wx: number, wy: number): DropTarget | null {
    const base = this.focusRoot ?? this.doc?.root;
    let best: { p: Placed; d: number } | null = null;
    for (const p of placed) {
      if (p.node === base) continue;
      const kids = visibleChildren(p.node).map((c) => this.layout!.placed.get(c.id)).filter((k): k is Placed => !!k);
      let d = -1;
      if (p.side === "right" || p.side === "left") {
        if (wy < p.y || wy > p.y + p.h) continue;
        const outer = p.side === "right" ? p.x + p.w : p.x;
        d = p.side === "right" ? wx - outer : outer - wx;
        const kidEdge = kids.length ? Math.min(...kids.map((k) => (p.side === "right" ? k.x - outer : outer - (k.x + k.w)))) : Infinity;
        if (d <= 4 || d > Math.min(96, kidEdge - 4)) continue;
      } else {
        if (wx < p.x || wx > p.x + p.w) continue;
        d = wy - (p.y + p.h);
        const kidEdge = kids.length ? Math.min(...kids.map((k) => k.y - (p.y + p.h))) : Infinity;
        if (d <= 4 || d > Math.min(64, kidEdge - 4)) continue;
      }
      if (!best || d < best.d) best = { p, d };
    }
    return best ? { parent: best.p.node, index: best.p.node.children.length, kind: "node" } : null;
  }

  /**
   * 思维导图结构里中心主题两侧的落点：按鼠标在中心主题哪边决定 side，只在那一侧的主主题之间找位置。
   * 左侧是倒序排的（文档里靠后的在上面），所以插入下标要反过来算。
   */
  private sideDropTarget(p: Placed, kids: Placed[], wx: number, wy: number): DropTarget {
    const side: "left" | "right" = wx < p.x + p.w / 2 ? "left" : "right";
    const list = kids.filter((k) => k.side === side).sort((a, b) => a.y - b.y);
    const children = p.node.children;
    if (!list.length) return { parent: p.node, index: children.length, kind: "gap", side, slot: 0 };
    const above = list.filter((k) => k.y + k.h / 2 < wy).length;
    let index: number;
    if (side === "right") {
      index = above < list.length ? children.indexOf(list[above].node) : children.indexOf(list[list.length - 1].node) + 1;
    } else {
      // 屏幕上从上到下文档下标递减：插到上方那个节点之前、下方那个节点之后
      index = above > 0 ? children.indexOf(list[above - 1].node) : children.indexOf(list[0].node) + 1;
    }
    return { parent: p.node, index, kind: "gap", side, slot: above };
  }

  private endDrag(commit: boolean): void {
    this.stopAutoScroll();
    if (!this.drag) return;
    const { node, ghost, indicator, target } = this.drag;
    ghost.remove();
    indicator.remove();
    for (const el of this.els.values()) el.classList.remove("is-dragging", "is-drop-target");
    this.el.classList.remove("is-dragging-node");
    this.drag = null;
    if (commit && target && this.doc && !isAncestor(node, target.parent) && target.parent !== node) {
      const parent = target.parent;
      const sideChange = !!target.side && node.parent === parent && this.layout?.placed.get(node.id)?.side !== target.side;
      const sameSpot = node.parent === parent && parent.children.indexOf(node) === target.index && !sideChange;
      if (!sameSpot) {
        if (target.side) {
          // 第一次在左右分布里拖主主题时，把所有主主题当前在哪边都记下来，免得别的分支被自动挤到另一边
          for (const c of parent.children) {
            const s = this.layout?.placed.get(c.id)?.side;
            if (!c.side && (s === "left" || s === "right")) c.side = s;
          }
          node.side = target.side;
        } else if (parent !== (this.focusRoot ?? this.doc.root)) {
          node.side = undefined;
        }
        if (sideChange && parent.children.indexOf(node) === target.index) {
          this.select(node);
          this.render();
          this.notify();
          return;
        }
        if (parent.folded) parent.folded = false;
        if (moveNode(node, parent, target.index, this.doc.style)) {
          this.select(node);
          this.render();
          this.notify();
          return;
        }
      }
    }
    this.positionNodebar();
  }

  // ---------- 编辑 ----------

  private notify(): void {
    if (this.notifyTimer !== null) {
      window.clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    if (this.doc) this.opts.onChange?.(this.doc);
  }

  /** 输入过程中的延迟通知：让自动保存跟上，但不至于每个键都序列化一次 */
  private scheduleNotify(delay = 500): void {
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, delay);
  }

  // ---------- 供大纲面板与快捷键调用的树操作 ----------

  renameNode(node: MindNode, text: string): void {
    if (!this.opts.editable || text === node.text) return;
    node.text = text;
    this.render();
    this.notify();
  }

  insertSibling(node: MindNode): MindNode | null {
    if (!this.opts.editable || !node.parent) return null;
    if (this.editing) this.commitEdit();
    const created = addSibling(node, "", true);
    if (!created) return null;
    this.select(created);
    this.render();
    return created;
  }

  insertChild(node: MindNode): MindNode | null {
    if (!this.opts.editable || !this.doc) return null;
    if (this.editing) this.commitEdit();
    if (node.folded) node.folded = false;
    const created = addChild(node, this.doc.style, "");
    this.select(created);
    this.render();
    return created;
  }

  deleteNode(node: MindNode): void {
    if (!this.opts.editable || !node.parent) return;
    const parent = node.parent;
    const idx = parent.children.indexOf(node);
    removeNode(node);
    this.select(parent.children[Math.min(idx, parent.children.length - 1)] ?? parent);
    this.render();
    this.notify();
  }

  moveNodeTo(node: MindNode, parent: MindNode, index: number): boolean {
    if (!this.opts.editable || !this.doc) return false;
    if (parent.folded) parent.folded = false;
    if (!moveNode(node, parent, index, this.doc.style)) return false;
    this.select(node);
    this.render();
    this.notify();
    return true;
  }

  /** 降级：挂到前一个兄弟的末尾 */
  indentNode(node: MindNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    const idx = parent.children.indexOf(node);
    if (idx <= 0) return false;
    const prev = parent.children[idx - 1];
    return this.moveNodeTo(node, prev, prev.children.length);
  }

  /** 升级：放到父节点之后 */
  outdentNode(node: MindNode): boolean {
    const parent = node.parent;
    if (!parent || !parent.parent) return false;
    return this.moveNodeTo(node, parent.parent, parent.parent.children.indexOf(parent) + 1);
  }

  /** 在兄弟之间上下移动 */
  moveSibling(node: MindNode, delta: number): boolean {
    const parent = node.parent;
    if (!parent) return false;
    const idx = parent.children.indexOf(node);
    const to = idx + delta;
    if (to < 0 || to >= parent.children.length) return false;
    return this.moveNodeTo(node, parent, delta > 0 ? to + 1 : to);
  }

  toggleFold(node: MindNode): void {
    if (this.editing) this.commitEdit();
    node.folded = !node.folded;
    // 折起来会把选中的后代藏进去，这时才把选中收拢到自己身上；
    // 否则不碰选中状态 —— 点一下折叠按钮就冒出浮动工具栏太吵了
    if (node.folded && [...this.selected].some((n) => isAncestor(node, n))) this.select(node);
    this.render();
    if (this.opts.editable) this.notify();
  }

  private addChildToSelected(): void {
    const sel = this.primary;
    if (!sel || !this.doc) return;
    if (sel.folded) sel.folded = false;
    const node = addChild(sel, this.doc.style, "");
    this.select(node);
    this.render();
    this.ensureVisible(node);
    this.startEdit(node, true);
  }

  private addSiblingToSelected(before: boolean): void {
    const sel = this.primary;
    if (!sel || !this.doc) return;
    const node = addSibling(sel, "", !before);
    if (!node) return;
    if (sel.side) node.side = sel.side;
    this.select(node);
    this.render();
    this.ensureVisible(node);
    this.startEdit(node, true);
  }

  private deleteSelected(): void {
    const victims = [...this.selected].filter((n) => n.parent && ![...this.selected].some((o) => o !== n && isAncestor(o, n)));
    if (!victims.length) return;
    const primary = this.primary && victims.includes(this.primary) ? this.primary : victims[0];
    const parent = primary.parent!;
    const idx = parent.children.indexOf(primary);
    for (const v of victims) removeNode(v);
    const next = parent.children[Math.min(idx, parent.children.length - 1)] ?? parent;
    this.select(next);
    this.render();
    this.notify();
  }

  startEdit(node: MindNode, isNew = false): void {
    if (!this.opts.editable) return;
    if (this.editing === node) return;
    if (this.editing) this.commitEdit();
    const el = this.els.get(node.id);
    const label = el?.querySelector<HTMLElement>(".mm-label");
    if (!el || !label) return;
    this.closePopover();
    this.select(node);
    this.editing = node;
    this.editingIsNew = isNew;
    this.positionNodebar();
    label.textContent = toEditableText(node.text);
    label.setAttribute("contenteditable", "plaintext-only");
    if (!label.isContentEditable) label.setAttribute("contenteditable", "true");
    el.classList.add("is-editing");
    label.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(label);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    this.reflow();
  }

  commitEdit(cancel = false, refocus = true): void {
    const node = this.editing;
    if (!node) return;
    this.closeLinkSuggest();
    const isNew = this.editingIsNew;
    this.editing = null;
    this.editingIsNew = false;
    const label = this.els.get(node.id)?.querySelector<HTMLElement>(".mm-label");
    const raw = fromEditableText(label?.textContent ?? "");
    const text = cancel ? node.text : raw;
    if (text === "" && isNew) {
      const parent = node.parent;
      removeNode(node);
      this.select(parent);
      this.render();
      if (refocus) this.el.focus({ preventScroll: true });
      return;
    }
    const changed = !cancel && (text !== node.text || isNew);
    node.text = text;
    // startEdit 把 label 换成了 contenteditable 的原文。文字没改的话签名跟着没变，
    // rebuild 会认为这个节点不用动，于是原文就留在那儿了 —— 纯文字节点看不出来，
    // 图片、链接、iframe 这种有渲染形态的就露馅。所以提交时强制让这个节点失效。
    const el = this.els.get(node.id);
    if (el) {
      this.elSigs.delete(el);
      this.elContent.delete(el);
    }
    this.render();
    if (refocus) this.el.focus({ preventScroll: true });
    if (changed) this.notify();
  }

  // ---------- 拖拽时贴边自动平移 ----------

  /** 指针离画布边缘 48px 以内就朝那边平移，越靠边越快；离开边缘区就停 */
  private updateAutoScroll(clientX: number, clientY: number, tick: () => void): void {
    const r = this.el.getBoundingClientRect();
    const zone = 48;
    const speed = (d: number) => (d < zone ? Math.min(1, (zone - Math.max(0, d)) / zone) * 16 : 0);
    const vx = speed(clientX - r.left) - speed(r.right - clientX);
    const vy = speed(clientY - r.top) - speed(r.bottom - clientY);
    if (!vx && !vy) return this.stopAutoScroll();
    if (this.autoScroll) {
      Object.assign(this.autoScroll, { vx, vy, tick });
      return;
    }
    const step = () => {
      const a = this.autoScroll;
      if (!a) return;
      this.tx += a.vx;
      this.ty += a.vy;
      this.applyTransform();
      a.tick();
      a.raf = window.requestAnimationFrame(step);
    };
    this.autoScroll = { raf: window.requestAnimationFrame(step), vx, vy, tick };
  }

  private stopAutoScroll(): void {
    if (this.autoScroll) window.cancelAnimationFrame(this.autoScroll.raf);
    this.autoScroll = null;
  }

  // ---------- 编辑时的 [[ 链接补全 ----------

  private editingLabel(): HTMLElement | null {
    return this.editing ? (this.els.get(this.editing.id)?.querySelector<HTMLElement>(".mm-label") ?? null) : null;
  }

  /** 光标在 label 纯文本里的位置 */
  private caretOffset(label: HTMLElement): number | null {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.anchorNode || !label.contains(sel.anchorNode)) return null;
    const r = document.createRange();
    r.selectNodeContents(label);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    return r.toString().length;
  }

  /** 选区在 label 纯文本里的起止 */
  private selectionRange(label: HTMLElement): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!label.contains(r.startContainer) || !label.contains(r.endContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(label);
    pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    return { start, end: start + r.toString().length };
  }

  /**
   * 把 [start, end) 包起来并保持选中：【→【文字】，[→[文字]；
   * 已经被【】或 [] 包着时再打一次，就升级成 [[文字]] 链接
   */
  private wrapSelection(label: HTMLElement, start: number, end: number, ch: string): void {
    const text = label.textContent ?? "";
    let before = text.slice(0, start);
    let after = text.slice(end);
    const inner = text.slice(start, end);
    let open = ch === "【" ? "【" : "[";
    let close = ch === "【" ? "】" : "]";
    const wrapped = (o: string, c: string) => before.endsWith(o) && after.startsWith(c);
    if (wrapped("【", "】") || (wrapped("[", "]") && !wrapped("[[", "]]"))) {
      before = before.slice(0, -1);
      after = after.slice(1);
      open = "[[";
      close = "]]";
    }
    label.textContent = before + open + inner + close + after;
    const s = before.length + open.length;
    const node = label.firstChild ?? label;
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, s);
    r.setEnd(node, s + inner.length);
    sel?.removeAllRanges();
    sel?.addRange(r);
    this.closeLinkSuggest();
    if (this.editing) this.reflow(this.editing);
  }

  private setCaret(label: HTMLElement, offset: number): void {
    const node = label.firstChild ?? label;
    const sel = window.getSelection();
    sel?.collapse(node, Math.min(offset, node.textContent?.length ?? 0));
  }

  /**
   * 输入后看光标前有没有一段还没闭合的 [[：有就弹候选。
   * 中文输入法下打出来的「【【」先换成 [[（别的笔记插件也这么做，省得切输入法）。
   */
  private updateLinkSuggest(): void {
    const label = this.editingLabel();
    const host = this.opts.host;
    if (!label || !host?.listLinkTargets) return this.closeLinkSuggest();
    const caret = this.caretOffset(label);
    if (caret === null) return this.closeLinkSuggest();
    let text = label.textContent ?? "";
    // 光标前最后一个「【【」（后面没有更晚的 [[）换成 [[；紧挨光标的「】】」换成 ]]。长度不变，光标不用挪
    const cn = text.slice(0, caret).lastIndexOf("【【");
    if (cn >= 0 && text.slice(0, caret).lastIndexOf("[[") < cn) text = text.slice(0, cn) + "[[" + text.slice(cn + 2);
    if (text.slice(0, caret).endsWith("】】")) text = text.slice(0, caret - 2) + "]]" + text.slice(caret);
    if (text !== label.textContent) {
      label.textContent = text;
      this.setCaret(label, caret);
    }
    const before = text.slice(0, caret);
    const open = before.lastIndexOf("[[");
    const query = open < 0 ? "" : before.slice(open + 2);
    if (open < 0 || query.includes("]]") || /[\n|#^]/.test(query)) return this.closeLinkSuggest();
    const q = query.trim().toLowerCase();
    const scored: { t: LinkTarget; s: number }[] = [];
    for (const t of host.listLinkTargets()) {
      const name = t.name.toLowerCase();
      const m = !q ? 2 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : `${t.folder}/${name}`.toLowerCase().includes(q) ? 2 : -1;
      if (m >= 0) scored.push({ t, s: m + (t.isNote ? 0 : 0.5) });
      if (!q && scored.length >= 8) break;
    }
    // 排序稳定：同分保持「最近修改」的先后
    const items = scored.sort((a, b) => a.s - b.s).slice(0, 8).map((x) => x.t);
    if (!items.length) return this.closeLinkSuggest();
    if (!this.linkSuggest) {
      const el = createDiv();
      el.className = "mm-menu mm-link-suggest";
      // 按下就选，并且不让编辑框失焦（失焦会提交编辑）
      el.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const item = (ev.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (item) this.chooseLinkSuggest(Number(item.dataset.index));
      });
      this.el.append(el);
      this.linkSuggest = { el, items, index: 0, open };
    } else {
      this.linkSuggest.items = items;
      this.linkSuggest.open = open;
      this.linkSuggest.index = Math.min(this.linkSuggest.index, items.length - 1);
    }
    this.paintLinkSuggest();
    // 跟着光标走
    const sel = window.getSelection();
    const host_ = this.el.getBoundingClientRect();
    let rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) rect = label.getBoundingClientRect();
    const el = this.linkSuggest.el;
    el.style.left = `${Math.max(4, Math.min(rect.left - host_.left, host_.width - el.offsetWidth - 4))}px`;
    const below = rect.bottom - host_.top + 6;
    el.style.top = `${below + el.offsetHeight > host_.height - 4 ? Math.max(4, rect.top - host_.top - el.offsetHeight - 6) : below}px`;
  }

  private paintLinkSuggest(): void {
    const s = this.linkSuggest;
    if (!s) return;
    s.el.replaceChildren();
    s.items.forEach((t, i) => {
      const row = createDiv();
      row.className = "mm-link-suggest-item" + (i === s.index ? " is-active" : "");
      row.dataset.index = String(i);
      const name = createSpan();
      name.className = "mm-link-suggest-name";
      name.textContent = t.name;
      row.append(name);
      if (t.folder) {
        const folder = createSpan();
        folder.className = "mm-link-suggest-folder";
        folder.textContent = t.folder;
        row.append(folder);
      }
      s.el.append(row);
    });
  }

  private chooseLinkSuggest(index: number): void {
    const s = this.linkSuggest;
    const label = this.editingLabel();
    const target = s?.items[index];
    if (!s || !label || !target) return;
    const caret = this.caretOffset(label) ?? (label.textContent ?? "").length;
    const text = label.textContent ?? "";
    // 光标后面已经有 ]]（比如自动补的）就一起吞掉，不留重复的括号
    const end = text.slice(caret).startsWith("]]") ? caret + 2 : caret;
    const link = `[[${target.linktext}]]`;
    label.textContent = text.slice(0, s.open) + link + text.slice(end);
    this.setCaret(label, s.open + link.length);
    this.closeLinkSuggest();
    if (this.editing) this.reflow(this.editing);
  }

  private closeLinkSuggest(): void {
    this.linkSuggest?.el.remove();
    this.linkSuggest = null;
  }

  // ---------- 折叠层级 ----------

  /** level 为 null 展开全部；否则深度 ≥ level 的节点折叠（1 = 只看主主题） */
  /** 只显示到第 level 层（相对当前聚焦的根；null 为全部展开），然后适应画布 */
  setFoldLevel(level: number | null): void {
    if (!this.doc) return;
    if (this.editing) this.commitEdit();
    const base = this.focusRoot ?? this.doc.root;
    walk(base, (n) => {
      if (n.children.length) n.folded = level !== null && n.depth - base.depth >= level;
    });
    this.render();
    this.fit();
    if (this.opts.editable) this.notify();
  }

  /** 把某个分支（含外框）缩放到正好占满画布 */
  fitBranch(node: MindNode): void {
    if (!this.layout) return;
    let b: Bounds | null = null;
    const add = (r: Bounds) => {
      if (!b) b = { ...r };
      else {
        const x = Math.min(b.x, r.x);
        const y = Math.min(b.y, r.y);
        b = { x, y, w: Math.max(b.x + b.w, r.x + r.w) - x, h: Math.max(b.y + b.h, r.y + r.h) - y };
      }
    };
    walk(node, (n) => {
      const p = this.layout!.placed.get(n.id);
      if (p) add(p);
    });
    for (const box of this.layout.boxes) if (box.members.some((m) => m === node || isAncestor(node, m))) add(box);
    if (b) this.fitBounds(b, 1.5);
  }

  private toggleFoldMenu(anchor: HTMLElement): void {
    if (this.foldMenu) {
      this.closeFoldMenu();
      return;
    }
    this.foldMenu = this.buildMenu(
      [
        { label: `${t("canvas.expandAll")}  0`, run: () => this.setFoldLevel(null) },
        { label: `${t("canvas.mainTopicsOnly")}  1`, run: () => this.setFoldLevel(1) },
        { label: `${t("canvas.showToLevel", { n: 2 })}  2`, run: () => this.setFoldLevel(2) },
        { label: `${t("canvas.showToLevel", { n: 3 })}  3`, run: () => this.setFoldLevel(3) },
      ],
      anchor,
      () => this.closeFoldMenu(),
    );
  }

  private closeFoldMenu(): void {
    this.foldMenu?.remove();
    this.foldMenu = null;
  }

  // ---------- 搜索 ----------

  openSearch(): void {
    if (this.search) {
      this.search.input.focus();
      this.search.input.select();
      return;
    }
    const bar = createDiv();
    bar.className = "mm-search";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const input = createEl("input");
    input.type = "text";
    input.className = "mm-search-input";
    input.placeholder = t("canvas.searchPlaceholder");
    input.spellcheck = false;
    const count = createSpan();
    count.className = "mm-search-count";
    count.textContent = "0/0";
    const tool = (name: string, title: string, fn: () => void) => {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-tool";
      b.dataset.tool = name;
      this.tip(b, title, "fixed", this.toolbarPos === "top" ? "top" : "bottom");
      b.append(icon(name));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fn();
      });
      return b;
    };
    bar.append(
      input,
      count,
      tool("up", t("canvas.prevMatch", { key: sc("Shift", "Enter") }), () => this.stepMatch(-1)),
      tool("down", t("canvas.nextMatch", { key: sc("Enter") }), () => this.stepMatch(1)),
      tool("close", t("canvas.closeSearch", { key: "Esc" }), () => this.closeSearch()),
    );
    this.el.append(bar);
    this.search = { bar, input, count, matches: new Set(), list: [], index: -1 };
    input.addEventListener("input", () => this.runSearch(input.value));
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter" || ev.key === "ArrowDown") {
        ev.preventDefault();
        this.stepMatch(ev.shiftKey && ev.key === "Enter" ? -1 : 1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        this.stepMatch(-1);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.closeSearch();
      }
    });
    input.focus();
  }

  closeSearch(): void {
    if (!this.search) return;
    this.search.bar.remove();
    this.search = null;
    for (const el of this.els.values()) el.classList.remove("is-match", "is-current-match");
    this.el.focus({ preventScroll: true });
  }

  private runSearch(query: string, reveal = true): void {
    const s = this.search;
    if (!s || !this.doc) return;
    const q = query.trim().toLowerCase();
    const list: MindNode[] = [];
    if (q) {
      walk(this.doc.root, (n) => {
        if (plainText(n.text).toLowerCase().includes(q) || unescapeNote(n.note).toLowerCase().includes(q)) list.push(n);
      });
    }
    s.list = list;
    s.matches = new Set(list);
    s.index = list.length ? Math.min(Math.max(s.index, 0), list.length - 1) : -1;
    this.applyMatchClasses();
    if (reveal && s.index >= 0) this.revealMatch();
  }

  private stepMatch(dir: number): void {
    const s = this.search;
    if (!s || !s.list.length) return;
    s.index = (s.index + dir + s.list.length) % s.list.length;
    this.applyMatchClasses();
    this.revealMatch();
  }

  private applyMatchClasses(): void {
    const s = this.search;
    if (!s) return;
    const current = s.index >= 0 ? s.list[s.index] : null;
    for (const [id, el] of this.els) {
      let node: MindNode | null = null;
      for (const m of s.matches) if (m.id === id) node = m;
      el.classList.toggle("is-match", node !== null);
      el.classList.toggle("is-current-match", node !== null && node === current);
    }
    s.count.textContent = `${s.index + 1}/${s.list.length}`;
  }

  /** 展开命中节点的祖先、选中并把它挪到画布中央 */
  private revealMatch(): void {
    const s = this.search;
    if (!s || s.index < 0) return;
    const node = s.list[s.index];
    let unfolded = false;
    for (let p = node.parent; p; p = p.parent) {
      if (p.folded) {
        p.folded = false;
        unfolded = true;
      }
    }
    if (unfolded) {
      this.render();
      this.applyMatchClasses();
      if (this.opts.editable) this.notify();
    }
    this.select(node);
    this.centerOn(node);
    s.input.focus();
  }

  /** 节点出了画布（或贴得太近）就平移最小距离把它带回来，留 56px 余量；已经在视野里就不动 */
  ensureVisible(node: MindNode | null): void {
    const p = node && this.layout?.placed.get(node.id);
    if (!p) return;
    const m = 56;
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    const shift = (lo: number, hi: number, max: number) => (hi - lo > max - 2 * m ? m - lo : lo < m ? m - lo : hi > max - m ? max - m - hi : 0);
    const dx = shift(this.tx + p.x * this.k, this.tx + (p.x + p.w) * this.k, cw);
    const dy = shift(this.ty + p.y * this.k, this.ty + (p.y + p.h) * this.k, ch);
    if (!dx && !dy) return;
    this.tx += dx;
    this.ty += dy;
    this.applyTransform();
    this.positionNodebar();
  }

  centerOn(node: MindNode): void {
    const p = this.layout?.placed.get(node.id);
    if (!p) return;
    this.tx = this.el.clientWidth / 2 - (p.x + p.w / 2) * this.k;
    this.ty = this.el.clientHeight / 2 - (p.y + p.h / 2) * this.k;
    this.applyTransform();
  }

  // ---------- 剪贴板 ----------

  /** 选区里去掉被其他选中节点包含的，按文档顺序排列 */
  private topLevelSelection(): MindNode[] {
    const all = [...this.selected];
    const tops = all.filter((n) => n.parent && !all.some((o) => o !== n && isAncestor(o, n)));
    const key = (n: MindNode) => pathOf(n).split("/").map((x) => Number(x));
    return tops.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const d = (ka[i] ?? -1) - (kb[i] ?? -1);
        if (d) return d;
      }
      return 0;
    });
  }

  /** 把选中的子树写成缩进列表放进剪贴板，返回文本；没有选中返回 null */
  copySelection(): string | null {
    const nodes = this.topLevelSelection();
    if (!nodes.length) return null;
    const text = nodes.map((n) => subtreeToList(n)).join("");
    this.clipboardText = text;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    return text;
  }

  cutSelection(): void {
    if (!this.opts.editable) return;
    if (this.copySelection()) this.deleteSelected();
  }

  async pasteFromClipboard(): Promise<void> {
    if (!this.opts.editable || !this.doc) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = this.clipboardText;
    }
    if (!text.trim()) text = this.clipboardText;
    this.pasteText(text);
  }

  /** 把文本解析成节点挂到当前节点下（无选中则挂到根） */
  pasteText(text: string): void {
    if (!this.opts.editable || !this.doc) return;
    const nodes = parseClipboard(text);
    if (!nodes.length) return;
    if (this.editing) this.commitEdit();
    const target = this.primary ?? this.doc.root;
    if (target.folded) target.folded = false;
    for (const n of nodes) attachSubtree(n, target, this.doc.style);
    this.select(null);
    nodes.forEach((n, i) => this.select(n, i === 0 ? "replace" : "add"));
    this.render();
    this.notify();
  }

  // ---------- 节点 ⇄ 笔记 ----------

  /** 已链接：弹菜单（打开 / 取消链接）；未链接：挑一篇笔记或新建，把标签变成 [[笔记|原文]] */
  async linkSelectedToNote(): Promise<void> {
    const node = this.primary;
    if (!node || !this.opts.editable || this.linkMenu || this.linking) return;
    const link = wikilinkOf(node.text);
    if (link) {
      const anchor = this.nodebar?.querySelector<HTMLElement>('.mm-tool[data-tool="link"]') ?? this.els.get(node.id);
      if (!anchor) return;
      this.linkMenu = this.buildMenu(
        [
          { label: t("menu.openLink", { target: link.target }), run: () => this.opts.host?.openLink?.(link.target, true, new MouseEvent("click")) },
          { label: t("menu.unlink"), run: () => this.unlinkNote(node) },
        ],
        anchor,
        () => {
          this.linkMenu?.remove();
          this.linkMenu = null;
        },
      );
      return;
    }
    const suggested = plainText(node.text).replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || t("canvas.untitled");
    this.linking = true;
    let name: string | null | undefined;
    try {
      name = await this.opts.host?.pickNote?.(suggested);
    } finally {
      this.linking = false;
    }
    if (!name) return;
    this.applyNoteLink(node, name);
  }

  applyNoteLink(node: MindNode, basename: string): void {
    const text = plainText(node.text).trim();
    node.text = !text || text === basename ? `[[${basename}]]` : `[[${basename}|${text}]]`;
    this.select(node);
    this.render();
    this.notify();
  }

  unlinkNote(node: MindNode): void {
    const link = wikilinkOf(node.text);
    if (!link) return;
    node.text = link.alias ?? link.target;
    this.select(node);
    this.render();
    this.notify();
  }

  private cancelTouchPress(): void {
    if (!this.touchPress) return;
    window.clearTimeout(this.touchPress.timer);
    this.touchPress = null;
  }

  // ---------- 右键菜单 ----------

  private showContextMenu(entries: MenuEntry[], ev: MouseEvent): void {
    if (this.opts.host?.showMenu) {
      this.opts.host.showMenu(entries, ev);
      return;
    }
    const items = entries.filter((e) => !e.separator && e.title && !e.disabled).map((e) => ({ label: e.title!, active: e.checked, run: () => e.run?.() }));
    const host = this.el.getBoundingClientRect();
    this.contextMenu?.remove();
    this.contextMenu = this.buildMenu(items, null, () => {
      this.contextMenu?.remove();
      this.contextMenu = null;
    }, { x: ev.clientX - host.left, y: ev.clientY - host.top });
  }
  private contextMenu: HTMLElement | null = null;

  private nodeMenuEntries(node: MindNode): MenuEntry[] {
    const editable = this.opts.editable;
    const link = wikilinkOf(node.text);
    const sep: MenuEntry = { separator: true };
    const entries: MenuEntry[] = [];
    if (editable) {
      entries.push(
        { title: t("menu.edit"), icon: "pencil", run: () => this.startEdit(node) },
        { title: t("menu.addChild"), icon: "corner-down-right", run: () => this.addChildToSelected() },
        { title: t("menu.addSibling"), icon: "list-plus", disabled: !node.parent, run: () => this.addSiblingToSelected(false) },
        sep,
      );
    }
    entries.push(
      this.focusRoot === node
        ? { title: t("menu.exitFocus"), icon: "minimize", run: () => this.exitFocus() }
        : { title: t("menu.focusBranch"), icon: "focus", disabled: !node.children.length, run: () => this.focusOn(node) },
    );
    if (node.children.length) entries.push({ title: `${node.folded ? t("menu.expand") : t("menu.collapse")}  /`, icon: node.folded ? "chevron-down" : "chevron-right", run: () => this.toggleFold(node) });
    entries.push({ title: `${t("menu.fitBranch")}  ${sc("Mod", "Shift", "0")}`, icon: "scan", run: () => this.fitBranch(node) });
    entries.push(sep);
    if (editable) {
      if (link) {
        entries.push(
          { title: t("menu.openLink", { target: link.target }), icon: "file-text", run: () => this.opts.host?.openLink?.(link.target, true, new MouseEvent("click")) },
          { title: t("menu.unlink"), icon: "unlink", run: () => this.unlinkNote(node) },
        );
      } else if (this.opts.host?.pickNote) {
        entries.push({ title: t("menu.linkNote"), icon: "link", run: () => void this.linkSelectedToNote() });
      }
      entries.push(
        { title: node.note ? t("menu.editNote") : t("menu.addNote"), icon: "sticky-note", run: () => this.toggleNotePopover(node, true) },
        { title: t("menu.markers"), icon: "star", run: () => this.toggleMarkerPicker(true) },
        { title: t("menu.task"), icon: "check-square", checked: /^\[( |x|X)\]\s/.test(splitMarkers(node.text).rest), run: () => this.toggleTaskOnSelected() },
      );
      if (node.width) entries.push({ title: t("menu.resetWidth"), icon: "move-horizontal", run: () => this.resetWidth(node) });
      const box = this.boxOf(node);
      if (box) entries.push(...this.boxMenuEntries(box));
      else entries.push({ title: t("menu.addBox"), icon: "square-dashed", disabled: !node.parent, run: () => this.addBoxToSelected() });
      entries.push(sep);
      const parent = node.parent;
      const canHeading = !!parent && parent.kind === "heading" && parent.level + 1 <= 6;
      entries.push(
        { title: t("menu.toHeading"), icon: "heading", disabled: !parent || node.kind === "heading" || !canHeading, run: () => this.convertLevel(node, "heading") },
        { title: t("menu.toList"), icon: "list", disabled: !parent || node.kind === "list", run: () => this.convertLevel(node, "list") },
        sep,
      );
    }
    entries.push(
      { title: t("menu.copy"), icon: "copy", run: () => this.copySelection() },
      ...(editable ? [{ title: t("menu.cut"), icon: "scissors", run: () => this.cutSelection() } as MenuEntry, { title: t("menu.pasteChild"), icon: "clipboard-paste", run: () => void this.pasteFromClipboard() } as MenuEntry] : []),
      { title: t("menu.copyNodeLink"), icon: "link-2", disabled: !this.opts.host?.fileBasename, run: () => void this.copyNodeLink(node) },
    );
    if (editable && node.parent) entries.push(sep, { title: t("menu.delete"), icon: "trash", run: () => this.deleteSelected() });
    return entries;
  }

  private backgroundMenuEntries(): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (this.opts.editable) entries.push({ title: t("menu.paste"), icon: "clipboard-paste", run: () => void this.pasteFromClipboard() }, { separator: true });
    entries.push(
      { title: t("canvas.expandAll"), icon: "chevrons-down-up", run: () => this.setFoldLevel(null) },
      { title: t("canvas.mainTopicsOnly"), icon: "chevrons-up-down", run: () => this.setFoldLevel(1) },
      { title: t("menu.fit"), icon: "maximize", run: () => this.fit() },
    );
    if (this.focusRoot) entries.push({ separator: true }, { title: t("menu.exitFocus"), icon: "minimize", run: () => this.exitFocus() });
    return entries;
  }

  private convertLevel(node: MindNode, kind: "heading" | "list"): void {
    if (!this.doc || !this.opts.editable) return;
    if (!convertLevelKind(node, kind, this.doc.style)) {
      this.opts.host?.notice?.(t("notice.cannotHeading"));
      return;
    }
    this.render();
    this.notify();
  }

  private toggleTaskOnSelected(): void {
    if (!this.opts.editable || !this.selected.size) return;
    const primaryHas = this.primary ? /^\[( |x|X)\]\s/.test(splitMarkers(this.primary.text).rest) : false;
    for (const n of this.selected) {
      const has = /^\[( |x|X)\]\s/.test(splitMarkers(n.text).rest);
      if (has === primaryHas) n.text = toggleTask(n.text, "add-remove");
    }
    this.render();
    this.notify();
  }

  /** 选中节点整体加粗/斜体：包一层或去掉一层 */
  private toggleInlineStyle(wrap: "**" | "*"): void {
    for (const n of this.selected) {
      const { markers, rest } = splitMarkers(n.text);
      const inner = rest.startsWith(wrap) && rest.endsWith(wrap) && rest.length > wrap.length * 2 ? rest.slice(wrap.length, -wrap.length) : `${wrap}${rest}${wrap}`;
      n.text = [...markers, inner].join(" ");
    }
    this.render();
    this.notify();
  }

  // ---------- 标记选择器 ----------

  private toggleMarkerPicker(force?: boolean): void {
    if (this.markerPicker && !force) {
      this.closeMarkerPicker();
      return;
    }
    this.closeMarkerPicker();
    const node = this.primary;
    if (!node || !this.opts.editable) return;
    const picker = createDiv();
    picker.className = "mm-menu mm-marker-picker";
    picker.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const refresh = () => {
      const current = new Set(this.primary ? splitMarkers(this.primary.text).markers : []);
      picker.querySelectorAll<HTMLElement>(".mm-marker-btn").forEach((b) => b.classList.toggle("is-active", current.has(b.dataset.emoji ?? "")));
    };
    for (const group of MARKER_GROUPS) {
      const row = createDiv();
      row.className = "mm-marker-row";
      const label = createSpan();
      label.className = "mm-marker-label";
      label.textContent = group.name;
      row.append(label);
      for (const emoji of group.emojis) {
        const b = createEl("button");
        b.type = "button";
        b.className = "mm-marker-btn";
        b.dataset.emoji = emoji;
        b.textContent = emoji;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          for (const n of this.selected) n.text = toggleMarker(n.text, emoji);
          this.closeMarkerPicker();
          this.render();
          this.notify();
        });
        row.append(b);
      }
      picker.append(row);
    }
    const clear = createEl("button");
    clear.type = "button";
    clear.className = "mm-menu-item";
    clear.textContent = t("canvas.clearMarkers");
    clear.addEventListener("click", (ev) => {
      ev.stopPropagation();
      for (const n of this.selected) n.text = splitMarkers(n.text).rest;
      this.closeMarkerPicker();
      this.render();
      this.notify();
    });
    picker.append(clear);
    this.el.append(picker);
    refresh();
    const anchor = this.nodebar?.querySelector<HTMLElement>('.mm-tool[data-tool="marker"]') ?? this.els.get(node.id) ?? this.el;
    const host = this.el.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    picker.style.left = `${Math.max(4, Math.min(r.left - host.left + r.width / 2 - picker.offsetWidth / 2, host.width - picker.offsetWidth - 4))}px`;
    let top = r.top - host.top - picker.offsetHeight - 6;
    if (top < 4) top = r.bottom - host.top + 6;
    picker.style.top = `${top}px`;
    this.markerPicker = picker;
    this.markerPickerCleanup = this.dismissOnOutside(picker, () => this.closeMarkerPicker());
  }

  private closeMarkerPicker(): void {
    this.markerPickerCleanup?.();
    this.markerPickerCleanup = null;
    this.markerPicker?.remove();
    this.markerPicker = null;
  }

  // ---------- 聚焦分支 ----------

  focusOn(node: MindNode): void {
    if (!this.doc || node === this.doc.root) {
      this.exitFocus();
      return;
    }
    if (this.editing) this.commitEdit();
    this.focusRoot = node;
    this.hasView = false; // 重新适应画布
    this.select(node);
    this.render();
  }

  exitFocus(rerender = true): void {
    if (!this.focusRoot) return;
    this.focusRoot = null;
    this.hasView = false;
    if (rerender) this.render();
  }

  getFocus(): MindNode | null {
    return this.focusRoot;
  }

  private renderCrumbs(): void {
    this.crumbs?.remove();
    this.crumbs = null;
    if (!this.focusRoot) return;
    const bar = createDiv();
    bar.className = "mm-crumbs";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const chain: MindNode[] = [];
    for (let n: MindNode | null = this.focusRoot; n; n = n.parent) chain.unshift(n);
    chain.forEach((n, i) => {
      if (i > 0) {
        const sepEl = createSpan();
        sepEl.className = "mm-crumb-sep";
        sepEl.textContent = "›";
        bar.append(sepEl);
      }
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-crumb" + (i === chain.length - 1 ? " is-current" : "");
      b.textContent = i === 0 ? t("canvas.wholeMap") : plainText(n.text) || t("canvas.emptyNode");
      b.addEventListener("click", () => (i === 0 ? this.exitFocus() : this.focusOn(n)));
      bar.append(b);
    });
    this.el.append(bar);
    this.crumbs = bar;
  }

  // ---------- 拖入与图片粘贴 ----------

  private async handleDrop(ev: DragEvent, target: MindNode): Promise<void> {
    if (!this.doc) return;
    const vaultFiles = this.opts.host?.getDraggedFiles?.() ?? null;
    const created: MindNode[] = [];
    if (vaultFiles?.length) {
      for (const f of vaultFiles) {
        const n = addChild(target, this.doc.style, f.isImage ? `![[${f.linktext}]]` : `[[${f.linktext}]]`);
        created.push(n);
      }
    } else {
      const files = [...(ev.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        await this.insertImageFiles(files, target);
        return;
      }
      const text = ev.dataTransfer?.getData("text/plain")?.trim();
      if (!text) return;
      const n = addChild(target, this.doc.style, /^https?:\/\//.test(text) ? `[${text.replace(/^https?:\/\//, "").slice(0, 40)}](${text})` : text);
      created.push(n);
    }
    if (!created.length) return;
    if (target.folded) target.folded = false;
    this.select(null);
    created.forEach((n, i) => this.select(n, i === 0 ? "replace" : "add"));
    this.render();
    this.notify();
  }

  /** 把图片文件存成附件并作为子节点插入 */
  private async insertImageFiles(files: File[], target: MindNode | null): Promise<void> {
    if (!this.doc || !target) return;
    const save = this.opts.host?.saveBinary;
    if (!save) {
      this.opts.host?.notice?.(t("notice.saveImageUnsupported"));
      return;
    }
    const created: MindNode[] = [];
    for (const f of files) {
      try {
        const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const name = f.name && f.name !== "image.png" ? f.name : `Pasted image ${stamp}.${ext}`;
        const link = await save(name, await f.arrayBuffer());
        created.push(addChild(target, this.doc.style, `![[${link}]]`));
      } catch (e) {
        this.opts.host?.notice?.(t("notice.saveImageFailed", { error: (e as Error).message }));
      }
    }
    if (!created.length) return;
    if (target.folded) target.folded = false;
    this.select(null);
    created.forEach((n, i) => this.select(n, i === 0 ? "replace" : "add"));
    this.render();
    this.notify();
  }

  // ---------- 复制节点链接 ----------

  async copyNodeLink(node: MindNode): Promise<void> {
    const base = this.opts.host?.fileBasename?.();
    if (!base) return;
    let link: string;
    if (!node.parent) link = `[[${base}]]`;
    else if (node.kind === "heading") link = `[[${base}#${plainText(node.text).replace(/[#|[\]]/g, " ").trim()}]]`;
    else {
      if (!node.blockId) {
        if (!this.opts.editable) {
          this.opts.host?.notice?.(t("notice.noBlockId"));
          return;
        }
        node.blockId = newBlockId();
        this.notify();
      }
      link = `[[${base}#^${node.blockId}]]`;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.opts.host?.notice?.(t("notice.copied", { link }));
    } catch {
      this.opts.host?.notice?.(t("notice.copyFailed"));
    }
  }

  // ---------- 图片缩放手柄 ----------

  /** 选中含图片的节点时，在图片右下角放一个拖拽手柄 */
  /** 选中节点侧边的宽度手柄：拖动改宽（文字跟着换行），双击恢复自适应。图片/视频节点有自己的手柄 */
  private updateWidthHandle(): void {
    if (this.widthResize) return;
    this.widthHandle?.remove();
    this.widthHandle = null;
    if (!this.opts.editable || !this.primary || this.editing || this.selected.size !== 1) return;
    const el = this.els.get(this.primary.id);
    if (!el || el.querySelector("img.mm-img, iframe.mm-frame")) return;
    const node = this.primary;
    // 左侧分支向左长：手柄放在外侧（左边），往左拖是变宽
    const dir: 1 | -1 = el.dataset.side === "left" ? -1 : 1;
    const handle = createDiv();
    handle.className = "mm-width-handle" + (dir < 0 ? " is-left" : "");
    this.tip(handle, t("canvas.resizeWidth"), "fixed", dir < 0 ? "left" : "right");
    el.append(handle);
    handle.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.widthResize = { node, el, startWorldX: this.toWorld(ev.clientX, ev.clientY).x, startW: el.offsetWidth, dir };
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch {
        // 合成事件
      }
    });
    // 按世界坐标算：贴边自动平移时指针不动、画布在动，宽度照样跟着长
    const apply = (clientX: number, clientY: number) => {
      const r = this.widthResize;
      if (!r) return;
      const dx = this.toWorld(clientX, clientY).x - r.startWorldX;
      const w = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, r.startW + r.dir * dx));
      r.el.classList.add("has-width");
      r.el.style.width = `${Math.round(w)}px`;
      this.reflow(r.node);
      this.positionNodebar();
    };
    handle.addEventListener("pointermove", (ev) => {
      if (!this.widthResize) return;
      ev.stopPropagation();
      apply(ev.clientX, ev.clientY);
      const { clientX, clientY } = ev;
      this.updateAutoScroll(clientX, clientY, () => apply(clientX, clientY));
    });
    const finish = (ev: PointerEvent) => {
      const r = this.widthResize;
      if (!r) return;
      ev.stopPropagation();
      this.stopAutoScroll();
      this.widthResize = null;
      const w = Math.round(r.el.offsetWidth);
      if (w === r.startW) return;
      r.node.width = w;
      this.render();
      this.notify();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      this.resetWidth(node);
    });
    this.widthHandle = handle;
  }

  resetWidth(node: MindNode): void {
    if (!this.opts.editable || !node.width) return;
    node.width = undefined;
    this.render();
    this.notify();
  }

  private updateImageHandle(): void {
    this.updateWidthHandle();
    if (this.imgResize) return;
    this.imgHandle?.remove();
    this.imgHandle = null;
    if (!this.opts.editable || !this.primary || this.editing) return;
    const el = this.els.get(this.primary.id);
    const iframe = el?.querySelector<HTMLIFrameElement>("iframe.mm-frame");
    const img = iframe ? null : el?.querySelector<HTMLImageElement>("img.mm-img");
    const box = iframe ?? img;
    if (!el || !box || (img && !img.complete)) return;
    const frame = !!iframe;
    const handle = createDiv();
    handle.className = "mm-img-handle";
    this.tip(
      handle,
      frame ? t("canvas.resizeFrame") : t("canvas.resizeImage"),
      "fixed",
      "right",
    );
    el.append(handle);
    this.placeImageHandle(handle, box);
    const node = this.primary;
    handle.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.imgResize = {
        node,
        box,
        frame,
        startX: ev.clientX,
        startY: ev.clientY,
        startW: box.clientWidth,
        startH: box.clientHeight,
        handle,
      };
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch {
        // 合成事件
      }
    });
    handle.addEventListener("pointermove", (ev) => {
      const r = this.imgResize;
      if (!r) return;
      ev.stopPropagation();
      const dx = (ev.clientX - r.startX) / this.k;
      const dy = (ev.clientY - r.startY) / this.k;
      if (r.frame) {
        // 默认锁宽高比（视频基本都是 16:9），按住 Shift 才单独拉高度
        const w = Math.max(FRAME_MIN, Math.min(FRAME_MAX, r.startW + dx));
        const h = ev.shiftKey
          ? Math.max(FRAME_MIN, Math.min(FRAME_MAX, r.startH + dy))
          : Math.max(FRAME_MIN, Math.min(FRAME_MAX, (w * r.startH) / r.startW));
        r.box.style.width = `${Math.round(w)}px`;
        r.box.style.height = `${Math.round(h)}px`;
      } else {
        const w = Math.max(IMAGE_MIN_WIDTH, Math.min(IMAGE_MAX_WIDTH, r.startW + dx));
        r.box.classList.add("has-size");
        r.box.style.width = `${Math.round(w)}px`;
      }
      this.reflow();
      this.placeImageHandle(r.handle, r.box);
    });
    const finish = (ev: PointerEvent) => {
      const r = this.imgResize;
      if (!r) return;
      ev.stopPropagation();
      this.imgResize = null;
      const w = Math.round(r.box.clientWidth);
      const h = Math.round(r.box.clientHeight);
      if (w === r.startW && h === r.startH) return;
      if (r.frame) {
        // 不能走 render()：重建标签会把 iframe 摘下来再插回去，视频就从头开始了。
        // 尺寸已经是行内样式的样子，只把文本同步回去即可。
        r.node.text = setFrameSize(r.node.text, { w, h });
        this.notify();
        return;
      }
      r.node.text = setImageWidth(r.node.text, w);
      this.render();
      this.notify();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (frame) {
        node.text = setFrameSize(node.text, null);
        box.style.width = `${FRAME_DEFAULT_W}px`;
        box.style.height = `${FRAME_DEFAULT_H}px`;
        this.reflow();
        this.placeImageHandle(handle, box);
        this.notify();
        return;
      }
      node.text = setImageWidth(node.text, null);
      this.render();
      this.notify();
    });
    this.imgHandle = handle;
  }

  /** 放开某个节点的播放器挡板。只改 class，不重渲染 —— 重建标签会让 iframe 重新加载 */
  private setLiveFrame(id: string | null): void {
    if (this.liveFrame === id) return;
    const prev = this.liveFrame ? this.els.get(this.liveFrame) : null;
    prev?.classList.remove("is-frame-live");
    this.liveFrame = id;
    if (id) this.els.get(id)?.classList.add("is-frame-live");
  }

  private placeImageHandle(handle: HTMLElement, box: HTMLElement): void {
    // iframe 外面还包了一层定位的 .mm-frame-box，offsetLeft 是相对最近的定位祖先，得一路加回节点
    let left = box.offsetWidth;
    let top = box.offsetHeight;
    for (let n: HTMLElement | null = box; n && !n.classList.contains("mm-node"); n = n.offsetParent as HTMLElement | null) {
      left += n.offsetLeft;
      top += n.offsetTop;
    }
    handle.style.left = `${left - 7}px`;
    handle.style.top = `${top - 7}px`;
  }

  // ---------- 备注弹层 ----------

  private toggleNotePopover(node: MindNode, edit = false): void {
    const sameNode = this.popover?.dataset.id === node.id;
    const alreadyEditing = !!this.popover?.querySelector("textarea");
    // 再点一次图标就收起；但「编辑」请求要把查看态切成编辑态，不能当成收起
    if (sameNode && (!edit || alreadyEditing)) {
      this.closePopover();
      return;
    }
    this.closePopover();
    const nodeEl = this.els.get(node.id);
    if (!nodeEl) return;
    const pop = createDiv();
    pop.className = "mm-popover";
    pop.dataset.id = node.id;
    pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop.addEventListener("wheel", (ev) => ev.stopPropagation());
    const editable = this.opts.editable && (edit || !node.note);
    if (editable) {
      const ta = createEl("textarea");
      ta.className = "mm-note-editor";
      ta.placeholder = t("canvas.notePlaceholder");
      const plain = unescapeNote(node.note);
      ta.value = plain;
      ta.rows = Math.min(12, Math.max(3, plain.split("\n").length + 1));
      const initial = node.note;
      const apply = () => {
        const next = normalizeNote(ta.value.replace(/\s+$/, ""));
        if (next === node.note) return false;
        node.note = next;
        return true;
      };
      let saved = false;
      const save = () => {
        if (saved) return;
        saved = true;
        this.popoverApply = null;
        apply();
        if (node.note !== initial) {
          this.render();
          this.notify();
        }
      };
      ta.addEventListener("input", () => {
        if (apply() && !this.opts.embedded) this.scheduleNotify();
      });
      ta.addEventListener("blur", () => {
        if (this.popover === pop) this.closePopover();
      });
      this.popoverSave = save;
      this.popoverApply = apply;
      pop.append(ta);
      this.el.append(pop);
      this.placePopover(pop, nodeEl);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } else {
      const body = createDiv();
      body.className = "mm-popover-body";
      if (this.opts.host?.renderNote) {
        body.classList.add("markdown-rendered");
        this.opts.host.renderNote(body, unescapeNote(node.note));
      } else {
        body.classList.add("is-plain");
        body.textContent = unescapeNote(node.note);
      }
      pop.append(body);
      if (this.opts.editable) {
        const editBtn = createEl("button");
        editBtn.type = "button";
        editBtn.className = "mm-popover-edit";
        editBtn.textContent = t("menu.edit");
        editBtn.addEventListener("click", () => this.toggleNotePopover(node, true));
        pop.append(editBtn);
      }
      this.el.append(pop);
      this.placePopover(pop, nodeEl);
    }
    this.popover = pop;
  }

  private placePopover(pop: HTMLElement, nodeEl: HTMLElement): void {
    const r = nodeEl.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - host.left, host.width - pop.offsetWidth - 8));
    let top = r.bottom - host.top + 8;
    if (top + pop.offsetHeight > host.height - 8) top = Math.max(8, r.top - host.top - pop.offsetHeight - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  private closePopover(): void {
    if (!this.popover) return;
    const pop = this.popover;
    const save = this.popoverSave;
    this.popover = null;
    this.popoverSave = null;
    this.popoverApply = null;
    pop.remove();
    save?.();
  }
}
