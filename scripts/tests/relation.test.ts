import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";

const parse = (t: string) => parseMarkdown(t, { fallbackTitle: "" });

test("关联线：id 和 rel 读出来，写回一字不差", () => {
  const src = "# T\n\n## 甲\n%%blue rel=r1 \"依赖\" c=40,-60 rel=r2%%\n\n## 乙\n%%id=r1%%\n\n- 丙 %%id=r2 rel=r1%%\n";
  const doc = parse(src);
  const [a, b] = doc.root.children;
  assert.equal(a.color, "blue");
  assert.deepEqual(a.rels, [
    { to: "r1", label: "依赖", c: { x: 40, y: -60 } },
    { to: "r2", label: "" },
  ]);
  assert.equal(b.anchor, "r1");
  const c = b.children[0];
  assert.equal(c.text, "丙");
  assert.equal(c.anchor, "r2");
  assert.deepEqual(c.rels, [{ to: "r1", label: "" }]);
  assert.equal(serializeMarkdown(doc), src);
});

test("关联线：改了以后按固定顺序写，文字里的引号去掉", () => {
  const doc = parse("# T\n\n- 甲\n- 乙\n");
  const [a, b] = doc.root.children;
  b.anchor = "r1";
  a.rels = [{ to: "r1", label: '他说"好"', c: { x: 12.4, y: -3.6 } }];
  assert.equal(serializeMarkdown(doc), "# T\n\n- 甲 %%rel=r1 \"他说好\" c=12,-4%%\n- 乙 %%id=r1%%\n");
});

test("不认识的写法不当标记：c= 前面没有 rel、id 里有怪字符", () => {
  const doc = parse("# T\n\n- 甲 %%c=1,2%%\n- 乙 %%id=a.b%%\n");
  assert.equal(doc.root.children[0].text, "甲 %%c=1,2%%");
  assert.equal(doc.root.children[1].text, "乙 %%id=a.b%%");
});

test("关联线几何：两端落在节点外面，文字在弧顶，c 就是弧顶相对中点的偏移", async () => {
  const { relGeometry } = await import("../../src/layout");
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const b = { x: 300, y: 0, w: 100, h: 40 };
  const g = relGeometry(a, b);
  // 默认朝上鼓
  assert.ok(g.top.y < 20, JSON.stringify(g.top));
  assert.equal(g.top.x, 200);
  const [sx, sy] = g.d.slice(1).split(" ")[0].split(",").map(Number);
  assert.ok(sx <= 0 || sx >= 100 || sy <= 0 || sy >= 40, g.d);
  // 拖过的 c 原样用
  const h = relGeometry(a, b, { x: 10, y: 80 });
  assert.deepEqual(h.top, { x: 210, y: 100 });
  assert.deepEqual(h.c, { x: 10, y: 80 });
});

// #28：两个控制点
import { relGeometry } from "../../src/layout";

test("两个控制点：c1= c2= 读出来，写回一字不差；旧的 c= 照旧", () => {
  const src = "# T\n\n- 甲 %%rel=r1 \"依赖\" c1=40,-60 c2=-30,-50 rel=r2 c=10,20%%\n- 乙 %%id=r1%%\n- 丙 %%id=r2%%\n";
  const doc = parse(src);
  assert.deepEqual(doc.root.children[0].rels, [
    { to: "r1", label: "依赖", c1: { x: 40, y: -60 }, c2: { x: -30, y: -50 } },
    { to: "r2", label: "", c: { x: 10, y: 20 } },
  ]);
  assert.equal(serializeMarkdown(doc), src);
});

test("拖过手柄（有 c1、c2）就不再写旧的 c=", () => {
  const doc = parse("# T\n\n- 甲 %%rel=r1 c=10,20%%\n- 乙 %%id=r1%%\n");
  const rel = doc.root.children[0].rels![0];
  rel.c1 = { x: 1, y: 2 };
  rel.c2 = { x: 3, y: 4 };
  rel.c = undefined;
  assert.equal(serializeMarkdown(doc), "# T\n\n- 甲 %%rel=r1 c1=1,2 c2=3,4%%\n- 乙 %%id=r1%%\n");
});

test("只有一个 c1 没有 c2：按旧样子画、不写（半截的不认）", () => {
  const doc = parse("# T\n\n- 甲 %%rel=r1 c1=1,2%%\n- 乙 %%id=r1%%\n");
  assert.equal(serializeMarkdown(doc), "# T\n\n- 甲 %%rel=r1%%\n- 乙 %%id=r1%%\n");
});

test("两个控制点的线：三次曲线，控制点跟着各自节点；文字在中间，箭头沿终点切线", () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const b = { x: 300, y: 0, w: 100, h: 40 };
  const g = relGeometry(a, b, undefined, { c1: { x: 0, y: -100 }, c2: { x: 0, y: -100 } });
  assert.match(g.d, /^M50,-\d+(\.\d+)? C50,-80 350,-80 /);
  assert.deepEqual(g.h1, { x: 50, y: -80 });
  assert.deepEqual(g.h2, { x: 350, y: -80 });
  // 终点从节点顶边上方出来，箭头朝下
  assert.equal(g.e.x, 350);
  assert.ok(g.e.y < 0);
  assert.ok(g.top.y < -40 && Math.abs(g.top.x - 200) < 1);
  // 节点挪了，控制点跟着挪
  const g2 = relGeometry(a, { ...b, y: 200 }, undefined, { c1: { x: 0, y: -100 }, c2: { x: 0, y: -100 } });
  assert.deepEqual(g2.h2, { x: 350, y: 120 });
});

test("一个控制点的线也给出画同一条线的两个手柄位置（拖手柄从这里接着拖）", () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const b = { x: 300, y: 0, w: 100, h: 40 };
  const q = relGeometry(a, b, { x: 0, y: -60 });
  // 二次升三次：手柄在起点、终点到二次控制点的 2/3 处，它们的 t=0.5 点就是弧顶
  const mid = { x: (q.s.x + 3 * q.h1.x + 3 * q.h2.x + q.e.x) / 8, y: (q.s.y + 3 * q.h1.y + 3 * q.h2.y + q.e.y) / 8 };
  assert.ok(Math.abs(mid.x - q.top.x) < 0.01 && Math.abs(mid.y - q.top.y) < 0.01, JSON.stringify([mid, q.top]));
});
