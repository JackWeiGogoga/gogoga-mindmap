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

const at = (c: number) => ({ from: c, to: c });

test("Markdown 标记：光标或选区一头落在段里（含贴着两头）就露出源码", () => {
  const [s] = formatSpans("ab **粗** cd");
  assert.equal(revealed(s, [at(3)]), true);
  assert.equal(revealed(s, [at(s.to)]), true);
  assert.equal(revealed(s, [at(1), at(10)]), false);
  // 在段里拖选：一直露着，不会一选就收起
  assert.equal(revealed(s, [{ from: s.innerFrom, to: s.innerFrom + 1 }]), true);
  // 从段外选进来
  assert.equal(revealed(s, [{ from: 0, to: s.innerFrom + 1 }]), true);
  // 整段包进去（进入编辑时的全选）：不露
  assert.equal(revealed(s, [{ from: 0, to: 11 }]), false);
  assert.equal(revealed(s, []), false);
});

test("HTML 颜色标签和 <mark>：始终藏着，光标在里面也不露", () => {
  for (const text of ['a <span style="color:red">红</span> b', 'a <mark style="background:#ffd43b">黄</mark> b', "a <mark>亮</mark> b"]) {
    const [s] = formatSpans(text);
    assert.equal(s.html, true, text);
    assert.equal(revealed(s, [at(s.innerFrom)]), false, text);
  }
  assert.equal(formatSpans("a ==亮== b")[0].html, undefined);
});

test("Obsidian 彩色高亮：emoji 算在开头的标记符里，带上颜色", () => {
  const text = "a ==🔴红**粗**== b";
  const spans = formatSpans(text);
  assert.equal(spans[0].kind, "mark");
  assert.equal(spans[0].highlight, "red");
  assert.equal(text.slice(spans[0].from, spans[0].innerFrom), "==🔴");
  assert.equal(text.slice(spans[0].innerFrom, spans[0].innerTo), "红**粗**");
  assert.equal(spans[1].kind, "strong");
  assert.equal(formatSpans("==普通==")[0].highlight, undefined);
});
