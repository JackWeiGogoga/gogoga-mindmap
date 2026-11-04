import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv.includes("production");
const harness = process.argv.includes("harness");

// `pnpm harness` 打包 dev/harness.ts，用浏览器脱离 Obsidian 调试渲染效果。
const entry = harness ? "dev/harness.ts" : "src/main.ts";
const outfile = harness ? "dev/harness.js" : "dist/main.js";

const context = await esbuild.context({
  entryPoints: [entry],
  bundle: true,
  // CodeMirror 用 Obsidian 自带的那份（插件运行时由 Obsidian 提供，版本和它的编辑器一致）；
  // 调试页不在 Obsidian 里，得打包进去
  external: ["obsidian", "electron", ...(harness ? [] : ["@codemirror/*", "@lezer/*"]), ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  format: harness ? "iife" : "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile,
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
