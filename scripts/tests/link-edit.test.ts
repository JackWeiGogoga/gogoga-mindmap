import assert from "node:assert/strict";
import test from "node:test";
import { linkRanges } from "../../src/cm-format";
import { rankLinkTargets } from "../../src/link-rank";

// B 站 FORMORE（2026-11-28）：编辑框里输入 [[ 后的字是白的，官方是链接色；表格里 [[ 补全图片排在笔记前面

const texts = (s: string, caret: number | null = null) => linkRanges(s, caret).map((l) => [s.slice(l.textFrom, l.textTo), l.syntax.map(([a, b]) => s.slice(a, b)).join("")]);

test("编辑框里的链接：[[笔记]]、别名、嵌入、[文字](网址)", () => {
  assert.deepEqual(texts("看 [[周会纪要]] 和 [[a|别名]]"), [["周会纪要", "[[]]"], ["a|别名", "[[]]"]]);
  assert.deepEqual(texts("![[图.png]]"), [["图.png", "![[]]"]]);
  assert.deepEqual(texts("[b站](https://b.cn)"), [["b站", "[](https://b.cn)"]]);
  assert.deepEqual(texts("普通文字 [不是链接] (x)"), []);
});

test("正在打的 [[…：光标前没写完的那段也是链接色", () => {
  const s = "前面 [[周会";
  assert.deepEqual(texts(s, s.length), [["周会", "[["]]);
  assert.deepEqual(texts("![[图", 4), [["图", "![["]]);
  // 光标不在后面（选区、没给光标）就不算
  assert.deepEqual(texts(s, null), []);
  // 已经写完的不重复
  const t = "[[甲]] 后";
  assert.deepEqual(texts(t, t.length), [["甲", "[[]]"]]);
  // 换了行就不算
  assert.deepEqual(texts("[[甲\n乙", 5), []);
});

test("行内代码里的 [[ 不算链接", () => {
  const s = "`[[x]]` 和 [[y]]";
  assert.deepEqual(
    linkRanges(s, null, [{ from: 0, to: 7 }]).map((l) => s.slice(l.textFrom, l.textTo)),
    ["y"],
  );
});

const files = [
  { name: "Pasted image 1.png", folder: "附件", isNote: false },
  { name: "周会纪要", folder: "", isNote: true },
  { name: "周.png", folder: "附件", isNote: false },
  { name: "年度计划", folder: "项目", isNote: true },
];

test("[[ 补全：同一档里笔记排在图片前面", () => {
  assert.deepEqual(rankLinkTargets(files, "周", 12).map((x) => x.name), ["周会纪要", "周.png"]);
  // 没输入：按传进来的顺序（最近修改），笔记在前
  assert.deepEqual(rankLinkTargets(files, "", 12).map((x) => x.name), ["周会纪要", "年度计划", "Pasted image 1.png", "周.png"]);
  // 完全同名排最前，路径里包含排最后
  assert.deepEqual(rankLinkTargets(files, "年度计划", 12).map((x) => x.name), ["年度计划"]);
  assert.deepEqual(rankLinkTargets(files, "项目", 12).map((x) => x.name), ["年度计划"]);
  assert.equal(rankLinkTargets(files, "", 1).length, 1);
});
