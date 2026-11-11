/**
 * 删除节点 / 图片时清理不再使用的图片附件（设置项，默认关；B 站 janish 2026-11-11）。
 *
 * - 只管脑图里自己的编辑（删节点、编辑时删掉图片、撤销重做）：Markdown 那边或别的设备改的不算
 * - 停手两秒再看（剪切后马上粘贴，图片还在，就不动它）
 * - 只动图片，而且整个库里没有别的笔记 / 白板还在引用；移到回收站（按 Obsidian「删除文件」的设置）
 * - 移走前把内容留在内存里：撤销让链接回来时，按原路径把文件写回去
 */

import type { App, TFile } from "obsidian";

export const CLEANUP_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

/** 单个文件超过这个大小不清理（留不住备份，撤销就恢复不了） */
const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 备份总量上限，超了先丢最早的 */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/** 文本里嵌入（![[…]]、![](…)）的链接路径，按出现顺序去重；网址和 data: 不算 */
export function embedTargets(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/!\[\[([^\]\n]+?)\]\]/g)) {
    const p = m[1].split("|")[0].split("#")[0].trim();
    if (p) out.add(p);
  }
  for (const m of text.matchAll(/!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g)) {
    let p = m[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) continue;
    try {
      p = decodeURI(p);
    } catch {
      /* 留原样 */
    }
    p = p.split("#")[0].trim();
    if (p) out.add(p);
  }
  return [...out];
}

interface Backup {
  path: string;
  data: ArrayBuffer;
}

export class AttachmentJanitor {
  /** 键：来源笔记路径 + 链接路径（撤销后文本里写的就是它） */
  private backups = new Map<string, Backup>();
  private bytes = 0;
  /** 清理、恢复按顺序来：剪切再粘贴时恢复要等前面的清理做完 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private notice: (count: number) => void,
  ) {}

  /** 文本里嵌入的图片附件 → 指向它的链接路径 */
  images(text: string, source: string): Map<TFile, string[]> {
    const out = new Map<TFile, string[]>();
    for (const lp of embedTargets(text)) {
      const f = this.app.metadataCache.getFirstLinkpathDest(lp, source);
      if (!f || !CLEANUP_IMAGE_EXTS.has(f.extension.toLowerCase())) continue;
      const list = out.get(f) ?? [];
      list.push(lp);
      out.set(f, list);
    }
    return out;
  }

  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** 文本里有嵌入找不到文件、而这里留着它的备份（撤销让链接回来了）：按原路径写回去 */
  restoreMissing(text: string, source: string): Promise<number> {
    return this.run(async () => {
      let n = 0;
      for (const lp of embedTargets(text)) {
        const key = `${source}\u0001${lp}`;
        const b = this.backups.get(key);
        if (!b || this.app.metadataCache.getFirstLinkpathDest(lp, source)) continue;
        if (!this.app.vault.getAbstractFileByPath(b.path)) {
          const dir = b.path.includes("/") ? b.path.slice(0, b.path.lastIndexOf("/")) : "";
          if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => undefined);
          await this.app.vault.createBinary(b.path, b.data);
          n++;
        }
        this.drop(b);
      }
      return n;
    });
  }

  /** 这张图在 source 以外还有没有人用：别的笔记（Obsidian 的链接索引）和白板（.canvas 不进索引，读文本找） */
  private async usedElsewhere(file: TFile, source: string): Promise<boolean> {
    const resolved = this.app.metadataCache.resolvedLinks;
    for (const [from, targets] of Object.entries(resolved)) {
      if (from !== source && targets[file.path]) return true;
    }
    for (const c of this.app.vault.getFiles()) {
      if (c.extension !== "canvas") continue;
      const text = await this.app.vault.cachedRead(c).catch(() => "");
      if (text.includes(file.path) || text.includes(file.name)) return true;
    }
    return false;
  }

  /**
   * removed 里的图片（文件 → 原来指向它的链接路径）不再被 source 用到：库里也没人用的移到回收站，留备份。
   * currentText 给出 source 现在的文本：真正动手前再确认一次它确实不用了
   */
  sweep(removed: Map<TFile, string[]>, source: string, currentText: () => string): Promise<number> {
    return this.run(async () => {
      let n = 0;
      const now = this.images(currentText(), source);
      for (const [file, links] of removed) {
        if (now.has(file) || !this.app.vault.getAbstractFileByPath(file.path)) continue;
        if (file.stat.size > MAX_FILE_BYTES) continue;
        if (await this.usedElsewhere(file, source)) continue;
        const data = await this.app.vault.readBinary(file);
        const b: Backup = { path: file.path, data };
        for (const lp of links) {
          const key = `${source}\u0001${lp}`;
          const old = this.backups.get(key);
          if (old) this.drop(old);
          this.backups.set(key, b);
        }
        this.bytes += data.byteLength;
        this.trim();
        await this.app.fileManager.trashFile(file);
        n++;
      }
      if (n) this.notice(n);
      return n;
    });
  }

  /** 来源笔记改名：备份的键跟着改 */
  rename(oldSource: string, newSource: string): void {
    for (const [k, b] of [...this.backups]) {
      if (!k.startsWith(`${oldSource}\u0001`)) continue;
      this.backups.delete(k);
      this.backups.set(`${newSource}\u0001${k.slice(oldSource.length + 1)}`, b);
    }
  }

  private drop(b: Backup): void {
    let had = false;
    for (const [k, v] of [...this.backups]) {
      if (v === b) {
        this.backups.delete(k);
        had = true;
      }
    }
    if (had) this.bytes -= b.data.byteLength;
  }

  private trim(): void {
    while (this.bytes > MAX_TOTAL_BYTES && this.backups.size) {
      const first = this.backups.values().next().value as Backup;
      this.drop(first);
    }
  }
}

