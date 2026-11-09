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

import { type Align, type Calc, CALCS, CELL_COLORS, type CellColor, isDelimiterRow, parseTable, type Rect, type Table, TABLE_DENSITIES, TABLE_STYLES, type TableDensity, type TableStyle } from "../core/table";
import { headRows, canSetHead, crossesHead, MAX_HEAD_ROWS, alignAll, autoWidthAll, bgOf, hasTotal, normalize, setCalc, setOptionColor, setOptionsCol, fgOf, setFg, setWidths, canSortRows, CHECK_RE, duplicateCol, duplicateRow, insertCols, insertRows, sortRows, toggleCheck, editCell, mergedText, shownText, clearAllBg, clearCells, fillRange, setTableLook, type FillDir, isCovered, colCount, deleteCol, deleteRow, insertCol, insertRow, mergeAt, mergeCells, merges, moveCol, moveRow, pasteGrid, rowCount, setAlign, setBg, setCell, setWidth, unmergeAt, widthOf } from "../core/ops";
import { fromTSV, toHTML, toTSV } from "../core/clipboard";
import { applyInlineFormat, highlightOf, type InlineFormat } from "../core/format";
import { type CellInput, CodeMirrorInput, TextareaInput } from "./cell-input";
import { t } from "./i18n";

export interface MenuItem {
  title?: string;
  icon?: string;
  /** 色块（底色菜单用） */
  swatch?: CellColor | "none";
  /** 色块是文字颜色（画成一个带颜色的「A」） */
  textSwatch?: boolean;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  run?: () => void;
  separator?: boolean;
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
  /** 选中或开始编辑时通知宿主（实时预览里用来防止编辑器抢走光标） */
  onFocus?(): void;
  /** 格子的编辑框用 CodeMirror：加粗、颜色、荧光笔直接显示效果，标签藏起来（建编辑器时问一次） */
  richEdit?(): boolean;
  /** 编辑格子时选中文字浮出的格式栏用哪些颜色；返回 null（或不给）就不显示格式栏 */
  formatColors?(): { text: string[]; highlight: string[] } | null;
  readonly?: boolean;
}

type Pos = { r: number; c: number };

/** 内容、对齐、设置都一样（写回风格不算） */
export function sameTable(a: Table, b: Table): boolean {
  return JSON.stringify([a.cells, a.align, a.meta]) === JSON.stringify([b.cells, b.align, b.meta]);
}


/**
 * 不用走 Markdown 渲染的格子：只有文字、数字和不会触发任何写法的标点（没有链接、加粗、标签、公式、HTML、换行……），
 * 也不以列表、引用、标题的记号开头。拿不准的一律交给渲染，宁可慢不能显示错
 */
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
  private editing = false;
  /** 编辑时宿主送来的新表：等这一格改完再换上 */
  private pending: Table | null = null;
  private hover: Pos | null = null;
  /** 每个位置 → 显示它的格子元素（被合并盖住的位置指向左上角那格）。render 时建，大表格里不用每次 querySelector 全表 */
  private grid: HTMLElement[][] = [];
  /** 上一次加了选中样式、十字高亮的格子：下次只清这些，不扫全表 */
  private marked: HTMLElement[] = [];
  private crossed: HTMLElement[] = [];
  private popover: HTMLElement | null = null;
  /** 编辑时的补全列表（[[ 链接、# 标签） */
  private suggest: { kind: "link" | "tag" | "option"; start: number; items: string[]; index: number; el: HTMLElement } | null = null;
  private resize: { c: number; startX: number; startW: number; col: HTMLElement } | null = null;
  private destroyed = false;
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
    this.root.classList.toggle("is-readonly", !!host.readonly);
    parent.appendChild(this.root);
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
    this.setSel({ r, c }, true);
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
        this.apply(sortRows(tb, p.c, id === "sort-desc", this.hasTotalRow()), p);
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

  destroy(): void {
    this.hideFormatBar();
    if (lastActive === this) lastActive = null;
    this.destroyed = true;
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
      const sc = this.scroller;
      this.root.classList.toggle("can-left", sc.scrollLeft > 1);
      this.root.classList.toggle("can-right", sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1);
      this.stickHeader();
      // 手柄、左上角按钮跟着滚动换位置（贴在看得见的边上，滚出去的藏起来）
      this.placeHandles();
      // 冻结标题列时，十字高亮竖的色带不能伸进冻结列底下：横向滚动后重新摆
      if (this.root.classList.contains("is-freeze") && this.crossBands.some((b) => b.classList.contains("is-shown"))) this.markCross();
    };
    const onScroll = () => win.requestAnimationFrame(update);
    this.on(this.scroller, "scroll", onScroll, { passive: true });
    // 外面的滚动容器要等挂到文档上才找得到
    win.requestAnimationFrame(() => {
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
      if (el) {
        this.outer = el;
        // 浏览器支持滚动驱动动画时，表头位置交给浏览器按滚动位置算（和滚动同一帧画，不会慢一拍抖动，#2）。
        // 时间线名挂在这个滚动容器上；同一容器里的几张表共用
        if (win.CSS?.supports?.("animation-timeline: scroll()")) {
          el.classList.add("ggt-y-host");
          this.scrollDriven = true;
        }
        el.addEventListener("scroll", onScroll, { passive: true });
        this.cleanups.push(() => el.removeEventListener("scroll", onScroll));
      }
      update();
    });
    const ro = new win.ResizeObserver(onScroll);
    ro.observe(this.scroller);
    this.cleanups.push(() => ro.disconnect());
  }

  private outer: HTMLElement | null = null;
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
    if (outer && this.scrollDriven && Math.abs(this.scale() - 1) < 0.01) {
      this.stickRange(outer, head);
      head.removeAttribute("style");
      return;
    }
    this.root.classList.remove("is-sd");
    if (stuck) head.setAttribute("style", `transform: translateY(${Math.round(offset / this.scale())}px)`);
    else head.removeAttribute("style");
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
    const key = `${a}|${len}`;
    if (key !== this.stickKey) {
      this.stickKey = key;
      this.root.style.setProperty("--ggt-stick-a", `${a}px`);
      this.root.style.setProperty("--ggt-stick-b", `${a + len}px`);
      this.root.style.setProperty("--ggt-stick-len", `${len}px`);
    }
    this.root.classList.add("is-sd");
  }

  /** 样式、行距：这张表自己定了就用它的，否则用宿主给的默认（data-def-*） */
  private applyLook(): void {
    const d = this.root.dataset;
    d.preset = this.table.meta.style ?? d.defPreset ?? "default";
    d.density = this.table.meta.density ?? d.defDensity ?? "comfortable";
  }

  // ---------- 渲染 ----------

  private render(): void {
    const doc = this.root.ownerDocument;
    const hadFocus = this.input.hasFocus();
    const tb = this.table;
    const rows = rowCount(tb);
    const cols = colCount(tb);
    if (this.sel) this.sel = this.canon({ r: Math.min(this.sel.r, rows - 1), c: Math.min(this.sel.c, cols - 1) });
    if (this.anchor) this.anchor = { r: Math.min(this.anchor.r, rows - 1), c: Math.min(this.anchor.c, cols - 1) };
    const ms = merges(tb);
    this.applyLook();
    this.tableEl.replaceChildren();
    this.grid = Array.from({ length: rows }, () => new Array<HTMLElement>(cols));
    this.marked = [];
    this.crossed = [];
    const colgroup = this.tableEl.appendChild(doc.createElement("colgroup"));
    for (let c = 0; c < cols; c++) {
      const col = colgroup.appendChild(doc.createElement("col"));
      const w = widthOf(tb, c);
      if (w) col.style.width = `${w}px`;
    }
    const thead = this.tableEl.appendChild(doc.createElement("thead"));
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
          cell.rowSpan = m.r2 - m.r1 + 1;
          cell.classList.add("is-merged");
          for (let i = m.r1; i <= m.r2; i++) for (let j = m.c1; j <= m.c2; j++) this.grid[i][j] = cell;
        } else this.grid[r][c] = cell;
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        const a = tb.align[c];
        if (a) cell.dataset.align = a;
        const bg = bgOf(tb, r, c);
        if (bg) cell.dataset.bg = bg;
        const fg = fgOf(tb, r, c);
        if (fg) cell.dataset.fg = fg;
        if (tb.meta.headerCol && c === 0 && r >= head) cell.classList.add("is-head-col");
        // 冻结标题列：第一列（横跨到第二列的合并格不冻，不然盖住第二列）左右滚动时固定在左边
        if (freeze && c === 0 && (!m || m.c2 === 0)) cell.classList.add("is-frozen");
        // 没拖过宽度的列：宿主可以给它设个最宽（脑图节点里最宽 240，超出换行）
        if (!m && !widthOf(tb, c)) cell.classList.add("is-auto-width");
        const content = cell.appendChild(doc.createElement("div"));
        content.className = "ggt-content";
        if (r === rows - 1 && r >= head && hasTotal(tb)) cell.classList.add("is-total-row");
        this.fillCell(content, r, c, m ? mergedText(tb, m) : tb.cells[r][c]);
      }
    }
    this.markSel();
    if (hadFocus && this.sel) this.input.focus();
    this.stickHeader();
    // 列宽变了，线的位置就不对了：先收起来，鼠标再动时按新的边线放
    if (!this.resize) this.resizeBar.classList.remove("is-shown", "is-active");
  }

  /** 状态列的数据格画成彩色标签，别的照常 */
  private fillCell(el: HTMLElement, r: number, c: number, md: string): void {
    const opts = this.table.meta.opts?.[c];
    const isData = r >= headRows(this.table) && !(hasTotal(this.table) && r === rowCount(this.table) - 1);
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
      if (this.host.renderMarkdown) this.host.renderMarkdown(span, rest);
      else span.textContent = rest;
      return;
    }
    // 纯文字、数字直接放进去：渲染出来和走 Markdown 一样，大表格里能省掉几万次渲染
    if (this.host.renderMarkdown && !isPlainText(md)) this.host.renderMarkdown(el, md);
    else {
      el.textContent = md;
      // 渲染出来的段落带 dir="auto"（阿拉伯文、希伯来文靠右），直接放的文字也一样
      if (this.host.renderMarkdown) el.dir = "auto";
    }
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

  /** 填充柄放在选区右下角；没选中、在编辑、只读时不显示 */
  private placeFill(): void {
    const box = !this.editing && !this.host.readonly ? this.selBox() : null;
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
    this.markCross();
    if (cell) this.placeFill();
    this.placeHandles();
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
    if (this.anchor) {
      this.anchor = null;
      this.markSel();
    }
    this.editing = true;
    cell.classList.add("is-editing");
    this.fillHandle.classList.remove("is-shown");
    if (keep) {
      this.input.reset(shownText(this.table, this.sel.r, this.sel.c));
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
    if (!this.editing || !this.sel) return;
    const p = this.sel;
    this.editing = false;
    this.cellEl(p)?.classList.remove("is-editing");
    const text = this.input.value.replace(/\r\n?/g, "\n");
    this.input.reset("");
    const edited = editCell(this.table, p.r, p.c, text.replace(/^\s+|\s+$/g, ""));
    const next = edited === this.table ? edited : normalize(edited);
    const pending = this.pending;
    this.pending = null;
    if (next !== this.table) {
      const prev = this.table;
      this.table = next;
      if (hasTotal(next) || next.meta.opts?.some(Boolean)) this.render();
      else this.restoreContent(p);
      this.host.onChange(next, prev);
    } else if (pending) {
      this.table = pending;
      this.render();
    } else this.restoreContent(p);
  }

  private cancel(): void {
    this.closeSuggest();
    this.hideFormatBar();
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
    const rows = rowCount(this.table);
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
      if (wrap) {
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
      if (this.input.contains(target)) return;
      const cell = target.closest<HTMLElement>(".ggt-cell");
      if (!cell || this.host.readonly) return;
      // 点链接、标签：照常打开，不选中
      if (target.closest("a, .tag, input[type=checkbox]")) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      if (ev.pointerType === "touch") return this.touchStart(ev, p);
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
    // 点勾选框：切换 [ ] / [x]
    this.on(this.tableEl, "click", (ev) => {
      const box = (ev.target as HTMLElement).closest<HTMLInputElement>("input.ggt-check");
      const cell = box?.closest<HTMLElement>(".ggt-cell");
      if (!box || !cell) return;
      ev.preventDefault();
      if (this.host.readonly) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      this.apply(toggleCheck(this.table, p.r, p.c), p);
    });
    this.on(this.tableEl, "dblclick", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".ggt-cell") && !this.editing) this.startEdit(true);
    });
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
      this.openMenu(this.cellMenu(inRange && this.sel ? this.sel : p), ev.clientX, ev.clientY);
    });
    this.on(this.resizeBar, "pointerdown", (ev) => this.startResize(ev, this.resizeBar));
    this.on(this.fillHandle, "pointerdown", (ev) => this.fillDrag(ev));
    // 宿主改了默认样式（设置变了）
    this.on(this.root, "ggt-restyle" as keyof HTMLElementEventMap, () => {
      this.refreshInput();
      this.applyLook();
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
      const cell = (ev.target as HTMLElement).closest<HTMLElement>(".ggt-cell");
      if (!cell || !this.tableEl.contains(cell)) return;
      const p = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      if (!this.hover || this.hover.r !== p.r || this.hover.c !== p.c) {
        this.hover = p;
        this.placeHandles();
      }
    });
    this.on(this.root, "pointerleave", () => {
      if (!this.resize) this.resizeBar.classList.remove("is-shown");
      if (this.popover) return;
      this.hover = null;
      this.placeHandles();
    });
    this.on(this.scroller, "scroll", () => this.placeHandles(), { passive: true });

    this.bindInput();
    this.cleanups.push(() => this.input.destroy());
    this.on(doc, "scroll", () => this.formatBar && this.updateFormatBar(), { capture: true, passive: true });
    this.on(doc, "pointerdown", (ev) => {
      const target = ev.target as Node;
      // 点格式栏的按钮：还在编辑这一格
      if (this.formatBar?.contains(target)) return;
      if (this.popover && !this.popover.contains(target)) this.closePopover();
      // 点到表格外面：取消选中
      if (this.sel && !this.root.contains(target) && !(this.popover && this.popover.contains(target))) {
        if (this.editing) this.commit();
        this.sel = null;
        this.markSel();
      }
    }, { capture: true });
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
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
      if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey && !mod) {
        ev.preventDefault();
        this.commit();
        this.move(1, 0);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        this.commit();
        this.move(0, ev.shiftKey ? -1 : 1, true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
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
        break;
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
    const colors = this.editing && !this.host.readonly && this.sel && el.selectionStart !== el.selectionEnd ? this.host.formatColors?.() : null;
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
    const r = cell.getBoundingClientRect();
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const left = Math.max(8, Math.min(win.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6;
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
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
    const r = applyInlineFormat(el.value, from, to, fmt);
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
    btn("is-highlight", t("fmtHighlight"), { kind: "highlight" }, iconBtn("highlighter", "H"));
    if (colors.text.length) sep();
    for (const c of colors.text)
      btn("is-color", `${t("fmtTextColor")} ${c}`, { kind: "color", color: c }, (b) => {
        b.textContent = "A";
        b.style.color = c;
      });
    if (colors.highlight.length) sep();
    for (const c of colors.highlight) {
      const hl = highlightOf(c);
      btn("is-bg", `${t("fmtHighlightColor")} ${c}`, hl ? { kind: "highlight", color: hl } : { kind: "bg", color: c }, (b) => {
        b.textContent = "A";
        if (hl) b.dataset.highlight = hl;
        else b.style.background = c;
      });
    }
    sep();
    btn("is-clear", t("fmtClear"), { kind: "clear" }, iconBtn("eraser", "⌫"));
    doc.body.append(bar);
    return bar;
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
    // 状态列：编辑时列出这一列已有的状态，按输入过滤
    const opts = this.sel && this.sel.r >= headRows(this.table) ? this.table.meta.opts?.[this.sel.c] : null;
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
    const doc = this.root.ownerDocument;
    const box = this.suggest?.el ?? doc.body.appendChild(doc.createElement("div"));
    box.className = "ggt-suggest";
    box.replaceChildren();
    items.forEach((it, i) => {
      const row = box.appendChild(doc.createElement("div"));
      row.className = "ggt-suggest-item" + (i === 0 ? " is-active" : "");
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
    this.suggest = { kind, start, items, index: 0, el: box };
  }

  /** 补全列表开着时的按键：上下选、Enter / Tab 确认、Esc 关掉。处理了返回 true */
  private onSuggestKey(ev: KeyboardEvent): boolean {
    const sg = this.suggest;
    if (!sg) return false;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      sg.index = (sg.index + (ev.key === "ArrowDown" ? 1 : -1) + sg.items.length) % sg.items.length;
      Array.from(sg.el.children).forEach((c, i) => c.classList.toggle("is-active", i === sg.index));
      return true;
    }
    if (ev.key === "Enter" || ev.key === "Tab") {
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
    this.suggest?.el.remove();
    this.suggest = null;
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

  /** 第 i 行（或列）在屏幕上的起止 */
  private lineBox(i: number, row: boolean): { a: number; b: number } {
    if (row) {
      const tr = this.tableEl.rows[i];
      const b = tr?.getBoundingClientRect();
      return b ? { a: b.top, b: b.bottom } : { a: 0, b: 0 };
    }
    const b = this.tableEl.querySelectorAll("col")[i]?.getBoundingClientRect();
    return b ? { a: b.left, b: b.right } : { a: 0, b: 0 };
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
    const grid = this.rangeGrid();
    const r = this.rangeRect();
    ev.clipboardData.setData("text/plain", toTSV(grid));
    ev.clipboardData.setData("text/html", r ? this.styledHTML(r) : toHTML(grid, false));
    if (cut && !this.host.readonly) this.applyKeepRange(clearCells(this.table, this.rangeCells()));
  }

  /**
   * 带样式的 HTML：格子实际显示的底色、文字颜色、加粗、对齐、列宽、合并都写成内联样式，
   * 粘到 Word、飞书、邮件里保留样子。标上 data-ggt，粘回我们自己的表格时用纯文本（Markdown 原文）
   */
  private styledHTML(rect: Rect): string {
    const tb = this.table;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const win = this.root.ownerDocument.defaultView ?? window;
    const cols = Array.from(this.tableEl.querySelectorAll("col"));
    let html = '<table data-ggt="1" style="border-collapse:collapse">';
    html += "<colgroup>";
    const k = this.scale();
    for (let c = rect.c1; c <= rect.c2; c++) html += `<col style="width:${Math.round((cols[c]?.getBoundingClientRect().width ?? 80 * k) / k)}px">`;
    html += "</colgroup>";
    for (let r = rect.r1; r <= rect.r2; r++) {
      html += "<tr>";
      for (let c = rect.c1; c <= rect.c2; c++) {
        const m = mergeAt(tb, r, c);
        // 被合并盖住、而左上角也在复制范围里：不单独写
        if (m && (m.r1 !== r || m.c1 !== c) && m.r1 >= rect.r1 && m.c1 >= rect.c1) continue;
        const el = this.cellEl({ r, c });
        const cs = el ? win.getComputedStyle(el) : null;
        const styles = ["border:1px solid #d9d9d9", "padding:6px 10px", "vertical-align:top"];
        const a = tb.align[c];
        if (a) styles.push(`text-align:${a}`);
        if (cs) {
          if (cs.backgroundColor && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(cs.backgroundColor)) styles.push(`background-color:${cs.backgroundColor}`);
          if (fgOf(tb, r, c)) styles.push(`color:${cs.color}`);
          if (Number(cs.fontWeight) >= 600) styles.push("font-weight:600");
        }
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
            const ps = orig ? win.getComputedStyle(orig) : null;
            if (ps) pill.setAttribute("style", `background:${ps.backgroundColor};color:${ps.color};padding:0 8px;border-radius:10px`);
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
    if (this.editing || !this.sel || this.host.readonly || !ev.clipboardData) return;
    const grid = gridFromClipboard(ev.clipboardData, this.root.ownerDocument);
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

  // ---------- 触屏 ----------

  /**
   * 手指按在格子上：轻点是选中并进入编辑（键盘弹出来），按住不动半秒是菜单，滑动是滚动（什么都不做）。
   * 不在按下时 preventDefault，滚动照常
   */
  private touchStart(ev: PointerEvent, p: Pos): void {
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let moved = false;
    let pressed = false;
    const timer = window.setTimeout(() => {
      if (moved) return;
      pressed = true;
      this.longPressAt = performance.now();
      this.setSel(p, false);
      this.openMenu(this.cellMenu(p), x0, y0);
    }, 500);
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 8) {
        moved = true;
        window.clearTimeout(timer);
      }
    };
    const end = (e: PointerEvent) => {
      window.clearTimeout(timer);
      this.tableEl.removeEventListener("pointermove", move);
      this.tableEl.removeEventListener("pointerup", end);
      this.tableEl.removeEventListener("pointercancel", end);
      if (moved || pressed || e.type === "pointercancel") return;
      const same = this.sel && this.sel.r === p.r && this.sel.c === p.c;
      if (same && this.editing) return;
      this.setSel(p, true);
      this.startEdit(true);
    };
    this.tableEl.addEventListener("pointermove", move);
    this.tableEl.addEventListener("pointerup", end);
    this.tableEl.addEventListener("pointercancel", end);
  }

  // ---------- 列宽 ----------

  /** 指针离哪条列边线（每列的右边）不到 4 像素，就把调列宽的线放到那里；不在附近就藏起来 */
  private placeResizeBar(x: number, y: number): void {
    const bar = this.resizeBar;
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
      const cols = Array.from(this.tableEl.querySelectorAll("col"));
      cols.forEach((col, c) => {
        if (c >= c1 && c < c2) return;
        const right = col.getBoundingClientRect().right;
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

  private startResize(ev: PointerEvent, handle: HTMLElement): void {
    if (this.host.readonly) return;
    ev.preventDefault();
    ev.stopPropagation();
    const c = Number(handle.dataset.c);
    const col = this.tableEl.querySelectorAll("col")[c];
    if (!col || Number.isNaN(c)) return;
    const k = this.scale();
    this.resize = { c, startX: ev.clientX, startW: col.getBoundingClientRect().width / k, col };
    const startLeft = parseFloat(handle.style.left) || 0;
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
      // 线跟着鼠标走
      const tr = this.tableEl.getBoundingClientRect();
      const base = this.root.getBoundingClientRect();
      handle.setAttribute("style", `left:${startLeft + (w - r.startW)}px;top:${(tr.top - base.top) / k}px;height:${tr.height / k}px`);
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
      if (Math.abs(w - r.startW) >= 1) this.apply(setWidth(this.table, r.c, w));
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
        this.sel = row ? { r: p.r, c: colCount(this.table) - 1 } : { r: rowCount(this.table) - 1, c: p.c };
        this.lineSel = true;
        this.markSel();
        this.input.focus();
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
      if (!this.host.readonly) run();
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
    const p = this.hover ?? this.sel;
    const show = !!p && !this.host.readonly && !this.resize;
    this.rowHandle.classList.toggle("is-shown", show);
    this.colHandle.classList.toggle("is-shown", show);
    if (!show || !p) return;
    const base = this.root.getBoundingClientRect();
    const cell = this.cellEl(p);
    const first = this.cellEl({ r: p.r, c: 0 });
    const head = this.cellEl({ r: 0, c: p.c });
    if (!cell || !first || !head) return;
    const fr = first.getBoundingClientRect();
    const hr = head.getBoundingClientRect();
    const k = this.scale();
    // 行手柄贴在看得见的左边；这一行上下滚出去了就藏起来。列手柄：这一列左右滚出去了就藏起来
    const rowMid = fr.top + fr.height / 2;
    const colMid = hr.left + hr.width / 2;
    if (rowMid < vis.top || rowMid > vis.bottom) this.rowHandle.classList.remove("is-shown");
    if (colMid < vis.left || colMid > vis.right) this.colHandle.classList.remove("is-shown");
    this.rowHandle.style.top = `${(rowMid - base.top) / k}px`;
    this.rowHandle.style.left = `${(Math.max(fr.left, vis.left) - base.left) / k}px`;
    this.rowHandle.dataset.r = String(p.r);
    this.rowHandle.classList.toggle("is-fixed", p.r < headRows(this.table));
    this.rowHandle.dataset.c = String(p.c);
    this.colHandle.style.left = `${(colMid - base.left) / k}px`;
    this.colHandle.style.top = `${(Math.max(hr.top, vis.top) - base.top) / k}px`;
    this.colHandle.dataset.r = String(p.r);
    this.colHandle.dataset.c = String(p.c);
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
      { separator: true },
      align("left", t("alignAllLeft"), "align-left"),
      align("center", t("alignAllCenter"), "align-center"),
      align("right", t("alignAllRight"), "align-right"),
      { separator: true },
      { title: t("headerRows") },
      ...Array.from({ length: MAX_HEAD_ROWS }, (_, i): MenuItem => ({
        title: t("headerRowsN").replace("{n}", String(i + 1)),
        checked: headRows(tb) === i + 1,
        disabled: headRows(tb) !== i + 1 && !canSetHead(tb, i + 1),
        run: () => keep(setTableLook(this.table, { head: i + 1 })),
      })),
      { separator: true },
      { title: t("headerColumn"), icon: "panel-left", checked: !!tb.meta.headerCol, run: () => keep(setTableLook(this.table, { headerCol: !this.table.meta.headerCol })) },
      // 冻结是标题列的选项：标题列开着才出现
      ...(tb.meta.headerCol ? [{ title: t("freezeHeaderCol"), icon: "pin", checked: tb.meta.freeze === 1, run: () => keep(setTableLook(this.table, { freeze: this.table.meta.freeze !== 1 })) }] : []),
      { separator: true },
      { title: t("distributeCols"), icon: "columns-3", run: () => keep(setWidths(this.table, this.colWidths().map((_, _i, all) => all.reduce((a, b) => a + b, 0) / all.length))) },
      { title: t("fitWidth"), icon: "move-horizontal", run: () => keep(setWidths(this.table, this.fitWidths())) },
      { title: t("autoWidthAll"), icon: "move-horizontal", disabled: !tb.meta.w?.some((x) => x != null), run: () => keep(autoWidthAll(this.table)) },
      { title: t("clearAllBg"), icon: "paintbrush", disabled: !Object.keys(tb.meta.bg ?? {}).length && !Object.keys(tb.meta.fg ?? {}).length, run: () => keep(clearAllBg(this.table)) },
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

  /** 每列现在实际的宽度 */
  private colWidths(): number[] {
    const k = this.scale();
    return Array.from(this.tableEl.querySelectorAll("col")).map((c) => c.getBoundingClientRect().width / k);
  }

  /** 撑满页面：按现在各列的比例放大 / 缩小到正文的可用宽度 */
  private fitWidths(): number[] {
    const ws = this.colWidths();
    const sum = ws.reduce((a, b) => a + b, 0) || 1;
    const host = this.root.parentElement;
    // 表格外层左右各有一点留白（放手柄、加号）
    const avail = (host?.clientWidth ?? sum) - 4;
    return ws.map((w) => (w / sum) * avail);
  }

  private rowMenu(p: Pos): MenuItem[] {
    const tb = this.table;
    const head = p.r < headRows(tb);
    return [
      ...this.insertRowItems(p),
      { title: t("duplicateRow"), icon: "copy-plus", disabled: p.r === 0, run: () => this.apply(duplicateRow(tb, p.r), { r: p.r + 1, c: p.c }) },
      { separator: true },
      { title: t("moveRowUp"), icon: "arrow-up", disabled: head || moveRow(tb, p.r, p.r - 1) === tb, run: () => this.apply(moveRow(tb, p.r, p.r - 1), { r: p.r - 1, c: p.c }) },
      { title: t("moveRowDown"), icon: "arrow-down", disabled: head || moveRow(tb, p.r, p.r + 1) === tb, run: () => this.apply(moveRow(tb, p.r, p.r + 1), { r: p.r + 1, c: p.c }) },
      { separator: true },
      ...this.colorItems(Array.from({ length: colCount(tb) }, (_, c) => ({ r: p.r, c }))),
      { separator: true },
      // 选中了好几行时和插入一样按选区来
      this.isMulti() ? this.deleteItems(p)[0] : { title: t("deleteRow"), icon: "trash-2", danger: true, disabled: deleteRow(tb, p.r) === tb, run: () => this.apply(deleteRow(tb, p.r), { r: Math.min(p.r, rowCount(tb) - 2), c: p.c }) },
    ];
  }

  private colMenu(p: Pos): MenuItem[] {
    const tb = this.table;
    return [
      ...this.insertColItems(p),
      { title: t("duplicateCol"), icon: "copy-plus", run: () => this.apply(duplicateCol(tb, p.c), { r: p.r, c: p.c + 1 }) },
      { separator: true },
      ...this.calcItems(p.c),
      { title: tb.meta.opts?.[p.c] ? t("statusOff") : t("statusOn"), icon: "tags", run: () => this.apply(setOptionsCol(tb, p.c, !tb.meta.opts?.[p.c]), p) },
      { separator: true },
      { title: t("sortAsc"), icon: "arrow-down-a-z", disabled: !canSortRows(tb), run: () => this.apply(sortRows(tb, p.c, false, this.hasTotalRow()), p) },
      { title: t("sortDesc"), icon: "arrow-up-z-a", disabled: !canSortRows(tb), run: () => this.apply(sortRows(tb, p.c, true, this.hasTotalRow()), p) },
      { separator: true },
      { title: t("moveColLeft"), icon: "arrow-left", disabled: p.c === 0, run: () => this.apply(moveCol(tb, p.c, p.c - 1), { r: p.r, c: p.c - 1 }) },
      { title: t("moveColRight"), icon: "arrow-right", disabled: p.c >= colCount(tb) - 1, run: () => this.apply(moveCol(tb, p.c, p.c + 1), { r: p.r, c: p.c + 1 }) },
      { separator: true },
      ...this.alignItems(p.c),
      { title: t("autoWidth"), icon: "move-horizontal", disabled: widthOf(tb, p.c) == null, run: () => this.apply(setWidth(tb, p.c, null), p) },
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
    if (multi && rect) mergeItems.push({ title: t("mergeCells"), icon: "combine", disabled: crossesHead(tb, rect), run: () => this.apply(mergeCells(tb, rect), { r: rect.r1, c: rect.c1 }) });
    if (merged) mergeItems.push({ title: t("unmergeCells"), icon: "split", run: () => this.apply(unmergeAt(tb, p.r, p.c), { r: merged.r1, c: merged.c1 }) });
    const cells = multi ? this.rangeCells() : [p];
    const cols = multi && rect ? Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, i) => rect.c1 + i) : [p.c];
    return [
      ...this.insertRowItems(p, merged?.r2),
      ...this.insertColItems(p, merged?.c2),
      { separator: true },
      ...mergeItems,
      ...(mergeItems.length ? [{ separator: true }] : []),
      ...this.alignItems(cols),
      { separator: true },
      ...this.statusColorItems(p),
      ...this.colorItems(cells),
      { separator: true },
      { title: CHECK_RE.test(tb.cells[p.r][p.c]) ? t("removeCheckbox") : t("addCheckbox"), icon: "square-check", disabled: multi, run: () => this.apply(setCell(tb, p.r, p.c, CHECK_RE.test(tb.cells[p.r][p.c]) ? tb.cells[p.r][p.c].replace(CHECK_RE, "").trimStart() : `[ ] ${tb.cells[p.r][p.c]}`.trimEnd()), p) },
      { title: t("clearCell"), icon: "eraser", disabled: !cells.some((c) => tb.cells[c.r][c.c]), run: () => this.apply(clearCells(tb, cells), this.sel ?? p) },
      ...this.deleteItems(p),
    ];
  }

  /** 删除行 / 列：选区跨了几行（几列）就一次删几行（#4）；表头行不能删，至少留下表头和一行、一列 */
  private deleteItems(p: Pos): MenuItem[] {
    const tb = this.table;
    const r = (this.isMulti() && this.rangeRect()) || { r1: p.r, c1: p.c, r2: p.r, c2: p.c };
    const rows = r.r2 - r.r1 + 1;
    const cols = r.c2 - r.c1 + 1;
    return [
      {
        title: rows > 1 ? t("deleteRows").replace("{n}", String(rows)) : t("deleteRow"),
        icon: "trash-2",
        danger: true,
        disabled: r.r1 === 0 || rowCount(tb) - rows < 2 || deleteRow(tb, r.r2) === tb,
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

  /** 状态列的格子：改这个状态的颜色（整列同一个状态一起变） */
  private statusColorItems(p: Pos): MenuItem[] {
    const v = this.table.cells[p.r][p.c].trim();
    const opts = this.table.meta.opts?.[p.c];
    if (!opts || !v || p.r < headRows(this.table)) return [];
    return [
      { title: t("statusColor").replace("{v}", v) },
      ...CELL_COLORS.map((color): MenuItem => ({ swatch: color, title: t(color), checked: opts[v] === color, run: () => this.applyKeepRange(setOptionColor(this.table, p.c, v, color)) })),
      { separator: true },
    ];
  }

  /** 合计：这一列怎么算（求和、平均……），勾着的是现在的 */
  private calcItems(c: number): MenuItem[] {
    const cur = this.table.meta.calc?.[c] ?? null;
    const item = (how: Calc | null): MenuItem => ({
      title: how ? t(`calc_${how}`) : t("calc_none"),
      checked: cur === how,
      disabled: !how && !cur,
      run: () => this.apply(setCalc(this.table, c, how, t("totalLabel")), this.sel ?? undefined),
    });
    return [{ title: t("calcTitle") }, ...CALCS.map((x) => item(x)), item(null), { separator: true }];
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
    return [item("left", t("alignLeft"), "align-left"), item("center", t("alignCenter"), "align-center"), item("right", t("alignRight"), "align-right")];
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

  /** 自己画的弹出菜单：样式统一，色块能排成一行，手机上也好点 */
  private openMenu(items: MenuItem[], x: number, y: number): void {
    this.closePopover();
    const doc = this.root.ownerDocument;
    const pop = doc.body.appendChild(doc.createElement("div"));
    pop.className = "ggt-menu";
    pop.setAttribute("role", "menu");
    let swatches: HTMLElement | null = null;
    for (const item of items) {
      if (item.separator) {
        swatches = null;
        if (pop.lastElementChild && !pop.lastElementChild.classList.contains("ggt-menu-sep")) pop.appendChild(doc.createElement("div")).className = "ggt-menu-sep";
        continue;
      }
      if (item.swatch) {
        if (!swatches) {
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
      b.appendChild(doc.createElement("span")).textContent = item.title ?? "";
      if (item.checked) {
        const ck = b.appendChild(doc.createElement("span"));
        ck.className = "ggt-menu-check";
        if (this.host.setIcon) this.host.setIcon(ck, "check");
        else ck.textContent = "✓";
      }
      b.addEventListener("click", () => {
        this.closePopover();
        item.run?.();
      });
    }
    if (pop.lastElementChild?.classList.contains("ggt-menu-sep")) pop.lastElementChild.remove();
    // 放在点击处，超出窗口就往回挪
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
    pop.style.top = `${Math.max(8, y + r.height > vh - 8 ? Math.max(8, y - r.height) : y)}px`;
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
