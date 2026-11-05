/**
 * PDF 自动摘录：开着时，PDF++ 每复制一次链接（选中文字、框选区域、标注，开了 PDF++ 的自动复制就是选中即复制），
 * 就直接加到这张脑图选中节点下，不用再回脑图按 ⌘V。
 *
 * PDF++ 没有给别的插件的接口，这里接的是它复制完链接后决定「要不要自动粘贴到笔记」的那一步
 * （lib.copyLink.autoFocusOrAutoPaste，所有复制链接的路径最后都走它）：开着摘录时由脑图接走，
 * 不再让 PDF++ 自己的自动粘贴、自动聚焦再处理一遍；关掉或脑图关了就原样交还。
 */

import { Notice, type App } from "obsidian";
import { t } from "./i18n";

interface CopyLink {
  autoFocusOrAutoPaste: (text: string, ...rest: unknown[]) => Promise<void>;
  statusDurationMs?: number;
}
interface Palette {
  setStatus?: (text: string, durationMs: number) => void;
}
export interface ExcerptTarget {
  /** 把 PDF++ 复制出的文字加到选中节点下；脑图不能编辑等原因加不进去返回 false */
  pasteExcerpt(text: string): boolean;
  /** 视图还开着 */
  isAlive(): boolean;
  /** 显示 / 去掉「正在摘录」的标记 */
  setExcerpting(on: boolean): void;
}

function pdfPlusCopyLink(app: App): CopyLink | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { lib?: { copyLink?: unknown } }> } }).plugins?.plugins;
  const copyLink = plugins?.["pdf-plus"]?.lib?.copyLink as CopyLink | undefined;
  return copyLink && typeof copyLink.autoFocusOrAutoPaste === "function" ? copyLink : null;
}

export class PdfExcerpt {
  private target: ExcerptTarget | null = null;
  private patched: {
    copyLink: CopyLink;
    original: CopyLink["autoFocusOrAutoPaste"];
    hook: CopyLink["autoFocusOrAutoPaste"];
    /** 原方法是实例自己的还是类上的：类上的就删掉实例上这个，不留一个多余的属性 */
    own: boolean;
  } | null = null;

  constructor(private readonly app: App) {}

  isOn(target: ExcerptTarget): boolean {
    return this.target === target;
  }

  toggle(target: ExcerptTarget): void {
    if (this.target === target) {
      this.stop();
      new Notice(t("notice.excerptOff"));
      return;
    }
    const copyLink = pdfPlusCopyLink(this.app);
    if (!copyLink) {
      new Notice(t("notice.excerptNeedsPdfPlus"));
      return;
    }
    this.stop();
    this.hook(copyLink);
    this.target = target;
    target.setExcerpting(true);
    new Notice(t("notice.excerptOn"));
  }

  /** 关掉摘录，把 PDF++ 的方法换回去（插件卸载时也调） */
  stop(): void {
    this.target?.setExcerpting(false);
    this.target = null;
    const p = this.patched;
    this.patched = null;
    // 期间 PDF++ 重载过、方法被换成了新的，就不去动它
    if (!p || p.copyLink.autoFocusOrAutoPaste !== p.hook) return;
    if (p.own) p.copyLink.autoFocusOrAutoPaste = p.original;
    else delete (p.copyLink as Partial<CopyLink>).autoFocusOrAutoPaste;
  }

  private hook(copyLink: CopyLink): void {
    const original = copyLink.autoFocusOrAutoPaste;
    const own = Object.prototype.hasOwnProperty.call(copyLink, "autoFocusOrAutoPaste");
    const take = (text: string, self: CopyLink, palette: Palette | undefined) => this.take(text, self, palette);
    // 普通函数：PDF++ 调用时的 this 是它自己的 copyLink，原方法要原样拿到
    const hook = async function (this: CopyLink, text: string, ...rest: unknown[]): Promise<void> {
      // 参数依次是 文字、是否强制粘贴、工具栏（显示「已复制」状态的那个）
      if (take(text, this, rest[1] as Palette | undefined)) return;
      return original.call(this, text, ...rest);
    };
    copyLink.autoFocusOrAutoPaste = hook;
    this.patched = { copyLink, original, hook, own };
  }

  /** 交给脑图；脑图已经关了就停掉摘录，这一次照旧交还 PDF++ */
  private take(text: string, copyLink: CopyLink, palette: Palette | undefined): boolean {
    const target = this.target;
    if (!target) return false;
    if (!target.isAlive()) {
      this.stop();
      return false;
    }
    if (!target.pasteExcerpt(text)) return false;
    palette?.setStatus?.(t("pdfExcerpt.status"), copyLink.statusDurationMs ?? 2000);
    return true;
  }
}
