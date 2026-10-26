/**
 * 在别的笔记里用 ![[脑图笔记]] / ![[文件.xmind]] 嵌入一张已有的脑图：显示只读预览，
 * 点工具栏的「打开」或双击节点打开原文件编辑。
 *
 * Obsidian 的嵌入按扩展名分派（app.embedRegistry，非公开 API）：xmind 没人注册，直接注册；
 * md 是 Obsidian 自己的，包一层，只有 frontmatter 带 mindmap 的笔记才接管，其余照旧交回原来的处理。
 *
 * 指向某个节点（![[脑图#时间线]]、![[脑图#^abc123]]）时只显示那个节点和它的子树。
 * 放进白板（Canvas）的卡片里时铺满卡片，卡片拉多大图就多大。
 */

import { App, Component, TFile } from "obsidian";
import type MindMapPlugin from "./main";
import { MindMapCanvas } from "./canvas";
import { frontmatterValue, parseMarkdown } from "./markdown";
import type { MindDoc } from "./model";
import { indentString } from "./settings";
import { edgeFromFrontmatter, isThemeId } from "./theme";
import { isStructure } from "./layout";
import { describeLost, parseXmind, xmindSheetToDoc } from "./xmind";
import { MindNode, walk } from "./model";
import { plainText } from "./inline";
import { t } from "./i18n";

interface EmbedContext {
  app: App;
  containerEl: HTMLElement;
  sourcePath: string;
}

type EmbedCreator = (ctx: EmbedContext, file: TFile, subpath: string) => Component;

interface EmbedRegistry {
  embedByExtension: Record<string, EmbedCreator | undefined>;
  registerExtension(ext: string, creator: EmbedCreator): void;
  unregisterExtension(ext: string): void;
}

export function registerMindMapEmbeds(plugin: MindMapPlugin): void {
  const registry = (plugin.app as App & { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (!registry?.registerExtension) return;
  const create = (ctx: EmbedContext, file: TFile, subpath: string) => new MindMapEmbed(plugin, ctx, file, subpath);

  if (!registry.embedByExtension.xmind) {
    registry.registerExtension("xmind", create);
    plugin.register(() => registry.unregisterExtension("xmind"));
  }

  const original = registry.embedByExtension.md;
  if (original) {
    registry.unregisterExtension("md");
    registry.registerExtension("md", (ctx, file, subpath) =>
      plugin.isMindMapFile(file.path) ? create(ctx, file, subpath) : original(ctx, file, subpath),
    );
    plugin.register(() => {
      registry.unregisterExtension("md");
      registry.registerExtension("md", original);
    });
  }
}

class MindMapEmbed extends Component {
  private canvas: MindMapCanvas | null = null;
  private wrap: HTMLElement | null = null;
  private lastHeight = 0;
  private bounds: { w: number; h: number } | null = null;

  constructor(
    private plugin: MindMapPlugin,
    private ctx: EmbedContext,
    private file: TFile,
    /** 嵌入链接里 # 后面的部分：标题路径或 ^块 id，空串为整张图 */
    private subpath = "",
  ) {
    super();
  }

  /** 放在白板卡片里：卡片多大就铺多大，而不是按图的大小算高度 */
  private inCanvas(): boolean {
    return !!this.ctx.containerEl.closest(".canvas-node");
  }

  onload(): void {
    this.registerEvent(
      this.plugin.app.vault.on("modify", (f) => {
        if (f === this.file) void this.loadFile();
      }),
    );
  }

  onunload(): void {
    this.canvas?.destroy();
    this.canvas = null;
    this.wrap?.remove();
    this.wrap = null;
  }

  async loadFile(): Promise<void> {
    const { doc, lost } = await this.readDoc();
    if (!doc) return;
    const settings = this.plugin.settings;
    const fm = (k: string) => frontmatterValue(doc.frontmatter, k);
    const structure = fm("mindmap-structure");
    const theme = fm("mindmap-theme");
    if (!this.canvas) {
      this.ctx.containerEl.addClass("mm-file-embed");
      const wrap = this.ctx.containerEl.createDiv({ cls: "mm-codeblock" });
      this.wrap = wrap;
      this.canvas = new MindMapCanvas(wrap, {
        structure: isStructure(structure) ? structure : settings.defaultStructure,
        theme: isThemeId(theme) ? theme : settings.defaultTheme,
        edge: edgeFromFrontmatter(fm),
        editable: false,
        embedded: true,
        toolbarPosition: settings.toolbarPosition,
        wheelZoom: () => settings.wheelAction === "zoom",
        marqueeDrag: () => settings.leftDrag === "select",
        caretAtEnd: () => settings.editCaret === "end",
        dragToFloat: () => settings.dragToFloat,
        notePopoverSize: this.plugin.notePopoverSize,
        host: this.plugin.canvasHost(() => this.ctx.sourcePath, this),
        onOpenFile: () => void this.plugin.app.workspace.openLinkText(this.file.path, this.ctx.sourcePath),
        onLayout: (bounds) => {
          this.bounds = bounds;
          // 布局回调可能处在 ResizeObserver 链路里，推到下一帧再改高度
          window.requestAnimationFrame(() => this.resize());
        },
      });
      // 实时预览里嵌入框的宽度会在第一次布局之后才定下来；宽度一变就重算高度、重新适应。
      // 白板卡片的高度也由用户拖，所以在白板里高度变了也要重新适应
      let last = "";
      const ro = new ResizeObserver(() => {
        const size = this.inCanvas() ? `${wrap.clientWidth}x${wrap.clientHeight}` : String(wrap.clientWidth);
        if (size === last) return;
        last = size;
        this.resize();
      });
      ro.observe(wrap);
      this.register(() => ro.disconnect());
    }
    this.canvas.setDoc(doc);
    this.focusSubpath(doc.root);
    this.wrap?.querySelector(".mm-xmind-lost")?.remove();
    if (lost) this.wrap?.createDiv({ cls: "mm-xmind-lost", text: lost });
  }

  /**
   * 预览框高度：宽图按宽度缩小来适应，高度也按同样的比例算，免得下面空出一大片。
   * 高度变了要重新适应一次，不然图还按旧尺寸摆着
   */
  private resize(): void {
    const wrap = this.wrap;
    const b = this.bounds;
    if (!wrap || !b || !wrap.clientWidth) return;
    if (this.inCanvas()) {
      this.ctx.containerEl.addClass("mm-in-canvas");
      this.canvas?.fit();
      return;
    }
    const k = Math.min(1, Math.max(0.2, (wrap.clientWidth - 96) / Math.max(1, b.w)));
    const h = Math.min(this.plugin.settings.codeBlockMaxHeight, Math.max(200, Math.round(b.h * k + 96)));
    if (h !== this.lastHeight) {
      this.lastHeight = h;
      wrap.setCssStyles({ height: `${h}px` });
    }
    this.canvas?.fit();
  }

  /**
   * 链接指向某个节点就聚焦到它：#^abc 按块 id 找；#甲#乙 按标题路径找（只写最后一段也行），
   * 比较时去掉 Markdown 格式、不分大小写，和 Obsidian 找标题的方式一致。找不到就显示整张图
   */
  private focusSubpath(root: MindNode): void {
    const canvas = this.canvas;
    const sub = this.subpath.replace(/^#/, "");
    if (!canvas || !sub) return;
    const norm = (s: string) => plainText(s).replace(/\s+/g, " ").trim().toLowerCase();
    let target: MindNode | null = null;
    if (sub.startsWith("^")) {
      const id = sub.slice(1);
      walk(root, (n) => {
        if (!target && n.blockId === id) target = n;
      });
    } else {
      const parts = sub.split("#").map(norm).filter(Boolean);
      const last = parts[parts.length - 1];
      walk(root, (n) => {
        if (target || norm(n.text) !== last) return;
        // 写了上级标题的，上级也要对得上
        let p = n.parent;
        for (let i = parts.length - 2; i >= 0 && p; i--) {
          while (p && norm(p.text) !== parts[i]) p = p.parent;
          if (!p) return;
          p = p.parent;
        }
        target = n;
      });
    }
    const found: MindNode | null = target;
    if (!found || found === root || canvas.getFocus() === found) return;
    canvas.focusOn(found);
    // 只读预览里不用选中它
    canvas.select(null);
  }

  private async readDoc(): Promise<{ doc: MindDoc | null; lost: string }> {
    const settings = this.plugin.settings;
    const style = { maxHeadingLevel: settings.maxHeadingLevel, indent: indentString(settings.indent) };
    const vault = this.plugin.app.vault;
    try {
      if (this.file.extension === "xmind") {
        // 多个画布的只显示第一个；要看别的打开文件切换
        const sheet = (await parseXmind(await vault.readBinary(this.file)))[0];
        return sheet ? { doc: xmindSheetToDoc(sheet, style), lost: describeLost(sheet.lost) } : { doc: null, lost: "" };
      }
      return { doc: parseMarkdown(await vault.cachedRead(this.file), { fallbackTitle: this.file.basename, style }), lost: "" };
    } catch (e) {
      this.ctx.containerEl.setText(t("xmind.readFailed", { name: this.file.name, error: (e as Error).message }));
      return { doc: null, lost: "" };
    }
  }
}
