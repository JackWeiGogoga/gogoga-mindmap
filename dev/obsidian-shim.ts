/**
 * 调试页不在 Obsidian 里跑，补上 src/ 用到的那几个 Obsidian DOM 辅助函数（createEl / setCssStyles 等）。
 * 只实现用到的子集；必须在其它模块之前 import。
 */
type Info = { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null> };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info | string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const info: Info = typeof o === "string" ? { cls: o } : (o ?? {});
  if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  if (info.text !== undefined) el.textContent = info.text;
  for (const [k, v] of Object.entries(info.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, String(v));
  return el;
}

const g = globalThis as unknown as Record<string, unknown>;
g.createEl ??= make;
g.createDiv ??= (o?: Info | string) => make("div", o);
g.createSpan ??= (o?: Info | string) => make("span", o);
// This shim implements the Obsidian helpers themselves, so native DOM creation is required.
g.createSvg ??= (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag);

if (!("doc" in Node.prototype)) Object.defineProperty(Node.prototype, "doc", { get(this: Node) { return this.ownerDocument ?? this; } });
if (!("win" in Node.prototype)) Object.defineProperty(Node.prototype, "win", { get(this: Node) { return this.ownerDocument?.defaultView ?? window; } });
const html = HTMLElement.prototype as unknown as Record<string, unknown>;
html.createEl ??= function (this: HTMLElement, tag: keyof HTMLElementTagNameMap, info?: Info | string) {
  const child = make(tag, info);
  this.append(child);
  return child;
};
html.createDiv ??= function (this: HTMLElement, info?: Info | string) { const child = make("div", info); this.append(child); return child; };
html.createSpan ??= function (this: HTMLElement, info?: Info | string) { const child = make("span", info); this.append(child); return child; };
html.empty ??= function (this: HTMLElement) { this.replaceChildren(); };

for (const proto of [HTMLElement.prototype, SVGElement.prototype] as unknown as Record<string, unknown>[]) {
  proto.setCssStyles ??= function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  };
  proto.setCssProps ??= function (this: HTMLElement, props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
  };
}

// Obsidian 用 body 上的类标出平台，快捷键提示据此显示 ⌘ 还是 Ctrl
document.body.classList.add("mod-macos");
