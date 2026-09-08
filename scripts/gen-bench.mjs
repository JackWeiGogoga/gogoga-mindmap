/**
 * 生成压力测试用的大脑图笔记。
 *   node scripts/gen-bench.mjs <节点数> [输出路径]
 * 默认 1000 个节点，写到 vault 的 inbox 下。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const total = Number(process.argv[2] || 1000);
const out =
  process.argv[3] ??
  path.join(
    process.env.OBSIDIAN_VAULT ??
      path.join(process.env.HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/JackWei"),
    "inbox",
    `脑图性能测试 ${total}.md`,
  );

const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"];
const WORDS = ["指标", "转化", "留存", "增长", "策略", "渠道", "成本", "风险", "排期", "复盘", "实验", "灰度", "回归", "监控", "预算"];
const lines = ["---", "mindmap: true", "---", "", `# 性能测试 ${total} 节点`, "", "自动生成，用来量渲染和交互耗时。", ""];

let made = 1;
let rng = 42;
/** 固定种子，保证每次生成的文件一样 */
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const label = (i) => `${WORDS[i % WORDS.length]}${i} ${(rand() * 1000).toFixed(0)}`;

// 二级标题 → 三级标题 → 列表（三到四层），宽度与深度都接近真实脑图
const mains = Math.max(4, Math.round(Math.sqrt(total) / 1.6));
outer: for (let a = 0; a < mains; a++) {
  lines.push(`## ${WORDS[a % WORDS.length]}板块 ${a + 1} %%${COLORS[a % COLORS.length]}%%`, "");
  if (++made >= total) break;
  const subs = Math.max(2, Math.round(total / mains / 6));
  for (let b = 0; b < subs; b++) {
    lines.push(`### ${label(made)}`);
    if (++made >= total) break outer;
    const items = Math.max(2, Math.round(total / mains / subs / 2));
    for (let c = 0; c < items; c++) {
      const marker = c === 0 && a % 3 === 0 ? " %%green%%" : "";
      lines.push(`- ${label(made)}${marker}`);
      if (++made >= total) break outer;
      const leaves = rand() < 0.6 ? 2 : 1;
      for (let d = 0; d < leaves; d++) {
        lines.push(`\t- ${label(made)}`);
        if (++made >= total) break outer;
      }
    }
    lines.push("");
  }
}

writeFileSync(out, lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
const nodes = lines.filter((l) => /^#{2,6} |^\t*- /.test(l)).length + 1;
console.log(`已生成 ${out}\n约 ${nodes} 个节点，${lines.length} 行`);
