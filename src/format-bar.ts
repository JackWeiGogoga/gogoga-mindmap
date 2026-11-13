/**
 * 选中文字时浮出的格式栏（加粗、斜体、删除线、下划线、高亮、常用文字颜色、荧光笔颜色、清除）。
 * 脑图的节点编辑框和 Markdown 笔记的实时预览共用这一个，按钮、颜色、写进文件的格式都一样
 */

import { type ColorKind, type ColorMemory, colorFormat, createColorSplit, createPalette, paintColor, refreshColorSplit, THEME_HIGHLIGHT } from "./color-palette";

export { colorFormat, highlightFormat } from "./color-palette";
import { type InlineFormat } from "./format";
import { paletteText, t } from "./i18n";

/** 颜色的说明：🔴 这些和主题高亮用文字，其余就是色值 */
export function colorTitle(color: string): string {
  return color === THEME_HIGHLIGHT ? t("palette.themeHighlight") : color;
}

export interface FormatBarOptions {
  textColors: string[];
  highlightColors: string[];
  /** 下划线的快捷键说明，比如 ⌘U */
  underlineKey: string;
  icon: (name: "highlighter" | "eraser" | "link" | "split") => HTMLElement;
  tip: (el: HTMLElement, text: string) => void;
  onFormat: (fmt: InlineFormat) => void;
  /** 上次用的颜色、最近使用（插件存在设置里）；不给就只记在这个格式栏里 */
  memory?: ColorMemory;
  /** 色板里点「自定义…」：系统取色器会让编辑器失焦，宿主先记下要上色的地方，返回之后上格式用的函数 */
  onCustom?: () => (fmt: InlineFormat) => void;
  /** 选中的字做成笔记链接（给了才有这个按钮）；linkKey 是快捷键说明，比如 ⌘K */
  onLink?: () => void;
  linkKey?: string;
  /** 「拆分」按钮的下拉：几种拆分方式（给了才有这个按钮） */
  split?: { title: string; items: { label: string; run: () => void }[] };
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
  sep();
  // 文字颜色、荧光笔：左半边套用上次的颜色，▾ 打开色板（和节点浮动工具栏一样）
  const local: Record<string, string> = {};
  const mem: ColorMemory = o.memory ?? {
    last: (k) => local[k] ?? null,
    recent: () => [],
    remember: (k, c) => (local[k] = c),
  };
  const common = (kind: "text" | "bg") => (kind === "text" ? o.textColors : o.highlightColors);
  const current = (kind: "text" | "bg") => mem.last(kind) ?? common(kind)[0] ?? (kind === "bg" ? THEME_HIGHLIGHT : null);
  let open: { kind: ColorKind | "split"; el: HTMLElement } | null = null;
  const closePalette = () => {
    open?.el.remove();
    open = null;
  };
  const split = (kind: "text" | "bg") => {
    const el = createColorSplit({
      doc,
      cls: kind === "text" ? "is-text-color" : "is-highlighter",
      title: kind === "text" ? t("bar.textColor") : t("bar.highlight"),
      caretTitle: kind === "text" ? t("palette.textMore") : t("palette.bgMore"),
      face: (f) => {
        if (kind === "text") f.textContent = "A";
        else f.append(o.icon("highlighter"));
      },
      current: () => current(kind),
      paintBar: (b, c) => paintColor(b, c, kind),
      tip: o.tip,
      onApply: () => {
        const c = current(kind);
        if (!c) return;
        closePalette();
        o.onFormat(colorFormat(kind, c));
      },
      onOpen: (anchor) => {
        if (open?.kind === kind) {
          closePalette();
          return;
        }
        closePalette();
        const pick = (c: string | null, apply: (fmt: InlineFormat) => void = o.onFormat) => {
          closePalette();
          if (c !== null) mem.remember(kind, c);
          refreshColorSplit(anchor);
          apply(colorFormat(kind, c));
        };
        const pal = createPalette(doc, {
          text: paletteText(),
          common: common(kind),
          recent: mem.recent(kind),
          alpha: true,
          defaultAlpha: kind === "text" ? 100 : 60,
          paint: (b, c) => paintColor(b, c, kind),
          label: colorTitle,
          noneLabel: kind === "text" ? t("palette.noText") : t("palette.noHighlight"),
          extras:
            kind === "bg" && !common("bg").includes(THEME_HIGHLIGHT)
              ? [{ value: THEME_HIGHLIGHT, label: t("palette.themeHighlight"), paint: (b) => paintColor(b, THEME_HIGHLIGHT, "bg") }]
              : [],
          onPick: (c) => pick(c),
          onCustom: () => {
            const apply = o.onCustom?.() ?? o.onFormat;
            return (c) => pick(c, apply);
          },
          tip: o.tip,
        });
        pal.classList.add("mm-format-palette");
        bar.append(pal);
        pal.style.left = `${Math.max(0, anchor.offsetLeft)}px`;
        open = { kind, el: pal };
      },
    });
    bar.append(el);
  };
  split("text");
  split("bg");
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
  // 拆分：点开是一列拆分方式（和右键「拆成子节点」的二级菜单一样），选一种就把选中的文字拆成子节点
  if (o.split?.items.length) {
    const split = o.split;
    sep();
    const b = doc.createElement("button");
    b.className = "mm-format-btn is-split";
    b.type = "button";
    b.setAttribute("aria-label", split.title);
    o.tip(b, split.title);
    b.append(o.icon("split"));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (open?.kind === "split") return closePalette();
      closePalette();
      const menu = doc.createElement("div");
      menu.className = "mm-palette mm-format-palette mm-split-menu";
      menu.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      menu.addEventListener("mousedown", (e) => e.preventDefault());
      for (const it of split.items) {
        const item = doc.createElement("button");
        item.type = "button";
        item.className = "mm-split-item";
        item.textContent = it.label;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          closePalette();
          it.run();
        });
        menu.append(item);
      }
      bar.append(menu);
      menu.style.left = `${Math.max(0, b.offsetLeft)}px`;
      open = { kind: "split", el: menu };
    });
    bar.append(b);
  }
  return bar;
}
