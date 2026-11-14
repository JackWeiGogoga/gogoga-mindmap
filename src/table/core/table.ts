/**
 * 表格核心：一张表在内存里的样子，和「标准 GFM 表格 + 下面一行注释」之间的互转。
 * 不依赖 Obsidian、不碰 DOM，方便单测。
 *
 * 文件里长这样：
 *   | 方案 | 月费 |
 *   | :--- | :---: |
 *   | 基础 | 10 元 |
 *   <!-- gogoga-table: {"w":[120,null,200],"bg":{"B2":"yellow"}} -->
 * 注释里放 Markdown 写不出来的东西（列宽、底色……）；对齐用标准的冒号写法。
 * 格子坐标按 Excel：列 A、B、C……，第 1 行是表头。
 */

export type Align = "left" | "center" | "right" | null;

/** 底色只用这几个名字，深浅色模式各配一套 */
export const CELL_COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;
export type CellColor = (typeof CELL_COLORS)[number];

export const CALCS = ["sum", "avg", "count", "max", "min"] as const;
export type Calc = (typeof CALCS)[number];

/** 垂直对齐：不写是顶端 */
export const VALIGNS = ["middle", "bottom"] as const;
export type VAlign = (typeof VALIGNS)[number];

export const TABLE_STYLES = ["default", "zebra", "minimal", "academic"] as const;
export type TableStyle = (typeof TABLE_STYLES)[number];
export const TABLE_DENSITIES = ["comfortable", "compact"] as const;
/** 菜单里的文字大小档位（很小、小、正常、大、很大）；文件里写别的倍数也认，0.5～3 */
export const FONT_SIZES = [0.75, 0.85, 1, 1.15, 1.3] as const;
export const fontSizeOk = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0.5 && v <= 3;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

export interface TableMeta {
  /** 每列宽度（像素），null 是自动 */
  w?: (number | null)[];
  /** 格子底色，键是 A1 式坐标 */
  bg?: Record<string, CellColor>;
  /** 合并的格子：每项是 "A3:B4" 这样的矩形，左上角那格的内容代表整块 */
  merge?: string[];
  /** 格子的文字颜色，键是 A1 式坐标 */
  fg?: Record<string, CellColor>;
  /** 每列的垂直对齐（middle 居中、bottom 底端），null 是顶端 */
  va?: (VAlign | null)[];
  /** 每列的合计方式；有任何一列设了，最后一行就是合计行 */
  calc?: (Calc | null)[];
  /** 状态列：每列「值 → 颜色」；设了的列，格子画成彩色标签 */
  opts?: (Record<string, CellColor> | null)[];
  /** 第一列当标题列（加底色、加粗） */
  headerCol?: boolean;
  /** 冻结标题列：左右滚动时第一列固定在左边（只在 headerCol 开着时有用） */
  freeze?: 1;
  /** 表头行数（2、3）：Markdown 只认第一行是表头，往下几行也画成表头、一起吸顶，排序合计不算它们。不写就是 1 */
  head?: number;
  /** 这张表自己的样式、行距（不写就跟着设置走） */
  style?: TableStyle;
  density?: TableDensity;
  /** 整表文字大小，相对正常大小的倍数（1.15 大一号）；不写是正常 */
  fs?: number;
  /** 格子的文字大小倍数，键是 A1 式坐标；和整表的相乘 */
  fz?: Record<string, number>;
  /** 拖列宽时把表格拉得比正文宽了：这张表想左右滑动，「列宽按比例缩放」不缩它 */
  wide?: 1;
  /** 不认识的键原样保留，新版本加的东西旧版本不会弄丢 */
  [key: string]: unknown;
}

export interface Table {
  /** 第 0 行是表头；每行一样长。格子里是 Markdown 源码，换行用 \n（写回成 <br>），竖线不带转义 */
  cells: string[][];
  align: Align[];
  meta: TableMeta;
  /** 写回时沿用原来的风格：两头有没有竖线、各列有没有补空格对齐 */
  style: { outerPipes: boolean; padded: boolean };
}

export const META_PREFIX = "gogoga-table:";
const META_RE = /^\s*<!--\s*gogoga-table:\s*(\{.*\})\s*-->\s*$/;
const DELIM_CELL_RE = /^\s*:?-+:?\s*$/;
const BR_RE = /<br\s*\/?>/gi;

// ---------- 坐标 ----------

/** 第 c 列（从 0 开始）的字母：0 → A，25 → Z，26 → AA */
export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** (行, 列) → A1；行 0 是表头，对应第 1 行 */
export function cellRef(r: number, c: number): string {
  return colName(c) + (r + 1);
}

export function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)([1-9]\d*)$/.exec(ref);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** "A3:B4" → 矩形（不止一格才算）；写反了的也认 */
export function parseRange(s: string): Rect | null {
  const [a, b] = s.split(":");
  const p = a ? parseRef(a) : null;
  const q = b ? parseRef(b) : null;
  if (!p || !q) return null;
  const r = { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
  return r.r1 === r.r2 && r.c1 === r.c2 ? null : r;
}

export function rangeRef(r: Rect): string {
  return `${cellRef(r.r1, r.c1)}:${cellRef(r.r2, r.c2)}`;
}

// ---------- 解析 ----------

/** 按没转义的竖线切开一行；\| 留成 |。两头的竖线可有可无 */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function isDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIM_CELL_RE.test(c));
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

/** 注释行里的设置；不是我们的注释或 JSON 坏了返回 null */
export function parseMetaLine(line: string): TableMeta | null {
  const m = META_RE.exec(line);
  if (!m) return null;
  try {
    const v: unknown = JSON.parse(m[1]);
    return v && typeof v === "object" && !Array.isArray(v) ? sanitizeMeta(v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 认识的键检查一遍类型，不对的丢掉（不让坏数据影响显示）；不认识的键原样留着 */
function sanitizeMeta(raw: Record<string, unknown>): TableMeta {
  const meta: TableMeta = { ...raw };
  if (raw.w !== undefined) {
    if (Array.isArray(raw.w)) meta.w = raw.w.map((x) => (typeof x === "number" && isFinite(x) && x > 0 ? Math.round(x) : null));
    else delete meta.w;
  }
  if (raw.headerCol !== undefined && raw.headerCol !== true) delete meta.headerCol;
  if (raw.freeze !== undefined && raw.freeze !== 1) delete meta.freeze;
  if (raw.wide !== undefined && raw.wide !== 1) delete meta.wide;
  if (raw.head !== undefined && !(raw.head === 2 || raw.head === 3)) delete meta.head;
  if (raw.calc !== undefined) {
    const calc = Array.isArray(raw.calc) ? raw.calc.map((x) => ((CALCS as readonly unknown[]).includes(x) ? (x as Calc) : null)) : [];
    if (calc.some(Boolean)) meta.calc = calc;
    else delete meta.calc;
  }
  if (raw.va !== undefined) {
    const va = Array.isArray(raw.va) ? raw.va.map((x) => ((VALIGNS as readonly unknown[]).includes(x) ? (x as VAlign) : null)) : [];
    if (va.some(Boolean)) meta.va = va;
    else delete meta.va;
  }
  if (raw.opts !== undefined) {
    const opts = Array.isArray(raw.opts)
      ? raw.opts.map((o) => {
          if (!o || typeof o !== "object" || Array.isArray(o)) return null;
          const m: Record<string, CellColor> = {};
          for (const [k, v] of Object.entries(o as Record<string, unknown>)) if ((CELL_COLORS as readonly string[]).includes(v as string)) m[k] = v as CellColor;
          return m;
        })
      : [];
    if (opts.some(Boolean)) meta.opts = opts;
    else delete meta.opts;
  }
  if (raw.fg !== undefined) {
    const fg: Record<string, CellColor> = {};
    if (raw.fg && typeof raw.fg === "object" && !Array.isArray(raw.fg)) {
      for (const [k, v] of Object.entries(raw.fg as Record<string, unknown>)) {
        if (parseRef(k) && (CELL_COLORS as readonly string[]).includes(v as string)) fg[k] = v as CellColor;
      }
    }
    if (Object.keys(fg).length) meta.fg = fg;
    else delete meta.fg;
  }
  if (raw.bg !== undefined) {
    const bg: Record<string, CellColor> = {};
    if (raw.bg && typeof raw.bg === "object" && !Array.isArray(raw.bg)) {
      for (const [k, v] of Object.entries(raw.bg as Record<string, unknown>)) {
        if (parseRef(k) && (CELL_COLORS as readonly string[]).includes(v as string)) bg[k] = v as CellColor;
      }
    }
    if (Object.keys(bg).length) meta.bg = bg;
    else delete meta.bg;
  }
  if (raw.fs !== undefined && (!fontSizeOk(raw.fs) || raw.fs === 1)) delete meta.fs;
  if (raw.fz !== undefined) {
    const fz: Record<string, number> = {};
    if (raw.fz && typeof raw.fz === "object" && !Array.isArray(raw.fz)) {
      for (const [k, v] of Object.entries(raw.fz as Record<string, unknown>)) {
        if (parseRef(k) && fontSizeOk(v) && v !== 1) fz[k] = v;
      }
    }
    if (Object.keys(fz).length) meta.fz = fz;
    else delete meta.fz;
  }
  if (raw.style !== undefined && !(TABLE_STYLES as readonly unknown[]).includes(raw.style)) delete meta.style;
  if (raw.density !== undefined && !(TABLE_DENSITIES as readonly unknown[]).includes(raw.density)) delete meta.density;
  if (raw.merge !== undefined) {
    const merge = Array.isArray(raw.merge) ? raw.merge.filter((m): m is string => typeof m === "string" && parseRange(m) !== null) : [];
    if (merge.length) meta.merge = merge;
    else delete meta.merge;
  }
  return meta;
}

/** 格子源码 → 编辑用的文字：<br> 变换行 */
export function cellFromSource(s: string): string {
  return s.replace(BR_RE, "\n");
}

/** 编辑用的文字 → 格子源码：换行变 <br>，竖线转义，去掉两头空白 */
export function cellToSource(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

/**
 * 解析表格的几行（表头、分隔行、数据行），meta 是下面注释里的设置。不是表格返回 null。
 * 数据行比表头多出来的格子不丢：整张表按最宽的那行补齐，多出来的列表头是空的
 */
export function parseTable(lines: readonly string[], meta: TableMeta | null = null): Table | null {
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const delim = splitRow(lines[1]);
  if (header.length !== delim.length) return null;
  const rows = [header, ...lines.slice(2).map(splitRow)];
  const width = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: width }, (_, i) => cellFromSource(r[i] ?? "")));
  const align = Array.from({ length: width }, (_, i) => (i < delim.length ? alignOf(delim[i]) : null));
  const all = [lines[0], lines[1], ...lines.slice(2)];
  return {
    cells,
    align,
    meta: meta ?? {},
    style: { outerPipes: lines[0].trim().startsWith("|"), padded: looksPadded(all) },
  };
}

/** 原来的表格是不是补了空格让各列对齐（每行显示宽度一样，并且不止一行） */
function looksPadded(lines: readonly string[]): boolean {
  if (lines.length < 3) return false;
  const w = displayWidth(lines[0].trimEnd());
  return w > 0 && lines.every((l) => displayWidth(l.trimEnd()) === w);
}

// ---------- 写回 ----------

/** 等宽字体下的显示宽度：中日韩、全角字符和大部分 emoji 算 2 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** 分隔行的一格；width 是补空格对齐时这一列的宽度，紧凑写法时是 0（写成 :--- / :---: / ---:） */
function delimCell(a: Align, width: number): string {
  if (!width) return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
  const n = Math.max(3, width);
  if (a === "center") return ":" + "-".repeat(Math.max(1, n - 2)) + ":";
  if (a === "right") return "-".repeat(Math.max(2, n - 1)) + ":";
  if (a === "left") return ":" + "-".repeat(Math.max(2, n - 1));
  return "-".repeat(n);
}

/** 注释里实际要写的内容：空的项去掉；什么都没有就不写注释 */
export function metaToWrite(meta: TableMeta, cols: number): TableMeta | null {
  const out: TableMeta = { ...meta };
  if (out.w) {
    const w = out.w.slice(0, cols);
    if (w.some((x) => x != null)) {
      while (w.length && w[w.length - 1] == null) w.pop();
      out.w = w;
    } else delete out.w;
  }
  if (out.bg && !Object.keys(out.bg).length) delete out.bg;
  if (out.fg && !Object.keys(out.fg).length) delete out.fg;
  if (out.fz && !Object.keys(out.fz).length) delete out.fz;
  if (out.fs === 1) delete out.fs;
  for (const key of ["calc", "opts", "va"] as const) {
    const a = out[key] as unknown[] | undefined;
    if (!a) continue;
    const b = a.slice(0, cols);
    if (b.some(Boolean)) {
      while (b.length && !b[b.length - 1]) b.pop();
      (out as Record<string, unknown>)[key] = b;
    } else delete out[key];
  }
  if (out.merge && !out.merge.length) delete out.merge;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : null;
}

/** 注释行。竖线写成 \u007c：注释紧跟在表格下面，带竖线的话可能被当成表格的一行 */
export function metaLine(meta: TableMeta): string {
  return `<!-- ${META_PREFIX} ${JSON.stringify(meta).replace(/\|/g, "\\u007c")} -->`;
}

/** 写回成几行：表格，有设置时最后一行是注释 */
export function serializeTable(t: Table): string[] {
  const cols = t.align.length;
  const src = t.cells.map((row) => row.map(cellToSource));
  const widths = Array.from({ length: cols }, (_, c) => (t.style.padded ? Math.max(3, ...src.map((r) => displayWidth(r[c]))) : 0));
  const pad = (s: string, c: number) => {
    if (!t.style.padded) return s;
    const extra = widths[c] - displayWidth(s);
    if (extra <= 0) return s;
    const a = t.align[c];
    if (a === "right") return " ".repeat(extra) + s;
    if (a === "center") return " ".repeat(Math.floor(extra / 2)) + s + " ".repeat(Math.ceil(extra / 2));
    return s + " ".repeat(extra);
  };
  const line = (cells: string[]) => {
    const inner = cells.map((s) => ` ${s} `).join("|");
    return t.style.outerPipes ? `|${inner}|` : inner.trim() === "" ? inner : inner.replace(/^ /, "").replace(/ $/, "");
  };
  const out: string[] = [];
  out.push(line(src[0].map(pad)));
  out.push(line(t.align.map((a, c) => delimCell(a, widths[c]))));
  for (const row of src.slice(1)) out.push(line(row.map(pad)));
  const meta = metaToWrite(t.meta, cols);
  if (meta) out.push(metaLine(meta));
  return out;
}

/** 新建一张 rows×cols 的空表（rows 含表头） */
export function emptyTable(rows: number, cols: number): Table {
  return {
    cells: Array.from({ length: Math.max(2, rows) }, () => Array.from({ length: Math.max(1, cols) }, () => "")),
    align: Array.from({ length: Math.max(1, cols) }, () => null),
    meta: {},
    style: { outerPipes: true, padded: false },
  };
}

/**
 * 写回整块（替换 findTables 给出的 [start, stop)）：表格、原样留着的行（公式注释、块标识）、我们的注释。
 * 有块标识时，我们的注释前面必须隔一个空行，块标识才算这张表的
 */
export function serializeBlock(t: Table, tail: readonly string[]): string[] {
  const lines = serializeTable(t);
  const hasMeta = lines.length > 0 && lines[lines.length - 1].startsWith(`<!-- ${META_PREFIX}`);
  const table = hasMeta ? lines.slice(0, -1) : lines;
  const out = [...table, ...tail];
  if (hasMeta) {
    const blockId = tail.length > 0 && /^\^[A-Za-z0-9-]+\s*$/.test(tail[0]);
    if (blockId && out[out.length - 1].trim() !== "") out.push("");
    out.push(lines[lines.length - 1]);
  }
  return out;
}
