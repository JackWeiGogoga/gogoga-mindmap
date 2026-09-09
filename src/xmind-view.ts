import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { MindMapCanvas } from "./canvas";
import { MINDMAP_ICON } from "./icon";
import { indentString } from "./settings";
import { parseXmind, XmindSheet, xmindSheetToDoc, xmindSheetToMarkdown } from "./xmind";
import { VIEW_TYPE_MINDMAP } from "./view";
import type MindMapPlugin from "./main";

export const VIEW_TYPE_XMIND = "mindmap-xmind";

/** 直接打开 vault 里的 .xmind：只读渲染，可一键转成 Markdown 笔记 */
export class XmindView extends FileView {
  private canvas: MindMapCanvas | null = null;
  private sheets: XmindSheet[] = [];
  private current = 0;
  private sheetBar: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MindMapPlugin) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return VIEW_TYPE_XMIND;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "XMind";
  }

  getIcon(): string {
    return MINDMAP_ICON;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "xmind";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("mm-view-content");
    this.addAction("file-text", "转换为 Markdown 笔记", () => void this.convert());
    const host = this.contentEl.createDiv();
    this.canvas = new MindMapCanvas(host, {
      structure: this.plugin.settings.defaultStructure,
      theme: this.plugin.settings.defaultTheme,
      editable: false,
      host: this.plugin.canvasHost(() => this.file?.path ?? "", this),
    });
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.canvas?.destroy();
    this.canvas = null;
  }

  async onLoadFile(file: TFile): Promise<void> {
    try {
      this.sheets = await parseXmind(await this.app.vault.readBinary(file));
    } catch (e) {
      this.sheets = [];
      new Notice(`无法读取 ${file.name}：${(e as Error).message}`);
    }
    this.current = 0;
    this.renderSheet();
  }

  private docStyle() {
    return { maxHeadingLevel: this.plugin.settings.maxHeadingLevel, indent: indentString(this.plugin.settings.indent) };
  }

  private renderSheet(): void {
    if (!this.canvas) return;
    this.sheetBar?.remove();
    this.sheetBar = null;
    const sheet = this.sheets[this.current];
    if (!sheet) return;
    this.canvas.setDoc(xmindSheetToDoc(sheet, this.docStyle()));
    if (this.sheets.length > 1) {
      const bar = this.canvas.el.createDiv({ cls: "mm-sheets" });
      bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      this.sheets.forEach((s, i) => {
        const b = bar.createEl("button", { text: s.title, cls: i === this.current ? "is-active" : "" });
        b.addEventListener("click", () => {
          this.current = i;
          this.renderSheet();
        });
      });
      this.sheetBar = bar;
    }
  }

  private async convert(): Promise<void> {
    const file = this.file;
    const sheet = this.sheets[this.current];
    if (!file || !sheet) return;
    let md = xmindSheetToMarkdown(sheet, this.docStyle());
    const icon = this.plugin.settings.listIcon;
    if (icon) md = md.replace(/^---\nmindmap: true\n/, `---\nmindmap: true\nicon: ${icon}\n`);
    const folder = file.parent?.path ?? "";
    const base = this.sheets.length > 1 ? `${file.basename} - ${sheet.title}` : file.basename;
    let name = `${base}.md`;
    for (let i = 1; this.app.vault.getAbstractFileByPath(folder && folder !== "/" ? `${folder}/${name}` : name); i++) {
      name = `${base} ${i}.md`;
    }
    const path = folder && folder !== "/" ? `${folder}/${name}` : name;
    const created = await this.app.vault.create(path, md);
    await this.leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: created.path }, active: true });
    new Notice(`已转换为 ${created.path}`);
  }
}
