import { parser, Strikethrough, type DelimiterType } from "@lezer/markdown";
import { colorSpans, type ColorSpan, type MarkupSpan } from "./color-source";

const highlight: DelimiterType = { resolve: "Highlight", mark: "HighlightMark" };
const inlineParser = parser.configure([Strikethrough, {
  defineNodes: ["Highlight", "HighlightMark", "WikiLink", "WikiMark"],
  parseInline: [{
    name: "Highlight",
    parse(cx, next, pos) {
      if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      return cx.addDelimiter(highlight, pos, pos + 2, !/\s|^$/.test(cx.slice(pos + 2, pos + 3)), !/\s|^$/.test(cx.slice(pos - 1, pos)));
    },
  }, {
    name: "WikiLink", before: "Link",
    parse(cx, next, pos) {
      if (next !== 91 || cx.char(pos + 1) !== 91 || cx.char(pos - 1) === 33) return -1;
      const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(cx.slice(pos, cx.end));
      if (!match) return -1;
      const to = pos + match[0].length;
      const openEnd = pos + (match[2] ? match[0].indexOf("|") + 1 : 2);
      return cx.addElement(cx.elt("WikiLink", pos, to, [cx.elt("WikiMark", pos, openEnd), cx.elt("WikiMark", to - 2, to)]));
    },
  }],
}]);

const classes: Record<string, string> = {
  StrongEmphasis: "mm-edit-bold", Emphasis: "mm-edit-italic", Strikethrough: "mm-edit-strike",
  Highlight: "mm-edit-highlight", InlineCode: "mm-edit-code", Link: "mm-edit-link", WikiLink: "mm-edit-link",
};

/** Parse syntax rather than guessing delimiter positions with regular expressions. */
export function markdownSpans(source: string): MarkupSpan[] {
  const spans: MarkupSpan[] = [];
  const tree = inlineParser.parse(source);
  tree.iterate({ enter(node) {
    if (/^(FencedCode|CodeBlock|HTMLBlock|Image)$/.test(node.name)) return false;
    const className = classes[node.name];
    if (!className) return;
    const first = node.node.firstChild;
    const last = node.node.lastChild;
    if (!first || !last || first === last) return;
    let closeStart = last.from;
    if (node.name === "Link") {
      // The closing label bracket starts the hidden destination, including its title.
      const labelEnd = first.nextSibling;
      let mark = labelEnd;
      while (mark && !(mark.name === "LinkMark" && source.slice(mark.from, mark.to) === "]")) mark = mark.nextSibling;
      if (!mark) return;
      closeStart = mark.from;
    }
    const span = { from: node.from, openEnd: first.to, closeStart, to: node.to, className };
    if (span.openEnd < span.closeStart) spans.push(span);
    if (node.name === "InlineCode" || node.name === "WikiLink") return false;
    return;
  } });
  return spans.sort((a, b) => a.from - b.from || b.to - a.to);
}

export interface RenderOptions { html: boolean; markdown: boolean }

export function editingSpans(source: string, options: RenderOptions): (MarkupSpan | ColorSpan)[] {
  const markdown = options.markdown ? markdownSpans(source) : [];
  // HTML attributes and link destinations are syntax, not Markdown content.
  const htmlTags = [...source.matchAll(/<[^>\n]*>/g)].map((m) => ({ from: m.index, to: m.index + m[0].length }));
  const visible = markdown.filter((s) => !htmlTags.some((tag) => s.from >= tag.from && s.from < tag.to)
    && !markdown.some((p) => p !== s && p.className === "mm-edit-link" && s.from >= p.closeStart && s.to <= p.to));
  return [...(options.html ? colorSpans(source) : []), ...visible];
}
