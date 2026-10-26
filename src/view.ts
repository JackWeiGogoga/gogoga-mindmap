import { HoverPopover, Menu, Notice, Scope, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { buildSvg, svgToPng } from "./export";
import { MindMapCanvas, NodeCommand } from "./canvas";
import { MINDMAP_ICON } from "./icon";
import { t } from "./i18n";
import { OutlinePanel } from "./outline";
import { History } from "./history";
import { isStructure, Structure } from "./layout";
import { frontmatterValue, parseMarkdown, serializeMarkdown, setFrontmatterValue } from "./markdown";
import type { MindDoc } from "./model";
import type { EdgeOptions, ThemeId } from "./theme";
import { edgeFromFrontmatter, isThemeId } from "./theme";
import type MindMapPlugin from "./main";
import { indentString, ToolbarPosition } from "./settings";

export const VIEW_TYPE_MINDMAP = "mindmap";

export class MindMapView extends TextFileView {
  /** 页面预览（hover-link）需要宿主提供这个字段 */
  hoverPopover: HoverPopover | null = null;
  private canvas: MindMapCanvas | null = null;
  private outline: OutlinePanel | null = null;
  private outlineHost: HTMLElement | null = null;
  private history = new History();
  private doc: MindDoc | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MindMapPlugin) {
    super(leaf);
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

  toggleRecite(): void {
    this.canvas?.setRecite(!this.canvas.isRecite());
  }

  fitSelectedBranch(): void {
    const n = this.canvas?.getPrimary();
    if (n) this.canvas?.fitBranch(n);
  }

  toggleBoxOnSelected(): void {
    this.canvas?.toggleBoxOnSelected();
  }

  toggleSummaryOnSelected(): void {
    this.canvas?.toggleSummaryOnSelected();
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
    this.addAction("file-text", t("menu.openAsMarkdown"), () => {
      if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
    });
    this.outlineHost = this.contentEl.createDiv({ cls: "mm-outline-host" });
    const host = this.contentEl.createDiv({ cls: "mm-canvas-host" });
    this.canvas = new MindMapCanvas(host, {
      structure: this.plugin.settings.defaultStructure,
      theme: this.plugin.settings.defaultTheme,
      editable: true,
      host: this.plugin.canvasHost(() => this.file?.path ?? "", this, this),
      onChange: (doc) => this.onDocChange(doc),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onStructureChange: (s) => this.persistStructure(s),
      onThemeChange: (t) => this.persistTheme(t),
      onEdgeChange: (e) => this.persistEdge(e),
      onRender: () => this.outline?.refresh(),
      onSelectionChange: (primary) => {
        this.outline?.syncSelection(primary);
        this.rememberViewportSoon();
      },
      onViewChange: () => this.rememberViewportSoon(),
      onRevealInMarkdown: () => {
        if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
      },
      onToggleOutline: () => void this.toggleOutline(),
      toolbarPosition: this.plugin.settings.toolbarPosition,
      wheelZoom: () => this.plugin.settings.wheelAction === "zoom",
      marqueeDrag: () => this.plugin.settings.leftDrag === "select",
      caretAtEnd: () => this.plugin.settings.editCaret === "end",
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

  /** 卸载前把正在输入的内容提交，Obsidian 随后会 save(true) 写盘 */
  async onUnloadFile(file: TFile): Promise<void> {
    this.rememberViewportNow();
    this.canvas?.flush();
    return super.onUnloadFile(file);
  }

  async onClose(): Promise<void> {
    // FileView.onClose 会 loadFile(null) → onUnloadFile → TextFileView.save(true)，
    // 这是视图被替换（切 Markdown 视图、同一标签页打开别的笔记）时最后一次写盘的机会，不能漏掉 super
    this.canvas?.flush();
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
        .setIcon("file-text")
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

  getViewData(): string {
    // 自动保存可能发生在输入途中：先把正在输入的标签/备注同步进树，再交出数据
    this.canvas?.syncPending();
    return this.data;
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) this.history.reset();
    if (!clear && this.canvas) {
      // 文件在外部变了（Obsidian 已把 this.data 设成磁盘内容）。若画布上还有没落盘的编辑，
      // flush 会通过 onDocChange 把 this.data 改回本地版本；这时以本地为准，不用磁盘内容覆盖
      this.canvas.flush();
      if (this.data !== data) {
        this.requestSave();
        return;
      }
    }
    this.data = data;
    this.doc = parseMarkdown(data, {
      fallbackTitle: this.file?.basename ?? "",
      style: { maxHeadingLevel: this.plugin.settings.maxHeadingLevel, indent: indentString(this.plugin.settings.indent) },
    });
    this.applyFrontmatterOptions(this.doc);
    // 打开文件（不是文件内容变了）时恢复上次的视口和选中
    const saved = clear && this.file ? this.plugin.getViewport(this.file.path) : undefined;
    if (saved && this.canvas) {
      this.restoringViewport = true;
      this.canvas.setViewState(saved);
      this.restoringViewport = false;
    }
    this.canvas?.setDoc(this.doc);
    if (saved?.sel != null) this.canvas?.selectPath(saved.sel);
  }

  /**
   * 旁边的 Markdown 编辑器正在改同一个文件：不等它落盘（约 2 秒），直接跟上。
   * 脑图这边有没提交的编辑时跳过，等落盘后走 setViewData 的正常合并。
   */
  syncFromEditor(text: string): void {
    if (!this.canvas || text === this.data || this.canvas.isBusy()) return;
    this.data = text;
    this.setViewData(text, false);
  }

  clear(): void {
    this.data = "";
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

  private onDocChange(doc: MindDoc): void {
    const next = serializeMarkdown(doc);
    if (next === this.data) return;
    this.history.push(this.data);
    this.data = next;
    this.requestSave();
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
    const prev = this.history.undo(this.data);
    if (prev === null) return;
    this.data = prev;
    this.reparse();
    this.requestSave();
  }

  private redo(): void {
    const next = this.history.redo(this.data);
    if (next === null) return;
    this.data = next;
    this.reparse();
    this.requestSave();
  }

  private reparse(): void {
    this.doc = parseMarkdown(this.data, {
      fallbackTitle: this.file?.basename ?? "",
      style: { maxHeadingLevel: this.plugin.settings.maxHeadingLevel, indent: indentString(this.plugin.settings.indent) },
    });
    this.applyFrontmatterOptions(this.doc);
    this.canvas?.setDoc(this.doc);
  }

}
