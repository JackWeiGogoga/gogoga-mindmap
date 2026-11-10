/**
 * 选中文字时浮出的格式栏（加粗、斜体、删除线、下划线、高亮、常用文字颜色、荧光笔颜色、清除）。
 * 脑图的节点编辑框和 Markdown 笔记的实时预览共用这一个，按钮、颜色、写进文件的格式都一样
 */

import { highlightOf, type InlineFormat } from "./format";
import { t } from "./i18n";

/** 格式栏、命令里的一个颜色：荧光笔颜色表里的 🔴 之类写成 Obsidian 的 ==🔴文字==，其余照旧写颜色标签 */
export function highlightFormat(kind: "color" | "bg", color: string): InlineFormat {
  const hl = kind === "bg" ? highlightOf(color) : null;
  return hl ? { kind: "highlight", color: hl } : { kind, color };
}

export interface FormatBarOptions {
  textColors: string[];
  highlightColors: string[];
  /** 下划线的快捷键说明，比如 ⌘U */
  underlineKey: string;
  icon: (name: "highlighter" | "eraser" | "link") => HTMLElement;
  tip: (el: HTMLElement, text: string) => void;
  onFormat: (fmt: InlineFormat) => void;
  /** 选中的字做成笔记链接（给了才有这个按钮）；linkKey 是快捷键说明，比如 ⌘K */
  onLink?: () => void;
  linkKey?: string;
}

/** 造一个格式栏（还没挂到页面上）。按下按钮不会让编辑器失焦，选区留着 */
export function createFormatBar(doc: Document, o: FormatBarOptions): HTMLElement {
  const bar = doc.createElement("div");
  bar.className = "mm-format-bar";
  bar.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  bar.addEventListener("mousedown", (ev) => ev.preventDefault());
  const btn = (cls: string, title: string, fmt: InlineFormat, fill?: (b: HTMLButtonElement) => void) => {
    const b = doc.createElement("button");
    b.className = `mm-format-btn ${cls}`;
    b.type = "button";
    b.setAttribute("aria-label", title);
    o.tip(b, title);
    fill?.(b);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      o.onFormat(fmt);
    });
    bar.append(b);
    return b;
  };
  const sep = () => {
    const s = doc.createElement("span");
    s.className = "mm-format-sep";
    bar.append(s);
  };
  btn("is-bold", t("format.bold"), { kind: "bold" }, (b) => (b.textContent = "B"));
  btn("is-italic", t("format.italic"), { kind: "italic" }, (b) => (b.textContent = "I"));
  btn("is-strike", t("format.strike"), { kind: "strike" }, (b) => (b.textContent = "S"));
  btn("is-underline", t("format.underline", { key: o.underlineKey }), { kind: "underline" }, (b) => (b.textContent = "U"));
  btn("is-highlight", t("format.highlight"), { kind: "highlight" }, (b) => b.append(o.icon("highlighter")));
  if (o.textColors.length) sep();
  for (const c of o.textColors)
    btn("is-color", t("format.textColor", { color: c }), { kind: "color", color: c }, (b) => {
      b.textContent = "A";
      b.style.color = c;
    });
  if (o.highlightColors.length) sep();
  for (const c of o.highlightColors)
    btn("is-bg", t("format.highlightColor", { color: c }), highlightFormat("bg", c), (b) => {
      b.textContent = "A";
      // Obsidian 的彩色高亮用主题里的颜色，样式表按 data-highlight 上色
      const hl = highlightOf(c);
      if (hl) b.dataset.highlight = hl;
      else b.style.background = c;
    });
  sep();
  if (o.onLink) {
    const onLink = o.onLink;
    const b = doc.createElement("button");
    b.className = "mm-format-btn is-link";
    b.type = "button";
    const title = t("format.link", { key: o.linkKey ?? "" });
    b.setAttribute("aria-label", title);
    o.tip(b, title);
    b.append(o.icon("link"));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onLink();
    });
    bar.append(b);
  }
  btn("is-clear", t("format.clear"), { kind: "clear" }, (b) => b.append(o.icon("eraser")));
  return bar;
}
