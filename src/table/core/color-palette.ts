/**
 * 颜色的「按钮 + 下拉」和下拉打开的色板。节点浮动工具栏、格式栏（脑图编辑框和笔记里）、设置页共用：
 * 文字颜色、荧光笔点左半边直接用色条上的颜色（上次用的），点 ▾ 打开色板：常用（设置里的）、色块网格、最近使用、
 * 透明度、自定义（系统取色器）。按下色板里的东西不让编辑器失焦（pointerdown / mousedown 都 preventDefault），
 * 所以透明度是自己画的滑块，不用 <input type="range">（它要拿焦点才能拖）
 *
 * gogoga Mind Map 和 gogoga Table 共用（源头在脑图，scripts/sync-table.mjs 复制到表格的 src/core/）：
 * 这里不引用哪一边的翻译，界面上的字由调用方在 PaletteOptions.text 里给
 */

import { highlightOf, type InlineFormat } from "./format";

/** 三种颜色：文字颜色、荧光笔、节点颜色 */
export type ColorKind = "text" | "bg" | "node";

/** 「按钮 + 下拉」记住的颜色：上次用的（色条上那个）和最近使用；插件存在设置里 */
export interface ColorMemory {
  last(kind: ColorKind): string | null;
  recent(kind: ColorKind): string[];
  remember(kind: ColorKind, color: string): void;
}

/** 荧光笔颜色表里表示 Obsidian 普通 ==高亮== 的那一项 */
export const THEME_HIGHLIGHT = "==";

/** 格式栏、命令里的一个颜色：荧光笔颜色表里的 🔴 之类写成 Obsidian 的 ==🔴文字==，其余照旧写颜色标签 */
export function highlightFormat(kind: "color" | "bg", color: string): InlineFormat {
  if (kind === "bg" && color === THEME_HIGHLIGHT) return { kind: "highlight" };
  const hl = kind === "bg" ? highlightOf(color) : null;
  return hl ? { kind: "highlight", color: hl } : { kind, color };
}

/** 颜色下拉选了一个颜色（null = 去掉）要上的格式 */
export function colorFormat(kind: "text" | "bg", color: string | null): InlineFormat {
  if (color === null) return { kind: kind === "text" ? "nocolor" : "nobg" };
  return highlightFormat(kind === "text" ? "color" : "bg", color);
}

/**
 * 给色块 / 色条上色：🔴 这些和 ==（主题高亮）按 Obsidian 主题的高亮色，节点颜色的颜色名按脑图主题，其余直接用颜色值
 */
export function paintColor(el: HTMLElement, color: string | null, kind: ColorKind): void {
  el.classList.remove("mm-hl-chip");
  delete el.dataset.highlight;
  el.style.removeProperty("background");
  if (!color) return;
  const hl = color === THEME_HIGHLIGHT ? "" : highlightOf(color);
  if (hl !== null) {
    el.classList.add("mm-hl-chip");
    if (hl) el.dataset.highlight = hl;
    return;
  }
  el.style.background = kind === "node" && /^[a-z]+$/i.test(color) ? `var(--mm-c-${color}, ${color})` : color;
}

/** 色块网格：每列一种色相，从上到下由浅到深；最后两列是灰度 */
const GRID: string[][] = [
  ["#fde2e2", "#f9b4b4", "#f07070", "#e03e3e", "#b42b2b", "#7a1d1d"],
  ["#ffe8cc", "#ffc78a", "#ff9f43", "#f08c00", "#c06a00", "#7f4700"],
  ["#fff3bf", "#ffe066", "#ffd43b", "#fab005", "#c99400", "#806000"],
  ["#d3f9d8", "#8ce99a", "#51cf66", "#27ae60", "#1e7d45", "#12502c"],
  ["#c3fae8", "#63e6be", "#20c997", "#0ca678", "#087f5b", "#054c37"],
  ["#d0ebff", "#74c0fc", "#339af0", "#2f80ed", "#1864ab", "#0b3d6e"],
  ["#e5dbff", "#b197fc", "#845ef7", "#7048e8", "#5235b5", "#33206f"],
  ["#ffdeeb", "#faa2c1", "#f06595", "#d6336c", "#a61e4d", "#6b1132"],
  ["#f1f3f5", "#ced4da", "#adb5bd", "#868e96", "#495057", "#212529"],
  ["#ffffff", "#e9ecef", "#9aa0a6", "#5f6368", "#3c4043", "#000000"],
];
export const PALETTE_GRID: readonly (readonly string[])[] = GRID;

/** 最近使用最多记几个 */
export const RECENT_MAX = 8;

/** #rgb / #rrggbb 加上透明度（0–100）：100 原样返回 6 位，其余写成 8 位 #rrggbbaa */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace(/^#/, "").toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/.test(h)) return hex;
  const a = Math.max(0, Math.min(100, Math.round(alpha)));
  return a >= 100 ? `#${h}` : `#${h}${Math.round((a * 255) / 100).toString(16).padStart(2, "0")}`;
}

/** #rrggbbaa 的透明度（0–100）；不是十六进制或没有透明度给 null */
export function alphaOf(color: string): number | null {
  const m = /^#([0-9a-f]{8}|[0-9a-f]{4})$/i.exec(color);
  if (!m) return null;
  const a = m[1].length === 8 ? parseInt(m[1].slice(6), 16) : parseInt(m[1][3] + m[1][3], 16);
  return Math.round((a * 100) / 255);
}

/** 记一个最近用过的颜色：放到最前，去重，最多 RECENT_MAX 个 */
export function pushRecent(list: readonly string[], color: string): string[] {
  const c = color.toLowerCase();
  return [color, ...list.filter((x) => x.toLowerCase() !== c)].slice(0, RECENT_MAX);
}

/** 色板上的几处文字（各插件按自己的语言给） */
export interface PaletteText {
  common: string;
  recent: string;
  alpha: string;
  custom: string;
}

export interface PaletteOptions {
  text: PaletteText;
  /** 常用：设置里配的颜色（十六进制、颜色名、🔴 之类都可能有），原样交回 onPick */
  common: readonly string[];
  recent: readonly string[];
  /** 显示透明度滑块 */
  alpha: boolean;
  /** 透明度的初始值（0–100） */
  defaultAlpha: number;
  /** 画一个常用 / 最近使用的色块（颜色名、🔴 这些要按主题上色） */
  paint: (el: HTMLElement, color: string) => void;
  /** 色块的说明文字 */
  label: (color: string) => string;
  /** 「无颜色」的说明 */
  noneLabel: string;
  /** 常用那一排最前面再放的几个特殊项（比如荧光笔的「主题高亮」），点了原样交回 onPick */
  extras?: { value: string; label: string; paint: (el: HTMLElement) => void }[];
  onPick: (color: string | null) => void;
  /** 点「自定义…」：系统取色器会让编辑器失焦，先记下要上色的地方，返回选好颜色后用来上色的函数；不给就用 onPick */
  onCustom?: () => (color: string) => void;
  tip?: (el: HTMLElement, text: string) => void;
}

/** 造一块色板（还没挂到页面上） */
export function createPalette(doc: Document, o: PaletteOptions): HTMLElement {
  const root = doc.createElement("div");
  root.className = "mm-palette";
  // 按下色板里的任何东西都不让编辑器失焦、选区留着
  root.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  root.addEventListener("mousedown", (ev) => ev.preventDefault());
  let alpha = o.defaultAlpha;
  const preview = doc.createElement("span");
  preview.className = "mm-palette-preview";
  const hexOut = doc.createElement("span");
  hexOut.className = "mm-palette-hex";
  const show = (c: string | null) => {
    preview.style.background = c ?? "transparent";
    hexOut.textContent = c ?? "";
  };
  const swatch = (parent: HTMLElement, title: string, paint: (el: HTMLElement) => void, pick: () => void, hover?: () => string | null) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "mm-palette-swatch";
    b.setAttribute("aria-label", title);
    o.tip?.(b, title);
    paint(b);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      pick();
    });
    if (hover) b.addEventListener("pointerenter", () => show(hover()));
    parent.append(b);
    return b;
  };
  const section = (title: string) => {
    const h = doc.createElement("div");
    h.className = "mm-palette-title";
    h.textContent = title;
    root.append(h);
    const row = doc.createElement("div");
    row.className = "mm-palette-row";
    root.append(row);
    return row;
  };
  // 常用：无颜色 + 特殊项 + 设置里的
  const common = section(o.text.common);
  swatch(common, o.noneLabel, (b) => b.classList.add("is-none"), () => o.onPick(null));
  for (const x of o.extras ?? []) swatch(common, x.label, x.paint, () => o.onPick(x.value));
  for (const c of o.common) swatch(common, o.label(c), (b) => o.paint(b, c), () => o.onPick(c), () => c);
  // 网格
  const grid = doc.createElement("div");
  grid.className = "mm-palette-grid";
  root.append(grid);
  for (let r = 0; r < GRID[0].length; r++)
    for (const col of GRID) {
      const c = col[r];
      swatch(
        grid,
        c,
        (b) => (b.style.background = c),
        () => o.onPick(o.alpha ? withAlpha(c, alpha) : c),
        () => (o.alpha ? withAlpha(c, alpha) : c),
      );
    }
  // 最近使用
  if (o.recent.length) {
    const recent = section(o.text.recent);
    for (const c of o.recent) swatch(recent, o.label(c), (b) => o.paint(b, c), () => o.onPick(c), () => c);
  }
  // 透明度：自己画的滑块（不拿焦点）
  if (o.alpha) {
    const line = doc.createElement("div");
    line.className = "mm-palette-alpha";
    const name = doc.createElement("span");
    name.textContent = o.text.alpha;
    const track = doc.createElement("div");
    track.className = "mm-palette-track";
    const fill = doc.createElement("div");
    fill.className = "mm-palette-fill";
    const thumb = doc.createElement("div");
    thumb.className = "mm-palette-thumb";
    track.append(fill, thumb);
    const val = doc.createElement("span");
    val.className = "mm-palette-alpha-val";
    const set = (a: number) => {
      alpha = Math.max(0, Math.min(100, Math.round(a)));
      fill.style.width = `${alpha}%`;
      thumb.style.left = `${alpha}%`;
      val.textContent = `${alpha}%`;
    };
    set(alpha);
    const at = (ev: PointerEvent) => {
      const r = track.getBoundingClientRect();
      set(((ev.clientX - r.left) / Math.max(1, r.width)) * 100);
    };
    track.addEventListener("pointerdown", (ev) => {
      at(ev);
      try {
        track.setPointerCapture(ev.pointerId);
      } catch {
        // 合成事件没有活动指针
      }
      const move = (e: PointerEvent) => at(e);
      const up = () => {
        track.removeEventListener("pointermove", move);
        track.removeEventListener("pointerup", up);
        track.removeEventListener("pointercancel", up);
      };
      track.addEventListener("pointermove", move);
      track.addEventListener("pointerup", up);
      track.addEventListener("pointercancel", up);
    });
    line.append(name, track, val);
    root.append(line);
  }
  // 底部：预览 + 色值 + 自定义
  const foot = doc.createElement("div");
  foot.className = "mm-palette-foot";
  const left = doc.createElement("span");
  left.className = "mm-palette-current";
  left.append(preview, hexOut);
  const custom = doc.createElement("button");
  custom.type = "button";
  custom.className = "mm-palette-custom";
  custom.textContent = o.text.custom;
  custom.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const apply = o.onCustom?.() ?? ((c: string) => o.onPick(c));
    // 取色器的输入框挂在 body 上：选颜色时编辑器可能已经失焦、色板跟着关掉，输入框还得在
    const input = doc.createElement("input");
    input.type = "color";
    input.className = "mm-palette-native";
    doc.body.append(input);
    const done = () => {
      input.remove();
    };
    input.addEventListener("change", () => {
      apply(o.alpha ? withAlpha(input.value, alpha) : input.value);
      done();
    });
    input.addEventListener("blur", () => (doc.defaultView ?? window).setTimeout(done, 1000));
    input.click();
  });
  foot.append(left, custom);
  root.append(foot);
  show(null);
  return root;
}

export interface ColorSplitOptions {
  cls: string;
  title: string;
  caretTitle: string;
  /** 左半边的字或图标 */
  face: (el: HTMLElement) => void;
  /** 色条的颜色：上次用的（没有就是常用的第一个） */
  current: () => string | null;
  /** 给色条上色（颜色名、🔴 要按主题上色） */
  paintBar: (el: HTMLElement, color: string | null) => void;
  onApply: () => void;
  onOpen: (anchor: HTMLElement) => void;
  tip: (el: HTMLElement, text: string) => void;
  /** 两半是按钮还是能拿焦点的；默认 button */
  doc: Document;
}

/** 「按钮 + 下拉」：左半边套用色条上的颜色，右半边 ▾ 打开色板 */
export function createColorSplit(o: ColorSplitOptions): HTMLElement {
  const doc = o.doc;
  const wrap = doc.createElement("span");
  wrap.className = `mm-color-split ${o.cls}`;
  const main = doc.createElement("button");
  main.type = "button";
  main.className = "mm-color-split-main";
  main.setAttribute("aria-label", o.title);
  o.tip(main, o.title);
  const face = doc.createElement("span");
  face.className = "mm-color-split-face";
  o.face(face);
  const bar = doc.createElement("span");
  bar.className = "mm-color-split-bar";
  main.append(face, bar);
  const caret = doc.createElement("button");
  caret.type = "button";
  caret.className = "mm-color-split-caret";
  caret.setAttribute("aria-label", o.caretTitle);
  o.tip(caret, o.caretTitle);
  caret.textContent = "▾";
  const refresh = () => o.paintBar(bar, o.current());
  refresh();
  main.addEventListener("click", (ev) => {
    ev.stopPropagation();
    o.onApply();
    refresh();
  });
  caret.addEventListener("click", (ev) => {
    ev.stopPropagation();
    o.onOpen(wrap);
  });
  (wrap as HTMLElement & { refreshColor?: () => void }).refreshColor = refresh;
  wrap.append(main, caret);
  return wrap;
}

/** 刷新一个「按钮 + 下拉」色条上的颜色（选了新颜色以后） */
export function refreshColorSplit(el: Element | null | undefined): void {
  (el as (HTMLElement & { refreshColor?: () => void }) | null)?.refreshColor?.();
}
