import assert from "node:assert/strict";
import test from "node:test";
import { lineOfPath, parseMarkdown, ParseOptions, pathAtLine, serializeMarkdown } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";
import { countHidden, hideNode, MindNode, moveNode, removeNode, walk } from "../../src/model";

const texts = (n: MindNode): string[] => n.children.map((c) => c.text);
const find = (root: MindNode, text: string): MindNode => {
  let hit: MindNode | null = null;
  walk(root, (n) => {
    if (!hit && n.text === text) hit = n;
  });
  assert.ok(hit, text);
  return hit;
};
/** 和视图保存时走同一条路：写出来再按原文的格式合并，没改的行原样留着 */
const save = (src: string, doc: ReturnType<typeof parseMarkdown>, opts: ParseOptions = {}) =>
  preserveFormat(src, serializeMarkdown(doc), (t) => serializeMarkdown(parseMarkdown(t, opts)));
const roundTrip = (src: string, opts: ParseOptions = {}) => {
  assert.equal(save(src, parseMarkdown(src, opts), opts), src);
  // 解析两次结果一致（写回的规范格式是稳定的）
  const once = serializeMarkdown(parseMarkdown(src, opts));
  assert.equal(serializeMarkdown(parseMarkdown(once, opts)), once);
};

const DOC = `# R

## A
- a1
- 秘密 %%hide%%
\t- 秘密的子节点
- a2

## 隐藏标题
%%hide%%
- h1

## B
- b1
`;

test("%%hide%%：节点连同子树不进树，写回原样", () => {
  const doc = parseMarkdown(DOC);
  assert.deepEqual(texts(doc.root), ["A", "B"]);
  assert.deepEqual(texts(find(doc.root, "A")), ["a1", "a2"]);
  assert.equal(countHidden(doc.root), 2);
  roundTrip(DOC);
  // 打开「显示隐藏的节点」：都在树里，带着 hidden
  const shown = parseMarkdown(DOC, { showHidden: true });
  assert.deepEqual(texts(shown.root), ["A", "隐藏标题", "B"]);
  assert.equal(find(shown.root, "秘密").hidden, true);
  roundTrip(DOC, { showHidden: true });
});

test("%%hide%%：排在第一个、最后一个、连着几个，都原位写回", () => {
  for (const src of [
    "# R\n- 第一 %%hide%%\n- 二\n- 三\n",
    "# R\n- 一\n- 二\n- 末 %%hide%%\n",
    "# R\n- 一\n- x %%hide%%\n- y %%hide red%%\n- 二\n",
    "# R\n- 全 %%hide%%\n- 都 %%hide%%\n",
  ]) {
    roundTrip(src);
  }
});

test("%%hide%%：挪动、删除它前面那个节点，隐藏的节点留在原位，不丢", () => {
  const src = "# R\n- 一\n- 二\n- 藏 %%hide%%\n- 三\n";
  const doc = parseMarkdown(src);
  moveNode(find(doc.root, "二"), doc.root, 3, doc.style);
  assert.equal(serializeMarkdown(doc), "# R\n- 一\n- 藏 %%hide%%\n- 三\n- 二\n");
  const doc2 = parseMarkdown(src);
  removeNode(find(doc2.root, "二"));
  assert.equal(serializeMarkdown(doc2), "# R\n- 一\n- 藏 %%hide%%\n- 三\n");
  const doc3 = parseMarkdown("# R\n- 一\n- 藏 %%hide%%\n");
  removeNode(find(doc3.root, "一"));
  assert.equal(serializeMarkdown(doc3), "# R\n- 藏 %%hide%%\n");
});

test("右键隐藏：打上标记、从树里摘掉，外框少罩一个", () => {
  const doc = parseMarkdown("# R\n- 一 %%box=3%%\n- 二\n- 三\n");
  hideNode(find(doc.root, "二"));
  assert.deepEqual(texts(doc.root), ["一", "三"]);
  assert.equal(find(doc.root, "一").box?.span, 2);
  assert.equal(serializeMarkdown(doc), "# R\n- 一 %%box=2%%\n- 二 %%hide%%\n- 三\n");
});

test("%%hide%%：外框跨度里夹着隐藏节点，没改过就原样写回", () => {
  const src = "# R\n- 一 %%box=3 \"组\"%%\n- 藏 %%hide%%\n- 二\n- 三\n";
  const doc = parseMarkdown(src);
  assert.equal(find(doc.root, "一").box?.span, 2);
  assert.equal(serializeMarkdown(doc), src);
});

test("%%hide%%：最高一级的标题全隐藏，写回的级别不变；行号和路径照可见的树算", () => {
  roundTrip("## 藏 %%hide%%\n### 子\n## 二\n");
  const src = "# R\n- 一\n- 藏 %%hide%%\n  藏的备注\n- 二\n";
  assert.equal(lineOfPath(src, "1"), 4);
  assert.equal(pathAtLine(src, 3), "0");
});

const HEADINGS = `# 读书笔记

前言一段。

## 第一章
- 要点一
\t- 细节
- 要点二 %%red%%

1. 有序
2. 列表

### 1.1 小节
- 列表

## 第二章
正文
`;

test("只把标题当节点：列表算进标题的备注，写回一字不动", () => {
  const doc = parseMarkdown(HEADINGS, { headingsOnly: true });
  assert.deepEqual(texts(doc.root), ["第一章", "第二章"]);
  assert.deepEqual(texts(find(doc.root, "第一章")), ["1.1 小节"]);
  assert.ok(find(doc.root, "第一章").note.includes("- 要点一\n\t- 细节"));
  roundTrip(HEADINGS, { headingsOnly: true });
  // 和隐藏一起用
  roundTrip("# R\n## 藏 %%hide%%\n- x\n## 看得见\n- y\n", { headingsOnly: true });
  // 行号互查用同一套规则
  assert.equal(lineOfPath(HEADINGS, "0/0", { headingsOnly: true }), 12);
  assert.equal(pathAtLine(HEADINGS, 6, { headingsOnly: true }), "0");
});

test("编辑后保存只动改了的那一行：只认标题时改标题名、有隐藏节点时改别的节点", () => {
  const opts = { headingsOnly: true };
  const doc = parseMarkdown(HEADINGS, opts);
  find(doc.root, "第二章").text = "第二章 改";
  assert.equal(save(HEADINGS, doc, opts), HEADINGS.replace("## 第二章\n", "## 第二章 改\n"));
  const doc2 = parseMarkdown(DOC);
  find(doc2.root, "a2").text = "a2 改";
  assert.equal(save(DOC, doc2), DOC.replace("- a2\n", "- a2 改\n"));
  // 显示隐藏节点时取消隐藏：只去掉那一处标记
  const doc3 = parseMarkdown(DOC, { showHidden: true });
  find(doc3.root, "秘密").hidden = false;
  assert.equal(save(DOC, doc3, { showHidden: true }), DOC.replace("- 秘密 %%hide%%\n", "- 秘密\n"));
});
