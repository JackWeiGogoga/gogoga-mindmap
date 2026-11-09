/**
 * 「在笔记里选中文字时显示格式栏」的纯逻辑（不依赖 Obsidian，单测直接跑）：哪段能加格式、加完怎么改文档
 */

import { type ChangeSpec, EditorSelection, EditorState } from "@codemirror/state";
import { fencedLines } from "./fence";
import { applyInlineFormat, type InlineFormat } from "./format";

/** 一行里能加格式的那一段 [起, 止)：去掉开头的引用、标题、列表、任务框，和行尾的 ^块编号、%%…%% 标记 */
export function lineContentRange(text: string): [number, number] {
  const head = /^\s*(?:>\s?)*(?:\[![^\]\s]*\][+-]?\s*)?(?:#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?)?/.exec(text);
  const start = head ? head[0].length : 0;
  let end = text.length;
  let rest = text.slice(start, end);
  for (const re of [/\s+\^[A-Za-z0-9-]+\s*$/, /\s*%%[^%]*%%\s*$/, /\s+$/]) {
    const m = re.exec(rest);
    if (m) {
      end -= m[0].length;
      rest = rest.slice(0, rest.length - m[0].length);
    }
  }
  return [start, Math.max(start, end)];
}

/** 选区覆盖的行里有没有在代码块、公式块、frontmatter 里的 */
function touchesFence(state: EditorState, fromLine: number, toLine: number): boolean {
  const doc = state.doc;
  const fenced = fencedLines((i) => doc.line(i + 1).text, toLine);
  for (let n = fromLine; n <= toLine; n++) if (fenced[n - 1]) return true;
  return false;
}

/** 选区落在哪几行（结尾停在下一行行首的不算那一行） */
function selectedLines(state: EditorState): [number, number] | null {
  const sel = state.selection.main;
  if (sel.empty) return null;
  const first = state.doc.lineAt(sel.from).number;
  let last = state.doc.lineAt(sel.to).number;
  if (last > first && state.doc.line(last).from === sel.to) last--;
  return [first, last];
}

/** 给选中的文字加格式要做的改动；没有能改的（选的全是列表符号、在代码块里……）返回 null */
export function formatSelection(state: EditorState, fmt: InlineFormat): { changes: ChangeSpec[]; selection: EditorSelection } | null {
  const lines = selectedLines(state);
  if (!lines || touchesFence(state, lines[0], lines[1])) return null;
  const sel = state.selection.main;
  const changes: ChangeSpec[] = [];
  let from: number | null = null;
  let to = 0;
  let delta = 0;
  for (let n = lines[0]; n <= lines[1]; n++) {
    const line = state.doc.line(n);
    const [cs, ce] = lineContentRange(line.text);
    const s = Math.max(cs, sel.from - line.from);
    const e = Math.min(ce, sel.to - line.from);
    if (s >= e || !line.text.slice(s, e).trim()) continue;
    const r = applyInlineFormat(line.text, s, e, fmt);
    if (r.text !== line.text) changes.push({ from: line.from, to: line.to, insert: r.text });
    from ??= line.from + delta + r.start;
    to = line.from + delta + r.end;
    delta += r.text.length - line.text.length;
  }
  if (from === null || !changes.length) return null;
  return { changes, selection: EditorSelection.single(from, to) };
}

/** 选区现在能不能显示格式栏（不管位置） */
export function canShowFormatBar(state: EditorState): boolean {
  const lines = selectedLines(state);
  if (!lines || touchesFence(state, lines[0], lines[1])) return false;
  const sel = state.selection.main;
  for (let n = lines[0]; n <= lines[1]; n++) {
    const line = state.doc.line(n);
    const [cs, ce] = lineContentRange(line.text);
    const s = Math.max(cs, sel.from - line.from);
    const e = Math.min(ce, sel.to - line.from);
    if (s < e && line.text.slice(s, e).trim()) return true;
  }
  return false;
}

