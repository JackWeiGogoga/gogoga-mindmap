import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import { STRUCTURES, Structure } from "./layout";
import { MINDMAP_LIST_ICON } from "./icon";
import { IconPickerModal, storedValue } from "./icon-picker";
import { displayEmoji, iconIdOf, isEmojiValue } from "./icon-value";
import { t } from "./i18n";
import { themeIds, themeLabel, type ThemeId } from "./theme";
import { newCustomThemeId, type CustomTheme } from "./custom-theme";
import { ConfirmModal, CustomThemeModal, themeFromBase } from "./custom-theme-modal";
import { THEME_LIST, themeShortLabel, type ThemeName } from "./theme";
import type MindMapPlugin from "./main";

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
  /** 查看备注弹窗拖出来的尺寸，没拖过就按内容自适应 */
  notePopoverSize?: { w: number; h: number };
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
  /** 滚轮行为：pan 平移（Cmd/Ctrl+滚轮缩放），zoom 直接缩放（Shift+滚轮平移） */
  wheelAction: "pan" | "zoom";
  /** 左键拖空白处：pan 平移（Shift+拖框选），select 框选（右键或中键拖平移，XMind 的习惯） */
  leftDrag: "pan" | "select";
  /** 切换成脑图时往 frontmatter 写 mindmap: true，以后都用脑图打开；关掉则只换当前显示 */
  rememberView: boolean;
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
/** label 用 getter：设置页打开时才查字典，跟随界面语言 */
export const TOOLBAR_POSITIONS: { id: ToolbarPosition; readonly label: string }[] = [
  { id: "bottom", get label() { return t("toolbarPos.bottom"); } },
  { id: "top", get label() { return t("toolbarPos.top"); } },
  { id: "left", get label() { return t("toolbarPos.left"); } },
  { id: "right", get label() { return t("toolbarPos.right"); } },
];

export const DEFAULT_SETTINGS: MindMapSettings = {
  defaultStructure: "logic-right",
  defaultTheme: "snow",
  maxHeadingLevel: 3,
  indent: "tab",
  codeBlockMaxHeight: 600,
  claimMindmapBlock: true,
  outlineOpen: false,
  toolbarPosition: "bottom",
  wheelAction: "pan",
  leftDrag: "pan",
  rememberView: true,
  customThemes: [],
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
      .setName(t("settings.rememberView.name"))
      .setDesc(t("settings.rememberView.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.rememberView).onChange(async (v) => {
          this.plugin.settings.rememberView = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.structure.name"))
      .setDesc(t("settings.structure.desc"))
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
      .setName(t("settings.theme.name"))
      .setDesc(t("settings.theme.desc"))
      .addDropdown((d) =>
        d
          .addOptions(Object.fromEntries(themeIds().map((id) => [id, themeLabel(id)])))
          .setValue(this.plugin.settings.defaultTheme)
          .onChange(async (v) => {
            this.plugin.settings.defaultTheme = v as ThemeId;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.headingLevel.name"))
      .setDesc(t("settings.headingLevel.desc"))
      .addDropdown((d) =>
        d
          .addOptions({ "2": t("settings.headingLevel.h2"), "3": "H3", "4": "H4", "5": "H5", "6": "H6" })
          .setValue(String(this.plugin.settings.maxHeadingLevel))
          .onChange(async (v) => {
            this.plugin.settings.maxHeadingLevel = Number(v);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.indent.name"))
      .setDesc(t("settings.indent.desc"))
      .addDropdown((d) =>
        d
          .addOptions({ tab: t("settings.indent.tab"), "2": t("settings.indent.spaces", { n: 2 }), "4": t("settings.indent.spaces", { n: 4 }) })
          .setValue(this.plugin.settings.indent)
          .onChange(async (v) => {
            this.plugin.settings.indent = v as MindMapSettings["indent"];
            await this.plugin.saveSettings();
          }),
      );

    const iconSetting = new Setting(containerEl)
      .setName(t("settings.listIcon.name"))
      .setDesc(t("settings.listIcon.desc", { command: t("command.addListIcons") }));

    const preview = iconSetting.controlEl.createSpan({ cls: "mm-setting-icon-preview" });
    const label = iconSetting.controlEl.createSpan({ cls: "mm-setting-icon-value" });
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

    iconSetting
      .addButton((b) =>
        b
          .setButtonText(t("settings.listIcon.choose"))
          .setCta()
          .onClick(() => {
            new IconPickerModal(this.app, (pick) => {
              if (!pick) return;
              void (async () => {
                this.plugin.settings.listIcon = storedValue(pick);
                await this.plugin.saveSettings();
                refresh();
              })();
            }).open();
          }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip(t("settings.listIcon.reset"))
          .onClick(async () => {
            this.plugin.settings.listIcon = MINDMAP_LIST_ICON;
            await this.plugin.saveSettings();
            refresh();
          }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("x")
          .setTooltip(t("settings.listIcon.clear"))
          .onClick(async () => {
            this.plugin.settings.listIcon = "";
            await this.plugin.saveSettings();
            refresh();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.toolbar.name"))
      .setDesc(t("settings.toolbar.desc"))
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
      .setName(t("settings.wheel.name"))
      .setDesc(t("settings.wheel.desc"))
      .addDropdown((d) =>
        d
          .addOptions({ pan: t("settings.wheel.pan"), zoom: t("settings.wheel.zoom") })
          .setValue(this.plugin.settings.wheelAction)
          .onChange(async (v) => {
            this.plugin.settings.wheelAction = v as MindMapSettings["wheelAction"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.leftDrag.name"))
      .setDesc(t("settings.leftDrag.desc"))
      .addDropdown((d) =>
        d
          .addOptions({ pan: t("settings.leftDrag.pan"), select: t("settings.leftDrag.select") })
          .setValue(this.plugin.settings.leftDrag)
          .onChange(async (v) => {
            this.plugin.settings.leftDrag = v as MindMapSettings["leftDrag"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.hover.name"))
      .setDesc(t("settings.hover.desc", { source: t("hover.display") }));

    new Setting(containerEl)
      .setName(t("settings.codeBlockHeight.name"))
      .setDesc(t("settings.codeBlockHeight.desc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.codeBlockMaxHeight)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 120) {
            this.plugin.settings.codeBlockMaxHeight = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.claimBlock.name"))
      .setDesc(t("settings.claimBlock.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.claimMindmapBlock).onChange(async (v) => {
          this.plugin.settings.claimMindmapBlock = v;
          await this.plugin.saveSettings();
        }),
      );

    this.renderCustomThemes(containerEl);

    new Setting(containerEl)
      .setName(t("settings.support.name"))
      .setDesc(t("settings.support.desc"))
      .addButton((b) =>
        b.setButtonText(t("settings.support.button")).onClick(() => {
          window.open(FUNDING_URL);
        }),
      );
  }

  /** 自定义主题：列表（编辑 / 复制 / 删除）+ 选基础主题新建 */
  private renderCustomThemes(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("customTheme.heading")).setHeading();
    const plugin = this.plugin;
    const save = async (theme: CustomTheme) => {
      const list = plugin.settings.customThemes;
      const i = list.findIndex((x) => x.id === theme.id);
      if (i >= 0) list[i] = theme;
      else list.push(theme);
      await plugin.saveSettings();
      plugin.applyCustomThemes();
      this.display();
    };
    for (const theme of plugin.settings.customThemes) {
      new Setting(containerEl)
        .setName(theme.name)
        .setDesc(t("customTheme.basedOn", { base: themeShortLabel(theme.base) }))
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
                  this.display();
                });
              }).open(),
            ),
        );
    }
    let base: ThemeName = "snow";
    new Setting(containerEl)
      .setName(t("customTheme.new"))
      .setDesc(t("customTheme.newDesc"))
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
  }
}
