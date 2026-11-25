import assert from "node:assert/strict";
import test from "node:test";
import { cmpVersion, pendingNotes, type WhatsNewEntry } from "../../src/whatsnew-core";
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { generate, sections } from "../gen-whatsnew.mjs";

const N = (v: string): WhatsNewEntry => ({ version: v, date: "2026-11-25", zh: v, en: v });
const ALL = ["0.98.0", "0.97.0", "0.96.0", "0.95.0"].map(N);

test("比版本号：按数字比，不按字符串", () => {
  assert.ok(cmpVersion("0.98.0", "0.97.0") > 0);
  assert.ok(cmpVersion("0.100.0", "0.99.9") > 0);
  assert.ok(cmpVersion("1.0.0", "0.99.0") > 0);
  assert.equal(cmpVersion("0.98.0", "0.98.0"), 0);
  assert.ok(cmpVersion("0.98", "0.98.1") < 0);
});

test("该提示哪些版本", () => {
  assert.deepEqual(pendingNotes(ALL, "0.97.0", "0.98.0", false).map((n) => n.version), ["0.98.0"], "更新一版：只提示这一版");
  assert.deepEqual(pendingNotes(ALL, "0.95.0", "0.98.0", false).map((n) => n.version), ["0.98.0", "0.97.0", "0.96.0"], "隔了几版：这期间的都列出来，新的在前");
  assert.deepEqual(pendingNotes(ALL, "0.98.0", "0.98.0", false), [], "没更新：不提示");
  assert.deepEqual(pendingNotes(ALL, undefined, "0.98.0", true), [], "新装：不提示");
  assert.deepEqual(pendingNotes(ALL, undefined, "0.98.0", false).map((n) => n.version), ["0.98.0"], "老用户第一次装上带这个功能的版本：只提示当前这一版");
  assert.deepEqual(pendingNotes(ALL, "0.98.0", "0.97.0", false), [], "降级：不提示");
  assert.deepEqual(pendingNotes(ALL, "0.98.0", "0.99.0", false), [], "当前版本不在列表里：没东西可看就不提示");
});

test("从 CHANGELOG 取版本：跳过 Unreleased，到下一个版本或底部链接为止；英文按版本号配上", () => {
  const zh = "# 更新日志\n\n## [Unreleased]\n\n## [0.98.0] - 2026-11-25\n\n### 新增\n- 甲\n\n## [0.97.0] - 2026-11-24\n\n### 修复\n- 乙\n\n[Unreleased]: https://x/compare/0.98.0...HEAD\n[0.98.0]: https://x/compare/0.97.0...0.98.0\n";
  const en = "# Changelog\n\n## [Unreleased]\n\n## [0.98.0] - 2026-11-25\n\n### Added\n- A\n\n## [0.97.0] - 2026-11-24\n\n### Fixed\n- B\n\n[Unreleased]: https://x\n";
  const s = sections(zh) as { version: string; date: string; body: string }[];
  assert.deepEqual(s.map((x) => x.version), ["0.98.0", "0.97.0"]);
  assert.equal(s[0].body, "### 新增\n- 甲");
  assert.equal(s[1].body, "### 修复\n- 乙", "最后一个版本不带底部的链接");
  const out = generate(zh, en, 1) as string;
  assert.ok(out.includes('"version": "0.98.0"') && !out.includes("0.97.0"), "只留最近 keep 个");
  assert.ok(out.includes("### Added\\n- A"));
});

test("提示里的亮点：取「新增」各条冒号前的几个字，去掉括号补充，最多三条；隔了几版只说几个版本", async () => {
  const { highlights } = await import("../../src/whatsnew-core");
  const one = (zh: string, en: string): WhatsNewEntry[] => [{ version: "0.98.0", date: "", zh, en }];
  assert.equal(
    highlights(one("### 新增\n- 诊断记录（只在电脑端，设置 →「诊断」）：笔记突然变空……\n- 更新后提示更新内容：插件更新后……\n- 右键菜单「拉成一行」：选中的节点……\n- 第四条：不显示\n\n### 修复\n- 某个修复：……", ""), "zh"),
    "新增：诊断记录、更新后提示更新内容、右键菜单「拉成一行」",
  );
  assert.equal(highlights(one("", "### Added\n- Diagnostics (desktop only): if a note…\n- What's new after updating: after the plugin…"), "en"), "Added: Diagnostics, What's new after updating");
  assert.equal(highlights(one("### 修复\n- 用 Minimal 主题并关掉「表格样式优先于主题」时，竖着合并格子后：……", ""), "zh"), "修复：用 Minimal 主题并…", "没有新增就用修复；太长截断（最多 14 个字）");
  assert.equal(highlights([...one("x", "x"), ...one("y", "y")], "zh"), "包含 2 个版本的更新");
  assert.equal(highlights([], "zh"), "");
});
