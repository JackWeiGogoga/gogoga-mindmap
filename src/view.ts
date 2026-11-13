import { HoverPopover, Menu, normalizePath, Notice, Scope, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { mergeLayout, NODEBAR_DEFAULT, TOOLBAR_DEFAULT } from "./bar-layout";
import { buildSvg, svgToPng } from "./export";
import { mergeExternal, preserveFormat } from "./merge";
import { blankBeforeNodeTables } from "./node-table";
import { MindMapCanvas, NodeCommand } from "./canvas";
import { MARKDOWN_ICON, MINDMAP_ICON } from "./icon";
import { parseColorList, type InlineFormat } from "./format";
import { t } from "./i18n";
import { OutlinePanel } from "./outline";
import { History } from "./history";
import { isStructure, Structure } from "./layout";
import { blankAfterQuotedNotes, frontmatterValue, parseMarkdown, parseNodeColors, pathAtLine, serializeMarkdown, setFrontmatterValue, strippedMarkerRenames } from "./markdown";
import { pathOf, walk, type MindDoc, adoptIds } from "./model";
import type { EdgeOptions, ThemeId } from "./theme";
import { edgeFromFrontmatter, isThemeId } from "./theme";
import type MindMapPlugin from "./main";
import type { ExcerptTarget } from "./pdf-excerpt";
import { indentString, type SavedViewport, ToolbarPosition } from "./settings";

/**
 * 脑图视图的类型名。一直用的是 "mindmap"，但 Mind Map（lynchjames）等插件也叫这个名字：
 * 它先加载时 Obsidian 不让重复登记，整个插件会加载失败（#34）。那时改用 gogoga-mindmap（main.ts 里登记时决定）
 */
export let VIEW_TYPE_MINDMAP = "mindmap";
export const VIEW_TYPE_MINDMAP_FALLBACK = "gogoga-mindmap";
export function useFallbackViewType(): void {
  VIEW_TYPE_MINDMAP = VIEW_TYPE_MINDMAP_FALLBACK;
}

/** 折叠着的节点路径串，比较折叠状态有没有变 */
function foldedSignature(doc: MindDoc): string {
  const out: string[] = [];
  walk(doc.root, (n) => {
    if (n.folded) out.push(pathOf(n));
  });
  return out.join("\n");
}

export class MindMapView extends TextFileView implements ExcerptTarget {
  /** 页面预览（hover-link）需要宿主提供这个字段 */
  hoverPopover: HoverPopover | null = null;
  private canvas: MindMapCanvas | null = null;
  private outline: OutlinePanel | null = null;
  private outlineHost: HTMLElement | null = null;
  private history = new History();
  private doc: MindDoc | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MindMapPlugin) {
    super(leaf);
    // 文件在外部被改动时不要 Obsidian 按字符合并（两边改同一行会拼成一团），由 setViewData 按行合并、冲突时保留脑图的
    (this as unknown as { isPlaintext: boolean }).isPlaintext = false;
    // 读完文件时视图已经换了别的文件，晚到的内容不能留下（#30）
    this.guardLoads();
    // 视图激活时 ⌘F 归我们，否则会被 Obsidian 的「搜索当前文件」截走
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "f", () => {
      this.canvas?.openSearch();
      return false;
    });
    this.scope.register(["Mod"], "k", () => {
      void this.canvas?.linkSelectedToNote();
      return false;
    });
    // ⌘↵ 插入父节点（XMind 的习惯）。全局的 ⌘↵ 是「在新标签页打开链接」，按键根本到不了画布，
    // 只能在视图的 Scope 里截；用户自己把 ⌘↵ 绑给了本插件别的命令就执行那个
    this.scope.register(["Mod"], "Enter", (ev) => {
      const own = this.plugin.ownHotkeyCommand(ev);
      const commands = (this.app as unknown as { commands?: { executeCommandById?: (id: string) => boolean } }).commands;
      if (own && own !== `${this.plugin.manifest.id}:insert-parent` && commands?.executeCommandById) commands.executeCommandById(own);
      else this.canvas?.handleModEnter(ev);
      return false;
    });
    // ⌘B / ⌘I 是 Obsidian 编辑器「加粗 / 斜体」的默认热键，在脑图里也会被它截走（然后因为没有编辑器什么都不做），
    // 得在这里截下来自己处理；用户把这两个键绑给了本插件的命令就执行那个
    for (const [k, kind] of [["b", "bold"], ["i", "italic"]] as const) {
      this.scope.register(["Mod"], k, (ev) => {
        const own = this.plugin.ownHotkeyCommand(ev);
        const commands = (this.app as unknown as { commands?: { executeCommandById?: (id: string) => boolean } }).commands;
        if (own && commands?.executeCommandById) commands.executeCommandById(own);
        else this.canvas?.formatText({ kind });
        return false;
      });
    }
  }

  linkSelectedToNote(): Promise<void> {
    return this.canvas?.linkSelectedToNote() ?? Promise.resolve();
  }

  setToolbarPosition(pos: ToolbarPosition): void {
    this.canvas?.setToolbarPosition(pos);
  }

  focusSelected(): void {
    const n = this.canvas?.getPrimary();
    if (n) this.canvas?.focusOn(n);
  }

  exitFocus(): void {
    this.canvas?.exitFocus();
  }

  copySelectedNodeLink(): Promise<void> {
    const n = this.canvas?.getPrimary();
    return n ? (this.canvas?.copyNodeLink(n) ?? Promise.resolve()) : Promise.resolve();
  }

  async toggleOutline(): Promise<void> {
    if (this.outline) this.closeOutline();
    else this.openOutline();
    this.plugin.settings.outlineOpen = !!this.outline;
    await this.plugin.saveSettings();
  }

  private openOutline(): void {
    if (this.outline || !this.canvas || !this.outlineHost) return;
    this.outline = new OutlinePanel(this.outlineHost, this.canvas, () => void this.toggleOutline());
    this.contentEl.addClass("has-outline");
  }

  private closeOutline(): void {
    this.outline?.destroy();
    this.outline = null;
    this.contentEl.removeClass("has-outline");
  }

  openSearch(): void {
    this.canvas?.openSearch();
  }

  /** 折叠 / 展开选中的节点（画布里按 / 也是它） */
  toggleFoldSelected(): void {
    const n = this.canvas?.getPrimary();
    if (n?.children.length) this.canvas?.toggleFold(n);
  }

  private following = false;

  /** 分屏联动：Markdown 光标在第 line 行，选中对应节点（只在看不见时挪画面） */
  /** 同一篇的 Markdown 有没有显示着、联动开关现在的状态：刷新工具栏上的分屏联动按钮 */
  updateSplitSync(available: boolean): void {
    this.canvas?.setSplitSyncAvailable(available);
    this.sideAction?.toggle(!available);
  }

  followLine(text: string, line: number): void {
    if (!this.canvas) return;
    const path = pathAtLine(text, line, this.plugin.rootRule());
    if (path === null || path === this.canvas.getSelectedPath()) return;
    this.following = true;
    try {
      this.canvas.followPath(path, this.plugin.settings.followExpand);
    } finally {
      this.following = false;
    }
  }

  /** 标记的定义变了：节点开头哪些算标记要重新认，不能复用旧的节点 DOM */
  redrawAll(): void {
    this.canvas?.redrawAll();
  }

  toggleNotes(): void {
    this.canvas?.toggleNotes();
  }

  toggleCallouts(): void {
    this.canvas?.toggleCallouts();
  }

  applyLock(locked: boolean): void {
    this.canvas?.setLocked(locked);
  }

  /** state.json 被别的设备同步改过：按新的锁定、标注、备注状态更新这张图 */
  applyFileState(): void {
    const path = this.file?.path;
    const c = this.canvas;
    if (!path || !c) return;
    if (c.isLocked() !== this.plugin.isLocked(path)) c.setLocked(this.plugin.isLocked(path));
    let redraw = false;
    if (c.isCalloutsHidden() !== this.plugin.isCalloutsHidden(path)) {
      c.setCalloutsHidden(this.plugin.isCalloutsHidden(path));
      redraw = true;
    }
    if (c.isNotesExpanded() !== this.plugin.isNotesExpanded(path)) {
      c.setNotesExpanded(this.plugin.isNotesExpanded(path));
      redraw = true;
    }
    const cards = this.plugin.getNoteCards(path);
    if (JSON.stringify(cards ?? {}) !== JSON.stringify(c.getNoteCards())) {
      c.setNoteCards(cards);
      redraw = true;
    }
    if (redraw) c.render();
  }

  toggleLock(): void {
    if (!this.canvas || !this.file) return;
    this.canvas.setLocked(!this.canvas.isLocked());
    this.plugin.setLocked(this.file.path, this.canvas.isLocked());
  }

  toggleRecite(): void {
    this.canvas?.setRecite(!this.canvas.isRecite());
  }

  // ---------- PDF 自动摘录（见 pdf-excerpt.ts） ----------

  private excerptAction: HTMLElement | null = null;

  pasteExcerpt(text: string): boolean {
    return this.canvas?.pasteText(text, false) ?? false;
  }

  isAlive(): boolean {
    return !!this.canvas && this.containerEl.isConnected;
  }

  private sideAction: HTMLElement | null = null;

  /** 摘录开着时标题栏多一个高亮的按钮，点它关掉 */
  setExcerpting(on: boolean): void {
    this.excerptAction?.remove();
    this.excerptAction = null;
    if (!on) return;
    this.excerptAction = this.addAction("file-input", t("action.stopExcerpt"), () => this.plugin.pdfExcerpt.toggle(this));
    this.excerptAction.addClass("is-active", "mm-excerpt-action");
  }

  fitSelectedBranch(): void {
    const n = this.canvas?.getPrimary();
    if (n) this.canvas?.fitBranch(n);
  }

  formatText(fmt: InlineFormat): void {
    this.canvas?.formatText(fmt);
  }

  formatColor(kind: "color" | "bg", index: number): void {
    this.canvas?.formatColor(kind, index);
  }

  toggleBoxOnSelected(): void {
    this.canvas?.toggleBoxOnSelected();
  }

  toggleSummaryOnSelected(): void {
    this.canvas?.toggleSummaryOnSelected();
  }

  toggleNumberingOnSelected(): void {
    this.canvas?.toggleNumbering();
  }

  runNodeCommand(cmd: NodeCommand): void {
    this.canvas?.runNodeCommand(cmd);
  }

  /** 自定义主题改了之后重画（主题 id 不变，样式和行为可能变了） */
  refreshTheme(): void {
    const c = this.canvas;
    if (c) c.setTheme(c.getTheme());
  }

  setFoldLevel(level: number | null): void {
    this.canvas?.setFoldLevel(level);
  }

  /** 和数字键一样：从选中的节点往下算 */
  showLevelFromSelected(level: number): void {
    this.canvas?.setFoldLevel(level, this.canvas.getPrimary());
  }

  getViewType(): string {
    return VIEW_TYPE_MINDMAP;
  }

  getDisplayText(): string {
    return this.file?.basename ?? t("view.displayText");
  }

  getIcon(): string {
    return MINDMAP_ICON;
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("mm-view-content");
    this.addAction(MARKDOWN_ICON, t("menu.openAsMarkdown"), () => {
      if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
    });
    // 分屏对照：左边 Markdown、右边脑图。旁边已经开着这篇的 Markdown 时藏起来（见 updateSplitSync）
    this.sideAction = this.addAction("columns-2", t("command.openPreview"), () => {
      if (this.file) void this.plugin.openSideBySide(this.file, this.leaf);
    });
    this.sideAction.addClass("mm-side-action");
    this.outlineHost = this.contentEl.createDiv({ cls: "mm-outline-host" });
    const host = this.contentEl.createDiv({ cls: "mm-canvas-host" });
    this.canvas = new MindMapCanvas(host, {
      structure: this.plugin.settings.defaultStructure,
      theme: this.plugin.settings.defaultTheme,
      editable: true,
      host: this.plugin.canvasHost(() => this.file?.path ?? "", this, this),
      onChange: (doc) => this.onDocChange(doc),
      fallbackTitle: () => this.file?.basename ?? "",
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onStructureChange: (s) => this.persistStructure(s),
      onThemeChange: (t) => this.persistTheme(t),
      onEdgeChange: (e) => this.persistEdge(e),
      onRender: () => this.outline?.refresh(),
      onSelectionChange: (primary) => {
        this.outline?.syncSelection(primary);
        this.rememberViewportSoon();
        // 跟着 Markdown 光标选中的，不再推回去
        if (!this.following) this.plugin.syncMarkdownToMap(this);
      },
      initialView: () => this.plugin.settings.openView,
      onViewChange: () => this.rememberViewportSoon(),
      onRevealInMarkdown: () => {
        if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
      },
      onToggleOutline: () => void this.toggleOutline(),
      onSideBySide: () => {
        if (this.file) void this.plugin.openSideBySide(this.file, this.leaf);
      },
      showHidden: () => this.plugin.showHidden,
      onToggleHidden: () => this.plugin.toggleShowHidden(),
      onLockChange: (locked) => {
        if (this.file) this.plugin.setLocked(this.file.path, locked);
      },
      splitSync: {
        on: () => this.plugin.settings.syncSplit,
        toggle: () => void this.plugin.setSyncSplit(!this.plugin.settings.syncSplit),
      },
      toolbarPosition: this.plugin.settings.toolbarPosition,
      wheelZoom: () => this.plugin.settings.wheelAction === "zoom",
      notePreview: () => this.plugin.settings.notePreview,
      formatBar: () => this.plugin.settings.formatBar,
      split: () => this.plugin.splitPrefs(),
      keepBlankLines: () => this.plugin.settings.keepBlankLines,
      quickSettings: () => this.plugin.quickSettings(),
      centerOnSelect: () => this.plugin.settings.centerOnSelect,
      hideSyntax: () => this.plugin.settings.hideSyntax,
      widthHandleOnHover: () => this.plugin.settings.widthHandleOnHover,
      newNodeName: () => this.plugin.settings.newNodeName,
      autoNumber: () => this.plugin.settings.numberByTyping,
      copyPlain: () => this.plugin.settings.copyPlain,
      showNodebar: () => this.plugin.settings.showNodebar,
      nodebarLayout: () => mergeLayout(this.plugin.settings.nodebarLayout, NODEBAR_DEFAULT),
      toolbarLayout: () => mergeLayout(this.plugin.settings.toolbarLayout, TOOLBAR_DEFAULT),
      nodeColors: () => parseNodeColors(this.plugin.settings.nodeColors),
      textColors: () => parseColorList(this.plugin.settings.textColors),
      highlightColors: () => parseColorList(this.plugin.settings.highlightColors, true),
      colorMemory: this.plugin.colorMemory,
      marqueeDrag: () => this.plugin.settings.leftDrag === "select",
      caretAtEnd: () => this.plugin.settings.editCaret === "end",
      dragToFloat: () => this.plugin.settings.dragToFloat,
      calloutsHidden: () => this.plugin.isCalloutsHidden(this.file?.path ?? ""),
      onCalloutsHiddenChange: (hidden) => {
        if (this.file) this.plugin.setCalloutsHidden(this.file.path, hidden);
      },
      notesExpanded: () => this.plugin.isNotesExpanded(this.file?.path ?? ""),
      noteCardFilter: () => this.plugin.settings.noteCardShow,
      onNotesExpandedChange: (expanded) => {
        if (this.file) this.plugin.setNotesExpanded(this.file.path, expanded);
      },
      onNoteCardsChange: (cards) => {
        if (this.file) this.plugin.setNoteCards(this.file.path, cards);
      },
      notePopoverSize: this.plugin.notePopoverSize,
      ownsHotkey: (ev) => this.plugin.isOwnHotkey(ev),
      onToolbarPositionChange: (pos) => {
        this.plugin.settings.toolbarPosition = pos;
        void this.plugin.saveSettings();
        this.plugin.applyToolbarPosition(this);
      },
    });
    if (this.plugin.settings.outlineOpen) this.openOutline();
  }

  getSelectedPath(): string | null {
    return this.canvas?.getSelectedPath() ?? null;
  }

  /** 链接带过来的 #^块id / #标题（Obsidian 打开 [[笔记#…]] 时传进来）：内容还没读进来就先记着 */
  private pendingSubpath: string | null = null;

  setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const st = state as { subpath?: unknown; line?: unknown } | null;
    const sub = st?.subpath;
    if (typeof sub === "string" && sub.replace(/^#/, "")) {
      if (this.doc && this.canvas) this.canvas.revealSubpath(sub);
      else this.pendingSubpath = sub;
      return;
    }
    // 按行号跳过来的（PDF++ 点标注回到笔记里引用它的那一行、反向链接、搜索结果）：选中这一行所在的节点
    if (typeof st?.line === "number" && st.line >= 0) {
      if (this.doc && this.canvas) this.revealLine(st.line);
      else this.pendingLine = st.line;
    }
  }

  private pendingLine: number | null = null;

  private revealLine(line: number): boolean {
    const path = pathAtLine(this.data, line, this.plugin.rootRule());
    return path !== null && !!this.canvas?.revealPathFlash(path);
  }

  /** 选中路径对应的节点并移到中间（从 Markdown 切回来时） */
  revealPath(path: string): void {
    this.canvas?.revealPath(path);
  }

  private viewportTimer: number | null = null;
  /** 平移、缩放、选中变了就记下来（攒 300ms），下次打开这个文件时恢复 */
  private rememberViewportSoon(): void {
    if (this.viewportTimer !== null) window.clearTimeout(this.viewportTimer);
    this.viewportTimer = window.setTimeout(() => this.rememberViewportNow(), 300);
  }

  rememberViewportNow(): void {
    if (this.viewportTimer !== null) window.clearTimeout(this.viewportTimer);
    this.viewportTimer = null;
    // 还没渲染出来（刚打开、文件为空）时的视口没有意义，别把记住的覆盖掉
    if (!this.canvas || !this.file || !this.doc || this.restoringViewport) return;
    this.plugin.rememberViewport(this.file.path, { ...this.canvas.getViewState(), sel: this.canvas.getSelectedPath() });
  }
  private restoringViewport = false;

  /**
   * Obsidian 读完文件就把内容填进视图，不看这时视图是不是已经换了别的文件（打开文件、文件在外面被改了都走这里）。
   * 上一篇读得慢（库外的笔记、网盘）、中途又换到下一篇时，上一篇的内容会晚到、盖掉下一篇：
   * 标签页是 B、脑图里是 A，一存盘 B 就被 A 覆盖（#30）。读完发现文件已经换了：先禁止写盘，再按现在的文件重读一遍
   */
  private guardLoads(): void {
    const base = (TextFileView.prototype as unknown as { loadFileInternal?: (f: TFile, c: boolean) => Promise<void> }).loadFileInternal;
    // 内部方法：哪天 Obsidian 改了名就不挂，照旧由它自己读
    if (typeof base !== "function") return;
    (this as unknown as { loadFileInternal: (f: TFile, c: boolean) => Promise<void> }).loadFileInternal = async (file: TFile, clear: boolean) => {
      await base.call(this, file, clear);
      for (let i = 0; i < 3 && this.file && this.file !== file; i++) {
        const cur: TFile = this.file;
        (this as unknown as { lastSavedData: string | null }).lastSavedData = null;
        await base.call(this, cur, true);
        file = cur;
      }
    };
  }

  /** 卸载前把正在输入的内容提交，Obsidian 随后会 save(true) 写盘 */
  async onUnloadFile(file: TFile): Promise<void> {
    this.rememberViewportNow();
    this.canvas?.flush();
    this.flushImageSweep();
    return super.onUnloadFile(file);
  }

  async onClose(): Promise<void> {
    // FileView.onClose 会 loadFile(null) → onUnloadFile → TextFileView.save(true)，
    // 这是视图被替换（切 Markdown 视图、同一标签页打开别的笔记）时最后一次写盘的机会，不能漏掉 super
    this.canvas?.flush();
    if (this.plugin.pdfExcerpt.isOn(this)) this.plugin.pdfExcerpt.stop();
    await super.onClose();
    this.outline?.destroy();
    this.outline = null;
    this.canvas?.destroy();
    this.canvas = null;
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle(t("menu.openAsMarkdown"))
        .setIcon(MARKDOWN_ICON)
        .setSection("pane")
        .onClick(() => {
          if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
        }),
    );
    menu.addItem((item) => item.setTitle(t("command.exportPng")).setIcon("image").setSection("pane").onClick(() => void this.exportPng()));
    menu.addItem((item) => item.setTitle(t("command.exportSvg")).setIcon("image").setSection("pane").onClick(() => void this.exportSvg()));
    menu.addItem((item) => item.setTitle(t("command.copyPng")).setIcon("copy").setSection("pane").onClick(() => void this.copyPng()));
  }

  // ---------- 导出 ----------

  private async attachmentPath(ext: string): Promise<string> {
    if (!this.file) throw new Error(t("error.noOpenFile"));
    return this.app.fileManager.getAvailablePathForAttachment(`${this.file.basename}.${ext}`, this.file.path);
  }

  async exportPng(): Promise<void> {
    if (!this.canvas) return;
    try {
      this.canvas.select(null);
      const blob = await svgToPng(await buildSvg(this.canvas), 2);
      const path = await this.attachmentPath("png");
      await this.app.vault.createBinary(path, await blob.arrayBuffer());
      new Notice(t("notice.exported", { path }));
    } catch (e) {
      new Notice(t("notice.exportFailed", { error: (e as Error).message }));
    }
  }

  async exportSvg(): Promise<void> {
    if (!this.canvas) return;
    try {
      this.canvas.select(null);
      const { svg } = await buildSvg(this.canvas);
      const path = await this.attachmentPath("svg");
      await this.app.vault.create(path, svg);
      new Notice(t("notice.exported", { path }));
    } catch (e) {
      new Notice(t("notice.exportFailed", { error: (e as Error).message }));
    }
  }

  async copyPng(): Promise<void> {
    if (!this.canvas) return;
    try {
      this.canvas.select(null);
      const blob = await svgToPng(await buildSvg(this.canvas), 2);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      new Notice(t("notice.copiedAsImage"));
    } catch (e) {
      new Notice(t("notice.copyFailedWithError", { error: (e as Error).message }));
    }
  }

  /** 有没有还没写盘的改动 */
  hasUnsavedChanges(): boolean {
    return (this as unknown as { dirty?: boolean }).dirty === true;
  }

  getViewData(): string {
    // 自动保存可能发生在输入途中：先把正在输入的标签/备注同步进树，再交出数据
    this.canvas?.syncPending();
    return this.data;
  }

  /** 脑图这边的文本。文件在外部变了时，Obsidian 调 setViewData 之前已经把 this.data 换成磁盘内容，本地版本靠这个找回 */
  private local = "";
  /** 上次读入或写盘时磁盘上的文本，外部改动和本地没落盘的编辑合并时的基准 */
  private disk: string | null = null;

  /**
   * 写盘。库外的笔记（Obsidian 能直接打开库外的 md，路径是 file:/…）：写盘时 Obsidian 发的 modify 事件早于内容就绪，
   * 旁边开着它的 Markdown 读到的还是旧内容、一直不刷新（#30）。写完再通知一次；库内的笔记不受影响
   */
  async save(clear?: boolean): Promise<void> {
    const file = this.file;
    const saving = super.save(clear);
    // TextFileView 在真正写盘前就同步记下了要写的文本（没变、正在写的不记）
    const saved = (this as unknown as { lastSavedData: string | null }).lastSavedData;
    if (saved !== null) this.disk = saved;
    await saving;
    if (file && file.path.startsWith("file:") && this.app.vault.getAbstractFileByPath(file.path)) this.app.vault.trigger("modify", file);
  }

  setViewData(data: string, clear: boolean): void {
    // 外面来的内容（打开文件、Markdown 那边改的、同步来的）：先把脑图里还没清理的删除处理掉，再按新内容记下用到的图片
    this.flushImageSweep();
    this.applyViewData(data, clear);
    this.usedImages = this.file ? this.plugin.janitor.images(this.data, this.file.path) : null;
  }

  /** 打开文件时把按路径记下的状态放到画布上，返回记下的视口（选中节点要等图建好再用） */
  private restoreFileState(file: TFile | null): SavedViewport | undefined {
    if (!file || !this.canvas) return undefined;
    const p = file.path;
    const saved = this.plugin.getViewport(p);
    this.canvas.setCalloutsHidden(this.plugin.isCalloutsHidden(p));
    this.canvas.setNotesExpanded(this.plugin.isNotesExpanded(p));
    this.canvas.setNoteCards(this.plugin.getNoteCards(p));
    this.canvas.setLocked(this.plugin.isLocked(p));
    if (saved) {
      this.restoringViewport = true;
      try {
        this.canvas.setViewState(saved);
      } finally {
        this.restoringViewport = false;
      }
    }
    return saved;
  }

  private applyViewData(data: string, clear: boolean): void {
    if (clear) this.history.reset();
    if (!clear && this.canvas) {
      const merged = this.mergeWithLocal(data);
      this.disk = data;
      if (merged !== data) {
        if (merged !== this.data) {
          this.data = this.local = merged;
          this.reparse();
        }
        this.requestSave();
        return;
      }
    }
    this.disk = data;
    this.data = this.local = data;
    const prev = this.doc;
    this.doc = this.parseText(data);
    // 内容变了（不是打开文件）：没变的节点沿用编号，画布只重建改了的
    if (!clear && prev) adoptIds(prev.root, this.doc.root);
    this.lastFolds = foldedSignature(this.doc);
    this.applyFrontmatterOptions(this.doc);
    // 打开文件（不是文件内容变了）时恢复上次的视口和选中
    const file = clear ? this.file : null;
    let saved: SavedViewport | undefined;
    try {
      saved = this.restoreFileState(file);
      this.canvas?.setDoc(this.doc);
    } catch (e) {
      if (!file) throw e;
      // 按路径记下的状态（视口、锁定、备注……）坏了让图打不开：丢掉这些记录，按默认样子再打开一次。
      // 文件内容一点不动（B 站 FORMORE 2026-11-11：复杂的图点开就闪退，建个副本就能打开）
      console.error("gogoga-mindmap: saved view state of", file.path, "broke opening it; reset", e);
      this.restoringViewport = false;
      this.plugin.forgetFileState(file.path);
      this.canvas?.resetView();
      saved = this.restoreFileState(file);
      this.canvas?.setDoc(this.doc);
      new Notice(t("notice.viewStateReset", { file: file.basename }));
    }
    const sub = this.pendingSubpath;
    this.pendingSubpath = null;
    const line = this.pendingLine;
    this.pendingLine = null;
    // 从链接点进来的，定位到链接指的节点；不然恢复上次的选中
    if (sub && this.canvas?.revealSubpath(sub)) return;
    if (line !== null && this.revealLine(line)) return;
    if (saved?.sel != null) this.canvas?.selectPath(saved.sel);
  }

  /**
   * 文件在外部变了：脑图这边没落盘的编辑（已经进了文本的，和画布上还没提交的）和磁盘上的改动合到一起。
   * 两边改到同一处时以脑图这边为准，提示一下；磁盘上那次改动会被下次保存覆盖
   */
  private mergeWithLocal(disk: string): string {
    const base = this.disk;
    this.data = this.local;
    // 提交画布上的编辑；这里可能顺手存一次盘（折叠跟随），基准得在这之前取
    this.canvas?.flush();
    const ours = this.data;
    if (base === null) return ours;
    const merged = mergeExternal(base, ours, disk);
    if (merged !== null) return merged;
    new Notice(t("notice.externalConflict", { file: this.file?.basename ?? "" }));
    return ours;
  }

  /**
   * 旁边的 Markdown 编辑器正在改同一个文件：不等它落盘（约 2 秒），直接跟上。
   * 脑图这边有没提交的编辑时跳过，等落盘后走 setViewData 的正常合并。
   * path 是那段文字所属的文件：脑图这时已经换了别的文件就不收，免得把一篇笔记的内容存进另一篇（#30）
   */
  syncFromEditor(text: string, path: string): void {
    if (!this.canvas || !this.file || this.file.path !== path || text === this.data || this.canvas.isBusy()) return;
    this.data = text;
    this.setViewData(text, false);
  }

  clear(): void {
    this.data = this.local = "";
    this.disk = null;
    this.doc = null;
    this.history.reset();
  }

  private applyFrontmatterOptions(doc: MindDoc): void {
    if (!this.canvas) return;
    const structure = frontmatterValue(doc.frontmatter, "mindmap-structure");
    this.canvas.setStructure(isStructure(structure) ? structure : this.plugin.settings.defaultStructure);
    const theme = frontmatterValue(doc.frontmatter, "mindmap-theme");
    this.canvas.setTheme(isThemeId(theme) ? theme : this.plugin.settings.defaultTheme);
    this.canvas.setEdge(edgeFromFrontmatter((k) => frontmatterValue(doc.frontmatter, k)));
  }

  /** 这张图上次清理以来用到过的图片附件（删除节点时清理不再使用的图片，见 attachment-cleanup.ts） */
  private usedImages: Map<TFile, string[]> | null = null;
  private sweepTimer: number | null = null;

  /** 脑图里的编辑改了文本：撤销让图片链接回来的，马上写回文件；删掉的，停手两秒再清理（剪切后马上粘贴就不动） */
  private imagesChanged(): void {
    if (!this.file) return;
    void this.plugin.janitor.restoreMissing(this.data, this.file.path);
    // 两秒内出现过的图片都记着（撤销回来又删掉的也算），到时候「出现过、现在没了」的才清理
    const seen = this.usedImages ?? new Map<TFile, string[]>();
    for (const [f, links] of this.plugin.janitor.images(this.data, this.file.path)) seen.set(f, [...new Set([...(seen.get(f) ?? []), ...links])]);
    this.usedImages = seen;
    const win = this.contentEl.win;
    if (this.sweepTimer !== null) win.clearTimeout(this.sweepTimer);
    this.sweepTimer = win.setTimeout(() => this.flushImageSweep(), 2000);
  }

  private flushImageSweep(): void {
    if (this.sweepTimer === null) return;
    this.contentEl.win.clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    const file = this.file;
    if (!file) return;
    const before = this.usedImages;
    const now = this.plugin.janitor.images(this.data, file.path);
    this.usedImages = now;
    if (!before || !this.plugin.settings.cleanAttachments) return;
    const removed = new Map([...before].filter(([f]) => !now.has(f)));
    if (!removed.size) return;
    const path = file.path;
    const snapshot = this.data;
    void this.plugin.janitor.sweep(removed, path, () => (this.file?.path === path ? this.data : snapshot));
  }

  /** 上次保存时折叠着的节点（路径），判断这次改动有没有改折叠 */
  private lastFolds: string | null = null;

  private onDocChange(doc: MindDoc): void {
    // 中心主题是文件名（不是一级标题）时，改它就是给笔记改名（#27）；它本身不写进文件
    if (this.file && !doc.rootFromHeading && doc.root.text !== this.file.basename) this.renameFromRoot(doc, this.file);
    // 原文里这次没碰到的行保持原样（空行、缩进、行尾空格……），只有改动的地方按插件的格式写
    let next = blankBeforeNodeTables(preserveFormat(this.data, serializeMarkdown(doc), (text) => serializeMarkdown(this.parseText(text))));
    // 设置「列表项下的备注写成引用块」：这次改过的引用块备注后面补空行（合并时会被当成格式差异去掉）
    if (this.plugin.settings.quoteListNotes) next = blankAfterQuotedNotes(next, this.data);
    // 标题的标记从行末挪到下一行后，标题文字变了：别的笔记里指向旧标题（带着 %%标记%%）的链接跟着改
    if (this.file && next !== this.data) this.plugin.fixHeadingLinks(this.file, strippedMarkerRenames(this.data, next));
    if (next === this.data) return;
    this.history.push(this.data);
    this.data = this.local = next;
    this.imagesChanged();
    // 「Markdown 跟着脑图折叠」：折叠状态变了就马上存，不等 Obsidian 两秒的延迟保存，Markdown 那边才跟得上
    const folds = this.plugin.settings.foldFollow ? foldedSignature(doc) : null;
    if (folds !== null && folds !== this.lastFolds) {
      this.lastFolds = folds;
      void this.save();
      return;
    }
    this.requestSave();
  }

  private renameFromRoot(doc: MindDoc, file: TFile): void {
    const name = doc.root.text.trim();
    const revert = (msg?: string) => {
      if (msg) new Notice(msg);
      doc.root.text = file.basename;
      this.contentEl.win.setTimeout(() => this.canvas?.render(), 0);
    };
    if (!name || name === file.basename) return revert();
    if (/[\\/:*?"<>|#^[\]]/.test(name)) return revert(t("notice.rootBadName"));
    const dir = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
    const path = normalizePath(`${dir}${name}.${file.extension}`);
    const taken = this.app.vault.getAbstractFileByPath(path);
    if (taken && taken !== file) return revert(t("notice.rootNameTaken", { name }));
    doc.root.text = name;
    this.app.fileManager.renameFile(file, path).catch((e: unknown) => revert(String(e)));
  }

  /** 笔记改名了（在哪改的都算）：中心主题是文件名时跟着变 */
  async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    if (this.doc && !this.doc.rootFromHeading && this.doc.root.text !== file.basename) {
      this.doc.root.text = file.basename;
      this.canvas?.render();
    }
  }

  private persistTheme(theme: ThemeId): void {
    if (!this.doc) return;
    const value = theme === this.plugin.settings.defaultTheme ? null : theme;
    this.doc.frontmatter = setFrontmatterValue(this.doc.frontmatter, "mindmap-theme", value);
    if (!this.doc.frontmatter) this.doc.frontmatter = setFrontmatterValue("", "mindmap", "true");
    this.onDocChange(this.doc);
  }

  private persistEdge(edge: EdgeOptions): void {
    if (!this.doc) return;
    this.doc.frontmatter = setFrontmatterValue(this.doc.frontmatter, "mindmap-edge", edge.shape ?? null);
    this.doc.frontmatter = setFrontmatterValue(this.doc.frontmatter, "mindmap-edge-dash", edge.dashed === undefined ? null : String(edge.dashed));
    this.doc.frontmatter = setFrontmatterValue(this.doc.frontmatter, "mindmap-edge-corner", edge.sharp === undefined ? null : edge.sharp ? "sharp" : "round");
    if (!this.doc.frontmatter) this.doc.frontmatter = setFrontmatterValue("", "mindmap", "true");
    this.onDocChange(this.doc);
  }

  private persistStructure(structure: Structure): void {
    if (!this.doc) return;
    const value = structure === this.plugin.settings.defaultStructure ? null : structure;
    this.doc.frontmatter = setFrontmatterValue(this.doc.frontmatter, "mindmap-structure", value);
    if (!this.doc.frontmatter) this.doc.frontmatter = setFrontmatterValue("", "mindmap", "true");
    this.onDocChange(this.doc);
  }

  private undo(): void {
    // 锁定编辑时撤销重做也不动文件
    if (this.canvas?.isLocked()) return;
    const prev = this.history.undo(this.data);
    if (prev === null) return;
    this.data = this.local = prev;
    this.reparse();
    this.imagesChanged();
    this.requestSave();
  }

  private redo(): void {
    if (this.canvas?.isLocked()) return;
    const next = this.history.redo(this.data);
    if (next === null) return;
    this.data = this.local = next;
    this.reparse();
    this.imagesChanged();
    this.requestSave();
  }

  /** 影响解析结果的设置变了（比如中心主题规则）：按当前文本重新解析 */
  reloadFromSettings(): void {
    if (!this.doc) return;
    // 画布上还没落盘的编辑先交出来，再按新规则重新解析，不然就丢了
    this.canvas?.flush();
    this.reparse();
  }

  /** 按这个视图的规则解析一段文本（文件名作兜底标题、中心主题规则、新节点的写法） */
  private parseText(text: string): MindDoc {
    return parseMarkdown(text, {
      fallbackTitle: this.file?.basename ?? "",
      ...this.plugin.rootRule(),
      // 只把标题当节点时新节点一律写成标题，能写到六级
      style: { maxHeadingLevel: this.plugin.settings.headingsOnly ? 6 : this.plugin.settings.maxHeadingLevel, indent: indentString(this.plugin.settings.indent) },
    });
  }

  private reparse(): void {
    const prev = this.doc;
    this.doc = this.parseText(this.data);
    if (prev) adoptIds(prev.root, this.doc.root);
    this.applyFrontmatterOptions(this.doc);
    this.canvas?.setDoc(this.doc);
  }

}
