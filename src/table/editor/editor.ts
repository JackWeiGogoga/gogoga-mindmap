/**
 * 表格编辑器：给一个元素就挂出一张能编辑的表。不依赖 Obsidian，实时预览、阅读视图、脑图节点都用它，
 * 和宿主之间只通过 EditorHost 打交道（渲染格子里的 Markdown、把改好的表交回去、撤销……）。
 *
 * 交互（参考飞书、Notion）：
 * - 单击格子选中；直接打字替换内容，双击或 Enter 在原内容上改；手机上点一下就进入编辑
 * - 编辑中 Enter 完成并往下走一格，Shift+Enter 换行，Tab / Shift+Tab 左右走，Esc 取消
 * - 选中时方向键移动，Delete / Backspace 清空，⌘Z 交给宿主撤销
 * - 鼠标停在格子上，行左边、列上边出现手柄，点开是行 / 列菜单；表格右边、下边的加号加列加行
 * - 拖表头右边缘改列宽，双击恢复自动
 *
 * 选中时焦点在一个看不见的输入框里（放在选中的格子上），打字和输入法组字都先落到它身上，
 * 第一下输入就把它变成这一格的编辑框，组字不会被打断。
 */

import { type ColorMemory, colorFormat, createColorSplit, createPalette, paintColor, refreshColorSplit, THEME_HIGHLIGHT } from "../core/color-palette";
import { type Align, type Calc, CALCS, CELL_COLORS, type CellColor, type ColType, CURRENCIES, FONT_SIZES, isDelimiterRow, parseTable, type Rect, serializeTable, type Table, TABLE_DENSITIES, TABLE_STYLES, type TableDensity, type TableStyle, type VAlign } from "../core/table";
import { headRows, setFolded, canSetHead, crossesHead, MAX_HEAD_ROWS, alignAll, autoWidthAll, bgOf, hasTotal, normalize, setCalc, setOptionColor, fgOf, setFg, fontSizeOf, setFontSize, setTableFontSize, setWide, setWidths, canSortRows, CHECK_RE, duplicateCol, duplicateRow, insertCols, insertRows, sortRows, toggleCheck, toggleTask, editCell, mergedText, shownText, clearAllBg, clearCells, fillRange, setTableLook, type FillDir, isCovered, colCount, deleteCol, deleteRow, insertCol, insertRow, mergeAt, mergeCells, merges, moveCol, moveRow, pasteGrid, rowCount, setAlign, setBg, setCell, setWidth, subTable, unmergeAt, widthOf, setVAlign, vAlignAll, vAlignOf } from "../core/ops";
import { COL_KINDS, type ColKind, colKindOf, colTypeOf, setColKind, setColType } from "../core/ops";
import { isoDate, parseLooseDate, readDate, readProgress, splitTags, writeDate, type Ymd } from "../core/coltype";
import { checkFormula, columnNames, formulaError, formulaOf, fxCellNote, fxPlacesOf, isFxCell, setFormula, totalsAllSum } from "../core/ops";
import { formatFx, type FxEmpty, type FxError, nameOk, prettyOps } from "../core/formula";
import { fromTSV, sourceAttr, toHTML, toTSV } from "../core/clipboard";
import { type InlineFormat } from "../core/format";
import { applyFormat } from "../core/format-apply";
import { type CellInput, CodeMirrorInput, type Edge, TextareaInput } from "./cell-input";
import { isSealed } from "../core/secret";
import type { SecretBox } from "../core/secret-box";

/** 列类型菜单的图标 */
const KIND_ICONS: Record<ColKind, string> = { text: "type", status: "tag", multi: "tags", date: "calendar", num: "hash", bar: "percent", enc: "lock" };

/** 编辑时按方向键：到了格子边上往哪个格子走 */
const ARROW_EDGE: Record<string, { edge: Edge; dr: number; dc: number } | undefined> = {
  ArrowUp: { edge: "up", dr: -1, dc: 0 },
  ArrowDown: { edge: "down", dr: 1, dc: 0 },
  ArrowLeft: { edge: "left", dr: 0, dc: -1 },
  ArrowRight: { edge: "right", dr: 0, dc: 1 },
};
import { t } from "./i18n";

export interface MenuItem {
  title?: string;
  icon?: string;
  /** 色块（底色菜单用） */
  swatch?: CellColor | "none";
  /** 色块是文字颜色（画成一个带颜色的「A」） */
  textSwatch?: boolean;
  /** 只画图标、和相邻的 inline 项排成一排（对齐这类），名字在悬停提示里；菜单短一些，矮窗口里不用滚 */
  inline?: boolean;
  checked?: boolean;
  disabled?: boolean;
  /** 灰掉的原因：悬停显示，点一下弹提示（不说原因的灰色项会被当成功能坏了、要付费，B 站 LinJG2023） */
  why?: string;
  danger?: boolean;
  run?: () => void;
  separator?: boolean;
  /** 现成的图标元素（别的插件加进来的项，只有画好的图标，没有图标名） */
  iconNode?: Node;
  /** 文字大小档位（倍数）：画成一个这么大的「A」，和相邻的排成一排 */
  sizeChip?: number;
  /** 这一排开头的名字（文字大小那排：名字和「A」放一行，菜单矮一些） */
  rowLabel?: string;
  /** 和文字大小一样排成一排的小按钮，上面写这几个字（表头行数的 1、2、3） */
  chipText?: string;
}

export interface EditorHost {
  /** 把格子里的 Markdown 渲染进 el；不给就按纯文本显示 */
  renderMarkdown?(el: HTMLElement, markdown: string): void;
  /** 表改了：宿主负责写回文件。previous 是改之前显示的那张（宿主按它在文件里找到这张表） */
  onChange(table: Table, previous: Table): void;
  /** 在图标元素里放图标（Obsidian 的 setIcon）；不给就用文字符号 */
  setIcon?(el: HTMLElement, name: string): void;
  undo?(): void;
  redo?(): void;
  /** 选中第一行再往上、最后一行再往下、Esc：宿主把光标挪出表格 */
  onLeave?(where: "above" | "below" | "escape"): void;
  /** 编辑格子时输入 [[ 补全笔记链接：返回要插进去的链接文字（最多十几个） */
  suggestLinks?(query: string): string[];
  /** 编辑格子时输入 # 补全标签：返回不带 # 的标签 */
  suggestTags?(query: string): string[];
  /** 删掉整张表（连同下面的注释）：给了才在表格菜单里出现「删除表格」 */
  onDeleteTable?(): void;
  /** 整张表往里缩（挂到上面最近的列表项下）/ 移出列表：给了才在表格菜单里出现；canIndentTable 决定是不是灰的 */
  indentTable?(dir: 1 | -1): void;
  canIndentTable?(dir: 1 | -1): boolean;
  /** 弹一条提示（复制好了之类）；不给就不提示 */
  notice?(message: string): void;
  /** 点格子里的双链：打开那篇笔记（ev 带着修饰键，⌘/Ctrl 点在新标签打开）；不给就不管 */
  openLink?(href: string, ev: MouseEvent): void;
  /** 鼠标悬停在格子里的双链上：页面预览 */
  hoverLink?(ev: MouseEvent, href: string, el: HTMLElement): void;
  /** 右键格子里的双链：宿主弹出原生的链接菜单（新标签页打开、重命名、移动……）；不给就照常弹格子菜单 */
  linkMenu?(ev: MouseEvent, href: string): void;
  /**
   * 右键格子里的图片：宿主弹出图片菜单。link 是 ![[…]] 里的文件名（Markdown 图片语法时为 null）；
   * remove 把这张图的嵌入从格子里去掉（删掉文件后调用；只读时为 null）
   */
  imageMenu?(ev: MouseEvent, img: HTMLImageElement, link: string | null, remove: (() => void) | null): void;
  /** 收起右键双链、图片弹出的菜单（点格子时会拦下按下的默认动作，宿主的菜单收不到「点了别处」，#9） */
  dismissMenus?(): void;
  /** 右键格子时，别的插件往这次右键里加的菜单项（比如 adjustable-media 的「包成布局块」）：交给表格自己的菜单显示，不另弹一个 */
  eventMenuItems?(ev: MouseEvent, take: (items: MenuItem[]) => void): void;
  /** 往格子里粘贴图片：存成附件，返回要插进格子的 Markdown（![[…]]）；不给就不接图片 */
  saveImage?(file: File): Promise<string | null>;
  /** 选中或开始编辑时通知宿主（实时预览里用来防止编辑器抢走光标） */
  onFocus?(): void;
  /** 格子的编辑框用 CodeMirror：加粗、颜色、荧光笔直接显示效果，标签藏起来（建编辑器时问一次） */
  richEdit?(): boolean;
  /** 编辑格子时选中文字浮出的格式栏用哪些颜色；返回 null（或不给）就不显示格式栏 */
  formatColors?(root: HTMLElement): { text: string[]; highlight: string[] } | null;
  /** 格式栏颜色下拉记住的颜色（上次用的、最近使用）；不给就只记在这次的格式栏里 */
  colorMemory?(): ColorMemory;
  /** 日期列写成 [[日记]] 时：按日记插件的日期格式写名字、读名字；不给就用 2026-11-17 */
  dailyNote?(): { name(v: Ymd): string; parse(name: string): Ymd | null } | null;
  /** 日期列手打的 1/5、2026年1月5日、今天 这些，提交时换成这一列的写法；不给当成开着 */
  smartDate?(): boolean;
  /** 加密列的主密码会话（所有表格共用一个）；不给就只显示 ••••••，不能解锁、不能改加密列 */
  secrets?(): SecretBox | null;
  /** 确认框（把加密列解密成明文之前问一下）；不给就不做要确认的事 */
  confirm?(message: string, ok: string): Promise<boolean>;
  readonly?: boolean;
}

type Pos = { r: number; c: number };

/** 加密列的数据格：[行, 列, 原文]（合并格只算左上角） */
function secretCellsOf(t: Table): [number, number, string][] {
  const out: [number, number, string][] = [];
  const end = rowCount(t) - (hasTotal(t) ? 1 : 0);
  t.meta.ty?.forEach((ty, c) => {
    if (ty?.t !== "enc" || c >= colCount(t)) return;
    for (let r = headRows(t); r < end; r++) {
      const m = mergeAt(t, r, c);
      if (m && (m.r1 !== r || m.c1 !== c)) continue;
      out.push([r, c, t.cells[r][c]]);
    }
  });
  return out;
}

/** 整格是加密的内容（任何列里：加密列，或单独加密的格子） */
function hasSecret(md: string): boolean {
  return md.includes("🔐") && !!md.trim() && isSealed(md);
}

/** 表里所有加密的格子的原文（解锁时拿来核对、解开） */
function sealedCellsOf(t: Table): string[] {
  const out = new Set<string>();
  for (const row of t.cells) for (const v of row) if (hasSecret(v)) out.add(v);
  return [...out];
}

/** next 的加密列里有 prev 的加密列里没有的明文（粘贴、填充进来的） */
export function freshPlain(prev: Table, next: Table): boolean {
  if (!next.meta.ty?.some((x) => x?.t === "enc")) return false;
  const had = new Set(secretCellsOf(prev).map((x) => x[2]));
  return secretCellsOf(next).some(([, , v]) => !!v.trim() && !isSealed(v) && !had.has(v));
}

/** 加密列里的明文全部加密（要先解锁） */
async function sealTable(t: Table, box: SecretBox): Promise<Table> {
  const todo = secretCellsOf(t).filter(([, , v]) => v.trim() && !isSealed(v));
  if (!todo.length) return t;
  const sealed = await Promise.all(todo.map(([, , v]) => box.seal(v)));
  let n = t;
  todo.forEach(([r, c], i) => (n = editCell(n, r, c, sealed[i])));
  return n;
}

/** 复制出去的明文过 30 秒从剪贴板清掉（剪贴板里已经换成别的就不动） */
function clearClipboardLater(win: Window, text: string): void {
  win.setTimeout(() => {
    void win.navigator.clipboard
      .readText()
      .then((now) => (now === text ? win.navigator.clipboard.writeText("") : undefined))
      .catch(() => undefined);
  }, 30000);
}

/** 内容、对齐、设置都一样（写回风格不算） */
export function sameTable(a: Table, b: Table): boolean {
  return JSON.stringify([a.cells, a.align, a.meta]) === JSON.stringify([b.cells, b.align, b.meta]);
}


/**
 * 不用走 Markdown 渲染的格子：只有文字、数字和不会触发任何写法的标点（没有链接、加粗、标签、公式、HTML、换行……），
 * 也不以列表、引用、标题的记号开头。拿不准的一律交给渲染，宁可慢不能显示错
 */
/** 垂直对齐菜单项的图标 */
const V_ICONS = { top: "align-vertical-justify-start", middle: "align-vertical-justify-center", bottom: "align-vertical-justify-end" } as const;

/**
 * 格子里 Shift+Enter 空出来的行（#13）：交给 Markdown 渲染时连着的空行会折成一处段落分隔，格子里段落没有间距，空行就看不见了。
 * 渲染前把夹在中间的空行换成一个不换行空格，让它真的占一行（只改显示，文件里还是原来的换行）。代码块里的不动
 */
export function keepBlankLines(md: string): string {
  if (!/\n[ \t]*\n/.test(md)) return md;
  const lines = md.split("\n");
  let fence = false;
  return lines
    .map((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const inner = i > 0 && i < lines.length - 1;
      return !fence && inner && !l.trim() ? "&nbsp;" : l;
    })
    .join("\n");
}

/** 列宽按比例缩放时每列最窄多少（再窄就宁可横向滚动） */
const MIN_FIT_COL = 56;

const PLAIN_RE = /^[\p{L}\p{N}\p{Zs},.;:!?'"()%+\-/@，。、；：！？“”‘’（）《》【】…—·]*$/u;
export function isPlainText(md: string): boolean {
  if (!PLAIN_RE.test(md)) return false;
  // 列表（- 、+ 、1. 、1) ）开头；网址会被自动变成链接；%% 是注释
  if (/^\s*([-+]\s|\d+[.)](\s|$))/.test(md)) return false;
  if (/:\/\/|www\.|%%|^\s*-+\s*$/i.test(md)) return false;
  return true;
}

/** 最近一次选中格子的那张表：命令（命令面板、快捷键）作用在它上面 */
let lastActive: TableEditor | null = null;

function markActive(e: TableEditor): void {
  lastActive = e;
}
export function activeTableEditor(): TableEditor | null {
  return lastActive && lastActive.hasSelection() ? lastActive : null;
}

export const TABLE_COMMANDS = [
  "insert-row-above",
  "insert-row-below",
  "insert-col-left",
  "insert-col-right",
  "duplicate-row",
  "duplicate-col",
  "delete-row",
  "delete-col",
  "sort-asc",
  "sort-desc",
  "merge-cells",
  "unmerge-cells",
  "clear-cells",
  "align-left",
  "align-center",
  "align-right",
  "select-row",
  "select-col",
  "toggle-checkbox",
] as const;
export type TableCommand = (typeof TABLE_COMMANDS)[number];

/**
 * 浮出来的菜单挂在哪：电脑上挂 body；手机、平板上挂进 Obsidian 的 .app-container。
 * iPhone 上挂在 body 下的菜单看得见、点不到，手指点下去落到了后面的格子、正文上（iPhone 镜像实测，小红书反馈「删除行列只有最后一行一列才有用」）
 */
export function popupParent(doc: Document): HTMLElement {
  if (doc.body.classList.contains("is-mobile")) return doc.querySelector<HTMLElement>(".app-container") ?? doc.body;
  return doc.body;
}

export class TableEditor {
  readonly root: HTMLElement;
  private table: Table;
  private readonly scroller: HTMLElement;
  private readonly tableEl: HTMLTableElement;
  private input: CellInput;
  private readonly rowHandle: HTMLElement;
  /** 表格左上角的按钮：这张表的样式、行距、整表对齐…… */
  private readonly cornerBtn: HTMLElement;
  /** 选了一片时框住整片的蓝框（放在滚动容器里，横向滚动时跟着表格走） */
  private readonly rangeBox: HTMLElement;
  /** 十字高亮：盖在表格上的四条淡色带（左、右、上、下，选中那格自己留空）。逐格加样式在大表格里很慢（每改一格整张表重排） */
  private readonly crossBands: HTMLElement[];
  /** 选区右下角的填充柄（往下 / 往右拖，按规律接着填） */
  private readonly fillHandle: HTMLElement;
  /** 拖填充柄时，要填的那一片的虚线框 */
  private readonly fillPreview: HTMLElement;
  /** 调列宽的线：鼠标靠近任意两列之间的竖线（哪一行都行）时出现，贯穿整张表 */
  private readonly resizeBar: HTMLElement;
  private readonly colHandle: HTMLElement;
  private sel: Pos | null = null;
  /** 多格选区的另一头（拖选、Shift）；null 是只选了一格 */
  private anchor: Pos | null = null;
  /** 选区是点行 / 列手柄选的整行 / 整列：不因为碰到合并格往外扩 */
  private lineSel = false;
  /** 折着的表在这张编辑器里临时展开了（阅读视图点「展开」、搜索跳到藏着的行），不改文件 */
  private localUnfold = false;
  private editing = false;
  /** 编辑时宿主送来的新表：等这一格改完再换上 */
  private pending: Table | null = null;
  private hover: Pos | null = null;
  /** 上一次滚动的时间：滚动中（和刚停下的一小会儿）不显示手柄，鼠标再动才出来（#2） */
  private scrolledAt = 0;
  /** 最近一次是用手指点的：触屏没有悬停，手柄跟着选中的格子显示 */
  private touched = false;
  /** 触屏上的「多选格子」：点格子不进编辑，而是从起点选到这一格（相当于电脑上按住 Shift 点），长按选区出菜单 */
  /** 刚按坐标替菜单点过按钮：这次触摸剩下的事件（iPhone 上 touchstart 在 pointerdown 之后才来，那时菜单已经关了）别再落到后面的正文、格子上 */
  private swallowUntil = 0;
  /** 每个位置 → 显示它的格子元素（被合并盖住的位置指向左上角那格）。render 时建，大表格里不用每次 querySelector 全表 */
  private grid: HTMLElement[][] = [];
  /** 上一次加了选中样式、十字高亮的格子：下次只清这些，不扫全表 */
  private marked: HTMLElement[] = [];
  private crossed: HTMLElement[] = [];
  private popover: HTMLElement | null = null;
  /** 上次提示「计算列不能改」的时间（一直打字时别一直弹） */
  private fxNoticeAt = 0;
  /** 编辑时的补全列表（[[ 链接、# 标签） */
  private suggest: { kind: "link" | "tag" | "option"; start: number; items: string[]; index: number; el: HTMLElement; multi?: { before: string[]; after: string[] } } | null = null;
  /** 日期列编辑时的日历：view 是正在看的月份，picked 是格子里现在的日期 */
  private cal: { el: HTMLElement; y: number; m: number; key: string } | null = null;
  /** 这次编辑里打过字（日期列「自动识别日期写法」只换打过字的格子） */
  private typed = false;
  /** 上次弹菜单的位置（列类型的二级菜单在同一处打开） */
  private menuAt = { x: 0, y: 0 };
  private resize: { c: number; startX: number; startW: number; col: HTMLElement; fitW: number; scale: number } | null = null;
  private destroyed = false;
  /** 横向滚动条占的高度（覆盖式滚动条是 0） */
  private scrollbarH = 0;
  /** 浮在可视区底边的横向滚动条（表格又宽又长、自己的滚动条在屏幕下面时才出来） */
  private hbar: HTMLElement | null = null;
  private hbarSync = false;
  /** 列宽按比例缩放时缩了多少（1 = 没缩）；拖列宽时按它换算回文件里的宽度 */
  private fitScale = 1;
  /** 上一次长按开菜单的时间（安卓随后还会来一次右键事件，忽略掉） */
  private longPressAt = -Infinity;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    table: Table,
    private readonly host: EditorHost,
  ) {
    this.table = table;
    const doc = parent.ownerDocument;
    this.root = doc.createElement("div");
    this.root.className = "ggt";
    this.scroller = this.root.appendChild(doc.createElement("div"));
    this.scroller.className = "ggt-scroll";
    this.tableEl = this.scroller.appendChild(doc.createElement("table"));
    this.tableEl.className = "ggt-table";
    this.rangeBox = this.scroller.appendChild(doc.createElement("div"));
    this.rangeBox.className = "ggt-range-box";
    this.crossBands = [0, 1, 2, 3].map(() => {
      const band = this.scroller.appendChild(doc.createElement("div"));
      band.className = "ggt-cross-band";
      return band;
    });
    this.fillPreview = this.scroller.appendChild(doc.createElement("div"));
    this.fillPreview.className = "ggt-fill-preview";
    this.fillHandle = this.scroller.appendChild(doc.createElement("div"));
    this.fillHandle.className = "ggt-fill";
    this.fillHandle.setAttribute("aria-label", t("fill"));
    // 宿主要「所见即所得」就用 CodeMirror（格式直接显示、标签藏起来），否则普通 textarea
    this.input = host.richEdit?.() ? new CodeMirrorInput(doc) : new TextareaInput(doc);
    this.resizeBar = this.root.appendChild(doc.createElement("div"));
    this.resizeBar.className = "ggt-resize";
    this.resizeBar.setAttribute("aria-label", t("resize"));
    // 手机、平板：从这些把手上横着拖是在调列宽、拖填充、挪行列，不是拉出 Obsidian 的侧栏。
    // Obsidian 的侧栏手势在 touchstart 时沿着目标往上找 data-ignore-swipe，有就不启动（它自己的滑块、拖动把手也这么标）
    this.resizeBar.dataset.ignoreSwipe = "true";
    this.fillHandle.dataset.ignoreSwipe = "true";
    this.rowHandle = this.handle("ggt-row-handle", t("rowMenu"), "grip-vertical");
    this.cornerBtn = this.root.appendChild(doc.createElement("button"));
    this.cornerBtn.setAttribute("type", "button");
    this.cornerBtn.className = "ggt-corner";
    this.cornerBtn.tabIndex = -1;
    this.cornerBtn.setAttribute("aria-label", t("tableMenu"));
    if (this.host.setIcon) this.host.setIcon(this.cornerBtn, "table-2");
    else this.cornerBtn.textContent = "▦";
    this.colHandle = this.handle("ggt-col-handle", t("colMenu"), "grip-horizontal");
    this.addButton("ggt-add-col", t("addCol"), () => this.apply(insertCol(this.table, colCount(this.table)), { r: this.sel?.r ?? 0, c: colCount(this.table) }));
    this.addButton("ggt-add-row", t("addRow"), () => this.apply(insertRow(this.table, rowCount(this.table)), { r: rowCount(this.table), c: this.sel?.c ?? 0 }));
    // 群里反馈：四边都能加。左边加在最前面；上边加在表头下面（Markdown 的表头只能是第一行）。
    // 这两条在表格外面（里面的留白放着行列手柄），盖在上一行文字、左边留白上：鼠标先进了表格才接得住点击，免得点上一行的字误加一行
    this.addButton("ggt-add-col-first", t("addColFirst"), () => this.apply(insertCol(this.table, 0), { r: this.sel?.r ?? 0, c: 0 }));
    this.addButton("ggt-add-row-first", t("addRowFirst"), () => {
      const at = headRows(this.table);
      this.apply(insertRow(this.table, at), { r: at, c: this.sel?.c ?? 0 });
    });
    // 上边、左边的加号和表格之间隔着一点空隙：鼠标从表格出来再停一会儿才算离开（0.4 秒），不然移到加号上时它已经不接点击了。
    // 到了加号上（它也在表格的元素里）就又算进来了
    let leaveTimer = 0;
    this.root.addEventListener("pointerenter", () => {
      window.clearTimeout(leaveTimer);
      this.root.classList.add("is-hot");
    });
    this.root.addEventListener("pointerleave", () => {
      window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => this.root.classList.remove("is-hot"), 400);
    });
    this.cleanups.push(() => window.clearTimeout(leaveTimer));
    this.root.classList.toggle("is-readonly", !!host.readonly);
    parent.appendChild(this.root);
    // 主密码锁上、解锁了：重画加密格子（旧版本的会话没有 subscribe）
    const box = host.secrets?.();
    if (box?.subscribe) this.cleanups.push(box.subscribe(() => this.refreshSecrets()));
    this.bind();
    this.render();
    this.watchScroll();
  }

  // ---------- 对外 ----------

  /** 宿主那边的表变了（比如撤销、别处改了文件） */
  update(table: Table): void {
    // 自己刚交出去、宿主写回文件后又送回来的同一张表：不重画（重画会丢掉焦点和悬停状态）
    if (sameTable(table, this.table)) {
      this.table = table;
      return;
    }
    if (this.editing) {
      this.pending = table;
      return;
    }
    this.table = table;
    this.render();
  }

  getTable(): Table {
    return this.table;
  }

  select(r: number, c: number): void {
    this.revealRow(r);
    this.setSel({ r, c }, true);
  }

  /** 折着的表：在这一张编辑器里先展开（不改文件），要去的那一行藏着的时候用（搜索跳过来、宿主要选某一格） */
  private revealRow(r: number): void {
    if (!this.folded() || r < headRows(this.table)) return;
    this.localUnfold = true;
    this.render();
  }

  /** 折叠着：注释里有 fold、没在这张编辑器里临时展开、表头下面真有行 */
  private folded(): boolean {
    const tb = this.table;
    return tb.meta.fold === 1 && !this.localUnfold && rowCount(tb) > headRows(tb);
  }

  /** 画出来的行数：折着时只有表头 */
  private shownRows(): number {
    return this.folded() ? headRows(this.table) : rowCount(this.table);
  }

  /** 点「展开 N 行」：能改文件就去掉注释里的 fold；只读（阅读视图）只在这里展开，不改文件 */
  private unfold(): void {
    if (this.host.readonly) {
      this.localUnfold = true;
      this.render();
      return;
    }
    this.applyKeepRange(setFolded(this.table, false));
  }

  /**
   * 正在编辑的这一格按输入框里现在的文字算出来的表，不结束编辑；没在编辑或没改返回 null。
   * 宿主自动保存前用（脑图视图存盘前要带上正在输入的文字）
   */
  draft(): Table | null {
    if (!this.editing || !this.sel) return null;
    const text = this.input.value.replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "");
    const edited = editCell(this.table, this.sel.r, this.sel.c, text);
    return edited === this.table ? null : normalize(edited);
  }

  /** 结束编辑并把输入的内容交给宿主（宿主关掉、换文档、切只读之前调） */
  flush(): void {
    if (this.editing) this.commit();
  }

  isEditing(): boolean {
    return this.editing;
  }

  hasSelection(): boolean {
    return !this.destroyed && !!this.sel && this.root.isConnected;
  }

  /** 命令：作用在选中的格子（或选区）上。做不了返回 false */
  runCommand(id: TableCommand): boolean {
    const p = this.sel;
    if (!p || this.host.readonly) return false;
    if (this.editing) this.commit();
    const tb = this.table;
    const r = this.rangeRect() ?? { r1: p.r, c1: p.c, r2: p.r, c2: p.c };
    const rows = r.r2 - r.r1 + 1;
    const cols = r.c2 - r.c1 + 1;
    switch (id) {
      case "insert-row-above":
        if (r.r1 === 0) return false;
        this.apply(insertRows(tb, r.r1, rows), { r: r.r1, c: p.c });
        return true;
      case "insert-row-below":
        this.apply(insertRows(tb, r.r2 + 1, rows), { r: r.r2 + 1, c: p.c });
        return true;
      case "insert-col-left":
        this.apply(insertCols(tb, r.c1, cols), { r: p.r, c: r.c1 });
        return true;
      case "insert-col-right":
        this.apply(insertCols(tb, r.c2 + 1, cols), { r: p.r, c: r.c2 + 1 });
        return true;
      case "duplicate-row":
        if (p.r === 0) return false;
        this.apply(duplicateRow(tb, p.r), { r: p.r + 1, c: p.c });
        return true;
      case "duplicate-col":
        this.apply(duplicateCol(tb, p.c), { r: p.r, c: p.c + 1 });
        return true;
      case "delete-row": {
        // 只选着表头那一行：删掉它、下一行变成表头（#17）；选了好几行时表头还是删不了
        if (rows === 1 && r.r1 === 0) {
          const n = deleteRow(tb, 0);
          if (n === tb) return false;
          this.apply(n, { r: 0, c: p.c });
          return true;
        }
        if (r.r1 === 0 || rowCount(tb) - rows < 2) return false;
        if (deleteRow(tb, r.r2) === tb) return false;
        let n = tb;
        for (let i = r.r2; i >= r.r1; i--) n = deleteRow(n, i);
        this.apply(n, { r: Math.min(r.r1, rowCount(n) - 1), c: p.c });
        return true;
      }
      case "delete-col": {
        if (colCount(tb) - cols < 1) return false;
        let n = tb;
        for (let i = r.c2; i >= r.c1; i--) n = deleteCol(n, i);
        this.apply(n, { r: p.r, c: Math.min(r.c1, colCount(n) - 1) });
        return true;
      }
      case "sort-asc":
      case "sort-desc":
        if (!canSortRows(tb)) return false;
        this.apply(sortRows(tb, p.c, id === "sort-desc", this.hasTotalRow(), this.dateParser()), p);
        return true;
      case "merge-cells":
        if (!this.isMulti()) return false;
        this.apply(mergeCells(tb, r), { r: r.r1, c: r.c1 });
        return true;
      case "unmerge-cells":
        if (!mergeAt(tb, p.r, p.c)) return false;
        this.apply(unmergeAt(tb, p.r, p.c), p);
        return true;
      case "clear-cells":
        this.applyKeepRange(clearCells(tb, this.rangeCells()));
        return true;
      case "align-left":
      case "align-center":
      case "align-right": {
        const a = id.slice(6) as Align;
        let n = tb;
        for (let c = r.c1; c <= r.c2; c++) n = setAlign(n, c, a);
        this.applyKeepRange(n);
        return true;
      }
      case "select-row":
        this.anchor = { r: p.r, c: 0 };
        this.sel = { r: p.r, c: colCount(tb) - 1 };
        this.lineSel = true;
        this.markSel();
        return true;
      case "select-col":
        this.anchor = { r: 0, c: p.c };
        this.sel = { r: rowCount(tb) - 1, c: p.c };
        this.lineSel = true;
        this.markSel();
        return true;
      case "toggle-checkbox": {
        const v = tb.cells[p.r][p.c];
        this.apply(setCell(tb, p.r, p.c, CHECK_RE.test(v) ? v.replace(CHECK_RE, "").trimStart() : `[ ] ${v}`.trimEnd()), p);
        return true;
      }
    }
    return false;
  }

  /**
   * 搜索跳到表格里（在文件中查找、全局搜索点进来）：第 r 行第 c 列格子里第 k 处 text 标出来、滚进视野（#15）。
   * 和 Obsidian 标当前这一处一样，在那几个字外面画一圈强调色的框（盖在格子底色、==高亮== 上面，不会被它们盖住）；
   * 不改格子的内容。找不到这段字（格式把字拆开了）就给整格画框
   */
  showMatch(r: number, c: number, text: string, k: number): void {
    this.revealRow(r);
    const el = this.grid[r]?.[c];
    if (!el) return;
    clearSearchMark();
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const content = el.querySelector(".ggt-content");
    const range = content && text ? findTextRange(content, text, k) : null;
    // 点一下页面（点格子不经过编辑器，编辑器看不到选区变化）就去掉
    this.root.ownerDocument.addEventListener("pointerdown", clearSearchMark, { once: true, capture: true });
    const rects = range ? Array.from(range.getClientRects()).filter((b) => b.width > 0 && b.height > 0) : [];
    if (rects.length) {
      // 屏幕上量的位置换成格子里的 CSS 像素（脑图画布会整体缩放）
      const k2 = this.scale();
      const box = el.getBoundingClientRect();
      const layer = el.createDiv({ cls: "ggt-search-mark" });
      for (const b of rects) {
        layer.createDiv().setCssProps({
          left: `${(b.left - box.left) / k2 - el.clientLeft}px`,
          top: `${(b.top - box.top) / k2 - el.clientTop}px`,
          width: `${b.width / k2}px`,
          height: `${b.height / k2}px`,
        });
      }
      searchMarkLayer = layer;
      return;
    }
    el.classList.add("is-search-hit");
    searchMarkCell = el;
  }

  destroy(): void {
    this.hideFormatBar();
    this.hideMobileBar();
    if (lastActive === this) lastActive = null;
    this.destroyed = true;
    this.hbar?.remove();
    this.hbar = null;
    this.closePopover();
    this.closeSuggest();
    for (const f of this.cleanups) f();
    this.root.remove();
  }

  // ---------- 表头吸顶、横向滚动阴影 ----------

  /** 往上找会滚动的容器（编辑器、阅读视图），表头在表格滚出它顶端时贴着顶端 */
  private watchScroll(): void {
    const win = this.root.ownerDocument.defaultView ?? window;
    const update = () => {
      if (this.destroyed) return;
      if (!this.outer) this.findOuter?.();
      const sc = this.scroller;
      this.root.classList.toggle("can-left", sc.scrollLeft > 1);
      this.root.classList.toggle("can-right", sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1);
      // 横向滚动条占地方时（Windows、或者 macOS 设成「始终显示滚动条」），底下的「加一行」按钮挪到滚动条下面，
      // 不然按钮正好盖在滚动条上，滚动条拖不动也点不到
      const bar = Math.max(0, sc.offsetHeight - sc.clientHeight);
      if (bar !== this.scrollbarH) {
        this.scrollbarH = bar;
        this.root.style.setProperty("--ggt-sb", `${bar}px`);
      }
      this.stickHeader();
      this.placeHBar();
      // 左上角按钮跟着滚动换位置（贴在看得见的边上，滚出去的藏起来）
      this.placeHandles();
      if (this.resizeBar.classList.contains("is-touch")) this.placeTouchResize();
      // 冻结标题列时，十字高亮竖的色带不能伸进冻结列底下：横向滚动后重新摆
      if (this.root.classList.contains("is-freeze") && this.crossBands.some((b) => b.classList.contains("is-shown"))) this.markCross();
    };
    const onScroll = () => win.requestAnimationFrame(update);
    // 滚动时手柄先藏起来：鼠标没动、底下的格子在动，悬停的那格已经不对了；列手柄也跟不上吸顶的表头（#2）
    const onScrollEv = () => {
      this.hideHandlesForScroll();
      onScroll();
    };
    this.on(this.scroller, "scroll", onScrollEv, { passive: true });
    // 外面的滚动容器要等挂到文档上才找得到。阅读视图会先把表格画好、过一会儿才挂到页面上：
    // 下一帧还没挂上就先不找，等挂上以后（ResizeObserver 报尺寸变化 → update）再找
    const findOuter = (): boolean => {
      if (this.outer) return true;
      if (!this.root.isConnected) return false;
      // 找上下滚的那层：overflow-y 是 auto/scroll、而且真能上下滚的最近一层；都滚不动（笔记很短）就用最近的一层。
      // 只横向滚的包装跳过——阅读视图里 Obsidian 的 .el-table 是 overflow-x: auto，算出来 overflow-y 也是 auto，以前表头吸顶在阅读视图里因此没生效
      let first: HTMLElement | null = null;
      let found: HTMLElement | null = null;
      for (let el = this.root.parentElement; el; el = el.parentElement) {
        const oy = win.getComputedStyle(el).overflowY;
        if ((oy !== "auto" && oy !== "scroll") || el.classList.contains("el-table")) continue;
        first ??= el;
        if (el.scrollHeight > el.clientHeight + 1) {
          found = el;
          break;
        }
      }
      const el = found ?? first;
      if (!el) return false;
      this.outer = el;
      // 浏览器支持滚动驱动动画时，表头位置交给浏览器按滚动位置算（和滚动同一帧画，不会慢一拍抖动，#2）。
      // 时间线名挂在这个滚动容器上；同一容器里的几张表共用
      if (win.CSS?.supports?.("animation-timeline: scroll()")) {
        el.classList.add("ggt-y-host");
        this.scrollDriven = true;
      }
      el.addEventListener("scroll", onScrollEv, { passive: true });
      this.cleanups.push(() => el.removeEventListener("scroll", onScrollEv));
      return true;
    };
    this.findOuter = findOuter;
    win.requestAnimationFrame(() => {
      findOuter();
      update();
    });
    // 正文变宽变窄（开关侧栏、拖窗口）：按比例缩放的列宽跟着重算。表格缩到正文宽以后自己不会跟着变宽，所以看外面那层
    let parentW = -1;
    const onParent = () => {
      const p = this.root.parentElement;
      const w = p ? p.clientWidth : 0;
      if (w === parentW) return;
      parentW = w;
      if (!this.resize) this.fitCols();
      onScroll();
    };
    const ro = new win.ResizeObserver(onScroll);
    ro.observe(this.scroller);
    const pro = new win.ResizeObserver(() => win.requestAnimationFrame(onParent));
    if (this.root.parentElement) pro.observe(this.root.parentElement);
    this.cleanups.push(() => pro.disconnect());
    this.cleanups.push(() => ro.disconnect());
  }

  /**
   * 又长又宽的表格：横向滚动条在表格最底下，得先翻到底才拖得到（B 站 bili_70604431418）。
   * 表格比页面宽、底边在可视区下面、上面还有一截露在可视区里时，在可视区底边浮出一条横向滚动条，和表格一起左右滚；
   * 表格的底边滚进来了就收起，用表格自己那条。被缩放的脑图画布里、触屏上不出（触屏直接左右划）
   */
  private placeHBar(): void {
    const sc = this.scroller;
    const outer = this.outer;
    const win = this.root.ownerDocument.defaultView ?? window;
    const hide = () => this.hbar?.classList.remove("is-shown");
    if (!outer || !this.root.isConnected || sc.scrollWidth <= sc.clientWidth + 1 || Math.abs(this.scale() - 1) > 0.01 || win.matchMedia?.("(pointer: coarse)").matches) return hide();
    const o = outer.getBoundingClientRect();
    const r = sc.getBoundingClientRect();
    const bottom = Math.min(o.bottom, win.innerHeight);
    // 表格自己的滚动条已经看得见了，或者表格整个不在可视区里
    if (r.width === 0 || r.bottom <= bottom || r.top > bottom - 60) return hide();
    const left = Math.max(r.left, o.left);
    const right = Math.min(r.right, o.right);
    if (right - left < 40) return hide();
    let bar = this.hbar;
    if (!bar) {
      const doc = this.root.ownerDocument;
      bar = doc.body.appendChild(doc.createElement("div"));
      bar.className = "ggt-hbar";
      bar.appendChild(doc.createElement("div")).className = "ggt-hbar-inner";
      bar.addEventListener(
        "scroll",
        () => {
          // 这次是 placeHBar 自己设的位置（跟着表格走），不用反过来再设表格
          if (this.hbarSync) {
            this.hbarSync = false;
            return;
          }
          const b = bar!;
          sc.scrollLeft = (b.scrollLeft / Math.max(1, b.scrollWidth - b.clientWidth)) * (sc.scrollWidth - sc.clientWidth);
        },
        { passive: true },
      );
      this.hbar = bar;
    }
    const inner = bar.firstElementChild as HTMLElement;
    // 条的宽度对着表格露出来的那段，里面撑开的宽度按比例算，拖到头正好是表格滚到头
    const w = right - left;
    inner.style.width = `${Math.round((sc.scrollWidth / sc.clientWidth) * w)}px`;
    bar.classList.add("is-shown");
    bar.style.left = `${Math.round(left)}px`;
    bar.style.width = `${Math.round(w)}px`;
    bar.style.top = `${Math.round(bottom - bar.offsetHeight)}px`;
    const target = (sc.scrollLeft / Math.max(1, sc.scrollWidth - sc.clientWidth)) * Math.max(0, bar.scrollWidth - bar.clientWidth);
    if (Math.abs(bar.scrollLeft - target) > 1) {
      this.hbarSync = true;
      bar.scrollLeft = target;
    }
  }

  private outer: HTMLElement | null = null;
  /** 找外面的滚动区（watchScroll 里定义；挂到页面上以前找不到，之后再试） */
  private findOuter: (() => boolean) | null = null;
  /** 表头吸顶用滚动驱动动画（否则每次滚动后用 JS 挪，旧环境、被缩放的脑图画布里走这条） */
  private scrollDriven = false;
  private stickKey = "";

  /**
   * 编辑器被整体缩放了多少（脑图画布用 transform: scale 缩放，getBoundingClientRect 量到的是屏幕像素）。
   * 屏幕上量出来的距离要除以它，才是写进 style 的 CSS 像素
   */
  private scale(): number {
    const w = this.root.offsetWidth;
    if (!w) return 1;
    const k = this.root.getBoundingClientRect().width / w;
    return k > 0 && Number.isFinite(k) ? k : 1;
  }

  private stickHeader(): void {
    const head = this.tableEl.tHead;
    if (!head) return;
    const outer = this.outer;
    let offset = 0;
    if (outer) {
      const top = outer.getBoundingClientRect().top;
      const t = this.tableEl.getBoundingClientRect();
      const h = head.getBoundingClientRect().height;
      // 表格顶端滚出去了、底部还在：表头往下挪，贴着容器顶端；表格快滚完时跟着走
      if (t.top < top && t.bottom - h > top) offset = Math.min(top - t.top, t.height - h * 2);
    }
    const stuck = offset > 0;
    this.root.classList.toggle("is-stuck", stuck);
    // 不用横向滚动的表格：表头直接用浏览器原生的吸顶（position: sticky），由浏览器在滚动线程上处理，
    // 编辑器在滚动中增删内容也不会让它慢一帧（滚动驱动动画在快速滑动、编辑器边滚边重画时会落后一帧，#2）
    const native = !!outer && Math.abs(this.scale() - 1) < 0.01 && this.canStickNatively(outer);
    this.root.classList.toggle("is-native-stick", native);
    if (native && outer) {
      this.root.classList.remove("is-sd");
      const pad = parseFloat((outer.ownerDocument.defaultView ?? window).getComputedStyle(outer).paddingTop) || 0;
      // 原生吸顶贴的是滚动区内边距的下沿：往上挪回去，贴着滚动区顶端
      this.root.style.setProperty("--ggt-sticky-top", `${-pad}px`);
      this.moveHead(head, 0);
      return;
    }
    if (outer && this.scrollDriven && Math.abs(this.scale() - 1) < 0.01) {
      this.stickRange(outer, head);
      this.moveHead(head, 0);
      return;
    }
    this.root.classList.remove("is-sd");
    this.moveHead(head, stuck ? Math.round(offset / this.scale()) : 0);
  }

  /**
   * 表头往下挪 y 像素（0 是不挪）。挪每个格子，不挪整个 thead：iOS（WebKit）给 thead 加 transform 时
   * 文字跟着挪、格子底色留在原地，表头变透明压在正文上（#15）
   */
  private headShift = 0;
  private moveHead(head: HTMLTableSectionElement, y: number): void {
    if (y === this.headShift && !head.hasAttribute("style")) return;
    this.headShift = y;
    head.removeAttribute("style");
    for (const cell of Array.from(head.querySelectorAll<HTMLElement>(".ggt-cell"))) {
      if (y) cell.setCssProps({ transform: `translateY(${y}px)` });
      else cell.style.removeProperty("transform");
    }
  }

  /**
   * 能不能用原生吸顶：表格不用横向滚动，而且表格到外面滚动区之间没有别的会滚动、会裁切的容器
   * （阅读视图里 Obsidian 给表格套的 .el-table 是 overflow-x: auto，原生吸顶会贴到它上面去）
   */
  private canStickNatively(outer: HTMLElement): boolean {
    const sc = this.scroller;
    // 原生吸顶时 .ggt-scroll 是 overflow: visible，宽度照样能比出来有没有超出
    if (sc.scrollWidth > sc.clientWidth + 1) return false;
    const win = this.root.ownerDocument.defaultView ?? window;
    for (let el = this.root.parentElement; el && el !== outer; el = el.parentElement) {
      const cs = win.getComputedStyle(el);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return false;
    }
    return true;
  }

  /**
   * 滚动驱动的吸顶：外面容器滚到「表格顶端碰到容器顶端」(a) 时表头开始跟着往下挪，挪到「表格只剩两行表头高」为止。
   * a 和长度不随滚动变，只在布局变了时更新；滚动过程中表头位置全由浏览器算
   */
  private stickRange(outer: HTMLElement, head: HTMLTableSectionElement): void {
    const t = this.tableEl.getBoundingClientRect();
    const len = Math.round(t.height - head.offsetHeight * 2);
    if (len <= 0) {
      this.root.classList.remove("is-sd");
      return;
    }
    const a = Math.round(outer.scrollTop + t.top - outer.getBoundingClientRect().top - outer.clientTop);
    const dpr = (this.root.ownerDocument.defaultView ?? window).devicePixelRatio || 1;
    const key = `${a}|${len}|${dpr}`;
    if (key !== this.stickKey) {
      this.stickKey = key;
      // 表头一个物理像素一格地挪，起点提前半格：触控板滚动的距离带小数，浏览器滚正文时按四舍五入对齐到物理像素，
      // 表头连续挪（或分步时向下取整）就会和正文差一个像素、来回跳（看起来在抖，#2）。分步 + 提前半格 = 也是四舍五入
      const half = 0.5 / dpr;
      this.root.style.setProperty("--ggt-stick-a", `${a - half}px`);
      this.root.style.setProperty("--ggt-stick-b", `${a + len - half}px`);
      this.root.style.setProperty("--ggt-stick-len", `${len}px`);
      this.root.style.setProperty("--ggt-stick-steps", String(Math.max(1, Math.round(len * dpr))));
    }
    this.root.classList.add("is-sd");
  }

  /** 样式、行距：这张表自己定了就用它的，否则用宿主给的默认（data-def-*） */
  private applyLook(): void {
    const d = this.root.dataset;
    d.preset = this.table.meta.style ?? d.defPreset ?? "default";
    d.density = this.table.meta.density ?? d.defDensity ?? "comfortable";
    // 设置「表格默认撑满页面宽度」：只管没拖过列宽的表（拖过的按设的宽度）
    this.root.classList.toggle("is-full", d.defFull === "1" && !this.table.meta.w?.some((x) => x != null));
    // 设置「表格样式优先于主题」（#12）
    this.root.classList.toggle("is-strict", d.defStrict === "1");
    // 整表文字大小（格子自己的再乘上去）
    if (this.table.meta.fs) this.root.setCssProps({ "--ggt-fs": String(this.table.meta.fs) });
    else this.root.style.removeProperty("--ggt-fs");
  }

  // ---------- 渲染 ----------

  private render(): void {
    const doc = this.root.ownerDocument;
    const hadFocus = this.input.hasFocus();
    const tb = this.table;
    const all = rowCount(tb);
    const folded = this.folded();
    // 折着时只画表头那几行，下面一条「展开 N 行」；选区不进藏着的行
    const rows = this.shownRows();
    const cols = colCount(tb);
    if (this.sel) this.sel = this.canon({ r: Math.min(this.sel.r, rows - 1), c: Math.min(this.sel.c, cols - 1) });
    if (this.anchor) this.anchor = { r: Math.min(this.anchor.r, rows - 1), c: Math.min(this.anchor.c, cols - 1) };
    this.root.classList.toggle("is-folded", folded);
    const ms = merges(tb);
    this.applyLook();
    this.tableEl.replaceChildren();
    this.grid = Array.from({ length: all }, () => new Array<HTMLElement>(cols));
    this.marked = [];
    this.crossed = [];
    const colgroup = this.tableEl.appendChild(doc.createElement("colgroup"));
    // 拖过列宽的：再记一份按比例的宽度（没拖过的列按拖过的平均宽度算）。Export Image 这类插件把画好的表格复制一份去截图，
    // 复制件上没有脚本，「列宽按比例缩放」不起作用，靠样式里用这份比例缩到图片宽（#7）
    const ws = Array.from({ length: cols }, (_, c) => widthOf(tb, c) ?? 0);
    const set = ws.filter((w) => w > 0);
    const avg = set.length ? set.reduce((a, b) => a + b, 0) / set.length : 0;
    const total = ws.reduce((a, w) => a + (w || avg), 0);
    if (set.length) this.tableEl.setCssProps({ "--ggt-total": `${Math.ceil(total)}px` });
    else this.tableEl.style.removeProperty("--ggt-total");
    for (let c = 0; c < cols; c++) {
      const col = colgroup.appendChild(doc.createElement("col"));
      const w = ws[c];
      if (w) col.style.width = `${w}px`;
      if (set.length) col.setCssProps({ "--ggt-pct": `${(((w || avg) / total) * 100).toFixed(3)}%` });
    }
    const thead = this.tableEl.appendChild(doc.createElement("thead"));
    // 表头格子是新建的，还没挪过（render 最后的 stickHeader 会按现在的滚动位置再挪）
    this.headShift = 0;
    const tbody = this.tableEl.appendChild(doc.createElement("tbody"));
    // 表头可以有几行（注释里的 head）：都放进 thead，一起吸顶
    const head = headRows(tb);
    const freeze = !!tb.meta.headerCol && tb.meta.freeze === 1;
    this.root.classList.toggle("is-freeze", freeze);
    for (let r = 0; r < rows; r++) {
      const tr = (r < head ? thead : tbody).appendChild(doc.createElement("tr"));
      for (let c = 0; c < cols; c++) {
        // 合并的格子：左上角那格跨行跨列，其余不画
        const m = ms.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
        if (m && (m.r1 !== r || m.c1 !== c)) continue;
        const cell = tr.appendChild(doc.createElement(r < head ? "th" : "td"));
        cell.className = "ggt-cell";
        if (m) {
          cell.colSpan = m.c2 - m.c1 + 1;
          cell.rowSpan = Math.min(m.r2, rows - 1) - m.r1 + 1;
          cell.classList.add("is-merged");
          for (let i = m.r1; i <= m.r2; i++) for (let j = m.c1; j <= m.c2; j++) this.grid[i][j] = cell;
        } else this.grid[r][c] = cell;
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        const a = tb.align[c];
        if (a) cell.dataset.align = a;
        const va = vAlignOf(tb, c);
        if (va) cell.dataset.valign = va;
        const bg = bgOf(tb, r, c);
        if (bg) cell.dataset.bg = bg;
        const fg = fgOf(tb, r, c);
        if (fg) cell.dataset.fg = fg;
        const fz = fontSizeOf(tb, r, c);
        if (fz) cell.setCssProps({ "--ggt-fz": String(fz) });
        if (tb.meta.headerCol && c === 0 && r >= head) cell.classList.add("is-head-col");
        // 冻结标题列：第一列（横跨到第二列的合并格不冻，不然盖住第二列）左右滚动时固定在左边
        if (freeze && c === 0 && (!m || m.c2 === 0)) cell.classList.add("is-frozen");
        // 没拖过宽度的列：宿主可以给它设个最宽（脑图节点里最宽 240，超出换行）
        if (!m && !widthOf(tb, c)) cell.classList.add("is-auto-width");
        // 拖过宽度的列：按拖到的宽度画，可以比没拖过的列（最少 80px）更窄（B站反馈：序号、勾选这类窄列占地方）
        else if (!m) cell.classList.add("is-set-width");
        const content = cell.appendChild(doc.createElement("div"));
        content.className = "ggt-content";
        if (r === all - 1 && r >= head && hasTotal(tb)) cell.classList.add("is-total-row");
        // 列类型：数字列等宽数字、日期列不折行（样式表按它画）
        const ty = colTypeOf(tb, c);
        if (ty && r >= head) cell.dataset.ty = ty.t;
        this.fillCell(content, r, c, m ? mergedText(tb, m) : tb.cells[r][c]);
        if (formulaOf(tb, c)) this.markFx(cell, r, c);
        if (cell.classList.contains("is-total-row")) this.markCalc(cell, content, c);
      }
    }
    if (folded) {
      const bar = tbody.createEl("tr").createEl("td");
      bar.className = "ggt-fold-bar";
      bar.colSpan = cols;
      const btn = bar.createEl("button");
      btn.type = "button";
      btn.className = "ggt-fold-btn";
      btn.textContent = t("unfoldRows").replace("{n}", String(all - head));
      // 不走格子的按下（选中、拖选）
      btn.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      });
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.unfold();
      });
    }
    this.fitCols();
    this.markSel();
    if (hadFocus && this.sel) this.input.focus();
    this.stickHeader();
    // 列宽变了，线的位置就不对了：先收起来，鼠标再动时按新的边线放
    if (!this.resize) this.resizeBar.classList.remove("is-shown", "is-active");
    this.placeTouchResize();
  }

  /** 状态列的数据格画成彩色标签，别的照常 */
  private fillCell(el: HTMLElement, r: number, c: number, md: string): void {
    const opts = this.table.meta.opts?.[c];
    const ty = colTypeOf(this.table, c);
    const isData = r >= headRows(this.table) && !(hasTotal(this.table) && r === rowCount(this.table) - 1);
    if ((ty?.t === "enc" && isData) || hasSecret(md)) return this.fillSecret(el, md);
    if (el.title === t("encPlain") || el.title === t("encForeign")) el.removeAttribute("title");
    el.classList.remove("is-unsealed");
    // 多选：每个标签一个彩色标签
    if (opts && ty?.t === "multi" && isData && md.trim()) {
      el.replaceChildren();
      el.classList.remove("is-empty");
      const wrap = el.appendChild(el.ownerDocument.createElement("span"));
      wrap.className = "ggt-pills";
      for (const v of splitTags(md)) {
        const pill = wrap.appendChild(el.ownerDocument.createElement("span"));
        pill.className = "ggt-pill";
        pill.dataset.c = opts[v] ?? "gray";
        pill.textContent = v;
      }
      return;
    }
    // 进度条：读得出进度的画成一条，后面写原文；读不出的照常显示
    const prog = ty?.t === "bar" && isData ? readProgress(md) : null;
    if (prog !== null) {
      el.replaceChildren();
      el.classList.remove("is-empty");
      const bar = el.appendChild(el.ownerDocument.createElement("span"));
      bar.className = "ggt-bar";
      if (prog >= 1) bar.dataset.done = "1";
      const track = bar.appendChild(el.ownerDocument.createElement("span"));
      track.className = "ggt-bar-track";
      const fill = track.appendChild(el.ownerDocument.createElement("span"));
      fill.className = "ggt-bar-fill";
      fill.setCssProps({ "--ggt-p": `${Math.round(Math.max(0, Math.min(1, prog)) * 1000) / 10}%` });
      const label = bar.appendChild(el.ownerDocument.createElement("span"));
      label.className = "ggt-bar-text";
      label.textContent = md.trim();
      return;
    }
    if (opts && isData && md.trim()) {
      el.replaceChildren();
      el.classList.remove("is-empty");
      const pill = el.appendChild(el.ownerDocument.createElement("span"));
      pill.className = "ggt-pill";
      pill.dataset.c = opts[md.trim()] ?? "gray";
      pill.textContent = md.trim();
      return;
    }
    this.fill(el, md);
    // 日期列里读不出日子的（待定、2 月 30 日）：画一条波浪线，悬停说明。只是显示，不改文件
    const daily = ty?.t === "date" && isData && md.trim() ? this.dailyNote() : null;
    const notDate = ty?.t === "date" && isData && !!md.trim() && !readDate(md, daily ? (n) => daily.parse(n) : undefined);
    el.classList.toggle("is-not-date", notDate);
    if (notDate) el.title = t("notDate");
    else if (el.title === t("notDate")) el.removeAttribute("title");
  }

  private fill(el: HTMLElement, md: string): void {
    el.replaceChildren();
    el.removeAttribute("dir");
    if (!md.trim()) {
      el.classList.add("is-empty");
      return;
    }
    el.classList.remove("is-empty");
    el.classList.toggle("is-plain", !this.host.renderMarkdown);
    // [ ] / [x] 开头：画成能点的勾选框，后面的文字照常渲染
    const check = CHECK_RE.exec(md);
    if (check) {
      const box = el.appendChild(el.ownerDocument.createElement("input"));
      box.type = "checkbox";
      box.className = "ggt-check task-list-item-checkbox";
      box.checked = check[1] !== " ";
      box.tabIndex = -1;
      const rest = md.slice(3).trim();
      if (!rest) return;
      const span = el.appendChild(el.ownerDocument.createElement("span"));
      span.className = "ggt-check-text";
      if (this.host.renderMarkdown) this.host.renderMarkdown(span, keepBlankLines(rest));
      else span.textContent = rest;
      return;
    }
    // 纯文字、数字直接放进去：渲染出来和走 Markdown 一样，大表格里能省掉几万次渲染
    if (this.host.renderMarkdown && !isPlainText(md)) this.host.renderMarkdown(el, keepBlankLines(md));
    else {
      el.textContent = md;
      // 渲染出来的段落带 dir="auto"（阿拉伯文、希伯来文靠右），直接放的文字也一样
      if (this.host.renderMarkdown) el.dir = "auto";
    }
  }

  // ---------- 加密列 ----------

  /** 这一格要按加密处理：加密列的数据格（表头、合计行不算），或者单独加密过的格子 */
  private isSecretCell(p: Pos): boolean {
    const tb = this.table;
    if (hasSecret(tb.cells[p.r]?.[p.c] ?? "")) return true;
    return colTypeOf(tb, p.c)?.t === "enc" && p.r >= headRows(tb) && !(hasTotal(tb) && p.r === rowCount(tb) - 1);
  }

  /** 显示过明文的格子（按密文记，锁上时清掉） */
  private readonly revealed = new Set<string>();
  private decrypting = false;

  /**
   * 加密格子：锁着画 ••••••（旁边一把锁，点了解锁）；解锁后还是 ••••••，旁边的眼睛显示明文、复制按钮复制明文。
   * 还没加密的明文照常显示，标出来
   */
  private fillSecret(el: HTMLElement, md: string): void {
    const doc = el.ownerDocument;
    el.replaceChildren();
    el.classList.remove("is-empty", "is-not-date", "is-unsealed");
    el.removeAttribute("title");
    if (!md.trim()) {
      el.classList.add("is-empty");
      return;
    }
    if (!isSealed(md)) {
      this.fill(el, md);
      el.classList.add("is-unsealed");
      el.title = t("encPlain");
      return;
    }
    const box = this.host.secrets?.() ?? null;
    const plain = box?.peek(md);
    if (box?.unlocked && plain === undefined) this.decryptSoon();
    const wrap = el.appendChild(doc.createElement("span"));
    wrap.className = "ggt-secret";
    const shown = typeof plain === "string" && this.revealed.has(md);
    if (shown) {
      const text = wrap.appendChild(doc.createElement("span"));
      text.className = "ggt-secret-text";
      this.fill(text, plain);
    } else {
      const mask = wrap.appendChild(doc.createElement("span"));
      mask.className = "ggt-secret-mask";
      mask.textContent = "••••••";
      if (plain === null) {
        wrap.classList.add("is-foreign");
        el.title = t("encForeign");
      }
    }
    const btn = (act: string, icon: string, label: string) => {
      const b = wrap.appendChild(doc.createElement("button"));
      b.type = "button";
      b.tabIndex = -1;
      b.className = "ggt-secret-btn clickable-icon";
      b.dataset.act = act;
      b.setAttribute("aria-label", label);
      if (this.host.setIcon) this.host.setIcon(b, icon);
      else b.textContent = act === "unlock" ? "🔒" : act === "copy" ? "⧉" : "👁";
    };
    if (!box) return;
    if (!box.unlocked) btn("unlock", "lock", t("encUnlock"));
    else if (typeof plain === "string") {
      btn("toggle", shown ? "eye-off" : "eye", t(shown ? "encHide" : "encShow"));
      btn("copy", "copy", t("encCopy"));
    }
  }

  /** 表里加密的格子的原文（加密列的、单独加密的） */
  private secretCells(): string[] {
    return sealedCellsOf(this.table);
  }

  /** 解锁着、还有没解开的格子：解开后重画加密列 */
  private decryptSoon(): void {
    const box = this.host.secrets?.();
    if (this.decrypting || !box?.unlocked) return;
    this.decrypting = true;
    void box.openAll(this.secretCells()).then((fresh) => {
      this.decrypting = false;
      if (fresh && !this.destroyed) this.refillSecrets();
    });
  }

  /** 加密列和单独加密的格子重新画一遍（正在编辑的那格不动） */
  private refillSecrets(): void {
    const done = new Set<HTMLElement>();
    const tb = this.table;
    const todo: Pos[] = secretCellsOf(tb).map(([r, c]) => ({ r, c }));
    tb.cells.forEach((row, r) => row.forEach((v, c) => hasSecret(v) && todo.push({ r, c })));
    for (const { r, c } of todo) {
      if (this.editing && this.sel && this.sel.r === r && this.sel.c === c) continue;
      const cell = this.cellEl({ r, c });
      const content = cell?.querySelector<HTMLElement>(".ggt-content");
      if (!cell || !content || done.has(cell)) continue;
      done.add(cell);
      const m = mergeAt(this.table, r, c);
      this.fillCell(content, r, c, m ? mergedText(this.table, m) : this.table.cells[r][c]);
    }
    this.refreshCross();
  }

  /** 主密码锁上、解锁了（refreshSecretCells 调） */
  refreshSecrets(): void {
    if (!this.table.meta.ty?.some((x) => x?.t === "enc") && !sealedCellsOf(this.table).length) return;
    if (!this.host.secrets?.()?.unlocked) this.revealed.clear();
    this.refillSecrets();
  }

  private async secretButton(act: string, p: Pos): Promise<void> {
    const box = this.host.secrets?.();
    if (!box) return;
    const raw = this.table.cells[p.r]?.[p.c] ?? "";
    if (act === "unlock") {
      if (await box.unlock(this.secretCells())) await box.openAll(this.secretCells());
      this.refillSecrets();
      return;
    }
    const plain = box.peek(raw);
    if (typeof plain !== "string") return;
    box.touch();
    if (act === "toggle") {
      if (this.revealed.has(raw)) this.revealed.delete(raw);
      else this.revealed.add(raw);
      this.refillSecrets();
    } else if (act === "copy") this.copySecret(plain);
  }

  /** 复制明文，30 秒后从剪贴板清掉 */
  private copySecret(plain: string): void {
    const win = this.root.ownerDocument.defaultView ?? window;
    void win.navigator.clipboard.writeText(plain).then(() => {
      this.host.notice?.(t("encCopied"));
      clearClipboardLater(win, plain);
    });
  }

  /** 锁着（或还没解开）时要编辑加密格子：先解锁、解开，再进编辑（打进来的第一个字留着） */
  private async secretEditLater(p: Pos, keep: boolean, typedText: string): Promise<void> {
    const box = this.host.secrets?.();
    if (!box || !(await box.unlock(this.secretCells()))) return;
    await box.openAll(this.secretCells());
    this.refillSecrets();
    if (this.destroyed || this.editing || !this.sel || this.sel.r !== p.r || this.sel.c !== p.c) return;
    this.input.focus();
    if (typedText) {
      this.input.reset(typedText);
      const end = typedText.length;
      this.input.setSelectionRange(end, end);
      this.startEdit(false);
    } else if (keep) this.startEdit(true);
  }

  /**
   * 加密格子提交：空的照常写（plain）；明文没变不写（same）；变了加密后再写（async，加密好了自己写回）。
   * 加密的时候表格被别处改了这一格，就不写（提示重新输入）
   */
  private secretCommit(p: Pos, text: string): "plain" | "same" | "async" {
    const raw = this.table.cells[p.r][p.c];
    if (!text) return "plain";
    const before = isSealed(raw) ? this.host.secrets?.()?.peek(raw) : raw;
    if (before === text) return isSealed(raw) ? "same" : "plain";
    const box = this.host.secrets?.();
    if (!box) {
      this.host.notice?.(t("encNoHost"));
      return "same";
    }
    void (async () => {
      if (!box.unlocked && !(await box.unlock(this.secretCells()))) {
        this.host.notice?.(t("encNotSaved"));
        return;
      }
      const sealed = await box.seal(text);
      if (this.destroyed) return;
      const cur = this.table;
      // 等的时候这一格被别处改了（撤销、外部改文件）：不覆盖
      if (cur.cells[p.r]?.[p.c] !== raw) {
        this.host.notice?.(t("encChanged"));
        return;
      }
      if (this.revealed.has(raw)) this.revealed.add(sealed);
      const next = normalize(editCell(cur, p.r, p.c, sealed));
      this.table = next;
      if (!(this.editing && this.sel?.r === p.r && this.sel?.c === p.c)) this.restoreContent(p);
      this.host.onChange(next, cur);
    })();
    return "async";
  }

  /** 改动带着加密列里的新明文：解锁、加密好再写回（base 是改之前的表，等的时候表又变了就不写） */
  private async sealThenApply(base: Table, next: Table, sel?: Pos): Promise<void> {
    const box = this.host.secrets?.();
    if (!box) {
      this.host.notice?.(t("encNoHost"));
      return;
    }
    if (!(await box.unlock([...this.secretCells(), ...secretCellsOf(next).map((x) => x[2])]))) {
      this.host.notice?.(t("encNotSaved"));
      return;
    }
    const sealed = await sealTable(next, box);
    if (this.destroyed) return;
    if (this.table !== base) {
      this.host.notice?.(t("encChanged"));
      return;
    }
    this.applyNow(sealed, sel);
  }

  /** 普通列改成加密列：已有的内容全部加密 */
  private async toSecretCol(c: number, p: Pos): Promise<void> {
    const box = this.host.secrets?.();
    if (!box) return;
    if (this.editing) this.commit();
    const base = this.table;
    if (!(await box.unlock(secretCellsOf(setColKind(base, c, "enc")).map((x) => x[2])))) return;
    const sealed = await sealTable(setColKind(base, c, "enc"), box);
    if (this.destroyed || this.table !== base) return;
    this.applyNow(normalize(sealed), p);
  }

  /** 加密列改成别的类型：问一下，解密成明文写回 */
  private async fromSecretCol(c: number, kind: ColKind, p: Pos): Promise<void> {
    const box = this.host.secrets?.();
    if (this.editing) this.commit();
    const base = this.table;
    const cells = secretCellsOf(base).filter(([, cc, v]) => cc === c && v.trim() && isSealed(v));
    if (cells.length) {
      if (!box || !this.host.confirm || !(await this.host.confirm(t("encDecryptConfirm"), t("encDecryptOk")))) return;
      if (!(await box.unlock(cells.map((x) => x[2])))) return;
      await box.openAll(cells.map((x) => x[2]));
      if (cells.some(([, , v]) => typeof box.peek(v) !== "string")) {
        this.host.notice?.(t("encForeignAbort"));
        return;
      }
    }
    if (this.destroyed || this.table !== base) return;
    let n = base;
    for (const [r, cc, v] of cells) n = editCell(n, r, cc, box?.peek(v) ?? v);
    this.applyNow(normalize(setColKind(n, c, kind)), p);
  }

  /** 列菜单里加密列的几项：加密还没加密的格子、锁定 */
  private secretColItems(c: number): MenuItem[] {
    if (colTypeOf(this.table, c)?.t !== "enc") return [];
    const box = this.host.secrets?.();
    const items: MenuItem[] = [];
    const base = this.table;
    if (box && secretCellsOf(base).some(([, cc, v]) => cc === c && v.trim() && !isSealed(v)))
      items.push({
        title: t("encSealCol"),
        icon: "lock",
        disabled: !!this.host.readonly,
        run: () =>
          void (async () => {
            if (!(await box.unlock(this.secretCells()))) return;
            const sealed = await sealTable(base, box);
            if (!this.destroyed && this.table === base) this.applyNow(normalize(sealed), this.sel ?? undefined);
          })(),
      });
    if (box?.unlocked) items.push({ title: t("encLock"), icon: "lock-keyhole", run: () => box.lock() });
    return items;
  }

  /** 格子元素；落在合并区域里的取左上角那格 */
  private cellEl(p: Pos): HTMLElement | null {
    return this.grid[p.r]?.[p.c] ?? null;
  }

  /** 落在合并区域里的位置换成左上角 */
  private canon(p: Pos): Pos {
    const m = mergeAt(this.table, p.r, p.c);
    return m ? { r: m.r1, c: m.c1 } : p;
  }

  /** 选区矩形（碰到的合并区域整块算进来）；没选中是 null */
  private rangeRect(): Rect | null {
    if (!this.sel) return null;
    const a = this.anchor ?? this.sel;
    let r: Rect = { r1: Math.min(a.r, this.sel.r), c1: Math.min(a.c, this.sel.c), r2: Math.max(a.r, this.sel.r), c2: Math.max(a.c, this.sel.c) };
    if (this.lineSel && this.anchor) return r;
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of merges(this.table)) {
        const hit = m.r1 <= r.r2 && r.r1 <= m.r2 && m.c1 <= r.c2 && r.c1 <= m.c2;
        if (hit && (m.r1 < r.r1 || m.c1 < r.c1 || m.r2 > r.r2 || m.c2 > r.c2)) {
          r = { r1: Math.min(r.r1, m.r1), c1: Math.min(r.c1, m.c1), r2: Math.max(r.r2, m.r2), c2: Math.max(r.c2, m.c2) };
          grew = true;
        }
      }
    }
    return r;
  }

  /** 选了不止一格（一整块合并的格子算一格） */
  private isMulti(): boolean {
    const r = this.rangeRect();
    if (!r || (r.r1 === r.r2 && r.c1 === r.c2)) return false;
    const m = mergeAt(this.table, r.r1, r.c1);
    return !(m && m.r1 === r.r1 && m.c1 === r.c1 && m.r2 === r.r2 && m.c2 === r.c2);
  }

  /** 选区里的所有格子（含被合并盖住的） */
  private rangeCells(): Pos[] {
    const r = this.rangeRect();
    if (!r) return [];
    const out: Pos[] = [];
    for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) out.push({ r: i, c: j });
    return out;
  }

  /** 选区（或选中的一格）在滚动容器里的位置 */
  private selBox(): { x: number; y: number; w: number; h: number } | null {
    const r = this.rangeRect();
    if (!r) return null;
    // 按行、列的实际位置算（不按格子拼）：碰到合并格时框的形状也对
    const top = this.lineBox(r.r1, true);
    const bottom = this.lineBox(r.r2, true);
    const left = this.lineBox(r.c1, false);
    const right = this.lineBox(r.c2, false);
    if (bottom.b > top.a && right.b > left.a) {
      const base = this.scroller.getBoundingClientRect();
      const k = this.scale();
      return { x: (left.a - base.left) / k + this.scroller.scrollLeft, y: (top.a - base.top) / k + this.scroller.scrollTop, w: (right.b - left.a) / k, h: (bottom.b - top.a) / k };
    }
    let box: { l: number; t: number; r: number; b: number } | null = null;
    for (const el of Array.from(this.tableEl.querySelectorAll<HTMLElement>(".ggt-cell"))) {
      const er = Number(el.dataset.r);
      const ec = Number(el.dataset.c);
      if (er < r.r1 || er > r.r2 || ec < r.c1 || ec > r.c2) continue;
      const b = el.getBoundingClientRect();
      box = box ? { l: Math.min(box.l, b.left), t: Math.min(box.t, b.top), r: Math.max(box.r, b.right), b: Math.max(box.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
    }
    if (!box) return null;
    const base = this.scroller.getBoundingClientRect();
    const k = this.scale();
    return { x: (box.l - base.left) / k + this.scroller.scrollLeft, y: (box.t - base.top) / k + this.scroller.scrollTop, w: (box.r - box.l) / k, h: (box.b - box.t) / k };
  }

  /**
   * 填充柄放在选区右下角；没选中、在编辑、只读时不显示。
   * 手指点的时候也不显示：触屏上多选改成长按格子后拖动，右下角的小圆点难按、和调列宽的把手挤在一起（群友在路上）。
   * 鼠标、手写笔照旧有
   */
  private placeFill(): void {
    const box = !this.editing && !this.host.readonly && !this.folded() && !this.touched ? this.selBox() : null;
    this.fillHandle.classList.toggle("is-shown", !!box);
    if (box) this.fillHandle.setAttribute("style", `left:${box.x + box.w - 4}px;top:${box.y + box.h - 4}px`);
  }

  /** 十字高亮：悬停模式下鼠标所在的格子，否则（或鼠标不在表格上）选中的格子 */
  private crossAt: Pos | null = null;

  /**
   * 十字高亮（设置里开，data-cross = select / hover）：把那一格所在的整行、整列铺一层淡色，看大表不串行。
   * 合并格按它占的范围算；那一格自己不铺（它有选中框）
   */
  private markCross(): void {
    for (const el of this.crossed) el.classList.remove("is-cross");
    this.crossed = [];
    const hide = () => {
      for (const b of this.crossBands) b.classList.remove("is-shown");
    };
    const mode = this.root.dataset.cross;
    if (mode !== "select" && mode !== "hover") return hide();
    const p = (mode === "hover" ? this.crossAt : null) ?? this.sel;
    if (!p || !this.grid[p.r]?.[p.c]) return hide();
    const m = mergeAt(this.table, p.r, p.c);
    const r1 = m?.r1 ?? p.r;
    const r2 = m?.r2 ?? p.r;
    const c1 = m?.c1 ?? p.c;
    const c2 = m?.c2 ?? p.c;
    // 位置都按滚动容器里的坐标算（和选区框一样），横向滚动时跟着表格走
    const base = this.scroller.getBoundingClientRect();
    const k = this.scale();
    const tb = this.tableEl.getBoundingClientRect();
    const x = (v: number) => (v - base.left) / k + this.scroller.scrollLeft;
    const y = (v: number) => (v - base.top) / k + this.scroller.scrollTop;
    const top = y(this.lineBox(r1, true).a);
    const bottom = y(this.lineBox(r2, true).b);
    const left = x(this.lineBox(c1, false).a);
    const right = x(this.lineBox(c2, false).b);
    const tl = x(tb.left);
    const tr = x(tb.right);
    const tt = y(tb.top);
    const tbm = y(tb.bottom);
    // 冻结标题列：色带在冻结的格子底下（不盖住吸顶的表头、滚过来的格子），冻结那几格自己加样式；
    // 竖的色带不伸进冻结列底下
    const frozen = this.root.classList.contains("is-freeze");
    let colLeft = left;
    if (frozen) {
      const f = this.grid[0]?.[0];
      const fw = f?.classList.contains("is-frozen") ? f.getBoundingClientRect().width / k : 0;
      colLeft = Math.max(left, this.scroller.scrollLeft + fw);
      const own = this.grid[r1]?.[c1];
      const add = (el: HTMLElement | undefined) => {
        if (!el || el === own || !el.classList.contains("is-frozen") || this.crossed.includes(el)) return;
        el.classList.add("is-cross");
        this.crossed.push(el);
      };
      for (let r = r1; r <= r2; r++) add(this.grid[r]?.[0]);
      // 高亮的正是冻结的那一列：竖的整列只能逐格加（少见）
      if (c1 === 0) for (let r = 0; r < this.grid.length; r++) add(this.grid[r]?.[0]);
    }
    const rects: [number, number, number, number][] = [
      [tl, top, left - tl, bottom - top],
      [right, top, tr - right, bottom - top],
      [colLeft, tt, right - colLeft, top - tt],
      [colLeft, bottom, right - colLeft, tbm - bottom],
    ];
    rects.forEach(([bx, by, bw, bh], i) => {
      const band = this.crossBands[i];
      const show = bw > 0.5 && bh > 0.5;
      band.classList.toggle("is-shown", show);
      if (show) band.setAttribute("style", `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px`);
    });
  }

  private markSel(): void {
    // 先把格子上的样式全改完、输入框挪好，再统一读位置摆浮层：大表格里每次「改了再读」都要整张表重排一遍
    for (const el of this.marked) el.classList.remove("is-selected", "is-sel-head", "is-in-range");
    this.marked = [];
    const multi = this.isMulti();
    this.root.classList.toggle("has-range", multi);
    const r = multi ? this.rangeRect() : null;
    // 选区里的格子都标上（合并格只标一次）：只走选区这一片，不扫全表
    let any = false;
    if (r) {
      const seen = new Set<HTMLElement>();
      for (let i = r.r1; i <= r.r2; i++)
        for (let j = r.c1; j <= r.c2; j++) {
          const el = this.grid[i]?.[j];
          if (!el || seen.has(el)) continue;
          seen.add(el);
          // 整行 / 整列选中时选区不往外扩：左上角不在选区里的合并格不算
          if (Number(el.dataset.r) < r.r1 || Number(el.dataset.c) < r.c1) continue;
          el.classList.add("is-in-range");
          this.marked.push(el);
          any = true;
        }
    }
    const cell = this.sel && this.cellEl(this.sel);
    if (cell && this.sel) {
      cell.classList.add("is-selected");
      this.marked.push(cell);
      const head = headRows(this.table);
      const headCell = this.sel.r >= head ? this.cellEl({ r: head - 1, c: this.sel.c }) : null;
      if (headCell) {
        headCell.classList.add("is-sel-head");
        this.marked.push(headCell);
      }
      // 看不见的输入框放进选中的格子里：打字、组字从这里开始
      if (this.input.el.parentElement !== cell) cell.appendChild(this.input.el);
    } else this.input.detach();
    // ---- 下面只读位置、摆浮层
    const sb = any ? this.selBox() : null;
    this.rangeBox.classList.toggle("is-shown", !!sb);
    if (sb) this.rangeBox.setAttribute("style", `left:${sb.x}px;top:${sb.y}px;width:${sb.w}px;height:${sb.h}px`);
    this.rangeBox.classList.toggle("is-under-frozen", !!sb && this.root.classList.contains("is-freeze") && (this.rangeRect()?.c1 ?? 0) > 0);
    this.markCross();
    // 没选中（点到表格外面、Esc）也要走一遍：把填充柄收起来，不然右下角的小方块留在原处
    this.placeFill();
    this.placeHandles();
    this.placeTouchResize();
  }

  // ---------- 选中、编辑 ----------

  /** extend：保留选区的另一头（Shift、拖选），否则只选这一格 */
  private setSel(p: Pos | null, focus: boolean, extend = false): void {
    if (this.editing) this.commit();
    this.lineSel = false;
    if (extend && this.sel && p) this.anchor = this.anchor ?? this.sel;
    else this.anchor = null;
    this.sel = p && this.canon(p);
    if (p) markActive(this);
    if (this.anchor && this.sel && this.anchor.r === this.sel.r && this.anchor.c === this.sel.c) this.anchor = null;
    this.markSel();
    if (p && focus && !this.host.readonly) {
      this.input.reset("");
      this.input.focus();
      this.cellEl(p)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      this.host.onFocus?.();
    }
  }

  /** 进入编辑：keep 为 true 在原内容上改，否则从输入框里已经打进去的字开始 */
  private startEdit(keep: boolean): void {
    if (!this.sel || this.host.readonly) return;
    const cell = this.cellEl(this.sel);
    if (!cell) return;
    // 计算列的格子是公式算出来的：不进编辑（打进来的字也不要），提示去列菜单改公式
    if (isFxCell(this.table, this.sel.r, this.sel.c)) {
      this.input.reset("");
      if (Date.now() - this.fxNoticeAt > 1500) {
        this.fxNoticeAt = Date.now();
        this.host.notice?.(t("fxLocked"));
      }
      return;
    }
    // 加密列：要先解锁、解开这一格；编辑框里是明文，提交时再加密
    let plain: string | null = null;
    if (this.isSecretCell(this.sel)) {
      const raw = this.table.cells[this.sel.r][this.sel.c];
      const box = this.host.secrets?.() ?? null;
      const typedText = keep ? "" : this.input.value;
      if (!box) {
        this.input.reset("");
        this.host.notice?.(t("encNoHost"));
        return;
      }
      if (isSealed(raw)) {
        const v = box.peek(raw);
        if (v === undefined) {
          this.input.reset("");
          void this.secretEditLater(this.sel, keep, typedText);
          return;
        }
        if (v === null) {
          this.input.reset("");
          this.host.notice?.(t("encForeign"));
          return;
        }
        plain = v;
      } else if (!box.unlocked) {
        // 还没加密的明文格子：改完要加密，也得先解锁
        this.input.reset("");
        void this.secretEditLater(this.sel, keep, typedText);
        return;
      }
      box.touch();
    }
    if (this.anchor) {
      this.anchor = null;
      this.markSel();
    }
    this.editing = true;
    this.typed = false;
    cell.classList.add("is-editing");
    this.fillHandle.classList.remove("is-shown");
    this.showMobileBar();
    if (keep) {
      this.input.reset(plain ?? shownText(this.table, this.sel.r, this.sel.c));
      const end = this.input.value.length;
      this.input.setSelectionRange(end, end);
    }
    if (!this.input.hasFocus()) this.input.focus();
    this.autosize();
    this.updateSuggest();
    this.host.onFocus?.();
  }

  /**
   * 编辑框跟着内容长高：格子里的内容区换成编辑框里的原文（看不见），编辑框盖在上面，
   * 格子按这段原文的高度排版，不用量高度、设内联样式
   */
  private autosize(): void {
    const content = this.sel && this.cellEl(this.sel)?.querySelector<HTMLElement>(".ggt-content");
    if (!content) return;
    content.classList.remove("is-empty");
    content.textContent = this.input.sizingText() + "\u200b";
    // 折行了行就变高：十字高亮的那条跟着重算，不然只盖住第一行
    this.refreshCross();
  }

  private refreshCross(): void {
    if (this.crossBands.some((b) => b.classList.contains("is-shown"))) this.markCross();
  }

  /** 编辑结束：内容区换回渲染好的样子 */
  private restoreContent(p: Pos): void {
    const content = this.cellEl(p)?.querySelector<HTMLElement>(".ggt-content");
    if (content) this.fillCell(content, p.r, p.c, shownText(this.table, p.r, p.c));
    this.refreshCross();
  }

  /** 编辑完：内容变了就交给宿主 */
  private commit(): void {
    this.closeSuggest();
    this.hideFormatBar();
    this.hideMobileBar();
    if (!this.editing || !this.sel) return;
    const p = this.sel;
    this.editing = false;
    this.cellEl(p)?.classList.remove("is-editing");
    const text = this.smartDate(p, this.input.value.replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, ""));
    this.input.reset("");
    // 加密列：明文没变就不写；变了先加密（异步），加密好了再写回。文件里不出现明文
    const secret = this.isSecretCell(p) ? this.secretCommit(p, text) : "plain";
    if (secret !== "plain") {
      const pending = this.pending;
      this.pending = null;
      if (pending) {
        this.table = pending;
        this.render();
      } else this.restoreContent(p);
      return;
    }
    const edited = editCell(this.table, p.r, p.c, text);
    const next = edited === this.table ? edited : normalize(edited);
    const pending = this.pending;
    this.pending = null;
    if (next !== this.table) {
      const prev = this.table;
      this.table = next;
      // 合计行、状态列、计算列：别的格子也可能跟着变，整张重画
      if (hasTotal(next) || next.meta.opts?.some(Boolean) || next.meta.fx?.some(Boolean)) this.render();
      else this.restoreContent(p);
      this.host.onChange(next, prev);
    } else if (pending) {
      this.table = pending;
      this.render();
    } else this.restoreContent(p);
  }

  /**
   * 日期列里改过的一格：整格是 1/5、2026年1月5日、20260105、今天 这类写法时，换成这一列的写法（日记链接列写成 [[日记]]）。
   * 这次没打过字的不动：以前存的「今天」进编辑再按 Enter，不会被换成那一天
   */
  private smartDate(p: Pos, text: string): string {
    const ty = colTypeOf(this.table, p.c);
    if (ty?.t !== "date" || this.host.smartDate?.() === false || !text || !this.typed) return text;
    if (p.r < headRows(this.table) || (hasTotal(this.table) && p.r === rowCount(this.table) - 1) || formulaOf(this.table, p.c)) return text;
    const now = new Date();
    const v = parseLooseDate(text, { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
    if (!v) return text;
    const daily = ty.f === "link" ? this.dailyNote() : null;
    return writeDate(v, ty.f, daily ? (x) => daily.name(x) : undefined);
  }

  private cancel(): void {
    this.closeSuggest();
    this.hideFormatBar();
    this.hideMobileBar();
    if (!this.editing || !this.sel) return;
    this.editing = false;
    this.cellEl(this.sel)?.classList.remove("is-editing");
    this.input.reset("");
    if (this.pending) {
      this.table = this.pending;
      this.pending = null;
      this.render();
    } else this.restoreContent(this.sel);
  }

  /** 换一张表，选区原样留着（批量设底色、对齐之后可以接着操作） */
  private applyKeepRange(next: Table): void {
    const anchor = this.anchor;
    this.apply(next, this.sel ?? undefined);
    if (anchor) {
      this.anchor = anchor;
      this.markSel();
    }
  }

  /** 换一张表并交给宿主，选中挪到 sel */
  private apply(nextRaw: Table, sel?: Pos): void {
    if (this.editing) this.commit();
    const next = nextRaw === this.table ? nextRaw : normalize(nextRaw);
    if (next === this.table) return;
    // 粘贴、填充这类改动往加密列里放了新的明文：先加密再写，文件里不出现明文
    if (freshPlain(this.table, next)) {
      void this.sealThenApply(this.table, next, sel);
      return;
    }
    this.applyNow(next, sel);
  }

  /** 写回一张已经整理好（normalize 过、加密列都是密文）的表 */
  private applyNow(next: Table, sel?: Pos): void {
    if (next === this.table) return;
    const prev = this.table;
    this.table = next;
    if (sel) this.sel = sel;
    this.render();
    this.host.onChange(next, prev);
    if (sel) this.setSel(this.sel, true);
  }

  /** 方向键、Tab、Enter 走格；extend 是 Shift+方向键扩大选区。从合并的格子出发时从它的边上走出去 */
  private move(dr: number, dc: number, wrap = false, extend = false): void {
    if (!this.sel) return;
    // 折着时藏着的行走不进去
    const rows = this.shownRows();
    const cols = colCount(this.table);
    const m = mergeAt(this.table, this.sel.r, this.sel.c);
    let { r, c } = this.sel;
    if (m) {
      if (dr > 0) r = m.r2;
      if (dc > 0) c = m.c2;
    }
    if (extend) {
      const nr = Math.max(0, Math.min(rows - 1, r + dr));
      const nc = Math.max(0, Math.min(cols - 1, c + dc));
      this.setSel({ r: nr, c: nc }, true, true);
      return;
    }
    c += dc;
    if (wrap && c >= cols) {
      c = 0;
      r++;
    } else if (wrap && c < 0) {
      c = cols - 1;
      r--;
    }
    r += dr;
    if (r < 0) {
      this.setSel(null, false);
      this.host.onLeave?.("above");
      return;
    }
    if (r >= rows) {
      if (wrap && !this.folded()) {
        // 最后一格按 Tab：加一行，和飞书、Notion 一样
        this.apply(insertRow(this.table, rows), { r: rows, c: 0 });
        return;
      }
      this.setSel(null, false);
      this.host.onLeave?.("below");
      return;
    }
    this.setSel({ r, c: Math.max(0, Math.min(cols - 1, c)) }, true);
  }

  // ---------- 事件 ----------

  private on<K extends keyof HTMLElementEventMap>(el: HTMLElement | Document, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    el.addEventListener(type, fn as EventListener, opts);
    this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  /** 输入框的事件交给编辑器（换输入框以后也要重新接） */
  private bindInput(): void {
    const doc = this.root.ownerDocument;
    this.input.bind({
      keydown: (ev) => this.onKey(ev),
      copy: (ev) => this.onCopy(ev, false),
      cut: (ev) => this.onCopy(ev, true),
      paste: (ev) => this.onPaste(ev),
      input: () => {
        if (!this.editing) this.startEdit(false);
        else this.autosize();
        this.typed = true;
        this.updateSuggest();
        this.updateFormatBar();
      },
      // 编辑时选中文字：浮出格式栏
      select: () => this.updateFormatBar(),
      compositionstart: () => {
        if (!this.editing) this.startEdit(false);
      },
      blur: () => {
        // 焦点去了别处（不是去开菜单）：编辑中的这一格就此保存
        window.setTimeout(() => {
          if (this.destroyed || this.input.hasFocus()) return;
          if (this.popover && this.popover.contains(doc.activeElement)) return;
          if (this.editing) this.commit();
        }, 0);
      },
    });
  }

  /** 设置改了「所见即所得」：换一种输入框（正在编辑的这一格先保存） */
  private refreshInput(): void {
    const rich = !!this.host.richEdit?.();
    if (rich === this.input instanceof CodeMirrorInput) return;
    const hadFocus = this.input.hasFocus();
    if (this.editing) this.commit();
    this.input.destroy();
    this.input = rich ? new CodeMirrorInput(this.root.ownerDocument) : new TextareaInput(this.root.ownerDocument);
    this.bindInput();
    this.markSel();
    if (hadFocus && this.sel) this.input.focus();
  }

  private bind(): void {
    const doc = this.root.ownerDocument;
    this.on(this.tableEl, "pointerdown", (ev) => {
      const target = ev.target as HTMLElement;
      // 手机、平板上编辑着一个空格子时长按：编辑框盖住了整格，按下都落在编辑框上，长按以前只出系统的「粘贴、选择、全选」，
      // 出不来表格菜单（小红书反馈 iPad 上长按空行老是出系统菜单）。空格子没有字可选，长按改成表格菜单；有字的照旧交给系统（放光标、选字）
      if (this.input.contains(target)) {
        if (ev.pointerType === "touch" && this.editing && this.sel && !this.host.readonly && !this.input.value.trim()) {
          this.touched = true;
          this.touchStart(ev, this.sel);
        }
        return;
      }
      // 加密格子的按钮：只认点击（只读时也能用），按下不选格子、不抢焦点
      if (target.closest(".ggt-secret-btn")) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      const cell = target.closest<HTMLElement>(".ggt-cell");
      if (!cell || this.host.readonly) return;
      // 点链接、标签：照常打开，不选中
      if (target.closest("a, .tag, input[type=checkbox]")) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      if (ev.pointerType === "touch") {
        this.touched = true;
        return this.touchStart(ev, p);
      }
      // 下面拦了按下的默认动作，浏览器就不再发 mousedown：Obsidian 的菜单靠它知道点了别处，这里替它收起来（#9）
      this.host.dismissMenus?.();
      // 中键不拦：留给浏览器的中键滚动（按一下出十字光标，移动鼠标往各个方向滚；B 站 bili_70604431418），和 Obsidian 自己的表格一样
      if (ev.button === 1) return;
      ev.preventDefault();
      if (ev.button !== 0) return;
      if (ev.shiftKey && this.sel) {
        this.setSel(p, true, true);
        return;
      }
      const same = this.sel && this.sel.r === p.r && this.sel.c === p.c;
      if (!same || !this.editing) this.setSel(p, true);
      this.dragSelect(ev);
    });
    // 格子里的双链：Obsidian 不管自己渲染出来的链接，点击、悬停预览都要自己接
    this.on(this.tableEl, "click", (ev) => {
      const link = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      if (!link || !link.closest(".ggt-cell") || !this.host.openLink) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.host.openLink(link.dataset.href ?? link.getAttribute("href") ?? "", ev);
    });
    this.on(this.tableEl, "auxclick", (ev) => {
      const link = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      if (!link || ev.button !== 1 || !this.host.openLink) return;
      ev.preventDefault();
      this.host.openLink(link.dataset.href ?? link.getAttribute("href") ?? "", ev);
    });
    this.on(this.tableEl, "mouseover", (ev) => {
      const link = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      const href = link?.dataset.href ?? link?.getAttribute("href");
      if (link && href) this.host.hoverLink?.(ev, href, link);
    });
    // 加密格子的按钮：解锁、显示 / 隐藏明文、复制明文（只读时也能用）
    this.on(this.tableEl, "click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>(".ggt-secret-btn");
      const cell = btn?.closest<HTMLElement>(".ggt-cell");
      if (!btn || !cell) return;
      ev.preventDefault();
      ev.stopPropagation();
      void this.secretButton(btn.dataset.act ?? "", { r: Number(cell.dataset.r), c: Number(cell.dataset.c) });
    });
    // 点勾选框：切换 [ ] / [x]；列表里的待办（- [ ]，渲染出来的勾选框）按第几个改原文
    this.on(this.tableEl, "click", (ev) => {
      const box = (ev.target as HTMLElement).closest<HTMLInputElement>("input.ggt-check, .ggt-content input.task-list-item-checkbox");
      const cell = box?.closest<HTMLElement>(".ggt-cell");
      if (!box || !cell || this.editing) return;
      ev.preventDefault();
      if (this.host.readonly) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      if (box.classList.contains("ggt-check")) return this.apply(toggleCheck(this.table, p.r, p.c), p);
      const n = [...cell.querySelectorAll<HTMLInputElement>(".ggt-content input.task-list-item-checkbox:not(.ggt-check)")].indexOf(box);
      if (n >= 0) this.apply(toggleTask(this.table, p.r, p.c, n), p);
    });
    // 设置「单击格子直接编辑」：鼠标点一下（不是拖选、没按修饰键）就进编辑。
    // 链接、勾选框、图片、加密按钮各管各的；只读、编辑着、选了一片都不管
    this.on(this.tableEl, "click", (ev) => {
      if (this.root.dataset.clickEdit !== "1" || ev.detail !== 1 || ev.button !== 0) return;
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey || this.touched) return;
      if (this.editing || this.host.readonly || this.isMulti() || !this.sel) return;
      const target = ev.target as HTMLElement;
      const cell = target.closest<HTMLElement>(".ggt-cell");
      if (!cell || target.closest("a, .tag, input, img, .ggt-secret-btn, .internal-embed")) return;
      if (Number(cell.dataset.r) !== this.sel.r || Number(cell.dataset.c) !== this.sel.c) return;
      this.startEdit(true);
    });
    this.on(this.tableEl, "dblclick", (ev) => {
      const target = ev.target as HTMLElement;
      // 双击格子里的图片：放大看（和原生表格、gogoga Mind Map 一样）；双击别处进入编辑
      const img = !this.editing && target.closest(".ggt-cell") ? target.closest<HTMLImageElement>(".ggt-content img") : null;
      if (img) {
        ev.preventDefault();
        // 脑图节点里的表格：别让画布再把双击当成编辑节点
        ev.stopPropagation();
        this.openLightbox(img);
        return;
      }
      if (target.closest(".ggt-cell") && !this.editing) this.startEdit(true);
    });
    // 右键格子里的图片、双链：弹出 Obsidian 原生的菜单（只读的表也弹，只是不能从格子里删图）
    this.on(this.tableEl, "contextmenu", (ev) => {
      const target = ev.target as HTMLElement;
      const cellEl = target.closest<HTMLElement>(".ggt-cell");
      if (!cellEl || (this.editing && this.input.contains(target))) return;
      const p = { r: Number(cellEl.dataset.r), c: Number(cellEl.dataset.c) };
      const img = target.closest<HTMLImageElement>(".ggt-content img");
      if (img && this.host.imageMenu) {
        ev.preventDefault();
        ev.stopPropagation();
        const link = img.closest<HTMLElement>(".internal-embed")?.getAttribute("src") ?? null;
        this.host.imageMenu(ev, img, link, link && !this.host.readonly ? () => this.removeEmbed(p, link) : null);
        return;
      }
      const a = target.closest<HTMLAnchorElement>(".ggt-content a.internal-link");
      const href = a?.dataset.href ?? a?.getAttribute("href");
      if (a && href && this.host.linkMenu) {
        ev.preventDefault();
        ev.stopPropagation();
        this.host.linkMenu(ev, href);
      }
    }, { capture: true });
    this.on(this.tableEl, "contextmenu", (ev) => {
      const cell = (ev.target as HTMLElement).closest<HTMLElement>(".ggt-cell");
      if (!cell || this.host.readonly || (this.editing && this.input.contains(ev.target as Node))) return;
      ev.preventDefault();
      ev.stopPropagation();
      // 安卓长按会再来一次右键事件：长按已经开过菜单了
      if (performance.now() - this.longPressAt < 1000) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      // 右键点在选区里：选区留着，菜单对整片生效
      const r = this.rangeRect();
      const inRange = this.isMulti() && r && p.r >= r.r1 && p.r <= r.r2 && p.c >= r.c1 && p.c <= r.c2;
      if (!inRange) this.setSel(p, true);
      else this.input.focus();
      const items = this.cellMenu(inRange && this.sel ? this.sel : p);
      this.openMenu(items, ev.clientX, ev.clientY);
      // 别的插件加的项接在菜单最后（菜单还开着才加，重画一次）
      const pop = this.popover;
      this.host.eventMenuItems?.(ev, (extra) => {
        if (!extra.length || this.popover !== pop) return;
        this.openMenu([...items, { separator: true }, ...extra], ev.clientX, ev.clientY);
      });
    });
    this.on(this.resizeBar, "pointerdown", (ev) => this.startResize(ev, this.resizeBar));
    // 手机、平板上拖把手：触摸事件别传到 Obsidian，不然左右拖会被当成拉出侧栏的手势（小红书反馈 iPad 上拖列宽带出左侧栏）
    for (const type of ["touchstart", "touchmove"] as const) {
      this.on(this.resizeBar, type, (ev) => {
        ev.stopPropagation();
        if (type === "touchmove" && ev.cancelable) ev.preventDefault();
      }, { passive: false });
    }
    // 手指拖填充柄是扩大选区（手机上没法拖选、按 Shift），鼠标拖才是填充
    this.on(this.fillHandle, "pointerdown", (ev) => (ev.pointerType === "mouse" ? this.fillDrag(ev) : this.rangeDrag(ev)));
    for (const type of ["touchstart", "touchmove"] as const) {
      this.on(this.fillHandle, type, (ev) => {
        ev.stopPropagation();
        if (type === "touchmove" && ev.cancelable) ev.preventDefault();
      }, { passive: false });
    }
    // 宿主改了默认样式（设置变了）
    this.on(this.root, "ggt-restyle" as keyof HTMLElementEventMap, () => {
      this.refreshInput();
      this.applyLook();
      this.fitCols();
      this.markCross();
    });
    // 十字高亮（悬停模式）：鼠标在哪格，就高亮那一格所在的行和列
    this.on(this.tableEl, "pointermove", (ev) => {
      if (this.root.dataset.cross !== "hover") return;
      const cell = (ev.target as HTMLElement).closest<HTMLElement>(".ggt-cell");
      const pos = cell ? { r: Number(cell.dataset.r), c: Number(cell.dataset.c) } : null;
      if (pos?.r === this.crossAt?.r && pos?.c === this.crossAt?.c) return;
      this.crossAt = pos;
      this.markCross();
    });
    this.on(this.tableEl, "pointerleave", () => {
      if (!this.crossAt) return;
      this.crossAt = null;
      this.markCross();
    });
    this.on(this.cornerBtn, "pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    this.on(this.cornerBtn, "click", (ev) => {
      ev.preventDefault();
      if (this.host.readonly) return;
      if (this.editing) this.commit();
      const rect = this.cornerBtn.getBoundingClientRect();
      this.openMenu(this.tableMenu(), rect.left, rect.bottom + 4);
    });
    this.on(this.resizeBar, "dblclick", (ev) => {
      ev.preventDefault();
      const c = Number(this.resizeBar.dataset.c);
      if (!Number.isNaN(c)) this.apply(setWidth(this.table, c, null));
    });
    this.on(this.root, "pointermove", (ev) => {
      if (!this.resize && ev.pointerType !== "touch" && !this.host.readonly) this.placeResizeBar(ev.clientX, ev.clientY);
      if (this.resize || ev.pointerType === "touch" || this.root.classList.contains("is-dragging")) return;
      this.touched = false;
      // 刚滚过：浏览器在滚动后补发的鼠标移动不算，等鼠标真的再动
      if (performance.now() - this.scrolledAt < 150) return;
      const cell = (ev.target as HTMLElement).closest<HTMLElement>(".ggt-cell");
      if (!cell || !this.tableEl.contains(cell)) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      if (!this.hover || this.hover.r !== p.r || this.hover.c !== p.c) {
        this.hover = p;
        this.placeHandles();
      }
    });
    this.on(this.root, "pointerleave", () => {
      // 手指抬起也会补一个 pointerleave：触屏的把手跟着选中走，不在这里收
      if (!this.resize && !this.resizeBar.classList.contains("is-touch")) this.resizeBar.classList.remove("is-shown");
      if (this.popover) return;
      this.hover = null;
      this.placeHandles();
    });
    this.on(this.scroller, "scroll", () => this.placeHandles(), { passive: true });

    this.bindInput();
    this.cleanups.push(() => this.input.destroy());
    this.on(doc, "scroll", () => this.formatBar && this.updateFormatBar(), { capture: true, passive: true });
    // 同上：手指落在菜单范围里时，别让后面的格子、正文拿到这次触摸（会弹键盘、放光标）
    this.on(doc, "touchstart", (ev) => {
      const t = ev.touches[0];
      const fl = t ? this.floatingAt(t.clientX, t.clientY) : null;
      const swallow = performance.now() < this.swallowUntil;
      if (((fl && !fl.contains(ev.target as Node)) || swallow) && ev.cancelable) ev.preventDefault();
    }, { capture: true, passive: false });
    this.on(doc, "pointerdown", (ev) => {
      const target = ev.target as Node;
      if (performance.now() < this.swallowUntil) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      // 点格式栏的按钮：还在编辑这一格
      if (this.formatBar?.contains(target)) return;
      // 点手机工具条的按钮：同上
      if (this.mobileBar?.contains(target)) return;
      // 点补全列表（状态、[[ 链接、# 标签）：它挂在 body 上，不能当成点到表格外面，不然先按原样退出编辑、列表也关了
      if (this.suggest?.el.contains(target) || this.cal?.el.contains(target)) return;
      // iPhone 上菜单看得见却点不到（点击判定落到后面的格子、正文上）：按坐标认，落在菜单里就点菜单里那个按钮
      const fl = this.floatingAt(ev.clientX, ev.clientY);
      if (fl && !fl.contains(target) && this.tapPopoverAt(ev.clientX, ev.clientY)) {
        this.swallowUntil = performance.now() + 500;
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (this.popover && !this.popover.contains(target)) this.closePopover();
      // 点到表格外面：取消选中。目标是 <html>、<body> 的不算：iPhone 上正文编辑器拿着焦点（键盘弹着）时，每次触摸前会先来一个落在 <html> 上的按下，
      // 不是真点到了外面（多选格子时它把选区清掉、多选也退了）
      const bare = target === doc.documentElement || target === doc.body;
      if (this.sel && !bare && !this.root.contains(target) && !(this.popover && this.popover.contains(target))) {
        if (this.editing) this.commit();
        this.sel = null;
        this.markSel();
      }
    }, { capture: true });
  }

  /** 挂在页面上的浮层（菜单、格式栏、手机工具条、补全列表、日历）里，坐标落在哪一个上 */
  private floatingAt(x: number, y: number): HTMLElement | null {
    for (const el of [this.popover, this.formatBar, this.mobileBar, this.suggest?.el, this.cal?.el]) {
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  }

  /** 坐标在开着的菜单里：按位置找到菜单里的按钮（色块、对齐按钮、菜单项）点它，返回 true；不在菜单里返回 false */
  private tapPopoverAt(x: number, y: number): boolean {
    if (!Number.isFinite(x)) return false;
    const pop = this.floatingAt(x, y);
    if (!pop) return false;
    // 坐标下面最小的那个元素（按钮、色块、补全项、日历的日子），给它补一套按下、抬起、点击：有的在按下时就执行，有的在点击时
    let hit: HTMLElement = pop;
    let area = Infinity;
    for (const el of Array.from(pop.querySelectorAll<HTMLElement>("*"))) {
      const br = el.getBoundingClientRect();
      if (!br.width || !br.height || x < br.left || x > br.right || y < br.top || y > br.bottom) continue;
      if (br.width * br.height <= area) {
        area = br.width * br.height;
        hit = el;
      }
    }
    const target = hit.closest<HTMLElement>("button, input, select, textarea, [role=menuitem], [role=option], [role=button]") ?? hit;
    if (target.tagName === "BUTTON" && (target as HTMLButtonElement).disabled) return true;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
      target.focus();
      return true;
    }
    const win = target.ownerDocument.defaultView ?? window;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new win.PointerEvent("pointerdown", { ...init, pointerType: "touch", isPrimary: true }));
    target.dispatchEvent(new win.MouseEvent("mousedown", init));
    target.dispatchEvent(new win.PointerEvent("pointerup", { ...init, pointerType: "touch", isPrimary: true }));
    target.dispatchEvent(new win.MouseEvent("mouseup", init));
    target.dispatchEvent(new win.MouseEvent("click", init));
    return true;
  }

  private onKey(ev: KeyboardEvent): void {
    // 输入法组字：组字中 isComposing；开始组字前那一下按键 key 是 "Process"
    if (ev.isComposing || ev.key === "Process") return;
    // ⌘ 或 Ctrl 都算（不去判断平台）：Mac 上 Ctrl+Z 本来也没有别的用处
    const mod = ev.metaKey || ev.ctrlKey;
    if (this.editing) {
      if (this.suggest && this.onSuggestKey(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (this.formatKey(ev)) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      const arrow = ARROW_EDGE[ev.key];
      if (arrow && !ev.shiftKey && !ev.altKey && !mod && this.input.atEdge(arrow.edge)) {
        // 光标到了格子边上再按方向键：存好这一格、跳到旁边的格子（B站反馈）；在字中间照常挪光标
        ev.preventDefault();
        this.commit();
        this.move(arrow.dr, arrow.dc);
      } else if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey && !mod) {
        ev.preventDefault();
        this.commit();
        this.move(1, 0);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        this.commit();
        this.move(0, ev.shiftKey ? -1 : 1, true);
      } else if (ev.key === "Escape") {
        // Esc 保存并退出编辑，和 Obsidian 自己的表格一样（以前是取消、丢掉刚打的字，#15）；想撤销按 ⌘Z
        ev.preventDefault();
        ev.stopPropagation();
        this.commit();
      }
      ev.stopPropagation();
      return;
    }
    // 选中、没在编辑
    const key = ev.key;
    const stop = () => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    if (mod && key.toLowerCase() === "z") {
      stop();
      if (ev.shiftKey) this.host.redo?.();
      else this.host.undo?.();
      return;
    }
    if (mod && key.toLowerCase() === "y") {
      stop();
      this.host.redo?.();
      return;
    }
    if (mod || ev.altKey) {
      ev.stopPropagation();
      return;
    }
    switch (key) {
      case "ArrowUp":
        stop();
        return this.move(-1, 0, false, ev.shiftKey);
      case "ArrowDown":
        stop();
        return this.move(1, 0, false, ev.shiftKey);
      case "ArrowLeft":
        stop();
        return this.move(0, -1, false, ev.shiftKey);
      case "ArrowRight":
        stop();
        return this.move(0, 1, false, ev.shiftKey);
      case "Tab":
        stop();
        return this.move(0, ev.shiftKey ? -1 : 1, true);
      case " ":
        if (this.sel && CHECK_RE.test(this.table.cells[this.sel.r][this.sel.c])) {
          stop();
          this.apply(toggleCheck(this.table, this.sel.r, this.sel.c), this.sel);
          return;
        }
        // 选中格子按空格：进入编辑、内容留着、光标在最后（群里反馈：以前和打字一样把整格换成一个空格，内容没了）
        stop();
        return this.startEdit(true);
      case "Enter":
      case "F2":
        stop();
        return this.startEdit(true);
      case "Backspace":
      case "Delete":
        stop();
        if (this.sel) {
          // 清空后选区留着（可以接着设底色、再清）
          const keep = this.anchor;
          this.apply(clearCells(this.table, this.rangeCells()), this.sel);
          if (keep) {
            this.anchor = keep;
            this.markSel();
          }
        }
        return;
      case "Escape":
        stop();
        // 菜单开着：先关菜单，选区不动
        if (this.popover) {
          this.closePopover();
          return;
        }
        // 选了一片：先收回成一格
        if (this.isMulti() && this.sel) {
          this.setSel(this.sel, true);
          return;
        }
        this.setSel(null, false);
        this.host.onLeave?.("escape");
        return;
    }
    // 其他键（打字）：落到输入框里，input 事件里开始编辑
    ev.stopPropagation();
  }

  /** 按住拖过几个格子：选中一片 */
  private dragSelect(ev: PointerEvent): void {
    const doc = this.root.ownerDocument;
    const move = (e: PointerEvent) => {
      // 键已经松开了（松开事件被别处拦掉也一样）：结束拖选
      if (!(e.buttons & 1)) return up();
      if (this.editing) return;
      const el = doc.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".ggt-cell");
      if (!el || !this.tableEl.contains(el)) return;
      const p = { r: Number(el.dataset.r), c: Number(el.dataset.c) };
      if (this.sel && (p.r !== this.sel.r || p.c !== this.sel.c)) this.setSel(p, true, true);
    };
    // 在捕获阶段收：实时预览里表格外层拦着冒泡（不让 Obsidian 碰到我们的格子），冒泡阶段收不到松开
    const up = () => {
      doc.removeEventListener("pointermove", move, true);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", up, true);
    };
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", up, true);
    void ev;
  }

  // ---------- 编辑时的格式和补全 ----------

  /**
   * 加粗 ⌘B、斜体 ⌘I、删除线 ⌘⇧X、高亮 ⌘⇧H、链接 ⌘K。编辑中改选中的字；只选中格子时给整格加 / 去掉。
   * 处理了返回 true（Obsidian 那边的快捷键作用域也调这里，免得它改到正文）
   */
  formatKey(ev: KeyboardEvent): boolean {
    const mod = ev.metaKey || ev.ctrlKey;
    if (!mod || ev.altKey || !this.sel || this.host.readonly) return false;
    const k = ev.key.toLowerCase();
    const mark = !ev.shiftKey && k === "b" ? "**" : !ev.shiftKey && k === "i" ? "*" : ev.shiftKey && k === "x" ? "~~" : ev.shiftKey && k === "h" ? "==" : null;
    const link = !ev.shiftKey && k === "k";
    // ⌘U 下划线：只在编辑时，给选中的字加 <u>
    if (!ev.shiftKey && k === "u" && this.editing) {
      this.applyFormat({ kind: "underline" });
      return true;
    }
    if (!mark && !link) return false;
    return this.formatMark(mark);
  }

  /** 按 Obsidian 命令做格式（用户把加粗、斜体这些命令改成了别的快捷键时，keys.ts 按命令调这里） */
  formatCommand(kind: "bold" | "italic" | "strike" | "highlight" | "link"): boolean {
    if (!this.sel || this.host.readonly) return false;
    const marks = { bold: "**", italic: "*", strike: "~~", highlight: "==" } as const;
    return this.formatMark(kind === "link" ? null : marks[kind]);
  }

  /** mark 是 null 时插链接 */
  private formatMark(mark: string | null): boolean {
    if (!this.sel) return false;
    if (this.editing) {
      // 所见即所得的编辑框选了字：和格式栏一样按看得见的字加（标签藏着，不能直接在两头插记号）
      const kinds: Record<string, InlineFormat> = { "**": { kind: "bold" }, "*": { kind: "italic" }, "~~": { kind: "strike" }, "==": { kind: "highlight" } };
      if (mark && this.input instanceof CodeMirrorInput && this.input.selectionStart !== this.input.selectionEnd) this.applyFormat(kinds[mark]);
      else if (mark) this.wrapSelection(mark);
      else this.insertLink();
      return true;
    }
    if (!mark) return true;
    // 只选中格子：选区里每格整格加上（都有了就都去掉）
    const cells = (this.rangeCells().length ? this.rangeCells() : [this.sel]).filter((p) => !isCovered(this.table, p.r, p.c) && this.table.cells[p.r][p.c].trim());
    const wrapped = (v: string) => v.length >= mark.length * 2 && v.startsWith(mark) && v.endsWith(mark);
    const all = cells.length > 0 && cells.every((p) => wrapped(this.table.cells[p.r][p.c].trim()));
    let next = this.table;
    for (const p of cells) {
      const v = this.table.cells[p.r][p.c].trim();
      next = setCell(next, p.r, p.c, all ? v.slice(mark.length, -mark.length) : `${mark}${v}${mark}`);
    }
    this.applyKeepRange(next);
    return true;
  }

  /** 选中的文字两边加上 / 去掉标记（** * ~~ ==）；没选文字时插一对，光标放中间 */
  private wrapSelection(mark: string): void {
    const el = this.input;
    const { selectionStart: a, selectionEnd: b, value: v } = el;
    const before = v.slice(0, a);
    const after = v.slice(b);
    if (before.endsWith(mark) && after.startsWith(mark)) {
      el.value = before.slice(0, -mark.length) + v.slice(a, b) + after.slice(mark.length);
      el.setSelectionRange(a - mark.length, b - mark.length);
    } else {
      el.value = before + mark + v.slice(a, b) + mark + after;
      el.setSelectionRange(a + mark.length, b + mark.length);
    }
    this.autosize();
  }

  // ---------- 格式栏 ----------

  private formatBar: HTMLElement | null = null;
  private formatBarKey = "";

  /** 编辑中选中了文字、宿主给了颜色：在这一格上方显示格式栏；否则收起 */
  private updateFormatBar(): void {
    const el = this.input;
    const colors = this.editing && !this.host.readonly && this.sel && el.selectionStart !== el.selectionEnd ? this.host.formatColors?.(this.root) : null;
    const cell = colors && this.sel ? this.cellEl(this.sel) : null;
    if (!colors || !cell) return this.hideFormatBar();
    const key = JSON.stringify(colors);
    if (!this.formatBar || this.formatBarKey !== key) {
      this.hideFormatBar();
      this.formatBar = this.buildFormatBar(colors);
      this.formatBarKey = key;
    }
    const bar = this.formatBar;
    const win = this.root.ownerDocument.defaultView ?? window;
    // 贴着选中的字放（拿不到时用整个格子）。格子里字很多、比看得见的区域还高时，按格子放会跑到屏幕外（脑图备注里的表格，群友反馈）：
    // 先把位置限制在格子真正看得见的那块（窗口和外面各层滚动框的交集），上面放得下放上面，不然放下面，都不行就盖在看得见的那块顶上
    const cr = cell.getBoundingClientRect();
    const sr = this.input.selectionRect();
    const vis = this.clipBox(cell, win);
    const top0 = Math.max(sr ? sr.top : cr.top, vis.top);
    const bottom0 = Math.min(sr ? sr.bottom : cr.bottom, vis.bottom);
    const cx = sr ? (sr.left + sr.right) / 2 : cr.left + cr.width / 2;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const left = Math.max(8, Math.min(win.innerWidth - w - 8, cx - w / 2));
    let top: number;
    if (top0 - h - 6 >= 8) top = top0 - h - 6;
    else if (bottom0 + 6 + h <= win.innerHeight - 8) top = bottom0 + 6;
    else top = Math.max(8, Math.min(win.innerHeight - h - 8, vis.top + 6));
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
  }

  /** 元素看得见的那块：窗口和外面每一层会裁剪内容的框（overflow 不是 visible）的交集 */
  private clipBox(el: HTMLElement, win: Window): { top: number; bottom: number } {
    let top = 0;
    let bottom = win.innerHeight;
    for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
      const cs = win.getComputedStyle(p);
      if (cs.overflowY === "visible" && cs.overflowX === "visible") continue;
      const r = p.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
    }
    return bottom > top ? { top, bottom } : { top: 0, bottom: win.innerHeight };
  }

  private hideFormatBar(): void {
    this.formatBar?.remove();
    this.formatBar = null;
  }

  /** 给编辑框里选中的字加格式（和脑图节点的格式栏同一套写法：**、*、~~、<u>、==、<span style>、<mark style>） */
  private applyFormat(fmt: InlineFormat): void {
    const el = this.input;
    // 选中的只是藏起来的标记、一个看得见的字都没有：不动（不然会当成没选，整段都上格式）
    const { from, to } = el.visibleSelection();
    if (from === to) return;
    const r = applyFormat(el.value, from, to, fmt);
    if (r.text !== el.value) {
      el.value = r.text;
      el.setSelectionRange(r.start, r.end);
      this.autosize();
    }
    this.updateFormatBar();
  }

  private buildFormatBar(colors: { text: string[]; highlight: string[] }): HTMLElement {
    const doc = this.root.ownerDocument;
    const bar = doc.createElement("div");
    bar.className = "ggt-format-bar";
    // 按下按钮不能让编辑框失焦（失焦就保存退出编辑了）
    bar.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    bar.addEventListener("mousedown", (ev) => ev.preventDefault());
    const btn = (cls: string, title: string, fmt: InlineFormat, fill: (b: HTMLButtonElement) => void) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `ggt-format-btn ${cls}`;
      b.setAttribute("aria-label", title);
      b.title = title;
      fill(b);
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.applyFormat(fmt);
      });
      bar.append(b);
    };
    const sep = () => {
      const s = doc.createElement("span");
      s.className = "ggt-format-sep";
      bar.append(s);
    };
    const iconBtn = (name: string, fallback: string) => (b: HTMLButtonElement) => {
      if (this.host.setIcon) this.host.setIcon(b, name);
      else b.textContent = fallback;
    };
    btn("is-bold", t("fmtBold"), { kind: "bold" }, (b) => (b.textContent = "B"));
    btn("is-italic", t("fmtItalic"), { kind: "italic" }, (b) => (b.textContent = "I"));
    btn("is-strike", t("fmtStrike"), { kind: "strike" }, (b) => (b.textContent = "S"));
    btn("is-underline", t("fmtUnderline"), { kind: "underline" }, (b) => (b.textContent = "U"));
    sep();
    // 文字颜色、荧光笔：和 gogoga Mind Map 一样的「按钮 + 下拉」。左半边套用上次的颜色，▾ 打开色板（常用、色块网格、最近使用、透明度、自定义）
    const local: Record<string, string> = {};
    const mem: ColorMemory = this.host.colorMemory?.() ?? {
      last: (k) => local[k] ?? null,
      recent: () => [],
      remember: (k, c) => (local[k] = c),
    };
    const common = (kind: "text" | "bg") => (kind === "text" ? colors.text : colors.highlight);
    const current = (kind: "text" | "bg") => mem.last(kind) ?? common(kind)[0] ?? (kind === "bg" ? THEME_HIGHLIGHT : null);
    const tip = (el: HTMLElement, text: string) => (el.title = text);
    let open: { kind: "text" | "bg"; el: HTMLElement } | null = null;
    const closePalette = () => {
      open?.el.remove();
      open = null;
    };
    const split = (kind: "text" | "bg") => {
      const el = createColorSplit({
        doc,
        cls: kind === "text" ? "is-text-color" : "is-highlighter",
        title: kind === "text" ? t("fmtTextColor") : t("fmtHighlightColor"),
        caretTitle: kind === "text" ? t("palTextMore") : t("palBgMore"),
        face: (f) => {
          if (kind === "text") f.textContent = "A";
          else iconBtn("highlighter", "H")(f as HTMLButtonElement);
        },
        current: () => current(kind),
        paintBar: (b, c) => paintColor(b, c, kind),
        tip,
        onApply: () => {
          const c = current(kind);
          if (!c) return;
          closePalette();
          this.applyFormat(colorFormat(kind, c));
        },
        onOpen: (anchor) => {
          if (open?.kind === kind) return closePalette();
          closePalette();
          const pick = (c: string | null, apply: (fmt: InlineFormat) => void = (f) => this.applyFormat(f)) => {
            closePalette();
            if (c !== null) mem.remember(kind, c);
            refreshColorSplit(anchor);
            apply(colorFormat(kind, c));
          };
          const pal = createPalette(doc, {
            text: { common: t("palCommon"), recent: t("palRecent"), alpha: t("palAlpha"), custom: t("palCustom") },
            common: common(kind),
            recent: mem.recent(kind),
            alpha: true,
            defaultAlpha: kind === "text" ? 100 : 60,
            paint: (b, c) => paintColor(b, c, kind),
            label: (c) => (c === THEME_HIGHLIGHT ? t("fmtHighlight") : c),
            noneLabel: kind === "text" ? t("palNoText") : t("palNoHighlight"),
            extras: kind === "bg" && !common("bg").includes(THEME_HIGHLIGHT) ? [{ value: THEME_HIGHLIGHT, label: t("fmtHighlight"), paint: (b) => paintColor(b, THEME_HIGHLIGHT, "bg") }] : [],
            onPick: (c) => pick(c),
            onCustom: () => {
              const apply = this.customColorTarget();
              return (c) => pick(c, apply);
            },
            tip,
          });
          pal.classList.add("ggt-format-palette");
          bar.append(pal);
          pal.style.left = `${Math.max(0, anchor.offsetLeft)}px`;
          open = { kind, el: pal };
        },
      });
      bar.append(el);
    };
    split("text");
    split("bg");
    sep();
    btn("is-clear", t("fmtClear"), { kind: "clear" }, iconBtn("eraser", "⌫"));
    doc.body.append(bar);
    return bar;
  }

  /**
   * 色板里点「自定义…」：系统取色器会拿走焦点，格子可能已经保存退出编辑了。先记下是哪一格、选的哪几个字，
   * 选好颜色后还在编辑这一格就照常上格式，否则直接改这一格的源码
   */
  private customColorTarget(): (fmt: InlineFormat) => void {
    const pos = this.sel ? { ...this.sel } : null;
    const { from, to } = this.input.visibleSelection();
    return (fmt) => {
      if (!pos || from === to) return;
      if (this.editing && this.sel && this.sel.r === pos.r && this.sel.c === pos.c) {
        this.input.focus();
        this.input.setSelectionRange(from, to);
        this.applyFormat(fmt);
        return;
      }
      const cur = this.table.cells[pos.r]?.[pos.c];
      if (cur === undefined) return;
      const r = applyFormat(cur, from, to, fmt);
      if (r.text !== cur) this.apply(setCell(this.table, pos.r, pos.c, r.text), pos);
    };
  }

  // ---------- 手机上的编辑工具条 ----------

  private mobileBar: HTMLElement | null = null;
  private mobileBarCleanup: (() => void) | null = null;

  /**
   * 手机、平板上编辑格子时，键盘上方的一排按钮：完成、撤销重做、加粗斜体删除线高亮、双链、勾选框、格内换行、上一格 / 下一格。
   * Obsidian 自己的手机工具条在焦点离开笔记编辑器时会收起来（它的按钮也只管笔记正文），所以表格自己出一条
   */
  private showMobileBar(): void {
    const doc = this.root.ownerDocument;
    if (this.mobileBar || this.host.readonly || !doc.body.classList.contains("is-mobile")) return;
    const win = doc.defaultView ?? window;
    const bar = doc.createElement("div");
    bar.className = "ggt-mobile-bar";
    // 按下按钮不让编辑框失焦（失焦就保存退出编辑，键盘也收起来了）
    bar.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    bar.addEventListener("mousedown", (ev) => ev.preventDefault());
    const btn = (icon: string, fallback: string, title: string, run: () => void) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "ggt-mobile-btn";
      b.setAttribute("aria-label", title);
      if (this.host.setIcon) this.host.setIcon(b, icon);
      else b.textContent = fallback;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        run();
      });
      bar.append(b);
    };
    const sep = () => {
      const s = doc.createElement("span");
      s.className = "ggt-mobile-sep";
      bar.append(s);
    };
    btn("check", "✓", t("mbDone"), () => this.commit());
    // 编辑着有字的格子时长按交给系统（挪光标、选字、粘贴），表格菜单从这里出：收起编辑和键盘，对这一格弹菜单
    btn("more-horizontal", "⋯", t("mbMenu"), () => this.menuFromBar());
    btn("undo-2", "↶", t("mbUndo"), () => this.input.undo());
    btn("redo-2", "↷", t("mbRedo"), () => this.input.redo());
    sep();
    btn("bold", "B", t("fmtBold"), () => this.formatOrInsert({ kind: "bold" }, "**", "**"));
    btn("italic", "I", t("fmtItalic"), () => this.formatOrInsert({ kind: "italic" }, "*", "*"));
    btn("strikethrough", "S", t("fmtStrike"), () => this.formatOrInsert({ kind: "strike" }, "~~", "~~"));
    btn("highlighter", "H", t("fmtHighlight"), () => this.formatOrInsert({ kind: "highlight" }, "==", "=="));
    sep();
    btn("link-2", "[[", t("mbLink"), () => this.insertAround("[[", "]]"));
    btn("square-check", "☑", t("mbCheckbox"), () => this.toggleEditCheckbox());
    btn("corner-down-left", "↵", t("mbNewline"), () => this.insertAround("\n", ""));
    sep();
    btn("arrow-left", "←", t("mbPrevCell"), () => this.editNext(-1));
    btn("arrow-right", "→", t("mbNextCell"), () => this.editNext(1));
    doc.body.append(bar);
    // Obsidian 自己的编辑工具条（撤销、[[、标签、附件……）只管正文：编辑格子时它会叠在我们这条上面，先藏起来
    doc.body.classList.add("ggt-cell-editing");
    // 贴在键盘上方：键盘弹出时可见区域变矮（visualViewport），工具条的底边跟着它
    const vv = win.visualViewport;
    const place = () => {
      let bottom = vv ? Math.max(0, win.innerHeight - (vv.offsetTop + vv.height)) : 0;
      // 没弹软键盘（外接键盘、iPhone 镜像）：Obsidian 底部的浮动导航栏还在，工具条放到它上面，别被压住
      const nav = doc.querySelector<HTMLElement>(".mobile-navbar");
      const nb = nav && nav.offsetParent ? nav.getBoundingClientRect() : null;
      if (nb && nb.height && nb.top < win.innerHeight - bottom) bottom = Math.max(bottom, win.innerHeight - nb.top + 4);
      bar.style.setProperty("--ggt-kb", `${Math.round(bottom)}px`);
    };
    place();
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    this.mobileBarCleanup = () => {
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
    this.mobileBar = bar;
  }

  private menuFromBar(): void {
    const p = this.sel;
    if (!p) return;
    this.commit();
    this.touched = true;
    // 编辑时收起的圆点（拖着多选）重新放出来
    this.markSel();
    this.dropKeyboard();
    const box = this.cellEl(p)?.getBoundingClientRect();
    if (!box) return;
    this.openMenu(this.cellMenu(p), box.left, box.bottom + 8, () => this.touchAvoid());
  }

  /** 触屏上开表格菜单前收起软键盘：焦点在格子的输入框或正文编辑器里，键盘会一直弹着、挡住菜单 */
  private dropKeyboard(): void {
    const ae = this.root.ownerDocument.activeElement as HTMLElement | null;
    if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) ae.blur();
  }

  private hideMobileBar(): void {
    if (this.mobileBar) this.root.ownerDocument.body.classList.remove("ggt-cell-editing");
    this.mobileBarCleanup?.();
    this.mobileBarCleanup = null;
    this.mobileBar?.remove();
    this.mobileBar = null;
  }

  /** 选了字就给选中的字上格式；没选就插一对标记、光标放中间，接着打的字就是这个格式 */
  private formatOrInsert(fmt: InlineFormat, open: string, close: string): void {
    const { from, to } = this.input.visibleSelection();
    if (from !== to) this.applyFormat(fmt);
    else this.insertAround(open, close);
  }

  /** 在光标（选区）两边插入 open、close，光标留在中间；插 [[ ]] 时接着弹出笔记补全 */
  private insertAround(open: string, close: string): void {
    if (!this.editing) return;
    const el = this.input;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const v = el.value;
    el.value = v.slice(0, a) + open + v.slice(a, b) + close + v.slice(b);
    el.setSelectionRange(a + open.length, b + open.length);
    this.autosize();
    this.updateSuggest();
  }

  /** 格子开头加上 / 去掉勾选框 */
  private toggleEditCheckbox(): void {
    if (!this.editing) return;
    const el = this.input;
    const v = el.value;
    const next = CHECK_RE.test(v) ? v.replace(CHECK_RE, "").trimStart() : `[ ] ${v}`;
    el.value = next;
    el.setSelectionRange(next.length, next.length);
    this.autosize();
  }

  /** 保存这一格，接着编辑上一格 / 下一格（行尾接下一行开头，和 Tab 一样） */
  private editNext(dir: 1 | -1): void {
    if (!this.editing) return;
    this.commit();
    this.move(0, dir, true);
    this.startEdit(true);
  }

  /** ⌘K：选中的文字变成 [文字]()，光标放进括号里填网址 */
  private insertLink(): void {
    const el = this.input;
    const { selectionStart: a, selectionEnd: b, value: v } = el;
    const text = v.slice(a, b);
    el.value = `${v.slice(0, a)}[${text}]()${v.slice(b)}`;
    const pos = a + text.length + 3;
    el.setSelectionRange(pos, pos);
    this.autosize();
  }

  /** 看光标前面是不是在输 [[ 链接或 # 标签，是就弹出补全 */
  private updateSuggest(): void {
    if (!this.editing) return this.closeSuggest();
    const el = this.input;
    if (el.composing) return;
    // 中文输入法打出来的「【【」换成 [[、紧挨光标的「】】」换成 ]]（和 gogoga Mind Map 一样，省得切输入法）。长度不变，光标不用挪
    {
      const v = el.value;
      const caret = el.selectionStart;
      let text = v;
      const cn = text.slice(0, caret).lastIndexOf("【【");
      if (cn >= 0 && text.slice(0, caret).lastIndexOf("[[") < cn) text = text.slice(0, cn) + "[[" + text.slice(cn + 2);
      if (text.slice(0, caret).endsWith("】】")) text = text.slice(0, caret - 2) + "]]" + text.slice(caret);
      if (text !== v) {
        el.value = text;
        el.setSelectionRange(caret, caret);
      }
    }
    const before = el.value.slice(0, el.selectionStart);
    const link = /\[\[([^[\]|#^\n]*)$/.exec(before);
    const tag = /(?:^|\s)#([^\s#[\]|,.;:!?，。；：！？]*)$/.exec(before);
    let kind: "link" | "tag" | "option" | null = null;
    let query = "";
    let start = 0;
    if (link && this.host.suggestLinks) {
      kind = "link";
      query = link[1];
      start = before.length - link[1].length;
    } else if (tag && this.host.suggestTags) {
      kind = "tag";
      query = tag[1];
      start = before.length - tag[1].length;
    }
    const dataRow = !!this.sel && this.sel.r >= headRows(this.table) && !(hasTotal(this.table) && this.sel.r === rowCount(this.table) - 1);
    // 日期列：编辑时弹日历（正在输 [[ 链接、# 标签时让给补全）
    if (!kind && dataRow && this.sel && colTypeOf(this.table, this.sel.c)?.t === "date") {
      this.closeSuggestList();
      this.showCalendar();
      return;
    }
    this.closeCalendar();
    // 状态列：编辑时列出这一列已有的状态，按输入过滤
    const opts = dataRow && this.sel ? this.table.meta.opts?.[this.sel.c] : null;
    // 多选：只看光标所在的那一段（逗号隔开），已经选了的不再列
    let multi: { before: string[]; after: string[] } | undefined;
    if (!kind && opts && this.sel && colTypeOf(this.table, this.sel.c)?.t === "multi") {
      const caret = el.selectionStart;
      const v = el.value;
      const segStart = Math.max(v.lastIndexOf(",", caret - 1), v.lastIndexOf("，", caret - 1), v.lastIndexOf("、", caret - 1)) + 1;
      const restSep = v.slice(caret).search(/[,，、]/);
      const segEnd = restSep < 0 ? v.length : caret + restSep;
      multi = { before: splitTags(v.slice(0, segStart)), after: splitTags(v.slice(segEnd)) };
      const q = v.slice(segStart, segEnd).trim();
      const chosen = new Set([...multi.before, ...multi.after]);
      const left = Object.keys(opts).filter((x) => !chosen.has(x));
      // 光标停在一个完整的标签后面（刚开始编辑）：列出还没选的
      const items = !q || opts[q] ? left.filter((x) => x !== q) : left.filter((x) => x.toLowerCase().includes(q.toLowerCase()));
      if (!items.length) return this.closeSuggest();
      this.openSuggestList("option", segStart, items, multi);
      return;
    }
    if (!kind && opts) {
      kind = "option";
      query = el.value.trim();
      start = 0;
    }
    const items =
      kind === "link"
        ? (this.host.suggestLinks?.(query) ?? [])
        : kind === "tag"
          ? (this.host.suggestTags?.(query) ?? [])
          : kind === "option" && opts
            ? // 还是原来的值（刚开始编辑）或空着：列出全部；打了字就按字过滤
              !query || opts[query]
              ? Object.keys(opts)
              : Object.keys(opts).filter((x) => x.toLowerCase().includes(query.toLowerCase()))
            : [];
    if (!kind || !items.length) return this.closeSuggest();
    this.openSuggestList(kind, start, items);
  }

  /** 补全列表：multi（多选列）时默认不选中任何一项，Enter 照常完成编辑，按 ↓ 才挑 */
  private openSuggestList(kind: "link" | "tag" | "option", start: number, items: string[], multi?: { before: string[]; after: string[] }): void {
    const doc = this.root.ownerDocument;
    const box = this.suggest?.el ?? doc.body.appendChild(doc.createElement("div"));
    box.className = "ggt-suggest";
    box.replaceChildren();
    const first = multi ? -1 : 0;
    items.forEach((it, i) => {
      const row = box.appendChild(doc.createElement("div"));
      row.className = "ggt-suggest-item" + (i === first ? " is-active" : "");
      row.textContent = kind === "tag" ? `#${it}` : it;
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (this.suggest) this.suggest.index = i;
        this.acceptSuggest();
      });
    });
    const cell = this.sel && this.cellEl(this.sel);
    const r = (cell ?? this.input.el).getBoundingClientRect();
    box.setAttribute("style", `left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px`);
    this.suggest = { kind, start, items, index: first, el: box, multi };
  }

  /** 补全列表开着时的按键：上下选、Enter / Tab 确认、Esc 关掉。处理了返回 true */
  private onSuggestKey(ev: KeyboardEvent): boolean {
    const sg = this.suggest;
    if (!sg) return false;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      sg.index = sg.index < 0 && ev.key === "ArrowUp" ? sg.items.length - 1 : (sg.index + (ev.key === "ArrowDown" ? 1 : -1) + sg.items.length) % sg.items.length;
      Array.from(sg.el.children).forEach((c, i) => c.classList.toggle("is-active", i === sg.index));
      return true;
    }
    if (ev.key === "Enter" || ev.key === "Tab") {
      // 多选列表还没挑：交给 Enter / Tab 原来的作用（完成编辑、走格）
      if (sg.index < 0) {
        this.closeSuggest();
        return false;
      }
      this.acceptSuggest();
      return true;
    }
    if (ev.key === "Escape") {
      this.closeSuggest();
      return true;
    }
    return false;
  }

  private acceptSuggest(): void {
    const sg = this.suggest;
    if (!sg) return;
    const el = this.input;
    const v = el.value;
    const caret = el.selectionStart;
    const pick = sg.items[sg.index];
    let insert = pick;
    let rest = v.slice(caret);
    if (sg.kind === "option" && sg.multi) {
      const tags = [...sg.multi.before, pick, ...sg.multi.after];
      el.value = tags.join(", ") + ", ";
      el.setSelectionRange(el.value.length, el.value.length);
      this.closeSuggest();
      this.autosize();
      this.updateSuggest();
      return;
    }
    if (sg.kind === "option") {
      el.value = pick;
      el.setSelectionRange(pick.length, pick.length);
      this.closeSuggest();
      this.autosize();
      return;
    }
    if (sg.kind === "link") {
      // 后面已经有 ]] 就不再补
      if (rest.startsWith("]]")) rest = rest.slice(2);
      insert = `${pick}]]`;
    } else insert = `${pick} `;
    el.value = v.slice(0, sg.start) + insert + rest;
    const pos = sg.start + insert.length;
    el.setSelectionRange(pos, pos);
    this.closeSuggest();
    this.autosize();
  }

  private closeSuggest(): void {
    this.closeSuggestList();
    this.closeCalendar();
  }

  private closeSuggestList(): void {
    this.suggest?.el.remove();
    this.suggest = null;
  }

  // ---------- 日期列的日历 ----------

  private dailyNote() {
    return this.host.dailyNote?.() ?? null;
  }

  /** 排序日期列时读日记链接用 */
  private dateParser(): ((name: string) => Ymd | null) | undefined {
    const daily = this.dailyNote();
    return daily ? (n) => daily.parse(n) : undefined;
  }

  /** 编辑日期列的格子时在格子下面弹日历：格子里的日期选中、看它那个月；输入了新日期就跟着跳过去 */
  private showCalendar(): void {
    if (!this.sel) return;
    const daily = this.dailyNote();
    const picked = readDate(this.input.value, daily ? (n) => daily.parse(n) : undefined);
    const key = picked ? isoDate(picked) : "";
    const now = new Date();
    if (!this.cal) {
      const doc = this.root.ownerDocument;
      const el = doc.body.appendChild(doc.createElement("div"));
      el.className = "ggt-cal";
      // 点日历不让编辑框失焦（失焦就提交了）
      el.addEventListener("pointerdown", (e) => e.preventDefault());
      el.addEventListener("mousedown", (e) => e.preventDefault());
      this.cal = { el, y: picked?.y ?? now.getFullYear(), m: picked?.m ?? now.getMonth() + 1, key };
    } else if (key !== this.cal.key) {
      this.cal.key = key;
      if (picked) {
        this.cal.y = picked.y;
        this.cal.m = picked.m;
      }
    }
    this.renderCalendar(picked);
  }

  private renderCalendar(picked: Ymd | null): void {
    const cal = this.cal;
    if (!cal) return;
    const doc = this.root.ownerDocument;
    const el = cal.el;
    el.replaceChildren();
    const btn = (parent: HTMLElement, cls: string, text: string, run: () => void, label?: string) => {
      const b = parent.appendChild(doc.createElement("button"));
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      if (label) b.setAttribute("aria-label", label);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        run();
      });
      return b;
    };
    const shift = (k: number) => {
      const d = new Date(cal.y, cal.m - 1 + k, 1);
      cal.y = d.getFullYear();
      cal.m = d.getMonth() + 1;
      this.renderCalendar(picked);
    };
    const head = el.appendChild(doc.createElement("div"));
    head.className = "ggt-cal-head";
    btn(head, "ggt-cal-nav", "‹", () => shift(-1), t("calPrev"));
    const title = head.appendChild(doc.createElement("span"));
    title.className = "ggt-cal-title";
    title.textContent = t("calMonth").replace("{y}", String(cal.y)).replace("{m}", String(cal.m)).replace("{M}", new Date(cal.y, cal.m - 1, 1).toLocaleString("en", { month: "long" }));
    btn(head, "ggt-cal-nav", "›", () => shift(1), t("calNext"));
    const grid = el.appendChild(doc.createElement("div"));
    grid.className = "ggt-cal-grid";
    const weekStart = Number(t("calWeekStart"));
    const names = t("calWeekdays").split(",");
    for (let i = 0; i < 7; i++) grid.appendChild(doc.createElement("span")).textContent = names[(i + weekStart) % 7];
    for (const s of Array.from(grid.children)) (s as HTMLElement).className = "ggt-cal-wd";
    const first = new Date(cal.y, cal.m - 1, 1);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const now = new Date();
    const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    for (let i = 0; i < 42; i++) {
      const d = new Date(cal.y, cal.m - 1, 1 - lead + i);
      const v = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
      const b = btn(grid, "ggt-cal-day", String(v.d), () => this.pickDate(v), isoDate(v));
      if (v.m !== cal.m) b.classList.add("is-other");
      if (isoDate(v) === isoDate(today)) b.classList.add("is-today");
      if (picked && isoDate(v) === isoDate(picked)) b.classList.add("is-picked");
    }
    const foot = el.appendChild(doc.createElement("div"));
    foot.className = "ggt-cal-foot";
    btn(foot, "ggt-cal-btn", t("calToday"), () => this.pickDate(today));
    btn(foot, "ggt-cal-btn", t("calClear"), () => this.pickDate(null));
    // 放在格子下面，下面放不下就放上面
    const cell = this.sel && this.cellEl(this.sel);
    const r = (cell ?? this.input.el).getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    const box = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, vw - box.width - 8));
    const top = r.bottom + 4 + box.height > vh - 8 && r.top - 4 - box.height > 8 ? r.top - 4 - box.height : r.bottom + 4;
    el.setAttribute("style", `left:${Math.round(left)}px;top:${Math.round(top)}px`);
  }

  /** 日历里点了一天（null 是清空）：按列的写法写进格子并完成编辑 */
  private pickDate(v: Ymd | null): void {
    if (!this.editing || !this.sel) return;
    const ty = colTypeOf(this.table, this.sel.c);
    const daily = ty?.t === "date" && ty.f === "link" ? this.dailyNote() : null;
    // 用 reset 换文字：直接赋值在 CodeMirror 编辑框里算一次输入，提交完它又让这格进入编辑（空的），下一下就把日期清掉了
    this.input.reset(v ? writeDate(v, ty?.t === "date" ? ty.f : undefined, daily ? (x) => daily.name(x) : undefined) : "");
    this.commit();
    this.input.focus();
  }

  private closeCalendar(): void {
    this.cal?.el.remove();
    this.cal = null;
  }

  // ---------- 下拉填充 ----------

  /** 按住填充柄往下 / 上 / 左 / 右拖：虚线框出要填的地方，松开按规律填上，拖出表格就加行加列 */
  private fillDrag(ev: PointerEvent): void {
    const src = this.rangeRect();
    if (!src || this.host.readonly) return;
    ev.preventDefault();
    ev.stopPropagation();
    const handle = this.fillHandle;
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      // 合成事件
    }
    this.root.classList.add("is-filling");
    // copy：按住 ⌥ 拖是照抄（松开时按住也算）
    const state: { plan: { dir: FillDir; count: number } | null; copy: boolean } = { plan: null, copy: ev.altKey };
    // 每一行、每一列的屏幕位置（表格外面按最后一行 / 列的大小往外推）
    const rows = Array.from({ length: rowCount(this.table) }, (_, r) => this.lineBox(r, true));
    const cols = Array.from({ length: colCount(this.table) }, (_, c) => this.lineBox(c, false));
    const indexAt = (v: number, lines: { a: number; b: number }[]) => {
      for (let i = 0; i < lines.length; i++) if (v < lines[i].b) return i;
      const last = lines[lines.length - 1];
      return lines.length - 1 + Math.ceil((v - last.b) / Math.max(20, last.b - last.a));
    };
    const move = (e: PointerEvent) => {
      state.copy = e.altKey;
      this.root.classList.toggle("is-fill-copy", e.altKey);
      const r = indexAt(e.clientY, rows);
      const c = indexAt(e.clientX, cols);
      const down = r - src.r2;
      const up = src.r1 - r;
      const right = c - src.c2;
      const left = src.c1 - c;
      const best = Math.max(down, up, right, left);
      state.plan = best <= 0 ? null : best === down ? { dir: "down", count: down } : best === right ? { dir: "right", count: right } : best === up ? { dir: "up", count: up } : { dir: "left", count: left };
      this.showFillPreview(src, state.plan, rows, cols);
    };
    const up = (e?: PointerEvent) => {
      if (e && e.type === "pointerup") state.copy = e.altKey;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      this.root.classList.remove("is-filling", "is-fill-copy");
      this.fillPreview.classList.remove("is-shown");
      const p = state.plan;
      if (!p) return;
      const { table, filled } = fillRange(this.table, src, p.dir, p.count, state.copy);
      if (table === this.table) return;
      // 填完选中整片（原来的 + 填上的）
      this.apply(table, { r: filled.r2, c: filled.c2 });
      this.anchor = { r: filled.r1, c: filled.c1 };
      this.markSel();
    };
    const cancel = () => {
      state.plan = null;
      up();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  }

  /** 手指按住选区右下角的圆点拖：从选区左上角扩到手指下的格子，松手出菜单（合并在最上面） */
  private rangeDrag(ev: PointerEvent): void {
    const src = this.rangeRect();
    if (!src || this.host.readonly) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.closePopover();
    const handle = this.fillHandle;
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      // 合成事件
    }
    this.touched = true;
    const start = { r: src.r1, c: src.c1 };
    const rows = Array.from({ length: rowCount(this.table) }, (_, r) => this.lineBox(r, true));
    const cols = Array.from({ length: colCount(this.table) }, (_, c) => this.lineBox(c, false));
    const indexAt = (v: number, lines: { a: number; b: number }[]) => {
      for (let i = 0; i < lines.length; i++) if (v < lines[i].b) return i;
      return lines.length - 1;
    };
    let last = "";
    const move = (e: PointerEvent) => {
      const to = { r: Math.max(start.r, indexAt(e.clientY, rows)), c: Math.max(start.c, indexAt(e.clientX, cols)) };
      const key = `${to.r},${to.c}`;
      if (key === last) return;
      last = key;
      this.sel = start;
      this.anchor = null;
      this.setSel(to, false, true);
    };
    const up = (e?: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (!e || e.type !== "pointerup" || !this.sel) return;
      const b = handle.getBoundingClientRect();
      this.openMenu(this.cellMenu(this.sel), b.left, b.bottom + 10, () => this.touchAvoid());
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  /** 选区连同右下角圆点在屏幕上的上下边：触屏菜单避开这一段 */
  private touchAvoid(): { top: number; bottom: number } | undefined {
    const r = this.rangeRect();
    if (!r) return undefined;
    const a = this.cellEl({ r: r.r1, c: r.c1 })?.getBoundingClientRect();
    const f = this.fillHandle.classList.contains("is-shown") ? this.fillHandle.getBoundingClientRect() : null;
    if (!a) return undefined;
    const bottom = Math.max(this.lineBox(r.r2, true).b, f ? f.bottom + 12 : 0);
    return { top: a.top, bottom };
  }

  /** 第 i 行（或列）在屏幕上的起止 */
  private lineBox(i: number, row: boolean): { a: number; b: number } {
    if (row) {
      const tr = this.tableEl.rows[i];
      const b = tr?.getBoundingClientRect();
      return b ? { a: b.top, b: b.bottom } : { a: 0, b: 0 };
    }
    const b = this.colBox(i);
    return { a: b.left, b: b.right };
  }

  private showFillPreview(src: Rect, plan: { dir: FillDir; count: number } | null, rows: { a: number; b: number }[], cols: { a: number; b: number }[]): void {
    const pv = this.fillPreview;
    if (!plan) {
      pv.classList.remove("is-shown");
      return;
    }
    const ext = (lines: { a: number; b: number }[], i: number) => {
      if (i < lines.length && i >= 0) return lines[i];
      const last = lines[lines.length - 1];
      const size = Math.max(20, last.b - last.a);
      const k = i - (lines.length - 1);
      return { a: last.b + (k - 1) * size, b: last.b + k * size };
    };
    const r1 = plan.dir === "up" ? src.r1 - plan.count : plan.dir === "down" ? src.r2 + 1 : src.r1;
    const r2 = plan.dir === "down" ? src.r2 + plan.count : plan.dir === "up" ? src.r1 - 1 : src.r2;
    const c1 = plan.dir === "left" ? src.c1 - plan.count : plan.dir === "right" ? src.c2 + 1 : src.c1;
    const c2 = plan.dir === "right" ? src.c2 + plan.count : plan.dir === "left" ? src.c1 - 1 : src.c2;
    const top = ext(rows, Math.max(0, r1)).a;
    const bottom = ext(rows, r2).b;
    const left = ext(cols, Math.max(0, c1)).a;
    const right = ext(cols, c2).b;
    const base = this.scroller.getBoundingClientRect();
    const k = this.scale();
    pv.setAttribute("style", `left:${(left - base.left) / k + this.scroller.scrollLeft}px;top:${(top - base.top) / k + this.scroller.scrollTop}px;width:${(right - left) / k}px;height:${(bottom - top) / k}px`);
    pv.classList.add("is-shown");
  }

  // ---------- 复制粘贴 ----------

  /** 选区里的内容（被合并盖住的格子是空的） */
  private rangeGrid(): string[][] {
    const r = this.rangeRect();
    if (!r) return [];
    const grid: string[][] = [];
    for (let i = r.r1; i <= r.r2; i++) {
      const row: string[] = [];
      // 被合并盖住的格子按看到的样子复制成空的
      for (let j = r.c1; j <= r.c2; j++) row.push(isCovered(this.table, i, j) ? "" : shownText(this.table, i, j));
      grid.push(row);
    }
    return grid;
  }

  private onCopy(ev: ClipboardEvent, cut: boolean): void {
    if (this.editing || !this.sel || !ev.clipboardData) return;
    ev.preventDefault();
    // 只选了一个加密格子、已经解开：复制明文（30 秒后清掉）；选了一片还是复制密文
    if (!this.isMulti() && this.isSecretCell(this.sel)) {
      const plain = this.host.secrets?.()?.peek(this.table.cells[this.sel.r][this.sel.c]);
      if (typeof plain === "string" && plain) {
        ev.clipboardData.setData("text/plain", plain);
        this.host.notice?.(t("encCopied"));
        clearClipboardLater(this.root.ownerDocument.defaultView ?? window, plain);
        if (cut && !this.host.readonly) this.applyKeepRange(clearCells(this.table, this.rangeCells()));
        return;
      }
    }
    const grid = this.rangeGrid();
    const r = this.rangeRect();
    ev.clipboardData.setData("text/plain", toTSV(grid));
    ev.clipboardData.setData("text/html", r ? this.styledHTML(r, this.sourceOf(r)) : toHTML(grid, false));
    if (cut && !this.host.readonly) this.applyKeepRange(clearCells(this.table, this.rangeCells()));
  }

  /**
   * 带样式的 HTML：格子实际显示的底色、文字颜色、加粗、对齐、列宽、合并都写成内联样式，
   * 粘到 Word、飞书、邮件里保留样子。标上 data-ggt，粘回我们自己的表格时用纯文本（Markdown 原文）
   */
  /** 这片格子截成的表格原文（带设置注释）：至少 2 行 2 列才算一张表，不然返回 null */
  private sourceOf(rect: Rect): string[] | null {
    if (rect.r2 - rect.r1 < 1 || rect.c2 - rect.c1 < 1) return null;
    return serializeTable(subTable(this.table, rect));
  }

  /** 表格菜单里的复制：整张表带样式（粘到别的笔记原样还原），或者只要 Markdown 表格 */
  private copyWhole(markdownOnly: boolean): void {
    if (this.editing) this.commit();
    const tb = this.table;
    const lines = markdownOnly ? serializeTable({ ...tb, meta: {} }) : serializeTable(tb);
    const text = lines.join("\n");
    const win = this.root.ownerDocument.defaultView ?? window;
    const clip = win.navigator.clipboard;
    const done = () => this.host.notice?.(t(markdownOnly ? "copiedMarkdown" : "copiedTable"));
    // Markdown 表格也带一份不带颜色的 HTML 表格：Word、邮件认得出是表格；粘回 Obsidian 用的还是原文（不带设置注释）
    const html = this.styledHTML({ r1: 0, c1: 0, r2: rowCount(tb) - 1, c2: colCount(tb) - 1 }, lines, markdownOnly);
    const item = new win.ClipboardItem({
      "text/plain": new win.Blob([text], { type: "text/plain" }),
      "text/html": new win.Blob([html], { type: "text/html" }),
    });
    void clip.write([item]).then(done);
  }

  /**
   * 复制出去的 HTML 表格（粘到 Word、飞书、邮件）。颜色一律按浅色主题取、半透明的叠在白底上算成实色：
   * 暗色主题下屏幕上的表头、标签是深底浅字，原样带过去在白纸上很难看。plain：只要表格，不带任何颜色
   */
  private styledHTML(rect: Rect, source: readonly string[] | null = null, plain = false): string {
    const body = this.root.ownerDocument.body;
    const dark = body.classList.contains("theme-dark");
    // 同一个任务里切过去、取完色马上切回来，屏幕不会闪
    if (dark && !plain) body.classList.replace("theme-dark", "theme-light");
    try {
      return this.buildHTML(rect, source, plain);
    } finally {
      if (dark && !plain) body.classList.replace("theme-light", "theme-dark");
    }
  }

  private buildHTML(rect: Rect, source: readonly string[] | null, plain: boolean): string {
    const tb = this.table;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const win = this.root.ownerDocument.defaultView ?? window;
    const cols = Array.from(this.tableEl.querySelectorAll("col"));
    let html = `<table data-ggt="1"${source ? sourceAttr(source) : ""} style="border-collapse:collapse">`;
    html += "<colgroup>";
    const k = this.scale();
    for (let c = rect.c1; c <= rect.c2; c++) html += `<col style="width:${Math.round((cols[c] ? this.colBox(c).width || 80 * k : 80 * k) / k)}px">`;
    html += "</colgroup>";
    for (let r = rect.r1; r <= rect.r2; r++) {
      html += "<tr>";
      for (let c = rect.c1; c <= rect.c2; c++) {
        const m = mergeAt(tb, r, c);
        // 被合并盖住、而左上角也在复制范围里：不单独写
        if (m && (m.r1 !== r || m.c1 !== c) && m.r1 >= rect.r1 && m.c1 >= rect.c1) continue;
        const el = this.cellEl({ r, c });
        const cs = el ? win.getComputedStyle(el) : null;
        const styles = ["border:1px solid #d9d9d9", "padding:6px 10px", `vertical-align:${vAlignOf(tb, c) ?? "top"}`];
        const a = tb.align[c];
        if (a) styles.push(`text-align:${a}`);
        if (cs) {
          const bg = plain ? null : onWhite(cs.backgroundColor);
          if (bg && bg !== "rgb(255, 255, 255)") styles.push(`background-color:${bg}`);
          if (!plain && fgOf(tb, r, c)) styles.push(`color:${onWhite(cs.color) ?? cs.color}`);
          if (Number(cs.fontWeight) >= 600) styles.push("font-weight:600");
        }
        // 文字大小（整表 × 格子）：粘到 Word 里也大一号 / 小一号
        const size = (tb.meta.fs ?? 1) * (fontSizeOf(tb, r, c) ?? 1);
        if (!plain && size !== 1) styles.push(`font-size:${Math.round(size * 100)}%`);
        let span = "";
        if (m && m.r1 === r && m.c1 === c) {
          const cs2 = Math.min(m.c2, rect.c2) - c + 1;
          const rs2 = Math.min(m.r2, rect.r2) - r + 1;
          if (cs2 > 1) span += ` colspan="${cs2}"`;
          if (rs2 > 1) span += ` rowspan="${rs2}"`;
        }
        // 内容：格子里渲染出来的样子；勾选框换成符号，状态标签带上颜色
        let inner = esc(shownText(tb, r, c)).replace(/\n/g, "<br>");
        const content = el?.querySelector<HTMLElement>(".ggt-content");
        if (content && el && !el.classList.contains("is-editing")) {
          const clone = content.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("input.ggt-check").forEach((b) => b.replaceWith((b as HTMLInputElement).checked ? "☑ " : "☐ "));
          clone.querySelectorAll<HTMLElement>(".ggt-pill").forEach((pill, i) => {
            const orig = content.querySelectorAll<HTMLElement>(".ggt-pill")[i];
            const ps = orig && !plain ? win.getComputedStyle(orig) : null;
            if (ps) pill.setAttribute("style", `background:${onWhite(ps.backgroundColor) ?? ps.backgroundColor};color:${onWhite(ps.color) ?? ps.color};padding:0 8px;border-radius:10px`);
            else pill.removeAttribute("style");
          });
          clone.querySelectorAll("textarea").forEach((x) => x.remove());
          // Obsidian 渲染时外面包了一层 <p>：拆掉（多段的换成 <br>），粘到 Word 里不会多出段落间距
          clone.querySelectorAll(":scope > p").forEach((para, i) => {
            if (i > 0) para.before(clone.ownerDocument.createElement("br"));
            para.replaceWith(...Array.from(para.childNodes));
          });
          inner = clone.innerHTML;
        }
        const tag = r < headRows(this.table) ? "th" : "td";
        html += `<${tag}${span} style="${styles.join(";")}">${inner}</${tag}>`;
      }
      html += "</tr>";
    }
    return html + "</table>";
  }

  private onPaste(ev: ClipboardEvent): void {
    if (!this.sel || this.host.readonly || !ev.clipboardData) return;
    const grid = this.editing ? null : gridFromClipboard(ev.clipboardData, this.root.ownerDocument);
    // 截图、复制的图片：存成附件，格子里插 ![[…]]（剪贴板里是一张表时还是按表粘）
    const image = this.host.saveImage && !(grid && (grid.length > 1 || grid[0].length > 1)) ? imageFrom(ev.clipboardData) : null;
    if (image) {
      ev.preventDefault();
      void this.pasteImage(image);
      return;
    }
    if (!grid) return;
    ev.preventDefault();
    const r = this.rangeRect() ?? { r1: this.sel.r, c1: this.sel.c, r2: this.sel.r, c2: this.sel.c };
    // 复制了一格、选了一片：每格都填上（和 Excel 一样）
    if (grid.length === 1 && grid[0].length === 1 && this.isMulti()) {
      let next = this.table;
      for (const p of this.rangeCells()) {
        const m = mergeAt(next, p.r, p.c);
        if (!m || (m.r1 === p.r && m.c1 === p.c)) next = setCell(next, p.r, p.c, grid[0][0]);
      }
      this.applyKeepRange(next);
      return;
    }
    const next = pasteGrid(this.table, r.r1, r.c1, grid);
    this.anchor = null;
    this.apply(next, { r: r.r1, c: r.c1 });
    // 粘贴进来的那一片选中
    if (grid.length > 1 || grid[0].length > 1) this.setSel({ r: r.r1 + grid.length - 1, c: r.c1 + Math.max(...grid.map((x) => x.length)) - 1 }, true, true);
  }

  /** 从格子里去掉一张图的嵌入 ![[文件名]]（带 |100 这类尺寸的也算），前后多出的空格一起收掉 */
  private removeEmbed(p: Pos, link: string): void {
    const cur = shownText(this.table, p.r, p.c);
    const esc = link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = cur.replace(new RegExp(`[ \\t]?!\\[\\[${esc}(?:\\|[^\\]]*)?\\]\\]`), "").trim();
    if (next !== cur) this.apply(editCell(this.table, p.r, p.c, next), p);
  }

  /** 双击格子里的图片：盖住整个窗口看原图，点一下或按 Esc 关掉 */
  private openLightbox(img: HTMLImageElement): void {
    const doc = this.root.ownerDocument;
    if (doc.querySelector(".ggt-lightbox")) return;
    const box = doc.body.appendChild(doc.createElement("div"));
    box.className = "ggt-lightbox";
    const big = box.appendChild(doc.createElement("img"));
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    const close = () => {
      box.remove();
      doc.removeEventListener("keydown", onKey, true);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
    };
    box.addEventListener("click", close);
    doc.addEventListener("keydown", onKey, true);
  }

  /** 图片存好以后插进格子：编辑中插在光标处；只是选中就接在格子原有内容后面（不覆盖） */
  private async pasteImage(file: File): Promise<void> {
    const p = this.sel;
    const editing = this.editing;
    const from = editing ? this.input.selectionStart : 0;
    const to = editing ? this.input.selectionEnd : 0;
    const md = await this.host.saveImage?.(file);
    if (!md || this.destroyed || !p) return;
    if (editing && this.editing && this.sel?.r === p.r && this.sel.c === p.c) {
      const v = this.input.value;
      this.input.value = v.slice(0, from) + md + v.slice(to);
      this.input.setSelectionRange(from + md.length, from + md.length);
      this.autosize();
      return;
    }
    if (this.editing) this.commit();
    const cur = shownText(this.table, p.r, p.c);
    this.apply(editCell(this.table, p.r, p.c, cur.trim() ? `${cur} ${md}` : md), p);
  }

  // ---------- 触屏 ----------

  /**
   * 手指按在格子上：轻点是选中并进入编辑（键盘弹出来），滑动是滚动（什么都不做）。
   * 按住不动半秒：选中这一格；接着不松手拖，就从这一格框选到手指下的格子（群友在路上建议：右下角的圆点太难按），
   * 松手出菜单（框选了就是选区的菜单，「合并单元格」在最上面）；按住后没拖就松手，是这一格的菜单。
   * 不在按下时 preventDefault，滚动照常；长按生效后才拦住这次触摸的滚动
   */
  private touchStart(ev: PointerEvent, p: Pos): void {
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let moved = false;
    let pressed = false;
    let dragged = false;
    let lastX = x0;
    let lastY = y0;
    let rows: { a: number; b: number }[] = [];
    let cols: { a: number; b: number }[] = [];
    let last = "";
    const indexAt = (v: number, lines: { a: number; b: number }[]) => {
      for (let i = 0; i < lines.length; i++) if (v < lines[i].b) return i;
      return lines.length - 1;
    };
    const timer = window.setTimeout(() => {
      if (moved) return;
      pressed = true;
      this.longPressAt = performance.now();
      // 编辑着（空格子里长按）：先收起编辑，键盘下去，菜单不被挡
      if (this.editing) this.commit();
      this.touched = true;
      this.setSel(p, false);
      this.dropKeyboard();
      // 系统已经选上了的字（拦晚了）：清掉
      const ws = doc.getSelection();
      if (ws && !ws.isCollapsed && this.tableEl.contains(ws.anchorNode)) ws.removeAllRanges();
      this.root.classList.add("is-pressing");
      // 安卓上轻轻震一下：告诉手指「可以拖了」（iPhone 的浏览器不支持，有选中框变化）
      try {
        navigator.vibrate?.(10);
      } catch {
        // 不支持
      }
    }, 500);
    const measure = () => {
      rows = Array.from({ length: rowCount(this.table) }, (_, r) => this.lineBox(r, true));
      cols = Array.from({ length: colCount(this.table) }, (_, c) => this.lineBox(c, false));
    };
    const selectAt = (x: number, y: number) => {
      const to = { r: indexAt(y, rows), c: indexAt(x, cols) };
      const key = `${to.r},${to.c}`;
      if (key === last) return;
      last = key;
      this.sel = p;
      this.anchor = null;
      this.setSel(to, false, true);
    };
    // 框选时手指拖到边上：表格左右滚、笔记上下滚，选区跟着扩（群友在路上：拖出屏幕就选不到了）。
    // 越靠边滚得越快；底部多留一些（手机上 Obsidian 的工具栏盖在下面）
    const win = this.root.ownerDocument.defaultView ?? window;
    let raf = 0;
    const EDGE = 44;
    const EDGE_BOTTOM = 72;
    const speed = (depth: number, edge: number) => Math.ceil((Math.min(edge, Math.max(0, depth)) / edge) * 16);
    const tick = () => {
      raf = 0;
      if (!dragged) return;
      let dx = 0;
      let dy = 0;
      const sc = this.scroller;
      if (sc.scrollWidth > sc.clientWidth + 1) {
        const r = sc.getBoundingClientRect();
        if (lastX > r.right - EDGE && sc.scrollLeft < sc.scrollWidth - sc.clientWidth) dx = speed(lastX - (r.right - EDGE), EDGE);
        else if (lastX < r.left + EDGE && sc.scrollLeft > 0) dx = -speed(r.left + EDGE - lastX, EDGE);
      }
      if (!this.outer) this.findOuter?.();
      const out = this.outer;
      if (out && out.scrollHeight > out.clientHeight + 1) {
        const r = out.getBoundingClientRect();
        const vv = win.visualViewport;
        const top = Math.max(r.top, vv ? vv.offsetTop : 0);
        const bottom = Math.min(r.bottom, vv ? vv.offsetTop + vv.height : win.innerHeight);
        if (lastY > bottom - EDGE_BOTTOM && out.scrollTop < out.scrollHeight - out.clientHeight) dy = speed(lastY - (bottom - EDGE_BOTTOM), EDGE_BOTTOM);
        else if (lastY < top + EDGE && out.scrollTop > 0) dy = -speed(top + EDGE - lastY, EDGE);
      }
      if (dx) sc.scrollLeft += dx;
      if (dy) out!.scrollTop += dy;
      if (dx || dy) {
        measure();
        selectAt(lastX, lastY);
      }
      raf = win.requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      if (!pressed) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) > 8) {
          moved = true;
          window.clearTimeout(timer);
        }
        return;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      if (!dragged) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < 8) return;
        dragged = true;
        this.closePopover();
        measure();
        raf = win.requestAnimationFrame(tick);
      }
      selectAt(e.clientX, e.clientY);
    };
    // 长按生效后手指再动，浏览器会当成滚动页面（并取消这次触摸）：拦下来
    const block = (e: TouchEvent) => {
      if (pressed && e.cancelable) e.preventDefault();
    };
    // 系统的长按选字（iOS 按住半秒左右自己开始选字，会把一整行选上）：这次触摸期间不让它开始。
    // 正在编辑的输入框里照旧（挪光标、选字）
    const noSelect = (e: Event) => {
      if (!this.input.contains(e.target as Node)) e.preventDefault();
    };
    const doc = this.root.ownerDocument;
    const end = (e: PointerEvent) => {
      window.clearTimeout(timer);
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      this.tableEl.removeEventListener("pointermove", move);
      this.tableEl.removeEventListener("pointerup", end);
      this.tableEl.removeEventListener("pointercancel", end);
      this.tableEl.removeEventListener("touchmove", block);
      doc.removeEventListener("selectstart", noSelect, true);
      this.root.classList.remove("is-pressing");
      if (pressed) {
        if (!this.sel) return;
        if (dragged) this.openMenu(this.cellMenu(this.sel), lastX, lastY + 10, () => this.touchAvoid());
        else this.openMenu(this.cellMenu(p), x0, y0, () => this.touchAvoid());
        return;
      }
      if (moved || e.type === "pointercancel") return;
      const same = this.sel && this.sel.r === p.r && this.sel.c === p.c;
      if (same && this.editing) return;
      this.setSel(p, true);
      this.startEdit(true);
    };
    this.tableEl.addEventListener("pointermove", move);
    this.tableEl.addEventListener("pointerup", end);
    this.tableEl.addEventListener("pointercancel", end);
    this.tableEl.addEventListener("touchmove", block, { passive: false });
    doc.addEventListener("selectstart", noSelect, true);
  }

  // ---------- 列宽 ----------

  /** 指针离哪条列边线（每列的右边）不到 4 像素，就把调列宽的线放到那里；不在附近就藏起来 */
  private placeResizeBar(x: number, y: number): void {
    const bar = this.resizeBar;
    bar.classList.remove("is-touch");
    const t = this.tableEl.getBoundingClientRect();
    let hit = -1;
    let at = 0;
    // 指针在填充柄上：那是拖填充，不是调列宽（填充柄正好在选区右下角的列边线上）
    const fb = this.fillHandle.classList.contains("is-shown") ? this.fillHandle.getBoundingClientRect() : null;
    const onFill = !!fb && x >= fb.left - 4 && x <= fb.right + 4 && y >= fb.top - 4 && y <= fb.bottom + 4;
    if (!onFill && y >= t.top && y <= t.bottom && !this.root.classList.contains("is-dragging")) {
      // 指针所在的格子：合并格跨了几列，它里面的列分界线不能拖（点在合并格中间是点格子）
      const under = Array.from(this.tableEl.querySelectorAll<HTMLTableCellElement>(".ggt-cell")).find((el) => {
        const b = el.getBoundingClientRect();
        return x >= b.left - 4 && x <= b.right + 4 && y >= b.top && y <= b.bottom && el.colSpan > 1;
      });
      const c1 = under ? Number(under.dataset.c) : -1;
      const c2 = under ? c1 + under.colSpan - 1 : -1;
      const boxes = this.colBoxes();
      boxes.forEach((box, c) => {
        if (c >= c1 && c < c2) return;
        const right = box.right;
        if (hit < 0 && Math.abs(x - right) <= 4) {
          hit = c;
          at = right;
        }
      });
    }
    if (hit < 0) {
      bar.classList.remove("is-shown");
      return;
    }
    const base = this.root.getBoundingClientRect();
    bar.dataset.c = String(hit);
    const k = this.scale();
    bar.setAttribute("style", `left:${(at - base.left) / k - 4}px;top:${(t.top - base.top) / k}px;height:${t.height / k}px`);
    bar.classList.add("is-shown");
  }

  /**
   * 触屏上没有「鼠标移到列边线」：点选一格后，在这一列的右边线上放一个能拖的把手（同一根调列宽的线，带个圆点），
   * 拖动改列宽、双击恢复自动列宽。只在最近一次是用手指点的、选着一格时出现（轻点进了编辑也在，拖之前先保存这一格）
   */
  private placeTouchResize(): void {
    const bar = this.resizeBar;
    if (this.resize) return;
    const cell = this.touched && this.sel && !this.isMulti() && !this.host.readonly ? this.cellEl(this.sel) : null;
    if (!cell || !cell.isConnected) {
      if (bar.classList.contains("is-touch")) bar.classList.remove("is-shown", "is-touch");
      return;
    }
    const c = Number(cell.dataset.c) + ((cell as HTMLTableCellElement).colSpan || 1) - 1;
    const col = this.tableEl.querySelectorAll("col")[c];
    if (!col) return;
    const t = this.tableEl.getBoundingClientRect();
    const base = this.root.getBoundingClientRect();
    const k = this.scale();
    const at = this.colBox(c).right;
    bar.dataset.c = String(c);
    bar.setAttribute("style", `left:${(at - base.left) / k - 4}px;top:${(t.top - base.top) / k}px;height:${t.height / k}px`);
    // 把手的圆点放在选中那一格的高度上，手指好找
    const cb = cell.getBoundingClientRect();
    bar.style.setProperty("--ggt-grip-y", `${(cb.top + cb.height / 2 - t.top) / k}px`);
    bar.classList.add("is-shown", "is-touch");
  }

  private startResize(ev: PointerEvent, handle: HTMLElement): void {
    if (this.host.readonly) return;
    ev.preventDefault();
    ev.stopPropagation();
    // 触屏上编辑着就拖把手：先把这一格存了，改完列宽重画时不丢字
    if (this.editing) this.commit();
    const c = Number(handle.dataset.c);
    const col = this.tableEl.querySelectorAll("col")[c];
    if (!col || Number.isNaN(c)) return;
    const k = this.scale();
    this.resize = { c, startX: ev.clientX, startW: this.colBox(c).width / k, col, fitW: this.root.classList.contains("is-fit") ? parseFloat(this.tableEl.style.width) || 0 : 0, scale: this.fitScale };
    const startLeft = parseFloat(handle.style.left) || 0;
    // 触屏把手的圆点高度（重写 style 时别丢了）
    const grip = handle.style.getPropertyValue("--ggt-grip-y");
    handle.classList.add("is-active");
    this.root.classList.add("is-resizing");
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      // 合成事件
    }
    const move = (e: PointerEvent) => {
      const r = this.resize;
      if (!r) return;
      const w = Math.max(40, Math.round(r.startW + (e.clientX - r.startX) / k));
      r.col.style.width = `${w}px`;
      // 按比例缩着的表（table-layout: fixed、总宽写死）：总宽跟着这一列变，别的列不动
      if (r.fitW) this.tableEl.style.width = `${r.fitW - r.startW + w}px`;
      // 线跟着鼠标走
      const tr = this.tableEl.getBoundingClientRect();
      const base = this.root.getBoundingClientRect();
      handle.setAttribute("style", `left:${startLeft + (w - r.startW)}px;top:${(tr.top - base.top) / k}px;height:${tr.height / k}px`);
      if (grip) handle.style.setProperty("--ggt-grip-y", grip);
      this.placeHandles();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.classList.remove("is-active");
      this.root.classList.remove("is-resizing");
      const r = this.resize;
      this.resize = null;
      if (!r) return;
      const w = parseFloat(r.col.style.width);
      if (Math.abs(w - r.startW) < 1) {
        this.fitCols();
        return;
      }
      // 开着「列宽按比例缩放」时，拖得表格比正文宽了：用户就是想让这张表左右滑动，记下来，以后不缩它（群里反馈）；
      // 拖回正文以内就去掉，又跟着缩放。缩着拖的那次，各列按眼前看到的宽度存，松手后和拖到的一样宽
      // 没开这个设置：不记也不清，留着这张表原来的标记
      const fit = this.root.dataset.defFit === "1";
      const avail = this.availWidth();
      const wide = fit && avail > 0 && this.tableEl.offsetWidth > avail + 1;
      if (wide) this.apply(setWide(r.scale !== 1 ? setWidths(this.table, this.colWidths()) : setWidth(this.table, r.c, w), true));
      else {
        // 缩着拖的：看到的宽度换算回没缩时的宽度再存，重新缩放后和拖到的差不多
        const n = setWidth(this.table, r.c, Math.round(w / r.scale));
        this.apply(fit ? setWide(n, false) : n);
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  // ---------- 手柄、加号 ----------

  private handle(cls: string, label: string, icon: string): HTMLElement {
    const doc = this.root.ownerDocument;
    const el = this.root.appendChild(doc.createElement("button"));
    el.type = "button";
    el.className = `ggt-handle ${cls}`;
    el.dataset.ignoreSwipe = "true";
    el.setAttribute("aria-label", label);
    el.tabIndex = -1;
    if (this.host.setIcon) this.host.setIcon(el, icon);
    else el.textContent = cls.includes("row") ? "⋮" : "⋯";
    const row = cls.includes("row");
    // 轻点打开行 / 列菜单；按住拖动换位置（和原生表格一样）
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.button !== 0 || el.dataset.r === undefined) return;
      const p = { r: Number(el.dataset.r), c: Number(el.dataset.c) };
      this.handleDrag(ev, el, row, p);
    });
    el.addEventListener("click", (ev) => ev.preventDefault());
    return el;
  }

  /** 按住行 / 列手柄：拖出去超过几像素就是拖动换位置，否则松开时打开菜单 */
  private handleDrag(ev: PointerEvent, handle: HTMLElement, row: boolean, p: Pos): void {
    if (this.editing) this.commit();
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const from = row ? p.r : p.c;
    let dragging = false;
    let target: number | null = null;
    const doc = this.root.ownerDocument;
    const line = doc.createElement("div");
    line.className = "ggt-drop-line" + (row ? " is-row" : " is-col");
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      // 合成事件
    }
    const marked = () => Array.from(this.tableEl.querySelectorAll<HTMLElement>(row ? `.ggt-cell[data-r="${from}"]` : `.ggt-cell[data-c="${from}"]`));
    /** 指针落在第几条缝上（0 = 第一行 / 列前面），返回挪过去以后的下标 */
    const slotAt = (x: number, y: number): { index: number; at: number } => {
      const cells = row
        ? Array.from({ length: rowCount(this.table) - 1 }, (_, i) => this.cellEl({ r: i + 1, c: 0 }))
        : Array.from({ length: colCount(this.table) }, (_, c) => this.cellEl({ r: 0, c }));
      const rects = cells.map((c) => c?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
      let slot = rects.length;
      for (let i = 0; i < rects.length; i++) {
        const mid = row ? rects[i].top + rects[i].height / 2 : rects[i].left + rects[i].width / 2;
        if ((row ? y : x) < mid) {
          slot = i;
          break;
        }
      }
      const edge = slot < rects.length ? (row ? rects[slot].top : rects[slot].left) : row ? rects[rects.length - 1].bottom : rects[rects.length - 1].right;
      // 行的下标从 1 开始（第 0 行是表头）
      const fromIdx = row ? from - 1 : from;
      const dest = slot > fromIdx ? slot - 1 : slot;
      return { index: row ? dest + 1 : dest, at: edge };
    };
    // 表头必须在第一行：表头的行手柄拖不动，只能点开菜单
    const fixed = row && from === 0;
    const move = (e: PointerEvent) => {
      if (fixed) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
        dragging = true;
        this.root.classList.add("is-dragging");
        for (const c of marked()) c.classList.add("is-drag-source");
        this.root.appendChild(line);
      }
      const { index, at } = slotAt(e.clientX, e.clientY);
      target = index;
      const base = this.root.getBoundingClientRect();
      const t = this.tableEl.getBoundingClientRect();
      const k = this.scale();
      if (row) line.setAttribute("style", `top:${(at - base.top) / k - 1}px;left:${(t.left - base.left) / k}px;width:${t.width / k}px`);
      else line.setAttribute("style", `left:${(at - base.left) / k - 1}px;top:${(t.top - base.top) / k}px;height:${t.height / k}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      line.remove();
      this.root.classList.remove("is-dragging");
      for (const c of marked()) c.classList.remove("is-drag-source");
      if (!dragging) {
        // 点手柄：选中整行 / 整列，再打开菜单
        // 选区的两头直接给，不经过 setSel：合并格会把起点挪到它的左上角（别的行），整行就选歪了
        if (this.editing) this.commit();
        this.anchor = row ? { r: p.r, c: 0 } : { r: 0, c: p.c };
        this.sel = row ? { r: p.r, c: colCount(this.table) - 1 } : { r: this.shownRows() - 1, c: p.c };
        this.lineSel = true;
        this.markSel();
        // 手机上点手柄只是要菜单：不聚焦输入框（会弹键盘把菜单挡住），已经弹着的键盘也收起来
        if (ev.pointerType === "touch") (doc.activeElement as HTMLElement | null)?.blur?.();
        else this.input.focus();
        const rect = handle.getBoundingClientRect();
        this.openMenu(row ? this.rowMenu(p) : this.colMenu(p), rect.left, rect.bottom + 4);
        return;
      }
      if (target === null || target === from) return;
      if (row) this.apply(moveRow(this.table, from, target), { r: target, c: p.c });
      else this.apply(moveCol(this.table, from, target), { r: p.r, c: target });
    };
    const cancel = () => {
      dragging = false;
      target = null;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      line.remove();
      this.root.classList.remove("is-dragging");
      for (const c of marked()) c.classList.remove("is-drag-source");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  }

  private addButton(cls: string, label: string, run: () => void): HTMLElement {
    const doc = this.root.ownerDocument;
    const el = this.root.appendChild(doc.createElement("button"));
    el.type = "button";
    el.className = `ggt-add ${cls}`;
    el.setAttribute("aria-label", label);
    el.tabIndex = -1;
    if (this.host.setIcon) this.host.setIcon(el, "plus");
    else el.textContent = "+";
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (this.host.readonly) return;
      // 正在编辑格子（按下时特意没让编辑框失焦，所以还没保存）：先把这一格存进表格，再按存好的表格加行加列。
      // 不然 run() 里按旧表格算出加了一行的新表，刚输入的字就丢了（群友反馈）
      if (this.editing) this.commit();
      run();
    });
    return el;
  }

  /** 行手柄放在悬停（或选中）那一行的左边框上，列手柄放在那一列的上边框上 */
  /** 滚动区域在屏幕上看得见的那一块（表格横向 / 纵向滚动时，手柄不能跟着跑到外面去） */
  private visibleBox(): { left: number; top: number; right: number; bottom: number } {
    const sc = this.scroller;
    const r = sc.getBoundingClientRect();
    const k = this.scale();
    const left = r.left + sc.clientLeft * k;
    const top = r.top + sc.clientTop * k;
    return { left, top, right: left + sc.clientWidth * k, bottom: top + sc.clientHeight * k };
  }

  private placeHandles(): void {
    const vis = this.visibleBox();
    {
      const base = this.root.getBoundingClientRect();
      const tr = this.tableEl.getBoundingClientRect();
      const k = this.scale();
      // 表格滚动了：左上角按钮贴在看得见的左上角，不跟着滚出去
      const x = Math.max(tr.left, vis.left);
      const y = Math.max(tr.top, vis.top);
      this.cornerBtn.setAttribute("style", `left:${(x - base.left) / k}px;top:${(y - base.top) / k}px`);
    }
    const off = () => {
      this.rowHandle.classList.remove("is-shown");
      this.colHandle.classList.remove("is-shown");
    };
    if (this.host.readonly || this.resize) return off();
    // 和原生表格一样：鼠标在第一列（横向滚过时是看得见的最左一列）才有这一行的行手柄，在表头行才有这一列的列手柄（#2）。
    // 用手柄选了整行 / 整列（菜单开着）时，那个手柄留着；触屏没有悬停，跟着选中的格子显示
    const head = Math.max(1, headRows(this.table));
    const h = this.hover;
    const line = this.lineSel && this.anchor && this.sel ? { a: this.anchor, b: this.sel } : null;
    const lineRow = line && line.a.r === line.b.r ? { r: line.a.r, c: 0 } : null;
    const lineCol = line && line.a.c === line.b.c ? { r: 0, c: line.a.c } : null;
    const touchSel = this.touched && !h ? this.sel : null;
    // 第一列横向滚出去了：看得见的最左边那一格也算行首；左边的格子都被合并占了也算
    const atRowStart = (q: Pos) => {
      if (q.c === 0) return true;
      // 第一列是从上一行合并下来的（这一行左边没有自己的格子）：这一行最左边画出来的那格就是行首
      let covered = true;
      for (let c = 0; c < q.c && covered; c++) covered = isCovered(this.table, q.r, c);
      if (covered) return true;
      const el = this.cellEl(q);
      return !!el && el.getBoundingClientRect().left <= vis.left + 1;
    };
    // 折着时没有行手柄（藏着的行挪不了，表头行也不让在折着时挪）
    const rowP = this.folded() ? null : ((h && atRowStart(h) ? h : null) ?? lineRow ?? touchSel);
    const colP = (h && h.r < head ? h : null) ?? lineCol ?? touchSel;
    this.rowHandle.classList.toggle("is-shown", !!rowP);
    this.colHandle.classList.toggle("is-shown", !!colP);
    const base = this.root.getBoundingClientRect();
    const k = this.scale();
    if (rowP) {
      const first = this.cellEl({ r: rowP.r, c: 0 });
      if (!first) this.rowHandle.classList.remove("is-shown");
      else {
        const fr = first.getBoundingClientRect();
        // 行手柄贴在看得见的左边；这一行上下滚出去了就藏起来
        const rowMid = fr.top + fr.height / 2;
        if (rowMid < vis.top || rowMid > vis.bottom) this.rowHandle.classList.remove("is-shown");
        this.rowHandle.style.top = `${(rowMid - base.top) / k}px`;
        this.rowHandle.style.left = `${(Math.max(fr.left, vis.left) - base.left) / k}px`;
        this.rowHandle.dataset.r = String(rowP.r);
        this.rowHandle.classList.toggle("is-fixed", rowP.r < headRows(this.table));
        this.rowHandle.dataset.c = String(rowP.c);
      }
    }
    if (colP) {
      const headCell = this.cellEl({ r: 0, c: colP.c });
      if (!headCell) this.colHandle.classList.remove("is-shown");
      else {
        const hr = headCell.getBoundingClientRect();
        // 列手柄：这一列左右滚出去了就藏起来
        const colMid = hr.left + hr.width / 2;
        if (colMid < vis.left || colMid > vis.right) this.colHandle.classList.remove("is-shown");
        this.colHandle.style.left = `${(colMid - base.left) / k}px`;
        // 手柄骑在表头上边线上（一半在外面）。吸顶时上边线贴着外面滚动区的顶端，露在外面的半截会被裁掉：
        // 最高放到顶端往下半个手柄的地方，整个落在表头里
        const outerTop = this.outer ? this.outer.getBoundingClientRect().top : -Infinity;
        const half = (this.colHandle.offsetHeight * k) / 2 + 1;
        const top = Math.max(hr.top, vis.top, outerTop + half);
        this.colHandle.style.top = `${(top - base.top) / k}px`;
        this.colHandle.dataset.r = String(colP.r);
        this.colHandle.dataset.c = String(colP.c);
      }
    }
  }

  /** 滚动中：忘掉悬停的格子、藏起手柄（菜单开着、整行整列选着的不动） */
  private hideHandlesForScroll(): void {
    this.scrolledAt = performance.now();
    if (this.popover) return;
    this.hover = null;
  }

  // ---------- 菜单 ----------

  /** 整张表的菜单（左上角按钮） */
  private tableMenu(): MenuItem[] {
    const tb = this.table;
    const keep = (next: Table) => this.applyKeepRange(next);
    const look = (style: TableStyle | null): MenuItem => ({
      title: style ? t(`style_${style}`) : t("followSettings"),
      checked: (tb.meta.style ?? null) === style,
      run: () => keep(setTableLook(this.table, { style })),
    });
    const dens = (density: TableDensity | null): MenuItem => ({
      title: density ? t(`density_${density}`) : t("followSettings"),
      checked: (tb.meta.density ?? null) === density,
      run: () => keep(setTableLook(this.table, { density })),
    });
    const align = (a: Align, title: string, icon: string): MenuItem => ({
      title,
      icon,
      inline: true,
      checked: tb.align.every((x) => (x ?? "left") === a),
      run: () => keep(alignAll(this.table, a)),
    });
    return [
      { title: t("tableStyle") },
      look(null),
      ...TABLE_STYLES.map((x) => look(x)),
      { separator: true },
      { title: t("rowSpacing") },
      dens(null),
      ...TABLE_DENSITIES.map((x) => dens(x)),
      ...this.sizeItems(t("tableFontSize"), tb.meta.fs ?? 1, (v) => keep(setTableFontSize(this.table, v))),
      { separator: true },
      { title: t("align") },
      align("left", t("alignAllLeft"), "align-left"),
      align("center", t("alignAllCenter"), "align-center"),
      align("right", t("alignAllRight"), "align-right"),
      ...(["top", "middle", "bottom"] as const).map((v): MenuItem => {
        const val: VAlign | null = v === "top" ? null : v;
        return {
          title: t(`vAlignAll_${v}`),
          icon: V_ICONS[v],
          inline: true,
          checked: Array.from({ length: colCount(tb) }, (_, c) => vAlignOf(tb, c)).every((x) => x === val),
          run: () => keep(vAlignAll(this.table, val)),
        };
      }),
      { separator: true },
      // 表头行数排成一排（1 2 3），菜单矮一些，矮窗口里不用滚
      ...Array.from({ length: MAX_HEAD_ROWS }, (_, i): MenuItem => ({
        chipText: String(i + 1),
        rowLabel: i === 0 ? t("headerRows") : undefined,
        title: t("headerRowsN").replace("{n}", String(i + 1)),
        checked: headRows(tb) === i + 1,
        disabled: headRows(tb) !== i + 1 && !canSetHead(tb, i + 1),
        why: rowCount(tb) - (i + 1) < 1 ? t("whyHeadRowsFew").replace("{n}", String(i + 1)) : t("whyHeadRowsMerge").replace("{n}", String(i + 1)),
        run: () => keep(setTableLook(this.table, { head: i + 1 })),
      })),
      { separator: true },
      {
        title: t("foldTable"),
        icon: "chevrons-down-up",
        checked: tb.meta.fold === 1,
        disabled: tb.meta.fold !== 1 && rowCount(tb) <= headRows(tb),
        why: t("whyFoldNoRows"),
        run: () => {
          this.localUnfold = false;
          keep(setFolded(this.table, this.table.meta.fold !== 1));
        },
      },
      { title: t("headerColumn"), icon: "panel-left", checked: !!tb.meta.headerCol, run: () => keep(setTableLook(this.table, { headerCol: !this.table.meta.headerCol })) },
      // 冻结是标题列的选项：标题列开着才出现
      ...(tb.meta.headerCol ? [{ title: t("freezeHeaderCol"), icon: "pin", checked: tb.meta.freeze === 1, run: () => keep(setTableLook(this.table, { freeze: this.table.meta.freeze !== 1 })) }] : []),
      { separator: true },
      { title: t("distributeCols"), icon: "columns-3", run: () => keep(setWidths(this.table, this.colWidths().map((_, _i, all) => all.reduce((a, b) => a + b, 0) / all.length))) },
      { title: t("fitWidth"), icon: "move-horizontal", run: () => keep(setWide(setWidths(this.table, this.fitWidths()), false)) },
      // 没拖过列宽、没上过色时不出现（灰着不说原因，会被当成功能坏了）
      ...(tb.meta.w?.some((x) => x != null) ? [{ title: t("autoWidthAll"), icon: "move-horizontal", run: () => keep(autoWidthAll(this.table)) }] : []),
      ...(Object.keys(tb.meta.bg ?? {}).length || Object.keys(tb.meta.fg ?? {}).length ? [{ title: t("clearAllBg"), icon: "paintbrush", run: () => keep(clearAllBg(this.table)) }] : []),
      { separator: true },
      { title: t("copyTable"), icon: "copy", run: () => this.copyWhole(false) },
      { title: t("copyMarkdown"), icon: "file-code", run: () => this.copyWhole(true) },
      ...(this.host.indentTable
        ? [
            { separator: true },
            // 表格上方是列表项才能缩进、本来在列表里才能减少缩进：用不了的不出现
            ...([1, -1] as const).filter((dir) => this.host.canIndentTable?.(dir)).map((dir): MenuItem => ({
              title: t(dir > 0 ? "indentTable" : "outdentTable"),
              icon: dir > 0 ? "indent-increase" : "indent-decrease",
              run: () => {
                if (this.editing) this.commit();
                this.host.indentTable?.(dir);
              },
            })),
          ]
        : []),
      ...(this.host.onDeleteTable
        ? [
            { separator: true },
            {
              title: t("deleteTable"),
              icon: "trash-2",
              danger: true,
              run: () => {
                if (this.editing) this.cancel();
                this.host.onDeleteTable?.();
              },
            },
          ]
        : []),
    ];
  }

  /**
   * 第 c 列在屏幕上的左右边：Chromium 量 <col> 就行；iPhone、iPad（WebKit）上 <col> 量出来一律是 0，
   * 这时用这一列的格子（不跨列的那种；都被合并盖住时取格子的边线）算。调列宽的把手就是按它放的，
   * 以前在手机上全跑到表格最左边，一拖就成了 Obsidian 拉出侧栏的手势（小红书反馈）
   */
  /**
   * 旧内核（Chromium 114 这类：Electron 25 的老安装器，Windows 上常见）量 <col> 时，每一列的位置都报成表格的左边，只有宽度对。
   * 拿它判断列边线，拖列宽的触发点、十字高亮都会往左错（#22）。量到第二列没接在第一列后面，就改量格子。
   * 内核不会中途变，判断一次就记住；还没画出来（宽度为 0）时先不下结论
   */
  private colRectsOk: boolean | null = null;
  private colRectsUsable(): boolean {
    if (this.colRectsOk !== null) return this.colRectsOk;
    const cols = this.tableEl.querySelectorAll("col");
    if (cols.length < 2) return true;
    const a = cols[0].getBoundingClientRect();
    const b = cols[1].getBoundingClientRect();
    if (!(a.width > 0 && b.width > 0)) return true;
    this.colRectsOk = Math.abs(b.left - a.right) < 2;
    return this.colRectsOk;
  }

  private colBox(c: number): { left: number; right: number; width: number } {
    const col = this.tableEl.querySelectorAll("col")[c];
    const b = col?.getBoundingClientRect();
    if (b && b.width > 0 && this.colRectsUsable()) return { left: b.left, right: b.right, width: b.width };
    return this.cellColBoxes(c)[c] ?? { left: 0, right: 0, width: 0 };
  }

  /** 每列的屏幕起止（要一次拿全部列时用：量格子只扫一遍） */
  private colBoxes(): { left: number; right: number; width: number }[] {
    const cols = Array.from(this.tableEl.querySelectorAll("col"));
    const rects = cols.map((col) => col.getBoundingClientRect());
    if (rects.every((b) => b.width > 0) && this.colRectsUsable()) return rects.map((b) => ({ left: b.left, right: b.right, width: b.width }));
    const fromCells = this.cellColBoxes();
    return cols.map((_c, i) => fromCells[i] ?? (rects[i].width > 0 ? { left: rects[i].left, right: rects[i].right, width: rects[i].width } : { left: 0, right: 0, width: 0 }));
  }

  /** 从格子量每列的起止（合并格只算它两头那一列）。只要第 only 列时找到就停 */
  private cellColBoxes(only?: number): ({ left: number; right: number; width: number } | undefined)[] {
    const n = this.tableEl.querySelectorAll("col").length;
    const left: number[] = new Array<number>(n).fill(NaN);
    const right: number[] = new Array<number>(n).fill(NaN);
    let missing = only === undefined ? 2 * n : 2;
    const want = (i: number) => only === undefined || i === only;
    for (const el of Array.from(this.tableEl.querySelectorAll<HTMLTableCellElement>(".ggt-cell"))) {
      const c0 = Number(el.dataset.c);
      const c1 = c0 + (el.colSpan || 1) - 1;
      if (!(c0 >= 0 && c0 < n)) continue;
      if (!want(c0) && !want(c1)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (want(c0) && Number.isNaN(left[c0])) {
        left[c0] = r.left;
        missing--;
      }
      if (c1 < n && want(c1) && Number.isNaN(right[c1])) {
        right[c1] = r.right;
        missing--;
      }
      if (missing <= 0) break;
    }
    return left.map((l, i) => (Number.isNaN(l) || Number.isNaN(right[i]) ? undefined : { left: l, right: right[i], width: right[i] - l }));
  }

  /** 每列现在实际的宽度 */
  private colWidths(): number[] {
    const k = this.scale();
    return this.colBoxes().map((b) => b.width / k);
  }

  /**
   * 设置「列宽按比例缩放」（#10）：设过列宽的表格比正文宽时，各列按现在的比例缩到正好放下，不出横向滚动条。
   * 只改显示（col 的 style），文件里还是原来的像素列宽。每列最窄 MIN_FIT_COL，列太多缩不下的照样横向滚动
   */
  private fitCols(): void {
    const tb = this.table;
    const t = this.tableEl;
    const cols = Array.from(t.querySelectorAll<HTMLElement>("colgroup > col"));
    if (this.fitScale !== 1 || this.root.classList.contains("is-fit")) {
      cols.forEach((col, c) => {
        const w = widthOf(tb, c);
        col.style.width = w ? `${w}px` : "";
      });
      t.style.removeProperty("width");
      this.root.classList.remove("is-fit");
      this.fitScale = 1;
    }
    if (this.root.dataset.defFit !== "1" || tb.meta.wide || !tb.meta.w?.some((x) => x != null) || this.resize) return;
    const avail = this.availWidth();
    const natural = t.offsetWidth;
    if (avail <= 0 || !natural || natural <= avail + 1) return;
    const k = this.scale();
    const all = this.colBoxes();
    const ws = cols.map((_c, i) => (all[i]?.width ?? 0) / k);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (!sum) return;
    const f = avail / sum;
    const px = ws.map((w) => Math.max(MIN_FIT_COL, Math.floor(w * f)));
    cols.forEach((col, c) => (col.style.width = `${px[c]}px`));
    t.style.width = `${px.reduce((a, b) => a + b, 0)}px`;
    this.root.classList.add("is-fit");
    this.fitScale = f;
  }

  /** 正文给表格的宽度（量外层，表格自己比它宽时就要横向滚动） */
  private availWidth(): number {
    const host = this.root.parentElement;
    return host ? host.clientWidth - 2 - this.mobileRoom() : 0;
  }

  /** 手机、平板上加号收在正文里（外框不往右伸出，见 styles.css），表格能用的宽度少这一截 */
  private mobileRoom(): number {
    return this.root.ownerDocument.body.classList.contains("is-mobile") ? 26 : 0;
  }

  /** 撑满页面：按现在各列的比例放大 / 缩小到正文的可用宽度 */
  private fitWidths(): number[] {
    const ws = this.colWidths();
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    const host = this.root.parentElement;
    // 表格外层左右各有一点留白（放手柄、加号）
    const avail = (host?.clientWidth ?? sum) - 4 - this.mobileRoom();
    return ws.map((w) => (w / sum) * avail);
  }

  /**
   * 灰掉、又写了原因的项：不用原生 disabled（点了什么事件都没有），改成看着灰、悬停显示原因、
   * 点一下弹提示（手机上没有悬停）。处理了返回 true，调用方就不再挂执行的点击
   */
  private explainDisabled(b: HTMLButtonElement, item: MenuItem): boolean {
    if (!item.disabled || !item.why) return false;
    const why = item.why;
    b.disabled = false;
    b.classList.add("is-disabled");
    b.setAttribute("aria-disabled", "true");
    b.title = why;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.host.notice?.(why);
    });
    return true;
  }

  private rowMenu(p: Pos): MenuItem[] {
    const tb = this.table;
    const head = p.r < headRows(tb);
    return [
      ...this.insertRowItems(p),
      { title: t("duplicateRow"), icon: "copy-plus", disabled: p.r === 0, why: t("whyDupHead"), run: () => this.apply(duplicateRow(tb, p.r), { r: p.r + 1, c: p.c }) },
      { separator: true },
      { title: t("moveRowUp"), icon: "arrow-up", disabled: head || moveRow(tb, p.r, p.r - 1) === tb, run: () => this.apply(moveRow(tb, p.r, p.r - 1), { r: p.r - 1, c: p.c }) },
      { title: t("moveRowDown"), icon: "arrow-down", disabled: head || moveRow(tb, p.r, p.r + 1) === tb, run: () => this.apply(moveRow(tb, p.r, p.r + 1), { r: p.r + 1, c: p.c }) },
      { separator: true },
      ...this.colorItems(Array.from({ length: colCount(tb) }, (_, c) => ({ r: p.r, c }))),
      { separator: true },
      // 选中了好几行时和插入一样按选区来
      this.isMulti() ? this.deleteItems(p)[0] : { title: p.r === 0 ? t("deleteHeadRow") : t("deleteRow"), icon: "trash-2", danger: true, disabled: deleteRow(tb, p.r) === tb, run: () => this.apply(deleteRow(tb, p.r), { r: Math.min(p.r, rowCount(tb) - 2), c: p.c }) },
    ];
  }

  private colMenu(p: Pos): MenuItem[] {
    const tb = this.table;
    return [
      ...this.insertColItems(p),
      { title: t("duplicateCol"), icon: "copy-plus", run: () => this.apply(duplicateCol(tb, p.c), { r: p.r, c: p.c + 1 }) },
      { separator: true },
      ...(colKindOf(tb, p.c) === "enc" ? [] : this.calcItems(p.c)),
      { title: t("colType").replace("{v}", t(`kind_${colKindOf(tb, p.c)}`)), icon: KIND_ICONS[colKindOf(tb, p.c)], run: () => this.openTypeMenu(p) },
      ...this.secretColItems(p.c),
      ...(formulaOf(tb, p.c)
        ? [
            { title: t("fxEdit"), icon: "calculator", run: () => this.openFormula(p.c) },
            { title: t("fxOff"), icon: "calculator", run: () => this.apply(setFormula(tb, p.c, null), p) },
          ]
        : [{ title: t("fxOn"), icon: "calculator", run: () => this.openFormula(p.c) }]),
      { separator: true },
      { title: t("sortAsc"), icon: "arrow-down-a-z", disabled: !canSortRows(tb) || colKindOf(tb, p.c) === "enc", why: colKindOf(tb, p.c) === "enc" ? t("whySortEnc") : t("whySortMerge"), run: () => this.apply(sortRows(tb, p.c, false, this.hasTotalRow(), this.dateParser()), p) },
      { title: t("sortDesc"), icon: "arrow-up-z-a", disabled: !canSortRows(tb) || colKindOf(tb, p.c) === "enc", why: colKindOf(tb, p.c) === "enc" ? t("whySortEnc") : t("whySortMerge"), run: () => this.apply(sortRows(tb, p.c, true, this.hasTotalRow(), this.dateParser()), p) },
      { separator: true },
      { title: t("moveColLeft"), icon: "arrow-left", disabled: p.c === 0, run: () => this.apply(moveCol(tb, p.c, p.c - 1), { r: p.r, c: p.c - 1 }) },
      { title: t("moveColRight"), icon: "arrow-right", disabled: p.c >= colCount(tb) - 1, run: () => this.apply(moveCol(tb, p.c, p.c + 1), { r: p.r, c: p.c + 1 }) },
      { separator: true },
      ...this.alignItems(p.c),
      ...(widthOf(tb, p.c) != null ? [{ title: t("autoWidth"), icon: "move-horizontal", run: () => this.apply(setWidth(tb, p.c, null), p) }] : []),
      { separator: true },
      ...this.colorItems(Array.from({ length: rowCount(tb) }, (_, r) => ({ r, c: p.c }))),
      { separator: true },
      this.isMulti() ? this.deleteItems(p)[1] : { title: t("deleteCol"), icon: "trash-2", danger: true, disabled: colCount(tb) <= 1, run: () => this.apply(deleteCol(tb, p.c), { r: p.r, c: Math.min(p.c, colCount(tb) - 2) }) },
    ];
  }

  private cellMenu(p: Pos): MenuItem[] {
    const tb = this.table;
    const multi = this.isMulti();
    const rect = this.rangeRect();
    const merged = mergeAt(tb, p.r, p.c);
    const mergeItems: MenuItem[] = [];
    if (multi && rect) mergeItems.push({ title: t("mergeCells"), icon: "combine", disabled: crossesHead(tb, rect), why: t("whyMergeHead"), run: () => this.apply(mergeCells(tb, rect), { r: rect.r1, c: rect.c1 }) });
    if (merged) mergeItems.push({ title: t("unmergeCells"), icon: "split", run: () => this.apply(unmergeAt(tb, p.r, p.c), { r: merged.r1, c: merged.c1 }) });
    // 触屏上没法拖选、按 Shift：拖右下角的圆点选出一片（iPad 上没法合并格子，小红书 Momo 反馈）。只选着一格时提示一句
    if (this.touched && !multi && !this.host.readonly) mergeItems.push({ title: t("dragToSelect") });
    const cells = multi ? this.rangeCells() : [p];
    const cols = multi && rect ? Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, i) => rect.c1 + i) : [p.c];
    // 手指选出一片：合并放最上面，拖完松手就能点到
    const mergeFirst = this.touched && multi;
    return [
      ...(mergeFirst ? [...mergeItems, { separator: true }] : []),
      ...this.insertRowItems(p, merged?.r2),
      ...this.insertColItems(p, merged?.c2),
      { separator: true },
      ...(mergeFirst ? [] : mergeItems),
      ...(!mergeFirst && mergeItems.length ? [{ separator: true }] : []),
      ...this.alignItems(cols),
      { separator: true },
      ...this.statusColorItems(p),
      ...this.colorItems(cells),
      ...(() => {
        const sizes = new Set(cells.map((q) => fontSizeOf(tb, q.r, q.c) ?? 1));
        return this.sizeItems(t("fontSize"), sizes.size === 1 ? [...sizes][0] : undefined, (v) => this.applyKeepRange(setFontSize(this.table, cells, v)));
      })(),
      { separator: true },
      { title: CHECK_RE.test(tb.cells[p.r][p.c]) ? t("removeCheckbox") : t("addCheckbox"), icon: "square-check", disabled: multi, why: t("whyCheckboxMulti"), run: () => this.apply(setCell(tb, p.r, p.c, CHECK_RE.test(tb.cells[p.r][p.c]) ? tb.cells[p.r][p.c].replace(CHECK_RE, "").trimStart() : `[ ] ${tb.cells[p.r][p.c]}`.trimEnd()), p) },
      ...(cells.some((c) => tb.cells[c.r][c.c]) ? [{ title: t("clearCell"), icon: "eraser", run: () => this.apply(clearCells(tb, cells), this.sel ?? p) }] : []),
      ...this.cellSecretItems(cells),
      ...this.deleteItems(p),
    ];
  }

  /**
   * 格子菜单里的「加密」「取消加密」：普通列里单独加密几格（加密列整列都是加密的，不出现）。
   * 计算列、合计行由公式写，状态、多选列的值会记成选项，这些不能加密
   */
  private cellSecretItems(cells: Pos[]): MenuItem[] {
    const box = this.host.secrets?.();
    if (!box || this.host.readonly) return [];
    const tb = this.table;
    const seen = new Set<string>();
    const own: Pos[] = [];
    for (const q of cells) {
      const c = this.canon(q);
      const id = `${c.r},${c.c}`;
      // 状态、多选列的值会记进选项（颜色），密文不能进去
      if (seen.has(id) || colTypeOf(tb, c.c)?.t === "enc" || tb.meta.opts?.[c.c] || isFxCell(tb, c.r, c.c) || (hasTotal(tb) && c.r === rowCount(tb) - 1)) continue;
      seen.add(id);
      own.push(c);
    }
    const plain = own.filter((c) => tb.cells[c.r][c.c].trim() && !hasSecret(tb.cells[c.r][c.c]));
    const sealed = own.filter((c) => hasSecret(tb.cells[c.r][c.c]));
    const items: MenuItem[] = [];
    if (plain.length)
      items.push({
        title: t("encCell"),
        icon: "lock",
        run: () =>
          void (async () => {
            if (!(await box.unlock(this.secretCells()))) return;
            const out = await Promise.all(plain.map((c) => box.seal(tb.cells[c.r][c.c])));
            if (this.destroyed || this.table !== tb) return;
            let n = tb;
            plain.forEach((c, i) => (n = editCell(n, c.r, c.c, out[i])));
            this.applyNow(normalize(n), this.sel ?? undefined);
          })(),
      });
    if (sealed.length)
      items.push({
        title: t("decryptCell"),
        icon: "lock-open",
        run: () =>
          void (async () => {
            if (!this.host.confirm || !(await this.host.confirm(t("encDecryptCellConfirm"), t("encDecryptOk")))) return;
            const raws = sealed.map((c) => tb.cells[c.r][c.c]);
            if (!(await box.unlock(raws))) return;
            await box.openAll(raws);
            if (raws.some((v) => typeof box.peek(v) !== "string")) {
              this.host.notice?.(t("encForeignAbort"));
              return;
            }
            if (this.destroyed || this.table !== tb) return;
            let n = tb;
            sealed.forEach((c, i) => (n = editCell(n, c.r, c.c, box.peek(raws[i]) ?? raws[i])));
            this.applyNow(normalize(n), this.sel ?? undefined);
          })(),
      });
    return items.length ? [{ separator: true }, ...items] : [];
  }

  /**
   * 删除行 / 列：选区跨了几行（几列）就一次删几行（#4）；至少留下表头和一行、一列。
   * 只选着表头那一行时也能删，下一行变成表头（#17）；选了好几行时表头还是删不了
   */
  private deleteItems(p: Pos): MenuItem[] {
    const tb = this.table;
    const r = (this.isMulti() && this.rangeRect()) || { r1: p.r, c1: p.c, r2: p.r, c2: p.c };
    const rows = r.r2 - r.r1 + 1;
    const cols = r.c2 - r.c1 + 1;
    return [
      {
        title: rows > 1 ? t("deleteRows").replace("{n}", String(rows)) : r.r1 === 0 ? t("deleteHeadRow") : t("deleteRow"),
        icon: "trash-2",
        danger: true,
        disabled: rows === 1 ? deleteRow(tb, r.r1) === tb : r.r1 === 0 || rowCount(tb) - rows < 2 || deleteRow(tb, r.r2) === tb,
        run: () => this.runCommand("delete-row"),
      },
      {
        title: cols > 1 ? t("deleteCols").replace("{n}", String(cols)) : t("deleteCol"),
        icon: "trash-2",
        danger: true,
        disabled: colCount(tb) - cols < 1,
        run: () => this.runCommand("delete-col"),
      },
    ];
  }

  /** 插入行：选区跨了几行就一次插几行 */
  private insertRowItems(p: Pos, below = p.r): MenuItem[] {
    const tb = this.table;
    const r = this.rangeRect();
    const k = this.isMulti() && r ? r.r2 - r.r1 + 1 : 1;
    const top = this.isMulti() && r ? r.r1 : p.r;
    const bottom = this.isMulti() && r ? r.r2 : below;
    const n = (key: "insertRowAbove" | "insertRowBelow" | "insertRowsAbove" | "insertRowsBelow") => t(key).replace("{n}", String(k));
    return [
      { title: n(k > 1 ? "insertRowsAbove" : "insertRowAbove"), icon: "arrow-up-to-line", disabled: top === 0, run: () => this.apply(insertRows(tb, top, k), { r: top, c: p.c }) },
      { title: n(k > 1 ? "insertRowsBelow" : "insertRowBelow"), icon: "arrow-down-to-line", run: () => this.apply(insertRows(tb, bottom + 1, k), { r: bottom + 1, c: p.c }) },
    ];
  }

  /** 插入列：选区跨了几列就一次插几列 */
  private insertColItems(p: Pos, right = p.c): MenuItem[] {
    const tb = this.table;
    const r = this.rangeRect();
    const k = this.isMulti() && r ? r.c2 - r.c1 + 1 : 1;
    const left = this.isMulti() && r ? r.c1 : p.c;
    const rr = this.isMulti() && r ? r.c2 : right;
    const n = (key: "insertColLeft" | "insertColRight" | "insertColsLeft" | "insertColsRight") => t(key).replace("{n}", String(k));
    return [
      { title: n(k > 1 ? "insertColsLeft" : "insertColLeft"), icon: "arrow-left-to-line", run: () => this.apply(insertCols(tb, left, k), { r: p.r, c: left }) },
      { title: n(k > 1 ? "insertColsRight" : "insertColRight"), icon: "arrow-right-to-line", run: () => this.apply(insertCols(tb, rr + 1, k), { r: p.r, c: rr + 1 }) },
    ];
  }

  /** 列类型的二级菜单：普通、状态、多选、日期、数字、进度条，下面是这种类型的选项（日期写法、数字格式） */
  private openTypeMenu(p: Pos): void {
    const { x, y } = this.menuAt;
    // 在原菜单的位置重开，选完选项留在这里接着调
    const again = (next: Table) => {
      this.apply(next, p);
      this.openTypeMenu(p);
    };
    this.openMenu(this.typeItems(p, again), x, y);
  }

  private typeItems(p: Pos, again: (t: Table) => void): MenuItem[] {
    const tb = this.table;
    const c = p.c;
    const kind = colKindOf(tb, c);
    const fx = !!formulaOf(tb, c);
    // 加密列要宿主有主密码会话（脑图节点里没有）；已经是加密列的照样列出来，好改回去
    const kinds = fx ? (["text", "num"] as ColKind[]) : COL_KINDS.filter((k) => k !== "enc" || kind === "enc" || this.host.secrets?.());
    const items: MenuItem[] = [{ title: fx ? t("colTypeFx") : t("colTypeTitle") }];
    for (const k of kinds)
      items.push({
        title: t(`kind_${k}`),
        icon: KIND_ICONS[k],
        checked: kind === k,
        run: () => {
          if (k === kind) return;
          // 加密、解密是异步的（要解锁），做完不再开二级菜单
          if (k === "enc") void this.toSecretCol(c, p);
          else if (kind === "enc") void this.fromSecretCol(c, k, p);
          else if (k === "text" || k === "status" || k === "multi") this.apply(setColKind(tb, c, k), p);
          else again(setColKind(tb, c, k));
        },
      });
    const ty = colTypeOf(tb, c);
    if (ty?.t === "date") {
      const set = (f: "slash" | "link" | undefined) => again(setColType(tb, c, f ? { t: "date", f } : { t: "date" }));
      items.push({ separator: true }, { title: t("dateStyle") });
      items.push({ title: "2026-11-17", checked: !ty.f, run: () => set(undefined) });
      items.push({ title: "2026/11/17", checked: ty.f === "slash", run: () => set("slash") });
      items.push({ title: t("dateLink"), checked: ty.f === "link", run: () => set("link") });
    }
    if (ty?.t === "num") {
      const set = (patch: Partial<Extract<ColType, { t: "num" }>>) => {
        const n: Record<string, unknown> = { ...ty, ...patch };
        for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
        again(setColType(tb, c, n as ColType));
      };
      items.push({ separator: true }, { title: t("numFormat") });
      items.push({ title: t("numGroup"), checked: !!ty.g, run: () => set({ g: ty.g ? undefined : 1 }) });
      items.push({ title: t("numPercent"), checked: !!ty.p, run: () => set({ p: ty.p ? undefined : 1, u: undefined }) });
      items.push({ rowLabel: t("numCurrency"), chipText: t("numNone"), title: t("numNone"), checked: !ty.u, run: () => set({ u: undefined }) });
      // 选货币时顺手开千分位、两位小数（和 Excel 的货币格式一样），之后还能改
      for (const u of CURRENCIES) items.push({ chipText: u, title: u, checked: ty.u === u, run: () => set(ty.u ? { u } : { u, p: undefined, g: 1, d: ty.d ?? 2 }) });
      // 计算列的小数位在公式里设
      if (!fx) {
        items.push({ separator: true });
        items.push({ rowLabel: t("numDecimals"), chipText: t("numAuto"), title: t("numAuto"), checked: ty.d === undefined, run: () => set({ d: undefined }) });
        for (const d of [0, 1, 2, 3]) items.push({ chipText: String(d), title: String(d), checked: ty.d === d, run: () => set({ d }) });
      }
    }
    return items;
  }

  /** 状态列的格子：改这个状态的颜色（整列同一个状态一起变） */
  private statusColorItems(p: Pos): MenuItem[] {
    const raw = this.table.cells[p.r][p.c];
    const opts = this.table.meta.opts?.[p.c];
    if (!opts || !raw.trim() || p.r < headRows(this.table)) return [];
    // 多选的格子：每个标签一排色块（最多前三个，菜单不至于太长）
    const values = colTypeOf(this.table, p.c)?.t === "multi" ? splitTags(raw).slice(0, 3) : [raw.trim()];
    return values.flatMap((v): MenuItem[] => [
      { title: t("statusColor").replace("{v}", v) },
      ...CELL_COLORS.map((color): MenuItem => ({ swatch: color, title: t(color), checked: opts[v] === color, run: () => this.applyKeepRange(setOptionColor(this.table, p.c, v, color)) })),
      { separator: true },
    ]);
  }

  /** 合计：这一列怎么算（求和、平均……），勾着的是现在的 */
  private calcItems(c: number): MenuItem[] {
    const cur = this.table.meta.calc?.[c] ?? null;
    const item = (how: Calc | null): MenuItem => ({
      title: how ? t(`calc_${how}`) : t("calc_none"),
      checked: cur === how,
      run: () => this.apply(setCalc(this.table, c, how, { sum: t("totalLabel"), mixed: t("totalLabelMixed") }), this.sel ?? undefined),
    });
    // 「不计算」只在设了合计时出现（没设时灰着没意义）
    return [{ title: t("calcTitle") }, ...CALCS.map((x) => item(x)), ...(cur ? [item(null)] : []), { separator: true }];
  }

  /** 有没有合计行 */
  private hasTotalRow(): boolean {
    return hasTotal(this.table);
  }

  /** 对齐（一列或选区里的几列） */
  private alignItems(c: number | number[]): MenuItem[] {
    const cols = Array.isArray(c) ? c : [c];
    const cur = new Set(cols.map((x) => this.table.align[x] ?? "left"));
    const one = cur.size === 1 ? [...cur][0] : null;
    const keep = () => ({ sel: this.sel, anchor: this.anchor });
    const item = (a: Align, title: string, icon: string): MenuItem => ({
      title,
      icon,
      inline: true,
      checked: one === a,
      run: () => {
        const k = keep();
        let next = this.table;
        for (const x of cols) next = setAlign(next, x, a);
        this.apply(next, k.sel ?? undefined);
        if (k.anchor) {
          this.anchor = k.anchor;
          this.markSel();
        }
      },
    });
    const vCur = new Set(cols.map((x) => vAlignOf(this.table, x)));
    const vOne = vCur.size === 1 ? [...vCur][0] : undefined;
    const vItem = (v: "top" | "middle" | "bottom"): MenuItem => {
      const val: VAlign | null = v === "top" ? null : v;
      return {
        title: t(`vAlign_${v}`),
        icon: V_ICONS[v],
        inline: true,
        checked: vOne === val,
        run: () => {
          const k = keep();
          let next = this.table;
          for (const x of cols) next = setVAlign(next, x, val);
          this.apply(next, k.sel ?? undefined);
          if (k.anchor) {
            this.anchor = k.anchor;
            this.markSel();
          }
        },
      };
    };
    return [
      { title: t("align") },
      item("left", t("alignLeft"), "align-left"),
      item("center", t("alignCenter"), "align-center"),
      item("right", t("alignRight"), "align-right"),
      vItem("top"),
      vItem("middle"),
      vItem("bottom"),
    ];
  }

  /** 底色：一排色块，标题是「底色」 */
  private colorItems(cells: Pos[]): MenuItem[] {
    const current = new Set(cells.map((p) => bgOf(this.table, p.r, p.c) ?? "none"));
    const one = current.size === 1 ? [...current][0] : null;
    const fgs = new Set(cells.map((p) => fgOf(this.table, p.r, p.c) ?? "none"));
    const oneFg = fgs.size === 1 ? [...fgs][0] : null;
    return [
      { title: t("color") },
      { swatch: "none", title: t("noColor"), checked: one === "none", run: () => this.applyKeepRange(setBg(this.table, cells, null)) },
      ...CELL_COLORS.map((color): MenuItem => ({ swatch: color, title: t(color), checked: one === color, run: () => this.applyKeepRange(setBg(this.table, cells, color)) })),
      { title: t("textColor") },
      { swatch: "none", textSwatch: true, title: t("defaultText"), checked: oneFg === "none", run: () => this.applyKeepRange(setFg(this.table, cells, null)) },
      ...CELL_COLORS.map((color): MenuItem => ({ swatch: color, textSwatch: true, title: t(color), checked: oneFg === color, run: () => this.applyKeepRange(setFg(this.table, cells, color)) })),
    ];
  }

  /** 文字大小：一排大小不同的「A」。current 是现在的倍数（几格不一样时是 undefined，哪个都不勾） */
  private sizeItems(title: string, current: number | undefined, set: (size: number | null) => void): MenuItem[] {
    const names = ["fontSize_xs", "fontSize_s", "fontSize_m", "fontSize_l", "fontSize_xl"] as const;
    return FONT_SIZES.map((v, i): MenuItem => ({ sizeChip: v, rowLabel: i === 0 ? title : undefined, title: t(names[i]), checked: current === v, run: () => set(v === 1 ? null : v) }));
  }

  /** 自己画的弹出菜单：样式统一，色块能排成一行，手机上也好点 */
  /** avoid：菜单别盖住的一块（屏幕坐标），放不下就贴着它的上边或下边、限高滚动 */
  private openMenu(items: MenuItem[], x: number, y: number, avoidAt?: () => { top: number; bottom: number } | undefined): void {
    this.closePopover();
    this.menuAt = { x, y };
    const doc = this.root.ownerDocument;
    const pop = popupParent(doc).appendChild(doc.createElement("div"));
    pop.className = "ggt-menu";
    pop.setAttribute("role", "menu");
    let swatches: HTMLElement | null = null;
    for (const item of items) {
      if (item.separator) {
        swatches = null;
        if (pop.lastElementChild && !pop.lastElementChild.classList.contains("ggt-menu-sep")) pop.appendChild(doc.createElement("div")).className = "ggt-menu-sep";
        continue;
      }
      if (item.sizeChip || item.chipText) {
        if (!swatches || !swatches.classList.contains("ggt-menu-sizes")) {
          swatches = pop.appendChild(doc.createElement("div"));
          swatches.className = "ggt-menu-sizes";
          if (item.rowLabel) {
            const label = swatches.appendChild(doc.createElement("span"));
            label.className = "ggt-menu-sizes-label";
            label.textContent = item.rowLabel;
          }
        }
        const b = swatches.appendChild(doc.createElement("button"));
        b.type = "button";
        b.className = "ggt-size-chip" + (item.checked ? " is-checked" : "");
        b.textContent = item.chipText ?? "A";
        if (item.sizeChip) b.setCssProps({ "--ggt-chip": String(item.sizeChip) });
        b.disabled = !!item.disabled;
        b.setAttribute("aria-label", item.title ?? "");
        b.title = item.title ?? "";
        if (this.explainDisabled(b, item)) continue;
        b.addEventListener("click", () => {
          this.closePopover();
          item.run?.();
        });
        continue;
      }
      if (item.swatch) {
        if (!swatches || !swatches.classList.contains("ggt-menu-swatches")) {
          swatches = pop.appendChild(doc.createElement("div"));
          swatches.className = "ggt-menu-swatches";
        }
        const b = swatches.appendChild(doc.createElement("button"));
        b.type = "button";
        b.className = "ggt-swatch" + (item.checked ? " is-checked" : "") + (item.textSwatch ? " is-text" : "");
        if (item.textSwatch) {
          b.dataset.fg = item.swatch;
          b.textContent = "A";
        } else b.dataset.bg = item.swatch;
        b.setAttribute("aria-label", item.title ?? "");
        b.title = item.title ?? "";
        b.addEventListener("click", () => {
          this.closePopover();
          item.run?.();
        });
        continue;
      }
      if (item.inline && item.run) {
        if (!swatches || !swatches.classList.contains("ggt-menu-icons")) {
          swatches = pop.appendChild(doc.createElement("div"));
          swatches.className = "ggt-menu-icons";
        }
        // 第二组（比如上下对齐接在左右对齐后面）中间留一道竖线
        if (item.inline && swatches.childElementCount && (swatches.lastElementChild as HTMLElement).dataset.group !== (item.icon?.startsWith("align-vertical") ? "v" : "h")) swatches.appendChild(doc.createElement("span")).className = "ggt-menu-icons-sep";
        const b = swatches.appendChild(doc.createElement("button"));
        b.type = "button";
        b.className = "ggt-menu-item is-icon" + (item.checked ? " is-checked" : "");
        b.dataset.group = item.icon?.startsWith("align-vertical") ? "v" : "h";
        b.disabled = !!item.disabled;
        b.setAttribute("role", "menuitem");
        b.setAttribute("aria-label", item.title ?? "");
        b.title = item.title ?? "";
        if (item.icon && this.host.setIcon) this.host.setIcon(b, item.icon);
        else b.textContent = (item.title ?? "").slice(0, 2);
        b.addEventListener("click", () => {
          this.closePopover();
          item.run?.();
        });
        continue;
      }
      if (swatches?.classList.contains("ggt-menu-icons")) swatches = null;
      if (!item.run) {
        swatches = null;
        const label = pop.appendChild(doc.createElement("div"));
        label.className = "ggt-menu-label";
        label.textContent = item.title ?? "";
        continue;
      }
      const b = pop.appendChild(doc.createElement("button"));
      b.type = "button";
      b.className = "ggt-menu-item" + (item.danger ? " is-danger" : "") + (item.checked ? " is-checked" : "");
      b.disabled = !!item.disabled;
      b.setAttribute("role", "menuitem");
      const ic = b.appendChild(doc.createElement("span"));
      ic.className = "ggt-menu-icon";
      if (item.icon && this.host.setIcon) this.host.setIcon(ic, item.icon);
      else if (item.iconNode) ic.appendChild(item.iconNode.cloneNode(true));
      b.appendChild(doc.createElement("span")).textContent = item.title ?? "";
      if (item.checked) {
        const ck = b.appendChild(doc.createElement("span"));
        ck.className = "ggt-menu-check";
        if (this.host.setIcon) this.host.setIcon(ck, "check");
        else ck.textContent = "✓";
      }
      if (this.explainDisabled(b, item)) continue;
      b.addEventListener("click", () => {
        this.closePopover();
        item.run?.();
      });
    }
    if (pop.lastElementChild?.classList.contains("ggt-menu-sep")) pop.lastElementChild.remove();
    // 放在点击处，超出可见区域就往回挪。手机上键盘弹着时窗口底部被挡住，按 visualViewport 算可见区域；
    // 菜单比可见区域还高就限高、里面滚动，顶边不再跑到状态栏后面
    const place = () => {
      const win = doc.defaultView ?? window;
      const vv = win.visualViewport;
      const vw = doc.documentElement.clientWidth;
      // iPhone 顶上的状态栏 / 刘海：Obsidian 把安全区写在 --safe-area-inset-top
      const safe = parseFloat(win.getComputedStyle(doc.body).getPropertyValue("--safe-area-inset-top")) || 0;
      const top0 = (vv ? vv.offsetTop : 0) + Math.max(8, safe);
      // iOS 上软键盘盖在网页上面、可见区域不变：再按 Obsidian 写的 --keyboard-height 让出键盘
      const kb = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--keyboard-height")) || 0;
      const bottom0 = Math.min((vv ? vv.offsetTop + vv.height : doc.documentElement.clientHeight) - 8, win.innerHeight - kb - 8);
      pop.style.maxHeight = `${Math.max(120, bottom0 - top0)}px`;
      const avoid = avoidAt?.();
      const r = pop.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
      if (avoid) {
        const roomB = bottom0 - (avoid.bottom + 8);
        const roomA = avoid.top - 8 - top0;
        const down = r.height <= roomB || (r.height > roomA && roomB >= roomA);
        const h = Math.min(r.height, Math.max(120, down ? roomB : roomA));
        pop.style.maxHeight = `${h}px`;
        pop.style.top = `${Math.max(top0, down ? avoid.bottom + 8 : avoid.top - 8 - h)}px`;
        return;
      }
      const below = y + r.height <= bottom0;
      const above = y - r.height >= top0;
      const top = below ? y : above ? y - r.height : bottom0 - r.height;
      pop.style.top = `${Math.max(top0, top)}px`;
    };
    place();
    // 刚收起键盘（长按、点「表格菜单」时）：键盘落下去以后按新的空间再放一次
    if (avoidAt) for (const ms of [350, 700]) window.setTimeout(() => this.popover === pop && place(), ms);
    // 菜单开着时键盘弹出 / 收起：跟着重新放
    const vv = (doc.defaultView ?? window).visualViewport;
    if (vv) {
      const onVV = () => (this.popover === pop ? place() : vv.removeEventListener("resize", onVV));
      vv.addEventListener("resize", onVV);
    }
    pop.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        this.closePopover();
        this.input.focus();
      }
    });
    this.popover = pop;
  }

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }

  /**
   * 合计行的格子：鼠标停上去说是怎么算的；各列不全是求和时（混着平均、最大、计数），数字前面加个小标签（B 站 lucent2019）。
   * 标签只是显示，格子里还是纯数字
   */
  private markCalc(cell: HTMLElement, content: HTMLElement, c: number): void {
    const how = this.table.meta.calc?.[c];
    if (!how) return;
    cell.title = t(`calc_${how}`);
    if (totalsAllSum(this.table)) return;
    const tag = this.root.ownerDocument.createElement("span");
    tag.className = "ggt-calc-tag";
    tag.textContent = t(`calc_${how}`);
    content.prepend(tag);
  }

  // ---------- 计算列 ----------

  /** 公式出错 / 某一格算不出来的原因 */
  private fxText(e: FxError | FxEmpty): string {
    const key = "code" in e ? `fxErr_${e.code}` : `fxEmpty_${e.reason}`;
    return t(key as Parameters<typeof t>[0]).replace("{name}", e.name ?? "");
  }

  /** 计算列：表头（最后一行）挂 ƒx 标记，数据格加上样式，空着的格子鼠标停上去说原因 */
  private markFx(cell: HTMLElement, r: number, c: number): void {
    const tb = this.table;
    if (r === headRows(tb) - 1) {
      const err = formulaError(tb, c);
      const badge = cell.appendChild(this.root.ownerDocument.createElement("span"));
      badge.className = "ggt-fx-badge" + (err ? " is-error" : "");
      badge.appendChild(this.root.ownerDocument.createElement("span")).textContent = "ƒx";
      badge.title = err ? this.fxText(err) : t("fxBadgeTitle").replace("{f}", formulaOf(tb, c) ?? "");
      cell.classList.add("has-fx");
      if (!this.host.readonly) {
        badge.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.openFormula(c);
        });
      }
      return;
    }
    if (!isFxCell(tb, r, c)) return;
    cell.classList.add("is-fx");
    if (!tb.cells[r][c]) {
      const note = fxCellNote(tb, r, c);
      if (note) cell.title = this.fxText(note);
    }
  }

  /** 计算列的公式编辑框：挂在这一列的表头下面。输入 { 补全列名、点列名插入、边输入边用第一行数据预览 */
  private openFormula(c: number): void {
    if (this.host.readonly) return;
    if (this.editing) this.commit();
    this.closePopover();
    const tb = this.table;
    const doc = this.root.ownerDocument;
    const names = columnNames(tb);
    const usable = names.filter((n, i) => i !== c && nameOk(n) && names.indexOf(n) === names.lastIndexOf(n));
    let places = fxPlacesOf(tb, c);
    const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text?: string) => {
      const e = parent.appendChild(doc.createElement(tag));
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const pop = doc.body.appendChild(doc.createElement("div"));
    pop.className = "ggt-menu ggt-fx";
    el(pop, "div", "ggt-fx-title", `${names[c] || t("fxThisCol")} =`);
    const input = el(pop, "input", "ggt-fx-input");
    input.type = "text";
    input.spellcheck = false;
    input.value = formulaOf(tb, c) ?? "";
    input.placeholder = usable.length >= 2 ? `{${usable[0]}} * {${usable[1]}}` : usable.length ? `{${usable[0]}} * 2` : "1 + 2";
    const list = el(pop, "div", "ggt-fx-suggest");
    const chips = el(pop, "div", "ggt-fx-chips");
    el(chips, "span", "ggt-fx-label", usable.length ? t("fxInsert") : t("fxNoNames"));
    for (const name of usable) {
      const b = el(chips, "button", "ggt-fx-chip", name);
      b.type = "button";
      b.addEventListener("click", () => insert(`{${name}}`));
    }
    el(pop, "div", "ggt-fx-hint", t("fxHint"));
    const placeRow = el(pop, "div", "ggt-fx-places");
    el(placeRow, "span", "ggt-fx-label", t("fxPlaces"));
    const placeBtns: HTMLButtonElement[] = [];
    for (const v of [null, 0, 1, 2, 3]) {
      const b = el(placeRow, "button", "ggt-fx-place", v === null ? t("fxAuto") : String(v));
      b.type = "button";
      b.dataset.v = String(v);
      b.addEventListener("click", () => {
        places = v;
        update();
        input.focus();
      });
      placeBtns.push(b);
    }
    const preview = el(pop, "div", "ggt-fx-preview");
    const actions = el(pop, "div", "ggt-fx-actions");
    const cancel = el(actions, "button", "ggt-fx-cancel", t("fxCancel"));
    cancel.type = "button";
    const ok = el(actions, "button", "ggt-fx-ok mod-cta", t("fxOk"));
    ok.type = "button";

    // 补全：光标前面有没配对的 {
    let picks: string[] = [];
    let active = 0;
    const brace = () => {
      const pos = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, pos).replace(/｛/g, "{").replace(/｝/g, "}");
      const i = before.lastIndexOf("{");
      if (i < 0 || before.lastIndexOf("}") > i) return null;
      return { start: i, end: pos, q: before.slice(i + 1).trim().toLowerCase() };
    };
    const showList = () => {
      const b = brace();
      picks = b ? usable.filter((n) => n.toLowerCase().includes(b.q)) : [];
      active = Math.min(active, Math.max(0, picks.length - 1));
      list.replaceChildren();
      list.classList.toggle("is-shown", picks.length > 0);
      picks.forEach((name, i) => {
        const it = el(list, "div", "ggt-suggest-item" + (i === active ? " is-active" : ""), name);
        it.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          pick(name);
        });
      });
    };
    const pick = (name: string) => {
      const b = brace();
      if (!b) return;
      let rest = input.value.slice(b.end);
      if (/^\s*[}｝]/.test(rest)) rest = rest.replace(/^\s*[}｝]/, "");
      input.value = input.value.slice(0, b.start) + `{${name}}` + rest;
      const at = b.start + name.length + 2;
      input.setSelectionRange(at, at);
      update();
    };
    const insert = (text: string) => {
      const a = input.selectionStart ?? input.value.length;
      const b = input.selectionEnd ?? a;
      input.value = input.value.slice(0, a) + text + input.value.slice(b);
      input.focus();
      input.setSelectionRange(a + text.length, a + text.length);
      update();
    };
    const update = () => {
      placeBtns.forEach((b) => b.classList.toggle("is-checked", b.dataset.v === String(places)));
      const src = input.value;
      const res = checkFormula(this.table, c, src, places);
      preview.classList.remove("is-error");
      if ("error" in res) {
        ok.disabled = true;
        preview.textContent = src.trim() ? this.fxText(res.error) : t("fxStart");
        preview.classList.toggle("is-error", !!src.trim());
      } else {
        ok.disabled = false;
        const vals = new Map(res.refs.map((x) => [x.name, x.value]));
        const expr = prettyOps(src.trim()).replace(/[{｛]([^}｝]*)[}｝]/g, (_, n: string) => {
          const v = vals.get(n.trim());
          return v === null || v === undefined ? t("fxBlank") : formatFx(v, null);
        });
        if (headRows(this.table) >= rowCount(this.table) - (hasTotal(this.table) ? 1 : 0)) preview.textContent = t("fxNoRows");
        else if (res.result !== null) preview.textContent = t("fxPreview").replace("{expr}", expr).replace("{v}", res.result);
        else preview.textContent = t("fxPreviewEmpty").replace("{why}", res.empty ? this.fxText(res.empty) : "");
      }
      showList();
    };
    const close = () => {
      this.closePopover();
      this.input.focus();
    };
    const confirm = () => {
      if (ok.disabled) return;
      const src = input.value.trim();
      this.closePopover();
      this.apply(setFormula(this.table, c, src, places), this.sel ?? { r: headRows(this.table) - 1, c });
      this.input.focus();
    };
    cancel.addEventListener("click", close);
    ok.addEventListener("click", confirm);
    input.addEventListener("input", update);
    input.addEventListener("click", showList);
    input.addEventListener("keyup", (ev) => {
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "Home" || ev.key === "End") showList();
    });
    pop.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      const listOpen = picks.length > 0 && ev.target === input;
      if (listOpen && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
        ev.preventDefault();
        active = (active + (ev.key === "ArrowDown" ? 1 : -1) + picks.length) % picks.length;
        showList();
      } else if (listOpen && (ev.key === "Enter" || ev.key === "Tab")) {
        ev.preventDefault();
        pick(picks[active]);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        if (listOpen) {
          picks = [];
          list.classList.remove("is-shown");
        } else close();
      } else if (ev.key === "Enter" && ev.target === input) {
        ev.preventDefault();
        confirm();
      } else return;
      ev.stopPropagation();
    });
    // 挂在这一列表头（最后一行）下面，放不下就往上、往左挪
    const anchor = this.cellEl({ r: headRows(tb) - 1, c }) ?? this.root;
    const ar = anchor.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    const pr = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(ar.left, vw - pr.width - 8))}px`;
    pop.style.top = `${ar.bottom + 4 + pr.height > vh - 8 ? Math.max(8, ar.top - 4 - pr.height) : ar.bottom + 4}px`;
    this.popover = pop;
    update();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

let searchMarkLayer: HTMLElement | null = null;
let searchMarkCell: HTMLElement | null = null;

/** 去掉搜索跳转时标出的那一处（选区挪走了、换了一处、查找框关了）。0.13.2–0.15.0 用过的自定义高亮也删掉（插件升级前留下的） */
export function clearSearchMark(): void {
  (window.CSS as { highlights?: Map<string, unknown> } | undefined)?.highlights?.delete("ggt-search");
  searchMarkLayer?.remove();
  searchMarkLayer = null;
  searchMarkCell?.classList.remove("is-search-hit");
  searchMarkCell = null;
}

/** 元素里第 k 处（从 0 数）text 的范围：文字可能跨好几个文字节点；不够 k 处就用最后一处 */
function findTextRange(root: Element, text: string, k: number): Range | null {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let all = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    all += (n as Text).data;
  }
  const hits: number[] = [];
  for (let i = all.indexOf(text); i >= 0; i = all.indexOf(text, i + text.length)) hits.push(i);
  if (!hits.length) return null;
  const start = hits[Math.min(k, hits.length - 1)];
  const at = (pos: number): [Text, number] => {
    let acc = 0;
    for (const n of nodes) {
      if (pos <= acc + n.data.length) return [n, pos - acc];
      acc += n.data.length;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.data.length];
  };
  const range = doc.createRange();
  const [sn, so] = at(start);
  const [en, eo] = at(start + text.length);
  range.setStart(sn, so);
  range.setEnd(en, eo);
  return range;
}

/** 一个 HTML 格子里的文字：<br> 和块级元素之间算换行 */
function htmlCellText(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.textContent ?? "");
    else if (n.nodeName === "BR") parts.push("\n");
    else {
      const block = /^(P|DIV|LI)$/.test(n.nodeName) && parts.length && !parts[parts.length - 1].endsWith("\n");
      if (block) parts.push("\n");
      n.childNodes.forEach(walk);
    }
  };
  walk(el);
  return parts.join("").replace(/\u00a0/g, " ").trim();
}

/**
 * 剪贴板里的表格：先看 HTML（Excel、飞书、网页复制的表格），再看 Markdown 表格源码，最后按制表符分隔的文字。
 * 普通的一段文字返回 1×1；什么都没有返回 null
 */
/** 计算出来的颜色叠在白纸上的实色（Word 不认半透明）；透明的返回 null */
export function onWhite(color: string): string | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(color);
  if (!m) return /transparent/.test(color) ? null : color;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a /= 100;
  if (a <= 0) return null;
  const mix = (v: string) => Math.round(parseFloat(v) * a + 255 * (1 - a));
  return `rgb(${mix(m[1])}, ${mix(m[2])}, ${mix(m[3])})`;
}

/** 剪贴板里的图片文件（截图、从网页复制的图）；没有就是 null */
export function imageFrom(data: DataTransfer): File | null {
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const it of Array.from(data.items ?? [])) {
    if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    if (f) return f;
  }
  return null;
}

export function gridFromClipboard(data: DataTransfer, doc: Document): string[][] | null {
  const html = data.getData("text/html");
  // 从我们自己的表格复制的：纯文本里是 Markdown 原文（链接、加粗都在），用它
  if (html && /data-ggt="1"/.test(html) && data.getData("text/plain")) return fromTSV(data.getData("text/plain"));
  if (html && /<table/i.test(html)) {
    const parsed = new (doc.defaultView ?? window).DOMParser().parseFromString(html, "text/html");
    const table = parsed.querySelector("table");
    if (table) {
      const grid = Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.querySelectorAll("td, th")).map(htmlCellText));
      if (grid.length && grid.some((r) => r.length)) return grid;
    }
  }
  const text = data.getData("text/plain");
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines.length >= 2 && lines[0].includes("|") && isDelimiterRow(lines[1])) {
    const t = parseTable(lines);
    if (t) return t.cells;
  }
  return fromTSV(text);
}
