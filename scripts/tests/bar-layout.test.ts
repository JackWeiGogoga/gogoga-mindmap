import assert from "node:assert/strict";
import test from "node:test";
import { mergeLayout, moveItem, moveTo, NODEBAR_DEFAULT, sameAsDefault, visibleSeps } from "../../src/bar-layout";

test("没存过：就是默认清单，可选按钮默认不显示", () => {
  const l = mergeLayout(undefined, NODEBAR_DEFAULT);
  assert.equal(l.length, NODEBAR_DEFAULT.length);
  assert.deepEqual(l.filter((x) => !x.on).map((x) => x.id), ["rel", "table", "fold", "moveUp", "moveDown"]);
  assert.ok(sameAsDefault(l, NODEBAR_DEFAULT));
});

test("存的清单：认不得的丢掉、重复的去掉、新加的按默认位置插回去", () => {
  const l = mergeLayout(["trash", "!colors", "gone", "trash", "child"], ["colors", "child", "sibling", "trash", "!rel"]);
  assert.deepEqual(l.map((x) => x.id).sort(), ["child", "colors", "rel", "sibling", "trash"]);
  // sibling 默认跟在 child 后面
  const ids = l.map((x) => x.id);
  assert.equal(ids.indexOf("sibling"), ids.indexOf("child") + 1);
  assert.equal(l.find((x) => x.id === "colors")!.on, false);
  assert.equal(l.find((x) => x.id === "rel")!.on, false);
});

test("挪一格、拖到任意位置", () => {
  const l = mergeLayout(undefined, ["a", "b", "c", "d"]);
  assert.deepEqual(moveItem(l, 0, 1).map((x) => x.id), ["b", "a", "c", "d"]);
  assert.deepEqual(moveItem(l, 0, -1).map((x) => x.id), ["a", "b", "c", "d"]);
  assert.deepEqual(moveTo(l, 0, 3).map((x) => x.id), ["b", "c", "d", "a"]);
  assert.deepEqual(moveTo(l, 3, 0).map((x) => x.id), ["d", "a", "b", "c"]);
  assert.deepEqual(moveTo(l, 1, 2).map((x) => x.id), ["a", "c", "b", "d"]);
});

test("分隔线：头尾、连着两条、两边没有看得见的按钮时不显示", () => {
  assert.deepEqual(visibleSeps(["sep", "tool", "sep", "tool", "sep"]), [false, false, true, false, false]);
  assert.deepEqual(visibleSeps(["tool", "sep", "sep", "tool"]), [false, false, true, false]);
  assert.deepEqual(visibleSeps(["tool", "sep", "gone", "sep", "tool"]), [false, false, false, true, false]);
});
