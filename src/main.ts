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
  moment,
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
import { Key, setLocale, t } from "./i18n";
import { MARKDOWN_ICON, MINDMAP_ICON, MINDMAP_LIST_ICON, registerMindMapIcon } from "./icon";
import { PropertyIconDecorator } from "./property-icon";
import { MenuLike, registerNotebookNavigatorMenus } from "./nn-menus";
import { NotePickerModal } from "./note-picker";
import { isStructure } from "./layout";
import { History } from "./history";
import { CanvasHost, flattenMenu, MenuEntry, MindMapCanvas, NodeCommand } from "./canvas";
import { fillTemplate, frontmatterValue, lineOfPath, parseMarkdown, pathAtLine, RootRule, serializeMarkdown, setFrontmatterValue, withFrontmatter } from "./markdown";
import { DEFAULT_SETTINGS, indentString, MindMapSettings, MindMapSettingTab, SavedViewport } from "./settings";
import { edgeFromFrontmatter, isThemeId } from "./theme";
import { customThemeCss, getCustomTheme, normalizeCustomTheme, PREVIEW_ID, setCustomThemes } from "./custom-theme";
import { MindMapView, VIEW_TYPE_MINDMAP } from "./view";
import { parseCustomMarkers, setCustomMarkers } from "./inline";
import { VIEW_TYPE_XMIND, XmindView } from "./xmind-view";
import { registerMindMapEmbeds } from "./embed";

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
    this.applyCustomMarkers(false);
    this.applyEmbedToolbar();
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.injectCustomCss(win.doc)));
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.applyEmbedToolbar(win.doc)));
    this.register(() => this.applyEmbedToolbar(undefined, false));
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
    registerMindMapEmbeds(this);
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
    this.registerSplitSync();
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
    // 记住的视口、标注的隐藏状态跟着文件改名 / 删除走
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        const hidden = this.settings.hiddenCallouts;
        const hi = hidden?.indexOf(oldPath) ?? -1;
        if (hidden && hi >= 0) {
          hidden[hi] = f.path;
          this.saveSettingsSoon();
        }
        const vp = this.settings.viewports?.[oldPath];
        if (!vp || !this.settings.viewports) return;
        delete this.settings.viewports[oldPath];
        this.settings.viewports[f.path] = vp;
        this.saveSettingsSoon();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (this.settings.hiddenCallouts?.includes(f.path)) this.setCalloutsHidden(f.path, false);
        if (!this.settings.viewports?.[f.path]) return;
        delete this.settings.viewports[f.path];
        this.saveSettingsSoon();
      }),
    );
    this.register(() => {
      if (this.saveTimer === null) return;
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveSettings();
    });
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

  /**
   * 嵌入的脑图（代码块、![[笔记]]）自动隐藏工具栏：开关挂在 body 上，样式表按阅读 / 编辑模式分别处理。
   * 新开的独立窗口也要挂；卸载插件时摘掉
   */
  applyEmbedToolbar(doc?: Document, on = this.settings.embedToolbarAutoHide): void {
    const docs = doc ? [doc] : [...new Set([document, ...this.app.workspace.getLeavesOfType("markdown").map((l) => l.view.containerEl.ownerDocument)])];
    for (const d of docs) d.body.classList.toggle("gg-mm-embed-toolbar-autohide", on);
  }

  /** 笔记文件（不是代码块）的中心主题规则：设置「用文件名作中心主题」打开时，一级标题不再升格 */
  rootRule(): RootRule {
    return { rootFromH1: !this.settings.fileNameAsRoot };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private saveTimer: number | null = null;
  /** 平移、缩放会频繁改视口，攒一下再写 data.json */
  saveSettingsSoon(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 1500);
  }

  // ---------- 标注的显示 / 隐藏（按文件记） ----------

  isCalloutsHidden(path: string): boolean {
    return !!path && !!this.settings.hiddenCallouts?.includes(path);
  }

  setCalloutsHidden(path: string, hidden: boolean): void {
    if (!path) return;
    const list = this.settings.hiddenCallouts ?? [];
    const next = hidden ? [...new Set([...list, path])] : list.filter((p) => p !== path);
    if (next.length) this.settings.hiddenCallouts = next;
    else delete this.settings.hiddenCallouts;
    this.saveSettingsSoon();
  }

  // ---------- 记住视口 ----------

  getViewport(path: string): SavedViewport | undefined {
    return this.settings.rememberViewport ? this.settings.viewports?.[path] : undefined;
  }

  rememberViewport(path: string, vp: Omit<SavedViewport, "at">): void {
    // 文件刚被删掉时视图随后关闭还会再记一次，跳过已经不存在的文件
    if (!this.settings.rememberViewport || !path || !this.app.vault.getAbstractFileByPath(path)) return;
    const all = (this.settings.viewports ??= {});
    all[path] = { ...vp, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 50) {
      keys.sort((a, b) => all[a].at - all[b].at);
      for (const k of keys.slice(0, keys.length - 50)) delete all[k];
    }
    this.saveSettingsSoon();
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

  /** 设置里的自定义标记 → 标记面板；redraw 时让已打开的脑图按新的标记重新识别、重画 */
  applyCustomMarkers(redraw = true): void {
    setCustomMarkers(parseCustomMarkers(this.settings.customMarkers), this.settings.customMarkersExclusive);
    if (!redraw) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      if (leaf.view instanceof MindMapView) leaf.view.redrawAll();
    }
  }

  /** 中心主题规则这类影响解析的设置变了：已打开的脑图重新解析 */
  reloadMaps(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      if (leaf.view instanceof MindMapView) leaf.view.reloadFromSettings();
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

  /** 从脑图切到 Markdown：选中了节点就跳到它那一行（先落盘，行号按文件里的实际文本算） */
  async openAsMarkdown(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    const from = leaf.view;
    let path: string | null = null;
    if (from instanceof MindMapView && from.file === file) {
      path = from.getSelectedPath();
      from.rememberViewportNow();
      await from.save();
    }
    this.markdownOverride.add(file.path);
    try {
      await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source" }, active: true });
    } finally {
      this.markdownOverride.delete(file.path);
    }
    if (path === null) return;
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file !== file) return;
    const line = lineOfPath(view.editor.getValue(), path, this.rootRule());
    if (line === null) return;
    const editor = view.editor;
    editor.setCursor({ line, ch: editor.getLine(line).length });
    editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    editor.focus();
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

  /**
   * 分屏联动（设置里打开）：同一文件的脑图和 Markdown 同时显示时，Markdown 里的光标换了行，
   * 脑图选中对应节点。光标移动没有公开事件，用 document 的 selectionchange（CodeMirror 会同步 DOM 选区），
   * 只认有焦点的编辑器 —— 脑图那边带过来的光标不会再弹回去
   */
  private registerSplitSync(): void {
    let timer: number | null = null;
    let last = "";
    this.registerDomEvent(document, "selectionchange", () => {
      if (!this.settings.syncSplit) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!view || !file || !view.editor.hasFocus()) return;
      const maps = this.visibleMapsOf(file.path);
      if (!maps.length) return;
      if (timer !== null) window.clearTimeout(timer);
      // 比 editor-change 的 150ms 晚一点：打字换行时等脑图先跟上新内容
      timer = window.setTimeout(() => {
        timer = null;
        if (!view.editor.hasFocus()) return;
        const line = view.editor.getCursor().line;
        const key = `${file.path}\u0001${line}`;
        if (key === last) return;
        last = key;
        const text = view.editor.getValue();
        for (const m of this.visibleMapsOf(file.path)) m.followLine(text, line);
      }, 200);
    });
    this.register(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
  }

  /** 正在显示（不是藏在别的标签页后面）的同一文件的脑图 */
  private visibleMapsOf(path: string): MindMapView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .map((l) => l.view)
      .filter((v): v is MindMapView => v instanceof MindMapView && v.file?.path === path && v.containerEl.isShown());
  }

  /** 分屏联动的另一半：脑图里选中了节点，旁边显示着的同一文件的 Markdown 滚到那一行，不抢焦点 */
  syncMarkdownToMap(from: MindMapView): void {
    if (!this.settings.syncSplit || !from.file) return;
    const path = from.getSelectedPath();
    if (path === null) return;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== from.file.path || !view.containerEl.isShown()) continue;
      // 用户正在那边打字：光标是他的，不去动
      if (view.editor.hasFocus()) continue;
      const editor = view.editor;
      const line = lineOfPath(editor.getValue(), path, this.rootRule());
      if (line === null) continue;
      editor.setCursor({ line, ch: editor.getLine(line).length });
      editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      this.flashLine(view, line);
    }
  }

  /**
   * 联动跳到的那一行底色闪一下。直接对行元素放 Web Animation：不碰 CodeMirror 的装饰，
   * 它重设 class 也不影响；滚动后那一行要等 CodeMirror 画出来，所以晚两帧再找
   */
  private flashLine(view: MarkdownView, line: number): void {
    type CM = { state: { doc: { lines: number; line(n: number): { from: number } } }; domAtPos(pos: number): { node: Node } };
    const cm = (view.editor as unknown as { cm?: CM }).cm;
    if (!cm || line + 1 > cm.state.doc.lines) return;
    const pos = cm.state.doc.line(line + 1).from;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const node = cm.domAtPos(pos).node;
        const el = (node.instanceOf(HTMLElement) ? node : node.parentElement)?.closest<HTMLElement>(".cm-line");
        if (!el?.animate) return;
        const color = getComputedStyle(el).getPropertyValue("--text-highlight-bg").trim() || "rgba(255, 208, 0, 0.4)";
        el.animate([{ backgroundColor: color }, { backgroundColor: color, offset: 0.5 }, { backgroundColor: "transparent" }], { duration: 1500, easing: "ease-out" });
      }),
    );
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
    // 从 Markdown 切过来：选中光标所在的那个节点（中心主题那行不算，回到上次的位置更有用）
    const from = leaf.view;
    let path: string | null = null;
    if (from instanceof MarkdownView && from.file === file) {
      path = pathAtLine(from.editor.getValue(), from.editor.getCursor().line, this.rootRule());
      if (path === "") path = null;
    }
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
    if (path !== null && leaf.view instanceof MindMapView) leaf.view.revealPath(path);
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
    for (const n of [1, 2, 3, 4, 5]) exportCommand(`show-level-${n}`, t("command.showLevel", { n }), async (v) => v.showLevelFromSelected(n));
    exportCommand("fit-branch", t("command.fitBranch"), async (v) => v.fitSelectedBranch());
    exportCommand("toggle-box", t("command.toggleBox"), async (v) => v.toggleBoxOnSelected());
    exportCommand("toggle-summary", t("command.toggleSummary"), async (v) => v.toggleSummaryOnSelected());
    exportCommand("toggle-recite", t("command.toggleRecite"), async (v) => v.toggleRecite());
    exportCommand("toggle-callouts", t("command.toggleCallouts"), async (v) => v.toggleCallouts());
    exportCommand("reveal-in-markdown", t("command.revealInMarkdown"), async (v) => {
      if (v.file) await this.openAsMarkdown(v.file, v.leaf);
    });
    // 画布里的基础按键（Tab、Enter、Delete…）也注册成命令，用户可以绑成 XMind 的习惯；原来的按键照常可用
    const nodeCommands: [string, NodeCommand, Key][] = [
      ["add-child", "add-child", "command.addChild"],
      ["add-sibling", "add-sibling", "command.addSibling"],
      ["insert-before", "insert-before", "command.insertBefore"],
      ["insert-parent", "insert-parent", "command.insertParent"],
      ["edit-node", "edit", "command.editNode"],
      ["edit-callout", "callout", "command.editCallout"],
      ["delete-node", "delete", "command.deleteNode"],
      ["delete-node-only", "delete-only", "command.deleteNodeOnly"],
      ["move-up", "move-up", "command.moveUp"],
      ["move-down", "move-down", "command.moveDown"],
      ["outdent", "outdent", "command.outdent"],
      ["indent", "indent", "command.indent"],
      ["expand-branch", "expand-branch", "command.expandBranch"],
    ];
    for (const [id, cmd, name] of nodeCommands) exportCommand(id, t(name), async (v) => v.runNodeCommand(cmd));
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
        .setIcon(isMap ? MARKDOWN_ICON : MINDMAP_ICON)
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
    const content = (await this.templateContent(title)) ?? this.defaultContent(title);
    const file = await this.app.vault.create(joinPath(folder.path, name), content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: true });
    new Notice(t("notice.created", { path: file.path }));
  }

  /** 内置的起始内容：跟随界面语言；只影响新建的文件 */
  private defaultContent(title: string): string {
    const iconLine = this.settings.listIcon ? `${ICON_KEY}: ${this.settings.listIcon}\n` : "";
    const topics = [1, 2, 3].map((n) => `## ${t("newFile.topic", { n })}\n`).join("\n");
    return `---\n${FRONTMATTER_KEY}: true\n${iconLine}---\n\n# ${title}\n\n${topics}`;
  }

  /** 设置里指定了模板笔记就用它；没设返回 null，设了但找不到也提示一下再用内置内容 */
  private async templateContent(title: string): Promise<string | null> {
    const path = this.settings.newFileTemplate.trim();
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path) ?? this.app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ""), "");
    if (!(file instanceof TFile)) {
      new Notice(t("notice.templateMissing", { path }));
      return null;
    }
    // obsidian 导出的 moment 在 esModuleInterop 下类型上不可调用，运行时就是 moment 函数本身
    const text = fillTemplate(await this.app.vault.cachedRead(file), title, (p) => (moment as unknown as () => moment.Moment)().format(p));
    // 模板里自己写了 icon 就听模板的；mindmap: true 一定要有，不然新建出来不会用脑图打开
    const values: [string, string][] = [[FRONTMATTER_KEY, "true"]];
    if (this.settings.listIcon) values.push([ICON_KEY, this.settings.listIcon]);
    return withFrontmatter(text, values, [ICON_KEY]);
  }

  // ---------- 代码块 ----------

  /** 代码块重新渲染之间要保住的状态，按「文件路径:起始行」缓存 */
  private blockStates = new Map<string, BlockState>();

  private registerCodeBlock(): void {
    const processor = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
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
        marqueeDrag: () => this.settings.leftDrag === "select",
        caretAtEnd: () => this.settings.editCaret === "end",
        dragToFloat: () => this.settings.dragToFloat,
        notePopoverSize: this.notePopoverSize,
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
    };
    // gogoga-mindmap 是专属名字，总能用；mindmap 和 Markmind 撞名，设置里可以让给它（改了重新加载插件生效）
    this.registerMarkdownCodeBlockProcessor("gogoga-mindmap", processor);
    if (this.settings.claimMindmapBlock) this.registerMarkdownCodeBlockProcessor("mindmap", processor);
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

  /**
   * 按键是否命中用户给本插件命令设的快捷键。读的是 Obsidian 内部的 hotkeyManager（没有公开 API），
   * 读不到就当没有，画布按原来的方式处理
   */
  /** 各处画布共用的备注弹窗尺寸存取 */
  readonly notePopoverSize = {
    get: () => this.settings.notePopoverSize,
    set: (size: { w: number; h: number }) => {
      this.settings.notePopoverSize = size;
      void this.saveSettings();
    },
  };

  isOwnHotkey(ev: KeyboardEvent): boolean {
    return this.ownHotkeyCommand(ev) !== null;
  }

  /** 按键命中的本插件命令 id（用户在快捷键设置里绑的），没有返回 null */
  ownHotkeyCommand(ev: KeyboardEvent): string | null {
    const hm = (this.app as unknown as { hotkeyManager?: { bakedIds?: string[]; bakedHotkeys?: { modifiers: string; key: string }[] } }).hotkeyManager;
    const ids = hm?.bakedIds;
    const keys = hm?.bakedHotkeys;
    if (!ids || !keys) return null;
    const mods = [ev.altKey && "Alt", ev.ctrlKey && "Ctrl", ev.metaKey && "Meta", ev.shiftKey && "Shift"].filter(Boolean).join(",");
    const key = ev.key.toLowerCase();
    // Alt 组合在 macOS 上 ev.key 是变形字符，再按物理键比一次
    const code = ev.code.replace(/^(Key|Digit)/, "").toLowerCase();
    const prefix = `${this.manifest.id}:`;
    const i = ids.findIndex((id, i) => {
      const hk = keys[i];
      if (!id.startsWith(prefix) || !hk || hk.modifiers !== mods) return false;
      const k = hk.key.toLowerCase();
      return k === key || k === code;
    });
    return i < 0 ? null : ids[i];
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
      showMenu: (entries, ev, onClose) => {
        const menu = new Menu();
        if (onClose) menu.onHide(onClose);
        // 二级菜单用的是 Obsidian 自己也在用的 MenuItem.setSubmenu()（不在公开 API 里）；
        // 没有这个方法时把子项平铺开，功能一样
        let canSub = false;
        // 用一个不显示的菜单探一下 MenuItem 有没有 setSubmenu
        new Menu().addItem((item) => {
          canSub = typeof (item as unknown as { setSubmenu?: unknown }).setSubmenu === "function";
        });
        const fill = (m: Menu, list: MenuEntry[]) => {
          for (const e of list) {
            if (e.separator) {
              m.addSeparator();
              continue;
            }
            m.addItem((item) => {
              item.setTitle(e.title ?? "");
              if (e.icon) item.setIcon(e.icon);
              if (e.checked) item.setChecked(true);
              item.setDisabled(!!e.disabled);
              if (e.submenu) {
                const sub = (item as unknown as { setSubmenu: () => Menu }).setSubmenu();
                fill(sub, e.submenu);
              } else {
                item.onClick(() => e.run?.());
              }
            });
          }
        };
        fill(menu, canSub ? entries : flattenMenu(entries));
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
