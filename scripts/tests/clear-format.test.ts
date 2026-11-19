import assert from "node:assert/strict";
import test from "node:test";
import { applyFormat, clearFormat } from "../../src/format-apply";

/** 用 [ ] 标出选区，返回清除格式后的文字，新选区同样用 [ ] 标出 */
function run(marked: string): string {
  const s = marked.indexOf("[");
  const e = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  const r = clearFormat(text, s, e);
  return r.text.slice(0, r.start) + "[" + r.text.slice(r.start, r.end) + "]" + r.text.slice(r.end);
}

test("清除格式（#45）：选中的整段，各种格式都去掉", () => {
  assert.equal(run("[**粗** 和 *斜* 和 ~~删~~ 和 ==亮== 和 <u>下</u>]"), "[粗 和 斜 和 删 和 亮 和 下]");
  assert.equal(run('[<span style="color:#e03e3e">红</span> <mark style="background:#ffd43b">黄</mark> ==🔴彩==]'), "[红 黄 彩]");
  // 套在一起的
  assert.equal(run("[***粗斜***]"), "[粗斜]");
  assert.equal(run("[**粗*斜*粗**]"), "[粗斜粗]");
  assert.equal(run('[<span style="color:#e03e3e">**红粗**</span>]'), "[红粗]");
});

test("清除格式：选的是格式里面的字（编辑框里标记藏着）或连标记一起选", () => {
  assert.equal(run("一段**[文字]**内容"), "一段[文字]内容");
  assert.equal(run("一段[**文字**]内容"), "一段[文字]内容");
  // 只选到半个标记：当整个选中
  assert.equal(run("一段*[*文字**]内容"), "一段[文字]内容");
});

test("清除格式：只选中一段格式中间的一截，两头断开，没选的字保留格式", () => {
  assert.equal(run("**甲[乙]丙**"), "**甲**[乙]**丙**");
  assert.equal(run("**甲[乙丙]**"), "**甲**[乙丙]");
  assert.equal(run("**[甲乙]丙**"), "[甲乙]**丙**");
  assert.equal(run("前**甲[乙** 中 *丙]丁*后"), "前**甲**[乙 中 丙]*丁*后");
  // 套着的也按里外层顺序收尾、接上
  assert.equal(run("**甲*乙[丙*丁]戊**"), "**甲*乙***[丙丁]**戊**");
  assert.equal(run('<span style="color:#e03e3e">甲[乙]丙</span>'), '<span style="color:#e03e3e">甲</span>[乙]<span style="color:#e03e3e">丙</span>');
  // 选的正好是套在一起的几层格式里面的字（编辑框里标签藏着）：几层都整个去掉，不补空标签
  assert.equal(run('甲<span style="color:#e03e3e"><mark style="background:#ffd43b99">[乙丙]</mark></span>丁'), "甲[乙丙]丁");
  assert.equal(run("前***[粗斜]***后"), "前[粗斜]后");
  // 外层还有别的字：外层保留、里层去掉
  assert.equal(run('<span style="color:#e03e3e">甲<mark style="background:#ffd43b">[乙]</mark></span>'), '<span style="color:#e03e3e">甲</span>[乙]');
});

test("清除格式：选区外的格式、行内代码、链接不动；跨行", () => {
  assert.equal(run("**甲** [乙] **丙**"), "**甲** [乙] **丙**");
  assert.equal(run("[`代码` **粗** [[链接]]]"), "[`代码` 粗 [[链接]]]");
  assert.equal(run("[**甲**\n*乙*]"), "[甲\n乙]");
});

test("清除格式：选区为空时整段都清", () => {
  const r = clearFormat("**甲** *乙* ==丙==", 3, 3);
  assert.equal(r.text, "甲 乙 丙");
});

test("applyFormat：clear 走清除格式，别的照旧", () => {
  assert.equal(applyFormat("**甲**", 2, 3, { kind: "clear" }).text, "甲");
  assert.equal(applyFormat("甲", 0, 1, { kind: "bold" }).text, "**甲**");
});
