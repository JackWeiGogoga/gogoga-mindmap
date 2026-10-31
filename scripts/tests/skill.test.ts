import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMarkdown, serializeMarkdown, unescapeNote } from "../../src/markdown";

// skills/gogoga-mindmap/SKILL.md 是给 AI 看的写法说明：里面的示例要真能读成说明里讲的样子，
// 改了解析规则忘了改文档时这里会挂
const skill = readFileSync("skills/gogoga-mindmap/SKILL.md", "utf8");
const blocks = [...skill.matchAll(/^(`{3,4})markdown\n([\s\S]*?)^\1$/gm)].map((m) => m[2]);

test("SKILL.md 的脑图笔记示例：节点、备注、标记都按说明读出来，写回一字不差", () => {
  const src = blocks.find((b) => b.includes("# Product launch"));
  assert.ok(src);
  const doc = parseMarkdown(src, { fallbackTitle: "" });
  assert.equal(doc.root.text, "Product launch");
  assert.equal(doc.root.note, "The launch plan for Q3.");
  const [goals, timeline, risks, owners] = doc.root.children;
  assert.deepEqual(doc.root.children.map((n) => n.text), ["Goals", "Timeline", "Risks", "Owners"]);
  assert.equal(goals.color, "blue");
  assert.equal(timeline.color, "green");
  assert.equal(timeline.callout, "Dates are tentative");
  assert.equal(timeline.children[0].box?.title, "Phase 1");
  assert.deepEqual(timeline.children[1].children.map((n) => n.text), ["Blog post", "Newsletter"]);
  assert.equal(risks.color, "red");
  assert.equal(risks.folded, true);
  assert.equal(risks.children[0].note, "Approval can take up to three weeks.");
  assert.equal(risks.children[1].children.length, 0);
  assert.equal(unescapeNote(risks.children[1].note), "- Load test in week 2\n- Autoscaling as a fallback");
  assert.equal(owners.summary?.text, "Weekly sync on Mondays");
  assert.equal(serializeMarkdown(doc), src);
});

test("SKILL.md 的代码块示例：块里的 frontmatter 和节点", () => {
  const src = blocks.find((b) => b.startsWith("```mindmap"));
  assert.ok(src);
  const body = src.replace(/^```mindmap\n/, "").replace(/```\n$/, "");
  const doc = parseMarkdown(body, { fallbackTitle: "" });
  assert.match(doc.frontmatter, /mindmap-structure: org-down/);
  assert.equal(doc.root.text, "Team");
  assert.deepEqual(doc.root.children.map((n) => n.children.map((c) => c.text)), [["Research", "UI"], ["Frontend", "Backend"]]);
});
