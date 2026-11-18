// 「打开使用指南」命令放进库里的笔记：仓库 examples/ 里的使用指南和它链接到的代码块示例，
// 构建时原样打进 main.js（esbuild 的 text 加载器），示例改了下次发版就跟着更新。
import guide from "../examples/Mind Map 使用指南.md";
import codeBlockExample from "../examples/脑图代码块嵌入示例.md";

export interface GuideFile { name: string; text: string }

/** 第一篇是使用指南本身（命令最后打开它），后面是它链接到的笔记 */
export const GUIDE_FILES: GuideFile[] = [
  { name: "Mind Map 使用指南.md", text: guide },
  { name: "脑图代码块嵌入示例.md", text: codeBlockExample },
];
