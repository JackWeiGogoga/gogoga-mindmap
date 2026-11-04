/**
 * 节点文字里的局部格式：粗体、斜体、高亮、文字颜色、荧光笔颜色。
 * 颜色用 Obsidian 里通行的 HTML 写法存（Highlightr 插件也是这样），Markdown 里照样显示：
 *   文字颜色 <span style="color:#e03e3e">文字</span>
 *   荧光笔   <mark style="background:#ffd43b">文字</mark>
 * 这里的函数只处理字符串（编辑框里的原文，换行是 \n），不碰 DOM，方便单测。
 */

export type InlineFormat =
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "highlight" }
  | { kind: "color"; color: string }
  | { kind: "bg"; color: string }
  | { kind: "clear" };

export interface FormatResult {
  text: string;
  /** 格式化后原来那段文字的新位置，编辑框据此重新选中 */
  start: number;
  end: number;
}

const COLOR = String.raw`#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\)`;
export const COLOR_OPEN_SRC = String.raw`<span style="color:\s*(${COLOR})\s*;?\s*">`;
export const BG_OPEN_SRC = String.raw`<mark style="background(?:-color)?:\s*(${COLOR})\s*;?\s*">`;

type ColorKind = "color" | "bg";
const TAG_RE: Record<ColorKind, RegExp> = {
  color: new RegExp(`${COLOR_OPEN_SRC}|</span>`, "g"),
  bg: new RegExp(`${BG_OPEN_SRC}|</mark>`, "g"),
};

/** 设置里填的颜色列表：逗号或空格隔开，只认合法的颜色写法 */
export function parseColorList(input: string): string[] {
  const one = new RegExp(`^(?:${COLOR})$`);
  return input
    // rgba(…) 里的逗号不算分隔
    .split(/[,，\s]+(?![^(]*\))/)
    .map((s) => s.trim())
    .filter((s) => one.test(s));
}

export function openTag(kind: ColorKind, color: string): string {
  return kind === "color" ? `<span style="color:${color}">` : `<mark style="background:${color}">`;
}
const closeTag = (kind: ColorKind) => (kind === "color" ? "</span>" : "</mark>");

interface Pair {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  color: string;
}

/** 文字里同一种颜色标签的配对（不配对的孤立标签忽略） */
function pairs(text: string, kind: ColorKind): Pair[] {
  const out: Pair[] = [];
  const stack: { start: number; end: number; color: string }[] = [];
  for (const m of text.matchAll(TAG_RE[kind])) {
    const i = m.index ?? 0;
    if (m[1] !== undefined) stack.push({ start: i, end: i + m[0].length, color: m[1] });
    else {
      const o = stack.pop();
      if (o) out.push({ openStart: o.start, openEnd: o.end, closeStart: i, closeEnd: i + m[0].length, color: o.color });
    }
  }
  return out;
}

/** 选区首尾的空白不进格式：`** 粗体**` 在 Markdown 里不算粗体 */
function trimRange(text: string, s: number, e: number): [number, number] {
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return [s, e];
}

/** 每一行单独包（节点里的换行存成 <br>，跨行的标记渲染不出来） */
function wrapLines(sel: string, open: string, close: string): string {
  return sel
    .split("\n")
    .map((line) => {
      const m = /^(\s*)(.*?)(\s*)$/.exec(line);
      if (!m || !m[2]) return line;
      return `${m[1]}${open}${m[2]}${close}${m[3]}`;
    })
    .join("\n");
}

/** 选区前后有几个连续的 * */
function starsBefore(text: string, s: number): number {
  let n = 0;
  while (s - n - 1 >= 0 && text[s - n - 1] === "*") n++;
  return n;
}
function starsAfter(text: string, e: number): number {
  let n = 0;
  while (e + n < text.length && text[e + n] === "*") n++;
  return n;
}

function toggleMark(text: string, s: number, e: number, kind: "bold" | "italic" | "highlight"): FormatResult {
  const m = kind === "bold" ? "**" : kind === "italic" ? "*" : "==";
  const len = m.length;
  // * 和 ** 共用一个字符：数一数前后有几个星号，奇数才有斜体，两个以上才有粗体
  const has = (before: number, after: number) => {
    if (kind === "highlight") return before >= 1 && after >= 1;
    const n = Math.min(before, after);
    return kind === "bold" ? n >= 2 : n % 2 === 1;
  };
  if (kind === "highlight") {
    if (text.slice(s - len, s) === m && text.slice(e, e + len) === m) {
      return { text: text.slice(0, s - len) + text.slice(s, e) + text.slice(e + len), start: s - len, end: e - len };
    }
    const sel = text.slice(s, e);
    if (sel.length > len * 2 && sel.startsWith(m) && sel.endsWith(m)) {
      return { text: text.slice(0, s) + sel.slice(len, -len) + text.slice(e), start: s, end: e - len * 2 };
    }
  } else {
    if (has(starsBefore(text, s), starsAfter(text, e))) {
      return { text: text.slice(0, s - len) + text.slice(s, e) + text.slice(e + len), start: s - len, end: e - len };
    }
    // 选区把星号也框进去了
    const sel = text.slice(s, e);
    const lead = /^\*+/.exec(sel)?.[0].length ?? 0;
    const tail = /\*+$/.exec(sel)?.[0].length ?? 0;
    if (sel.length > lead + tail && has(lead, tail)) {
      return { text: text.slice(0, s) + sel.slice(len, -len) + text.slice(e), start: s, end: e - len * 2 };
    }
  }
  const sel = text.slice(s, e);
  const wrapped = wrapLines(sel, m, m);
  return { text: text.slice(0, s) + wrapped + text.slice(e), start: s + len, end: s + wrapped.length - len };
}

/** 去掉空的颜色标签（拆分后可能在边上留下 <span …></span>） */
/**
 * 去掉空的颜色标签：编辑时颜色标签藏着，把一段彩色字整个删掉会留下看不见的 <span …></span>，提交时清掉
 */
export function dropEmptyColors(text: string): string {
  return dropEmpty(dropEmpty(text, "color"), "bg");
}

function dropEmpty(text: string, kind: ColorKind): string {
  const re = new RegExp(`${kind === "color" ? COLOR_OPEN_SRC : BG_OPEN_SRC}${closeTag(kind).replace("/", "\\/")}`, "g");
  return text.replace(re, "");
}

/**
 * 上色 / 去色。color 为 null 表示只去掉这一种颜色。
 * - 选区在一段同类颜色里面：把选区从那段里拆出来，再上新色（同色就是取消）
 * - 选区跨过同类标签的边界：先扩到整对标签，免得标签交错
 */
/** 一个完整的颜色标签（开头或收尾），用来从选区两头剥掉 */
const ANY_TAG = `${COLOR_OPEN_SRC}|${BG_OPEN_SRC}|</span>|</mark>`;
const LEADING_TAG = new RegExp(`^(?:${ANY_TAG})`);
const TRAILING_TAG = new RegExp(`(?:${ANY_TAG})$`);

/**
 * 让选区和颜色标签的结构对齐，格式化后标签不会交错（<span><mark></span></mark> 这种渲染不出来）：
 * 两头是完整的标签就剥掉（编辑框里标签藏着，选的时候很容易带上看不见的 </span>）；
 * 选区只框了某一对标签的一半，就扩到整对
 */
function alignToTags(text: string, s: number, e: number): [number, number] {
  for (let m: RegExpExecArray | null; s < e && (m = LEADING_TAG.exec(text.slice(s, e))); ) s += m[0].length;
  for (let m: RegExpExecArray | null; s < e && (m = TRAILING_TAG.exec(text.slice(s, e))); ) e -= m[0].length;
  if (s === e) return [s, e];
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of [...pairs(text, "color"), ...pairs(text, "bg")]) {
      const openIn = p.openStart >= s && p.openStart < e;
      const closeIn = p.closeEnd > s && p.closeEnd <= e;
      if (openIn !== closeIn) {
        s = Math.min(s, p.openStart);
        e = Math.max(e, p.closeEnd);
        changed = true;
      }
    }
  }
  return [s, e];
}

function applyColor(text: string, s: number, e: number, kind: ColorKind, color: string | null): FormatResult {
  // 选区正好是一整对（连标签一起选中）：当成选中了里面的文字
  const exact = pairs(text, kind).find((p) => p.openStart === s && p.closeEnd === e);
  if (exact) {
    s = exact.openEnd;
    e = exact.closeStart;
  }
  const enclosing = pairs(text, kind)
    .filter((p) => p.openEnd <= s && p.closeStart >= e)
    .sort((a, b) => b.openEnd - a.openEnd)[0];
  if (enclosing) {
    // 要从这段颜色里拆出选区：紧贴选区、正好包住它的另一种颜色标签一起带出来，免得标签交错
    const other: ColorKind = kind === "color" ? "bg" : "color";
    for (let changed = true; changed; ) {
      changed = false;
      for (const p of pairs(text, other)) {
        if (p.openEnd === s && p.closeStart === e && p.openStart >= enclosing.openEnd && p.closeEnd <= enclosing.closeStart) {
          s = p.openStart;
          e = p.closeEnd;
          changed = true;
        }
      }
    }
  }
  let before: string;
  let after: string;
  let sel = text.slice(s, e);
  let toggledOff = false;
  if (enclosing) {
    const open = text.slice(enclosing.openStart, enclosing.openEnd);
    const close = closeTag(kind);
    before = text.slice(0, enclosing.openStart) + open + text.slice(enclosing.openEnd, s) + close;
    after = open + text.slice(e, enclosing.closeStart) + close + text.slice(enclosing.closeEnd);
    toggledOff = color !== null && enclosing.color.toLowerCase() === color.toLowerCase();
  } else {
    before = text.slice(0, s);
    after = text.slice(e);
  }
  // 选区里已有的同类颜色先去掉，不叠层
  sel = sel.replace(TAG_RE[kind], "");
  const wrapped = color !== null && !toggledOff ? wrapLines(sel, openTag(kind, color), closeTag(kind)) : sel;
  // 前后可能留下空标签：分别清理，记下选区前面少了多少字
  const cleanBefore = dropEmpty(before, kind);
  const cleanAfter = dropEmpty(after, kind);
  const lead = wrapped === sel ? 0 : openTag(kind, color ?? "").length;
  const tail = wrapped === sel ? 0 : closeTag(kind).length;
  return {
    text: cleanBefore + wrapped + cleanAfter,
    start: cleanBefore.length + lead,
    end: cleanBefore.length + wrapped.length - tail,
  };
}

/**
 * 给 text 的 [start, end) 加上 / 取消一种格式。选区为空时作用于整段文字。
 * 粗体、斜体、高亮是开关；颜色同色再点一次是取消，换色是替换；clear 去掉文字颜色和荧光笔颜色。
 */
export function applyInlineFormat(text: string, start: number, end: number, fmt: InlineFormat): FormatResult {
  let [s, e] = start === end ? [0, text.length] : [Math.min(start, end), Math.max(start, end)];
  [s, e] = trimRange(text, s, e);
  [s, e] = alignToTags(text, s, e);
  if (s === e) return { text, start, end };
  switch (fmt.kind) {
    case "bold":
    case "italic":
    case "highlight":
      return toggleMark(text, s, e, fmt.kind);
    case "color":
    case "bg":
      return applyColor(text, s, e, fmt.kind, fmt.color);
    case "clear": {
      const a = applyColor(text, s, e, "color", null);
      return applyColor(a.text, a.start, a.end, "bg", null);
    }
  }
}
