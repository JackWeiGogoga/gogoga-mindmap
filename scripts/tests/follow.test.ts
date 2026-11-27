import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFollowTarget } from "../../src/follow-core";

const m = (id: string, win: string, file: string | null, activeTime: number, pinned = false) => ({ id, win, file, activeTime, pinned });

test("两个窗口各有脑图：只换同一个窗口里的", () => {
  const maps = [m("A", "main", "a.md", 10), m("B", "pop", "b.md", 20)];
  assert.equal(pickFollowTarget(maps, "main", "c.md")?.id, "A");
  assert.equal(pickFollowTarget(maps, "pop", "c.md")?.id, "B");
});

test("同一个窗口里已经显示着这篇：不换（别的窗口显示着不算）", () => {
  const maps = [m("A", "main", "c.md", 10), m("B", "pop", "b.md", 20)];
  assert.equal(pickFollowTarget(maps, "main", "c.md"), null);
  assert.equal(pickFollowTarget(maps, "pop", "c.md")?.id, "B");
});

test("这个窗口里没有脑图：跟别的窗口里的（脑图单独放在第二块屏幕）", () => {
  const maps = [m("B", "pop", "b.md", 20)];
  assert.equal(pickFollowTarget(maps, "main", "c.md")?.id, "B");
});

test("钉住的不换；挑最近用过的", () => {
  const maps = [m("A", "main", "a.md", 30, true), m("B", "main", "b.md", 10), m("C", "main", "x.md", 20)];
  assert.equal(pickFollowTarget(maps, "main", "c.md")?.id, "C");
  assert.equal(pickFollowTarget([m("A", "main", "a.md", 30, true)], "main", "c.md"), null);
});
