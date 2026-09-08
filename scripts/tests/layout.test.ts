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

import { fromEditableText, plainText, toEditableText } from "../../src/inline";

test("多行节点文本用 <br> 存储，编辑时还原成换行", () => {
  assert.equal(fromEditableText("第一行\n  第二行  \n\n第三行"), "第一行<br>第二行<br>第三行");
  assert.equal(toEditableText("a<br>b<br/>c"), "a\nb\nc");
  assert.equal(plainText("a<br>**b**"), "a b");
});

test("组织结构图：子节点水平排在父节点下方并居中，无重叠", () => {
  const doc = parseMarkdown(src);
  const res = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "org-down" });
  const all = [...res.placed.values()];
  const root = all[0];
  for (const p of all) if (p.node.depth > 0) assert.ok(p.y > root.y + root.h, `${p.node.text} 应在根下方`);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) assert.ok(!overlaps(all[i], all[j]), `${all[i].node.text} 与 ${all[j].node.text} 重叠`);
  const get = (path: string) => res.placed.get(findByPath(doc.root, path)!.id)!;
  const a = get("0");
  const a1 = get("0/0");
  const a3 = get("0/2");
  assert.equal(a.side, "down");
  assert.ok(Math.abs(a.x + a.w / 2 - (a1.x + a3.x + a3.w) / 2) < 0.01, "A 应位于 a1..a3 的水平中心");
  assert.ok(a1.x < get("0/1").x && get("0/1").x < a3.x, "兄弟从左到右");
  assert.equal(a1.y, get("0/1").y, "兄弟同一行");
});

test("树形图：子节点向右缩进、逐个向下堆叠", () => {
  const doc = parseMarkdown(src);
  const res = layoutTree(doc.root, measure, { ...DEFAULT_LAYOUT, structure: "tree-right" });
  const get = (path: string) => res.placed.get(findByPath(doc.root, path)!.id)!;
  const root = res.placed.get(doc.root.id)!;
  const a = get("0");
  const b = get("1");
  const a1 = get("0/0");
  assert.equal(a.side, "tree");
  assert.equal(a.x, root.x + 32);
  assert.equal(a1.x, a.x + 32);
  assert.ok(a1.y > a.y + a.h, "a1 在 A 下方");
  assert.ok(b.y > get("0/2").y + get("0/2").h, "B 排在 A 的整棵子树之后");
  const all = [...res.placed.values()];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) assert.ok(!overlaps(all[i], all[j]), `${all[i].node.text} 与 ${all[j].node.text} 重叠`);
});

test("plainText 会把图片语法化成文件名或 alt，供搜索用", () => {
  assert.equal(plainText("看图 ![[a.png|120]] 和 ![封面](https://x/y.png)"), "看图 a.png 和 封面");
});

import { setImageWidth } from "../../src/inline";

test("改写图片宽度参数：wiki 与 Markdown 两种写法，去参数时恢复", () => {
  assert.equal(setImageWidth("看 ![[a.png]] 图", 200), "看 ![[a.png|200]] 图");
  assert.equal(setImageWidth("![[a.png|160]]", 320), "![[a.png|320]]");
  assert.equal(setImageWidth("![[a.png|160]]", null), "![[a.png]]");
  assert.equal(setImageWidth("![[a.png|说明]]", 120), "![[a.png|说明|120]]");
  assert.equal(setImageWidth("![封面](https://x/y.png)", 150), "![封面|150](https://x/y.png)");
  assert.equal(setImageWidth("![封面|150](https://x/y.png)", null), "![封面](https://x/y.png)");
  assert.equal(setImageWidth("没有图片", 100), "没有图片");
});

import { MARKER_GROUPS, splitMarkers, toggleMarker, toggleTask } from "../../src/inline";

test("标记 emoji：同组互斥、再点移除、顺序固定", () => {
  assert.equal(toggleMarker("任务", "2️⃣"), "2️⃣ 任务");
  assert.equal(toggleMarker("2️⃣ 任务", "3️⃣"), "3️⃣ 任务", "优先级互斥");
  assert.equal(toggleMarker("3️⃣ 任务", "3️⃣"), "任务", "再点移除");
  assert.equal(toggleMarker("🚩 任务", "⭐"), "🚩 ⭐ 任务", "旗帜与符号可并存");
  assert.equal(toggleMarker("⭐ 任务", "1️⃣"), "1️⃣ ⭐ 任务", "优先级排在前面");
  assert.deepEqual(splitMarkers("1️⃣ ✅ 完成 [x] 事"), { markers: ["1️⃣", "✅"], rest: "完成 [x] 事" });
  assert.ok(MARKER_GROUPS.length >= 4);
});

test("任务复选框切换：无 → 空 → 勾 → 无；标记保留在前面", () => {
  assert.equal(toggleTask("事项"), "[ ] 事项");
  assert.equal(toggleTask("[ ] 事项"), "[x] 事项");
  assert.equal(toggleTask("[x] 事项"), "事项");
  assert.equal(toggleTask("🚩 [ ] 事项"), "🚩 [x] 事项");
  assert.equal(toggleTask("[ ] 事项", "add-remove"), "事项");
});

test("聚焦分支时布局按相对深度算间距", () => {
  const doc = parseMarkdown(src);
  const a = findByPath(doc.root, "0")!;
  const res = layoutTree(a, measure, { ...DEFAULT_LAYOUT, structure: "logic-right" });
  const pa = res.placed.get(a.id)!;
  const a1 = res.placed.get(findByPath(doc.root, "0/0")!.id)!;
  assert.equal(pa.x, -pa.w / 2, "聚焦节点当作根放在原点");
  assert.equal(a1.x, pa.x + pa.w + DEFAULT_LAYOUT.gapRoot, "它的子节点用根到主主题的间距");
  assert.equal(res.placed.size, 4);
});
