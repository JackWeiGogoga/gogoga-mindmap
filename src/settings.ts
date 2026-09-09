import { App, PluginSettingTab, Setting } from "obsidian";
import { STRUCTURES, Structure } from "./layout";
import { MINDMAP_LIST_ICON } from "./icon";
import { THEME_LIST, type ThemeName } from "./theme";
import type MindMapPlugin from "./main";

export interface MindMapSettings {
  defaultStructure: Structure;
  defaultTheme: ThemeName;
  /** 深于此级别的标题节点，新建子节点时改用列表 */
  maxHeadingLevel: number;
  /** 新文件的列表缩进 */
  indent: "tab" | "2" | "4";
  /** 代码块嵌入的最大高度 */
  codeBlockMaxHeight: number;
  /** 脑图视图是否显示大纲面板 */
  outlineOpen: boolean;
  /**
   * 写进 frontmatter `icon` 属性的值，让文件列表显示图标。
   * Notebook Navigator、Iconize 等都读这个属性；留空则不写。
   * 默认是插件自带的 lucide:mindmap-tree；也支持 Lucide 图标名（lucide:network）或 emoji（🧠）。
   */
  listIcon: string;
  /** 工具栏位置：上下为水平条，左右为垂直条 */
  toolbarPosition: ToolbarPosition;
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
export const TOOLBAR_POSITIONS: { id: ToolbarPosition; label: string }[] = [
  { id: "bottom", label: "下方（水平）" },
  { id: "top", label: "上方（水平）" },
  { id: "left", label: "左侧（垂直）" },
  { id: "right", label: "右侧（垂直）" },
];

export const DEFAULT_SETTINGS: MindMapSettings = {
  defaultStructure: "logic-right",
  defaultTheme: "snow",
  maxHeadingLevel: 3,
  indent: "tab",
  codeBlockMaxHeight: 600,
  outlineOpen: false,
  toolbarPosition: "bottom",
  listIcon: MINDMAP_LIST_ICON,
};

export function indentString(s: MindMapSettings["indent"]): string {
  return s === "tab" ? "\t" : " ".repeat(Number(s));
}

export class MindMapSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MindMapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("默认结构")
      .setDesc("新文件的布局。单个文件可在 frontmatter 里用 mindmap-structure 覆盖。")
      .addDropdown((d) =>
        d
          .addOptions(Object.fromEntries(STRUCTURES.map((s) => [s.id, s.label])))
          .setValue(this.plugin.settings.defaultStructure)
          .onChange(async (v) => {
            this.plugin.settings.defaultStructure = v as Structure;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("默认主题")
      .setDesc("新文件用的主题。工具栏的调色盘按钮可以按文件切换，切换结果会写进 mindmap-theme。")
      .addDropdown((d) =>
        d
          .addOptions(Object.fromEntries(THEME_LIST.map((t) => [t.name, t.label])))
          .setValue(this.plugin.settings.defaultTheme)
          .onChange(async (v) => {
            this.plugin.settings.defaultTheme = v as ThemeName;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("标题的最深级别")
      .setDesc("新建节点时，比这更深的层级用列表而不是标题写回。已有内容的写法不受影响。")
      .addDropdown((d) =>
        d
          .addOptions({ "2": "H2（主主题）", "3": "H3", "4": "H4", "5": "H5", "6": "H6" })
          .setValue(String(this.plugin.settings.maxHeadingLevel))
          .onChange(async (v) => {
            this.plugin.settings.maxHeadingLevel = Number(v);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("新文件的列表缩进")
      .setDesc("已有文件会沿用文件里检测到的缩进。")
      .addDropdown((d) =>
        d
          .addOptions({ tab: "Tab", "2": "2 空格", "4": "4 空格" })
          .setValue(this.plugin.settings.indent)
          .onChange(async (v) => {
            this.plugin.settings.indent = v as MindMapSettings["indent"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("文件列表里的图标")
      .setDesc(
        "把这个值写进笔记的 icon 属性，Notebook Navigator、Iconize 等文件列表会据此显示图标。" +
          `默认 ${MINDMAP_LIST_ICON} 是插件自带的脑图图标；也可填 Lucide 图标名（lucide:network）或 emoji（🧠）。留空则不写入。` +
          "只影响之后新建或转换的笔记；已有的用命令「给已有脑图笔记补上列表图标」批量补。",
      )
      .addText((t) =>
        t
          .setPlaceholder(MINDMAP_LIST_ICON)
          .setValue(this.plugin.settings.listIcon)
          .onChange(async (v) => {
            this.plugin.settings.listIcon = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("工具栏位置")
      .setDesc("上下是水平条，左右是垂直条。在工具栏上右键也能切换。")
      .addDropdown((d) =>
        d
          .addOptions(Object.fromEntries(TOOLBAR_POSITIONS.map((p) => [p.id, p.label])))
          .setValue(this.plugin.settings.toolbarPosition)
          .onChange(async (v) => {
            this.plugin.settings.toolbarPosition = v as ToolbarPosition;
            await this.plugin.saveSettings();
            this.plugin.applyToolbarPosition();
          }),
      );

    new Setting(containerEl)
      .setName("链接节点的悬停预览")
      .setDesc("按住 ⌘ / Ctrl 把鼠标停在链接到笔记的节点上，会弹出笔记预览，和 Obsidian 其他地方一致。想不按键就显示，去核心插件「页面预览」的设置里找「思维导图」那一项。");

    new Setting(containerEl)
      .setName("代码块嵌入的最大高度")
      .setDesc("```mindmap 代码块按内容自适应高度，但不超过这个值（像素）。")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.codeBlockMaxHeight)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 120) {
            this.plugin.settings.codeBlockMaxHeight = n;
            await this.plugin.saveSettings();
          }
        }),
      );
  }
}
