import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseMarkdown } from "../../src/markdown";
import { DEFAULT_LAYOUT, layoutMap, layoutTree, LayoutOptions, LayoutResult, Size, Structure } from "../../src/layout";
import { MindNode, pathOf } from "../../src/model";

/**
 * 布局快照：一批覆盖外框、概要、折叠、左右分布标记的样例，在四种结构下的全部坐标。
 * 改布局代码（比如加自由主题）时，没有新功能标记的笔记必须排得和以前一模一样。
 * 有意改变布局时用 UPDATE_GOLDEN=1 pnpm test 重新生成。
 */
const GOLDEN = path.join(process.cwd(), "scripts/tests/layout-golden.json");

const measure = (n: { text: string; depth: number }) => ({ w: 20 + n.text.length * 9, h: n.depth === 0 ? 56 : n.depth === 1 ? 36 : 28 });
const measureSummary = (s: { summary?: { text: string } }) => ({ w: 16 + (s.summary?.text.length ?? 0) * 8, h: 24 });

const fixtures: Record<string, string> = {
  plain: `# 根\n\n## A\n- a1\n- a2\n\t- a21\n\t- a22\n- a3\n\n## B\n\n## C\n- c1\n\t- c11\n\t\t- c111\n\n## D\n- d1\n`,
  boxes: `# 根\n\n## A %%box=2 "框"%%\n- a1\n\n## B\n- b1 %%box%%\n- b2\n\n## C\n- c1 %%box=2%%\n- c2\n- c3\n`,
  summaries: `# 根\n\n## A %%summary=2 "两条"%%\n- a1\n- a2 %%summary=2 "后两个" sw=120%%\n- a3\n\n## B\n\n## C %%box summary "框加概要"%%\n- c1\n`,
  sides: `# 根\n\n## R1 %%right%%\n- r\n\n## L1 %%left%%\n- l1\n- l2\n\n## R2\n\n## L2 %%left%%\n\n## X\n- x1\n`,
  folded: `# 根\n\n## A %%fold%%\n- a1\n- a2\n\n## B\n- b1 %%fold%%\n\t- b11\n- b2\n`,
  wide: `# 根\n\n## 很长很长很长很长很长很长的主题 %%w=200%%\n- 子\n\n## 短\n- 一个特别长的子节点文字用来撑宽\n- 二\n`,
  single: `# 只有一个分支\n\n## A\n- a1\n`,
};
const structures: Structure[] = ["logic-right", "mindmap", "org-down", "tree-right"];
const r = (v: number) => Math.round(v * 100) / 100;

type Layout = (root: MindNode, measure: (n: MindNode) => Size, opts: LayoutOptions, measureSummary?: (start: MindNode) => Size) => LayoutResult;

function snapshot(layout: Layout = layoutTree): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, src] of Object.entries(fixtures)) {
    for (const structure of structures) {
      const doc = parseMarkdown(src);
      const res = layout(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, measureSummary);
      out[`${name}/${structure}`] = {
        placed: [...res.placed.values()].map((p) => [pathOf(p.node), r(p.x), r(p.y), r(p.w), r(p.h), p.side]).sort(),
        boxes: res.boxes.map((b) => [pathOf(b.start), r(b.x), r(b.y), r(b.w), r(b.h), b.side]),
        summaries: res.summaries.map((s) => [pathOf(s.start), s.side, r(s.brace.x), r(s.brace.y), r(s.brace.w), r(s.brace.h), s.label ? [r(s.label.x), r(s.label.y)] : null]),
        bounds: [r(res.bounds.x), r(res.bounds.y), r(res.bounds.w), r(res.bounds.h)],
      };
    }
  }
  return out;
}

test("布局快照：没有新标记的笔记，四种结构下坐标和以前完全一致", () => {
  const now = snapshot();
  if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + "\n");
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  for (const key of Object.keys(golden)) assert.deepEqual(now[key], golden[key], key);
});

test("布局快照：画布实际用的 layoutMap 在没有自由主题时和快照完全一致", () => {
  if (!existsSync(GOLDEN)) return;
  const now = snapshot(layoutMap);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  for (const key of Object.keys(golden)) assert.deepEqual(now[key], golden[key], key);
});

test("布局快照：画布总会传标注尺寸函数，没有标注的笔记坐标仍和快照完全一致", () => {
  if (!existsSync(GOLDEN)) return;
  const now = snapshot((root, measure, opts, ms) => layoutMap(root, measure, opts, ms, () => ({ w: 300, h: 60 })));
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  for (const key of Object.keys(golden)) assert.deepEqual(now[key], golden[key], key);
});
