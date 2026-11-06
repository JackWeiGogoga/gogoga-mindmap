import assert from "node:assert/strict";
import test from "node:test";
import { formatSpans, guardHiddenMarks, revealed, type TextEdit } from "../../src/live-preview";

/** 每段写成「种类:中间的文字」，方便看 */
const show = (text: string) => formatSpans(text).map((s) => `${s.kind}:${text.slice(s.innerFrom, s.innerTo)}${s.color ? `@${s.color}` : ""}`);

test("常用格式：认出种类和中间的文字", () => {
  assert.deepEqual(show("a **粗** b *斜* c ==亮== d ~~删~~ e `码`"), ["strong:粗", "em:斜", "mark:亮", "del:删", "code:码"]);
  assert.deepEqual(show("__粗__ _斜_ <mark>亮</mark>"), ["strong:粗", "em:斜", "mark:亮"]);
});

test("颜色：带上颜色值，里面还能套格式", () => {
  assert.deepEqual(show('<span style="color:#e03e3e">红**粗**</span>'), ["color:红**粗**@#e03e3e", "strong:粗"]);
  assert.deepEqual(show('<mark style="background:#ffd43b99">黄</mark>'), ["bg:黄@#ffd43b99"]);
  assert.deepEqual(show('**<span style="color:red">蓝</span>**'), ["strong:<span style=\"color:red\">蓝</span>", "color:蓝@red"]);
});

test("标记符的位置：两头各自占的范围", () => {
  const text = 'x <span style="color:red">红</span> y';
  const [s] = formatSpans(text);
  assert.equal(text.slice(s.from, s.innerFrom), '<span style="color:red">');
  assert.equal(text.slice(s.innerTo, s.to), "</span>");
});

test("链接、公式、代码里的星号不当格式", () => {
  assert.deepEqual(show("[[a*b*c]] $x*y*z$ `**不粗**`"), ["code:**不粗**"]);
  assert.deepEqual(show("\\*不斜\\*"), []);
});

test("多行：按行找，位置按整段文字算", () => {
  const text = "第一行\n**第二**行";
  const [s] = formatSpans(text);
  assert.equal(text.slice(s.innerFrom, s.innerTo), "第二");
});

const at = (c: number) => ({ from: c, to: c });

test("Markdown 标记：光标或选区一头落在段里（含贴着两头）就露出源码", () => {
  const [s] = formatSpans("ab **粗** cd");
  assert.equal(revealed(s, [at(3)]), true);
  assert.equal(revealed(s, [at(s.to)]), true);
  assert.equal(revealed(s, [at(1), at(10)]), false);
  // 在段里拖选：一直露着，不会一选就收起
  assert.equal(revealed(s, [{ from: s.innerFrom, to: s.innerFrom + 1 }]), true);
  // 从段外选进来
  assert.equal(revealed(s, [{ from: 0, to: s.innerFrom + 1 }]), true);
  // 整段包进去（进入编辑时的全选）：不露
  assert.equal(revealed(s, [{ from: 0, to: 11 }]), false);
  assert.equal(revealed(s, []), false);
});

test("HTML 颜色标签和 <mark>：始终藏着，光标在里面也不露", () => {
  for (const text of ['a <span style="color:red">红</span> b', 'a <mark style="background:#ffd43b">黄</mark> b', "a <mark>亮</mark> b"]) {
    const [s] = formatSpans(text);
    assert.equal(s.html, true, text);
    assert.equal(revealed(s, [at(s.innerFrom)]), false, text);
  }
  assert.equal(formatSpans("a ==亮== b")[0].html, undefined);
});

test("Obsidian 彩色高亮：emoji 算在开头的标记符里，带上颜色", () => {
  const text = "a ==🔴红**粗**== b";
  const spans = formatSpans(text);
  assert.equal(spans[0].kind, "mark");
  assert.equal(spans[0].highlight, "red");
  assert.equal(text.slice(spans[0].from, spans[0].innerFrom), "==🔴");
  assert.equal(text.slice(spans[0].innerFrom, spans[0].innerTo), "红**粗**");
  assert.equal(spans[1].kind, "strong");
  assert.equal(formatSpans("==普通==")[0].highlight, undefined);
});

// ---------- 删字、打字碰到藏着的标记 ----------

/** 模拟编辑框：hidden 为 true 时所有段都藏着（「编辑时不露出格式标记」或 HTML 标签），返回改完的文字 */
function edit(text: string, e: TextEdit, backward: boolean | null, onlyHtml = false): string {
  const hidden = formatSpans(text).filter((s) => !onlyHtml || s.html);
  // tsconfig 的 lib 是 ES2020，没有 Segmenter 的类型；Node 里有
  const Seg = (Intl as unknown as { Segmenter: new () => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const seg = (s: string) => [...new Seg().segment(s)].map((x) => x.segment);
  const prev = (p: number) => p - (seg(text.slice(0, p)).pop()?.length ?? 1);
  const next = (p: number) => p + (seg(text.slice(p))[0]?.length ?? 1);
  const fixed = guardHiddenMarks(text, hidden, [e], backward, prev, next) ?? [e];
  let out = text;
  for (const f of [...fixed].sort((a, b) => b.from - a.from)) out = out.slice(0, f.from) + f.insert + out.slice(f.to);
  return out;
}
const RED = '<span style="color: red">红字</span>';

test("颜色字后面退格：删最后一个字，</span> 留着", () => {
  const t = `前${RED}后`;
  const end = t.indexOf("后");
  // 编辑器把原子范围整个 </span> 当成要删的
  const r = edit(t, { from: end - "</span>".length, to: end, insert: "" }, true, true);
  assert.equal(r, '前<span style="color: red">红</span>后');
});

test("删到颜色字里一个字都不剩：整段标签一起删", () => {
  const t = '前<span style="color: red">红</span>后';
  const end = t.indexOf("后");
  assert.equal(edit(t, { from: end - "</span>".length, to: end, insert: "" }, true, true), "前后");
});

test("颜色字前面按 Delete：删第一个字", () => {
  const t = `前${RED}后`;
  const open = '<span style="color: red">';
  assert.equal(edit(t, { from: 1, to: 1 + open.length, insert: "" }, false, true), '前<span style="color: red">字</span>后');
});

test("颜色字开头往前退格：删前面那个字", () => {
  const t = `前${RED}后`;
  const open = '<span style="color: red">';
  assert.equal(edit(t, { from: 1, to: 1 + open.length, insert: "" }, true, true), `${RED}后`);
});

test("选区从颜色字中间拖到外面再删：只删看得见的字", () => {
  const t = `前${RED}后面`;
  const from = t.indexOf("字");
  assert.equal(edit(t, { from, to: t.length - 1, insert: "" }, null, true), '前<span style="color: red">红</span>面');
});

test("选区跨过标签打字：字落在选区开头，标签成对", () => {
  const t = `前${RED}后面`;
  const from = t.indexOf("字");
  assert.equal(edit(t, { from, to: t.length - 1, insert: "z" }, null, true), '前<span style="color: red">红z</span>面');
});

test("整段都选中再删：照常整个删掉", () => {
  const t = `前${RED}后`;
  assert.equal(guardHiddenMarks(t, formatSpans(t), [{ from: 1, to: t.length - 1, insert: "" }], null, (p) => p - 1, (p) => p + 1), null);
});

test("没碰到标记的改动：不管", () => {
  const t = `前${RED}后`;
  assert.equal(guardHiddenMarks(t, formatSpans(t), [{ from: 0, to: 1, insert: "" }], true, (p) => p - 1, (p) => p + 1), null);
});

test("藏着的 ** 和 ==：退格删字，标记成对", () => {
  assert.equal(edit("前**粗体**后", { from: 5, to: 7, insert: "" }, true), "前**粗**后");
  assert.equal(edit("前**粗**后", { from: 4, to: 6, insert: "" }, true), "前后");
  assert.equal(edit("前==亮==后", { from: 4, to: 6, insert: "" }, true), "前后");
});

test("套着的格式：内层删空了，外层也空了就一起删", () => {
  // **==亮==**：在最后退格，跳过 ** 和 ==，删「亮」，两层都空了
  const t = "前**==亮==**后";
  assert.equal(edit(t, { from: 8, to: 10, insert: "" }, true), "前后");
  // 外层还有别的字：只删内层
  const u = "前**甲==亮==**后";
  assert.equal(edit(u, { from: 9, to: 11, insert: "" }, true), "前**甲**后");
});

test("组合表情当一个字删", () => {
  const t = "前**👍🏻**后";
  const end = t.indexOf("后");
  assert.equal(edit(t, { from: end - 2, to: end, insert: "" }, true), "前后");
});

test("在最前面往前退格：什么都不删", () => {
  const t = "**粗**后";
  assert.deepEqual(guardHiddenMarks(t, formatSpans(t), [{ from: 0, to: 2, insert: "" }], true, (p) => p - 1, (p) => p + 1), []);
});

test("编辑器自己删掉了段里最后一个字（没碰到标记）：两头的标记一起删", () => {
  const t = '前<span style="color: red">红</span>后';
  const at = t.indexOf("红");
  assert.equal(edit(t, { from: at, to: at + 1, insert: "" }, true, true), "前后");
  assert.equal(edit("粗**甲**尾", { from: 3, to: 4, insert: "" }, true), "粗尾");
});

test("选中段里的字整个打字替换：字留在原来的格式里", () => {
  const t = '前<span style="color: red">红字</span>后';
  const a = t.indexOf("红");
  assert.equal(guardHiddenMarks(t, formatSpans(t), [{ from: a, to: a + 2, insert: "z" }], null, (p) => p - 1, (p) => p + 1), null);
  // 从段里第一个字拖到段外再打字：字落在段里
  assert.equal(edit(t, { from: a, to: t.length, insert: "z" }, null, true), '前<span style="color: red">z</span>');
});
