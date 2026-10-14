/** 把构建产物复制进 vault 的插件目录。默认 JackWei vault，可用 OBSIDIAN_VAULT 覆盖。 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const vault =
  process.env.OBSIDIAN_VAULT ??
  path.join(process.env.HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents/JackWei");
const dest = path.join(vault, ".obsidian/plugins/gogoga-mindmap");

if (!existsSync(path.join(vault, ".obsidian"))) {
  console.error(`找不到 vault：${vault}`);
  process.exit(1);
}
if (!existsSync("dist/main.js")) {
  console.error("先执行 pnpm build");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const [from, to] of [
  ["dist/main.js", "main.js"],
  ["manifest.json", "manifest.json"],
  ["styles.css", "styles.css"],
]) {
  copyFileSync(from, path.join(dest, to));
}
console.log(`已安装到 ${dest}`);
