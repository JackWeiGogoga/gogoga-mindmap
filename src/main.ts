import { Component, MarkdownRenderChild, MarkdownRenderer, Notice, Plugin, TFile, TFolder, WorkspaceLeaf, ViewState } from "obsidian";
import { CanvasHost, MindMapCanvas } from "./canvas";
import { frontmatterValue, parseMarkdown } from "./markdown";
import { DEFAULT_SETTINGS, indentString, MindMapSettings, MindMapSettingTab } from "./settings";
import { THEMES, ThemeName } from "./theme";
import { MindMapView, VIEW_TYPE_MINDMAP } from "./view";
import { VIEW_TYPE_XMIND, XmindView } from "./xmind-view";

const FRONTMATTER_KEY = "mindmap";

export default class MindMapPlugin extends Plugin {
  settings: MindMapSettings = { ...DEFAULT_SETTINGS };
  /** 用户明确要求以 Markdown 打开的文件，跳过一次视图重定向 */
  private markdownOverride = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindMapView(leaf, this));
    this.registerView(VIEW_TYPE_XMIND, (leaf) => new XmindView(leaf, this));
    this.registerExtensions(["xmind"], VIEW_TYPE_XMIND);
    this.addSettingTab(new MindMapSettingTab(this.app, this));
    this.patchSetViewState();
    this.registerCodeBlock();
    this.registerCommands();

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const isMap = this.isMindMapFile(file.path);
        menu.addItem((item) =>
          item
            .setTitle(isMap ? "以 Markdown 打开" : "以思维导图打开")
            .setIcon(isMap ? "file-text" : "git-fork")
            .onClick(() => {
              const leaf = this.app.workspace.getLeaf(false);
              void (isMap ? this.openAsMarkdown(file, leaf) : this.openAsMindMap(file, leaf));
            }),
        );
      }),
    );

    this.app.workspace.onLayoutReady(() => this.convertOpenLeaves());
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<MindMapSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------- 视图切换 ----------

  isMindMapFile(path: string): boolean {
    const fm = this.app.metadataCache.getCache(path)?.frontmatter;
    const v = fm?.[FRONTMATTER_KEY];
    return v === true || v === "true" || (typeof v === "string" && v.length > 0 && v !== "false");
  }

  private patchSetViewState(): void {
    const plugin = this;
    const proto = WorkspaceLeaf.prototype;
    const original = proto.setViewState;
    proto.setViewState = function (this: WorkspaceLeaf, state: ViewState, eState?: unknown): Promise<void> {
      const file = state?.state?.file;
      if (state?.type === "markdown" && typeof file === "string" && !plugin.markdownOverride.has(file) && plugin.isMindMapFile(file)) {
        state = { ...state, type: VIEW_TYPE_MINDMAP };
      }
      return original.call(this, state, eState);
    };
    this.register(() => {
      proto.setViewState = original;
    });
  }

  private convertOpenLeaves(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const file = (leaf.view as { file?: TFile }).file;
      if (file && this.isMindMapFile(file.path)) void this.openAsMindMap(file, leaf);
    }
  }

  async openAsMarkdown(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    this.markdownOverride.add(file.path);
    try {
      await leaf.setViewState({ type: "markdown", state: { file: file.path }, active: true });
    } finally {
      this.markdownOverride.delete(file.path);
    }
  }

  async openAsMindMap(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    if (!this.isMindMapFile(file.path)) {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm[FRONTMATTER_KEY] = true;
      });
    }
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
  }

  // ---------- 命令 ----------

  private registerCommands(): void {
    this.addCommand({
      id: "toggle-view",
      name: "在思维导图和 Markdown 之间切换",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        const view = leaf?.view;
        const file = (view as { file?: TFile } | undefined)?.file;
        if (!leaf || !file || !view) return false;
        const type = view.getViewType();
        if (type !== "markdown" && type !== VIEW_TYPE_MINDMAP) return false;
        if (!checking) void (type === "markdown" ? this.openAsMindMap(file, leaf) : this.openAsMarkdown(file, leaf));
        return true;
      },
    });

    this.addCommand({
      id: "new-mindmap",
      name: "新建思维导图",
      callback: () => void this.createMindMap(),
    });

    this.addRibbonIcon("git-fork", "新建思维导图", () => void this.createMindMap());

    const exportCommand = (id: string, name: string, run: (view: MindMapView) => Promise<void>) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(MindMapView);
          if (!view) return false;
          if (!checking) void run(view);
          return true;
        },
      });
    exportCommand("export-png", "导出为 PNG", (v) => v.exportPng());
    exportCommand("export-svg", "导出为 SVG", (v) => v.exportSvg());
    exportCommand("copy-png", "复制为图片", (v) => v.copyPng());
  }

  private async createMindMap(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const folder: TFolder = this.app.fileManager.getNewFileParent(active?.path ?? "");
    const base = "未命名思维导图";
    let name = `${base}.md`;
    for (let i = 1; this.app.vault.getAbstractFileByPath(joinPath(folder.path, name)); i++) name = `${base} ${i}.md`;
    const title = name.replace(/\.md$/, "");
    const content = `---\n${FRONTMATTER_KEY}: true\n---\n\n# ${title}\n\n## 主题 1\n\n## 主题 2\n\n## 主题 3\n`;
    const file = await this.app.vault.create(joinPath(folder.path, name), content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
    new Notice(`已创建 ${file.path}`);
  }

  // ---------- 代码块 ----------

  private registerCodeBlock(): void {
    this.registerMarkdownCodeBlockProcessor("mindmap", (source, el, ctx) => {
      const wrap = el.createDiv({ cls: "mm-codeblock" });
      const child = new MarkdownRenderChild(wrap);
      const doc = parseMarkdown(source, {
        fallbackTitle: "",
        style: { maxHeadingLevel: this.settings.maxHeadingLevel, indent: indentString(this.settings.indent) },
      });
      const structure = frontmatterValue(doc.frontmatter, "mindmap-structure");
      const theme = frontmatterValue(doc.frontmatter, "mindmap-theme");
      let sized = false;
      const canvas = new MindMapCanvas(wrap, {
        structure: structure === "mindmap" || structure === "logic-right" ? structure : this.settings.defaultStructure,
        theme: theme && theme in THEMES ? (theme as ThemeName) : this.settings.defaultTheme,
        editable: false,
        host: this.canvasHost(() => ctx.sourcePath, child),
        onLayout: (bounds) => {
          if (sized) return;
          sized = true;
          wrap.style.height = `${Math.min(this.settings.codeBlockMaxHeight, Math.max(200, Math.round(bounds.h + 96)))}px`;
          canvas.fit();
        },
      });
      canvas.setDoc(doc);
      child.register(() => canvas.destroy());
      ctx.addChild(child);
    });
  }

  canvasHost(sourcePath: () => string, component: Component): CanvasHost {
    return {
      renderNote: (el, markdown) => {
        void MarkdownRenderer.render(this.app, markdown, el, sourcePath(), component);
      },
      openLink: (href, internal, ev) => {
        if (internal) void this.app.workspace.openLinkText(href, sourcePath(), ev.metaKey || ev.ctrlKey);
        else window.open(href, "_blank");
      },
    };
  }
}

function joinPath(folder: string, name: string): string {
  return folder && folder !== "/" ? `${folder}/${name}` : name;
}
