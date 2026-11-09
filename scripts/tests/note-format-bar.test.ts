import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { canShowFormatBar, formatSelection, lineContentRange } from "../../src/note-format-core";

const st = (doc: string, from: number, to: number) => EditorState.create({ doc, selection: EditorSelection.single(from, to) });
const run = (doc: string, from: number, to: number, fmt: Parameters<typeof formatSelection>[1]) => {
  const s = st(doc, from, to);
  const r = formatSelection(s, fmt);
  if (!r) return null;
  const t = s.update({ changes: r.changes, selection: r.selection }).state;
  return { doc: t.doc.toString(), sel: t.sliceDoc(t.selection.main.from, t.selection.main.to) };
};

test("一行里能加格式的范围：去掉列表符号、标题、引用、任务框、行尾标记和块编号", () => {
  const cut = (s: string) => s.slice(...lineContentRange(s));
  assert.equal(cut("- 甲乙"), "甲乙");
  assert.equal(cut("\t1. 甲乙"), "甲乙");
  assert.equal(cut("## 标题"), "标题");
  assert.equal(cut("> - [ ] 任务"), "任务");
  assert.equal(cut("> [!note] 标注"), "标注");
  assert.equal(cut("- 节点 %%red folded%%"), "节点");
  assert.equal(cut("段落 ^abc-1"), "段落");
  assert.equal(cut("普通一行"), "普通一行");
});

test("选中一段加格式，选区跟着新文字", () => {
  const doc = "- 我是重点内容";
  const from = doc.indexOf("重点"), to = from + 2;
  assert.deepEqual(run(doc, from, to, { kind: "bold" }), { doc: "- 我是**重点**内容", sel: "重点" });
  assert.deepEqual(run(doc, from, to, { kind: "color", color: "red" }), { doc: '- 我是<span style="color:red">重点</span>内容', sel: "重点" });
  assert.equal(run(doc, from, to, { kind: "underline" })?.doc, "- 我是<u>重点</u>内容");
});

test("跨行选中：每行分别加，列表符号和行尾标记不动", () => {
  const doc = "- 甲 %%red%%\n- 乙\n\n- 丙";
  const r = run(doc, 0, doc.length, { kind: "bold" });
  assert.equal(r?.doc, "- **甲** %%red%%\n- **乙**\n\n- **丙**");
  // 选到下一行行首：那一行不算
  const r2 = run("甲\n乙", 0, 2, { kind: "bold" });
  assert.equal(r2?.doc, "**甲**\n乙");
});

test("选的只有列表符号、在代码块或 frontmatter 里：不出现、不改", () => {
  assert.equal(canShowFormatBar(st("- 甲", 0, 2)), false);
  assert.equal(formatSelection(st("- 甲", 0, 2), { kind: "bold" }), null);
  const code = "```\nabc\n```";
  assert.equal(canShowFormatBar(st(code, 4, 7)), false);
  const fm = "---\na: 1\n---\n正文";
  assert.equal(canShowFormatBar(st(fm, 4, 8)), false);
  assert.equal(canShowFormatBar(st(fm, fm.length - 2, fm.length)), true);
  assert.equal(canShowFormatBar(st("甲", 0, 0)), false);
});
