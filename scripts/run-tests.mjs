/** 用 esbuild 把 TS 测试打成临时 mjs 再交给 node --test 执行，避免额外的 ts 运行时依赖。 */
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "mindmap-tests-"));
const tests = readdirSync("scripts/tests").filter((f) => f.endsWith(".test.ts"));

await esbuild.build({
  entryPoints: tests.map((f) => path.join("scripts/tests", f)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["obsidian"],
  outdir: dir,
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
});

const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => path.join(dir, f));
execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit", env: process.env });
