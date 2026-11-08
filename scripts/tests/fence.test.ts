import assert from "node:assert/strict";
import test from "node:test";
import { fencedLines } from "../../src/fence";

// 「在笔记里隐藏格式标签」：代码块、公式块、frontmatter 里的行不动
test("代码块、公式块（含一行写完的 $$a$$）、frontmatter 里的行（围栏行本身也算），公式块后面的行不受影响", () => {
  const lines = ["---", "a: 1", "---", "正文 <u>x</u>", "```", "<u>代码</u>", "```", "后面", "$$", "x<y", "$$", "$$a$$", "~~~~", "```", "~~~~", "尾"];
  const f = fencedLines((i) => lines[i], lines.length);
  assert.deepEqual(
    lines.map((l, i) => (f[i] ? "*" : "") + l).filter((l) => !l.startsWith("*")),
    ["正文 <u>x</u>", "后面", "尾"],
  );
});

test("没收尾的代码块：后面都算在里面；不在开头的 --- 不是 frontmatter", () => {
  assert.deepEqual(fencedLines((i) => ["正文", "```", "a", "b"][i], 4), [false, true, true, true]);
  assert.deepEqual(fencedLines((i) => ["正文", "---", "b"][i], 3), [false, false, false]);
});
