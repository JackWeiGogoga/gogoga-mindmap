import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLines, merge3, preserveFormat } from "../../src/merge";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { addChild, addSibling, findByPath } from "../../src/model";

/** 朴素 LCS 长度，用来核对 Myers 找到的是最长公共子序列 */
function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

test("逐行差异：配对的行相等、单调递增，而且是最长公共子序列", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 300; round++) {
    const a = Array.from({ length: Math.floor(rnd() * 14) }, () => "abcde"[Math.floor(rnd() * 5)]);
    const b = Array.from({ length: Math.floor(rnd() * 14) }, () => "abcde"[Math.floor(rnd() * 5)]);
    const pairs = matchLines(a, b);
    for (let i = 0; i < pairs.length; i++) {
      assert.equal(a[pairs[i][0]], b[pairs[i][1]]);
      if (i) assert.ok(pairs[i][0] > pairs[i - 1][0] && pairs[i][1] > pairs[i - 1][1]);
    }
    assert.equal(pairs.length, lcs(a, b), JSON.stringify({ a, b }));
  }
});

test("三方合并：格式差异取原文，内容差异取新文本", () => {
  const base = ["# A", "", "## B", "- c", "", "## D"];
  const ours = ["# A", "## B", "- c", "## D"]; // 原文没有空行
  const theirs = ["# A", "", "## B", "- c", "- new", "", "## D"];
  assert.deepEqual(merge3(base, ours, theirs), ["# A", "## B", "- c", "- new", "## D"]);
});

const canon = (s: string) => serializeMarkdown(parseMarkdown(s, { fallbackTitle: "t" }));

test("新增标题：紧凑脑图连续新增同级和子节点，不插入空行，原有间距不变", () => {
  const src = "---\nmindmap: true\n---\n\n# 测试\n\n## 主题 1\n## 主题 2\n## 主题 3\n### 子主题\n## A\n## B\n## C\n\n### D\n\n## E\n";
  let current = src;
  for (const [kind, label] of [["sibling", "新增一"], ["child", "新增子主题"], ["sibling", "新增二"]]) {
    const doc = parseMarkdown(current);
    const last = doc.root.children[doc.root.children.length - 1];
    if (kind === "child") addChild(last, doc.style, label);
    else addSibling(last, label);
    current = preserveFormat(current, serializeMarkdown(doc), canon);
  }
  assert.equal(current, `${src}## 新增一\n### 新增子主题\n## 新增二\n`);
});

test("新增标题：原文标题间有空行时保留该风格，备注分隔不受紧凑标题影响", () => {
  const spaced = "# 根\n\n## A\n\n## B\n";
  const doc = parseMarkdown(spaced);
  addSibling(doc.root.children[1], "C");
  assert.equal(serializeMarkdown(doc), `${spaced}\n## C\n`);
  const compact = parseMarkdown("# 根\n## A\n## B\n");
  compact.root.children[0].note = "备注第一段\n\n备注第二段";
  addSibling(compact.root.children[1], "C");
  assert.equal(serializeMarkdown(compact), "# 根\n## A\n\n备注第一段\n\n备注第二段\n\n## B\n## C\n");
});

test("保留格式：在末尾连续新增标题或列表节点，不给无结尾换行的原文补空行", () => {
  for (const body of ["# R\n\n## A", "# R\n- A"]) {
    for (const ending of ["", "\n"]) {
      for (const newline of ["\n", "\r\n"]) {
        let current = (body + ending).replace(/\n/g, newline);
        for (const operation of ["sibling", "child", "sibling"] as const) {
          const doc = parseMarkdown(current);
          const last = doc.root.children[doc.root.children.length - 1];
          if (operation === "child") addChild(last, doc.style, "子节点");
          else addSibling(last, "新节点");
          const next = serializeMarkdown(doc);
          current = preserveFormat(current, next, canon);
          assert.equal(current.endsWith(newline), ending !== "", JSON.stringify({ body, ending, newline, operation, current }));
          assert.equal(canon(current), next);
          if (newline === "\r\n") assert.ok(!/(^|[^\r])\n/.test(current));
        }
      }
    }
  }
});

test("保留格式：没碰到的空行、行尾硬换行、懒续行原样不动", () => {
  const src = "# 标题\n## 一\n- 甲\n- 乙\n<!-- end -->\n## 二\n第一行  \n第二行\n";
  const doc = parseMarkdown(src, { fallbackTitle: "t" });
  findByPath(doc.root, "0/1")!.text = "乙改";
  const out = preserveFormat(src, serializeMarkdown(doc), canon);
  assert.equal(out, "# 标题\n## 一\n- 甲\n- 乙改\n<!-- end -->\n## 二\n第一行  \n第二行\n");
});

test("保留格式：插件自己的格式没有可保留的，直接用新文本；CRLF 保留", () => {
  const mine = "# A\n\n## B\n";
  const d = parseMarkdown(mine, { fallbackTitle: "t" });
  d.root.children[0].text = "C";
  assert.equal(preserveFormat(mine, serializeMarkdown(d), canon), serializeMarkdown(d));
  const crlf = "# A\r\n## B\r\n## C\r\n";
  const d2 = parseMarkdown(crlf, { fallbackTitle: "t" });
  d2.root.children[1].text = "C2";
  assert.equal(preserveFormat(crlf, serializeMarkdown(d2), canon), "# A\r\n## B\r\n## C2\r\n");
});

test("保留格式：编辑和格式差异碰在一起时，改动的行沿用原文的缩进", () => {
  const src = "# 格式\n## 丙\n\t- 丙一\n\t- 丙二\n## 丁\n- 丁一\n";
  const doc = parseMarkdown(src, { fallbackTitle: "t" });
  findByPath(doc.root, "0/0")!.color = "red";
  assert.equal(preserveFormat(src, serializeMarkdown(doc), canon), "# 格式\n## 丙\n\t- 丙一 %%red%%\n\t- 丙二\n## 丁\n- 丁一\n");
});

test("保留格式：换行符混用的文件不整篇改成 CRLF", () => {
  const src = "# A\n## B\r\n## C\n";
  const d = parseMarkdown(src, { fallbackTitle: "t" });
  d.root.children[1].text = "C2";
  assert.equal(preserveFormat(src, serializeMarkdown(d), canon), "# A\n## B\r\n## C2\n");
});

test("保留格式：只删父节点时，子节点按新层级写，不换回原来的缩进", () => {
  const src = "# A\n## 乙\n- 乙一\n\t- 乙一一\n- 乙二\n## 丙\n";
  const doc = parseMarkdown(src, { fallbackTitle: "t" });
  const yi = findByPath(doc.root, "0/0")!;
  const kid = yi.children[0];
  yi.parent!.children.splice(0, 1, kid);
  kid.parent = yi.parent;
  assert.equal(preserveFormat(src, serializeMarkdown(doc), canon), "# A\n## 乙\n- 乙一一\n- 乙二\n## 丙\n");
});
