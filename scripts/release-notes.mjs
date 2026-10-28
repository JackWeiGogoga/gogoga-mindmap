/**
 * 从 CHANGELOG.zh-CN.md 和 CHANGELOG.md 里取出某个版本的条目，拼成 GitHub Release 的说明（中文在前、英文在后）。
 * 用法：node scripts/release-notes.mjs 0.23.0 > notes.md；更新日志里没有这个版本就报错退出，发版前必须先写。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** 取「## [版本]」到下一个「## 」或链接定义之间的内容，不含标题行 */
export function sectionOf(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && (l.startsWith("## ") || /^\[[^\]]+\]: /.test(l)));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** owner/repo：CI 里读 GITHUB_REPOSITORY，本地从 origin 的地址推出来 */
function currentRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    return /github\.com[:/](.+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function releaseNotes(version, zh, en, repo = currentRepo()) {
  const z = sectionOf(zh, version);
  const e = sectionOf(en, version);
  if (!z || !e) return null;
  // Release 页面里用三级标题太大，降一级
  const demote = (s) => s.replace(/^### /gm, "#### ");
  const tail = repo ? ["", `完整更新日志 / Full changelog: https://github.com/${repo}/blob/main/CHANGELOG.zh-CN.md`] : [];
  return [`### 中文`, "", demote(z), "", `### English`, "", demote(e), ...tail, ""].join("\n");
}

// 只在直接运行这个脚本时执行；被测试打包进去时不跑
if (process.argv[1]?.endsWith("release-notes.mjs")) {
  const version = process.argv[2];
  const notes = releaseNotes(version, readFileSync("CHANGELOG.zh-CN.md", "utf8"), readFileSync("CHANGELOG.md", "utf8"));
  if (!notes) {
    console.error(`CHANGELOG.md / CHANGELOG.zh-CN.md 里没有 ${version} 的条目，先写更新日志再发版`);
    process.exit(1);
  }
  process.stdout.write(notes);
}
