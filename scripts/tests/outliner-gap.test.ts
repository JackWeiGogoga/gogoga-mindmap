import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown, subtreeToList } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";

// 插件自己插进列表中间的空行写成「只有缩进的空白行」：Markdown 里一样是空行，
// 但 Outliner 插件把真正的空行（长度 0）当成列表结束，上下移动列表项跨不过去。
// 下面照 Outliner（vslinko/obsidian-outliner src/services/Parser.ts）找列表范围的规则：
// 往下找到第一行既不是列表项、也不以空白开头的行为止；范围里只有空白的行，缩进比备注浅就算分界
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+\.)( |\t)/;
const INDENTED = /^[ \t]+/;

/** 从第一行开始，Outliner 认的这个列表一直到第几行（含） */
function outlinerListEnd(text: string): number {
  const lines = text.replace(/\n$/, "").split("\n");
  let end = 0;
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    if (!LIST_ITEM.test(line) && !INDENTED.test(line)) break;
    if (line.length) end = l;
  }
  let itemIndent = "";
  let notesIndent: string | null = null;
  for (let l = 0; l <= end; l++) {
    const line = lines[l];
    const item = /^([ \t]*)(?:[-*+]|\d+\.)( |\t)/.exec(line);
    if (item) {
      itemIndent = item[1];
      notesIndent = null;
    } else if (INDENTED.test(line)) {
      const indent = line.match(/^[ \t]+/)![0];
      if (/^\s+$/.test(line) && (!line.startsWith(notesIndent ?? itemIndent) || (notesIndent === null && indent.length <= itemIndent.length))) return l - 1;
      if (notesIndent === null) notesIndent = indent;
    }
  }
  return end;
}

const lastLine = (md: string) => md.replace(/\n$/, "").split("\n").length - 1;
const on = { fallbackTitle: "", quoteListNotes: true };

test("规则自查：真正的空行会让 Outliner 把列表断开", () => {
  assert.equal(outlinerListEnd("- 甲\n\t> 备注\n\n- 乙\n"), 1);
  assert.equal(outlinerListEnd("- 甲\n\t> 备注\n\t\n- 乙\n"), 3);
});

test("引用块备注、标注块备注、节点表格之后，整个列表在 Outliner 看来还是一个", () => {
  const doc = parseMarkdown("- 任务2\n\t- 子项1\n\t- 子项2\n\t\t- 孙\n\t- 子项3\n- 任务3\n", on);
  const [t2, t3] = doc.root.children;
  t2.children[0].note = "备注一些内容";
  t2.children[1].children[0].note = "- 备注里的列表";
  t2.children[2].note = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  t2.children[2].table = true;
  t3.note = "最后一项的备注";
  const md = serializeMarkdown(doc);
  assert.ok(!/\n\n/.test(md), md);
  assert.equal(outlinerListEnd(md), lastLine(md), md);
  // 读回来结构和备注都不变，再写一遍一字不差
  const back = parseMarkdown(md, on);
  assert.equal(back.root.children[0].children[0].note, "备注一些内容");
  assert.deepEqual(back.root.children[0].children.map((n) => n.text), ["子项1", "子项2", "子项3"]);
  assert.equal(serializeMarkdown(back), md);
});

test("列表后面接标题：列表最后的空白行换成真正的空行，不多空一行", () => {
  const doc = parseMarkdown("# T\n\n## 甲\n\n- 一\n\n## 乙\n", on);
  doc.root.children[0].children[0].note = "备注";
  assert.equal(serializeMarkdown(doc), "# T\n\n## 甲\n\n- 一\n\t> 备注\n\n## 乙\n");
});

test("文件末尾的引用块备注后面不留空白行", () => {
  const doc = parseMarkdown("- 一\n", on);
  doc.root.children[0].note = "备注";
  assert.equal(serializeMarkdown(doc), "- 一\n\t> 备注\n");
});

test("复制节点：剪贴板里的标注块备注后面也是空白行，粘进别的列表不断开", () => {
  const doc = parseMarkdown("- A\n\t- B\n", { fallbackTitle: "" });
  doc.root.children[0].note = "- x";
  const md = subtreeToList(doc.root.children[0]);
  assert.equal(outlinerListEnd(md), lastLine(md), md);
});

test("旧文件里已经有的真正空行：没碰过的地方合并写回时原样留着", () => {
  const ser = (t: string) => serializeMarkdown(parseMarkdown(t, on));
  const original = "- 甲\n\t> 旧备注\n\n- 乙\n";
  const doc = parseMarkdown(original, on);
  assert.equal(doc.root.children[0].note, "旧备注");
  doc.root.children[1].text = "乙改了";
  assert.equal(preserveFormat(original, serializeMarkdown(doc), ser), "- 甲\n\t> 旧备注\n\n- 乙改了\n");
});
