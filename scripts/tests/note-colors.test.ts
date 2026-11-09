import assert from "node:assert/strict";
import test from "node:test";
import { Text } from "@codemirror/state";
import { colorRanges, lineColors, sectionColors } from "../../src/note-colors-core";

const doc = (s: string) => Text.of(s.split("\n"));

test("哪几行带节点颜色：行尾标记、标题下面的标记行、自定义色；普通注释和代码块里的不算", () => {
  const d = doc("# 中心\n\n## 章节\n%%red fold%%\n\n- 甲 %%blue%%\n- 乙 %%#ff8800%%\n- 丙 %%这是注释%%\n- 丁\n\n```\n- 戊 %%red%%\n```");
  const m = lineColors(d);
  assert.deepEqual([...m.entries()].map(([n, c]) => [n, c.color, c.named]), [
    [3, "red", true],
    [6, "blue", true],
    [7, "#ff8800", false],
  ]);
});

test("实时预览里铺色的范围：不含列表符号、#、任务框、行尾标记", () => {
  const src = "## 章节\n%%red%%\n- [ ] 任务 %%green%%\n\t1. 编号项 %%yellow%% ^abc";
  const d = doc(src);
  assert.deepEqual(colorRanges(d).map((r) => src.slice(r.from, r.to)), ["章节", "任务", "编号项"]);
});

test("阅读视图：一段里第几个标题、第几个列表项带颜色", () => {
  const src = "# T\n\n- 甲 %%red%%\n\t- 乙\n\t- 丙 %%blue%%\n- 丁\n\n## 章节\n%%green%%\n";
  const list = sectionColors(src, 2, 5);
  assert.deepEqual([...list.items.entries()].map(([i, c]) => [i, c.color]), [
    [0, "red"],
    [2, "blue"],
  ]);
  const h = sectionColors(src, 7, 7);
  assert.deepEqual([...h.headings.entries()].map(([i, c]) => [i, c.color]), [[0, "green"]]);
});

test("按文字判断脑图笔记：frontmatter 里 mindmap 不空、不是 false", async () => {
  const { textIsMindMap } = await import("../../src/note-colors-core");
  assert.equal(textIsMindMap("---\nmindmap: true\n---\n# T"), true);
  assert.equal(textIsMindMap("---\ntags: a\nmindmap: \"logic\"\n---\n"), true);
  assert.equal(textIsMindMap("---\nmindmap: false\n---\n"), false);
  assert.equal(textIsMindMap("# T\nmindmap: true"), false);
  assert.equal(textIsMindMap("---\ntitle: x\n---\nmindmap: true"), false);
});
