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
  pathOf,
  removeNode,
  visibleChildren,
  walk,
} from "./model";
import {
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
import { BRANCH_COLOR_COUNT, THEME_LIST, ThemeName, THEMES } from "./theme";
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
  /** 当前文件名（不含扩展名），复制节点链接用 */
  fileBasename?: () => string;
  notice?: (message: string) => void;
  /** 用宿主的样式显示提示（Obsidian 的 setTooltip）；没有就退回原生 title */
  setTooltip?: (el: HTMLElement, text: string, placement: TooltipPlacement) => void;
}

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

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
  /** 嵌在别的笔记里（代码块）：阻止事件冒泡到编辑器，工具栏带「编辑」开关，备注不做实时同步 */
  embedded?: boolean;
  /** 平移缩放变化时调用，用来在重新渲染后恢复视口 */
  onViewChange?: (state: ViewState) => void;
  onEditableChange?: (editable: boolean) => void;
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
const TOOLBAR_POSITION_LABELS: { id: ToolbarPosition; label: string }[] = [
  { id: "bottom", label: "下方（水平）" },
  { id: "top", label: "上方（水平）" },
  { id: "left", label: "左侧（垂直）" },
  { id: "right", label: "右侧（垂直）" },
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
};

const IS_APPLE = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** 把 Mod/Shift/Alt 写成当前平台的样子：⌘⇧⌥ 或 Ctrl+Shift+Alt+ */
function sc(...keys: string[]): string {
  const map: Record<string, string> = IS_APPLE
    ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵" }
    : { Mod: "Ctrl+", Shift: "Shift+", Alt: "Alt+", Enter: "Enter" };
  return keys.map((k) => map[k] ?? k).join(IS_APPLE ? "" : "");
}

const COLOR_LABELS: Record<string, string> = {
  red: "红色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  teal: "青色",
  blue: "蓝色",
  purple: "紫色",
  pink: "粉色",
  gray: "灰色",
};

function icon(name: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "mm-icon";
  span.innerHTML = ICONS[name];
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

    this.viewport = document.createElement("div");
    this.viewport.className = "mm-viewport";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "mm-edges");
    this.nodesEl = document.createElement("div");
    this.nodesEl.className = "mm-nodes";
    this.overlay = document.createElement("div");
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

  private themeTipText(): string {
    return `主题：${THEMES[this.opts.theme].label.split(" · ")[0]} · 点击切换`;
  }

  private toggleThemeMenu(anchor: HTMLElement): void {
    if (this.themeMenu) {
      this.closeThemeMenu();
      return;
    }
    this.themeMenu = this.buildMenu(
      THEME_LIST.map((t) => ({
        label: t.label,
        active: t.name === this.opts.theme,
        run: () => {
          this.setTheme(t.name);
          this.opts.onThemeChange?.(t.name);
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
    return `结构：${label} · 点击切换`;
  }

  setEditable(editable: boolean): void {
    if (this.opts.editable === editable) return;
    if (!editable) this.flush();
    this.opts.editable = editable;
    this.el.classList.toggle("is-editable", editable);
    this.structureButton?.classList.toggle("is-hidden", !editable);
    this.themeButton?.classList.toggle("is-hidden", !editable);
    this.structureSep?.classList.toggle("is-hidden", !editable);
    if (this.editToggle) {
      this.editToggle.replaceChildren(icon(editable ? "check" : "pencil"));
      this.tip(this.editToggle, editable ? "完成编辑，回到只读" : "编辑这张脑图 · 改动写回代码块", "toolbar");
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
    this.markerPicker = null;
    this.markerPickerCleanup = null;
    this.edgePaths = [];
    for (const c of [...this.outsideCleanups]) c();
    this.toolbarTips = [];
  }

  /** 返回是否真的适应了：容器还没量出尺寸时会失败，调用方得再试一次 */
  fit(): boolean {
    if (!this.layout) return false;
    const { bounds } = this.layout;
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    if (!cw || !ch) return false;
    let k = Math.min(1, (cw - FIT_PADDING * 2) / bounds.w, (ch - FIT_PADDING * 2) / bounds.h);
    if (k > 0.96) k = 1;
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
      const el = reused ?? document.createElement("div");
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
      if (theme.underlineFromDepth !== null && rel >= theme.underlineFromDepth && !node.color) {
        el.classList.add("is-underline");
      }
      if (this.selected.has(node)) el.classList.add("is-selected");
      if (this.search?.matches.has(node)) {
        el.classList.add("is-match");
        if (this.search.list[this.search.index] === node) el.classList.add("is-current-match");
      }

      if (!keepChildren) {
        const label = document.createElement("div");
        label.className = "mm-label";
        renderInline(label, node.text || (node.depth === 0 ? "中心主题" : ""), {
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
        if (shield) this.tip(shield, "双击激活播放器；激活前点哪儿都只是选中节点", "fixed", "top");
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
        this.tip(n, "查看备注");
        n.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        n.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleNotePopover(node);
        });
        el.append(n);
      }

      if (!keepChildren && node.children.length) {
        const t = document.createElement("button");
        t.className = "mm-toggle" + (node.folded ? " is-folded" : "");
        t.type = "button";
        if (node.folded) t.textContent = String(node.children.length);
        else t.append(icon("minus"));
        this.tip(t, node.folded ? `展开 ${node.children.length} 个子节点 /` : "折叠这一支 /");
        t.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        t.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleFold(node);
        });
        el.append(t);
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
      const style = parentNode === base ? theme.rootEdge : theme.edge;
      // 复用已有的 path，只改变了的属性；重新创建几千个 SVG 元素会让布局整体失效
      let path = this.edgePaths[edgeIndex];
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
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
      const d = edgePath(g, style) + tail;
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
      const depth = String(Math.min(child.node.depth - base.depth, 3));
      if (path.dataset.depth !== depth) path.dataset.depth = depth;
      const branch = this.els.get(child.node.id)?.dataset.branch;
      const stroke = branch !== undefined ? `var(--mm-branch-${branch})` : "";
      if (path.style.stroke !== stroke) path.style.stroke = stroke;
      if (path.style.display) path.style.display = "";
    }
    for (let i = edgeIndex; i < this.edgePaths.length; i++) {
      if (!this.edgePaths[i].style.display) this.edgePaths[i].style.display = "none";
    }
    this.updateZoomLabel();
    this.opts.onLayout?.(this.layout.bounds);
  }

  private settleTimer: number | null = null;

  /**
   * 平移/缩放期间把画布提成独立合成层，拖起来才跟手。
   * 但合成层是按「提层那一刻」的比例栅格化的，一直挂着 will-change 的话，放大后看到的
   * 就是被 GPU 拉伸的位图 —— 文字发虚。所以手一停就摘掉，让浏览器按当前比例重新栅格化。
   */
  private holdLayer(): void {
    if (this.viewport.style.willChange !== "transform") this.viewport.style.willChange = "transform";
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      this.viewport.style.willChange = "";
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
    const bar = document.createElement("div");
    bar.className = "mm-toolbar";
    bar.dataset.pos = this.toolbarPos;
    this.toolbar = bar;
    if (this.opts.onToolbarPositionChange) {
      this.tip(bar, "右键可切换工具栏位置", "toolbar");
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
      const b = document.createElement("button");
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
      btn("outline", "大纲面板 · 树形列表，可改名和调层级", () => this.opts.onToggleOutline?.());
      const sep0 = document.createElement("span");
      sep0.className = "mm-tool-sep";
      bar.append(sep0);
    }
    if (this.opts.embedded) {
      this.editToggle = btn(this.opts.editable ? "check" : "pencil", this.opts.editable ? "完成编辑，回到只读" : "编辑这张脑图 · 改动写回代码块", () =>
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
      const sep = document.createElement("span");
      sep.className = "mm-tool-sep";
      sep.classList.toggle("is-hidden", !this.opts.editable);
      bar.append(sep);
      this.structureSep = sep;
    }
    btn("minus", `缩小 ${sc("Mod", "-")}`, () => this.zoomBy(1 / 1.2));
    this.zoomLabel = document.createElement("button");
    this.zoomLabel.type = "button";
    this.zoomLabel.className = "mm-tool mm-zoom-label";
    this.zoomLabel.dataset.tool = "zoom";
    this.tip(this.zoomLabel, "当前缩放 · 点击回到 100%", "toolbar");
    this.zoomLabel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this.zoomLabel.addEventListener("click", () => this.zoomBy(1 / this.k));
    bar.append(this.zoomLabel);
    btn("plus", `放大 ${sc("Mod", "+")}`, () => this.zoomBy(1.2));
    btn("fit", `适应画布 · 缩放到看得见全部节点 ${sc("Mod", "0")}`, () => this.fit());
    btn("center", "回到中心 · 中心主题居中，缩放 100%", () => this.center());
    const sep2 = document.createElement("span");
    sep2.className = "mm-tool-sep";
    bar.append(sep2);
    if (this.opts.onUndo) {
      btn("undo", `撤销 ${sc("Mod", "Z")}`, () => this.opts.onUndo?.());
      btn("redo", `重做 ${sc("Mod", "Shift", "Z")}`, () => this.opts.onRedo?.());
      const sep3 = document.createElement("span");
      sep3.className = "mm-tool-sep";
      bar.append(sep3);
    }
    btn("search", `搜索节点 ${sc("Mod", "F")}`, () => this.openSearch());
    const layers = btn("layers", "折叠层级 · 展开全部或只看前几层", () => this.toggleFoldMenu(layers));
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
    const menu = document.createElement("div");
    menu.className = "mm-menu";
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    let cleanup = () => undefined as void;
    const closeAll = () => {
      cleanup();
      close();
    };
    for (const it of items) {
      const b = document.createElement("button");
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
    const bar = document.createElement("div");
    bar.className = "mm-nodebar";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const swatch = (color: string | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-swatch";
      this.tip(b, color ? `${COLOR_LABELS[color] ?? color} · 给选中的节点上色` : "清除颜色");
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
    const sep = document.createElement("span");
    sep.className = "mm-tool-sep";
    bar.append(sep);
    const tool = (name: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
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
    tool("child", "添加子节点 Tab", () => this.addChildToSelected());
    tool("sibling", `添加兄弟节点 ${sc("Enter")}`, () => this.addSiblingToSelected(false));
    tool("marker", "标记 · 优先级、进度、旗帜、符号", () => this.toggleMarkerPicker());
    tool("note", "备注 · 支持 Markdown，可写列表", () => {
      if (this.primary) this.toggleNotePopover(this.primary, true);
    });
    if (this.opts.host?.pickNote) tool("link", `链接到笔记，或按名字新建 ${sc("Mod", "K")}`, () => void this.linkSelectedToNote());
    tool("copy", `复制这棵子树 ${sc("Mod", "C")}`, () => this.copySelection());
    tool("paste", `粘贴为子节点 ${sc("Mod", "V")}`, () => void this.pasteFromClipboard());
    tool("trash", "删除节点及其子树 Delete", () => this.deleteSelected());
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
        if (ev.ctrlKey || ev.metaKey) {
          const rect = el.getBoundingClientRect();
          this.zoomBy(Math.exp(-ev.deltaY * scale * 0.01), ev.clientX - rect.left, ev.clientY - rect.top);
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
      if (this.editing && (ev.target as HTMLElement).classList.contains("mm-label")) this.reflow(this.editing);
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
      return;
    }
    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        ev.preventDefault();
        this.navigate(sel, ev.key);
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
    this.selectNearest(p, key === "ArrowUp" ? "up" : "down");
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
    const box = document.createElement("div");
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
    const indicator = document.createElement("div");
    indicator.className = "mm-drop-indicator";
    this.overlay.append(indicator);
    for (const n of subtree) this.els.get(n.id)?.classList.add("is-dragging");
    this.drag = { node, ghost, subtree, target: null, indicator };
    this.el.classList.add("is-dragging-node");
    this.positionNodebar();
    this.updateDrag(ev);
  }

  private updateDrag(ev: PointerEvent): void {
    if (!this.drag) return;
    const host = this.el.getBoundingClientRect();
    this.drag.ghost.style.left = `${ev.clientX - host.left + 12}px`;
    this.drag.ghost.style.top = `${ev.clientY - host.top + 12}px`;
    const w = this.toWorld(ev.clientX, ev.clientY);
    const target = this.findDropTarget(w.x, w.y, this.drag.subtree);
    this.drag.target = target;
    for (const el of this.els.values()) el.classList.remove("is-drop-target");
    const ind = this.drag.indicator;
    ind.style.display = "none";
    if (!target || !this.layout) return;
    if (target.kind === "node") {
      this.els.get(target.parent.id)?.classList.add("is-drop-target");
      return;
    }
    const kids = visibleChildren(target.parent).filter((c) => !this.drag!.subtree.has(c)).map((c) => this.layout!.placed.get(c.id)!).filter(Boolean);
    if (!kids.length) return;
    const gap = target.parent.depth === 0 ? DEFAULT_LAYOUT.gapMain : DEFAULT_LAYOUT.gapSibling;
    const side = kids[0].side;
    const pos = kids.findIndex((k) => target.parent.children.indexOf(k.node) >= target.index);
    ind.classList.toggle("is-vertical", side === "down");
    if (side === "down") {
      let x: number;
      if (pos === -1) x = kids[kids.length - 1].x + kids[kids.length - 1].w + gap;
      else if (pos === 0) x = kids[0].x - gap;
      else x = (kids[pos - 1].x + kids[pos - 1].w + kids[pos].x) / 2;
      Object.assign(ind.style, { display: "block", left: `${x - 2}px`, top: `${kids[0].y}px` });
      return;
    }
    let y: number;
    if (pos === -1) y = kids[kids.length - 1].y + kids[kids.length - 1].h + gap / 2;
    else if (pos === 0) y = kids[0].y - gap / 2;
    else y = (kids[pos - 1].y + kids[pos - 1].h + kids[pos].y) / 2;
    const x = side === "left" ? kids[0].x + kids[0].w - 48 : kids[0].x;
    Object.assign(ind.style, { display: "block", left: `${x}px`, top: `${y - 2}px` });
  }

  private findDropTarget(wx: number, wy: number, exclude: Set<MindNode>): DropTarget | null {
    if (!this.layout) return null;
    const placed = [...this.layout.placed.values()].filter((p) => !exclude.has(p.node));
    // 先看子节点列之间的空隙：插入到指定位置
    for (const p of placed) {
      const kids = visibleChildren(p.node).filter((c) => !exclude.has(c)).map((c) => this.layout!.placed.get(c.id)!).filter(Boolean);
      if (!kids.length) continue;
      const gap = p.node.depth === 0 ? DEFAULT_LAYOUT.gapMain : DEFAULT_LAYOUT.gapSibling;
      const horizontal = kids[0].side === "down";
      const minX = Math.min(...kids.map((k) => k.x)) - (horizontal ? gap : 12);
      const maxX = Math.max(...kids.map((k) => k.x + k.w)) + (horizontal ? gap : 12);
      const minY = Math.min(...kids.map((k) => k.y)) - (horizontal ? 12 : gap);
      const maxY = Math.max(...kids.map((k) => k.y + k.h)) + (horizontal ? 12 : gap);
      if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;
      // 落在某个子节点自己的盒子里 → 成为它的子节点
      const hit = kids.find((k) => wx >= k.x + 4 && wx <= k.x + k.w - 4 && wy >= k.y + 4 && wy <= k.y + k.h - 4);
      if (hit) return { parent: hit.node, index: hit.node.children.length, kind: "node" };
      const before = horizontal ? kids.filter((k) => k.x + k.w / 2 < wx).length : kids.filter((k) => k.y + k.h / 2 < wy).length;
      const index = before < kids.length ? p.node.children.indexOf(kids[before].node) : p.node.children.length;
      return { parent: p.node, index, kind: "gap" };
    }
    for (const p of placed) {
      if (wx >= p.x - 8 && wx <= p.x + p.w + 8 && wy >= p.y - 8 && wy <= p.y + p.h + 8) {
        return { parent: p.node, index: p.node.children.length, kind: "node" };
      }
    }
    return null;
  }

  private endDrag(commit: boolean): void {
    if (!this.drag) return;
    const { node, ghost, indicator, target } = this.drag;
    ghost.remove();
    indicator.remove();
    for (const el of this.els.values()) el.classList.remove("is-dragging", "is-drop-target");
    this.el.classList.remove("is-dragging-node");
    this.drag = null;
    if (commit && target && this.doc && !isAncestor(node, target.parent) && target.parent !== node) {
      const parent = target.parent;
      const sameSpot = node.parent === parent && parent.children.indexOf(node) === target.index;
      if (!sameSpot) {
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
    this.select(node);
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
    this.startEdit(node, true);
  }

  private addSiblingToSelected(before: boolean): void {
    const sel = this.primary;
    if (!sel || !this.doc) return;
    const node = addSibling(sel, "", !before);
    if (!node) return;
    this.select(node);
    this.render();
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

  // ---------- 折叠层级 ----------

  /** level 为 null 展开全部；否则深度 ≥ level 的节点折叠（1 = 只看主主题） */
  setFoldLevel(level: number | null): void {
    if (!this.doc) return;
    if (this.editing) this.commitEdit();
    walk(this.doc.root, (n) => {
      if (n.children.length) n.folded = level !== null && n.depth >= level;
    });
    this.render();
    if (this.opts.editable) this.notify();
  }

  private toggleFoldMenu(anchor: HTMLElement): void {
    if (this.foldMenu) {
      this.closeFoldMenu();
      return;
    }
    this.foldMenu = this.buildMenu(
      [
        { label: "展开全部", run: () => this.setFoldLevel(null) },
        { label: "只显示主主题", run: () => this.setFoldLevel(1) },
        { label: "显示到第 2 层", run: () => this.setFoldLevel(2) },
        { label: "显示到第 3 层", run: () => this.setFoldLevel(3) },
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
    const bar = document.createElement("div");
    bar.className = "mm-search";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mm-search-input";
    input.placeholder = "搜索节点";
    input.spellcheck = false;
    const count = document.createElement("span");
    count.className = "mm-search-count";
    count.textContent = "0/0";
    const tool = (name: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
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
      tool("up", `上一个匹配 ${sc("Shift", "Enter")}`, () => this.stepMatch(-1)),
      tool("down", `下一个匹配 ${sc("Enter")}`, () => this.stepMatch(1)),
      tool("close", "关闭搜索 Esc", () => this.closeSearch()),
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
          { label: `打开「${link.target}」`, run: () => this.opts.host?.openLink?.(link.target, true, new MouseEvent("click")) },
          { label: "取消链接", run: () => this.unlinkNote(node) },
        ],
        anchor,
        () => {
          this.linkMenu?.remove();
          this.linkMenu = null;
        },
      );
      return;
    }
    const suggested = plainText(node.text).replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "未命名";
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
        { title: "编辑", icon: "pencil", run: () => this.startEdit(node) },
        { title: "添加子节点", icon: "corner-down-right", run: () => this.addChildToSelected() },
        { title: "添加兄弟节点", icon: "list-plus", disabled: !node.parent, run: () => this.addSiblingToSelected(false) },
        sep,
      );
    }
    entries.push(
      this.focusRoot === node
        ? { title: "退出聚焦", icon: "minimize", run: () => this.exitFocus() }
        : { title: "聚焦此分支", icon: "focus", disabled: !node.children.length, run: () => this.focusOn(node) },
    );
    if (node.children.length) entries.push({ title: node.folded ? "展开" : "折叠", icon: node.folded ? "chevron-down" : "chevron-right", run: () => this.toggleFold(node) });
    entries.push(sep);
    if (editable) {
      if (link) {
        entries.push(
          { title: `打开「${link.target}」`, icon: "file-text", run: () => this.opts.host?.openLink?.(link.target, true, new MouseEvent("click")) },
          { title: "取消链接", icon: "unlink", run: () => this.unlinkNote(node) },
        );
      } else if (this.opts.host?.pickNote) {
        entries.push({ title: "链接到笔记…", icon: "link", run: () => void this.linkSelectedToNote() });
      }
      entries.push(
        { title: node.note ? "编辑备注" : "添加备注", icon: "sticky-note", run: () => this.toggleNotePopover(node, true) },
        { title: "标记…", icon: "star", run: () => this.toggleMarkerPicker(true) },
        { title: "任务复选框", icon: "check-square", checked: /^\[( |x|X)\]\s/.test(splitMarkers(node.text).rest), run: () => this.toggleTaskOnSelected() },
        sep,
      );
      const parent = node.parent;
      const canHeading = !!parent && parent.kind === "heading" && parent.level + 1 <= 6;
      entries.push(
        { title: "本级转为标题", icon: "heading", disabled: !parent || node.kind === "heading" || !canHeading, run: () => this.convertLevel(node, "heading") },
        { title: "本级转为列表", icon: "list", disabled: !parent || node.kind === "list", run: () => this.convertLevel(node, "list") },
        sep,
      );
    }
    entries.push(
      { title: "复制", icon: "copy", run: () => this.copySelection() },
      ...(editable ? [{ title: "剪切", icon: "scissors", run: () => this.cutSelection() } as MenuEntry, { title: "粘贴为子节点", icon: "clipboard-paste", run: () => void this.pasteFromClipboard() } as MenuEntry] : []),
      { title: "复制节点链接", icon: "link-2", disabled: !this.opts.host?.fileBasename, run: () => void this.copyNodeLink(node) },
    );
    if (editable && node.parent) entries.push(sep, { title: "删除", icon: "trash", run: () => this.deleteSelected() });
    return entries;
  }

  private backgroundMenuEntries(): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (this.opts.editable) entries.push({ title: "粘贴", icon: "clipboard-paste", run: () => void this.pasteFromClipboard() }, { separator: true });
    entries.push(
      { title: "展开全部", icon: "chevrons-down-up", run: () => this.setFoldLevel(null) },
      { title: "只显示主主题", icon: "chevrons-up-down", run: () => this.setFoldLevel(1) },
      { title: "适应画布", icon: "maximize", run: () => this.fit() },
    );
    if (this.focusRoot) entries.push({ separator: true }, { title: "退出聚焦", icon: "minimize", run: () => this.exitFocus() });
    return entries;
  }

  private convertLevel(node: MindNode, kind: "heading" | "list"): void {
    if (!this.doc || !this.opts.editable) return;
    if (!convertLevelKind(node, kind, this.doc.style)) {
      this.opts.host?.notice?.("这一层不能转为标题：父节点不是标题，或已经是六级标题");
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
    const picker = document.createElement("div");
    picker.className = "mm-menu mm-marker-picker";
    picker.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const refresh = () => {
      const current = new Set(this.primary ? splitMarkers(this.primary.text).markers : []);
      picker.querySelectorAll<HTMLElement>(".mm-marker-btn").forEach((b) => b.classList.toggle("is-active", current.has(b.dataset.emoji ?? "")));
    };
    for (const group of MARKER_GROUPS) {
      const row = document.createElement("div");
      row.className = "mm-marker-row";
      const label = document.createElement("span");
      label.className = "mm-marker-label";
      label.textContent = group.name;
      row.append(label);
      for (const emoji of group.emojis) {
        const b = document.createElement("button");
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
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "mm-menu-item";
    clear.textContent = "清除全部标记";
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
    const bar = document.createElement("div");
    bar.className = "mm-crumbs";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const chain: MindNode[] = [];
    for (let n: MindNode | null = this.focusRoot; n; n = n.parent) chain.unshift(n);
    chain.forEach((n, i) => {
      if (i > 0) {
        const sepEl = document.createElement("span");
        sepEl.className = "mm-crumb-sep";
        sepEl.textContent = "›";
        bar.append(sepEl);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-crumb" + (i === chain.length - 1 ? " is-current" : "");
      b.textContent = i === 0 ? "全图" : plainText(n.text) || "（空）";
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
      this.opts.host?.notice?.("当前环境不支持保存图片");
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
        this.opts.host?.notice?.(`保存图片失败：${(e as Error).message}`);
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
    else if (node.kind === "heading") link = `[[${base}#${plainText(node.text).replace(/[#|\[\]]/g, " ").trim()}]]`;
    else {
      if (!node.blockId) {
        if (!this.opts.editable) {
          this.opts.host?.notice?.("这个节点还没有块 id，需要在可编辑状态下生成");
          return;
        }
        node.blockId = newBlockId();
        this.notify();
      }
      link = `[[${base}#^${node.blockId}]]`;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.opts.host?.notice?.(`已复制 ${link}`);
    } catch {
      this.opts.host?.notice?.("复制失败");
    }
  }

  // ---------- 图片缩放手柄 ----------

  /** 选中含图片的节点时，在图片右下角放一个拖拽手柄 */
  private updateImageHandle(): void {
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
    const handle = document.createElement("div");
    handle.className = "mm-img-handle";
    this.tip(
      handle,
      frame ? "拖动改大小（按住 Shift 单独调高度），双击恢复 560×315" : "拖动改图片大小，双击恢复原始尺寸",
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
    const pop = document.createElement("div");
    pop.className = "mm-popover";
    pop.dataset.id = node.id;
    pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop.addEventListener("wheel", (ev) => ev.stopPropagation());
    const editable = this.opts.editable && (edit || !node.note);
    if (editable) {
      const ta = document.createElement("textarea");
      ta.className = "mm-note-editor";
      ta.placeholder = "备注（支持 Markdown，可以写列表）";
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
      const body = document.createElement("div");
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
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "mm-popover-edit";
        editBtn.textContent = "编辑";
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
