import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { addRootSibling } from "../../src/model";

// #27：中心主题是唯一的一级标题时给它加同级：再加一个一级标题，中心主题换成文件名
const opts = { fallbackTitle: "笔记名" };

test("加在后面：原来的一级标题和新的一级标题并列，子树不动", () => {
  const doc = parseMarkdown("# 甲\n\n## 甲1\n\n- 甲1a\n", opts);
  const n = addRootSibling(doc, "笔记名", true)!;
  n.text = "乙";
  assert.equal(doc.rootFromHeading, false);
  assert.equal(doc.root.text, "笔记名");
  assert.deepEqual(doc.root.children.map((c) => c.text), ["甲", "乙"]);
  const out = serializeMarkdown(doc);
  assert.equal(out, "# 甲\n\n## 甲1\n\n- 甲1a\n\n# 乙\n");
  const again = parseMarkdown(out, opts);
  assert.equal(again.rootFromHeading, false);
  assert.equal(again.root.text, "笔记名");
  assert.deepEqual(again.root.children.map((c) => c.text), ["甲", "乙"]);
  assert.deepEqual(again.root.children[0].children.map((c) => c.text), ["甲1"]);
});

test("加在前面（Shift+Enter）", () => {
  const doc = parseMarkdown("# 甲\n\n## 甲1\n", opts);
  addRootSibling(doc, "笔记名", false)!.text = "乙";
  assert.equal(serializeMarkdown(doc), "# 乙\n\n# 甲\n\n## 甲1\n");
});

test("深度跟着加一", () => {
  const doc = parseMarkdown("# 甲\n\n## 甲1\n\n- 甲1a\n", opts);
  addRootSibling(doc, "笔记名");
  const a = doc.root.children[0];
  assert.equal(a.depth, 1);
  assert.equal(a.children[0].depth, 2);
  assert.equal(a.children[0].children[0].depth, 3);
});

test("frontmatter、备注保留", () => {
  const src = "---\nmindmap: true\n---\n\n# 甲\n\n甲的备注\n\n## 甲1\n";
  const doc = parseMarkdown(src, opts);
  addRootSibling(doc, "笔记名")!.text = "乙";
  assert.equal(serializeMarkdown(doc), "---\nmindmap: true\n---\n\n# 甲\n\n甲的备注\n\n## 甲1\n\n# 乙\n");
});

test("中心主题不是一级标题、或下面有自由主题时不加", () => {
  assert.equal(addRootSibling(parseMarkdown("# 甲\n\n# 乙\n", opts), "笔记名"), null);
  assert.equal(addRootSibling(parseMarkdown("# 甲\n\n## 浮 %%float x=100 y=50%%\n", opts), "笔记名"), null);
});
