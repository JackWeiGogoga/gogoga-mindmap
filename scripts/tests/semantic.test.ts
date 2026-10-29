/**
 * 写回的语义不变量：原文和「解析再写回」的结果，用 CommonMark 渲染出来必须一样（只允许空白、紧凑 / 宽松列表的差别）。
 * 「和内存里的树一致」不够 —— 解析这一步就错了的话，树本身就是错的（0.25.0 之前列表中间的文字被挪位置就是这样漏掉的）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import MarkdownIt from "markdown-it";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";
import { isAncestor, moveNode, removeNode, walk, type MindNode } from "../../src/model";

const md = new MarkdownIt({ html: true });
/** 只比结构和文字：标签前后的空白、宽松列表多出来的 <p> 不算；%%…%% 是 Obsidian 的注释，渲染前去掉 */
const rendered = (s: string) => md.render(s.replace(/%%[\s\S]*?%%/g, "")).replace(/<\/?p>/g, "").replace(/\s+/g, " ").replace(/ ?(<[^>]+>) ?/g, "$1").trim();
const canon = (s: string) => serializeMarkdown(parseMarkdown(s, { fallbackTitle: "t" }));

const CASES: Record<string, string> = {
  "两个列表中间夹文字": "# 性能\n\n如果主要用于：\n\n* GitHub\n* npm\n\n推荐升级为：\n\n* SOCKS5\n* Xray\n\n速度会明显更快。\n",
  "子列表中间夹文字": "# N\n\n- a\n\t- b\n\n\t说明\n\n\t- c\n\n\t结尾\n\n- d\n",
  "普通懒续行": "# N\n\n- 第一行\n接着写的第二行\n- 下一项\n",
  "紧跟列表的 HTML 注释": "## 媒体\n\n- 视频：https://example.com/a.mp4\n<!-- fav-sync:end -->\n\n## 我的笔记\n",
  "紧跟列表的代码围栏": "# N\n\n- 命令\n```bash\nls -la\n```\n- 下一项\n",
  "紧跟列表的引用": "# N\n\n- 观点\n> 引用一句\n\n## 二\n",
  "紧跟列表的分隔线": "# N\n\n- 甲\n---\n\n## 二\n- 乙\n",
  "紧跟列表的块级 HTML": "# N\n\n- 甲\n<div>块</div>\n\n## 二\n",
  "列表项备注里的代码块": "# N\n\n- 甲\n\n\t```js\n\tconst a = 1;\n\t```\n\n- 乙\n",
  "硬换行和懒续行": "# N\n\n第一行  \n第二行\n\n- 甲  \n续行\n",
  "标题前没有空行": "---\nmindmap: true\n---\n# A\n## B\n- b1\n## C\n",
  "多个一级标题": "# A\n\n- a\n\n# B\n\n- b\n",
  "段落后面紧跟有序列表": "# N\n\n进度：\n1. 英文版\n2. 中文版\n3. 技能\n\n结尾\n",
  "段落后面的 2. 只是续行": "# N\n\n截至今年\n2026. 年底完成\n",
  "段落后面连续两行 2. 3. 都是续行": "# N\n\n计划\n2. 第二步\n3. 第三步\n\n- 列表\n",
  "列表项备注里的 2026.": "# N\n\n- 甲\n\n\t> [!note]\n\t> 截至今年\n\t> 2026. 年底完成\n\n- 乙\n",
};

test("语义不变量：各种结构解析再写回，渲染结果不变", () => {
  for (const [name, src] of Object.entries(CASES)) assert.equal(rendered(canon(src)), rendered(src), name);
});

test("语义不变量：仓库里的示例笔记解析再写回，渲染结果不变", () => {
  const dir = "examples";
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const src = readFileSync(`${dir}/${f}`, "utf8");
    assert.equal(rendered(canon(src)), rendered(src), f);
  }
});

test("语义不变量：随机改名、删除、移动一个节点后，写回结果和「编辑后的树」渲染一致，改名不影响原文其余部分", () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const [name, src] of Object.entries(CASES)) {
    for (let round = 0; round < 30; round++) {
      const doc = parseMarkdown(src, { fallbackTitle: "t" });
      const nodes: MindNode[] = [];
      walk(doc.root, (n) => n.parent && nodes.push(n));
      if (!nodes.length) continue;
      const n = nodes[Math.floor(rnd() * nodes.length)];
      const op = round % 3;
      if (op === 0) n.text = `${n.text}改`;
      else if (op === 1) removeNode(n);
      else {
        const targets = nodes.filter((x) => x !== n && !isAncestor(n, x));
        if (!targets.length) continue;
        moveNode(n, targets[Math.floor(rnd() * targets.length)], 0, doc.style);
      }
      const next = serializeMarkdown(doc);
      const merged = preserveFormat(src, next, canon);
      assert.equal(rendered(merged), rendered(next), `${name}：${["改名", "删除", "移动"][op]} ${n.text}`);
      if (op !== 0) continue;
      // 改名：只有被改的那个节点所在的文字变了
      const other = (s: string) => rendered(s).replace(`${n.text}`, "§").replace(n.text.slice(0, -1), "§");
      assert.equal(other(merged), other(src), `${name}：其余部分`);
    }
  }
});

test("语义不变量：删掉段落后面有序列表的第 1 项，剩下的 2. 3. 不会变成续行", () => {
  const src = "# N\n\n进度：\n1. 英文版\n2. 中文版\n3. 技能\n";
  const doc = parseMarkdown(src, { fallbackTitle: "t" });
  removeNode(doc.root.children[0]);
  const out = preserveFormat(src, serializeMarkdown(doc), canon);
  assert.match(rendered(out), /<ol start="2"><li>中文版<\/li><li>技能<\/li><\/ol>/);
});

test("备注转义按位置判断：标题下的「2026.」续行不用包，列表项下的要包", () => {
  const note = "截至今年\n2026. 年底完成";
  const doc = parseMarkdown("# N\n\n- 甲\n", { fallbackTitle: "t" });
  doc.root.note = note;
  doc.root.children[0].note = note;
  const out = serializeMarkdown(doc);
  assert.equal(out, "# N\n\n截至今年\n2026. 年底完成\n\n- 甲\n\t> [!note]\n\t> 截至今年\n\t> 2026. 年底完成\n");
  // 写回再读回来，两段备注都还在原来的节点上
  const back = parseMarkdown(out, { fallbackTitle: "t" });
  assert.equal(back.root.note, note);
  assert.deepEqual(back.root.children.map((n) => n.text), ["甲"]);
  assert.equal(rendered(out).includes("<blockquote>[!note] 截至今年"), true);
});
