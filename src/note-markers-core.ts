/**
 * 「在笔记里隐藏脑图节点标记」的核心（不碰 DOM，方便单测）：脑图笔记的实时预览里，行尾脑图认得的 %%…%% 标记
 * 缩成一个小灰点。标记必须留在行尾，脑图才认：
 * - 光标落到行尾（标记后面）时挪到标记前面，打字、输入法组字、粘贴都写在标记前面；从标记前往右走直接到下一行；
 * - 在标记前按回车：换行放到标记后面；
 * - 往前删、选中删碰到标记时只删看得见的字；在标记前按 Delete 不动；
 * - 在下一行开头退格把两行接起来时，下一行的字接到标记前面。
 * 光标进到标记里（点小灰点）就露出原文，可以手改；改动都在露出的标记里时不拦。
 * 用户自己写的、脑图不认的注释（比如 %%回头再改%%）不动
 */

import { EditorSelection, EditorState, type Extension, type Text, Transaction, type TransactionSpec, findClusterBreak } from "@codemirror/state";
import { fencedLines } from "./fence";
import { MARKER_RE, splitMarker } from "./markdown";

export interface MarkerRange {
  /** 整段（含前面的空格）在文档里的开头、结尾（结尾就是行尾） */
  from: number;
  to: number;
  /** 开头 %% 后面的位置：点小灰点时光标放这里 */
  inner: number;
}

/** 这一行行尾有没有脑图认得的标记 */
export function markerInLine(text: string, lineFrom: number): MarkerRange | null {
  if (!text.includes("%%")) return null;
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  if (splitMarker(text).text === text.trimEnd()) return null;
  const open = text.indexOf("%%", m.index);
  return { from: lineFrom + m.index, to: lineFrom + text.length, inner: lineFrom + open + 2 };
}

/** 光标、选区的一头在标记里面（不含两头）：露出原文 */
export function revealedMarker(r: MarkerRange, sel: EditorSelection): boolean {
  return sel.ranges.some((s) => (s.from > r.from && s.from < r.to) || (s.to > r.from && s.to < r.to));
}

/** 某行藏着的标记（不在代码块里、没露出来） */
export function hiddenMarkerAt(state: EditorState, lineNo: number, sel: EditorSelection = state.selection): MarkerRange | null {
  const line = state.doc.line(lineNo);
  const r = markerInLine(line.text, line.from);
  if (!r || revealedMarker(r, sel)) return null;
  if (fenced(state.doc, lineNo)[lineNo - 1]) return null;
  return r;
}

function fenced(doc: Text, upTo: number): boolean[] {
  return fencedLines((i) => doc.line(i + 1).text, Math.min(upTo, doc.lines));
}

/** 光标不停在藏着的标记后面：挪到标记前；从标记前往右走（落到行尾）就直接去下一行开头 */
function keepCursorBefore(active: (s: EditorState) => boolean): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.selection && !tr.docChanged) return tr;
    const st = tr.state;
    if (!active(st)) return tr;
    const sel = st.selection;
    if (sel.ranges.length > 1 || !sel.main.empty) return tr;
    const pos = sel.main.head;
    const line = st.doc.lineAt(pos);
    if (pos !== line.to) return tr;
    const r = hiddenMarkerAt(st, line.number, sel);
    if (!r || pos !== r.to || r.from === r.to) return tr;
    const prev = tr.startState.selection.main;
    const prevPos = tr.docChanged ? tr.changes.mapPos(prev.head, -1) : prev.head;
    // 原来就在标记前，这次往右走：去下一行
    const target = !tr.docChanged && prev.empty && prevPos === r.from && line.number < st.doc.lines ? line.to + 1 : r.from;
    return [tr, { selection: EditorSelection.cursor(target), sequential: true }];
  });
}

/**
 * 去掉改动开头没变的部分，只留真正变的那段：Obsidian 在列表里回车会把「乙 」整段换成「乙\n- 」，
 * 起点落在标记前面，看真正变的那段（在标记前插入换行）才认得出来。什么都没变返回 null
 */
export function trimChange(c: { from: number; to: number; insert: string }, deleted: string): { from: number; to: number; insert: string } | null {
  let a = 0;
  while (a < deleted.length && a < c.insert.length && deleted[a] === c.insert[a]) a++;
  if (a === deleted.length && a === c.insert.length) return null;
  // 只去掉相同的开头：结尾相同的那个空格（列表回车后的「- 」）是挪了位置，不能当成没变
  return { from: c.from + a, to: c.to, insert: c.insert.slice(a) };
}

/** 删字、打字、接行碰到藏着的标记时改写（规则见文件开头） */
function guardEdits(active: (s: EditorState) => boolean): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input"))) return tr;
    const st = tr.startState;
    if (!active(st) || st.selection.ranges.length > 1) return tr;
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((from, to, _a, _b, ins) => changes.push({ from, to, insert: ins.toString() }));
    if (changes.length !== 1) return tr;
    const doc = st.doc;
    const c = trimChange(changes[0], doc.sliceString(changes[0].from, changes[0].to));
    if (!c) return tr;
    const startLine = doc.lineAt(c.from);
    const r = hiddenMarkerAt(st, startLine.number);
    const userEvent = tr.annotation(Transaction.userEvent);
    const spec = (ch: { from: number; to?: number; insert?: string }[], cursor: number): TransactionSpec => ({
      changes: ch,
      selection: EditorSelection.cursor(cursor),
      userEvent,
      scrollIntoView: tr.scrollIntoView,
    });
    if (!r) return tr;
    // 1 接行：删掉行尾的换行（下一行开头退格、行尾 Delete），下一行的字接到标记前面
    if (c.from === r.to && c.to === r.to + 1 && !c.insert && startLine.number < doc.lines) {
      const next = doc.line(startLine.number + 1);
      if (!next.text) return tr;
      return spec([{ from: r.from, insert: next.text }, { from: r.to, to: next.to }], r.from);
    }
    // 回车（插入以换行开头）落在标记前、只顺手删了标记前的空格（Obsidian 列表回车会这样）：换行放到标记后面，标记留在这一行行尾
    if (c.insert.startsWith("\n") && c.from >= r.from && c.to <= r.inner - 2) {
      return spec([{ from: r.to, insert: c.insert }], r.to + c.insert.length);
    }
    const overlaps = c.to > r.from && c.from < r.to;
    // 2 删除（或替换）范围碰到标记：整行连标记一起删照常；不然只删看得见的那部分
    if (c.to > c.from && overlaps) {
      if (c.from <= startLine.from && c.to >= r.to) return tr;
      const to = Math.min(c.to, r.from);
      if (to > c.from) return spec([{ from: c.from, to, insert: c.insert }], c.from + c.insert.length);
      // 只删到了标记（退格落在标记上、在标记前按 Delete）
      if (c.insert) return spec([{ from: r.from, insert: c.insert }], r.from + c.insert.length);
      if (tr.isUserEvent("delete.backward") && r.from > startLine.from) {
        const p = findClusterBreak(startLine.text, r.from - startLine.from, false) + startLine.from;
        return spec([{ from: p, to: r.from }], p);
      }
      return [];
    }
    // 3 在标记后面（行尾）插入：挪到标记前面
    if (c.from === c.to && c.from === r.to && c.insert && !c.insert.startsWith("\n")) {
      return spec([{ from: r.from, insert: c.insert }], r.from + c.insert.length);
    }
    return tr;
  });
}

export function markerGuards(active: (s: EditorState) => boolean): Extension {
  return [guardEdits(active), keepCursorBefore(active)];
}
