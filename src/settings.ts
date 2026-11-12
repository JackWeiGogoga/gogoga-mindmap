import { AbstractInputSuggest, App, Platform, PluginSettingTab, Setting, setIcon, TFile, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { STRUCTURES, Structure } from "./layout";
import { COLOR_NAMES, parseNodeColors } from "./markdown";
import { MINDMAP_LIST_ICON } from "./icon";
import { IconPickerModal, storedValue } from "./icon-picker";
import { displayEmoji, iconIdOf, isEmojiValue } from "./icon-value";
import { t } from "./i18n";
import { themeIds, themeLabel, type ThemeId } from "./theme";
import { newCustomThemeId, type CustomTheme } from "./custom-theme";
import { ConfirmModal, CustomThemeModal, themeFromBase } from "./custom-theme-modal";
import { THEME_LIST, themeShortLabel, type ThemeName } from "./theme";
import type MindMapPlugin from "./main";
import { colorLabel, refreshAllBars, syncNotesExpandedAll, toolIcon } from "./canvas";
import { type ColorKind, createPalette, paintColor, THEME_HIGHLIGHT } from "./color-palette";
import { colorTitle } from "./format-bar";
import { type BarItem, EMBED_TOOLBAR_DEFAULT, encodeLayout, isSep, mergeLayout, moveItem, moveTo, NODEBAR_DEFAULT, sameAsDefault, TOOLBAR_DEFAULT } from "./bar-layout";

/** 嵌入的脑图选了「自定义」就用自己那份按钮清单，否则和打开的脑图一样 */
export function embedToolbarLayout(s: MindMapSettings): BarItem[] {
  return s.embedToolbar === "custom" ? mergeLayout(s.embedToolbarLayout, EMBED_TOOLBAR_DEFAULT) : mergeLayout(s.toolbarLayout, TOOLBAR_DEFAULT);
}

const FUNDING_URL = "https://afdian.com/a/jackweigogoga";

export interface MindMapSettings {
  defaultStructure: Structure;
  defaultTheme: ThemeId;
  customThemes: CustomTheme[];
  /** 深于此级别的标题节点，新建子节点时改用列表 */
  maxHeadingLevel: number;
  /** 新文件的列表缩进 */
  indent: "tab" | "2" | "4";
  /** 代码块嵌入的最大高度 */
  codeBlockMaxHeight: number;
  /** 是否接管 ```mindmap 代码块；关掉就只认 ```gogoga-mindmap，把 mindmap 让给 Markmind 等同名插件 */
  claimMindmapBlock: boolean;
  /** 重新打开 / 切回脑图时恢复上次的视口和选中 */
  rememberViewport: boolean;
  /** 备注默认展开显示在节点下面（默认关：点图标弹窗看） */
  notesExpanded: boolean;
  /** 编辑备注时旁边实时显示渲染效果（分栏预览，默认关） */
  notePreview: boolean;
  /** 编辑节点文字时，选中一段文字弹出格式栏（默认关） */
  formatBar: boolean;
  /** 选中节点时把它平滑移到画布中间（默认关） */
  centerOnSelect: boolean;
  /** 编辑时始终藏起格式标记（默认关） */
  hideSyntax: boolean;
  /** Markdown 笔记的实时预览里藏起颜色、荧光笔、下划线的 HTML 标签，直接显示效果（默认关） */
  hideTagsInNotes: boolean;
  /** Markdown 笔记的实时预览里选中文字浮出格式栏（默认关，只在电脑上） */
  formatBarInNotes: boolean;
  /** 脑图笔记的实时预览、阅读视图里，带颜色的节点文字铺一层同色淡底（默认关） */
  colorsInNotes: boolean;
  /** 脑图笔记的实时预览里，行尾的 %%…%% 节点标记怎么显示：原样、缩成小圆点、完全隐藏（默认原样） */
  markersInNotes: "show" | "dot" | "hide";
  /** 悬停在节点右边缘就能调宽度（默认关） */
  widthHandleOnHover: boolean;
  /** 触屏上的折叠按钮：一直显示（默认）/ 只在选中和已折叠时显示 */
  touchToggles: "always" | "selected";
  /** 新建的节点自带名字「主题1」，不写字也留着（默认关） */
  newNodeName: boolean;
  /** 编辑时开头打「1.」就给这组同级编号（默认开：关着时手打的「1.」写进文件是 `- 1. 文字`，Markdown 里显示不对） */
  numberByTyping: boolean;
  /** 勾上的任务（[x]）在脑图里显示删除线（默认关） */
  strikeDoneTasks: boolean;
  /** 编辑时粘贴网页地址，自动抓网页标题粘成 [标题](网址)（默认关） */
  pasteLinkTitle: boolean;
  /** 删除节点 / 图片后，库里没人再用的图片附件移到回收站（默认关） */
  cleanAttachments: boolean;
  /** 复制节点时去掉 %%…%% 标记（默认关） */
  copyPlain: boolean;
  /** 常用文字颜色、荧光笔颜色（逗号隔开） */
  textColors: string;
  highlightColors: string;
  /** 展开备注的最大高度（像素，随节点字号缩放） */
  noteMaxHeight: number;
  /** 展开备注的最大宽度（像素，随节点字号缩放）；单条拖过大小的不受它限制 */
  noteMaxWidth: number;
  /** 图片拖动调整的最大宽度（像素）：文件里写了更宽的也按它显示 */
  imageMaxWidth: number;
  /** 没设宽度的图片默认显示多宽（像素，高度最多是它的 3/4；中心主题里是它的 4/3） */
  imageThumbWidth: number;
  /** 节点里表格的最大宽度、高度（像素，随节点字号缩放）：超出的在节点里滚动 */
  tableMaxWidth: number;
  tableMaxHeight: number;
  /** 查看备注弹窗拖出来的尺寸，没拖过就按内容自适应 */
  notePopoverSize?: { w: number; h: number };
  /** 脑图视图是否显示大纲面板 */
  outlineOpen: boolean;
  /** 大纲面板里的标题换行显示全文（默认一行，放不下就省略） */
  outlineWrap: boolean;
  /**
   * 写进 frontmatter `icon` 属性的值，让文件列表显示图标。
   * Notebook Navigator、Iconize 等都读这个属性；留空则不写。
   * 默认是插件自带的 lucide:mindmap-tree；也支持 Lucide 图标名（lucide:network）或 emoji（🧠）。
   */
  listIcon: string;
  /** 工具栏位置：上下为水平条，左右为垂直条 */
  toolbarPosition: ToolbarPosition;
  /** 选中节点时显示浮动工具栏 */
  showNodebar: boolean;
  /** 浮动工具栏、主工具栏的按钮顺序和显示（bar-layout.ts）；空数组 = 默认 */
  nodebarLayout: string[];
  toolbarLayout: string[];
  /** 浮动工具栏里的节点颜色（逗号隔开的颜色名或 #色值） */
  nodeColors: string;
  /** 颜色下拉记住的：上次用的文字颜色、荧光笔（色条上那个），三种颜色各自最近使用的（color-palette.ts） */
  colorMemory: { last: Partial<Record<"text" | "bg" | "node", string>>; recent: Partial<Record<"text" | "bg" | "node", string[]>> };
  /** 滚轮行为：pan 平移（Cmd/Ctrl+滚轮缩放），zoom 直接缩放（Shift+滚轮平移） */
  wheelAction: "pan" | "zoom";
  /** 左键拖空白处：pan 平移（Shift+拖框选），select 框选（右键或中键拖平移，XMind 的习惯） */
  leftDrag: "pan" | "select";
  /** 进入编辑节点时：select 全选文字（打字直接替换），end 光标放在末尾 */
  editCaret: "select" | "end";
  /** 点节点、备注里的笔记链接时在哪里打开（⌘ / ⌘⌥ 点照 Obsidian 的习惯，不看这个） */
  linkOpen: "current" | "tab" | "split";
  /** 节点拖到空白处变成自由主题（默认关：拖到空白处是取消） */
  dragToFloat: boolean;
  /** 没有记住的视口时打开脑图：fit 适应画布，center 中心主题 100% */
  openView: "fit" | "center";
  /** 同一文件的脑图和 Markdown 同时显示时，选中和光标互相跟随（默认关） */
  syncSplit: boolean;
  /** 分屏联动定位到折叠着的节点时，把它展开（会改文件里的 %%fold%%，默认关） */
  followExpand: boolean;
  /** Markdown 跟着脑图折叠：编辑器和阅读视图里对应的节点按脑图的折叠状态折起来（默认关） */
  foldFollow: boolean;
  /** 自定义标记（设置里原样存用户填的文字，用时再解析） */
  customMarkers: string;
  customMarkersExclusive: boolean;
  /** 切换成脑图时往 frontmatter 写 mindmap: true，以后都用脑图打开；关掉则只换当前显示 */
  rememberView: boolean;
  /** 新建脑图用的模板笔记路径；留空用内置的「主题 1/2/3」 */
  newFileTemplate: string;
  /** 编辑器里切换笔记时，旁边的脑图跟着显示那篇（默认关） */
  followActiveNote: boolean;
  /** 节点间距、节点字号的百分比，100 为主题原样 */
  spacingScale: number;
  fontScale: number;
  /** 中心主题始终用文件名，唯一的一级标题也只当第一级分支（默认关：一级标题就是中心主题） */
  fileNameAsRoot: boolean;
  /** 笔记的脑图只把标题当节点，列表都算标题的备注（代码块里的脑图不受影响） */
  headingsOnly: boolean;
  /**
   * 嵌入的脑图的工具栏：full 和打开的脑图一样；custom 按 embedToolbarLayout 摆；
   * autohide 阅读模式一直不显示，编辑模式鼠标移上去才显示（0.60 以前的 embedToolbarAutoHide 开关迁过来）
   */
  embedToolbar: "full" | "custom" | "autohide";
  /** 嵌入的脑图选「自定义」时显示哪些按钮、什么顺序（空数组 = 默认：只留「打开 / 编辑」） */
  embedToolbarLayout: string[];
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
export interface SavedViewport {
  tx: number;
  ty: number;
  k: number;
  /** 记下时画布的宽高（旧数据没有） */
  cw?: number;
  ch?: number;
  /** 选中节点的路径 */
  sel: string | null;
  /** 最后一次记录的时间，超出 50 个时淘汰最旧的 */
  at: number;
}
/** label 用 getter：设置页打开时才查字典，跟随界面语言 */
export const TOOLBAR_POSITIONS: { id: ToolbarPosition; readonly label: string }[] = [
  { id: "bottom", get label() { return t("toolbarPos.bottom"); } },
  { id: "top", get label() { return t("toolbarPos.top"); } },
  { id: "left", get label() { return t("toolbarPos.left"); } },
  { id: "right", get label() { return t("toolbarPos.right"); } },
];

/** 默认三种常用颜色：红、蓝、绿；荧光笔带一点透明，暗色主题下浅色文字也看得清 */
/** 默认的节点颜色：内置九种，跟着主题和暗色模式变 */
export const DEFAULT_NODE_COLORS = COLOR_NAMES.join(", ");
export const DEFAULT_TEXT_COLORS = "#e03e3e, #2f80ed, #27ae60";
export const DEFAULT_HIGHLIGHT_COLORS = "#ffd43b99, #69db7c99, #ff8fab99";

export const DEFAULT_SETTINGS: MindMapSettings = {
  defaultStructure: "logic-right",
  defaultTheme: "snow",
  maxHeadingLevel: 3,
  indent: "tab",
  codeBlockMaxHeight: 600,
  claimMindmapBlock: true,
  rememberViewport: true,
  outlineOpen: false,
  outlineWrap: false,
  toolbarPosition: "bottom",
  showNodebar: true,
  nodebarLayout: [],
  toolbarLayout: [],
  nodeColors: DEFAULT_NODE_COLORS,
  colorMemory: { last: {}, recent: {} },
  wheelAction: "pan",
  leftDrag: "pan",
  editCaret: "select",
  linkOpen: "current",
  dragToFloat: false,
  openView: "fit",
  syncSplit: false,
  followExpand: false,
  foldFollow: false,
  customMarkers: "",
  customMarkersExclusive: false,
  rememberView: true,
  newFileTemplate: "",
  embedToolbar: "full",
  embedToolbarLayout: [],
  fileNameAsRoot: false,
  headingsOnly: false,
  followActiveNote: false,
  spacingScale: 100,
  fontScale: 100,
  notesExpanded: false,
  notePreview: false,
  formatBar: false,
  copyPlain: false,
  pasteLinkTitle: false,
  cleanAttachments: false,
  centerOnSelect: false,
  hideSyntax: false,
  hideTagsInNotes: false,
  formatBarInNotes: false,
  colorsInNotes: false,
  markersInNotes: "show",
  widthHandleOnHover: false,
  touchToggles: "always",
  newNodeName: false,
  numberByTyping: true,
  strikeDoneTasks: false,
  textColors: DEFAULT_TEXT_COLORS,
  highlightColors: DEFAULT_HIGHLIGHT_COLORS,
  noteMaxHeight: 240,
  noteMaxWidth: 320,
  imageMaxWidth: 800,
  imageThumbWidth: 240,
  tableMaxWidth: 640,
  tableMaxHeight: 480,
  customThemes: [],
  listIcon: MINDMAP_LIST_ICON,
};

export function indentString(s: MindMapSettings["indent"]): string {
  return s === "tab" ? "\t" : " ".repeat(Number(s));
}

/**
 * Obsidian 1.13 起有声明式设置：插件给一份清单，Obsidian 来画，设置项进全局的设置搜索。
 * 更早的版本没有，就按同一份清单自己逐项画（renderFallback），不维护两份
 */
function declarative(): boolean {
  return "getControlValue" in PluginSettingTab.prototype;
}

type Key = keyof MindMapSettings;
/** 下拉框只认字符串，这几项存的是数字 */
const NUMBER_DROPDOWNS = new Set<string>(["maxHeadingLevel"]);

export class MindMapSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MindMapPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    if (declarative()) {
      super.display();
      return;
    }
    this.containerEl.empty();
    renderFallback(this.containerEl, this.getSettingDefinitions(), this);
  }

  /**
   * 列表变了（自定义主题增删）之后重画。新版用 update()：重新取清单、刷新搜索、只重画当前这一页，
   * 人还停在子页面里；display() 会把子页面画空。旧版没有 update()，整页重画
   */
  private refresh(): void {
    const tab = this as unknown as { update?: () => void };
    if (declarative() && typeof tab.update === "function") tab.update();
    else this.display();
  }

  getControlValue(key: string): unknown {
    const v = (this.plugin.settings as unknown as Record<string, unknown>)[key];
    return NUMBER_DROPDOWNS.has(key) ? String(v) : v;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = NUMBER_DROPDOWNS.has(key) ? Number(value) : value;
    if (key === "rememberViewport" && !value) this.plugin.viewports.clear();
    await this.plugin.saveSettings();
    this.afterChange(key as Key, value);
  }

  /** 改完要立刻生效的设置：重排、重画、挪工具栏…… */
  private afterChange(key: Key, value: unknown): void {
    const p = this.plugin;
    switch (key) {
      case "fileNameAsRoot":
      case "headingsOnly":
        return p.reloadMaps();
      case "notesExpanded":
        return syncNotesExpandedAll();
      case "toolbarPosition":
        return p.applyToolbarPosition();
      case "embedToolbar":
        p.applyEmbedToolbar();
        refreshAllBars();
        // 选不选「自定义」决定这一页下面列不列按钮
        this.refresh();
        return;
      case "outlineWrap":
      case "touchToggles":
        return p.applyEmbedToolbar();
      case "customMarkers":
      case "customMarkersExclusive":
        return p.applyCustomMarkers();
      case "syncSplit":
        return p.updateSplitSyncButtons();
      case "strikeDoneTasks":
        return p.applyDisplayScale(false);
      case "hideTagsInNotes":
      case "formatBarInNotes":
      case "colorsInNotes":
      case "markersInNotes":
        return p.applyNoteTags();
      case "foldFollow":
        if (value) p.syncFolds();
        return;
      default:
        return;
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const toggle = (key: Key, name: string, desc: string, aliases?: string[]): SettingDefinition => ({ name, desc, aliases, control: { type: "toggle", key } });
    const dropdown = (key: Key, name: string, desc: string, options: Record<string, string>, aliases?: string[]): SettingDefinition => ({
      name,
      desc,
      aliases,
      control: { type: "dropdown", key, options },
    });
    const text = (key: Key, name: string, desc: string, placeholder: string, aliases?: string[]): SettingDefinition => ({
      name,
      desc,
      aliases,
      control: { type: "text", key, placeholder },
    });
    const group = (heading: string, items: SettingDefinition[]): SettingDefinitionItem => ({ type: "group", heading, items });
    /** 子页面：入口页一行一个，desc 说里面有什么；displayValue 让人不点进去也看得到当前状态 */
    const page = (name: string, desc: string, items: SettingDefinitionItem[], displayValue?: () => string): SettingDefinitionItem => ({
      type: "page",
      name,
      desc,
      items,
      displayValue,
    });
    const settings = this.plugin.settings;

    return [
      page(
        t("settings.group.open"),
        t("settings.page.open"),
        [
          dropdown("openView", t("settings.openView.name"), t("settings.openView.desc"), { fit: t("settings.openView.fit"), center: t("settings.openView.center") }),
          toggle("rememberViewport", t("settings.rememberViewport.name"), t("settings.rememberViewport.desc")),
          toggle("rememberView", t("settings.rememberView.name"), t("settings.rememberView.desc")),
          dropdown("touchToggles", t("settings.touchToggles.name"), t("settings.touchToggles.desc"), { always: t("settings.touchToggles.always"), selected: t("settings.touchToggles.selected") }, ["fold", "折叠", "按钮", "touch", "手机", "平板"]),
          dropdown("defaultStructure", t("settings.structure.name"), t("settings.structure.desc"), Object.fromEntries(STRUCTURES.map((x) => [x.id, x.label])), ["layout", "布局"]),
          dropdown("defaultTheme", t("settings.theme.name"), t("settings.theme.desc"), Object.fromEntries(themeIds().map((id) => [id, themeLabel(id)])), ["style", "风格", "配色"]),
          this.scaleSetting("spacingScale", t("settings.spacing.name"), t("settings.spacing.desc"), 50, 200),
          this.scaleSetting("fontScale", t("settings.fontScale.name"), t("settings.fontScale.desc"), 70, 150),
          this.sizeSetting("imageThumbWidth", t("settings.imageThumbWidth.name"), t("settings.imageThumbWidth.desc"), 120, 800, t("settings.resetImageThumb")),
          this.sizeSetting("imageMaxWidth", t("settings.imageMaxWidth.name"), t("settings.imageMaxWidth.desc"), 400, 2000, t("settings.resetImageMax")),
        ],
        () => STRUCTURES.find((x) => x.id === settings.defaultStructure)?.label ?? "",
      ),
      page(t("settings.group.edit"), t("settings.page.edit"), [
        dropdown("editCaret", t("settings.editCaret.name"), t("settings.editCaret.desc"), { select: t("settings.editCaret.select"), end: t("settings.editCaret.end") }, ["cursor", "光标"]),
        dropdown("linkOpen", t("settings.linkOpen.name"), t("settings.linkOpen.desc"), { current: t("settings.linkOpen.current"), tab: t("settings.linkOpen.tab"), split: t("settings.linkOpen.split") }, ["link", "链接", "分屏", "split", "打开"]),
        dropdown("wheelAction", t("settings.wheel.name"), t("settings.wheel.desc"), { pan: t("settings.wheel.pan"), zoom: t("settings.wheel.zoom") }, ["scroll", "滚动", "缩放"]),
        dropdown("leftDrag", t("settings.leftDrag.name"), t("settings.leftDrag.desc"), { pan: t("settings.leftDrag.pan"), select: t("settings.leftDrag.select") }, ["marquee", "框选", "平移"]),
        toggle("dragToFloat", t("settings.dragToFloat.name"), t("settings.dragToFloat.desc")),
        toggle("centerOnSelect", t("settings.centerOnSelect.name"), t("settings.centerOnSelect.desc"), ["center", "居中", "跟随"]),
        toggle("hideSyntax", t("settings.hideSyntax.name"), t("settings.hideSyntax.desc"), ["markdown", "bold", "加粗", "荧光笔", "源码"]),
        toggle("widthHandleOnHover", t("settings.widthHandleOnHover.name"), t("settings.widthHandleOnHover.desc"), ["width", "宽度", "手柄"]),
        toggle("newNodeName", t("settings.newNodeName.name"), t("settings.newNodeName.desc"), ["new node", "新建", "默认名字", "主题1"]),
        toggle("numberByTyping", t("settings.autoNumber.name"), t("settings.autoNumber.desc"), ["number", "编号", "序号", "有序列表"]),
        toggle("strikeDoneTasks", t("settings.strikeDoneTasks.name"), t("settings.strikeDoneTasks.desc"), ["task", "任务", "删除线", "strikethrough"]),
        toggle("copyPlain", t("settings.copyPlain.name"), t("settings.copyPlain.desc"), ["clipboard", "剪贴板"]),
        toggle("pasteLinkTitle", t("settings.pasteLinkTitle.name"), t("settings.pasteLinkTitle.desc"), ["link", "url", "链接", "网址"]),
        toggle("cleanAttachments", t("settings.cleanAttachments.name"), t("settings.cleanAttachments.desc"), ["image", "attachment", "delete", "图片", "附件", "删除", "回收站"]),
        { name: t("settings.hover.name"), desc: t("settings.hover.desc", { source: t("hover.display") }), aliases: ["page preview", "页面预览"] },
        group(t("settings.group.markers"), [
          text("customMarkers", t("settings.customMarkers.name"), t("settings.customMarkers.desc"), "🎯 📎 ★ ◆", ["emoji", "icon", "图标"]),
          toggle("customMarkersExclusive", t("settings.customMarkersExclusive.name"), t("settings.customMarkersExclusive.desc")),
        ]),
      ]),
      page(
        t("settings.group.toolbar"),
        t("settings.page.toolbar"),
        [
          dropdown("toolbarPosition", t("settings.toolbar.name"), t("settings.toolbar.desc"), Object.fromEntries(TOOLBAR_POSITIONS.map((x) => [x.id, x.label]))),
          toggle("showNodebar", t("settings.showNodebar.name"), t("settings.showNodebar.desc")),
          this.barLayoutPage("nodebarLayout"),
          this.barLayoutPage("toolbarLayout"),
          this.barLayoutPage("embedToolbarLayout"),
          this.colorListSetting("nodeColors", "node", t("settings.nodeColors.name"), t("settings.nodeColors.desc"), ["palette", "色块", "调色板"]),
          toggle("formatBar", t("settings.formatBar.name"), t("settings.formatBar.desc")),
          this.colorListSetting("textColors", "text", t("settings.textColors.name"), t("settings.textColors.desc"), ["font color", "字体颜色"]),
          this.colorListSetting("highlightColors", "bg", t("settings.highlightColors.name"), t("settings.highlightColors.desc"), ["highlight", "高亮", "背景色"]),
        ],
        () => t("settings.page.colorCount", { n: parseNodeColors(settings.nodeColors).length }),
      ),
      page(t("settings.group.notes"), t("settings.page.notes"), [
        toggle("notesExpanded", t("settings.notesExpanded.name"), t("settings.notesExpanded.desc")),
        this.sizeSetting("noteMaxHeight", t("settings.noteMaxHeight.name"), t("settings.noteMaxHeight.desc"), 120, 800, t("settings.resetNoteHeight")),
        this.sizeSetting("noteMaxWidth", t("settings.noteMaxWidth.name"), t("settings.noteMaxWidth.desc"), 160, 960, t("settings.resetNoteWidth")),
        this.sizeSetting("tableMaxWidth", t("settings.tableMaxWidth.name"), t("settings.tableMaxWidth.desc"), 320, 1600, t("settings.resetTableWidth")),
        this.sizeSetting("tableMaxHeight", t("settings.tableMaxHeight.name"), t("settings.tableMaxHeight.desc"), 160, 1200, t("settings.resetTableHeight")),
        toggle("notePreview", t("settings.notePreview.name"), t("settings.notePreview.desc")),
      ]),
      page(t("settings.group.markdown"), t("settings.page.markdown"), [
        group(t("settings.group.parse"), [
          toggle("headingsOnly", t("settings.headingsOnly.name"), t("settings.headingsOnly.desc")),
          dropdown("maxHeadingLevel", t("settings.headingLevel.name"), t("settings.headingLevel.desc"), { "2": t("settings.headingLevel.h2"), "3": "H3", "4": "H4", "5": "H5", "6": "H6" }),
        ]),
        group(t("settings.group.sync"), [
          toggle("syncSplit", t("settings.syncSplit.name"), t("settings.syncSplit.desc"), ["split", "分屏", "联动"]),
          toggle("followExpand", t("settings.followExpand.name"), t("settings.followExpand.desc")),
          toggle("foldFollow", t("settings.foldFollow.name"), t("settings.foldFollow.desc"), ["fold", "折叠"]),
          toggle("followActiveNote", t("settings.followActive.name"), t("settings.followActive.desc"), ["sidebar", "侧边栏"]),
          toggle("outlineWrap", t("settings.outlineWrap.name"), t("settings.outlineWrap.desc"), ["outline", "大纲"]),
        ]),
        group(t("settings.group.noteDisplay"), [
          toggle("hideTagsInNotes", t("settings.hideTagsInNotes.name"), t("settings.hideTagsInNotes.desc"), ["html", "span", "mark", "标签", "下划线", "underline", "颜色"]),
          toggle("colorsInNotes", t("settings.colorsInNotes.name"), t("settings.colorsInNotes.desc"), ["color", "颜色", "背景", "底色", "节点颜色"]),
          ...(Platform.isMobile ? [] : [toggle("formatBarInNotes", t("settings.formatBarInNotes.name"), t("settings.formatBarInNotes.desc"), ["format", "toolbar", "格式栏", "工具栏", "颜色", "荧光笔", "加粗"])]),
          dropdown(
            "markersInNotes",
            t("settings.markersInNotes.name"),
            t("settings.markersInNotes.desc"),
            { show: t("settings.markersInNotes.show"), dot: t("settings.markersInNotes.dot"), hide: t("settings.markersInNotes.hide") },
            ["%%", "marker", "comment", "标记", "注释", "隐藏"],
          ),
        ]),
        group(t("settings.group.embed"), [
          toggle("claimMindmapBlock", t("settings.claimBlock.name"), t("settings.claimBlock.desc"), ["code block", "代码块"]),
          {
            name: t("settings.codeBlockHeight.name"),
            desc: t("settings.codeBlockHeight.desc"),
            control: { type: "number", key: "codeBlockMaxHeight", min: 120, validate: (v) => (Number.isFinite(v) && v >= 120 ? undefined : "≥ 120") },
          },
        ]),
      ]),
      page(t("settings.group.newMap"), t("settings.page.newMap"), [
        this.templateSetting(),
        dropdown("indent", t("settings.indent.name"), t("settings.indent.desc"), {
          tab: t("settings.indent.tab"),
          "2": t("settings.indent.spaces", { n: 2 }),
          "4": t("settings.indent.spaces", { n: 4 }),
        }),
        toggle("fileNameAsRoot", t("settings.fileNameAsRoot.name"), t("settings.fileNameAsRoot.desc")),
        this.listIconSetting(),
      ]),
      this.customThemesPage(),
      {
        name: t("settings.support.name"),
        desc: t("settings.support.desc"),
        render: (setting) => {
          setting.addButton((b) => b.setButtonText(t("settings.support.button")).onClick(() => window.open(FUNDING_URL)));
        },
      },
    ];
  }

  /** 节点间距、字号：滑块加一个恢复 100% 的按钮（声明式的滑块没有按钮，自己画） */
  private scaleSetting(key: "spacingScale" | "fontScale", name: string, desc: string, min: number, max: number): SettingDefinition {
    return this.sliderWithReset(key, name, desc, min, max, 5, 100, t("settings.reset"), () => this.plugin.applyDisplayScale());
  }

  /**
   * 颜色清单（节点颜色、常用文字颜色、常用荧光笔颜色）：一排色块，点色块打开色板换颜色，× 删除，拖动调顺序，+ 新增；
   * 「直接写色值」切换成原来的文本框（颜色名、🔴、rgba() 这些也能直接写）。存的还是逗号隔开的字符串，和以前一样
   */
  private colorListSetting(key: "nodeColors" | "textColors" | "highlightColors", kind: ColorKind, name: string, desc: string, aliases: string[]): SettingDefinition {
    const plugin = this.plugin;
    const fallback = key === "nodeColors" ? DEFAULT_NODE_COLORS : key === "textColors" ? DEFAULT_TEXT_COLORS : DEFAULT_HIGHLIGHT_COLORS;
    const read = () =>
      plugin.settings[key]
        .split(/[,，\s]+(?![^(]*\))/)
        .map((x) => x.trim())
        .filter(Boolean);
    const save = async (list: string[]) => {
      plugin.settings[key] = list.join(", ");
      await plugin.saveSettings();
      refreshAllBars();
    };
    const label = (c: string) => (kind === "node" ? colorLabel(c) : colorTitle(c));
    let raw = false;
    return {
      name,
      desc,
      aliases,
      render: (setting) => {
        const ctl = setting.controlEl;
        const draw = () => {
          ctl.empty();
          ctl.addClass("mm-color-list-ctl");
          if (raw) {
            const input = ctl.createEl("input", { type: "text", cls: "mm-color-list-raw" });
            input.value = plugin.settings[key];
            input.placeholder = fallback;
            input.addEventListener("change", () => {
              plugin.settings[key] = input.value;
              void plugin.saveSettings().then(() => refreshAllBars());
            });
          } else {
            const list = read();
            const row = ctl.createDiv({ cls: "mm-color-list" });
            let dragFrom = -1;
            list.forEach((c, i) => {
              const chip = row.createDiv({ cls: "mm-color-chip" });
              chip.draggable = true;
              chip.setAttr("aria-label", label(c));
              const sw = chip.createSpan({ cls: "mm-color-chip-swatch" });
              paintColor(sw, c, kind);
              chip.createSpan({ cls: "mm-color-chip-name", text: label(c) });
              const x = chip.createSpan({ cls: "mm-color-chip-x" });
              setIcon(x, "x");
              x.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const next = read();
                next.splice(i, 1);
                void save(next).then(draw);
              });
              chip.addEventListener("click", () =>
                openPalette(chip, (picked) => {
                  const next = read();
                  if (picked === null) next.splice(i, 1);
                  else next[i] = picked;
                  void save(next).then(draw);
                }),
              );
              chip.addEventListener("dragstart", () => (dragFrom = i));
              chip.addEventListener("dragover", (ev) => ev.preventDefault());
              chip.addEventListener("drop", (ev) => {
                ev.preventDefault();
                if (dragFrom < 0 || dragFrom === i) return;
                const next = read();
                const [moved] = next.splice(dragFrom, 1);
                next.splice(i, 0, moved);
                dragFrom = -1;
                void save(next).then(draw);
              });
            });
            const add = row.createEl("button", { cls: "mm-color-list-add" });
            setIcon(add, "plus");
            add.setAttr("aria-label", t("settings.colorAdd"));
            add.addEventListener("click", () =>
              openPalette(add, (picked) => {
                if (picked === null) return;
                void save([...read(), picked]).then(draw);
              }),
            );
          }
          const toggleRaw = ctl.createEl("a", { cls: "mm-color-list-mode", text: raw ? t("settings.colorChips") : t("settings.colorRaw") });
          toggleRaw.addEventListener("click", () => {
            raw = !raw;
            draw();
          });
        };
        /** 设置页里的色板：挂在 body 上，点外面关掉 */
        const openPalette = (anchor: HTMLElement, done: (c: string | null) => void) => {
          const doc = anchor.ownerDocument;
          doc.querySelectorAll(".mm-settings-palette").forEach((e) => e.remove());
          const pal = createPalette(doc, {
            common: kind === "node" ? [...COLOR_NAMES] : kind === "bg" ? ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣"] : [],
            recent: plugin.colorMemory.recent(kind),
            alpha: kind !== "node",
            defaultAlpha: kind === "bg" ? 60 : 100,
            paint: (b, c) => paintColor(b, c, kind),
            label,
            noneLabel: t("settings.colorRemove"),
            extras: kind === "bg" ? [{ value: THEME_HIGHLIGHT, label: t("palette.themeHighlight"), paint: (b) => paintColor(b, THEME_HIGHLIGHT, "bg") }] : [],
            onPick: (c) => {
              close();
              done(c);
            },
          });
          pal.addClass("mm-settings-palette");
          doc.body.append(pal);
          const r = anchor.getBoundingClientRect();
          const win = doc.defaultView ?? window;
          pal.style.left = `${Math.max(8, Math.min(win.innerWidth - pal.offsetWidth - 8, r.left))}px`;
          const below = r.bottom + 6;
          pal.style.top = `${below + pal.offsetHeight < win.innerHeight - 8 ? below : Math.max(8, r.top - pal.offsetHeight - 6)}px`;
          const onDown = (ev: PointerEvent) => {
            if (!pal.contains(ev.target as Node)) close();
          };
          const close = () => {
            pal.remove();
            doc.removeEventListener("pointerdown", onDown, true);
          };
          doc.addEventListener("pointerdown", onDown, true);
        };
        draw();
      },
    };
  }

  /**
   * 浮动工具栏 / 主工具栏的按钮：一个子页面，一行一个按钮（图标、名字、开关、上移下移），最上面「恢复默认」。
   * 改了马上存、所有打开着的脑图重建工具栏
   */
  private barLayoutPage(key: "nodebarLayout" | "toolbarLayout" | "embedToolbarLayout"): SettingDefinitionItem {
    const plugin = this.plugin;
    const defaults = key === "nodebarLayout" ? NODEBAR_DEFAULT : key === "toolbarLayout" ? TOOLBAR_DEFAULT : EMBED_TOOLBAR_DEFAULT;
    const embed = key === "embedToolbarLayout";
    const items = () => mergeLayout(plugin.settings[key], defaults);
    const save = async (next: BarItem[]) => {
      plugin.settings[key] = sameAsDefault(next, defaults) ? [] : encodeLayout(next);
      await plugin.saveSettings();
      refreshAllBars();
      this.refresh();
    };
    const ICON: Record<string, string> = { embed: "open", colors: "palette", highlight: "highlighter", moveUp: "up", moveDown: "down", zoomOut: "minus", zoomIn: "plus", notes: "note", hidden: "hiddenNodes" };
    const list = items();
    const at = (id: string) => items().findIndex((x) => x.id === id);
    const rows: SettingDefinition[] = list.map((item, i) => ({
      name: isSep(item.id) ? t("bar.sep") : t(`bar.${item.id}` as Parameters<typeof t>[0]),
      desc: isSep(item.id) ? t("bar.sepDesc") : item.id === "embed" ? t("bar.embedDesc") : "",
      aliases: ["toolbar", "button", "工具栏", "按钮"],
      render: (setting) => {
        const name = ICON[item.id] ?? item.id;
        // Obsidian 重画设置页时会沿用同一个行元素再调一次 render：先把上次加的图标、把手去掉，免得越加越多
        setting.settingEl.querySelectorAll(".mm-setting-bar-grip, .mm-setting-bar-icon").forEach((e) => e.remove());
        if (!isSep(item.id) && item.id !== "zoom") {
          const ic = toolIcon(name);
          ic.addClass("mm-setting-bar-icon");
          setting.nameEl.prepend(ic);
        }
        setting.settingEl.toggleClass("mm-setting-bar-off", !item.on);
        // 拖动把手：按住拖到别的位置。只在这一页里（整张清单都在同一个容器里）能拖，设置搜索结果里只留箭头
        setting.settingEl.addClass("mm-setting-bar-row");
        setting.settingEl.dataset.mmBar = key;
        setting.settingEl.dataset.mmId = item.id;
        const grip = setting.settingEl.createDiv({ cls: "mm-setting-bar-grip" });
        setIcon(grip, "grip-vertical");
        // 不挂 aria-label：Obsidian 会给它弹提示，拖动时提示跟不上、还挡着；怎么拖写在这一页最上面的说明里
        setting.settingEl.prepend(grip);
        // 画完挂上去以后看一眼：清单不全（设置搜索结果里）就不显示把手
        window.requestAnimationFrame(() => {
          const sib = setting.settingEl.parentElement?.querySelectorAll(`:scope > .mm-setting-bar-row[data-mm-bar="${key}"]`).length ?? 0;
          grip.toggleClass("is-hidden", sib !== list.length);
        });
        grip.addEventListener("pointerdown", (ev) => dragRow(ev, setting.settingEl, key, list.length, (fromId, toId) => void save(moveTo(items(), at(fromId), at(toId)))));
        setting
          .addExtraButton((b) =>
            b
              .setIcon("arrow-up")
              .setTooltip(t("bar.moveUp"))
              .setDisabled(i === 0)
              .onClick(() => void save(moveItem(items(), at(item.id), -1))),
          )
          .addExtraButton((b) =>
            b
              .setIcon("arrow-down")
              .setTooltip(t("bar.moveDown"))
              .setDisabled(i === list.length - 1)
              .onClick(() => void save(moveItem(items(), at(item.id), 1))),
          )
          .addToggle((tg) =>
            tg.setValue(item.on).onChange((v) => {
              // 按 id 在最新的设置里找（页面刷新后各行的回调可能还是旧的）
              const next = items();
              const j = at(item.id);
              if (j >= 0) next[j] = { ...next[j], on: v };
              void save(next);
            }),
          );
      },
    }));
    const reset: SettingDefinition = {
      name: t("bar.reset"),
      desc: t(key === "nodebarLayout" ? "bar.nodebarDesc" : "bar.toolbarDesc"),
      render: (setting) => {
        setting.addButton((b) =>
          b
            .setButtonText(t("bar.resetButton"))
            .setDisabled(!plugin.settings[key].length)
            .onClick(() => void save(mergeLayout(undefined, defaults))),
        );
      },
    };
    const count = () => {
      const all = items().filter((x) => !isSep(x.id));
      return t("bar.count", { n: all.filter((x) => x.on).length, total: all.length });
    };
    if (!embed) {
      return {
        type: "page",
        name: t(key === "nodebarLayout" ? "bar.nodebarPage" : "bar.toolbarPage"),
        desc: t(key === "nodebarLayout" ? "bar.nodebarPageDesc" : "bar.toolbarPageDesc"),
        displayValue: count,
        items: [reset, ...rows],
      };
    }
    // 嵌入的脑图：最上面先选完整 / 自定义 / 自动隐藏，选了自定义才列按钮
    const modes = { full: t("settings.embedToolbar.full"), custom: t("settings.embedToolbar.custom"), autohide: t("settings.embedToolbar.autohide") };
    const mode: SettingDefinition = {
      name: t("settings.embedToolbar.name"),
      desc: t("settings.embedToolbar.desc"),
      aliases: ["embed", "嵌入", "简洁", "隐藏", "toolbar", "工具栏"],
      control: { type: "dropdown", key: "embedToolbar", options: modes },
    };
    return {
      type: "page",
      name: t("bar.embedPage"),
      desc: t("bar.embedPageDesc"),
      displayValue: () => (plugin.settings.embedToolbar === "custom" ? `${modes.custom} · ${count()}` : modes[plugin.settings.embedToolbar]),
      items: plugin.settings.embedToolbar === "custom" ? [mode, reset, ...rows] : [mode],
    };
  }

  private sizeSetting(key: "noteMaxHeight" | "noteMaxWidth" | "tableMaxWidth" | "tableMaxHeight" | "imageMaxWidth" | "imageThumbWidth", name: string, desc: string, min: number, max: number, resetTip: string): SettingDefinition {
    return this.sliderWithReset(key, name, desc, min, max, 20, DEFAULT_SETTINGS[key], resetTip, () => this.plugin.applyDisplayScale());
  }

  private sliderWithReset(
    key: "spacingScale" | "fontScale" | "noteMaxHeight" | "noteMaxWidth" | "tableMaxWidth" | "tableMaxHeight" | "imageMaxWidth" | "imageThumbWidth",
    name: string,
    desc: string,
    min: number,
    max: number,
    step: number,
    reset: number,
    resetTip: string,
    apply: () => void,
  ): SettingDefinition {
    return {
      name,
      desc,
      render: (setting) => {
        let slider: { setValue(v: number): unknown } | null = null;
        setting
          .addSlider((s) => {
            slider = s;
            s.setLimits(min, max, step)
              .setValue(this.plugin.settings[key])
              .onChange(async (v) => {
                this.plugin.settings[key] = v;
                await this.plugin.saveSettings();
                apply();
              });
          })
          .addExtraButton((b) =>
            b
              .setIcon("rotate-ccw")
              .setTooltip(resetTip)
              .onClick(async () => {
                this.plugin.settings[key] = reset;
                slider?.setValue(reset);
                await this.plugin.saveSettings();
                apply();
              }),
          );
      },
    };
  }

  /** 模板：文字框带笔记补全 */
  private templateSetting(): SettingDefinition {
    return {
      name: t("settings.template.name"),
      desc: t("settings.template.desc"),
      render: (setting) => {
        setting.addText((text) => {
          text
            .setPlaceholder(t("settings.template.placeholder"))
            .setValue(this.plugin.settings.newFileTemplate)
            .onChange(async (v) => {
              this.plugin.settings.newFileTemplate = v.trim();
              await this.plugin.saveSettings();
            });
          new NoteSuggest(this.app, text.inputEl);
        });
      },
    };
  }

  /** 文件列表里的图标：预览 + 选择 / 恢复默认 / 去掉 */
  private listIconSetting(): SettingDefinition {
    return {
      name: t("settings.listIcon.name"),
      desc: t("settings.listIcon.desc", { command: t("command.addListIcons") }),
      aliases: ["icon", "图标"],
      render: (setting) => {
        const preview = setting.controlEl.createSpan({ cls: "mm-setting-icon-preview" });
        const label = setting.controlEl.createSpan({ cls: "mm-setting-icon-value" });
        const refresh = () => {
          const v = this.plugin.settings.listIcon;
          preview.empty();
          preview.toggleClass("is-emoji", isEmojiValue(v));
          if (!v) {
            label.setText(t("settings.listIcon.none"));
            return;
          }
          if (isEmojiValue(v)) preview.setText(displayEmoji(v));
          else {
            const id = iconIdOf(v);
            if (id) setIcon(preview, id);
          }
          label.setText(v);
        };
        refresh();
        const set = async (v: string) => {
          this.plugin.settings.listIcon = v;
          await this.plugin.saveSettings();
          refresh();
        };
        setting
          .addButton((b) =>
            b
              .setButtonText(t("settings.listIcon.choose"))
              .setCta()
              .onClick(() => {
                new IconPickerModal(this.app, (pick) => {
                  if (pick) void set(storedValue(pick));
                }).open();
              }),
          )
          .addExtraButton((b) =>
            b
              .setIcon("rotate-ccw")
              .setTooltip(t("settings.listIcon.reset"))
              .onClick(() => void set(MINDMAP_LIST_ICON)),
          )
          .addExtraButton((b) =>
            b
              .setIcon("x")
              .setTooltip(t("settings.listIcon.clear"))
              .onClick(() => void set("")),
          );
      },
    };
  }

  /** 自定义主题：一个子页面，列表（编辑 / 复制 / 删除）+ 选基础主题新建 */
  private customThemesPage(): SettingDefinitionItem {
    const plugin = this.plugin;
    const save = async (theme: CustomTheme) => {
      const list = plugin.settings.customThemes;
      const i = list.findIndex((x) => x.id === theme.id);
      if (i >= 0) list[i] = theme;
      else list.push(theme);
      await plugin.saveSettings();
      plugin.applyCustomThemes();
      this.refresh();
    };
    const rows: SettingDefinition[] = plugin.settings.customThemes.map((theme) => ({
      name: theme.name,
      desc: t("customTheme.basedOn", { base: themeShortLabel(theme.base) }),
      render: (setting) => {
        setting
          .addButton((b) => b.setButtonText(t("customTheme.edit")).onClick(() => new CustomThemeModal(this.app, plugin, theme, (x) => void save(x)).open()))
          .addButton((b) =>
            b.setButtonText(t("customTheme.duplicate")).onClick(() => {
              const copy = { ...structuredClone(theme), id: newCustomThemeId(), name: t("customTheme.copyName", { name: theme.name }) };
              void save(copy);
            }),
          )
          .addExtraButton((b) =>
            b
              .setIcon("trash")
              .setTooltip(t("customTheme.delete"))
              .onClick(() =>
                new ConfirmModal(this.app, t("customTheme.deleteConfirm", { name: theme.name }), () => {
                  plugin.settings.customThemes = plugin.settings.customThemes.filter((x) => x.id !== theme.id);
                  if (plugin.settings.defaultTheme === theme.id) plugin.settings.defaultTheme = "snow";
                  void plugin.saveSettings().then(() => {
                    plugin.applyCustomThemes();
                    this.refresh();
                  });
                }).open(),
              ),
          );
      },
    }));
    let base: ThemeName = "snow";
    rows.push({
      name: t("customTheme.new"),
      desc: t("customTheme.newDesc"),
      render: (setting) => {
        setting
          .addDropdown((d) =>
            d
              .addOptions(Object.fromEntries(THEME_LIST.map((th) => [th.name, themeShortLabel(th.name)])))
              .setValue(base)
              .onChange((v) => (base = v as ThemeName)),
          )
          .addButton((b) =>
            b
              .setButtonText(t("customTheme.create"))
              .setCta()
              .onClick(() => {
                const name = t("customTheme.defaultName", { n: plugin.settings.customThemes.length + 1 });
                new CustomThemeModal(this.app, plugin, themeFromBase(base, name, newCustomThemeId()), (x) => void save(x)).open();
              }),
          );
      },
    });
    return {
      type: "page",
      name: t("customTheme.heading"),
      desc: t("settings.customThemes.desc"),
      displayValue: () => t("settings.page.themeCount", { n: plugin.settings.customThemes.length }),
      items: rows,
    };
  }
}

/**
 * 旧版 Obsidian（没有声明式设置）：按清单逐项画。分组画成小标题，子页面就地展开；
 * 控件只有清单里用到的几种（开关、下拉、文字、数字），其余是 render 自己画
 */
function renderFallback(el: HTMLElement, items: readonly unknown[], tab: MindMapSettingTab): void {
  for (const raw of items) {
    const item = raw as SettingDefinitionItem;
    if ("type" in item && (item.type === "group" || item.type === "list" || item.type === "page")) {
      const heading = item.type === "page" ? item.name : item.heading;
      if (heading) new Setting(el).setName(heading).setHeading();
      renderFallback(el, item.items ?? [], tab);
      continue;
    }
    const def = item as SettingDefinition;
    const setting = new Setting(el).setName(def.name);
    if (def.desc) setting.setDesc(def.desc);
    if (def.render) {
      def.render(setting, undefined as never);
      continue;
    }
    const c = def.control;
    if (!c) continue;
    const value = tab.getControlValue(c.key);
    const set = (v: unknown) => void tab.setControlValue(c.key, v);
    switch (c.type) {
      case "toggle":
        setting.addToggle((tg) => tg.setValue(Boolean(value)).onChange(set));
        break;
      case "dropdown":
        setting.addDropdown((d) => d.addOptions(c.options).setValue(String(value)).onChange(set));
        break;
      case "text":
        setting.addText((tx) => tx.setPlaceholder(c.placeholder ?? "").setValue(typeof value === "string" ? value : "").onChange(set));
        break;
      case "number":
        setting.addText((tx) => {
          tx.inputEl.type = "number";
          tx.setValue(String(value)).onChange((v) => {
            const n = Number(v);
            if (!c.validate || !c.validate(n)) set(n);
          });
        });
        break;
      default:
        break;
    }
  }
}

/** 设置里选模板笔记：输入时列出名字或路径匹配的 Markdown 笔记 */
class NoteSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, private input: HTMLInputElement) {
    super(app, input);
  }

  getSuggestions(query: string): TFile[] {
    const q = query.trim().toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.setValue(file.path);
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

/**
 * 拖动工具栏按钮那几行：按住把手，这一行跟着指针走，别的行让位；松手按新位置存。
 * 用指针事件自己做（手机上手指也能拖）；拖到设置窗口上下边缘时自动滚动
 */
function dragRow(ev: PointerEvent, row: HTMLElement, key: string, total: number, done: (fromId: string, toId: string) => void): void {
  const parent = row.parentElement;
  if (!parent || ev.button !== 0) return;
  const rows = [...parent.querySelectorAll<HTMLElement>(`:scope > .mm-setting-bar-row[data-mm-bar="${key}"]`)];
  // 设置搜索结果里清单不全：不拖
  if (rows.length !== total) return;
  ev.preventDefault();
  const from = rows.indexOf(row);
  if (from < 0) return;
  const grip = ev.currentTarget as HTMLElement;
  grip.setPointerCapture(ev.pointerId);
  const win = row.win;
  let scroller: HTMLElement | null = parent;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(win.getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
  // 开始拖时每行中线的位置（视口坐标）；滚动了多少另算
  const mids = rows.map((r) => {
    const b = r.getBoundingClientRect();
    return b.top + b.height / 2;
  });
  const startY = ev.clientY;
  const startScroll = scroller?.scrollTop ?? 0;
  const h = row.getBoundingClientRect().height;
  let to = from;
  let lastY = ev.clientY;
  let raf = 0;
  row.addClass("is-dragging");
  for (const r of rows) if (r !== row) r.addClass("is-drag-sibling");
  const place = () => {
    const ds = (scroller?.scrollTop ?? 0) - startScroll;
    // 拖着的这一行跟着指针（滚动时内容往上走，它要补回来）
    row.setCssStyles({ transform: `translateY(${lastY - startY + ds}px)` });
    const mid = mids[from] + lastY - startY;
    // 新位置 = 别的行里中线在它上面的有几行
    to = mids.filter((m, j) => j !== from && m - ds < mid).length;
    rows.forEach((r, j) => {
      if (j === from) return;
      const shift = from < to && j > from && j <= to ? -h : to < from && j >= to && j < from ? h : 0;
      r.setCssStyles({ transform: shift ? `translateY(${shift}px)` : "" });
    });
  };
  const tick = () => {
    raf = 0;
    if (!scroller) return;
    const b = scroller.getBoundingClientRect();
    const edge = 40;
    const v = lastY < b.top + edge ? -(b.top + edge - lastY) / 3 : lastY > b.bottom - edge ? (lastY - (b.bottom - edge)) / 3 : 0;
    if (!v) return;
    scroller.scrollTop += v;
    place();
    raf = win.requestAnimationFrame(tick);
  };
  const move = (e: PointerEvent) => {
    lastY = e.clientY;
    place();
    if (!raf) raf = win.requestAnimationFrame(tick);
  };
  const end = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    if (raf) win.cancelAnimationFrame(raf);
    for (const r of rows) {
      r.setCssStyles({ transform: "" });
      r.removeClass("is-dragging", "is-drag-sibling");
    }
    // 交出去的是 id：拖到的位置上原来是哪一项
    if (to !== from) done(rows[from].dataset.mmId ?? "", rows[to].dataset.mmId ?? "");
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}
