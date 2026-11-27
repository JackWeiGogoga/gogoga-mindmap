import { test } from "node:test";
import assert from "node:assert/strict";
import { isEnhancingFrontmatter, parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";
import type { MindNode } from "../../src/model";

/** Enhancing Mindmap 写出来的文件：frontmatter 带空行，折叠的节点行尾是 ^id，二级以下是列表 */
const SRC = `---

mindmap-plugin: basic

---

# 项目计划

## 需求 ^k3j2a1
- 用户调研
	- 访谈 5 人
- 竞品分析

## 设计
- 原型
	- 低保真 ^p9x8
	- 高保真
`;
const find = (n: MindNode, t: string): MindNode | undefined => (n.text === t ? n : n.children.map((c) => find(c, t)).find(Boolean));
const canonical = (t: string) => serializeMarkdown(parseMarkdown(t));

test("认 frontmatter 里的 mindmap-plugin", () => {
  assert.equal(isEnhancingFrontmatter("---\n\nmindmap-plugin: basic\n\n---"), true);
  assert.equal(isEnhancingFrontmatter("---\nmindmap: true\n---"), false);
  assert.equal(isEnhancingFrontmatter("---\nmindmap-plugin: false\n---"), false);
  assert.equal(isEnhancingFrontmatter(""), false);
});

test("行尾 ^id 读成折叠，文字里不带 ^id", () => {
  const doc = parseMarkdown(SRC);
  assert.equal(doc.style.foldIds, true);
  const need = find(doc.root, "需求")!;
  assert.equal(need.folded, true);
  assert.equal(need.foldId, "k3j2a1");
  const low = find(doc.root, "低保真")!;
  assert.equal(low.folded, true);
  assert.equal(low.blockId, undefined);
  assert.equal(find(doc.root, "设计")!.folded, false);
  assert.equal(find(doc.root, "用户调研")!.parent, need);
});

test("没改过的文件写回一字不变", () => {
  assert.equal(serializeMarkdown(parseMarkdown(SRC)), SRC);
  assert.equal(preserveFormat(SRC, canonical(SRC), canonical), SRC);
});

test("展开去掉 ^id，折叠加 ^id，不写 %%fold%%；同一个节点再折叠沿用原来的 id", () => {
  const doc = parseMarkdown(SRC);
  find(doc.root, "需求")!.folded = false;
  find(doc.root, "原型")!.folded = true;
  const out = serializeMarkdown(doc);
  assert.match(out, /^## 需求$/m);
  assert.match(out, /^- 原型 \^[a-z0-9]+$/m);
  assert.doesNotMatch(out, /%%/);
  const again = parseMarkdown(out);
  assert.equal(find(again.root, "原型")!.folded, true);
  // 节点对象上记着 id：再写一遍还是那个 id，不会每次存盘都换
  const id = find(doc.root, "原型")!.foldId;
  assert.equal(serializeMarkdown(doc).includes(`- 原型 ^${id}`), true);
  find(doc.root, "需求")!.folded = true;
  assert.match(serializeMarkdown(doc), /^## 需求 \^k3j2a1$/m);
});

test("列表项原有的大写块 id 照旧是块 id；折叠时就用它", () => {
  const src = `---\nmindmap-plugin: basic\n---\n\n# 根\n\n## 甲\n- 乙 ^Ab12\n\t- 丙\n`;
  const doc = parseMarkdown(src);
  const b = find(doc.root, "乙")!;
  assert.equal(b.folded, false);
  assert.equal(b.blockId, "Ab12");
  assert.equal(serializeMarkdown(doc), src);
  b.folded = true;
  assert.match(serializeMarkdown(doc), /^- 乙 \^Ab12$/m);
});

test("颜色等其他标记照常写，只有折叠换成 ^id", () => {
  const doc = parseMarkdown(SRC);
  const n = find(doc.root, "低保真")!;
  n.color = "red";
  assert.match(serializeMarkdown(doc), /^\t- 低保真 %%red%% \^p9x8$/m);
  const back = find(parseMarkdown(serializeMarkdown(doc)).root, "低保真")!;
  assert.equal(back.color, "red");
  assert.equal(back.folded, true);
});

test("普通脑图文件：行尾 ^id 还是块 id，不当折叠", () => {
  const src = `---\nmindmap: true\n---\n\n# A\n\n## B ^abc\n- c ^def\n`;
  const doc = parseMarkdown(src);
  assert.equal(doc.style.foldIds, undefined);
  assert.equal(find(doc.root, "c")!.folded, false);
  assert.equal(find(doc.root, "c")!.blockId, "def");
  assert.equal(serializeMarkdown(doc), src);
});
