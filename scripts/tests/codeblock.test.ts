import { test } from "node:test";
import assert from "node:assert/strict";
import { findMindmapBlocks, locateBlock, replaceBlock } from "../../src/codeblock";

const host = `# 笔记

段落。

\`\`\`mindmap
# 根
## A
\`\`\`

中间文字

~~~mindmap
# 另一个
~~~

\`\`\`js
// 不是脑图
\`\`\`
`;

test("列出所有 mindmap 代码块（反引号与波浪号围栏）", () => {
  const blocks = findMindmapBlocks(host);
  assert.deepEqual(
    blocks.map((b) => [b.lineStart, b.lineEnd, b.inner]),
    [
      [4, 7, "# 根\n## A"],
      [11, 13, "# 另一个"],
    ],
  );
});

test("行号命中且内容一致时直接用；行号漂移时按内容找唯一块", () => {
  assert.deepEqual(locateBlock(host, { lineStart: 4, lineEnd: 7 }, "# 根\n## A\n"), { lineStart: 4, lineEnd: 7 });
  // 上文多了两行，行号过期
  const shifted = "新增\n行\n" + host;
  assert.deepEqual(locateBlock(shifted, { lineStart: 4, lineEnd: 7 }, "# 根\n## A"), { lineStart: 6, lineEnd: 9 });
  // 两个内容相同的块无法区分 → null
  const dup = host + "\n```mindmap\n# 根\n## A\n```\n";
  assert.equal(locateBlock(dup, null, "# 根\n## A"), null);
  // 但行号命中其中一个时可以
  assert.deepEqual(locateBlock(dup, { lineStart: 4, lineEnd: 7 }, "# 根\n## A"), { lineStart: 4, lineEnd: 7 });
  assert.equal(locateBlock(host, null, "不存在的内容"), null);
});

test("替换块内容，围栏和其余文本原样保留", () => {
  const next = replaceBlock(host, { lineStart: 4, lineEnd: 7 }, "# 根\n## A\n## B\n");
  assert.ok(next.includes("```mindmap\n# 根\n## A\n## B\n```\n\n中间文字"), next);
  assert.equal(findMindmapBlocks(next).length, 2);
  const emptied = replaceBlock(host, { lineStart: 11, lineEnd: 13 }, "");
  assert.ok(emptied.includes("~~~mindmap\n~~~"), emptied);
});

test("```gogoga-mindmap 也算脑图代码块，能定位和写回", () => {
  const text = "前文\n\n```gogoga-mindmap\n# 根\n- A\n```\n\n```mindmap-other\n# 不算\n```\n";
  const blocks = findMindmapBlocks(text);
  assert.deepEqual(blocks.map((b) => [b.lineStart, b.lineEnd, b.inner]), [[2, 5, "# 根\n- A"]]);
  const range = locateBlock(text, null, "# 根\n- A");
  assert.ok(range);
  assert.equal(replaceBlock(text, range, "# 根\n- B"), "前文\n\n```gogoga-mindmap\n# 根\n- B\n```\n\n```mindmap-other\n# 不算\n```\n");
});

// #26：代码块里补出来的中心主题被起了名字，要升格成一级标题写回，不然重画后变回「中心主题」
import { parseMarkdown, promoteRoot, serializeMarkdown } from "../../src/markdown";
const rename = (src: string, name: string) => {
  const d = parseMarkdown(src, { fallbackTitle: "" });
  d.root.text = name;
  const r = promoteRoot(d);
  return { r, out: serializeMarkdown(d) };
};

test("#26 只有列表：顶上补一行一级标题，列表不动", () => {
  const { r, out } = rename("- 甲\n- 乙\n", "我的主题");
  assert.equal(r, "ok");
  // 原文列表前没空行，写回沿用这个习惯
  assert.equal(out, "# 我的主题\n- 甲\n- 乙\n");
  assert.equal(parseMarkdown(out, { fallbackTitle: "" }).root.text, "我的主题");
});

test("#26 好几个一级标题：补上中心主题，原来的标题各降一级", () => {
  const { r, out } = rename("# 甲\n\n## 甲1\n\n# 乙\n\n- 乙1\n", "根");
  assert.equal(r, "ok");
  assert.equal(out, "# 根\n\n## 甲\n\n### 甲1\n\n## 乙\n\n- 乙1\n");
});

test("#26 都是二级标题：中心主题补成一级，二级的不用动", () => {
  const { r, out } = rename("## 甲\n\n## 乙\n", "根");
  assert.equal(r, "ok");
  assert.equal(out, "# 根\n\n## 甲\n\n## 乙\n");
});

test("#26 没起名字、本来就有一级标题：不动", () => {
  assert.equal(rename("- 甲\n", "").r, "noop");
  assert.equal(rename("- 甲\n", "  ").r, "noop");
  const { r, out } = rename("# 根\n\n- 甲\n", "新根");
  assert.equal(r, "noop");
  assert.equal(out, "# 新根\n\n- 甲\n");
});

test("#26 已经用到六级标题：存不下，不改", () => {
  const src = "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f\n\n# g\n";
  const d = parseMarkdown(src, { fallbackTitle: "" });
  d.root.text = "根";
  assert.equal(promoteRoot(d), "full");
  assert.equal(d.rootFromHeading, false);
  d.root.text = "";
  assert.equal(serializeMarkdown(d), src);
});

test("#26 前面有 frontmatter：一级标题写在 frontmatter 后面", () => {
  const { out } = rename("---\nmindmap-structure: logic-right\n---\n- 甲\n", "根");
  assert.equal(out, "---\nmindmap-structure: logic-right\n---\n\n# 根\n- 甲\n");
});
