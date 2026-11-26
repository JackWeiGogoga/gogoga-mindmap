/**
 * 脑图改了文本后，旁边开着同一篇的 Markdown 编辑器要改哪一段（纯逻辑，单测从这里 import）。
 *
 * 只算一段替换：去掉头尾相同的部分，中间换掉。编辑器只重画这一段，光标、滚动、折叠都不动；
 * 整篇 setValue 会让光标回到开头、滚动跳走。
 * CodeMirror 的文档里换行一律是 \n（\r\n 的文件也一样），所以两边先统一成 \n 再比
 */
export interface EditorChange {
  from: number;
  to: number;
  insert: string;
}

export function editorChange(current: string, next: string): EditorChange | null {
  const a = current;
  const b = next.replace(/\r\n/g, "\n");
  if (a === b) return null;
  let head = 0;
  const max = Math.min(a.length, b.length);
  while (head < max && a.charCodeAt(head) === b.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a.charCodeAt(a.length - 1 - tail) === b.charCodeAt(b.length - 1 - tail)) tail++;
  // 别把一个代理对（emoji 之类）从中间切开：边界落在对中间就往外挪一位
  const low = (s: string, i: number) => i > 0 && i < s.length && isLow(s.charCodeAt(i)) && isHigh(s.charCodeAt(i - 1));
  if (low(a, head) || low(b, head)) head--;
  if (low(a, a.length - tail) || low(b, b.length - tail)) tail--;
  return { from: head, to: a.length - tail, insert: b.slice(head, b.length - tail) };
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
