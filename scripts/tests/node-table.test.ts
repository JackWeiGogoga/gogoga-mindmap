import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { addTable, blankBeforeNodeTables, noteRest, noteTable, withoutTable, withTable } from "../../src/node-table";
import { setCell, setBg } from "../../src/table/core/ops";

const parse = (t: string) => parseMarkdown(t, { fallbackTitle: "" });

test("%%table%% 标记读写：列表项、标题都行，和别的标记并存", () => {
  const md = "# T\n\n## 价格\n%%table%%\n\n| 方案 | 月费 |\n| --- | --- |\n| 基础 | 10 |\n\n- 功能\n\t- 同步 %%red table%%\n\n\t\t| 平台 | 支持 |\n\t\t| --- | --- |\n\t\t| Mac | ✅ |\n";
  const doc = parse(md);
  const price = doc.root.children[0];
  assert.equal(price.table, true);
  assert.equal(price.text, "价格");
  const sync = doc.root.children[0].children[0].children[0];
  assert.equal(sync.text, "同步");
  assert.equal(sync.table, true);
  assert.equal(sync.color, "red");
  assert.equal(serializeMarkdown(doc), md);
});

test("备注里的表：找到、改格子写回，表格下面的注释跟着走，别的文字原样", () => {
  const note = "前面一句\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后面一句";
  const nt = noteTable(note)!;
  assert.deepEqual(nt.table.cells, [["a", "b"], ["1", "2"]]);
  const next = setBg(setCell(nt.table, 1, 1, "3"), [{ r: 1, c: 0 }], "yellow");
  const out = withTable(note, next, true);
  assert.equal(out, '前面一句\n\n| a | b |\n| --- | --- |\n| 1 | 3 |\n<!-- gogoga-table: {"bg":{"A2":"yellow"}} -->\n\n后面一句');
  assert.equal(noteRest(out), "前面一句\n\n后面一句");
  assert.equal(withoutTable(out, true), "前面一句\n\n后面一句");
  // 再读回来，颜色还在
  assert.equal(noteTable(out)!.table.meta.bg?.A2, "yellow");
});

test("新加一张空表：放在备注前面；备注里有列表时包成标注块，表格在里面照样找得到", () => {
  assert.equal(addTable("", true), "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |");
  assert.equal(addTable("说明", true), "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\n说明");
  const wrapped = addTable("- 一项", true);
  assert.ok(wrapped.startsWith("> [!note]"));
  assert.equal(noteTable(wrapped)!.table.cells.length, 3);
  assert.equal(noteRest(wrapped), "- 一项");
});

test("节点表格改完写回整篇：列表项下面缩进，读回来一字不差", () => {
  const doc = parse("# T\n\n- 根\n\t- 同步 %%table%%\n");
  const n = doc.root.children[0].children[0];
  n.note = addTable(n.note, true, 2, 2);
  const t = noteTable(n.note)!.table;
  n.note = withTable(n.note, setCell(setCell(t, 0, 0, "平台"), 1, 0, "Mac|Win"), true);
  const md = serializeMarkdown(doc);
  assert.equal(md, "# T\n\n- 根\n\t- 同步 %%table%%\n\n\t\t| 平台 |  |\n\t\t| --- | --- |\n\t\t| Mac\\|Win |  |\n");
  const back = parse(md).root.children[0].children[0];
  assert.deepEqual(noteTable(back.note)!.table.cells, [["平台", ""], ["Mac|Win", ""]]);
  assert.equal(serializeMarkdown(parse(md)), md);
});

test("列表项下面的节点表格前面空一行（没装表格插件时阅读视图才渲染）；读回来还是这个节点的表，再写一字不差", () => {
  // 0.46.0 写的没空行的，读进来照样认，写回补上空行
  const old = "# T\n\n- 同步 %%table%%\n\t| a | b |\n\t| --- | --- |\n- 下一项\n";
  const md = serializeMarkdown(parse(old));
  assert.equal(md, "# T\n\n- 同步 %%table%%\n\n\t| a | b |\n\t| --- | --- |\n- 下一项\n");
  const back = parse(md);
  assert.equal(back.root.children[0].note.startsWith("| a | b |"), true);
  assert.equal(back.root.children[1].text, "下一项");
  assert.equal(serializeMarkdown(back), md);
  // 没有 %%table%% 的照旧不加空行
  const plain = "# T\n\n- 备注里的表\n\t| a | b |\n\t| --- | --- |\n";
  assert.equal(serializeMarkdown(parse(plain)), plain);
});

test("保存时给 0.46.0 写的节点表格补空行：只动带 %%table%% 的列表项，代码块里的不动", () => {
  
  assert.equal(blankBeforeNodeTables("- 同步 %%red table%%\n\t| a |\n\t| --- |\n- 下"), "- 同步 %%red table%%\n\n\t| a |\n\t| --- |\n- 下");
  assert.equal(blankBeforeNodeTables("- 同步 %%table%%\n\n\t| a |"), "- 同步 %%table%%\n\n\t| a |");
  assert.equal(blankBeforeNodeTables("- 备注里的表\n\t| a |"), "- 备注里的表\n\t| a |");
  assert.equal(blankBeforeNodeTables("```\n- x %%table%%\n\t| a |\n```"), "```\n- x %%table%%\n\t| a |\n```");
});
