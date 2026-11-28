/**
 * [[ 补全的候选排序。脑图节点、脑图里的表格、gogoga Table 的格子共用（随 scripts/sync-table.mjs 复制到表格）。
 * 不依赖 Obsidian：调用方传进来按最近修改排好的文件列表。
 */

export interface LinkCandidate {
  /** 笔记是不带 .md 的名字，附件是带扩展名的文件名 */
  name: string;
  /** 所在文件夹（库根目录是空串） */
  folder: string;
  isNote: boolean;
}

const NAME_COLLATOR = new Intl.Collator("zh-Hans-u-co-pinyin", { numeric: true, sensitivity: "base" });

/**
 * 完全同名 → 以输入开头 → 包含输入 → 路径里包含；同一档里笔记排在图片等附件前面（B 站 FORMORE：表格里图片排在前面）。
 * 没输入时按传进来的顺序（最近修改）、笔记在前；有输入时同档按名称，中文按拼音
 */
export function rankLinkTargets<T extends LinkCandidate>(list: Iterable<T>, query: string, max: number): T[] {
  const q = query.trim().toLowerCase();
  const scored: { t: T; s: number }[] = [];
  let notes = 0;
  for (const t of list) {
    const name = t.name.toLowerCase();
    const m = !q ? 0 : name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : `${t.folder}/${name}`.toLowerCase().includes(q) ? 3 : -1;
    if (m < 0) continue;
    scored.push({ t, s: m + (t.isNote ? 0 : 0.5) });
    if (t.isNote) notes++;
    // 没输入时候选是全库：凑够 max 条笔记就不用再往下看了
    if (!q && notes >= max) break;
  }
  // sort 是稳定的：同分的保持传进来的顺序
  return scored
    .sort((a, b) => a.s - b.s || (q ? NAME_COLLATOR.compare(a.t.name, b.t.name) : 0))
    .slice(0, max)
    .map((x) => x.t);
}
