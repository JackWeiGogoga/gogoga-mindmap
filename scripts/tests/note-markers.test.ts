import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { markerGuards, markerInLine } from "../../src/note-markers-core";

// 「在笔记里隐藏脑图节点标记」：标记必须留在行尾
const mk = (doc: string, cursor: number) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markerGuards(() => true)] });
const run = (st: EditorState, spec: TransactionSpec) => st.update(spec).state;

test("只认脑图认得的标记；普通注释不算", () => {
  assert.deepEqual(markerInLine("## 甲 %%red fold%%", 0), { from: 4, to: 17, inner: 7 });
  assert.deepEqual(markerInLine("%%blue rel=r1 \"依赖\" c1=1,2 c2=3,4%%", 10)?.from, 10);
  assert.equal(markerInLine("- 乙 %%回头再改%%", 0), null);
  assert.equal(markerInLine("- 乙", 0), null);
  assert.equal(markerInLine("%%%%", 0), null);
});

test("光标点到行尾：挪到标记前；在那里打字写在标记前面", () => {
  let st = mk("## 甲 %%red%%\n正文", 0);
  st = run(st, { selection: EditorSelection.cursor(12) });
  assert.equal(st.selection.main.head, 4);
  st = run(st, { changes: { from: 4, insert: "乙" }, selection: EditorSelection.cursor(5), userEvent: "input.type" });
  assert.equal(st.doc.toString(), "## 甲乙 %%red%%\n正文");
  assert.equal(st.selection.main.head, 5);
});

test("从标记前往右走：直接到下一行开头", () => {
  let st = mk("## 甲 %%red%%\n正文", 4);
  st = run(st, { selection: EditorSelection.cursor(12) });
  assert.equal(st.selection.main.head, 13);
});

test("在行尾插入（粘贴等）挪到标记前", () => {
  const st = run(mk("- 乙 %%id=r1%%", 0), { changes: { from: 13, insert: "丙" }, userEvent: "input.paste" });
  assert.equal(st.doc.toString(), "- 乙丙 %%id=r1%%");
});

test("Obsidian 列表回车会顺手删掉光标后的空格：换行照样放到标记后面", () => {
  const st = run(mk("- 乙 %%id=r1%%\n- 丙", 3), { changes: { from: 3, to: 4, insert: "\n- " }, userEvent: "input" });
  assert.equal(st.doc.toString(), "- 乙 %%id=r1%%\n- \n- 丙");
});

test("Obsidian 列表回车实际发的是替换（「乙 」换成「乙\\n- 」）：照样把换行放到标记后面", () => {
  const st = run(mk("- 乙 %%id=r1%%\n- 丙", 3), { changes: { from: 2, to: 4, insert: "乙\n- " }, userEvent: "input.type" });
  assert.equal(st.doc.toString(), "- 乙 %%id=r1%%\n- \n- 丙");
});

test("在标记前回车：换行放到标记后面，标记留在这一行", () => {
  const st = run(mk("- 乙 %%id=r1%%\n- 丙", 3), { changes: { from: 3, insert: "\n- " }, userEvent: "input" });
  assert.equal(st.doc.toString(), "- 乙 %%id=r1%%\n- \n- 丙");
  assert.equal(st.selection.main.head, 16);
});

test("在标记前退格删的是前一个字；按 Delete 不动；删字只删看得见的部分", () => {
  // 原子范围：退格落在标记上（编辑器会想整段删掉标记）
  let st = run(mk("## 甲乙 %%red%%", 5), { changes: { from: 5, to: 13 }, userEvent: "delete.backward" });
  assert.equal(st.doc.toString(), "## 甲 %%red%%");
  st = run(mk("## 甲乙 %%red%%", 5), { changes: { from: 5, to: 13 }, userEvent: "delete.forward" });
  assert.equal(st.doc.toString(), "## 甲乙 %%red%%");
  // 选区从字里拖到行尾再删
  st = run(mk("## 甲乙 %%red%%", 4), { changes: { from: 4, to: 13 }, userEvent: "delete.selection" });
  assert.equal(st.doc.toString(), "## 甲 %%red%%");
  // 整行连标记一起删照常
  st = run(mk("## 甲乙 %%red%%\n下", 0), { changes: { from: 0, to: 13 }, userEvent: "delete.selection" });
  assert.equal(st.doc.toString(), "\n下");
});

test("下一行开头退格接行：下一行的字接到标记前面", () => {
  const st = run(mk("- 乙 %%id=r1%%\n丙丁", 14), { changes: { from: 13, to: 14 }, userEvent: "delete.backward" });
  assert.equal(st.doc.toString(), "- 乙丙丁 %%id=r1%%");
  assert.equal(st.selection.main.head, 3);
});

test("代码块里的不管；光标在标记里面（露出来了）时照常改", () => {
  let st = run(mk("```\n## 甲 %%red%%\n```", 0), { changes: { from: 16, insert: "x" }, userEvent: "input.type" });
  assert.equal(st.doc.toString(), "```\n## 甲 %%red%%x\n```");
  st = run(mk("## 甲 %%red%%", 8), { changes: { from: 8, insert: " fold" }, userEvent: "input.type" });
  assert.equal(st.doc.toString(), "## 甲 %%r fold" + "ed%%");
});
