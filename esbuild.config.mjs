import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // CodeMirror 用 Obsidian 自带的那份（插件运行时由 Obsidian 提供，版本和它的编辑器一致）
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  // 「打开使用指南」命令带的示例笔记（src/guide.ts）
  loader: { ".md": "text" },
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
