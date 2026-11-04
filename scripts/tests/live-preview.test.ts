import assert from "node:assert/strict";
import test from "node:test";
import { formatSpans, revealed } from "../../src/live-preview";

/** 每段写成「种类:中间的文字」，方便看 */
const show = (text: string) => formatSpans(text).map((s) => `${s.kind}:${text.slice(s.innerFrom, s.innerTo)}${s.color ? `@${s.color}` : ""}`);

test("常用格式：认出种类和中间的文字", () => {
  assert.deepEqual(show("a **粗** b *斜* c ==亮== d ~~删~~ e `码`"), ["strong:粗", "em:斜", "mark:亮", "del:删", "code:码"]);
  assert.deepEqual(show("__粗__ _斜_ <mark>亮</mark>"), ["strong:粗", "em:斜", "mark:亮"]);
});

test("颜色：带上颜色值，里面还能套格式", () => {
  assert.deepEqual(show('<span style="color:#e03e3e">红**粗**</span>'), ["color:红**粗**@#e03e3e", "strong:粗"]);
  assert.deepEqual(show('<mark style="background:#ffd43b99">黄</mark>'), ["bg:黄@#ffd43b99"]);
  assert.deepEqual(show('**<span style="color:red">蓝</span>**'), ["strong:<span style=\"color:red\">蓝</span>", "color:蓝@red"]);
});

test("标记符的位置：两头各自占的范围", () => {
  const text = 'x <span style="color:red">红</span> y';
  const [s] = formatSpans(text);
  assert.equal(text.slice(s.from, s.innerFrom), '<span style="color:red">');
  assert.equal(text.slice(s.innerTo, s.to), "</span>");
});

test("链接、公式、代码里的星号不当格式", () => {
  assert.deepEqual(show("[[a*b*c]] $x*y*z$ `**不粗**`"), ["code:**不粗**"]);
  assert.deepEqual(show("\\*不斜\\*"), []);
});

test("多行：按行找，位置按整段文字算", () => {
  const text = "第一行\n**第二**行";
  const [s] = formatSpans(text);
  assert.equal(text.slice(s.innerFrom, s.innerTo), "第二");
});

test("光标停在段里或贴着两头才露出源码", () => {
  const [s] = formatSpans("ab **粗** cd");
  assert.equal(revealed(s, [3]), true);
  assert.equal(revealed(s, [s.to]), true);
  assert.equal(revealed(s, [1, 10]), false);
  assert.equal(revealed(s, []), false);
});
