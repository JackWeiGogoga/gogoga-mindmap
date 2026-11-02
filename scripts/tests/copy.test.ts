import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, subtreeToList } from "../../src/markdown";

test("复制节点：plain 不带 %% 标记，备注照留", () => {
  const doc = parseMarkdown("# 根\n\n- 甲 %%w=744%%\n\t备注一行\n\t- 乙 %%fold%%\n\t\t- 丙\n", { fallbackTitle: "" });
  const a = doc.root.children[0];
  assert.match(subtreeToList(a), /%%w=744%%/);
  assert.equal(subtreeToList(a, "\t", true), "- 甲\n\t备注一行\n\t- 乙\n\t\t- 丙\n");
});
