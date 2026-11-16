import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../../src/markdown";
import { progressLabel, taskProgress } from "../../src/task-progress";
import type { MindNode } from "../../src/model";

const find = (n: MindNode, text: string): MindNode | null => {
  if (n.text === text) return n;
  for (const c of n.children) {
    const r = find(c, text);
    if (r) return r;
  }
  return null;
};
const doc = parseMarkdown(`# 根

## 无序转md
- [ ] 任务1
- [x] 任务2
	- [x] 任务2子项1
	- [ ] 任务2子项2
- 普通
	- [x] 隔开的任务

## 没有任务
- 甲
	- 乙

## 全做完
- [x] 一
- [X] 二
`);

test("清单的上一级：下面一路连着的任务都算，子任务各算一项", () => {
  assert.deepEqual(taskProgress(find(doc.root, "无序转md")!), { done: 2, total: 4 });
});

test("中间隔着普通节点的任务：算在那个普通节点上，不往上累加", () => {
  assert.deepEqual(taskProgress(find(doc.root, "普通")!), { done: 1, total: 1 });
});

test("任务节点自己、没有任务的节点：不显示", () => {
  assert.equal(taskProgress(find(doc.root, "[x] 任务2")!), null);
  assert.equal(taskProgress(find(doc.root, "没有任务")!), null);
  assert.equal(taskProgress(find(doc.root, "甲")!), null);
});

test("只有直接子节点有任务才显示：上面的祖先不汇总", () => {
  assert.equal(taskProgress(doc.root), null);
});

test("[X] 大写也算完成", () => {
  assert.deepEqual(taskProgress(find(doc.root, "全做完")!), { done: 2, total: 2 });
});

test("显示文字：百分比向下取整", () => {
  assert.equal(progressLabel({ done: 1, total: 5 }, "percent"), "20%");
  assert.equal(progressLabel({ done: 2, total: 3 }, "percent"), "66%");
  assert.equal(progressLabel({ done: 1, total: 5 }, "count"), "1/5");
  assert.equal(progressLabel({ done: 1, total: 5 }, "both"), "1/5 · 20%");
  assert.equal(progressLabel({ done: 5, total: 5 }, "percent"), "100%");
});
