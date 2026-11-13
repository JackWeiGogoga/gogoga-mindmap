import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";

const parse = (t: string) => parseMarkdown(t, { fallbackTitle: "" });

// Linter 这类插件会在标题后面自动加一个空行：标题和它的标记行之间隔了空行
const LINTED = "# T\n\n## 甲\n\n%%red rel=r1%%\n\n备注文字\n\n## 乙\n\n%%id=r1%%\n";

test("标题和标记行之间隔了空行：标记照样认（关联线、颜色不丢），不当成备注", () => {
  const d = parse(LINTED);
  const [a, b] = d.root.children;
  assert.deepEqual(a.rels, [{ to: "r1", label: "" }]);
  assert.equal(a.color, "red");
  assert.equal(a.note, "备注文字");
  assert.equal(b.anchor, "r1");
  assert.equal(b.note, "");
});

test("隔了空行的标记行写回时照样空行，文件一个字不变", () => {
  assert.equal(serializeMarkdown(parse(LINTED)), LINTED);
  assert.equal(preserveFormat(LINTED, serializeMarkdown(parse(LINTED)), (t) => serializeMarkdown(parse(t))), LINTED);
  // 改了别处（乙改名）：甲那段空行照样保留
  const d = parse(LINTED);
  d.root.children[1].text = "乙二";
  assert.equal(preserveFormat(LINTED, serializeMarkdown(d), (t) => serializeMarkdown(parse(t))), LINTED.replace("## 乙", "## 乙二"));
});

test("标题下面空一行后是普通的 %% 注释：还是备注，不当标记吃掉", () => {
  const src = "# T\n\n## 甲\n\n%%回头再改%%\n";
  const d = parse(src);
  assert.equal(d.root.children[0].note, "%%回头再改%%");
  assert.equal(serializeMarkdown(d), src);
});

test("标记紧挨着标题的老写法不受影响", () => {
  const src = "# T\n\n## 甲\n%%red%%\n\n## 乙\n";
  assert.equal(parse(src).root.children[0].color, "red");
  assert.equal(serializeMarkdown(parse(src)), src);
});
