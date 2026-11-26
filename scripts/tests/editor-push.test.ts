import { test } from "node:test";
import assert from "node:assert/strict";
import { editorChange } from "../../src/editor-push-core";

const apply = (s: string, c: { from: number; to: number; insert: string } | null) => (c ? s.slice(0, c.from) + c.insert + s.slice(c.to) : s);

test("一样就不改", () => {
  assert.equal(editorChange("# a\n- b\n", "# a\n- b\n"), null);
});

test("只换中间改了的一段", () => {
  const a = "# 图\n- 甲\n- 乙\n- 丙\n";
  const b = "# 图\n- 甲\n- 乙改\n- 丙\n";
  const c = editorChange(a, b)!;
  assert.deepEqual(c, { from: a.indexOf("乙") + 1, to: a.indexOf("乙") + 1, insert: "改" });
  assert.equal(apply(a, c), b);
});

test("删掉、挪动、开头结尾改动都能还原", () => {
  const cases: [string, string][] = [
    ["- 甲\n- 乙\n- 丙\n", "- 乙\n- 丙\n"],
    ["- 甲\n- 乙\n- 丙\n", "- 丙\n- 甲\n- 乙\n"],
    ["- 甲\n", "x- 甲\ny"],
    ["", "- 新\n"],
    ["- 旧\n", ""],
    ["- 甲甲\n", "- 甲\n"],
  ];
  for (const [a, b] of cases) assert.equal(apply(a, editorChange(a, b)), b);
});

test("\\r\\n 的文本按编辑器里的 \\n 比", () => {
  const a = "- 甲\n- 乙\n";
  const c = editorChange(a, "- 甲\r\n- 乙改\r\n")!;
  assert.equal(apply(a, c), "- 甲\n- 乙改\n");
  assert.equal(editorChange(a, "- 甲\r\n- 乙\r\n"), null);
});

test("不从 emoji 中间切开", () => {
  // 😀 = 😀，😁 = 😁：高位相同，低位不同
  const a = "- 😀\n";
  const b = "- 😁\n";
  const c = editorChange(a, b)!;
  assert.equal(apply(a, c), b);
  assert.equal(c.insert, "😁");
});
