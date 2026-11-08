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
  | { kind: "strike" }
  /** 下划线：<u>文字</u> */
  | { kind: "underline" }
  /** color：Obsidian 的彩色高亮 ==🔴文字==；不给就是普通的 ==高亮== */
  | { kind: "highlight"; color?: HighlightColor }
  | { kind: "color"; color: string }
  | { kind: "bg"; color: string }
  | { kind: "clear" };

export interface FormatResult {
  text: string;
  /** 格式化后原来那段文字的新位置，编辑框据此重新选中 */
  start: number;
  end: number;
}

/**
 * Obsidian 1.15 起的彩色高亮：开头的 `==` 后面紧跟一个颜色 emoji，比如 `==🔴文字==`，圆点和方块都认。
 * 渲染时 emoji 不显示，底色用 Obsidian 主题里那个颜色的高亮色
 */
export const HIGHLIGHT_COLORS = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" } as const;
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;
const HIGHLIGHT_EMOJI: Record<string, HighlightColor> = {
  "🔴": "red", "🟥": "red", "🟠": "orange", "🟧": "orange", "🟡": "yellow", "🟨": "yellow",
  "🟢": "green", "🟩": "green", "🔵": "blue", "🟦": "blue", "🟣": "purple", "🟪": "purple",
};

/** ==高亮== 里面的文字开头是不是颜色 emoji：是的话给出颜色和 emoji 占的长度 */
export function highlightColor(inner: string): { color: HighlightColor; length: number } | null {
  const cp = inner.codePointAt(0);
  if (cp === undefined) return null;
  const ch = String.fromCodePoint(cp);
  const color = HIGHLIGHT_EMOJI[ch];
  return color ? { color, length: ch.length } : null;
}

const EMOJI_ALT = Object.keys(HIGHLIGHT_EMOJI).join("|");
/** 文字里紧挨着 s 前面的高亮开头（== 或 ==🔴） */
const HIGHLIGHT_OPEN_BEFORE = new RegExp(`==(?:${EMOJI_ALT})?$`, "u");
/** 选区连标记一起选中的整段高亮 */
const WHOLE_HIGHLIGHT = new RegExp(`^==(${EMOJI_ALT})?([\\s\\S]+)==$`, "u");
const COLORED_HIGHLIGHT = new RegExp(`==(${EMOJI_ALT})(.+?)==`, "gu");

const COLOR = String.raw`#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\)`;
export const COLOR_OPEN_SRC = String.raw`<span style="color:\s*(${COLOR})\s*;?\s*">`;
export const BG_OPEN_SRC = String.raw`<mark style="background(?:-color)?:\s*(${COLOR})\s*;?\s*">`;

type ColorKind = "color" | "bg";
const TAG_RE: Record<ColorKind, RegExp> = {
  color: new RegExp(`${COLOR_OPEN_SRC}|</span>`, "g"),
  bg: new RegExp(`${BG_OPEN_SRC}|</mark>`, "g"),
};

/** 设置里填的颜色列表：逗号或空格隔开，只认合法的颜色写法 */
export function parseColorList(input: string, highlights = false): string[] {
  const one = new RegExp(`^(?:${COLOR})$`);
  return input
    // rgba(…) 里的逗号不算分隔
    .split(/[,，\s]+(?![^(]*\))/)
    .map((s) => s.trim())
    // 荧光笔颜色里还可以填 🔴🟢 这些：写成 Obsidian 自己的彩色高亮
    .filter((s) => one.test(s) || (highlights && s in HIGHLIGHT_EMOJI));
}

/** 荧光笔颜色表里的一项是不是 Obsidian 的彩色高亮（🔴 之类），是的话给出颜色名 */
export function highlightOf(entry: string): HighlightColor | null {
  return HIGHLIGHT_EMOJI[entry] ?? null;
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

/** 删除线开关：选区紧挨着 ~~（或连 ~~ 一起选中）就去掉，不然每行包上 ~~ */
function toggleStrike(text: string, s: number, e: number): FormatResult {
  if (text.slice(s - 2, s) === "~~" && text.slice(e, e + 2) === "~~") {
    return { text: text.slice(0, s - 2) + text.slice(s, e) + text.slice(e + 2), start: s - 2, end: e - 2 };
  }
  const sel = text.slice(s, e);
  if (sel.length > 4 && sel.startsWith("~~") && sel.endsWith("~~")) {
    return { text: text.slice(0, s) + sel.slice(2, -2) + text.slice(e), start: s, end: e - 4 };
  }
  const wrapped = wrapLines(sel, "~~", "~~");
  return { text: text.slice(0, s) + wrapped + text.slice(e), start: s + 2, end: s + wrapped.length - 2 };
}

/** 下划线开关：选区两边正好是 <u> </u>（编辑框里标签藏着，选的是里面的字），或连标签一起选中，就去掉；不然每行包起来 */
function toggleUnderline(text: string, s: number, e: number): FormatResult {
  if (text.slice(s - 3, s) === "<u>" && text.slice(e, e + 4) === "</u>") {
    return { text: text.slice(0, s - 3) + text.slice(s, e) + text.slice(e + 4), start: s - 3, end: e - 3 };
  }
  const sel = text.slice(s, e);
  if (sel.length > 7 && sel.startsWith("<u>") && sel.endsWith("</u>") && !sel.slice(3, -4).includes("<u>")) {
    return { text: text.slice(0, s) + sel.slice(3, -4) + text.slice(e), start: s, end: e - 7 };
  }
  const wrapped = wrapLines(sel, "<u>", "</u>");
  return { text: text.slice(0, s) + wrapped + text.slice(e), start: s + 3, end: s + wrapped.length - 4 };
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

/**
 * 高亮开关：选区正好是一段高亮里面的文字（或连 == 一起选中）时，同色就取消、换色就只换颜色；
 * 不然整段包起来。颜色写成 Obsidian 的 ==🔴文字==，emoji 紧跟在开头的 == 后面
 */
function toggleHighlight(text: string, s: number, e: number, color?: HighlightColor): FormatResult {
  const emoji = color ? HIGHLIGHT_COLORS[color] : "";
  const open = HIGHLIGHT_OPEN_BEFORE.exec(text.slice(0, s));
  if (open && text.slice(e, e + 2) === "==") {
    const was = highlightColor(open[0].slice(2))?.color;
    const from = s - open[0].length;
    if (was === color) return { text: text.slice(0, from) + text.slice(s, e) + text.slice(e + 2), start: from, end: from + (e - s) };
    const opener = `==${emoji}`;
    return { text: text.slice(0, from) + opener + text.slice(s), start: from + opener.length, end: from + opener.length + (e - s) };
  }
  const whole = WHOLE_HIGHLIGHT.exec(text.slice(s, e));
  if (whole) {
    const was = whole[1] ? HIGHLIGHT_EMOJI[whole[1]] : undefined;
    const inner = whole[2];
    const next = was === color ? inner : `==${emoji}${inner}==`;
    const lead = was === color ? 0 : 2 + emoji.length;
    return { text: text.slice(0, s) + next + text.slice(e), start: s + lead, end: s + lead + inner.length };
  }
  const sel = text.slice(s, e);
  const wrapped = wrapLines(sel, `==${emoji}`, "==");
  return { text: text.slice(0, s) + wrapped + text.slice(e), start: s + 2 + emoji.length, end: s + wrapped.length - 2 };
}

/** 清除颜色时，碰到选区的彩色高亮去掉颜色、留下普通高亮 */
function clearHighlightColors(text: string, start: number, end: number): FormatResult {
  let out = "";
  let last = 0;
  let [s, e] = [start, end];
  for (const m of text.matchAll(COLORED_HIGHLIGHT)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (to <= start || from >= end) continue;
    const at = from + 2;
    const len = m[1].length;
    out += text.slice(last, at);
    last = at + len;
    if (at < start) s -= Math.min(len, start - at);
    if (at < end) e -= Math.min(len, end - at);
  }
  return { text: out + text.slice(last), start: s, end: e };
}

function toggleMark(text: string, s: number, e: number, kind: "bold" | "italic"): FormatResult {
  const m = kind === "bold" ? "**" : "*";
  const len = m.length;
  // * 和 ** 共用一个字符：数一数前后有几个星号，奇数才有斜体，两个以上才有粗体
  const has = (before: number, after: number) => {
    const n = Math.min(before, after);
    return kind === "bold" ? n >= 2 : n % 2 === 1;
  };
  if (has(starsBefore(text, s), starsAfter(text, e))) {
    return { text: text.slice(0, s - len) + text.slice(s, e) + text.slice(e + len), start: s - len, end: e - len };
  }
  // 选区把星号也框进去了
  const sel0 = text.slice(s, e);
  const lead = /^\*+/.exec(sel0)?.[0].length ?? 0;
  const tail = /\*+$/.exec(sel0)?.[0].length ?? 0;
  if (sel0.length > lead + tail && has(lead, tail)) {
    return { text: text.slice(0, s) + sel0.slice(len, -len) + text.slice(e), start: s, end: e - len * 2 };
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
      return toggleMark(text, s, e, fmt.kind);
    case "strike":
      return toggleStrike(text, s, e);
    case "underline":
      return toggleUnderline(text, s, e);
    case "highlight":
      return toggleHighlight(text, s, e, fmt.color);
    case "color":
    case "bg":
      return applyColor(text, s, e, fmt.kind, fmt.color);
    case "clear": {
      const a = applyColor(text, s, e, "color", null);
      const b = applyColor(a.text, a.start, a.end, "bg", null);
      return clearHighlightColors(b.text, b.start, b.end);
    }
  }
}
