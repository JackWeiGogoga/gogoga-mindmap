/**
 * 移动压测（常规测试，CI 也跑）：程序生成各种写法的笔记（连续多个空行、标题挤在一起、列表带备注、空格缩进、
 * \r\n 换行……），每组同级里把节点挪到最前 / 最后 / 隔一个的位置，按保存时的流程（保留原格式的三方合并）写回，
 * 检查结构正确、连续空行不超过原文最长的一段（#25）。真实笔记上的同一套检查在 e2e/mindmap/corpus/moves.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { preserveFormat } from "../../src/merge";
import { moveNode, walk, type MindNode } from "../../src/model";

/** 种子固定的伪随机数：每次生成一样的笔记，失败了能复现 */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function genNote(seed: number): string {
  const r = rng(seed);
  const blank = () => (r() < 0.3 ? "\n\n" : r() < 0.6 ? "\n" : "");
  const indent = r() < 0.5 ? "\t" : "  ";
  const out: string[] = [`# 笔记 ${seed}`];
  const chapters = 2 + Math.floor(r() * 4);
  for (let c = 1; c <= chapters; c++) {
    out.push(`${blank()}## 第${c}章`);
    if (r() < 0.6) out.push(`${blank()}第${c}章的一段正文。${r() < 0.5 ? "\n第二行正文。" : ""}`);
    if (r() < 0.5) {
      const n = 1 + Math.floor(r() * 3);
      for (let s = 1; s <= n; s++) out.push(`${blank()}### ${c}.${s} 小节${r() < 0.5 ? `\n\n小节 ${c}.${s} 的正文。` : ""}`);
    } else {
      const items: string[] = [];
      const n = 2 + Math.floor(r() * 3);
      for (let i = 1; i <= n; i++) {
        items.push(`- 要点 ${c}.${i}`);
        if (r() < 0.4) items.push(`${indent}说明文字 ${c}.${i}`);
        if (r() < 0.5) items.push(`${indent}- 细节 ${c}.${i}.1`, `${indent}- 细节 ${c}.${i}.2`);
        if (r() < 0.2) items.push("");
      }
      out.push(blank() + items.join("\n"));
    }
  }
  const text = out.join("\n") + (r() < 0.3 ? "\n\n\n" : "\n");
  return r() < 0.15 ? text.replace(/\n/g, "\r\n") : text;
}

/** 连续空行最长几行（文末的不算） */
function maxBlankRun(t: string): number {
  let m = 0;
  let run = 0;
  for (const l of t.replace(/\r/g, "").replace(/\n+$/, "").split("\n")) {
    run = l.trim() === "" ? run + 1 : 0;
    m = Math.max(m, run);
  }
  return m;
}

function indexPath(n: MindNode): number[] {
  const p: number[] = [];
  for (let x = n; x.parent; x = x.parent) p.unshift(x.parent.children.indexOf(x));
  return p;
}

test("移动压测：生成的各种写法的笔记，挪节点后结构正确、不多出空行", () => {
  let moves = 0;
  const problems: string[] = [];
  const canon = (t: string) => serializeMarkdown(parseMarkdown(t, { fallbackTitle: "T" }));
  for (let seed = 1; seed <= 40; seed++) {
    const src = genNote(seed);
    const groups: number[][] = [];
    walk(parseMarkdown(src, { fallbackTitle: "T" }).root, (n) => {
      if (n.children.length >= 2) groups.push(indexPath(n));
    });
    for (const g of groups) {
      const parentOf = (root: MindNode) => g.reduce((p, i) => p.children[i], root);
      const count = parentOf(parseMarkdown(src, { fallbackTitle: "T" }).root).children.length;
      // 第一个挪到最后、最后一个挪到最前、每个往后隔一个
      const plan: [number, number][] = [[0, count], [count - 1, 0]];
      for (let i = 0; i + 2 <= count; i++) plan.push([i, i + 2]);
      for (const [from, to] of plan) {
        const doc = parseMarkdown(src, { fallbackTitle: "T" });
        const p = parentOf(doc.root);
        if (!moveNode(p.children[from], p, to, doc.style)) continue;
        const next = serializeMarkdown(doc);
        const out = preserveFormat(src, next, canon);
        moves++;
        if (canon(out.replace(/\r\n/g, "\n")) !== next) problems.push(`种子 ${seed} 第 ${g.join("/")} 组 ${from}→${to}：结构不对`);
        if (maxBlankRun(out) > Math.max(1, maxBlankRun(src))) problems.push(`种子 ${seed} 第 ${g.join("/")} 组 ${from}→${to}：多出空行`);
      }
    }
  }
  assert.ok(moves > 200, `只挪了 ${moves} 次`);
  assert.deepEqual(problems.slice(0, 10), []);
});
