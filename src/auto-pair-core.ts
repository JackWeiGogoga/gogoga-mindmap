/**
 * 编辑节点时自动配对符号（#55，设置 autoPair，默认关）：打左半边自动补上右半边，光标停在中间。纯逻辑，单测直接 import。
 *
 * - 【 和 [ 不在里面：它们用来打 [[链接]]（选中文字打【包起来、【【 换成 [[，见 canvas.wrapOnInput / updateLinkSuggest）
 * - 光标后面紧挨着字时不补（在一段字前面打括号多半是要把后面的字括起来）；英文引号前面是字母数字时不补（don't、5'）
 * - 选中了文字：用这一对包起来
 * - 刚自动补上的右半边，接着又打了同一个右半边：跳过去，不多出一个（中文输入法的引号是“”交替出的，打第二下就是右引号）
 * - 光标在刚补上的一对中间按退格：两边一起删
 */
export const PAIRS: Record<string, string> = {
  "(": ")",
  "（": "）",
  "“": "”",
  "‘": "’",
  '"': '"',
  "'": "'",
  "《": "》",
  "「": "」",
};
const CLOSERS = new Set(Object.values(PAIRS));
const WORD = /[\p{L}\p{N}_]/u;

export interface PairEdit {
  /** 替换 [from, to) 的文字 */
  from: number;
  to: number;
  insert: string;
  /** 之后的选区 */
  anchor: number;
  head: number;
  /** 自动补上的右半边在哪（之后再打它就跳过去）；null 是这次没补 */
  closer: number | null;
}

/**
 * 打了 typed（替换 [from, to)）：要自动配对就返回怎么改，不管就返回 null（照常输入）。
 * pending：上次自动补上的右半边现在的位置（没有就 null）
 */
export function pairInput(text: string, from: number, to: number, typed: string, pending: number | null): PairEdit | null {
  // 跳过刚补上的右半边
  if (from === to && pending === from && CLOSERS.has(typed) && text[from] === typed) {
    return { from, to, insert: "", anchor: from + 1, head: from + 1, closer: null };
  }
  const close = PAIRS[typed];
  if (!close) return null;
  if (from !== to) {
    // 选中了文字：包起来，选区还是那段字
    const inner = text.slice(from, to);
    return { from, to, insert: typed + inner + close, anchor: from + 1, head: from + 1 + inner.length, closer: null };
  }
  const next = text[from] ?? "";
  const prev = text[from - 1] ?? "";
  if (next && WORD.test(next)) return null;
  if (typed === close && prev && WORD.test(prev)) return null;
  return { from, to, insert: typed + close, anchor: from + 1, head: from + 1, closer: from + 1 };
}

/** 退格：光标在刚补上的一对中间（pending 就是光标位置）时，两边一起删；返回要删的范围 */
export function pairBackspace(text: string, pos: number, pending: number | null): { from: number; to: number } | null {
  if (pending !== pos || pos <= 0) return null;
  const open = text[pos - 1];
  if (PAIRS[open] === undefined || text[pos] !== PAIRS[open]) return null;
  return { from: pos - 1, to: pos + 1 };
}
