import assert from "node:assert/strict";
import test from "node:test";
import { foldPlan } from "../../src/markdown";

const SRC = `---
mindmap: true
---
# 根

## 甲
%%fold%%
- 甲一 %%fold%%
\t备注
\t- 甲一一
\t\t- 甲一一一
- 甲二

## 乙
- 乙一 %%fold%%

## 丙
- 丙一
`;

test("折叠着的节点：从节点行到整个分支最后一个非空行，没有子节点的不折", () => {
  const plan = foldPlan(SRC);
  const lines = SRC.split("\n");
  assert.deepEqual(
    plan.folds.map((f) => [lines[f.from], lines[f.to]]),
    [
      ["## 甲", "- 甲二"],
      ["- 甲一 %%fold%%", "\t\t- 甲一一一"],
    ],
  );
  assert.deepEqual(plan.paths, ["0", "0/0"]);
});

test("节点行：标题和列表项都算，备注行不算", () => {
  const plan = foldPlan(SRC);
  const lines = SRC.split("\n");
  const at = (t: string) => lines.indexOf(t);
  assert.ok(plan.nodeLines.has(at("## 乙")));
  assert.ok(plan.nodeLines.has(at("- 丙一")));
  assert.ok(!plan.nodeLines.has(at("\t备注")));
});
