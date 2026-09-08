import { App, PluginSettingTab, Setting } from "obsidian";
import { STRUCTURES, Structure } from "./layout";
import type { ThemeName } from "./theme";
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
}

export const DEFAULT_SETTINGS: MindMapSettings = {
  defaultStructure: "logic-right",
  defaultTheme: "snow",
  maxHeadingLevel: 3,
  indent: "tab",
  codeBlockMaxHeight: 600,
  outlineOpen: false,
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
      .setDesc("snow：深色中心主题、灰色节点、折线；rainbow：彩虹分支、曲线。单个文件可用 mindmap-theme 覆盖。")
      .addDropdown((d) =>
        d
          .addOptions({ snow: "snow", rainbow: "rainbow" })
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
