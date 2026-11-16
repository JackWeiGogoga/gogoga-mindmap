/**
 * 鱼骨图（鱼头向右 / 向左）：程序生成各种写法的笔记排一遍，检查
 * 节点（连同展开的备注）互不重叠；主主题上下交替、第一个离鱼头最近；整个分支都在主骨同一侧、鱼头的鱼尾那边；
 * 主骨、斜骨、小骨都不从别的节点里穿过；二级主题的小骨接在斜骨上，三级以下按树形图挂在二级下面
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../../src/markdown";
import { Bounds, DEFAULT_LAYOUT, edgeGeometry, edgePath, layoutMap, ribGeometry, Segment, Structure } from "../../src/layout";
import { visibleChildren, walk, type MindNode } from "../../src/model";

const STRUCTS: Structure[] = ["fishbone-right", "fishbone-left"];
const measure = (n: MindNode) => ({ w: 24 + Math.min(n.text.length, 24) * 9, h: n.depth === 0 ? 48 : n.depth === 1 ? 34 : 26 });
const measureNote = (n: MindNode) => (n.note ? { w: 60 + (n.note.length % 7) * 30, h: 22 + (n.note.length % 3) * 16 } : null);

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function genNote(seed: number): string {
  const r = rng(seed);
  const out: string[] = [`# 问题 ${seed}`];
  if (r() < 0.3) out.push("问题的说明。");
  const mains = 1 + Math.floor(r() * 8);
  for (let c = 1; c <= mains; c++) {
    out.push(`## ${r() < 0.3 ? "很长很长的原因大类" : "大类"}${c}`);
    if (r() < 0.3) out.push(`第${c}类的说明。`);
    const n = Math.floor(r() * 5);
    for (let i = 1; i <= n; i++) {
      out.push(`- ${r() < 0.2 ? "一条比较长的具体原因文字" : "原因"} ${c}.${i}`);
      if (r() < 0.25) out.push(`\t备注 ${c}.${i}`);
      if (r() < 0.4) out.push(`\t- 细节 ${c}.${i}.1`, `\t- 细节 ${c}.${i}.2`);
    }
  }
  return out.join("\n") + "\n";
}

const hit = (a: Bounds, b: Bounds) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
/** 线段经过矩形内部（边上不算）：沿线取点 */
function crosses(s: Segment, b: Bounds): boolean {
  for (let t = 0.02; t < 0.98; t += 0.02) {
    const x = s.x1 + (s.x2 - s.x1) * t;
    const y = s.y1 + (s.y2 - s.y1) * t;
    if (x > b.x + 0.5 && x < b.x + b.w - 0.5 && y > b.y + 0.5 && y < b.y + b.h - 0.5) return true;
  }
  return false;
}

for (const structure of STRUCTS) {
  test(`鱼骨图 ${structure}：不重叠、上下交替、第一个离鱼头最近、骨头不穿过节点`, () => {
    const d = structure === "fishbone-right" ? -1 : 1;
    for (let seed = 1; seed <= 80; seed++) {
      const doc = parseMarkdown(genNote(seed));
      const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, undefined, undefined, measureNote);
      const where = `种子 ${seed}`;
      const rects: { b: Bounds; who: string; owner: MindNode }[] = [];
      for (const p of res.placed.values()) rects.push({ b: p, who: p.node.text, owner: p.node });
      for (const n of res.notes) rects.push({ b: n, who: `${n.node.text} 的备注`, owner: n.node });
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          if (rects[i].owner === rects[j].owner) continue;
          assert.ok(!hit(rects[i].b, rects[j].b), `${where}：${rects[i].who} 和 ${rects[j].who} 重叠`);
        }
      const root = res.placed.get(doc.root.id)!;
      const mains = visibleChildren(doc.root);
      const spine = res.spine!;
      assert.ok(spine && spine.plain, `${where}：没有主骨`);
      assert.equal(spine.segs.size, mains.length);
      let prevS: number | null = null;
      mains.forEach((m, i) => {
        const p = res.placed.get(m.id)!;
        const up = i % 2 === 0;
        assert.equal(p.side, up ? "up" : "down", `${where}：${m.text} 的方向`);
        const bone = spine.segs.get(m.id)!;
        assert.deepEqual(p.bone, bone);
        // 斜骨从主骨出发，往鱼尾那边斜着到主主题
        assert.equal(bone.y1, 0);
        assert.ok(d < 0 ? bone.x2 < bone.x1 : bone.x2 > bone.x1, `${where}：${m.text} 的斜骨方向`);
        assert.ok(up ? bone.y2 < 0 : bone.y2 > 0, `${where}：${m.text} 的斜骨在错的一侧`);
        // 第一个离鱼头最近，往鱼尾依次排开
        if (prevS !== null) assert.ok(d < 0 ? bone.x1 < prevS : bone.x1 > prevS, `${where}：${m.text} 的顺序不对`);
        prevS = bone.x1;
        walk(m, (n) => {
          const q = res.placed.get(n.id);
          if (!q) return;
          // 整个分支在主骨同一侧、在鱼头的鱼尾那边
          if (up) assert.ok(q.y + q.h < 0, `${where}：${n.text} 应在主骨上方`);
          else assert.ok(q.y > 0, `${where}：${n.text} 应在主骨下方`);
          assert.ok(d < 0 ? q.x + q.w < root.x : q.x > root.x + root.w, `${where}：${n.text} 跑到鱼头另一边了`);
          if (n === m) return;
          const parent = res.placed.get(n.parent!.id)!;
          if (n.parent === m) {
            assert.equal(q.side, "rib", `${where}：${n.text} 应该是小骨`);
            const g = ribGeometry(parent, q, q.y + q.h / 2);
            // 小骨接在斜骨上（两个端点之间），长度至少留出一截
            const lo = Math.min(bone.x1, bone.x2);
            const hi = Math.max(bone.x1, bone.x2);
            assert.ok(g.x1 >= lo - 0.5 && g.x1 <= hi + 0.5, `${where}：${n.text} 的小骨没接在斜骨上`);
            assert.ok(Math.abs(g.x2 - g.x1) >= 8, `${where}：${n.text} 的小骨太短`);
            const rib: Segment = { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 };
            for (const o of res.placed.values()) if (o.node !== n) assert.ok(!crosses(rib, o), `${where}：${n.text} 的小骨穿过 ${o.node.text}`);
          } else {
            assert.equal(q.side, "tree", `${where}：${n.text} 应按树形图挂着`);
          }
          const e = edgePath(edgeGeometry(parent, q), "elbow");
          assert.ok(!/NaN/.test(e), `${where}：${n.text} 的连线`);
        });
        for (const o of res.placed.values()) if (o.node !== m) assert.ok(!crosses(bone, o), `${where}：${m.text} 的斜骨穿过 ${o.node.text}`);
      });
      // 主骨从鱼尾通到鱼头，不穿过任何节点，鱼尾越过所有分支
      if (spine.end) {
        const e = spine.end;
        assert.equal(e.x2, d < 0 ? root.x : root.x + root.w);
        for (const o of res.placed.values()) assert.ok(!crosses(e, o), `${where}：主骨穿过 ${o.node.text}`);
        for (const o of res.placed.values()) if (o.node !== doc.root) assert.ok(d < 0 ? e.x1 < o.x : e.x1 > o.x + o.w, `${where}：鱼尾没有越过 ${o.node.text}`);
      } else assert.equal(mains.length, 0);
      for (const v of [res.bounds.x, res.bounds.y, res.bounds.w, res.bounds.h]) assert.ok(Number.isFinite(v));
    }
  });
}

test("鱼骨图：主主题折叠了、没有子主题也能排；只有中心主题时没有主骨", () => {
  const doc = parseMarkdown("# 问题\n\n## 甲 %%fold%%\n- 子\n\n## 乙\n");
  const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "fishbone-right" });
  const [a, b] = visibleChildren(doc.root);
  assert.ok(res.placed.get(a.id) && res.placed.get(b.id));
  assert.equal(res.spine?.segs.size, 2);
  const solo = layoutMap(parseMarkdown("# 只有我\n").root, measure, { ...DEFAULT_LAYOUT, structure: "fishbone-left" });
  assert.equal(solo.spine?.end, null);
});

test("鱼头向右：概要挪到这一组的左边，小骨不从概要的括号、文字里穿过；鱼头向左照旧在右边", () => {
  const src = "# 问题\n\n## 人\n- 甲 %%summary \"最关键\"%%\n- 乙\n- 丙 %%box=2 \"一组\"%%\n- 丁 %%summary%%\n";
  for (const structure of ["fishbone-right", "fishbone-left"] as Structure[]) {
    const doc = parseMarkdown(src);
    const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, () => ({ w: 60, h: 24 }));
    assert.equal(res.summaries.length, 2);
    const main = res.placed.get(visibleChildren(doc.root)[0].id)!;
    for (const sm of res.summaries) {
      const first = res.placed.get(sm.members[0].id)!;
      if (structure === "fishbone-right") assert.ok(sm.brace.x + sm.brace.w <= first.x, `${structure}：括号应在左边`);
      else assert.ok(sm.brace.x >= first.x + first.w, `${structure}：括号应在右边`);
      for (const k of visibleChildren(main.node)) {
        const q = res.placed.get(k.id)!;
        const g = ribGeometry(main, q, q.y + q.h / 2);
        const rib: Segment = { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 };
        assert.ok(!crosses(rib, sm.brace), `${structure}：${k.text} 的小骨穿过概要括号`);
        if (sm.label) assert.ok(!crosses(rib, sm.label), `${structure}：${k.text} 的小骨穿过概要文字`);
      }
    }
  }
});
