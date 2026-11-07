import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown } from "../../src/markdown";
import { adoptIds } from "../../src/model";

const parse = (t: string) => parseMarkdown(t, { fallbackTitle: "" });

test("重新解析后没变的节点沿用编号，改了文字的、新加的是新编号，编号不重复", () => {
  const a = parse("# T\n\n- 甲\n\t- 甲一\n\t- 甲二\n- 乙\n- 乙\n");
  const b = parse("# T\n\n- 甲\n\t- 甲一（改）\n\t- 甲二\n\t- 新的\n- 乙\n- 乙\n- 丙\n");
  adoptIds(a.root, b.root);
  const [ja, ya1, ya2] = a.root.children;
  const [jb, yb1, yb2, bing] = b.root.children;
  assert.equal(jb.id, ja.id);
  assert.notEqual(jb.children[0].id, ja.children[0].id);
  assert.equal(jb.children[1].id, ja.children[1].id);
  // 同名的兄弟按顺序配
  assert.equal(yb1.id, ya1.id);
  assert.equal(yb2.id, ya2.id);
  const ids: string[] = [];
  const walk = (n: typeof b.root) => {
    ids.push(n.id);
    n.children.forEach(walk);
  };
  walk(b.root);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(![ja, ya1, ya2, ...ja.children].some((n) => n.id === bing.id));
});
