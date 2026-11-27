import { test } from "node:test";
import assert from "node:assert/strict";
import { mindmapBlockInsert } from "../../src/insert-block-core";

test("空行：放一个代码块，光标到它下面的空行", () => {
  const r = mindmapBlockInsert("", 0, "mindmap", "中心主题");
  assert.equal(r.text, "```mindmap\n# 中心主题\n```\n");
  assert.deepEqual(r.cursor, { line: 3, ch: 0 });
});

test("行里有字：前面的字留在原行，后面的字挪到代码块下面", () => {
  const r = mindmapBlockInsert("前面 后面", 3, "mindmap", "中心主题");
  assert.equal(r.text, "前面\n```mindmap\n# 中心主题\n```\n后面");
  assert.deepEqual(r.cursor, { line: 4, ch: 0 });
});

test("光标在行尾：原行不动，代码块接在下面", () => {
  const r = mindmapBlockInsert("一行字", 3, "gogoga-mindmap", "Central topic");
  assert.equal(r.text, "一行字\n```gogoga-mindmap\n# Central topic\n```\n");
});
