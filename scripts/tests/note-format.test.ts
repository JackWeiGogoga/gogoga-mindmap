import assert from "node:assert/strict";
import test from "node:test";
import { formatLines } from "../../src/note-lines";
import { splitNoteTables } from "../../src/node-table";

// 备注里上格式：按行分开套，跳过行首的列表、引用、标题记号；没选字不动
const sel = (text: string, part: string) => {
  const from = text.indexOf(part);
  return [from, from + part.length] as const;
};

test("一行里选一段：只包这一段，选区跟着", () => {
  const text = "前面要记的内容后面";
  const [a, b] = sel(text, "要记的内容");
  const r = formatLines(text, a, b, { kind: "highlight" })!;
  assert.equal(r.text, "前面==要记的内容==后面");
  assert.equal(r.text.slice(r.start, r.end), "要记的内容");
});

test("跨行选中：每行各包一层，不跨行", () => {
  const text = "第一行文字\n第二行文字";
  const r = formatLines(text, 2, text.length - 1, { kind: "bold" })!;
  assert.equal(r.text, "第一**行文字**\n**第二行文**字");
});

test("行首的列表、任务框、编号、引用、标题记号不包进去", () => {
  const text = "- 甲\n- [ ] 乙\n1. 丙\n> 丁\n## 戊";
  const r = formatLines(text, 0, text.length, { kind: "highlight" })!;
  assert.equal(r.text, "- ==甲==\n- [ ] ==乙==\n1. ==丙==\n> ==丁==\n## ==戊==");
});

test("空行、只有记号的行跳过", () => {
  const text = "甲\n\n- \n乙";
  const r = formatLines(text, 0, text.length, { kind: "bold" })!;
  assert.equal(r.text, "**甲**\n\n- \n**乙**");
});

test("文字颜色、荧光笔颜色写成和节点一样的标签", () => {
  const text = "重点";
  assert.equal(formatLines(text, 0, 2, { kind: "color", color: "#e03e3e" })!.text, '<span style="color:#e03e3e">重点</span>');
  assert.equal(formatLines(text, 0, 2, { kind: "bg", color: "#ffd43b99" })!.text, '<mark style="background:#ffd43b99">重点</mark>');
});

test("没选字：不动（不给整段备注上格式）", () => {
  assert.equal(formatLines("一段备注\n两行", 3, 3, { kind: "bold" }), null);
});

test("再按一次：去掉格式", () => {
  const text = "前==重点==后";
  const [a, b] = sel(text, "重点");
  assert.equal(formatLines(text, a, b, { kind: "highlight" })!.text, "前重点后");
});

// 备注里的表格：顶格的单独画（和节点表格一个样子，合并单元格也显示得出来），列表里的留给 Obsidian
const TABLE = ["| a | b |", "| --- | --- |", "| 合并 |  |", '<!-- gogoga-table: {"merge":["A2:B2"]} -->'];

test("没有表格：整段一起渲染", () => {
  assert.deepEqual(splitNoteTables("只有文字"), [{ md: "只有文字" }]);
  assert.deepEqual(splitNoteTables("a | b 不是表格"), [{ md: "a | b 不是表格" }]);
});

test("没有 gogoga-table 注释的普通表格也拆出来画", () => {
  const parts = splitNoteTables("文字\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { md: "文字\n" });
  assert.ok("table" in parts[1] && parts[1].table.cells[1][0] === "1", JSON.stringify(parts[1]));
});

test("带注释的表格拆出来，前后文字各一段，注释不进文字", () => {
  const parts = splitNoteTables(["上面", "", ...TABLE, "", "下面"].join("\n"));
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0], { md: "上面\n" });
  assert.ok("table" in parts[1]);
  assert.deepEqual(parts[2], { md: "\n下面" });
  assert.ok(!JSON.stringify(parts[0]).includes("gogoga-table") && !JSON.stringify(parts[2]).includes("gogoga-table"));
});

test("拆出来的表格带着合并信息", () => {
  const parts = splitNoteTables(TABLE.join("\n"));
  assert.equal(parts.length, 1);
  const p = parts[0];
  assert.ok("table" in p && JSON.stringify(p.table.meta.merge) === '["A2:B2"]', JSON.stringify(p));
});

test("列表里缩进的表格不拆（拆了列表会断开）", () => {
  const md = ["- 项", "", ...TABLE.map((l) => "\t" + l)].join("\n");
  assert.deepEqual(splitNoteTables(md), [{ md }]);
});
