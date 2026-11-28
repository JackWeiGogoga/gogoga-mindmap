/**
 * 画布：把树渲染成 HTML 节点 + SVG 连线，负责平移缩放、选择（多选/框选）、拖拽换父、
 * 内联编辑、备注编辑、键盘操作。不依赖 obsidian 模块，浏览器调试页和代码块渲染器共用。
 */

import { rankLinkTargets } from "./link-rank";
import { progressLabel, taskProgress, type TaskProgressMode } from "./task-progress";
import { centerAt, minimapScale, minimapShown, toMini, viewRect, type MinimapMode } from "./minimap-core";
import { clickNode, frameView, presentKey, presentLook, presentProgress, presentRoute, presentSwipe, reanchor, startState, step as presentStep, type PresentAction, type PresentState } from "./present-core";
import { noteCardParts, type NoteCardFilter } from "./note-filter";
import {
  addChild,
  addSibling,
  addRootSibling,
  attachSubtree,
  createNode,
  findByPath,
  isAncestor,
  MindDoc,
  MindNode,
  moveNode,
  boxGroups,
  GroupKind,
  groupLimits,
  groupRange,
  insertParents,
  setGroupRange,
  shrinkGroupsAround,
  NODE_MAX_WIDTH,
  NODE_MIN_WIDTH,
  pathOf,
  removeNode,
  removeNodeKeepChildren,
  summaryGroups,
  visibleChildren,
  Relation,
  walkAll,
  walkMap,
  isSummaryTopic,
  BRANCH_LAYOUTS,
  type BranchLayout,
  topicsOf,
  visibleTopics,
  fixTopics,
  hideNode,
  countHidden,
  numberLabel,
  orderedBullet,
  stripTypedNumbers,
  TYPED_NUMBER_RE,
  allChildren,
  type RelShape,
  REL_SHAPES,
} from "./model";
import {
  allSpines,
  BOX_PAD,
  branchStructure,
  Bounds,
  CALLOUT_GAP,
  DEFAULT_LAYOUT,
  edgeGeometry,
  ribGeometry,
  isFishbone,
  edgePath,
  isTimeline,
  isTimelineH,
  layoutMap,
  LayoutOptions,
  LayoutResult,
  Placed,
  relGeometry,
  Segment,
  PlacedCallout,
  PlacedNote,
  PlacedSummary,
  Size,
  Structure,
  STRUCTURES,
} from "./layout";
import { type InlineFormat } from "./format";
import { applyFormat } from "./format-apply";
import { formatLines } from "./note-lines";
import type { LiveNoteEditor, LiveNoteEditorOptions } from "./live-note-editor";
import { type ColorKind, type ColorMemory, createColorSplit, createPalette, paintColor, refreshColorSplit, THEME_HIGHLIGHT } from "./color-palette";
import { colorFormat, colorTitle, createFormatBar, highlightFormat } from "./format-bar";
import { InlineEditor } from "./inline-editor";
import {
  fromEditableText,
  getImageMaxWidth,
  FRAME_DEFAULT_H,
  FRAME_DEFAULT_W,
  FRAME_MAX,
  FRAME_MIN,
  IMAGE_MIN_WIDTH,
  isAnswerMarker,
  isAnswer,
  MARKER_GROUPS,
  plainText,
  renderInline,
  setFrameSize,
  setImageWidth,
  mapSize,
  setMapSize,
  MAP_MAX_H,
  MAP_MAX_W,
  MAP_MIN_H,
  MAP_MIN_W,
  splitMarkers,
  taskState,
  toEditableText,
  toggleMarker,
  toggleTask,
  wikilinkOf,
  linkRange,
  linkWholeText,
  unlinkText,
} from "./inline";
import { baseThemeOf, BRANCH_COLOR_COUNT, EdgeOptions, EdgeStyle, isThemeName, isUnderlineAt, resolveTheme, ThemeId, themeIds, themeLabel, themeShortLabel } from "./theme";
import { Key, paletteText, t } from "./i18n";
import { alignedTiers, tierOf } from "./custom-theme";
import { clampCard, NOTE_CARD_MAX, type NoteCards, type NoteCardState } from "./state";
import { TableEditor, type EditorHost } from "./table/editor/editor";
import { assignReviewIds, deckIdOf, newReviewId, REVIEW_KEY, reviewBranches } from "./review/mindmap-cards";
import type { Table } from "./table/core/table";
import type { SecretBox } from "./table/core/secret-box";
import { type BarItem, isSep, mergeLayout, NODEBAR_DEFAULT, TOOLBAR_DEFAULT, visibleSeps } from "./bar-layout";
import { isWebUrl, linkDestination } from "./paste-link";
import { spotInSource } from "./note-spot";
import { addTable, noteOnlyTable, noteRest, noteTable, splitNoteTables, tableSource, withoutTable, withTable } from "./node-table";
import { type CustomSplit, type SplitRule, splitText } from "./split";
import { arrangeMenu, type MenuPlace, MORE_SLOT, tidySeparators } from "./menu-layout";
import { calloutFromMarker, calloutToMarker, COLOR_NAMES, setFrontmatterValue, convertLevelKind, MARKER_RE, markerText, newBlockId, normalizeNote, parseClipboard, subtreeToList, unescapeNote } from "./markdown";

export interface CanvasHost {
  /** 嵌入的图拿到焦点时，截下会和画布按键撞车的 Obsidian 全局热键交给 onKey；返回注销函数 */
  claimKeys?: (el: HTMLElement, onKey: (ev: KeyboardEvent) => void) => () => void;
  /** 渲染节点备注（Obsidian 里用 MarkdownRenderer），缺省为纯文本 */
  renderNote?: (el: HTMLElement, markdown: string) => void;
  /**
   * 分栏预览用：一个单独的渲染作用域，反复 render 时前一次的渲染随即释放，弹窗关掉时 dispose。
   * 不给就没有分栏预览
   */
  notePreviewScope?: () => { render: (el: HTMLElement, markdown: string) => void; dispose: () => void };
  /** 编辑备注用 Obsidian 自己的实时预览编辑器（所见即所得）；建不起来返回 null，画布退回普通输入框 */
  createNoteEditor?: (parent: HTMLElement, o: Omit<LiveNoteEditorOptions, "file">) => LiveNoteEditor | null;
  openLink?: (href: string, internal: boolean, ev: MouseEvent) => void;
  /** 内部链接悬停：Obsidian 用来弹页面预览 */
  hoverLink?: (ev: MouseEvent, linktext: string, targetEl: HTMLElement) => void;
  /**
   * 右键链接、图片：弹出 Obsidian 原生的链接菜单（新标签页打开、重命名、移动……）。extra 是放在最前面的额外项。
   * linktext 为空时只放 extra
   */
  linkContextMenu?: (ev: MouseEvent, linktext: string, extra: { title: string; icon: string; warning?: boolean; run: () => void }[]) => void;
  /** 用 Obsidian 自己的确认框删掉链接指向的文件；删了返回 true */
  deleteLinkedFile?: (linktext: string) => Promise<boolean>;
  /** 让用户挑一篇笔记（或新建），返回笔记名；取消返回 null */
  pickNote?: (suggested: string) => Promise<string | null>;
  /** 渲染 $…$ 公式 */
  renderMath?: (tex: string) => HTMLElement | null;
  /** 一批节点渲染完之后（Obsidian 用来 finishRenderMath） */
  afterRender?: () => void;
  /** 把图片链接解析成 src */
  resolveImage?: (link: string) => string | null;
  /**
   * 节点里的 `![[另一张脑图]]`：链接指向脑图笔记或 .xmind 时，往 el 里挂一张只读预览，返回卸载函数；不是脑图返回 null
   */
  mapPreview?: (link: string, el: HTMLElement) => { dispose: () => void; fit: () => void } | null;
  /** PDF 截区（PDF++ 的 #rect=）：画进 el，图片好了交回 onImage；画不了返回 false */
  renderPdfCrop?: (link: string, el: HTMLElement, onImage: (img: HTMLImageElement) => void) => boolean;
  /** 原生右键菜单（Obsidian 的 Menu）；没有就用画布自带的 */
  /** onClose：菜单关掉时调用（画布借此在菜单开着时藏起节点浮动工具栏） */
  showMenu?: (entries: MenuEntry[], ev: MouseEvent, onClose?: () => void) => void;
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
  /** 编辑时粘贴网页地址，抓它的标题（设置里关着就返回 null，照常粘地址） */
  linkTitle?: (url: string) => Promise<string | null> | null;
  /** 在元素里放图标（Obsidian 的 setIcon）：节点里的表格编辑器用 */
  setIcon?: (el: HTMLElement, name: string) => void;
  /** 库里已有的标签（不带 #）：节点表格的格子里输入 # 时补全 */
  listTags?: () => string[];
  /** 节点表格的日期列写成 [[日记]] 时：按日记插件的日期格式写名字、读名字 */
  dailyNote?: () => { name(v: { y: number; m: number; d: number }): string; parse(name: string): { y: number; m: number; d: number } | null };
  /** 用宿主的样式显示提示（Obsidian 的 setTooltip）；没有就退回原生 title */
  setTooltip?: (el: HTMLElement, text: string, placement: TooltipPlacement, delay?: number) => void;
  /** 节点表格的加密格子：用 gogoga Table 的主密码会话（装着才有；没有就只显示 ••••••，不能解锁） */
  tableSecrets?: () => SecretBox | null;
  /** 确认框（把加密格子解密成明文之前问一下） */
  confirm?: (message: string, ok: string) => Promise<boolean>;
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
  /** 灰掉的原因：悬停显示，点一下弹提示（灰着不说原因，会被当成功能坏了、要付费） */
  why?: string;
  checked?: boolean;
  run?: () => void;
  separator?: boolean;
  /** 二级菜单；host 拿不到二级菜单时平铺在这一项的位置 */
  submenu?: MenuEntry[];
  /** 节点右键菜单里能挪位置的项（见 menu-layout.ts） */
  id?: string;
}

/** 间隔复习的宿主接口：数字由宿主异步算好，画布同步取 */
export interface ReviewHooks {
  /** 今天到期的卡挂在哪些节点（rv）、这张图今天一共要复习几张；还没算好返回 null */
  due(): { ids: Set<string>; count: number } | null;
  /** 这个分支（节点路径）下今天要复习几张 */
  dueIn(path: string): number;
  /** 打开复习：null 是整张图，否则只复习这个分支 */
  study(branchPath: string | null): void;
  /** 加入、移出复习了：宿主重算数字 */
  changed(): void;
  /** 小绿点开着没有 */
  dots(): boolean;
  /** 这篇笔记以前用过的牌组 id：移出复习再加回来时沿用，排期接着用 */
  previousDeck(): string | null;
  suspended(reviewId: string): boolean;
  unsuspend(reviewId: string): void;
}

/** 原地复习（在脑图里一道道过）：排期由宿主管，画布只管遮、揭开、选中、画按钮 */
export interface MapReviewDriver {
  /**
   * 下一张。card：卡片挂的节点（rv）和类型、底栏的三个数（current 是正在出的这张属于哪一类）。
   * 没有了返回 done：wait 是学习中下一张到点的时刻（没有为 null），note 是学完的小结
   */
  next():
    | { reviewId: string; kind: "cloze" | "choice" | "answer"; counts: [number, number, number]; current: 0 | 1 | 2 }
    | { done: true; wait: number | null; note: string };
  /** 翻面后四个按钮上方的间隔文字 */
  intervals(): [string, string, string, string];
  grade(g: 1 | 2 | 3 | 4): Promise<void>;
  /** 撤销上一次评分；撤销了返回 true */
  undo(): Promise<boolean>;
  /** 这张找不到节点了（删了）：今天先不出，接着下一张 */
  skip(): Promise<void>;
  /** 换到复习标签页接着复习 */
  openTab(): void;
  finish(): void;
}

/** 快捷设置面板的一项：value 是布尔就画开关，否则按 options 画几选一 */
export interface QuickSetting {
  label: string;
  value: boolean | string;
  options?: { value: string; label: string }[];
  set: (value: boolean | string) => void;
}

/** 把二级菜单平铺开（不支持二级菜单的地方用），子项前后加分隔线 */
export function flattenMenu(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (!e.submenu) {
      out.push(e);
      continue;
    }
    if (e.disabled) continue;
    if (out.length && !out[out.length - 1].separator) out.push({ separator: true });
    out.push(...flattenMenu(e.submenu).filter((x, i, arr) => !(x.separator && (i === 0 || i === arr.length - 1))));
    out.push({ separator: true });
  }
  return out.filter((x, i, arr) => !(x.separator && arr[i - 1]?.separator));
}

export interface DroppedFile {
  name: string;
  basename: string;
  linktext: string;
  isImage: boolean;
}

export interface CanvasOptions {
  structure: Structure;
  theme: ThemeId;
  editable: boolean;
  host?: CanvasHost;
  /** 树被编辑后调用（折叠、改文字、增删移节点、颜色、备注） */
  onChange?: (doc: MindDoc) => void;
  /** 中心主题不是来自一级标题时显示什么（笔记视图是文件名；代码块里是空串） */
  fallbackTitle?: () => string;
  onUndo?: () => void;
  onRedo?: () => void;
  onStructureChange?: (structure: Structure) => void;
  onThemeChange?: (theme: ThemeId) => void;
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
  /** 提供则空白处右键菜单里有「Markdown 和思维导图分屏对照」（只在脑图视图里，嵌入的没有） */
  onSideBySide?: () => void;
  /** 禅模式开关（#43）：视图收起 / 还原 Obsidian 自己的界面；嵌入的脑图不给，就没有禅模式 */
  onZen?: (on: boolean) => void;
  /** 提供则工具栏出现「锁定编辑」按钮：锁住后只能看（缩放、平移、折叠），参数是锁上之后的状态 */
  onLockChange?: (locked: boolean) => void;
  /** 「显示隐藏的节点」现在开着没有（开着时带 %%hide%% 的节点半透明地留在图里） */
  showHidden?: () => boolean;
  /** 工具栏 / 命令切换「显示隐藏的节点」：宿主按新规则重新解析 */
  onToggleHidden?: () => void;
  /** 工具栏位置；提供 onToolbarPositionChange 后工具栏上右键可以切换 */
  toolbarPosition?: ToolbarPosition;
  /** 主工具栏收起着（#61）：只留一个小把手，点它或用命令「隐藏 / 显示工具栏」再展开。不给 onToolbarHiddenChange 就没有收起按钮（嵌入的图） */
  toolbarHidden?: () => boolean;
  /** 用户点了收起 / 展开：宿主记进设置，别的打开着的图跟着变 */
  onToolbarHiddenChange?: (hidden: boolean) => void;
  onToolbarPositionChange?: (pos: ToolbarPosition) => void;
  /** 返回 true 时滚轮直接缩放、Shift+滚轮平移；每次滚动时读取，改设置立即生效 */
  wheelZoom?: () => boolean;
  /** 编辑备注时分栏预览；每次打开编辑时读取 */
  notePreview?: () => boolean;
  /** 编辑备注时所见即所得（嵌入 Obsidian 的编辑器）；关掉是普通输入框 */
  noteLiveEdit?: () => boolean;
  /** 复制节点时剪贴板里不带 %%…%% 标记 */
  copyPlain?: () => boolean;
  /** 选中节点时显示浮动工具栏（关掉后这些操作在右键菜单里） */
  showNodebar?: () => boolean;
  /** 工具栏的「浮动工具栏」按钮：开关设置 showNodebar（插件那边改设置、重建各张图的工具栏） */
  onToggleNodebar?: () => void;
  /** 浮动工具栏、格式栏放在哪：节点（选中的字）上方 / 下方 / 固定在画布顶部（B 站落尘-书生） */
  barPlacement?: () => "above" | "below" | "top";
  /** 浮动工具栏、主工具栏的按钮：显示哪些、什么顺序（见 bar-layout.ts）；每次建工具栏时读 */
  nodebarLayout?: () => BarItem[];
  toolbarLayout?: () => BarItem[];
  /** 浮动工具栏和标注颜色菜单里列出的节点颜色（颜色名或 #色值），见 parseNodeColors */
  nodeColors?: () => string[];
  /** 编辑节点文字时选中一段文字弹出格式栏 */
  formatBar?: () => boolean;
  /** 工具栏「快捷设置」面板里的几项（给了才有这个按钮）：开关或几选一，改了直接存进设置 */
  quickSettings?: () => QuickSetting[];
  /** 设置「保留节点里的空行」：多行节点中间的空行不抹掉 */
  keepBlankLines?: () => boolean;
  /** 设置「保留节点开头结尾的空格」：文件里写成 &nbsp;，编辑框里是普通空格 */
  keepEdgeSpaces?: () => boolean;
  /** 拆成子节点的偏好：保留原文字、保留拆分符号、设置里自定义的拆分方式 */
  split?: () => { keepOriginal: boolean; keepDelims: boolean; custom: CustomSplit[] };
  /** 选中节点时把它平滑移到画布中间（默认关：只在出了视野时带回来） */
  centerOnSelect?: () => boolean;
  /** 演示模式：叶子也各占一步 */
  presentLeaves?: () => boolean;
  /** 左下角的缩略图：自动（大图才显示）/ 总是 / 从不 */
  minimap?: () => MinimapMode;
  /** 编辑时光标挨着格式也不露出 ** == 这些标记（默认关） */
  hideSyntax?: () => boolean;
  /** 鼠标移到任意节点的右边缘就能拖动改宽、双击，不用先选中（默认关：只有选中的节点有手柄） */
  widthHandleOnHover?: () => boolean;
  /** 新建的节点自带名字「主题1」「主题2」…：不写字直接确认也留着（默认关：没写字的新节点不保留） */
  newNodeName?: () => boolean;
  /** 和 Markdown 分屏联动的开关（工具栏按钮，同一篇的 Markdown 开着时才出现） */
  splitSync?: { on: () => boolean; toggle: () => void };
  /** 编辑时在开头打「1.」「1、」：这组同级开始编号，打的数字去掉（默认关） */
  autoNumber?: () => boolean;
  /** 常用文字颜色、荧光笔颜色（格式栏和「第 N 个颜色」命令用） */
  textColors?: () => string[];
  highlightColors?: () => string[];
  /** 节点右键菜单各项放哪一层（只有和默认不一样的） */
  menuLayout?: () => Record<string, MenuPlace>;
  /** 颜色下拉记住的颜色（上次用的、最近使用）；不给就只记在这张图里 */
  colorMemory?: ColorMemory;
  /** 返回 true 时鼠标左键拖空白处是框选，右键 / 中键拖动平移；每次按下时读取 */
  marqueeDrag?: () => boolean;
  /** 返回 true 时进入编辑把光标放在文字末尾；否则全选（默认，打字直接替换） */
  caretAtEnd?: () => boolean;
  /** 编辑节点时自动配对引号、括号（设置 autoPair，#55） */
  autoPair?: () => boolean;
  /** 返回 true 时把节点拖到空白处会变成自由主题（XMind 的习惯）；否则拖到空白处是取消 */
  dragToFloat?: () => boolean;
  /** 首次显示（没有恢复视口时）：fit 适应画布（默认），center 中心主题 100% */
  initialView?: () => "fit" | "center";
  /** 打开时标注是否隐藏（按文件记住）；不给就默认显示 */
  calloutsHidden?: () => boolean;
  /** 用户切换了标注的显示 / 隐藏 */
  onCalloutsHiddenChange?: (hidden: boolean) => void;
  /** 打开时备注是否展开显示在节点下面（按文件记住）；不给就收起（点图标弹窗看） */
  notesExpanded?: () => boolean;
  /** 展开的备注卡片里显示什么：全部，或者只显示列表项 / 有序列表 / 无序列表（#31）；不给就是全部 */
  noteCardFilter?: () => NoteCardFilter;
  /** 用户切换了备注的展开 / 收起 */
  onNotesExpandedChange?: (expanded: boolean) => void;
  /** 清单上一级的节点显示任务完成度：关、百分比、完成数/总数、两者都显示；不给就是关 */
  taskProgress?: () => TaskProgressMode;
  /** 完成度放在哪：文字后面（默认），或者文字下面单独一行 */
  taskProgressPos?: () => "end" | "below";
  /** 没单独设线形的关联线用哪种（#53），默认曲线 */
  relShape?: () => RelShape;
  /**
   * 每条展开备注单独的状态（单独收起、拖出来的大小）变了，或者节点改名、挪动让文字路径变了：把整份交回去存。
   * 打开文件时由宿主用 setNoteCards 交进来；不接就只在这次打开有效
   */
  onNoteCardsChange?: (cards: NoteCards) => void;
  /** 按键是不是用户在快捷键设置里绑给本插件命令的；是就不在画布里处理，交给 Obsidian 去执行命令 */
  ownsHotkey?: (ev: KeyboardEvent) => boolean;
  /** 查看备注弹窗的默认尺寸（设置里填的）；单条备注拖过的尺寸记在备注状态里（pw/ph），优先用它 */
  notePopoverSize?: { get: () => PopoverSize | undefined; set: (size: PopoverSize) => void };
  /** 提供则节点右键菜单有「在 Markdown 中定位」：切到 Markdown 并跳到选中节点那一行 */
  onRevealInMarkdown?: () => void;
  /** 间隔复习：右键「间隔复习」、工具栏「复习 N」、到期节点的小绿点。不给就没有这些 */
  review?: ReviewHooks;
  /** 嵌在别的笔记里（代码块）：阻止事件冒泡到编辑器，工具栏带「编辑」开关，备注不做实时同步 */
  embedded?: boolean;
  /** 嵌入的脑图：先点一下脑图，滚轮才拿来平移（#35，默认这样）；没点过时滚轮交给页面滚动，⌘ / Ctrl + 滚轮照样缩放 */
  embedWheelLock?: () => boolean;
  /** 平移缩放变化时调用，用来在重新渲染后恢复视口 */
  onViewChange?: (state: ViewState) => void;
  onEditableChange?: (editable: boolean) => void;
  /**
   * 嵌入的是一个文件（![[脑图]]）而不是代码块：没有地方写回，工具栏的「编辑」换成「打开」，
   * 双击也是打开原文件
   */
  onOpenFile?: () => void;
  /** 代码块嵌入：工具栏「编辑」旁边多一个「大窗口编辑」，在铺满窗口的编辑框里改这张图（#41） */
  onBigEdit?: () => void;
  /**
   * 嵌入的图：还没手动拖过、缩放过时，框的大小一变（插件按内容调高、阅读模式排完版、侧栏开合）就重新适应画布，
   * 一直居中、给工具栏留位置（蝈蝈反馈嵌入的图没居中、工具栏压在图上）
   */
  autoRefit?: boolean;
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
export interface PopoverSize {
  w: number;
  h: number;
}

/** 画布里按键能做的节点操作，另外注册成命令，用户可以在快捷键设置里换成自己的习惯 */
export type NodeCommand =
  | "add-child"
  | "add-sibling"
  | "insert-before"
  | "insert-parent"
  | "edit"
  | "delete"
  | "delete-only"
  | "add-rel"
  | "move-up"
  | "move-down"
  | "outdent"
  | "indent"
  | "expand-branch"
  | "collapse-branch"
  | "expand-level"
  | "collapse-level"
  | "callout"
  | "note";

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
  /** 记下视口时画布的宽高：换到大小不同的窗格（比如侧边栏）恢复时，按它保持画面中心不变 */
  cw?: number;
  ch?: number;
}

/** 链接补全最多列多少条；超出一屏的滚动查看 */
const LINK_SUGGEST_MAX = 50;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const FIT_PADDING = 48;

const DRAG_THRESHOLD = 4;

/** 设置里的「节点间距」：所有画布的间距按这个倍数放大缩小（1 = 主题原样） */
let spacingScale = 1;
/** 活着的画布，间距、字号这类全局设置变了时一起重画 */
const liveCanvases = new Set<MindMapCanvas>();

export function setSpacingScale(scale: number): void {
  spacingScale = scale;
}

/** 全局显示设置变了：所有打开着的画布重新量尺寸、重新排版 */
/**
 * 跟着设置走的节点装饰（宿主在启动时挂上，画布里不碰 Obsidian）：
 * levelColor：按层级着色，第 depth 层（中心主题 0）的颜色，关着时 null；
 * pdfBorder：节点文字里 PDF++ 链接的标注颜色（color=…）对应的外框颜色，没有或关着时 null
 */
export const nodeDecor: { levelColor?: (depth: number) => string | null; pdfBorder?: (text: string) => string | null } = {};

/** 缩略图的设置变了：开着的脑图都重画缩略图 */
export function refreshAllMinimaps(): void {
  for (const c of liveCanvases) c.scheduleMinimap();
}

export function redrawAllCanvases(): void {
  for (const c of liveCanvases) c.redrawAll();
}

/** 设置里改了「备注展开显示」的默认值 */
/**
 * 节点在树里的文字路径，用来记单条备注的状态：中心主题是空串，往下每层是节点文字，
 * 同一层有同名兄弟时带上它是第几个。在 Markdown 里改了文字就对不上，退回默认显示（只是视图状态，不要紧）
 */
export function noteKey(node: MindNode): string {
  const parts: string[] = [];
  for (let n = node; n.parent; n = n.parent) {
    const same = n.parent.children.filter((c) => c.text === n.text);
    const i = same.indexOf(n);
    parts.push(i > 0 ? `${n.text}\u0002${i}` : n.text);
  }
  return parts.reverse().join("\u0001");
}

/** 拖备注卡片时的最小尺寸（画布像素） */
const NOTE_CARD_MIN = { w: 80, h: 40 };

/** 设置里改了浮动工具栏、主工具栏的按钮：所有打开着的画布照新的清单重建工具栏 */
export function refreshAllBars(): void {
  for (const c of liveCanvases) c.refreshBars();
}

/** 只重画浮动工具栏（快捷设置里开关它时用，主工具栏和开着的快捷设置面板不动） */
export function refreshAllNodebars(): void {
  for (const c of liveCanvases) c.refreshNodebar();
}

export function syncNotesExpandedAll(): void {
  for (const c of liveCanvases) c.syncNotesExpanded();
}

const ICONS: Record<string, string> = {
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  splitSync: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><path d="M6.5 10h3M14.5 10h3M6.5 14h3M14.5 14h3"/></svg>',
  splitSyncOff: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><path d="M3 3l18 18"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  center: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  logic: '<svg viewBox="0 0 24 24"><path d="M3 12h6M9 12v-6h6M9 12v6h6M9 12h6"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.21-1.79 4-4 4h-1.5a1.5 1.5 0 0 0-1.06 2.56A1.5 1.5 0 0 1 12 21Z"/><circle cx="7.5" cy="12" r="1"/><circle cx="9.5" cy="8" r="1"/><circle cx="14.5" cy="7.5" r="1"/><circle cx="17.5" cy="11" r="1"/></svg>',
  structure: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v4M6 17v-3h12v3"/></svg>',
  mindmap: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M15 12h6M9 12H3M14.5 9.5l4-4M14.5 14.5l4 4M9.5 9.5l-4-4M9.5 14.5l-4 4"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  nodebar: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="7" rx="2"/><path d="M7 6.5h.01M12 6.5h.01M17 6.5h.01"/><rect x="7" y="15" width="10" height="6" rx="1.5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  highlighter: '<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
  // 虚线框里一只眼睛：把藏起来的节点显示出来
  review: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="14" rx="2"/><path d="M7 3h11a2 2 0 0 1 2 2v12"/><path d="M7 14l2.5 2.5L13 12"/></svg>',
  hiddenNodes: '<svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M6 12s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="12" cy="12" r="1.5"/></svg>',
  present: '<svg viewBox="0 0 24 24"><path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5"/></svg>',
  recite: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7c2.1 0 3.8.7 5.2 1.7M22 12s-3.5 7-10 7c-2.1 0-3.8-.7-5.2-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  minimize: '<svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  quick: '<svg viewBox="0 0 24 24"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>',
  split: '<svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  outline: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  // 加下级 / 加同级（#44）：方框是主题，虚线框是要加的那个；下级在右边连一条短横，同级在下面用「[」连起来
  child: '<svg viewBox="0 0 24 24"><rect x="2" y="8" width="7" height="8" rx="1.5"/><rect x="15" y="8" width="7" height="8" rx="1.5" stroke-dasharray="2.5 2.5"/><path d="M9 12h6"/></svg>',
  sibling: '<svg viewBox="0 0 24 24"><rect x="10" y="3" width="11" height="6" rx="1.5"/><rect x="10" y="15" width="11" height="6" rx="1.5" stroke-dasharray="2.5 2.5"/><path d="M10 6H6v12h4"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>',
  marker: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.3l6-.8z"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  none: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  edge: '<svg viewBox="0 0 24 24"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18c6 0 4-12 10-12" stroke-dasharray="0"/></svg>',
  callout: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>',
  // 文字颜色：字母 A，下面一道颜色条（按钮上的条按当前颜色上色）
  textColor: '<svg viewBox="0 0 24 24"><path d="m6 16 6-12 6 12M8.5 11h7"/><path class="mm-tc-bar" d="M4 20h16" stroke-width="3"/></svg>',
  // 浮动工具栏的可选按钮：关联线（带箭头的虚线弧）、表格、折叠
  rel: '<svg viewBox="0 0 24 24"><path d="M4 18C4 9 11 5 19 6" stroke-dasharray="3 3"/><path d="m15 3 4 3-3 4"/></svg>',
  table: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>',
  // Lucide image-plus（ISC）
  media: '<svg viewBox="0 0 24 24"><path d="M16 5h6M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></svg>',
  fold: '<svg viewBox="0 0 24 24"><path d="m7 20 5-5 5 5M7 4l5 5 5-5"/></svg>',
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

export function colorLabel(color: string): string {
  const key = COLOR_LABEL_KEYS[color];
  return key ? t(key) : color;
}

/** 最近一次复制的节点：剪贴板里放的版本和带标记的完整版（各个脑图共用，跨图粘贴也能还原） */
let lastCopy: { plain: string; full: string; titles: string[] } | null = null;

/** 设置页里画工具栏按钮的图标用 */
export function toolIcon(name: string): HTMLElement {
  return icon(name);
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
  /** 落在节点上（成为末尾子节点）、落在子节点列之间（插入到指定位置），还是落在概要文字上（先变成概要主题，再挂到它下面） */
  kind: "node" | "gap" | "summary";
  /** 思维导图结构里拖到中心主题的左边还是右边 */
  side?: "left" | "right";
  /** 有 side 时：插在那一侧从上往下第几个位置（画指示线用） */
  slot?: number;
  /** 指示线直接画在这里（画布坐标的中心点，竖着画）：鱼骨图主骨上两根斜骨之间 */
  at?: { x: number; y: number };
}

/**
 * 链接的 #… 部分指向哪个节点：#^abc 按块 id 找；#甲#乙 按标题路径找（只写最后一段也行），
 * 比较时去掉 Markdown 格式、不分大小写，和 Obsidian 找标题的方式一致。找不到返回 null
 */
export function findSubpathNode(root: MindNode, subpath: string): MindNode | null {
  const sub = subpath.replace(/^#/, "");
  if (!sub) return null;
  const norm = (s: string) => plainText(s).replace(/\s+/g, " ").trim().toLowerCase();
  let target: MindNode | null = null;
  if (sub.startsWith("^")) {
    const id = sub.slice(1);
    walkMap(root, (n) => {
      if (!target && n.blockId === id) target = n;
    });
    return target;
  }
  const parts = sub.split("#").map(norm).filter(Boolean);
  const last = parts[parts.length - 1];
  walkMap(root, (n) => {
    if (target || norm(n.text) !== last) return;
    // 写了上级标题的，上级也要对得上
    let p = n.parent;
    for (let i = parts.length - 2; i >= 0 && p; i--) {
      while (p && norm(p.text) !== parts[i]) p = p.parent;
      if (!p) return;
      p = p.parent;
    }
    target = n;
  });
  return target;
}

/** 关联线的两个控制点（#28）；没有就是一个控制点或默认弯法 */
function relCubic(rel: Relation): { c1: { x: number; y: number }; c2: { x: number; y: number } } | undefined {
  return rel.c1 && rel.c2 ? { c1: rel.c1, c2: rel.c2 } : undefined;
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
  /** 工具栏收起后留在原处的小把手（点它展开） */
  private toolbarHandle: HTMLElement | null = null;
  private toolbarHidden = false;
  /** 记住每个按钮的提示文案；节点上的图标会随渲染反复重建，用 WeakMap 免得越积越多 */
  private tips = new WeakMap<HTMLElement, { text: string; zone: "toolbar" | "fixed"; placement?: TooltipPlacement; delay?: number }>();
  /** 工具栏按钮单独留一份引用，换位置时要重新按新方向应用 */
  private toolbarTips: HTMLElement[] = [];
  private positionMenu: HTMLElement | null = null;
  private structureButton: HTMLButtonElement | null = null;
  private structureMenu: HTMLElement | null = null;
  private themeButton: HTMLButtonElement | null = null;
  private themeMenu: HTMLElement | null = null;
  private edgeButton: HTMLButtonElement | null = null;
  /** 拖节点 / 拖宽度时贴近画布边缘自动平移；tick 在每帧平移后重算拖拽状态 */
  private autoScroll: { raf: number; vx: number; vy: number; tick: () => void } | null = null;
  private linkSuggest: { el: HTMLElement; items: LinkTarget[]; index: number; open: number } | null = null;
  private edgeMenu: HTMLElement | null = null;
  private editToggle: HTMLButtonElement | null = null;
  private nodebar: HTMLElement | null = null;
  /** 手机 / 平板上选中关联线时线上方的小工具栏（编辑文字、删除）：没有 Delete 键、长按线也难按准，靠它删线 */
  private relbar: HTMLElement | null = null;
  /** 触屏长按关联线弹菜单的计时；fired 记下刚自己弹过菜单，系统随后再发的 contextmenu 就不重复弹 */
  private relPress: { timer: number; x: number; y: number } | null = null;
  private relPressFired = 0;

  private doc: MindDoc | null = null;
  private layout: LayoutResult | null = null;
  private els = new Map<string, HTMLElement>();
  private sizes = new Map<string, Size>();
  private recite = false;
  private reciteButton: HTMLElement | null = null;
  /** 背诵模式下已揭晓答案的题目 */
  private revealedQuestions = new Set<string>();
  /** 背诵模式下点开了的答案节点 */
  private revealedAnswers = new Set<string>();
  private reciteDown: { x: number; y: number } | null = null;
  /** 撤掉同层对齐之前量到的宽高；对齐在它的基础上算 */
  private naturalSizes = new Map<string, Size>();
  /** 被同层对齐写过 style.width 的节点 */
  private alignedEls = new Set<HTMLElement>();
  /** 节点内容的签名，用来判断能否原样复用元素 */
  private elSigs = new WeakMap<HTMLElement, string>();
  /** 只跟「节点里画什么」有关的签名；它没变就别动 DOM 子节点（iframe 重新插入会重新加载） */
  private elContent = new WeakMap<HTMLElement, string>();
  /** 每个节点当前活着的 iframe，按 id 存，重渲染时复用同一个元素 */
  private frames = new Map<string, HTMLIFrameElement | HTMLMediaElement>();
  /** 节点里嵌入的脑图预览：键是「节点 id|链接|参数」。重画节点时原样搬进新的标签里，不重新加载 */
  private mapPreviews = new Map<string, { el: HTMLElement; dispose: () => void; fit: () => void }>();
  /** 激活着的预览（双击或点「激活」）：能平移、缩放、展开折叠，键同 mapPreviews */
  private livePreview: string | null = null;
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
  private summaryLayer!: SVGGElement;
  private summaryPaths: SVGPathElement[] = [];
  /** 外框 / 概要两端的范围手柄（池子按序号复用） */
  private rangeHandles: HTMLElement[] = [];
  private rangeHandleInfo = new WeakMap<HTMLElement, { kind: GroupKind; start: MindNode; end: "start" | "end" }>();
  /** 鼠标停在哪个概要文字上：它的范围手柄跟着显示 */
  private hoverGroup: MindNode | null = null;
  private summaryLabels = new Map<string, HTMLElement>();
  private summaryStart = new WeakMap<HTMLElement, MindNode>();
  private editingSummary: MindNode | null = null;
  /** 标注：气泡是 nodes 层里的 HTML（按节点 id 复用），尖角画在 svg 里 */
  private calloutLayer!: SVGGElement;
  private calloutTails: SVGPathElement[] = [];
  private calloutEls = new Map<string, HTMLElement>();
  private calloutNode = new WeakMap<HTMLElement, MindNode>();
  private editingCallout: MindNode | null = null;
  /** 整体隐藏标注时排版当它们不存在；点节点上的小图标临时浮出一条看（不重新排版） */
  private calloutsHidden = false;
  private peekCallout: MindNode | null = null;
  private calloutButton: HTMLElement | null = null;
  private hiddenButton: HTMLElement | null = null;
  private reviewButton: HTMLElement | null = null;
  /** 原地复习进行中 */
  private mapReview: {
    driver: MapReviewDriver;
    node: MindNode | null;
    kind: "cloze" | "choice" | "answer" | null;
    shown: boolean;
    prevRecite: boolean;
    unfolded: MindNode[];
    bar: HTMLElement;
    pop: HTMLElement;
    start: number;
    timer: number;
  } | null = null;
  /** 展开的备注：卡片是 nodes 层里的 HTML（按节点 id 复用），放到分支下面离得远时引线画在 svg 里 */
  private noteLayer!: SVGGElement;
  private relLayer!: SVGGElement;
  private noteLinks: SVGPathElement[] = [];
  private noteEls = new Map<string, HTMLElement>();
  private noteNode = new WeakMap<HTMLElement, MindNode>();
  private notesExpanded = false;
  /** 每条展开备注单独的状态，按节点 id 记（改名、挪动时跟着节点走）；写出时换算成文字路径 */
  private cardState = new Map<string, NoteCardState>();
  /** 上次读到 / 交出去的文字路径版本：重新解析出新的树时，靠它把状态认回到节点上 */
  private cardKeys: NoteCards = {};
  /** 这次操作里因为挪动被升成标题的列表节点，notify 时提示一次 */
  private promoted: MindNode[] = [];
  /** 只把标题当节点时，新建出了六级以下的节点（写回会变成备注）：提示过一次就不再提 */
  private warnedDeep = false;
  private notesButton: HTMLElement | null = null;
  /** 备注里的图片、公式晚到会把卡片撑大，尺寸一变就重新排版 */
  private noteRo: ResizeObserver | null = null;
  /** 节点框里的表格（%%table%%）：按节点 id 记着编辑器和它显示的那张表的 Markdown */
  private tableEds = new Map<string, { ed: TableEditor; src: string; node: MindNode }>();
  /** 这一轮渲染里节点编号 → 节点（事件里按编号现查当前的节点；按元素找节点也用它） */
  private nodeById = new Map<string, MindNode>();
  /** 正在拖右下角改大小的那条备注：松手前还没记进 cardState，重新布局时按它来，不然会被改回旧尺寸、一闪一闪 */
  private cardDrag: { id: string; size: NoteCardState } | null = null;

  private tx = 0;
  private ty = 0;
  private k = 1;
  private hasView = false;
  /**
   * 恢复的视口：画面中心对着的内容坐标，以及按它摆好后的平移量。窗格大小还在变（侧边栏展开、代码块重新渲染）时
   * 每次都把这个点放回中心；平移量被别处改过（用户拖动、缩放、定位）就作废
   */
  private viewAnchor: { cx: number; cy: number; tx: number; ty: number } | null = null;
  /** 聚焦 / 退出聚焦后重新适应画布，不走「打开脑图时」的设置 */
  private refitOnly = false;
  private needsRender = false;

  private selected = new Set<MindNode>();
  private primary: MindNode | null = null;
  private editing: MindNode | null = null;
  private editingIsNew = false;

  private pointers = new Map<number, { x: number; y: number }>();
  /** menuNode：右键按在这个节点上（拖动平移时鼠标已被画布接管，contextmenu 的 target 不再是节点，按下时先记住） */
  private pan: { x: number; y: number; tx: number; ty: number; moved: boolean; onNode?: boolean; button?: number; menuNode?: MindNode } | null = null;
  private pendingMenuNode: MindNode | null = null;
  /** 框选模式下右键按住拖动平移：macOS 按下就发 contextmenu，先存着，松开没拖动才弹菜单 */
  private pendingMenu: MouseEvent | null = null;
  /** Windows 上 contextmenu 在松开之后才来；刚拖完平移的那一下不弹菜单 */
  private suppressMenuUntil = 0;
  private pinch: { dist: number; k: number } | null = null;
  private pendingDrag: { node: MindNode; x: number; y: number } | null = null;
  private lastTap: { node: MindNode; time: number } | null = null;
  /** 这次按下是不是落在播放器挡板上；双击挡板是「激活播放器」，不是「编辑文字」 */
  private downOnShield = false;
  /** 这次按下点在节点里的脑图预览上（双击它是激活，不是编辑） */
  private downOnPreview: string | null = null;
  /** 按下时落在图片上：双击 / 连点两下就看大图，不进编辑 */
  private downOnImage: HTMLImageElement | null = null;
  private lightbox: HTMLElement | null = null;
  private keysHandled = new WeakSet<KeyboardEvent>();
  private pendingSelectPath: string | null = null;
  /** 触屏：按住节点不动一段时间才进入拖拽，期间手指移动视为平移 */
  private touchPress: { node: MindNode; timer: number; ev: PointerEvent } | null = null;
  private search: { bar: HTMLElement; input: HTMLInputElement; count: HTMLElement; results: HTMLElement; matches: Set<MindNode>; list: MindNode[]; index: number; listOpen: boolean } | null = null;
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
  private widthHandleNode: MindNode | null = null;
  /** 鼠标正指着的节点（悬停调宽度用） */
  private hoverNode: MindNode | null = null;
  /** 拖宽度手柄：group 是一起改宽度的节点（框选了好几个、拖的是其中一个时是选中的全部，否则只有它） */
  private widthResize: { node: MindNode; el: HTMLElement; startWorldX: number; startW: number; dir: 1 | -1; group: { node: MindNode; el: HTMLElement; w: number }[]; moved?: boolean } | null = null;
  private imgResize: {
    node: MindNode;
    /** 图片或 iframe，两者都靠右下角那个手柄改大小 */
    box: HTMLImageElement | HTMLIFrameElement | HTMLVideoElement;
    frame: boolean;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    handle: HTMLElement;
  } | null = null;
  private clipboardText = "";
  /** movers：一起拖的节点（多选时是选区里最外层的那些，按文档顺序），node 是按住的那个 */
  private drag: {
    node: MindNode;
    movers: MindNode[];
    ghost: HTMLElement;
    subtree: Set<MindNode>;
    target: DropTarget | null;
    indicator: HTMLElement;
    /** 按下点相对按住节点中心的偏移（世界坐标），放到空白处时用来算自由主题的位置 */
    grab: { x: number; y: number };
    /** 最后一次指针位置（世界坐标） */
    last: { x: number; y: number } | null;
  } | null = null;
  private marquee: { x: number; y: number; el: HTMLElement; base: Set<MindNode>; moved?: boolean } | null = null;
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
  private formatBar: HTMLElement | null = null;
  /** 正在编辑备注时：格式命令、快捷键改的是备注里选中的字，不是节点 */
  private noteFormat: ((fmt: InlineFormat) => void) | null = null;
  /** 备注卡片、查看备注窗口里画出来的表格（只读）：卡片或窗口没了就销毁 */
  private noteTableEds = new Set<{ el: HTMLElement; ed: TableEditor }>();
  /** 正在编辑的节点文字的编辑框（CodeMirror），和 editing 同生同灭 */
  private nodeEditor: InlineEditor | null = null;
  /** 正在编辑的标注的编辑框：文字颜色、高亮、加粗这些格式也能用在标注上（群里反馈） */
  private calloutEditor: InlineEditor | null = null;

  constructor(container: HTMLElement, opts: CanvasOptions) {
    this.opts = { ...opts };
    this.el = container;
    this.el.classList.add("gg-mm-root");
    liveCanvases.add(this);
    this.el.tabIndex = 0;
    this.applyThemeAttrs();
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
    this.applyThemeAttrs();
    this.boxLayer = createSvg("g");
    this.boxLayer.setAttribute("class", "mm-boxes");
    this.svg.append(this.boxLayer);
    this.summaryLayer = createSvg("g");
    this.summaryLayer.setAttribute("class", "mm-summaries");
    this.svg.append(this.summaryLayer);
    this.calloutLayer = createSvg("g");
    this.calloutLayer.setAttribute("class", "mm-callout-tails");
    this.svg.append(this.calloutLayer);
    this.calloutsHidden = opts.calloutsHidden?.() ?? false;
    this.noteLayer = createSvg("g");
    this.noteLayer.setAttribute("class", "mm-note-links");
    this.svg.append(this.noteLayer);
    this.relLayer = createSvg("g");
    this.relLayer.setAttribute("class", "mm-rels");
    this.svg.append(this.relLayer);
    this.notesExpanded = opts.notesExpanded?.() ?? false;
    this.nodesEl = createDiv();
    this.nodesEl.className = "mm-nodes";
    this.overlay = createDiv();
    this.overlay.className = "mm-overlay";
    this.viewport.append(this.svg, this.nodesEl, this.overlay);
    this.el.append(this.viewport);
    this.buildToolbar();
    this.setToolbarHidden(!!opts.toolbarHidden?.());
    this.bindEvents();
    // 临时浮出的标注：点到别处就收起（捕获阶段，别的处理拦下事件也照样收）
    this.el.addEventListener(
      "pointerdown",
      (ev) => {
        if (!this.peekCallout || this.editingCallout) return;
        if ((ev.target as HTMLElement).closest?.(".mm-callout, .mm-callout-icon")) return;
        this.peekCallout = null;
        if (this.doc && this.els.size) this.reflow();
      },
      true,
    );

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => {
        // 刚点了节点里的链接、在旁边分屏打开了笔记：脑图变窄，点的那个节点别被挤到看不见的地方（B站 13579abc_）
        const kept = this.linkNode && performance.now() < this.linkNode.until ? this.nodeById.get(this.linkNode.id) : null;
        if (kept) this.el.win.requestAnimationFrame(() => this.revealLinkNode(kept));
        // 恢复的视口：按现在的大小把原来的中心放回中间（下面的重画会直接返回，所以放在前面）
        if (this.viewAnchor) {
          this.applyViewAnchor();
          this.applyTransform();
        }
        if (this.needsRender) {
          this.render();
          return;
        }
        if (!this.hasView && this.initialFit()) {
          this.hasView = true;
          this.refitSize = `${this.el.clientWidth}x${this.el.clientHeight}`;
        } else this.autoRefitIfNeeded();
        // 从看不见变成看得见（后台标签页切过来、侧栏展开）：藏着的时候量的尺寸可能不准
        const visible = this.el.clientWidth > 0 && this.el.clientHeight > 0;
        if (visible && !this.wasVisible) this.scheduleSizeCheck();
        this.wasVisible = visible;
        this.updateBottomInset();
        this.positionNodebar();
        this.scheduleMinimap();
      });
      this.ro.observe(this.el);
      this.noteRo = new ResizeObserver(() => this.scheduleReflow());
    }
    // 字体加载完：节点文字的宽度会变
    const fonts = this.el.ownerDocument.fonts;
    if (fonts) {
      const onFonts = () => this.scheduleSizeCheck();
      fonts.addEventListener("loadingdone", onFonts);
      this.sizeCheckCleanup = () => fonts.removeEventListener("loadingdone", onFonts);
    }
  }

  // ---------- 公共 API ----------

  setDoc(doc: MindDoc): void {
    this.flush();
    const paths = [...this.selected].map(pathOf);
    const primaryPath = this.primary ? pathOf(this.primary) : null;
    const focusPath = this.focusRoot ? pathOf(this.focusRoot) : null;
    this.doc = doc;
    this.resolveNoteCards();
    this.focusRoot = focusPath !== null ? findByPath(doc.root, focusPath) : null;
    if (this.focusRoot === doc.root) this.focusRoot = null;
    this.editing = null;
    this.selected = new Set(paths.map((p) => findByPath(doc.root, p)).filter((n): n is MindNode => !!n));
    this.primary = primaryPath !== null ? findByPath(doc.root, primaryPath) : null;
    if (this.primary && !this.selected.has(this.primary)) this.primary = null;
    this.render();
    if (this.search) this.runSearch(this.search.input.value, false);
    // 第一次打开：重启时可能在样式、字体还没就绪时就排了版，过一会儿核对一下尺寸
    if (!this.sizeCheckedOnce) {
      this.sizeCheckedOnce = true;
      this.scheduleSizeCheck();
    }
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

  /** 根元素上的主题属性：data-theme 用内置主题（自定义主题取它的基础），自定义的另挂 data-custom */
  private applyThemeAttrs(): void {
    const id = this.opts.theme;
    this.el.dataset.theme = baseThemeOf(id);
    if (isThemeName(id)) delete this.el.dataset.custom;
    else this.el.dataset.custom = id;
    const th = resolveTheme(id);
    this.el.dataset.branchColors = th.branchColors ? "true" : "false";
    this.svg?.classList.toggle("is-dashed", this.opts.edge?.dashed ?? !!th.dashed);
  }

  getTheme(): ThemeId {
    return this.opts.theme;
  }

  setTheme(theme: ThemeId): void {
    this.opts.theme = theme;
    this.applyThemeAttrs();
    if (this.themeButton) this.tip(this.themeButton, this.themeTipText(), "toolbar");
    this.render();
  }

  setEdge(edge: EdgeOptions): void {
    this.opts.edge = { ...edge };
    this.svg.classList.toggle("is-dashed", edge.dashed ?? !!resolveTheme(this.opts.theme).dashed);
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
    const th = resolveTheme(this.opts.theme);
    const dashed = cur.dashed ?? !!th.dashed;
    const sharp = cur.sharp ?? !!th.sharp;
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
        { label: t("edge.dashed"), active: dashed, run: () => pick({ ...cur, dashed: !dashed }) },
        { label: t("edge.rounded"), active: !sharp, run: () => pick({ ...cur, sharp: !sharp }) },
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
      themeIds().map((id) => ({
        label: themeLabel(id),
        active: id === this.opts.theme,
        run: () => {
          this.setTheme(id);
          this.opts.onThemeChange?.(id);
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

  /**
   * 导出图片 / PDF 时节点里的表格完整展开（小红书反馈：大表格导出只有节点里看得到的那一块，还带着滚动条和淡出）：
   * 去掉表格的最大宽高、不滚动不淡出，重新量一遍排版，导出完再还原。画布上平时的样子不变
   */
  async withFullTables<T>(fn: () => Promise<T>): Promise<T> {
    const scrolls = [...this.nodesEl.querySelectorAll<HTMLElement>(".mm-node-table .ggt-scroll")];
    const clipped = scrolls.some((s) => s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1);
    if (!clipped || !this.doc) return fn();
    for (const s of scrolls) {
      s.scrollLeft = 0;
      s.scrollTop = 0;
    }
    // 滚回顶上后吸顶的表头要先归位（滚动事件里挪的），等一帧
    await new Promise<void>((r) => this.el.win.requestAnimationFrame(() => r()));
    this.el.classList.add("is-export-full");
    this.reflow();
    try {
      return await fn();
    } finally {
      this.el.classList.remove("is-export-full");
      if (this.doc) this.reflow();
    }
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
    if (this.els.has(node.id)) {
      this.select(node);
      this.quietSelect();
    } else this.pendingSelectPath = path;
  }

  /**
   * 选中路径对应的节点并移到画布中间（从 Markdown 切回来时用）。节点藏在折叠里就退到
   * 最近的可见祖先，不去改折叠状态（那会改文件）。还没渲染就等首次渲染再做
   */
  revealPath(path: string, steady = false): void {
    if (!this.doc) {
      this.pendingReveal = path;
      this.pendingSteady = steady;
      return;
    }
    let node = findByPath(this.doc.root, path);
    if (!node) return;
    for (let a = node.parent; a; a = a.parent) if (a.folded) node = a;
    const p = this.layout?.placed.get(node.id);
    if (!p) {
      this.pendingReveal = path;
      this.pendingSteady = steady;
      return;
    }
    this.select(node);
    this.quietSelect();
    // 同一个标签页在 Markdown 和脑图之间来回切（群里反馈：切两次焦点就丢了）：节点就在眼前时视口一点不动，
    // 看不到才把它移过来，缩放也不改
    if (steady && this.hasView) {
      if (!this.rectInView(p)) this.showBranch(node);
      return;
    }
    // 适应画布后整张大图可能缩得很小，跳过来的节点要看得清
    if (this.k < 0.8) this.k = 1;
    this.showBranch(node);
    this.hasView = true;
  }

  /** node 和它展开着的子孙（含概要主题）在画布上占的范围 */
  private branchBox(node: MindNode): { x: number; y: number; w: number; h: number } | null {
    const placed = this.layout?.placed;
    const p0 = placed?.get(node.id);
    if (!placed || !p0) return null;
    let x1 = p0.x;
    let y1 = p0.y;
    let x2 = p0.x + p0.w;
    let y2 = p0.y + p0.h;
    const visit = (n: MindNode) => {
      for (const c of [...visibleChildren(n), ...visibleTopics(n)]) {
        const p = placed.get(c.id);
        if (p) {
          x1 = Math.min(x1, p.x);
          y1 = Math.min(y1, p.y);
          x2 = Math.max(x2, p.x + p.w);
          y2 = Math.max(y2, p.y + p.h);
        }
        visit(c);
      }
    };
    visit(node);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /**
   * 跳到某个节点（点链接、PDF 跳回来、从 Markdown 切过来）时摆画面：节点连同它展开的分支一起看。
   * 分支放得下就整个居中；放不下就把节点贴在分支生长方向的反面（往右长贴左边、往左长贴右边、往下长贴上边），
   * 另一个方向不偏的就让节点居中。以前一律把节点放正中，往右长的图左半边全是空的、右边的内容反而出了画面（群里反馈）
   */
  private showBranch(node: MindNode): void {
    const p = this.layout?.placed.get(node.id);
    const box = this.branchBox(node);
    if (!p || !box) return;
    const k = this.k;
    const m = 56;
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    const axis = (bLo: number, bLen: number, nLo: number, nLen: number, view: number): number => {
      if (bLen * k <= view - 2 * m) return view / 2 - (bLo + bLen / 2) * k;
      const after = bLo + bLen > nLo + nLen + 1 && bLo >= nLo - 1;
      const before = bLo < nLo - 1 && bLo + bLen <= nLo + nLen + 1;
      if (after) return m - nLo * k;
      if (before) return view - m - (nLo + nLen) * k;
      return view / 2 - (nLo + nLen / 2) * k;
    };
    this.stopPanAnim();
    this.tx = axis(box.x, box.w, p.x, p.w, cw);
    this.ty = axis(box.y, box.h, p.y, p.h, ch);
    this.applyTransform();
  }
  private pendingReveal: string | null = null;
  private pendingSteady = false;

  /** 画布坐标里的这块矩形是否整个在可视区里（留一点边） */
  private rectInView(r: { x: number; y: number; w: number; h: number }): boolean {
    const m = 8;
    const x = r.x * this.k + this.tx;
    const y = r.y * this.k + this.ty;
    return x >= m && y >= m && x + r.w * this.k <= this.el.clientWidth - m && y + r.h * this.k <= this.el.clientHeight - m;
  }

  /** 选中的节点，没选中就是离可视区中心最近的节点（切回 Markdown 时定位用） */
  getFocusPath(): string | null {
    if (this.primary) return pathOf(this.primary);
    if (!this.layout) return null;
    const cx = (this.el.clientWidth / 2 - this.tx) / this.k;
    const cy = (this.el.clientHeight / 2 - this.ty) / this.k;
    let best: MindNode | null = null;
    let bd = Infinity;
    for (const p of this.layout.placed.values()) {
      const dx = Math.max(p.x - cx, 0, cx - p.x - p.w);
      const dy = Math.max(p.y - cy, 0, cy - p.y - p.h);
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = p.node;
      }
    }
    return best ? pathOf(best) : null;
  }

  /**
   * 点了指向这张图里某个节点的链接（[[笔记#^abc]]、[[笔记#标题]]）：折叠着的上级展开，
   * 聚焦着别的分支就退出聚焦，然后选中、居中、闪一下。找不到这个节点返回 false
   */
  revealSubpath(subpath: string): boolean {
    const node = this.doc && findSubpathNode(this.doc.root, subpath);
    return !!node && this.revealNode(node);
  }

  /** 按路径找节点再 revealNode（PDF++ 这类按行号跳回来的） */
  revealPathFlash(path: string): boolean {
    const node = this.doc && findByPath(this.doc.root, path);
    return !!node && this.revealNode(node);
  }

  private revealNode(node: MindNode): boolean {
    if (this.focusRoot && node !== this.focusRoot && !isAncestor(this.focusRoot, node)) this.exitFocus(false);
    let unfolded = false;
    for (let p = node.parent; p; p = p.parent) {
      if (p.folded) {
        p.folded = false;
        unfolded = true;
      }
    }
    if (unfolded) {
      this.render();
      if (this.opts.editable) this.notify();
    }
    this.revealPath(pathOf(node));
    this.flashNode(node);
    return true;
  }

  /**
   * 跟随 Markdown 光标：选中节点，看不见时才挪画面。折叠着的：expand 时展开上级（和点链接跳过来一样，
   * 展开会写进笔记），否则选最近的可见祖先
   */
  followPath(path: string, expand = false): void {
    if (!this.doc || this.editing || this.editingCallout) return;
    let node = findByPath(this.doc.root, path);
    if (!node) return;
    if (expand && this.opts.editable) {
      let unfolded = false;
      for (let a = node.parent; a; a = a.parent) {
        if (a.folded) {
          a.folded = false;
          unfolded = true;
        }
      }
      if (unfolded) {
        this.render();
        this.notify();
      }
    }
    for (let a = node.parent; a; a = a.parent) if (a.folded) node = a;
    if (!this.layout?.placed.get(node.id)) return;
    this.select(node);
    this.quietSelect();
    this.ensureVisible(node);
    this.flashNode(node);
  }

  /** 联动跳过来的节点外面闪一圈，看得出是哪个；只是动画，不改 class，重画节点也不留痕迹 */
  private flashNode(node: MindNode): void {
    const el = this.els.get(node.id);
    if (!el?.animate) return;
    const color = el.win.getComputedStyle(el).getPropertyValue("--mm-selection").trim() || "#155dff";
    el.animate([{ boxShadow: `0 0 0 6px ${color}` }, { boxShadow: `0 0 0 2px ${color}`, offset: 0.6 }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1200, easing: "ease-out" });
  }

  /** 节点 DOM 全部重建（内容签名没变也重建），用在标记定义这类影响渲染、但不在签名里的设置变了之后 */
  redrawAll(): void {
    this.elSigs = new WeakMap();
    this.elContent = new WeakMap();
    this.render();
  }

  /** 设置里改了工具栏的按钮：主工具栏重建，浮动工具栏下次显示时按新的清单建 */
  refreshNodebar(): void {
    this.nodebar?.remove();
    this.nodebar = null;
    this.positionNodebar();
  }

  refreshBars(): void {
    this.toolbar?.remove();
    this.toolbarHandle?.remove();
    this.toolbarHandle = null;
    this.positionMenu?.remove();
    this.positionMenu = null;
    this.buildToolbar();
    this.nodebar?.remove();
    this.nodebar = null;
    this.render();
    // 格式栏的开关也可能刚变（命令「切换格式栏」）：编辑中按新的设置收起或浮出来
    this.formatBar?.remove();
    this.formatBar = null;
    this.updateFormatBar();
  }

  getViewState(): ViewState {
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    return cw && ch ? { tx: this.tx, ty: this.ty, k: this.k, cw, ch } : { tx: this.tx, ty: this.ty, k: this.k };
  }

  /** 恢复视口；之后首次渲染不再自动适应画布 */
  setViewState(state: ViewState, auto = false): void {
    // 坏掉的视口（空值、文字、无穷大）不用，免得之后的平移缩放全算错
    if (![state.tx, state.ty, state.k].every((v) => typeof v === "number" && Number.isFinite(v)) || state.k <= 0) return;
    // auto：编辑写回后接着显示的自动视口，不算用户调过，但先别重新适应
    if (auto) this.viewFrozen = true;
    else this.userView = true;
    this.tx = state.tx;
    this.ty = state.ty;
    this.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.k));
    this.hasView = true;
    this.viewAnchor =
      state.cw && state.ch && Number.isFinite(state.cw) && Number.isFinite(state.ch) ? { cx: (state.cw / 2 - this.tx) / this.k, cy: (state.ch / 2 - this.ty) / this.k, tx: this.tx, ty: this.ty } : null;
    this.applyViewAnchor();
    this.applyTransform();
  }

  /**
   * 视口是在别的大小的窗格里记下的（宽窗格里记的，拿到侧边栏里恢复），或者画布大小还在变：
   * 让原来在画面中间的内容还在中间。大小没量出来（侧边栏正在展开）就等 ResizeObserver 再来
   */
  private applyViewAnchor(): void {
    const a = this.viewAnchor;
    if (!a) return;
    if (this.tx !== a.tx || this.ty !== a.ty) {
      this.viewAnchor = null;
      return;
    }
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    if (!cw || !ch) return;
    a.tx = this.tx = cw / 2 - a.cx * this.k;
    a.ty = this.ty = ch / 2 - a.cy * this.k;
  }

  isEditable(): boolean {
    return this.opts.editable;
  }

  setToolbarPosition(pos: ToolbarPosition): void {
    this.toolbarPos = pos;
    this.el.dataset.toolbar = pos;
    if (this.toolbar) this.toolbar.dataset.pos = pos;
    this.updateToolbarHideIcons();
    // 弹出方向变了，工具栏上的提示要重新应用
    for (const el of this.toolbarTips) this.applyTip(el);
  }

  private structureTipText(): string {
    const label = STRUCTURES.find((s) => s.id === this.opts.structure)?.label ?? this.opts.structure;
    return t("canvas.structureTip", { name: label });
  }

  private locked = false;
  private lockButton: HTMLElement | null = null;

  isLocked(): boolean {
    return this.locked;
  }

  /** 锁定编辑：只改能不能编辑，不改文件；锁着的时候折叠也只是看，不写回 */
  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.setEditable(!locked);
    this.el.classList.toggle("is-locked", locked);
    this.updateLockButton();
  }

  private splitSyncButton: HTMLElement | null = null;

  /** 同一篇的 Markdown 有没有显示着：有才显示分屏联动按钮 */
  setSplitSyncAvailable(available: boolean): void {
    this.splitSyncButton?.classList.toggle("is-hidden", !available);
    this.updateSplitSyncButton();
  }

  /** 按设置刷新分屏联动按钮：开着是高亮的分屏图标，关着加一道斜线 */
  updateSplitSyncButton(): void {
    const b = this.splitSyncButton;
    const sync = this.opts.splitSync;
    if (!b || !sync) return;
    const on = sync.on();
    const tool = on ? "splitSync" : "splitSyncOff";
    // 状态没变就不换图标：点按钮时脑图这边被激活、会来刷新一次，按下时点中的图标被换掉，浏览器就不发 click 了
    if (b.dataset.tool === tool && b.firstChild) return;
    b.dataset.tool = tool;
    b.replaceChildren(icon(tool));
    b.classList.toggle("is-active", on);
    this.tip(b, on ? t("canvas.splitSyncOn") : t("canvas.splitSyncOff"), "toolbar");
  }

  private updateLockButton(): void {
    const b = this.lockButton;
    if (!b) return;
    b.dataset.tool = this.locked ? "lock" : "unlock";
    b.replaceChildren(icon(this.locked ? "lock" : "unlock"));
    b.classList.toggle("is-active", this.locked);
    this.tip(b, this.locked ? t("canvas.unlockEditing") : t("canvas.lockEditing"), "toolbar");
  }

  setEditable(editable: boolean): void {
    if (this.opts.editable === editable) return;
    if (!editable) this.flush();
    this.opts.editable = editable;
    this.el.classList.toggle("is-editable", editable);
    this.structureButton?.classList.toggle("is-hidden", !editable);
    this.themeButton?.classList.toggle("is-hidden", !editable);
    this.edgeButton?.classList.toggle("is-hidden", !editable);
    if (this.editToggle) {
      this.editToggle.replaceChildren(icon(editable ? "check" : "pencil"));
      this.tip(this.editToggle, editable ? t("canvas.doneEditing") : t("canvas.editEmbedded"), "toolbar");
      this.editToggle.classList.toggle("is-active", editable);
    }
    if (!editable) this.select(null);
    // 节点里的表格跟着切只读 / 可编辑（重建编辑器）
    if (this.doc && this.tableEds.size) {
      this.render();
      this.reflow();
    }
    this.positionNodebar();
    this.opts.onEditableChange?.(editable);
  }

  /**
   * 把进行中的编辑（标签、备注）同步到树上并通知，但不关闭编辑界面。
   * 视图自动保存前调用，保证写盘内容包含正在输入的文字。
   */
  /** 画布上正在改文字或备注：这时外面来的内容先不要覆盖 */
  isBusy(): boolean {
    return !!this.editing || !!this.popoverApply || [...this.tableEds.values()].some((e) => e.ed.isEditing());
  }

  syncPending(): boolean {
    let changed = false;
    if (this.editing && this.nodeEditor) {
      const text = this.fromEdit(this.nodeEditor.savedText);
      if (text && text !== this.editing.text) {
        this.editing.text = text;
        changed = true;
      }
    }
    if (this.popoverApply && this.popoverApply()) changed = true;
    // 节点表格里正在输入的格子也算上（不结束编辑；稍后提交时写回的是同样的内容）
    for (const e of this.tableEds.values()) {
      const draft = e.ed.draft();
      if (!draft) continue;
      const note = withTable(e.node.note, draft, e.node.kind === "list");
      if (note !== e.node.note) {
        e.node.note = note;
        changed = true;
      }
    }
    if (changed) this.notify();
    return changed;
  }

  /** 结束所有进行中的编辑并落到树上；视图卸载或换文档前调用 */
  flush(): void {
    if (this.editing) this.commitEdit(false, false);
    if (this.popover) this.closePopover();
    for (const e of [...this.tableEds.values()]) e.ed.flush();
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  destroy(): void {
    if (this.present) this.endPresent();
    if (this.minimapFrame) this.el.win.cancelAnimationFrame(this.minimapFrame);
    if (this.mapReview) this.endMapReview();
    if (this.zen) this.setZen(false);
    liveCanvases.delete(this);
    this.sizeCheckCleanup?.();
    for (const t of this.sizeCheckTimers) window.clearTimeout(t);
    this.nodeEditor?.destroy();
    this.ro?.disconnect();
    this.noteRo?.disconnect();
    for (const id of [...this.tableEds.keys()]) this.dropTable(id);
    for (const t of this.noteTableEds) t.ed.destroy();
    this.noteTableEds.clear();
    for (const p of this.mapPreviews.values()) p.dispose();
    this.mapPreviews.clear();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    if (this.reflowTimer !== null) window.clearTimeout(this.reflowTimer);
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.cancelTapCenter();
    this.stopPanAnim();
    if (this.touchPress) window.clearTimeout(this.touchPress.timer);
    for (const d of this.disposers) d();
    this.el.replaceChildren();
    this.el.classList.remove("gg-mm-root");
    this.crumbs = null;
    this.structureMenu = null;
    this.themeMenu = null;
    this.themeButton = null;
    this.edgeMenu = null;
    this.edgeButton = null;
    this.lightbox?.remove();
    this.lightbox = null;
    this.markerPicker = null;
    this.markerPickerCleanup = null;
    this.edgePaths = [];
    for (const c of [...this.outsideCleanups]) c();
    this.toolbarTips = [];
  }

  /** 返回是否真的适应了：容器还没量出尺寸时会失败，调用方得再试一次 */
  /** 第一次显示时的视口：按设置适应画布或回到中心；容器还没尺寸时返回 false，等下次再来 */
  private initialFit(): boolean {
    if (this.refitOnly || this.opts.initialView?.() !== "center") {
      const ok = this.fit();
      if (ok) this.refitOnly = false;
      return ok;
    }
    if (!this.el.clientWidth || !this.el.clientHeight) return false;
    this.center();
    return true;
  }

  fit(): boolean {
    if (!this.layout) return false;
    return this.fitBounds(this.layout.bounds);
  }

  /** maxK：整图适应时最大 100%，缩放到分支时允许放大 */
  private fitBounds(bounds: Bounds, maxK = 1): boolean {
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    if (!cw || !ch) return false;
    // 工具栏那一边留出它占的地方，不然最靠边的节点会被盖住（预览框矮的时候最明显）
    const bar = this.toolbarInsets();
    const pad = (inset: number) => (inset ? Math.max(FIT_PADDING, inset + 12) : FIT_PADDING);
    const [top, right, bottom, left] = [pad(bar.top), pad(bar.right), pad(bar.bottom), pad(bar.left)];
    let k = Math.min(maxK, (cw - left - right) / bounds.w, (ch - top - bottom) / bounds.h);
    if (k > 0.96 && k < 1.04) k = 1;
    this.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
    this.tx = (left + cw - right) / 2 - (bounds.x + bounds.w / 2) * this.k;
    this.ty = (top + ch - bottom) / 2 - (bounds.y + bounds.h / 2) * this.k;
    this.applyTransform();
    return true;
  }

  /**
   * 工具栏从画布各边往里占了多少像素（没显示、嵌入时设成自动隐藏的都算 0）。
   * 适应画布时让开这一块；嵌入的预览框算高度时也要加上
   */
  toolbarInsets(): { top: number; right: number; bottom: number; left: number } {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    const bar = this.toolbar;
    if (!bar?.isConnected) return none;
    if (this.opts.embedded && this.el.doc.body.hasClass("gg-mm-embed-toolbar-autohide")) return none;
    const b = bar.getBoundingClientRect();
    if (!b.width || !b.height) return none;
    const e = this.el.getBoundingClientRect();
    const clip = (v: number) => Math.max(0, Math.round(v));
    switch (bar.dataset.pos as ToolbarPosition) {
      case "top":
        return { ...none, top: clip(b.bottom - e.top) };
      case "left":
        return { ...none, left: clip(b.right - e.left) };
      case "right":
        return { ...none, right: clip(e.right - b.left) };
      default:
        return { ...none, bottom: clip(e.bottom - b.top) };
    }
  }

  /** 根节点居中，缩放归 100% */
  center(): void {
    this.k = 1;
    this.tx = this.el.clientWidth / 2;
    this.ty = this.el.clientHeight / 2;
    this.applyTransform();
  }

  /** 用户手动拖过、缩放过、点过居中：嵌入的图不再自动适应（见 autoRefit） */
  private userView = false;
  /** 编辑写回后恢复的视口：图在改，别跟着框的高度一直重新适应，画面会跳 */
  private viewFrozen = false;
  private refitSize = "";

  hasUserView(): boolean {
    return this.userView;
  }

  private userZoomBy(factor: number, sx?: number, sy?: number): void {
    this.userView = true;
    this.zoomBy(factor, sx, sy);
  }

  /** 点「适应画布」：嵌入的图回到自动适应 */
  private userFit(): void {
    this.userView = false;
    this.viewFrozen = false;
    this.fit();
    this.refitSize = `${this.el.clientWidth}x${this.el.clientHeight}`;
  }

  private userCenter(): void {
    this.userView = true;
    this.center();
  }

  /** 框的大小变了：嵌入的图还是自动适应的状态就重新适应 */
  private autoRefitIfNeeded(): void {
    if (!this.opts.autoRefit || !this.hasView || this.userView || this.viewFrozen || !this.layout) return;
    const size = `${this.el.clientWidth}x${this.el.clientHeight}`;
    if (size === this.refitSize || !this.el.clientWidth || !this.el.clientHeight) return;
    this.refitSize = size;
    this.fit();
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
    this.updateCalloutButton();
    this.updateNotesButton();
    this.updateHiddenButton();
    this.applyReviewDots();
    // 背诵模式的「单选 / 多选」标签会改变节点宽度，得在测量之前挂上
    if (this.recite) this.applyRecite();
    this.reflow();
    // 演示中图变了（别处改了文本）：按新图认回讲到的节点，重新上色；镜头直接到位
    if (this.present) this.applyPresent(false);
    // 代码块嵌入首次渲染时容器高度还是 0（真正的高度要等 onLayout 下一帧才写上去），
    // 这时 fit 量不出东西。失败就别置 hasView，等 ResizeObserver 拿到高度再适应一次。
    if (!this.hasView && this.initialFit()) this.hasView = true;
    if (this.pendingSelectPath !== null) {
      const path = this.pendingSelectPath;
      this.pendingSelectPath = null;
      this.selectPath(path);
    }
    if (this.pendingReveal !== null && this.layout) {
      const path = this.pendingReveal;
      this.pendingReveal = null;
      this.revealPath(path, this.pendingSteady);
    }
    this.updateBottomInset();
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
    // 概要主题跟着起始节点（编辑挪动之后对上 parent、深度、写法）
    fixTopics(doc.root);
    const theme = resolveTheme(this.opts.theme);
    const branchOf = new Map<string, number>();
    doc.root.children.forEach((c, i) => walkMap(c, (n) => branchOf.set(n.id, i % BRANCH_COLOR_COUNT)));
    // 主主题这一层的概要主题：跟着它括住的第一个主主题配色
    for (const t of topicsOf(doc.root)) {
      const b = t.topicOf && branchOf.get(t.topicOf.id);
      if (b !== undefined) walkMap(t, (n) => branchOf.set(n.id, b));
    }
    const base = this.focusRoot ?? doc.root;
    const prev = this.els;
    const next = new Map<string, HTMLElement>();

    this.nodeById.clear();
    // 在复习范围里：整张图加入了，或者在加入的分支下面
    const deck = !!this.doc && !!deckIdOf(this.doc.frontmatter);
    const branched = deck && !!this.doc && !!reviewBranches(this.doc);
    const inReview = (n: MindNode): boolean => {
      if (!deck) return false;
      if (!branched) return true;
      for (let p: MindNode | null = n; p; p = p.parent) if (p.review) return true;
      return false;
    };
    const visit = (node: MindNode) => {
      this.nodeById.set(node.id, node);
      // 事件里用的节点按编号现查：重新解析后没变的节点沿用编号、DOM 留着，事件绑定时的 node 已经不在树里了
      const live = (): MindNode => this.nodeById.get(node.id) ?? node;
      const rel = node.depth - base.depth;
      const branch = theme.branchColors ? branchOf.get(node.id) : undefined;
      // 内容签名管子节点，整体签名再叠上纯表现的部分（选中、配色、层级）；
      // 只有前者变了才重建 DOM，选一下节点不该把里面的 iframe 打回重载
      const nt = node.table ? noteTable(node.note) : null;
      const tableSig = nt ? `T${this.opts.editable && !this.recite ? "e" : ""}` : "";
      const num = numberLabel(node);
      // 背诵模式下带 [x] / [ ] 子节点的是选择题：显示「2/4」等于把正确选项有几个说出来了，不显示
      // 加入了间隔复习的选择题：[x] 是答案不是待办，也不显示
      const progMode = this.recite ? "off" : this.opts.taskProgress?.() ?? "off";
      const prog = progMode === "off" || inReview(node) ? null : taskProgress(node);
      const progText = prog ? progressLabel(prog, progMode) : "";
      const progBelow = !!prog && this.opts.taskProgressPos?.() === "below";
      const contentSig = [node.text, num ?? "", progText + (progBelow ? "\u0002" : ""), this.noteShown(node) ? "n" : "", tableSig, node.folded ? "f" : "", node.children.length, this.opts.theme, node.callout && this.calloutsHidden ? "c" : "", node.hidden ? "h" : ""].join("\u0001");
      const sig = [
        contentSig,
        node.color ?? "",
        node.width ?? "",
        isUnderlineAt(theme, rel) ? "u" : "",
        rel,
        branch ?? "",
        this.selected.has(node) ? "s" : "",
        this.search?.matches.has(node) ? (this.search.list[this.search.index] === node ? "M" : "m") : "",
      ].join("\u0001");
      const reused = prev.get(node.id);
      if (reused && this.elSigs.get(reused) === sig) {
        next.set(node.id, reused);
        // 外观没变也要把当前的表交给节点里的表格（Markdown 里改了格子、或者节点对象重新解析换了）
        if (nt) this.syncTable(node, nt.table);
        for (const c of visibleChildren(node)) visit(c);
        for (const t of visibleTopics(node)) visit(t);
        return;
      }
      const el = reused ?? createDiv();
      const keepChildren = !!reused && this.elContent.get(reused) === contentSig;
      if (reused) {
        if (!keepChildren) {
          this.dropTable(node.id);
          el.replaceChildren();
        }
        el.removeAttribute("style");
        el.removeAttribute("data-color");
        el.removeAttribute("data-branch");
        // 位置在 reflow 里重写，先清掉缓存免得被当成没变
        this.lastPos.delete(el);
      }
      this.elSigs.set(el, sig);
      this.elContent.set(el, contentSig);
      el.className = "gg-mm-node";
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
      // 按层级着色（设置里）：节点背景混一点这一层的颜色，自己设过颜色的节点不动
      const level = node.color ? null : (nodeDecor.levelColor?.(node.depth) ?? null);
      if (level) {
        el.style.setProperty("--mm-level", level);
        el.classList.add("has-level-color");
      }
      // PDF++ 标注颜色的外框（设置里）：自己设过颜色的节点不动
      const pdf = node.color ? null : (nodeDecor.pdfBorder?.(node.text) ?? null);
      if (pdf) {
        el.style.setProperty("--mm-pdf-border", pdf);
        el.classList.add("has-pdf-border");
      }
      if (node.width) {
        el.classList.add("has-width");
        el.style.width = `${node.width}px`;
      }
      // 「显示隐藏的节点」开着时才会在树里遇到：半透明、虚线框，一眼看出它在脑图里是藏着的
      if (node.hidden) el.classList.add("is-hidden-node");
      if (isUnderlineAt(theme, rel) && !node.color) {
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
        const usedPreviews = new Set<string>();
        renderInline(label, node.text || (node.depth === 0 ? t("canvas.centralTopic") : ""), {
          onLink: (href, internal, ev) => {
            this.keepLinkNode(node);
            this.opts.host?.openLink?.(href, internal, ev);
          },
          onHover: (href, ev, a) => this.opts.host?.hoverLink?.(ev, href, a),
          renderMath: this.opts.host?.renderMath,
          resolveImage: this.opts.host?.resolveImage,
          renderPdfCrop: this.opts.host?.renderPdfCrop,
          onImageLoad: () => this.scheduleReflow(),
          onTag: (tag) => this.opts.host?.openTag?.(tag),
          onTaskToggle: () => {
            // 背诵模式下勾选框是题目的答案，点了不能改
            if (!this.opts.editable || this.recite) return;
            const n = live();
            n.text = toggleTask(n.text);
            this.render();
            this.notify();
          },
          reuseFrame: (src) => {
            const f = this.frames.get(node.id);
            return f && f.src === src ? f : null;
          },
          mapPreview: (link, param) => this.mapPreviewFor(node, link, param, usedPreviews),
        });
        this.dropMapPreviews(node.id, usedPreviews);
        // 嵌入的脑图预览里也可能有视频：只认这个节点自己的
        const frame = [...label.querySelectorAll<HTMLIFrameElement | HTMLMediaElement>(".mm-frame")].find((f) => !f.closest(".mm-map-preview")) ?? null;
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
              this.select(live());
              this.positionNodebar();
              this.setLiveFrame(node.id);
            });
          }
        }
        // 编号（这组同级开了编号时）：放在标题前面，不在文字里，编辑时也留着
        if (num) el.append(createSpan({ cls: "mm-num", text: num }));
        el.append(label);
        if (nt) this.mountTable(node, el, nt.table);
      } else if (nt) {
        this.syncTable(node, nt.table);
      }
      if (nt) el.classList.add("has-table");
      // 只放了表格、没有标题的节点：不显示空的标题行（编辑时照常出现）
      if (nt && !node.text.trim()) el.classList.add("no-title");
      if (num) el.classList.add("has-num");
      if (progBelow) el.classList.add("has-progress-below");
      // PDF 截区的图是 PDF++ 之后才异步画进来的：排版这时还没有 <img>，看截区的外框也算图片节点（不然节点最宽 300，拖大了图片伸出框外）
      if (el.querySelector(".mm-label img, .mm-label .mm-pdf-crop, .mm-label .mm-map-preview")) el.classList.add("has-image");
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

      // 任务完成度：挂在文字后面的小胶囊，一段进度条加文字（全做完也是同一个颜色，进度条满了就是做完了）。只是显示，不写进文件
      if (!keepChildren && prog) {
        const chip = createSpan({ cls: "mm-progress" + (prog.done === prog.total ? " is-done" : "") });
        const bar = chip.createSpan({ cls: "mm-progress-bar" });
        bar.createSpan({ cls: "mm-progress-fill" }).style.width = `${(prog.done / prog.total) * 100}%`;
        chip.createSpan({ cls: "mm-progress-text", text: progText });
        chip.setAttr("aria-label", t("canvas.taskProgress", { done: prog.done, total: prog.total }));
        // 放下面：前面插一个占满整行的空元素把它挤到下一行，宽度只有胶囊自己那么宽
        if (progBelow) el.append(createSpan({ cls: "mm-progress-break" }));
        el.append(chip);
      }

      if (!keepChildren && this.noteShown(node)) {
        const n = icon("note");
        n.classList.add("mm-note-icon");
        this.tip(n, t("canvas.viewNote"));
        n.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        n.addEventListener("click", (ev) => {
          ev.stopPropagation();
          // 展开备注时图标管这一条的收起 / 展开；收起时（或卡片按设置没有可显示的）还是弹窗看
          if (this.notesExpanded && this.cardText(live())) this.toggleNoteCard(live());
          else this.toggleNotePopover(live());
        });
        el.append(n);
      }

      // 标注隐藏时节点上留个小图标，点一下临时看这一条
      if (!keepChildren && node.callout && this.calloutsHidden) {
        const c = icon("callout");
        c.classList.add("mm-callout-icon");
        this.tip(c, t("canvas.viewCallout"));
        c.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        c.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const n = live();
          this.peekCallout = this.peekCallout?.id === n.id ? null : n;
          this.reflow();
        });
        el.append(c);
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
          this.toggleFold(live());
        });
        el.append(toggle);
      }

      if (!reused) this.nodesEl.append(el);
      next.set(node.id, el);
      for (const c of visibleChildren(node)) visit(c);
      for (const t of visibleTopics(node)) visit(t);
    };
    visit(base);
    for (const [id, el] of prev) {
      if (next.has(id)) continue;
      this.dropTable(id);
      this.elSigs.delete(el);
      this.lastPos.delete(el);
      this.frames.delete(id);
      this.dropMapPreviews(id);
      el.remove();
    }
    this.els = next;
    this.renderCrumbs();
    this.opts.host?.afterRender?.();
  }

  /**
   * 节点里 `![[另一张脑图]]` 的只读预览框（宿主认得是脑图才有）。大小见 mapSize（`|400`、`|480x300`），选中节点后右下角手柄能拖。
   * 平时预览里的图不接鼠标（点、拖都是外面这个节点的）；双击或点「激活」后能平移、缩放、展开折叠（只影响这个预览，不写回那张图），
   * 点外面或按 Esc 退出。右上角「打开」打开那张脑图
   */
  private mapPreviewFor(node: MindNode, link: string, param: string | undefined, used: Set<string>): HTMLElement | null {
    const host = this.opts.host;
    if (!host?.mapPreview) return null;
    // 同一个节点里嵌了两次同一张图：按出现的次序区分
    let n = 0;
    while (used.has(`${node.id}|${link}|${n}`)) n++;
    const key = `${node.id}|${link}|${n}`;
    const size = mapSize(param);
    const old = this.mapPreviews.get(key);
    if (old) {
      used.add(key);
      // 链接里的大小改了（拖手柄、撤销）：只改框的大小，里面的图不重新加载，大小一变它自己会重新适应
      old.el.setCssProps({ "--mm-map-w": `${size.w}px`, "--mm-map-h": `${size.h}px` });
      return old.el;
    }
    const box = createDiv({ cls: "mm-map-preview" });
    box.setCssProps({ "--mm-map-w": `${size.w}px`, "--mm-map-h": `${size.h}px` });
    box.dataset.link = link;
    box.dataset.key = key;
    const inner = box.createDiv({ cls: "mm-map-preview-body" });
    const mounted = host.mapPreview(link, inner);
    if (!mounted) return null;
    // 激活着时，预览里的鼠标、滚轮、按键都留在预览里，不让外面的画布拿去选中、拖动、平移
    for (const type of ["pointerdown", "wheel", "dblclick", "contextmenu", "click"] as const) {
      inner.addEventListener(type, (ev) => {
        if (this.livePreview === key) ev.stopPropagation();
      });
    }
    box.addEventListener("keydown", (ev) => {
      if (this.livePreview !== key) return;
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.setLivePreview(null);
        this.el.focus({ preventScroll: true });
      }
    });
    const bar = box.createDiv({ cls: "mm-map-preview-bar" });
    const button = (cls: string, text: string, run: (ev: MouseEvent) => void) => {
      const b = bar.createEl("button", { cls, text });
      b.type = "button";
      b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      b.addEventListener("dblclick", (ev) => ev.stopPropagation());
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        run(ev);
      });
      return b;
    };
    button("mm-map-preview-live", t("canvas.activateMap"), () => {
      if (this.livePreview === key) mounted.fit();
      else this.setLivePreview(key);
    });
    button("mm-map-preview-open", t("canvas.openMap"), (ev) => host.openLink?.(link, true, ev));
    this.mapPreviews.set(key, { el: box, dispose: mounted.dispose, fit: mounted.fit });
    used.add(key);
    return box;
  }

  /** 激活 / 退出节点里的脑图预览：只改 class，不重画（重画会把预览摘下来） */
  private setLivePreview(key: string | null): void {
    if (this.livePreview === key) return;
    const prev = this.livePreview ? this.mapPreviews.get(this.livePreview) : null;
    if (prev) {
      prev.el.classList.remove("is-live");
      const b = prev.el.querySelector(".mm-map-preview-live");
      if (b) b.textContent = t("canvas.activateMap");
    }
    this.livePreview = key;
    const cur = key ? this.mapPreviews.get(key) : null;
    if (!cur) {
      this.livePreview = null;
      return;
    }
    cur.el.classList.add("is-live");
    const b = cur.el.querySelector(".mm-map-preview-live");
    if (b) b.textContent = t("canvas.fitMap");
  }

  /** 节点重画完：这次没用到的预览卸掉（链接改了、删了）；不给 keep 就是这个节点的全卸掉 */
  private dropMapPreviews(nodeId: string, keep?: Set<string>): void {
    for (const [key, p] of this.mapPreviews) {
      if (!key.startsWith(`${nodeId}|`) || keep?.has(key)) continue;
      if (this.livePreview === key) this.livePreview = null;
      p.dispose();
      p.el.remove();
      this.mapPreviews.delete(key);
    }
  }

  private reflowTimer: number | null = null;
  /** 图片陆续加载完时合并成一次重排 */
  /**
   * 保护：重启 Obsidian 时脑图可能在插件样式或字体还没就绪时就排了版，量出来的节点偏小，节点叠在一起，
   * 之后又没有东西触发重排。在容易出这种事的时候（第一次打开、从看不见变成看得见、字体加载完）
   * 过一会儿核对节点现在的实际尺寸和排版用的尺寸，不一致就重排。只读尺寸；一轮最多重排 3 次
   */
  private sizeCheckCleanup: (() => void) | null = null;
  private sizeCheckTimers: number[] = [];
  private sizeCheckedOnce = false;
  private wasVisible = false;
  private sizeFixes = 0;
  private scheduleSizeCheck(): void {
    for (const t of this.sizeCheckTimers) window.clearTimeout(t);
    this.sizeFixes = 0;
    this.sizeCheckTimers = [50, 300, 1000, 2500].map((ms) => window.setTimeout(() => this.checkSizes(), ms));
  }

  private checkSizes(): void {
    if (!this.doc || !this.els.size || this.editing || this.sizeFixes >= 3) return;
    // 藏着（后台标签页、折叠的侧栏）：量不出来，等变成看得见时再核对
    if (!this.el.isConnected || this.el.clientWidth === 0) return;
    for (const [id, el] of this.els) {
      if (el.offsetParent === null) continue;
      const used = this.sizes.get(id);
      if (!used) continue;
      if (Math.abs(el.offsetWidth - used.w) > 1 || Math.abs(el.offsetHeight - used.h) > 1) {
        this.sizeFixes++;
        this.reflow();
        return;
      }
    }
  }

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
   * 自定义主题的「同层对齐」：同一层（相对当前根的深度）里，没手动拖过宽度、不是图片节点的，
   * 统一成这一层最宽那个的自然宽度。只会变宽、不会变窄，所以换行不变，高度直接沿用
   */
  private alignWidths(base: MindNode): void {
    const tiers = alignedTiers(this.opts.theme);
    if (!tiers) return;
    const byDepth = new Map<number, { el: HTMLElement; id: string }[]>();
    walkMap(base, (n) => {
      const el = this.els.get(n.id);
      if (!el || el.classList.contains("has-width") || el.classList.contains("has-image")) return;
      const rel = n.depth - base.depth;
      if (!tiers[tierOf(rel)]) return;
      const list = byDepth.get(rel) ?? [];
      list.push({ el, id: n.id });
      byDepth.set(rel, list);
    });
    for (const list of byDepth.values()) {
      const max = Math.max(...list.map((x) => this.naturalSizes.get(x.id)?.w ?? 0));
      for (const { el, id } of list) {
        const size = this.naturalSizes.get(id);
        if (!size) continue;
        if (size.w < max) {
          el.setCssStyles({ width: `${max}px` });
          this.alignedEls.add(el);
          this.sizes.set(id, { w: max, h: size.h });
        } else if (this.alignedEls.delete(el)) {
          el.setCssStyles({ width: "" });
        }
      }
    }
  }

  /**
   * 测量 → 布局 → 定位 → 画线。编辑中输入文字时也会调用，所以不重建 DOM。
   * remeasure 传入某个节点时只重新测量它：打字只改变这一个节点的尺寸，
   * 读全部 3000 个节点的 offsetWidth 会触发整页强制布局（约 30ms）。
   */
  private reflow(remeasure?: MindNode): void {
    // 排完版（这一帧之后）重画缩略图
    this.scheduleMinimap();
    const doc = this.doc!;
    const theme = resolveTheme(this.opts.theme);
    const base = this.focusRoot ?? doc.root;
    // 量的是自然宽度：先把上一轮对齐写上去的宽度撤掉（先统一写、再统一读，免得一来一回反复强制布局）
    if (remeasure && this.naturalSizes.size === this.els.size) {
      const el = this.els.get(remeasure.id);
      if (el) {
        if (this.alignedEls.delete(el)) el.setCssStyles({ width: "" });
        this.naturalSizes.set(remeasure.id, { w: el.offsetWidth, h: el.offsetHeight });
      }
    } else {
      for (const el of this.alignedEls) el.setCssStyles({ width: "" });
      this.alignedEls.clear();
      this.naturalSizes.clear();
      for (const [id, el] of this.els) this.naturalSizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    }
    this.sizes = new Map(this.naturalSizes);
    this.alignWidths(base);
    const raw: LayoutOptions = { ...DEFAULT_LAYOUT, ...theme.layout, structure: this.baseStructure() };
    const sp = (v: number) => Math.round(v * spacingScale);
    const layoutOpts: LayoutOptions = { ...raw, gapRoot: sp(raw.gapRoot), gapLevel: sp(raw.gapLevel), gapSibling: sp(raw.gapSibling), gapMain: sp(raw.gapMain) };
    this.syncSummaryLabels(base);
    this.syncCallouts(base);
    this.syncNotes(base);
    this.layout = layoutMap(
      base,
      (n) => this.sizes.get(n.id) ?? { w: 40, h: 24 },
      layoutOpts,
      (start) => {
        const el = this.summaryLabels.get(start.id);
        return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
      },
      (n) => {
        if (this.calloutsHidden) return null;
        const el = this.calloutEls.get(n.id);
        return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
      },
      (n) => {
        const el = this.noteEls.get(n.id);
        return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
      },
    );

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
      const toggle = p.toggle ?? (p.side === "left" || p.side === "down" || p.side === "up" ? p.side : "right");
      if (el.dataset.toggle !== toggle) el.dataset.toggle = toggle;
    }
    // 中心主题的主轴和设了自己结构（时间轴、鱼骨图）的分支各自的主轴
    const spines = allSpines(this.layout);

    let edgeIndex = 0;
    const anchorBottom = (p: Placed) => isUnderlineAt(theme, p.node.depth - base.depth) && !p.node.color;
    for (const child of this.layout.placed.values()) {
      const parentNode = child.node.parent;
      if (!parentNode) continue;
      // 自由主题不和中心主题连线；概要主题由括号连着，也不和父节点连线
      if (this.layout.floating?.has(child.node) || isSummaryTopic(child.node)) continue;
      const parent = this.layout.placed.get(parentNode.id);
      if (!parent) continue;
      // 时间轴的主主题：不和中心主题连线，改画主轴上从前一个连过来的那一段
      let seg: Segment | undefined;
      for (const sp of spines) if ((seg = sp.segs.get(child.node.id))) break;
      let g = edgeGeometry(parent, child);
      if (child.side === "rib") {
        // 鱼骨图的小骨：下划线式的主题从文字底下接进来，小骨和下划线连成一条
        if (anchorBottom(child)) g = ribGeometry(parent, child, child.y + child.h);
      } else if (child.side === "right" || child.side === "left") {
        if (anchorBottom(parent)) g.y1 = parent.y + parent.h;
        if (anchorBottom(child)) g.y2 = child.y + child.h;
      } else if ((child.side === "tree" || child.side === "tree-up") && anchorBottom(child)) {
        // 树形分支（树形图、横向时间轴主题下面那一列）也从文字底下接进来，下划线才不会从字中间穿过去
        g.y2 = child.y + child.h;
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
      // 上下方向（组织结构图）的连线接在节点上沿或下沿中间，接不成下划线：下划线单独在文字底下画一段
      const vertical = child.side === "down" || child.side === "up";
      const tail = !anchorBottom(child)
        ? ""
        : vertical
          ? ` M${round2(child.x)},${round2(child.y + child.h)} L${round2(child.x + child.w)},${round2(child.y + child.h)}`
          : child.side === "rib"
            ? ` L${round2(g.x2 === child.x ? child.x + child.w : child.x)},${round2(g.y2)}`
            : ` L${round2(child.side === "left" ? child.x : child.x + child.w)},${round2(g.y2)}`;
      // 设了自己结构的分支：连线先弯到整块朝父节点的那条边，再直着接进根节点（不从分支里穿过去）
      let straight = "";
      if (child.entry !== undefined && (child.side === "right" || child.side === "left")) {
        straight = ` L${round2(g.x2)},${round2(g.y2)}`;
        g.x2 = child.entry;
      } else if (child.entry !== undefined && child.side === "down") {
        straight = ` L${round2(g.x2)},${round2(g.y2)}`;
        g.y2 = child.entry;
      }
      const d = seg
        ? `M${round2(seg.x1)},${round2(seg.y1)} L${round2(seg.x2)},${round2(seg.y2)}`
        : edgePath(g, style, (this.opts.edge?.sharp ?? theme.sharp) ? 0 : 8) + straight + tail;
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
      const depth = String(Math.min(child.node.depth - base.depth, 3));
      if (path.dataset.depth !== depth) path.dataset.depth = depth;
      // 演示模式按它判断这条线跟着哪个节点淡掉
      if (path.dataset.child !== child.node.id) path.dataset.child = child.node.id;
      const branch = this.els.get(child.node.id)?.dataset.branch;
      // 按层级着色开着时连线听层级（连到这一层的线用这一层的颜色），盖过「分支各一色」
      const levelStroke = nodeDecor.levelColor?.(child.node.depth) ?? null;
      const stroke = levelStroke ?? (branch !== undefined ? `var(--mm-branch-${branch})` : "");
      if (path.style.stroke !== stroke) path.style.stroke = stroke;
      if (path.style.display) path.setCssStyles({ display: "" });
    }
    // 时间轴主轴的最后一段：带箭头，颜色跟最后一个主主题
    for (const sp of spines) {
      const end = sp.end;
      if (!end) continue;
      let path = this.edgePaths[edgeIndex];
      if (!path) {
        path = createSvg("path");
        path.setAttribute("class", "mm-edge");
        this.svg.append(path);
        this.edgePaths.push(path);
      }
      edgeIndex += 1;
      const horiz = end.y1 === end.y2;
      const a = 5;
      // 箭头朝主轴的走向：时间轴往右（往下），鱼头在左的鱼骨图往左
      const dir = horiz && end.x2 < end.x1 ? -1 : 1;
      const head = horiz
        ? ` M${round2(end.x2 - dir * a * 1.4)},${round2(end.y2 - a)} L${round2(end.x2)},${round2(end.y2)} L${round2(end.x2 - dir * a * 1.4)},${round2(end.y2 + a)}`
        : ` M${round2(end.x2 - a)},${round2(end.y2 - a * 1.4)} L${round2(end.x2)},${round2(end.y2)} L${round2(end.x2 + a)},${round2(end.y2 - a * 1.4)}`;
      const d = `M${round2(end.x1)},${round2(end.y1)} L${round2(end.x2)},${round2(end.y2)}` + head;
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
      if (path.dataset.depth !== "1") path.dataset.depth = "1";
      if (path.dataset.child) delete path.dataset.child;
      // 鱼骨图的主骨属于整张图，不跟哪个分支的颜色
      const last = sp.plain ? undefined : [...sp.segs.keys()].pop();
      const branch = last ? this.els.get(last)?.dataset.branch : undefined;
      const stroke = branch !== undefined ? `var(--mm-branch-${branch})` : "";
      if (path.style.stroke !== stroke) path.style.stroke = stroke;
      if (path.style.display) path.setCssStyles({ display: "" });
    }
    for (let i = edgeIndex; i < this.edgePaths.length; i++) {
      if (!this.edgePaths[i].style.display) this.edgePaths[i].setCssStyles({ display: "none" });
    }
    this.drawBoxes();
    this.drawSummaries();
    this.drawCallouts();
    this.drawNotes();
    this.drawRels();
    this.drawRangeHandles();
    this.updateZoomLabel();
    this.opts.onLayout?.(this.layout.bounds);
  }

  // ---------- 关联线 ----------

  /**
   * 每条关联线的元素（看得见的线、加宽的透明点击区、箭头、线上的文字），按「起点节点 id:序号」复用。
   * 线在连线层里（压在节点下面），文字在节点层里，导出时跟着一起走
   */
  private relEls = new Map<string, { g: SVGGElement; line: SVGPathElement; hit: SVGPathElement; arrow: SVGPathElement; label: HTMLElement; guides: SVGPathElement; handles: [HTMLElement, HTMLElement] }>();
  private relOf = new WeakMap<Element, { src: MindNode; rel: Relation }>();
  /** 单击选中的那条线：高亮、出现拖弯曲的手柄，Delete 删掉 */
  private activeRel: Relation | null = null;
  private editingRel: Relation | null = null;
  /** 正在连线：从这个节点出发，等着点终点 */
  private relFrom: MindNode | null = null;
  private relDraft: { path: SVGPathElement; hint: HTMLElement; off: () => void } | null = null;

  private drawRels(): void {
    const layout = this.layout!;
    const anchors = new Map<string, MindNode>();
    walkMap(this.doc!.root, (n) => {
      if (n.anchor && !anchors.has(n.anchor)) anchors.set(n.anchor, n);
    });
    const seen = new Set<string>();
    walkMap(this.doc!.root, (src) => {
      src.rels?.forEach((rel, i) => {
        const dst = anchors.get(rel.to);
        const a = layout.placed.get(src.id);
        const b = dst && layout.placed.get(dst.id);
        // 一头折叠、隐藏、不在聚焦的分支里，线就不画
        if (!a || !b || dst === src) return;
        const key = `${src.id}:${i}`;
        seen.add(key);
        let r = this.relEls.get(key);
        if (!r) {
          r = this.createRel();
          this.relEls.set(key, r);
        }
        this.relOf.set(r.hit, { src, rel });
        this.relOf.set(r.label, { src, rel });
        const shape = this.relShapeOf(rel);
        const geo = relGeometry(a, b, rel.c, relCubic(rel), shape);
        if (r.line.getAttribute("d") !== geo.d) {
          r.line.setAttribute("d", geo.d);
          r.hit.setAttribute("d", geo.d);
          r.arrow.setAttribute("d", geo.arrow);
        }
        const active = this.activeRel === rel;
        r.g.classList.toggle("is-active", active);
        if (this.editingRel !== rel && r.label.dataset.raw !== rel.label) {
          r.label.dataset.raw = rel.label;
          renderInline(r.label, rel.label, this.summaryInlineOptions());
        }
        r.label.classList.toggle("is-empty", !rel.label && this.editingRel !== rel);
        r.label.classList.toggle("is-active", active);
        r.label.style.left = `${round2(geo.top.x)}px`;
        r.label.style.top = `${round2(geo.top.y)}px`;
        // 选中的线：两头各一个控制点手柄，用细线连到线头（#28）
        const handles = active && !!this.opts.editable && shape === "curve";
        r.g.classList.toggle("has-handles", handles);
        r.guides.setAttribute("d", handles ? `M${round2(geo.s.x)},${round2(geo.s.y)} L${round2(geo.h1.x)},${round2(geo.h1.y)} M${round2(geo.e.x)},${round2(geo.e.y)} L${round2(geo.h2.x)},${round2(geo.h2.y)}` : "");
        [geo.h1, geo.h2].forEach((h, j) => {
          const el = r.handles[j];
          el.classList.toggle("is-shown", handles);
          el.style.left = `${round2(h.x)}px`;
          el.style.top = `${round2(h.y)}px`;
        });
      });
    });
    for (const [key, r] of this.relEls) {
      if (seen.has(key)) continue;
      r.g.remove();
      r.label.remove();
      r.handles.forEach((h) => h.remove());
      this.relEls.delete(key);
    }
    this.positionRelbar();
  }

  private createRel(): { g: SVGGElement; line: SVGPathElement; hit: SVGPathElement; arrow: SVGPathElement; label: HTMLElement; guides: SVGPathElement; handles: [HTMLElement, HTMLElement] } {
    const g = createSvg("g");
    g.setAttribute("class", "mm-rel");
    const line = createSvg("path");
    line.setAttribute("class", "mm-rel-line");
    const arrow = createSvg("path");
    arrow.setAttribute("class", "mm-rel-arrow");
    const hit = createSvg("path");
    hit.setAttribute("class", "mm-rel-hit");
    const guides = createSvg("path");
    guides.setAttribute("class", "mm-rel-guide");
    g.append(line, arrow, hit, guides);
    this.relLayer.append(g);
    const label = createDiv({ cls: "mm-rel-label" });
    this.nodesEl.append(label);
    const handles: [HTMLElement, HTMLElement] = [createDiv({ cls: "mm-rel-handle" }), createDiv({ cls: "mm-rel-handle" })];
    handles.forEach((h, j) => {
      h.dataset.end = j === 0 ? "start" : "end";
      this.nodesEl.append(h);
      h.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        const r = this.relOf.get(label);
        if (!r || ev.button !== 0) return;
        ev.preventDefault();
        this.el.focus({ preventScroll: true });
        this.dragRelHandle(r.src, r.rel, j as 0 | 1, h, ev);
      });
      h.addEventListener("click", (ev) => ev.stopPropagation());
    });
    const info = (el: Element) => this.relOf.get(el) ?? null;
    // 点线、拖文字和手柄都把键盘焦点给画布：之后按 ⌘Z、Delete 才作用在脑图上
    hit.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      this.el.focus({ preventScroll: true });
      // 触屏：按住不动 450ms 弹关联线菜单。不靠系统的 contextmenu（iPhone 上按在线上常常不来）
      if (ev.pointerType === "touch" && this.opts.editable) {
        this.cancelRelPress();
        const timer = window.setTimeout(() => {
          this.relPress = null;
          const r = info(hit);
          if (!r) return;
          this.relPressFired = performance.now();
          this.activateRel(r.rel);
          this.showContextMenu(this.relMenuEntries(r.src, r.rel), ev);
        }, 450);
        this.relPress = { timer, x: ev.clientX, y: ev.clientY };
      }
    });
    hit.addEventListener("pointermove", (ev) => {
      if (this.relPress && Math.hypot(ev.clientX - this.relPress.x, ev.clientY - this.relPress.y) > 8) this.cancelRelPress();
    });
    for (const type of ["pointerup", "pointercancel"] as const) hit.addEventListener(type, () => this.cancelRelPress());
    // 长按弹了菜单后松手：取消触屏补发的鼠标事件和 click（mousedown 会被菜单当成点外面而关掉，click 可能误点菜单项）
    hit.addEventListener("touchend", (ev) => {
      if (performance.now() - this.relPressFired < 1500) ev.preventDefault();
    });
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const r = info(hit);
      if (r) this.activateRel(r.rel);
    });
    hit.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const r = info(hit);
      if (r) this.editRelLabel(r.rel);
    });
    hit.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // 长按计时已经弹过菜单了（或马上要弹）：系统这次的 contextmenu 不再弹第二个
      if (this.relPress || performance.now() - this.relPressFired < 1500) return;
      const r = info(hit);
      if (!r || !this.opts.editable) return;
      this.activateRel(r.rel);
      this.showContextMenu(this.relMenuEntries(r.src, r.rel), ev);
    });
    // 文字（没文字时是个小圆点手柄）：拖它改弯曲，单击选中，双击改文字
    label.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      const r = info(label);
      if (!r || this.editingRel === r.rel || ev.button !== 0) return;
      ev.preventDefault();
      this.el.focus({ preventScroll: true });
      this.dragRelCurve(r.src, r.rel, label, ev);
    });
    label.addEventListener("click", (ev) => ev.stopPropagation());
    label.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const r = info(label);
      if (r) this.editRelLabel(r.rel);
    });
    label.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const r = info(label);
      if (!r || !this.opts.editable || this.editingRel === r.rel) return;
      this.activateRel(r.rel);
      this.showContextMenu(this.relMenuEntries(r.src, r.rel), ev);
    });
    return { g, line, hit, arrow, label, guides, handles };
  }

  private activateRel(rel: Relation | null): void {
    if (rel) {
      this.select(null, "replace");
      this.activeGroup = null;
      this.syncRangeHandles();
    }
    if (this.activeRel === rel) return;
    this.activeRel = rel;
    if (this.layout) this.drawRels();
  }

  /** 拖线上的文字 / 手柄改弯曲：弧顶跟着鼠标走。没怎么动就当单击（选中） */
  private dragRelCurve(src: MindNode, rel: Relation, label: HTMLElement, down: PointerEvent): void {
    // 直线、直角折线没有弯曲可拖：按一下就是选中
    if (this.relShapeOf(rel) !== "curve") {
      this.activateRel(rel);
      return;
    }
    const start = { x: down.clientX, y: down.clientY };
    const geo = this.relGeoOf(src, rel);
    if (!geo) return;
    const from = { ...geo.c };
    const before = JSON.stringify([rel.c, rel.c1, rel.c2]);
    const cubic = relCubic(rel);
    const c1 = cubic && { ...cubic.c1 };
    const c2 = cubic && { ...cubic.c2 };
    let moved = false;
    label.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / this.k;
      const dy = (e.clientY - start.y) / this.k;
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
      if (!this.opts.editable) return;
      moved = true;
      // 三次曲线 t=0.5 处 = (起点 + 3·控制点1 + 3·控制点2 + 终点) / 8：两个控制点各挪 4/3，文字正好挪一个鼠标的距离
      if (c1 && c2) {
        rel.c1 = { x: Math.round(c1.x + (dx * 4) / 3), y: Math.round(c1.y + (dy * 4) / 3) };
        rel.c2 = { x: Math.round(c2.x + (dx * 4) / 3), y: Math.round(c2.y + (dy * 4) / 3) };
      } else rel.c = { x: Math.round(from.x + dx), y: Math.round(from.y + dy) };
      this.drawRels();
    };
    const up = () => {
      label.removeEventListener("pointermove", move);
      label.removeEventListener("pointerup", up);
      label.removeEventListener("pointercancel", up);
      if (!moved) {
        this.activateRel(rel);
        return;
      }
      if (before !== JSON.stringify([rel.c, rel.c1, rel.c2])) this.notify();
      this.activateRel(rel);
    };
    label.addEventListener("pointermove", move);
    label.addEventListener("pointerup", up);
    label.addEventListener("pointercancel", up);
  }

  private relGeoOf(src: MindNode, rel: Relation): ReturnType<typeof relGeometry> | null {
    const dst = this.relTarget(rel);
    const a = this.layout?.placed.get(src.id);
    const b = dst && this.layout?.placed.get(dst.id);
    return a && b ? relGeometry(a, b, rel.c, relCubic(rel), this.relShapeOf(rel)) : null;
  }

  /** 这条关联线画成什么形状：单独设过的用它，否则按设置里的默认线形 */
  private relShapeOf(rel: Relation): RelShape {
    return rel.shape ?? this.opts.relShape?.() ?? "curve";
  }

  /** 改一条关联线的线形；和默认线形一样就不写进文件（跟着设置走） */
  setRelShape(rel: Relation, shape: RelShape): void {
    if (!this.opts.editable || this.relShapeOf(rel) === shape) return;
    rel.shape = shape === (this.opts.relShape?.() ?? "curve") ? undefined : shape;
    this.render();
    this.notify();
  }

  /**
   * 拖控制点手柄（#28）：手柄跟着鼠标走。还是一个控制点（或默认弯法）的线，先换成画出同一条线的两个控制点再拖；
   * 控制点记成相对各自节点中心的偏移。没怎么动就当单击
   */
  private dragRelHandle(src: MindNode, rel: Relation, which: 0 | 1, el: HTMLElement, down: PointerEvent): void {
    const dst = this.relTarget(rel);
    const a = this.layout?.placed.get(src.id);
    const b = dst && this.layout?.placed.get(dst.id);
    const geo = this.relGeoOf(src, rel);
    if (!a || !b || !geo || !this.opts.editable) return;
    const center = (n: { x: number; y: number; w: number; h: number }) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    const ca = center(a);
    const cb = center(b);
    const start = { x: down.clientX, y: down.clientY };
    const h = which === 0 ? geo.h1 : geo.h2;
    const before = JSON.stringify([rel.c, rel.c1, rel.c2]);
    let moved = false;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
      if (!moved) {
        moved = true;
        rel.c1 ??= { x: Math.round(geo.h1.x - ca.x), y: Math.round(geo.h1.y - ca.y) };
        rel.c2 ??= { x: Math.round(geo.h2.x - cb.x), y: Math.round(geo.h2.y - cb.y) };
        rel.c = undefined;
      }
      const x = h.x + (e.clientX - start.x) / this.k;
      const y = h.y + (e.clientY - start.y) / this.k;
      const c = which === 0 ? ca : cb;
      const off = { x: Math.round(x - c.x), y: Math.round(y - c.y) };
      if (which === 0) rel.c1 = off;
      else rel.c2 = off;
      this.drawRels();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved && before !== JSON.stringify([rel.c, rel.c1, rel.c2])) this.notify();
      this.activateRel(rel);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  private relSource(rel: Relation): MindNode | null {
    let found: MindNode | null = null;
    if (this.doc) walkMap(this.doc.root, (n) => {
      if (!found && n.rels?.includes(rel)) found = n;
    });
    return found;
  }

  private relTarget(rel: Relation): MindNode | null {
    let found: MindNode | null = null;
    if (this.doc) walkMap(this.doc.root, (n) => {
      if (!found && n.anchor === rel.to) found = n;
    });
    return found;
  }

  private cancelRelPress(): void {
    if (!this.relPress) return;
    window.clearTimeout(this.relPress.timer);
    this.relPress = null;
  }

  /** 选中的关联线上方放一个小工具栏（编辑文字、删除；跟节点的浮动工具栏一样的样式），手机上点它删线。其余操作在右键 / 长按菜单里 */
  private positionRelbar(): void {
    const rel = this.activeRel;
    const src = rel && this.doc ? this.relSource(rel) : null;
    const entry = rel ? [...this.relEls.values()].find((r) => this.relOf.get(r.label)?.rel === rel) : undefined;
    // 只在手机 / 平板上出：电脑上有 Delete 键和右键菜单，线上方多一条工具栏反而挡着双击改文字
    const touch = this.el.ownerDocument.body.classList.contains("is-mobile");
    const show = touch && !!rel && !!src && !!entry && this.opts.editable && this.opts.showNodebar?.() !== false && !this.editingRel && !this.selected.size;
    if (!show) {
      this.relbar?.remove();
      this.relbar = null;
      return;
    }
    if (!this.relbar) {
      const bar = createDiv({ cls: "mm-nodebar mm-relbar" });
      bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      bar.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
      const tool = (id: string, iconName: string, title: string, run: (src: MindNode, rel: Relation) => void) => {
        const b = createEl("button");
        b.type = "button";
        b.className = "mm-tool";
        b.dataset.tool = id;
        this.tip(b, title);
        b.append(icon(iconName));
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const r = this.activeRel;
          const s = r && this.relSource(r);
          if (r && s) run(s, r);
        });
        bar.append(b);
      };
      tool("rel-label", "pencil", t("menu.editRelLabel"), (_s, r) => this.editRelLabel(r));
      tool("rel-delete", "trash", t("menu.deleteRel"), (s, r) => this.deleteRel(s, r));
      this.relbar = bar;
      this.el.append(bar);
    }
    const bar = this.relbar;
    bar.classList.remove("is-hidden");
    // 放在线中间那个圆点 / 文字的上方；上面放不下就放下面
    const host = this.el.getBoundingClientRect();
    const a = entry.label.getBoundingClientRect();
    const cx = a.left + a.width / 2 - host.left;
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    let top = a.top - host.top - bh - 12;
    if (top < 4) top = a.bottom - host.top + 12;
    bar.style.left = `${Math.max(4, Math.min(cx - bw / 2, this.el.clientWidth - bw - 4))}px`;
    bar.style.top = `${top}px`;
    bar.classList.toggle("is-hidden", cx < 0 || cx > this.el.clientWidth || top > this.el.clientHeight);
  }

  private relMenuEntries(src: MindNode, rel: Relation): MenuEntry[] {
    const dst = this.relTarget(rel);
    return [
      { title: t("menu.relGoSource"), icon: "locate", run: () => this.jumpToNode(src) },
      { title: t("menu.relGoTarget"), icon: "locate-fixed", disabled: !dst, why: t("why.relTargetGone"), run: () => dst && this.jumpToNode(dst) },
      { separator: true },
      { title: t("menu.editRelLabel"), icon: "pencil", run: () => this.editRelLabel(rel) },
      { title: t("menu.reverseRel"), icon: "arrow-left-right", run: () => this.reverseRel(src, rel) },
      {
        title: t("menu.relShape"),
        icon: "waypoints",
        submenu: REL_SHAPES.map((sh) => ({ title: t(`edge.${sh}`), icon: sh === "curve" ? "spline" : sh === "straight" ? "move-up-right" : "corner-down-right", checked: this.relShapeOf(rel) === sh, run: () => this.setRelShape(rel, sh) })),
      },
      // 没拖过弯度就没有可恢复的：不出现
      ...(this.relShapeOf(rel) === "curve" && (rel.c || rel.c1 || rel.c2) ? [{ title: t("menu.resetRelCurve"), icon: "spline", run: () => this.resetRelCurve(rel) }] : []),
      { separator: true },
      { title: t("menu.deleteRel"), icon: "trash", run: () => this.deleteRel(src, rel) },
    ];
  }

  /** 选中节点并把它平滑移到画布中间（关联线的「跳到起点 / 终点」） */
  jumpToNode(node: MindNode): void {
    if (!this.els.has(node.id)) return;
    this.activateRel(null);
    this.select(node);
    this.centerOn(node, true);
  }

  /** 原地改线上的文字；Enter 完成，Esc 取消，清空就是没有文字（线还在） */
  editRelLabel(rel: Relation): void {
    if (!this.opts.editable) return;
    const key = [...this.relEls].find(([, r]) => this.relOf.get(r.label)?.rel === rel)?.[0];
    const label = key ? this.relEls.get(key)?.label : null;
    if (!label) return;
    const before = rel.label;
    this.activateRel(rel);
    this.editingRel = rel;
    this.positionRelbar();
    label.classList.remove("is-empty");
    label.classList.add("is-editing");
    delete label.dataset.raw;
    this.editInPlace(label, {
      text: before,
      selectAll: true,
      multiline: false,
      done: (commit, text) => {
        label.classList.remove("is-editing");
        this.editingRel = null;
        rel.label = commit ? markerText(text) : before;
        this.drawRels();
        if (rel.label !== before) this.notify();
        this.el.focus({ preventScroll: true });
      },
    });
  }

  /** 反过来：线挪到原来的终点上，指回原来的起点 */
  reverseRel(src: MindNode, rel: Relation): void {
    const dst = this.relTarget(rel);
    if (!this.opts.editable || !dst || !src.rels) return;
    src.anchor ??= this.newRelId();
    src.rels = src.rels.filter((r) => r !== rel);
    if (!src.rels.length) src.rels = undefined;
    // 反过来时两个控制点对调（各自还跟着原来的节点）
    const back: Relation = { to: src.anchor, label: rel.label, c: rel.c, c1: rel.c2, c2: rel.c1 };
    (dst.rels ??= []).push(back);
    this.pruneRels();
    this.activeRel = back;
    this.render();
    this.notify();
  }

  resetRelCurve(rel: Relation): void {
    if (!this.opts.editable || (!rel.c && !rel.c1 && !rel.c2)) return;
    rel.c = undefined;
    rel.c1 = undefined;
    rel.c2 = undefined;
    this.render();
    this.notify();
  }

  deleteRel(src: MindNode, rel: Relation): void {
    if (!this.opts.editable || !src.rels) return;
    src.rels = src.rels.filter((r) => r !== rel);
    if (!src.rels.length) src.rels = undefined;
    if (this.activeRel === rel) this.activeRel = null;
    this.pruneRels();
    this.render();
    this.notify();
  }

  /** 一个还没用过的标识（r1、r2……），id= 和 rel= 里出现过的都避开，包括隐藏的节点 */
  private newRelId(): string {
    const used = new Set<string>();
    if (this.doc) walkAll(this.doc.root, (n) => {
      if (n.anchor) used.add(n.anchor);
      for (const r of n.rels ?? []) used.add(r.to);
    });
    let i = 1;
    while (used.has(`r${i}`)) i++;
    return `r${i}`;
  }

  /**
   * 删掉节点或线以后收拾：指向已经不存在的节点的线去掉，没有线指过来的 id= 也去掉。
   * 隐藏的节点也算（它们的 id 和线还在笔记里）
   */
  private pruneRels(): void {
    if (!this.doc) return;
    const anchors = new Set<string>();
    const targets = new Set<string>();
    walkAll(this.doc.root, (n) => {
      if (n.anchor) anchors.add(n.anchor);
    });
    walkAll(this.doc.root, (n) => {
      if (!n.rels) return;
      n.rels = n.rels.filter((r) => anchors.has(r.to));
      if (!n.rels.length) n.rels = undefined;
      for (const r of n.rels ?? []) targets.add(r.to);
    });
    walkAll(this.doc.root, (n) => {
      if (n.anchor && !targets.has(n.anchor)) n.anchor = undefined;
    });
  }

  /** 粘贴进来的节点：id= 和图里已有的撞了就换一个，粘贴的这批内部的线跟着换 */
  private remapPastedAnchors(nodes: MindNode[]): void {
    if (!this.doc) return;
    const used = new Set<string>();
    walkAll(this.doc.root, (n) => {
      if (n.anchor) used.add(n.anchor);
      for (const r of n.rels ?? []) used.add(r.to);
    });
    const map = new Map<string, string>();
    for (const root of nodes) walkAll(root, (n) => {
      if (!n.anchor || !used.has(n.anchor)) return;
      let i = 1;
      while (used.has(`r${i}`)) i++;
      const id = `r${i}`;
      used.add(id);
      map.set(n.anchor, id);
      n.anchor = id;
    });
    for (const root of nodes) walkAll(root, (n) => {
      for (const r of n.rels ?? []) r.to = map.get(r.to) ?? r.to;
    });
  }

  /** 开始连线：从这个节点拉出一条跟着鼠标的虚线，点一个节点连上，点空白处或 Esc 取消 */
  startRel(node: MindNode): void {
    if (!this.opts.editable || !this.layout?.placed.get(node.id)) return;
    this.cancelRel();
    this.relFrom = node;
    const path = createSvg("path");
    path.setAttribute("class", "mm-rel-draft");
    this.relLayer.append(path);
    const hint = this.el.createDiv({ cls: "mm-rel-hint", text: t("canvas.relHint") });
    this.el.classList.add("is-connecting");
    const toCanvas = (ev: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      return { x: (ev.clientX - r.left - this.tx) / this.k, y: (ev.clientY - r.top - this.ty) / this.k };
    };
    const onMove = (ev: PointerEvent) => {
      const a = this.relFrom && this.layout?.placed.get(this.relFrom.id);
      if (!a) return;
      const p = toCanvas(ev);
      const geo = relGeometry(a, { x: p.x, y: p.y, w: 0, h: 0 });
      path.setAttribute("d", geo.d);
    };
    const onDown = (ev: PointerEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      const nodeEl = (ev.target as HTMLElement).closest?.<HTMLElement>(".gg-mm-node");
      const target = nodeEl ? this.nodeFromEl(nodeEl) : null;
      const from = this.relFrom;
      this.cancelRel();
      if (target && from && target !== from) this.addRel(from, target);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      ev.preventDefault();
      this.cancelRel();
    };
    this.el.addEventListener("pointermove", onMove);
    this.el.addEventListener("pointerdown", onDown, true);
    this.el.addEventListener("keydown", onKey, true);
    this.relDraft = {
      path,
      hint,
      off: () => {
        this.el.removeEventListener("pointermove", onMove);
        this.el.removeEventListener("pointerdown", onDown, true);
        this.el.removeEventListener("keydown", onKey, true);
      },
    };
    this.el.focus({ preventScroll: true });
  }

  private cancelRel(): void {
    this.relFrom = null;
    if (!this.relDraft) return;
    this.relDraft.off();
    this.relDraft.path.remove();
    this.relDraft.hint.remove();
    this.relDraft = null;
    this.el.classList.remove("is-connecting");
  }

  addRel(from: MindNode, to: MindNode): void {
    if (!this.opts.editable || from === to) return;
    to.anchor ??= this.newRelId();
    const rel: Relation = { to: to.anchor, label: "" };
    (from.rels ??= []).push(rel);
    this.select(null, "replace");
    this.activeRel = rel;
    this.render();
    this.notify();
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
      if (rect.dataset.start !== b.start.id) rect.dataset.start = b.start.id;

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
      this.showContextMenu(this.opts.editable ? this.boxMenuEntries(start) : [], ev);
    });
    this.nodesEl.append(el);
    return el;
  }

  /**
   * 指针下最里层的外框（起始节点）。外框画在不接收鼠标的连线层里，标题以外的地方
   * 只能按坐标判断；layout.boxes 由内向外，第一个命中的就是最里层
   */
  private boxAt(clientX: number, clientY: number): MindNode | null {
    if (!this.layout) return null;
    const p = this.toWorld(clientX, clientY);
    const hit = this.layout.boxes.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    return hit?.start ?? null;
  }

  /** node 所在外框的起始节点 */
  private boxOf(node: MindNode): MindNode | null {
    if (!node.parent || this.isFloating(node)) return null;
    return boxGroups(this.groupSiblings(node.parent)).get(node.id) ?? null;
  }

  /** 算外框 / 概要分组用的兄弟列表：和布局一致，中心主题下的自由主题不算在内 */
  private groupSiblings(parent: MindNode): MindNode[] {
    const floating = this.layout?.floating;
    return floating?.size && !parent.parent ? parent.children.filter((c) => !floating.has(c)) : parent.children;
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
      ...this.rangeMenuEntries(start, "box"),
      { title: t("menu.removeBox"), icon: "square-dashed", run: () => this.removeBox(start) },
    ];
  }

  /** 外框 / 概要菜单里的「范围多括一个 / 少括一个」：都从末尾那一端改，拖两端的手柄可以随意改 */
  private rangeMenuEntries(start: MindNode, kind: GroupKind): MenuEntry[] {
    const [from, to] = groupRange(start, kind);
    const { hi } = groupLimits(start, kind);
    return [
      { title: t("menu.extendRange"), icon: "unfold-vertical", disabled: to >= hi, why: t("why.rangeAtEnd"), run: () => this.resizeGroup(start, kind, from, to + 1) },
      { title: t("menu.shrinkRange"), icon: "fold-vertical", disabled: to <= from, why: t("why.rangeOne"), run: () => this.resizeGroup(start, kind, from, to - 1) },
    ];
  }

  private resizeGroup(start: MindNode, kind: GroupKind, from: number, to: number): void {
    if (!this.opts.editable) return;
    setGroupRange(start, kind, from, to);
    this.render();
    this.notify();
  }

  // ---------- 外框 / 概要的范围手柄 ----------

  /**
   * 每个外框、概要在括住范围的两头各放一个小手柄，拖到哪个兄弟上范围就伸缩到哪。
   * 平时看不见：选中了里面的节点、或鼠标停在概要文字 / 手柄上时才显示
   */
  private drawRangeHandles(): void {
    const layout = this.layout!;
    let n = 0;
    const place = (kind: GroupKind, start: MindNode, end: "start" | "end", x: number, y: number, horizontal: boolean) => {
      let el = this.rangeHandles[n];
      if (!el) {
        el = this.createRangeHandle();
        this.rangeHandles.push(el);
      }
      n++;
      this.rangeHandleInfo.set(el, { kind, start, end });
      el.dataset.orient = horizontal ? "h" : "v";
      el.setCssStyles({ display: "", left: `${round2(x)}px`, top: `${round2(y)}px` });
    };
    if (this.opts.editable) {
      const groups: { kind: GroupKind; start: MindNode; segs: { rect: Bounds; side: string; members: MindNode[] }[] }[] = [];
      const add = (kind: GroupKind, start: MindNode, rect: Bounds, side: string, members: MindNode[]) => {
        let g = groups.find((x) => x.kind === kind && x.start === start);
        if (!g) groups.push((g = { kind, start, segs: [] }));
        g.segs.push({ rect, side, members });
      };
      for (const b of layout.boxes) add("box", b.start, b, b.side, b.members);
      for (const sm of layout.summaries) add("summary", sm.start, sm.brace, sm.side, sm.members);
      for (const g of groups) {
        const sibs = g.start.parent?.children ?? [];
        const [from, to] = groupRange(g.start, g.kind);
        const first = sibs[from];
        const last = sibs[to];
        const segStart = g.segs.find((x) => x.members.includes(first)) ?? g.segs[0];
        const segEnd = g.segs.find((x) => x.members.includes(last)) ?? g.segs[g.segs.length - 1];
        const ends = (seg: (typeof g.segs)[number]) => {
          const { x, y, w, h } = seg.rect;
          const horizontal = seg.side === "down";
          const a = horizontal ? { x, y: y + h / 2 } : { x: x + w / 2, y };
          const b = horizontal ? { x: x + w, y: y + h / 2 } : { x: x + w / 2, y: y + h };
          return { a, b, horizontal };
        };
        // 哪一头离第一个 / 最后一个成员近，手柄就放哪头（左侧、向下等结构不用逐个分情况）
        const near = (node: MindNode, e: ReturnType<typeof ends>) => {
          const p = layout.placed.get(node.id);
          if (!p) return e.a;
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          return Math.hypot(e.a.x - cx, e.a.y - cy) <= Math.hypot(e.b.x - cx, e.b.y - cy) ? e.a : e.b;
        };
        const es = ends(segStart);
        const pStart = near(first, es);
        let pEnd: { x: number; y: number };
        const ee = ends(segEnd);
        if (segEnd === segStart) pEnd = pStart === es.a ? es.b : es.a;
        else pEnd = near(last, ee);
        place(g.kind, g.start, "start", pStart.x, pStart.y, es.horizontal);
        place(g.kind, g.start, "end", pEnd.x, pEnd.y, ee.horizontal);
      }
    }
    for (let i = n; i < this.rangeHandles.length; i++) {
      if (this.rangeHandles[i].style.display !== "none") this.rangeHandles[i].setCssStyles({ display: "none" });
    }
    this.syncRangeHandles();
  }

  /** 选中了外框 / 概要里的节点、或鼠标停在它的概要文字上，它的手柄才显示 */
  private syncRangeHandles(): void {
    for (const el of this.rangeHandles) {
      const info = this.rangeHandleInfo.get(el);
      if (!info || el.style.display === "none") continue;
      const on = this.hoverGroup === info.start || this.rangeDragging === info.start || this.activeGroup === info.start;
      el.classList.toggle("is-active", on);
    }
    const active = this.rangeDragging ?? this.activeGroup;
    for (const [id, el] of this.summaryLabels) el.classList.toggle("is-active", active?.id === id);
    for (const rect of this.boxRects) rect.classList.toggle("is-active", !!active && rect.dataset.start === active.id && rect.style.display !== "none");
  }

  private rangeDragging: MindNode | null = null;
  /** 正在拖的东西来自备注弹窗 */
  private dragFromPopover = false;
  /** 单击概要文字 / 外框里的空白处选中的那个外框或概要（起始节点）；点别处、选中节点就取消 */
  private activeGroup: MindNode | null = null;

  private activateGroup(start: MindNode | null): void {
    if (start) this.select(null, "replace");
    this.activeGroup = start;
    this.activateRel(null);
    this.syncRangeHandles();
  }
  private hoverTimer = 0;

  /** 离开时晚一点再藏：从概要文字挪到括号端点的手柄上要经过一段空白 */
  private setHoverGroup(start: MindNode | null): void {
    window.clearTimeout(this.hoverTimer);
    if (start) {
      this.hoverGroup = start;
      this.syncRangeHandles();
      return;
    }
    this.hoverTimer = window.setTimeout(() => {
      this.hoverGroup = null;
      this.syncRangeHandles();
    }, 700);
  }

  private createRangeHandle(): HTMLElement {
    const el = createDiv();
    el.className = "mm-range-handle";
    el.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (ev.button !== 0) return;
      const info = this.rangeHandleInfo.get(el);
      if (info && this.opts.editable) this.dragGroupRange(info, el.dataset.orient === "h");
    });
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener("pointerenter", () => this.setHoverGroup(this.rangeHandleInfo.get(el)?.start ?? null));
    el.addEventListener("pointerleave", () => this.setHoverGroup(null));
    this.nodesEl.append(el);
    return el;
  }

  /**
   * 拖范围手柄：另一头不动，这一头跟着指针落到最近的兄弟（按整条分支的范围算）上。
   * 拖的时候实时重排，松手才写回；渲染会换掉手柄元素，所以监听挂在 document 上
   */
  private dragGroupRange(info: { kind: GroupKind; start: MindNode; end: "start" | "end" }, horizontal: boolean): void {
    if (this.editing) this.commitEdit();
    const kind = info.kind;
    let start = info.start;
    const sibs = start.parent?.children;
    if (!sibs) return;
    const [from0, to0] = groupRange(start, kind);
    const fixed = info.end === "start" ? to0 : from0;
    const { lo, hi } = groupLimits(start, kind);
    const doc = this.el.ownerDocument;
    let changed = false;
    this.rangeDragging = start;
    const dragCls = horizontal ? "is-range-dragging-h" : "is-range-dragging";
    this.el.classList.add(dragCls);
    const branchBounds = (node: MindNode): Bounds | null => {
      let b: Bounds | null = null;
      walkMap(node, (m) => {
        const p = this.layout?.placed.get(m.id);
        if (!p) return;
        if (!b) b = { x: p.x, y: p.y, w: p.w, h: p.h };
        else {
          const x = Math.min(b.x, p.x);
          const y = Math.min(b.y, p.y);
          b = { x, y, w: Math.max(b.x + b.w, p.x + p.w) - x, h: Math.max(b.y + b.h, p.y + p.h) - y };
        }
      });
      return b;
    };
    const move = (ev: PointerEvent) => {
      const p = this.toWorld(ev.clientX, ev.clientY);
      let best = -1;
      let bestD = Infinity;
      for (let k = lo; k <= hi; k++) {
        const b = branchBounds(sibs[k]);
        if (!b) continue;
        const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
        const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best < 0) return;
      const [a, b] = [Math.min(best, fixed), Math.max(best, fixed)];
      const [ca, cb] = groupRange(start, kind);
      if (a === ca && b === cb) return;
      start = setGroupRange(start, kind, a, b);
      this.rangeDragging = start;
      changed = true;
      this.render();
    };
    const up = () => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", up);
      this.rangeDragging = null;
      this.activeGroup = start;
      this.el.classList.remove(dragCls);
      this.syncRangeHandles();
      if (changed) this.notify();
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
    doc.addEventListener("pointercancel", up);
    this.syncRangeHandles();
  }

  /**
   * 给选中的节点加外框：同一父节点下相邻的合成一个，其余各自一个；已在外框里的跳过。
   * 外框连同分支一起框，祖先也选中了的节点不再单独加（框选整个分支时只出最外层一个框）
   */
  addBoxToSelected(): void {
    if (!this.opts.editable) return;
    const byParent = new Map<MindNode, number[]>();
    // 祖先自己加不了外框（中心主题、自由主题、概要主题）时不算，子节点照常加
    const ancestorSelected = (n: MindNode) => {
      for (let p = n.parent; p; p = p.parent) if (this.selected.has(p) && p.parent && !this.isFloating(p) && !isSummaryTopic(p)) return true;
      return false;
    };
    for (const n of this.selected) {
      if (!n.parent || this.boxOf(n) || this.isFloating(n) || isSummaryTopic(n) || ancestorSelected(n)) continue;
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

  /**
   * 浮动工具栏的外框按钮：还没外框就加；已经在外框里就弹出外框菜单（加 / 改标题、移除），
   * 不再一点就删，标题也就有了显眼的入口。⌘⇧B 仍是直接切换
   */
  private boxButton(ev: MouseEvent): void {
    if (!this.opts.editable || !this.selected.size) return;
    const start = [...this.selected].map((n) => this.boxOf(n)).find((s): s is MindNode => !!s);
    if (!start) {
      this.addBoxToSelected();
      return;
    }
    this.showContextMenu(this.boxMenuEntries(start), ev);
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

  // ---------- 概要 ----------

  /** 布局前先把要显示的概要文字建好（布局要量它的尺寸）；看不见的（父节点折叠了）删掉 */
  private syncSummaryLabels(base: MindNode): void {
    const need = new Set<string>();
    const visit = (n: MindNode) => {
      for (const c of visibleChildren(n)) {
        // 概要主题本身就是节点，不另建文字框
        if (c.summary && !c.summary.topic) {
          need.add(c.id);
          let el = this.summaryLabels.get(c.id);
          if (!el) {
            el = this.createSummaryLabel();
            this.summaryLabels.set(c.id, el);
          }
          this.summaryStart.set(el, c);
          if (this.editingSummary !== c) {
            const raw = c.summary.text || t("canvas.summaryDefault");
            const textEl = el.querySelector<HTMLElement>(".mm-summary-text")!;
            if (el.dataset.raw !== raw) {
              el.dataset.raw = raw;
              renderInline(textEl, raw, this.summaryInlineOptions());
            }
            el.classList.toggle("is-empty", !c.summary.text);
          }
          const w = c.summary.width;
          el.classList.toggle("has-width", !!w);
          el.setCssStyles({ width: w ? `${w}px` : "" });
        }
        visit(c);
      }
      for (const t of visibleTopics(n)) visit(t);
    };
    visit(base);
    for (const [id, el] of this.summaryLabels) {
      if (need.has(id)) continue;
      el.remove();
      this.summaryLabels.delete(id);
    }
  }

  /** 概要文字和节点文字用同一套行内 Markdown：链接能点、能悬停预览，公式、图片也照样渲染 */
  private summaryInlineOptions(): Parameters<typeof renderInline>[2] {
    return {
      onLink: (href, internal, ev) => this.opts.host?.openLink?.(href, internal, ev),
      onHover: (href, ev, a) => this.opts.host?.hoverLink?.(ev, href, a),
      renderMath: this.opts.host?.renderMath,
      resolveImage: this.opts.host?.resolveImage,
      renderPdfCrop: this.opts.host?.renderPdfCrop,
      onImageLoad: () => this.scheduleReflow(),
      onTag: (tag) => this.opts.host?.openTag?.(tag),
    };
  }

  private createSummaryLabel(): HTMLElement {
    const el = createDiv();
    el.className = "mm-summary";
    el.createSpan({ cls: "mm-summary-text" });
    // 外侧边缘的小竖条：拖动改宽度，双击恢复自适应
    const handle = el.createDiv({ cls: "mm-summary-handle" });
    handle.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const start = this.summaryStart.get(el);
      if (start && this.opts.editable) this.dragSummaryWidth(start, el, handle, ev);
    });
    // 拖完松手那一下的 click 别冒到文字框上（那会选中括住的节点、弹出工具栏）
    handle.addEventListener("click", (ev) => ev.stopPropagation());
    handle.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const start = this.summaryStart.get(el);
      if (!start?.summary?.width || !this.opts.editable) return;
      start.summary.width = undefined;
      this.render();
      this.notify();
    });
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    el.addEventListener("pointerenter", () => this.setHoverGroup(this.summaryStart.get(el) ?? null));
    el.addEventListener("pointerleave", () => this.setHoverGroup(null));
    // 单击不选中括住的节点：选中会弹出节点工具栏，常常正好盖在概要上，双击的第二下就点到工具栏去了。
    // 改成选中概要本身：高亮出来，两端出现范围手柄
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const start = this.summaryStart.get(el);
      if (start && this.opts.editable && this.editingSummary !== start) this.activateGroup(start);
    });
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const start = this.summaryStart.get(el);
      if (start && this.opts.editable) this.editSummary(start);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const start = this.summaryStart.get(el);
      if (!start || this.editingSummary === start || !this.opts.editable) return;
      this.showContextMenu(this.summaryMenuEntries(start), ev);
    });
    this.nodesEl.append(el);
    return el;
  }

  // ---------- 标注 ----------

  /** 布局前把要显示的标注气泡建好（布局要量它的尺寸）；隐藏时只建临时浮出的那一条 */
  private syncCallouts(base: MindNode): void {
    const need = new Set<string>();
    const show = (n: MindNode) => n.callout !== undefined && (!this.calloutsHidden || this.peekCallout === n || this.editingCallout === n);
    const visit = (n: MindNode) => {
      if (show(n)) {
        need.add(n.id);
        let el = this.calloutEls.get(n.id);
        if (!el) {
          el = this.createCallout();
          this.calloutEls.set(n.id, el);
        }
        this.calloutNode.set(el, n);
        if (this.editingCallout !== n) this.renderCalloutText(el, n.callout ?? "");
        el.classList.toggle("is-peek", this.calloutsHidden);
      }
      for (const c of visibleChildren(n)) visit(c);
      for (const t of visibleTopics(n)) visit(t);
    };
    visit(base);
    for (const [id, el] of this.calloutEls) {
      if (need.has(id)) continue;
      el.remove();
      this.calloutEls.delete(id);
    }
  }

  /** 一行一个块，每行按行内 Markdown 渲染（链接、加粗、公式、标签） */
  private renderCalloutText(el: HTMLElement, text: string): void {
    if (el.dataset.raw === text) return;
    el.dataset.raw = text;
    const box = el.querySelector<HTMLElement>(".mm-callout-text")!;
    box.empty();
    for (const line of text.split("\n")) renderInline(box.createDiv({ cls: "mm-callout-line" }), line || "\u200b", this.summaryInlineOptions());
  }

  private createCallout(): HTMLElement {
    const el = createDiv();
    el.className = "mm-callout";
    el.createDiv({ cls: "mm-callout-text" });
    // 和概要文字一样不参与画布拖拽；单击选中它所在的节点，双击编辑
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const n = this.calloutNode.get(el);
      if (!n || this.editingCallout === n) return;
      this.select(n);
      this.positionNodebar();
    });
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const n = this.calloutNode.get(el);
      if (n && this.opts.editable) this.editCallout(n);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const n = this.calloutNode.get(el);
      if (!n || this.editingCallout === n || !this.opts.editable) return;
      this.showContextMenu(
        [
          { title: t("menu.editCallout"), icon: "pencil", run: () => this.editCallout(n) },
          { title: t("menu.calloutColor"), icon: "palette", submenu: this.calloutColorEntries(n) },
          { title: t("menu.removeCallout"), icon: "x", run: () => this.removeCallout(n) },
        ],
        ev,
      );
    });
    this.nodesEl.append(el);
    return el;
  }

  private calloutColorEntries(node: MindNode): MenuEntry[] {
    const entry = (color: string | null): MenuEntry => ({
      title: color ? colorLabel(color) : t("canvas.clearColor"),
      icon: color ? "circle" : "circle-off",
      checked: (node.calloutColor ?? null) === color,
      run: () => this.setCalloutColor(node, color),
    });
    return [entry(null), ...this.nodeColors().map(entry)];
  }

  setCalloutColor(node: MindNode, color: string | null): void {
    if (!this.opts.editable || node.callout === undefined || (node.calloutColor ?? null) === color) return;
    node.calloutColor = color ?? undefined;
    this.render();
    this.notify();
  }

  /** 尖角：气泡边上一段短底边收到节点边上的一个点，填分支色 */
  private static calloutTail(c: { x: number; y: number; w: number; h: number; dir: PlacedCallout["dir"] }, p: Placed): string {
    const r = (v: number) => round2(v);
    if (c.dir === "right") {
      const y = c.y + Math.min(c.h, p.h) / 2;
      const bx = c.x + 1;
      return `M${r(bx)},${r(y - 5)} L${r(bx)},${r(y + 5)} L${r(p.x + p.w + 2)},${r(y)} Z`;
    }
    const lo = Math.max(c.x, p.x);
    const hi = Math.min(c.x + c.w, p.x + p.w);
    const x = hi > lo ? (lo + hi) / 2 : p.x + p.w / 2;
    const by = c.y + c.h - 1;
    // 离得远（气泡放到了整个分支上方）时底边收窄，像一根细线指回节点，不然是一根粗黑的刺
    const half = p.y - by > 30 ? 2 : 5;
    return `M${r(x - half)},${r(by)} L${r(x + half)},${r(by)} L${r(x)},${r(p.y - 2)} Z`;
  }

  private drawCallouts(): void {
    const layout = this.layout!;
    const list: { node: MindNode; x: number; y: number; w: number; h: number; dir: PlacedCallout["dir"] }[] = [...layout.callouts];
    // 隐藏时临时浮出的一条：不占位置，直接浮在节点上方
    const peek = this.calloutsHidden ? (this.editingCallout ?? this.peekCallout) : null;
    if (peek) {
      const p = layout.placed.get(peek.id);
      const el = this.calloutEls.get(peek.id);
      if (p && el) list.push({ node: peek, x: p.x, y: p.y - CALLOUT_GAP - el.offsetHeight, w: el.offsetWidth, h: el.offsetHeight, dir: "up" });
    }
    let i = 0;
    for (const c of list) {
      const el = this.calloutEls.get(c.node.id);
      const p = layout.placed.get(c.node.id);
      if (!el || !p) continue;
      const branch = this.els.get(c.node.id)?.dataset.branch;
      // 设了填充色：边框、尖角都用这个颜色；没设还是分支色描边
      const fill = c.node.calloutColor;
      const fillVar = !fill ? "" : (COLOR_NAMES as readonly string[]).includes(fill) ? `var(--mm-c-${fill})` : fill;
      const color = fillVar || (branch !== undefined ? `var(--mm-branch-${branch})` : "");
      if (el.style.getPropertyValue("--mm-callout-color") !== color) el.style.setProperty("--mm-callout-color", color);
      if (el.style.getPropertyValue("--mm-callout-bg") !== fillVar) {
        if (fillVar) el.style.setProperty("--mm-callout-bg", fillVar);
        else el.style.removeProperty("--mm-callout-bg");
      }
      const fg = !fill ? "" : fill.startsWith("#") ? contrastText(fill) : "var(--mm-c-fg)";
      if (el.style.getPropertyValue("--mm-callout-fg") !== fg) {
        if (fg) el.style.setProperty("--mm-callout-fg", fg);
        else el.style.removeProperty("--mm-callout-fg");
      }
      el.classList.toggle("has-color", !!fill);
      el.setCssStyles({ left: `${round2(c.x)}px`, top: `${round2(c.y)}px` });
      let tail = this.calloutTails[i];
      if (!tail) {
        tail = createSvg("path");
        tail.setAttribute("class", "mm-callout-tail");
        this.calloutLayer.append(tail);
        this.calloutTails.push(tail);
      }
      i++;
      const d = MindMapCanvas.calloutTail(c, p);
      if (tail.getAttribute("d") !== d) tail.setAttribute("d", d);
      if (tail.style.getPropertyValue("--mm-callout-color") !== color) tail.style.setProperty("--mm-callout-color", color);
      tail.classList.toggle("is-peek", c.node === peek);
      tail.classList.toggle("is-answer-covered", el.classList.contains("is-answer-covered"));
      if (tail.style.display) tail.setCssStyles({ display: "" });
    }
    for (let j = i; j < this.calloutTails.length; j++) {
      if (!this.calloutTails[j].style.display) this.calloutTails[j].setCssStyles({ display: "none" });
    }
  }

  isCalloutsHidden(): boolean {
    return this.calloutsHidden;
  }

  /** 打开别的文件时由宿主按记住的状态设置；不回调、不重画（随后的 setDoc 会画） */
  setCalloutsHidden(hidden: boolean): void {
    this.calloutsHidden = hidden;
    this.peekCallout = null;
  }

  toggleCallouts(): void {
    if (this.editingCallout) return;
    this.calloutsHidden = !this.calloutsHidden;
    this.peekCallout = null;
    this.opts.onCalloutsHiddenChange?.(this.calloutsHidden);
    this.render();
  }

  // ---------- 间隔复习 ----------

  /** 这张图在不在复习里：没加入、整张图、只有几个分支 */
  reviewState(): "none" | "whole" | "branch" {
    if (!this.doc || deckIdOf(this.doc.frontmatter) === null) return "none";
    return reviewBranches(this.doc) ? "branch" : "whole";
  }

  /** 宿主算好了今天的到期数（复习了、换天了）：刷新工具栏的数字和小绿点 */
  refreshReview(): void {
    this.updateReviewButton();
    this.applyReviewDots();
  }

  private updateReviewButton(): void {
    const b = this.reviewButton;
    if (!b) return;
    const on = this.reviewState() !== "none";
    const n = on ? (this.opts.review?.due()?.count ?? 0) : 0;
    // 只读的图没法加入，还没加入时就不显示
    b.classList.toggle("is-hidden", !on && !this.opts.editable);
    b.classList.toggle("is-off", !on);
    const c = b.querySelector<HTMLElement>(".mm-tool-count");
    if (c) c.textContent = n ? String(n) : "";
    this.tip(b, on ? t("canvas.review", { n }) : t("canvas.reviewJoin"), "toolbar");
  }

  /** 工具栏的复习按钮（还没加入复习时）：在按钮下面弹出加入复习的菜单；选中了分支节点时多一项「只把这个分支加入复习」 */
  private showReviewJoinMenu(anchor: HTMLElement): void {
    const node = this.primary ?? this.doc?.root;
    if (!node) return;
    const entries = this.reviewMenu(node);
    if (!entries.length) return;
    const r = anchor.getBoundingClientRect();
    this.showContextMenu(entries, new MouseEvent("contextmenu", { clientX: r.left, clientY: r.bottom + 4 }));
  }

  /** 今天有卡片到期的节点：右上角一个小绿点（设置里可以关） */
  private applyReviewDots(): void {
    if (!this.doc) return;
    const hooks = this.opts.review;
    const ids = hooks && hooks.dots() && this.reviewState() !== "none" ? (hooks.due()?.ids ?? null) : null;
    walkMap(this.doc.root, (n) => {
      const el = this.els.get(n.id);
      if (!el) return;
      const due = !!ids && !!n.reviewId && ids.has(n.reviewId);
      if (el.classList.contains("has-review-due") !== due) el.classList.toggle("has-review-due", due);
    });
  }

  /** 右键「间隔复习 ▸」：按这张图现在的状态给加入、移出、复习这个分支 */
  private reviewMenu(node: MindNode): MenuEntry[] {
    const hooks = this.opts.review;
    if (!hooks || !this.doc) return [];
    const editable = this.opts.editable;
    const state = this.reviewState();
    const out: MenuEntry[] = [];
    const isRoot = node === this.doc.root;
    let inBranch = false;
    for (let p: MindNode | null = node; p; p = p.parent) if (p.review) inBranch = true;
    const studyable = state === "whole" || (state === "branch" && inBranch);
    if (studyable) out.push({ title: t("menu.reviewStudyBranch", { n: hooks.dueIn(pathOf(node)) }), icon: "play", run: () => hooks.study(isRoot ? null : pathOf(node)) });
    if (editable) {
      if (state === "none") {
        out.push({ title: t("menu.reviewJoinAll"), icon: "layers", run: () => this.setReview("all-in", node) });
        if (!isRoot) out.push({ title: t("menu.reviewJoinBranch"), icon: "git-branch", run: () => this.setReview("branch-in", node) });
      } else if (state === "whole") {
        out.push({ title: t("menu.reviewLeaveAll"), icon: "x", run: () => this.setReview("all-out", node) });
      } else {
        if (node.review) out.push({ title: t("menu.reviewLeaveBranch"), icon: "x", run: () => this.setReview("branch-out", node) });
        else if (!inBranch && !isRoot) out.push({ title: t("menu.reviewAddBranch"), icon: "git-branch", run: () => this.setReview("branch-in", node) });
        out.push({ title: t("menu.reviewJoinAll"), icon: "layers", run: () => this.setReview("all-in", node) });
        out.push({ title: t("menu.reviewLeaveAll"), icon: "x", run: () => this.setReview("all-out", node) });
      }
      if (node.reviewId && hooks.suspended(node.reviewId)) out.push({ separator: true }, { title: t("menu.reviewUnsuspend"), icon: "play-circle", run: () => hooks.unsuspend(node.reviewId!) });
    }
    return out;
  }

  /**
   * 加入 / 移出复习：整张图写 frontmatter 的 mindmap-review（牌组 id），只加入分支的再在分支节点写 %%review%%。
   * 移出时卡片的 rv 留着，再加回来排期接着用
   */
  private setReview(how: "all-in" | "branch-in" | "all-out" | "branch-out", node: MindNode): void {
    const doc = this.doc;
    if (!doc || !this.opts.editable) return;
    const clearFlags = (n: MindNode) => {
      n.review = undefined;
      n.children.forEach(clearFlags);
      if (n.summary?.topic) clearFlags(n.summary.topic);
    };
    const ensureDeck = () => {
      if (!deckIdOf(doc.frontmatter)) doc.frontmatter = setFrontmatterValue(doc.frontmatter, REVIEW_KEY, this.opts.review?.previousDeck() ?? newReviewId(new Set()));
    };
    if (how === "all-in") {
      ensureDeck();
      clearFlags(doc.root);
    } else if (how === "branch-in") {
      const whole = this.reviewState() === "whole";
      ensureDeck();
      if (whole) clearFlags(doc.root);
      // 下面已经单独加入的分支并进来
      clearFlags(node);
      node.review = true;
    } else if (how === "all-out") {
      doc.frontmatter = setFrontmatterValue(doc.frontmatter, REVIEW_KEY, null);
      clearFlags(doc.root);
    } else {
      node.review = undefined;
      if (!reviewBranches(doc)) doc.frontmatter = setFrontmatterValue(doc.frontmatter, REVIEW_KEY, null);
    }
    if (how.endsWith("-in")) assignReviewIds(doc);
    this.render();
    this.notify();
    this.opts.review?.changed();
  }

  /** 原地复习开始前：出题的节点还没有 rv（新写的题）就补上，写回文件 */
  ensureReviewIds(): void {
    if (!this.doc || !this.opts.editable) return;
    if (!assignReviewIds(this.doc)) return;
    this.render();
    this.notify();
  }

  /** 命令、文件菜单：整张图加入 / 移出复习（和右键菜单一样，能撤销） */
  setWholeReview(on: boolean): void {
    if (!this.doc) return;
    this.setReview(on ? "all-in" : "all-out", this.doc.root);
  }

  /** 复习时按「编辑」跳回来：按卡片的 rv 找节点（找不到按路径），展开、选中、移到中间 */
  revealReview(reviewId: string | undefined, path: string): boolean {
    if (!this.doc) return false;
    let hit: MindNode | null = null;
    if (reviewId) {
      const find = (n: MindNode) => {
        if (hit) return;
        if (n.reviewId === reviewId) hit = n;
        n.children.forEach(find);
        if (n.summary?.topic) find(n.summary.topic);
      };
      find(this.doc.root);
    }
    if (hit) return this.revealNode(hit);
    return path ? this.revealPathFlash(path) : false;
  }

  private updateHiddenButton(): void {
    const b = this.hiddenButton;
    if (!b || !this.doc) return;
    // 代码块里的脑图没有接这个开关
    if (!this.opts.onToggleHidden) {
      b.classList.add("is-hidden");
      return;
    }
    const shown = !!this.opts.showHidden?.();
    const any = countHidden(this.doc.root) > 0;
    b.classList.toggle("is-hidden", !any && !shown);
    b.classList.toggle("is-active", shown);
    this.tip(b, shown ? t("canvas.hideHidden") : t("canvas.showHidden"), "toolbar");
  }

  /** 右键「在脑图中隐藏」：打上 %%hide%%；没开「显示隐藏的节点」时直接从图里摘掉 */
  hideSelected(): void {
    if (!this.opts.editable || !this.doc) return;
    // 概要主题藏起来就挂不回概要上了（解析时隐藏的不挂），不提供
    const targets = [...this.selected].filter((n) => n.parent && !n.hidden && !isSummaryTopic(n));
    if (!targets.length) return;
    const show = !!this.opts.showHidden?.();
    const next = targets[0].parent!;
    for (const n of targets) {
      if (show) n.hidden = true;
      else hideNode(n);
    }
    if (!show) {
      this.select(next.children.find((c) => !targets.includes(c)) ?? next);
      this.opts.host?.notice?.(t("notice.nodesHidden", { count: targets.length }));
    }
    this.render();
    this.notify();
  }

  unhideSelected(): void {
    if (!this.opts.editable) return;
    const targets = [...this.selected].filter((n) => n.hidden);
    for (const n of targets) n.hidden = false;
    if (!targets.length) return;
    this.render();
    this.notify();
  }

  private updateCalloutButton(): void {
    const b = this.calloutButton;
    if (!b || !this.doc) return;
    let any = false;
    walkMap(this.doc.root, (n) => {
      if (n.callout) any = true;
    });
    b.classList.toggle("is-hidden", !any);
    b.classList.toggle("is-active", any && !this.calloutsHidden);
    this.tip(b, this.calloutsHidden ? t("canvas.showCallouts") : t("canvas.hideCallouts"), "toolbar");
  }

  removeCallout(node: MindNode): void {
    if (!this.opts.editable || node.callout === undefined) return;
    node.callout = undefined;
    node.calloutColor = undefined;
    if (this.peekCallout === node) this.peekCallout = null;
    this.render();
    this.notify();
  }

  /** 原地编辑标注（没有就新加一条）：Enter 提交，Shift+Enter 换行，Esc 取消；清空提交等于删除 */
  editCallout(node: MindNode): void {
    if (!this.opts.editable || !this.doc) return;
    if (this.editing) this.commitEdit();
    const isNew = node.callout === undefined;
    const before = node.callout ?? "";
    if (isNew) node.callout = "";
    this.editingCallout = node;
    this.select(node);
    this.render();
    const box = this.calloutEls.get(node.id);
    const el = box?.querySelector<HTMLElement>(".mm-callout-text");
    if (!box || !el) {
      this.editingCallout = null;
      if (isNew) node.callout = undefined;
      return;
    }
    this.ensureVisible(node);
    delete box.dataset.raw;
    box.classList.add("is-editing");
    this.calloutEditor = this.editInPlace(el, {
      text: before,
      format: true,
      // 改已有的：光标放末尾，接着写
      selectAll: false,
      multiline: true,
      placeholder: t("canvas.calloutPlaceholder"),
      // 文字变了气泡尺寸跟着变，周围的节点要重新让位
      onChange: () => this.reflow(),
      done: (commit, raw) => {
        // 写回文件时引号、%% 会被换掉，这里先换好，画布上看到的和文件里一致
        const text = commit ? calloutFromMarker(calloutToMarker(raw)) : before;
        box.classList.remove("is-editing");
        this.editingCallout = null;
        this.calloutEditor = null;
        this.updateFormatBar();
        node.callout = text || undefined;
        if (!node.callout) node.calloutColor = undefined;
        // 隐藏标注时编辑完留着浮出的那条，方便看结果；点别处再收起
        if (this.calloutsHidden && node.callout) this.peekCallout = node;
        this.render();
        if ((node.callout ?? "") !== before || (isNew && node.callout)) this.notify();
        this.el.focus({ preventScroll: true });
      },
    });
  }

  /** 大括号：right / tree 尖朝右，left 尖朝左，down 横着、尖朝下 */
  private static bracePath(s: PlacedSummary): string {
    const { x, y, w, h } = s.brace;
    const r = (v: number) => round2(v);
    if (s.side === "down") {
      const q = Math.min(h / 2, w / 4);
      const ym = y + h / 2;
      const mid = x + w / 2;
      return `M${r(x)},${r(y)} Q${r(x)},${r(ym)} ${r(x + q)},${r(ym)} L${r(mid - q)},${r(ym)} Q${r(mid)},${r(ym)} ${r(mid)},${r(y + h)} Q${r(mid)},${r(ym)} ${r(mid + q)},${r(ym)} L${r(x + w - q)},${r(ym)} Q${r(x + w)},${r(ym)} ${r(x + w)},${r(y)}`;
    }
    const q = Math.min(w / 2, h / 4);
    const mid = y + h / 2;
    const xm = x + w / 2;
    // 开口那一侧的 x 和尖的 x
    const open = s.side === "left" ? x + w : x;
    const tip = s.side === "left" ? x : x + w;
    return `M${r(open)},${r(y)} Q${r(xm)},${r(y)} ${r(xm)},${r(y + q)} L${r(xm)},${r(mid - q)} Q${r(xm)},${r(mid)} ${r(tip)},${r(mid)} Q${r(xm)},${r(mid)} ${r(xm)},${r(mid + q)} L${r(xm)},${r(y + h - q)} Q${r(xm)},${r(y + h)} ${r(open)},${r(y + h)}`;
  }

  private drawSummaries(): void {
    const list = this.layout!.summaries;
    list.forEach((s, i) => {
      let path = this.summaryPaths[i];
      if (!path) {
        path = createSvg("path");
        path.setAttribute("class", "mm-summary-brace");
        this.summaryLayer.append(path);
        this.summaryPaths.push(path);
      }
      const d = MindMapCanvas.bracePath(s);
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
      if (path.style.display) path.setCssStyles({ display: "" });
      if (!s.label) return;
      const el = this.summaryLabels.get(s.start.id);
      if (!el) return;
      if (el.dataset.side !== s.side) el.dataset.side = s.side;
      el.setCssStyles({ left: `${round2(s.label.x)}px`, top: `${round2(s.label.y)}px` });
    });
    for (let i = list.length; i < this.summaryPaths.length; i++) {
      if (!this.summaryPaths[i].style.display) this.summaryPaths[i].setCssStyles({ display: "none" });
    }
  }

  /** node 所在概要的起始节点 */
  private summaryOf(node: MindNode): MindNode | null {
    if (!node.parent || this.isFloating(node)) return null;
    return summaryGroups(this.groupSiblings(node.parent)).get(node.id) ?? null;
  }

  private summaryMenuEntries(start: MindNode): MenuEntry[] {
    const topic = start.summary?.topic;
    if (topic) {
      // 只剩一行字（没有子节点、备注、标注、关联线）时才能转回普通概要，转回去不丢东西
      const plain = !topic.children.length && !topic.note && topic.callout === undefined && !topic.rels?.length && !topic.anchor;
      return [
        { title: t("menu.editSummary"), icon: "type", run: () => this.editTopic(topic) },
        { title: t("menu.addSummaryTopic"), icon: "corner-down-right", run: () => this.addTopicChild(start) },
        { title: t("menu.pasteChild"), icon: "clipboard-paste", run: () => this.pasteIntoSummary(start) },
        ...this.rangeMenuEntries(start, "summary"),
        { title: t("menu.summaryToText"), icon: "text", disabled: !plain, why: t("why.summaryNotPlain"), run: () => this.topicToText(start) },
        { title: t("menu.removeSummary"), icon: "x", run: () => this.removeSummary(start) },
      ];
    }
    return [
      { title: t("menu.editSummary"), icon: "type", run: () => this.editSummary(start) },
      { title: t("menu.addSummaryTopic"), icon: "corner-down-right", run: () => this.addTopicChild(start) },
      { title: t("menu.pasteChild"), icon: "clipboard-paste", run: () => this.pasteIntoSummary(start) },
      ...this.rangeMenuEntries(start, "summary"),
      { title: t("menu.removeSummary"), icon: "x", run: () => this.removeSummary(start) },
    ];
  }

  /** 概要的右键菜单（手机上长按）里的「粘贴」：粘到这个概要后面 */
  private pasteIntoSummary(start: MindNode): void {
    this.select(null);
    this.activeGroup = start;
    if (!start.summary?.topic) this.summaryLabels.get(start.id)?.classList.add("is-active");
    void this.pasteFromClipboard();
  }

  private editTopic(topic: MindNode): void {
    this.select(topic);
    this.startEdit(topic);
  }

  /**
   * 给概要加子主题（XMind 的概要主题）：普通概要先把文字变成一个节点（概要主题），再在它下面加一个子节点进入编辑。
   * 写回时概要主题是被括住的最后一个兄弟后面的一项，见 Summary.topic
   */
  addTopicChild(start: MindNode): void {
    if (!this.opts.editable || !this.doc || !start.summary) return;
    if (this.editing) this.commitEdit();
    const topic = this.ensureSummaryTopic(start);
    if (!topic) return;
    if (topic.folded) topic.folded = false;
    const child = addChild(topic, this.doc.style, "");
    this.activateGroup(null);
    this.select(child);
    this.render();
    this.startEdit(child, true);
    this.followSelection(child);
  }

  /** 概要的概要主题；普通概要先把文字变成一个节点（概要主题）再给出来。往概要后面挂节点（加子主题、粘贴、拖进来）都走这里 */
  private ensureSummaryTopic(start: MindNode): MindNode | null {
    if (!this.doc || !start.summary) return null;
    let topic = start.summary.topic;
    if (!topic) {
      topic = createNode({ parent: start.parent, text: start.summary.text || t("canvas.summaryDefault") });
      start.summary = { span: start.summary.span, raw: start.summary.raw, text: "", topic };
      fixTopics(this.doc.root);
    }
    return topic;
  }

  /**
   * 粘贴、插图片落到哪个节点下：选中的节点；没选节点、选中的是一个概要（点了概要文字）时，落到这个概要后面
   * （普通概要先变成概要主题）；都没有就是中心主题
   */
  private pasteTarget(): MindNode | null {
    if (this.primary) return this.primary;
    const g = this.activeGroup;
    if (g?.summary && (g.summary.topic || this.summaryLabels.get(g.id)?.classList.contains("is-active"))) {
      const topic = this.ensureSummaryTopic(g);
      if (topic) {
        this.activateGroup(null);
        return topic;
      }
    }
    return this.doc?.root ?? null;
  }

  /** 概要主题只剩一行字时转回普通概要（文字写进标记） */
  topicToText(start: MindNode): void {
    const g = start.summary;
    const topic = g?.topic;
    if (!this.opts.editable || !g || !topic || topic.children.length) return;
    start.summary = { span: g.span, raw: g.raw, text: markerText(topic.text), width: topic.width };
    topic.topicOf = undefined;
    topic.parent = null;
    this.select(null);
    this.render();
    this.notify();
  }

  /** 给选中的节点加概要：同一父节点下相邻的合成一个；已在概要里的跳过。加完直接进入编辑文字 */
  addSummaryToSelected(): void {
    if (!this.opts.editable) return;
    const byParent = new Map<MindNode, number[]>();
    for (const n of this.selected) {
      if (!n.parent || this.summaryOf(n) || this.isFloating(n) || isSummaryTopic(n)) continue;
      const arr = byParent.get(n.parent) ?? [];
      arr.push(n.parent.children.indexOf(n));
      byParent.set(n.parent, arr);
    }
    if (!byParent.size) return;
    let first: MindNode | null = null;
    for (const [parent, idx] of byParent) {
      idx.sort((a, b) => a - b);
      for (let i = 0; i < idx.length; ) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
        const start = parent.children[idx[i]];
        start.summary = { span: idx[j] - idx[i] + 1, text: "" };
        first ??= start;
        i = j + 1;
      }
    }
    this.render();
    if (first) this.editSummary(first, true);
  }

  // ---------- 同级编号 ----------

  /** 这组子节点能不能编号：用文件名当中心主题时，它下面的标题没处记 %%num%%，只有列表子节点才行 */
  private canNumber(parent: MindNode): boolean {
    if (parent !== this.doc?.root || this.doc.rootFromHeading) return true;
    return !allChildren(parent).some((c) => c.kind === "heading");
  }

  /**
   * 给选中节点所在的几组同级加上 / 取消编号。on 不给时：有一组没编号就全加，都编了就全取消。
   * 取消时列表子节点的有序项目符号换回普通的
   */
  toggleNumbering(on?: boolean): void {
    if (!this.opts.editable || !this.selected.size) return;
    const parents = new Set<MindNode>();
    for (const n of this.selected) if (n.parent && !isSummaryTopic(n) && this.canNumber(n.parent)) parents.add(n.parent);
    if (!parents.size) return;
    const next = on ?? [...parents].some((p) => !p.numbered);
    let changed = false;
    for (const p of parents) {
      // 已经编号了、但每项还带着手打的序号（「1. 1. 一」）：这次点击先把手打的去掉，编号留着
      if (!next && p.numbered && stripTypedNumbers(p)) changed = true;
      else changed = this.setNumbered(p, next) || changed;
    }
    if (!changed) return;
    this.render();
    this.reflow();
    this.notify();
  }

  private setNumbered(parent: MindNode, on: boolean): boolean {
    if (!!parent.numbered === on) return false;
    parent.numbered = on || undefined;
    // 已经手打了「1. 2. 3.」的一组，打开编号顺手把手打的去掉，不然会变成「1. 1. 一」
    if (on) stripTypedNumbers(parent);
    if (!on) for (const c of allChildren(parent)) if (c.kind === "list" && orderedBullet(c.bullet)) c.bullet = "";
    return true;
  }

  /** 命令：选中的有在概要里的就移除，否则加 */
  toggleSummaryOnSelected(): void {
    if (!this.opts.editable || !this.selected.size) return;
    const starts = new Set<MindNode>();
    for (const n of this.selected) {
      const s = this.summaryOf(n);
      if (s) starts.add(s);
    }
    if (!starts.size) {
      this.addSummaryToSelected();
      return;
    }
    for (const s of starts) s.summary = undefined;
    this.render();
    this.notify();
  }

  removeSummary(start: MindNode): void {
    if (!this.opts.editable || !start.summary) return;
    const topic = start.summary.topic;
    start.summary = undefined;
    if (topic) {
      // 连同概要主题的子树一起去掉：选中在里面的取消，连到里面的关联线也去掉
      for (const n of [...this.selected]) if (n === topic || isAncestor(topic, n)) this.selected.delete(n);
      topic.topicOf = undefined;
      topic.parent = null;
      this.pruneRels();
    }
    this.render();
    this.notify();
  }

  /** 原地编辑概要文字。isNew：刚加上的，按 Esc 或清空就当没加 */
  editSummary(start: MindNode, isNew = false): void {
    if (!this.opts.editable || !start.summary) return;
    const before = start.summary.text;
    const label = this.summaryLabels.get(start.id);
    const el = label?.querySelector<HTMLElement>(".mm-summary-text");
    if (!label || !el) return;
    this.editingSummary = start;
    label.classList.remove("is-empty");
    delete label.dataset.raw;
    label.classList.add("is-editing");
    this.editInPlace(el, {
      // 新加的先给个默认字样并全选，打字直接替换
      text: before || t("canvas.summaryDefault"),
      selectAll: true,
      multiline: false,
      // 文字变长变短要重新排位置（括号不动，文字跟着尖走）
      onChange: () => this.reflow(),
      done: (commit, raw) => {
        label.classList.remove("is-editing");
        this.editingSummary = null;
        if (!start.summary) return;
        const text = commit ? markerText(raw) : before;
        // 概要就是为了那段文字：清空了（或新加的按了 Esc）就整个去掉
        if (!text && (commit || isNew)) start.summary = undefined;
        else start.summary.text = text;
        this.render();
        if (isNew || text !== before) this.notify();
        this.el.focus({ preventScroll: true });
      },
    });
  }

  /** 拖概要文字框外侧的竖条改宽度；朝外拖变宽。组织结构图里文字居中，两边一起长，所以按两倍算 */
  private dragSummaryWidth(start: MindNode, el: HTMLElement, handle: HTMLElement, down: PointerEvent): void {
    if (!start.summary) return;
    const side = el.dataset.side;
    const dir = side === "left" ? -1 : 1;
    const factor = side === "down" ? 2 : 1;
    const startW = el.offsetWidth;
    const before = start.summary.width;
    handle.setPointerCapture(down.pointerId);
    const move = (ev: PointerEvent) => {
      if (!start.summary) return;
      const dx = ((ev.clientX - down.clientX) / this.k) * dir * factor;
      start.summary.width = Math.round(Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, startW + dx)));
      el.classList.add("has-width");
      el.setCssStyles({ width: `${start.summary.width}px` });
      this.reflow();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (start.summary && start.summary.width !== before) this.notify();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
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
    this.editInPlace(el, {
      text: start.box.title,
      selectAll: true,
      multiline: false,
      done: (commit, raw) => {
        el.classList.remove("is-editing");
        this.editingBox = null;
        if (!start.box) return;
        const text = commit ? raw.replace(/["%\r\n]/g, "").trim() : before;
        const changed = text !== before;
        start.box.title = text;
        el.textContent = text;
        this.render();
        if (changed) this.notify();
        this.el.focus({ preventScroll: true });
      },
    });
  }

  /**
   * 原地编辑一段文字（标注、概要、关联线文字、外框标题）：Enter 提交（能换行的用 Shift+Enter 换行），
   * Esc 取消，失焦提交。按键不往画布上冒，免得被当成节点操作
   */
  private editInPlace(
    host: HTMLElement,
    opts: { text: string; selectAll: boolean; multiline: boolean; placeholder?: string; onChange?: () => void; done: (commit: boolean, text: string) => void; format?: boolean },
  ): InlineEditor {
    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      const text = editor.savedText;
      editor.destroy();
      opts.done(commit, text);
    };
    const editor = new InlineEditor(host, {
      text: opts.text,
      selectAll: opts.selectAll,
      multiline: opts.multiline,
      placeholder: opts.placeholder,
      linkTitle: this.linkTitle,
      hideSyntax: this.hideSyntax(),
      onKey: (ev) => {
        ev.stopPropagation();
        if (ev.isComposing || ev.keyCode === 229) return false;
        if (ev.key === "Enter" && !(opts.multiline && ev.shiftKey)) {
          ev.preventDefault();
          finish(true);
          return true;
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish(false);
          return true;
        }
        // 能上格式的（标注）：⌘B / ⌘I / ⌘U 作用于选中的那段文字，和编辑节点一样
        const mod = ev.metaKey || ev.ctrlKey;
        if (opts.format && mod && !ev.shiftKey && !ev.altKey && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
          ev.preventDefault();
          const k = ev.key.toLowerCase();
          this.formatText({ kind: k === "b" ? "bold" : k === "i" ? "italic" : "underline" });
          return true;
        }
        return false;
      },
      onChange: opts.onChange,
      onSelect: opts.format ? () => this.updateFormatBar() : undefined,
      onBlur: () => finish(true),
    });
    return editor;
  }

  private settleTimer: number | null = null;

  /**
   * 手机上平移/缩放期间把画布提成独立合成层，停手 200ms 后摘掉（一直挂着的话，放大后看到的是按提层那一刻比例栅格化、
   * 再被 GPU 拉伸的位图，文字发虚）。电脑上不加：大图（5000 节点）加了反而每帧要 90ms 以上，不加满帧（e2e t_benchpan）；
   * 手机（iOS 是 WebKit）上没量过，先保持原来的做法
   */
  private holdLayer(): void {
    if (!this.el.ownerDocument.body.classList.contains("is-mobile")) return;
    if (this.viewport.style.willChange !== "transform") this.viewport.setCssStyles({ willChange: "transform" });
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      this.viewport.setCssStyles({ willChange: "" });
    }, 200);
  }

  /**
   * 手动平移（拖空白、滚轮）。嵌入的脑图框不大，平移没边界时滚几下整张图就跑出框外、只剩空白（#41）：
   * 嵌入的图至少留一半在框里（图比框小时留图的一半），已经在界外时只拦再往外走的那一步
   */
  private panTo(tx: number, ty: number): void {
    this.userView = true;
    if (this.opts.embedded && this.layout) {
      const b = this.layout.bounds;
      const axis = (prev: number, next: number, lo: number, size: number, view: number) => {
        const span = size * this.k;
        const m = Math.min(span, view) / 2;
        const min = m - (lo * this.k + span);
        const max = view - m - lo * this.k;
        if (next < min) return Math.max(next, Math.min(prev, min));
        if (next > max) return Math.min(next, Math.max(prev, max));
        return next;
      };
      tx = axis(this.tx, tx, b.x, b.w, this.el.clientWidth);
      ty = axis(this.ty, ty, b.y, b.h, this.el.clientHeight);
    }
    this.tx = tx;
    this.ty = ty;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.viewport.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.k})`;
    this.placeMinimapFrame();
    this.holdLayer();
    this.updateZoomLabel();
    this.positionNodebar();
    this.positionMapReview();
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
  private dismissOnOutside(el: HTMLElement, close: () => void, except?: HTMLElement): () => void {
    const onDown = (ev: PointerEvent) => {
      // except：打开它的那个按钮，点它由按钮自己收起（不然这里先收起、按钮又把它打开）
      if (el.contains(ev.target as Node) || except?.contains(ev.target as Node)) return;
      cleanup();
      close();
    };
    const cleanup = () => {
      doc.removeEventListener("pointerdown", onDown, true);
      this.outsideCleanups.delete(cleanup);
    };
    // 脑图开在独立窗口里时，点击发生在那个窗口的 document 上
    const doc = this.el.doc;
    doc.addEventListener("pointerdown", onDown, true);
    this.outsideCleanups.add(cleanup);
    return cleanup;
  }

  /** 供外部面板（大纲）复用同一套提示 */
  tipFor(el: HTMLElement, text: string, placement: TooltipPlacement = "top"): void {
    this.tip(el, text, "fixed", placement);
  }

  /** 给按钮加提示。zone 为 toolbar 的会跟随工具栏位置改变弹出方向 */
  private tip(el: HTMLElement, text: string, zone: "toolbar" | "fixed" = "fixed", placement?: TooltipPlacement, delay?: number): void {
    this.tips.set(el, { text, zone, placement, delay });
    if (zone === "toolbar" && !this.toolbarTips.includes(el)) this.toolbarTips.push(el);
    this.applyTip(el);
  }

  private applyTip(el: HTMLElement): void {
    const t = this.tips.get(el);
    if (!t) return;
    const placement = t.zone === "toolbar" ? this.toolbarTipPlacement() : (t.placement ?? "top");
    if (this.opts.host?.setTooltip) {
      el.removeAttribute("title");
      this.opts.host.setTooltip(el, t.text, placement, t.delay);
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
    // 先把按钮都建好放进 pool（按设置里的 id），最后按设置里的顺序摆上去
    const pool = new Map<string, HTMLElement>();
    const ID_OF: Record<string, string> = { unlock: "lock", minus: "zoomOut", plus: "zoomIn", note: "notes", hiddenNodes: "hidden", check: "embed", pencil: "embed", open: "embed" };
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
      pool.set(ID_OF[name] ?? name, b);
      return b;
    };
    if (this.opts.onToggleOutline) {
      btn("outline", t("canvas.outline"), () => this.opts.onToggleOutline?.());
    }
    if (this.opts.onLockChange) {
      const onLock = this.opts.onLockChange;
      this.lockButton = btn(this.locked ? "lock" : "unlock", "", () => {
        this.setLocked(!this.locked);
        onLock(this.locked);
      });
      this.updateLockButton();
    }
    // 分屏联动开关：同一篇的 Markdown 也开着时才显示（宿主调 setSplitSyncAvailable）
    if (this.opts.splitSync) {
      const sync = this.opts.splitSync;
      this.splitSyncButton = btn("splitSync", "", () => {
        sync.toggle();
        this.updateSplitSyncButton();
      });
      this.splitSyncButton.classList.add("is-hidden");
      this.updateSplitSyncButton();
    }
    if (this.opts.embedded && this.opts.onOpenFile) {
      const open = this.opts.onOpenFile;
      btn("open", t("canvas.openEmbeddedFile"), () => open());
    } else if (this.opts.embedded) {
      this.editToggle = btn(this.opts.editable ? "check" : "pencil", this.opts.editable ? t("canvas.doneEditing") : t("canvas.editEmbedded"), () =>
        this.setEditable(!this.opts.editable),
      );
      this.editToggle.classList.toggle("is-active", this.opts.editable);
      if (this.opts.onBigEdit) {
        const big = this.opts.onBigEdit;
        btn("expand", t("canvas.bigEdit"), () => big());
      }
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
    }
    btn("minus", t("canvas.zoomOut", { key: sc("Mod", "-") }), () => this.userZoomBy(1 / 1.2));
    this.zoomLabel = createEl("button");
    this.zoomLabel.type = "button";
    this.zoomLabel.className = "mm-tool mm-zoom-label";
    this.zoomLabel.dataset.tool = "zoom";
    this.tip(this.zoomLabel, t("canvas.zoomLevel"), "toolbar");
    this.zoomLabel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this.zoomLabel.addEventListener("click", () => this.userZoomBy(1 / this.k));
    pool.set("zoom", this.zoomLabel);
    btn("plus", t("canvas.zoomIn", { key: sc("Mod", "+") }), () => this.userZoomBy(1.2));
    btn("fit", t("canvas.fit", { key: sc("Mod", "0") }), () => this.userFit());
    btn("center", t("canvas.center"), () => this.userCenter());
    if (this.opts.onUndo) {
      btn("undo", t("canvas.undo", { key: sc("Mod", "Z") }), () => this.opts.onUndo?.());
      btn("redo", t("canvas.redo", { key: sc("Mod", "Shift", "Z") }), () => this.opts.onRedo?.());
    }
    btn("search", t("canvas.search", { key: sc("Mod", "F") }), () => this.openSearch());
    // 只在图里有标注时出现
    this.calloutButton = btn("callout", t("canvas.toggleCallouts"), () => this.toggleCallouts());
    // 只在图里有备注时出现
    this.notesButton = btn("note", t("canvas.toggleNotes"), () => this.toggleNotes());
    // 「选中节点时显示浮动工具栏」开关（#56）：亮着是开（设置里同一项）
    if (this.opts.onToggleNodebar) {
      const nb = btn("nodebar", t("canvas.toggleNodebar"), () => this.opts.onToggleNodebar?.());
      nb.classList.toggle("is-active", this.opts.showNodebar?.() !== false);
    }
    // 只在图里有隐藏的节点时出现
    this.hiddenButton = btn("hiddenNodes", t("canvas.showHidden"), () => this.opts.onToggleHidden?.());
    this.reciteButton = btn("recite", t("canvas.recite"), () => this.setRecite(!this.recite));
    if (!this.opts.embedded) btn("present", t("canvas.present"), () => this.startPresent());
    // 间隔复习：加入了复习，旁边写今天要复习几张，点了开始复习；还没加入时淡一点，点了弹出「加入复习」（群友反馈入口太深）
    if (this.opts.review) {
      const hooks = this.opts.review;
      const b = btn("review", "", () => (this.reviewState() === "none" ? this.showReviewJoinMenu(b) : hooks.study(null)));
      this.reviewButton = b;
      this.reviewButton.createSpan({ cls: "mm-tool-count" });
      this.updateReviewButton();
    }
    this.reciteButton.classList.toggle("is-active", this.recite);
    const layers = btn("layers", t("canvas.foldLevels"), () => this.toggleFoldMenu(layers));
    if (this.opts.quickSettings) {
      const quick = btn("quick", t("canvas.quickSettings"), () => this.toggleQuickSettings(quick));
    }
    // 按设置里的顺序摆。嵌入的脑图的「编辑 / 完成」「打开」按钮：清单里有它（嵌入的选了自定义）就按清单，
    // 否则不能关，放在「结构」那一格前面
    const layout = this.opts.toolbarLayout?.() ?? mergeLayout(undefined, TOOLBAR_DEFAULT);
    const listed = layout.some((x) => x.id === "embed");
    const embed = listed ? undefined : pool.get("embed");
    for (const item of layout) {
      if (item.id === "structure" && embed) bar.append(embed);
      if (!item.on) continue;
      if (isSep(item.id)) {
        const sep = createSpan();
        sep.className = "mm-tool-sep";
        bar.append(sep);
      } else {
        const b = pool.get(item.id);
        if (b) bar.append(b);
      }
    }
    if (embed && !embed.isConnected) bar.prepend(embed);
    // 「大窗口编辑」：嵌入的选了自定义时按清单（默认关）；否则跟在「编辑」后面
    const big = layout.some((x) => x.id === "expand") ? undefined : pool.get("expand");
    if (big) {
      const edit = pool.get("embed");
      // 工具栏这时还没挂进页面，isConnected 一直是 false，按父元素判断
      if (edit?.parentElement === bar) edit.after(big);
      else bar.prepend(big);
    }
    // 收起按钮（#61）：固定在最后，不进按钮清单；收起后在同一个角落留一个小把手
    if (this.opts.onToolbarHiddenChange) {
      const sep = createSpan();
      sep.className = "mm-tool-sep";
      bar.append(sep);
      const hide = btn("down", t("canvas.hideToolbar"), () => this.setToolbarHidden(true, true));
      hide.dataset.tool = "hideToolbar";
      bar.append(hide);
      const handle = createDiv();
      handle.className = "mm-toolbar mm-toolbar-handle";
      handle.dataset.pos = this.toolbarPos;
      const show = createEl("button");
      show.type = "button";
      show.className = "mm-tool";
      show.dataset.tool = "showToolbar";
      this.tip(show, t("canvas.showToolbar"), "toolbar");
      show.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      show.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.setToolbarHidden(false, true);
      });
      handle.append(show);
      this.toolbarHandle = handle;
    }
    // 分隔线：前后没有看得见的按钮就藏起来。按钮会随情况显示 / 隐藏（有标注才出现标注按钮这类），类名一变就重新整理
    const tidy = () => {
      const kids = [...bar.children] as HTMLElement[];
      const show = visibleSeps(kids.map((k) => (k.classList.contains("mm-tool-sep") ? "sep" : k.classList.contains("is-hidden") ? "gone" : "tool")));
      kids.forEach((k, i) => {
        if (k.classList.contains("mm-tool-sep") && k.classList.contains("is-hidden") === show[i]) k.classList.toggle("is-hidden", !show[i]);
      });
      // 一个看得见的按钮都没有（嵌入的自定义里全关了）：整条工具栏不显示，免得留一个空框
      const empty = !kids.some((k) => !k.classList.contains("mm-tool-sep") && !k.classList.contains("is-hidden"));
      if (bar.classList.contains("is-empty") !== empty) bar.classList.toggle("is-empty", empty);
    };
    tidy();
    new MutationObserver(tidy).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class"] });
    this.el.append(bar);
    if (this.toolbarHandle) this.el.append(this.toolbarHandle);
    this.updateToolbarHideIcons();
    this.updateZoomLabel();
  }

  /** 收起 / 展开按钮的箭头朝工具栏贴着的那条边：在底部时收起朝下、把手朝上 */
  private updateToolbarHideIcons(): void {
    const dir = { bottom: ["down", "up"], top: ["up", "down"], left: ["prev", "next"], right: ["next", "prev"] }[this.toolbarPos];
    const hide = this.toolbar?.querySelector<HTMLElement>('[data-tool="hideToolbar"]');
    const show = this.toolbarHandle?.querySelector<HTMLElement>('[data-tool="showToolbar"]');
    if (this.toolbarHandle) this.toolbarHandle.dataset.pos = this.toolbarPos;
    if (hide && hide.dataset.dir !== dir[0]) {
      hide.dataset.dir = dir[0];
      hide.replaceChildren(icon(dir[0]));
    }
    if (show && show.dataset.dir !== dir[1]) {
      show.dataset.dir = dir[1];
      show.replaceChildren(icon(dir[1]));
    }
  }

  isToolbarHidden(): boolean {
    return this.toolbarHidden;
  }

  /** 收起 / 展开主工具栏（#61）。fromUser：用户点的、用的命令，告诉宿主记下来 */
  setToolbarHidden(hidden: boolean, fromUser = false): void {
    if (!this.toolbarHandle) hidden = false;
    if (hidden === this.toolbarHidden) return;
    this.toolbarHidden = hidden;
    this.el.classList.toggle("is-toolbar-hidden", hidden);
    this.closePopover();
    if (fromUser) this.opts.onToolbarHiddenChange?.(hidden);
  }

  // ---------- 背诵模式 ----------

  /**
   * 背诵模式：只改显示，不写进文件。==高亮== 遮成横线，点一下揭开；子节点带 [x] / [ ] 的节点
   * 是选择题，选项一律显示成没勾的样子，点题目揭晓（[x] 变绿、[ ] 变淡），两个以上正确选项标「多选」；
   * 带答案标记的节点连同子树整个遮住，点一下揭开
   */
  isRecite(): boolean {
    return this.recite;
  }

  setRecite(on: boolean): void {
    if (this.recite === on) return;
    this.recite = on;
    this.revealedQuestions.clear();
    this.revealedAnswers.clear();
    this.el.classList.toggle("is-recite", on);
    this.reciteButton?.classList.toggle("is-active", on);
    for (const m of this.el.querySelectorAll(".mm-label mark.is-revealed")) m.classList.remove("is-revealed");
    // 节点 DOM 会复用，退出时把题目标签摘掉，免得撑宽节点
    if (!on) for (const tag of this.el.querySelectorAll(".mm-quiz-tag")) tag.remove();
    this.render();
  }

  /** 按当前的树给题目和选项挂上 class；只在背诵模式下有样式，关掉后留着也不影响 */
  private applyRecite(): void {
    if (!this.doc) return;
    walkMap(this.doc.root, (q) => {
      const qEl = this.els.get(q.id);
      const options = q.children.map((c) => ({ c, state: taskState(c.text) })).filter((o) => o.state);
      if (qEl) {
        qEl.classList.toggle("is-question", options.length > 0);
        // 题目上挂「单选 / 多选」标签，揭晓答案只认点它，点节点别处就是普通的选中
        let tag = qEl.querySelector<HTMLElement>(":scope > .mm-quiz-tag");
        if (options.length) {
          tag ??= qEl.createSpan({ cls: "mm-quiz-tag" });
          const multi = options.filter((o) => o.state === "done").length > 1;
          tag.textContent = t(multi ? "canvas.multiChoice" : "canvas.singleChoice");
          tag.classList.toggle("is-shown", this.revealedQuestions.has(q.id));
        } else tag?.remove();
      }
      const shown = this.revealedQuestions.has(q.id);
      for (const { c, state } of options) {
        const el = this.els.get(c.id);
        if (!el) continue;
        el.classList.add("is-option");
        el.classList.toggle("is-correct", state === "done");
        el.classList.toggle("is-option-shown", shown);
      }
    });
    // 答案：没揭开的答案节点和它下面的节点都遮住，节点上的标注也一起藏
    // 选择题没揭晓时，选项下面的子节点（解题思路之类）也一起遮住
    const cover = (n: MindNode, covered: boolean) => {
      const answer = isAnswer(n.text);
      const option = !!n.parent && !!taskState(n.text) && !this.revealedQuestions.has(n.parent.id);
      const hide = covered || (answer && !this.revealedAnswers.has(n.id));
      const el = this.els.get(n.id);
      if (el) {
        el.classList.toggle("is-answer", answer);
        el.classList.toggle("is-answer-covered", hide);
        if (answer && hide && !covered) el.dataset.answer = t("canvas.answerCovered");
        else delete el.dataset.answer;
      }
      this.calloutEls.get(n.id)?.classList.toggle("is-answer-covered", hide);
      this.noteEls.get(n.id)?.classList.toggle("is-answer-covered", hide);
      for (const c of n.children) cover(c, hide || option);
    };
    cover(this.doc.root, false);
  }

  /** 遮住这个节点的那个答案：往上找最外层没揭开的答案；没被遮住返回 null */
  private coveringAnswer(node: MindNode): MindNode | null {
    let hit: MindNode | null = null;
    for (let n: MindNode | null = node; n; n = n.parent) if (isAnswer(n.text) && !this.revealedAnswers.has(n.id)) hit = n;
    return hit;
  }

  /** 背诵模式下的单击：点到遮住的高亮就揭开 / 盖回；点到题目就揭晓 / 收起答案 */
  private onReciteClick(ev: MouseEvent): void {
    if (!this.recite || this.editing) return;
    const down = this.reciteDown;
    if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > DRAG_THRESHOLD) return;
    const target = ev.target as HTMLElement;
    // 原地复习：点当前这道题被遮住的地方（高亮、答案、选择题标签）= 「显示答案」，评分按钮跟着出来；翻面后不再盖回去
    const r = this.mapReview;
    if (r?.node) {
      const curEl = this.els.get(r.node.id);
      const nodeEl = target.closest<HTMLElement>(".gg-mm-node");
      const hitNode = nodeEl ? this.nodeFromEl(nodeEl) : null;
      const onCurrent =
        (r.kind === "cloze" && !!curEl && !!target.closest(".mm-label mark") && curEl.contains(target)) ||
        (r.kind === "answer" && !!hitNode && (hitNode === r.node || isAncestor(r.node, hitNode))) ||
        (r.kind === "choice" && !!target.closest(".mm-quiz-tag") && hitNode === r.node);
      if (onCurrent) {
        this.revealReviewCard();
        return;
      }
    }
    // 节点文字里的、展开的备注卡片和查看备注窗口里的 ==高亮==：点一下揭开，再点盖回
    const mark = target.closest<HTMLElement>(".mm-label mark, .mm-note-card-body mark, .mm-popover.is-view .mm-popover-body mark");
    if (mark) {
      mark.classList.toggle("is-revealed");
      return;
    }
    const answerEl = target.closest<HTMLElement>(".gg-mm-node.is-answer, .gg-mm-node.is-answer-covered");
    const answer = answerEl ? this.nodeFromEl(answerEl) : null;
    if (answer) {
      const cover = this.coveringAnswer(answer);
      if (cover) {
        this.revealedAnswers.add(cover.id);
        this.applyRecite();
        if (this.layout) {
          this.drawCallouts();
          this.drawNotes();
        }
        return;
      }
      // 揭开过的答案再点一下盖回去
      if (isAnswer(answer.text)) {
        this.revealedAnswers.delete(answer.id);
        this.applyRecite();
        if (this.layout) {
          this.drawCallouts();
          this.drawNotes();
        }
        return;
      }
    }
    const tagEl = target.closest<HTMLElement>(".mm-quiz-tag");
    const nodeEl = tagEl?.closest<HTMLElement>(".gg-mm-node.is-question");
    const q = nodeEl ? this.nodeFromEl(nodeEl) : null;
    if (!q) return;
    if (!this.revealedQuestions.delete(q.id)) this.revealedQuestions.add(q.id);
    this.applyRecite();
    if (this.layout) {
      this.drawCallouts();
      this.drawNotes();
    }
  }

  /** 画出来的这张图（聚焦时是那个分支）用的结构：聚焦到设了自己结构的分支时用它的 */
  private baseStructure(): Structure {
    const f = this.focusRoot;
    return f?.layout ? branchStructure(f.layout, false).structure : this.opts.structure;
  }

  /** 设了自己结构、而且生效的分支根节点，或者画出来的这张图的根 */
  private isStructureRoot(n: MindNode): boolean {
    return n === (this.focusRoot ?? this.doc?.root) || (!!n.layout && !this.branchLayoutBlocked(n));
  }

  /**
   * node 的子节点按什么结构排：往上找最近的结构根（设了自己结构的分支、或者图的根）。
   * 时间轴、鱼骨图的分支里面不是它本身：横向时间轴和鱼骨图是树形图，纵向时间轴是逻辑图
   */
  private kidsStructure(node: MindNode): Structure {
    const base = this.focusRoot ?? this.doc?.root;
    for (let a: MindNode | null = node; a; a = a.parent) {
      if (!this.isStructureRoot(a)) continue;
      const s = a === base ? this.baseStructure() : branchStructure(a.layout!, this.layout?.placed.get(a.id)?.side === "left").structure;
      if (a === node) return s;
      if (isTimelineH(s) || isFishbone(s)) return "tree-right";
      if (isTimeline(s)) return "logic-right";
      return s;
    }
    return this.opts.structure;
  }

  /**
   * 混合结构：node 不能单独设结构的原因（能设返回 null）。中心主题在工具栏里改；概要主题、自由主题不行；
   * 时间轴、鱼骨图的主主题沿主轴 / 主骨排，第一期也不行（它们下面的主题可以）
   */
  private branchLayoutBlocked(node: MindNode): string | null {
    const base = this.focusRoot ?? this.doc?.root;
    if (!node.parent || node === base) return t("menu.branchLayoutRoot");
    if (isSummaryTopic(node)) return t("menu.branchLayoutTopic");
    // 自由主题单独排，可以设自己的结构（不受中心主题是时间轴、鱼骨图的限制）
    if (this.isFloating(node)) return null;
    const p = node.parent;
    // 父节点设的结构没生效（它自己就不能设）时不算
    const ps: Structure | undefined = p === base ? this.baseStructure() : p.layout && !this.branchLayoutBlocked(p) ? branchStructure(p.layout, false).structure : undefined;
    if (ps && (isTimeline(ps) || isFishbone(ps))) return t("menu.branchLayoutMainTopic");
    return null;
  }

  private branchLayoutMenu(node: MindNode): MenuEntry[] {
    const why = this.branchLayoutBlocked(node);
    if (why) return [{ title: why, disabled: true }];
    // 挂在父节点左边的分支：横向时间轴的主轴会和连向父节点的线叠在一起，不提供
    const leftward = this.layout?.placed.get(node.id)?.side === "left";
    const label = (l: BranchLayout) => (l === "fishbone" ? t("structure.fishbone") : (STRUCTURES.find((s) => s.id === l)?.label ?? l));
    return [
      { title: t("menu.branchLayoutInherit"), checked: !node.layout, run: () => this.setBranchLayout(undefined) },
      { separator: true },
      ...BRANCH_LAYOUTS.map((l): MenuEntry => ({ title: label(l), checked: node.layout === l, disabled: leftward && l.startsWith("timeline-h"), why: t("why.timelineLeft"), run: () => this.setBranchLayout(l) })),
    ];
  }

  /** 选中的分支都设成 layout（undefined = 跟随上级） */
  setBranchLayout(layout: BranchLayout | undefined): void {
    if (!this.opts.editable || !this.doc) return;
    const targets = [...this.selected].filter((n) => !this.branchLayoutBlocked(n) && n.layout !== layout);
    if (!targets.length) return;
    for (const n of targets) n.layout = layout;
    this.render();
    this.notify();
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
    items: { label: string; active?: boolean; run: () => void; color?: string | null }[],
    anchor: HTMLElement | null,
    close: () => void,
    point?: { x: number; y: number },
    /** 打开它的按钮：点它由按钮自己收起，不算「点外面」 */
    opener?: HTMLElement,
  ): HTMLElement {
    const menu = createDiv();
    menu.className = "mm-menu";
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    let cleanup = () => undefined as void;
    const closeAll = () => {
      // 同上：菜单按钮带着焦点被删掉，焦点要收回画布
      const refocus = menu.contains(this.el.ownerDocument.activeElement);
      cleanup();
      close();
      if (refocus) this.el.focus({ preventScroll: true });
    };
    for (const it of items) {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-menu-item" + (it.active ? " is-active" : "");
      // 面包屑的同级列表：主题有颜色时前面一个色点，和大纲面板一样（#43）
      if (it.color) {
        const dot = b.createSpan({ cls: "mm-outline-dot" });
        dot.dataset.color = it.color;
        if (!/^[a-z]+$/.test(it.color)) dot.style.background = it.color;
      }
      b.appendText(it.label);
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
    } else this.placeAtAnchor(menu, anchor);
    cleanup = this.dismissOnOutside(menu, closeAll, opener);
    return menu;
  }

  /** 弹出的菜单、面板摆在按钮旁边：工具栏里的按钮按工具栏位置决定弹出方向，其他地方（节点工具栏）一律向上弹 */
  private placeAtAnchor(menu: HTMLElement, anchor: HTMLElement): void {
    const host = this.el.getBoundingClientRect();
    const clampX = (x: number) => Math.max(4, Math.min(x, host.width - menu.offsetWidth - 4));
    const clampY = (y: number) => Math.max(4, Math.min(y, host.height - menu.offsetHeight - 4));
    const r = anchor.getBoundingClientRect();
    const pos: ToolbarPosition = anchor.closest(".mm-toolbar") ? this.toolbarPos : "bottom";
    if (pos === "left" || pos === "right") {
      menu.style.left = `${clampX(pos === "left" ? r.right - host.left + 8 : r.left - host.left - menu.offsetWidth - 8)}px`;
      menu.style.top = `${clampY(r.top - host.top + r.height / 2 - menu.offsetHeight / 2)}px`;
    } else {
      menu.style.left = `${clampX(r.left - host.left + r.width / 2 - menu.offsetWidth / 2)}px`;
      menu.style.top = `${clampY(pos === "top" ? r.bottom - host.top + 6 : r.top - host.top - menu.offsetHeight - 6)}px`;
    }
  }

  // ---------- 节点浮动工具栏 ----------

  private buildNodebar(): HTMLElement {
    const bar = createDiv();
    bar.className = "mm-nodebar";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    // 颜色、按钮各成一组：窄屏折行时整组换行，不会从按钮中间断开
    const colors = createDiv();
    colors.className = "mm-nodebar-group";
    const swatch = (color: string | null) => {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-swatch";
      this.tip(b, color ? t("canvas.colorTip", { color: colorLabel(color) }) : t("canvas.clearColor"));
      if (color) b.style.setProperty("--swatch", color.startsWith("#") ? color : `var(--mm-c-${color})`);
      else b.append(icon("none"));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.applyColor(color);
      });
      colors.append(b);
    };
    swatch(null);
    for (const c of this.nodeColors()) swatch(c);
    // 「···」：色板里选任意颜色（写成 %%#e5484d%% 这样的色值）
    const more = createEl("button");
    more.type = "button";
    more.className = "mm-swatch-more";
    more.textContent = "···";
    this.tip(more, t("palette.nodeMore"));
    more.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.toggleColorPalette("node", more);
    });
    colors.append(more);
    const tools = new Map<string, HTMLElement>();
    const tool = (id: string, iconName: string, title: string, onClick: (ev: MouseEvent) => void) => {
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-tool";
      b.dataset.tool = id;
      this.tip(b, title);
      b.append(icon(iconName));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onClick(ev);
      });
      tools.set(id, b);
    };
    // 文字颜色、荧光笔：左半边套用上次的颜色（作用于整个节点的文字），▾ 打开色板；和格式栏里的一样
    const split = (id: string, kind: "text" | "bg") => {
      const el = createColorSplit({
        doc: this.el.ownerDocument,
        cls: kind === "text" ? "is-text-color" : "is-highlighter",
        title: kind === "text" ? t("bar.textColor") : t("bar.highlight"),
        caretTitle: kind === "text" ? t("palette.textMore") : t("palette.bgMore"),
        face: (f) => (kind === "text" ? (f.textContent = "A") : f.append(icon("highlighter"))),
        current: () => this.currentColor(kind),
        paintBar: (b, c) => paintColor(b, c, kind),
        tip: (b, text) => this.tip(b, text),
        onApply: () => {
          const c = this.currentColor(kind);
          if (c) this.formatText(colorFormat(kind, c));
        },
        onOpen: (anchor) => this.toggleColorPalette(kind, anchor),
      });
      el.dataset.tool = id;
      tools.set(id, el);
    };
    split("textColor", "text");
    split("highlight", "bg");
    tool("child", "child", t("canvas.addChildTip", { key: "Tab" }), () => this.addChildToSelected());
    tool("sibling", "sibling", t("canvas.addSiblingTip", { key: sc("Enter") }), () => this.addSiblingToSelected(false));
    tool("marker", "marker", t("canvas.markersTip"), () => this.toggleMarkerPicker());
    tool("note", "note", t("canvas.noteTip", { key: sc("Mod", "Shift", "M") }), () => {
      if (this.primary) this.toggleNotePopover(this.primary, true);
    });
    tool("box", "box", t("canvas.boxTip", { key: sc("Mod", "Shift", "B") }), (ev) => this.boxButton(ev));
    if (this.opts.host?.pickNote) tool("link", "link", t("canvas.linkTip", { key: sc("Mod", "K") }), () => void this.linkSelectedToNote());
    tool("copy", "copy", t("canvas.copyTip", { key: sc("Mod", "C") }), () => this.copySelection());
    tool("paste", "paste", t("canvas.pasteTip", { key: sc("Mod", "V") }), () => void this.pasteFromClipboard());
    tool("trash", "trash", t("canvas.deleteTip", { key: "Delete" }), () => this.deleteSelected());
    // 可选按钮（设置里打开才显示）
    tool("rel", "rel", t("menu.addRel"), () => {
      if (this.primary) this.startRel(this.primary);
    });
    tool("media", "media", t("menu.insertMedia"), () => {
      if (this.primary) this.pickMedia(this.primary);
    });
    tool("table", "table", t("menu.insertTable"), () => {
      if (this.primary) this.tableMenuEntry(this.primary).run?.();
    });
    tool("fold", "fold", t("canvas.foldTip", { key: "/" }), () => {
      if (this.primary?.children.length) this.toggleFold(this.primary);
    });
    tool("moveUp", "up", t("canvas.moveUpTip", { key: sc("Alt", "↑") }), () => this.moveSelection("up"));
    tool("moveDown", "down", t("canvas.moveDownTip", { key: sc("Alt", "↓") }), () => this.moveSelection("down"));
    // 按设置里的顺序摆：颜色自成一组，相邻的按钮合成一组，组和组之间一条分隔线
    const layout = this.opts.nodebarLayout?.() ?? mergeLayout(undefined, NODEBAR_DEFAULT);
    const groups: HTMLElement[] = [];
    let run: HTMLElement | null = null;
    for (const item of layout) {
      if (!item.on) continue;
      if (item.id === "colors") {
        groups.push(colors);
        run = null;
        continue;
      }
      const b = tools.get(item.id);
      if (!b) continue;
      if (!run) {
        run = createDiv();
        run.className = "mm-nodebar-group";
        groups.push(run);
      }
      run.append(b);
    }
    groups.forEach((g, i) => {
      if (i > 0) {
        const sep = createSpan();
        sep.className = "mm-tool-sep";
        bar.append(sep);
      }
      bar.append(g);
    });
    return bar;
  }

  /**
   * 手机版 Obsidian 底部有一条悬浮导航栏（.mobile-navbar），电脑上右下角有状态栏，会盖住画布底部。
   * 量出它压住画布的高度，写进 --mm-bottom-inset，底部工具栏和搜索框据此抬高。
   */
  private updateBottomInset(): void {
    const r = this.el.getBoundingClientRect();
    const desktop = !this.el.ownerDocument.body.classList.contains("is-mobile");
    const inset = this.bottomCover(r.left, r.right);
    // 电脑上没被压着就和别的位置一样离底边 12px（样式表里没量过时的默认值是 44px，给状态栏留的）
    const v = inset > 0 ? `${Math.round(inset + 8)}px` : desktop ? "12px" : "";
    if (this.el.style.getPropertyValue("--mm-bottom-inset") !== v) {
      if (v) this.el.style.setProperty("--mm-bottom-inset", v);
      else this.el.style.removeProperty("--mm-bottom-inset");
    }
  }

  /**
   * 画布底部被盖住的高度，只算和屏幕上 [left, right) 这段横向范围重叠的：电脑上是右下角的状态栏，手机上是底部悬浮导航栏。
   * 看有没有画出来，不看 offsetParent：手机上那条导航栏是 position: fixed，offsetParent 永远是 null，
   * 以前因此当它不存在，脑图的工具栏被它挡住（#37）。电脑上的状态栏只压在最右下那个窗格上，分屏时别的窗格不受影响
   */
  private bottomCover(left: number, right: number): number {
    const doc = this.el.ownerDocument;
    const desktop = !doc.body.classList.contains("is-mobile");
    const r = this.el.getBoundingClientRect();
    let cover = 0;
    for (const b of doc.querySelectorAll<HTMLElement>(desktop ? ".status-bar" : ".mobile-navbar, .mobile-toolbar")) {
      const br = b.getBoundingClientRect();
      if (!(br.width > 0 && br.height > 0) || getComputedStyle(b).visibility === "hidden") continue;
      if (br.top < r.bottom && br.bottom > r.top && br.left < Math.min(right, r.right) && br.right > Math.max(left, r.left)) cover = Math.max(cover, r.bottom - br.top);
    }
    return cover;
  }

  // ---------- 原地复习 ----------

  // ---------- 禅模式（#43） ----------

  private zen: { exit: HTMLElement; timer: number; onMove: () => void } | null = null;

  isZen(): boolean {
    return !!this.zen;
  }

  /**
   * 禅模式：工具栏、节点浮动栏、格式栏、大纲面板都藏起来（CSS 按 is-zen），面包屑平时透明、移到上面才出来；
   * 键盘、右键菜单照常。鼠标一动右上角淡淡出一个「退出禅模式」，停 2 秒隐去（手机上常驻半透明）。只在这个标签页里、不记住
   */
  /** 格式栏挂在 body 上：body 上记着这个窗口里有没有开着禅模式的脑图，样式按它藏格式栏（不用 :has） */
  private markZenBody(): void {
    const doc = this.el.ownerDocument;
    doc.body.classList.toggle("gg-mm-has-zen", !!doc.querySelector(".gg-mm-root.is-zen"));
  }

  setZen(on: boolean): void {
    if (!this.opts.onZen || on === !!this.zen) return;
    if (on) {
      this.closeQuickSettings();
      this.closeFoldMenu();
      const exit = this.el.createEl("button", { cls: "mm-zen-exit", attr: { type: "button" } });
      exit.append(icon("minimize"));
      exit.createSpan({ cls: "mm-zen-exit-label", text: t(this.present ? "present.exitShort" : "canvas.zenExit") });
      exit.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      exit.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // 演示中（演示自动进了禅模式）：这个按钮就是退出演示，只退禅模式会剩下淡掉、锁着的半个演示
        if (this.present) this.endPresent();
        else this.setZen(false);
      });
      const z = {
        exit,
        timer: 0,
        onMove: () => {
          exit.classList.add("is-shown");
          window.clearTimeout(z.timer);
          z.timer = window.setTimeout(() => exit.classList.remove("is-shown"), 2000);
        },
      };
      this.zen = z;
      this.el.addEventListener("pointermove", z.onMove);
      this.el.classList.add("is-zen");
      this.markZenBody();
      this.updateBottomInset();
    } else {
      const z = this.zen;
      if (!z) return;
      this.zen = null;
      window.clearTimeout(z.timer);
      this.el.removeEventListener("pointermove", z.onMove);
      z.exit.remove();
      this.el.classList.remove("is-zen");
      this.markZenBody();
      this.updateBottomInset();
      this.positionNodebar();
    }
    this.opts.onZen(on);
    this.el.focus({ preventScroll: true });
  }

  isMapReviewing(): boolean {
    return !!this.mapReview;
  }

  /**
   * 原地复习：进背诵模式（高亮、答案、选择题都遮着），到期的题一道道选中、移到中间，
   * 节点下面浮出「显示答案」，揭开后换成四个评分按钮。顶上一条显示剩余数和退出
   */
  startMapReview(driver: MapReviewDriver): void {
    if (this.mapReview) this.endMapReview();
    const prevRecite = this.recite;
    if (!prevRecite) this.setRecite(true);
    const bar = this.el.createDiv({ cls: "mm-review-bar" });
    const pop = this.el.createDiv({ cls: "mm-review-pop" });
    for (const el of [bar, pop]) {
      // 按下按钮不抢焦点：按钮点完就重画掉了，焦点跟着丢，后面的空格、1–4 就送不到画布
      el.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      });
      el.addEventListener("mousedown", (ev) => ev.preventDefault());
      el.addEventListener("dblclick", (ev) => ev.stopPropagation());
      el.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
    }
    this.el.classList.add("is-map-review");
    this.mapReview = { driver, node: null, kind: null, shown: false, prevRecite, unfolded: [], bar, pop, start: Date.now(), timer: 0 };
    this.el.focus({ preventScroll: true });
    void this.nextReviewCard();
  }

  endMapReview(): void {
    const r = this.mapReview;
    if (!r) return;
    this.mapReview = null;
    window.clearTimeout(r.timer);
    r.bar.remove();
    r.pop.remove();
    this.el.classList.remove("is-map-review");
    for (const el of this.el.querySelectorAll(".is-review-current")) el.classList.remove("is-review-current");
    // 为了出题临时展开的分支折回去（只改了内存，没写文件）
    for (const n of r.unfolded) n.folded = true;
    if (r.unfolded.length) this.render();
    if (!r.prevRecite) this.setRecite(false);
    else this.coverAll();
    r.driver.finish();
  }

  // ---------- 演示模式 ----------

  /** 演示进行中（见 present-core.ts）：锁住编辑、进禅模式，退出时把视口、选中、锁定、禅模式都还原 */
  private present: {
    route: MindNode[];
    state: PresentState;
    /** 讲到的节点从中心主题到它的 id 链：图变了靠它认回来 */
    path: string[];
    bar: HTMLElement;
    prevLocked: boolean;
    prevZen: boolean;
    prevView: { k: number; tx: number; ty: number };
    prevSel: string | null;
    down: { x: number; y: number; node: string | null; touch: boolean } | null;
    cleanup: () => void;
    anim: number;
  } | null = null;

  isPresenting(): boolean {
    return !!this.present;
  }

  private presentRouteNow(): MindNode[] {
    return this.doc ? presentRoute(this.doc.root, { leaves: this.opts.presentLeaves?.() ?? false }) : [];
  }

  /** 开始演示；from 是从哪个节点讲起（右键「从这里开始演示」），不给从中心主题讲 */
  startPresent(from: MindNode | null = null): void {
    if (!this.doc || this.present || this.opts.embedded) return;
    if (this.mapReview) this.endMapReview();
    if (this.editing) this.commitEdit();
    this.closePopover();
    this.closeQuickSettings();
    this.closeFoldMenu();
    if (this.focusRoot) this.exitFocus();
    const prevLocked = this.locked;
    const prevZen = !!this.zen;
    const prevView = { k: this.k, tx: this.tx, ty: this.ty };
    const prevSel = this.getSelectedPath();
    this.setLocked(true);
    if (!prevZen) this.setZen(true);
    this.zenExitLabel(true);
    const bar = this.el.createDiv({ cls: "mm-present-bar" });
    // 按下按钮不抢焦点，点完接着能用方向键翻页
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    bar.addEventListener("mousedown", (ev) => ev.preventDefault());
    bar.addEventListener("dblclick", (ev) => ev.stopPropagation());
    bar.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
    // 节点上的按下、双击、右键都截下来：点节点是跳过去，不选中、不拖、不编辑；空白处照常能拖着平移
    const inBar = (ev: Event) => !!(ev.target as HTMLElement).closest?.(".mm-present-bar, .mm-zen-exit");
    const onDown = (ev: PointerEvent) => {
      const p = this.present;
      if (!p || inBar(ev) || ev.button > 0) return;
      const nodeEl = (ev.target as HTMLElement).closest?.<HTMLElement>(".gg-mm-node");
      p.down = { x: ev.clientX, y: ev.clientY, node: nodeEl?.dataset.id ?? null, touch: ev.pointerType === "touch" };
      if (nodeEl) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    const onUp = (ev: PointerEvent) => {
      const p = this.present;
      const d = p?.down;
      if (!p || !d) return;
      p.down = null;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      const swipe = d.touch ? presentSwipe(dx, dy) : null;
      if (swipe) return this.presentAct(swipe);
      if (!d.node || Math.hypot(dx, dy) > 6) return;
      ev.stopPropagation();
      const node = this.nodeById.get(d.node);
      if (node) this.presentGo(clickNode(p.route, node));
    };
    const swallow = (ev: Event) => {
      if (inBar(ev)) return;
      ev.stopPropagation();
      ev.preventDefault();
    };
    const swallowNode = (ev: Event) => {
      if ((ev.target as HTMLElement).closest?.(".gg-mm-node")) swallow(ev);
    };
    this.el.addEventListener("pointerdown", onDown, true);
    this.el.addEventListener("pointerup", onUp, true);
    this.el.addEventListener("click", swallowNode, true);
    this.el.addEventListener("dblclick", swallow, true);
    this.el.addEventListener("contextmenu", swallow, true);
    this.el.addEventListener("dragstart", swallow, true);
    const cleanup = () => {
      this.el.removeEventListener("pointerdown", onDown, true);
      this.el.removeEventListener("pointerup", onUp, true);
      this.el.removeEventListener("click", swallowNode, true);
      this.el.removeEventListener("dblclick", swallow, true);
      this.el.removeEventListener("contextmenu", swallow, true);
      this.el.removeEventListener("dragstart", swallow, true);
    };
    const route = this.presentRouteNow();
    this.present = { route, state: startState(route, from), path: [], bar, prevLocked, prevZen, prevView, prevSel, down: null, cleanup, anim: 0 };
    this.el.classList.add("is-presenting");
    this.scheduleMinimap();
    this.select(null);
    this.el.focus({ preventScroll: true });
    this.applyPresent(true);
  }

  /** 右上角「退出禅模式」按钮：演示中写「退出演示」（点它结束演示） */
  private zenExitLabel(presenting: boolean): void {
    const label = this.zen?.exit.querySelector(".mm-zen-exit-label");
    if (label) label.textContent = t(presenting ? "present.exitShort" : "canvas.zenExit");
  }

  endPresent(): void {
    const p = this.present;
    if (!p) return;
    this.present = null;
    if (p.anim) this.el.win.cancelAnimationFrame(p.anim);
    p.cleanup();
    p.bar.remove();
    this.el.classList.remove("is-presenting", "is-present-all");
    this.scheduleMinimap();
    for (const el of this.el.querySelectorAll(".is-present-on, .is-present-ring")) el.classList.remove("is-present-on", "is-present-ring");
    if (!p.prevZen) this.setZen(false);
    else this.zenExitLabel(false);
    if (!p.prevLocked) this.setLocked(false);
    this.k = p.prevView.k;
    this.tx = p.prevView.tx;
    this.ty = p.prevView.ty;
    this.applyTransform();
    if (p.prevSel !== null) this.selectPath(p.prevSel);
    this.el.focus({ preventScroll: true });
  }

  presentAct(a: PresentAction): void {
    const p = this.present;
    if (!p) return;
    if (a === "exit") return this.endPresent();
    this.presentGo(presentStep(p.state, a, p.route.length));
  }

  private presentGo(s: PresentState): void {
    const p = this.present;
    if (!p) return;
    p.state = s;
    this.applyPresent(true);
  }

  private onPresentKey(ev: KeyboardEvent): boolean {
    if (!this.present) return false;
    const a = presentKey(ev.key, { meta: ev.metaKey, ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey });
    if (a) {
      ev.preventDefault();
      ev.stopPropagation();
      this.presentAct(a);
      return true;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) {
      // ⌘Z、⌘X 这些会改图：演示时不做；⌘F、⌘+ 这类交给原来的处理
      if (["z", "x", "v", "y", "d", "b", "i", "u"].includes(ev.key.toLowerCase())) {
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      }
      return false;
    }
    // 别的键（Tab、Delete、F2、字母……）演示时都不处理，免得改到图
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }

  /** 按现在讲到哪给节点、连线、标注、备注卡片上色，更新底部的条，镜头飞过去 */
  private applyPresent(animate: boolean): void {
    const p = this.present;
    if (!p || !this.doc || !this.layout) return;
    // 图变了：讲解顺序重新算，按 id 链认回原来讲到的节点
    const route = this.presentRouteNow();
    const same = route.length === p.route.length && route.every((n, i) => n.id === p.route[i].id);
    if (!same) p.state = reanchor(route, p.state, p.path, p.route.length);
    p.route = route;
    const cur = route[p.state.pos];
    if (cur) {
      const chain: string[] = [];
      for (let n: MindNode | null = cur; n; n = n.parent) chain.unshift(n.id);
      p.path = chain;
    }
    const look = presentLook(route, p.state);
    const normal = look.normal;
    if (normal) {
      // 正常显示的节点挂着的概要主题也正常
      walkMap(this.doc.root, (n) => {
        if (n.summary?.topic && normal.has(n.id)) normal.add(n.summary.topic.id);
      });
    }
    const on = (id: string | undefined) => !normal || (!!id && normal.has(id));
    this.el.classList.toggle("is-present-all", !normal);
    for (const [id, el] of this.els) {
      el.classList.toggle("is-present-on", on(id));
      el.classList.toggle("is-present-ring", look.rings.includes(id));
    }
    for (const path of this.edgePaths) path.classList.toggle("is-present-on", on(path.dataset.child));
    for (const [id, el] of this.calloutEls) el.classList.toggle("is-present-on", on(id));
    for (const [id, el] of this.noteEls) el.classList.toggle("is-present-on", on(id));
    this.paintPresentBar(cur ?? null);
    this.presentCamera(look.frame, animate);
  }

  private paintPresentBar(cur: MindNode | null): void {
    const p = this.present;
    if (!p) return;
    const bar = p.bar;
    bar.empty();
    const prog = presentProgress(p.state, p.route.length);
    const btn = (name: string, label: string, a: PresentAction, disabled = false) => {
      const b = bar.createEl("button", { cls: "mm-present-btn", attr: { type: "button", "data-act": a } });
      b.append(icon(name));
      this.tip(b, label, "fixed", "top");
      b.toggleClass("is-disabled", disabled);
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.presentAct(a);
        this.el.focus({ preventScroll: true });
      });
      return b;
    };
    btn("prev", t("present.prev"), "prev", p.state.pos === 0 && !p.state.peek && !p.state.ring);
    const crumbs = bar.createDiv({ cls: "mm-present-crumbs" });
    if (cur && !p.state.peek) {
      const chain: MindNode[] = [];
      for (let n: MindNode | null = cur; n; n = n.parent) chain.unshift(n);
      chain.forEach((n, i) => {
        if (i > 0) crumbs.createSpan({ cls: "mm-present-crumb-sep", text: "›" });
        crumbs.createSpan({ cls: "mm-present-crumb" + (i === chain.length - 1 ? " is-current" : ""), text: plainText(n.text) || t("canvas.emptyNode") });
      });
    } else crumbs.createSpan({ cls: "mm-present-crumb is-current", text: t("present.overview") });
    // 全图时面包屑那里已经写着「全图」，不再重复
    if (prog) bar.createSpan({ cls: "mm-present-count", text: `${prog.at} / ${prog.of}` });
    btn("next", t("present.next"), "next", p.state.pos >= p.route.length && !p.state.peek);
    btn("fit", t("present.toggleOverview"), "overview", p.state.pos >= p.route.length).classList.toggle("is-active", p.state.peek || p.state.pos >= p.route.length);
    btn("close", t("present.exit"), "exit");
    const line = bar.createDiv({ cls: "mm-present-progress" });
    const ratio = p.route.length ? Math.min(1, (p.state.pos + (p.state.pos >= p.route.length ? 0 : 1)) / p.route.length) : 1;
    line.setCssStyles({ width: `${Math.round(ratio * 1000) / 10}%` });
  }

  /** 镜头：框住这一步要看的节点（null 整张图），平移和缩放一起动 */
  private presentCamera(frame: string[] | null, animate: boolean): void {
    const p = this.present;
    const layout = this.layout;
    if (!p || !layout) return;
    let b = layout.bounds;
    if (frame) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const id of frame) {
        const q = layout.placed.get(id);
        if (!q) continue;
        x1 = Math.min(x1, q.x);
        y1 = Math.min(y1, q.y);
        x2 = Math.max(x2, q.x + q.w);
        y2 = Math.max(y2, q.y + q.h);
      }
      if (x1 < Infinity) b = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    // 演示条占掉的底部：手机上它要躲开底栏（--mm-bottom-inset），按它的实际位置算，镜头别把节点放到它后面
    const barH = p.bar.offsetHeight ? Math.max(0, this.el.getBoundingClientRect().bottom - p.bar.getBoundingClientRect().top) + 8 : 0;
    const to = frameView(b, { w: this.el.clientWidth, h: this.el.clientHeight, bottom: barH }, { pad: FIT_PADDING, minK: MIN_ZOOM, maxK: frame ? 1.6 : 1 });
    const win = this.el.win;
    if (p.anim) win.cancelAnimationFrame(p.anim);
    p.anim = 0;
    this.stopPanAnim();
    if (!animate) {
      this.k = to.k;
      this.tx = to.tx;
      this.ty = to.ty;
      this.applyTransform();
      return;
    }
    const from = { k: this.k, tx: this.tx, ty: this.ty };
    const start = performance.now();
    const ms = 360;
    const tick = (now: number) => {
      if (this.present !== p) return;
      const u = Math.min(1, (now - start) / ms);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // 缩放按对数插值，放大缩小的快慢看起来一样；平移跟着屏幕中心走，不先偏出去再拐回来
      const k = from.k * Math.pow(to.k / from.k, e);
      const cx = this.el.clientWidth / 2;
      const cy = this.el.clientHeight / 2;
      const wx = (cx - from.tx) / from.k + ((cx - to.tx) / to.k - (cx - from.tx) / from.k) * e;
      const wy = (cy - from.ty) / from.k + ((cy - to.ty) / to.k - (cy - from.ty) / from.k) * e;
      this.k = k;
      this.tx = cx - wx * k;
      this.ty = cy - wy * k;
      this.applyTransform();
      p.anim = u < 1 ? win.requestAnimationFrame(tick) : 0;
    };
    p.anim = win.requestAnimationFrame(tick);
  }

  // ---------- 缩略图（见 minimap-core.ts） ----------

  private minimap: { el: HTMLElement; map: HTMLCanvasElement; frame: HTMLElement; s: number; o: { x: number; y: number }; bounds: Bounds } | null = null;
  private minimapFrame = 0;

  /** 下一帧重画缩略图（排版、窗格大小、设置变了）；一帧里只画一次 */
  scheduleMinimap(): void {
    if (this.minimapFrame) return;
    this.minimapFrame = this.el.win.requestAnimationFrame(() => {
      this.minimapFrame = 0;
      this.drawMinimap();
    });
  }

  private drawMinimap(): void {
    const layout = this.layout;
    const show =
      !!layout &&
      minimapShown(this.opts.minimap?.() ?? "auto", {
        nodes: layout.placed.size,
        viewW: this.el.clientWidth,
        viewH: this.el.clientHeight,
        embedded: !!this.opts.embedded,
        presenting: !!this.present,
      });
    if (!show || !layout) {
      this.minimap?.el.remove();
      this.minimap = null;
      return;
    }
    let mm = this.minimap;
    if (!mm) {
      const el = this.el.createDiv({ cls: "mm-minimap", attr: { "aria-label": t("canvas.minimap") } });
      const map = el.createEl("canvas");
      const frame = el.createDiv({ cls: "mm-minimap-frame" });
      // 在缩略图上按下、拖动：那一点到画布正中；别让画布当成平移 / 框选
      let dragging = false;
      const go = (ev: PointerEvent) => {
        const m = this.minimap;
        if (!m) return;
        const r = el.getBoundingClientRect();
        const to = centerAt(m.bounds, m.s, ev.clientX - r.left, ev.clientY - r.top, { w: this.el.clientWidth, h: this.el.clientHeight, k: this.k }, m.o);
        this.stopPanAnim();
        this.userView = true;
        this.tx = to.tx;
        this.ty = to.ty;
        this.applyTransform();
      };
      el.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        dragging = true;
        el.setPointerCapture(ev.pointerId);
        go(ev);
      });
      el.addEventListener("pointermove", (ev) => {
        if (dragging) go(ev);
      });
      const stop = () => {
        dragging = false;
      };
      el.addEventListener("pointerup", stop);
      el.addEventListener("pointercancel", stop);
      el.addEventListener("dblclick", (ev) => ev.stopPropagation());
      el.addEventListener("contextmenu", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      });
      el.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
      mm = this.minimap = { el, map, frame, s: 1, o: { x: 0, y: 0 }, bounds: layout.bounds };
    }
    const b = layout.bounds;
    const { s, w, h, ox, oy } = minimapScale(b);
    mm.s = s;
    mm.o = { x: ox, y: oy };
    mm.bounds = b;
    mm.el.setCssStyles({ width: `${w}px`, height: `${h}px` });
    const dpr = this.el.win.devicePixelRatio || 1;
    const cv = mm.map;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.setCssStyles({ width: `${w}px`, height: `${h}px` });
    }
    const ctx = cv.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const css = getComputedStyle(this.el);
      const muted = css.getPropertyValue("--text-muted").trim() || "#888";
      const colors = new Map<string, string>();
      const colorOf = (branch: string | undefined) => {
        if (branch === undefined) return muted;
        let c = colors.get(branch);
        if (c === undefined) {
          c = css.getPropertyValue(`--mm-branch-${branch}`).trim() || muted;
          colors.set(branch, c);
        }
        return c;
      };
      for (const p of layout.placed.values()) {
        const a = toMini(b, s, p.x, p.y, mm.o);
        const el = this.els.get(p.node.id);
        const root = !p.node.parent;
        ctx.globalAlpha = root ? 1 : 0.8;
        ctx.fillStyle = root ? muted : colorOf(el?.dataset.branch);
        // 太小的节点至少画 1.5 像素，看得出有东西
        ctx.fillRect(a.x, a.y, Math.max(1.5, p.w * s), Math.max(1.5, p.h * s));
      }
      ctx.globalAlpha = 1;
    }
    this.placeMinimapFrame();
  }

  /** 视口框：平移、缩放时只挪它，不重画缩略图 */
  private placeMinimapFrame(): void {
    const mm = this.minimap;
    if (!mm) return;
    const r = viewRect(mm.bounds, mm.s, { w: this.el.clientWidth, h: this.el.clientHeight, tx: this.tx, ty: this.ty, k: this.k }, mm.o);
    mm.frame.setCssStyles({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  /** 揭开过的都盖回去 */
  private coverAll(): void {
    this.revealedAnswers.clear();
    this.revealedQuestions.clear();
    for (const m of this.el.querySelectorAll(".mm-label mark.is-revealed")) m.classList.remove("is-revealed");
    this.applyRecite();
    if (this.layout) {
      this.drawCallouts();
      this.drawNotes();
    }
  }

  private async nextReviewCard(): Promise<void> {
    const r = this.mapReview;
    if (!r || !this.doc) return;
    window.clearTimeout(r.timer);
    if (r.node) this.els.get(r.node.id)?.classList.remove("is-review-current");
    this.coverAll();
    const next = r.driver.next();
    if ("done" in next) {
      r.node = null;
      r.kind = null;
      this.paintReviewDone(next.wait, next.note);
      return;
    }
    let hit: MindNode | null = null;
    const find = (n: MindNode) => {
      if (hit) return;
      if (n.reviewId === next.reviewId) hit = n;
      n.children.forEach(find);
      if (n.summary?.topic) find(n.summary.topic);
    };
    find(this.doc.root);
    const node = hit as MindNode | null;
    if (!node) {
      await r.driver.skip();
      return this.nextReviewCard();
    }
    // 藏在折叠里的：临时展开（只改内存），退出时折回去；聚焦在别的分支上就退出聚焦
    if (this.focusRoot && node !== this.focusRoot && !isAncestor(this.focusRoot, node)) this.exitFocus(false);
    let unfolded = false;
    for (let p = node.parent; p; p = p.parent)
      if (p.folded) {
        p.folded = false;
        r.unfolded.push(p);
        unfolded = true;
      }
    if (unfolded) this.render();
    r.node = node;
    r.kind = next.kind;
    r.shown = false;
    r.start = Date.now();
    this.select(node);
    this.els.get(node.id)?.classList.add("is-review-current");
    this.centerOn(node, true);
    this.paintReviewBar(next.counts, next.current);
    this.paintReviewPop();
  }

  private paintReviewBar(counts: [number, number, number], current: 0 | 1 | 2): void {
    const r = this.mapReview;
    if (!r) return;
    r.bar.replaceChildren();
    r.bar.createSpan({ cls: "mm-review-bar-title", text: t("mapReview.title") });
    const c = r.bar.createSpan({ cls: "mm-review-counts" });
    const tips = [t("review.tipNew", { n: counts[0] }), t("review.tipLearn", { n: counts[1] }), t("review.tipReview", { n: counts[2] })];
    counts.forEach((n, i) => {
      if (i) c.appendText(" + ");
      const s = c.createSpan({ cls: `is-c${i}${i === current ? " is-current" : ""}`, text: String(n) });
      this.tip(s, i === current ? `${tips[i]}\n${t("review.tipCurrent")}` : tips[i], "fixed", "bottom");
    });
    const tab = r.bar.createEl("button", { cls: "mm-review-bar-btn", text: t("mapReview.openTab") });
    tab.addEventListener("click", () => {
      const d = r.driver;
      this.endMapReview();
      d.openTab();
    });
    const exit = r.bar.createEl("button", { cls: "mm-review-bar-btn", text: t("mapReview.exit") });
    exit.addEventListener("click", () => this.endMapReview());
  }

  /** 节点下面的浮层：翻面前「显示答案」，翻面后四个评分按钮 */
  private paintReviewPop(): void {
    const r = this.mapReview;
    if (!r) return;
    const pop = r.pop;
    pop.replaceChildren();
    pop.classList.remove("is-done");
    const btn = (cls: string, label: string, sub: string | null, run: () => void) => {
      const b = pop.createEl("button", { cls: `mm-review-btn ${cls}` });
      if (sub !== null) b.createSpan({ cls: "mm-review-iv", text: sub });
      b.createSpan({ cls: "mm-review-name", text: label });
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        run();
      });
      return b;
    };
    if (!r.shown) {
      const b = btn("is-show", t("review.showAnswer"), null, () => this.revealReviewCard());
      // 电脑上写上按键（和复习标签页一样），手机上没有键盘不写
      if (!this.el.ownerDocument.body.classList.contains("is-mobile")) b.createSpan({ cls: "mm-review-kbd", text: t("review.space") });
    }
    else {
      const iv = r.driver.intervals();
      const names = [t("review.again"), t("review.hard"), t("review.good"), t("review.easy")];
      names.forEach((name, i) => btn(`is-g${i + 1}`, name, iv[i], () => void this.gradeReviewCard((i + 1) as 1 | 2 | 3 | 4)));
    }
    this.positionMapReview();
  }

  private paintReviewDone(wait: number | null, note: string): void {
    const r = this.mapReview;
    if (!r) return;
    this.select(null);
    r.bar.querySelector(".mm-review-counts")?.remove();
    const pop = r.pop;
    pop.replaceChildren();
    pop.classList.add("is-done");
    pop.createDiv({ cls: "mm-review-done-title", text: wait ? t("mapReview.waiting") : t("review.doneTitle") });
    if (note) pop.createDiv({ cls: "mm-review-done-note", text: note });
    const row = pop.createDiv({ cls: "mm-review-done-row" });
    const exit = row.createEl("button", { cls: "mm-review-btn is-show", text: t("mapReview.exit") });
    exit.addEventListener("click", () => this.endMapReview());
    // 学习中的卡到了提前出的时间（离到点 20 分钟内）自动接着出
    if (wait) r.timer = window.setTimeout(() => void this.nextReviewCard(), Math.max(1000, wait - Date.now() - 20 * 60_000 + 1000));
    this.positionMapReview();
  }

  private revealReviewCard(): void {
    const r = this.mapReview;
    if (!r?.node || r.shown) return;
    r.shown = true;
    const n = r.node;
    if (r.kind === "cloze") for (const m of this.els.get(n.id)?.querySelectorAll(".mm-label mark") ?? []) m.classList.add("is-revealed");
    else if (r.kind === "answer") this.revealedAnswers.add(n.id);
    else this.revealedQuestions.add(n.id);
    this.applyRecite();
    if (this.layout) {
      this.drawCallouts();
      this.drawNotes();
    }
    this.paintReviewPop();
  }

  private async gradeReviewCard(g: 1 | 2 | 3 | 4): Promise<void> {
    const r = this.mapReview;
    if (!r?.node || !r.shown) return;
    await r.driver.grade(g);
    await this.nextReviewCard();
  }

  /** 浮层跟着节点：放在节点下面，下面放不下放上面；顶栏贴着画布顶 */
  private positionMapReview(): void {
    const r = this.mapReview;
    if (!r) return;
    const pop = r.pop;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const rect = r.node ? this.screenRectOf(r.node) : null;
    let x = w / 2 - pw / 2;
    let y = h / 2 - ph / 2;
    if (rect) {
      x = rect.left + rect.width / 2 - pw / 2;
      y = rect.bottom + 10;
      if (y + ph > h - 8) y = rect.top - ph - 10;
    }
    pop.style.left = `${Math.round(Math.max(8, Math.min(x, w - pw - 8)))}px`;
    pop.style.top = `${Math.round(Math.max(8, Math.min(y, h - ph - 8)))}px`;
  }

  /** 原地复习时的按键（照 Anki）：空格 / 回车翻面，翻面后 = 良好；1–4 评分；⌘Z 撤销；Esc 退出。处理了返回 true */
  private onMapReviewKey(ev: KeyboardEvent): boolean {
    const r = this.mapReview;
    if (!r) return false;
    const mod = ev.metaKey || ev.ctrlKey;
    const done = (fn: () => void) => {
      ev.preventDefault();
      ev.stopPropagation();
      fn();
      return true;
    };
    if (ev.key === "Escape") return done(() => this.endMapReview());
    if (mod && !ev.shiftKey && ev.key.toLowerCase() === "z")
      return done(() => {
        void r.driver.undo().then((ok) => {
          if (ok) void this.nextReviewCard();
        });
      });
    if (mod || ev.altKey) return false;
    if (!r.node) return ev.key === " " ? done(() => undefined) : false;
    if (ev.key === " " || ev.key === "Enter") return done(() => (r.shown ? void this.gradeReviewCard(3) : this.revealReviewCard()));
    if (r.shown && /^[1-4]$/.test(ev.key)) return done(() => void this.gradeReviewCard(Number(ev.key) as 1 | 2 | 3 | 4));
    // 别的键（方向键挪选中、/ 折叠……）在原地复习时都不处理，免得改到图
    if (ev.key.length === 1 || ev.key.startsWith("Arrow") || ev.key === "Tab" || ev.key === "Delete" || ev.key === "Backspace" || ev.key === "F2") return done(() => undefined);
    return false;
  }

  private positionNodebar(): void {
    this.updateImageHandle();
    this.positionRelbar();
    // 只读（包括选中节点后才锁定）时不显示，留着的要收掉
    const show =
      this.opts.editable &&
      this.opts.showNodebar?.() !== false &&
      this.primary &&
      this.selected.size > 0 &&
      !this.quietSel &&
      !this.editing &&
      !this.drag &&
      !this.marquee &&
      this.els.has(this.primary.id);
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
    // 窄屏（手机）放不下一整行就折行：颜色一行、按钮一行
    this.nodebar.style.maxWidth = `${Math.max(160, this.el.clientWidth - 8)}px`;
    // 按钮组掉到颜色组下面一行了，就是折行：藏掉两组之间的竖分隔线
    this.nodebar.classList.remove("is-wrapped");
    const [colors, tools] = this.nodebar.querySelectorAll<HTMLElement>(".mm-nodebar-group");
    this.nodebar.classList.toggle("is-wrapped", !!colors && !!tools && tools.offsetTop >= colors.offsetTop + colors.offsetHeight);
    const bw = this.nodebar.offsetWidth;
    const bh = this.nodebar.offsetHeight;
    const left = Math.max(4, Math.min(r.x + r.width / 2 - bw / 2, this.el.clientWidth - bw - 4));
    // 节点上方有标注气泡时放到气泡上面，不然盖住气泡没法双击编辑
    let above = r.y;
    const bubble = this.calloutEls.get(this.primary!.id);
    if (bubble && bubble.isConnected) {
      const b = bubble.getBoundingClientRect();
      const host = this.el.getBoundingClientRect();
      if (b.bottom - host.top <= r.y + 1) above = Math.min(above, b.top - host.top);
    }
    // 横向时间轴里朝上长的主主题：折叠按钮在节点上面，工具栏放到按钮上方，不然盖住按钮点不到
    const toggle = this.layout?.placed.get(this.primary!.id)?.side === "up" ? this.els.get(this.primary!.id)?.querySelector(".mm-toggle") : null;
    if (toggle) above = Math.min(above, toggle.getBoundingClientRect().top - this.el.getBoundingClientRect().top);
    // 下面：节点下方挂着展开的备注时放到备注下面，同样不盖住它
    const belowTop = () => {
      let below = r.y + r.height;
      const card = this.noteEls.get(this.primary!.id);
      if (card && card.isConnected) {
        const c = card.getBoundingClientRect();
        const host = this.el.getBoundingClientRect();
        if (c.top - host.top >= below - 1) below = Math.max(below, c.bottom - host.top);
      }
      return below + 10;
    };
    const place = this.opts.barPlacement?.() ?? "above";
    if (place === "top") {
      // 固定在画布顶部正中，不跟着节点走；主工具栏也在顶部时放在它下面
      this.nodebar.style.left = `${Math.max(4, (this.el.clientWidth - bw) / 2)}px`;
      this.nodebar.style.top = `${this.topBarInset()}px`;
      this.nodebar.classList.remove("is-hidden");
      return;
    }
    let top: number;
    if (place === "below") {
      // 下面放不下改放上面
      top = belowTop();
      if (top + bh > this.el.clientHeight - 4 && above - bh - 10 >= 4) top = above - bh - 10;
    } else {
      // 上面放不下改放下面
      top = above - bh - 10;
      if (top < 4) top = belowTop();
    }
    this.nodebar.style.left = `${left}px`;
    this.nodebar.style.top = `${top}px`;
    const hidden = r.y + r.height < 0 || r.y > this.el.clientHeight || r.x + r.width < 0 || r.x > this.el.clientWidth;
    this.nodebar.classList.toggle("is-hidden", hidden);
  }

  /** 固定在画布顶部的浮动栏离顶边多远：主工具栏也在顶部时让开它 */
  private topBarInset(): number {
    if (this.toolbarPos !== "top" || !this.toolbar?.isConnected || this.toolbar.offsetParent === null) return 8;
    const t = this.toolbar.getBoundingClientRect();
    return Math.max(8, t.bottom - this.el.getBoundingClientRect().top + 6);
  }

  /** 设置里的节点颜色；没设过（或嵌入的图没传）就是内置的九种 */
  private nodeColors(): string[] {
    return this.opts.nodeColors?.() ?? [...COLOR_NAMES];
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

  /** 右键菜单：点在节点上弹节点菜单（顺带选中它），否则弹空白处的菜单 */
  private contextMenuAt(ev: MouseEvent, pressed?: MindNode): void {
    const nodeEl = (ev.target as HTMLElement | null)?.closest?.<HTMLElement>(".gg-mm-node");
    const node = pressed ?? (nodeEl ? this.nodeFromEl(nodeEl) : null);
    if (node) {
      if (this.editing === node) return;
      if (this.editing) this.commitEdit();
      if (!this.selected.has(node)) this.select(node);
      else this.setPrimary(node);
      this.showContextMenu(this.nodeMenuEntries(node), ev);
      return;
    }
    this.showBackgroundMenu(ev);
  }

  private bindEvents(): void {
    const el = this.el;

    this.on(el, "pointerdown", (ev) => {
      if (this.opts.embedded) ev.stopPropagation();
      const target = ev.target as HTMLElement;
      if (target.closest(".mm-toolbar, .mm-popover, .mm-nodebar")) return;
      // 双击有两条路（原生 dblclick 和 pointerup 自判定），两条都得知道有没有落在挡板上
      this.downOnShield = !!target.closest(".mm-frame-shield");
      this.downOnPreview = target.closest<HTMLElement>(".mm-map-preview")?.dataset.key ?? null;
      this.downOnImage = this.imageAt(target, ev.clientX, ev.clientY);
      const nodeEl = target.closest<HTMLElement>(".gg-mm-node");
      // 点到节点（包括定位过来、已经选中的那个）：浮动工具栏照常出
      if (nodeEl && this.quietSel) {
        this.quietSel = false;
        this.positionNodebar();
      }
      this.cancelTapCenter();
      // 第一根手指按下：之前记着的按点都是没收到松开的（iPhone 长按弹出菜单后，松手落在菜单上，画布收不到）。
      // 不清掉的话这一下会被当成双指缩放，点哪里都没反应、取消不了选中
      if (ev.isPrimary && ev.pointerType !== "mouse" && this.pointers.size) this.dropTouch();
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
        if (ev.button === 2 && ev.pointerType === "mouse") {
          // 右键按住拖动平移画布，按在节点上也行（节点密的图里不用找空白）；没拖动就松开，照常弹节点菜单
          if (this.editing) this.commitEdit();
          this.closePopover();
          this.el.focus({ preventScroll: true });
          this.capture(ev);
          this.pendingMenu = null;
          this.pan = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, moved: false, onNode: true, button: 2, menuNode: node };
          return;
        }
        if (this.editing) this.commitEdit();
        this.closePopover();
        // 先拿焦点再选中：选中会通知分屏联动，联动见旁边的 Markdown 编辑器还有焦点会当成用户在那边打字、不跳过去
        this.el.focus({ preventScroll: true });
        if (ev.shiftKey) {
          if (!this.selectRange(node)) this.select(node, "add");
        } else if (ev.metaKey || ev.ctrlKey) {
          this.select(node, "toggle");
          this.rangeAnchor = node.id;
        } else if (!this.selected.has(node)) {
          this.select(node, "replace");
          this.rangeAnchor = node.id;
        } else {
          this.rangeAnchor = node.id;
          // 点的是已经选中的节点（比如 Markdown 光标就在这一行，脑图跟着选中了它）：选中没变也照样通知，联动才会跳回去
          this.setPrimary(node);
          this.opts.onSelectionChange?.(this.primary, [...this.selected]);
        }
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
        } else if (ev.button === 0 && !isSummaryTopic(node)) {
          // 概要主题跟着括住的范围走，不能拖去排序（往它下面拖别的节点照常）
          this.pendingDrag = { node, x: ev.clientX, y: ev.clientY };
        }
        return;
      }
      // 框选模式（XMind 的习惯）：鼠标左键拖空白处框选，右键 / 中键拖动平移；触屏、触控笔照旧拖动平移
      const marqueeMode = ev.pointerType === "mouse" && !!this.opts.marqueeDrag?.();
      // 右键拖空白处平移：框选模式下一直有；平移模式下鼠标右键也能拖（和按在节点上一样）
      if (ev.button !== 0 && ev.button !== 1 && !(ev.button === 2 && (marqueeMode || ev.pointerType === "mouse"))) return;
      if (this.editing) this.commitEdit();
      this.closePopover();
      this.el.focus({ preventScroll: true });
      this.capture(ev);
      this.pendingMenu = null;
      if (ev.button === 0) this.activateGroup(null);
      if (ev.button === 0 && (ev.shiftKey || marqueeMode)) {
        this.startMarquee(ev, ev.shiftKey || ev.metaKey || ev.ctrlKey);
        return;
      }
      this.pan = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, moved: false, button: ev.button };
    });

    this.on(el, "pointermove", (ev) => {
      // 松手事件丢了（按住时切走窗口、弹出了对话框……）：鼠标其实没按着，画布还以为在拖。
      // 不收掉的话，之后鼠标一动就按「按下时的位置 + 移动距离」重设视口，滚轮滚的位移马上被拉回去，看起来像滚轮失效、
      // 图还跟着鼠标走，点一下才好。只对鼠标这样判断（触屏、手写笔的 buttons 不可靠）
      if (ev.pointerType === "mouse" && ev.buttons === 0 && (this.pan || this.drag || this.marquee || this.pendingDrag)) {
        endPointer(ev);
        return;
      }
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = el.getBoundingClientRect();
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (this.pinch.k * dist) / this.pinch.dist));
        this.userZoomBy(next / this.k, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
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
      this.panTo(this.pan.tx + dx, this.pan.ty + dy);
    });

    const endPointer = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.marquee) {
        const tap = !this.marquee.moved && ev.type === "pointerup";
        this.endMarquee();
        // 框选模式下没拖动的单击：和平移模式一样，点在外框空白处就选中外框
        if (tap && this.opts.editable && !this.selected.size) this.activateGroup(this.boxAt(ev.clientX, ev.clientY));
      }
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
          else if (this.downOnPreview) this.setLivePreview(this.downOnPreview);
          else if (this.downOnImage) this.openLightbox(this.downOnImage);
          else this.editOnDoubleTap(tapped);
        } else {
          this.lastTap = { node: tapped, time: now };
          // 单击选中后居中：等过了双击的间隔再挪，免得第二下点空；按着 Shift/⌘ 多选时不挪
          if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey && this.opts.centerOnSelect?.()) this.scheduleTapCenter(tapped);
        }
      } else if (ev.type === "pointerup") {
        this.lastTap = null;
      }
      if (this.pan) {
        const { moved, onNode, button, menuNode } = this.pan;
        this.pan = null;
        if (button === 2) {
          const menu = this.pendingMenu;
          this.pendingMenu = null;
          if (moved) this.suppressMenuUntil = performance.now() + 500;
          else if (menu && ev.type === "pointerup") this.contextMenuAt(menu, menuNode);
          // Windows 松开后才发 contextmenu：没拖动的话，它来的时候按节点弹
          else if (!menu && !moved) this.pendingMenuNode = menuNode ?? null;
        } else if (!moved && !onNode) {
          this.select(null, "replace");
          // 点在外框里的空白处：选中这个外框，两端出现范围手柄
          this.activateGroup(this.opts.editable && ev.type === "pointerup" ? this.boxAt(ev.clientX, ev.clientY) : null);
        }
      }
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    };
    this.on(el, "pointerup", endPointer);
    this.on(el, "pointercancel", endPointer);

    this.on(
      el,
      "wheel",
      (ev) => {
        // 备注弹窗、链接补全这类菜单自己能滚，滚轮留给它们，不拿去平移缩放画布；缩略图上滚轮也不动画布
        if ((ev.target as HTMLElement).closest(".mm-popover, .mm-menu, .mm-minimap")) {
          if (this.opts.embedded) ev.stopPropagation();
          return;
        }
        // 嵌入的脑图还没点过：滚轮交给页面（滚着看笔记时不会突然变成在滚脑图），提示一下怎么用；⌘ / Ctrl + 滚轮照样缩放
        if (this.opts.embedded && !this.wheelActive && !(ev.ctrlKey || ev.metaKey) && this.opts.embedWheelLock?.()) {
          this.showWheelHint();
          return;
        }
        // 一次滑动（连同触控板松手后的惯性）只归一样东西：开头落在哪就一直是哪，
        // 从画布开始的平移扫过表格节点不会被截住，在表格里开始的滚到头也不会把画布甩出去
        const now = performance.now();
        const zoom = ev.ctrlKey || ev.metaKey;
        const latched = this.wheelLatch && now - this.wheelLatch.at < 220 ? this.wheelLatch : null;
        const scroller = zoom ? null : latched ? latched.target : this.wheelTargetAt(ev);
        this.wheelLatch = zoom ? null : { target: scroller, at: now };
        if (scroller?.isConnected) {
          ev.preventDefault();
          if (this.opts.embedded) ev.stopPropagation();
          const k = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
          // Shift + 滚轮：有的系统不把竖着滚换成横向，自己换
          const dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX;
          const dy = ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY;
          scroller.scrollLeft += dx * k;
          scroller.scrollTop += dy * k;
          return;
        }
        ev.preventDefault();
        if (this.opts.embedded) ev.stopPropagation();
        const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
        const rect = el.getBoundingClientRect();
        if (ev.ctrlKey || ev.metaKey) {
          // 触控板捏合也走这里（浏览器会带上 ctrlKey），每次的量很小，按原样连续缩放；
          // 鼠标滚轮一格的量约 100，原样算一格就是 2.7 倍，和直接缩放一样限幅成每格约 1.2 倍
          const raw = ev.deltaY * scale;
          const notch = ev.deltaMode !== 0 || Math.abs(raw) >= 50;
          const d = notch ? Math.max(-100, Math.min(100, Math.sign(raw) * Math.max(Math.abs(raw), 100))) * 0.18 : raw;
          this.userZoomBy(Math.exp(-d * 0.01), ev.clientX - rect.left, ev.clientY - rect.top);
        } else if (!ev.shiftKey && this.opts.wheelZoom?.()) {
          // 鼠标一格 deltaY 约 100，限幅后每格约 1.2 倍，和工具栏 +/- 一致
          const d = Math.max(-100, Math.min(100, ev.deltaY * scale));
          this.userZoomBy(Math.exp(-d * 0.0018), ev.clientX - rect.left, ev.clientY - rect.top);
        } else if (ev.shiftKey && !ev.deltaX) {
          // Shift + 滚轮左右平移：有的系统不会把竖着滚换成横向（deltaX 还是 0），这里自己换
          this.panTo(this.tx - ev.deltaY * scale, this.ty);
        } else {
          this.panTo(this.tx - ev.deltaX * scale, this.ty - ev.deltaY * scale);
        }
      },
      { passive: false },
    );

    // 实时预览里代码块嵌在 CodeMirror 的可编辑区域中，mousedown 的默认行为会把焦点从画布上拿走，
    // 之后回车、Tab 就没反应了。画布自己在 pointerdown 时已经拿了焦点，这里只拦默认行为
    if (this.opts.embedded) {
      this.on(el, "mousedown", (ev) => {
        // 外层的 cm-content 本身就是 contenteditable，只看画布里面的输入框和正在编辑的标签
        const field = (ev.target as HTMLElement).closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
        if (field && el.contains(field)) return;
        ev.preventDefault();
      });
      const releaseKeys = this.opts.host?.claimKeys?.(el, (ev) => this.onKeyDown(ev));
      if (releaseKeys) this.disposers.push(releaseKeys);
      // 嵌入的图点到外面（正文、白板空白处）就取消选中，节点浮动栏跟着收起来。
      // 画布自己的菜单、弹层和 Obsidian 的菜单、弹窗、悬停预览可能挂在 body 上，不算外面；
      // 正在编辑的标签先由它自己的 blur 提交，等它提交完再取消选中
      this.on(
        this.el.doc,
        "pointerdown",
        (ev) => {
          const target = ev.target as HTMLElement;
          if (el.contains(target)) {
            // 点了这张嵌入的脑图：滚轮开始归它（点到外面再还给页面）
            this.wheelActive = true;
            return;
          }
          if (target.closest?.(".mm-menu, .mm-popover, .menu, .modal-container, .suggestion-container, .popover")) return;
          this.wheelActive = false;
          if (!this.selected.size) return;
          window.setTimeout(() => {
            if (!el.isConnected || this.editing || !this.selected.size) return;
            this.select(null);
          });
        },
        { capture: true },
      );
    }

    // 激活着的脑图预览：点到它外面（画布上、页面别处）就退出
    this.on(
      el.ownerDocument,
      "pointerdown",
      (ev) => {
        const live = this.livePreview ? this.mapPreviews.get(this.livePreview) : null;
        if (live && !live.el.contains(ev.target as Node)) this.setLivePreview(null);
      },
      { capture: true },
    );
    this.on(el, "dblclick", (ev) => {
      if (this.opts.embedded) ev.stopPropagation();
      const nodeEl = (ev.target as HTMLElement).closest<HTMLElement>(".gg-mm-node");
      const node = nodeEl && this.nodeFromEl(nodeEl);
      if (!node) {
        // 双击外框里的空白处：直接编辑外框标题（没有标题就加一个）
        const box = this.opts.editable && !(ev.target as HTMLElement).closest(".mm-toolbar, .mm-nodebar, .mm-popover, .mm-menu, .mm-box-title")
          ? this.boxAt(ev.clientX, ev.clientY)
          : null;
        if (box) {
          ev.preventDefault();
          this.editBoxTitle(box);
          return;
        }
        // 双击空白处：在这里新建一个自由主题（和 XMind 一样）
        const blank = !(ev.target as HTMLElement).closest(".mm-toolbar, .mm-nodebar, .mm-popover, .mm-menu, .mm-box-title, .mm-summary, .mm-range-handle, .mm-crumbs, .gg-mm-search, .mm-outline");
        if (blank && this.canFloat()) {
          ev.preventDefault();
          this.createFloatAt(this.toWorld(ev.clientX, ev.clientY));
        }
        return;
      }
      ev.preventDefault();
      // 双击节点里嵌入的脑图预览：激活它（和视频的挡板一样），不进编辑
      const preview = (ev.target as HTMLElement).closest<HTMLElement>(".mm-map-preview");
      if (preview?.dataset.key) {
        this.setLivePreview(preview.dataset.key);
        return;
      }
      const img = this.imageAt(ev.target as HTMLElement, ev.clientX, ev.clientY);
      if ((ev.target as HTMLElement).closest(".mm-frame-shield")) this.setLiveFrame(node.id);
      else if (img) this.openLightbox(img);
      else this.editOnDoubleTap(node);
    });

    // 悬停调宽度：记下鼠标指着哪个节点；按着键（拖动、平移、框选）时不算
    this.on(el, "pointerover", (ev) => {
      if (ev.pointerType === "touch") return;
      const nodeEl = ev.buttons ? null : (ev.target as HTMLElement).closest<HTMLElement>(".gg-mm-node");
      this.setHoverNode(nodeEl ? this.nodeFromEl(nodeEl) : null);
    });
    this.on(el, "pointerleave", () => this.setHoverNode(null));

    // 链接节点的悬停预览：用一个委托监听，元素复用时不会重复绑定
    this.on(el, "mouseover", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest("a.internal-link")) return;
      const nodeEl = target.closest<HTMLElement>(".gg-mm-node.is-linked");
      const linktext = nodeEl?.dataset.link;
      // 预览插件会盯着 targetEl 判断鼠标是否还停着，所以传节点本身
      if (nodeEl && linktext) this.opts.host?.hoverLink?.(ev, linktext, nodeEl);
    });

    this.on(el, "keydown", (ev) => this.onKeyDown(ev));

    // 背诵模式：单击揭开遮住的高亮或题目答案；拖动过的不算
    this.on(el, "pointerdown", (ev) => (this.reciteDown = { x: ev.clientX, y: ev.clientY }), { capture: true });
    this.on(el, "click", (ev) => this.onReciteClick(ev));

    this.on(el, "contextmenu", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".mm-toolbar, .mm-popover, .mm-nodebar, .gg-mm-search, .mm-menu, .mm-crumbs")) return;
      ev.preventDefault();
      if (this.opts.embedded) ev.stopPropagation();
      // 右键正按着、可能要拖动平移（macOS 按下就发 contextmenu）：等松开再决定弹不弹
      if (this.pan?.button === 2) {
        this.pendingMenu = ev;
        return;
      }
      // Windows 松开后才发：刚拖完平移的那一下不弹
      if (performance.now() < this.suppressMenuUntil) return;
      // 触屏长按弹菜单：这一按变成了菜单，不再拖节点、平移
      if (this.touchPress || (this.drag && !ev.button && this.pointers.size)) this.dropTouch();
      const pressed = this.pendingMenuNode;
      this.pendingMenuNode = null;
      this.contextMenuAt(ev, pressed ?? undefined);
    });

    // 拖入笔记 / 图片文件
    this.on(el, "dragover", (ev) => {
      if (!this.opts.editable) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      const nodeEl = (ev.target as HTMLElement).closest<HTMLElement>(".gg-mm-node");
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
      // 从自己的备注弹窗里拖出来的（图片、选中的文字）不算拖入，免得一失手就多出节点
      if (this.dragFromPopover) {
        this.dragFromPopover = false;
        this.dropHover?.classList.remove("is-drop-target");
        this.dropHover = null;
        return;
      }
      if (this.opts.embedded) ev.stopPropagation();
      const targetEl = this.dropHover ?? (ev.target as HTMLElement).closest<HTMLElement>(".gg-mm-node");
      this.dropHover?.classList.remove("is-drop-target");
      this.dropHover = null;
      const target = (targetEl && this.nodeFromEl(targetEl)) ?? this.primary ?? this.doc?.root ?? null;
      if (target) void this.handleDrop(ev, target);
    });

    const onPaste = (ev: ClipboardEvent) => {
      // 编辑中的粘贴归编辑框（图片在 startEdit 的 onPaste 里处理）
      if (!this.opts.editable || this.editing) return;
      const t = ev.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable) return;
      const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      const text = ev.clipboardData?.getData("text/plain") ?? "";
      if (!files.length && !text.trim()) return;
      ev.preventDefault();
      if (this.opts.embedded) ev.stopPropagation();
      if (files.length) void this.insertImageFiles(files, this.pasteTarget());
      else this.pasteText(text);
    };
    this.on(el, "paste", onPaste);

    // 浏览器把粘贴事件发给页面上选区所在的元素，不看焦点：PDF 里刚选过文字（PDF++ 选中即复制）、
    // 选区还留在 PDF 上时，点节点再 ⌘V，事件落在 PDF 的文字层，画布收不到。焦点在画布上就接过来
    this.on(el.ownerDocument, "paste", (ev) => {
      if (el.contains(ev.target as Node) || el.ownerDocument.activeElement !== el) return;
      onPaste(ev);
    });
  }

  private onKeyDown(ev: KeyboardEvent): void {
    // 被 claimKeys 截下来处理过的按键，冒泡到画布时不再处理第二遍
    if (this.keysHandled.has(ev)) return;
    this.keysHandled.add(ev);
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
  /**
   * 指针下的节点图片。图片设了 pointer-events: none（免得浏览器原生拖图片和拖节点抢），
   * 事件目标永远是外面的 label，所以按坐标判断落没落在图片上
   */
  private imageAt(target: HTMLElement, x: number, y: number): HTMLImageElement | null {
    const nodeEl = target.closest<HTMLElement>(".gg-mm-node");
    if (!nodeEl) return null;
    for (const img of nodeEl.querySelectorAll<HTMLImageElement>("img.mm-img")) {
      const r = img.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return img;
    }
    return null;
  }

  /** 全窗口看原图：暗底、按窗口大小居中，点任意处或 Esc 关 */
  private openLightbox(img: HTMLImageElement): void {
    if (this.lightbox) return;
    const doc = this.el.ownerDocument;
    const box = doc.body.createDiv({ cls: "mm-lightbox" });
    box.createEl("img", { attr: { src: img.currentSrc || img.src, alt: img.alt } });
    const close = () => {
      box.remove();
      doc.removeEventListener("keydown", onKey, true);
      this.lightbox = null;
      this.el.focus({ preventScroll: true });
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
    };
    box.addEventListener("click", close);
    doc.addEventListener("keydown", onKey, true);
    this.lightbox = box;
  }

  private editOnDoubleTap(node: MindNode): void {
    if (this.opts.onOpenFile) {
      this.opts.onOpenFile();
      return;
    }
    if (!this.opts.editable) {
      if (!this.opts.embedded) return;
      this.setEditable(true);
    }
    this.startEdit(node);
  }

  private handleKey(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    const target = ev.target as HTMLElement;
    if (target.closest(".gg-mm-search")) return;
    // 输入法组字中的回车、Esc、Tab 归输入法（回车上屏英文、Esc 取消组字）；
    // 这时提交编辑会把拼音里的分隔符（自带输入法的空格、搜狗的 '）一起存进去
    if (ev.isComposing || ev.keyCode === 229) return;
    // 演示：翻页、全图、Esc 归演示，别的会改图的键都不处理
    if (this.present && this.onPresentKey(ev)) return;
    // 原地复习：空格、1–4、⌘Z、Esc 归复习
    if (this.mapReview && target.tagName !== "TEXTAREA" && this.onMapReviewKey(ev)) return;
    // 聚焦分支时 PageUp / PageDown 切到上一个 / 下一个同级分支（像翻 PPT，#43）
    if (this.focusRoot && !this.editing && target.tagName !== "TEXTAREA" && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key === "PageUp" || ev.key === "PageDown")) {
      ev.preventDefault();
      this.focusStep(ev.key === "PageUp" ? -1 : 1);
      return;
    }
    // 用户把这个键绑给了本插件的命令（比如 ⌘↵ = 在前面插入）：画布不抢，命令自己会先提交编辑
    if (!this.linkSuggest && target.tagName !== "TEXTAREA" && this.opts.ownsHotkey?.(ev)) return;
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
      } else if ((ev.key === "ArrowUp" || ev.key === "ArrowDown") && !mod && !ev.shiftKey && !ev.altKey && this.nodeEditor?.view.dom.contains(ev.target as Node) && this.nodeEditor.atEdge(ev.key === "ArrowUp" ? "up" : "down")) {
        // 光标已经在第一行 / 最后一行：跳到上一个 / 下一个节点接着编辑，光标放在末尾（B站反馈：用脑图连续改字更快）。
        // 往哪走和没在编辑时按方向键一样；那边没有节点就留在原地，光标挪到开头 / 末尾
        ev.preventDefault();
        const from = this.editing;
        this.commitEdit();
        this.navigate(from, ev.key);
        const next = this.primary ?? from;
        this.startEdit(next, false, next !== from ? "end" : ev.key === "ArrowUp" ? "start" : "end");
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        this.commitEdit();
        this.addChildToSelected();
      } else if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "k" && this.opts.host?.pickNote) {
        // 编辑中 ⌘K：选中的那段字做成笔记链接；没选中就把整个节点做成链接
        ev.preventDefault();
        void this.linkEditSelection();
      } else if (mod && !ev.shiftKey && !ev.altKey && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
        // 编辑中 ⌘B / ⌘I / ⌘U 作用于选中的那段文字
        ev.preventDefault();
        const k = ev.key.toLowerCase();
        this.formatText({ kind: k === "b" ? "bold" : k === "i" ? "italic" : "underline" });
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
    // ⌘⇧M：添加 / 编辑选中节点的备注（B站反馈：找不到添加备注的快捷键）。⌘⇧N 是 Obsidian 自己的「在新标签页新建笔记」，先被它拿走了
    if (mod && ev.shiftKey && !ev.altKey && ev.code === "KeyM") {
      if (this.opts.editable && this.primary) {
        ev.preventDefault();
        this.toggleNotePopover(this.primary, true);
      }
      return;
    }
    if (mod && ev.shiftKey && ev.key.toLowerCase() === "b") {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        this.toggleBoxOnSelected();
      }
      return;
    }
    // ⌘] 加 / 去概要（和 XMind 一样）
    if (mod && !ev.altKey && ev.code === "BracketRight") {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        this.toggleSummaryOnSelected();
      }
      return;
    }
    // ⌘L 任务复选框：有就去掉、没有就加（和 Obsidian 编辑器里切换待办同一个键）
    if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "l") {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        this.toggleTaskOnSelected();
      }
      return;
    }
    // Home：选中中心主题（聚焦时是聚焦的那个），移到画面中间，缩放不变
    if (ev.key === "Home" && !mod && !ev.altKey && !ev.shiftKey) {
      const root = this.focusRoot ?? this.doc?.root;
      const c = root ? this.centerOf(root) : null;
      if (root && c) {
        ev.preventDefault();
        this.select(root);
        this.panTo(this.el.clientWidth / 2 - c.x * this.k, this.el.clientHeight / 2 - c.y * this.k);
      }
      return;
    }
    if (mod && !ev.shiftKey && !ev.altKey && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
      if (this.opts.editable && this.selected.size) {
        ev.preventDefault();
        const k = ev.key.toLowerCase();
        this.formatText({ kind: k === "b" ? "bold" : k === "i" ? "italic" : "underline" });
      }
      return;
    }
    if (mod && (ev.key === "=" || ev.key === "+")) {
      ev.preventDefault();
      this.userZoomBy(1.2);
      return;
    }
    if (mod && ev.key === "-") {
      ev.preventDefault();
      this.userZoomBy(1 / 1.2);
      return;
    }
    if (mod && ev.shiftKey && (ev.key === "0" || ev.code === "Digit0")) {
      ev.preventDefault();
      if (this.primary) this.fitBranch(this.primary);
      return;
    }
    // ⇧0 折叠全部子分支（和 0 展开全部成对）；= / - 展开一级、折叠一级
    if (!mod && !ev.altKey && ev.shiftKey && ev.code === "Digit0") {
      ev.preventDefault();
      this.collapseBranch(this.primary);
      return;
    }
    if (!mod && !ev.altKey && (ev.code === "Equal" || ev.code === "Minus")) {
      ev.preventDefault();
      this.stepFoldLevel(this.primary, ev.code === "Equal" ? 1 : -1);
      return;
    }
    // 数字键：选中节点往下只显示 N 层，0 = 这一支全部展开；选中的是根或没选就是整张图。
    // ⌘1–9 是 Obsidian 切标签页，不占
    if (!mod && !ev.altKey && !ev.shiftKey && /^Digit[0-9]$/.test(ev.code)) {
      ev.preventDefault();
      const n = Number(ev.code.slice(5));
      this.setFoldLevel(n === 0 ? null : n, this.primary);
      return;
    }
    if (mod && ev.key === "0") {
      ev.preventDefault();
      this.userFit();
      return;
    }
    if (ev.key === "Escape") {
      this.closePopover();
      this.closeMarkerPicker();
      if (!this.selected.size && this.focusRoot) {
        this.exitFocus();
        return;
      }
      // 禅模式排在最后：没有选中、没有聚焦了，再按 Esc 才退出
      if (!this.selected.size && !this.activeGroup && !this.activeRel && this.zen) {
        this.setZen(false);
        return;
      }
      this.select(null, "replace");
      this.activateGroup(null);
      return;
    }
    if (this.activeRel && !this.selected.size && this.opts.editable) {
      const src = this.doc && this.relSource(this.activeRel);
      if (src && (ev.key === "Delete" || ev.key === "Backspace")) {
        ev.preventDefault();
        this.deleteRel(src, this.activeRel);
        return;
      }
      if (src && (ev.key === "Enter" || ev.key === "F2" || ev.key === " ")) {
        ev.preventDefault();
        this.editRelLabel(this.activeRel);
        return;
      }
    }
    const sel = this.primary;
    // 点选了概要文字（没有选中节点）时按 Tab：给概要加子主题
    if (!sel && ev.key === "Tab" && !ev.shiftKey && this.opts.editable && this.activeGroup?.summary && this.summaryLabels.get(this.activeGroup.id)?.classList.contains("is-active")) {
      ev.preventDefault();
      this.addTopicChild(this.activeGroup);
      return;
    }
    if (!sel) return;
    if (ev.altKey && this.opts.editable && ev.key.startsWith("Arrow")) {
      // Alt+↑↓ 在兄弟间排序，Alt+←→ 升降级
      ev.preventDefault();
      this.moveSelection(ev.key === "ArrowUp" ? "up" : ev.key === "ArrowDown" ? "down" : ev.key === "ArrowLeft" ? "outdent" : "indent");
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
        this.followSelection(this.primary);
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
        // ⌘⌫ 只删这一个节点，子节点接到它原来的位置
        if (mod) this.deleteOnlySelected();
        else this.deleteSelected();
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
    const hit = this.nodeById.get(id);
    if (hit) return hit;
    let found: MindNode | null = null;
    walkMap(this.doc.root, (n) => {
      if (n.id === id) found = n;
    });
    return found;
  }

  /** 从别处定位过来选中的（分屏联动、点链接跳过来、从 Markdown 切过来）：不弹浮动工具栏；在这张图里点一下、键盘挪一下就照常出（zhiqiang 反馈） */
  private quietSel = false;

  private quietSelect(): void {
    this.quietSel = true;
    this.positionNodebar();
  }

  select(node: MindNode | null, mode: "replace" | "add" | "toggle" = "replace"): void {
    this.quietSel = false;
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

  /** Shift 连选的起点：上次不按 Shift 点的节点（按编号记，重新解析后还认得） */
  private rangeAnchor: string | null = null;

  /**
   * Shift 连选（B 站晓兔的建议，和文件管理器一样：Shift 连选、⌘ / Ctrl 加选）：起点和 node 是同级时，
   * 选中两者之间的整段兄弟节点，起点不动，再按 Shift 点别处就换一段；起点没了或不是同级返回 false，照旧加选
   */
  private selectRange(node: MindNode): boolean {
    // 记下的起点已经不在选中里了（之后用方向键、点空白处换过选中）：从当前选中的节点算
    const kept = this.rangeAnchor !== null ? this.nodeById.get(this.rangeAnchor) : undefined;
    const anchor = kept && this.selected.has(kept) ? kept : this.primary;
    if (!anchor || anchor === node || !node.parent || anchor.parent !== node.parent) return false;
    const sibs = visibleChildren(node.parent);
    const i = sibs.indexOf(anchor);
    const j = sibs.indexOf(node);
    if (i < 0 || j < 0) return false;
    this.rangeAnchor = anchor.id;
    this.selected.clear();
    for (const n of sibs.slice(Math.min(i, j), Math.max(i, j) + 1)) this.selected.add(n);
    this.primary = node;
    this.syncSelectionClasses();
    return true;
  }

  private setPrimary(node: MindNode): void {
    this.primary = node;
    this.positionNodebar();
  }

  private selectAll(): void {
    if (!this.doc) return;
    this.selected.clear();
    walkMap(this.doc.root, (n) => {
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
    if (this.selected.size) this.activeGroup = null;
    if (this.selected.size && this.activeRel) this.activateRel(null);
    this.syncRangeHandles();
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
    // 混合结构：node 的子节点按 own 排，node 自己在兄弟里按 structure（它父节点的子节点那一层）排
    const own = this.kidsStructure(node);
    const structure = node.parent && node !== (this.focusRoot ?? this.doc?.root) ? this.kidsStructure(node.parent) : own;
    // 概要主题往回走到它括住的第一个兄弟；被括住的节点没有子节点时，往子节点方向走就到概要主题
    const back = (n: MindNode) => {
      if (isSummaryTopic(n)) this.select(n.topicOf!);
      else if (n.parent && !this.isFloating(n)) this.select(n.parent);
    };
    const forward = (kids: MindNode[]) => {
      if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
      else {
        const topic = this.summaryOf(node)?.summary?.topic;
        if (topic && this.layout?.placed.has(topic.id)) this.select(topic);
      }
    };
    // 时间轴、鱼骨图：node 是主轴的根（中心主题或设了这个结构的分支），或者是它的主主题
    const root = this.isStructureRoot(node);
    if (root && isTimeline(own) && this.navigateTimeline(node, p, key, forward, node, own)) return;
    if (root && isFishbone(own) && this.navigateFishbone(node, p, key, forward, node, own)) return;
    const parent = node.parent;
    if (parent && this.isStructureRoot(parent) && !this.isFloating(node)) {
      if (isTimeline(structure) && this.navigateTimeline(node, p, key, forward, parent, structure)) return;
      if (isFishbone(structure) && this.navigateFishbone(node, p, key, forward, parent, structure)) return;
    }
    // 设了自己结构的分支根：朝它子节点长的方向进到子节点，其余按它在父节点那一层的结构走（回父节点、找兄弟）
    // （时间轴、鱼骨图沿主轴进到主主题，上面已经处理过了）
    if (root && own !== structure && !isTimeline(own) && !isFishbone(own)) {
      const into = own === "org-down" ? "ArrowDown" : own === "logic-right" && this.layout.placed.get(visibleChildren(node)[0]?.id ?? "")?.side === "left" ? "ArrowLeft" : "ArrowRight";
      if (key === into) {
        const kids = visibleChildren(node);
        if (kids.length && own === "tree-right") this.select(kids[0]);
        else forward(kids);
        return;
      }
    }
    if (structure === "org-down") {
      // 向下结构：上下是父子，左右在兄弟间找最近的
      if (key === "ArrowDown") {
        forward(visibleChildren(node));
        return;
      }
      if (key === "ArrowUp") {
        back(node);
        return;
      }
      this.selectNearest(p, key === "ArrowLeft" ? "left" : "right");
      return;
    }
    // 鱼骨图的分支里面是树形图（二级主题往下缩进挂三级），按树形图走
    if (structure === "tree-right" || isTimelineH(structure) || isFishbone(structure)) {
      if (key === "ArrowRight") {
        const kids = visibleChildren(node);
        if (kids.length) this.select(kids[0]);
        else forward(kids);
        return;
      }
      if (key === "ArrowLeft") {
        back(node);
        return;
      }
      this.selectNearest(p, key === "ArrowUp" ? "up" : "down");
      return;
    }
    const towardChildren = (key === "ArrowRight" && p.side === "right") || (key === "ArrowLeft" && p.side === "left");
    if (key === "ArrowLeft" || key === "ArrowRight") {
      if (node.depth === 0) {
        const kids = visibleChildren(node).filter((c) => !this.isFloating(c) && this.layout!.placed.get(c.id)?.side === (key === "ArrowRight" ? "right" : "left"));
        if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
        return;
      }
      // 自由主题没有连到中心主题，往回走不到中心主题
      if (towardChildren) forward(visibleChildren(node));
      else back(node);
      return;
    }
    this.selectVertical(node, p, key === "ArrowUp" ? -1 : 1);
  }

  /**
   * 时间轴：中心主题和主主题沿主轴走（横向 ←→、纵向 ↑↓），朝分支长的方向进到分支里；
   * 分支里面照它自己的结构走（横向的分支是树形图，纵向的是逻辑图），交给 navigate 的通用逻辑。返回是否处理了
   */
  /** base：这条主轴的根（中心主题，或设了时间轴结构的分支）；structure：它的结构 */
  private navigateTimeline(node: MindNode, p: Placed, key: string, forward: (kids: MindNode[]) => void, base: MindNode, structure: Structure): boolean {
    if (!this.layout) return false;
    const horiz = isTimelineH(structure);
    const mains = visibleChildren(base).filter((c) => !this.isFloating(c) && this.layout!.placed.has(c.id));
    const along = horiz ? (key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0) : key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
    if (node === base) {
      if (along > 0 && mains.length) {
        this.select(mains[0]);
        return true;
      }
      // 分支自己的时间轴：别的方向键交给它在父节点那一层的走法（回父节点、找兄弟）
      return base === (this.focusRoot ?? this.doc?.root);
    }
    const i = mains.indexOf(node);
    if (i < 0) return false;
    if (along) {
      const next = i + along < 0 ? base : mains[i + along];
      if (next) this.select(next);
      return true;
    }
    // 朝分支长的方向：进到子节点（横向朝上的分支，离主轴最近的是最后一个）
    const toward =
      (key === "ArrowDown" && p.side === "down") || (key === "ArrowUp" && p.side === "up") || (key === "ArrowRight" && p.side === "right") || (key === "ArrowLeft" && p.side === "left");
    if (toward) {
      const kids = visibleChildren(node);
      if (horiz && kids.length) this.select(p.side === "up" ? kids[kids.length - 1] : kids[0]);
      else forward(kids);
    }
    return true;
  }

  /**
   * 鱼骨图：鱼头和主主题沿主骨走（← → 往鱼尾 / 鱼头），从主主题朝分支那边（主骨上方的往下、下方的往上）进到分支里；
   * 分支里面交给 navigate 按树形图走。返回是否处理了
   */
  private navigateFishbone(node: MindNode, p: Placed, key: string, forward: (kids: MindNode[]) => void, base: MindNode, structure: Structure): boolean {
    if (!this.layout) return false;
    const mains = visibleChildren(base).filter((c) => !this.isFloating(c) && this.layout!.placed.has(c.id));
    const towardTail = structure === "fishbone-right" ? "ArrowLeft" : "ArrowRight";
    const towardHead = towardTail === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    const along = key === towardTail ? 1 : key === towardHead ? -1 : 0;
    if (node === base) {
      if (along > 0 && mains.length) {
        this.select(mains[0]);
        return true;
      }
      return base === (this.focusRoot ?? this.doc?.root);
    }
    const i = mains.indexOf(node);
    if (i < 0) return false;
    if (along) {
      const next = i + along < 0 ? base : mains[i + along];
      if (next) this.select(next);
      return true;
    }
    // 主骨上方的主主题，分支在它下面（离主题最近的是第一个）；下方的分支在它上面（最近的是最后一个）
    const kids = visibleChildren(node);
    if (key === "ArrowDown" && p.side === "up") {
      if (kids.length) this.select(kids[0]);
      else forward(kids);
    } else if (key === "ArrowUp" && p.side === "down") {
      if (kids.length) this.select(kids[kids.length - 1]);
      else forward(kids);
    }
    return true;
  }

  /**
   * 横向结构里的上下键：先在同一父节点、同一侧的兄弟里按屏幕顺序走；走到头再去相邻分支找
   * 同一层、最近的节点。对齐按节点贴着父节点的那条边算，不用中心点 —— 兄弟左对齐，
   * 文字长短不一时中心点会偏得很远，以前就因此从 2-2 跳去了别的分支。
   */
  /** 按自由主题排着的节点（中心主题下带 float 的子节点，聚焦分支时没有） */
  private isFloating(node: MindNode): boolean {
    return !!this.layout?.floating?.has(node);
  }

  private selectVertical(node: MindNode, p: Placed, dir: -1 | 1): void {
    if (!this.layout || !node.parent) return;
    const placed = this.layout.placed;
    // 概要主题没有兄弟，直接找上下最近的
    const sibs = (isSummaryTopic(node) ? [] : visibleChildren(node.parent))
      .map((c) => placed.get(c.id))
      .filter((q): q is Placed => !!q && q.side === p.side && this.isFloating(q.node) === this.isFloating(node))
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

  /** additive：在已有选中上追加（Shift 拖动）；否则从空选开始，点一下空白处等于取消选中 */
  private startMarquee(ev: PointerEvent, additive = true): void {
    if (!additive) this.select(null, "replace");
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
    if (!this.marquee.moved && Math.hypot(ev.clientX - host.left - this.marquee.x, ev.clientY - host.top - this.marquee.y) < 3) return;
    this.marquee.moved = true;
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
    // 按住的是多选里的一个：整组一起拖（父子都选中时只拖外层的，子节点跟着走）
    const movers = (this.selected.has(node) && this.selected.size > 1 ? this.topLevelSelection() : [node]).filter((m) => !isSummaryTopic(m));
    if (!movers.length || isSummaryTopic(node)) return;
    if (!movers.includes(node)) movers.splice(0, movers.length, node);
    const subtree = new Set<MindNode>();
    for (const m of movers) walkMap(m, (n) => subtree.add(n));
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("mm-ghost");
    ghost.classList.remove("is-selected");
    ghost.querySelector(".mm-toggle")?.remove();
    ghost.style.transform = `scale(${this.k})`;
    if (movers.length > 1) ghost.createSpan({ cls: "mm-ghost-count", text: String(movers.length) });
    this.el.append(ghost);
    const indicator = createDiv();
    indicator.className = "mm-drop-indicator";
    this.overlay.append(indicator);
    for (const n of subtree) this.els.get(n.id)?.classList.add("is-dragging");
    const w0 = this.toWorld(ev.clientX, ev.clientY);
    const p0 = this.layout?.placed.get(node.id);
    const grab = p0 ? { x: w0.x - (p0.x + p0.w / 2), y: w0.y - (p0.y + p0.h / 2) } : { x: 0, y: 0 };
    this.drag = { node, movers, ghost, subtree, target: null, indicator, grab, last: null };
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
    this.drag.last = w;
    const target = this.findDropTarget(w.x, w.y, this.drag.subtree);
    this.drag.target = target;
    for (const el of this.els.values()) el.classList.remove("is-drop-target");
    for (const el of this.summaryLabels.values()) el.classList.remove("is-drop-target");
    const ind = this.drag.indicator;
    ind.setCssStyles({ display: "none" });
    if (!target || !this.layout) return;
    if (target.kind === "summary") {
      this.summaryLabels.get(target.parent.id)?.classList.add("is-drop-target");
      return;
    }
    if (target.kind === "node") {
      this.els.get(target.parent.id)?.classList.add("is-drop-target");
      return;
    }
    if (target.at) {
      ind.classList.add("is-vertical");
      ind.setCssStyles({ display: "block", left: `${target.at.x - 2}px`, top: `${target.at.y - 20}px` });
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
    const across = side === "down" || side === "up";
    ind.classList.toggle("is-vertical", across);
    // 展开的备注挂在节点下面：横线画在备注框外面，不压在备注上（B 站晓兔）
    const box = (k: Placed) => this.dropBox(k);
    if (across) {
      let x: number;
      if (pos === -1) x = box(kids[kids.length - 1]).x + box(kids[kids.length - 1]).w + gap;
      else if (pos === 0) x = kids[0].x - gap;
      else x = (box(kids[pos - 1]).x + box(kids[pos - 1]).w + kids[pos].x) / 2;
      ind.setCssStyles({ display: "block", left: `${x - 2}px`, top: `${kids[0].y}px` });
      return;
    }
    let y: number;
    if (pos === -1) y = box(kids[kids.length - 1]).y + box(kids[kids.length - 1]).h + gap / 2;
    else if (pos === 0) y = kids[0].y - gap / 2;
    else y = (box(kids[pos - 1]).y + box(kids[pos - 1]).h + kids[pos].y) / 2;
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
    // 概要文字上：挂到这个概要后面（还没有概要主题的先变成概要主题）。被括住的节点拖到自己的概要上不算
    for (const s of this.layout.summaries) {
      const b = s.label;
      if (!b || s.topic || !s.start.summary || exclude.has(s.start) || s.members.some((m) => exclude.has(m))) continue;
      if (wx >= b.x - 4 && wx <= b.x + b.w + 4 && wy >= b.y - 4 && wy <= b.y + b.h + 4) return { parent: s.start, index: 0, kind: "summary" };
    }
    let hit: Placed | null = null;
    for (const p of placed) {
      if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h && (!hit || p.w * p.h < hit.w * hit.h)) hit = p;
    }
    if (hit) return { parent: hit.node, index: hit.node.children.length, kind: "node" };
    // 鱼骨图的主骨上：先于「节点屁股后面」判断，二级主题下面挂子节点的那块空白一直延伸到主骨边上。
    // 混合结构里每个设成鱼骨图的分支都有自己的主骨
    const fishRoots = placed.filter((p) => this.isStructureRoot(p.node) && isFishbone(this.kidsStructure(p.node)));
    for (const fr of fishRoots) {
      const t = this.fishboneDropTarget(fr.node, wx, wy, exclude, this.kidsStructure(fr.node));
      if (t) return t;
    }
    const behind = this.behindTarget(placed, wx, wy);
    if (behind) return behind;

    const base = this.focusRoot ?? this.doc?.root;
    const kidsOf = (p: Placed) =>
      visibleChildren(p.node)
        .filter((c) => !exclude.has(c))
        .map((c) => this.layout!.placed.get(c.id))
        .filter((k): k is Placed => !!k);
    if (this.baseStructure() === "mindmap" && base) {
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
        wy <= Math.max(...col.map((k) => this.dropBox(k).y + this.dropBox(k).h)) + pad;
      const nearRoot = rp && !col.length && Math.abs(wy - (rp.y + rp.h / 2)) < 80 && (side === "left" ? wx < rp.x : wx > rp.x + rp.w);
      if (rp && (inCol || nearRoot)) return this.sideDropTarget(rp, kids, wx, wy);
    }

    let best: { t: DropTarget; size: number } | null = null;
    for (const p of placed) {
      // 中心主题下的主主题：思维导图在上面按左右两列找过了，鱼骨图按主骨找过了
      if ((this.baseStructure() === "mindmap" && p.node === base) || fishRoots.includes(p)) continue;
      const kids = kidsOf(p);
      if (!kids.length) continue;
      // 横向时间轴的主主题沿主轴从左往右排（分支朝下朝上都有）
      const across = kids[0].side === "down" || kids[0].side === "up";
      // 沿堆叠方向排好：纵向排的按 y，横向排的（组织结构图）按 x
      kids.sort((a, b) => (across ? a.x - b.x : a.y - b.y));
      const edgeGap = p.node === base ? DEFAULT_LAYOUT.gapMain : 24;
      for (let i = 0; i <= kids.length; i++) {
        const a = kids[i - 1];
        const b = kids[i];
        // 展开的备注算进节点的范围：备注框上和备注框下面那一段都算这两个兄弟之间（B 站晓兔）
        const two = [a, b].filter((k): k is Placed => !!k).map((k) => this.dropBox(k));
        let inBand: boolean;
        let size: number;
        if (!across) {
          const top = a ? a.y + a.h : b.y - edgeGap;
          const bottom = b ? b.y : this.dropBox(a).y + this.dropBox(a).h + edgeGap;
          const left = Math.min(...two.map((k) => k.x)) - 12;
          const right = Math.max(...two.map((k) => k.x + k.w)) + 12;
          inBand = wy >= top && wy <= bottom && wx >= left && wx <= right;
          size = bottom - top;
        } else {
          const left = a ? a.x + a.w : b.x - edgeGap;
          const right = b ? b.x : this.dropBox(a).x + this.dropBox(a).w + edgeGap;
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
      } else if (p.side === "up") {
        // 横向时间轴里朝上长的分支：子节点在上面
        if (wx < p.x || wx > p.x + p.w) continue;
        d = p.y - wy;
        const kidEdge = kids.length ? Math.min(...kids.map((k) => p.y - (k.y + k.h))) : Infinity;
        if (d <= 4 || d > Math.min(64, kidEdge - 4)) continue;
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
   * 鱼骨图：拖到主骨附近（鱼头的鱼尾那边）就插到主主题之间，位置按各斜骨在主骨上的起点算 ——
   * 第一个离鱼头最近，落点和鱼头之间有几根斜骨就排在第几个后面
   */
  private fishboneDropTarget(base: MindNode, wx: number, wy: number, exclude: Set<MindNode>, structure: Structure): DropTarget | null {
    const rp = this.layout?.placed.get(base.id);
    if (!rp || Math.abs(wy - (rp.y + rp.h / 2)) > 12) return null;
    const right = structure === "fishbone-right";
    const headX = right ? rp.x : rp.x + rp.w;
    if (right ? wx >= headX : wx <= headX) return null;
    const mains = visibleChildren(base)
      .filter((c) => !exclude.has(c) && !this.isFloating(c))
      .map((c) => this.layout!.placed.get(c.id))
      .filter((k): k is Placed => !!k?.bone);
    const xs = mains.map((m) => m.bone!.x1);
    const before = xs.filter((x) => (right ? x > wx : x < wx)).length;
    const children = base.children;
    const index = before < mains.length ? children.indexOf(mains[before].node) : mains.length ? children.indexOf(mains[mains.length - 1].node) + 1 : children.length;
    const near = before > 0 ? xs[before - 1] : headX;
    const far = before < xs.length ? xs[before] : near + (right ? -1 : 1) * DEFAULT_LAYOUT.gapMain;
    return { parent: base, index, kind: "gap", at: { x: (near + far) / 2, y: rp.y + rp.h / 2 } };
  }

  /**
   * 思维导图结构里中心主题两侧的落点：按鼠标在中心主题哪边决定 side，只在那一侧的主主题之间找位置。
   * 左侧是倒序排的（文档里靠后的在上面），所以插入下标要反过来算。
   */
  private dropBoxes: { layout: LayoutResult; notes: Map<MindNode, PlacedNote> } | null = null;
  /** 节点连同它下面展开的备注框占的范围（拖放时兄弟之间的空隙、插入横线都从这个范围外面算） */
  private dropBox(k: Placed): Bounds {
    const layout = this.layout;
    if (!layout) return k;
    if (this.dropBoxes?.layout !== layout) this.dropBoxes = { layout, notes: new Map(layout.notes.map((n) => [n.node, n])) };
    const n = this.dropBoxes.notes.get(k.node);
    if (!n) return k;
    const x = Math.min(k.x, n.x);
    const y = Math.min(k.y, n.y);
    return { x, y, w: Math.max(k.x + k.w, n.x + n.w) - x, h: Math.max(k.y + k.h, n.y + n.h) - y };
  }

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
    const { node, movers, ghost, indicator, grab, last } = this.drag;
    let target = this.drag.target;
    ghost.remove();
    indicator.remove();
    for (const el of this.els.values()) el.classList.remove("is-dragging", "is-drop-target");
    for (const el of this.summaryLabels.values()) el.classList.remove("is-drop-target");
    // 落在概要文字上：普通概要先变成概要主题，再当作落在概要主题上（成为它的末尾子节点）
    if (target?.kind === "summary") {
      const topic = commit ? this.ensureSummaryTopic(target.parent) : null;
      target = topic ? { parent: topic, index: topic.children.length, kind: "node" } : null;
    }
    this.el.classList.remove("is-dragging-node");
    this.drag = null;
    // 放到空白处的落点（按住的节点中心）
    const dropCenter = last && { x: last.x - grab.x, y: last.y - grab.y };
    if (movers.length > 1) {
      if (commit && target && this.doc) this.dropMany(movers, node, target);
      else if (commit && !target && dropCenter && this.canFloat() && this.opts.dragToFloat?.()) this.floatMany(movers, node, dropCenter);
      else this.positionNodebar();
      return;
    }
    // 自由主题：落在节点 / 空隙上就挂回去，落在空白处就挪到那里
    if (commit && this.doc && this.isFloating(node)) {
      if (!target) {
        if (dropCenter) {
          node.float = this.floatPos(dropCenter);
          this.select(node);
          this.render();
          this.notify();
        }
        return;
      }
      if (target.parent !== node && !isAncestor(node, target.parent)) {
        node.float = undefined;
        if (target.side) node.side = target.side;
        if (target.parent.folded) target.parent.folded = false;
        moveNode(node, target.parent, target.index, this.doc.style, this.promoted);
        this.select(node);
        this.render();
        this.notify();
        return;
      }
    }
    // 设置里打开了「拖到空白处变成自由主题」
    if (commit && !target && dropCenter && this.doc && node.parent && this.canFloat() && this.opts.dragToFloat?.()) {
      this.floatMany([node], node, dropCenter);
      return;
    }
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
        if (moveNode(node, parent, target.index, this.doc.style, this.promoted)) {
          this.select(node);
          this.render();
          this.notify();
          return;
        }
      }
    }
    this.positionNodebar();
  }

  /**
   * 多个节点一起落到 target：按文档顺序排在一起，插在落点那个兄弟之前（或末尾）。
   * 落点在某个被拖节点的子树里时不动（findDropTarget 已经排除了，这里再兜一次）
   */
  private dropMany(movers: MindNode[], primary: MindNode, target: DropTarget): void {
    if (!this.doc) return;
    const parent = target.parent;
    if (movers.some((m) => m === parent || isAncestor(m, parent))) {
      this.positionNodebar();
      return;
    }
    // 记下落点后面第一个不被拖走的兄弟，挨个插到它前面；没有就追加到末尾
    const anchor = parent.children.slice(target.index).find((c) => !movers.includes(c)) ?? null;
    if (target.side) {
      for (const c of parent.children) {
        const s = this.layout?.placed.get(c.id)?.side;
        if (!c.side && (s === "left" || s === "right")) c.side = s;
      }
    }
    if (parent.folded) parent.folded = false;
    for (const m of movers) {
      const at = anchor ? parent.children.indexOf(anchor) : parent.children.length;
      // 自由主题被拖进树里就挂上了
      m.float = undefined;
      if (!moveNode(m, parent, at, this.doc.style, this.promoted)) continue;
      if (target.side) m.side = target.side;
      else if (parent !== (this.focusRoot ?? this.doc.root)) m.side = undefined;
    }
    this.select(null);
    for (const m of movers) this.select(m, "add");
    this.setPrimary(primary);
    this.render();
    this.notify();
  }

  // ---------- 自由主题 ----------

  /** 只有显示整张图（不在聚焦某个分支）时才能放自由主题 */
  private canFloat(): boolean {
    return !!this.doc && this.opts.editable && !this.focusRoot;
  }

  /** 世界坐标（画布里的点）→ 自由主题的位置：相对中心主题中心 */
  private floatPos(center: { x: number; y: number }): { x: number; y: number } {
    const rp = this.doc && this.layout?.placed.get(this.doc.root.id);
    const cx = rp ? rp.x + rp.w / 2 : 0;
    const cy = rp ? rp.y + rp.h / 2 : 0;
    return { x: Math.round(center.x - cx), y: Math.round(center.y - cy) };
  }

  /** 节点所在位置的中心（世界坐标） */
  private centerOf(node: MindNode): { x: number; y: number } | null {
    const p = this.layout?.placed.get(node.id);
    return p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : null;
  }

  /** 在画布某处新建一个自由主题并进入编辑；没写字就按 Esc / 回车，等于没加 */
  createFloatAt(center: { x: number; y: number }): void {
    if (!this.canFloat() || !this.doc) return;
    if (this.editing) this.commitEdit();
    const node = addChild(this.doc.root, this.doc.style, "");
    node.float = this.floatPos(center);
    this.select(node);
    this.render();
    this.startEdit(node, true);
  }

  /** 在一个自由主题整棵树的下方（dir = -1 时上方）再放一个自由主题 */
  private addFloatNear(f: MindNode, dir: 1 | -1): void {
    if (!this.canFloat() || !this.doc || !this.layout) return;
    const pf = this.layout.placed.get(f.id);
    if (!pf) return;
    let top = pf.y;
    let bottom = pf.y + pf.h;
    walkMap(f, (n) => {
      const p = this.layout!.placed.get(n.id);
      if (!p) return;
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y + p.h);
    });
    const gap = 40;
    const y = dir > 0 ? bottom + gap + pf.h / 2 : top - gap - pf.h / 2;
    this.createFloatAt({ x: pf.x + pf.w / 2, y });
  }

  /**
   * 把节点（连同子树）变成自由主题：挪到中心主题下最后，放在 center（多个时保持彼此的相对位置）。
   * 原来罩着它的外框 / 概要少括一个，免得范围顺延到别的兄弟上
   */
  private floatMany(nodes: MindNode[], primary: MindNode, center: { x: number; y: number }): void {
    if (!this.doc) return;
    const root = this.doc.root;
    const c0 = this.centerOf(primary) ?? center;
    const offsets = new Map(nodes.map((n) => {
      const c = this.centerOf(n) ?? c0;
      return [n, { x: c.x - c0.x, y: c.y - c0.y }] as const;
    }));
    for (const n of nodes) {
      if (!n.parent || n === root) continue;
      shrinkGroupsAround(n);
      moveNode(n, root, root.children.length, this.doc.style, this.promoted);
      n.side = undefined;
      if (n.box) n.box.span = 1;
      if (n.summary) n.summary.span = 1;
      const o = offsets.get(n)!;
      n.float = this.floatPos({ x: center.x + o.x, y: center.y + o.y });
    }
    this.select(null);
    for (const n of nodes) this.select(n, "add");
    this.setPrimary(primary);
    this.render();
    this.notify();
  }

  /** 节点原地变成自由主题（右键「转为自由主题」） */
  convertToFloat(node: MindNode): void {
    if (!this.canFloat() || !node.parent || this.isFloating(node) || isSummaryTopic(node)) return;
    const c = this.centerOf(node);
    if (c) this.floatMany([node], node, c);
  }

  /** 自由主题挂回中心主题，排在主主题最后 */
  attachFloat(node: MindNode): void {
    if (!this.doc || !this.opts.editable || !node.float) return;
    node.float = undefined;
    const root = this.doc.root;
    moveNode(node, root, root.children.length, this.doc.style, this.promoted);
    this.select(node);
    this.render();
    this.notify();
  }

  /**
   * Alt+方向键对整组生效（单选时还是原来的 moveSibling / indentNode / outdentNode）。
   * 同一父节点下的选中节点一起动：上下移各挪一格，挪不动的（到顶 / 到底）连同挤着它的一起不动；
   * 降级挂到组里第一个前面那个没被选中的兄弟下；升级放到父节点之后
   */
  private moveSelection(op: "up" | "down" | "indent" | "outdent"): void {
    // 概要主题不在兄弟里，不能上下挪、升降级
    const movers = this.topLevelSelection().filter((m) => !isSummaryTopic(m));
    const primary = this.primary && !isSummaryTopic(this.primary) ? this.primary : null;
    if (movers.length <= 1 || !this.doc) {
      const n = primary;
      if (!n) return;
      if (op === "up") this.moveSibling(n, -1);
      else if (op === "down") this.moveSibling(n, 1);
      else if (op === "outdent") this.outdentNode(n);
      else this.indentNode(n);
      return;
    }
    const style = this.doc.style;
    const groups = new Map<MindNode, MindNode[]>();
    for (const m of movers) groups.set(m.parent!, [...(groups.get(m.parent!) ?? []), m]);
    let changed = false;
    for (const [parent, group] of groups) {
      const kids = parent.children;
      group.sort((a, b) => kids.indexOf(a) - kids.indexOf(b));
      if (op === "up" || op === "down") {
        const dir = op === "up" ? -1 : 1;
        const order = op === "up" ? group : [...group].reverse();
        const stuck = new Set<MindNode>();
        for (const m of order) {
          const i = kids.indexOf(m);
          const j = i + dir;
          const other = kids[j];
          if (j < 0 || j >= kids.length || (stuck.has(other) && group.includes(other))) {
            stuck.add(m);
            continue;
          }
          if (group.includes(other)) {
            stuck.add(m);
            continue;
          }
          moveNode(m, parent, dir < 0 ? j : j + 1, style, this.promoted);
          changed = true;
        }
      } else if (op === "indent") {
        const first = kids.indexOf(group[0]);
        const prev = kids.slice(0, first).reverse().find((c) => !group.includes(c));
        if (!prev) continue;
        if (prev.folded) prev.folded = false;
        for (const m of group) moveNode(m, prev, prev.children.length, style, this.promoted);
        changed = true;
      } else {
        const grand = parent.parent;
        if (!grand) continue;
        let at = grand.children.indexOf(parent) + 1;
        for (const m of group) {
          moveNode(m, grand, at, style, this.promoted);
          at = grand.children.indexOf(m) + 1;
        }
        changed = true;
      }
    }
    if (!changed) return;
    this.select(null);
    for (const m of movers) this.select(m, "add");
    if (primary) this.setPrimary(primary);
    this.render();
    this.notify();
  }

  // ---------- 编辑 ----------

  private notify(): void {
    if (this.notifyTimer !== null) {
      window.clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    if (this.promoted.length) {
      // 标题挪到列表前面时，后面的列表兄弟升成了标题（不然存不回 Markdown）：说一声，⌘Z 能撤
      const names = this.promoted.map((n) => `「${n.text.replace(/\s*\^[\w-]+$/, "")}」`).join("");
      this.opts.host?.notice?.(t("notice.promotedToHeading", { names, count: this.promoted.length, key: sc("Mod", "Z") }));
      this.promoted.length = 0;
    }
    // 改名、挪动会让节点的文字路径变掉，先把单条备注的状态按新路径交出去
    this.emitNoteCards();
    if (this.doc?.style.headingsOnly && !this.warnedDeep) {
      let deep = false;
      walkMap(this.doc.root, (n) => {
        if (n !== this.doc!.root && n.kind === "list") deep = true;
      });
      if (deep) {
        this.warnedDeep = true;
        this.opts.host?.notice?.(t("notice.tooDeepForHeadings"));
      }
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
    if (!moveNode(node, parent, index, this.doc.style, this.promoted)) return false;
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
    // 先进编辑再居中：编辑框会把节点撑宽，按撑宽后的大小算中心
    this.startEdit(node, true);
    this.followSelection(node);
  }

  /** 中心主题能不能加同级：它是唯一的一级标题、下面没有自由主题、能编辑（#27） */
  private canAddRootSibling(node: MindNode): boolean {
    return !!this.doc && node === this.doc.root && this.doc.rootFromHeading && !node.children.some((c) => c.float);
  }

  private addSiblingToSelected(before: boolean): void {
    const sel = this.primary;
    if (!sel || !this.doc) return;
    if (this.isFloating(sel)) {
      this.addFloatNear(sel, before ? -1 : 1);
      return;
    }
    // 中心主题是唯一的一级标题：加同级 = 再加一个一级标题，中心主题换成文件名（#27）
    const node = sel === this.doc.root ? addRootSibling(this.doc, this.opts.fallbackTitle?.() ?? "", !before) : addSibling(sel, "", !before);
    if (!node) return;
    if (sel.side) node.side = sel.side;
    this.select(node);
    this.render();
    // 先进编辑再居中：编辑框会把节点撑宽，按撑宽后的大小算中心
    this.startEdit(node, true);
    this.followSelection(node);
  }

  private deleteSelected(): void {
    const victims = [...this.selected].filter((n) => n.parent && ![...this.selected].some((o) => o !== n && isAncestor(o, n)));
    if (!victims.length) return;
    const primary = this.primary && victims.includes(this.primary) ? this.primary : victims[0];
    const parent = primary.parent!;
    // 删的是概要主题：之后选中它括住的第一个兄弟
    const fallback = isSummaryTopic(primary) ? primary.topicOf! : null;
    const idx = parent.children.indexOf(primary);
    for (const v of victims) removeNode(v);
    // 删掉的节点上连出去、连进来的关联线一起去掉
    this.pruneRels();
    const next = (fallback?.parent ? fallback : null) ?? parent.children[Math.min(Math.max(0, idx), parent.children.length - 1)] ?? parent;
    this.select(next);
    this.render();
    this.notify();
  }

  /** 视图把 ⌘↵ 交到这里：备注框里是关掉备注，搜索框里不管，其他时候插入父节点 */
  /**
   * 视图 Scope 截下来的 ⌘L / ⌘]：焦点在画布上（没在编辑、不在输入框里）才处理，返回 false；
   * 否则返回 true 交回 Obsidian（备注编辑框里的 ⌘L 还是切换待办）
   */
  handleScopeKey(ev: KeyboardEvent, cmd: "task" | "summary"): boolean {
    const target = ev.target as HTMLElement | null;
    if (this.editing || !target || !this.el.contains(target) || target.closest("input, textarea, [contenteditable='true'], .cm-editor")) return true;
    if (!this.opts.editable || !this.selected.size) return false;
    if (this.keysHandled.has(ev)) return false;
    this.keysHandled.add(ev);
    if (cmd === "task") this.toggleTaskOnSelected();
    else this.toggleSummaryOnSelected();
    return false;
  }

  handleModEnter(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement;
    if (target.closest?.(".gg-mm-search")) return;
    // 备注编辑框里的 ⌘↵ 是关掉备注：所见即所得备注是 CodeMirror（contenteditable 的 div，不是 textarea），
    // 也要认出来，不然会给选中的节点插一个空白父节点（0.87.0 起的回归）
    if (target.tagName === "TEXTAREA" || (this.popover && this.popover.contains(target))) {
      this.closePopover();
      this.el.focus({ preventScroll: true });
      return;
    }
    this.runNodeCommand("insert-parent");
  }

  /** 命令入口：和画布里的按键做同一件事；正在编辑的文字先提交 */
  runNodeCommand(cmd: NodeCommand): void {
    const sel = this.primary;
    if (!sel) return;
    // 折叠展开只是看：锁着也能用（不写文件，见 setFoldLevel）
    if (cmd === "expand-branch") return this.setFoldLevel(null, sel);
    if (cmd === "collapse-branch") return this.collapseBranch(sel);
    if (cmd === "expand-level") return this.stepFoldLevel(sel, 1);
    if (cmd === "collapse-level") return this.stepFoldLevel(sel, -1);
    if (!this.opts.editable) return;
    if (this.editing) this.commitEdit();
    switch (cmd) {
      case "add-child":
        return this.addChildToSelected();
      case "add-sibling":
        if (!sel.parent) return this.addChildToSelected();
        return this.addSiblingToSelected(false);
      case "insert-before":
        return this.addSiblingToSelected(true);
      case "insert-parent":
        return this.insertParentForSelected();
      case "edit":
        return this.startEdit(sel);
      case "callout":
        return this.editCallout(sel);
      case "note":
        return this.toggleNotePopover(sel, true);
      case "delete":
        return this.deleteSelected();
      case "delete-only":
        return this.deleteOnlySelected();
      case "add-rel":
        return this.startRel(sel);
      case "move-up":
        this.moveSelection("up");
        break;
      case "move-down":
        this.moveSelection("down");
        break;
      case "outdent":
        this.moveSelection("outdent");
        break;
      case "indent":
        this.moveSelection("indent");
        break;
    }
    this.ensureVisible(this.primary);
  }

  /**
   * 插入父节点（XMind 的 ⌘↵）：选中的兄弟收进一个新节点，不是兄弟的各自一个；建好就进入编辑。
   * 不当「新节点」编辑：Esc 或留空也不会删掉它（删它会连带收进去的节点），要撤销按 ⌘Z
   */
  private insertParentForSelected(): void {
    if (!this.doc || !this.opts.editable) return;
    if (this.editing) this.commitEdit();
    // 概要主题不在兄弟里，给它插父节点没有意义
    const made = insertParents([...this.selected].filter((n) => !isSummaryTopic(n)), this.doc.style);
    if (!made.length) return;
    this.select(made[0]);
    for (const n of made.slice(1)) this.select(n, "add");
    this.setPrimary(made[0]);
    this.render();
    this.notify();
    if (made.length === 1) this.startEdit(made[0]);
    this.followSelection(made[0]);
  }

  /** 只删选中的节点本身，它的子节点按原顺序接到父节点下、它原来的位置 */
  private deleteOnlySelected(): void {
    if (!this.doc) return;
    const victims = [...this.selected].filter((n) => n.parent && !isSummaryTopic(n));
    if (!victims.length) return;
    const primary = this.primary && victims.includes(this.primary) ? this.primary : victims[0];
    let next: MindNode | null = null;
    for (const v of victims) {
      const parent = v.parent;
      if (!parent) continue;
      const idx = parent.children.indexOf(v);
      const kids = removeNodeKeepChildren(v, this.doc.style);
      if (v === primary) next = kids[0] ?? parent.children[Math.min(idx, parent.children.length - 1)] ?? parent;
    }
    // 多选时接上来的子节点自己也可能被删了，挂不回根上的就退回根
    const root = this.doc.root;
    const alive = (n: MindNode | null): n is MindNode => {
      let x = n;
      while (x?.parent) x = x.parent;
      return x === root;
    };
    this.pruneRels();
    this.select(alive(next) ? next : root);
    this.render();
    this.notify();
  }

  /** 编辑节点文字时自动配对引号、括号（大纲面板的编辑框也用它） */
  readonly autoPairOn = (): boolean => !!this.opts.autoPair?.();

  startEdit(node: MindNode, isNew = false, caret?: "start" | "end"): void {
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
    // 新建节点自带名字（设置打开时）：名字先写进节点，编辑时整个选中，打字就替换；不改直接确认、按 Esc 都留着
    const named = isNew && !node.text && !!this.opts.newNodeName?.();
    if (named) node.text = this.defaultNodeName(node);
    this.positionNodebar();
    el.classList.add("is-editing");
    this.nodeEditor = new InlineEditor(label, {
      text: this.toEdit(node.text),
      // 默认全选，打字直接替换；设置里可以改成光标放在末尾接着写
      selectAll: !caret && (named || !this.opts.caretAtEnd?.()),
      autoPair: this.autoPairOn,
      multiline: true,
      // 回车提交、Esc、Tab、链接补全的上下键、⌘B 这些走画布的按键处理；画布没处理的（打字、方向键、⌘Z）归编辑框
      onKey: (ev) => {
        this.onKeyDown(ev);
        return ev.defaultPrevented;
      },
      onInput: (from, to, text) => this.wrapOnInput(from, to, text),
      linkTitle: this.linkTitle,
      hideSyntax: this.hideSyntax(),
      // 编辑节点文字时粘贴图片：标题里放不了，存成附件追加到这个节点的备注（正文）里
      onPaste: (ev) => {
        const imgs = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (imgs.length) {
          void this.addImagesToNote(node, imgs);
          return true;
        }
        // 粘的是复制来的节点（剪贴板里是「- 文字」的列表）：只粘文字
        const plain = this.nodePasteText(ev.clipboardData?.getData("text/plain") ?? "");
        const ed = this.nodeEditor;
        if (plain === null || !ed) return false;
        const { from, to } = ed.selection;
        ed.replace(from, to, plain, from + plain.length);
        return true;
      },
      onChange: () => {
        if (this.editing !== node) return;
        this.updateLinkSuggest();
        this.reflow(node);
      },
      onSelect: () => this.updateFormatBar(),
      onBlur: () => {
        if (this.editing === node) this.commitEdit();
      },
    });
    if (caret && this.nodeEditor) this.nodeEditor.select(caret === "start" ? 0 : this.nodeEditor.text.length);
    // 只有这个节点换成了编辑框、尺寸可能变了：只重新量它（大图上全部重量、位置全部重写要几百毫秒，见 e2e t_bench）
    this.reflow(node);
    // 双击进入编辑时文字已经全选：选区是建编辑框时就给好的，不会触发 onSelect，格式栏要自己叫一次（等排好版、拿到焦点）。
    // 新建的节点（默认名字全选着，马上就要打字替换）不弹，免得连续加节点时格式栏一直闪
    if (!isNew) {
      const win = this.el.ownerDocument.defaultView ?? window;
      win.requestAnimationFrame(() => {
        if (this.editing === node) this.updateFormatBar();
      });
    }
  }

  /** 新节点的默认名字：主题1、主题2……，接着同级里已有的最大编号往下排 */
  private defaultNodeName(node: MindNode): string {
    const siblings = node.parent ? node.parent.children : [];
    const re = new RegExp(`^${t("canvas.newTopicName", { n: "(\\d+)" })}$`);
    let max = 0;
    for (const s of siblings) {
      if (s === node) continue;
      const m = re.exec(s.text.trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
    return t("canvas.newTopicName", { n: max + 1 });
  }

  /** 交给行内编辑框：粘贴网页地址时抓标题 */
  readonly linkTitle = (url: string): Promise<string | null> | null => this.opts.host?.linkTitle?.(url) ?? null;
  readonly hideSyntax = (): boolean => !!this.opts.hideSyntax?.();

  commitEdit(cancel = false, refocus = true): void {
    const node = this.editing;
    if (!node) return;
    this.closeLinkSuggest();
    const isNew = this.editingIsNew;
    this.editing = null;
    this.editingIsNew = false;
    const raw = this.fromEdit(this.nodeEditor?.savedText ?? "");
    this.nodeEditor?.destroy();
    this.nodeEditor = null;
    this.updateFormatBar();
    // 没改：进编辑时跨行的格式被拆好了（toEditableText），原样提交回来和原文写法不同但意思一样，照旧用原文，不算改动
    const text = cancel || raw === this.fromEdit(this.toEdit(node.text)) ? node.text : raw;
    // 新节点没写字就当没加；但编辑中贴了图片（进了备注）的要留着，不然图片就丢了
    if (text === "" && isNew && !node.note) {
      const parent = node.parent;
      removeNode(node);
      this.select(parent);
      this.render();
      if (refocus) this.el.focus({ preventScroll: true });
      return;
    }
    // 新节点留下来了（自带名字的按 Esc 也留着）就得存
    let changed = isNew || (!cancel && text !== node.text);
    node.text = text;
    // 快捷编号（设置打开时）：开头打了「1.」「1、」，这组同级开始编号，打的数字去掉
    if (!cancel && this.opts.autoNumber?.() && node.parent && !isSummaryTopic(node) && this.canNumber(node.parent)) {
      if (TYPED_NUMBER_RE.test(text)) {
        // 先开编号（同级都手打了序号的会一起去掉），再去掉这个节点自己打的
        this.setNumbered(node.parent, true);
        node.text = node.text.replace(TYPED_NUMBER_RE, "");
        changed = true;
      }
    }
    // startEdit 把 label 换成了编辑框。文字没改的话签名跟着没变，
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
      a.raf = this.el.win.requestAnimationFrame(step);
    };
    this.autoScroll = { raf: this.el.win.requestAnimationFrame(step), vx, vy, tick };
  }

  private stopAutoScroll(): void {
    if (this.autoScroll) this.el.win.cancelAnimationFrame(this.autoScroll.raf);
    this.autoScroll = null;
  }

  // ---------- 编辑时的 [[ 链接补全 ----------

  /**
   * 选中文字再打【或 [：包成【文字】/[文字]，已经被【】或 [] 包着时再打一次升级成 [[文字]] 链接（同 Easy Typing 的习惯）。
   * 输入法打的【也走这里（CodeMirror 把组字结果交给 inputHandler）
   */
  private wrapOnInput(from: number, to: number, typed: string): boolean {
    const ed = this.nodeEditor;
    if (!ed || from === to || (typed !== "【" && typed !== "[")) return false;
    const text = ed.text;
    let before = text.slice(0, from);
    let after = text.slice(to);
    const inner = text.slice(from, to);
    let open = typed === "【" ? "【" : "[";
    let close = typed === "【" ? "】" : "]";
    const wrapped = (o: string, c: string) => before.endsWith(o) && after.startsWith(c);
    if (wrapped("【", "】") || (wrapped("[", "]") && !wrapped("[[", "]]"))) {
      before = before.slice(0, -1);
      after = after.slice(1);
      open = "[[";
      close = "]]";
    }
    const start = before.length + open.length;
    ed.setText(before + open + inner + close + after, start, start + inner.length);
    this.closeLinkSuggest();
    return true;
  }

  /**
   * 输入后看光标前有没有一段还没闭合的 [[：有就弹候选。
   * 中文输入法下打出来的「【【」先换成 [[（别的笔记插件也这么做，省得切输入法）。
   */
  private updateLinkSuggest(): void {
    const ed = this.nodeEditor;
    const host = this.opts.host;
    if (!ed || ed.composing || !host?.listLinkTargets) return this.closeLinkSuggest();
    const { from, to } = ed.selection;
    if (from !== to) return this.closeLinkSuggest();
    const caret = to;
    let text = ed.text;
    // 光标前最后一个「【【」（后面没有更晚的 [[）换成 [[；紧挨光标的「】】」换成 ]]。长度不变，光标不用挪
    const cn = text.slice(0, caret).lastIndexOf("【【");
    if (cn >= 0 && text.slice(0, caret).lastIndexOf("[[") < cn) text = text.slice(0, cn) + "[[" + text.slice(cn + 2);
    if (text.slice(0, caret).endsWith("】】")) text = text.slice(0, caret - 2) + "]]" + text.slice(caret);
    if (text !== ed.text) ed.setText(text, caret);
    const before = text.slice(0, caret);
    const open = before.lastIndexOf("[[");
    const query = open < 0 ? "" : before.slice(open + 2);
    if (open < 0 || query.includes("]]") || /[\n|#^]/.test(query)) return this.closeLinkSuggest();
    const items = rankLinkTargets(host.listLinkTargets(), query, LINK_SUGGEST_MAX);
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
    const host_ = this.el.getBoundingClientRect();
    const rect = ed.coordsAt(caret) ?? ed.host.getBoundingClientRect();
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
    // 列表能滚动：上下键选到哪儿就滚到哪儿。只滚列表自己，scrollIntoView 会连画布一起挪
    const active = s.el.children[s.index] as HTMLElement | undefined;
    if (active) {
      if (active.offsetTop < s.el.scrollTop) s.el.scrollTop = active.offsetTop;
      else if (active.offsetTop + active.offsetHeight > s.el.scrollTop + s.el.clientHeight) s.el.scrollTop = active.offsetTop + active.offsetHeight - s.el.clientHeight;
    }
  }

  private chooseLinkSuggest(index: number): void {
    const s = this.linkSuggest;
    const ed = this.nodeEditor;
    const target = s?.items[index];
    if (!s || !ed || !target) return;
    const caret = ed.selection.to;
    // 光标后面已经有 ]]（比如自动补的）就一起吞掉，不留重复的括号
    const end = ed.text.slice(caret).startsWith("]]") ? caret + 2 : caret;
    const link = `[[${target.linktext}]]`;
    ed.replace(s.open, end, link, s.open + link.length);
    this.closeLinkSuggest();
  }

  private closeLinkSuggest(): void {
    this.linkSuggest?.el.remove();
    this.linkSuggest = null;
  }

  // ---------- 折叠层级 ----------

  /** level 为 null 展开全部；否则深度 ≥ level 的节点折叠（1 = 只看主主题） */
  /** 只显示到第 level 层（相对当前聚焦的根；null 为全部展开），然后适应画布 */
  /**
   * 只显示到第 level 层（null = 全部展开）。from 给了某个节点就只动它这一支：层数从它算起，
   * 别的分支不受影响，视野也不跳，只保证它还在画面里；不给或给的是根，就是整张图并适应画布
   */
  setFoldLevel(level: number | null, from?: MindNode | null): void {
    if (!this.doc) return;
    if (this.editing) this.commitEdit();
    const top = this.focusRoot ?? this.doc.root;
    const base = from && from !== top && isAncestor(top, from) ? from : top;
    walkMap(base, (n) => {
      if (n.children.length) n.folded = level !== null && n.depth - base.depth >= level;
    });
    this.render();
    if (base === top) this.fit();
    else this.ensureVisible(base);
    if (this.opts.editable) this.notify();
  }

  /**
   * 折叠全部子分支：这个节点连同下面所有分支都折起来，以后一层层展开时下面的还收着。
   * 对中心主题（或没选）就是整张图只露出主主题
   */
  collapseBranch(from?: MindNode | null): void {
    if (!this.doc) return;
    const top = this.focusRoot ?? this.doc.root;
    this.setFoldLevel(!from || from === top ? 1 : 0, from);
  }

  /**
   * 展开一级 / 折叠一级：这一支现在露出几层，就按「只显示到第 N 层」（数字键那套）多露一层或少露一层。
   * 中心主题至少留一层，别的节点可以一直收到只剩自己
   */
  stepFoldLevel(from: MindNode | null | undefined, step: 1 | -1): void {
    if (!this.doc) return;
    const top = this.focusRoot ?? this.doc.root;
    const base = from && from !== top && isAncestor(top, from) ? from : top;
    const shown = (n: MindNode): number => (n.folded ? 0 : Math.max(0, ...visibleChildren(n).map((c) => 1 + shown(c))));
    const now = shown(base);
    const next = Math.max(base === top ? 1 : 0, now + step);
    if (next === now) return;
    this.setFoldLevel(next, base);
  }

  /** 折叠同一层：整张图（聚焦时是聚焦的分支）只显示到这个节点这一层，同一层的节点都收起来，再把它移到眼前 */
  foldSameLevel(node: MindNode): void {
    if (!this.doc) return;
    const top = this.focusRoot ?? this.doc.root;
    if (node === top || !isAncestor(top, node)) return;
    this.setFoldLevel(node.depth - top.depth, top);
    this.select(node);
    this.ensureVisible(node);
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
    walkMap(node, (n) => {
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

  /** 嵌入的脑图：点过之后滚轮才归它（见 embedWheelLock） */
  private wheelActive = false;
  private wheelHint: HTMLElement | null = null;
  private wheelHintTimer: number | null = null;

  /** 嵌入的脑图还没点过时滚滚轮：在图上浮一行提示，一会儿自己淡掉 */
  private showWheelHint(): void {
    if (!this.wheelHint) {
      const hint = createDiv();
      hint.className = "mm-wheel-hint";
      hint.textContent = t("canvas.wheelHint", { key: sc("Mod") });
      this.el.append(hint);
      this.wheelHint = hint;
    }
    this.wheelHint.classList.add("is-shown");
    if (this.wheelHintTimer !== null) window.clearTimeout(this.wheelHintTimer);
    this.wheelHintTimer = window.setTimeout(() => {
      this.wheelHintTimer = null;
      this.wheelHint?.classList.remove("is-shown");
    }, 1400);
  }

  private quickPanel: HTMLElement | null = null;

  /** 工具栏「快捷设置」：编辑、拆分这些常调的细节设置，改了马上生效（和设置页是同一份设置） */
  private toggleQuickSettings(anchor: HTMLElement): void {
    if (this.quickPanel) {
      this.closeQuickSettings();
      return;
    }
    const panel = createDiv();
    panel.className = "mm-menu mm-quick-settings";
    panel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const head = createDiv();
    head.className = "mm-quick-title";
    head.textContent = t("canvas.quickSettingsTitle");
    panel.append(head);
    const fill = () => {
      panel.querySelectorAll(".mm-quick-row").forEach((r) => r.remove());
      for (const q of this.opts.quickSettings?.() ?? []) {
        const row = createDiv();
        row.className = "mm-quick-row";
        const label = createSpan();
        label.className = "mm-quick-label";
        label.textContent = q.label;
        row.append(label);
        if (typeof q.value === "boolean") {
          const on = q.value;
          const sw = createEl("button");
          sw.type = "button";
          sw.className = "mm-quick-toggle" + (on ? " is-on" : "");
          sw.setAttribute("role", "switch");
          sw.setAttribute("aria-checked", String(on));
          sw.setAttribute("aria-label", q.label);
          sw.addEventListener("click", (ev) => {
            ev.stopPropagation();
            q.set(!on);
            fill();
          });
          row.append(sw);
        } else {
          const seg = createDiv();
          seg.className = "mm-quick-seg";
          for (const o of q.options ?? []) {
            const b = createEl("button");
            b.type = "button";
            b.className = "mm-quick-opt" + (o.value === q.value ? " is-active" : "");
            b.textContent = o.label;
            b.addEventListener("click", (ev) => {
              ev.stopPropagation();
              if (o.value !== q.value) q.set(o.value);
              fill();
            });
            seg.append(b);
          }
          row.append(seg);
        }
        panel.append(row);
      }
      // 禅模式只管这个标签页，不是插件设置：点了就关面板进去
      if (this.opts.onZen) {
        const row = panel.createDiv({ cls: "mm-quick-row" });
        row.createSpan({ cls: "mm-quick-label", text: t("canvas.zen") });
        const sw = row.createEl("button", { cls: "mm-quick-toggle", attr: { type: "button", role: "switch", "aria-checked": "false", "aria-label": t("canvas.zen") } });
        sw.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.setZen(true);
        });
      }
    };
    fill();
    this.el.append(panel);
    this.placeAtAnchor(panel, anchor);
    const cleanup = this.dismissOnOutside(panel, () => this.closeQuickSettings(), anchor);
    this.quickPanel = panel;
    this.quickPanelCleanup = cleanup;
  }

  private quickPanelCleanup: (() => void) | null = null;

  private closeQuickSettings(): void {
    this.quickPanelCleanup?.();
    this.quickPanelCleanup = null;
    this.quickPanel?.remove();
    this.quickPanel = null;
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
    bar.className = "gg-mm-search";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const input = createEl("input");
    input.type = "text";
    input.className = "gg-mm-search-input";
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
    // 命中节点列表（#50）：点一条跳过去；手机上点完收起列表和键盘，点列表按钮再展开
    const results = createDiv();
    results.className = "mm-search-results";
    results.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
    results.addEventListener("click", (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>(".mm-search-item");
      const s = this.search;
      if (!row || !s) return;
      ev.stopPropagation();
      s.index = Number(row.dataset.index);
      this.applyMatchClasses();
      if (this.touchUi()) {
        this.setSearchList(false);
        input.blur();
        this.revealMatch(false);
      } else this.revealMatch();
    });
    const row = createDiv();
    row.className = "mm-search-row";
    bar.append(row, results);
    row.append(
      input,
      count,
      tool("outline", t("canvas.searchList"), () => this.setSearchList(!this.search?.listOpen)),
      tool("up", t("canvas.prevMatch", { key: sc("Shift", "Enter") }), () => this.stepMatch(-1)),
      tool("down", t("canvas.nextMatch", { key: sc("Enter") }), () => this.stepMatch(1)),
      tool("close", t("canvas.closeSearch", { key: "Esc" }), () => this.closeSearch()),
    );
    this.el.append(bar);
    this.search = { bar, input, count, results, matches: new Set(), list: [], index: -1, listOpen: true };
    input.addEventListener("input", () => {
      this.setSearchList(true);
      this.runSearch(input.value);
    });
    input.addEventListener("focus", () => this.setSearchList(true));
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return;
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
      walkMap(this.doc.root, (n) => {
        if (plainText(n.text).toLowerCase().includes(q) || unescapeNote(n.note).toLowerCase().includes(q) || (n.callout ?? "").toLowerCase().includes(q)) list.push(n);
      });
    }
    s.list = list;
    s.matches = new Set(list);
    s.index = list.length ? Math.min(Math.max(s.index, 0), list.length - 1) : -1;
    this.renderSearchList(q);
    this.applyMatchClasses();
    if (reveal && s.index >= 0) this.revealMatch();
  }

  private touchUi(): boolean {
    return this.el.ownerDocument.body.classList.contains("is-mobile");
  }

  private setSearchList(open: boolean): void {
    const s = this.search;
    if (!s) return;
    s.listOpen = open;
    s.bar.classList.toggle("is-list-open", open && s.list.length > 0);
    s.bar.querySelector('[data-tool="outline"]')?.classList.toggle("is-active", open);
    if (open) this.scrollCurrentRow();
  }

  /** 命中列表：节点文字高亮关键词；文字里没有、命中在备注或标注里的，第二行放那一段 */
  private renderSearchList(q: string): void {
    const s = this.search;
    if (!s) return;
    s.results.empty();
    const MAX = 300;
    const mark = (host: HTMLElement, text: string) => {
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) {
        host.append(text);
        return;
      }
      host.append(text.slice(0, i));
      host.createEl("mark", { text: text.slice(i, i + q.length) });
      host.append(text.slice(i + q.length));
    };
    const snippet = (text: string) => {
      const flat = text.replace(/\s+/g, " ");
      const i = flat.toLowerCase().indexOf(q);
      const from = Math.max(0, i - 12);
      return (from > 0 ? "…" : "") + flat.slice(from, i + q.length + 60);
    };
    s.list.slice(0, MAX).forEach((n, i) => {
      const row = s.results.createDiv({ cls: "mm-search-item" });
      row.dataset.index = String(i);
      const title = plainText(n.text).replace(/\s+/g, " ").trim();
      mark(row.createDiv({ cls: "mm-search-title" }), title || t("canvas.searchEmptyNode"));
      if (!title.toLowerCase().includes(q)) {
        const note = unescapeNote(n.note);
        const src = note.toLowerCase().includes(q) ? note : n.callout ?? "";
        if (src) mark(row.createDiv({ cls: "mm-search-sub" }), snippet(src));
      }
    });
    if (s.list.length > MAX) s.results.createDiv({ cls: "mm-search-more", text: t("canvas.searchMore", { n: String(s.list.length - MAX) }) });
    s.bar.classList.toggle("is-list-open", s.listOpen && s.list.length > 0);
  }

  private scrollCurrentRow(): void {
    const s = this.search;
    const row = s?.results.querySelector<HTMLElement>(".mm-search-item.is-current");
    if (!s || !row) return;
    const box = s.results;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
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
    for (const row of Array.from(s.results.children)) row.classList.toggle("is-current", (row as HTMLElement).dataset.index === String(s.index));
    this.scrollCurrentRow();
  }

  /** 节点收在折叠分支里就展开它的上级（会写回文件里的折叠标记），返回有没有展开 */
  unfoldAncestors(node: MindNode): boolean {
    let unfolded = false;
    for (let p = node.parent; p; p = p.parent) {
      if (p.folded) {
        p.folded = false;
        unfolded = true;
      }
    }
    if (unfolded) {
      this.render();
      if (this.opts.editable) this.notify();
    }
    return unfolded;
  }

  /** 展开命中节点的祖先、选中并把它挪到画布中央 */
  private revealMatch(refocus = true): void {
    const s = this.search;
    if (!s || s.index < 0) return;
    const node = s.list[s.index];
    if (this.unfoldAncestors(node)) this.applyMatchClasses();
    this.select(node);
    this.centerOn(node);
    if (refocus) s.input.focus();
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

  /** 点链接时记下节点：接下来一会儿里画布变窄（分屏打开了笔记），把它带回视野 */
  private linkNode: { id: string; until: number } | null = null;
  private keepLinkNode(node: MindNode): void {
    this.linkNode = { id: node.id, until: performance.now() + 1500 };
  }

  /** 节点不完整在画面里就挪到中间（分屏后左边只剩一半宽，挪最小距离会贴在边上）；完整看得见就不动 */
  private revealLinkNode(node: MindNode): void {
    const p = this.layout?.placed.get(node.id);
    if (!p) return;
    const x1 = this.tx + p.x * this.k;
    const x2 = this.tx + (p.x + p.w) * this.k;
    const y1 = this.ty + p.y * this.k;
    const y2 = this.ty + (p.y + p.h) * this.k;
    if (x1 >= 0 && y1 >= 0 && x2 <= this.el.clientWidth && y2 <= this.el.clientHeight) return;
    this.centerOn(node, true);
    this.positionNodebar();
  }

  /** smooth：约 0.2 秒平滑移过去（中途用户自己平移、缩放了就停下，不和他抢） */
  centerOn(node: MindNode, smooth = false): void {
    const p = this.layout?.placed.get(node.id);
    if (!p) return;
    const tx = this.el.clientWidth / 2 - (p.x + p.w / 2) * this.k;
    const ty = this.el.clientHeight / 2 - (p.y + p.h / 2) * this.k;
    this.stopPanAnim();
    if (!smooth || (Math.abs(tx - this.tx) < 1 && Math.abs(ty - this.ty) < 1)) {
      this.tx = tx;
      this.ty = ty;
      this.applyTransform();
      return;
    }
    const win = this.el.win;
    const sx = this.tx;
    const sy = this.ty;
    const k = this.k;
    // 上一帧设到的位置：和现在对不上，说明别处动过视口（拖动画布、滚轮、缩放），就停下
    let last = { tx: sx, ty: sy };
    const start = performance.now();
    const step = (now: number) => {
      if (this.tx !== last.tx || this.ty !== last.ty || this.k !== k) {
        this.panAnim = null;
        return;
      }
      const t = Math.min(1, (now - start) / 200);
      const e = 1 - Math.pow(1 - t, 3);
      this.tx = sx + (tx - sx) * e;
      this.ty = sy + (ty - sy) * e;
      last = { tx: this.tx, ty: this.ty };
      this.applyTransform();
      this.panAnim = t < 1 ? win.requestAnimationFrame(step) : null;
    };
    this.panAnim = win.requestAnimationFrame(step);
  }

  private panAnim: number | null = null;
  private tapCenter: number | null = null;

  private stopPanAnim(): void {
    if (this.panAnim !== null) this.el.win.cancelAnimationFrame(this.panAnim);
    this.panAnim = null;
  }

  /** 选中变了以后把它带进视野：设置开了「选中节点时自动居中」就平滑移到中间，否则出了视野才挪最小距离 */
  private followSelection(node: MindNode | null): void {
    if (node && this.opts.centerOnSelect?.()) this.centerOn(node, true);
    else this.ensureVisible(node);
  }

  /** 单击选中后的居中等双击间隔过了再做；期间又按下了（双击、拖动）就取消 */
  private scheduleTapCenter(node: MindNode): void {
    this.cancelTapCenter();
    this.tapCenter = this.el.win.setTimeout(() => {
      this.tapCenter = null;
      if (this.primary === node && this.selected.size === 1 && !this.editing) this.centerOn(node, true);
    }, 350);
  }

  private cancelTapCenter(): void {
    if (this.tapCenter !== null) this.el.win.clearTimeout(this.tapCenter);
    this.tapCenter = null;
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
    // 设置里打开「复制时去掉脑图标记」：剪贴板里放干净的 Markdown，带标记的完整版记在本地，
    // 粘回脑图时认出是同一份就用完整版，宽度、标注这些不丢
    const plain = this.opts.copyPlain?.() ? nodes.map((n) => subtreeToList(n, "\t", true)).join("") : text;
    // 编辑节点文字时粘贴：只要复制的这几个节点自己的文字（不带子节点），不要列表的「- 」和标记
    lastCopy = { plain, full: text, titles: nodes.map((n) => n.text) };
    void navigator.clipboard?.writeText(plain).catch(() => undefined);
    return plain;
  }

  /**
   * 编辑节点文字时粘贴的文字：剪贴板里是刚复制的节点，换成这几个节点自己的文字（不带子节点，多个节点一行一个）；
   * 是一行列表项（「- 文字」，比如重启后剪贴板里还留着的节点）就去掉列表符号。别的照常粘，返回 null
   */
  private nodePasteText(clip: string): string | null {
    const text = clip.replace(/\r/g, "");
    if (lastCopy && (text === lastCopy.plain || text === lastCopy.full)) return lastCopy.titles.map((t) => this.toEdit(t)).join("\n");
    const one = /^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?(.*?)\s*$/.exec(text.replace(/\n+$/, ""));
    const title = one?.[1].replace(MARKER_RE, "");
    return title ? this.toEdit(title) : null;
  }

  cutSelection(): void {
    if (!this.opts.editable) return;
    if (this.copySelection()) this.deleteSelected();
  }

  async pasteFromClipboard(): Promise<void> {
    if (!this.opts.editable || !this.doc) return;
    // 右键菜单、工具栏的「粘贴」不经过 paste 事件，得自己读剪贴板：有图片按图片插入，和 ⌘V 一样
    const images = await this.clipboardImages();
    if (images.length) {
      await this.insertImageFiles(images, this.pasteTarget());
      return;
    }
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = this.clipboardText;
    }
    if (!text.trim()) text = this.clipboardText;
    this.pasteText(text);
  }

  /** 剪贴板里的图片（截图、网页上复制的图片）；读不了（没权限、旧系统）就当没有 */
  private async clipboardImages(): Promise<File[]> {
    const files: File[] = [];
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], "image.png", { type }));
      }
    } catch {
      // ignore
    }
    return files;
  }

  /** 把文本解析成节点挂到当前节点下（无选中则挂到根） */
  /**
   * 剪贴板文字粘成选中节点的子节点。select：选中粘进来的节点（平常的粘贴）；
   * 不选（PDF 自动摘录）时选中留在原节点上，接着摘的还加到它下面，只把新节点挪进视野。粘进了东西返回 true
   */
  pasteText(text: string, select = true): boolean {
    if (!this.opts.editable || !this.doc) return false;
    if (lastCopy && lastCopy.plain !== lastCopy.full && text.replace(/\r/g, "") === lastCopy.plain) text = lastCopy.full;
    const nodes = parseClipboard(text);
    if (!nodes.length) return false;
    if (this.editing) this.commitEdit();
    this.remapPastedAnchors(nodes);
    const target = this.pasteTarget() ?? this.doc.root;
    if (target.folded) target.folded = false;
    for (const n of nodes) attachSubtree(n, target, this.doc.style);
    if (select) {
      this.select(null);
      nodes.forEach((n, i) => this.select(n, i === 0 ? "replace" : "add"));
    }
    this.render();
    if (!select) this.ensureVisible(nodes[nodes.length - 1]);
    this.notify();
    // 只粘了一个网页地址：和编辑时粘贴一样，设置里开着就去抓标题，抓到后把节点换成 [标题](网址)
    if (select && nodes.length === 1 && !nodes[0].children.length && isWebUrl(text) && nodes[0].text === text.trim()) this.titlePastedUrl(nodes[0]);
    return true;
  }

  /** 节点还挂在当前这张图上（没被删、文件没整个重新载入） */
  private inDoc(node: MindNode): boolean {
    let n = node;
    while (n.parent) {
      if (!n.parent.children.includes(n)) return false;
      n = n.parent;
    }
    return n === this.doc?.root;
  }

  private titlePastedUrl(node: MindNode): void {
    const url = node.text;
    const pending = this.linkTitle(url);
    if (!pending) return;
    void pending.then((title) => {
      // 等标题的这一会儿节点可能被删了、改过字或正在编辑：那就不动
      if (!title || !this.doc || node.text !== url || !this.inDoc(node) || this.editing === node) return;
      node.text = `[${title.replace(/[[\]]/g, "")}](${linkDestination(url) ?? url})`;
      this.render();
      this.notify();
    });
  }

  // ---------- 节点 ⇄ 笔记 ----------

  /** 已链接：弹菜单（打开 / 取消链接）；未链接：挑一篇笔记或新建，把标签变成 [[笔记|原文]] */
  async linkSelectedToNote(): Promise<void> {
    // 正在编辑：链接选中的那段字（没选中就是整个节点）。⌘K 绑在命令上时也走这里
    if (this.editing) return this.linkEditSelection();
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

  private textColorMenu: HTMLElement | null = null;

  /** 选中节点的整段文字现在是什么颜色：都一样就返回它，没颜色返回 ""，不一样返回 null */
  private wholeTextColor(): string | null {
    const colors = new Set<string>();
    for (const n of this.selected) {
      const m = /^<span style="color:\s*([^";]+?)\s*;?\s*">([\s\S]*)<\/span>$/.exec(splitMarkers(n.text).rest.trim());
      colors.add(m && !m[2].includes("<span") ? m[1] : /<span style="color/.test(n.text) ? "?" : "");
    }
    return colors.size === 1 ? [...colors][0] : null;
  }

  /** 选中的节点整段文字上色（color 为空串 = 去掉文字颜色），原来局部的文字颜色统一换掉 */
  setTextColorOnSelected(color: string): void {
    this.formatText(color ? { kind: "color", color } : { kind: "nocolor" });
  }

  private readonly localColors: Record<string, string> = {};
  private readonly localRecent: Record<string, string[]> = {};
  private colorMemory(): ColorMemory {
    return (
      this.opts.colorMemory ?? {
        last: (k) => this.localColors[k] ?? null,
        recent: (k) => this.localRecent[k] ?? [],
        remember: (k, c) => {
          this.localColors[k] = c;
          this.localRecent[k] = [c, ...(this.localRecent[k] ?? []).filter((x) => x !== c)].slice(0, 8);
        },
      }
    );
  }

  /** 颜色按钮色条上的颜色：上次用的，没有就是常用的第一个（荧光笔再没有就是主题高亮） */
  private currentColor(kind: "text" | "bg"): string | null {
    const common = (kind === "text" ? this.opts.textColors?.() : this.opts.highlightColors?.()) ?? [];
    return this.colorMemory().last(kind) ?? common[0] ?? (kind === "bg" ? THEME_HIGHLIGHT : null);
  }

  /** 选中节点时的色板：文字颜色、荧光笔作用于整个节点的文字，节点颜色改节点的颜色 */
  private toggleColorPalette(kind: ColorKind, anchor: HTMLElement): void {
    const was = this.textColorMenu?.dataset.kind;
    this.textColorMenu?.remove();
    this.textColorMenu = null;
    if (was === kind || !this.opts.editable || !this.selected.size) return;
    const mem = this.colorMemory();
    const common = kind === "node" ? this.nodeColors() : ((kind === "text" ? this.opts.textColors?.() : this.opts.highlightColors?.()) ?? []);
    const close = () => {
      this.textColorMenu?.remove();
      this.textColorMenu = null;
      cleanup();
    };
    const pick = (c: string | null) => {
      close();
      if (c !== null) mem.remember(kind, c);
      if (kind === "node") this.applyColor(c);
      else {
        this.formatText(colorFormat(kind, c));
        refreshColorSplit(anchor);
      }
    };
    const pal = createPalette(this.el.ownerDocument, {
      text: paletteText(),
      common,
      recent: mem.recent(kind),
      alpha: kind !== "node",
      defaultAlpha: kind === "bg" ? 60 : 100,
      paint: (b, c) => paintColor(b, c, kind),
      label: (c) => (kind === "node" && /^[a-z]+$/i.test(c) ? colorLabel(c) : colorTitle(c)),
      noneLabel: kind === "text" ? t("palette.noText") : kind === "bg" ? t("palette.noHighlight") : t("palette.noNodeColor"),
      extras:
        kind === "bg" && !common.includes(THEME_HIGHLIGHT)
          ? [{ value: THEME_HIGHLIGHT, label: t("palette.themeHighlight"), paint: (b) => paintColor(b, THEME_HIGHLIGHT, "bg") }]
          : [],
      onPick: pick,
      tip: (b, text) => this.tip(b, text),
    });
    pal.dataset.kind = kind;
    pal.classList.add("mm-node-palette");
    this.el.append(pal);
    const host = this.el.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const left = Math.max(4, Math.min(host.width - pal.offsetWidth - 4, r.left - host.left));
    const above = r.top - host.top - pal.offsetHeight - 6;
    pal.style.left = `${Math.round(left)}px`;
    pal.style.top = `${Math.round(above >= 4 ? above : r.bottom - host.top + 6)}px`;
    const cleanup = this.dismissOnOutside(pal, close);
    this.textColorMenu = pal;
  }

  /**
   * 编辑节点时把选中的字做成笔记链接：选笔记的对话框会让编辑框失焦（编辑先提交），所以先记下编辑框里的文字和选区，
   * 选好了在这份文字上把选中那段包成链接（保留格式，见 linkWholeText）。没选中文字就把整个节点做成链接
   */
  async linkEditSelection(): Promise<void> {
    const node = this.editing;
    const ed = this.nodeEditor;
    if (!node || !ed || !this.opts.host?.pickNote || this.linking) return;
    const { from, to } = ed.visibleSelection;
    if (from === to) {
      this.commitEdit();
      await this.linkSelectedToNote();
      return;
    }
    const text = ed.text;
    const part = text.slice(from, to);
    this.commitEdit();
    const suggested = plainText(part).replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || t("canvas.untitled");
    this.linking = true;
    let name: string | null | undefined;
    try {
      name = await this.opts.host.pickNote(suggested);
    } finally {
      this.linking = false;
    }
    if (!name || !this.doc) return;
    const next = this.fromEdit(linkRange(text, from, to, name));
    if (next === node.text) return;
    node.text = next;
    this.select(node);
    this.render();
    this.notify();
  }

  applyNoteLink(node: MindNode, basename: string): void {
    // 保留格式：颜色、加粗这些留着，每段文字各自包成链接（见 linkWholeText）
    node.text = linkWholeText(node.text, basename);
    this.select(node);
    this.render();
    this.notify();
  }

  unlinkNote(node: MindNode): void {
    const link = wikilinkOf(node.text);
    if (!link) return;
    node.text = unlinkText(node.text, link.target);
    this.select(node);
    this.render();
    this.notify();
  }

  /** 收掉这一次触摸留下的状态：按住计时、拖动中的节点（不落下）、平移、缩放、记着的按点和指针捕获 */
  private dropTouch(): void {
    this.cancelTouchPress();
    if (this.drag) this.endDrag(false);
    this.pan = null;
    this.pinch = null;
    for (const id of this.pointers.keys()) if (this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id);
    this.pointers.clear();
  }

  private cancelTouchPress(): void {
    if (!this.touchPress) return;
    window.clearTimeout(this.touchPress.timer);
    this.touchPress = null;
  }

  // ---------- 右键菜单 ----------

  private showContextMenu(entries: MenuEntry[], ev: MouseEvent): void {
    // 右键节点要先选中它，选中又会弹出浮动工具栏，和菜单叠在一起；菜单开着时先藏起来。
    // 点空白处关菜单时，菜单在按下那一刻就关了，画布却要等抬起才取消选中，中间工具栏会闪一下，
    // 所以是被按下关掉的就等这次点击结束、选中状态定了再放出来
    this.el.classList.add("is-menu-open");
    const doc = this.el.ownerDocument;
    let pressed = false;
    const onDown = () => (pressed = true);
    const onUp = () => (pressed = false);
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("pointerup", onUp, true);
    const reveal = () => this.el.classList.remove("is-menu-open");
    const onClose = () => {
      doc.removeEventListener("pointerdown", onDown, true);
      doc.removeEventListener("pointerup", onUp, true);
      if (!pressed) return reveal();
      // 万一抬起发生在窗口外收不到，过一会儿也放出来
      const fallback = window.setTimeout(reveal, 1500);
      doc.addEventListener(
        "pointerup",
        () => {
          window.clearTimeout(fallback);
          this.el.win.requestAnimationFrame(reveal);
        },
        { once: true },
      );
    };
    if (this.opts.host?.showMenu) {
      this.opts.host.showMenu(entries, ev, onClose);
      return;
    }
    const items = flattenMenu(entries).filter((e) => !e.separator && e.title && !e.disabled).map((e) => ({ label: e.title!, active: e.checked, run: () => e.run?.() }));
    const host = this.el.getBoundingClientRect();
    this.contextMenu?.remove();
    this.contextMenu = this.buildMenu(items, null, () => {
      this.contextMenu?.remove();
      this.contextMenu = null;
      onClose();
    }, { x: ev.clientX - host.left, y: ev.clientY - host.top });
  }
  private contextMenu: HTMLElement | null = null;

  /** 空白处的右键菜单；落在外框里就是外框自己的菜单（加 / 改标题、移除） */
  private showBackgroundMenu(ev: MouseEvent): void {
    const box = this.opts.editable ? this.boxAt(ev.clientX, ev.clientY) : null;
    // 只弹菜单不改选中：选中会把节点浮动工具栏也带出来，和菜单叠在一起
    if (box && this.editingBox !== box) {
      this.showContextMenu(this.boxMenuEntries(box), ev);
      return;
    }
    this.showContextMenu(this.backgroundMenuEntries(this.toWorld(ev.clientX, ev.clientY)), ev);
  }

  /**
   * 节点右键菜单。常用的留在第一层，成组的（插入、折叠展开、外框、概要）和低频的（更多）收进二级菜单，
   * 第一层固定二十项左右，矮窗口也放得下。Obsidian 拿不到二级菜单时由 host 平铺开
   */
  private nodeMenuEntries(node: MindNode): MenuEntry[] {
    const editable = this.opts.editable;
    const link = wikilinkOf(node.text);
    const sep: MenuEntry = { separator: true };
    const entries: MenuEntry[] = [];
    // 概要主题不在兄弟里：没有兄弟、前后、父节点这些操作，范围和移除在「概要 ▸」里
    const topic = isSummaryTopic(node);
    if (editable) {
      entries.push(
        { id: "edit", title: `${t("menu.edit")}  F2`, icon: "pencil", run: () => this.startEdit(node) },
        { id: "addChild", title: `${t("menu.addChild")}  Tab`, icon: "corner-down-right", run: () => this.addChildToSelected() },
        { id: "addSibling", title: node.parent ? `${t("menu.addSibling")}  ${sc("Enter")}` : t("menu.addSibling"), icon: "list-plus", disabled: (!node.parent && !this.canAddRootSibling(node)) || topic, why: topic ? t("why.topicSibling") : t("why.rootSibling"), run: () => this.addSiblingToSelected(false) },
        {
          id: "insert",
          title: t("menu.insertGroup"),
          icon: "between-horizontal-start",
          // 概要主题跟着括住的范围走，前后插不了，也不放表格
          disabled: topic,
          why: t("why.topicSibling"),
          submenu: [
            { title: node.parent ? `${t("menu.insertBefore")}  ${sc("Shift", "Enter")}` : t("menu.insertBefore"), icon: "list-start", disabled: (!node.parent && !this.canAddRootSibling(node)) || topic, why: topic ? t("why.topicSibling") : t("why.rootSibling"), run: () => this.addSiblingToSelected(true) },
            { title: `${t("menu.insertParent")}  ${sc("Mod", "Enter")}`, icon: "corner-left-up", disabled: !node.parent || topic, why: topic ? t("why.topicSibling") : t("why.rootParent"), run: () => this.insertParentForSelected() },
            // 节点里的表格：没有就插入一张，备注里有表就放进节点（第一层菜单放不下了，归到「插入」里）
            ...(this.nodeTable(node) ? [] : [this.tableMenuEntry(node)]),
            { title: t("menu.tableChild"), icon: "table", run: () => this.insertTableChild(node) },
            // 图片、视频（#40）：手机上没法粘贴、拖文件进节点，从这里选
            ...(this.opts.host?.saveBinary ? [{ title: t("menu.insertMedia"), icon: "image-plus", run: () => this.pickMedia(node) }] : []),
          ],
        },
        sep,
      );
    }
    const leaf = !node.children.length;
    // 展开全部 / 折叠全部是高频操作，成对放在第一层；一层层收放、聚焦、缩放放进「折叠与视图 ▸」，第一层别太长
    if (!leaf) {
      entries.push(
        { id: "expandCollapse", title: `${t("menu.expandBranch")}  0`, icon: "chevrons-up-down", run: () => this.setFoldLevel(null, node) },
        { id: "expandCollapse", title: `${t("menu.collapseBranch")}  ${sc("Shift", "0")}`, icon: "chevrons-down-up", run: () => this.collapseBranch(node) },
      );
    }
    entries.push(
      {
        id: "fold",
        title: t("menu.foldGroup"),
        icon: node.folded ? "chevron-down" : "chevron-right",
        submenu: [
          { title: `${node.folded ? t("menu.expand") : t("menu.collapse")}  /`, icon: node.folded ? "chevron-down" : "chevron-right", disabled: leaf, why: t("why.leaf"), run: () => this.toggleFold(node) },
          { title: `${t("menu.expandLevel")}  =`, icon: "chevron-down", disabled: leaf, why: t("why.leaf"), run: () => this.stepFoldLevel(node, 1) },
          { title: `${t("menu.collapseLevel")}  -`, icon: "chevron-up", disabled: leaf, why: t("why.leaf"), run: () => this.stepFoldLevel(node, -1) },
          // 和数字键一样从这个节点往下算：1 = 只露出下一级
          { title: `${t("menu.expandNextLevel")}  1`, icon: "chevron-down", disabled: leaf, why: t("why.leaf"), run: () => this.setFoldLevel(1, node) },
          // 整张图里和它同一层的节点都折起来（上面几层展开）：层级多时比工具栏的「显示到第 3 层」管用（B站反馈）
          { title: t("menu.foldSameLevel"), icon: "chevrons-down-up", disabled: node === (this.focusRoot ?? this.doc?.root), why: t("why.rootSameLevel"), run: () => this.foldSameLevel(node) },
          sep,
          this.focusRoot === node
            ? { title: t("menu.exitFocus"), icon: "minimize", run: () => this.exitFocus() }
            : { title: t("menu.focusBranch"), icon: "focus", disabled: leaf, why: t("why.leaf"), run: () => this.focusOn(node) },
          { title: `${t("menu.fitBranch")}  ${sc("Mod", "Shift", "0")}`, icon: "scan", run: () => this.fitBranch(node) },
          ...(this.opts.embedded ? [] : [{ title: t("menu.presentFromHere"), icon: "presentation", run: () => this.startPresent(node) }]),
        ],
      },
      sep,
    );
    if (editable) {
      if (link) {
        entries.push(
          { id: "link", title: t("menu.openLink", { target: link.target }), icon: "file-text", run: () => this.opts.host?.openLink?.(link.target, true, new MouseEvent("click")) },
          { id: "link", title: t("menu.unlink"), icon: "unlink", run: () => this.unlinkNote(node) },
        );
      } else if (this.opts.host?.pickNote) {
        entries.push({ id: "link", title: `${t("menu.linkNote")}  ${sc("Mod")}K`, icon: "link", run: () => void this.linkSelectedToNote() });
      }
      entries.push(
        { id: "note", title: `${node.note ? t("menu.editNote") : t("menu.addNote")}  ${sc("Mod", "Shift", "M")}`, icon: "sticky-note", run: () => this.toggleNotePopover(node, true) },
      );
      if (this.noteShown(node)) entries.push({ id: "deleteNote", title: t("menu.deleteNote"), icon: "trash-2", run: () => this.deleteNote(node) });
      entries.push(
        // 带标注的节点：编辑、颜色、删除收进「标注」二级菜单（颜色原来只在气泡上右键才有，不好找，蝈蝈）；
        // 第一层项数不变，菜单才放得进窗口
        node.callout !== undefined
          ? {
              id: "callout",
              title: t("menu.calloutGroup"),
              icon: "message-square",
              submenu: [
                { title: t("menu.editCallout"), icon: "pencil", run: () => this.editCallout(node) },
                { title: t("menu.removeCallout"), icon: "x", run: () => this.removeCallout(node) },
                { separator: true },
                ...this.calloutColorEntries(node),
              ],
            }
          : { id: "callout", title: t("menu.addCallout"), icon: "message-square", run: () => this.editCallout(node) },
        { id: "rel", title: t("menu.addRel"), icon: "spline", run: () => this.startRel(node) },
        { id: "markers", title: t("menu.markers"), icon: "star", run: () => this.toggleMarkerPicker(true) },
        { id: "task", title: `${t("menu.task")}  ${sc("Mod", "L")}`, icon: "check-square", checked: /^\[( |x|X)\]\s/.test(splitMarkers(node.text).rest), run: () => this.toggleTaskOnSelected() },
      );
      if (node.parent && !topic) {
        const on = !!node.parent.numbered;
        entries.push({ id: "numbering", title: t("menu.numbering"), icon: "list-ordered", checked: on, disabled: !this.canNumber(node.parent), why: t("why.numberHeadings"), run: () => this.toggleNumbering(!on) });
      }
      {
        // 右键的是选中的节点之一：对选中的一起。有折行的可以拉成一行，设过宽度的可以恢复；两样都有时收进「节点宽度」二级菜单，第一层只占一项
        const group = this.selected.size > 1 && this.selected.has(node) ? [...this.selected] : [node];
        const many = group.filter((n) => n.width);
        const wrapped = this.oneLineWidths(group).size > 0;
        const fit = { id: "width", title: t("menu.oneLine"), icon: "move-horizontal", run: () => this.fitOneLine(group) };
        const reset = { id: "width", title: t("menu.resetWidth"), icon: "rotate-ccw", run: () => this.resetWidths(many) };
        if (wrapped && many.length) entries.push({ id: "width", title: t("menu.widthGroup"), icon: "move-horizontal", submenu: [fit, reset] });
        else if (wrapped) entries.push(fit);
        else if (many.length) entries.push({ ...reset, icon: "move-horizontal" });
      }
      // 外框 / 概要：还没有时只有「添加」一项，直接放第一层；有了以后操作好几项，收进二级菜单
      const box = this.boxOf(node);
      if (box) entries.push({ id: "box", title: t("menu.boxGroup"), icon: "square-dashed", submenu: this.boxMenuEntries(box) });
      else entries.push({ id: "box", title: `${t("menu.addBox")}  ${sc("Mod", "Shift", "B")}`, icon: "square-dashed", disabled: !node.parent || this.isFloating(node) || topic, why: !node.parent ? t("why.rootBox") : topic ? t("why.topicBox") : t("why.floatBox"), run: () => this.addBoxToSelected() });
      const summary = topic ? node.topicOf! : this.summaryOf(node);
      if (summary) entries.push({ id: "summary", title: t("menu.summaryGroup"), icon: "brackets", submenu: this.summaryMenuEntries(summary) });
      else entries.push({ id: "summary", title: `${t("menu.addSummary")}  ${sc("Mod", "]")}`, icon: "brackets", disabled: !node.parent || this.isFloating(node), why: !node.parent ? t("why.rootSummary") : t("why.floatSummary"), run: () => this.addSummaryToSelected() });
      entries.push(sep);
    }
    entries.push({ id: "copy", title: t("menu.copy"), icon: "copy", run: () => this.copySelection() });
    // 节点里有图片时可以把图片本身复制出去（⌘C 复制的是 Markdown 文字）
    const img = this.els.get(node.id)?.querySelector<HTMLImageElement>(".mm-label img.mm-img");
    if (img) entries.push({ id: "copyImage", title: t("menu.copyImage"), icon: "image", run: () => void this.copyImage(img) });
    if (editable) {
      entries.push(
        { id: "cut", title: t("menu.cut"), icon: "scissors", run: () => this.cutSelection() },
        { id: "paste", title: t("menu.pasteChild"), icon: "clipboard-paste", run: () => void this.pasteFromClipboard() },
      );
    }
    entries.push(sep);
    // 更多：低频的转换、链接、跳转
    const more: MenuEntry[] = [];
    if (editable) {
      const parent = node.parent;
      const canHeading = !!parent && parent.kind === "heading" && parent.level + 1 <= 6;
      more.push(
        // 已经是标题 / 列表的那一项不出现；别的原因转不了的灰着、说原因
        ...(node.kind === "heading" ? [] : [{ id: "convert", title: t("menu.toHeading"), icon: "heading", disabled: !parent || topic || !canHeading, why: !parent ? t("why.rootConvert") : topic ? t("why.topicConvert") : t("why.toHeading"), run: () => this.convertLevel(node, "heading") }]),
        ...(node.kind === "list" ? [] : [{ id: "convert", title: t("menu.toList"), icon: "list", disabled: !parent || topic || !!this.doc?.style.headingsOnly, why: !parent ? t("why.rootConvert") : topic ? t("why.topicConvert") : t("why.headingsOnly"), run: () => this.convertLevel(node, "list") }]),
      );
      more.push({
        id: "split",
        title: t("menu.splitInto"),
        icon: "split",
        submenu: this.splitRules().map((r) => ({ title: r.label, disabled: !this.splittable(node, r.rule).length, why: t("why.splitNone"), run: () => this.splitIntoChildren(node, r.rule) })),
      });
      if (node.parent && !topic) {
        more.push(
          node.hidden
            ? { id: "hide", title: t("menu.unhideNode"), icon: "eye", run: () => this.unhideSelected() }
            : { id: "hide", title: t("menu.hideNode"), icon: "eye-off", run: () => this.hideSelected() },
        );
      }
      more.push({ id: "branchLayout", title: t("menu.branchLayout"), icon: "network", submenu: this.branchLayoutMenu(node) });
      if (this.isFloating(node)) more.push({ id: "float", title: t("menu.attachFloat"), icon: "link", run: () => this.attachFloat(node) });
      else if (node.parent && !topic && this.canFloat()) more.push({ id: "float", title: t("menu.toFloat"), icon: "square-dashed-mouse-pointer", run: () => this.convertToFloat(node) });
      more.push(sep);
    }
    if (editable && this.nodeTable(node)) {
      more.push(
        { id: "nodeTable", title: t("menu.tableToNote"), icon: "sticky-note", run: () => this.setTableInNode(node, false) },
        { id: "nodeTable", title: t("menu.deleteTable"), icon: "trash-2", run: () => this.deleteNodeTable(node) },
        sep,
      );
    }
    more.push({ id: "nodeLink", title: t("menu.copyNodeLink"), icon: "link-2", disabled: !this.opts.host?.fileBasename, run: () => void this.copyNodeLink(node) });
    // 带别名：[[笔记#^id|节点的内容]]，粘到别处显示的是内容不是一串 id（zhiqiang 反馈）
    more.push({ id: "nodeLink", title: t("menu.copyNodeLinkAlias"), icon: "link-2", disabled: !this.opts.host?.fileBasename, run: () => void this.copyNodeLink(node, true) });
    if (this.opts.onRevealInMarkdown) more.push({ id: "reveal", title: t("menu.revealInMarkdown"), icon: "file-search", run: () => this.opts.onRevealInMarkdown?.() });
    // 整个节点的文字颜色（浮动工具栏上也有）：第一层菜单放不下了，放在「更多」最后（放最前时，鼠标往二级菜单里移会先扫过它、弹出三级菜单挡住别的项）
    if (editable) {
      const now = this.wholeTextColor();
      more.push({
        id: "textColor",
        title: t("menu.textColor"),
        icon: "baseline",
        submenu: [
          { title: t("canvas.defaultTextColor"), checked: now === "", run: () => this.setTextColorOnSelected("") },
          ...(this.opts.textColors?.() ?? []).map((c): MenuEntry => ({ title: colorLabel(c), checked: now === c, run: () => this.setTextColorOnSelected(c) })),
        ],
      });
    }
    // 间隔复习放在「更多」最前面：第一层菜单不能再长了（矮窗口里放不下）；常用的「复习」在工具栏上
    const review = this.reviewMenu(node);
    if (review.length) more.unshift({ id: "review", title: t("menu.reviewGroup"), icon: "layers", submenu: review }, sep);
    entries.push({ id: MORE_SLOT });
    if (editable && node.parent) {
      entries.push(sep, { id: "delete", title: `${t("menu.delete")}  ${isApple() ? "⌫" : "Delete"}`, icon: "trash", run: () => this.deleteSelected() });
      if (node.children.length && !topic) entries.push({ id: "delete", title: `${t("menu.deleteOnly")}  ${sc("Mod", isApple() ? "⌫" : "Backspace")}`, icon: "eraser", run: () => this.deleteOnlySelected() });
    }
    // 按设置把各项放到第一层、「更多」或去掉（设置 → 编辑与操作 → 右键菜单）
    const placed = arrangeMenu(entries, more, this.opts.menuLayout?.(), () => ({ separator: true }));
    const moreAt = placed.top.findIndex((e) => e.id === MORE_SLOT);
    if (placed.more.length) placed.top[moreAt] = { title: t("menu.more"), icon: "more-horizontal", submenu: placed.more };
    else placed.top.splice(moreAt, 1);
    return tidySeparators(placed.top);
  }

  private backgroundMenuEntries(at?: { x: number; y: number }): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (this.opts.editable) {
      if (at && this.canFloat()) entries.push({ title: t("menu.newFloat"), icon: "square-plus", run: () => this.createFloatAt(at) });
      entries.push({ title: t("menu.paste"), icon: "clipboard-paste", run: () => void this.pasteFromClipboard() }, { separator: true });
    }
    entries.push(
      { title: t("canvas.expandAll"), icon: "chevrons-down-up", run: () => this.setFoldLevel(null) },
      { title: t("canvas.mainTopicsOnly"), icon: "chevrons-up-down", run: () => this.setFoldLevel(1) },
      { title: t("menu.fit"), icon: "maximize", run: () => this.userFit() },
    );
    if (this.focusRoot) entries.push({ separator: true }, { title: t("menu.exitFocus"), icon: "minimize", run: () => this.exitFocus() });
    if (this.opts.onZen) entries.push({ separator: true }, this.zen ? { title: t("canvas.zenExit"), icon: "minimize", run: () => this.setZen(false) } : { title: t("canvas.zen"), icon: "maximize-2", run: () => this.setZen(true) });
    const side = this.opts.onSideBySide;
    if (side) entries.push({ separator: true }, { title: t("command.openPreview"), icon: "columns-2", run: () => side() });
    // 间隔复习（和右键中心主题「更多」里的一样）：空白处的菜单短，放在第一层好找
    const review = this.doc ? this.reviewMenu(this.doc.root) : [];
    if (review.length) entries.push({ separator: true }, { title: t("menu.reviewGroup"), icon: "layers", submenu: review });
    return entries;
  }

  private convertLevel(node: MindNode, kind: "heading" | "list"): void {
    if (!this.doc || !this.opts.editable || isSummaryTopic(node)) return;
    if (!convertLevelKind(node, kind, this.doc.style)) {
      this.opts.host?.notice?.(t("notice.cannotHeading"));
      return;
    }
    this.render();
    this.notify();
  }

  toggleTaskOnSelected(): void {
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
  // ---------- 局部格式 ----------

  /**
   * 粗体、斜体、高亮、文字颜色、荧光笔。编辑中作用于选中的那段文字（没选就是整段）；
   * 不在编辑就作用于每个选中节点的整段文字（开头的标记和任务框不动）
   */
  formatText(fmt: InlineFormat): void {
    if (!this.opts.editable) return;
    if (this.noteFormat) {
      this.noteFormat(fmt);
      return;
    }
    if (this.editing || this.calloutEditor) {
      this.formatEditing(fmt);
      return;
    }
    if (!this.selected.size) return;
    let changed = false;
    for (const n of this.selected) {
      const editable = this.toEdit(n.text);
      // 开头的标记、任务框不加格式（两者谁在前都行，#46）：从正文开始的地方算
      const { rest } = splitMarkers(n.text);
      const body = rest.replace(/^\[( |x|X)\]\s+/, "");
      const start = editable.length - this.toEdit(body).length;
      if (start >= editable.length) continue;
      const next = this.fromEdit(applyFormat(editable, start, editable.length, fmt).text);
      if (next !== n.text) {
        n.text = next;
        changed = true;
      }
    }
    if (!changed) return;
    this.render();
    this.notify();
  }

  /** 用设置里第 index 个常用颜色上色；没有这一个就不动 */
  formatColor(kind: "color" | "bg", index: number): void {
    const color = (kind === "color" ? this.opts.textColors?.() : this.opts.highlightColors?.())?.[index];
    if (color) this.formatText(highlightFormat(kind, color));
  }

  private formatEditing(fmt: InlineFormat): void {
    const ed = this.nodeEditor ?? this.calloutEditor;
    if (!ed) return;
    // 选中的只是藏起来的标记、一个看得见的字都没有：不动（不然会当成没选，整段都上格式）
    const raw = ed.selection;
    const { from, to } = ed.visibleSelection;
    if (raw.from !== raw.to && from === to) return;
    const r = applyFormat(ed.text, from, to, fmt);
    if (r.text !== ed.text) ed.setText(r.text, r.start, r.end);
  }

  /** 编辑中选中一段文字时浮在它上面的格式栏（设置里打开才有） */
  private updateFormatBar(): void {
    const ed = this.nodeEditor ?? this.calloutEditor;
    const rect = ed && this.opts.formatBar?.() ? ed.selectionRect() : null;
    if (!ed || !rect) {
      this.formatBar?.remove();
      this.formatBar = null;
      return;
    }
    if (!this.formatBar) this.formatBar = this.buildFormatBar();
    const bar = this.formatBar;
    const host = this.el.getBoundingClientRect();
    // 竖直方向避开整个节点（选区在第一行时，紧贴选区放会压住节点边框）
    const nodeRect = (ed.host.closest(".gg-mm-node") ?? ed.host).getBoundingClientRect();
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const left = Math.max(4, Math.min(host.width - w - 4, rect.left + rect.width / 2 - host.left - w / 2));
    const above = Math.min(rect.top, nodeRect.top) - host.top - h - 6;
    const below = Math.max(rect.bottom, nodeRect.bottom) - host.top + 6;
    const place = this.opts.barPlacement?.() ?? "above";
    let top: number;
    if (place === "top") {
      bar.style.left = `${Math.round(Math.max(4, (host.width - w) / 2))}px`;
      bar.style.top = `${Math.round(this.topBarInset())}px`;
      return;
    }
    // 上面放不下就放到选区下面；设成「下方」时反过来
    if (place === "below") top = below + h <= host.height - 4 || above < 4 ? below : above;
    else top = above >= 4 ? above : below;
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
  }

  private buildFormatBar(): HTMLElement {
    const bar = createFormatBar(this.el.ownerDocument, {
      textColors: this.opts.textColors?.() ?? [],
      highlightColors: this.opts.highlightColors?.() ?? [],
      underlineKey: sc("Mod", "U"),
      icon,
      tip: (el, text) => this.tip(el, text),
      onFormat: (fmt) => this.formatText(fmt),
      memory: this.colorMemory(),
      // 系统取色器会让编辑框失焦（编辑先提交）：记下节点和选区，选好颜色后在提交后的文字上同一段上色
      onCustom: () => {
        const node = this.editing;
        const callout = this.calloutEditor ? this.editingCallout : null;
        const sel = (this.nodeEditor ?? this.calloutEditor)?.visibleSelection ?? null;
        return (fmt) => {
          if ((this.editing && this.editing === node) || (callout && this.editingCallout === callout && this.calloutEditor)) {
            this.formatText(fmt);
            return;
          }
          // 标注：取色时编辑框失焦、标注已经提交，在提交后的文字上同一段上色
          if (callout) {
            if (!sel || callout.callout === undefined) return;
            const next = calloutFromMarker(calloutToMarker(applyFormat(callout.callout, sel.from, sel.to, fmt).text));
            if (next === callout.callout) return;
            callout.callout = next;
            this.render();
            this.notify();
            return;
          }
          if (!node || !sel) return;
          const next = this.fromEdit(applyFormat(this.toEdit(node.text), sel.from, sel.to, fmt).text);
          if (next === node.text) return;
          node.text = next;
          this.render();
          this.notify();
        };
      },
      ...(this.opts.host?.pickNote ? { onLink: () => void this.linkEditSelection(), linkKey: sc("Mod", "K") } : {}),
      split: { title: t("bar.split"), items: this.splitRules().map((r) => ({ label: r.label, run: () => this.splitSelection(r.rule) })) },
    });
    this.el.append(bar);
    return bar;
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
        if (isAnswerMarker(emoji)) this.tip(b, t("marker.answerTip"));
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
    // 焦点在面板的按钮上，面板一删就落到 body，⌘Z 到不了画布；收回来
    const refocus = !!this.markerPicker?.contains(this.el.ownerDocument.activeElement);
    this.markerPicker?.remove();
    this.markerPicker = null;
    if (refocus) this.el.focus({ preventScroll: true });
  }

  // ---------- 聚焦分支 ----------

  focusOn(node: MindNode): void {
    if (!this.doc || node === this.doc.root) {
      this.exitFocus();
      return;
    }
    if (this.editing) this.commitEdit();
    // 已经在聚焦里换一个分支（面包屑、上一个 / 下一个）：缩放不变，新分支的主题放在原来那个主题的位置上，像翻 PPT（#43）
    const prev = this.focusRoot && this.hasView ? this.layout?.placed.get(this.focusRoot.id) : null;
    const at = prev ? { x: prev.x * this.k + this.tx, y: prev.y * this.k + this.ty } : null;
    this.focusRoot = node;
    if (!at) {
      this.hasView = false; // 重新适应画布
      this.refitOnly = true;
    }
    this.select(node);
    this.render();
    const p = at ? this.layout?.placed.get(node.id) : null;
    if (at && p) {
      this.stopPanAnim();
      this.tx = at.x - p.x * this.k;
      this.ty = at.y - p.y * this.k;
      this.applyTransform();
    }
  }

  /** 聚焦分支时的同级（上一个 / 下一个用）：隐藏的、概要主题不算 */
  private focusSiblings(): { prev: MindNode | null; next: MindNode | null } {
    const f = this.focusRoot;
    const parent = f?.parent;
    if (!f || !parent || !parent.children.includes(f)) return { prev: null, next: null };
    const kids = parent.children.filter((c) => !c.hidden || c === f);
    const i = kids.indexOf(f);
    return { prev: kids[i - 1] ?? null, next: kids[i + 1] ?? null };
  }

  /** 聚焦到上一个 / 下一个同级分支；没有返回 false */
  focusStep(dir: -1 | 1): boolean {
    const { prev, next } = this.focusSiblings();
    const to = dir < 0 ? prev : next;
    if (!to) return false;
    this.closeCrumbMenu();
    this.focusOn(to);
    return true;
  }

  exitFocus(rerender = true): void {
    if (!this.focusRoot) return;
    this.focusRoot = null;
    this.hasView = false;
    this.refitOnly = true;
    if (rerender) this.render();
  }

  /** 丢掉当前视口，下次画的时候按打开时的默认方式重新摆 */
  resetView(): void {
    this.hasView = false;
    this.viewAnchor = null;
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
        // 分隔符是个下拉：列出前一级的全部子主题（下一级的同级），点一个直接聚焦过去（#42）
        const sepEl = createEl("button");
        sepEl.type = "button";
        sepEl.className = "mm-crumb-sep";
        sepEl.textContent = "›";
        sepEl.setAttr("aria-label", t("canvas.crumbSiblings"));
        const parent = chain[i - 1];
        sepEl.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleCrumbMenu(sepEl, parent, n);
        });
        bar.append(sepEl);
      }
      const b = createEl("button");
      b.type = "button";
      b.className = "mm-crumb" + (i === chain.length - 1 ? " is-current" : "");
      b.textContent = i === 0 ? t("canvas.wholeMap") : plainText(n.text) || t("canvas.emptyNode");
      b.addEventListener("click", () => (i === 0 ? this.exitFocus() : this.focusOn(n)));
      bar.append(b);
    });
    // 上一个 / 下一个同级分支（#43）：到头了按钮变灰
    const { prev, next } = this.focusSiblings();
    if (prev || next) {
      const nav = bar.createSpan({ cls: "mm-crumb-nav" });
      for (const [dir, to, name, label] of [
        [-1, prev, "prev", t("canvas.focusPrev")],
        [1, next, "next", t("canvas.focusNext")],
      ] as const) {
        const nb = nav.createEl("button", { cls: "mm-crumb-step", attr: { type: "button", "data-dir": String(dir) } });
        nb.append(icon(name));
        this.tip(nb, to ? `${label} · ${plainText(to.text) || t("canvas.emptyNode")}` : label, "fixed", "bottom");
        nb.toggleClass("is-disabled", !to);
        // 按下不抢焦点：点完接着能用 PageUp / PageDown、方向键
        nb.addEventListener("mousedown", (ev) => ev.preventDefault());
        nb.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.focusStep(dir);
          this.el.focus({ preventScroll: true });
        });
      }
    }
    this.el.append(bar);
    this.crumbs = bar;
  }

  private crumbMenu: HTMLElement | null = null;
  private crumbMenuOpener: HTMLElement | null = null;
  /** 面包屑分隔符的下拉：parent 的子主题（隐藏的、概要主题不算），current 打勾；面包屑在下面时往上弹 */
  private toggleCrumbMenu(anchor: HTMLElement, parent: MindNode, current: MindNode): void {
    if (this.crumbMenu) {
      const same = this.crumbMenuOpener === anchor;
      this.closeCrumbMenu();
      if (same) return;
    }
    this.crumbMenuOpener = anchor;
    const kids = parent.children.filter((c) => !c.hidden || c === current);
    if (!kids.length) return;
    const host = this.el.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const menu = this.buildMenu(
      kids.map((c) => ({ label: plainText(c.text) || t("canvas.emptyNode"), active: c === current, run: () => this.focusOn(c), color: c.color ?? null })),
      null,
      () => this.closeCrumbMenu(),
      { x: r.left - host.left, y: r.bottom - host.top + 4 },
      anchor,
    );
    menu.classList.add("mm-crumb-menu");
    // 禅模式下菜单开着时面包屑一直显示：样式按这个类，不用 :has
    this.el.classList.add("has-crumb-menu");
    if (r.top - host.top > host.height / 2) menu.style.top = `${Math.max(4, r.top - host.top - 4 - menu.offsetHeight)}px`;
    this.crumbMenu = menu;
  }

  private closeCrumbMenu(): void {
    this.crumbMenu?.remove();
    this.crumbMenu = null;
    this.el.classList.remove("has-crumb-menu");
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

  /** 图片文件存成附件，返回嵌入用的链接文本；失败给提示、返回 null */
  private async saveImageFile(f: File): Promise<string | null> {
    const save = this.opts.host?.saveBinary;
    if (!save) {
      this.opts.host?.notice?.(t("notice.saveImageUnsupported"));
      return null;
    }
    try {
      const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      // 剪贴板、手机相册给的是 image.png / image.jpg 这种通用名：换成和 Obsidian 粘贴图片一样的名字
      const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : `Pasted image ${stamp}.${/\.(\w+)$/.exec(f.name)?.[1] ?? ext}`;
      return await save(name, await f.arrayBuffer());
    } catch (e) {
      this.opts.host?.notice?.(t("notice.saveImageFailed", { error: (e as Error).message }));
      return null;
    }
  }

  /** 图片存成附件，追加到节点备注的末尾；正在编辑这个节点的文字时不打断，提交时备注图标一起出来 */
  private async addImagesToNote(node: MindNode, files: File[]): Promise<void> {
    const links: string[] = [];
    for (const f of files) {
      const link = await this.saveImageFile(f);
      if (link) links.push(`![[${link}]]`);
    }
    if (!links.length) return;
    node.note = this.storeNote(node, [unescapeNote(node.note), ...links].filter(Boolean).join("\n"));
    this.opts.host?.notice?.(t("notice.imageAddedToNote"));
    if (this.editing !== node) this.render();
    this.notify();
  }

  /**
   * 「插入图片或视频」（#40）：手机上没法往节点里粘贴、拖文件，用系统的选文件框。
   * 选好的存成附件（照 Obsidian 的附件位置设置），嵌入接在节点文字后面，图片、视频直接显示在节点上。
   * 中心主题是文件名的时候不能往文字里加（会把文件改名），改成插成子节点
   */
  private pickMedia(node: MindNode): void {
    if (!this.opts.editable) return;
    if (!this.opts.host?.saveBinary) {
      this.opts.host?.notice?.(t("notice.saveImageUnsupported"));
      return;
    }
    const doc = this.el.ownerDocument;
    const input = doc.body.createEl("input", { type: "file" });
    input.multiple = true;
    input.accept = "image/*,video/*,audio/*";
    input.setCssStyles({ display: "none" });
    const done = () => input.remove();
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      done();
      if (files.length) void this.addMediaToNode(node, files);
    });
    input.addEventListener("cancel", done);
    input.click();
  }

  private async addMediaToNode(node: MindNode, files: File[]): Promise<void> {
    if (!this.doc) return;
    if (!node.parent && !this.doc.rootFromHeading) {
      await this.insertImageFiles(files, node);
      return;
    }
    const links: string[] = [];
    for (const f of files) {
      const link = await this.saveImageFile(f);
      if (link) links.push(`![[${link}]]`);
    }
    if (!links.length) return;
    const live = this.nodeById.get(node.id) ?? node;
    live.text = [live.text.trimEnd(), ...links].filter(Boolean).join(" ");
    this.render();
    this.notify();
    const active = this.el.ownerDocument.activeElement;
    if (!active || active === this.el.ownerDocument.body || this.el.contains(active)) this.el.focus({ preventScroll: true });
  }

  /** 把图片文件存成附件并作为子节点插入 */
  private async insertImageFiles(files: File[], target: MindNode | null): Promise<void> {
    if (!this.doc || !target) return;
    if (!this.opts.host?.saveBinary) {
      this.opts.host?.notice?.(t("notice.saveImageUnsupported"));
      return;
    }
    const created: MindNode[] = [];
    for (const f of files) {
      try {
        const link = await this.saveImageFile(f);
        if (!link) continue;
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
    // 存附件要等一会儿，期间点过的按钮、菜单可能已经没了，焦点落到 body 上，⌘Z 就到不了画布。
    // 焦点还在画布里或者已经丢了，就收回来；用户点去了别处则不抢
    const active = this.el.ownerDocument.activeElement;
    if (!active || active === this.el.ownerDocument.body || this.el.contains(active)) this.el.focus({ preventScroll: true });
  }

  // ---------- 复制节点链接 ----------

  async copyNodeLink(node: MindNode, alias = false): Promise<void> {
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
    if (alias) {
      // 别名里不能有 | [ ]（会把链接截断），换行、多个空格并成一个
      const label = plainText(node.text).replace(/[|[\]]/g, " ").replace(/\s+/g, " ").trim();
      if (label && label !== base) link = `${link.slice(0, -2)}|${label}]]`;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.opts.host?.notice?.(t("notice.copied", { link }));
    } catch {
      this.opts.host?.notice?.(t("notice.copyFailed"));
    }
  }

  /** 把节点里的图片以 PNG 放进剪贴板：剪贴板只认 PNG，其他格式先画到 canvas 上转一下 */
  private async copyImage(img: HTMLImageElement): Promise<void> {
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const src = new Image();
        src.crossOrigin = "anonymous";
        src.onload = () => {
          const c = createEl("canvas");
          c.width = src.naturalWidth;
          c.height = src.naturalHeight;
          c.getContext("2d")?.drawImage(src, 0, 0);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
        };
        src.onerror = () => reject(new Error("load"));
        src.src = img.currentSrc || img.src;
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      this.opts.host?.notice?.(t("notice.imageCopied"));
    } catch {
      this.opts.host?.notice?.(t("notice.copyFailed"));
    }
  }

  // ---------- 图片缩放手柄 ----------

  /** 选中含图片的节点时，在图片右下角放一个拖拽手柄 */
  /**
   * 节点右边缘的宽度手柄：一条铺满右边、平时透明的窄条，拖动改宽（文字跟着换行），双击见 toggleWidth。
   * 选中的节点一直有；设置里打开「悬停调宽度」后，鼠标指着的节点也有，不用先选中，竖条（选中的也一样）指到边上才显示。图片/视频节点有自己的手柄
   */
  private updateWidthHandle(): void {
    if (this.widthResize) return;
    const target = this.widthHandleTarget();
    const el = target ? this.els.get(target.id) : undefined;
    const usable = target && el && !el.querySelector("img.mm-img, iframe.mm-frame, video.mm-media") ? target : null;
    // 悬停调宽度打开时，选中的节点也一样：竖条平时透明，指到右边缘才出现
    const hover = !!usable && !!this.opts.widthHandleOnHover?.();
    // 还是同一个节点、同一个元素：留着，悬停时鼠标在节点里移动不会一直重建
    const kept = this.widthHandle;
    if (usable && kept && kept.parentElement === el && this.widthHandleNode === usable) {
      kept.classList.toggle("is-hover", hover);
      return;
    }
    this.widthHandle?.remove();
    this.widthHandle = null;
    this.widthHandleNode = null;
    if (!usable || !el) return;
    const node = usable;
    // 左侧分支向左长：手柄放在外侧（左边），往左拖是变宽
    const dir: 1 | -1 = el.dataset.side === "left" ? -1 : 1;
    const handle = createDiv();
    handle.className = "mm-width-handle" + (dir < 0 ? " is-left" : "") + (hover ? " is-hover" : "");
    // 鼠标停一会儿才出提示：路过、直接拖的时候不弹出来挡住旁边的节点（B 站落尘-书生）
    this.tip(handle, t("canvas.resizeWidth"), "fixed", dir < 0 ? "left" : "right", 1200);
    el.append(handle);
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      // 框选了好几个、拖的是其中一个：选中的节点（图片、视频节点除外）一起设成同样宽度
      const group = (this.selected.size > 1 && this.selected.has(node) ? [...this.selected] : [node])
        .map((n) => ({ node: n, el: this.els.get(n.id)! }))
        .filter((g) => g.el && !g.el.querySelector("img.mm-img, iframe.mm-frame, video.mm-media"))
        .map((g) => ({ ...g, w: g.el.offsetWidth }));
      this.widthResize = { node, el, startWorldX: this.toWorld(ev.clientX, ev.clientY).x, startW: el.offsetWidth, dir, group };
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
      if (!r.moved && Math.abs(dx) < 1) return;
      r.moved = true;
      for (const g of r.group) {
        g.el.classList.add("has-width");
        g.el.style.width = `${Math.round(w)}px`;
      }
      if (r.group.length > 1) this.reflow();
      else this.reflow(r.node);
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
      // 只是点了一下（双击的前两下）没拖：什么都不改。不然框选了几个时，点一下就把它们都设成这个节点的宽度，
      // 还会重画掉手柄，第二下落在新手柄上、双击不触发
      if (!r.moved) return;
      const w = Math.round(r.el.offsetWidth);
      if (r.group.every((g) => g.w === w && (g.node.width ?? g.w) === w)) return;
      for (const g of r.group) g.node.width = w;
      this.render();
      this.notify();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    // 手柄上的单击、双击都不落到节点和画布上（不选中、不进编辑）
    handle.addEventListener("click", (ev) => ev.stopPropagation());
    handle.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.toggleWidth(node);
    });
    this.widthHandle = handle;
    this.widthHandleNode = node;
  }

  /** 谁该有宽度手柄：悬停打开时是鼠标指着的节点，否则（或没指着）是唯一选中的节点；编辑、拖动中都没有 */
  private widthHandleTarget(): MindNode | null {
    if (!this.opts.editable || this.editing || this.drag) return null;
    const hovered = this.hoverNode;
    if (hovered && this.opts.widthHandleOnHover?.() && this.els.has(hovered.id)) return hovered;
    // 框选了好几个：手柄在主选中的那个上，拖它就一起改（见 updateWidthHandle）
    return this.primary && this.selected.has(this.primary) ? this.primary : null;
  }

  /** 鼠标指着的节点变了：悬停调宽度打开时把手柄挪过去 */
  private setHoverNode(node: MindNode | null): void {
    this.hoverNode = node;
    // 同一个节点也要看一下：开关刚打开时鼠标可能本来就停在节点上；手柄没变时 updateWidthHandle 什么都不做
    if (this.opts.widthHandleOnHover?.()) this.updateWidthHandle();
  }

  /**
   * 双击宽度手柄：设过宽度的恢复自动宽度；自动宽度、文字折了行的拉成一行（最宽 NODE_MAX_WIDTH），
   * 已经是一行的不动
   */
  toggleWidth(node: MindNode): void {
    if (!this.opts.editable) return;
    // 框选了好几个、双击的是其中一个：有折行的就一起拉成一行，都不折行了就一起恢复自动宽度（B 站反馈：一个个拉太慢）
    if (this.selected.size > 1 && this.selected.has(node)) {
      const group = [...this.selected];
      if (!this.fitOneLine(group)) this.resetWidths(group);
      return;
    }
    if (node.width) {
      this.resetWidth(node);
      return;
    }
    const el = this.els.get(node.id);
    if (!el) return;
    const now = el.offsetWidth;
    el.classList.add("has-width");
    // 量的是缩放后的屏幕宽度，换回画布上的宽度；往上取整，免得差零点几像素又折一行
    const one = Math.ceil(el.getBoundingClientRect().width / this.k);
    el.classList.remove("has-width");
    if (one <= now + 1) return;
    node.width = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, one));
    this.render();
    this.notify();
  }

  /** 编辑框里的文字 → 存进节点的（按设置决定要不要留中间的空行） */
  private fromEdit(text: string): string {
    return fromEditableText(text, this.opts.keepBlankLines?.() ?? false, this.opts.keepEdgeSpaces?.() ?? false);
  }

  private toEdit(text: string): string {
    return toEditableText(text, this.opts.keepEdgeSpaces?.() ?? false);
  }

  /** 拆分方式：内置的几种，加上设置里自定义的 */
  private splitRules(): { label: string; rule: SplitRule }[] {
    return [
      { label: t("split.comma"), rule: { kind: "comma" } },
      { label: t("split.period"), rule: { kind: "period" } },
      { label: t("split.semicolon"), rule: { kind: "semicolon" } },
      { label: t("split.number"), rule: { kind: "number" } },
      ...(this.opts.split?.().custom ?? []).map((c): { label: string; rule: SplitRule } => ({ label: c.name, rule: { kind: "chars", chars: c.chars } })),
    ];
  }

  private splitPrefs(): { keepOriginal: boolean; keepDelims: boolean } {
    const s = this.opts.split?.();
    return { keepOriginal: s?.keepOriginal ?? true, keepDelims: s?.keepDelims ?? false };
  }

  /** 右键的是选中的节点之一时就是选中的这几个，否则只有它；只留下文字能拆出两段以上的 */
  private splittable(node: MindNode, rule: SplitRule = { kind: "comma" }): { node: MindNode; prefix: string; lead: string; parts: string[] }[] {
    const nodes = this.selected.has(node) ? [...this.selected] : [node];
    const { keepDelims } = this.splitPrefs();
    return nodes.flatMap((n) => {
      // 开头的标记（emoji）和任务框留在原节点上，只拆后面的文字
      const { rest } = splitMarkers(n.text);
      const body = rest.replace(/^\[( |x|X)\]\s+/, "");
      const prefix = n.text.endsWith(body) ? n.text.slice(0, n.text.length - body.length) : "";
      const r = splitText(body, rule, keepDelims);
      return r ? [{ node: n, prefix, lead: r.lead, parts: r.parts }] : [];
    });
  }

  /**
   * 按 rule 把节点文字拆成几段。保留原文字（默认）：每段一个子节点，接在已有的子节点后面，节点自己的文字不动。
   * 不保留：拆出来的几段代替这个节点、放在原来那一层（第一段就是这个节点，子节点、备注、颜色都留着），
   * 序号前面有文字（「水果：1. 苹果 2. 梨」）时节点留下那段文字、各项成为子节点；中心主题、概要没有同级，照旧加成子节点
   */
  splitIntoChildren(node: MindNode, rule: SplitRule = { kind: "comma" }): void {
    if (!this.opts.editable || !this.doc) return;
    const list = this.splittable(node, rule);
    if (!list.length) return;
    const { keepOriginal } = this.splitPrefs();
    for (const { node: n, prefix, lead, parts } of list) {
      n.folded = false;
      if (keepOriginal || !n.parent || isSummaryTopic(n)) {
        for (const p of parts) addChild(n, this.doc.style, p);
      } else if (lead) {
        n.text = prefix + lead;
        for (const p of parts) addChild(n, this.doc.style, p);
      } else {
        n.text = prefix + parts[0];
        let prev = n;
        for (const p of parts.slice(1)) prev = addSibling(prev, p) ?? prev;
      }
    }
    this.render();
    this.notify();
  }

  /**
   * 编辑节点时只拆选中的文字：拆出来的几段接成这个节点的子节点。不保留原文字时把选中的那段从节点里去掉
   * （选中的就是全部文字时，和整个节点拆分一样：由拆出来的几段代替这个节点）
   */
  private splitSelection(rule: SplitRule): void {
    const ed = this.nodeEditor;
    const node = this.editing;
    if (!ed || !node || !this.doc || !this.opts.editable) return;
    const { from, to } = ed.visibleSelection;
    if (from === to) return;
    const { keepOriginal, keepDelims } = this.splitPrefs();
    const text = ed.savedText;
    const res = splitText(text.slice(from, to), rule, keepDelims);
    if (!res) {
      this.opts.host?.notice?.(t("split.none"));
      return;
    }
    const remaining = keepOriginal ? text : text.slice(0, from) + res.lead + text.slice(to);
    // 编辑框里的文字自己定：先取消编辑（不提交、不记一步撤销），再一次改好、记一步
    this.commitEdit(true, false);
    const parts = res.parts.map((p) => this.fromEdit(p));
    const whole = !keepOriginal && !splitMarkers(this.fromEdit(remaining)).rest.trim();
    if (whole && node.parent && !isSummaryTopic(node)) {
      const head = this.fromEdit(remaining).trim();
      node.text = head ? `${head} ${parts[0]}` : parts[0];
      let prev = node;
      for (const p of parts.slice(1)) prev = addSibling(prev, p) ?? prev;
    } else {
      node.text = this.fromEdit(remaining).replace(/\s+$/, "");
      node.folded = false;
      for (const p of parts) addChild(node, this.doc.style, p);
    }
    this.select(node);
    this.render();
    this.el.focus({ preventScroll: true });
    this.notify();
  }

  /** 删掉备注：右键的是选中的节点之一时，选中的几个一起删 */
  deleteNote(node: MindNode): void {
    if (!this.opts.editable) return;
    const targets = (this.selected.has(node) ? [...this.selected] : [node]).filter((n) => this.noteShown(n));
    if (!targets.length) return;
    // 先关掉开着的备注弹窗：关的时候会把编辑框里的内容存回去
    this.closePopover();
    // 节点框里的表格也存在备注里：删备注只删表格以外的部分
    for (const n of targets) n.note = this.nodeTable(n) ? noteOnlyTable(n.note) : "";
    this.render();
    this.notify();
  }

  resetWidth(node: MindNode): void {
    if (!this.opts.editable || !node.width) return;
    node.width = undefined;
    this.render();
    this.notify();
  }

  /**
   * 量每个节点不折行时要多宽：只返回现在折了行的（图片、视频节点不算）。设过宽度的也按内容量；
   * 量的是缩放后的屏幕宽度，换回画布上的宽度；往上取整，免得差零点几像素又折一行
   */
  private oneLineWidths(nodes: MindNode[]): Map<MindNode, number> {
    const out = new Map<MindNode, number>();
    for (const n of nodes) {
      const el = this.els.get(n.id);
      if (!el || el.querySelector("img.mm-img, iframe.mm-frame, video.mm-media")) continue;
      const now = el.offsetWidth;
      const had = el.classList.contains("has-width");
      const w0 = el.style.width;
      el.setCssStyles({ width: "" });
      el.classList.add("has-width");
      const one = Math.ceil(el.getBoundingClientRect().width / this.k);
      el.setCssStyles({ width: w0 });
      if (!had) el.classList.remove("has-width");
      if (one > now + 1) out.set(n, Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, one)));
    }
    return out;
  }

  /** 把几个节点里折了行的都拉成一行（一步撤销）；没有折行的返回 false */
  private fitOneLine(nodes: MindNode[]): boolean {
    if (!this.opts.editable) return false;
    const widths = this.oneLineWidths(nodes);
    if (!widths.size) return false;
    for (const [n, w] of widths) n.width = w;
    this.render();
    this.notify();
    return true;
  }

  /** 几个节点一起恢复自动宽度（一步撤销） */
  private resetWidths(nodes: MindNode[]): void {
    if (!this.opts.editable || !nodes.some((n) => n.width)) return;
    for (const n of nodes) n.width = undefined;
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
    // 嵌入的脑图预览：手柄拖宽高（写成 ![[脑图|宽x高]]）。预览里面的图片、视频不算这个节点的
    const mapBox = el ? ([...el.querySelectorAll<HTMLElement>(".mm-map-preview")].find((p) => !p.parentElement?.closest(".mm-map-preview")) ?? null) : null;
    if (el && mapBox) return this.mapResizeHandle(el, mapBox, this.primary);
    const iframe = el?.querySelector<HTMLIFrameElement>("iframe.mm-frame");
    // 视频和图片一样只调宽度（写成 ![[片段.mp4|宽度]]），高度跟着画面比例
    const video = iframe ? null : el?.querySelector<HTMLVideoElement>("video.mm-media");
    const img = iframe || video ? null : el?.querySelector<HTMLImageElement>("img.mm-img");
    const box = iframe ?? video ?? img;
    if (!el || !box || (img && !img.complete)) return;
    const frame = !!iframe;
    const handle = createDiv();
    handle.className = "mm-img-handle";
    this.tip(
      handle,
      frame ? t("canvas.resizeFrame") : video ? t("canvas.resizeVideo") : t("canvas.resizeImage"),
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
        const w = Math.max(IMAGE_MIN_WIDTH, Math.min(getImageMaxWidth(), r.startW + dx));
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

  /** 节点里嵌入的脑图预览右下角的手柄：宽高随便拖，松手写进链接（![[脑图|480x300]]）；双击恢复默认大小 */
  private mapResizeHandle(el: HTMLElement, box: HTMLElement, node: MindNode): void {
    const link = box.dataset.link ?? "";
    const handle = createDiv();
    handle.className = "mm-img-handle";
    this.tip(handle, t("canvas.resizeMap"), "fixed", "right");
    el.append(handle);
    this.placeImageHandle(handle, box);
    let drag: { x: number; y: number; w: number; h: number } | null = null;
    handle.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      drag = { x: ev.clientX, y: ev.clientY, w: box.offsetWidth, h: box.offsetHeight };
      this.imgResize = { node, box: box as unknown as HTMLImageElement, frame: false, startX: ev.clientX, startY: ev.clientY, startW: drag.w, startH: drag.h, handle };
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch {
        // 合成事件
      }
    });
    handle.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      ev.stopPropagation();
      const w = Math.max(MAP_MIN_W, Math.min(MAP_MAX_W, drag.w + (ev.clientX - drag.x) / this.k));
      const h = Math.max(MAP_MIN_H, Math.min(MAP_MAX_H, drag.h + (ev.clientY - drag.y) / this.k));
      box.setCssProps({ "--mm-map-w": `${Math.round(w)}px`, "--mm-map-h": `${Math.round(h)}px` });
      this.reflow();
      this.placeImageHandle(handle, box);
    });
    const finish = (ev: PointerEvent) => {
      if (!drag) return;
      ev.stopPropagation();
      const start = drag;
      drag = null;
      this.imgResize = null;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      if (w === start.w && h === start.h) return;
      node.text = setMapSize(node.text, link, { w, h });
      this.render();
      this.notify();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const next = setMapSize(node.text, link, null);
      if (next === node.text) return;
      node.text = next;
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
    for (let n: HTMLElement | null = box; n && !n.classList.contains("gg-mm-node"); n = n.offsetParent as HTMLElement | null) {
      left += n.offsetLeft;
      top += n.offsetTop;
    }
    handle.style.left = `${left - 7}px`;
    handle.style.top = `${top - 7}px`;
  }

  // ---------- 节点里的表格 ----------

  /** 节点框里画的那张表：有 %%table%% 且备注里真有表格 */
  private nodeTable(node: MindNode): Table | null {
    return node.table ? (noteTable(node.note)?.table ?? null) : null;
  }

  /** 备注图标、展开的备注、备注弹窗看的部分：节点框里画了表格时去掉那张表；没有就是空串 */
  private noteShown(node: MindNode): string {
    if (!node.note) return "";
    return this.nodeTable(node) ? noteRest(node.note) : node.note;
  }

  /**
   * 编辑后的备注原文 → 存储形式。只把标题当节点时，标题下备注里的列表读回来还是备注，不用包成 > [!note]
   * （和写文件时一样）；以前这里没管，开着这个设置编辑一次带列表的标题备注，整段就被改写成标注块
   */
  private storeNote(node: MindNode, plain: string): string {
    return normalizeNote(plain, node.kind === "list", !!this.doc?.style.headingsOnly && node.kind !== "list");
  }

  /**
   * 展开的卡片里显示的那部分备注：按设置只挑列表项时，原文里不挨着的几段之间插一个看不见的注释，
   * 免得两处各自从 1 开始的有序列表被接成一个。空串表示没有可显示的（只留图标，点开弹窗看全文）
   */
  private cardText(node: MindNode): string {
    const note = this.noteShown(node);
    const mode = this.opts.noteCardFilter?.() ?? "all";
    if (mode === "all" || !note) return note;
    return noteCardParts(note, mode).join("\n\n<!-- -->\n\n");
  }

  /** 在节点里（标题下面）挂一张表格编辑器 */
  private mountTable(first: MindNode, el: HTMLElement, table: Table): void {
    // 节点沿用编号重新解析后对象会换：事件里按编号取当前的
    const id = first.id;
    const live = (): MindNode => this.nodeById.get(id) ?? this.tableEds.get(id)?.node ?? first;
    const wrap = el.createDiv({ cls: "mm-node-table" });
    const editable = this.opts.editable && !this.recite;
    // 表格里的按键、粘贴、双击、右键归表格自己，不能冒泡到画布（画布会当成节点快捷键、新建节点、编辑标题）
    for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut", "dblclick", "contextmenu", "click", "compositionstart", "compositionupdate", "compositionend"]) {
      wrap.addEventListener(type, (ev) => ev.stopPropagation());
    }
    // 捕获阶段先选中节点：表格编辑器在格子上自己会拦下 pointerdown，冒泡阶段等不到
    wrap.addEventListener(
      "pointerdown",
      () => {
        // 只读时按普通节点处理：点一下选中、按住拖动
        if (!editable) return;
        this.cancelTapCenter();
        if (this.editing) this.commitEdit();
        this.closePopover();
        // 节点还没选中就顺手选中它（工具栏、右键菜单照常）
        {
          const node = live();
          if (!(this.selected.size === 1 && this.selected.has(node))) this.select(node, "replace");
        }
        this.positionNodebar();
      },
      true,
    );
    // 点格子不拖节点、不平移画布
    wrap.addEventListener("pointerdown", (ev) => {
      if (editable) ev.stopPropagation();
    });
    const host = this.opts.host;
    const tableHost: EditorHost = {
      renderMarkdown: host?.renderNote ? (cell, md) => host.renderNote!(cell, md) : undefined,
      setIcon: host?.setIcon,
      onChange: (next) => this.onTableEdit(live(), next),
      undo: () => this.opts.onUndo?.(),
      redo: () => this.opts.onRedo?.(),
      // 格子编辑框和节点编辑框一样用 CodeMirror：颜色、荧光笔、加粗直接显示，标签藏起来
      richEdit: () => true,
      // 编辑格子时的格式栏：跟着脑图的「选中文字时显示格式栏」开关和常用颜色
      formatColors: () => (this.opts.formatBar?.() ? { text: this.opts.textColors?.() ?? [], highlight: this.opts.highlightColors?.() ?? [] } : null),
      // 节点表格的格式栏和脑图自己的格式栏记同一份「上次用的颜色、最近使用」
      colorMemory: () => this.colorMemory(),
      // Esc、从第一行往上、最后一行往下：回到画布，节点还选着，方向键接着在节点之间走
      onLeave: () => {
        this.el.focus({ preventScroll: true });
        const node = live();
        if (!this.selected.has(node)) this.select(node, "replace");
      },
      suggestLinks: host?.listLinkTargets
        ? (query) => {
            return rankLinkTargets(host.listLinkTargets!(), query, 12).map((x) => x.linktext);
          }
        : undefined,
      suggestTags: host?.listTags
        ? (query) => {
            const q = query.toLowerCase();
            return host.listTags!().filter((x) => x.toLowerCase().includes(q)).slice(0, 12);
          }
        : undefined,
      dailyNote: host?.dailyNote,
      secrets: host?.tableSecrets,
      confirm: host?.confirm,
      readonly: !editable,
      // 表格菜单「复制整张表格」「复制为 Markdown 表格」完成后的提示
      notice: host?.notice,
      // 格子里的双链：和节点里的链接一样打开（按「链接打开位置」设置，⌘/Ctrl 点新标签），悬停预览
      openLink: host?.openLink ? (href, ev) => host.openLink!(href, true, ev) : undefined,
      hoverLink: host?.hoverLink,
      // 右键格子里的双链：原生链接菜单
      linkMenu: host?.linkContextMenu ? (ev, href) => host.linkContextMenu!(ev, href, []) : undefined,
      // 右键格子里的图片：复制图片 + 原生文件菜单 + 删除图片（Obsidian 的确认框，删了再把嵌入从格子里去掉）
      imageMenu: host?.linkContextMenu
        ? (ev, img, link, remove) => {
            const extra: { title: string; icon: string; warning?: boolean; run: () => void }[] = [{ title: t("menu.copyImage"), icon: "copy", run: () => void this.copyImage(img) }];
            if (link && remove && host.deleteLinkedFile)
              extra.push({ title: t("menu.deleteImage"), icon: "trash-2", warning: true, run: () => void host.deleteLinkedFile!(link).then((ok) => ok && remove()) });
            host.linkContextMenu!(ev, link ?? "", extra);
          }
        : undefined,
      // 往格子里粘贴截图：和往节点里粘贴图片一样存成附件
      saveImage: editable && host?.saveBinary
        ? async (file) => {
            const link = await this.saveImageFile(file);
            return link ? `![[${link}]]` : null;
          }
        : undefined,
      // 表格左上角菜单里的「删除表格」：只删表格，节点留着
      onDeleteTable: editable ? () => this.deleteNodeTable(live()) : undefined,
    };
    const ed = new TableEditor(wrap, table, tableHost);
    this.tableEds.set(id, { ed, src: tableSource(table), node: first });
    // 格子里的图片、公式渲染完会变高：节点跟着重新排
    this.noteRo?.observe(wrap);
  }

  /** 节点 DOM 留着、表格在别处改了（备注弹窗、撤销）：把新表交给编辑器 */
  private syncTable(node: MindNode, table: Table): void {
    const e = this.tableEds.get(node.id);
    if (!e) return;
    e.node = node;
    const src = tableSource(table);
    if (e.src === src) return;
    e.src = src;
    e.ed.update(table);
  }

  private dropTable(id: string): void {
    const e = this.tableEds.get(id);
    if (!e) return;
    this.tableEds.delete(id);
    const wrap = e.ed.root.parentElement;
    if (wrap) this.noteRo?.unobserve(wrap);
    e.ed.destroy();
  }

  /** 在表格里改了：写回备注，节点重新量尺寸，交出去存 */
  private onTableEdit(node: MindNode, next: Table): void {
    if (!this.opts.editable) return;
    node.note = withTable(node.note, next, node.kind === "list");
    const e = this.tableEds.get(node.id);
    if (e) e.src = tableSource(next);
    if (this.doc && this.els.has(node.id)) this.reflow(node);
    this.notify();
  }

  /** 「插入」菜单里的表格项：没有表就插入一张；备注里有表就放进节点（已经在节点里的，放回备注、删除在「更多」里） */
  private tableMenuEntry(node: MindNode): MenuEntry {
    if (noteTable(node.note)) return { title: t("menu.tableInNode"), icon: "table", run: () => this.setTableInNode(node, true) };
    return { title: t("menu.insertTable"), icon: "table", run: () => this.insertNodeTable(node) };
  }

  /** 插入一张空表（三列、表头加两行），画在节点里，选中第一格 */
  insertNodeTable(node: MindNode): void {
    if (!this.opts.editable || this.nodeTable(node)) return;
    this.closePopover();
    if (!noteTable(node.note)) node.note = addTable(node.note, node.kind === "list");
    node.table = true;
    this.render();
    this.reflow();
    this.notify();
    this.tableEds.get(node.id)?.ed.select(0, 0);
  }

  /** 新建一个只放表格的子节点（不用先写标题），选中第一格 */
  insertTableChild(parent: MindNode): void {
    if (!this.opts.editable || !this.doc) return;
    this.closePopover();
    if (this.editing) this.commitEdit();
    if (parent.folded) parent.folded = false;
    const node = addChild(parent, this.doc.style, "");
    node.note = addTable("", node.kind === "list");
    node.table = true;
    this.select(node);
    this.render();
    this.reflow();
    this.notify();
    this.followSelection(node);
    this.tableEds.get(node.id)?.ed.select(0, 0);
  }

  private setTableInNode(node: MindNode, on: boolean): void {
    if (!this.opts.editable || !!node.table === on) return;
    node.table = on || undefined;
    this.render();
    this.reflow();
    this.notify();
  }

  private deleteNodeTable(node: MindNode): void {
    if (!this.opts.editable) return;
    node.note = withoutTable(node.note, node.kind === "list");
    node.table = undefined;
    this.render();
    this.reflow();
    this.notify();
  }

  // ---------- 展开的备注 ----------

  /** 布局前把要展开的备注卡片建好（布局要量它的尺寸）；顺手更新节点上备注图标的状态 */
  private syncNotes(base: MindNode): void {
    const need = new Set<string>();
    const visit = (n: MindNode) => {
      const note = this.noteShown(n);
      if (note) {
        const card = this.cardState.get(n.id);
        const text = this.notesExpanded ? this.cardText(n) : "";
        const shown = this.notesExpanded && !card?.collapsed && !!text;
        const icon = this.els.get(n.id)?.querySelector<HTMLElement>(".mm-note-icon");
        const state = !this.notesExpanded || !text ? "popover" : shown ? "open" : "closed";
        if (icon && icon.dataset.state !== state) {
          icon.dataset.state = state;
          icon.classList.toggle("is-expanded", shown);
          this.tip(icon, state === "popover" ? t("canvas.viewNote") : shown ? t("canvas.collapseNote") : t("canvas.expandNote"));
        }
        if (shown) {
          need.add(n.id);
          let el = this.noteEls.get(n.id);
          if (!el) {
            el = this.createNoteCard();
            this.noteEls.set(n.id, el);
          }
          this.noteNode.set(el, n);
          if (el.dataset.raw !== text) {
            el.dataset.raw = text;
            const body = el.querySelector<HTMLElement>(".mm-note-card-body")!;
            body.empty();
            body.scrollTop = 0;
            this.fillNoteBody(body, text);
          }
          this.applyCardSize(el, this.cardDrag?.id === n.id ? { ...card, ...this.cardDrag.size } : card);
        }
      }
      for (const c of visibleChildren(n)) visit(c);
      for (const t of visibleTopics(n)) visit(t);
    };
    visit(base);
    for (const [id, el] of this.noteEls) {
      if (need.has(id)) continue;
      this.noteRo?.unobserve(el);
      el.remove();
      this.noteEls.delete(id);
    }
  }

  private createNoteCard(): HTMLElement {
    const el = createDiv();
    el.className = "mm-note-card";
    const body = el.createDiv({ cls: "mm-note-card-body" });
    this.wireNoteBody(body);
    body.addEventListener("scroll", () => this.updateNoteFade(el), { passive: true });
    const fold = el.createEl("button", { cls: "mm-note-card-fold" });
    fold.type = "button";
    fold.append(icon("up"));
    this.tip(fold, t("canvas.collapseNote"));
    this.wireCardResize(el);
    fold.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const n = this.noteNode.get(el);
      if (n) this.toggleNoteCard(n);
    });
    // 和标注一样不参与画布拖拽（里面的文字可以选中复制）；单击选中它所在的节点，双击编辑
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // 背诵模式下点备注里遮住的高亮：揭开 / 盖回（卡片的点击不冒到画布，要自己转过去）
      if (this.recite && (ev.target as HTMLElement).closest("mark")) {
        this.onReciteClick(ev);
        return;
      }
      const n = this.noteNode.get(el);
      if (!n) return;
      this.select(n);
      this.positionNodebar();
    });
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const n = this.noteNode.get(el);
      const body = el.querySelector<HTMLElement>(".mm-note-card-body");
      if (n && this.opts.editable && !this.recite) this.editNoteCard(n, el, body ? this.noteSpot(body, ev, n) : undefined);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const n = this.noteNode.get(el);
      if (!n) return;
      const entries: MenuEntry[] = [];
      if (this.opts.editable && !this.recite) entries.push({ title: t("menu.editNote"), icon: "pencil", run: () => this.editNoteCard(n, el) });
      if (this.opts.editable && !this.recite) entries.push({ title: t("menu.deleteNote"), icon: "trash-2", run: () => this.deleteNote(n) });
      entries.push({ title: t("canvas.collapseNote"), icon: "chevron-up", run: () => this.toggleNoteCard(n) });
      this.showContextMenu(entries, ev);
    });
    this.nodesEl.append(el);
    this.noteRo?.observe(el);
    return el;
  }

  /**
   * 右下角的手柄拖动改这条备注的宽高（图片跟着宽度放大），松手记住；双击手柄回到默认大小。
   * 拖的是屏幕像素，按当前缩放换回画布里的尺寸
   */
  private wireCardResize(el: HTMLElement): void {
    const grip = el.createDiv({ cls: "mm-note-card-resize" });
    this.tip(grip, t("canvas.resizeNote"));
    grip.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const node = this.noteNode.get(el);
      const body = el.querySelector<HTMLElement>(".mm-note-card-body");
      if (!node || !body) return;
      const k = this.k;
      const start = { x: ev.clientX, y: ev.clientY, w: el.offsetWidth, h: body.offsetHeight };
      let size: { w: number; h: number } | null = null;
      grip.setPointerCapture(ev.pointerId);
      el.classList.add("is-resizing");
      const move = (e: PointerEvent) => {
        size = {
          w: Math.round(Math.min(NOTE_CARD_MAX.w, Math.max(NOTE_CARD_MIN.w, start.w + (e.clientX - start.x) / k))),
          h: Math.round(Math.min(NOTE_CARD_MAX.h, Math.max(NOTE_CARD_MIN.h, start.h + (e.clientY - start.y) / k))),
        };
        this.cardDrag = { id: node.id, size };
        this.applyCardSize(el, size);
        this.updateNoteFade(el);
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        el.classList.remove("is-resizing");
        this.cardDrag = null;
        if (size) this.updateCard(node, size);
        this.reflow();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("click", (ev) => ev.stopPropagation());
    grip.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const node = this.noteNode.get(el);
      if (!node) return;
      this.updateCard(node, { w: undefined, h: undefined });
      this.applyCardSize(el, this.cardState.get(node.id));
      this.reflow();
    });
  }

  /** 在卡片原位打开编辑框：和弹窗编辑是同一套（粘贴图片、拖入笔记都能用），起码留出能写字的大小 */
  /** 双击渲染好的备注：双击的字在原文里的位置和鼠标高度（见 toggleNotePopover 的 spot）；对不上返回 undefined，光标照旧放在最后 */
  private noteSpot(body: HTMLElement, ev: MouseEvent, node: MindNode): { at: number; y: number } | undefined {
    const at = spotInSource(body, ev.clientX, ev.clientY, unescapeNote(node.note));
    return at === null ? undefined : { at, y: ev.clientY };
  }

  private editNoteCard(node: MindNode, card: HTMLElement, spot?: { at: number; y: number }): void {
    const r = card.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const w = Math.min(Math.max(r.width, 260), Math.max(160, host.width - 16));
    const h = Math.min(Math.max(r.height, 140), Math.max(80, host.height - 16));
    const left = Math.max(8, Math.min(r.left - host.left, host.width - w - 8));
    const top = Math.max(8, Math.min(r.top - host.top, host.height - h - 8));
    // 画布放大时卡片里的字跟着变大，编辑框盖在卡片上也按同样的比例放大，不然一进编辑字就缩小（群友反馈）。
    // 缩小时不跟：字太小没法编辑，编辑框最小也有 260×140
    const scale = Math.min(Math.max(this.k, 1), 3);
    this.toggleNotePopover(node, true, { left: `${left}px`, top: `${top}px`, w, h, scale }, spot);
  }

  /** 内容超出卡片、还没滚到底时，底部渐隐提示下面还有 */
  private updateNoteFade(el: HTMLElement): void {
    const body = el.querySelector<HTMLElement>(".mm-note-card-body");
    if (!body) return;
    const more = body.scrollHeight > body.clientHeight + 1 && body.scrollTop + body.clientHeight < body.scrollHeight - 1;
    if (el.classList.contains("is-overflow") !== more) el.classList.toggle("is-overflow", more);
  }

  /** 正在进行的这次滑动归谁：节点表格 / 备注卡片的滚动区，null 是画布 */
  private wheelLatch: { target: HTMLElement | null; at: number } | null = null;

  /**
   * 一次滑动开始时落在哪：
   * - 节点里的表格超出了大小、还能往这个方向滚：鼠标在这个节点任何地方（标题、边距也算）都滚表格。
   *   已经滚到头了，这次滑动交给画布（以前滚到头就什么都不动，鼠标停在这个节点上滚轮像失效了一样）；
   *   一次滑动中途滚到头不会转给画布（见 wheelLatch），不会把图甩出去
   * - 展开的备注卡片：同样，还能往这个方向滚才归卡片
   */
  private wheelTargetAt(ev: WheelEvent): HTMLElement | null {
    const target = ev.target as HTMLElement;
    const tableNode = target.closest<HTMLElement>(".gg-mm-node.has-table");
    const sc = tableNode?.querySelector<HTMLElement>(".mm-node-table .ggt-scroll");
    if (sc && MindMapCanvas.canScroll(sc, ev)) return sc;
    const body = target.closest<HTMLElement>(".mm-note-card-body");
    if (body && MindMapCanvas.canScroll(body, ev)) return body;
    return null;
  }

  /** 滚轮在这个元素里还能不能往这个方向滚 */
  private static canScroll(el: HTMLElement, ev: WheelEvent): boolean {
    if (Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)) {
      if (el.scrollHeight <= el.clientHeight + 1 || !ev.deltaY) return false;
      return ev.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    }
    if (el.scrollWidth <= el.clientWidth + 1) return false;
    return ev.deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  private drawNotes(): void {
    const layout = this.layout!;
    let i = 0;
    for (const c of layout.notes) {
      const el = this.noteEls.get(c.node.id);
      const p = layout.placed.get(c.node.id);
      if (!el || !p) continue;
      const branch = this.els.get(c.node.id)?.dataset.branch;
      const color = branch !== undefined ? `var(--mm-branch-${branch})` : "";
      if (el.style.getPropertyValue("--mm-note-color") !== color) {
        if (color) el.style.setProperty("--mm-note-color", color);
        else el.style.removeProperty("--mm-note-color");
      }
      el.setCssStyles({ left: `${round2(c.x)}px`, top: `${round2(c.y)}px` });
      this.updateNoteFade(el);
      if (!c.far) continue;
      // 放到了整个分支下面：从节点底边竖一根细线下来，走节点靠里的一侧，不碰连向子节点的线
      let link = this.noteLinks[i];
      if (!link) {
        link = createSvg("path");
        link.setAttribute("class", "mm-note-link");
        this.noteLayer.append(link);
        this.noteLinks.push(link);
      }
      i++;
      const k = Math.min(12, p.w / 2);
      const centered = Math.abs(c.x + c.w / 2 - (p.x + p.w / 2)) < 1;
      const x = centered ? p.x + p.w / 2 : p.side === "left" ? p.x + p.w - k : p.x + k;
      const d = `M${round2(x)},${round2(p.y + p.h)} L${round2(x)},${round2(c.y)}`;
      if (link.getAttribute("d") !== d) link.setAttribute("d", d);
      if (link.style.getPropertyValue("--mm-note-color") !== color) link.style.setProperty("--mm-note-color", color);
      link.classList.toggle("is-answer-covered", el.classList.contains("is-answer-covered"));
      if (link.style.display) link.setCssStyles({ display: "" });
    }
    for (let j = i; j < this.noteLinks.length; j++) {
      if (!this.noteLinks[j].style.display) this.noteLinks[j].setCssStyles({ display: "none" });
    }
  }

  /** 展开时单独收起 / 重新展开某一条（按文件记住） */
  private toggleNoteCard(node: MindNode): void {
    const card = this.cardState.get(node.id);
    this.updateCard(node, { collapsed: card?.collapsed ? undefined : true });
    this.reflow();
  }

  /** 改一条备注的单独状态；全部回到默认就删掉，然后交出去存 */
  private updateCard(node: MindNode, patch: NoteCardState): void {
    const next: NoteCardState = { ...this.cardState.get(node.id), ...patch };
    for (const k of Object.keys(next) as (keyof NoteCardState)[]) if (next[k] === undefined) delete next[k];
    if (Object.keys(next).length) this.cardState.set(node.id, next);
    else this.cardState.delete(node.id);
    this.emitNoteCards();
  }

  /** 拖出来的大小写到卡片上；没拖过就按内容和设置里的上限 */
  private applyCardSize(el: HTMLElement, card: NoteCardState | undefined): void {
    const body = el.querySelector<HTMLElement>(".mm-note-card-body");
    const w = card?.w ? `${card.w}px` : "";
    const h = card?.h ? `${card.h}px` : "";
    if (el.style.width !== w) el.setCssStyles({ width: w, maxWidth: w ? "none" : "" });
    if (body && body.style.height !== h) body.setCssStyles({ height: h, maxHeight: h ? "none" : "" });
    el.classList.toggle("is-sized", !!(w || h));
  }

  /** 大纲面板里的标题：$公式$ 照节点里的样子渲染，其余按纯文本（图片、链接只留文字） */
  renderOutlineText(el: HTMLElement, text: string): void {
    el.empty();
    const re = /\$\$?(?!\s)([^$\n]+?)(?<!\s)\$\$?(?!\d)/g;
    let last = 0;
    let math = false;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) el.appendText(plainText(text.slice(last, m.index)));
      const r = this.opts.host?.renderMath?.(m[1]);
      if (r) {
        r.classList.add("mm-math");
        el.append(r);
        math = true;
      } else el.appendText(m[0]);
      last = re.lastIndex;
    }
    if (last < text.length) el.appendText(plainText(text.slice(last)));
    if (math) this.opts.host?.afterRender?.();
  }

  getNoteCards(): NoteCards {
    return this.cardKeys;
  }

  /** 宿主换了文件：交来这个文件记下的单条备注状态（随后的 setDoc 按它认节点） */
  setNoteCards(cards: NoteCards | undefined): void {
    this.cardKeys = cards ?? {};
    this.resolveNoteCards();
  }

  /** 按文字路径把记下的状态认回到当前树的节点上 */
  private resolveNoteCards(): void {
    this.cardState.clear();
    if (!this.doc || !Object.keys(this.cardKeys).length) return;
    walkMap(this.doc.root, (n) => {
      const c = this.cardKeys[noteKey(n)];
      if (c) this.cardState.set(n.id, clampCard(c));
    });
  }

  /** 按当前的树重算文字路径，变了才交出去 */
  private emitNoteCards(): void {
    if (!this.doc) return;
    const out: NoteCards = {};
    walkMap(this.doc.root, (n) => {
      const c = this.cardState.get(n.id);
      if (c && n.note) out[noteKey(n)] = c;
    });
    if (JSON.stringify(out) === JSON.stringify(this.cardKeys)) return;
    this.cardKeys = out;
    this.opts.onNoteCardsChange?.(out);
  }

  isNotesExpanded(): boolean {
    return this.notesExpanded;
  }

  /** 打开别的文件时由宿主按记住的状态设置；不回调、不重画（随后的 setDoc 会画） */
  setNotesExpanded(expanded: boolean): void {
    this.notesExpanded = expanded;
  }

  /** 设置里改了默认值：按宿主现在给的状态重画 */
  syncNotesExpanded(): void {
    const v = this.opts.notesExpanded?.() ?? false;
    if (v === this.notesExpanded) return;
    this.setNotesExpanded(v);
    this.render();
  }

  toggleNotes(): void {
    this.notesExpanded = !this.notesExpanded;
    // 整体展开就是全部展开：单独收起过的也放出来（拖过的大小留着）
    if (this.notesExpanded) {
      for (const [id, c] of this.cardState) {
        if (!c.collapsed) continue;
        const { collapsed: _, ...rest } = c;
        if (Object.keys(rest).length) this.cardState.set(id, rest);
        else this.cardState.delete(id);
      }
    }
    this.emitNoteCards();
    this.opts.onNotesExpandedChange?.(this.notesExpanded);
    this.render();
  }

  private updateNotesButton(): void {
    const b = this.notesButton;
    if (!b || !this.doc) return;
    let any = false;
    walkMap(this.doc.root, (n) => {
      if (n.note) any = true;
    });
    b.classList.toggle("is-hidden", !any);
    b.classList.toggle("is-active", any && this.notesExpanded);
    this.tip(b, this.notesExpanded ? t("canvas.collapseNotes") : t("canvas.expandNotes"), "toolbar");
  }

  // ---------- 备注弹层 ----------

  /**
   * spot：双击查看中的备注进来时，双击的字在原文里的位置和鼠标的高度。编辑框打开后光标放在那里、那一行留在鼠标原来的高度，
   * 不用在长备注里重新找刚才看到哪
   */
  private toggleNotePopover(node: MindNode, edit = false, at?: { left: string; top: string; w: number; h: number; scale?: number }, spot?: { at: number; y: number }): void {
    const sameNode = this.popover?.dataset.id === node.id;
    const alreadyEditing = !!this.popover?.querySelector("textarea");
    // 再点一次图标就收起；但「编辑」请求要把查看态切成编辑态，不能当成收起
    if (sameNode && (!edit || alreadyEditing)) {
      this.closePopover();
      return;
    }
    // 从查看切到编辑：沿用查看窗口的位置和大小，不突然变大或挪位置
    const prev = sameNode && edit && this.popover?.classList.contains("is-view") ? this.popover : null;
    const keep = at ?? (prev ? { left: prev.style.left, top: prev.style.top, w: prev.offsetWidth, h: prev.offsetHeight } : null);
    this.closePopover();
    const nodeEl = this.els.get(node.id);
    if (!nodeEl) return;
    const pop = createDiv();
    pop.className = "mm-popover";
    pop.dataset.id = node.id;
    // 从放大了的备注卡片进编辑：备注字号（表格字号跟着它）按画布比例放大，和卡片上看到的一样大
    if (at?.scale && at.scale !== 1) {
      const base = parseFloat(this.el.win.getComputedStyle(this.el).getPropertyValue("--mm-note-size")) || 13;
      pop.setCssProps({ "--mm-note-size": `${Math.round(base * at.scale * 100) / 100}px` });
    }
    pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop.addEventListener("wheel", (ev) => ev.stopPropagation());
    pop.addEventListener("dragstart", () => (this.dragFromPopover = true));
    pop.addEventListener("dragend", () => (this.dragFromPopover = false));
    const editable = this.opts.editable && (edit || !node.note);
    if (editable && this.opts.noteLiveEdit?.() && this.opts.host?.createNoteEditor && this.openLiveNote(node, pop, nodeEl, keep, spot)) {
      this.popover = pop;
      return;
    }
    if (editable) {
      const ta = createEl("textarea");
      ta.className = "mm-note-editor";
      ta.placeholder = t("canvas.notePlaceholder");
      const plain = unescapeNote(node.note);
      ta.value = plain;
      ta.rows = Math.min(12, Math.max(3, plain.split("\n").length + 1));
      const initial = node.note;
      // 分栏预览：旁边（窄的时候在下面）实时渲染，停手 150ms 后刷新
      const scope = this.opts.notePreview?.() ? this.opts.host?.notePreviewScope?.() : undefined;
      let preview: HTMLElement | null = null;
      let previewTimer = 0;
      const refreshPreview = () => {
        if (preview && scope) scope.render(preview, ta.value);
      };
      const apply = () => {
        const next = this.storeNote(node, ta.value.replace(/\s+$/, ""));
        if (next === node.note) return false;
        node.note = next;
        return true;
      };
      let saved = false;
      let noteBar: HTMLElement | null = null;
      const save = () => {
        if (saved) return;
        saved = true;
        this.popoverApply = null;
        this.noteFormat = null;
        noteBar?.remove();
        noteBar = null;
        window.clearTimeout(previewTimer);
        scope?.dispose();
        apply();
        if (node.note !== initial) {
          this.render();
          this.notify();
        }
      };
      ta.addEventListener("input", () => {
        if (apply() && !this.opts.embedded) this.scheduleNotify();
        if (preview) {
          window.clearTimeout(previewTimer);
          previewTimer = window.setTimeout(refreshPreview, 150);
        }
      });
      // 在预览里点、拖滚动条、选文字会让输入框失焦，这时不能当成编辑结束；松手后焦点还回输入框
      // （选中了预览里的文字就不抢，方便复制）
      let downInPop = false;
      pop.addEventListener(
        "pointerdown",
        () => {
          downInPop = true;
          const doc = this.el.ownerDocument;
          const up = () => {
            doc.removeEventListener("pointerup", up, true);
            downInPop = false;
            if (!ta.isConnected || doc.activeElement === ta) return;
            const sel = doc.getSelection();
            if (sel && !sel.isCollapsed && preview?.contains(sel.anchorNode)) return;
            ta.focus({ preventScroll: true });
          };
          doc.addEventListener("pointerup", up, true);
        },
        true,
      );
      ta.addEventListener("blur", () => {
        if (downInPop) return;
        // 失焦给了预览里的东西（比如复制完文字）也不关
        if (preview && preview.contains(this.el.ownerDocument.activeElement)) return;
        if (this.popover === pop) this.closePopover();
      });
      // 编辑备注时粘贴 / 拖入图片：存成附件，在光标处插入 ![[图片]]，和在 Markdown 里粘贴一样
      const insertText = (text: string) => {
        if (!text) return;
        if (ta.isConnected) {
          ta.focus();
          ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
          ta.dispatchEvent(new Event("input"));
          return;
        }
        // 存附件期间弹窗已经关了：直接接到备注末尾
        node.note = this.storeNote(node, [unescapeNote(node.note), text].filter(Boolean).join("\n"));
        this.render();
        this.notify();
      };
      const insertImages = async (files: File[]) => {
        const links: string[] = [];
        for (const f of files) {
          const link = await this.saveImageFile(f);
          if (link) links.push(`![[${link}]]`);
        }
        insertText(links.join("\n"));
      };
      ta.addEventListener("paste", (ev) => {
        const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        ev.preventDefault();
        ev.stopPropagation();
        void insertImages(files);
      });
      // 拖到备注框上的东西归备注框，不能冒到画布上变成新节点
      ta.addEventListener("dragover", (ev) => {
        ev.stopPropagation();
        // 文件（系统里的图片、库里拖来的笔记）默认不能落在 textarea 上，要先声明接收
        if (ev.dataTransfer?.types.includes("Files") || this.opts.host?.getDraggedFiles?.()?.length) {
          ev.preventDefault();
          ev.dataTransfer!.dropEffect = "copy";
        }
      });
      ta.addEventListener("drop", (ev) => {
        ev.stopPropagation();
        const vaultFiles = this.opts.host?.getDraggedFiles?.() ?? null;
        if (vaultFiles?.length) {
          ev.preventDefault();
          insertText(vaultFiles.map((f) => (f.isImage ? `![[${f.linktext}]]` : `[[${f.linktext}]]`)).join("\n"));
          return;
        }
        const files = [...(ev.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        ev.preventDefault();
        void insertImages(files);
      });
      // 颜色、荧光笔、加粗：只改选中的字，按行分开套（** 跨行在 Markdown 里不算加粗）；没选字不动（不给整段备注上格式）
      const formatNote = (fmt: InlineFormat, sel?: { from: number; to: number }) => {
        const from = sel?.from ?? ta.selectionStart;
        const to = sel?.to ?? ta.selectionEnd;
        const text = ta.isConnected ? ta.value : unescapeNote(node.note);
        const r = formatLines(text, from, to, fmt);
        if (!r || r.text === text) return;
        if (!ta.isConnected) {
          // 取色时弹窗已经关了（系统取色器抢走焦点）：直接改存好的备注
          node.note = this.storeNote(node, r.text.replace(/\s+$/, ""));
          this.render();
          this.notify();
          return;
        }
        ta.focus({ preventScroll: true });
        // 整段换掉也留在输入框自己的撤销记录里：⌘Z 能撤回这次上色
        ta.setSelectionRange(0, ta.value.length);
        if (!this.el.ownerDocument.execCommand("insertText", false, r.text)) ta.value = r.text;
        ta.setSelectionRange(r.start, r.end);
        ta.dispatchEvent(new Event("input"));
      };
      this.noteFormat = (fmt) => formatNote(fmt);
      ta.addEventListener("keydown", (ev) => {
        const mod = ev.metaKey || ev.ctrlKey;
        if (!mod || ev.altKey || ev.isComposing) return;
        const k = ev.key.toLowerCase();
        const fmt: InlineFormat | null = !ev.shiftKey && k === "b" ? { kind: "bold" } : !ev.shiftKey && k === "i" ? { kind: "italic" } : !ev.shiftKey && k === "u" ? { kind: "underline" } : ev.shiftKey && k === "h" ? { kind: "highlight" } : ev.shiftKey && k === "x" ? { kind: "strike" } : null;
        if (!fmt) return;
        ev.preventDefault();
        ev.stopPropagation();
        formatNote(fmt);
      });
      // 选中文字时浮出格式栏（不看「选中文字时显示格式栏」设置，备注里一律有）：输入框量不出选区的位置，放在弹窗上方
      const placeBar = () => {
        const has = ta.isConnected && this.el.ownerDocument.activeElement === ta && ta.selectionStart !== ta.selectionEnd;
        if (!has) {
          noteBar?.remove();
          noteBar = null;
          return;
        }
        if (!noteBar) {
          noteBar = createFormatBar(this.el.ownerDocument, {
            textColors: this.opts.textColors?.() ?? [],
            highlightColors: this.opts.highlightColors?.() ?? [],
            underlineKey: sc("Mod", "U"),
            icon,
            tip: (el, text) => this.tip(el, text),
            onFormat: (fmt) => formatNote(fmt),
            memory: this.colorMemory(),
            onCustom: () => {
              const sel = { from: ta.selectionStart, to: ta.selectionEnd };
              return (fmt) => formatNote(fmt, sel);
            },
          });
          noteBar.classList.add("mm-note-float-bar");
          this.el.append(noteBar);
        }
        const host = this.el.getBoundingClientRect();
        const r = pop.getBoundingClientRect();
        const w = noteBar.offsetWidth;
        const h = noteBar.offsetHeight;
        const above = r.top - host.top - h - 6;
        noteBar.style.left = `${Math.round(Math.max(4, Math.min(host.width - w - 4, r.left - host.left)))}px`;
        noteBar.style.top = `${Math.round(above >= 4 ? above : r.bottom - host.top + 6)}px`;
      };
      for (const type of ["select", "keyup", "mouseup", "input"]) ta.addEventListener(type, placeBar);
      this.popoverSave = save;
      this.popoverApply = apply;
      if (scope) {
        preview = createDiv({ cls: "mm-popover-body mm-note-preview markdown-rendered" });
        this.wireNoteBody(preview);
        const split = createDiv({ cls: "mm-note-split" });
        split.append(ta, preview);
        pop.append(split);
        pop.classList.add("has-preview");
        refreshPreview();
        // 输入框滚到哪，预览按比例跟到哪
        ta.addEventListener("scroll", () => {
          if (!preview) return;
          const room = ta.scrollHeight - ta.clientHeight;
          preview.scrollTop = room > 0 ? (ta.scrollTop / room) * (preview.scrollHeight - preview.clientHeight) : 0;
        });
      } else {
        pop.append(ta);
      }
      this.el.append(pop);
      if (keep && scope) {
        // 从查看切过来、开着分栏预览：位置和高度沿用，宽度放宽到够左右两栏（不超出画布）
        const host = this.el.getBoundingClientRect();
        const w = Math.round(Math.max(keep.w, Math.min(680, host.width - 16)));
        const left = Math.max(8, Math.min(parseFloat(keep.left) || 8, host.width - w - 8));
        pop.classList.add("is-sized");
        pop.setCssStyles({ width: `${w}px`, height: `${keep.h}px`, left: `${left}px`, top: keep.top });
      } else if (keep) {
        pop.classList.add("is-sized");
        pop.setCssStyles({ width: `${keep.w}px`, height: `${keep.h}px`, left: keep.left, top: keep.top });
      } else if (scope) {
        // 分栏要宽一些：两栏各有地方写字
        const host = this.el.getBoundingClientRect();
        pop.classList.add("is-sized");
        pop.setCssStyles({ width: `${Math.round(Math.max(160, Math.min(680, host.width - 16)))}px`, height: `${Math.round(Math.max(120, Math.min(340, host.height - 16)))}px` });
        this.placePopover(pop, nodeEl);
      } else {
        this.placePopover(pop, nodeEl);
      }
      ta.focus();
      const caret = spot ? Math.min(spot.at, ta.value.length) : ta.value.length;
      ta.setSelectionRange(caret, caret);
      if (spot) {
        // 普通输入框量不出某个字在哪一行：按光标前的行数估一下，把那一行挪到鼠标原来的高度
        const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 20;
        const row = ta.value.slice(0, caret).split("\n").length - 1;
        ta.scrollTop = Math.max(0, row * lineH - (spot.y - ta.getBoundingClientRect().top));
      }
    } else {
      pop.classList.add("is-view");
      const body = createDiv();
      body.className = "mm-popover-body";
      this.wireNoteBody(body);
      this.fillNoteBody(body, node.note);
      pop.append(body);
      if (this.opts.editable) {
        const editBtn = createEl("button");
        editBtn.type = "button";
        editBtn.className = "mm-popover-edit";
        editBtn.textContent = t("menu.edit");
        editBtn.addEventListener("click", () => this.toggleNotePopover(node, true));
        pop.append(editBtn);
        // 双击正文也进编辑（和展开的备注卡片一样）；双链、图片单击有自己的用处，双击它们不算
        body.addEventListener("dblclick", (ev) => {
          if ((ev.target as HTMLElement).closest("a, img")) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (this.recite) return;
          this.toggleNotePopover(node, true, undefined, this.noteSpot(body, ev, node));
        });
      }
      this.el.append(pop);
      this.applyPopoverSize(pop, node, nodeEl);
      this.placePopover(pop, nodeEl);
      // 图片晚到会把弹窗撑大，再摆一次免得出了画布
      body.addEventListener("load", () => this.placePopover(pop, nodeEl), true);
    }
    this.popover = pop;
  }

  /**
   * 编辑备注：Obsidian 自己的实时预览编辑器（设置「编辑备注时所见即所得」，默认开）。
   * 和普通输入框一样：边打边存、点到外面或 Esc / ⌘↵ 关掉、顶上一排格式按钮、⌘B ⌘⇧H 这些只改选中的字、粘贴拖入图片存成附件。
   * 编辑器建不起来（Obsidian 改了内部结构）返回 false，调用方用普通输入框
   */
  private openLiveNote(node: MindNode, pop: HTMLElement, nodeEl: HTMLElement, keep: { left: string; top: string; w: number; h: number } | null, spot?: { at: number; y: number }): boolean {
    const host = this.opts.host!;
    const initial = node.note;
    let ed: LiveNoteEditor | null = null;
    const apply = () => {
      if (!ed) return false;
      const next = this.storeNote(node, ed.value.replace(/\s+$/, ""));
      if (next === node.note) return false;
      node.note = next;
      return true;
    };
    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      this.popoverApply = null;
      this.noteFormat = null;
      doc.removeEventListener("pointerdown", outside, true);
      apply();
      ed?.destroy();
      if (node.note !== initial) {
        this.render();
        this.notify();
      }
    };
    const formatNote = (fmt: InlineFormat, sel?: { from: number; to: number }) => {
      const live = ed && ed.el.isConnected ? ed : null;
      const text = live ? live.value : unescapeNote(node.note);
      const { from, to } = sel ?? live?.selection ?? { from: 0, to: 0 };
      const r = formatLines(text, from, to, fmt);
      if (!r || r.text === text) return;
      if (!live) {
        node.note = this.storeNote(node, r.text.replace(/\s+$/, ""));
        this.render();
        this.notify();
        return;
      }
      live.replace(r.text, r.start, r.end);
      live.focus();
    };
    const insertImages = async (files: File[]) => {
      const links: string[] = [];
      for (const f of files) {
        const link = await this.saveImageFile(f);
        if (link) links.push(`![[${link}]]`);
      }
      if (!links.length) return;
      if (ed && ed.el.isConnected) {
        ed.focus();
        ed.insert(links.join("\n"));
        return;
      }
      node.note = this.storeNote(node, [unescapeNote(node.note), ...links].filter(Boolean).join("\n"));
      this.render();
      this.notify();
    };
    const close = () => {
      if (this.popover === pop) this.closePopover();
      this.el.focus({ preventScroll: true });
    };
    // 选中文字浮出的格式栏由宿主挂在编辑器上（和 Markdown 笔记里同一份）
    pop.classList.add("is-live");
    // 有表格时左边多留出表格手柄的位置（styles.css）；边写边看，插进表格、删掉表格都跟着变
    const markTable = (text: string) => pop.classList.toggle("has-table", /^[ \t]*\|.*\|[ \t]*$/m.test(text));
    markTable(unescapeNote(node.note));
    ed = host.createNoteEditor!(pop, {
      text: unescapeNote(node.note),
      caret: spot?.at,
      caretY: spot?.y,
      onChange: () => {
        if (apply() && !this.opts.embedded) this.scheduleNotify();
        if (ed) markTable(ed.value);
      },
      onKey: (ev) => {
        if (ev.isComposing) return false;
        const mod = ev.metaKey || ev.ctrlKey;
        if (ev.key === "Escape" || (ev.key === "Enter" && mod)) {
          ev.preventDefault();
          close();
          return true;
        }
        if (!mod || ev.altKey) return false;
        const k = ev.key.toLowerCase();
        const fmt: InlineFormat | null = !ev.shiftKey && k === "b" ? { kind: "bold" } : !ev.shiftKey && k === "i" ? { kind: "italic" } : !ev.shiftKey && k === "u" ? { kind: "underline" } : ev.shiftKey && k === "h" ? { kind: "highlight" } : ev.shiftKey && k === "x" ? { kind: "strike" } : null;
        if (!fmt) return false;
        ev.preventDefault();
        formatNote(fmt);
        return true;
      },
      onPaste: (ev) => {
        const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        ev.preventDefault();
        void insertImages(files);
        return true;
      },
      onDragOver: (ev) => {
        if (ev.dataTransfer?.types.includes("Files") || host.getDraggedFiles?.()?.length) {
          ev.preventDefault();
          ev.dataTransfer!.dropEffect = "copy";
          return true;
        }
        return false;
      },
      onDrop: (ev) => {
        const vaultFiles = host.getDraggedFiles?.() ?? null;
        if (vaultFiles?.length) {
          ev.preventDefault();
          ed?.insert(vaultFiles.map((f) => (f.isImage ? `![[${f.linktext}]]` : `[[${f.linktext}]]`)).join("\n"));
          return true;
        }
        const files = [...(ev.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        ev.preventDefault();
        void insertImages(files);
        return true;
      },
    });
    if (!ed) {
      pop.classList.remove("is-live");
      return false;
    }
    // 关掉的时机：在 Obsidian 主界面里（画布、侧栏、别的标签页）按下鼠标、又不在这个弹窗里。
    // 不按失焦关：斜杠菜单、插入表格的行列对话框、格式栏的取色板、表格的菜单都会抢走焦点，它们挂在主界面外面
    const doc = this.el.ownerDocument;
    const outside = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target || pop.contains(target) || !target.closest(".app-container")) return;
      if (this.popover === pop) this.closePopover();
    };
    doc.addEventListener("pointerdown", outside, true);
    // 编辑框里的按键、拖放归编辑框，不冒到画布（画布会当成节点快捷键、新建节点）
    for (const type of ["keyup", "keypress", "dragover", "drop", "dblclick", "contextmenu"]) ed.el.addEventListener(type, (ev) => ev.stopPropagation());
    // 光标在编辑框里的表格格子上（格子是另一个小编辑器，外层的按键处理收不到）：Esc、⌘↵ 没人处理就关掉备注
    // Obsidian 自己的表格格子会把 Esc 标成处理过、其实什么都不做，这种照样关；gogoga 表格（.ggt）的格子 Esc 是退出格子编辑，尊重它
    ed.el.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.isComposing) return;
      const target = ev.target as HTMLElement;
      const nativeCell = ev.key === "Escape" && !!target.closest("table") && !target.closest(".ggt");
      if (ev.defaultPrevented && !nativeCell) return;
      if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
        ev.preventDefault();
        close();
      }
    });
    this.noteFormat = (fmt) => formatNote(fmt);
    this.popoverSave = save;
    this.popoverApply = apply;
    this.el.append(pop);
    // 所见即所得的编辑框要地方：默认比普通输入框大一些，沿用查看窗口的位置大小
    const room = this.el.getBoundingClientRect();
    pop.classList.add("is-sized");
    if (keep) pop.setCssStyles({ width: `${Math.max(keep.w, 320)}px`, height: `${Math.max(keep.h, 200)}px`, left: keep.left, top: keep.top });
    else {
      pop.setCssStyles({ width: `${Math.round(Math.max(200, Math.min(460, room.width - 16)))}px`, height: `${Math.round(Math.max(140, Math.min(320, room.height - 16)))}px` });
      this.placePopover(pop, nodeEl);
    }
    ed.focus();
    return true;
  }

  /** 备注正文里的双链、图片：弹窗和展开的卡片共用 */
  private wireNoteBody(body: HTMLElement): void {
    // 备注里的图片太小，单击（或双击）就全屏看原图
    body.addEventListener("click", (ev) => {
      // 备注里的双链：MarkdownRenderer 只画出链接，点击要自己接（⌘/Ctrl 点在新标签页打开）
      const link = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      if (link) {
        ev.preventDefault();
        ev.stopPropagation();
        this.opts.host?.openLink?.(link.dataset.href ?? link.getAttribute("href") ?? "", true, ev);
        return;
      }
      const img = (ev.target as HTMLElement).closest("img");
      if (!img) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.openLightbox(img);
    });
    // 悬停双链出预览（按住 ⌘/Ctrl 或开了页面预览设置时，Obsidian 自己判断）
    body.addEventListener("mouseover", (ev) => {
      const link = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      const href = link?.dataset.href ?? link?.getAttribute("href");
      if (link && href) this.opts.host?.hoverLink?.(ev, href, link);
    });
  }

  private fillNoteBody(body: HTMLElement, note: string): void {
    // 换掉了的卡片、关掉的窗口里的表格：销毁（表格编辑器在文档上挂着监听）
    for (const t of this.noteTableEds) {
      if (t.el.isConnected && !body.contains(t.el)) continue;
      t.ed.destroy();
      this.noteTableEds.delete(t);
    }
    const host = this.opts.host;
    if (host?.renderNote) {
      body.classList.add("markdown-rendered");
      const parts = splitNoteTables(unescapeNote(note));
      if (parts.length === 1 && "md" in parts[0]) {
        host.renderNote(body, parts[0].md);
        return;
      }
      // 带 gogoga-table 注释的表格用脑图的表格组件画（只读）：合并单元格、底色、列宽和节点表格一样显示
      for (const part of parts) {
        if ("md" in part) {
          host.renderNote(body.createDiv({ cls: "mm-note-part" }), part.md);
          continue;
        }
        const wrap = body.createDiv({ cls: "mm-node-table mm-note-table" });
        // 格子里的链接由表格自己打开，不再冒到备注上再开一次
        wrap.addEventListener("click", (ev) => {
          if ((ev.target as HTMLElement).closest("a")) ev.stopPropagation();
        });
        const ed = new TableEditor(wrap, part.table, {
          readonly: true,
          onChange: () => {},
          renderMarkdown: (cell, md) => host.renderNote!(cell, md),
          setIcon: host.setIcon,
          openLink: host.openLink ? (href, ev) => host.openLink!(href, true, ev) : undefined,
          hoverLink: host.hoverLink,
          notice: host.notice,
        });
        this.noteTableEds.add({ el: wrap, ed });
      }
    } else {
      body.classList.add("is-plain");
      body.textContent = unescapeNote(note);
    }
  }

  /**
   * 查看备注的弹窗右下角可以拖动改大小（CSS resize）。拖出来的尺寸记在这条备注上（和展开卡片的大小一样按文件存），
   * 下次打开这条备注直接用；没单独拖过的用全局记的尺寸（以前的版本拖过就有），再没有就按内容。
   * 双击右下角：去掉这条备注自己的尺寸，回到全局尺寸或按内容（群友 zhiqiang）。
   * 默认的最大宽高是为了不撑满画布，拖动时放开到画布大小
   */
  private applyPopoverSize(pop: HTMLElement, node: MindNode, nodeEl: HTMLElement): void {
    const store = this.opts.notePopoverSize;
    const host = this.el.getBoundingClientRect();
    // 画布还没量出尺寸（刚打开、被折叠）时不按它收窄，免得记住的尺寸被压成最小
    const room = (v: number, fallback: number) => (v > 50 ? v - 16 : fallback);
    const lift = () => pop.setCssStyles({ maxWidth: `${room(host.width, 4000)}px`, maxHeight: `${room(host.height, 4000)}px` });
    // 太小的值是坏数据（比如拖到一半弹窗被关掉量成 0），当没记过
    const ok = (s: PopoverSize | undefined): s is PopoverSize => !!s && s.w >= 160 && s.h >= 48;
    const own = (): PopoverSize | undefined => {
      const c = this.cardState.get(node.id);
      return c?.pw && c.ph ? { w: c.pw, h: c.ph } : undefined;
    };
    const size = () => {
      const mine = own();
      const saved = ok(mine) ? mine : store?.get();
      if (ok(saved)) {
        lift();
        pop.setCssStyles({ width: `${Math.min(saved.w, room(host.width, saved.w))}px`, height: `${Math.min(saved.h, room(host.height, saved.h))}px` });
      } else pop.setCssStyles({ width: "", height: "", maxWidth: "", maxHeight: "" });
    };
    size();
    const corner = (ev: MouseEvent) => {
      const r = pop.getBoundingClientRect();
      // 只认右下角的拖动柄那一小块
      return ev.clientX >= r.right - 18 && ev.clientY >= r.bottom - 18;
    };
    pop.addEventListener("dblclick", (ev) => {
      if (!corner(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (own()) this.updateCard(node, { pw: undefined, ph: undefined });
      size();
      this.placePopover(pop, nodeEl);
    });
    pop.addEventListener("pointerdown", (ev) => {
      if (!corner(ev)) return;
      // 先把当前尺寸钉成显式宽高再放开上限，否则内容宽的弹窗（大图）一按就自己撑大；为状态栏临时压矮的也放开
      pop.classList.remove("is-capped");
      const w0 = pop.offsetWidth;
      const h0 = pop.offsetHeight;
      pop.setCssStyles({ width: `${w0}px`, height: `${h0}px` });
      lift();
      const doc = this.el.ownerDocument;
      const up = () => {
        doc.removeEventListener("pointerup", up, true);
        // 松手前弹窗可能已经被关掉了（量出来是 0），那次不算
        if (!pop.isConnected || pop.offsetWidth < 160 || pop.offsetHeight < 48) return;
        if (pop.offsetWidth !== w0 || pop.offsetHeight !== h0) this.updateCard(node, { pw: pop.offsetWidth, ph: pop.offsetHeight });
      };
      doc.addEventListener("pointerup", up, true);
    });
  }

  private placePopover(pop: HTMLElement, nodeEl: HTMLElement): void {
    const r = nodeEl.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - host.left, host.width - pop.offsetWidth - 8));
    // 右下角的状态栏浮在画布上：弹窗落在它那一段时底边要让开，不然右下角拖动改大小、双击恢复的那块被它盖住点不到
    const bottom = host.height - 8 - this.bottomCover(host.left + left, host.left + left + pop.offsetWidth);
    pop.style.removeProperty("--mm-pop-cap");
    pop.classList.remove("is-capped");
    let top = r.bottom - host.top + 8;
    if (top + pop.offsetHeight > bottom) top = Math.max(8, r.top - host.top - pop.offsetHeight - 8);
    // 上下都放不下：尽量往上挪；还是比可用的高度高，这次显示先压矮（不改记下的尺寸），右下角始终露在外面
    if (top + pop.offsetHeight > bottom) {
      top = Math.max(8, bottom - pop.offsetHeight);
      if (top + pop.offsetHeight > bottom && bottom - top > 48) {
        pop.style.setProperty("--mm-pop-cap", `${Math.floor(bottom - top)}px`);
        pop.classList.add("is-capped");
      }
    }
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
