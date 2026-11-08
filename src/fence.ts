/**
 * 笔记里哪几行在代码块（``` ~~~）、公式块（$$）、开头的 frontmatter 里面：按行数围栏，不靠语法树。
 * 返回长度为 count 的数组，第 i 项是第 i 行（从 0 数）是不是在里面（围栏那一行本身也算）
 */
export function fencedLines(line: (i: number) => string, count: number): boolean[] {
  const out = new Array<boolean>(count).fill(false);
  let i = 0;
  if (count && line(0).trim() === "---") {
    let end = 1;
    while (end < count && !/^(---|\.\.\.)\s*$/.test(line(end))) end++;
    for (; i <= Math.min(end, count - 1); i++) out[i] = true;
  }
  let fence: string | null = null;
  for (; i < count; i++) {
    const m = /^\s*(`{3,}|~{3,}|\$\$)/.exec(line(i));
    if (fence !== null) {
      out[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      // 一行写完的 $$公式$$ 不算开头
    } else if (m) {
      out[i] = true;
      const mark = m[1].startsWith("$") ? "$$" : m[1];
      if (!(mark === "$$" && /^\s*\$\$.*\S.*\$\$\s*$/.test(line(i)))) fence = mark;
    }
  }
  return out;
}
