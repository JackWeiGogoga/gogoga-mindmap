import { test } from "node:test";
import assert from "node:assert/strict";
import { centerAt, MINIMAP_AUTO_NODES, minimapScale, minimapShown, toMini, viewRect } from "../../src/minimap-core";

const big = { nodes: 500, viewW: 1200, viewH: 800 };

test("什么时候显示", () => {
  assert.equal(minimapShown("auto", big), true);
  assert.equal(minimapShown("auto", { ...big, nodes: MINIMAP_AUTO_NODES - 1 }), false, "自动：节点少不显示");
  assert.equal(minimapShown("always", { ...big, nodes: 3 }), true);
  assert.equal(minimapShown("never", big), false);
  assert.equal(minimapShown("always", { ...big, embedded: true }), false, "嵌入的不显示");
  assert.equal(minimapShown("always", { ...big, presenting: true }), false, "演示时不显示");
  assert.equal(minimapShown("always", { ...big, viewW: 400 }), false, "窗格太窄不显示");
  assert.equal(minimapShown("always", { ...big, viewH: 300 }), false, "窗格太矮不显示");
});

test("比例：按长宽比放进最大框，留内边距；太窄 / 太扁时撑到最小值、图居中", () => {
  const wide = minimapScale({ x: 0, y: 0, w: 1880, h: 200 }, 200, 140, 6, 48);
  assert.equal(wide.s, 0.1);
  assert.deepEqual([wide.w, wide.h, wide.ox, wide.oy], [200, 48, 6, 14]);
  const tall = minimapScale({ x: -500, y: -1000, w: 400, h: 2560 }, 200, 140, 6, 48);
  assert.equal(tall.s, 128 / 2560);
  assert.deepEqual([tall.w, tall.h, tall.ox, tall.oy], [48, 140, 14, 6]);
  const normal = minimapScale({ x: 0, y: 0, w: 940, h: 640 }, 200, 140, 6, 48);
  assert.deepEqual([normal.w, normal.h], [200, 140]);
  assert.equal(normal.ox, 6);
});

test("坐标换算和视口框", () => {
  const b = { x: -100, y: -50, w: 1000, h: 500 };
  assert.deepEqual(toMini(b, 0.1, -100, -50, { x: 6, y: 6 }), { x: 6, y: 6 });
  assert.deepEqual(toMini(b, 0.1, 900, 450, { x: 6, y: 6 }), { x: 106, y: 56 });
  // 画布 800×600，缩放 2，平移让图上 (0,0) 在画布 (400,300)：看到的是图上 (-200,-150) 起 400×300 的一块
  const r = viewRect(b, 0.1, { w: 800, h: 600, tx: 400, ty: 300, k: 2 }, { x: 6, y: 6 });
  assert.deepEqual(r, { x: (-200 + 100) * 0.1 + 6, y: (-150 + 50) * 0.1 + 6, w: 40, h: 30 });
});

test("点缩略图：那一点到画布正中，再算一次视口框中心就是那一点", () => {
  const b = { x: -100, y: -50, w: 1000, h: 500 };
  const view = { w: 800, h: 600, k: 1.5 };
  const o = { x: 20, y: 9 };
  const to = centerAt(b, 0.1, 50, 30, view, o);
  const r = viewRect(b, 0.1, { ...view, ...to }, o);
  assert.ok(Math.abs(r.x + r.w / 2 - 50) < 1e-9);
  assert.ok(Math.abs(r.y + r.h / 2 - 30) < 1e-9);
});
