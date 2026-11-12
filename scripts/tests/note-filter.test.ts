import assert from "node:assert/strict";
import test from "node:test";
import { noteCardParts } from "../../src/note-filter";

const NOTE = "解释文字第一段。\n\n1. 结论一\n2. 结论二\n\t- 补充\n\n又一段解释。\n\n- 无序甲\n- 无序乙";

test("全部：原样一段；空备注没有可显示的", () => {
  assert.deepEqual(noteCardParts(NOTE, "all"), [NOTE]);
  assert.deepEqual(noteCardParts("  \n", "all"), []);
});

test("只显示有序列表：留下结论和它下面缩进的补充，解释文字、无序列表不要", () => {
  assert.deepEqual(noteCardParts(NOTE, "ordered"), ["1. 结论一\n2. 结论二\n\t- 补充"]);
});

test("只显示无序列表：留下无序列表；有序项下面的无序子项也算（左移到顶格）", () => {
  assert.deepEqual(noteCardParts(NOTE, "unordered"), ["- 补充", "- 无序甲\n- 无序乙"]);
});

test("只显示列表项：两处列表分成两段（中间隔着解释文字），免得有序列表编号接在一起", () => {
  assert.deepEqual(noteCardParts(NOTE, "list"), ["1. 结论一\n2. 结论二\n\t- 补充", "- 无序甲\n- 无序乙"]);
});

test("只隔空行的列表项算同一段；没有列表项就没有可显示的", () => {
  assert.deepEqual(noteCardParts("1. 甲\n\n2. 乙", "ordered"), ["1. 甲\n\n2. 乙"]);
  assert.deepEqual(noteCardParts("只有一段文字。\n\n第二段。", "list"), []);
});

test("列表项的续行、空行后的缩进段落、项内代码块都跟着这一项", () => {
  const note = "1. 结论\n   续行\n\n   补充一段\n\n   ```\n   - 不是列表\n   ```\n后面的文字";
  assert.deepEqual(noteCardParts(note, "ordered"), ["1. 结论\n   续行\n\n   补充一段\n\n   ```\n   - 不是列表\n   ```"]);
});

test("代码块里的「- 」、分隔线、1) 写法、任务", () => {
  assert.deepEqual(noteCardParts("```\n- 代码\n```\n---\n***", "list"), []);
  assert.deepEqual(noteCardParts("1) 甲\n2) 乙", "ordered"), ["1) 甲\n2) 乙"]);
  assert.deepEqual(noteCardParts("- [ ] 待办\n- [x] 完成", "unordered"), ["- [ ] 待办\n- [x] 完成"]);
});

test("整体缩进的列表（tab）按这一项的缩进左移，子项保持相对缩进", () => {
  assert.deepEqual(noteCardParts("\t1. 甲\n\t\t- 子\n\t2. 乙", "ordered"), ["1. 甲\n\t- 子\n2. 乙"]);
});
