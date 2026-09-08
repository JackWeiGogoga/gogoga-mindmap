import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../../src/markdown";
import { DEFAULT_LAYOUT, layoutTree, Placed } from "../../src/layout";
import { findByPath, walk } from "../../src/model";

const measure = (n: { text: string; depth: number }) => ({ w: 20 + n.text.length * 8, h: n.depth === 0 ? 60 : 30 });

const src = `# Root

## A
- a1
- a2
- a3

## B

## C
- c1

## D
`;

function overlaps(a: Placed, b: Placed): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("逻辑图：全部在右侧，父节点对子节点块居中，无重叠", () => {
  const doc = parseMarkdown(src);
  const res = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "logic-right" });
  const all = [...res.placed.values()];
  assert.equal(all.length, 9);
  for (const p of all) assert.equal(p.side, "right");
  for (const p of all) if (p.node.depth > 0) assert.ok(p.x > 0, `${p.node.text} 应在根右侧`);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) assert.ok(!overlaps(all[i], all[j]), `${all[i].node.text} 与 ${all[j].node.text} 重叠`);
  const a = res.placed.get(findByPath(doc.root, "0")!.id)!;
  const a1 = res.placed.get(findByPath(doc.root, "0/0")!.id)!;
  const a3 = res.placed.get(findByPath(doc.root, "0/2")!.id)!;
  assert.ok(Math.abs(a.y + a.h / 2 - (a1.y + a3.y + a3.h) / 2) < 0.01, "A 应位于 a1..a3 的中心");
  assert.equal(a1.x, a.x + a.w + DEFAULT_LAYOUT.gapLevel);
  assert.equal(a.x, all[0].x + all[0].w + DEFAULT_LAYOUT.gapRoot);
});

test("思维导图：前一半在右、后一半在左且顺时针", () => {
  const doc = parseMarkdown(src);
  const res = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "mindmap" });
  const get = (path: string) => res.placed.get(findByPath(doc.root, path)!.id)!;
  assert.equal(get("0").side, "right");
  assert.equal(get("1").side, "right");
  assert.equal(get("2").side, "left");
  assert.equal(get("3").side, "left");
  assert.ok(get("2").x + get("2").w < 0, "C 在根左侧");
  assert.ok(get("3").y < get("2").y, "顺时针：D 在 C 上方");
  assert.ok(get("2/0").x < get("2").x, "左侧的子节点继续向左延伸");
});

test("折叠的节点不参与布局", () => {
  const doc = parseMarkdown(src.replace("## A", "## A %%fold%%"));
  const res = layoutTree(doc.root, measure, DEFAULT_LAYOUT);
  let total = 0;
  walk(doc.root, () => total++);
  assert.equal(total, 9);
  assert.equal(res.placed.size, 6);
});
