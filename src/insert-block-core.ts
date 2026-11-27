/**
 * 「插入脑图」命令（#54）：在 Markdown 光标处放一个脑图代码块。纯逻辑，单测直接 import。
 * 光标所在行有字时，代码块另起一行（前面的字留在原行，后面的字挪到代码块下面）；
 * 插完光标放到代码块后面那一行，实时预览里代码块马上渲染成脑图，不停在源码里
 */
export interface BlockInsert {
  /** 替换当前这一行的新文本（可能多行） */
  text: string;
  /** 插完以后光标在新文本里的位置：第几行（相对当前行）、第几列 */
  cursor: { line: number; ch: number };
}

export function mindmapBlockInsert(line: string, ch: number, lang: string, root: string): BlockInsert {
  const before = line.slice(0, ch);
  const after = line.slice(ch);
  const block = ["```" + lang, `# ${root}`, "```"];
  const lines: string[] = [];
  if (before.trim()) lines.push(before.trimEnd());
  lines.push(...block);
  // 代码块后面那一行：原来光标后面的字，没有就是空行（光标放这里）
  const tail = after.trimStart();
  lines.push(tail);
  return { text: lines.join("\n"), cursor: { line: lines.length - 1, ch: 0 } };
}
