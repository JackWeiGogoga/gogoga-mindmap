import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { colorSpans, dropEmptyColors } from "../../src/color-source";
import { colorEditing, colorSourceChange, visualColorSpans } from "../../src/color-editing";

const red = (text: string) => `<span style="color:#e03e3e">${text}</span>`;
const yellow = (text: string) => `<mark style="background:#ffd43b">${text}</mark>`;
const editing = (doc: string, enabled = true) => EditorState.create({ doc, extensions: [history(), colorEditing({ enabled: () => enabled })] });
const change = (state: EditorState, from: number, to: number, insert = "", event = "input.type") => state.update({ changes: { from, to, insert }, annotations: Transaction.userEvent.of(event) }).state;

test("颜色可视化：解析嵌套文字颜色和荧光笔，保留精确源码范围", () => {
  const source = `前${red(`甲${yellow("乙")}丙`)}后`;
  const spans = colorSpans(source);
  assert.deepEqual(spans.map((s) => [s.kind, s.color]), [["color", "#e03e3e"], ["bg", "#ffd43b"]]);
  assert.equal(source.slice(spans[1].openEnd, spans[1].closeStart), "乙");
  assert.equal(colorSpans('<mark style="background: #FFB8EBA6;">字</mark>').length, 1);
});

test("颜色可视化：代码、转义、不完整或不支持的 HTML 保留源码", () => {
  for (const text of [`\`${red("代码")}\``, `\`\`\`html\n${red("代码")}\n\`\`\``, `~~~html\n${red("代码")}\n~~~`, `\\${red("转义")}`, '<span style="color:red">缺闭合', '<span onclick="x()">文字</span>']) {
    assert.equal(colorSpans(text).length, 0, text);
  }
  assert.equal(colorSpans(red("普通文字")).length, 1);
});

test("可视化编辑：修改彩色文字和跨边界替换时保持标签配对", () => {
  const source = `前${red("甲乙")}后`;
  let state = editing(source);
  const start = source.indexOf("甲");
  state = change(state, start, start + 1, "新");
  assert.equal(state.doc.toString(), `前${red("新乙")}后`);
  state = change(state, 0, state.doc.toString().indexOf("乙"), "替换");
  assert.equal(state.doc.toString(), `替换${red("乙")}后`);
  assert.equal(colorSpans(state.doc.toString()).length, 1);
});

test("可视化编辑：全选替换、删除不会留下可见的孤立标签", () => {
  const source = `前${red("甲")}中${yellow("乙")}后`;
  const replaced = change(editing(source), 0, source.length, "新文字");
  assert.equal(dropEmptyColors(replaced.doc.toString()), "新文字");
  const removed = change(editing(source), 0, source.length, "", "delete.selection");
  assert.equal(dropEmptyColors(removed.doc.toString()), "");
  assert.equal(dropEmptyColors(red(yellow(""))), "");
});

test("可视化编辑：删除隐藏边界时删除相邻文字，支持 emoji 字素", () => {
  const source = `😀${red("甲")}后`;
  const span = colorSpans(source)[0];
  assert.equal(change(editing(source), span.from, span.openEnd, "", "delete.backward").doc.toString(), `${red("甲")}后`);
  assert.equal(change(editing(source), span.closeStart, span.to, "", "delete.backward").doc.toString(), "😀后");
  assert.equal(change(editing(source), span.from, span.openEnd, "", "delete.forward").doc.toString(), "😀后");
});

test("可视化编辑：源码模式与显式格式命令可修改标签，撤销重做恢复内容和样式", () => {
  const source = red("文字");
  const raw = change(editing(source, false), 0, source.length, "源码替换");
  assert.equal(raw.doc.toString(), "源码替换");
  assert.equal(visualColorSpans(raw, { enabled: () => false }).length, 0);
  let state = editing(source);
  state = state.update({ changes: { from: 0, to: source.length, insert: yellow("文字") }, selection: EditorSelection.cursor(0), annotations: [colorSourceChange.of(true), Transaction.userEvent.of("input.format")] }).state;
  assert.equal(state.doc.toString(), yellow("文字"));
  const dispatch = (tr: Transaction) => { state = tr.state; };
  assert.ok(undo({ state, dispatch }));
  assert.equal(state.doc.toString(), source);
  assert.ok(redo({ state, dispatch }));
  assert.equal(state.doc.toString(), yellow("文字"));
});

test("实时预览开关：同一编辑器切换到源码模式后不再保护隐藏标签", () => {
  const setLive = StateEffect.define<boolean>();
  const live = StateField.define({
    create: () => true,
    update: (value, tr) => tr.effects.find((effect) => effect.is(setLive))?.value as boolean | undefined ?? value,
  });
  const source = red("文字");
  let state = EditorState.create({ doc: source, extensions: [live, colorEditing({ enabled: (s) => s.field(live) })] });
  state = state.update({ effects: setLive.of(false) }).state;
  state = change(state, 0, source.length, "普通源码");
  assert.equal(state.doc.toString(), "普通源码");
  state = state.update({ effects: setLive.of(true) }).state;
  state = change(state, 0, state.doc.length, source);
  state = change(state, 0, state.doc.length, "新文字");
  assert.equal(dropEmptyColors(state.doc.toString()), "新文字");
});
