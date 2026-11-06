import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { PARTS, TABLE_SRC, tableCss } from "../sync-table.mjs";

// 只在两个仓库并排放着时检查（CI 里只有脑图仓库，跳过）
test("节点表格的代码和 gogoga-table 同步（改了表格插件要跑 node scripts/sync-table.mjs）", { skip: !existsSync(path.join(TABLE_SRC as string, "src", "core")) }, () => {
  for (const part of PARTS as string[]) {
    const from = path.join(TABLE_SRC as string, "src", part);
    for (const f of readdirSync(from).filter((x) => x.endsWith(".ts"))) {
      assert.equal(readFileSync(path.join("src/table", part, f), "utf8"), readFileSync(path.join(from, f), "utf8"), `src/table/${part}/${f} 没同步`);
    }
  }
  const css = (tableCss as (s: string) => string)(readFileSync(path.join(TABLE_SRC as string, "styles.css"), "utf8"));
  assert.ok(readFileSync("styles.css", "utf8").includes(css), "styles.css 里的表格样式没同步");
});
