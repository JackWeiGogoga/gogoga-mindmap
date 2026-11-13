import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomSplits, splitByPunctuation, splitText } from "../../src/split";

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

const parts = (text: string, rule: Parameters<typeof splitText>[1], keep = false) => splitText(text, rule, keep)?.parts ?? null;

test("句号、分号拆分；小数点不拆；连着的符号算一处", () => {
  assert.deepEqual(parts("今天下雨。明天放晴！后天呢？", { kind: "period" }), ["今天下雨", "明天放晴！", "后天呢？"].map((x) => x.replace(/[！？]$/, "")));
  assert.deepEqual(parts("版本 3.14 发布了. 很好用!!", { kind: "period" }), ["版本 3.14 发布了", "很好用"]);
  assert.deepEqual(parts("甲，乙；丙，丁", { kind: "semicolon" }), ["甲，乙", "丙，丁"]);
});

test("保留拆分符号：标点留在每段末尾", () => {
  assert.deepEqual(parts("苹果，香蕉，梨。", { kind: "comma" }, true), ["苹果，", "香蕉，", "梨。"]);
  assert.deepEqual(parts("今天下雨。明天放晴！", { kind: "period" }, true), ["今天下雨。", "明天放晴！"]);
});

test("自定义符号：句号分号拆，逗号顿号保留", () => {
  assert.deepEqual(parts("甲，乙。丙、丁；戊", { kind: "chars", chars: "。；" }), ["甲，乙", "丙、丁", "戊"]);
  assert.deepEqual(parseCustomSplits("句号分号：。；\n\n斜杠: / \n|"), [
    { name: "句号分号", chars: "。；" },
    { name: "斜杠", chars: "/" },
    { name: "|", chars: "|" },
  ]);
});

test("序号拆分：阿拉伯数字、带圈数字、中文、罗马数字", () => {
  assert.deepEqual(parts("1. 苹果 2. 香蕉 3. 梨", { kind: "number" }), ["苹果", "香蕉", "梨"]);
  assert.deepEqual(parts("1、苹果；2、香蕉；3、梨。", { kind: "number" }), ["苹果", "香蕉", "梨"]);
  assert.deepEqual(parts("(1)苹果(2)香蕉", { kind: "number" }), ["苹果", "香蕉"]);
  assert.deepEqual(parts("①苹果②香蕉③梨", { kind: "number" }), ["苹果", "香蕉", "梨"]);
  assert.deepEqual(parts("一、苹果 二、香蕉 三、梨", { kind: "number" }), ["苹果", "香蕉", "梨"]);
  assert.deepEqual(parts("（一）苹果（二）香蕉", { kind: "number" }), ["苹果", "香蕉"]);
  assert.deepEqual(parts("I. 苹果 II. 香蕉 III. 梨", { kind: "number" }), ["苹果", "香蕉", "梨"]);
  assert.deepEqual(parts("i) 苹果 ii) 香蕉", { kind: "number" }), ["苹果", "香蕉"]);
});

test("序号拆分：保留序号；序号后面紧接文字时文字保留", () => {
  assert.deepEqual(parts("一、苹果 二、香蕉", { kind: "number" }, true), ["一、苹果", "二、香蕉"]);
  assert.deepEqual(parts("①苹果②香蕉", { kind: "number" }, false), ["苹果", "香蕉"]);
  assert.deepEqual(parts("1.苹果 2.香蕉", { kind: "number" }), ["苹果", "香蕉"]);
});

test("序号拆分：序号前面的文字单独给出；不按顺序、不在标点后的数字不算", () => {
  assert.deepEqual(splitText("水果：1. 苹果 2. 梨", { kind: "number" }), { lead: "水果：", parts: ["苹果", "梨"] });
  assert.equal(parts("第1版和第2版", { kind: "number" }), null);
  assert.equal(parts("3. 苹果 1. 梨", { kind: "number" }), null);
  assert.equal(parts("I am here. You are there.", { kind: "number" }), null);
  assert.deepEqual(parts("版本 2.0 的改动：1. 修复 2. 新增", { kind: "number" }), ["修复", "新增"]);
  assert.deepEqual(parts("1. 见 [[笔记 2. 草稿]] 2. 完成", { kind: "number" }), ["见 [[笔记 2. 草稿]]", "完成"]);
});
