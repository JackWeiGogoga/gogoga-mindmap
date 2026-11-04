import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";
import { addChild, addSibling, MindDoc, MindNode } from "../../src/model";

const canon = (s: string) => serializeMarkdown(parseMarkdown(s, { fallbackTitle: "t" }));
const last = (doc: MindDoc): MindNode => doc.root.children[doc.root.children.length - 1];

/** 在脑图里做一步编辑再按保留格式写回，和插件里一样 */
function edit(src: string, change: (doc: MindDoc) => void): string {
  const doc = parseMarkdown(src, { fallbackTitle: "t" });
  change(doc);
  return preserveFormat(src, serializeMarkdown(doc), canon);
}

/** 连续新增：同级、子级、同级（qiang哥儿反馈的操作） */
function addThree(src: string): string {
  let cur = edit(src, (d) => addSibling(last(d), "新增一"));
  cur = edit(cur, (d) => addChild(last(d), d.style, "新增子主题"));
  return edit(cur, (d) => addSibling(last(d), "新增二"));
}

test("标题紧挨着写的笔记：新增的标题也紧挨着，不插空行", () => {
  const src = "# 测试\n\n## 主题 1\n## 主题 2\n### 子主题\n";
  assert.equal(addThree(src), `${src}## 新增一\n### 新增子主题\n## 新增二\n`);
});

test("标题之间空一行的笔记（插件新建的就是这样）：新增的照旧空一行", () => {
  const src = "# 测试\n\n## 主题 1\n\n## 主题 2\n\n### 子主题\n";
  assert.equal(addThree(src), `${src}\n## 新增一\n\n### 新增子主题\n\n## 新增二\n`);
});

test("紧凑写法里：中心主题后面、备注后面的标题照样空一行", () => {
  const doc = parseMarkdown("# 根\n## A\n## B\n");
  doc.root.children[0].note = "备注";
  addSibling(last(doc), "C");
  assert.equal(serializeMarkdown(doc), "# 根\n\n## A\n\n备注\n\n## B\n## C\n");
});

test("两种写法一样多时按插件原来的写法空一行", () => {
  assert.equal(parseMarkdown("# 根\n\n## A\n## B\n\n## C\n").style.blankBeforeHeading, true);
  assert.equal(parseMarkdown("# 根\n\n## A\n## B\n## C\n\n## D\n").style.blankBeforeHeading, false);
});

test("原文结尾没有换行：新增节点后也不补", () => {
  for (const src of ["# 根\n\n## A", "# 根\n- A"]) {
    const out = edit(src, (d) => addSibling(last(d), "新"));
    assert.ok(out.includes("新"), out);
    assert.ok(!out.endsWith("\n"), JSON.stringify(out));
  }
});

test("整篇 \\r\\n 的笔记：各种写回都保持 \\r\\n", () => {
  // 插件格式的原文（直接用新文本的那条路）和需要合并的原文都要换回去
  for (const src of ["# 根\r\n\r\n## A\r\n", "# 根\r\n## A\r\n  - a\r\n"]) {
    const out = edit(src, (d) => addSibling(last(d), "新"));
    assert.ok(out.includes("新"), out);
    assert.ok(!/(^|[^\r])\n/.test(out), JSON.stringify(out));
  }
});
