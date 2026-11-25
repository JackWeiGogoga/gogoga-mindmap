/**
 * 从 CHANGELOG.zh-CN.md / CHANGELOG.md 取最近几个版本的条目，生成 src/whatsnew-data.ts（更新后的「更新内容」用）。
 * 构建前自动跑（package.json 的 build / dev），生成的文件也提交进仓库（lint、类型检查不用先构建）。
 * 两个插件各一份（源头在 gogoga-mindmap/scripts，改了复制给 gogoga-table）。
 */
import { readFileSync, writeFileSync } from "node:fs";

const KEEP = 10;

/** 「## [x.y.z] - 日期」到下一个「## [」之间是一个版本；[Unreleased] 不要 */
export function sections(md) {
  const out = [];
  const re = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm;
  const heads = [...md.matchAll(re)];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index + heads[i][0].length;
    const rest = md.slice(start);
    const next = rest.search(/^## \[|^\[[^\]]+\]: /m);
    out.push({ version: heads[i][1], date: heads[i][2], body: (next >= 0 ? rest.slice(0, next) : rest).trim() });
  }
  return out;
}

export function generate(zhMd, enMd, keep = KEEP) {
  const en = new Map(sections(enMd).map((s) => [s.version, s.body]));
  const list = sections(zhMd)
    .slice(0, keep)
    .map((s) => ({ version: s.version, date: s.date, zh: s.body, en: en.get(s.version) ?? s.body }));
  return `// 构建时由 scripts/gen-whatsnew.mjs 从 CHANGELOG 生成，别直接改\nexport const WHATS_NEW: { version: string; date: string; zh: string; en: string }[] = ${JSON.stringify(list, null, 1)};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = generate(readFileSync("CHANGELOG.zh-CN.md", "utf8"), readFileSync("CHANGELOG.md", "utf8"));
  let old = "";
  try {
    old = readFileSync("src/whatsnew-data.ts", "utf8");
  } catch {
    // 第一次生成
  }
  if (old !== text) writeFileSync("src/whatsnew-data.ts", text);
}
