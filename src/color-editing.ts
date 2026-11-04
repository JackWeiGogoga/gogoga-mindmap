import { Annotation, ChangeSet, EditorState, Extension, findClusterBreak, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { colorSpans, type ColorSpan } from "./color-source";

/** Explicit formatting/source commands may change tags; ordinary visual typing may not. */
export const colorSourceChange = Annotation.define<boolean>();

export interface ColorEditingOptions {
  enabled?: (state: EditorState) => boolean;
  exclude?: (state: EditorState, span: ColorSpan) => boolean;
}

export function visualColorSpans(state: EditorState, options: ColorEditingOptions = {}): ColorSpan[] {
  if (options.enabled && !options.enabled(state)) return [];
  return colorSpans(state.doc.toString()).filter((s) => !options.exclude?.(state, s));
}

/** Protect invisible delimiters when a visual selection crosses a color boundary. */
export function protectColorChanges(state: EditorState, changes: ChangeSet, spans: ColorSpan[], direction?: "backward" | "forward"): ChangeSet {
  const tags = spans.flatMap((s) => [{ from: s.from, to: s.openEnd }, { from: s.closeStart, to: s.to }]).sort((a, b) => a.from - b.from);
  const edits: { from: number; to: number; insert?: string }[] = [];
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const before = edits.length;
    let at = from;
    // Clicking beside a hidden delimiter must insert into the visible text, never into HTML.
    for (const tag of tags) if (at > tag.from && at < tag.to) at = tag.from;
    if (inserted.length) edits.push({ from: at, to: at, insert: inserted.toString() });
    let cursor = from;
    for (const tag of tags) {
      if (tag.to <= cursor || tag.from >= to) continue;
      if (cursor < tag.from) edits.push({ from: cursor, to: Math.min(tag.from, to) });
      cursor = Math.max(cursor, tag.to);
    }
    if (cursor < to) edits.push({ from: cursor, to });
    if (edits.length === before && direction && from < to) {
      let pos = direction === "backward" ? from : to;
      for (;;) {
        const tag = tags.find((t) => direction === "backward" ? t.from < pos && t.to >= pos : t.from <= pos && t.to > pos);
        if (!tag) break;
        pos = direction === "backward" ? tag.from : tag.to;
      }
      const end = findClusterBreak(state.doc.toString(), pos, direction === "forward");
      if (end !== pos) edits.push({ from: Math.min(pos, end), to: Math.max(pos, end) });
    }
  });
  let result = ChangeSet.of(edits.sort((a, b) => a.from - b.from || a.to - b.to), state.doc.length);
  let doc = result.apply(state.doc);
  for (;;) {
    const empty = colorSpans(doc.toString()).filter((s) => s.openEnd === s.closeStart);
    if (!empty.length) return result;
    const cleanup = ChangeSet.of(empty.map((s) => ({ from: s.from, to: s.to })), doc.length);
    result = result.compose(cleanup);
    doc = cleanup.apply(doc);
  }
}

export function colorEditing(options: ColorEditingOptions = {}): Extension {
  const build = (state: EditorState) => {
    const spans = visualColorSpans(state, options);
    const hidden = spans.flatMap((s) => [Decoration.replace({}).range(s.from, s.openEnd), Decoration.replace({}).range(s.closeStart, s.to)]);
    const ranges = spans.flatMap((s) => {
      const tags = [Decoration.replace({}).range(s.from, s.openEnd), Decoration.replace({}).range(s.closeStart, s.to)];
      if (s.openEnd < s.closeStart) tags.push(Decoration.mark({ attributes: { style: `${s.kind === "color" ? "color" : "background-color"}:${s.color}` } }).range(s.openEnd, s.closeStart));
      return tags;
    });
    return { spans, decorations: Decoration.set(ranges, true), atomic: Decoration.set(hidden, true) };
  };
  const preview = StateField.define<{ spans: ColorSpan[]; decorations: DecorationSet; atomic: DecorationSet }>({
    create: build,
    update: (value, tr) => {
      if (!tr.docChanged && !tr.reconfigured && !tr.effects.length && options.enabled?.(tr.startState) === options.enabled?.(tr.state)) return value;
      return build(tr.state);
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      // Only delimiters are atomic; the colored words remain editable.
      EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
    ],
  });
  return [preview, EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(colorSourceChange) || (!tr.isUserEvent("input") && !tr.isUserEvent("delete"))) return tr;
    const spans = tr.startState.field(preview).spans;
    if (!spans.length) return tr;
    const direction = tr.isUserEvent("delete.backward") ? "backward" : tr.isUserEvent("delete.forward") ? "forward" : undefined;
    const changes = protectColorChanges(tr.startState, tr.changes, spans, direction);
    if (changes.apply(tr.startState.doc).eq(tr.newDoc)) return tr;
    const mapping = tr.changes.invertedDesc.composeDesc(changes.desc);
    const event = tr.annotation(Transaction.userEvent);
    return { changes, selection: tr.newSelection.map(mapping), scrollIntoView: tr.scrollIntoView, annotations: event ? Transaction.userEvent.of(event) : [] };
  })];
}
