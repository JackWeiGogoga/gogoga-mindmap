import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../../src/markdown";
import { Bounds, DEFAULT_LAYOUT, edgeGeometry, layoutMap, layoutTree, LayoutResult, NOTE_GAP, Size, Structure } from "../../src/layout";
import { MindNode, visibleChildren, walk } from "../../src/model";

const STRUCTURES: Structure[] = ["logic-right", "mindmap", "org-down", "tree-right"];
const measure = (n: { text: string; depth: number }) => ({ w: 20 + n.text.length * 8, h: n.depth === 0 ? 60 : 30 });

/** 严格相交（只碰到边不算） */
function hit(a: Bounds, b: Bounds): boolean {
  const e = 0.01;
  return a.x < b.x + b.w - e && b.x < a.x + a.w - e && a.y < b.y + b.h - e && b.y < a.y + a.h - e;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 展开的备注不能和任何节点、标注、别的备注、连线重叠；挂在自己节点下面；整体范围包含它 */
function checkNotes(res: LayoutResult, structure: Structure, label: string): void {
  const nodes = [...res.placed.values()];
  for (const a of nodes) for (const b of nodes) if (a !== b) assert.ok(!hit(a, b), `${label}: 节点「${a.node.text}」和「${b.node.text}」重叠`);
  for (const n of res.notes) {
    const own = res.placed.get(n.node.id)!;
    assert.ok(n.y >= own.y + own.h + NOTE_GAP - 0.01, `${label}: 备注应在节点下方`);
    for (const p of nodes) assert.ok(!hit(n, p), `${label}: 「${n.node.text}」的备注压到了节点「${p.node.text}」`);
    for (const c of res.callouts) assert.ok(!hit(n, c), `${label}: 「${n.node.text}」的备注压到了「${c.node.text}」的标注`);
    for (const m of res.notes) if (m !== n) assert.ok(!hit(n, m), `${label}: 「${n.node.text}」和「${m.node.text}」的备注重叠`);
    const b = res.bounds;
    assert.ok(n.x >= b.x - 0.01 && n.y >= b.y - 0.01 && n.x + n.w <= b.x + b.w + 0.01 && n.y + n.h <= b.y + b.h + 0.01, `${label}: 整体范围没包含备注`);
  }
  // 连线（按外接矩形算）不从备注里穿过
  for (const child of nodes) {
    const parent = child.node.parent && res.placed.get(child.node.parent.id);
    if (!parent || res.floating?.has(child.node)) continue;
    const g = edgeGeometry(parent, child);
    const box = { x: Math.min(g.x1, g.x2), y: Math.min(g.y1, g.y2), w: Math.abs(g.x2 - g.x1), h: Math.abs(g.y2 - g.y1) };
    for (const n of res.notes) {
      assert.ok(!hit(n, box), `${label}: 「${parent.node.text}」→「${child.node.text}」的连线穿过了「${n.node.text}」的备注`);
    }
  }
  // 组织结构图、树形图：子节点连线从备注底下出来
  if (structure === "org-down" || structure === "tree-right") {
    for (const n of res.notes) {
      const p = res.placed.get(n.node.id)!;
      for (const c of visibleChildren(n.node)) {
        const cp = res.placed.get(c.id);
        if (!cp) continue;
        assert.ok(edgeGeometry(p, cp).y1 >= n.y + n.h - 0.01, `${label}: 「${n.node.text}」的子节点连线应从备注下面出`);
      }
    }
  }
}

test("展开的备注：四种结构下不压到节点、标注、连线，也互不重叠", () => {
  const md = `# 中心主题

## A
- a1
- a2
- a3

## B

## C
- c1
\t- c11
\t- c12

## D
`;
  for (const structure of STRUCTURES) {
    for (const wide of [false, true]) {
      const doc = parseMarkdown(md);
      walk(doc.root, (n) => {
        if (["中心主题", "A", "a2", "C", "c11", "D"].includes(n.text)) n.note = `备注 ${n.text}`;
      });
      const res = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, undefined, undefined, undefined, (n) =>
        n.note ? { w: wide ? 260 : 18, h: 50 } : null,
      );
      assert.equal(res.notes.length, 6, structure);
      checkNotes(res, structure, `${structure}${wide ? "（宽）" : ""}`);
    }
  }
});

test("展开的备注：没传 measureNote 时布局和以前一模一样", () => {
  const md = "# R\n\n## A\n- a1\n- a2\n\n## B\n";
  for (const structure of STRUCTURES) {
    const doc = parseMarkdown(md);
    walk(doc.root, (n) => (n.note = "x"));
    const before = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure });
    const after = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, undefined, undefined, undefined, () => null);
    assert.deepEqual([...after.placed.values()].map((p) => [p.x, p.y]), [...before.placed.values()].map((p) => [p.x, p.y]), structure);
    assert.equal(after.notes.length, 0);
  }
});

test("展开的备注：随机树压力测试（含标注、自由主题）", () => {
  const rand = rng(20261029);
  for (let round = 0; round < 400; round++) {
    const lines = ["# R"];
    const depthMax = 4;
    let count = 0;
    const gen = (depth: number) => {
      const k = depth === 0 ? 1 + Math.floor(rand() * 5) : Math.floor(rand() * (depth < depthMax ? 4 : 1));
      for (let i = 0; i < k && count < 40; i++) {
        count++;
        const text = "n".repeat(1 + Math.floor(rand() * 12)) + count;
        lines.push(`${"\t".repeat(depth)}- ${text}`);
        gen(depth + 1);
      }
    };
    gen(0);
    const doc = parseMarkdown(lines.join("\n") + "\n");
    const sizes = new Map<string, Size>();
    const callouts = new Map<string, Size>();
    walk(doc.root, (n: MindNode) => {
      if (rand() < 0.4) {
        n.note = "x";
        sizes.set(n.id, { w: 60 + Math.floor(rand() * 280), h: 20 + Math.floor(rand() * 200) });
      }
      if (rand() < 0.15) {
        n.callout = "c";
        callouts.set(n.id, { w: 30 + Math.floor(rand() * 200), h: 20 + Math.floor(rand() * 40) });
      }
      if (n.depth === 1 && rand() < 0.15) n.float = { x: 600 + Math.floor(rand() * 400), y: -300 + Math.floor(rand() * 600) };
    });
    for (const structure of STRUCTURES) {
      const res = layoutMap(
        doc.root,
        measure,
        { ...DEFAULT_LAYOUT, structure },
        undefined,
        (n) => callouts.get(n.id) ?? null,
        (n) => sizes.get(n.id) ?? null,
      );
      // 自由主题自成一棵树，和主树之间本来就可能叠（用户自己摆的位置），只查每棵树内部
      const trees = new Map<MindNode, MindNode>();
      for (const p of res.placed.values()) {
        let top = p.node;
        while (top.parent && !res.floating?.has(top)) top = top.parent;
        trees.set(p.node, top);
      }
      const sub = (top: MindNode): LayoutResult => ({
        ...res,
        placed: new Map([...res.placed].filter(([, p]) => trees.get(p.node) === top)),
        notes: res.notes.filter((n) => trees.get(n.node) === top),
        callouts: res.callouts.filter((c) => trees.get(c.node) === top),
      });
      for (const top of new Set(trees.values())) checkNotes(sub(top), structure, `第 ${round} 轮 ${structure}`);
    }
  }
});
