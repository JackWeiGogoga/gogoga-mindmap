import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { releaseNotes, sectionOf } from "../release-notes.mjs";

const zh = readFileSync("CHANGELOG.zh-CN.md", "utf8");
const en = readFileSync("CHANGELOG.md", "utf8");
const versions = (s: string) => [...s.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);

test("更新日志：当前版本两种语言都写了（发版前必须先写）", () => {
  const { version } = JSON.parse(readFileSync("manifest.json", "utf8")) as { version: string };
  assert.ok(sectionOf(zh, version), `CHANGELOG.zh-CN.md 缺 ${version}`);
  assert.ok(sectionOf(en, version), `CHANGELOG.md 缺 ${version}`);
  assert.ok(releaseNotes(version, zh, en));
});

test("更新日志：中英文版本一一对应，都有比较链接", () => {
  assert.deepEqual(versions(zh), versions(en));
  for (const v of versions(en)) {
    assert.match(en, new RegExp(`^\\[${v.replace(/\./g, "\\.")}\\]: https://`, "m"), `CHANGELOG.md 缺 ${v} 的链接`);
    assert.match(zh, new RegExp(`^\\[${v.replace(/\./g, "\\.")}\\]: https://`, "m"), `CHANGELOG.zh-CN.md 缺 ${v} 的链接`);
  }
});
