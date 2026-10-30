import { AbstractInputSuggest, App, PluginSettingTab, Setting, setIcon, TFile } from "obsidian";
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
import { syncNotesExpandedAll } from "./canvas";

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
  /** 展开备注的最大高度（像素，随节点字号缩放） */
  noteMaxHeight: number;
  /** 展开备注的最大宽度（像素，随节点字号缩放）；单条拖过大小的不受它限制 */
  noteMaxWidth: number;
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
  /** 滚轮行为：pan 平移（Cmd/Ctrl+滚轮缩放），zoom 直接缩放（Shift+滚轮平移） */
  wheelAction: "pan" | "zoom";
  /** 左键拖空白处：pan 平移（Shift+拖框选），select 框选（右键或中键拖平移，XMind 的习惯） */
  leftDrag: "pan" | "select";
  /** 进入编辑节点时：select 全选文字（打字直接替换），end 光标放在末尾 */
  editCaret: "select" | "end";
  /** 节点拖到空白处变成自由主题（默认关：拖到空白处是取消） */
  dragToFloat: boolean;
  /** 没有记住的视口时打开脑图：fit 适应画布，center 中心主题 100% */
  openView: "fit" | "center";
  /** 同一文件的脑图和 Markdown 同时显示时，选中和光标互相跟随（默认关） */
  syncSplit: boolean;
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
  /** 嵌入的脑图隐藏工具栏：阅读模式一直不显示，编辑模式鼠标移上去才显示（默认关） */
  embedToolbarAutoHide: boolean;
}

export type ToolbarPosition = "bottom" | "top" | "left" | "right";
export interface SavedViewport {
  tx: number;
  ty: number;
  k: number;
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
  wheelAction: "pan",
  leftDrag: "pan",
  editCaret: "select",
  dragToFloat: false,
  openView: "fit",
  syncSplit: false,
  customMarkers: "",
  customMarkersExclusive: false,
  rememberView: true,
  newFileTemplate: "",
  embedToolbarAutoHide: false,
  fileNameAsRoot: false,
  headingsOnly: false,
  followActiveNote: false,
  spacingScale: 100,
  fontScale: 100,
  notesExpanded: false,
  noteMaxHeight: 240,
  noteMaxWidth: 320,
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
      .setName(t("settings.fileNameAsRoot.name"))
      .setDesc(t("settings.fileNameAsRoot.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.fileNameAsRoot).onChange(async (v) => {
          this.plugin.settings.fileNameAsRoot = v;
          await this.plugin.saveSettings();
          this.plugin.reloadMaps();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.headingsOnly.name"))
      .setDesc(t("settings.headingsOnly.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.headingsOnly).onChange(async (v) => {
          this.plugin.settings.headingsOnly = v;
          await this.plugin.saveSettings();
          this.plugin.reloadMaps();
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

    new Setting(containerEl)
      .setName(t("settings.template.name"))
      .setDesc(t("settings.template.desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.template.placeholder"))
          .setValue(this.plugin.settings.newFileTemplate)
          .onChange(async (v) => {
            this.plugin.settings.newFileTemplate = v.trim();
            await this.plugin.saveSettings();
          });
        new NoteSuggest(this.app, text.inputEl);
      });

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

    const scaleSetting = (name: string, desc: string, key: "spacingScale" | "fontScale", min: number, max: number) => {
      let slider: { setValue(v: number): unknown } | null = null;
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addSlider((s) => {
          slider = s;
          s.setLimits(min, max, 5)
            .setValue(this.plugin.settings[key])
            .onChange(async (v) => {
              this.plugin.settings[key] = v;
              await this.plugin.saveSettings();
              this.plugin.applyDisplayScale();
            });
        })
        .addExtraButton((b) =>
          b.setIcon("rotate-ccw").setTooltip(t("settings.reset")).onClick(async () => {
            this.plugin.settings[key] = 100;
            slider?.setValue(100);
            await this.plugin.saveSettings();
            this.plugin.applyDisplayScale();
          }),
        );
    };
    scaleSetting(t("settings.spacing.name"), t("settings.spacing.desc"), "spacingScale", 50, 200);
    scaleSetting(t("settings.fontScale.name"), t("settings.fontScale.desc"), "fontScale", 70, 150);

    new Setting(containerEl)
      .setName(t("settings.notesExpanded.name"))
      .setDesc(t("settings.notesExpanded.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.notesExpanded).onChange(async (v) => {
          this.plugin.settings.notesExpanded = v;
          await this.plugin.saveSettings();
          syncNotesExpandedAll();
        }),
      );
    let noteHeight: { setValue(v: number): unknown } | null = null;
    new Setting(containerEl)
      .setName(t("settings.noteMaxHeight.name"))
      .setDesc(t("settings.noteMaxHeight.desc"))
      .addSlider((s) => {
        noteHeight = s;
        s.setLimits(120, 800, 20)
          .setValue(this.plugin.settings.noteMaxHeight)
          .onChange(async (v) => {
            this.plugin.settings.noteMaxHeight = v;
            await this.plugin.saveSettings();
            this.plugin.applyDisplayScale();
          });
      })
      .addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("settings.resetNoteHeight")).onClick(async () => {
          this.plugin.settings.noteMaxHeight = DEFAULT_SETTINGS.noteMaxHeight;
          noteHeight?.setValue(DEFAULT_SETTINGS.noteMaxHeight);
          await this.plugin.saveSettings();
          this.plugin.applyDisplayScale();
        }),
      );

    let noteWidth: { setValue(v: number): unknown } | null = null;
    new Setting(containerEl)
      .setName(t("settings.noteMaxWidth.name"))
      .setDesc(t("settings.noteMaxWidth.desc"))
      .addSlider((s) => {
        noteWidth = s;
        s.setLimits(160, 960, 20)
          .setValue(this.plugin.settings.noteMaxWidth)
          .onChange(async (v) => {
            this.plugin.settings.noteMaxWidth = v;
            await this.plugin.saveSettings();
            this.plugin.applyDisplayScale();
          });
      })
      .addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("settings.resetNoteWidth")).onClick(async () => {
          this.plugin.settings.noteMaxWidth = DEFAULT_SETTINGS.noteMaxWidth;
          noteWidth?.setValue(DEFAULT_SETTINGS.noteMaxWidth);
          await this.plugin.saveSettings();
          this.plugin.applyDisplayScale();
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
      .setName(t("settings.editCaret.name"))
      .setDesc(t("settings.editCaret.desc"))
      .addDropdown((d) =>
        d
          .addOptions({ select: t("settings.editCaret.select"), end: t("settings.editCaret.end") })
          .setValue(this.plugin.settings.editCaret)
          .onChange(async (v) => {
            this.plugin.settings.editCaret = v as MindMapSettings["editCaret"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.dragToFloat.name"))
      .setDesc(t("settings.dragToFloat.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.dragToFloat).onChange(async (v) => {
          this.plugin.settings.dragToFloat = v;
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
      .setName(t("settings.followActive.name"))
      .setDesc(t("settings.followActive.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.followActiveNote).onChange(async (v) => {
          this.plugin.settings.followActiveNote = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.embedToolbar.name"))
      .setDesc(t("settings.embedToolbar.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.embedToolbarAutoHide).onChange(async (v) => {
          this.plugin.settings.embedToolbarAutoHide = v;
          await this.plugin.saveSettings();
          this.plugin.applyEmbedToolbar();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.outlineWrap.name"))
      .setDesc(t("settings.outlineWrap.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.outlineWrap).onChange(async (v) => {
          this.plugin.settings.outlineWrap = v;
          await this.plugin.saveSettings();
          this.plugin.applyEmbedToolbar();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.rememberViewport.name"))
      .setDesc(t("settings.rememberViewport.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.rememberViewport).onChange(async (v) => {
          this.plugin.settings.rememberViewport = v;
          if (!v) this.plugin.viewports.clear();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.openView.name"))
      .setDesc(t("settings.openView.desc"))
      .addDropdown((d) =>
        d
          .addOption("fit", t("settings.openView.fit"))
          .addOption("center", t("settings.openView.center"))
          .setValue(this.plugin.settings.openView)
          .onChange(async (v) => {
            this.plugin.settings.openView = v === "center" ? "center" : "fit";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.syncSplit.name"))
      .setDesc(t("settings.syncSplit.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.syncSplit).onChange(async (v) => {
          this.plugin.settings.syncSplit = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.customMarkers.name"))
      .setDesc(t("settings.customMarkers.desc"))
      .addText((text) =>
        text
          .setPlaceholder("🎯 📎 ★ ◆")
          .setValue(this.plugin.settings.customMarkers)
          .onChange(async (v) => {
            this.plugin.settings.customMarkers = v;
            await this.plugin.saveSettings();
            this.plugin.applyCustomMarkers();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.customMarkersExclusive.name"))
      .setDesc(t("settings.customMarkersExclusive.desc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.customMarkersExclusive).onChange(async (v) => {
          this.plugin.settings.customMarkersExclusive = v;
          await this.plugin.saveSettings();
          this.plugin.applyCustomMarkers();
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
