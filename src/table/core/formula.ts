/**
 * 计算列的公式：整列用同一个公式按行算，比如「金额」= {单价} * {数量}。
 * 公式用列名引用（花括号括起来），所以插入、删除、移动行列都不用改公式；改了表头的列名，公式跟着改。
 * 只有四则运算、括号和几个函数（SUM AVG MIN MAX ROUND），不用 eval。不依赖表格，方便单测。
 */

export const FX_FUNCS = ["SUM", "AVG", "MIN", "MAX", "ROUND"] as const;
export type FxFunc = (typeof FX_FUNCS)[number];

export type FxNode =
  | { k: "num"; v: number }
  | { k: "ref"; name: string }
  | { k: "neg"; a: FxNode }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: FxNode; b: FxNode }
  | { k: "fn"; name: FxFunc; args: FxNode[] };

/** 公式写错了：code 给界面翻译，name 是出错的列名 / 函数名 */
export interface FxError {
  code: "empty" | "syntax" | "paren" | "brace" | "func" | "args" | "unknownCol" | "self" | "cycle" | "ambiguous";
  name?: string;
}

/** 某一行算不出来（结果留空）：引用的格子是空的 / 不是数，或者除以 0 */
export interface FxEmpty {
  reason: "input" | "div0";
  name?: string;
}

type Tok = { t: "num"; v: number } | { t: "ref"; name: string } | { t: "id"; name: string } | { t: "op"; v: string };

/** 中文输入法打出来的全角符号也认 */
const WIDE: Record<string, string> = { "（": "(", "）": ")", "，": ",", "×": "*", "÷": "/", "＋": "+", "－": "-", "−": "-", "＊": "*", "／": "/", "｛": "{", "｝": "}" };

function tokenize(src: string): Tok[] {
  const s = src.replace(/[（），×÷＋－−＊／｛｝]/g, (ch) => WIDE[ch]);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "{") {
      const j = s.indexOf("}", i + 1);
      if (j < 0) throw new FxFail({ code: "brace" });
      const name = s.slice(i + 1, j).trim();
      if (!name || name.includes("{")) throw new FxFail({ code: "brace" });
      out.push({ t: "ref", name });
      i = j + 1;
      continue;
    }
    if (ch === "}") throw new FxFail({ code: "brace" });
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[1]) });
      i += num[1].length;
      continue;
    }
    const id = /^[A-Za-z]+/.exec(s.slice(i));
    if (id) {
      out.push({ t: "id", name: id[0] });
      i += id[0].length;
      continue;
    }
    if ("+-*/(),".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new FxFail({ code: "syntax" });
  }
  return out;
}

/** 解析公式；写错了抛 FxFail（info 是 FxError） */
export function parseFormula(src: string): FxNode {
  if (!src.trim()) throw new FxFail({ code: "empty" });
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const expr = (): FxNode => {
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[i++] as { v: "+" | "-" }).v;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): FxNode => {
    let a = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[i++] as { v: "*" | "/" }).v;
      a = { k: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): FxNode => {
    if (isOp("-")) {
      i++;
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return primary();
  };
  const primary = (): FxNode => {
    const tk = toks[i];
    if (!tk) throw new FxFail({ code: "syntax" });
    if (tk.t === "num") {
      i++;
      return { k: "num", v: tk.v };
    }
    if (tk.t === "ref") {
      i++;
      return { k: "ref", name: tk.name };
    }
    if (tk.t === "id") {
      const name = tk.name.toUpperCase() as FxFunc;
      if (!(FX_FUNCS as readonly string[]).includes(name)) throw new FxFail({ code: "func", name: tk.name });
      i++;
      if (!isOp("(")) throw new FxFail({ code: "syntax" });
      i++;
      const args: FxNode[] = [];
      if (!isOp(")")) {
        args.push(expr());
        while (isOp(",")) {
          i++;
          args.push(expr());
        }
      }
      if (!isOp(")")) throw new FxFail({ code: "paren" });
      i++;
      const ok = name === "ROUND" ? args.length === 1 || args.length === 2 : args.length >= 1;
      if (!ok) throw new FxFail({ code: "args", name });
      return { k: "fn", name, args };
    }
    if (tk.v === "(") {
      i++;
      const e = expr();
      if (!isOp(")")) throw new FxFail({ code: "paren" });
      i++;
      return e;
    }
    if (tk.v === ")") throw new FxFail({ code: "paren" });
    throw new FxFail({ code: "syntax" });
  };
  const node = expr();
  if (i < toks.length) throw new FxFail(isOp(")") ? { code: "paren" } : { code: "syntax" });
  return node;
}

/** 公式写错（parseFormula）、某一行算不出来（evalFormula）时抛这个，原因在 info 里 */
export class FxFail extends Error {
  constructor(readonly info: FxError | FxEmpty) {
    super("code" in info ? `formula: ${info.code}` : `formula: ${info.reason}`);
  }
}

/** 解析出错时的原因；别的异常返回 null */
export function fxErrorOf(e: unknown): FxError | null {
  return e instanceof FxFail && "code" in e.info ? e.info : null;
}

/** 公式里引用到的列名（去重，按出现顺序） */
export function formulaRefs(node: FxNode): string[] {
  const out: string[] = [];
  const walk = (n: FxNode) => {
    if (n.k === "ref") {
      if (!out.includes(n.name)) out.push(n.name);
    } else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    } else if (n.k === "fn") n.args.forEach(walk);
  };
  walk(node);
  return out;
}

/**
 * 按一行的值算公式。get 返回这一列在这一行的数，空格子、不是数的格子返回 null。
 * 算不出来（引用的格子空着、除以 0）抛 FxFail（info 是 FxEmpty）；SUM、AVG、MIN、MAX 跳过空的，全空才算不出来
 */
export function evalFormula(node: FxNode, get: (name: string) => number | null): number {
  const ev = (n: FxNode): number => {
    switch (n.k) {
      case "num":
        return n.v;
      case "ref": {
        const v = get(n.name);
        if (v === null) throw new FxFail({ reason: "input", name: n.name });
        return v;
      }
      case "neg":
        return -ev(n.a);
      case "bin": {
        const a = ev(n.a);
        const b = ev(n.b);
        if (n.op === "+") return a + b;
        if (n.op === "-") return a - b;
        if (n.op === "*") return a * b;
        if (b === 0) throw new FxFail({ reason: "div0" });
        return a / b;
      }
      case "fn": {
        if (n.name === "ROUND") {
          const v = ev(n.args[0]);
          const p = n.args[1] ? Math.max(0, Math.min(10, Math.round(ev(n.args[1])))) : 0;
          const f = 10 ** p;
          return Math.round((v + Math.sign(v) * Number.EPSILON) * f) / f;
        }
        const vals: number[] = [];
        let first: FxFail | null = null;
        for (const a of n.args) {
          try {
            vals.push(ev(a));
          } catch (e) {
            if (!(e instanceof FxFail)) throw e;
            first ??= e;
          }
        }
        if (!vals.length) throw first ?? new FxFail({ reason: "input" });
        if (n.name === "SUM") return vals.reduce((x, y) => x + y, 0);
        if (n.name === "AVG") return vals.reduce((x, y) => x + y, 0) / vals.length;
        return n.name === "MAX" ? Math.max(...vals) : Math.min(...vals);
      }
    }
  };
  return ev(node);
}

/** 算不出来时的原因；别的异常返回 null */
export function fxEmptyOf(e: unknown): FxEmpty | null {
  return e instanceof FxFail && "reason" in e.info ? e.info : null;
}

/** 算出来的数写进格子：places 为 null 是自动（整数就是整数，否则最多两位小数） */
export function formatFx(v: number, places: number | null): string {
  if (!Number.isFinite(v)) return "";
  let s: string;
  if (places === null) {
    const r = Math.round(v * 100) / 100;
    s = Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  } else s = v.toFixed(places);
  // -0、-0.00 写成 0
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** 列名能不能被公式引用：不能是空的，不能带花括号 */
export function nameOk(name: string): boolean {
  return !!name && !/[{}]/.test(name);
}

/** 公式里的 {旧名} 换成 {新名}（改了表头时用；花括号里两头的空格也认） */
export function renameInFormula(src: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return src.replace(new RegExp(`[{｛]\\s*${esc}\\s*[}｝]`, "g"), () => `{${to}}`);
}

/** 公式写成好读的样子（预览用）：* / 换成 × ÷ */
export function prettyOps(src: string): string {
  return src.replace(/\*/g, "×").replace(/\//g, "÷");
}
