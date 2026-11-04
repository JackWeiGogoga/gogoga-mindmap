import assert from "node:assert/strict";
import test from "node:test";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { editingSpans, markdownSpans, type RenderOptions } from "../../src/markdown-source";
import { colorEditing, colorSourceChange } from "../../src/color-editing";

const red = (text: string) => `<span style="color:#e03e3e">${text}</span>`;
const editing = (doc: string, options: RenderOptions = { html: true, markdown: true }) => EditorState.create({
  doc, extensions: [history(), colorEditing({ parse: (source) => editingSpans(source, options) })],
});
const change = (state: EditorState, from: number, to: number, insert = "", event = "input.type") => state.update({ changes: { from, to, insert }, annotations: Transaction.userEvent.of(event) }).state;
const shown = (source: string, options: RenderOptions) => {
  const hidden = editingSpans(source, options).flatMap((s) => [[s.from, s.openEnd], [s.closeStart, s.to]]);
  return [...source].filter((_c, i) => !hidden.some(([a, b]) => a <= i && i < b)).join("");
};

test("Markdown 编辑：粗斜体嵌套、删除线、高亮、代码和链接的精确源码范围", () => {
  const source = '***粗斜*** **粗体** _斜体_ ~~删除~~ ==高亮== ``代码`段`` [文字](https://example.com "标题") [[文件|别名]]';
  assert.equal(shown(source, { html: false, markdown: true }), "粗斜 粗体 斜体 删除 高亮 代码`段 文字 别名");
  assert.equal(markdownSpans("***粗斜***").length, 2);
});

test("渲染开关：HTML 与 Markdown 的四种组合独立且不改源码", () => {
  const source = red("**粗体**");
  for (const html of [false, true]) for (const markdown of [false, true]) {
    const options = { html, markdown };
    assert.equal(editing(source, options).doc.toString(), source);
    assert.equal(shown(source, options), html ? (markdown ? "粗体" : "**粗体**") : red(markdown ? "粗体" : "**粗体**"));
  }
});

test("Markdown 编辑：不隐藏代码内容、不完整标记、转义字符和图片", () => {
  assert.equal(shown('`**代码**` \\*原样\\* **缺闭合 ![图片](url)', { html: true, markdown: true }), '**代码** \\*原样\\* **缺闭合 ![图片](url)');
  assert.equal(markdownSpans("```md\n**源码**\n```\n\n    **缩进代码**").length, 0);
  assert.equal(markdownSpans('<span style="color:**red**">文字</span>').length, 0);
});

test("Markdown 编辑：正文替换、边界插入保留成对标记", () => {
  for (const source of ["**文字**", "*文字*", "~~文字~~", "==文字==", "`文字`", "[文字](url)", "[[文件|文字]]", red("**文字**")]) {
    const start = source.indexOf("文字");
    const state = change(editing(source), start, start + 2, "新文");
    assert.equal(state.doc.toString(), source.replace("文字", "新文"), source);
    assert.equal(change(editing(source), start, start, "前").doc.toString(), source.replace("文字", "前文字"));
  }
});

test("Markdown 编辑：清空格式内容与全选替换不留下孤立标记，支持嵌套", () => {
  for (const source of ["**文字**", "***文字***", "~~文字~~", "==文字==", "`文字`", "[文字](url)", "[[文件|文字]]", red("**文字**")]) {
    const start = source.indexOf("文字");
    assert.equal(change(editing(source), start, start + 2, "", "delete.selection").doc.toString(), "", source);
    assert.equal(change(editing(source), 0, source.length, "替换").doc.toString(), "替换", source);
  }
});

test("Markdown 编辑：跨颜色和 Markdown 范围替换后结构完整", () => {
  const source = `前**甲乙**中${red("丙丁")}后`;
  const result = change(editing(source), source.indexOf("乙"), source.indexOf("丁"), "新").doc.toString();
  assert.equal(result, `前**甲新**${red("丁")}后`);
});

test("Markdown 编辑：显式格式和源码模式允许改标记；撤销重做保存源码", () => {
  let state = editing("**文字**");
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: "==文字==" }, selection: EditorSelection.range(2, 4),
    annotations: [colorSourceChange.of(true), Transaction.userEvent.of("input.format")] }).state;
  const dispatch = (tr: Transaction) => { state = tr.state; };
  assert.ok(undo({ state, dispatch }));
  assert.equal(state.doc.toString(), "**文字**");
  assert.ok(redo({ state, dispatch }));
  assert.equal(state.doc.toString(), "==文字==");
  const mode = new Compartment();
  state = EditorState.create({ doc: "**文字**", extensions: mode.of(colorEditing({ parse: (source) => editingSpans(source, { html: true, markdown: true }) })) });
  state = state.update({ effects: mode.reconfigure([]) }).state;
  assert.equal(change(state, 0, 2, "").doc.toString(), "文字**");
});
