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
