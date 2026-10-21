import {
  Component,
  FileView,
  finishRenderMath,
  getLanguage,
  HoverParent,
  ItemView,
  loadMathJax,
  loadPrism,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  MenuItem,
  Notice,
  setTooltip,
  Plugin,
  renderMath,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  ViewState,
} from "obsidian";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
import { locateBlock, replaceBlock } from "./codeblock";
import { setLocale, t } from "./i18n";
import { MINDMAP_ICON, MINDMAP_LIST_ICON, registerMindMapIcon } from "./icon";
import { PropertyIconDecorator } from "./property-icon";
import { MenuLike, registerNotebookNavigatorMenus } from "./nn-menus";
import { NotePickerModal } from "./note-picker";
import { isStructure } from "./layout";
import { History } from "./history";
import { CanvasHost, MindMapCanvas } from "./canvas";
import { frontmatterValue, parseMarkdown, serializeMarkdown, setFrontmatterValue } from "./markdown";
import { DEFAULT_SETTINGS, indentString, MindMapSettings, MindMapSettingTab } from "./settings";
import { edgeFromFrontmatter, isThemeId } from "./theme";
import { customThemeCss, getCustomTheme, normalizeCustomTheme, PREVIEW_ID, setCustomThemes } from "./custom-theme";
import { MindMapView, VIEW_TYPE_MINDMAP } from "./view";
import { VIEW_TYPE_XMIND, XmindView } from "./xmind-view";

const FRONTMATTER_KEY = "mindmap";
/** 页面预览的来源 id；注册后「页面预览」设置里会出现本插件的开关，默认和 Obsidian 一样按住 ⌘ 才弹 */
const HOVER_SOURCE = "gogoga-mindmap";
/** 文件列表插件（Notebook Navigator、Iconize 等）读的图标属性 */
const ICON_KEY = "icon";

export default class MindMapPlugin extends Plugin {
  settings: MindMapSettings = { ...DEFAULT_SETTINGS };
  /** 用户明确要求以 Markdown 打开的文件，跳过一次视图重定向 */
  private markdownOverride = new Set<string>();
  /** 脑图笔记临时以 Markdown 打开时，标签页右上角那个「以思维导图打开」按钮 */
  private mapButtons = new Map<MarkdownView, HTMLElement>();

  private mathReady = false;
  private propertyIcons: PropertyIconDecorator | null = null;

  async onload(): Promise<void> {
    // 界面语言跟随 Obsidian；必须在注册命令、视图、功能区图标和设置页之前定下来
    setLocale(getLanguage());
    registerMindMapIcon();
    await this.loadSettings();
    this.applyCustomThemes();
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.injectCustomCss(win.doc)));
    this.register(() => {
      for (const m of [...this.openThemeEditors]) m.close();
      for (const el of this.customCssEls) el.remove();
      this.customCssEls = [];
    });
    // 公式和代码高亮的引擎按需加载；失败也不影响其他功能
    void loadMathJax().then(() => (this.mathReady = true)).catch(() => undefined);
    void loadPrism().catch(() => undefined);
    this.registerHoverLinkSource(HOVER_SOURCE, { display: t("hover.display"), defaultMod: true });
    this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindMapView(leaf, this));
    this.registerView(VIEW_TYPE_XMIND, (leaf) => new XmindView(leaf, this));
    this.registerExtensions(["xmind"], VIEW_TYPE_XMIND);
    this.addSettingTab(new MindMapSettingTab(this.app, this));
    this.patchSetViewState();
    this.registerCodeBlock();
    this.registerCommands();

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        if (file instanceof TFolder) this.addFolderMenuItems(menu, file);
        else this.addFileMenuItems(menu, file, leaf);
      }),
    );
    // Notebook Navigator 自己吞掉右键菜单，不走 file-menu 事件，得单独接一份
    this.register(
      registerNotebookNavigatorMenus(this.app, {
        folder: (menu, folder, tweak) => this.addFolderMenuItems(menu, folder, tweak),
        file: (menu, file) => this.addFileMenuItems(menu, file),
      }),
    );

    // 属性面板里的 icon 一行：加图标预览，去掉被误判成外链的观感
    this.propertyIcons = new PropertyIconDecorator(this.app);
    const refreshProps = () => this.propertyIcons?.schedule();
    this.registerEvent(this.app.workspace.on("file-open", refreshProps));
    this.registerEditorSync();
    const syncButtons = () => this.syncMapButtons();
    this.registerEvent(this.app.workspace.on("layout-change", syncButtons));
    this.registerEvent(this.app.workspace.on("file-open", syncButtons));
    this.registerEvent(this.app.metadataCache.on("changed", syncButtons));
    this.app.workspace.onLayoutReady(syncButtons);
    this.register(() => {
      for (const el of this.mapButtons.values()) el.remove();
      this.mapButtons.clear();
    });
    this.registerEvent(this.app.workspace.on("layout-change", refreshProps));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refreshProps));
    this.registerEvent(this.app.metadataCache.on("changed", refreshProps));
    this.register(() => {
      this.propertyIcons?.destroy();
      this.propertyIcons = null;
    });

    this.app.workspace.onLayoutReady(() => {
      this.convertOpenLeaves();
      this.propertyIcons?.schedule();
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<MindMapSettings> | null) };
    this.settings.customThemes = this.settings.customThemes.map(normalizeCustomTheme);
    // 0.3.x 用的是借来的 lucide:git-fork；裸的 mindmap-tree 又不被文件列表插件认，统一迁到带前缀的值
    if (this.settings.listIcon === "lucide:git-fork" || this.settings.listIcon === MINDMAP_ICON) {
      this.settings.listIcon = MINDMAP_LIST_ICON;
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------- 自定义主题 ----------

  private customCssEls: HTMLStyleElement[] = [];
  /** 打开着的主题编辑器：插件卸载 / 重载时一并关掉，免得旧代码继续往样式表里写 */
  openThemeEditors = new Set<{ close(): void }>();

  /** 设置里的自定义主题 → 注册表 + 样式表，并让已打开的脑图重画 */
  applyCustomThemes(): void {
    setCustomThemes(this.settings.customThemes);
    this.refreshCustomCss();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      if (leaf.view instanceof MindMapView) leaf.view.refreshTheme();
    }
  }

  /** 重新生成样式表（含编辑器里的预览主题），主窗口和弹出窗口都写一份 */
  refreshCustomCss(): void {
    this.customCssEls = this.customCssEls.filter((el) => el.isConnected);
    const docs = new Set<Document>([document, ...this.customCssEls.map((el) => el.ownerDocument)]);
    for (const doc of docs) this.injectCustomCss(doc);
  }

  /** 写进指定窗口的样式表；设置页开在单独窗口时，主题编辑器要把样式直接写进那个窗口 */
  injectCustomCss(doc: Document): void {
    const preview = getCustomTheme(PREVIEW_ID);
    const css = customThemeCss([...this.settings.customThemes, ...(preview ? [preview] : [])]);
    // 同一个 id 只留一份（插件重载前留下的旧元素直接接管）
    let el = this.customCssEls.find((e) => e.ownerDocument === doc) ?? (doc.getElementById("gogoga-mindmap-custom-themes") as HTMLStyleElement | null) ?? undefined;
    if (el && !this.customCssEls.includes(el)) this.customCssEls.push(el);
    if (!el) {
      el = doc.createElement("style");
      el.id = "gogoga-mindmap-custom-themes";
      doc.head.append(el);
      this.customCssEls.push(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  /** 给所有还没有 icon 属性的脑图笔记补上，返回处理数量 */
  async addListIcons(): Promise<void> {
    const icon = this.settings.listIcon;
    if (!icon) {
      new Notice(t("notice.setIconFirst"));
      return;
    }
    const targets = this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.isMindMapFile(f.path) && !this.app.metadataCache.getCache(f.path)?.frontmatter?.[ICON_KEY]);
    if (!targets.length) {
      new Notice(t("notice.allHaveIcons"));
      return;
    }
    let done = 0;
    for (const file of targets) {
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm[ICON_KEY] = icon;
        });
        done += 1;
      } catch (e) {
        console.error(t("log.iconWriteFailed", { path: file.path }), e);
      }
    }
    new Notice(t("notice.iconsAdded", { count: done }));
  }

  /** 把设置里的工具栏位置应用到所有打开的脑图视图（except 可跳过刚发起改动的那个） */
  applyToolbarPosition(except?: MindMapView): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      const view = leaf.view;
      if (view instanceof MindMapView && view !== except) view.setToolbarPosition(this.settings.toolbarPosition);
    }
  }

  // ---------- 视图切换 ----------

  isMindMapFile(path: string): boolean {
    const fm = this.app.metadataCache.getCache(path)?.frontmatter;
    const v: unknown = fm?.[FRONTMATTER_KEY];
    return v === true || v === "true" || (typeof v === "string" && v.length > 0 && v !== "false");
  }

  private patchSetViewState(): void {
    const shouldRedirect = (file: string) => !this.markdownOverride.has(file) && this.isMindMapFile(file);
    const proto = WorkspaceLeaf.prototype;
    // 原型上的方法要留着以后还原，取的是未绑定的函数本身，调用时再 call 回当前 leaf
    const original = Object.getOwnPropertyDescriptor(proto, "setViewState")!.value as (
      this: WorkspaceLeaf,
      state: ViewState,
      eState?: unknown,
    ) => Promise<void>;
    proto.setViewState = function (this: WorkspaceLeaf, state: ViewState, eState?: unknown): Promise<void> {
      const file = state?.state?.file;
      // 已经以 Markdown 打开的同一文件（阅读/编辑模式切换等）不再拦回脑图
      const current = this.view as { file?: TFile } | undefined;
      const alreadyMarkdown = this.view?.getViewType() === "markdown" && current?.file?.path === file;
      if (state?.type === "markdown" && typeof file === "string" && !alreadyMarkdown && shouldRedirect(file)) {
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
      await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source" }, active: true });
    } finally {
      this.markdownOverride.delete(file.path);
    }
  }

  /**
   * remember 为真时往 frontmatter 写 mindmap: true（和列表图标），以后都用脑图打开；
   * 否则只把这个标签页换成脑图视图，不动文件
   */
  /** 和脑图视图右上角的「以 Markdown 打开」对称：带 mindmap: true 的笔记在 Markdown 里显示时给一个回脑图的按钮 */
  private syncMapButtons(): void {
    const live = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file || !this.isMindMapFile(view.file.path)) continue;
      live.add(view);
      if (this.mapButtons.has(view)) continue;
      const el = view.addAction(MINDMAP_ICON, t("menu.openAsMindMap"), () => {
        if (view.file) void this.openAsMindMap(view.file, view.leaf);
      });
      this.mapButtons.set(view, el);
    }
    for (const [view, el] of this.mapButtons) {
      if (live.has(view)) continue;
      el.remove();
      this.mapButtons.delete(view);
    }
  }

  /** Markdown 编辑器打字时，同一文件的脑图视图随之更新（分屏预览靠它做到实时） */
  private registerEditorSync(): void {
    const timers = new Map<string, number>();
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const path = info.file?.path;
        if (!path) return;
        const views = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP).map((l) => l.view).filter((v): v is MindMapView => v instanceof MindMapView && v.file?.path === path);
        if (!views.length) return;
        window.clearTimeout(timers.get(path));
        timers.set(
          path,
          window.setTimeout(() => {
            timers.delete(path);
            const text = editor.getValue();
            for (const v of views) v.syncFromEditor(text);
          }, 150),
        );
      }),
    );
    this.register(() => timers.forEach((id) => window.clearTimeout(id)));
  }

  /** 在右侧分屏用脑图看当前笔记，不写 frontmatter；已经开着就直接显示那个 */
  async openPreview(file: TFile): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP).find((l) => (l.view as MindMapView).file?.path === file.path);
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const source = this.app.workspace.getMostRecentLeaf();
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: false });
    // 新分屏会抢走焦点；预览是给人看的，光标留在原来的编辑器里
    if (source) this.app.workspace.setActiveLeaf(source, { focus: true });
  }

  async openAsMindMap(file: TFile, leaf: WorkspaceLeaf, remember = this.settings.rememberView): Promise<void> {
    const icon = this.settings.listIcon;
    const needsIcon = !!icon && !this.app.metadataCache.getCache(file.path)?.frontmatter?.[ICON_KEY];
    if (remember && (!this.isMindMapFile(file.path) || needsIcon)) {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm[FRONTMATTER_KEY] = true;
        if (needsIcon) fm[ICON_KEY] = icon;
      });
    }
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
  }

  // ---------- 命令 ----------

  private registerCommands(): void {
    this.addCommand({
      id: "toggle-view",
      name: t("command.toggleView"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(FileView);
        const leaf = view?.leaf;
        const file = view?.file;
        if (!leaf || !file || !view) return false;
        const type = view.getViewType();
        if (type !== "markdown" && type !== VIEW_TYPE_MINDMAP) return false;
        if (!checking) void (type === "markdown" ? this.openAsMindMap(file, leaf) : this.openAsMarkdown(file, leaf));
        return true;
      },
    });

    this.addCommand({
      id: "new-mindmap",
      name: t("command.newMindMap"),
      callback: () => void this.createMindMap(),
    });

    this.addRibbonIcon(MINDMAP_ICON, t("command.newMindMap"), () => void this.createMindMap());

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
    this.addCommand({
      id: "open-preview",
      name: t("command.openPreview"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.openPreview(file);
        return true;
      },
    });

    exportCommand("link-note", t("command.linkNote"), (v) => v.linkSelectedToNote());
    exportCommand("toggle-outline", t("command.toggleOutline"), (v) => v.toggleOutline());

    this.addCommand({
      id: "add-list-icons",
      name: t("command.addListIcons"),
      callback: () => void this.addListIcons(),
    });
    exportCommand("focus-branch", t("command.focusBranch"), async (v) => v.focusSelected());
    exportCommand("exit-focus", t("command.exitFocus"), async (v) => v.exitFocus());
    exportCommand("copy-node-link", t("command.copyNodeLink"), (v) => v.copySelectedNodeLink());
    exportCommand("search", t("command.search"), async (v) => v.openSearch());
    // 画布里的按键（/、数字键、⌘⇧B…）不是命令，快捷键面板里看不到；这里再注册一份，用户可以自己绑键。不设默认热键
    exportCommand("toggle-fold", t("command.toggleFold"), async (v) => v.toggleFoldSelected());
    for (const n of [1, 2, 3, 4, 5]) exportCommand(`show-level-${n}`, t("command.showLevel", { n }), async (v) => v.setFoldLevel(n));
    exportCommand("fit-branch", t("command.fitBranch"), async (v) => v.fitSelectedBranch());
    exportCommand("toggle-box", t("command.toggleBox"), async (v) => v.toggleBoxOnSelected());
    exportCommand("expand-all", t("command.expandAll"), async (v) => v.setFoldLevel(null));
    exportCommand("collapse-all", t("command.collapseAll"), async (v) => v.setFoldLevel(1));
    exportCommand("export-png", t("command.exportPng"), (v) => v.exportPng());
    exportCommand("export-svg", t("command.exportSvg"), (v) => v.exportSvg());
    exportCommand("copy-png", t("command.copyPng"), (v) => v.copyPng());
  }

  private addFolderMenuItems(menu: MenuLike, folder: TFolder, tweak?: (item: MenuItem) => void): void {
    menu.addItem((item) => {
      item
        .setTitle(t("command.newMindMap"))
        .setIcon(MINDMAP_ICON)
        // 核心文件列表里跟「新建笔记 / 新建文件夹 / 新建画布」同组，我们注册得晚，自然排在最后
        .setSection("action-primary")
        .onClick(() => void this.createMindMap(folder));
      tweak?.(item);
    });
  }

  /**
   * 文件菜单里切换项按「这个文件当前怎么显示」来定，而不是只看 frontmatter：
   * 带 mindmap: true 的笔记临时切成 Markdown 后，菜单要给出「以思维导图打开」才回得去。
   * leaf 是标签页 ⋯ 菜单传进来的；文件列表右键没有 leaf，就看当前活动标签页是不是这个文件。
   */
  private addFileMenuItems(menu: MenuLike, file: TAbstractFile, leaf?: WorkspaceLeaf): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const active = this.app.workspace.getMostRecentLeaf();
    const shown = leaf ?? ((active?.view as { file?: TFile } | undefined)?.file === file ? active : null);
    const shownType = shown?.view.getViewType();
    const isMap = shownType === "markdown" ? false : shownType === VIEW_TYPE_MINDMAP ? true : this.isMindMapFile(file.path);
    menu.addItem((item) =>
      item
        .setTitle(isMap ? t("menu.openAsMarkdown") : t("menu.openAsMindMap"))
        .setIcon(isMap ? "file-text" : MINDMAP_ICON)
        .onClick(() => {
          const target = shown ?? this.app.workspace.getLeaf(false);
          void (isMap ? this.openAsMarkdown(file, target) : this.openAsMindMap(file, target));
        }),
    );
    if (!isMap) {
      menu.addItem((item) =>
        item
          .setTitle(t("command.openPreview"))
          .setIcon("columns-2")
          .onClick(() => void this.openPreview(file)),
      );
    }
  }

  /** 不传文件夹就按 Obsidian 的新建笔记位置设置来 */
  private async createMindMap(target?: TFolder): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const folder: TFolder = target ?? this.app.fileManager.getNewFileParent(active?.path ?? "");
    const base = t("newFile.baseName");
    let name = `${base}.md`;
    for (let i = 1; this.app.vault.getAbstractFileByPath(joinPath(folder.path, name)); i++) name = `${base} ${i}.md`;
    const title = name.replace(/\.md$/, "");
    const iconLine = this.settings.listIcon ? `${ICON_KEY}: ${this.settings.listIcon}\n` : "";
    // 新文件的起始内容跟随界面语言；只影响新建的文件
    const topics = [1, 2, 3].map((n) => `## ${t("newFile.topic", { n })}\n`).join("\n");
    const content = `---\n${FRONTMATTER_KEY}: true\n${iconLine}---\n\n# ${title}\n\n${topics}`;
    const file = await this.app.vault.create(joinPath(folder.path, name), content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
    new Notice(t("notice.created", { path: file.path }));
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
      const state: BlockState = this.blockStates.get(key) ?? { view: null, selected: null, editable: false, focused: false, history: new History() };
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
        state.focused = wrap.contains(wrap.ownerDocument.activeElement);
        writing = writing.then(async () => {
          try {
            await this.replaceCodeBlock(ctx, el, prev, next);
          } catch (e) {
            new Notice(t("notice.writeBackFailed", { error: (e as Error).message }));
          }
        });
      };

      const canvas = new MindMapCanvas(wrap, {
        structure: isStructure(structure) ? structure : this.settings.defaultStructure,
        theme: isThemeId(theme) ? theme : this.settings.defaultTheme,
        edge: edgeFromFrontmatter((k) => frontmatterValue(doc.frontmatter, k)),
        editable: state.editable,
        embedded: true,
        toolbarPosition: this.settings.toolbarPosition,
        wheelZoom: () => this.settings.wheelAction === "zoom",
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
        onEdgeChange: (e) => {
          const d = canvas.getDoc();
          if (!d) return;
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-edge", e.shape ?? null);
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-edge-dash", e.dashed === undefined ? null : String(e.dashed));
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-edge-corner", e.sharp === undefined ? null : e.sharp ? "sharp" : "round");
          writeBack(serializeMarkdown(d));
        },
        onLayout: (bounds) => {
          const h = Math.min(this.settings.codeBlockMaxHeight, Math.max(200, Math.round(bounds.h + 96)));
          if (h !== lastHeight) {
            lastHeight = h;
            // 布局回调可能处在 ResizeObserver 链路里，直接改高度会触发 "loop completed" 警告；推到下一帧
            window.requestAnimationFrame(() => {
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
      if (state.focused) {
        // 写回后 Obsidian 会把整个代码块重新渲染成新元素，旧画布上的焦点跟着没了；
        // 新元素挂进页面之后再把焦点给它（处理器跑的时候它可能还没进 DOM）
        state.focused = false;
        let tries = 0;
        const refocus = () => {
          if (wrap.isConnected) canvas.focus();
          else if (++tries < 10) window.requestAnimationFrame(refocus);
        };
        window.requestAnimationFrame(refocus);
      }
      child.register(() => {
        state.selected = canvas.getSelectedPath();
        state.view = canvas.getViewState();
        if (wrap.contains(wrap.ownerDocument.activeElement)) state.focused = true;
        canvas.destroy();
      });
      ctx.addChild(child);
    });
  }

  /** 把新的块内容写回宿主笔记：文件在编辑器里打开就走编辑器，否则直接改文件 */
  private async replaceCodeBlock(ctx: MarkdownPostProcessorContext, el: HTMLElement, expectedInner: string, nextInner: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) throw new Error(t("error.fileNotFound", { path: ctx.sourcePath }));
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
      if (!range) throw new Error(t("error.blockNotFound"));
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
    if (failed) throw new Error(t("error.blockNotFound"));
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
      showMenu: (entries, ev) => {
        const menu = new Menu();
        for (const e of entries) {
          if (e.separator) {
            menu.addSeparator();
            continue;
          }
          menu.addItem((item) => {
            item.setTitle(e.title ?? "");
            if (e.icon) item.setIcon(e.icon);
            if (e.checked) item.setChecked(true);
            item.setDisabled(!!e.disabled);
            item.onClick(() => e.run?.());
          });
        }
        menu.showAtMouseEvent(ev);
      },
      openTag: (tag) => {
        const search = (this.app as unknown as { internalPlugins: { getPluginById(id: string): { instance?: { openGlobalSearch?: (q: string) => void } } | null } }).internalPlugins.getPluginById("global-search");
        search?.instance?.openGlobalSearch?.(`tag:${tag}`);
      },
      getDraggedFiles: () => {
        const d = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: TFile; files?: TFile[] } | null } }).dragManager?.draggable;
        if (!d) return null;
        const files = d.type === "file" && d.file ? [d.file] : d.type === "files" && d.files ? d.files : [];
        return files
          .filter((f): f is TFile => f instanceof TFile)
          .map((f) => ({
            name: f.name,
            basename: f.basename,
            linktext: this.app.metadataCache.fileToLinktext(f, sourcePath()),
            isImage: IMAGE_EXTS.has(f.extension.toLowerCase()),
          }));
      },
      saveBinary: async (name, data) => {
        const path = await this.app.fileManager.getAvailablePathForAttachment(name, sourcePath());
        const file = await this.app.vault.createBinary(path, data);
        return this.app.metadataCache.fileToLinktext(file, sourcePath());
      },
      fileBasename: () => {
        const p = sourcePath();
        const f = this.app.vault.getAbstractFileByPath(p);
        return f instanceof TFile ? f.basename : p.replace(/\.md$/, "").split("/").pop() ?? p;
      },
      notice: (m) => new Notice(m),
      setTooltip: (el, text, placement) => setTooltip(el, text, { placement }),
      openLink: (href, internal, ev) => {
        if (internal) void this.app.workspace.openLinkText(href, sourcePath(), ev.metaKey || ev.ctrlKey);
        else window.open(href, "_blank");
      },
      hoverLink: hoverParent
        ? (event, linktext, targetEl) => {
            this.app.workspace.trigger("hover-link", { event, source: HOVER_SOURCE, hoverParent, targetEl, linktext, sourcePath: sourcePath() });
          }
        : undefined,
      listLinkTargets: () =>
        this.app.vault
          .getFiles()
          .sort((a, b) => b.stat.mtime - a.stat.mtime)
          .map((f) => ({
            name: f.extension === "md" ? f.basename : f.name,
            folder: f.parent && f.parent.path !== "/" ? f.parent.path : "",
            linktext: this.app.metadataCache.fileToLinktext(f, sourcePath(), true),
            isNote: f.extension === "md",
          })),
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
        new Notice(t("notice.createNoteFailed", { error: (e as Error).message }));
        return null;
      }
    }
    if (!(file instanceof TFile)) return null;
    const origin = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.openFile(file, { active: false });
    // 新笔记在右侧打开，焦点留在脑图上，方便继续加节点
    if (origin) this.app.workspace.setActiveLeaf(origin, { focus: true });
    return file;
  }
}

interface BlockState {
  view: { tx: number; ty: number; k: number } | null;
  selected: string | null;
  editable: boolean;
  /** 重新渲染前画布有焦点：新画布接着拿焦点，键盘操作不断 */
  focused: boolean;
  history: History;
}

function joinPath(folder: string, name: string): string {
  return folder && folder !== "/" ? `${folder}/${name}` : name;
}
