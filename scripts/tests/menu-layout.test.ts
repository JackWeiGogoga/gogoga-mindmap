import assert from "node:assert/strict";
import test from "node:test";
import { arrangeMenu, cleanLayout, MORE_SLOT, placeOf } from "../../src/menu-layout";

type E = { id?: string; separator?: boolean; title?: string };
const sep = (): E => ({ separator: true });
const ids = (l: E[]) => l.map((e) => (e.separator ? "|" : (e.title ?? e.id)));

const top: E[] = [{ id: "edit" }, { id: "addChild" }, sep(), { id: "note" }, { id: "rel" }, sep(), { id: "copy" }, sep(), { id: MORE_SLOT }, sep(), { id: "delete" }];
const more: E[] = [{ id: "review" }, sep(), { id: "convert", title: "toHeading" }, { id: "convert", title: "toList" }, { id: "split" }, sep(), { id: "textColor" }];

test("右键菜单：没设置时原样", () => {
  const r = arrangeMenu(top, more, {}, sep);
  assert.deepEqual(ids(r.top), ids(top));
  assert.deepEqual(ids(r.more), ids(more));
});

test("右键菜单：提到第一层的放在「更多」前面，同一个 id 的几项一起挪", () => {
  const r = arrangeMenu(top, more, { review: "top", convert: "top" }, sep);
  assert.deepEqual(ids(r.top), ["edit", "addChild", "|", "note", "rel", "|", "copy", "|", "review", "toHeading", "toList", "|", MORE_SLOT, "|", "delete"]);
  assert.deepEqual(ids(r.more), ["split", "|", "textColor"]);
});

test("右键菜单：收进「更多」的放在最前面，隐藏的去掉，分隔线不连着", () => {
  const r = arrangeMenu(top, more, { note: "more", rel: "hidden", copy: "hidden" }, sep);
  assert.deepEqual(ids(r.top), ["edit", "addChild", "|", MORE_SLOT, "|", "delete"]);
  assert.deepEqual(ids(r.more), ["note", "|", "review", "|", "toHeading", "toList", "split", "|", "textColor"]);
});

test("右键菜单：核心操作不能隐藏，只能挪到「更多」", () => {
  assert.equal(placeOf("edit", { edit: "hidden" }), "top");
  assert.equal(placeOf("delete", { delete: "more" }), "more");
  const r = arrangeMenu(top, more, { edit: "hidden", addChild: "more" }, sep);
  assert.equal(ids(r.top)[0], "edit");
  assert.equal(ids(r.more)[0], "addChild");
});

test("右键菜单：存设置只留和默认不一样的、认识的", () => {
  assert.deepEqual(cleanLayout({ edit: "hidden", note: "top", review: "top", bogus: "more", rel: "x" }), { review: "top" });
  assert.deepEqual(cleanLayout(undefined), {});
});
