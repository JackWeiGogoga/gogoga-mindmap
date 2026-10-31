import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown, subtreeToList, unescapeNote } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";

// 列表项下包成 > [!note] 的备注，Obsidian 实时预览会把紧跟着的列表项（子节点、兄弟、上一层的下一项）
// 也算进标注块，所以后面空一行再接
const canon = (t: string) => serializeMarkdown(parseMarkdown(t, { fallbackTitle: "" }));

test("包成标注块的列表备注后面空一行：子节点、兄弟、上一层的下一项都隔开", () => {
  const doc = parseMarkdown("# T\n\n- 根\n\t- A\n\t- A 兄弟\n\t\t- 子\n\t- 上一层\n- 顶层\n\t- 顶层子\n", { fallbackTitle: "" });
  const [root, top] = doc.root.children;
  const [a, sib] = root.children;
  a.note = "- 列表备注";
  sib.children[0].note = "# 标题备注";
  top.note = "- y";
  const md = serializeMarkdown(doc);
  assert.equal(
    md,
    "# T\n\n- 根\n\t- A\n\t\t> [!note]\n\t\t> - 列表备注\n\n\t- A 兄弟\n\t\t- 子\n\t\t\t> [!note]\n\t\t\t> # 标题备注\n\n\t- 上一层\n- 顶层\n\t> [!note]\n\t> - y\n\n\t- 顶层子\n",
  );
  // 读回来结构、备注都不变，空行不进备注；再写一遍一字不差
  const back = parseMarkdown(md, { fallbackTitle: "" });
  assert.deepEqual(back.root.children[0].children.map((n) => n.text), ["A", "A 兄弟", "上一层"]);
  assert.equal(unescapeNote(back.root.children[0].children[0].note), "- 列表备注");
  assert.equal(unescapeNote(back.root.children[0].children[1].children[0].note), "# 标题备注");
  assert.deepEqual(back.root.children[1].children.map((n) => n.text), ["顶层子"]);
  assert.equal(serializeMarkdown(back), md);
});

test("普通备注不加空行；标注块备注在最后时文件末尾也不多空行", () => {
  const doc = parseMarkdown("- 甲\n\t- 乙\n- 丙\n", { fallbackTitle: "" });
  doc.root.children[0].note = "普通备注";
  doc.root.children[1].note = "- 列表";
  assert.equal(serializeMarkdown(doc), "- 甲\n\t普通备注\n\t- 乙\n- 丙\n\t> [!note]\n\t> - 列表\n");
});

test("已有笔记没有这个空行：没改到的地方原样保留", () => {
  const src = "# T\n\n- A\n\t- B\n\t\t> [!note]\n\t\t> - x\n\t- C\n- D\n";
  assert.equal(preserveFormat(src, canon(src), canon), src);
  const doc = parseMarkdown(src, { fallbackTitle: "" });
  doc.root.children[1].text = "D2";
  assert.equal(preserveFormat(src, serializeMarkdown(doc), canon), src.replace("- D\n", "- D2\n"));
});

test("复制节点：剪贴板里的标注块备注后面也空一行", () => {
  const doc = parseMarkdown("- A\n\t- B\n", { fallbackTitle: "" });
  doc.root.children[0].note = "- x";
  assert.equal(subtreeToList(doc.root.children[0]), "- A\n\t> [!note]\n\t> - x\n\n\t- B\n");
});
