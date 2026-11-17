/**
 * 混合结构（分支单独设结构，%%layout=…%%）：
 * - 标记读写：列表、标题（标记写在下一行）都能读回来；不认识的结构名整段当普通文字；没有标记的笔记写回不变
 * - 程序生成各种写法的笔记，随机给分支设结构，在每种整图结构下排一遍：节点（连同标注、备注）互不重叠，
 *   设了结构的分支整块不压到父节点，分支里的子节点按它自己的方向长
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { allSpines, Bounds, DEFAULT_LAYOUT, layoutMap, Structure } from "../../src/layout";
import { BRANCH_LAYOUTS, visibleChildren, walk, type BranchLayout, type MindNode } from "../../src/model";

test("标记读写：%%layout=…%%", () => {
  const src = "# 根\n\n- 进度 %%layout=timeline-h%%\n\t- 立项\n- 原因 %%red layout=fishbone%%\n\t- 人\n\n## 标题分支\n%%layout=org-down%%\n\n- 子\n";
  const doc = parseMarkdown(src);
  const [a, b, h] = doc.root.children;
  assert.equal(a.layout, "timeline-h");
  assert.equal(b.layout, "fishbone");
  assert.equal(b.color, "red");
  assert.equal(h.layout, "org-down");
  assert.equal(serializeMarkdown(doc), src, "原样写回");
  a.layout = undefined;
  assert.ok(!serializeMarkdown(doc).includes("layout=timeline-h"), "取消后标记去掉");
  const bad = parseMarkdown("# 根\n\n- 甲 %%layout=spiral%%\n");
  assert.equal(bad.root.children[0].layout, undefined);
  assert.equal(bad.root.children[0].text, "甲 %%layout=spiral%%", "不认识的结构名：整段当普通文字");
});

const measure = (n: MindNode) => ({ w: 24 + Math.min(n.text.length, 24) * 9, h: n.depth === 0 ? 48 : n.depth === 1 ? 34 : 26 });
const measureNote = (n: MindNode) => (n.note ? { w: 60 + (n.note.length % 7) * 30, h: 22 + (n.note.length % 3) * 16 } : null);
const measureCallout = (n: MindNode) => (n.callout ? { w: 50 + (n.callout.length % 5) * 20, h: 24 } : null);

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function genNote(seed: number): string {
  const r = rng(seed);
  const out: string[] = [`# 主题 ${seed}`];
  const mains = 1 + Math.floor(r() * 5);
  for (let c = 1; c <= mains; c++) {
    out.push(`- ${r() < 0.3 ? "很长很长的主主题文字" : "主主题"}${c}`);
    const n = Math.floor(r() * 4);
    for (let i = 1; i <= n; i++) {
      out.push(`\t- ${r() < 0.2 ? "一条比较长的分支文字" : "分支"} ${c}.${i}`);
      if (r() < 0.2) out.push(`\t\t备注 ${c}.${i}`);
      const m = Math.floor(r() * 4);
      for (let k = 1; k <= m; k++) {
        out.push(`\t\t- 细节 ${c}.${i}.${k}`);
        if (r() < 0.3) out.push(`\t\t\t- 更细 ${c}.${i}.${k}.1`, `\t\t\t- 更细 ${c}.${i}.${k}.2`);
      }
    }
  }
  return out.join("\n") + "\n";
}

/** 随机给有子节点的分支设结构（主主题在时间轴、鱼骨图下不能设，留给更下一层） */
function assignLayouts(root: MindNode, structure: Structure, seed: number): MindNode[] {
  const r = rng(seed * 7 + 3);
  const set: MindNode[] = [];
  const isAxis = (s: string) => s.startsWith("timeline-") || s.startsWith("fishbone");
  /** 子节点沿主轴排的节点（整图根是时间轴、鱼骨图，或分支设成了它们）：它的子节点是主主题，不能设 */
  const axisRoots = new Set<MindNode>(isAxis(structure) ? [root] : []);
  walk(root, (n) => {
    if (n === root || !n.children.length) return;
    if (n.parent && axisRoots.has(n.parent)) return;
    if (r() < 0.45) {
      n.layout = BRANCH_LAYOUTS[Math.floor(r() * BRANCH_LAYOUTS.length)] as BranchLayout;
      set.push(n);
      if (isAxis(n.layout)) axisRoots.add(n);
    }
  });
  return set;
}

const hit = (a: Bounds, b: Bounds) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

const STRUCTS: Structure[] = ["logic-right", "mindmap", "org-down", "tree-right", "timeline-h", "timeline-v-right", "timeline-v-alt", "fishbone-right", "fishbone-left"];

for (const structure of STRUCTS) {
  test(`混合结构（整图 ${structure}）：节点互不重叠、分支整块不压到父节点`, () => {
    let mixed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const doc = parseMarkdown(genNote(seed));
      const set = assignLayouts(doc.root, structure, seed);
      mixed += set.length;
      const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, undefined, measureCallout, measureNote);
      const where = `种子 ${seed}，设了：${set.map((n) => `${n.text}=${n.layout}`).join("、")}`;
      // 每个节点都排进去了
      walk(doc.root, (n) => {
        if (n.hidden) return;
        assert.ok(res.placed.has(n.id), `${where}：${n.text} 没排进去`);
      });
      // 节点和展开的备注互不重叠
      const rects: { b: Bounds; who: string; owner: MindNode }[] = [];
      for (const p of res.placed.values()) rects.push({ b: p, who: p.node.text, owner: p.node });
      for (const nt of res.notes) rects.push({ b: nt, who: `${nt.node.text} 的备注`, owner: nt.node });
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          if (rects[i].owner === rects[j].owner) continue;
          assert.ok(!hit(rects[i].b, rects[j].b), `${where}：${rects[i].who} 和 ${rects[j].who} 重叠`);
        }
      // 设了结构的分支：子孙都在它那一块里，这一块不压到父节点
      for (const n of set) {
        const p = res.placed.get(n.id)!;
        const parent = res.placed.get(n.parent!.id)!;
        let block: Bounds = p;
        walk(n, (d) => {
          const q = res.placed.get(d.id);
          if (!q || d === n) return;
          const x = Math.min(block.x, q.x);
          const y = Math.min(block.y, q.y);
          block = { x, y, w: Math.max(block.x + block.w, q.x + q.w) - x, h: Math.max(block.y + block.h, q.y + q.h) - y };
          assert.ok(!hit(q, parent), `${where}：${d.text} 压到了 ${n.parent!.text}`);
        });
      }
      // 每个设成时间轴、鱼骨图（而且生效）的分支都有自己的主轴，主主题的那一段在里面
      for (const n of set) {
        if (!n.layout!.startsWith("timeline") && n.layout !== "fishbone") continue;
        const kids = visibleChildren(n);
        if (!kids.length) continue;
        const sp = allSpines(res).find((s) => s.segs.has(kids[0].id));
        assert.ok(sp, `${where}：${n.text}（${n.layout}）没有主轴`);
      }
    }
    assert.ok(mixed > 20, `真的测到了混合的分支（${mixed} 个）`);
  });
}

test("混合结构：分支的子节点按它自己的方向长", () => {
  const doc = parseMarkdown("# 根\n\n- 组织 %%layout=org-down%%\n\t- 甲\n\t- 乙\n- 普通\n\t- 丙\n");
  const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "logic-right" });
  const [org, plain] = doc.root.children;
  const po = res.placed.get(org.id)!;
  for (const c of org.children) {
    const q = res.placed.get(c.id)!;
    assert.equal(q.side, "down");
    assert.ok(q.y > po.y + po.h, `${c.text} 在 组织 下面`);
  }
  assert.equal(res.placed.get(org.id)!.side, "right", "分支根和父节点之间还是逻辑图的连线");
  assert.equal(res.placed.get(org.id)!.toggle, "down", "折叠按钮在下面");
  assert.equal(res.placed.get(plain.children[0].id)!.side, "right");
});

test("混合结构：左右分布的左半边，逻辑图分支往左长、鱼骨图鱼头朝右", () => {
  const doc = parseMarkdown("# 根\n\n- 右 %%right%%\n- 逻辑 %%left layout=logic-right%%\n\t- 甲\n- 鱼 %%left layout=fishbone%%\n\t- 原因1\n\t\t- 细\n\t- 原因2\n");
  const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "mindmap" });
  const [, logic, fish] = doc.root.children;
  const pl = res.placed.get(logic.id)!;
  const kid = res.placed.get(logic.children[0].id)!;
  assert.equal(kid.side, "left");
  assert.ok(kid.x + kid.w <= pl.x, "逻辑图分支的子节点在左边");
  const pf = res.placed.get(fish.id)!;
  for (const c of fish.children) {
    const q = res.placed.get(c.id)!;
    assert.ok(q.x + q.w <= pf.x + pf.w, `${c.text} 在鱼头左边`);
  }
  assert.equal(pf.toggle, "left");
});

test("混合结构：没有标记时排版和以前一样（结构不受 layout 字段的影响）", () => {
  for (const structure of STRUCTS) {
    const a = parseMarkdown(genNote(5));
    const b = parseMarkdown(genNote(5));
    const ra = layoutMap(a.root, measure, { ...DEFAULT_LAYOUT, structure });
    const rb = layoutMap(b.root, measure, { ...DEFAULT_LAYOUT, structure });
    assert.deepEqual(
      [...ra.placed.values()].map((p) => [p.x, p.y, p.side]),
      [...rb.placed.values()].map((p) => [p.x, p.y, p.side]),
    );
    assert.equal(ra.spines, undefined);
  }
});

test("混合结构：外框、概要框住设了自己结构的分支时，整块都在框里、不压到别的节点", () => {
  for (const structure of ["logic-right", "mindmap", "org-down", "tree-right"] as Structure[]) {
    for (const lay of BRANCH_LAYOUTS) {
      const src = `# 根\n\n- 甲 %%box=2 "框"%%\n\t- 甲一\n\t- 甲二\n- 乙 %%layout=${lay}%%\n\t- 乙一\n\t\t- 乙一一\n\t- 乙二\n\t- 乙三\n- 丙 %%summary=2 "概要"%%\n\t- 丙一\n- 丁 %%layout=${lay}%%\n\t- 丁一\n\t- 丁二\n- 戊\n\t- 戊一\n`;
      const doc = parseMarkdown(src);
      const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure }, () => ({ w: 40, h: 20 }));
      const where = `整图 ${structure}、分支 ${lay}`;
      const inside = (b: Bounds, c: Bounds) => c.x >= b.x - 0.5 && c.y >= b.y - 0.5 && c.x + c.w <= b.x + b.w + 0.5 && c.y + c.h <= b.y + b.h + 0.5;
      const box = res.boxes.find((b) => b.start.text === "甲")!;
      assert.ok(box, `${where}：有外框`);
      const sum = res.summaries.find((s) => s.start.text === "丙")!;
      assert.ok(sum, `${where}：有概要`);
      for (const p of res.placed.values()) {
        const inBox = ["甲", "乙"].some((t) => p.node.text.startsWith(t));
        if (inBox) assert.ok(inside(box, p), `${where}：${p.node.text} 在外框里`);
        else assert.ok(!hit(box, p), `${where}：${p.node.text} 压到了外框`);
        const inSum = ["丙", "丁"].some((t) => p.node.text.startsWith(t));
        if (!inSum) assert.ok(!hit(sum.brace, p), `${where}：${p.node.text} 压到了概要的括号`);
        if (sum.label && p.node.parent) assert.ok(!hit(sum.label, p), `${where}：${p.node.text} 压到了概要文字`);
      }
    }
  }
});

/** 折叠按钮占的地方（和 styles.css 一样：离节点 10px、16px 见方），连同它连到节点的那一小段 */
function toggleRect(p: { x: number; y: number; w: number; h: number; side: string; toggle?: string }): Bounds {
  const dir = p.toggle ?? (p.side === "left" || p.side === "down" || p.side === "up" ? p.side : "right");
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  if (dir === "right") return { x: p.x + p.w, y: cy - 8, w: 26, h: 16 };
  if (dir === "left") return { x: p.x - 26, y: cy - 8, w: 26, h: 16 };
  if (dir === "down") return { x: cx - 8, y: p.y + p.h, w: 16, h: 26 };
  return { x: cx - 8, y: p.y - 26, w: 16, h: 26 };
}

test("混合结构：分支根节点的折叠按钮不被别的节点压住", () => {
  for (const structure of ["logic-right", "mindmap", "org-down", "tree-right"] as Structure[]) {
    for (const lay of BRANCH_LAYOUTS) {
      for (const side of ["right", "left"]) {
        if (side === "left" && structure !== "mindmap") continue;
        const doc = parseMarkdown(`# 根\n\n- 甲\n- 分支 %%${side} layout=${lay}%%\n\t- 第一个主题\n\t\t- 细节\n\t- 第二个\n\t- 第三个比较长的主题\n- 乙\n`);
        const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure });
        const b = doc.root.children[1];
        const t = toggleRect(res.placed.get(b.id)!);
        for (const q of res.placed.values()) {
          if (q.node === b) continue;
          assert.ok(!hit(t, q), `整图 ${structure}、${side} 边的 ${lay} 分支：折叠按钮被「${q.node.text}」压住`);
        }
      }
    }
  }
});

test("混合结构：父节点连到分支根的线不从分支里穿过去", () => {
  for (const structure of ["logic-right", "mindmap", "org-down", "tree-right"] as Structure[]) {
    for (const lay of BRANCH_LAYOUTS) {
      for (const side of ["right", "left"]) {
        if (side === "left" && structure !== "mindmap") continue;
        if (side === "left" && lay.startsWith("timeline-h")) continue;
        for (const pos of [0, 1, 2]) {
          const kids = ["- 甲\n\t- 甲一\n", "- 乙\n\t- 乙一\n\t- 乙二\n", "- 丙\n"];
          kids.splice(pos, 0, `- 分支 %%${side} layout=${lay}%%\n\t- 第一个主题\n\t\t- 细节一\n\t\t- 细节二\n\t- 第二个\n\t\t- 细节三\n\t- 第三个比较长的主题\n`);
          const doc = parseMarkdown(`# 根\n\n${kids.join("")}`);
          const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure });
          const b = doc.root.children.find((c) => c.text === "分支")!;
          const p = res.placed.get(b.id)!;
          const parent = res.placed.get(b.parent!.id)!;
          const where = `整图 ${structure}、${side} 边、第 ${pos + 1} 个的 ${lay} 分支`;
          // 连线：父节点出线点 → 整块的边（entry，没有就是根节点的边），这一段的外接框里没有分支里的节点；再直着进根节点
          const horiz = p.side === "right" || p.side === "left";
          const end = horiz ? (p.side === "right" ? p.x : p.x + p.w) : p.y;
          const entry = p.entry ?? end;
          const cy = p.y + p.h / 2;
          const cx = p.x + p.w / 2;
          const x1 = p.side === "right" ? parent.x + parent.w : p.side === "left" ? parent.x : parent.x + parent.w / 2;
          const y1 = p.side === "down" ? parent.y + parent.h : parent.y + parent.h / 2;
          const curve: Bounds = horiz
            ? { x: Math.min(x1, entry), y: Math.min(y1, cy), w: Math.abs(entry - x1), h: Math.abs(cy - y1) }
            : { x: Math.min(x1, cx), y: Math.min(y1, entry), w: Math.abs(cx - x1), h: Math.abs(entry - y1) };
          const line: Bounds = horiz ? { x: Math.min(entry, end), y: cy - 1, w: Math.abs(end - entry), h: 2 } : { x: cx - 1, y: Math.min(entry, end), w: 2, h: Math.abs(end - entry) };
          walk(b, (d) => {
            if (d === b) return;
            const q = res.placed.get(d.id)!;
            assert.ok(!hit(curve, q), `${where}：连线的弯曲段穿过「${d.text}」`);
            assert.ok(!hit(line, q), `${where}：连线直着接进根节点的那段穿过「${d.text}」`);
          });
        }
      }
    }
  }
});

test("混合结构：自由主题按自己的结构排，左边的朝左", () => {
  const doc = parseMarkdown("---\nmindmap-structure: mindmap\n---\n# 根\n\n- 甲\n- 右边自由 %%float x=500 y=0 layout=org-down%%\n\t- 一\n\t- 二\n- 左边自由 %%float x=-500 y=0 layout=fishbone%%\n\t- 原因一\n\t- 原因二\n");
  const res = layoutMap(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "mindmap" });
  const [, r, l] = doc.root.children;
  const pr = res.placed.get(r.id)!;
  for (const c of r.children) assert.ok(res.placed.get(c.id)!.y > pr.y + pr.h, `${c.text} 在右边自由主题下面`);
  assert.equal(pr.toggle, "down");
  const pl = res.placed.get(l.id)!;
  for (const c of l.children) {
    const q = res.placed.get(c.id)!;
    assert.ok(q.x + q.w <= pl.x + pl.w, `${c.text} 在左边自由主题（鱼头）左边`);
  }
  assert.equal(pl.toggle, "left");
  assert.ok(allSpines(res).some((s) => s.segs.has(l.children[0].id)), "左边自由主题有自己的主骨");
});
