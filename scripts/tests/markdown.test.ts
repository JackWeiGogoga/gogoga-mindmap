import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, serializeMarkdown, splitMarker } from "../../src/markdown";
import { addChild, addSibling, moveNode, pathOf, findByPath } from "../../src/model";

const canonical = `---
mindmap: true
---

# 周末露营计划

计划说明作为根节点备注。

## 装备清单 %%green%%
- 帐篷 2 顶
	- 睡袋 4 个
	- 防潮垫 4 张

## 路线与行程 %%red%%

### 第一天 出发
- 车程 3 小时
- 午饭 服务区

### 第二天 徒步
- 环湖步道 12 km
	- 提前查好天气，下雨就改走林间小路 %%blue%%
- 傍晚返程
	- 采购清单 6 项
		- 木炭 2 袋 %%red%%
		- 饮用水 12 瓶 %%green fold%%
			- 隐藏的子节点
`;

test("规范格式往返完全一致", () => {
  const doc = parseMarkdown(canonical);
  assert.equal(doc.rootFromHeading, true);
  assert.equal(doc.root.text, "周末露营计划");
  assert.equal(doc.root.note, "计划说明作为根节点备注。");
  assert.equal(doc.root.children.length, 2);
  assert.equal(doc.root.children[0].color, "green");
  assert.equal(doc.root.children[0].children[0].children.length, 2);
  const folded = findByPath(doc.root, "1/1/1/0/1")!;
  assert.equal(folded.text, "饮用水 12 瓶");
  assert.equal(folded.folded, true);
  assert.equal(folded.color, "green");
  assert.equal(folded.children.length, 1);
  assert.equal(doc.style.indent, "\t");
  assert.equal(serializeMarkdown(doc), canonical);
});

test("没有 H1 时用文件名做根，且不写出 H1", () => {
  const src = `## A
- a1

## B
`;
  const doc = parseMarkdown(src, { fallbackTitle: "我的笔记" });
  assert.equal(doc.rootFromHeading, false);
  assert.equal(doc.root.text, "我的笔记");
  assert.deepEqual(doc.root.children.map((c) => c.text), ["A", "B"]);
  assert.equal(serializeMarkdown(doc), src);
});

test("多个 H1 时全部视为主主题", () => {
  const src = `# A

# B
- b1
`;
  const doc = parseMarkdown(src, { fallbackTitle: "T" });
  assert.equal(doc.rootFromHeading, false);
  assert.deepEqual(doc.root.children.map((c) => c.text), ["A", "B"]);
  assert.equal(serializeMarkdown(doc), src);
});

test("代码块里的 # 和 - 不当作节点", () => {
  const src = `# Root

## A

\`\`\`sh
# comment
- not a list
\`\`\`

## B
`;
  const doc = parseMarkdown(src);
  assert.equal(doc.root.children.length, 2);
  assert.equal(doc.root.children[0].note, "```sh\n# comment\n- not a list\n```");
  assert.equal(serializeMarkdown(doc), src);
});

test("标记解析：认识的才摘出来，其余注释留在文本里", () => {
  assert.deepEqual(splitMarker("hello %%red fold%%"), { text: "hello", marker: { color: "red", folded: true } });
  assert.deepEqual(splitMarker("hello %%#ABC%%"), { text: "hello", marker: { color: "#abc", folded: false } });
  assert.deepEqual(splitMarker("hello %%todo later%%"), { text: "hello %%todo later%%", marker: { folded: false } });
  assert.deepEqual(splitMarker("plain"), { text: "plain", marker: { folded: false } });
});

test("列表项备注：缩进行、懒延续、列表后的段落归标题 tail", () => {
  const src = `# Root

## A
- item one
\tnote line for one
- item two
lazy continuation of two

Paragraph after the list belongs to A.

## B
`;
  const doc = parseMarkdown(src);
  const a = doc.root.children[0];
  assert.equal(a.children[0].note, "note line for one");
  assert.equal(a.children[1].note, "lazy continuation of two");
  assert.equal(a.tail, "Paragraph after the list belongs to A.");
  // 懒延续行写回时规范成缩进的备注行，语义不变
  assert.equal(serializeMarkdown(doc), src.replace("\nlazy continuation", "\n\tlazy continuation"));
});

test("两空格缩进会被识别并保留", () => {
  const src = `# R
- a
  - b
    - c
`;
  const doc = parseMarkdown(src);
  assert.equal(doc.style.indent, "  ");
  assert.equal(findByPath(doc.root, "0/0/0")!.text, "c");
  assert.equal(serializeMarkdown(doc), src);
});

test("非规范空行只规范化一次，之后稳定", () => {
  const messy = `# R
## A


- a1
* a2
   - a3

## B
text
`;
  const once = serializeMarkdown(parseMarkdown(messy));
  const twice = serializeMarkdown(parseMarkdown(once));
  assert.equal(once, twice);
  assert.equal(
    once,
    `# R

## A

- a1
* a2
   - a3

## B

text
`,
    "检测到的空行风格和三空格缩进都保留",
  );
});

test("新建节点：跟随兄弟，否则按 maxHeadingLevel 决定标题或列表", () => {
  const doc = parseMarkdown(`# R

## A

### A1
- x
`);
  const a = doc.root.children[0];
  const a1 = a.children[0];
  const n1 = addChild(a1, doc.style, "new under A1");
  assert.equal(n1.kind, "list");
  const n2 = addChild(doc.root, doc.style, "C");
  assert.equal(n2.kind, "heading");
  const a2 = addSibling(a1, "A2")!;
  assert.equal(a2.kind, "heading");
  assert.equal(a2.level, 3);
  const leaf = addChild(a2, doc.style, "leaf");
  assert.equal(leaf.kind, "list", "maxHeadingLevel=3 时四级用列表");
  assert.equal(
    serializeMarkdown(doc),
    `# R

## A

### A1
- x
- new under A1

### A2
- leaf

## C
`,
  );
});

test("移动节点后写回方式跟随新位置", () => {
  const doc = parseMarkdown(`# R

## A
- a1
\t- a11

## B
`);
  const a11 = findByPath(doc.root, "0/0/0")!;
  const b = findByPath(doc.root, "1")!;
  assert.equal(moveNode(a11, b, 0, doc.style), true);
  assert.equal(pathOf(a11), "1/0");
  assert.equal(
    serializeMarkdown(doc),
    `# R

## A
- a1

## B
- a11
`,
  );
  // 把列表项提到根下：跟随兄弟变成标题
  const a1 = findByPath(doc.root, "0/0")!;
  moveNode(a1, doc.root, 2, doc.style);
  assert.equal(a1.kind, "heading");
  assert.equal(serializeMarkdown(doc), `# R

## A

## B
- a11

## a1
`);
});

import { escapeNote, isEscapedNote, normalizeNote, noteNeedsEscape, unescapeNote } from "../../src/markdown";

test("备注里的列表和标题会包成 callout，往返后原文不变", () => {
  const plain = "数据指标\n\n- 指标 1\n- 指标 2\n  - 指标 2.1\n\n## 不是节点的标题";
  assert.equal(noteNeedsEscape(plain), true);
  assert.equal(noteNeedsEscape("普通段落\n\n**加粗** 和 [[链接]]"), false);
  assert.equal(noteNeedsEscape("```\n- 代码块里的列表不算\n```"), false);
  const stored = normalizeNote(plain);
  assert.equal(stored, "> [!note]\n> 数据指标\n>\n> - 指标 1\n> - 指标 2\n>   - 指标 2.1\n>\n> ## 不是节点的标题");
  assert.equal(isEscapedNote(stored), true);
  assert.equal(unescapeNote(stored), plain);
  assert.equal(normalizeNote(stored), stored, "已包装的不会再包一层");
  assert.equal(unescapeNote("> 用户自己写的引用"), "> 用户自己写的引用", "普通引用块不动");

  const doc = parseMarkdown("# R\n\n## A\n- a1\n");
  doc.root.children[0].note = plain;
  const md = serializeMarkdown(doc);
  const again = parseMarkdown(md);
  assert.equal(again.root.children[0].children.length, 1, "备注里的列表没有变成子节点");
  assert.equal(unescapeNote(again.root.children[0].note), plain);
  assert.equal(serializeMarkdown(again), md);

  // 列表节点的备注同样处理，且保持缩进
  doc.root.children[0].children[0].note = "- x\n- y";
  const md2 = serializeMarkdown(doc);
  assert.ok(md2.includes("- a1\n\t> [!note]\n\t> - x\n\t> - y\n"), md2);
  const again2 = parseMarkdown(md2);
  assert.equal(again2.root.children[0].children[0].children.length, 0);
  assert.equal(unescapeNote(again2.root.children[0].children[0].note), "- x\n- y");
  assert.equal(escapeNote("a\n\nb"), "> [!note]\n> a\n>\n> b");
});

import { parseClipboard, subtreeToList } from "../../src/markdown";
import { attachSubtree } from "../../src/model";

test("复制子树 → 缩进列表 → 粘贴回来结构、标记、备注都在", () => {
  const doc = parseMarkdown(`# R

## A %%green%%

段落备注

### A1
- x %%fold%%
\t- x1
`);
  const a = doc.root.children[0];
  const text = subtreeToList(a);
  assert.equal(
    text,
    `- A %%green%%
\t段落备注
\t- A1
\t\t- x %%fold%%
\t\t\t- x1
`,
  );
  const nodes = parseClipboard(text);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].text, "A");
  assert.equal(nodes[0].color, "green");
  assert.equal(nodes[0].note, "段落备注");
  assert.equal(nodes[0].children[0].children[0].folded, true);

  // 粘到 B（二级标题）下：顶层变 H3，再深的按 maxHeadingLevel=3 变列表
  const target = addChild(doc.root, doc.style, "B");
  attachSubtree(nodes[0], target, doc.style);
  const md = serializeMarkdown(doc);
  assert.ok(md.includes("## B\n\n### A %%green%%\n\n段落备注\n\n- A1\n\t- x %%fold%%\n\t\t- x1\n"), md);
});

test("粘贴纯文本：每行一个节点；带标题的文本按结构解析", () => {
  const plain = parseClipboard("苹果\n香蕉\n\n橙子\n");
  assert.deepEqual(plain.map((n) => n.text), ["苹果", "香蕉", "橙子"]);
  const mixed = parseClipboard("说明\n- a\n  - a1\n- b");
  assert.deepEqual(mixed.map((n) => n.text), ["说明", "a", "b"]);
  assert.equal(mixed[1].children[0].text, "a1");
  const h1 = parseClipboard("# 标题\n## 子\n");
  assert.equal(h1.length, 1);
  assert.equal(h1[0].children[0].text, "子");
  assert.deepEqual(parseClipboard("   \n"), []);
});

import { convertLevelKind, newBlockId, splitBlockId } from "../../src/markdown";

test("列表项末尾的块 id 往返保留，标记与块 id 共存", () => {
  const src = `# R

## A
- 甲 ^abc123
- 乙 %%red%% ^x-9
- 丙
`;
  const doc = parseMarkdown(src);
  const [a, b, c] = doc.root.children[0].children;
  assert.equal(a.text, "甲");
  assert.equal(a.blockId, "abc123");
  assert.equal(b.text, "乙");
  assert.equal(b.color, "red");
  assert.equal(b.blockId, "x-9");
  assert.equal(c.blockId, undefined);
  assert.equal(serializeMarkdown(doc), src);
  c.blockId = newBlockId();
  assert.match(c.blockId, /^[a-z0-9]{6}$/);
  assert.ok(serializeMarkdown(doc).includes(`- 丙 ^${c.blockId}\n`));
  assert.deepEqual(splitBlockId("文字 ^id1"), { text: "文字", blockId: "id1" });
  assert.deepEqual(splitBlockId("没有 id"), { text: "没有 id" });
});

test("整层兄弟在标题与列表之间转换", () => {
  const doc = parseMarkdown(`# R

## A
- a1
- a2
\t- a21
`);
  const a1 = findByPath(doc.root, "0/0")!;
  assert.equal(convertLevelKind(a1, "heading", doc.style), true);
  assert.equal(serializeMarkdown(doc), `# R

## A

### a1

### a2
- a21
`);
  assert.equal(convertLevelKind(findByPath(doc.root, "0/1/0")!, "heading", doc.style), true, "a21 的父节点是 H3，可以变 H4");
  assert.equal(convertLevelKind(a1, "list", doc.style), true);
  assert.equal(serializeMarkdown(doc), `# R

## A
- a1
- a2
\t- a21
`, "a21 随父节点一起回到列表");
  assert.equal(convertLevelKind(doc.root, "list", doc.style), false, "根节点不能转");
});

test("色值不带 # 写回，避免被 Obsidian 当成标签；读时两种都认", () => {
  // 旧文件里的 %%#a3e5a2%% 仍能读，写回时归一成不带 #
  const doc = parseMarkdown("# R\n\n## A %%#a3e5a2%%\n\n## B %%f9a3a3%%\n\n## C %%red%%\n");
  assert.equal(doc.root.children[0].color, "#a3e5a2");
  assert.equal(doc.root.children[1].color, "#f9a3a3");
  assert.equal(doc.root.children[2].color, "red");
  const md = serializeMarkdown(doc);
  assert.equal(md, "# R\n\n## A %%a3e5a2%%\n\n## B %%f9a3a3%%\n\n## C %%red%%\n");
  assert.ok(!md.includes("%%#"), "写回的文件里不应再有 #，否则会进标签面板");
  // 归一之后往返稳定
  assert.equal(serializeMarkdown(parseMarkdown(md)), md);
  assert.deepEqual(splitMarker("x %%#ABC%%"), { text: "x", marker: { color: "#abc", folded: false } });
  assert.deepEqual(splitMarker("x %%abc%%"), { text: "x", marker: { color: "#abc", folded: false } });
});
