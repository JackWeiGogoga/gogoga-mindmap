import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, quoteListNote, serializeMarkdown, unquoteListNote } from "../../src/markdown";

// 设置「列表项下的备注写成引用块」：列表项的备注每行前加 > 写回，读的时候去掉一层
const on = { fallbackTitle: "", quoteListNotes: true };
const off = { fallbackTitle: "" };

test("设置关着：读写和以前一样，> 原样算进备注", () => {
  const src = "# T\n\n- 甲\n\t> 引用一\n\t> 引用二\n- 乙\n\t普通备注\n";
  const doc = parseMarkdown(src, off);
  assert.equal(doc.root.children[0].note, "> 引用一\n> 引用二");
  assert.equal(doc.root.children[1].note, "普通备注");
  assert.equal(serializeMarkdown(doc), src);
});

test("设置打开：写回时列表项备注每行前加 >，空行写成 >，后面空一行", () => {
  const doc = parseMarkdown("# T\n\n- 甲\n\t- 子\n- 乙\n", on);
  doc.root.children[0].note = "第一段\n第二行\n\n第二段";
  assert.equal(serializeMarkdown(doc), "# T\n\n- 甲\n\t> 第一段\n\t> 第二行\n\t>\n\t> 第二段\n\n\t- 子\n- 乙\n");
});

test("设置打开：读进来去掉一层 >，再写一遍一字不差", () => {
  const src = "# T\n\n- 甲\n\t> 第一段\n\t> 第二行\n\t>\n\t> 第二段\n\n\t- 子\n- 乙\n";
  const doc = parseMarkdown(src, on);
  assert.equal(doc.root.children[0].note, "第一段\n第二行\n\n第二段");
  assert.deepEqual(doc.root.children[0].children.map((n) => n.text), ["子"]);
  assert.equal(serializeMarkdown(doc), src);
});

test("设置打开：没加 > 的旧备注读进来照旧，改了才写成引用块", () => {
  const src = "# T\n\n- 甲\n\t旧备注\n- 乙\n";
  const doc = parseMarkdown(src, on);
  assert.equal(doc.root.children[0].note, "旧备注");
  assert.equal(serializeMarkdown(doc), "# T\n\n- 甲\n\t> 旧备注\n\n- 乙\n");
});

test("标注块、整段包成 > [!note] 的、节点表格、标题下的备注都不动", () => {
  assert.equal(quoteListNote("> [!tip] 提示\n> 正文"), "> [!tip] 提示\n> 正文");
  assert.equal(unquoteListNote("> [!tip] 提示\n> 正文"), "> [!tip] 提示\n> 正文");
  const doc = parseMarkdown("# T\n\n## 标题\n\n- 甲\n", on);
  doc.root.children[0].note = "标题下的备注";
  doc.root.children[0].children[0].note = "- 备注里的列表";
  const md = serializeMarkdown(doc);
  assert.ok(md.includes("## 标题\n\n标题下的备注"), md);
  assert.ok(md.includes("\t> [!note]\n\t> - 备注里的列表\n"), md);
  const back = parseMarkdown(md, on);
  assert.equal(back.root.children[0].children[0].note, "> [!note]\n> - 备注里的列表");
  assert.equal(serializeMarkdown(back), md);
});

test("本来就是引用的备注：多套一层，读回来还是引用，来回稳定", () => {
  const doc = parseMarkdown("# T\n\n- 甲\n", on);
  doc.root.children[0].note = "> 原本就是引用\n说明";
  const md = serializeMarkdown(doc);
  assert.ok(md.includes("\t> > 原本就是引用\n\t> 说明\n"), md);
  const back = parseMarkdown(md, on);
  assert.equal(back.root.children[0].note, "> 原本就是引用\n说明");
  assert.equal(serializeMarkdown(back), md);
});

test("合并写回后补空行：只补改过的引用块，没碰过的旧引用块不动", async () => {
  const { blankAfterQuotedNotes } = await import("../../src/markdown");
  const original = "- 甲\n\t旧备注\n- 乙\n\t> 手写的引用\n\t- 乙子\n";
  const merged = "- 甲\n\t> 旧备注，改了\n- 乙\n\t> 手写的引用\n\t- 乙子\n";
  assert.equal(blankAfterQuotedNotes(merged, original), "- 甲\n\t> 旧备注，改了\n\n- 乙\n\t> 手写的引用\n\t- 乙子\n");
  // 后面紧跟的是新加的列表项也补
  assert.equal(blankAfterQuotedNotes("- 甲\n\t> 引用\n- 新加的\n", "- 甲\n\t> 引用\n"), "- 甲\n\t> 引用\n\n- 新加的\n");
  // 代码块里不管
  assert.equal(blankAfterQuotedNotes("```\n\t> x\n- y\n```\n", ""), "```\n\t> x\n- y\n```\n");
});
