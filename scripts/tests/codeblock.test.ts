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
