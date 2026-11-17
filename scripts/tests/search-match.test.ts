import assert from "node:assert/strict";
import test from "node:test";
import { matchLine } from "../../src/markdown";

const content = "---\nmindmap: true\n---\n\n# 中心\n\n- 甲\n\t- 西瓜词\n- 乙\n";

test("全局搜索的 match：按第一处匹配的字符位置换算行号", () => {
  const at = content.indexOf("西瓜词");
  assert.equal(matchLine({ match: { content, matches: [[at, at + 3]] } }), 7);
  assert.equal(matchLine({ match: { content, matches: [[0, 3]] } }), 0);
  const last = content.indexOf("乙");
  assert.equal(matchLine({ match: { content, matches: [[last, last + 1], [at, at + 3]] } }), 8);
});

test("不是搜索带来的、格式不对的：返回 null", () => {
  assert.equal(matchLine(null), null);
  assert.equal(matchLine({ focus: true }), null);
  assert.equal(matchLine({ match: { content, matches: [] } }), null);
  assert.equal(matchLine({ match: { content: 1, matches: [[0, 1]] } }), null);
  assert.equal(matchLine({ match: { content, matches: [[content.length + 5, content.length + 6]] } }), null);
});
