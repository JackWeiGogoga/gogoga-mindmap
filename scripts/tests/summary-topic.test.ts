import assert from "node:assert/strict";
import test from "node:test";
import { lineOfPath, parseClipboard, parseMarkdown, pathAtLine, serializeMarkdown, subtreeToList } from "../../src/markdown";
import {
  addSibling,
  cloneTree,
  findByPath,
  hideNode,
  insertParents,
  isSummaryTopic,
  moveNode,
  pathOf,
  removeNode,
  removeNodeKeepChildren,
  setGroupRange,
  walkAll,
  walkMap,
  type MindNode,
} from "../../src/model";

const roundTrip = (src: string) => serializeMarkdown(parseMarkdown(src));
const kids = (n: MindNode) => n.children.map((c) => c.text);

const LIST = `# 根

## 装备
- 防潮垫
	- 垫1
	- 垫2
	- 注意事项 %%summary-topic=2%%
		- 钱注意安全
		- 人注意安全
- 头灯
`;

test("列表里的概要主题：原样往返，挂在起始节点上、不在兄弟里", () => {
  assert.equal(roundTrip(LIST), LIST);
  const doc = parseMarkdown(LIST);
  const pad = doc.root.children[0].children[0];
  assert.deepEqual(kids(pad), ["垫1", "垫2"]);
  const t = pad.children[0].summary?.topic;
  assert.ok(t);
  assert.equal(t.text, "注意事项");
  assert.deepEqual(kids(t), ["钱注意安全", "人注意安全"]);
  assert.equal(pad.children[0].summary!.span, 2);
  assert.ok(isSummaryTopic(t));
  assert.equal(t.parent, pad);
  assert.equal(t.depth, pad.depth + 1);
  assert.equal(t.children[0].depth, pad.depth + 2);
});

test("标题里的概要主题：原样往返", () => {
  const src = `# 根

## 甲
- a

## 乙

## 小结
%%summary-topic=2%%
- 一
- 二

## 丙
`;
  assert.equal(roundTrip(src), src);
  const doc = parseMarkdown(src);
  assert.deepEqual(kids(doc.root), ["甲", "乙", "丙"]);
  assert.equal(doc.root.children[0].summary?.topic?.text, "小结");
});

test("路径、行号：概要主题用 s 开头的路径，和行号互查", () => {
  const doc = parseMarkdown(LIST);
  const t = doc.root.children[0].children[0].children[0].summary!.topic!;
  assert.equal(pathOf(t), "0/0/s0");
  assert.equal(pathOf(t.children[1]), "0/0/s0/1");
  assert.equal(findByPath(doc.root, "0/0/s0/1"), t.children[1]);
  assert.equal(findByPath(doc.root, "0/0/s1"), null);
  const lines = LIST.split("\n");
  assert.equal(lineOfPath(LIST, "0/0/s0"), lines.indexOf("\t- 注意事项 %%summary-topic=2%%"));
  assert.equal(pathAtLine(LIST, lines.indexOf("\t\t- 人注意安全")), "0/0/s0/1");
  // 普通节点的路径不变
  assert.equal(pathAtLine(LIST, lines.indexOf("- 头灯")), "0/1");
});

test("挂不上的当普通节点，标记原样写回", () => {
  const cases = [
    // 前面没有兄弟
    `# 根\n\n- 孤单 %%summary-topic=2%%\n- 后面\n`,
    // 起始节点已经有概要
    `# 根\n\n- a %%summary "已有"%%\n- 主题 %%summary-topic=1%%\n`,
    // 起始节点落在前面的概要里
    `# 根\n\n- a %%summary=3 "大"%%\n- b\n- c\n- 主题 %%summary-topic=1%%\n`,
    // 自己是隐藏的
    `# 根\n\n- a\n- 主题 %%hide summary-topic=1%%\n`,
    // 起始节点是隐藏的
    `# 根\n\n- a %%hide%%\n- 主题 %%summary-topic=1%%\n`,
    // 连着两个概要主题：第二个的范围碰到前一个概要主题
    `# 根\n\n- a\n- t1 %%summary-topic=1%%\n- t2 %%summary-topic=2%%\n`,
  ];
  for (const src of cases) {
    assert.equal(roundTrip(src), src, src);
    assert.equal(roundTrip(src), serializeMarkdown(parseMarkdown(src, { showHidden: true })), src);
  }
  const doc = parseMarkdown(cases[0]);
  assert.deepEqual(kids(doc.root), ["孤单", "后面"]);
});

test("跨度写大了按前面实际的兄弟数算", () => {
  const doc = parseMarkdown(`# 根\n\n- a\n- b\n- 主题 %%summary-topic=5%%\n`);
  assert.equal(doc.root.children[0].summary?.span, 2);
  assert.equal(serializeMarkdown(doc), `# 根\n\n- a\n- b\n- 主题 %%summary-topic=2%%\n`);
});

test("范围里夹着隐藏的兄弟：原样往返", () => {
  const src = `# 根\n\n- a\n- 藏 %%hide%%\n- b\n- 主题 %%summary-topic=3%%\n\t- 子\n- c\n`;
  assert.equal(roundTrip(src), src);
  const doc = parseMarkdown(src);
  assert.deepEqual(kids(doc.root), ["a", "b", "c"]);
  assert.equal(doc.root.children[0].summary?.span, 2);
});

test("概要主题子树里的隐藏节点照样摘出去、原位写回", () => {
  const src = `# 根\n\n- a\n- 主题 %%summary-topic=1%%\n\t- 显\n\t- 藏 %%hide%%\n`;
  assert.equal(roundTrip(src), src);
  const t = parseMarkdown(src).root.children[0].summary!.topic!;
  assert.deepEqual(kids(t), ["显"]);
  let all = 0;
  walkAll(parseMarkdown(src).root, () => all++);
  assert.equal(all, 5);
});

test("删概要主题：只去掉这个概要，括住的兄弟不动", () => {
  const doc = parseMarkdown(LIST);
  const pad = doc.root.children[0].children[0];
  removeNode(pad.children[0].summary!.topic!);
  assert.equal(pad.children[0].summary, undefined);
  assert.equal(serializeMarkdown(doc), LIST.replace(/\t- 注意事项[^\n]*\n\t\t- 钱注意安全\n\t\t- 人注意安全\n/, ""));
});

test("删起始节点：概要交给下一个兄弟；括住的全删了，概要主题留下当普通节点", () => {
  const doc = parseMarkdown(LIST);
  const pad = doc.root.children[0].children[0];
  removeNode(pad.children[0]);
  assert.equal(pad.children[0].text, "垫2");
  assert.equal(pad.children[0].summary?.topic?.text, "注意事项");
  assert.equal(pad.children[0].summary?.span, 1);
  removeNode(pad.children[0]);
  assert.deepEqual(kids(pad), ["注意事项"]);
  assert.ok(!isSummaryTopic(pad.children[0]));
  assert.equal(serializeMarkdown(doc), LIST.replace("\t- 垫1\n\t- 垫2\n", "").replace(" %%summary-topic=2%%", ""));
});

test("只删起始节点本身：概要交给接上来的第一个子节点，范围跟着变大", () => {
  const src = `# 根\n\n- a\n\t- a1\n\t- a2\n- b\n- 主题 %%summary-topic=2%%\n`;
  const doc = parseMarkdown(src);
  removeNodeKeepChildren(doc.root.children[0], doc.style);
  assert.equal(serializeMarkdown(doc), `# 根\n\n- a1\n- a2\n- b\n- 主题 %%summary-topic=3%%\n`);
});

test("隐藏起始节点：概要交给下一个兄弟，概要主题不丢", () => {
  const doc = parseMarkdown(`# 根\n\n- a\n- b\n- 主题 %%summary-topic=2%%\n\t- 子\n`);
  hideNode(doc.root.children[0]);
  assert.equal(serializeMarkdown(doc), `# 根\n\n- a %%hide%%\n- b\n- 主题 %%summary-topic=1%%\n\t- 子\n`);
});

test("概要主题不能当兄弟用：不能挪、不能加兄弟", () => {
  const doc = parseMarkdown(LIST);
  const t = doc.root.children[0].children[0].children[0].summary!.topic!;
  assert.equal(addSibling(t), null);
  assert.equal(moveNode(t, doc.root, 0, doc.style), false);
  assert.equal(serializeMarkdown(doc), LIST);
});

test("往概要主题下面挪节点、在下面加子节点都照常", () => {
  const doc = parseMarkdown(LIST);
  const t = doc.root.children[0].children[0].children[0].summary!.topic!;
  const lamp = doc.root.children[0].children[1];
  assert.ok(moveNode(lamp, t, 2, doc.style));
  assert.equal(serializeMarkdown(doc), LIST.replace("- 头灯\n", "").replace("\t\t- 人注意安全\n", "\t\t- 人注意安全\n\t\t- 头灯\n"));
});

test("改概要范围：概要主题跟着挪到新范围后面", () => {
  const doc = parseMarkdown(`# 根\n\n- a\n- b\n- 主题 %%summary-topic=1%%\n- c\n`);
  const next = setGroupRange(doc.root.children[1], "summary", 0, 2);
  assert.equal(next.summary?.topic?.text, "主题");
  assert.equal(serializeMarkdown(doc), `# 根\n\n- a\n- b\n- c\n- 主题 %%summary-topic=3%%\n`);
});

test("插入父节点：括住的被收进去，概要主题跟着范围走", () => {
  const doc = parseMarkdown(`# 根\n\n- a\n- b\n- 主题 %%summary-topic=2%%\n- c\n`);
  insertParents([doc.root.children[0], doc.root.children[1]], doc.style);
  doc.root.children[0].text = "新";
  assert.equal(serializeMarkdown(doc), `# 根\n\n- 新\n\t- a\n\t- b\n- 主题 %%summary-topic=1%%\n- c\n`);
});

test("复制：父节点带着概要主题；单独复制概要主题是普通节点", () => {
  const doc = parseMarkdown(LIST);
  const pad = doc.root.children[0].children[0];
  const copied = subtreeToList(pad);
  assert.equal(copied, "- 防潮垫\n\t- 垫1\n\t- 垫2\n\t- 注意事项 %%summary-topic=2%%\n\t\t- 钱注意安全\n\t\t- 人注意安全\n");
  const pasted = parseClipboard(copied);
  assert.equal(pasted[0].children[0].summary?.topic?.text, "注意事项");
  assert.equal(subtreeToList(pasted[0]), copied);
  const t = pad.children[0].summary!.topic!;
  assert.equal(subtreeToList(t), "- 注意事项\n\t- 钱注意安全\n\t- 人注意安全\n");
});

test("克隆是深拷贝：改副本不动原来的概要主题", () => {
  const doc = parseMarkdown(LIST);
  const pad = doc.root.children[0].children[0];
  const copy = cloneTree(pad, pad.parent);
  const t = copy.children[0].summary!.topic!;
  assert.notEqual(t, pad.children[0].summary!.topic);
  t.text = "改了";
  assert.equal(pad.children[0].summary!.topic!.text, "注意事项");
  let n = 0;
  walkMap(copy, () => n++);
  assert.equal(n, 6);
});

test("没有 summary-topic 的笔记：解析写回和以前一样（普通概要、外框、隐藏、自由主题）", () => {
  const src = `# 根\n\n## A\n%%summary=2 "两条"%%\n- a1 %%box=2%%\n- a2\n\n## B\n- b %%hide%%\n\n## F\n%%float x=300 y=-80%%\n`;
  assert.equal(roundTrip(src), src);
});
