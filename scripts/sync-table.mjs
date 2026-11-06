/**
 * 把 gogoga-table 的表格核心和编辑器复制进脑图（脑图节点里的表格用它，不依赖表格插件是否安装）。
 * 源头在 ../gogoga-table：src/core、src/editor 原样复制到 src/table/ 下，styles.css 换掉本文件里
 * 「gogoga-table 同步开始 / 结束」两行注释之间的部分。改表格功能去 gogoga-table 改，改完在这里跑
 * `node scripts/sync-table.mjs`；scripts/tests/table-sync.test.ts 在两个仓库都在时检查是否同步了。
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TABLE_SRC = path.resolve("../gogoga-table");
export const PARTS = ["core", "editor"];
export const CSS_BEGIN = "/* ==== gogoga-table 同步开始（scripts/sync-table.mjs 生成，别直接改） ==== */";
export const CSS_END = "/* ==== gogoga-table 同步结束 ==== */";

/** 表格插件的 styles.css → 要放进脑图 styles.css 的那一段 */
export function tableCss(src) {
  return `${CSS_BEGIN}\n${src.trim()}\n${CSS_END}`;
}

/** 在脑图的 styles.css 里换掉同步段（没有就接在末尾） */
export function withTableCss(styles, css) {
  const a = styles.indexOf(CSS_BEGIN);
  const b = styles.indexOf(CSS_END);
  if (a >= 0 && b > a) return styles.slice(0, a) + css + styles.slice(b + CSS_END.length);
  return `${styles.trimEnd()}\n\n${css}\n`;
}

function main() {
  for (const part of PARTS) {
    const from = path.join(TABLE_SRC, "src", part);
    const to = path.join("src/table", part);
    rmSync(to, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from).filter((x) => x.endsWith(".ts"))) copyFileSync(path.join(from, f), path.join(to, f));
  }
  const css = tableCss(readFileSync(path.join(TABLE_SRC, "styles.css"), "utf8"));
  writeFileSync("styles.css", withTableCss(readFileSync("styles.css", "utf8"), css));
  console.log("synced gogoga-table → src/table, styles.css");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
