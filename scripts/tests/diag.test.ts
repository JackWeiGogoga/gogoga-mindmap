import assert from "node:assert/strict";
import test from "node:test";
import { anomalyOf, damageScore, hashText, lineDelta } from "../../src/diag";

const NOTE = [
  "- 考点一 综合改革——《1944年教育法》 <br>★★★【选；论】 %%fold%%",
  '\t- <span style="color:#e03e3e">(一) 简介：</span>“二战”期间，“人人受中等教育”的观念深入人心。',
  '\t\t- <span style="color:#e03e3e">1. 加强国家对教育的领导</span>。废除教育委员会，<mark style="background:#ffd43b99">设立教育部</mark>，统一领导全国的教育。',
  '\t\t- <span style="color:#e03e3e">2. 加强地方行政管理权限</span>。地方当局设立由<mark style="background:#ffd43b99">初等教育、中等教育和继续教育</mark>组成的公共教育系统。',
  '\t\t- <span style="color:#e03e3e">3. 延长义务教育</span>。实施5～15岁的义务教育，<mark style="background:#ffd43b99">提供全日制教育和业余教育</mark>。',
].join("\n");
// 群友笔记被拼坏的样子：别的行的开头拼进行中间、标签被切断
const GARBLED = [
  "- 考点一 综合改革——《1944年教育法》 <br>★★★【选；论】 %%fold%%",
  '\t- <span style="color:#e03e3e">(一) 简介：</span>“二战”期间，“人人受中等教育”的观念深入人心。',
  '\t\t- <span style="color:#e03e3e">2. 加强地方行政管理权限</span>。地方当局设立由<mark style="background:#ff\t\t- 99">初等教育、中等教育和继。为义务教育公共教育系统</mark>。',
  "\t\t- <span styl。为义务教育or:#e03e3e提供全日制教育和业余教育，中等学校一律实施an>。为义务教育<mark提供全日制教育\t\t- ark>提供全日制教育<mar。",
  "\t\t- 主体</m。该法案还提出了宗教教育。y\t- 凯程助记：教育和高等教育改革等\t\t- 两加强一延长",
].join("\n");

test("摘要：同样的内容同样的摘要，差一个字就不同", () => {
  assert.equal(hashText(NOTE), hashText(NOTE));
  assert.notEqual(hashText(NOTE), hashText(NOTE + " "));
  assert.equal(hashText("").length, 8);
});

test("异常：变空、一次少三成以上、拼坏都算；正常改几个字、加内容、本来就短的笔记删掉不算", () => {
  assert.equal(anomalyOf(NOTE, ""), "empty");
  assert.equal(anomalyOf(NOTE, "   \n"), "empty");
  assert.equal(anomalyOf(NOTE, NOTE.slice(0, Math.floor(NOTE.length / 2))), "shrink");
  assert.equal(anomalyOf(NOTE, GARBLED), "damage");
  assert.equal(anomalyOf(NOTE, NOTE.replace("设立教育部", "设立教育部（改）")), null);
  assert.equal(anomalyOf(NOTE, NOTE + "\n- 新的一条"), null);
  assert.equal(anomalyOf("- 甲\n- 乙", ""), "empty");
  assert.equal(anomalyOf("- 甲\n- 乙\n- 丙", "- 甲"), null, "短笔记删几行不算大幅删减");
  assert.equal(anomalyOf(null, ""), null, "没有之前的内容（刚打开）不判断");
  assert.equal(anomalyOf("", ""), null);
});

test("拼坏的特征分：正常笔记是 0，正在打的一个标签只加一点，拼坏的一大截", () => {
  assert.equal(damageScore(NOTE), 0);
  assert.equal(damageScore(NOTE + '\n- <span style="color:red">还没打完'), 1);
  assert.ok(damageScore(GARBLED) >= 5, String(damageScore(GARBLED)));
  assert.equal(damageScore("| a\t| b |\n| --- | --- |"), 0, "表格里的 Tab 不算");
});

test("改了几行：按行计数，顺序不管", () => {
  assert.deepEqual(lineDelta("a\nb\nc", "a\nb\nc"), { add: 0, del: 0 });
  assert.deepEqual(lineDelta("a\nb\nc", "a\nB\nc\nd"), { add: 2, del: 1 });
  assert.deepEqual(lineDelta("a\nb", "b\na"), { add: 0, del: 0 });
});

test("诊断：Templater 展开模板不算一次少三成，展开时真删了正文还是算", () => {
  const before = `---\ntype: diary\n---\n# <% moment(tp.file.title, "YYYY-MM-DD").format("YYYY年MM月DD日 dddd") %>\n\n← [[diary/<% tp.date.now("YYYY/MM/YYYY-MM-DD", -1, tp.file.title, "YYYY-MM-DD") %>|<% tp.date.now("YYYY-MM-DD", -1, tp.file.title, "YYYY-MM-DD") %>]] | [[diary/<% tp.date.now("YYYY/MM/YYYY-MM-DD", 1, tp.file.title, "YYYY-MM-DD") %>|<% tp.date.now("YYYY-MM-DD", 1, tp.file.title, "YYYY-MM-DD") %>]] →\n\n## 今日目标\n\n- [ ] <% tp.file.cursor() %>\n\n## 值得沉淀\n\n- \n`;
  const after = `---\ntype: diary\n---\n# 2026年11月26日 星期四\n\n← [[diary/2026/11/2026-11-25|2026-11-25]] | [[diary/2026/11/2026-11-27|2026-11-27]] →\n\n## 今日目标\n\n- [ ] <% tp.file.cursor() %>\n\n## 值得沉淀\n\n- \n`;
  assert.ok(before.length >= 200 && after.length < before.length * 0.7);
  assert.equal(anomalyOf(before, after), null);
  // 模板写法之外的正文也大段没了：照样报
  const body = before + "正文".repeat(200);
  assert.equal(anomalyOf(body, after), "shrink");
  // 没有模板写法的删减不受影响
  assert.equal(anomalyOf("甲".repeat(300), "甲".repeat(100)), "shrink");
});
