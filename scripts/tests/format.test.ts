import assert from "node:assert/strict";
import test from "node:test";
import { applyInlineFormat, parseColorList, type InlineFormat } from "../../src/format";

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
