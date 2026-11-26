import { test } from "node:test";
import assert from "node:assert/strict";
import { clickNode, frameView, presentKey, presentLook, presentProgress, presentRoute, presentSwipe, reanchor, startState, step, type PresentNode } from "../../src/present-core";

interface N extends PresentNode {
  children: N[];
  parent: N | null;
}
/** ["根", ["甲", ["甲一"], ["甲二", ["甲二一"]]], ["乙"]] 这样写树 */
type Spec = [string, ...Spec[]];
function tree(spec: Spec, parent: N | null = null): N {
  const n: N = { id: spec[0], children: [], parent };
  n.children = (spec.slice(1) as Spec[]).map((s) => tree(s, n));
  return n;
}
const find = (n: N, id: string): N => (n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean)!) as N;
const ids = (ns: N[]) => ns.map((n) => n.id);

const T = (): N => tree(["根", ["甲", ["甲一"], ["甲二", ["甲二一"]]], ["乙"], ["丙", ["丙一"]]]);

test("讲解顺序：先序，只走有子节点的，中心主题打头", () => {
  assert.deepEqual(ids(presentRoute(T())), ["根", "甲", "甲二", "丙"]);
});

test("讲解顺序：叶子也占一步", () => {
  assert.deepEqual(ids(presentRoute(T(), { leaves: true })), ["根", "甲", "甲一", "甲二", "甲二一", "乙", "丙", "丙一"]);
});

test("讲解顺序：只讲到第几层", () => {
  assert.deepEqual(ids(presentRoute(T(), { limit: 1 })), ["根"]);
  assert.deepEqual(ids(presentRoute(T(), { limit: 2 })), ["根", "甲", "丙"]);
  assert.deepEqual(ids(presentRoute(T(), { limit: 2, leaves: true })), ["根", "甲", "乙", "丙"]);
});

test("讲解顺序：折叠的不往里讲，隐藏的不算", () => {
  const t = T();
  find(t, "甲").folded = true;
  find(t, "丙一").hidden = true;
  assert.deepEqual(ids(presentRoute(t)), ["根"]);
});

test("只有中心主题也有一步", () => {
  assert.deepEqual(ids(presentRoute(tree(["根"]))), ["根"]);
});

test("前进、后退、结尾的全图、偷看全图", () => {
  const len = 4;
  let s = startState(presentRoute(T()), null);
  assert.deepEqual(s, { pos: 0, peek: false, ring: null });
  s = step(s, "prev", len);
  assert.equal(s.pos, 0, "第一步再后退不动");
  s = step(step(s, "next", len), "next", len);
  assert.equal(s.pos, 2);
  s = step(s, "overview", len);
  assert.equal(s.peek, true);
  assert.equal(presentProgress(s, len), null);
  s = step(s, "next", len);
  assert.deepEqual(s, { pos: 2, peek: false, ring: null }, "偷看全图时前进只是回到这一步");
  s = step(step(s, "next", len), "next", len);
  assert.equal(s.pos, 4, "讲完是全图");
  assert.equal(presentProgress(s, len), null);
  assert.deepEqual(step(s, "next", len), s, "全图之后不再往前");
  assert.deepEqual(step(s, "overview", len), s, "结尾全图上 O 没事做");
  assert.equal(step(s, "prev", len).pos, 3);
  assert.equal(step(s, "first", len).pos, 0);
  assert.equal(step({ pos: 1, peek: false, ring: null }, "last", len).pos, 4);
  assert.deepEqual(presentProgress({ pos: 1, peek: false, ring: null }, len), { at: 2, of: 4 });
});

test("点节点：在顺序里的跳过去；叶子从它那一步讲、加圈；后退先去掉圈", () => {
  const t = T();
  const route = presentRoute(t);
  assert.deepEqual(clickNode(route, find(t, "甲二")), { pos: 2, peek: false, ring: null });
  const s = clickNode(route, find(t, "甲一"));
  assert.deepEqual(s, { pos: 1, peek: false, ring: "甲一" });
  assert.deepEqual(step(s, "prev", route.length), { pos: 1, peek: false, ring: null });
  assert.deepEqual(step(s, "next", route.length), { pos: 2, peek: false, ring: null });
  // 从某个节点开始讲（右键「从这里开始演示」）同一个规则
  assert.deepEqual(startState(route, find(t, "甲二一")), { pos: 2, peek: false, ring: "甲二一" });
});

test("怎么画：当前节点、上级、子节点正常；镜头框住它、子节点和父节点", () => {
  const t = T();
  const route = presentRoute(t);
  const look = presentLook(route, { pos: 2, peek: false, ring: null });
  assert.deepEqual([...look.normal!].sort(), ["根", "甲", "甲二", "甲二一"].sort());
  assert.deepEqual(look.rings, ["甲二"]);
  assert.deepEqual(look.frame, ["甲二", "甲二一", "甲"]);
  const root = presentLook(route, { pos: 0, peek: false, ring: null });
  assert.deepEqual(root.frame, ["根", "甲", "乙", "丙"]);
  assert.deepEqual(presentLook(route, { pos: 1, peek: false, ring: "甲一" }).rings, ["甲", "甲一"]);
  assert.deepEqual(presentLook(route, { pos: 4, peek: false, ring: null }), { normal: null, rings: [], frame: null });
  assert.deepEqual(presentLook(route, { pos: 1, peek: true, ring: null }).normal, null);
});

test("图变了：留在原来的节点；它没了退到上级；圈只在还是子节点时留着", () => {
  const t = T();
  const old = presentRoute(t);
  // 甲二 还在
  assert.deepEqual(reanchor(presentRoute(t), { pos: 2, peek: false, ring: "甲二一" }, ["根", "甲", "甲二"], old.length), { pos: 2, peek: false, ring: "甲二一" });
  // 甲二 的子节点删掉了：它不再是一步，退到 甲
  const t2 = T();
  find(t2, "甲二").children = [];
  assert.deepEqual(reanchor(presentRoute(t2), { pos: 2, peek: false, ring: "甲二一" }, ["根", "甲", "甲二"], old.length), { pos: 1, peek: false, ring: null });
  // 在结尾全图上：还是结尾
  const r2 = presentRoute(t2);
  assert.deepEqual(reanchor(r2, { pos: 4, peek: false, ring: null }, [], old.length), { pos: r2.length, peek: false, ring: null });
  // 什么都对不上：回第 0 步
  assert.deepEqual(reanchor(r2, { pos: 2, peek: false, ring: null }, ["x", "y"], old.length).pos, 0);
});

test("按键", () => {
  for (const k of ["ArrowRight", "ArrowDown", "PageDown", "Enter", " "]) assert.equal(presentKey(k, {}), "next", k);
  for (const k of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) assert.equal(presentKey(k, {}), "prev", k);
  assert.equal(presentKey(" ", { shift: true }), "prev");
  assert.equal(presentKey("Home", {}), "first");
  assert.equal(presentKey("End", {}), "last");
  assert.equal(presentKey("o", {}), "overview");
  assert.equal(presentKey("Escape", {}), "exit");
  assert.equal(presentKey("ArrowRight", { meta: true }), null);
  assert.equal(presentKey("a", {}), null);
});

test("滑动：往左下一步，往右上一步；短的、偏竖直的不算", () => {
  assert.equal(presentSwipe(-80, 10), "next");
  assert.equal(presentSwipe(80, -10), "prev");
  assert.equal(presentSwipe(-30, 0), null);
  assert.equal(presentSwipe(-80, 70), null);
});

test("镜头：放进画面、居中，缩放有上下限", () => {
  const v = frameView({ x: 0, y: 0, w: 100, h: 50 }, { w: 400, h: 300 }, { pad: 50, minK: 0.2, maxK: 1.6 });
  assert.equal(v.k, 1.6);
  assert.equal(v.tx, 200 - 50 * 1.6);
  assert.equal(v.ty, 150 - 25 * 1.6);
  const big = frameView({ x: -1000, y: 0, w: 3000, h: 100 }, { w: 400, h: 300 }, { pad: 50, minK: 0.2, maxK: 1.6 });
  assert.equal(big.k, 0.2);
  // 底下有进度条：可用高度往上让
  const bar = frameView({ x: 0, y: 0, w: 10, h: 10 }, { w: 400, h: 300, bottom: 60 }, { pad: 0, minK: 1, maxK: 1 });
  assert.equal(bar.ty, 120 - 5);
});
