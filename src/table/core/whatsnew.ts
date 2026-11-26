/**
 * 更新后告诉用户这次更新了什么：右下角弹一条「已更新到 x.y.z」，带「查看更新内容」按钮，点了才开窗口，不打断手上的事。
 * 内容是构建时从 CHANGELOG 取的最近几个版本（scripts/gen-whatsnew.mjs → whatsnew-data.ts），不联网。
 * 隔了几版才打开 Obsidian 只提示一次，窗口里列出这期间的全部版本；新装的不提示；设置里能关；命令面板随时能看。
 * 两个插件共用（源头在脑图，sync-table 复制给表格），各自传自己的更新日志。
 */
import { Component, getLanguage, MarkdownRenderer, Modal, Notice, type Plugin, setIcon } from "obsidian";
import { highlights, pendingNotes, type WhatsNewEntry } from "./whatsnew-core";


export interface WhatsNewOptions {
  /** 插件显示名，如 gogoga Mind Map */
  name: string;
  /** 提示标题前的图标（Obsidian 的图标名） */
  icon: string;
  notes: WhatsNewEntry[];
  /** 完整更新日志（GitHub 上的 CHANGELOG） */
  changelogUrl: { zh: string; en: string };
  enabled: () => boolean;
  lastSeen: () => string | undefined;
  setLastSeen: (v: string) => Promise<void>;
  /** 这次是新装（之前没有存过设置）：不提示，只记下版本 */
  fresh: boolean;
}

const zh = () => getLanguage().toLowerCase().startsWith("zh");
const L = (c: string, e: string) => (zh() ? c : e);

export class WhatsNewModal extends Modal {
  private readonly comp = new Component();
  constructor(
    plugin: Plugin,
    private readonly opts: Pick<WhatsNewOptions, "name" | "changelogUrl"> & { manifest: Plugin["manifest"] },
    private readonly notes: WhatsNewEntry[],
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.comp.load();
    this.modalEl.addClass("gg-whatsnew-modal");
    this.setTitle(L(`${this.opts.name} 更新内容`, `What's new in ${this.opts.name}`));
    const body = this.contentEl.createDiv({ cls: "gg-whatsnew" });
    for (const n of this.notes) {
      const sec = body.createDiv({ cls: "gg-whatsnew-version" });
      sec.createEl("h2", { text: n.version }).createSpan({ cls: "gg-whatsnew-date", text: n.date });
      const md = sec.createDiv({ cls: "gg-whatsnew-body markdown-rendered" });
      void MarkdownRenderer.render(this.app, zh() ? n.zh : n.en, md, "", this.comp);
    }
    const foot = this.contentEl.createDiv({ cls: "gg-whatsnew-foot" });
    const link = foot.createEl("a", { text: L("完整更新日志", "Full changelog"), href: zh() ? this.opts.changelogUrl.zh : this.opts.changelogUrl.en });
    link.setAttr("target", "_blank");
    // 打赏只放在这个窗口底部：窗口是用户自己点开的，不另外弹、不催。地址用 manifest 里的 fundingUrl，没有就不显示
    const fund = this.fundingUrl();
    const support = this.contentEl.createDiv({ cls: "gg-whatsnew-support" });
    if (fund) {
      support.createDiv({
        cls: "gg-whatsnew-support-text",
        text: L(`gogoga 系列全部免费开源。如果 ${this.opts.name} 帮到了你，欢迎支持一下。`, `gogoga is free and open source. If ${this.opts.name} helps you, consider supporting its development.`),
      });
    }
    const row = support.createDiv({ cls: "gg-whatsnew-support-actions" });
    if (fund) {
      const btn = row.createEl("button", { cls: "gg-whatsnew-fund" });
      setIcon(btn.createSpan({ cls: "gg-whatsnew-fund-icon" }), "coffee");
      btn.createSpan({ text: L("请我喝杯咖啡", "Buy me a coffee") });
      btn.addEventListener("click", () => window.open(fund));
    }
    const ok = row.createEl("button", { cls: "mod-cta", text: L("好的", "Got it") });
    ok.addEventListener("click", () => this.close());
  }

  private fundingUrl(): string | undefined {
    const f = (this.opts.manifest as { fundingUrl?: string | Record<string, string> }).fundingUrl;
    if (typeof f === "string") return f || undefined;
    return f ? Object.values(f)[0] : undefined;
  }

  onClose(): void {
    this.comp.unload();
    this.contentEl.empty();
  }
}

/** 插件加载后（工作区好了再等几秒，不和启动挤在一起）看要不要提示；再加一个「查看更新内容」命令 */
export function initWhatsNew(plugin: Plugin, opts: WhatsNewOptions): void {
  const current = plugin.manifest.version;
  plugin.addCommand({
    id: "show-whats-new",
    name: L("查看更新内容", "Show what's new"),
    callback: () => new WhatsNewModal(plugin, { ...opts, manifest: plugin.manifest }, opts.notes.slice(0, 5)).open(),
  });
  plugin.app.workspace.onLayoutReady(() => {
    const timer = window.setTimeout(() => void run(), 3000);
    plugin.register(() => window.clearTimeout(timer));
  });
  const run = async () => {
    const last = opts.lastSeen();
    if (last === current) return;
    const notes = pendingNotes(opts.notes, last, current, opts.fresh);
    // 不管提不提示都记下：用户没点按钮，下次启动也不再弹
    await opts.setLastSeen(current);
    if (!notes.length || !opts.enabled()) return;
    showUpdateNotice(plugin, opts, current, notes);
  };
}

/** 停留多久自动关（鼠标停在上面时不关，移开后重新计时） */
const NOTICE_MS = 20000;

/**
 * 右上角的更新提示：图标 + 插件名 + 版本号小标签，下面一行这次的亮点，最后是「查看更新内容」「关闭」两个按钮。
 * 位置和外框跟 Obsidian 自己的提示一样（跟主题走），里面的排版是我们的
 */
function showUpdateNotice(plugin: Plugin, opts: WhatsNewOptions, version: string, notes: WhatsNewEntry[]): void {
  let notice: Notice | null = null;
  const frag = createFragment((f) => {
    const head = f.createDiv({ cls: "gg-update-notice-head" });
    setIcon(head.createSpan({ cls: "gg-update-notice-icon" }), opts.icon);
    head.createSpan({ cls: "gg-update-notice-name", text: opts.name });
    head.createSpan({ cls: "gg-update-notice-version", text: version });
    const line = highlights(notes, zh() ? "zh" : "en");
    f.createDiv({ cls: "gg-update-notice-text", text: line || L(`已更新到 ${version}`, `Updated to ${version}`) });
    const row = f.createDiv({ cls: "gg-update-notice-actions" });
    const open = row.createEl("button", { cls: "mod-cta", text: L("查看更新内容", "What's new") });
    open.addEventListener("click", (ev) => {
      ev.stopPropagation();
      notice?.hide();
      new WhatsNewModal(plugin, { ...opts, manifest: plugin.manifest }, notes).open();
    });
    const close = row.createEl("button", { text: L("关闭", "Close") });
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      notice?.hide();
    });
  });
  // 自己计时：鼠标停在上面时不关（Obsidian 的计时停不下来）
  notice = new Notice(frag, 0);
  const el = notice.containerEl;
  el.addClass("gg-update-notice");
  let timer = window.setTimeout(() => notice?.hide(), NOTICE_MS);
  el.addEventListener("mouseenter", () => window.clearTimeout(timer));
  el.addEventListener("mouseleave", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => notice?.hide(), NOTICE_MS / 2);
  });
  plugin.register(() => window.clearTimeout(timer));
}
