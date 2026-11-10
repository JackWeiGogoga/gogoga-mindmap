import assert from "node:assert/strict";
import test from "node:test";
import { carryAcrossBreaks, toEditableText } from "../../src/inline";
import { balancedSlice, breakInsideFormats } from "../../src/live-preview";

const RED = '<span style="color: #e03e3e">';

test("跨 <br> 的颜色：每一行自己收尾、接上", () => {
  assert.deepEqual(carryAcrossBreaks([`${RED}第一行`, "第二行</span>后面"]), [`${RED}第一行</span>`, `${RED}第二行</span>后面`]);
  assert.deepEqual(carryAcrossBreaks(["**粗", "体**"]), ["**粗**", "**体**"]);
  assert.deepEqual(carryAcrossBreaks(["a", "b"]), ["a", "b"]);
  // 嵌套：外层先开、内层先收
  assert.deepEqual(carryAcrossBreaks([`${RED}<u>甲`, "乙</u></span>"]), [`${RED}<u>甲</u></span>`, `${RED}<u>乙</u></span>`]);
});

test("编辑框里：<br> 变成换行，跨行的格式拆好", () => {
  assert.equal(toEditableText(`${RED}一<br>二</span>`), `${RED}一</span>\n${RED}二</span>`);
  assert.equal(toEditableText("一<br>二"), "一\n二");
});

test("复制颜色里的一段：补上开头和收尾", () => {
  const t = `我是，${RED}我要被复制出来</span>。`;
  const a = t.indexOf("我要");
  const b = t.indexOf("</span>");
  assert.equal(balancedSlice(t, a, b), `${RED}我要被复制出来</span>`);
  // 选区带上了开头的标签、没带结尾的（实际复制时常见）
  assert.equal(balancedSlice(t, t.indexOf("<span"), b), `${RED}我要被复制出来</span>`);
  // 只选了一半的字
  assert.equal(balancedSlice(t, a, a + 2), `${RED}我要</span>`);
  // 普通文字不动
  assert.equal(balancedSlice(t, 0, 2), "我是");
  // 选了整段（带两头标签）
  assert.equal(balancedSlice(t, t.indexOf("<span"), t.length), `${RED}我要被复制出来</span>。`);
});

test("复制：嵌套的格式按里外顺序补", () => {
  const t = `${RED}**粗体字**</span>`;
  const a = t.indexOf("体");
  assert.equal(balancedSlice(t, a, a + 1), `${RED}**体**</span>`);
});

test("在颜色里换行：先收尾、换行、再接上", () => {
  const t = `${RED}前半后半</span>`;
  const p = t.indexOf("后");
  assert.equal(breakInsideFormats(t, p), `</span>\n${RED}`);
  assert.equal(breakInsideFormats("普通文字", 2), "\n");
});

import { linkRange, linkWholeText, unlinkText, wikilinkOf } from "../../src/inline";

test("整个节点做成链接：保留颜色，每段文字各自带链接", () => {
  const t = `我是，${RED}红色的字</span>`;
  const l = linkWholeText(t, "笔记");
  // 颜色那段写成 Markdown 链接、颜色在链接文字里（实时预览不解析标签里的 [[ ]]）
  assert.equal(l, `[[笔记|我是，]][${RED}红色的字</span>](笔记.md)`);
  assert.deepEqual(wikilinkOf(l), { target: "笔记" });
  assert.equal(unlinkText(l, "笔记"), t);
});

test("整个节点做成链接：没有格式时和以前一样", () => {
  assert.equal(linkWholeText("普通文字", "笔记"), "[[笔记|普通文字]]");
  assert.equal(linkWholeText("笔记", "笔记"), "[[笔记]]");
  assert.deepEqual(wikilinkOf("[[笔记|普通文字]]"), { target: "笔记", alias: "普通文字" });
  assert.equal(unlinkText("[[笔记|普通文字]]", "笔记"), "普通文字");
});

test("加粗、高亮颜色、斜体留在链接外面", () => {
  assert.equal(linkWholeText("**粗**和==🔴红==", "N"), "**[[N|粗]]**[[N|和]]==🔴[[N|红]]==");
  assert.equal(linkWholeText("*斜*", "N"), "*[[N|斜]]*");
});

test("指向不同笔记、或者还有普通文字时不算整个节点是链接", () => {
  assert.equal(wikilinkOf("[[甲]]**[[乙]]**"), null);
  assert.equal(wikilinkOf("前面[[甲]]"), null);
});

import { applyInlineFormat } from "../../src/format";

test("整段换文字颜色：原来局部的颜色统一换掉；去掉颜色时其他格式留着", () => {
  const t = `我是，${RED}红色</span>**粗**`;
  const blue = applyInlineFormat(t, 0, t.length, { kind: "color", color: "#2266ff" }).text;
  assert.ok(!blue.includes("#e03e3e"), blue);
  assert.equal((blue.match(/<span/g) ?? []).length, 1, blue);
  assert.ok(blue.includes("**粗**"), blue);
  const none = applyInlineFormat(blue, 0, blue.length, { kind: "nocolor" }).text;
  assert.equal(none, "我是，红色**粗**");
});

test("编辑时选中颜色里的一段做成链接：颜色在两头断开，选中的字单独是带颜色的链接", () => {
  const t = `${RED}前面红字后面</span>`;
  const a = t.indexOf("红字");
  const out = linkRange(t, a, a + 2, "笔记 甲");
  assert.equal(out, `${RED}前面</span>[${RED}红字</span>](笔记%20甲.md)${RED}后面</span>`);
  assert.equal(unlinkText(out, "笔记 甲"), `${RED}前面</span>${RED}红字</span>${RED}后面</span>`);
  // 选中整段颜色里的字：两头不留空标签
  const all = linkRange(t, t.indexOf("前面"), t.indexOf("</span>"), "N");
  assert.equal(all, `[${RED}前面红字后面</span>](N.md)`);
  // 普通文字
  assert.equal(linkRange("链接这一个", 2, 4, "N"), "链接[[N|这一]]个");
});
