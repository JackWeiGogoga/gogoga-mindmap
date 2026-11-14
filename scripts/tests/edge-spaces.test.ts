/**
 * 设置「保留节点开头结尾的空格」（群里反馈）：Markdown 列表项、标题开头结尾的空格存不住，文件里写成 &nbsp;，
 * 编辑框里显示成普通空格；中间的 &nbsp; 不动；关着时和以前一样去掉
 */
import assert from "node:assert/strict";
import test from "node:test";
import { edgeNbspToSpaces, edgeSpacesToNbsp, fromEditableText, plainText, toEditableText } from "../../src/inline";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";

test("编辑框里的首尾空格 → 文件里的 &nbsp;，中间的空格不动", () => {
  assert.equal(edgeSpacesToNbsp("  节点 文字 "), "&nbsp;&nbsp;节点 文字&nbsp;");
  assert.equal(edgeSpacesToNbsp("\t节点\t"), "节点");
  assert.equal(edgeSpacesToNbsp("   "), "");
  assert.equal(fromEditableText("  甲 \n 乙", false, true), "&nbsp;&nbsp;甲&nbsp;<br>&nbsp;乙");
});

test("文件里首尾的 &nbsp; → 编辑框里的空格；中间的 &nbsp; 原样", () => {
  assert.equal(edgeNbspToSpaces("&nbsp;&nbsp;节点&nbsp;文字&nbsp;"), "  节点&nbsp;文字 ");
  assert.equal(toEditableText("&nbsp;甲&nbsp;<br>&nbsp;乙", true), " 甲 \n 乙");
});

test("来回转一遍不变", () => {
  for (const t of ["&nbsp;&nbsp;节点&nbsp;", "节点", "&nbsp;**加粗**&nbsp;", "中间&nbsp;不动"]) {
    assert.equal(fromEditableText(toEditableText(t, true), false, true), t);
  }
});

test("关着：和以前一样去掉首尾空格，&nbsp; 原样显示在编辑框里", () => {
  assert.equal(fromEditableText("  节点 ", false, false), "节点");
  assert.equal(toEditableText("&nbsp;节点", false), "&nbsp;节点");
});

test("搜索、测量用的纯文本里 &nbsp; 是空格", () => {
  assert.equal(plainText("&nbsp;&nbsp;节点&nbsp;"), "  节点 ");
});

test("带 &nbsp; 的脑图读进来再写回，一字不差；节点文字里留着 &nbsp;", () => {
  const src = "# 中心\n\n## &nbsp;&nbsp;标题&nbsp;\n- &nbsp;列表项&nbsp;&nbsp;\n\t- 子&nbsp;节点 %%fold%%\n";
  const doc = parseMarkdown(src);
  assert.equal(serializeMarkdown(doc), src);
  const h = doc.root.children[0];
  assert.equal(h.text, "&nbsp;&nbsp;标题&nbsp;");
  assert.equal(h.children[0].text, "&nbsp;列表项&nbsp;&nbsp;");
});
