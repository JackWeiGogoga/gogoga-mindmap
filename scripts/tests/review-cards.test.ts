/**
 * 间隔复习的题目来源（脑图）：三种写法生成卡片、只加入分支、补卡片 id（复制出来的重复 id 换新）、标记读写不改动别的内容
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { assignReviewIds, crumbOf, deckIdOf, displayText, extractCards, hasCloze, isMultiChoice } from "../../src/review/mindmap-cards";

const MAP = `---
mindmap: true
mindmap-review: k3j9x2
---

# 第2章 细胞的结构

## 细胞膜

- 主要成分：==磷脂==和==蛋白质==
- 结构特点：具有一定的<mark style="background:#ff8fab99">流动性</mark>

## 细胞器

- 光合作用的场所
\t- 🙈 叶绿体
\t\t- 双层膜，==类囊体==堆叠成基粒
- 下列属于原核生物的是
\t- [x] 蓝细菌
\t- [ ] 酵母菌
\t- [x] 大肠杆菌
\t\t- ==没有==成形的细胞核
`;

const parse = (s: string) => parseMarkdown(s, { fallbackTitle: "x" });
const kinds = (s: string) => extractCards(parse(s)).map((c) => `${c.kind}:${displayText(c.node.text)}`);

test("三种写法：填空、问答（🙈）、选择题；答案和选项下面的高亮不单独出", () => {
  assert.deepEqual(kinds(MAP), ["cloze:主要成分：==磷脂==和==蛋白质==", 'cloze:结构特点：具有一定的<mark style="background:#ff8fab99">流动性</mark>', "answer:叶绿体", "choice:下列属于原核生物的是"]);
  assert.equal(isMultiChoice(extractCards(parse(MAP))[3].node), true);
});

test("高亮判断：==x==、<mark>；不认空的和 ===", () => {
  assert.ok(hasCloze("a ==b== c"));
  assert.ok(hasCloze("<mark>x</mark>"));
  assert.ok(!hasCloze("a == b"));
  assert.ok(!hasCloze("没有高亮"));
});

test("frontmatter 里的牌组 id", () => {
  assert.equal(deckIdOf("---\nmindmap-review: k3j9x2\n---"), "k3j9x2");
  assert.equal(deckIdOf("---\nmindmap-review: true\n---"), "");
  assert.equal(deckIdOf("---\nmindmap-review: false\n---"), null);
  assert.equal(deckIdOf("---\nmindmap: true\n---"), null);
});

test("只加入分支：只出写了 %%review%% 的分支里的题", () => {
  const src = MAP.replace("## 细胞器", "## 细胞器 %%review%%");
  assert.deepEqual(kinds(src), ["answer:叶绿体", "choice:下列属于原核生物的是"]);
});

test("补卡片 id：每个出题节点一个 rv，写回只多了标记；同一个节点两张卡共用一个", () => {
  const src = MAP.replace("- 光合作用的场所", "- 光合作用的==场所==");
  const doc = parse(src);
  assert.ok(assignReviewIds(doc));
  const cards = extractCards(doc);
  assert.ok(cards.every((c) => c.id));
  // 光合作用的==场所== 只有填空一张卡（它下面是 🙈，不是选择题）
  const out = serializeMarkdown(doc);
  const rvs = [...out.matchAll(/%%rv=([a-z0-9]{6})%%/g)].map((m) => m[1]);
  assert.equal(rvs.length, 5);
  // 去掉 rv 标记后和原文一样
  assert.equal(out.replace(/ %%rv=[a-z0-9]{6}%%/g, "").replace(/\n%%rv=[a-z0-9]{6}%%/g, ""), serializeMarkdown(parse(src)));
  // 再读回来 id 都在、再补一次不改
  const again = parse(out);
  assert.equal(assignReviewIds(again), false);
  assert.deepEqual(extractCards(again).map((c) => c.id), cards.map((c) => c.id));
});

test("复制粘贴出来的重复 rv：后面那个换新的，前面的排期不丢", () => {
  const src = "# 图\n\n- 甲 ==一== %%rv=aaaaaa%%\n- 乙 ==二== %%rv=aaaaaa%%\n";
  const doc = parse(src);
  assert.deepEqual(extractCards(doc).map((c) => c.id), ["aaaaaa:c", null]);
  assignReviewIds(doc);
  const ids = extractCards(doc).map((c) => c.id);
  assert.equal(ids[0], "aaaaaa:c");
  assert.ok(ids[1] && ids[1] !== "aaaaaa:c");
});

test("rv、review 和别的标记写在一起；不认识的值当普通文字", () => {
  const doc = parse("# 图\n\n- 甲 ==一== %%red rv=abcdef review%%\n- 乙 %%rv=XYZ!%%\n");
  const [a, b] = doc.root.children;
  assert.equal(a.reviewId, "abcdef");
  assert.equal(a.review, true);
  assert.equal(a.color, "red");
  assert.equal(b.reviewId, undefined);
  assert.match(serializeMarkdown(doc), /- 甲 ==一== %%red review rv=abcdef%%/);
});

test("路径：中心主题到上级", () => {
  const c = extractCards(parse(MAP))[2];
  assert.deepEqual(crumbOf(c.node), ["第2章 细胞的结构", "细胞器", "光合作用的场所"]);
});
