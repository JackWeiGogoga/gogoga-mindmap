import assert from "node:assert/strict";
import test from "node:test";
import { splitByPunctuation } from "../../src/markdown";

test("按中英文逗号、顿号、分号拆开，去掉空白和句末句号", () => {
  assert.deepEqual(splitByPunctuation("苹果、香蕉，梨；桃。"), ["苹果", "香蕉", "梨", "桃"]);
  assert.deepEqual(splitByPunctuation("red, green; blue"), ["red", "green", "blue"]);
  assert.deepEqual(splitByPunctuation("甲，，乙"), ["甲", "乙"]);
});

test("链接、公式、代码里的标点和千分位逗号不拆", () => {
  assert.deepEqual(splitByPunctuation("[[笔记, 一]]、$f(x,y)$、`a,b`"), ["[[笔记, 一]]", "$f(x,y)$", "`a,b`"]);
  assert.deepEqual(splitByPunctuation("[文字，说明](https://a.com/x,y)，第二段"), ["[文字，说明](https://a.com/x,y)", "第二段"]);
  assert.deepEqual(splitByPunctuation("收入 1,000 元，支出 2,500 元"), ["收入 1,000 元", "支出 2,500 元"]);
});

test("拆不出两段返回 null", () => {
  assert.equal(splitByPunctuation("没有标点"), null);
  assert.equal(splitByPunctuation("只有一段，"), null);
  assert.equal(splitByPunctuation("1,000"), null);
});
