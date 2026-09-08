import { HoverPopover, Menu, Notice, Scope, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { buildSvg, svgToPng } from "./export";
import { MindMapCanvas } from "./canvas";
import { History } from "./history";
import { isStructure, Structure } from "./layout";
import { frontmatterValue, parseMarkdown, serializeMarkdown, setFrontmatterValue } from "./markdown";
import type { MindDoc } from "./model";
import type { ThemeName } from "./theme";
import { THEMES } from "./theme";
import type MindMapPlugin from "./main";
import { indentString } from "./settings";

export const VIEW_TYPE_MINDMAP = "mindmap";

export class MindMapView extends TextFileView {
  /** 页面预览（hover-link）需要宿主提供这个字段 */
  hoverPopover: HoverPopover | null = null;
  private canvas: MindMapCanvas | null = null;
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
  }

  linkSelectedToNote(): Promise<void> {
    return this.canvas?.linkSelectedToNote() ?? Promise.resolve();
  }

  openSearch(): void {
    this.canvas?.openSearch();
  }

  setFoldLevel(level: number | null): void {
    this.canvas?.setFoldLevel(level);
  }

  getViewType(): string {
    return VIEW_TYPE_MINDMAP;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "思维导图";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("mm-view-content");
    this.addAction("file-text", "以 Markdown 打开", () => {
      if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
    });
    const host = this.contentEl.createDiv();
    this.canvas = new MindMapCanvas(host, {
      structure: this.plugin.settings.defaultStructure,
      theme: this.plugin.settings.defaultTheme,
      editable: true,
      host: this.plugin.canvasHost(() => this.file?.path ?? "", this, this),
      onChange: (doc) => this.onDocChange(doc),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onStructureChange: (s) => this.persistStructure(s),
    });
  }

  /** 卸载前把正在输入的内容提交，Obsidian 随后会 save(true) 写盘 */
  async onUnloadFile(file: TFile): Promise<void> {
    this.canvas?.flush();
    return super.onUnloadFile(file);
  }

  async onClose(): Promise<void> {
    // FileView.onClose 会 loadFile(null) → onUnloadFile → TextFileView.save(true)，
    // 这是视图被替换（切 Markdown 视图、同一标签页打开别的笔记）时最后一次写盘的机会，不能漏掉 super
    this.canvas?.flush();
    await super.onClose();
    this.canvas?.destroy();
    this.canvas = null;
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle("以 Markdown 打开")
        .setIcon("file-text")
        .setSection("pane")
        .onClick(() => {
          if (this.file) void this.plugin.openAsMarkdown(this.file, this.leaf);
        }),
    );
    menu.addItem((item) => item.setTitle("导出为 PNG").setIcon("image").setSection("pane").onClick(() => void this.exportPng()));
    menu.addItem((item) => item.setTitle("导出为 SVG").setIcon("image").setSection("pane").onClick(() => void this.exportSvg()));
    menu.addItem((item) => item.setTitle("复制为图片").setIcon("copy").setSection("pane").onClick(() => void this.copyPng()));
  }

  // ---------- 导出 ----------

  private async attachmentPath(ext: string): Promise<string> {
    if (!this.file) throw new Error("没有打开的文件");
    return this.app.fileManager.getAvailablePathForAttachment(`${this.file.basename}.${ext}`, this.file.path);
  }

  async exportPng(): Promise<void> {
    if (!this.canvas) return;
    try {
      this.canvas.select(null);
      const blob = await svgToPng(await buildSvg(this.canvas), 2);
      const path = await this.attachmentPath("png");
      await this.app.vault.createBinary(path, await blob.arrayBuffer());
      new Notice(`已导出 ${path}`);
    } catch (e) {
      new Notice(`导出失败：${(e as Error).message}`);
    }
  }

  async exportSvg(): Promise<void> {
    if (!this.canvas) return;
    try {
      this.canvas.select(null);
      const { svg } = await buildSvg(this.canvas);
      const path = await this.attachmentPath("svg");
      await this.app.vault.create(path, svg);
      new Notice(`已导出 ${path}`);
    } catch (e) {
      new Notice(`导出失败：${(e as Error).message}`);
    }
  }

  async copyPng(): Promise<void> {
    if (!this.canvas) return;
    try {
      this.canvas.select(null);
      const blob = await svgToPng(await buildSvg(this.canvas), 2);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      new Notice("已复制为图片");
    } catch (e) {
      new Notice(`复制失败：${(e as Error).message}`);
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
    this.canvas?.setDoc(this.doc);
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
    this.canvas.setTheme(theme && theme in THEMES ? (theme as ThemeName) : this.plugin.settings.defaultTheme);
  }

  private onDocChange(doc: MindDoc): void {
    const next = serializeMarkdown(doc);
    if (next === this.data) return;
    this.history.push(this.data);
    this.data = next;
    this.requestSave();
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
