import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../../src/markdown";
import { BRACE_W, DEFAULT_LAYOUT, layoutMap, type Bounds, type Structure } from "../../src/layout";
import { walkMap, type MindNode } from "../../src/model";

const measure = (n: MindNode) => ({ w: 20 + [...n.text].length * 9, h: n.depth === 0 ? 56 : n.depth === 1 ? 36 : 28 });
const measureSummary = (s: MindNode) => ({ w: 16 + [...(s.summary?.text ?? "")].length * 8, h: 24 });
const structures: Structure[] = ["logic-right", "mindmap", "org-down", "tree-right"];

/** 概要主题比括住的两项高很多：下面还有兄弟、兄弟的分支向右伸得很远 */
const TALL = `# 根

## 装备
- 帐篷
- 防潮垫
	- 垫1
	- 垫2
	- 注意事项 %%summary-topic=2%%
		- 钱注意安全
		- 人注意安全
		- 东西注意安全
		- 天气注意安全
		- 火注意安全
- 露营灯
	- 一个很长很长很长很长很长很长的子节点
		- 再往右伸
- 头灯

## 行程
- 第一天
- 第二天
- 小结 %%summary-topic=2%%
	- 早点出发
	- 带够水
- 第三天
`;

const overlap = (a: Bounds, b: Bounds) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function check(src: string, structure: Structure) {
  const doc = parseMarkdown(src);
  const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, measureSummary);
  // 看得见的节点：折叠着的节点下面不算
  const nodes: MindNode[] = [];
  walkMap(doc.root, (n) => {
    for (let a = n.parent; a; a = a.parent) if (a.folded) return;
    nodes.push(n);
  });
  // 每个节点（含概要主题和它的子树）都排上了
  for (const n of nodes) assert.ok(res.placed.has(n.id), `${structure}: ${n.text} 没排上`);
  const rects = [...res.placed.values()];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `${structure}: ${rects[i].node.text} 和 ${rects[j].node.text} 重叠`);
  // 括号不压到任何节点
  for (const s of res.summaries) for (const r of rects) assert.ok(!overlap(s.brace, r), `${structure}: 括号压到 ${r.node.text}`);
  return { doc, res };
}

test("概要主题：四种结构下都排上了、互不重叠，括号不压节点", () => {
  for (const s of structures) check(TALL, s);
});

test("概要主题紧跟在括号尖后面，括号只括被概括的两项", () => {
  const { doc, res } = check(TALL, "logic-right");
  const pad = doc.root.children[0].children[1];
  const topic = pad.children[0].summary!.topic!;
  const sm = res.summaries.find((s) => s.topic === topic)!;
  assert.ok(sm);
  assert.equal(sm.label, null);
  const t = res.placed.get(topic.id)!;
  assert.ok(t.x >= sm.brace.x + BRACE_W && t.x < sm.brace.x + BRACE_W + 20, `${t.x} vs ${sm.brace.x}`);
  const m1 = res.placed.get(pad.children[0].id)!;
  const m2 = res.placed.get(pad.children[1].id)!;
  assert.ok(sm.brace.y <= m1.y && sm.brace.y + sm.brace.h >= m2.y + m2.h);
  // 子节点在概要主题右边
  for (const c of topic.children) assert.ok(res.placed.get(c.id)!.x > t.x + t.w);
});

test("概要主题比括住的一段高：后面的兄弟被推开，不和小树重叠", () => {
  const plain = TALL.replace(/\t- 注意事项[^\n]*\n(\t\t- [^\n]*\n)+/, "");
  const a = layoutMap(parseMarkdown(plain).root, measure, DEFAULT_LAYOUT, measureSummary);
  const b = check(TALL, "logic-right");
  const lamp = (r: ReturnType<typeof layoutMap>) => [...r.placed.values()].find((p) => p.node.text === "露营灯")!;
  const pad = (r: ReturnType<typeof layoutMap>) => [...r.placed.values()].find((p) => p.node.text === "防潮垫")!;
  assert.ok(lamp(b.res).y - pad(b.res).y > lamp(a).y - pad(a).y + 20, "露营灯应当被往下推");
});

test("思维导图左边的概要主题镜像排：在括号左边，子节点往左", () => {
  const src = `# 根\n\n## R1\n\n## R2\n\n## L\n%%left%%\n- a\n- b\n- 小结 %%summary-topic=2%%\n\t- 子1\n\t- 子2\n`;
  const { doc, res } = check(src, "mindmap");
  const topic = doc.root.children[2].children[0].summary!.topic!;
  const sm = res.summaries.find((s) => s.topic === topic)!;
  const t = res.placed.get(topic.id)!;
  assert.equal(t.side, "left");
  assert.ok(t.x + t.w <= sm.brace.x);
  for (const c of topic.children) assert.ok(res.placed.get(c.id)!.x + res.placed.get(c.id)!.w < t.x);
});

test("概要主题折叠时只排它自己", () => {
  const src = TALL.replace("注意事项 %%summary-topic=2%%", "注意事项 %%fold summary-topic=2%%");
  const { doc, res } = check(src, "logic-right");
  const topic = doc.root.children[0].children[1].children[0].summary!.topic!;
  assert.ok(topic.folded);
  assert.ok(res.placed.has(topic.id));
  for (const c of topic.children) assert.ok(!res.placed.has(c.id));
});

test("自由主题里的概要主题也排上", () => {
  const src = `# 根\n\n## 主\n\n## 自由\n%%float x=400 y=200%%\n- a\n- b\n- 小结 %%summary-topic=2%%\n\t- 子\n`;
  for (const s of structures) check(src, s);
});
