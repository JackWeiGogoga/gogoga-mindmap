import { test } from "node:test";
import assert from "node:assert/strict";
import { pairBackspace, pairInput } from "../../src/auto-pair-core";

const apply = (text: string, e: NonNullable<ReturnType<typeof pairInput>>) => text.slice(0, e.from) + e.insert + text.slice(e.to);

test("打左半边：补上右半边，光标在中间", () => {
  for (const [o, c] of [["“", "”"], ["‘", "’"], ['"', '"'], ["'", "'"], ["（", "）"], ["(", ")"], ["《", "》"], ["「", "」"]]) {
    const e = pairInput("", 0, 0, o, null)!;
    assert.equal(apply("", e), o + c, o);
    assert.equal(e.anchor, 1);
    assert.equal(e.closer, 1);
  }
});

test("【 和 [ 不管（留给 [[链接]]）；普通字不管", () => {
  assert.equal(pairInput("", 0, 0, "【", null), null);
  assert.equal(pairInput("", 0, 0, "[", null), null);
  assert.equal(pairInput("", 0, 0, "a", null), null);
});

test("光标后面紧挨着字：不补", () => {
  assert.equal(pairInput("测试", 0, 0, "“", null), null);
  assert.equal(pairInput("abc", 0, 0, "(", null), null);
  // 后面是空格、标点、右括号：照样补
  assert.ok(pairInput(" 后", 0, 0, "（", null));
  assert.ok(pairInput("）", 0, 0, "（", null));
});

test("英文引号前面是字母数字：不补（don't、5'）；中文引号照样补", () => {
  assert.equal(pairInput("don", 3, 3, "'", null), null);
  assert.equal(pairInput("5", 1, 1, '"', null), null);
  assert.ok(pairInput("说", 1, 1, "“", null));
});

test("选中了文字：包起来，选区还是那段字", () => {
  const e = pairInput("一段字", 1, 3, "《", null)!;
  assert.equal(apply("一段字", e), "一《段字》");
  assert.deepEqual([e.anchor, e.head], [2, 4]);
});

test("接着打补上的右半边：跳过去；不是补上的就照常输入", () => {
  // “|” 再打 ”
  const e = pairInput("“”", 1, 1, "”", 1)!;
  assert.equal(apply("“”", e), "“”");
  assert.equal(e.anchor, 2);
  // 右边那个不是自动补的（pending 不对）：照常输入
  assert.equal(pairInput("“”", 1, 1, "”", null), null);
});

test("退格：在刚补上的一对中间，两边一起删", () => {
  assert.deepEqual(pairBackspace("前“”后", 2, 2), { from: 1, to: 3 });
  assert.equal(pairBackspace("前“”后", 2, null), null);
  assert.equal(pairBackspace("“x”", 2, 2), null);
});
