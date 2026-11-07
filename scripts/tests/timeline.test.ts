/**
 * 时间轴结构（五种）：程序生成各种写法的笔记排一遍，检查
 * 节点（连同展开的备注）互不重叠、主主题按笔记顺序串在主轴上、分支长在约定的一侧、主轴不从节点里穿过、
 * 交错的确实轮流长在两侧；原有四种结构的排布由 layout-golden 守着不变
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../../src/markdown";
import { Bounds, DEFAULT_LAYOUT, edgeGeometry, edgePath, isTimelineH, layoutMap, Structure } from "../../src/layout";
import { visibleChildren, walk, type MindNode } from "../../src/model";

const STRUCTS: Structure[] = ["timeline-h", "timeline-h-alt", "timeline-v-right", "timeline-v-left", "timeline-v-alt"];
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
  const out: string[] = [`# 时间轴 ${seed}`];
  const mains = 1 + Math.floor(r() * 7);
  for (let c = 1; c <= mains; c++) {
    out.push(`## ${r() < 0.3 ? "很长很长的阶段名字" : "阶段"}${c}`);
    if (r() < 0.3) out.push(`第${c}阶段的说明。`);
    const n = Math.floor(r() * 5);
    for (let i = 1; i <= n; i++) {
      out.push(`- ${r() < 0.2 ? "一条比较长的要点文字" : "要点"} ${c}.${i}`);
      if (r() < 0.25) out.push(`\t备注 ${c}.${i}`);
      if (r() < 0.4) out.push(`\t- 细节 ${c}.${i}.1`, `\t- 细节 ${c}.${i}.2`);
    }
  }
  return out.join("\n") + "\n";
}

const hit = (a: Bounds, b: Bounds) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

for (const structure of STRUCTS) {
  test(`时间轴 ${structure}：不重叠、顺序对、分支在约定的一侧、主轴不穿过节点`, () => {
    const horiz = isTimelineH(structure);
    for (let seed = 1; seed <= 60; seed++) {
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
      const mains = visibleChildren(doc.root);
      const spine = res.spine!;
      assert.ok(spine, `${where}：没有主轴`);
      assert.equal(spine.segs.size, mains.length);
      let prev = -Infinity;
      mains.forEach((m, i) => {
        const p = res.placed.get(m.id)!;
        const center = horiz ? p.y + p.h / 2 : p.x + p.w / 2;
        assert.ok(Math.abs(center) < 0.01, `${where}：${m.text} 不在主轴上`);
        const pos = horiz ? p.x : p.y;
        assert.ok(pos > prev, `${where}：${m.text} 顺序不对`);
        prev = pos;
        const second = structure.endsWith("-alt") && i % 2 === 1;
        const want = horiz ? (second ? "up" : "down") : structure === "timeline-v-left" || second ? "left" : "right";
        assert.equal(p.side, want, `${where}：${m.text} 的方向`);
        walk(m, (n) => {
          if (n === m) return;
          const q = res.placed.get(n.id);
          if (!q) return;
          if (want === "down") assert.ok(q.y > p.y + p.h, `${where}：${n.text} 应在主轴下方`);
          if (want === "up") assert.ok(q.y + q.h < p.y, `${where}：${n.text} 应在主轴上方`);
          if (want === "right") assert.ok(q.x > p.x + p.w, `${where}：${n.text} 应在主轴右边`);
          if (want === "left") assert.ok(q.x + q.w < p.x, `${where}：${n.text} 应在主轴左边`);
          const e = edgePath(edgeGeometry(res.placed.get(n.parent!.id)!, q), "elbow");
          assert.ok(!/NaN/.test(e), `${where}：${n.text} 的连线`);
        });
      });
      // 主轴各段（连同末尾的箭头）不从节点里穿过
      const segs = [...spine.segs.values(), ...(spine.end ? [spine.end] : [])];
      for (const s of segs) {
        const line: Bounds = { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2) - 0.1, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) + 0.2 };
        if (horiz) line.h = 0.2;
        else line.w = 0.2;
        if (!horiz) line.x = s.x1 - 0.1;
        for (const p of res.placed.values()) assert.ok(!hit(line, p), `${where}：主轴穿过 ${p.node.text}`);
      }
      for (const v of [res.bounds.x, res.bounds.y, res.bounds.w, res.bounds.h]) assert.ok(Number.isFinite(v));
    }
  });
}

test("时间轴：交错比同侧短（相邻分支在两侧，往中间挤）", () => {
  const src = "# 根\n\n" + [1, 2, 3, 4, 5, 6].map((i) => `## 阶段${i}\n- 一条比较长的要点文字用来撑宽\n- 要点二\n- 要点三`).join("\n\n") + "\n";
  const len = (s: Structure) => {
    const b = layoutMap(parseMarkdown(src).root, measure, { ...DEFAULT_LAYOUT, structure: s }).bounds;
    return isTimelineH(s) ? b.w : b.h;
  };
  assert.ok(len("timeline-h-alt") < len("timeline-h"), "横向交错应比同侧短");
  assert.ok(len("timeline-v-alt") < len("timeline-v-right"), "纵向交错应比同侧短");
});

test("时间轴：只有中心主题、折叠的主主题都能排", () => {
  for (const s of STRUCTS) {
    const one = layoutMap(parseMarkdown("# 只有中心\n").root, measure, { ...DEFAULT_LAYOUT, structure: s });
    assert.equal(one.placed.size, 1);
    const folded = layoutMap(parseMarkdown("# 根\n\n## A %%fold%%\n- a1\n\n## B\n- b1\n").root, measure, { ...DEFAULT_LAYOUT, structure: s });
    assert.equal(folded.placed.size, 4);
  }
});

test("时间轴：套着主主题的外框、概要不盖住框外的节点", () => {
  const measureSummary = (s: MindNode) => ({ w: 16 + (s.summary?.text.length ?? 0) * 12, h: 24 });
  const srcs = [
    "# 根\n\n## 甲 %%box=2 \"前期\"%%\n- 一条比较长的要点文字\n\t- 细节\n\n## 乙\n- 乙一\n\n## 丙\n- 丙一\n- 丙二\n\n## 丁\n- 丁一\n",
    "# 根\n\n## 甲\n- 甲一\n\n## 乙 %%summary=2 \"中段的概要文字\"%%\n- 乙一\n- 乙二\n\n## 丙\n- 丙一\n\n## 丁\n- 丁一\n\t- 丁一一\n",
    "# 根\n\n## 甲 %%box=2 summary=2 \"框加概要\"%%\n- 甲一\n\n## 乙\n- 乙一\n\n## 丙\n- 一条比较长的要点文字\n- 丙二\n",
  ];
  for (const structure of STRUCTS) {
    for (const src of srcs) {
      const doc = parseMarkdown(src);
      const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, measureSummary);
      const inside = (n: MindNode, members: MindNode[]) => members.some((m) => { let x: MindNode | null = n; while (x) { if (x === m) return true; x = x.parent; } return false; });
      for (const b of res.boxes) {
        for (const p of res.placed.values()) {
          if (p.node === doc.root || inside(p.node, b.members)) continue;
          assert.ok(!hit(b, p), `${structure}：外框盖住了 ${p.node.text}`);
        }
      }
      for (const sm of res.summaries) {
        for (const r of [sm.brace, ...(sm.label ? [sm.label] : [])]) {
          for (const p of res.placed.values()) assert.ok(!hit(r, p), `${structure}：概要压到了 ${p.node.text}`);
        }
      }
    }
  }
});
