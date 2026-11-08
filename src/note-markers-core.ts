/**
 * 「笔记里的脑图节点标记」（缩成小圆点或完全隐藏）的核心（不碰 DOM，方便单测）。脑图笔记的实时预览里藏两种标记：
 * - 行尾的 %%…%%（节点颜色、折叠、id、关联线……）；
 * - 标题下面单独一行的 %%…%%（标题行保持干净，链接才对得上）：连同标题行尾的换行一起藏，看上去标题下面直接是正文，
 *   小圆点画在标题末尾。
 * 标记必须留在原处脑图才认（行尾的在行尾；标题的紧跟在标题下面），所以：
 * - 光标不停在藏着的标记后面：挪到前面，打字、输入法、粘贴都写在标记前面；从标记前往右走直接到下一行；
 * - 在标记前回车：换行放到标记后面；
 * - 退格、选中删只删看得见的字；在标记前按 Delete 不动；一行的字整个删掉（删整行）时连它的标记一起删；
 * - 在下一行开头退格接行：字接到标记前面（标题的就接到标题末尾）；
 * - 上下移动行：标题和它下面的标记行当成一个整体移动，别的行也不会被移到它们中间。
 * 光标进到标记里（点小圆点）就露出原文，可以手改；改动都在露出的标记里时不拦。不是脑图标记的普通注释不动
 */

import { EditorSelection, EditorState, type Extension, type Text, Transaction, type TransactionSpec, findClusterBreak } from "@codemirror/state";
import { fencedLines } from "./fence";
import { MARKER_RE, splitMarker } from "./markdown";

export interface MarkerRange {
  /** 藏起来的那段在文档里的开头、结尾（行尾标记：含前面的空格到行尾；标题的标记行：标题行尾到标记行尾） */
  from: number;
  to: number;
  /** 开头 %% 后面的位置：点小圆点时光标放这里 */
  inner: number;
  /** 这个标记属于哪一行（行尾标记是它自己那行，标记行是上面的标题）的行首 */
  owner: number;
  /** 标题下面单独一行的标记 */
  own: boolean;
}

const HEADING_LINE = /^#{1,6}(?:[ \t]|$)/;

/** 一行行尾有没有脑图认得的标记（只看这一行的文字） */
export function markerInLine(text: string, lineFrom: number): MarkerRange | null {
  if (!text.includes("%%")) return null;
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  if (splitMarker(text).text === text.trimEnd()) return null;
  const open = text.indexOf("%%", m.index);
  return { from: lineFrom + m.index, to: lineFrom + text.length, inner: lineFrom + open + 2, owner: lineFrom, own: false };
}

/** 第 n 行是不是标题下面单独一行的标记（上一行是标题） */
function ownMarkerLine(doc: Text, n: number): MarkerRange | null {
  if (n < 2) return null;
  const line = doc.line(n);
  const t = line.text;
  if (!t.trimStart().startsWith("%%") || splitMarker(t.trim()).text !== "") return null;
  const prev = doc.line(n - 1);
  if (!HEADING_LINE.test(prev.text)) return null;
  return { from: prev.to, to: line.to, inner: line.from + t.indexOf("%%") + 2, owner: prev.from, own: true };
}

/** 属于第 n 行的标记（它自己的行尾标记、下面一行的标记行），不管露没露、在不在代码块里 */
export function markersOfLine(doc: Text, n: number): MarkerRange[] {
  const out: MarkerRange[] = [];
  if (n < 1 || n > doc.lines) return out;
  if (!ownMarkerLine(doc, n)) {
    const line = doc.line(n);
    const r = markerInLine(line.text, line.from);
    if (r) out.push(r);
  }
  if (n < doc.lines) {
    const own = ownMarkerLine(doc, n + 1);
    if (own) out.push(own);
  }
  return out;
}

/** 光标、选区的一头在标记里面（不含两头）：露出原文 */
export function revealedMarker(r: MarkerRange, sel: EditorSelection): boolean {
  return sel.ranges.some((s) => (s.from > r.from && s.from < r.to) || (s.to > r.from && s.to < r.to));
}

function fenced(doc: Text, upTo: number): boolean[] {
  return fencedLines((i) => doc.line(i + 1).text, Math.min(upTo, doc.lines));
}

/** 第 n 行（和它前一行）上藏着的标记：不在代码块里、没露出来 */
export function hiddenAround(state: EditorState, n: number, sel: EditorSelection = state.selection): MarkerRange[] {
  const doc = state.doc;
  const skip = fenced(doc, Math.min(doc.lines, n + 1));
  const out: MarkerRange[] = [];
  for (const k of [n - 1, n]) {
    if (k < 1 || k > doc.lines || skip[k - 1]) continue;
    for (const r of markersOfLine(doc, k)) if (!revealedMarker(r, sel) && !skip[doc.lineAt(r.to).number - 1]) out.push(r);
  }
  return out;
}

/** 全文藏着的标记（显示用） */
export function allHidden(state: EditorState): MarkerRange[] {
  const doc = state.doc;
  const skip = fenced(doc, doc.lines);
  const out: MarkerRange[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (skip[n - 1]) continue;
    for (const r of markersOfLine(doc, n)) if (!skip[doc.lineAt(r.to).number - 1] && !revealedMarker(r, state.selection)) out.push(r);
  }
  return out;
}

/** 光标不停在藏着的标记后面：挪到标记前；从标记前往右走（落到标记后）就直接去下一行开头 */
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
    const r = hiddenAround(st, line.number, sel).find((x) => x.to === pos && x.from < x.to);
    if (!r) return tr;
    const prev = tr.startState.selection.main;
    const prevPos = tr.docChanged ? tr.changes.mapPos(prev.head, -1) : prev.head;
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
    if (!tr.docChanged || tr.isUserEvent("move") || !(tr.isUserEvent("delete") || tr.isUserEvent("input"))) return tr;
    const st = tr.startState;
    if (!active(st) || st.selection.ranges.length > 1) return tr;
    const raw: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((from, to, _a, _b, ins) => raw.push({ from, to, insert: ins.toString() }));
    if (raw.length !== 1) return tr;
    const doc = st.doc;
    const c = trimChange(raw[0], doc.sliceString(raw[0].from, raw[0].to));
    if (!c) return tr;
    const userEvent = tr.annotation(Transaction.userEvent);
    const spec = (ch: { from: number; to?: number; insert?: string }[], cursor: number): TransactionSpec => ({
      changes: ch,
      selection: EditorSelection.cursor(cursor),
      userEvent,
      scrollIntoView: tr.scrollIntoView,
    });
    const startLine = doc.lineAt(c.from);
    const cands = hiddenAround(st, startLine.number);
    for (const r of hiddenAround(st, doc.lineAt(c.to).number)) if (!cands.some((x) => x.from === r.from && x.to === r.to)) cands.push(r);
    for (const r of cands) {
      // 0 一行的文字整个删掉了（Obsidian 删整行会连前一行的换行一起删、删到行尾为止）：它的标记也删，
      // 不然标记会接到上一行末尾变成别的节点的，或者标题的标记行没了主
      // 只选中看得见的文字删（打算重写这一行）不算：要带上换行，或者一直选到行尾
      const wholeLine = c.from < r.owner || (r.own && c.to > r.from) || (c.from <= r.owner && c.to >= r.to);
      if (wholeLine && c.from < r.from && c.from <= r.owner && c.to >= r.from && c.to <= r.to && !c.insert) {
        const to = Math.min(doc.length, r.to + (r.own && c.to > r.from ? 1 : 0));
        return spec([{ from: c.from, to }], c.from);
      }
      // 1 接行：删掉标记后面的换行（下一行开头退格、标记后 Delete），下一行的字接到标记前面
      if (c.from === r.to && c.to === r.to + 1 && !c.insert && r.to < doc.length) {
        const next = doc.lineAt(r.to + 1);
        if (!next.text) return tr;
        // 下一行是带标记行的标题：接上来它的标记行就没主了，不接
        if (markersOfLine(doc, next.number).some((x) => x.own)) return [];
        return spec([{ from: r.from, insert: next.text }, { from: r.to, to: next.to }], r.from);
      }
      // 2 回车（插入以换行开头）落在标记前、最多顺手删了标记前的空格：换行放到标记后面
      if (c.insert.startsWith("\n") && c.from >= r.from && c.from <= r.from + (r.own ? 0 : r.inner - 2 - r.from) && c.to <= r.inner - 2) {
        return spec([{ from: r.to, insert: c.insert }], r.to + c.insert.length);
      }
      const overlaps = c.to > r.from && c.from < r.to;
      if (c.to > c.from && overlaps) {
        // 3a 从标记前面一直删过标记、删到下一行里（跨行选中删除）：标记整个没了，不会坏。
        // 只删到标记末尾（Shift+End 选到行尾再删）不算，那是只想删字
        if (c.from < r.from && c.to > r.to) return tr;
        // 3c 只删看得见的那部分
        const to = Math.min(c.to, r.from);
        if (to > c.from) return spec([{ from: c.from, to, insert: c.insert }], c.from + c.insert.length);
        if (c.insert) return spec([{ from: r.from, insert: c.insert }], r.from + c.insert.length);
        const ownerLine = doc.lineAt(r.owner);
        if (tr.isUserEvent("delete.backward") && r.from > ownerLine.from) {
          const p = findClusterBreak(ownerLine.text, r.from - ownerLine.from, false) + ownerLine.from;
          return spec([{ from: p, to: r.from }], p);
        }
        return [];
      }
      // 4 在标记后面插入（不是换行）：挪到标记前面
      if (c.from === c.to && c.from === r.to && c.insert && !c.insert.startsWith("\n")) {
        return spec([{ from: r.from, insert: c.insert }], r.from + c.insert.length);
      }
    }
    return tr;
  });
}

/** 上下移动行（userEvent move.line）：标题和它下面的标记行是一个整体，挪的时候一起走、也不让别的行插进中间 */
function keepUnitsOnMove(active: (s: EditorState) => boolean): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent("move.line")) return tr;
    const st = tr.startState;
    if (!active(st) || st.selection.ranges.length > 1) return tr;
    const doc = st.doc;
    const skip = fenced(doc, doc.lines);
    // 第 n 行所在的整体：[开始行, 结束行]
    const unit = (n: number): [number, number] => {
      if (!skip[n - 1] && n < doc.lines && !skip[n] && ownMarkerLine(doc, n + 1)) return [n, n + 1];
      if (!skip[n - 1] && ownMarkerLine(doc, n)) return [n - 1, n];
      return [n, n];
    };
    const sel = st.selection.main;
    const l1 = doc.lineAt(sel.from).number;
    const l2 = doc.lineAt(sel.to).number - (sel.to > sel.from && doc.lineAt(sel.to).from === sel.to ? 1 : 0);
    const start = unit(l1)[0];
    const end = unit(Math.max(l1, l2))[1];
    let up = false;
    tr.changes.iterChanges((from) => {
      if (from < doc.line(l1).from) up = true;
    });
    const nb = up ? (start > 1 ? unit(start - 1) : null) : end < doc.lines ? unit(end + 1) : null;
    if (!nb) return [];
    // 都是单行：编辑器自己的移动就对
    if (start === l1 && end === Math.max(l1, l2) && nb[0] === nb[1]) return tr;
    const text = (a: number, b: number) => doc.sliceString(doc.line(a).from, doc.line(b).to);
    const block = text(start, end);
    const other = text(nb[0], nb[1]);
    const from = doc.line(up ? nb[0] : start).from;
    const to = doc.line(up ? end : nb[1]).to;
    const insert = up ? `${block}\n${other}` : `${other}\n${block}`;
    const shift = up ? -(other.length + 1) : other.length + 1;
    return {
      changes: { from, to, insert },
      selection: EditorSelection.range(sel.anchor + shift, sel.head + shift),
      userEvent: "move.line",
      scrollIntoView: true,
    };
  });
}

export function markerGuards(active: (s: EditorState) => boolean): Extension {
  return [keepUnitsOnMove(active), guardEdits(active), keepCursorBefore(active)];
}
