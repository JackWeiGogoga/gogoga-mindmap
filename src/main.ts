import { type CustomSplit, parseCustomSplits } from "./split";
import type { QuickSetting } from "./canvas";
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
  Platform,
  setIcon,
  setTooltip,
  Keymap,
  parseLinktext,
  Plugin,
  renderMath,
  requestUrl,
  Scope,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  ViewState,
  editorInfoField,
  editorLivePreviewField,
} from "obsidian";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
import { mergeLayout, NODEBAR_DEFAULT } from "./bar-layout";
import { type ColorMemory, pushRecent } from "./color-palette";
import { locateBlock, replaceBlock } from "./codeblock";
import { blankBeforeNodeTables } from "./node-table";
import { preserveFormat } from "./merge";
import { parseColorList } from "./format";
import { htmlCharset, titleFromHtml } from "./paste-link";
import { PdfExcerpt } from "./pdf-excerpt";
import { Key, setLocale, t } from "./i18n";
import { setLanguage as setTableLanguage } from "./table/editor/i18n";
import { MARKDOWN_ICON, MINDMAP_ICON, MINDMAP_LIST_ICON, registerMindMapIcon } from "./icon";
import { PropertyIconDecorator } from "./property-icon";
import { MenuLike, registerNotebookNavigatorMenus } from "./nn-menus";
import { NotePickerModal } from "./note-picker";
import { isStructure } from "./layout";
import { History } from "./history";
import { CanvasHost, flattenMenu, MenuEntry, MindMapCanvas, NodeCommand, redrawAllCanvases, refreshAllBars, setSpacingScale } from "./canvas";
import { fillTemplate, foldPlan, frontmatterValue, lineOfPath, parseMarkdown, parseNodeColors, pathAtLine, promoteRoot, RootRule, serializeMarkdown, setFrontmatterValue, withFrontmatter } from "./markdown";
import { DEFAULT_SETTINGS, embedToolbarLayout, indentString, MindMapSettings, MindMapSettingTab, SavedViewport } from "./settings";
import { edgeFromFrontmatter, isThemeId } from "./theme";
import { customThemeCss, getCustomTheme, normalizeCustomTheme, PREVIEW_ID, setCustomThemes } from "./custom-theme";
import { MindMapView, useFallbackViewType, VIEW_TYPE_MINDMAP, VIEW_TYPE_MINDMAP_FALLBACK } from "./view";
import { parseCustomMarkers, setCustomMarkers, setImageMaxWidth } from "./inline";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { noteTagsExtension } from "./note-tags";
import { noteMarkersExtension } from "./note-markers";
import { noteFormatBarExtension } from "./note-format-bar";
import { noteColorsExtension, paintNoteColors } from "./note-colors";
import { textIsMindMap } from "./note-colors-core";
import { VIEW_TYPE_XMIND, XmindView } from "./xmind-view";
import { registerMindMapEmbeds } from "./embed";
import { AttachmentJanitor } from "./attachment-cleanup";
import { scrollEditorLineToCenter, scrollParentWithin, scrollWithin } from "./scroll-inside";
import { FileStateStore, LEGACY_KEYS, LegacyFileState, NoteCards, ViewportStore } from "./state";

const FRONTMATTER_KEY = "mindmap";
/** 页面预览的来源 id；注册后「页面预览」设置里会出现本插件的开关，默认和 Obsidian 一样按住 ⌘ 才弹 */
const HOVER_SOURCE = "gogoga-mindmap";
/** 文件列表插件（Notebook Navigator、Iconize 等）读的图标属性 */
const ICON_KEY = "icon";

/**
 * 阅读视图的分段（没有公开 API）：每段有起止行号；页眉页脚、属性区这些界面块带 mod-ui，跳过。
 * 列表是一整段，里面每个列表项的 data-line 是相对这一段开头的行偏移
 */
type PreviewSection = {
  el: HTMLElement;
  start?: { line: number };
  end?: { line: number };
  rendered?: boolean;
  /** 标题是 1–6，其余是 7 */
  level?: number;
  headingCollapsed?: boolean;
  /** 被折叠的标题藏起来时为 false */
  shown?: boolean;
};
function previewSections(view: MarkdownView): (PreviewSection & { start: { line: number }; end: { line: number } })[] {
  const sections = (view.previewMode as unknown as { renderer?: { sections?: PreviewSection[] } }).renderer?.sections ?? [];
  return sections.filter((s): s is PreviewSection & { start: { line: number }; end: { line: number } } => !!s.el && !!s.start && !!s.end && !s.el.classList.contains("mod-ui"));
}

/** 阅读视图里某一行对应的元素；那一段还没渲染出来（懒渲染）时 ready 为 false */
function previewElAtLine(view: MarkdownView, line: number): { el: HTMLElement; ready: boolean } | null {
  const sec = previewSections(view).filter((s) => s.start.line <= line && line <= s.end.line).pop();
  if (!sec) return null;
  const ready = sec.rendered !== false && sec.shown !== false && sec.el.childElementCount > 0;
  const li = [...sec.el.querySelectorAll<HTMLElement>("li[data-line]")].find((l) => sec.start.line + Number(l.dataset.line) === line);
  return { el: li ?? sec.el, ready };
}

/** 那一行在阅读视图里被折叠的标题藏着：把它上面折叠着的各级标题都展开（点标题的折叠箭头，和手点一样） */
function unfoldPreviewLine(view: MarkdownView, line: number): void {
  const secs = previewSections(view);
  const i = secs.findIndex((s) => s.start.line <= line && line <= s.end.line);
  if (i < 0) return;
  let level = secs[i].level ?? 7;
  for (let j = i - 1; j >= 0 && level > 1; j--) {
    const h = secs[j];
    if ((h.level ?? 7) >= level) continue;
    level = h.level ?? 7;
    if (h.headingCollapsed) h.el.querySelector<HTMLElement>(".heading-collapse-indicator")?.click();
  }
}

function previewLineAt(view: MarkdownView, target: HTMLElement): number | null {
  const sec = previewSections(view).find((s) => s.el.contains(target));
  if (!sec) return null;
  const li = target.closest<HTMLElement>("li[data-line]");
  return li && sec.el.contains(li) ? sec.start.line + Number(li.dataset.line) : sec.start.line;
}

export default class MindMapPlugin extends Plugin {
  settings: MindMapSettings = { ...DEFAULT_SETTINGS };
  /** PDF 自动摘录：同一时间只有一张脑图接 PDF++ 复制的内容 */
  readonly pdfExcerpt = new PdfExcerpt(this.app);
  /** 删除节点时清理不再使用的图片（设置项 cleanAttachments） */
  readonly janitor = new AttachmentJanitor(this.app, (n) => new Notice(t("notice.attachmentsCleaned", { n: String(n) })));
  /** 锁定、备注展开、隐藏标注：插件目录下的 state.json，和设置分开 */
  fileState!: FileStateStore;
  /** 视口：只存本机 */
  viewports!: ViewportStore;
  /** 用户明确要求以 Markdown 打开的文件，跳过一次视图重定向 */
  private markdownOverride = new Set<string>();
  /** 脑图笔记临时以 Markdown 打开时，标签页右上角那个「以思维导图打开」按钮 */
  private mapButtons = new Map<MarkdownView, HTMLElement>();

  private mathReady = false;
  private propertyIcons: PropertyIconDecorator | null = null;

  async onload(): Promise<void> {
    // 只在 Obsidian 启动时把打开着的脑图笔记换成脑图视图（工作区恢复时可能早于 setViewState 的拦截）。
    // 插件被重新加载、更新、启用时工作区早就好了，用户这时以 Markdown 开着的是他自己选的，不去动。
    // 要在任何 await 之前判断：启动时等加载设置的工夫里工作区就可能好了
    const atStartup = !this.app.workspace.layoutReady;
    // 界面语言跟随 Obsidian；必须在注册命令、视图、功能区图标和设置页之前定下来
    setLocale(getLanguage());
    setTableLanguage(getLanguage());
    registerMindMapIcon();
    await this.loadSettings();
    this.register(() => this.pdfExcerpt.stop());
    this.applyCustomThemes();
    this.applyCustomMarkers(false);
    this.applyEmbedToolbar();
    this.applyDisplayScale(false);
    this.registerEditorExtension(this.noteTagExt);
    this.applyNoteTags(false);
    // 脑图笔记用 Markdown 打开时，视图上挂 gg-mm-note：只给它们用的样式（颜色里的链接保持文字颜色）认这个类
    const markNotes = () => this.markMindMapNotes();
    this.registerEvent(this.app.workspace.on("layout-change", markNotes));
    this.registerEvent(this.app.workspace.on("file-open", markNotes));
    this.registerEvent(this.app.metadataCache.on("changed", markNotes));
    this.app.workspace.onLayoutReady(markNotes);
    this.register(() => this.app.workspace.iterateAllLeaves((l) => l.view.containerEl.classList.remove("gg-mm-note")));
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.injectCustomCss(win.doc)));
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.applyEmbedToolbar(win.doc)));
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.setFontScale(win.doc)));
    this.register(() => {
      this.applyEmbedToolbar(undefined, false);
      for (const d of this.allDocs()) {
        d.body.style.removeProperty("--mm-font-scale");
        d.body.classList.remove("mm-strike-done");
        d.body.style.removeProperty("--mm-img-thumb-w");
        d.body.style.removeProperty("--mm-note-max-h");
        d.body.style.removeProperty("--mm-note-max-w");
      }
    });
    this.register(() => {
      for (const m of [...this.openThemeEditors]) m.close();
      for (const el of this.customCssEls) el.remove();
      this.customCssEls = [];
    });
    // 公式和代码高亮的引擎按需加载；失败也不影响其他功能
    void loadMathJax().then(() => (this.mathReady = true)).catch(() => undefined);
    void loadPrism().catch(() => undefined);
    this.registerHoverLinkSource(HOVER_SOURCE, { display: t("hover.display"), defaultMod: true });
    // 名字被别的插件先登记了，Obsidian 会直接抛错、整个插件加载失败（#34）：撞名时让一步，别的功能照常
    try {
      this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindMapView(leaf, this));
    } catch (e) {
      console.warn(`gogoga Mind Map: view type "${VIEW_TYPE_MINDMAP}" is taken by another plugin, using "${VIEW_TYPE_MINDMAP_FALLBACK}"`, e);
      useFallbackViewType();
      this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindMapView(leaf, this));
    }
    this.registerView(VIEW_TYPE_XMIND, (leaf) => new XmindView(leaf, this));
    try {
      this.registerExtensions(["xmind"], VIEW_TYPE_XMIND);
    } catch (e) {
      console.warn("gogoga Mind Map: .xmind is opened by another plugin", e);
      if (!this.settings.xmindTakenNoticed) {
        new Notice(t("notice.xmindTaken"), 10000);
        this.settings.xmindTakenNoticed = true;
        void this.saveSettings();
      }
    }
    this.addSettingTab(new MindMapSettingTab(this.app, this));
    this.patchSetViewState();
    this.registerCodeBlock();
    registerMindMapEmbeds(this);
    // 阅读视图里的节点颜色（设置「在笔记里显示节点颜色」）
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (this.settings.colorsInNotes) paintNoteColors(
          el,
          ctx,
          (text) => this.isMindMapFile(ctx.sourcePath) || textIsMindMap(text),
          () => {
            let found = "";
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (!found && leaf.view instanceof MarkdownView && leaf.view.file?.path === ctx.sourcePath) found = leaf.view.data;
            });
            return found;
          },
        );
    });
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
    this.registerFoldFollow();
    this.registerFollowActive();
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
    // 记住的视口、锁定、标注隐藏这些状态跟着文件改名 / 删除走
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        this.fileState.rename(oldPath, f.path);
        this.viewports.rename(oldPath, f.path);
        this.janitor.rename(oldPath, f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        this.fileState.remove(f.path);
        this.viewports.remove(f.path);
      }),
    );
    // 别的设备同步过来改了 state.json：切回 Obsidian 时读回来，打开着的脑图跟上
    const refreshState = () => void this.fileState.refresh().then((changed) => changed && this.applyFileState());
    this.registerDomEvent(window, "focus", refreshState);
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.registerDomEvent(win.win, "focus", refreshState)));
    this.register(() => void this.fileState.flush());
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
      if (atStartup) this.convertOpenLeaves();
      this.propertyIcons?.schedule();
    });
  }

  async loadSettings(): Promise<void> {
    const raw = ((await this.loadData()) as (Partial<MindMapSettings> & LegacyFileState) | null) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...raw };
    // 嵌套的对象要自己一份，不能和默认值共用（记颜色时会改它）
    this.settings.colorMemory = { last: { ...raw.colorMemory?.last }, recent: { ...raw.colorMemory?.recent } };
    this.fileState = new FileStateStore(this.app.vault.adapter, `${this.manifest.dir}/state.json`);
    await this.fileState.load();
    this.viewports = new ViewportStore(this.app);
    // 0.28.2 以前这些按文件的状态都记在 data.json 里：搬过去，再从设置里删掉
    if (LEGACY_KEYS.some((k) => k in raw)) {
      const flags = (list?: string[]) => Object.fromEntries((list ?? []).map((p) => [p, true]));
      this.fileState.fill("hiddenCallouts", flags(raw.hiddenCallouts));
      this.fileState.fill("locked", flags(raw.lockedFiles));
      this.fileState.fill("notesExpanded", raw.notesExpandedFiles ?? {});
      if (raw.viewports) this.viewports.fill(raw.viewports);
      const s = this.settings as MindMapSettings & LegacyFileState;
      for (const k of LEGACY_KEYS) delete s[k];
      await this.fileState.flush();
      await this.saveSettings();
    }
    this.settings.customThemes = this.settings.customThemes.map(normalizeCustomTheme);
    // 0.60 以前「嵌入的脑图隐藏工具栏」是个开关：开着的迁到「自动隐藏」，旧键删掉
    if ("embedToolbarAutoHide" in raw) {
      const s = this.settings as MindMapSettings & { embedToolbarAutoHide?: boolean };
      if (!("embedToolbar" in raw) && s.embedToolbarAutoHide) this.settings.embedToolbar = "autohide";
      delete s.embedToolbarAutoHide;
      await this.saveSettings();
    }
    // 0.56 以前的「打 1. 开始编号」叫 autoNumber、默认关；改名后按新默认（开）来，旧键删掉
    if ("autoNumber" in raw) {
      delete (this.settings as MindMapSettings & { autoNumber?: boolean }).autoNumber;
      await this.saveSettings();
    }
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
  applyEmbedToolbar(doc?: Document, on = true): void {
    for (const d of doc ? [doc] : this.allDocs()) {
      d.body.classList.toggle("gg-mm-embed-toolbar-autohide", on && this.settings.embedToolbar === "autohide");
      // 大纲面板显示完整标题（换行），默认一行放不下就省略
      d.body.classList.toggle("gg-mm-outline-wrap", on && this.settings.outlineWrap);
      // 触屏上的折叠按钮只在选中、已折叠时显示（和电脑上一样）；默认一直显示
      d.body.classList.toggle("gg-mm-touch-toggle-auto", on && this.settings.touchToggles === "selected");
    }
  }

  /** 主窗口和打开着的独立窗口 */
  private allDocs(): Document[] {
    const docs = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves((l) => docs.add(l.view.containerEl.ownerDocument));
    return [...docs];
  }

  /**
   * 设置里的节点间距、节点字号：间距交给排版，字号写成 body 上的 --mm-font-scale（样式表和自定义主题都乘它）。
   * 改了以后所有画布重新量、重新排
   */
  applyDisplayScale(redraw = true): void {
    setSpacingScale(this.settings.spacingScale / 100);
    setImageMaxWidth(this.settings.imageMaxWidth);
    for (const d of this.allDocs()) this.setFontScale(d);
    if (redraw) redrawAllCanvases();
  }

  private setFontScale(doc: Document): void {
    const k = this.settings.fontScale / 100;
    if (k === 1) doc.body.style.removeProperty("--mm-font-scale");
    else doc.body.style.setProperty("--mm-font-scale", String(k));
    // 没设宽度的图片默认显示多宽（样式表按它算高度上限和中心主题里的宽度）
    const thumb = this.settings.imageThumbWidth;
    if (thumb === DEFAULT_SETTINGS.imageThumbWidth) doc.body.style.removeProperty("--mm-img-thumb-w");
    else doc.body.style.setProperty("--mm-img-thumb-w", `${thumb}px`);
    // 完成的任务（[x]）显示删除线：样式表按这个类画
    doc.body.classList.toggle("mm-strike-done", this.settings.strikeDoneTasks);
    const h = this.settings.noteMaxHeight;
    if (h === DEFAULT_SETTINGS.noteMaxHeight) doc.body.style.removeProperty("--mm-note-max-h");
    else doc.body.style.setProperty("--mm-note-max-h", `${h}px`);
    const w = this.settings.noteMaxWidth;
    if (w === DEFAULT_SETTINGS.noteMaxWidth) doc.body.style.removeProperty("--mm-note-max-w");
    else doc.body.style.setProperty("--mm-note-max-w", `${w}px`);
    const tw = this.settings.tableMaxWidth;
    if (tw === DEFAULT_SETTINGS.tableMaxWidth) doc.body.style.removeProperty("--mm-table-max-w");
    else doc.body.style.setProperty("--mm-table-max-w", `${tw}px`);
    const th = this.settings.tableMaxHeight;
    if (th === DEFAULT_SETTINGS.tableMaxHeight) doc.body.style.removeProperty("--mm-table-max-h");
    else doc.body.style.setProperty("--mm-table-max-h", `${th}px`);
  }

  /** 笔记文件（不是代码块）的中心主题规则：设置「用文件名作中心主题」打开时，一级标题不再升格 */
  rootRule(): RootRule {
    return { rootFromH1: !this.settings.fileNameAsRoot, headingsOnly: this.settings.headingsOnly, showHidden: this.showHidden, quoteListNotes: this.settings.quoteListNotes };
  }

  /** 「在笔记里隐藏格式标签」：开关时换掉注册给编辑器的扩展，updateOptions 让打开着的笔记立刻生效 */
  private readonly noteTagExt: Extension[] = [];
  private markMindMapNotes(): void {
    this.app.workspace.iterateAllLeaves((l) => {
      const v = l.view;
      if (v.getViewType() !== "markdown") return;
      const file = (v as { file?: TFile | null }).file;
      v.containerEl.classList.toggle("gg-mm-note", !!file && this.isMindMapFile(file.path));
    });
  }

  applyNoteTags(refresh = true): void {
    this.noteTagExt.length = 0;
    if (this.settings.hideTagsInNotes) this.noteTagExt.push(noteTagsExtension());
    if (this.settings.colorsInNotes) {
      this.noteTagExt.push(
        noteColorsExtension((view) => {
          if (!view.state.field(editorLivePreviewField, false)) return false;
          const path = view.state.field(editorInfoField, false)?.file?.path;
          return (!!path && this.isMindMapFile(path)) || textIsMindMap(view.state.sliceDoc(0, 2000));
        }),
      );
    }
    if (refresh) this.rerenderReadingViews();
    if (this.settings.formatBarInNotes && !Platform.isMobile) {
      this.noteTagExt.push(
        noteFormatBarExtension({
          bar: () => ({
            textColors: parseColorList(this.settings.textColors),
            highlightColors: parseColorList(this.settings.highlightColors, true),
            memory: this.colorMemory,
            underlineKey: Platform.isMacOS ? "⌘U" : "Ctrl+U",
            icon: (name) => {
              const span = createSpan({ cls: "mm-icon" });
              setIcon(span, name);
              return span;
            },
            tip: (el, text) => setTooltip(el, text, { placement: "top" }),
          }),
        }),
      );
    }
    if (this.settings.markersInNotes !== "show") {
      // 只在实时预览、只在脑图笔记（frontmatter 有 mindmap）里
      this.noteTagExt.push(
        noteMarkersExtension(this.settings.markersInNotes, (s) => {
          if (!s.field(editorLivePreviewField, false)) return false;
          const path = s.field(editorInfoField, false)?.file?.path;
          return (!!path && this.isMindMapFile(path)) || textIsMindMap(s.sliceDoc(0, 2000));
        }),
      );
    }
    if (refresh) this.app.workspace.updateOptions();
  }

  /** 设置改了以后，打开着的阅读视图重新渲染（节点颜色是渲染时加上去的） */
  private rerenderReadingViews(): void {
    this.app.workspace.iterateAllLeaves((l) => {
      if (l.view instanceof MarkdownView && l.view.getMode() === "preview") l.view.previewMode.rerender(true);
    });
  }

  /** 「显示隐藏的节点」：只在这次运行里有效，所有脑图一起切换 */
  showHidden = false;

  toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    this.reloadMaps();
  }

  /** 工具栏「快捷设置」面板里的几项：编辑、拆分这些常调的细节设置；和设置页是同一份 */
  quickSettings(): QuickSetting[] {
    const s = this.settings;
    const save = () => void this.saveSettings();
    return [
      {
        label: t("settings.editCaret.name"),
        value: s.editCaret,
        options: [
          { value: "select", label: t("settings.editCaret.select") },
          { value: "end", label: t("settings.editCaret.end") },
        ],
        set: (v) => {
          s.editCaret = v === "end" ? "end" : "select";
          save();
        },
      },
      {
        label: t("settings.formatBar.name"),
        value: s.formatBar,
        set: (v) => {
          s.formatBar = !!v;
          save();
        },
      },
      {
        label: t("settings.widthHandleOnHover.name"),
        value: s.widthHandleOnHover,
        set: (v) => {
          s.widthHandleOnHover = !!v;
          save();
        },
      },
      {
        label: t("settings.keepBlankLines.name"),
        value: s.keepBlankLines,
        set: (v) => {
          s.keepBlankLines = !!v;
          save();
        },
      },
      {
        label: t("settings.splitKeepOriginal.name"),
        value: s.splitKeepOriginal,
        set: (v) => {
          s.splitKeepOriginal = !!v;
          save();
        },
      },
      {
        label: t("settings.splitKeepDelims.name"),
        value: s.splitKeepDelims,
        set: (v) => {
          s.splitKeepDelims = !!v;
          save();
        },
      },
    ];
  }

  /** 拆成子节点的偏好（设置里的保留原文字、保留拆分符号、自定义拆分方式） */
  splitPrefs(): { keepOriginal: boolean; keepDelims: boolean; custom: CustomSplit[] } {
    return { keepOriginal: this.settings.splitKeepOriginal, keepDelims: this.settings.splitKeepDelims, custom: parseCustomSplits(this.settings.customSplits) };
  }

  /** 颜色下拉记住的颜色（上次用的、最近使用），脑图、嵌入的脑图、笔记里的格式栏共用一份 */
  readonly colorMemory: ColorMemory = {
    last: (k) => this.settings.colorMemory?.last?.[k] ?? null,
    recent: (k) => this.settings.colorMemory?.recent?.[k] ?? [],
    remember: (k, c) => {
      const m = (this.settings.colorMemory ??= { last: {}, recent: {} });
      m.last ??= {};
      m.recent ??= {};
      m.last[k] = c;
      m.recent[k] = pushRecent(m.recent[k] ?? [], c);
      this.saveSettingsSoon();
    },
  };

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private saveTimer: number | null = null;
  /** 连续改设置（拖滑块之类）时攒一下再写 data.json */
  saveSettingsSoon(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 1500);
  }

  /** state.json 读回了别的设备的改动：打开着的脑图跟上 */
  private applyFileState(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      if (leaf.view instanceof MindMapView) leaf.view.applyFileState();
    }
  }

  // ---------- 标注的显示 / 隐藏（按文件记） ----------

  isCalloutsHidden(path: string): boolean {
    return !!path && !!this.fileState.get("hiddenCallouts", path);
  }

  setCalloutsHidden(path: string, hidden: boolean): void {
    this.fileState.set("hiddenCallouts", path, hidden || undefined);
  }

  // ---------- 备注展开（默认值在设置里，工具栏上切换过的按文件记） ----------

  isNotesExpanded(path: string): boolean {
    return (path ? this.fileState.get("notesExpanded", path) : undefined) ?? this.settings.notesExpanded;
  }

  setNotesExpanded(path: string, expanded: boolean): void {
    this.fileState.set("notesExpanded", path, expanded);
  }

  /** 每条展开备注单独的状态（单独收起、拖出来的大小） */
  getNoteCards(path: string): NoteCards | undefined {
    return path ? this.fileState.get("noteCards", path) : undefined;
  }

  setNoteCards(path: string, cards: NoteCards): void {
    this.fileState.set("noteCards", path, Object.keys(cards).length ? cards : undefined);
  }

  // ---------- 锁定编辑（按文件记，不写进笔记） ----------

  isLocked(path: string): boolean {
    return !!path && !!this.fileState.get("locked", path);
  }

  setLocked(path: string, locked: boolean): void {
    if (!path) return;
    this.fileState.set("locked", path, locked || undefined);
    // 同一个文件开在别的标签页里的脑图跟着锁上 / 解开
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      const v = leaf.view;
      if (v instanceof MindMapView && v.file?.path === path) v.applyLock(locked);
    }
  }

  // ---------- 记住视口 ----------

  /** 这个文件按路径记下的全部状态（视口、锁定、备注、隐藏标注）都丢掉：它们坏了让图打不开时用 */
  forgetFileState(path: string): void {
    this.viewports.remove(path);
    this.fileState.remove(path);
  }

  getViewport(path: string): SavedViewport | undefined {
    return this.settings.rememberViewport ? this.viewports.get(path) : undefined;
  }

  rememberViewport(path: string, vp: Omit<SavedViewport, "at">): void {
    // 文件刚被删掉时视图随后关闭还会再记一次，跳过已经不存在的文件
    if (!this.settings.rememberViewport || !path || !this.app.vault.getAbstractFileByPath(path)) return;
    this.viewports.set(path, { ...vp, at: Date.now() });
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

  /**
   * 标题改名后修别的笔记里的链接：[[笔记#旧标题]] / [[笔记#上级#旧标题]] / ![[笔记#旧标题]] 改成新标题。
   * 只改链接目标确实是这篇笔记、而且那一段标题完全一致的；笔记自己里面的 [[#旧标题]] 不动（正在写这篇）
   */
  fixHeadingLinks(file: TFile, renames: Map<string, string>): void {
    if (!renames.size) return;
    const sources = Object.entries(this.app.metadataCache.resolvedLinks)
      .filter(([src, targets]) => src !== file.path && targets[file.path])
      .map(([src]) => src);
    void (async () => {
      let count = 0;
      for (const src of sources) {
        const srcFile = this.app.vault.getAbstractFileByPath(src);
        const cache = srcFile instanceof TFile ? this.app.metadataCache.getFileCache(srcFile) : null;
        if (!(srcFile instanceof TFile) || !cache) continue;
        const swaps: [string, string][] = [];
        for (const l of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
          const hash = l.link.indexOf("#");
          if (hash < 0) continue;
          if (this.app.metadataCache.getFirstLinkpathDest(l.link.slice(0, hash), src) !== file) continue;
          const parts = l.link.slice(hash + 1).split("#");
          const last = parts[parts.length - 1];
          const to = renames.get(last);
          if (to === undefined) continue;
          // 原文里的写法：wikilink 是原样，Markdown 链接可能是编码过的
          for (const from of [`#${last}`, `#${encodeURI(last)}`, `#${last.replace(/ /g, "%20")}`]) {
            if (!l.original.includes(from)) continue;
            const enc = from === `#${last}` ? to : from === `#${encodeURI(last)}` ? encodeURI(to) : to.replace(/ /g, "%20");
            swaps.push([l.original, l.original.replace(from, `#${enc}`)]);
            break;
          }
        }
        if (!swaps.length) continue;
        await this.app.vault.process(srcFile, (text) => {
          for (const [a, b] of swaps) {
            if (!text.includes(a)) continue;
            text = text.split(a).join(b);
            count++;
          }
          return text;
        });
      }
      if (count) new Notice(t("notice.headingLinksUpdated", { n: count }));
    })();
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
    scrollEditorLineToCenter((editor as unknown as { cm: EditorView }).cm, line);
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
  /** 分屏联动最近一次对上的「文件 + 行」：两边互相带的时候靠它别来回弹 */
  private lastFollowKey = "";

  private registerSplitSync(): void {
    // 工具栏的分屏联动按钮：布局变了（开关分屏、换标签页、换文件）就看一下要不要显示
    const refresh = () => window.setTimeout(() => this.updateSplitSyncButtons(), 0);
    this.registerEvent(this.app.workspace.on("layout-change", refresh));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.app.workspace.onLayoutReady(refresh);
    let timer: number | null = null;
    const onSelectionChange = (ev: Event) => {
      if (!this.settings.syncSplit) return;
      // 找这个窗口里光标所在的编辑器：不用 activeLeaf，独立窗口里的编辑器不一定是它
      const doc = ev.target as Document;
      const view = this.app.workspace
        .getLeavesOfType("markdown")
        .map((l) => l.view)
        .find((v): v is MarkdownView => v instanceof MarkdownView && v.containerEl.doc === doc && v.editor.hasFocus());
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
        if (key === this.lastFollowKey) return;
        this.lastFollowKey = key;
        const text = view.editor.getValue();
        for (const m of this.visibleMapsOf(file.path)) m.followLine(text, line);
      }, 200);
    };
    // 阅读模式没有光标：点到哪一段（列表项）就让脑图选中哪个节点
    const onPreviewClick = (ev: MouseEvent) => {
      if (!this.settings.syncSplit) return;
      const target = ev.target as HTMLElement | null;
      if (!target?.closest?.(".markdown-reading-view")) return;
      const view = this.app.workspace
        .getLeavesOfType("markdown")
        .map((l) => l.view)
        .find((v): v is MarkdownView => v instanceof MarkdownView && v.getMode() === "preview" && v.containerEl.contains(target));
      const file = view?.file;
      if (!view || !file) return;
      const line = previewLineAt(view, target);
      if (line === null) return;
      const maps = this.visibleMapsOf(file.path);
      if (!maps.length) return;
      this.lastFollowKey = `${file.path}\u0001${line}`;
      const text = view.editor.getValue();
      for (const m of maps) m.followLine(text, line);
    };
    // 每个窗口有自己的 document：主窗口之外，独立窗口打开时也要挂上
    const watched = new WeakSet<Document>();
    const watch = (doc: Document) => {
      if (watched.has(doc)) return;
      watched.add(doc);
      this.registerDomEvent(doc, "selectionchange", onSelectionChange);
      this.registerDomEvent(doc, "click", onPreviewClick);
    };
    watch(document);
    this.registerEvent(this.app.workspace.on("window-open", (win) => watch(win.doc)));
    this.app.workspace.onLayoutReady(() => this.allDocs().forEach(watch));
    this.register(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
  }

  /**
   * 跟随当前笔记（设置里打开）：编辑器里换了一篇 Markdown 笔记，旁边正显示着的脑图也换成它。
   * 只动一个脑图标签页（最近用过的那个），钉住的不动；那篇已经有脑图在显示就不用换
   */
  private registerFollowActive(): void {
    /** 换一次；换了返回 true（等切换完成） */
    const followOnce = async (): Promise<boolean> => {
      if (!this.settings.followActiveNote) return false;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!view || !file || file.extension !== "md") return false;
      const maps = this.app.workspace
        .getLeavesOfType(VIEW_TYPE_MINDMAP)
        .filter((l) => l !== view.leaf && l.view instanceof MindMapView && l.view.containerEl.isShown());
      if (!maps.length || maps.some((l) => (l.view as MindMapView).file?.path === file.path)) return false;
      const target = maps
        .filter((l) => !(l as WorkspaceLeaf & { pinned?: boolean }).pinned)
        .sort((a, b) => ((b as unknown as { activeTime?: number }).activeTime ?? 0) - ((a as unknown as { activeTime?: number }).activeTime ?? 0))[0];
      if (!target) return false;
      const mapView = target.view as MindMapView;
      mapView.rememberViewportNow();
      await target.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: file.path }, active: false });
      return true;
    };
    // 一次只换一个：上一次还没换完（库外文件读得慢）又来一次时，Obsidian 可能把后一次丢掉，脑图停在上一篇，
    // 和左边的笔记对不上（#30）。换完再对一遍，还不一致就接着换（最多几次，防止来回抖）
    let running = false;
    let again = false;
    const follow = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        for (let i = 0; i < 4; i++) {
          again = false;
          const switched = await followOnce();
          if (!switched && !again) break;
        }
      } catch (e) {
        console.error("gogoga-mindmap: follow active note failed", e);
      } finally {
        running = false;
      }
    };
    this.registerEvent(this.app.workspace.on("file-open", () => void follow()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void follow()));
  }

  /** Markdown 跟着脑图折叠：每个 Markdown 视图上次跟着脑图折起来的节点（路径）。按它算增减，用户自己折的不碰 */
  private appliedFolds = new WeakMap<MarkdownView, { mode: string; paths: Set<string> }>();

  private registerFoldFollow(): void {
    let timer: number | null = null;
    // 脑图改了折叠要等文件写回、Markdown 视图更新；打开 Markdown、切换编辑 / 阅读模式时 layout-change 会来
    const soon = () => {
      if (!this.settings.foldFollow) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        this.syncFolds();
      }, 300);
    };
    this.registerEvent(this.app.workspace.on("layout-change", soon));
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (f instanceof TFile && this.app.workspace.getLeavesOfType("markdown").some((l) => (l.view as MarkdownView).file?.path === f.path)) soon();
      }),
    );
    this.register(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
  }

  /**
   * 把文件里的 %%fold%% 应用到打开着的同一篇 Markdown（编辑器和阅读视图都有 getFoldInfo / applyFoldInfo，
   * Obsidian 记折叠状态用的就是它们，没有公开 API，取不到就跳过）。只增减跟着脑图走的那些节点的折叠
   */
  syncFolds(): void {
    if (!this.settings.foldFollow) return;
    type FoldInfo = { folds: { from: number; to: number }[]; lines: number };
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      if (!this.isMindMapFile(view.file.path) && !this.visibleMapsOf(view.file.path).length) continue;
      const mode = view.currentMode as unknown as { getFoldInfo?: () => FoldInfo | null; applyFoldInfo?: (info: FoldInfo) => void };
      if (typeof mode?.getFoldInfo !== "function" || typeof mode.applyFoldInfo !== "function") continue;
      const plan = foldPlan(view.editor.getValue(), this.rootRule());
      const now = new Set(plan.paths);
      const prev = this.appliedFolds.get(view);
      const modeName = `${view.file.path}\u0001${view.getMode()}`;
      // 换了笔记或模式（编辑 ⇄ 阅读的折叠状态各管各的），当成第一次
      const before = prev && prev.mode === modeName ? prev.paths : new Set<string>();
      if (prev && prev.mode === modeName && before.size === now.size && [...now].every((p) => before.has(p))) continue;
      this.appliedFolds.set(view, { mode: modeName, paths: now });
      const unfold = new Set([...before].filter((p) => !now.has(p)).map((p) => plan.lineOf.get(p)).filter((l): l is number => l !== undefined));
      const add = plan.folds.filter((f) => !before.has(plan.paths[plan.folds.indexOf(f)]));
      const cur = mode.getFoldInfo()?.folds ?? [];
      const kept = cur.filter((f) => !unfold.has(f.from) && !add.some((a) => a.from === f.from));
      const folds = [...kept, ...add].sort((a, b) => a.from - b.from);
      const keep = this.keepScroll(view);
      mode.applyFoldInfo({ folds, lines: view.editor.lineCount() });
      keep();
    }
  }

  /**
   * 重新套一遍折叠（applyFoldInfo）后 Obsidian 会把滚动位置算歪：长笔记里前面折着很多段时，
   * 在脑图里展开一个分支，旁边 Markdown 一下子跳到几十行开外。套之前记下顶端是哪一行、离顶端多远，
   * 套完把同一行放回原处（编辑器按 CodeMirror 的行块高度算，阅读视图按行号）
   */
  private keepScroll(view: MarkdownView): () => void {
    type Block = { from: number; top: number };
    type CM = { scrollDOM: HTMLElement; lineBlockAtHeight(h: number): Block; lineBlockAt(pos: number): Block; state: { doc: { length: number } } };
    if (view.getMode() === "preview") {
      const line = view.previewMode.getScroll();
      return () => view.previewMode.applyScroll(line);
    }
    const cm = (view.editor as unknown as { cm?: CM }).cm;
    if (!cm) return () => {};
    const top = cm.scrollDOM.scrollTop;
    const block = cm.lineBlockAtHeight(top);
    const offset = top - block.top;
    return () => {
      if (block.from > cm.state.doc.length) return;
      cm.scrollDOM.scrollTop = cm.lineBlockAt(block.from).top + offset;
    };
  }

  /** 正在显示（不是藏在别的标签页后面）的同一文件的脑图 */
  /** 设置里的分屏联动开关（工具栏按钮也改它）：存下来，所有脑图的按钮跟着变 */
  async setSyncSplit(on: boolean): Promise<void> {
    this.settings.syncSplit = on;
    await this.saveSettings();
    this.updateSplitSyncButtons();
  }

  /** 每个脑图看一下同一篇的 Markdown 有没有显示着，有才在工具栏显示分屏联动按钮 */
  updateSplitSyncButtons(): void {
    const shownMd = new Set(
      this.app.workspace
        .getLeavesOfType("markdown")
        .map((l) => l.view)
        .filter((v): v is MarkdownView => v instanceof MarkdownView && !!v.file && v.containerEl.isShown())
        .map((v) => v.file!.path),
    );
    for (const l of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      const v = l.view;
      if (v instanceof MindMapView) v.updateSplitSync(!!v.file && shownMd.has(v.file.path));
    }
  }

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
    // 脑图里刚改过（移动节点之类）还没写盘：Markdown 那边还是旧内容，按旧内容定位会跳到错的行（#30）。
    // 先写盘，等旁边的 Markdown 换成新内容（最多一秒）再定位
    const file = from.file;
    const stale = this.app.workspace
      .getLeavesOfType("markdown")
      .some((l) => l.view instanceof MarkdownView && l.view.file === file && l.view.containerEl.isShown() && l.view.editor.getValue() !== from.getViewData());
    if (stale && from.hasUnsavedChanges()) {
      void (async () => {
        await from.save();
        const win = from.containerEl.win;
        const started = win.performance.now();
        const ready = () =>
          this.app.workspace
            .getLeavesOfType("markdown")
            .every((l) => !(l.view instanceof MarkdownView) || l.view.file !== file || l.view.editor.getValue() === from.getViewData());
        while (!ready() && win.performance.now() - started < 1000) await new Promise((r) => win.setTimeout(r, 30));
        if (from.file === file && from.getSelectedPath() === path) this.revealSelectedInMarkdown(from, path);
      })();
      return;
    }
    this.revealSelectedInMarkdown(from, path);
  }

  private revealSelectedInMarkdown(from: MindMapView, path: string): void {
    if (!from.file) return;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== from.file.path || !view.containerEl.isShown()) continue;
      if (view.getMode() === "preview") {
        const line = lineOfPath(view.editor.getValue(), path, this.rootRule());
        if (line === null) continue;
        this.lastFollowKey = `${from.file.path}\u0001${line}`;
        this.revealPreviewLine(view, line);
        continue;
      }
      // 用户正在那边打字：光标是他的，不去动。各窗口各记各的焦点：Markdown 开在别的窗口时，
      // 它的编辑器一直显示「有焦点」，可人正在这边点脑图，不算在打字
      if (view.editor.hasFocus() && view.containerEl.doc === from.containerEl.doc) continue;
      const editor = view.editor;
      const line = lineOfPath(editor.getValue(), path, this.rootRule());
      if (line === null) continue;
      // 记成已跟随过的那一行：别的窗口里的编辑器还带着焦点，这次移光标引起的 selectionchange 不再弹回脑图
      this.lastFollowKey = `${from.file.path}\u0001${line}`;
      editor.setCursor({ line, ch: editor.getLine(line).length });
      // 只滚编辑器自己：scrollIntoView 会连外层容器一起滚（#29）
      scrollEditorLineToCenter((editor as unknown as { cm: EditorView }).cm, line);
      this.flashLine(view, line);
    }
  }

  /**
   * 阅读模式：滚到那一行并闪一下。阅读视图是按段懒渲染的，先用 applyScroll 让那一段画出来，
   * 等它渲染好再找到元素居中（列表项找到那一项，其余是整段）
   */
  private revealPreviewLine(view: MarkdownView, line: number): void {
    unfoldPreviewLine(view, line);
    view.previewMode.applyScroll(line);
    const win = view.containerEl.win;
    const started = win.performance.now();
    const tick = () => {
      const hit = previewElAtLine(view, line);
      // 用 setTimeout 不用 requestAnimationFrame：Markdown 在被挡住的独立窗口里时动画帧不触发
      // 那一段还没渲染出来（机器忙时 applyScroll 之后要等几帧）：接着等，最多约一秒；等不到渲染好也先滚过去
      if (!hit?.ready && win.performance.now() - started < 1000) {
        win.setTimeout(tick, 16);
        return;
      }
      if (!hit) return;
      const el = hit.el;
      // 只滚阅读视图自己：el.scrollIntoView 会连外层容器一起滚（#29）
      // 阅读视图真正在滚的是里面的 .markdown-preview-view，不是 previewMode.containerEl：从元素往外找
      const scroller = scrollParentWithin(el, view.containerEl);
      if (!scroller) return;
      scrollWithin(scroller, el, "center");
      // 滚过去之后，上面的段落才陆续渲染、高度变了，目标会被挤出画面：半秒内被挤出去就再居中（元素被重画了就重新找）
      const settleFrom = win.performance.now();
      const recheck = () => {
        if (win.performance.now() - settleFrom > 600) return;
        const cur = el.isConnected ? el : previewElAtLine(view, line)?.el;
        if (cur) {
          const s = scroller.getBoundingClientRect();
          const r = cur.getBoundingClientRect();
          if (r.top < s.top || r.bottom > s.bottom) scrollWithin(scroller, cur, "center");
        }
        win.setTimeout(recheck, 16);
      };
      win.setTimeout(recheck, 16);
      if (!el.animate) return;
      const color = win.getComputedStyle(el).getPropertyValue("--text-highlight-bg").trim() || "rgba(255, 208, 0, 0.4)";
      el.animate([{ backgroundColor: color }, { backgroundColor: color, offset: 0.5 }, { backgroundColor: "transparent" }], { duration: 1500, easing: "ease-out" });
    };
    win.requestAnimationFrame(tick);
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
    // 用编辑器所在窗口的：Markdown 开在独立窗口里时，主窗口在后台，它的动画帧会被节流
    const win = view.containerEl.win;
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        const node = cm.domAtPos(pos).node;
        const el = (node.instanceOf(HTMLElement) ? node : node.parentElement)?.closest<HTMLElement>(".cm-line");
        if (!el?.animate) return;
        const color = win.getComputedStyle(el).getPropertyValue("--text-highlight-bg").trim() || "rgba(255, 208, 0, 0.4)";
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
        const mapsOf = () =>
          this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP).map((l) => l.view).filter((v): v is MindMapView => v instanceof MindMapView && v.file?.path === path);
        if (!mapsOf().length) return;
        window.clearTimeout(timers.get(path));
        timers.set(
          path,
          window.setTimeout(() => {
            timers.delete(path);
            // 等的这 150ms 里编辑器、脑图都可能换了文件（跟随当前笔记、在库内外笔记间来回切）：
            // 编辑器已经不是这篇就不推；脑图按现在显示的文件重新找，不用当初记下的（#30：库内笔记被库外笔记的内容覆盖）
            if (info.file?.path !== path) return;
            const text = editor.getValue();
            for (const v of mapsOf()) v.syncFromEditor(text, path);
          }, 150),
        );
      }),
    );
    this.register(() => timers.forEach((id) => window.clearTimeout(id)));
  }

  /**
   * 左右分屏对照：左边 Markdown，右边脑图，都不写 frontmatter。
   * leaf 正显示着这篇的脑图（脑图笔记默认就是）：先把它换成 Markdown，再在右侧开脑图；
   * 没给 leaf、或 leaf 显示的不是这篇：在当前标签页打开 Markdown
   */
  async openSideBySide(file: TFile, leaf?: WorkspaceLeaf): Promise<void> {
    const target = leaf ?? this.app.workspace.getLeaf(false);
    const view = target.view;
    if (!(view instanceof MarkdownView && view.file === file)) await this.openAsMarkdown(file, target);
    this.app.workspace.setActiveLeaf(target, { focus: true });
    await this.openPreview(file);
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
        // Markdown 和脑图视图里都能用：当前显示哪一边，另一边就开到右侧
        const view = this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.app.workspace.getActiveViewOfType(MindMapView);
        const file = view?.file;
        if (!view || !file || file.extension !== "md") return false;
        if (!checking) void this.openSideBySide(file, view.leaf);
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
    exportCommand("toggle-numbering", t("command.toggleNumbering"), async (v) => v.toggleNumberingOnSelected());
    exportCommand("toggle-recite", t("command.toggleRecite"), async (v) => v.toggleRecite());
    exportCommand("toggle-pdf-excerpt", t("command.togglePdfExcerpt"), async (v) => this.pdfExcerpt.toggle(v));
    exportCommand("toggle-callouts", t("command.toggleCallouts"), async (v) => v.toggleCallouts());
    exportCommand("toggle-notes", t("command.toggleNotes"), async (v) => v.toggleNotes());
    exportCommand("toggle-hidden", t("command.toggleHidden"), async () => this.toggleShowHidden());
    exportCommand("toggle-lock", t("command.toggleLock"), async (v) => v.toggleLock());
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
      ["add-relationship", "add-rel", "command.addRel"],
      ["delete-node", "delete", "command.deleteNode"],
      ["delete-node-only", "delete-only", "command.deleteNodeOnly"],
      ["move-up", "move-up", "command.moveUp"],
      ["move-down", "move-down", "command.moveDown"],
      ["outdent", "outdent", "command.outdent"],
      ["indent", "indent", "command.indent"],
      ["expand-branch", "expand-branch", "command.expandBranch"],
      ["collapse-branch", "collapse-branch", "command.collapseBranch"],
      ["expand-level", "expand-level", "command.expandLevel"],
      ["collapse-level", "collapse-level", "command.collapseLevel"],
    ];
    for (const [id, cmd, name] of nodeCommands) exportCommand(id, t(name), async (v) => v.runNodeCommand(cmd));
    exportCommand("format-bold", t("command.formatBold"), async (v) => v.formatText({ kind: "bold" }));
    exportCommand("format-italic", t("command.formatItalic"), async (v) => v.formatText({ kind: "italic" }));
    exportCommand("format-underline", t("command.formatUnderline"), async (v) => v.formatText({ kind: "underline" }));
    exportCommand("format-highlight", t("command.formatHighlight"), async (v) => v.formatText({ kind: "highlight" }));
    for (const n of [1, 2, 3, 4, 5]) {
      exportCommand(`format-text-color-${n}`, t("command.formatTextColor", { n }), async (v) => v.formatColor("color", n - 1));
      exportCommand(`format-highlight-color-${n}`, t("command.formatHighlightColor", { n }), async (v) => v.formatColor("bg", n - 1));
    }
    exportCommand("format-clear", t("command.formatClear"), async (v) => v.formatText({ kind: "clear" }));
    // 开关型命令：按一下打开 / 关掉对应的设置（和去设置页拨开关一样，会记住），可以绑快捷键
    const toggleSetting = (id: string, key: "showNodebar" | "formatBar" | "formatBarInNotes", name: Parameters<typeof t>[0], label: Parameters<typeof t>[0]) =>
      this.addCommand({
        id,
        name: t(name),
        callback: async () => {
          this.settings[key] = !this.settings[key];
          await this.saveSettings();
          if (key === "formatBarInNotes") this.applyNoteTags();
          else refreshAllBars();
          new Notice(t(this.settings[key] ? "notice.toggledOn" : "notice.toggledOff", { name: t(label) }));
        },
      });
    toggleSetting("toggle-nodebar", "showNodebar", "command.toggleNodebar", "settings.showNodebar.name");
    toggleSetting("toggle-format-bar", "formatBar", "command.toggleFormatBar", "settings.formatBar.name");
    toggleSetting("toggle-note-format-bar", "formatBarInNotes", "command.toggleNoteFormatBar", "settings.formatBarInNotes.name");
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
    // 脑图笔记也给：最想左右对照着看的往往就是它
    menu.addItem((item) =>
      item
        .setTitle(t("command.openPreview"))
        .setIcon("columns-2")
        .onClick(() => void this.openSideBySide(file, shown ?? undefined)),
    );
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

      // 代码块里没被这次编辑碰到的行保持原样，和脑图笔记一样
      const keepFormat = (next: string) =>
        blankBeforeNodeTables(preserveFormat(current, next.replace(/\n$/, ""), (text) => serializeMarkdown(parseMarkdown(text, { fallbackTitle: "", style })).replace(/\n$/, "")));
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
        notePreview: () => this.settings.notePreview,
        formatBar: () => this.settings.formatBar,
        split: () => this.splitPrefs(),
        keepBlankLines: () => this.settings.keepBlankLines,
        centerOnSelect: () => this.settings.centerOnSelect,
        hideSyntax: () => this.settings.hideSyntax,
        widthHandleOnHover: () => this.settings.widthHandleOnHover,
        newNodeName: () => this.settings.newNodeName,
        autoNumber: () => this.settings.numberByTyping,
        copyPlain: () => this.settings.copyPlain,
        showNodebar: () => this.settings.showNodebar,
        nodebarLayout: () => mergeLayout(this.settings.nodebarLayout, NODEBAR_DEFAULT),
        toolbarLayout: () => embedToolbarLayout(this.settings),
        nodeColors: () => parseNodeColors(this.settings.nodeColors),
        textColors: () => parseColorList(this.settings.textColors),
        highlightColors: () => parseColorList(this.settings.highlightColors, true),
        colorMemory: this.colorMemory,
        marqueeDrag: () => this.settings.leftDrag === "select",
        caretAtEnd: () => this.settings.editCaret === "end",
        dragToFloat: () => this.settings.dragToFloat,
        notesExpanded: () => this.settings.notesExpanded,
        noteCardFilter: () => this.settings.noteCardShow,
        notePopoverSize: this.notePopoverSize,
        host: this.canvasHost(() => ctx.sourcePath, child),
        onChange: (d) => {
          // 代码块没有文件名可用：补出来的中心主题被起了名字，就升格成一级标题写进去，不然重画后名字丢了（#26）
          // 存不下时只撤掉中心主题的名字，同一次里别的改动照常写回
          if (promoteRoot(d) === "full") {
            new Notice(t("notice.rootNoRoom"));
            d.root.text = "";
            wrap.win.setTimeout(() => canvas.render(), 0);
          }
          writeBack(keepFormat(serializeMarkdown(d)));
        },
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
          writeBack(keepFormat(serializeMarkdown(d)));
        },
        onEdgeChange: (e) => {
          const d = canvas.getDoc();
          if (!d) return;
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-edge", e.shape ?? null);
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-edge-dash", e.dashed === undefined ? null : String(e.dashed));
          d.frontmatter = setFrontmatterValue(d.frontmatter, "mindmap-edge-corner", e.sharp === undefined ? null : e.sharp ? "sharp" : "round");
          writeBack(keepFormat(serializeMarkdown(d)));
        },
        onLayout: (bounds) => {
          // 工具栏在上下边时多留出它的高度，最靠边的节点才不会被挡住
          const bar = canvas.toolbarInsets();
          const h = Math.min(this.settings.codeBlockMaxHeight, Math.max(200, Math.round(bounds.h + 96 + bar.top + bar.bottom)));
          if (h !== lastHeight) {
            lastHeight = h;
            // 布局回调可能处在 ResizeObserver 链路里，直接改高度会触发 "loop completed" 警告；推到下一帧
            wrap.win.requestAnimationFrame(() => {
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
          else if (++tries < 10) wrap.win.requestAnimationFrame(refocus);
        };
        wrap.win.requestAnimationFrame(refocus);
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
    // mindmap 已经被别的插件（Markmind 等）登记了：让给它，不然整个插件加载失败（#34）
    if (this.settings.claimMindmapBlock)
      try {
        this.registerMarkdownCodeBlockProcessor("mindmap", processor);
      } catch (e) {
        console.warn("gogoga Mind Map: the mindmap code block is taken by another plugin; use gogoga-mindmap", e);
      }
  }

  /** 把新的块内容写回宿主笔记：文件在编辑器里打开就走编辑器，否则直接改文件 */
  private async replaceCodeBlock(ctx: MarkdownPostProcessorContext, el: HTMLElement, expectedInner: string, nextInner: string): Promise<void> {
    const info = ctx.getSectionInfo(el);
    const hint = info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
    // 白板的文本卡片没有宿主笔记（sourcePath 是空的），块在卡片自己的文字里
    const card = this.canvasTextCard(el);
    if (card) {
      const range = locateBlock(card.node.text, hint, expectedInner);
      if (!range) throw new Error(t("error.blockNotFound"));
      card.node.setText(replaceBlock(card.node.text, range, nextInner));
      card.canvas.requestSave();
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) throw new Error(t("error.fileNotFound", { path: ctx.sourcePath }));

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
   * 代码块所在的白板文本卡片。白板没有公开 API：从打开着的白板视图里找 nodeEl 包含它、带 text 的卡片；
   * 文件卡片（嵌入的笔记）有自己的宿主笔记，不在这里处理
   */
  private canvasTextCard(el: HTMLElement): { canvas: { requestSave(): void }; node: { text: string; setText(text: string): void } } | null {
    if (!el.closest(".canvas-node")) return null;
    type CanvasNode = { nodeEl?: HTMLElement; text?: unknown; setText?: (text: string) => void };
    type Canvas = { nodes?: Map<string, CanvasNode>; requestSave?: () => void };
    for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
      const canvas = (leaf.view as unknown as { canvas?: Canvas }).canvas;
      if (!canvas?.nodes || typeof canvas.requestSave !== "function") continue;
      for (const node of canvas.nodes.values()) {
        if (!node.nodeEl?.contains(el)) continue;
        if (typeof node.text !== "string" || typeof node.setText !== "function") return null;
        const setText = node.setText.bind(node);
        const requestSave = canvas.requestSave.bind(canvas);
        return {
          canvas: { requestSave },
          node: {
            get text() {
              return node.text as string;
            },
            setText,
          },
        };
      }
    }
    return null;
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

  /**
   * 链接指向一个已经在别的标签页里打开的 PDF：在那个标签页里跳到对应位置（页码、选区高亮），
   * 不把脑图所在的标签页换成 PDF。左脑图右 PDF 边读边记时，点节点就在右边定位
   */
  private revealInOpenPdf(href: string, sourcePath: string): boolean {
    const hash = href.indexOf("#");
    const path = hash < 0 ? href : href.slice(0, hash);
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file || file.extension !== "pdf") return false;
    let target: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((l) => {
      if (!target && l.view.getViewType() === "pdf" && (l.view as unknown as { file?: TFile }).file?.path === file.path) target = l;
    });
    if (!target) return false;
    const leaf: WorkspaceLeaf = target;
    void leaf.openFile(file, { eState: { subpath: hash < 0 ? "" : href.slice(hash) } }).then(() => {
      void this.app.workspace.revealLeaf(leaf);
      // Obsidian 自己的 PDF 阅读器在文件已经打开时只滚动、不画选区高亮（高亮要等页面重新渲染）；
      // 内部接口在就补画一次，没有就算了。PDF++ 自己会画
      type Child = { subpathHighlight?: { type: string; page: number; range: unknown } | null; highlightText?: (page: number, range: unknown) => void };
      const child = (leaf.view as unknown as { viewer?: { child?: Child } }).viewer?.child;
      const h = child?.subpathHighlight;
      if (h?.type === "text" && typeof child?.highlightText === "function") {
        try {
          child.highlightText(h.page, h.range);
        } catch {
          // 内部接口变了：只滚动到位置
        }
      }
    });
    return true;
  }

  /** 抓网页标题；10 秒没回来、出错、不是网页都当没有 */
  private async fetchPageTitle(url: string): Promise<string | null> {
    const fetch = (async () => {
      const res = await requestUrl({ url, method: "GET", throw: false });
      if (res.status >= 400) return null;
      const type = res.headers["content-type"] ?? res.headers["Content-Type"];
      if (type && !/html/i.test(type)) return null;
      const bytes = res.arrayBuffer;
      // 先按 latin1 看一眼开头找 <meta charset>，再用声明的编码解（GBK 的中文网页不少）
      const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
      let html: string;
      try {
        html = new TextDecoder(htmlCharset(type, head)).decode(bytes);
      } catch {
        html = new TextDecoder().decode(bytes);
      }
      return titleFromHtml(html);
    })();
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 10000));
    try {
      return await Promise.race([fetch, timeout]);
    } catch {
      return null;
    }
  }

  canvasHost(sourcePath: () => string, component: Component, hoverParent?: HoverParent): CanvasHost {
    return {
      claimKeys: (el, onKey) => {
        // Obsidian 的热键在 window 捕获阶段就处理了，画布自己的 keydown 来不及拦：
        // F2 默认是「重命名文件」，在笔记里嵌入的图上按 F2 会跑去改文件名。
        // 焦点在图里时压一层 Scope 先截下来交给画布，返回 false 让 Obsidian 不再往下处理
        const scope = new Scope(this.app.scope);
        scope.register([], "F2", (ev) => {
          onKey(ev);
          return false;
        });
        // ⌘B / ⌘I 同理：不截的话会交给外面笔记的编辑器去加粗它自己的选区
        for (const k of ["b", "i"]) {
          scope.register(["Mod"], k, (ev) => {
            onKey(ev);
            return false;
          });
        }
        let pushed = false;
        const pop = () => {
          if (!pushed) return;
          this.app.keymap.popScope(scope);
          pushed = false;
        };
        const onIn = () => {
          if (pushed) return;
          this.app.keymap.pushScope(scope);
          pushed = true;
        };
        const onOut = (ev: FocusEvent) => {
          if (!el.contains(ev.relatedTarget as Node | null)) pop();
        };
        el.addEventListener("focusin", onIn);
        el.addEventListener("focusout", onOut);
        return () => {
          el.removeEventListener("focusin", onIn);
          el.removeEventListener("focusout", onOut);
          pop();
        };
      },
      notePreviewScope: () => {
        const scope = new Component();
        scope.load();
        let child: Component | null = null;
        return {
          render: (el, markdown) => {
            if (child) scope.removeChild(child);
            child = scope.addChild(new Component());
            el.empty();
            void MarkdownRenderer.render(this.app, markdown, el, sourcePath(), child);
          },
          dispose: () => scope.unload(),
        };
      },
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
      renderPdfCrop: (link, el, onImage) => {
        // 截区是 PDF++ 的写法，Obsidian 自己只会显示整页，没装就退回成链接
        const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
        if (!plugins?.enabledPlugins?.has("pdf-plus")) return false;
        let done = false;
        const settle = (img: HTMLImageElement) => {
          if (done) return;
          done = true;
          observer.disconnect();
          onImage(img);
        };
        // PDF++ 先放一个占位、渲染好了才换成 <img>（data URL），等图片真正加载完再交回去量尺寸
        const observer = new MutationObserver(() => {
          const img = el.querySelector("img");
          if (!img) return;
          if (img.complete && img.naturalWidth) settle(img);
          else img.addEventListener("load", () => settle(img), { once: true });
        });
        observer.observe(el, { childList: true, subtree: true });
        void MarkdownRenderer.render(this.app, `![[${link}]]`, el, sourcePath(), component);
        return true;
      },
      resolveImage: (link) => {
        if (/^(https?:|data:|app:|blob:)/.test(link)) return link;
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
      linkTitle: (url) => (this.settings.pasteLinkTitle ? this.fetchPageTitle(url) : null),
      // 工具栏按钮只有图标：提示别让人等（Obsidian 默认要停一会儿才出）
      setTooltip: (el, text, placement) => setTooltip(el, text, { placement, delay: 150 }),
      setIcon: (el, name) => setIcon(el, name),
      listTags: () => Object.keys((this.app.metadataCache as unknown as { getTags?: () => Record<string, number> }).getTags?.() ?? {}).map((x) => x.replace(/^#/, "")),
      openLink: (href, internal, ev) => {
        if (!internal) {
          window.open(href, "_blank");
          return;
        }
        // ⌘ 点新标签页、⌘⌥ 点右侧分屏……照 Obsidian 的习惯；不按修饰键时按设置
        const mod = Keymap.isModEvent(ev);
        if (!mod && this.revealInOpenPdf(href, sourcePath())) return;
        if (mod === "split" || (!mod && this.settings.linkOpen === "split")) void this.openInLinkSplit(href, sourcePath());
        else void this.app.workspace.openLinkText(href, sourcePath(), mod || (this.settings.linkOpen === "tab" ? "tab" : false));
      },
      linkContextMenu: (ev, linktext, extra) => {
        const menu = new Menu();
        for (const x of extra)
          menu.addItem((item) => {
            item
              .setSection(x.warning ? "danger" : "action")
              .setTitle(x.title)
              .setIcon(x.icon)
              .onClick(() => x.run());
            if (x.warning) item.setWarning(true);
          });
        // Obsidian 给链接右键用的内部方法：菜单和笔记里一模一样，别的插件加的项也在；没有就只放 extra
        const ws = this.app.workspace as unknown as { handleLinkContextMenu?: (menu: Menu, linktext: string, sourcePath: string) => boolean };
        if (linktext) ws.handleLinkContextMenu?.(menu, linktext, sourcePath());
        menu.showAtMouseEvent(ev);
      },
      deleteLinkedFile: async (linktext) => {
        const file = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath());
        return file ? this.app.fileManager.promptForDeletion(file) : false;
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
    const leaf = this.linkSplit(origin);
    await leaf.openFile(file, { active: false });
    // 新笔记在右侧打开，焦点留在脑图上，方便继续加节点
    if (origin) this.app.workspace.setActiveLeaf(origin, { focus: true });
    return file;
  }

  /** 上次从脑图打开链接用的右侧分屏：还开着就接着用，免得每点一个链接多分一屏 */
  private linkLeaf: WorkspaceLeaf | null = null;

  private linkSplit(origin?: WorkspaceLeaf): WorkspaceLeaf {
    let alive = false;
    const prev = this.linkLeaf;
    if (prev && prev !== origin) this.app.workspace.iterateAllLeaves((l) => (alive ||= l === prev));
    if (alive && prev) return prev;
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    this.linkLeaf = leaf;
    return leaf;
  }

  /** 在右侧分屏里打开链接，焦点留在脑图上 */
  private async openInLinkSplit(href: string, sourcePath: string): Promise<void> {
    const origin = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
    const { path, subpath } = parseLinktext(href);
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    // 还没建的笔记：交给 Obsidian 照常处理（它会新建），在新分屏里打开
    if (!file) {
      await this.app.workspace.openLinkText(href, sourcePath, "split");
      return;
    }
    const leaf = this.linkSplit(origin);
    await leaf.openFile(file, { active: false, eState: subpath ? { subpath } : undefined });
    if (origin) this.app.workspace.setActiveLeaf(origin, { focus: true });
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

