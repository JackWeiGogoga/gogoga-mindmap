/**
 * 列类型用到的文字处理：数字格式、日期、进度、多选标签。只管一格里的文字，不碰整张表（整表的在 ops.ts）。
 * 原则：格子里写的都是看得懂的文字；整理格式时不丢信息（小数位比设定的多就留着）
 */
import type { ColType } from "./table";

export type NumFmt = Extract<ColType, { t: "num" }>;

// ---------- 数字 ----------

/** 包在数外面的格式（**加粗**、==高亮==……）：整理格式时原样留着 */
const WRAP_RE = /^(\*\*|__|\*|_|==|~~|`)(.*)\1$/;
const NUM_RE = /^([+-])?([¥$€£])?([+-])?(\d[\d,]*(?:\.\d+)?|\.\d+)(%)?$/;

/** 读一格里的数：去掉千分位、货币符号；pct 是带百分号。shown 是写出来的那个数（12% 是 12），places 是它的小数位 */
export function readNumber(text: string): { shown: number; places: number; pct: boolean; wrap: string } | null {
  let s = text.trim();
  let wrap = "";
  const w = WRAP_RE.exec(s);
  if (w) {
    wrap = w[1];
    s = w[2];
  }
  s = s.replace(/[\s，]/g, "");
  const m = NUM_RE.exec(s);
  if (!m || (m[1] && m[3])) return null;
  const digits = m[4].replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(digits)) return null;
  const neg = (m[1] ?? m[3]) === "-";
  const i = digits.indexOf(".");
  return { shown: (neg ? -1 : 1) * Number(digits), places: i < 0 ? 0 : digits.length - i - 1, pct: !!m[5], wrap };
}

/** 三位一个逗号 */
function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 按数字格式写一个数。v 是真正的值（百分比列里 0.12 写成 12%）；places 是小数位，null 是自动（最多两位、去掉末尾的 0）
 */
export function formatNumber(v: number, f: NumFmt, places: number | null): string {
  if (!Number.isFinite(v)) return "";
  const shown = f.p ? v * 100 : v;
  return writeShown(shown, f, places);
}

function writeShown(shown: number, f: NumFmt, places: number | null): string {
  let body: string;
  if (places === null) {
    const r = Math.round(Math.abs(shown) * 100) / 100;
    body = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  } else body = Math.abs(shown).toFixed(places);
  // 很大的数 toFixed 会写成 1e+21：不整理
  if (/e/i.test(body)) return String(shown);
  const neg = shown < 0 && !/^0(\.0+)?$/.test(body);
  const [int, dec] = body.split(".");
  const num = (f.g ? group(int) : int) + (dec !== undefined ? "." + dec : "");
  return (neg ? "-" : "") + (f.u ?? "") + num + (f.p ? "%" : "");
}

/**
 * 数字列里提交的一格：是数就按列的格式重写，不是数（空的、文字）原样返回。
 * 百分比列里打 12 就是 12%（和 Excel 一样）；不是百分比的列里写 12% 换成 0.12。
 * 小数位：设了就补到这么多位，但打的位数更多时留着（不四舍五入丢掉）
 */
export function reformatNumber(text: string, f: NumFmt): string {
  const n = readNumber(text);
  if (!n) return text;
  let shown = n.shown;
  let places = n.places;
  if (!f.p && n.pct) {
    shown = n.shown / 100;
    places += 2;
    // 0.120 这种末尾的 0 是换算出来的，去掉
    const s = shown.toFixed(places).replace(/0+$/, "");
    places = s.includes(".") ? s.length - s.indexOf(".") - 1 : 0;
  }
  const d = f.d === undefined ? places : Math.max(f.d, places);
  return n.wrap + writeShown(shown, f, d) + n.wrap;
}

// ---------- 日期 ----------

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** 合法的日子（2 月 30 日不算） */
export function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return false;
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

const DATE_RE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/;
const ONLY_DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const LINK_RE = /^\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]$/;

/**
 * 格子里的日期：找 2026-11-17、2026/11/17、2026年11月17日；[[日记]] 链接按 parseNote（日记插件的格式）读。
 * 读不出来返回 null
 */
export function readDate(text: string, parseNote?: (name: string) => Ymd | null): Ymd | null {
  const s = text.trim();
  const link = LINK_RE.exec(s);
  if (link && parseNote) {
    const name = link[1].split("/").pop() ?? link[1];
    const p = parseNote(name);
    if (p) return p;
  }
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const v = { y: +m[1], m: +m[2], d: +m[3] };
  return validYmd(v.y, v.m, v.d) ? v : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (v: Ymd) => `${v.y}-${pad(v.m)}-${pad(v.d)}`;

/** 按日期列的写法写一个日子；link 要日记的名字（noteName），不给就用 2026-11-17 */
export function writeDate(v: Ymd, f: "slash" | "link" | undefined, noteName?: (v: Ymd) => string): string {
  if (f === "slash") return `${v.y}/${pad(v.m)}/${pad(v.d)}`;
  if (f === "link") return `[[${noteName ? noteName(v) : isoDate(v)}]]`;
  return isoDate(v);
}

/**
 * 日期列里提交的一格：整格就是一个日期（2026-1-5、2026/01/05）时按列的写法统一（补零、换分隔符）；
 * 带别的字、链接、读不出的原样返回。写成链接的列不改（链接要按日记的格式，只有日历选的时候写）
 */
export function reformatDate(text: string, f: "slash" | "link" | undefined): string {
  if (f === "link") return text;
  const m = ONLY_DATE_RE.exec(text.trim());
  if (!m || !validYmd(+m[1], +m[2], +m[3])) return text;
  return writeDate({ y: +m[1], m: +m[2], d: +m[3] }, f);
}

const RELATIVE_DAYS: Record<string, number> = { 前天: -2, 昨天: -1, 今天: 0, 明天: 1, 后天: 2, yesterday: -1, today: 0, tomorrow: 1 };

/**
 * 手打进日期列的一整格，尽量读成一个日子（设置里「自动识别日期写法」开着时，提交那一格用）：
 * 2026-1-5、2026/1/5、2026.1.5、2026年1月5日（号）、20260105；没写年的 1/5、11-17、1月5日 算今年；
 * 今天、明天、昨天、后天、前天（today / tomorrow / yesterday）按 today 算。
 * 带别的字、日子不存在（2 月 30 日）、两位数的年份（26-1-5，分不清年月日的顺序）读不出，返回 null
 */
export function parseLooseDate(text: string, today: Ymd): Ymd | null {
  const s = text.trim().toLowerCase();
  if (s in RELATIVE_DAYS) {
    const d = new Date(Date.UTC(today.y, today.m - 1, today.d + RELATIVE_DAYS[s]));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  let m = /^(\d{4})\s*(?:[-/.]\s*(\d{1,2})\s*[-/.]|年\s*(\d{1,2})\s*月)\s*(\d{1,2})\s*(?:日|号)?$/.exec(s);
  let v: Ymd | null = m ? { y: +m[1], m: +(m[2] ?? m[3]), d: +m[4] } : null;
  if (!v && (m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) v = { y: +m[1], m: +m[2], d: +m[3] };
  if (!v && (m = /^(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})\s*(?:日|号)?$/.exec(s))) v = { y: today.y, m: +m[1], d: +m[2] };
  return v && validYmd(v.y, v.m, v.d) ? v : null;
}

// ---------- 进度 ----------

/**
 * 进度：60% → 0.6，3/5 → 0.6，0.6（带小数点、不超过 1）→ 0.6，别的数按百分数（60 → 0.6）。
 * 超出 0～1 的照样返回（画的时候截住）；读不出返回 null
 */
export function readProgress(text: string): number | null {
  const s = text.trim().replace(/\s/g, "");
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) return +frac[2] > 0 ? +frac[1] / +frac[2] : null;
  const n = readNumber(s);
  if (!n || n.wrap) return null;
  if (n.pct) return n.shown / 100;
  if (n.places > 0 && Math.abs(n.shown) <= 1) return n.shown;
  return n.shown / 100;
}

// ---------- 多选标签 ----------

const TAG_SEP = /[,，、]/;

/** 多选格子里的标签：按逗号、顿号分开，去掉空的、重复的 */
export function splitTags(text: string): string[] {
  const out: string[] = [];
  for (const x of text.split(TAG_SEP)) {
    const v = x.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 多选格子统一写成「甲, 乙」 */
export function joinTags(tags: readonly string[]): string {
  return tags.join(", ");
}
