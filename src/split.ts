/**
 * 「拆成子节点」：把一段文字按某种方式拆成几段。
 * - 逗号（默认，原来的「按标点拆」）：中英文逗号、顿号、分号
 * - 句号：。！？和英文 . ! ?（小数点 3.14 不算）
 * - 分号：中英文分号
 * - 序号：1. / 1、 / (1) / ① / 一、 / （一） / I. / iv) 这类，按顺序出现（1、2、3）才拆
 * - 自定义：设置里写的一组符号
 * 链接、公式、代码、HTML 标签、网址里的符号都不算；数字里的千分位逗号（1,000）不算。
 * keepDelims：拆分符号留着（标点留在每段末尾，序号留在每段开头）；不留时序号连同紧跟的标点、空格一起去掉，后面的文字留着
 */

export type SplitRule = { kind: "comma" } | { kind: "period" } | { kind: "semicolon" } | { kind: "number" } | { kind: "chars"; chars: string };

export interface SplitResult {
  /** 序号拆分时第一个序号前面的文字（比如「水果：1. 苹果 2. 梨」的「水果：」）；没有是空串 */
  lead: string;
  parts: string[];
}

/** 拆分时不能从中间断开的片段：双链、链接、图片、行内代码、公式、HTML 标签、网址 */
const KEEP_RE = /!?\[\[[^\]]*\]\]|!?\[[^\]]*\]\([^)]*\)|`[^`]*`|\$\$?[^$]*\$\$?|<[^>]+>|https?:\/\/\S+/g;

/** 设置里的自定义拆分方式：每行「名称：符号」 */
export interface CustomSplit {
  name: string;
  chars: string;
}

/** 解析设置里的自定义拆分（每行「名称：符号」，冒号中英文都行；没写名称的用符号当名称） */
export function parseCustomSplits(text: string): CustomSplit[] {
  const out: CustomSplit[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    const m = /^(.*?)[：:]\s*(\S.*)$/.exec(s);
    const name = m ? m[1].trim() : "";
    const chars = Array.from(new Set(Array.from((m ? m[2] : s).replace(/\s+/g, "")))).join("");
    if (!chars) continue;
    out.push({ name: name || chars, chars });
  }
  return out;
}

const RULE_CHARS = { comma: "，、；;,", period: "。！？!?.", semicolon: "；;" } as const;

function keepSpans(text: string): [number, number][] {
  const keep: [number, number][] = [];
  for (const m of text.matchAll(KEEP_RE)) keep.push([m.index, m.index + m[0].length]);
  return keep;
}

/** 按一组符号拆。, 夹在两个数字中间（千分位）、. 夹在两个数字中间（小数点）不算 */
function splitChars(text: string, chars: string, keepDelims: boolean): string[] {
  const keep = keepSpans(text);
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const span = keep.find(([a, b]) => i >= a && i < b);
    if (span) {
      i = span[1] - 1;
      continue;
    }
    const c = text[i];
    if (!chars.includes(c)) continue;
    if ((c === "," || c === ".") && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    // 连着的几个符号（「！？」「...」）算一处
    let j = i;
    while (j + 1 < text.length && chars.includes(text[j + 1])) j++;
    parts.push(keepDelims ? text.slice(start, j + 1) : text.slice(start, i));
    start = j + 1;
    i = j;
  }
  parts.push(text.slice(start));
  return parts.map((p) => (keepDelims ? p.trim() : p.trim().replace(/[。．]+$/, "").trim())).filter(Boolean);
}

// ---------- 序号 ----------

type Family = "arabic" | "circled" | "chinese" | "roman" | "ROMAN";
interface Mark {
  at: number;
  /** 序号连同后面的标点、空格到哪儿（不留拆分符号时去掉 [at, end)） */
  end: number;
  family: Family;
  value: number;
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function chineseValue(s: string): number | null {
  if (s === "十") return 10;
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m) return (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  return s.length === 1 && CN_DIGITS[s] ? CN_DIGITS[s] : null;
}
const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanValue(s: string): number | null {
  const t = s.toLowerCase();
  let v = 0;
  for (let i = 0; i < t.length; i++) {
    const a = ROMAN[t[i]];
    const b = ROMAN[t[i + 1]] ?? 0;
    v += a < b ? -a : a;
  }
  return v > 0 && v < 100 ? v : null;
}

// 序号的写法：（1）(1)、1. 1、 1) 1．、①、（一）(一)、一、 一. 一)、I. ii) IV、（罗马数字要跟着 . 、 ) 才算，免得把 I am 拆开）
const MARK_RE =
  /[(（](\d{1,3})[)）]|(\d{1,3})(?:[.．](?!\d)|[、)）])|([①-⑳])|[(（]([一二三四五六七八九十]{1,3})[)）]|([一二三四五六七八九十]{1,3})[、.．)）]|\b([IVXLC]{1,6}|[ivxlc]{1,6})(?:[.．、)）])/g;

function findMarks(text: string): Mark[] {
  const keep = keepSpans(text);
  const marks: Mark[] = [];
  for (const m of text.matchAll(MARK_RE)) {
    const at = m.index;
    if (keep.some(([a, b]) => at >= a && at < b)) continue;
    // 只认开头、或者标点 / 空白后面的序号（「第1版」「版本2.0」不算）；带括号、带圈的自带边界，紧跟在文字后面也算
    const before = text[at - 1];
    const bounded = !!(m[1] || m[3] || m[4]);
    if (at > 0 && !bounded && !/[\s，。、；;,.：:！？!?）)】\]]/.test(before)) continue;
    let value: number | null = null;
    let family: Family;
    if (m[1] || m[2]) {
      family = "arabic";
      value = Number(m[1] ?? m[2]);
    } else if (m[3]) {
      family = "circled";
      value = m[3].charCodeAt(0) - 0x2460 + 1;
    } else if (m[4] || m[5]) {
      family = "chinese";
      value = chineseValue(m[4] ?? m[5]);
    } else {
      family = m[6] === m[6].toUpperCase() ? "ROMAN" : "roman";
      value = romanValue(m[6]);
    }
    if (value === null) continue;
    let end = at + m[0].length;
    // 序号后面紧跟的标点、空格一起算进去（「一、 xx」「1. xx」），是文字就停
    while (end < text.length && /[\s.．、，,:：)）]/.test(text[end])) end++;
    marks.push({ at, end, family, value });
  }
  return marks;
}

/** 同一种写法、按 1、2、3 连着递增的最长一串序号（少于两个返回 null） */
function bestChain(marks: Mark[]): Mark[] | null {
  let best: Mark[] = [];
  for (let i = 0; i < marks.length; i++) {
    const chain = [marks[i]];
    for (let j = i + 1; j < marks.length; j++) {
      const last = chain[chain.length - 1];
      if (marks[j].family === last.family && marks[j].value === last.value + 1) chain.push(marks[j]);
    }
    if (chain.length > best.length) best = chain;
  }
  return best.length >= 2 ? best : null;
}

/** 每段末尾分隔用的标点（不留拆分符号时去掉：「1.苹果；2.梨」→ 苹果、梨） */
const TRAIL_RE = /[\s，、；;,。．]+$/;

function splitNumbers(text: string, keepDelims: boolean): SplitResult | null {
  const chain = bestChain(findMarks(text));
  if (!chain) return null;
  const lead = text.slice(0, chain[0].at).trim();
  const parts = chain
    .map((m, i) => {
      const stop = i + 1 < chain.length ? chain[i + 1].at : text.length;
      const seg = keepDelims ? text.slice(m.at, stop) : text.slice(m.end, stop);
      return keepDelims ? seg.trim() : seg.replace(TRAIL_RE, "").trim();
    })
    .filter(Boolean);
  return parts.length >= 2 ? { lead, parts } : null;
}

/** 按 rule 拆 text；拆不出两段以上返回 null */
export function splitText(text: string, rule: SplitRule, keepDelims = false): SplitResult | null {
  if (rule.kind === "number") return splitNumbers(text, keepDelims);
  const chars = rule.kind === "chars" ? rule.chars : RULE_CHARS[rule.kind];
  if (!chars) return null;
  const parts = splitChars(text, chars, keepDelims);
  return parts.length >= 2 ? { lead: "", parts } : null;
}

/** 原来的「按标点拆成子节点」（逗号、顿号、分号，去掉符号） */
export function splitByPunctuation(text: string): string[] | null {
  return splitText(text, { kind: "comma" })?.parts ?? null;
}
