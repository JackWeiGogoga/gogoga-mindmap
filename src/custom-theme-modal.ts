import { App, Modal, Setting } from "obsidian";
import { MindMapCanvas } from "./canvas";
import { CustomTheme, PREVIEW_ID, setPreviewTheme, Spacing, TierStyle, toHex } from "./custom-theme";
import { t } from "./i18n";
import { parseMarkdown } from "./markdown";
import { EdgeStyle, isUnderlineAt, THEME_LIST, themeShortLabel, ThemeName, THEMES } from "./theme";
import type MindMapPlugin from "./main";

/** 预览用的示例图：四档层级都有，带一个下划线候选的深层 */
const SAMPLE = `# 读书笔记

## 第一章
- 要点
	- 关键概念
- 摘录

## 第二章
- 思考
- 疑问

## 第三章
- 行动清单
`;

/**
 * 从内置主题读出 4 档的实际样式，作为自定义主题的起点：
 * 临时挂一份隐藏的画布 DOM，用 getComputedStyle 量。量的时候按浅色模式算（深色由样式表自动推算）。
 */
export function themeFromBase(base: ThemeName, name: string, id: string): CustomTheme {
  const th = THEMES[base];
  const body = document.body;
  const wasDark = body.classList.contains("theme-dark");
  if (wasDark) body.classList.replace("theme-dark", "theme-light");
  const root = createDiv({ cls: "gg-mm-root" });
  root.dataset.theme = base;
  root.dataset.branchColors = th.branchColors ? "true" : "false";
  root.setCssStyles({ position: "absolute", left: "-10000px", top: "0", visibility: "hidden" });
  const svg = createSvg("svg", { cls: "mm-edges" });
  root.append(svg);
  const tiers: TierStyle[] = [];
  body.append(root);
  try {
    for (let depth = 0; depth < 4; depth++) {
      const node = root.createDiv({ cls: "gg-mm-node" });
      node.dataset.depth = String(depth);
      const underline = depth > 0 && isUnderlineAt(th, depth);
      if (underline) node.addClass("is-underline");
      node.createDiv({ cls: "mm-label", text: "Aa" });
      const path = createSvg("path", { cls: "mm-edge" });
      path.dataset.depth = String(Math.max(1, depth));
      svg.append(path);
      const cs = getComputedStyle(node);
      const ps = getComputedStyle(path);
      const bg = cs.backgroundColor;
      const transparent = !bg || bg === "transparent" || /rgba\([^)]*,\s*0\)$/.test(bg);
      const borderStyle = cs.borderTopStyle === "dashed" ? "dashed" : cs.borderTopStyle === "none" || parseFloat(cs.borderTopWidth) === 0 ? "none" : "solid";
      tiers.push({
        fontSize: Math.round(parseFloat(cs.fontSize)) || 14,
        bold: Number(cs.fontWeight) >= 600,
        italic: cs.fontStyle === "italic",
        color: toHex(cs.color),
        fill: transparent ? null : toHex(bg),
        underline,
        radius: Math.round(parseFloat(cs.borderTopLeftRadius)) || 0,
        borderStyle,
        borderWidth: borderStyle === "none" ? 1 : parseFloat(cs.borderTopWidth) || 1,
        borderColor: borderStyle === "none" ? "#8a8a8a" : toHex(cs.borderTopColor),
        maxWidth: null,
        align: false,
        lineColor: ps.stroke && ps.stroke !== "none" ? toHex(ps.stroke) : "#2b2b2b",
        lineWidth: parseFloat(ps.strokeWidth) || 1.5,
      });
    }
  } finally {
    root.remove();
    if (wasDark) body.classList.replace("theme-light", "theme-dark");
  }
  // 彩虹类主题的主主题底色来自分支色，量不到；给一个中性色，关掉彩虹时能用
  if (th.branchColors && !tiers[1].fill) tiers[1].fill = "#e9e9ef";
  return { id, name, base, edge: th.edge, sharp: false, dashed: false, branchColors: th.branchColors, spacing: "normal", tiers };
}

export class CustomThemeModal extends Modal {
  private draft: CustomTheme;
  private tier = 1;
  private canvas: MindMapCanvas | null = null;
  private controls!: HTMLElement;
  private relayout = 0;

  constructor(
    app: App,
    private plugin: MindMapPlugin,
    theme: CustomTheme,
    private onSave: (theme: CustomTheme) => void,
  ) {
    super(app);
    this.draft = structuredClone(theme);
  }

  onOpen(): void {
    this.plugin.openThemeEditors.add(this);
    this.modalEl.addClass("mm-theme-modal");
    this.setTitle(t("customTheme.editTitle"));
    const body = this.contentEl.createDiv({ cls: "mm-theme-editor" });
    this.controls = body.createDiv({ cls: "mm-theme-controls" });
    const previewWrap = body.createDiv({ cls: "mm-theme-preview" });
    previewWrap.createDiv({ cls: "mm-theme-preview-label", text: t("customTheme.preview") });
    const host = previewWrap.createDiv({ cls: "mm-theme-preview-canvas" });
    this.updatePreviewTheme();
    host.tabIndex = -1;
    this.canvas = new MindMapCanvas(host, { structure: "logic-right", theme: PREVIEW_ID, editable: false, embedded: true });
    host.tabIndex = -1;
    this.canvas.setDoc(parseMarkdown(SAMPLE, { fallbackTitle: "" }));
    window.setTimeout(() => this.canvas?.fit(), 50);

    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    footer.createEl("button", { text: t("customTheme.cancel") }).addEventListener("click", () => this.close());
    const save = footer.createEl("button", { text: t("customTheme.save"), cls: "mod-cta" });
    save.addEventListener("click", () => {
      this.onSave({ ...this.draft, name: this.draft.name.trim() || t("customTheme.untitled") });
      this.close();
    });
    this.renderControls();
  }

  onClose(): void {
    if (this.relayout) window.cancelAnimationFrame(this.relayout);
    this.plugin.openThemeEditors.delete(this);
    this.canvas?.destroy();
    this.canvas = null;
    setPreviewTheme(null);
    this.plugin.refreshCustomCss();
    this.contentEl.empty();
  }

  private updatePreviewTheme(): void {
    setPreviewTheme(this.draft);
    this.plugin.refreshCustomCss();
    // 设置页可能开在单独的窗口里：样式要同步写进这个窗口，否则主窗口的样式要过一会儿才镜像过来，
    // 预览按旧样式量了尺寸，新样式一到宽度就变了，子节点位置对不上
    this.plugin.injectCustomCss(this.modalEl.ownerDocument);
  }

  /** 改了任何一项：刷新预览主题的样式表，画布按新行为（连线、间距、下划线）重画 */
  private changed(rerenderControls = false): void {
    this.updatePreviewTheme();
    if (this.canvas) {
      this.canvas.setEdge({});
      this.canvas.setTheme(PREVIEW_ID);
      this.canvas.fit();
      // 保险：下一帧再量一次，样式哪怕晚到一步布局也能跟上
      if (this.relayout) window.cancelAnimationFrame(this.relayout);
      this.relayout = window.requestAnimationFrame(() => {
        this.relayout = 0;
        this.canvas?.render();
        this.canvas?.fit();
      });
    }
    if (rerenderControls) this.renderControls();
  }

  private renderControls(): void {
    const el = this.controls;
    // 外形 / 边框 / 宽度这类下拉会增减下面的选项，只能整列重画；重画前记住滚动位置，画完放回去，免得跳回顶部
    const scroll = el.scrollTop;
    el.empty();
    const d = this.draft;

    new Setting(el).setName(t("customTheme.name")).addText((x) =>
      x.setValue(d.name).onChange((v) => {
        d.name = v;
      }),
    );
    new Setting(el)
      .setName(t("customTheme.base"))
      .setDesc(t("customTheme.baseDesc"))
      .addDropdown((x) =>
        x
          .addOptions(Object.fromEntries(THEME_LIST.map((th) => [th.name, themeShortLabel(th.name)])))
          .setValue(d.base)
          .onChange((v) => {
            const fresh = themeFromBase(v as ThemeName, d.name, d.id);
            this.draft = fresh;
            this.changed(true);
          }),
      );

    el.createDiv({ cls: "mm-theme-section", text: t("customTheme.overall") });
    new Setting(el).setName(t("customTheme.edge")).addDropdown((x) =>
      x
        .addOptions({ curve: t("edge.curve"), elbow: t("edge.elbow"), straight: t("edge.straight") })
        .setValue(d.edge)
        .onChange((v) => {
          d.edge = v as EdgeStyle;
          this.changed();
        }),
    );
    new Setting(el).setName(t("edge.rounded")).addToggle((x) =>
      x.setValue(!d.sharp).onChange((v) => {
        d.sharp = !v;
        this.changed();
      }),
    );
    new Setting(el).setName(t("edge.dashed")).addToggle((x) =>
      x.setValue(d.dashed).onChange((v) => {
        d.dashed = v;
        this.changed();
      }),
    );
    new Setting(el).setName(t("customTheme.branchColors")).addToggle((x) =>
      x.setValue(d.branchColors).onChange((v) => {
        d.branchColors = v;
        this.changed();
      }),
    );
    new Setting(el).setName(t("customTheme.spacing")).addDropdown((x) =>
      x
        .addOptions({ compact: t("customTheme.spacing.compact"), normal: t("customTheme.spacing.normal"), loose: t("customTheme.spacing.loose") })
        .setValue(d.spacing)
        .onChange((v) => {
          d.spacing = v as Spacing;
          this.changed();
        }),
    );

    el.createDiv({ cls: "mm-theme-section", text: t("customTheme.byLevel") });
    const tabs = el.createDiv({ cls: "mm-theme-tiers" });
    [t("customTheme.tier0"), t("customTheme.tier1"), t("customTheme.tier2"), t("customTheme.tier3")].forEach((label, i) => {
      const b = tabs.createEl("button", { text: label, cls: i === this.tier ? "is-active" : "" });
      b.addEventListener("click", () => {
        this.tier = i;
        this.renderControls();
      });
    });

    const tier = d.tiers[this.tier];
    // 滑块旁边带一个数字框：拖滑块粗调，直接输入精确值（不受步长限制，超出范围会夹回去）
    const slider = (s: Setting, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      let num: HTMLInputElement | null = null;
      s.addSlider((x) => {
        const sync = (v: number) => {
          set(v);
          if (num) num.value = String(v);
          this.changed();
        };
        x.setLimits(min, max, step).setValue(get()).onChange(sync);
        // Obsidian 的滑块松手才回调；拖动过程中也跟着刷新预览
        x.sliderEl.addEventListener("input", () => sync(Number(x.sliderEl.value)));
        s.addText((tx) => {
          num = tx.inputEl;
          num.type = "number";
          num.min = String(min);
          num.max = String(max);
          num.step = "any";
          num.addClass("mm-theme-num");
          num.value = String(get());
          const commit = () => {
            const raw = Number(num!.value);
            if (!num!.value.trim() || !Number.isFinite(raw)) {
              num!.value = String(get());
              return;
            }
            const v = Math.min(max, Math.max(min, Math.round(raw * 10) / 10));
            num!.value = String(v);
            if (v === get()) return;
            set(v);
            x.setValue(v);
            this.changed();
          };
          num.addEventListener("change", commit);
          num.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          });
        });
      });
    };
    const color = (s: Setting, get: () => string, set: (v: string) => void) =>
      s.addColorPicker((x) =>
        x.setValue(get()).onChange((v) => {
          set(v);
          this.changed();
        }),
      );

    slider(new Setting(el).setName(t("customTheme.fontSize")), 10, 40, 1, () => tier.fontSize, (v) => (tier.fontSize = v));
    new Setting(el).setName(t("customTheme.bold")).addToggle((x) =>
      x.setValue(tier.bold).onChange((v) => {
        tier.bold = v;
        this.changed();
      }),
    );
    new Setting(el).setName(t("customTheme.italic")).addToggle((x) =>
      x.setValue(tier.italic).onChange((v) => {
        tier.italic = v;
        this.changed();
      }),
    );
    color(new Setting(el).setName(t("customTheme.textColor")), () => tier.color, (v) => (tier.color = v));

    const shape = tier.underline ? "underline" : tier.fill ? "fill" : "none";
    new Setting(el).setName(t("customTheme.shape")).addDropdown((x) =>
      x
        .addOptions({ fill: t("customTheme.shape.fill"), none: t("customTheme.shape.none"), underline: t("customTheme.shape.underline") })
        .setValue(shape)
        .onChange((v) => {
          tier.underline = v === "underline";
          tier.fill = v === "fill" ? (tier.fill ?? "#f1f1f4") : null;
          this.changed(true);
        }),
    );
    if (shape === "fill") color(new Setting(el).setName(t("customTheme.fill")), () => tier.fill ?? "#f1f1f4", (v) => (tier.fill = v));
    if (shape !== "underline") {
      slider(new Setting(el).setName(t("customTheme.radius")), 0, 30, 1, () => tier.radius, (v) => (tier.radius = v));
      new Setting(el).setName(t("customTheme.border")).addDropdown((x) =>
        x
          .addOptions({ none: t("customTheme.border.none"), solid: t("customTheme.border.solid"), dashed: t("customTheme.border.dashed") })
          .setValue(tier.borderStyle)
          .onChange((v) => {
            tier.borderStyle = v as TierStyle["borderStyle"];
            this.changed(true);
          }),
      );
      if (tier.borderStyle !== "none") {
        slider(new Setting(el).setName(t("customTheme.borderWidth")), 0.5, 4, 0.5, () => tier.borderWidth, (v) => (tier.borderWidth = v));
        color(new Setting(el).setName(t("customTheme.borderColor")), () => tier.borderColor, (v) => (tier.borderColor = v));
      }
    }
    new Setting(el)
      .setName(t("customTheme.width"))
      .setDesc(t("customTheme.widthDesc"))
      .addDropdown((x) =>
        x
          .addOptions({ auto: t("customTheme.width.auto"), custom: t("customTheme.width.custom") })
          .setValue(tier.maxWidth ? "custom" : "auto")
          .onChange((v) => {
            tier.maxWidth = v === "custom" ? (tier.maxWidth ?? (this.tier === 0 ? 440 : 300)) : null;
            this.changed(true);
          }),
      );
    if (tier.maxWidth) slider(new Setting(el).setName(t("customTheme.widthPx")), 60, 1200, 10, () => tier.maxWidth ?? 300, (v) => (tier.maxWidth = v));
    new Setting(el)
      .setName(t("customTheme.align"))
      .setDesc(t("customTheme.alignDesc"))
      .addToggle((x) =>
        x.setValue(tier.align).onChange((v) => {
          tier.align = v;
          this.changed();
        }),
      );
    if (this.tier > 0) {
      color(new Setting(el).setName(t("customTheme.lineColor")), () => tier.lineColor, (v) => (tier.lineColor = v));
      slider(new Setting(el).setName(t("customTheme.lineWidth")), 0.5, 6, 0.5, () => tier.lineWidth, (v) => (tier.lineWidth = v));
    }
    el.scrollTop = scroll;
  }
}

/** 删除前确认 */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private onYes: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    footer.createEl("button", { text: t("customTheme.cancel") }).addEventListener("click", () => this.close());
    const yes = footer.createEl("button", { text: t("customTheme.delete"), cls: "mod-warning" });
    yes.addEventListener("click", () => {
      this.onYes();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
