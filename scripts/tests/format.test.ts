import assert from "node:assert/strict";
import test from "node:test";
import { applyInlineFormat, highlightColor, highlightOf, parseColorList, type InlineFormat } from "../../src/format";

/** 用 [ ] 标出选区，返回格式化后的文字，新选区同样用 [ ] 标出 */
function run(marked: string, fmt: InlineFormat): string {
  const s = marked.indexOf("[");
  const e = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  const r = applyInlineFormat(text, s, e, fmt);
  return r.text.slice(0, r.start) + "[" + r.text.slice(r.start, r.end) + "]" + r.text.slice(r.end);
}
const RED = { kind: "color", color: "#e03e3e" } as const;
const BLUE = { kind: "color", color: "#2f80ed" } as const;
const YEL = { kind: "bg", color: "#ffd43b" } as const;

test("粗体、斜体、高亮：包上和取消", () => {
  assert.equal(run("一段[文字]内容", { kind: "bold" }), "一段**[文字]**内容");
  assert.equal(run("一段**[文字]**内容", { kind: "bold" }), "一段[文字]内容");
  assert.equal(run("一段[**文字**]内容", { kind: "bold" }), "一段[文字]内容");
  assert.equal(run("一段[文字]内容", { kind: "italic" }), "一段*[文字]*内容");
  assert.equal(run("一段*[文字]*内容", { kind: "italic" }), "一段[文字]内容");
  assert.equal(run("一段[文字]内容", { kind: "highlight" }), "一段==[文字]==内容");
  assert.equal(run("一段==[文字]==内容", { kind: "highlight" }), "一段[文字]内容");
});

test("粗体里切斜体不会吃掉粗体的星号", () => {
  assert.equal(run("**[文字]**", { kind: "italic" }), "***[文字]***");
  assert.equal(run("***[文字]***", { kind: "italic" }), "**[文字]**");
  assert.equal(run("*[文字]*", { kind: "bold" }), "***[文字]***");
  assert.equal(run("***[文字]***", { kind: "bold" }), "*[文字]*");
});

test("选区两头的空白不进格式，跨行逐行包", () => {
  assert.equal(run("一段[ 文字 ]内容", { kind: "bold" }), "一段 **[文字]** 内容");
  assert.equal(run("[第一行\n第二行]", RED), '<span style="color:#e03e3e">[第一行</span>\n<span style="color:#e03e3e">第二行]</span>');
});

test("没选文字：作用于整段", () => {
  const r = applyInlineFormat("整段文字", 2, 2, { kind: "bold" });
  assert.equal(r.text, "**整段文字**");
});

test("文字颜色：上色、同色取消、换色替换", () => {
  const red = run("一段[文字]内容", RED);
  assert.equal(red, '一段<span style="color:#e03e3e">[文字]</span>内容');
  assert.equal(run('一段<span style="color:#e03e3e">[文字]</span>内容', RED), "一段[文字]内容");
  assert.equal(run('一段<span style="color:#e03e3e">[文字]</span>内容', BLUE), '一段<span style="color:#2f80ed">[文字]</span>内容');
  // 连标签一起选中也认
  assert.equal(run('一段[<span style="color:#e03e3e">文字</span>]内容', RED), "一段[文字]内容");
});

test("在一段颜色中间改一部分：拆开，不嵌套", () => {
  assert.equal(
    run('<span style="color:#e03e3e">甲[乙]丙</span>', BLUE),
    '<span style="color:#e03e3e">甲</span><span style="color:#2f80ed">[乙]</span><span style="color:#e03e3e">丙</span>',
  );
  assert.equal(run('<span style="color:#e03e3e">甲[乙]丙</span>', RED), '<span style="color:#e03e3e">甲</span>[乙]<span style="color:#e03e3e">丙</span>');
  // 选区盖住已有颜色的一部分：扩到整段再上色
  assert.equal(run('[甲<span style="color:#e03e3e">乙]丙</span>', BLUE), '<span style="color:#2f80ed">[甲乙丙]</span>');
});

test("荧光笔和文字颜色可以叠加，清除格式两种都去掉", () => {
  const both = run('<span style="color:#e03e3e">[文字]</span>', YEL);
  assert.equal(both, '<span style="color:#e03e3e"><mark style="background:#ffd43b">[文字]</mark></span>');
  assert.equal(run('<span style="color:#e03e3e"><mark style="background:#ffd43b">[文字]</mark></span>', { kind: "clear" }), "[文字]");
  // Highlightr 的写法也认
  assert.equal(run('<mark style="background: #FFB8EBA6;">[文字]</mark>', { kind: "clear" }), "[文字]");
});

test("颜色列表：逗号或空格隔开，非法的忽略", () => {
  assert.deepEqual(parseColorList("#e03e3e, #2f80ed，red  rgba(1,2,3,0.5) 不是颜色 #12"), ["#e03e3e", "#2f80ed", "red", "rgba(1,2,3,0.5)"]);
});

test("选区两头带上了看不见的标签：剥掉再格式化，标签不交错", () => {
  const GREEN = { kind: "bg", color: "#69db7c99" } as const;
  // 编辑框里 </span> 藏着，从末尾往回选「了」会把它一起选上
  assert.equal(
    run('阿<span style="color:#27ae60">[了</span>]', GREEN),
    '阿<span style="color:#27ae60"><mark style="background:#69db7c99">[了]</mark></span>',
  );
  assert.equal(run('阿<span style="color:#27ae60">[了</span>]', { kind: "bold" }), '阿<span style="color:#27ae60">**[了]**</span>');
  // 只选中了一个看不见的标签：什么都不做
  assert.equal(run('阿<span style="color:#27ae60">了[</span>]', GREEN), '阿<span style="color:#27ae60">了[</span>]');
});

test("选区只框住另一种颜色标签的一半：扩到整对，结构保持完整", () => {
  const out = run('[甲<span style="color:#e03e3e">乙]丙</span>', { kind: "bg", color: "#ffd43b" });
  assert.equal(out, '<mark style="background:#ffd43b">[甲<span style="color:#e03e3e">乙丙</span>]</mark>');
});

test("Obsidian 彩色高亮：包上、同色取消、换色只换 emoji、和普通高亮互换", () => {
  const R = { kind: "highlight", color: "red" } as const;
  const G = { kind: "highlight", color: "green" } as const;
  assert.equal(run("一段[文字]内容", R), "一段==🔴[文字]==内容");
  assert.equal(run("一段==🔴[文字]==内容", R), "一段[文字]内容");
  assert.equal(run("一段==🔴[文字]==内容", G), "一段==🟢[文字]==内容");
  assert.equal(run("一段==[文字]==内容", R), "一段==🔴[文字]==内容");
  assert.equal(run("一段==🔴[文字]==内容", { kind: "highlight" }), "一段==[文字]==内容");
  // 方块 emoji 也认，同色算同一种
  assert.equal(run("一段==🟥[文字]==内容", R), "一段[文字]内容");
  // 连标记一起选中
  assert.equal(run("一段[==🔴文字==]内容", R), "一段[文字]内容");
  assert.equal(run("一段[==🔴文字==]内容", G), "一段==🟢[文字]==内容");
  // 跨行逐行包
  assert.equal(run("[甲\n乙]", R), "==🔴[甲==\n==🔴乙]==");
});

test("清除颜色：彩色高亮去掉颜色、留下普通高亮，选区外的不动", () => {
  assert.equal(run("[==🔴甲== 乙] ==🟢丙==", { kind: "clear" }), "[==甲== 乙] ==🟢丙==");
  assert.equal(run("==🔴[甲]==", { kind: "clear" }), "==[甲]==");
});

test("荧光笔颜色表：可以填 🔴 这些，文字颜色表不认", () => {
  assert.deepEqual(parseColorList("#ffd43b99, 🔴 🟢", true), ["#ffd43b99", "🔴", "🟢"]);
  assert.deepEqual(parseColorList("#ffd43b99, 🔴", false), ["#ffd43b99"]);
  assert.equal(highlightOf("🟦"), "blue");
  assert.equal(highlightOf("#ffd43b"), null);
  assert.deepEqual(highlightColor("🟣字"), { color: "purple", length: 2 });
  assert.equal(highlightColor("字"), null);
});

test("删除线：加上、紧挨着 ~~ 时去掉、连 ~~ 选中也去掉、多行每行各包一层", () => {
  assert.deepEqual(applyInlineFormat("完成任务", 0, 2, { kind: "strike" }), { text: "~~完成~~任务", start: 2, end: 4 });
  assert.deepEqual(applyInlineFormat("~~完成~~任务", 2, 4, { kind: "strike" }), { text: "完成任务", start: 0, end: 2 });
  assert.deepEqual(applyInlineFormat("~~完成~~任务", 0, 6, { kind: "strike" }), { text: "完成任务", start: 0, end: 2 });
  assert.equal(applyInlineFormat("一\n二", 0, 3, { kind: "strike" }).text, "~~一~~\n~~二~~");
  // 选区为空：整段
  assert.equal(applyInlineFormat("全部", 1, 1, { kind: "strike" }).text, "~~全部~~");
});

test("下划线：加上、去掉（选里面的字或连标签一起选）、多行各包各的", () => {
  assert.deepEqual(applyInlineFormat("学校与教科书", 0, 2, { kind: "underline" }), { text: "<u>学校</u>与教科书", start: 3, end: 5 });
  assert.deepEqual(applyInlineFormat("<u>学校</u>与教科书", 3, 5, { kind: "underline" }), { text: "学校与教科书", start: 0, end: 2 });
  assert.deepEqual(applyInlineFormat("<u>学校</u>与教科书", 0, 9, { kind: "underline" }), { text: "学校与教科书", start: 0, end: 2 });
  assert.equal(applyInlineFormat("甲\n乙", 0, 3, { kind: "underline" }).text, "<u>甲</u>\n<u>乙</u>");
  // 选区为空：整段
  assert.equal(applyInlineFormat("学校", 1, 1, { kind: "underline" }).text, "<u>学校</u>");
});

test("去掉荧光笔：==高亮==（主题、彩色）和 <mark style> 都去掉", () => {
  const at = (t: string, w: string) => [t.indexOf(w), t.indexOf(w) + w.length] as const;
  const go = (t: string, w: string, fmt: Parameters<typeof applyInlineFormat>[3]) => {
    const [s, e] = at(t, w);
    const r = applyInlineFormat(t, s, e, fmt);
    return [r.text, r.text.slice(r.start, r.end)];
  };
  assert.deepEqual(go("这是==重点==内容", "重点", { kind: "nobg" }), ["这是重点内容", "重点"]);
  assert.deepEqual(go("这是==🔴重点==内容", "重点", { kind: "nobg" }), ["这是重点内容", "重点"]);
  assert.deepEqual(go("这是==重点==内容", "==重点==", { kind: "nobg" }), ["这是重点内容", "重点"]);
  assert.deepEqual(go('这是<mark style="background:#ffd43b99">重点</mark>内容', "重点", { kind: "nobg" }), ["这是重点内容", "重点"]);
});

test("荧光笔换成指定颜色：原来的 ==高亮== 去掉，不叠两层", () => {
  const t = "这是==重点==内容";
  const s = t.indexOf("重点");
  const r = applyInlineFormat(t, s, s + 2, { kind: "bg", color: "#51cf6699" });
  assert.equal(r.text, '这是<mark style="background:#51cf6699">重点</mark>内容');
  assert.equal(r.text.slice(r.start, r.end), "重点");
});
