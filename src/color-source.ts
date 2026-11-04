/** Supported color markup stays in the source; these ranges drive visual editing. */
import { BG_OPEN_SRC, COLOR_OPEN_SRC } from "./format";

export interface MarkupSpan {
  from: number;
  openEnd: number;
  closeStart: number;
  to: number;
  className?: string;
}

export interface ColorSpan extends MarkupSpan {
  kind: "color" | "bg";
  color: string;
}

/** Ignore code, escaped tags and incomplete/misnested markup rather than hiding it. */
export function colorSpans(source: string): ColorSpan[] {
  const tokens = new RegExp(`${COLOR_OPEN_SRC}|${BG_OPEN_SRC}|<mark>|</span>|</mark>|\x60+|^ {0,3}~{3,}[^\n]*`, "gm");
  const stack: Omit<ColorSpan, "closeStart" | "to">[] = [];
  const spans: ColorSpan[] = [];
  let code = "";
  for (const m of source.matchAll(tokens)) {
    const token = m[0];
    const from = m.index;
    let escapes = 0;
    for (let i = from - 1; i >= 0 && source[i] === "\\"; i--) escapes++;
    if (escapes % 2) continue;
    if (token.startsWith("`") || token.trimStart().startsWith("~~~")) {
      const fence = token.trimStart().match(/^[`~]+/)?.[0] ?? "";
      if (!code) code = fence;
      else if (fence[0] === code[0] && (code.length >= 3 ? fence.length >= code.length : fence.length === code.length)) code = "";
      continue;
    }
    if (code || token.includes("\n")) continue;
    if (m[1] !== undefined || m[2] !== undefined || token === "<mark>") {
      stack.push({ from, openEnd: from + token.length, kind: m[1] !== undefined ? "color" : "bg", color: m[1] ?? m[2] ?? "var(--text-highlight-bg, #ffd43b66)" });
    } else {
      const kind = token === "</span>" ? "color" : "bg";
      const open = stack.pop();
      if (open?.kind === kind) spans.push({ ...open, closeStart: from, to: from + token.length });
      else stack.length = 0;
    }
  }
  return spans.sort((a, b) => a.from - b.from);
}

/** Empty formatting is not node content. Other markup is left byte-for-byte intact. */
export function dropEmptyColors(source: string): string {
  for (;;) {
    const empty = colorSpans(source).filter((s) => s.openEnd === s.closeStart);
    if (!empty.length) return source;
    for (const s of empty.reverse()) source = source.slice(0, s.from) + source.slice(s.to);
  }
}
