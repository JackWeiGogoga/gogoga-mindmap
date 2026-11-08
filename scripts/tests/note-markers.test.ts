import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { markerGuards, markerInLine } from "../../src/note-markers-core";

// 「在笔记里隐藏脑图节点标记」：标记必须留在行尾
const mk = (doc: string, cursor: number) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markerGuards(() => true)] });
const run = (st: EditorState, spec: TransactionSpec) => st.update(spec).state;

test("只认脑图认得的标记；普通注释不算", () => {
  assert.deepEqual(markerInLine("## 甲 %%red fold%%", 0), { from: 4, to: 17, inner: 7, owner: 0, own: false });
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

// 标题下面单独一行的标记：连标题行尾的换行一起藏
const H = "## 丁\n%%blue rel=r1%%\n正文\n## 戊";
const HE = H.indexOf("\n"); // 标题行尾
const ME = H.indexOf("\n", HE + 1); // 标记行尾
const BODY = ME + 1; // 「正文」行首
const BE = H.indexOf("\n", BODY); // 「正文」行尾

test("标题下一行的标记：范围从标题行尾到标记行尾；不是标题下面的不算", async () => {
  const { markersOfLine } = await import("../../src/note-markers-core");
  const st = mk(H, 0);
  assert.deepEqual(markersOfLine(st.doc, 1), [{ from: HE, to: ME, inner: HE + 3, owner: 0, own: true }]);
  assert.deepEqual(markersOfLine(st.doc, 2), []);
  assert.equal(markersOfLine(mk("正文\n%%blue%%", 0).doc, 1).length, 0);
});

test("标题行尾：光标停在标题末尾；打字写在标题里；回车新行放到标记行后面", () => {
  let st = run(mk(H, 0), { selection: EditorSelection.cursor(ME) });
  assert.equal(st.selection.main.head, HE);
  st = run(st, { changes: { from: HE, insert: "丁" }, selection: EditorSelection.cursor(HE + 1), userEvent: "input.type" });
  assert.equal(st.doc.toString(), "## 丁丁\n%%blue rel=r1%%\n正文\n## 戊");
  st = run(mk(H, HE), { changes: { from: HE, insert: "\n" }, userEvent: "input" });
  assert.equal(st.doc.toString(), "## 丁\n%%blue rel=r1%%\n\n正文\n## 戊");
});

test("下一行开头退格：接到标题末尾；在标题末尾按 Delete 不动", () => {
  let st = run(mk(H, BODY), { changes: { from: ME, to: BODY }, userEvent: "delete.backward" });
  assert.equal(st.doc.toString(), "## 丁正文\n%%blue rel=r1%%\n## 戊");
  st = run(mk(H, HE), { changes: { from: HE, to: ME }, userEvent: "delete.forward" });
  assert.equal(st.doc.toString(), H);
});

test("删整行标题（连换行）：标记行一起删；只选标题文字删到行尾不动标记行", () => {
  let st = run(mk(H, 0), { changes: { from: 0, to: HE + 1 }, userEvent: "delete" });
  assert.equal(st.doc.toString(), "正文\n## 戊");
  st = run(mk(H, 0), { changes: { from: 3, to: ME }, userEvent: "delete.selection" });
  assert.equal(st.doc.toString(), "## \n%%blue rel=r1%%\n正文\n## 戊");
});

test("Shift+End 选到行尾再删：只删字，行尾标记留着", () => {
  const d = "## 甲乙 %%red%%";
  const st = run(mk(d, 3), { changes: { from: 3, to: d.length }, userEvent: "delete.selection" });
  assert.equal(st.doc.toString(), "##  %%red%%");
});

test("上下移动行：标题和标记行一起走，别的行不插到中间", () => {
  // 「正文」上移（编辑器只会和标记行对调）：越过「丁」和它的标记行
  let st = run(mk(H, BODY + 1), { changes: { from: HE + 1, to: BE, insert: "正文\n%%blue rel=r1%%" }, selection: EditorSelection.cursor(HE + 2), userEvent: "move.line" });
  assert.equal(st.doc.toString(), "正文\n## 丁\n%%blue rel=r1%%\n## 戊");
  assert.equal(st.selection.main.head, 1);
  // 「丁」下移（编辑器只会和标记行对调）：带着标记行越过「正文」
  st = run(mk(H, 2), { changes: { from: 0, to: ME, insert: "%%blue rel=r1%%\n## 丁" }, selection: EditorSelection.cursor(ME - 2), userEvent: "move.line" });
  assert.equal(st.doc.toString(), "正文\n## 丁\n%%blue rel=r1%%\n## 戊");
  // 光标还在「## 丁」里原来的位置（# 号后面）
  assert.equal(st.selection.main.head, "正文\n##".length);
});

test("Obsidian 删整行（连前一行的换行，删到行尾）：标题的标记行一起删", () => {
  const d = "---\nmindmap: true\n---\n\n# 中心\n\n## 丁\n%%blue fold%%\n正文\n\n## 戊\n%%red%%\n";
  const h = d.indexOf("## 丁");
  const st = run(mk(d, h + 2), { changes: { from: h, to: h + 5 }, userEvent: "delete.line" });
  assert.equal(st.doc.toString(), "---\nmindmap: true\n---\n\n# 中心\n\n正文\n\n## 戊\n%%red%%\n");
});

test("删掉「换行＋整行文字」：行尾标记一起删，不接到上一行末尾", () => {
  const d = "- 甲 %%red%%\n- 乙 %%id=r1%%\n- 丙";
  const a = d.indexOf("\n- 乙");
  const st = run(mk(d, a + 3), { changes: { from: a, to: d.indexOf(" %%id") }, userEvent: "delete.line" });
  assert.equal(st.doc.toString(), "- 甲 %%red%%\n- 丙");
});

test("只选中一行看得见的文字删掉：标记留着（节点的颜色、关联线不丢）", () => {
  const d = "- 甲 %%red%%\n- 乙 %%id=r1%%";
  const a = d.indexOf("- 乙");
  const st = run(mk(d, a), { changes: { from: a, to: d.indexOf(" %%id") }, userEvent: "delete.selection" });
  assert.equal(st.doc.toString(), "- 甲 %%red%%\n %%id=r1%%");
});
