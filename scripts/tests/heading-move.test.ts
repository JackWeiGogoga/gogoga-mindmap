import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { MindNode, moveNode, walk } from "../../src/model";

const find = (root: MindNode, text: string): MindNode => {
  let hit: MindNode | null = null;
  walk(root, (n) => {
    if (!hit && n.text === text) hit = n;
  });
  assert.ok(hit, text);
  return hit;
};
const outline = (root: MindNode): string[] => {
  const out: string[] = [];
  const go = (n: MindNode, d: number) => {
    out.push(`${"  ".repeat(d)}${n.kind === "heading" ? "#" : "-"}${n.text}`);
    n.children.forEach((c) => go(c, d + 1));
  };
  root.children.forEach((c) => go(c, 0));
  return out;
};

test("#10：标题挪到列表兄弟前面，保持标题，后面的列表兄弟升成同级标题", () => {
  const doc = parseMarkdown("# Heading h1\n- Bullet Point 1\n## Heading h2\n  - Bullet Point 2\n");
  const h2 = find(doc.root, "Heading h2");
  const promoted: MindNode[] = [];
  assert.ok(moveNode(h2, doc.root, 0, doc.style, promoted));
  assert.deepEqual(promoted.map((n) => n.text), ["Bullet Point 1"]);
  const md = serializeMarkdown(doc);
  assert.equal(md, "# Heading h1\n\n## Heading h2\n- Bullet Point 2\n\n## Bullet Point 1\n");
  // 写回再读，顺序和层级都还在
  assert.deepEqual(outline(parseMarkdown(md).root), ["#Heading h2", "  -Bullet Point 2", "#Bullet Point 1"]);
});

test("#10：列表项挪到标题兄弟后面，升成标题，顺序不再被写回打乱", () => {
  const doc = parseMarkdown("# R\n- a\n- b\n## H\n- h1\n");
  const a = find(doc.root, "a");
  const promoted: MindNode[] = [];
  moveNode(a, doc.root, doc.root.children.length, doc.style, promoted);
  assert.deepEqual(promoted, []);
  const back = parseMarkdown(serializeMarkdown(doc));
  assert.deepEqual(outline(back.root), ["-b", "#H", "  -h1", "#a"]);
});

test("#10：列表之间挪列表、标题之间挪标题都不改写法", () => {
  const doc = parseMarkdown("# R\n- a\n- b\n- c\n## H1\n## H2\n");
  const promoted: MindNode[] = [];
  moveNode(find(doc.root, "c"), doc.root, 0, doc.style, promoted);
  moveNode(find(doc.root, "H2"), doc.root, 3, doc.style, promoted);
  assert.deepEqual(promoted, []);
  assert.deepEqual(outline(parseMarkdown(serializeMarkdown(doc)).root), ["-c", "-a", "-b", "#H2", "#H1"]);
});

test("#10：挪到列表节点下面只能是列表；挪到标题末尾保持标题", () => {
  const doc = parseMarkdown("# R\n## A\n- a1\n- a2\n## B\n- b1\n");
  const b = find(doc.root, "B");
  moveNode(b, find(doc.root, "a1"), 0, doc.style);
  assert.equal(b.kind, "list");
  const doc2 = parseMarkdown("# R\n## A\n- a1\n## B\n- b1\n");
  const b2 = find(doc2.root, "B");
  moveNode(b2, find(doc2.root, "A"), find(doc2.root, "A").children.length, doc2.style);
  assert.equal(b2.kind, "heading");
  assert.deepEqual(outline(parseMarkdown(serializeMarkdown(doc2)).root), ["#A", "  -a1", "  #B", "    -b1"]);
});

test("#10：升成标题的列表项，块 ID 和前置段落都不丢", () => {
  const doc = parseMarkdown("# R\n段落一\n\n- a ^blk\n- b\n## H\n");
  const promoted: MindNode[] = [];
  moveNode(find(doc.root, "H"), doc.root, 0, doc.style, promoted);
  const md = serializeMarkdown(doc);
  assert.ok(md.includes("^blk"), md);
  assert.ok(md.includes("段落一"), md);
  assert.deepEqual(promoted.map((n) => n.text), ["a ^blk", "b"]);
});
