/** 更新提示里不依赖 Obsidian 的部分（单测用）：比版本号、这次该提示哪些版本。见 whatsnew.ts */

export interface WhatsNewEntry {
  version: string;
  date: string;
  zh: string;
  en: string;
}

/** 比版本号：a 比 b 新返回正数 */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * 这次要提示哪些版本：上次看过的之后、到当前版本为止（新的在前）。
 * 新装的不提示；老用户第一次装上带这个功能的版本（没记过）只提示当前这一版；降级、版本不在列表里的不提示
 */
export function pendingNotes(all: WhatsNewEntry[], last: string | undefined, current: string, fresh: boolean): WhatsNewEntry[] {
  if (last === current) return [];
  if (last === undefined) return fresh ? [] : all.filter((n) => n.version === current);
  if (cmpVersion(current, last) <= 0) return [];
  return all.filter((n) => cmpVersion(n.version, last) > 0 && cmpVersion(n.version, current) <= 0);
}

/**
 * 提示里的一行亮点：这一版「新增」（没有就「改进」「修复」）里每条开头冒号前那几个字，最多三条。
 * 「诊断记录（只在电脑端……）：……」取「诊断记录」，括号里的补充说明去掉，太长的截断。
 * 隔了几版的只说包含几个版本
 */
export function highlights(notes: WhatsNewEntry[], lang: "zh" | "en"): string {
  if (!notes.length) return "";
  if (notes.length > 1) return lang === "zh" ? `包含 ${notes.length} 个版本的更新` : `${notes.length} versions of changes`;
  const body = lang === "zh" ? notes[0].zh : notes[0].en;
  const groups = new Map<string, string[]>();
  let cur = "";
  for (const line of body.split("\n")) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = h[1];
      groups.set(cur, []);
    } else if (cur && /^- /.test(line)) groups.get(cur)!.push(line.slice(2));
  }
  const order = lang === "zh" ? ["新增", "改进", "修复"] : ["Added", "Changed", "Fixed"];
  const label = order.find((k) => groups.get(k)?.length);
  if (!label) return "";
  const max = lang === "zh" ? 14 : 30;
  const leads = groups
    .get(label)!
    .slice(0, 3)
    .map((item) => {
      const cut = lang === "zh" ? item.indexOf("：") : item.search(/:\s/);
      let lead = (cut > 0 ? item.slice(0, cut) : item)
        .replace(/（[^）]*）|\([^)]*\)/g, "")
        .replace(/\*\*/g, "")
        .trim();
      if (lead.length > max) lead = lead.slice(0, max - 1).trimEnd() + "…";
      return lead;
    })
    .filter(Boolean);
  return lang === "zh" ? `${label}：${leads.join("、")}` : `${label}: ${leads.join(", ")}`;
}
