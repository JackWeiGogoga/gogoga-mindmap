import assert from "node:assert/strict";
import test from "node:test";
import { locateSnippet } from "../../src/note-spot";

const src = "第一段写了一些**重点**内容。\n\n- 列表里也有重点内容\n- 第二项\n\n最后一段：重点内容在这里";

test("鼠标前后的字在原文里连着：找到那个位置", () => {
  // 渲染后「第一段写了一些」是一个文字节点，点在「写了」后面
  assert.equal(locateSnippet(src, "第一段写了", "一些", 0.05), src.indexOf("一些"));
});

test("几处都对得上：挑相对位置最近的", () => {
  // 「内容」出现三次；点的是最后一段那个（相对位置靠后）
  const last = src.lastIndexOf("内容");
  assert.equal(locateSnippet(src, "重点", "内容在", 0.9), last);
  // 只给「内容」两个字，靠前的位置挑第一处
  assert.equal(locateSnippet(src, "", "内容", 0.1), src.indexOf("内容"));
});

test("渲染后去掉了记号：前面那段在原文里不连着，缩短后照样找到", () => {
  // 渲染出来是「重点内容。」一个节点里只有「内容。」（粗体是另一个节点），点在「内」前面
  assert.equal(locateSnippet(src, "", "内容。", 0.2), src.indexOf("内容。"));
});

test("对不上返回 null", () => {
  assert.equal(locateSnippet(src, "完全没有", "的字", 0.5), null);
  assert.equal(locateSnippet(src, "", "", 0.5), null);
});
