import {
  Component,
  finishRenderMath,
  HoverParent,
  loadMathJax,
  loadPrism,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Plugin,
  renderMath,
  TFile,
  TFolder,
  WorkspaceLeaf,
  ViewState,
} from "obsidian";
import { locateBlock, replaceBlock } from "./codeblock";
import { NotePickerModal } from "./note-picker";
import { isStructure } from "./layout";
import { History } from "./history";
import { CanvasHost, MindMapCanvas } from "./canvas";
import { frontmatterValue, parseMarkdown, serializeMarkdown, setFrontmatterValue } from "./markdown";
import { DEFAULT_SETTINGS, indentString, MindMapSettings, MindMapSettingTab } from "./settings";
import { THEMES, ThemeName } from "./theme";
import { MindMapView, VIEW_TYPE_MINDMAP } from "./view";
import { VIEW_TYPE_XMIND, XmindView } from "./xmind-view";

const FRONTMATTER_KEY = "mindmap";

export default class MindMapPlugin extends Plugin {
  settings: MindMapSettings = { ...DEFAULT_SETTINGS };
  /** 用户明确要求以 Markdown 打开的文件，跳过一次视图重定向 */
  private markdownOverride = new Set<string>();

  private mathReady = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    // 公式和代码高亮的引擎按需加载；失败也不影响其他功能
    void loadMathJax().then(() => (this.mathReady = true)).catch(() => undefined);
    void loadPrism().catch(() => undefined);
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
    exportCommand("link-note", "链接到笔记 / 新建笔记", (v) => v.linkSelectedToNote());
    exportCommand("search", "搜索节点", async (v) => v.openSearch());
    exportCommand("expand-all", "展开全部节点", async (v) => v.setFoldLevel(null));
    exportCommand("collapse-all", "折叠全部节点", async (v) => v.setFoldLevel(1));
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

  /** 代码块重新渲染之间要保住的状态，按「文件路径:起始行」缓存 */
  private blockStates = new Map<string, BlockState>();

  private registerCodeBlock(): void {
    this.registerMarkdownCodeBlockProcessor("mindmap", (source, el, ctx) => {
      const wrap = el.createDiv({ cls: "mm-codeblock" });
      const child = new MarkdownRenderChild(wrap);
      const info = ctx.getSectionInfo(el);
      const key = `${ctx.sourcePath}:${info?.lineStart ?? "?"}`;
      const state: BlockState = this.blockStates.get(key) ?? { view: null, selected: null, editable: false, history: new History() };
      this.blockStates.set(key, state);

      const style = { maxHeadingLevel: this.settings.maxHeadingLevel, indent: indentString(this.settings.indent) };
      const doc = parseMarkdown(source, { fallbackTitle: "", style });
      const structure = frontmatterValue(doc.frontmatter, "mindmap-structure");
      const theme = frontmatterValue(doc.frontmatter, "mindmap-theme");
      let current = source.replace(/\n$/, "");
      let lastHeight = 0;
      let writing = Promise.resolve();

      const writeBack = (next: string, pushHistory = true) => {
        next = next.replace(/\n$/, "");
        if (next === current) return;
        if (pushHistory) state.history.push(current);
        const prev = current;
        current = next;
        state.selected = canvas.getSelectedPath();
        state.view = canvas.getViewState();
        writing = writing.then(async () => {
          try {
            await this.replaceCodeBlock(ctx, el, prev, next);
          } catch (e) {
            new Notice(`写回代码块失败：${(e as Error).message}`);
          }
        });
      };

      const canvas = new MindMapCanvas(wrap, {
        structure: isStructure(structure) ? structure : this.settings.defaultStructure,
        theme: theme && theme in THEMES ? (theme as ThemeName) : this.settings.defaultTheme,
        editable: state.editable,
        embedded: true,
        host: this.canvasHost(() => ctx.sourcePath, child),
        onChange: (d) => writeBack(serializeMarkdown(d)),
        onUndo: () => {
          const prev = state.history.undo(current);
          if (prev !== null) writeBack(prev, false);
        },
        onRedo: () => {
          const next = state.history.redo(current);
          if (next !== null) writeBack(next, false);
        },
        onStructureChange: (s) => {
          const d = canvas.getDoc();
          if (!d) return;
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-structure", s === this.settings.defaultStructure ? null : s);
          writeBack(serializeMarkdown(d));
        },
        onLayout: (bounds) => {
          const h = Math.min(this.settings.codeBlockMaxHeight, Math.max(200, Math.round(bounds.h + 96)));
          if (h !== lastHeight) {
            lastHeight = h;
            // 布局回调可能处在 ResizeObserver 链路里，直接改高度会触发 "loop completed" 警告；推到下一帧
            requestAnimationFrame(() => {
              wrap.style.height = `${h}px`;
            });
          }
        },
        onViewChange: (v) => {
          state.view = v;
        },
        onEditableChange: (e) => {
          state.editable = e;
          wrap.classList.toggle("is-editable", e);
        },
      });
      wrap.classList.toggle("is-editable", state.editable);
      if (state.view) canvas.setViewState(state.view);
      canvas.setDoc(doc);
      if (state.selected) canvas.selectPath(state.selected);
      child.register(() => {
        state.selected = canvas.getSelectedPath();
        state.view = canvas.getViewState();
        canvas.destroy();
      });
      ctx.addChild(child);
    });
  }

  /** 把新的块内容写回宿主笔记：文件在编辑器里打开就走编辑器，否则直接改文件 */
  private async replaceCodeBlock(ctx: MarkdownPostProcessorContext, el: HTMLElement, expectedInner: string, nextInner: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) throw new Error(`找不到文件 ${ctx.sourcePath}`);
    const info = ctx.getSectionInfo(el);
    const hint = info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;

    const views = this.app.workspace
      .getLeavesOfType("markdown")
      .map((l) => l.view as MarkdownView)
      .filter((v) => v.file?.path === file.path);
    const editorView = views.find((v) => v.containerEl.contains(el)) ?? views[0];
    if (editorView && editorView.getMode() === "source") {
      const editor = editorView.editor;
      const range = locateBlock(editor.getValue(), hint, expectedInner);
      if (!range) throw new Error("在笔记里找不到这个代码块");
      const body = nextInner === "" ? "" : `${nextInner}\n`;
      editor.replaceRange(body, { line: range.lineStart + 1, ch: 0 }, { line: range.lineEnd, ch: 0 });
      return;
    }
    let failed = false;
    await this.app.vault.process(file, (data) => {
      const range = locateBlock(data, hint, expectedInner);
      if (!range) {
        failed = true;
        return data;
      }
      return replaceBlock(data, range, nextInner);
    });
    if (failed) throw new Error("在笔记里找不到这个代码块");
  }

  canvasHost(sourcePath: () => string, component: Component, hoverParent?: HoverParent): CanvasHost {
    return {
      renderNote: (el, markdown) => {
        void MarkdownRenderer.render(this.app, markdown, el, sourcePath(), component).then(() => {
          // 备注里的代码块：MarkdownRenderer 不一定跑高亮，补一次
          const prism = (window as unknown as { Prism?: { highlightAllUnder?: (el: Element) => void } }).Prism;
          if (el.querySelector("pre code[class*=language-]")) prism?.highlightAllUnder?.(el);
        });
      },
      renderMath: (tex) => {
        if (!this.mathReady) return null;
        try {
          return renderMath(tex, false);
        } catch {
          return null;
        }
      },
      afterRender: () => {
        if (this.mathReady) void finishRenderMath();
      },
      resolveImage: (link) => {
        if (/^(https?:|data:|app:)/.test(link)) return link;
        const file = this.app.metadataCache.getFirstLinkpathDest(link.split("#")[0], sourcePath());
        return file ? this.app.vault.getResourcePath(file) : null;
      },
      openLink: (href, internal, ev) => {
        if (internal) void this.app.workspace.openLinkText(href, sourcePath(), ev.metaKey || ev.ctrlKey);
        else window.open(href, "_blank");
      },
      hoverLink: hoverParent
        ? (event, linktext, targetEl) => {
            this.app.workspace.trigger("hover-link", { event, source: "mindmap", hoverParent, targetEl, linktext, sourcePath: sourcePath() });
          }
        : undefined,
      pickNote: (suggested) =>
        new Promise<string | null>((resolve) => {
          new NotePickerModal(this.app, suggested, (item) => {
            if (!item) return resolve(null);
            if (item.kind === "file") return resolve(item.file.basename);
            void this.createLinkedNote(item.name, sourcePath()).then((f) => resolve(f ? f.basename : null));
          }).open();
        }),
    };
  }

  /** 从节点新建笔记：放在新文件默认位置，已存在就直接复用，并在右侧分栏打开 */
  private async createLinkedNote(name: string, sourcePath: string): Promise<TFile | null> {
    const folder = this.app.fileManager.getNewFileParent(sourcePath);
    const path = joinPath(folder.path, `${name}.md`);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      try {
        file = await this.app.vault.create(path, "");
      } catch (e) {
        new Notice(`新建笔记失败：${(e as Error).message}`);
        return null;
      }
    }
    const origin = this.app.workspace.activeLeaf;
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.openFile(file as TFile, { active: false });
    // 新笔记在右侧打开，焦点留在脑图上，方便继续加节点
    if (origin) this.app.workspace.setActiveLeaf(origin, { focus: true });
    return file as TFile;
  }
}

interface BlockState {
  view: { tx: number; ty: number; k: number } | null;
  selected: string | null;
  editable: boolean;
  history: History;
}

function joinPath(folder: string, name: string): string {
  return folder && folder !== "/" ? `${folder}/${name}` : name;
}
