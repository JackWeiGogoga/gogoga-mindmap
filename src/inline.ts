/**
 * 节点标签的行内 Markdown 渲染：粗体、斜体、行内代码、删除线、高亮、
 * wiki 链接、普通链接、任务复选框。只做一层，不嵌套；输出全部用 DOM API 构造，不拼 HTML。
 */

export interface InlineOptions {
  onLink?: (href: string, internal: boolean, ev: MouseEvent) => void;
  /** 鼠标悬停在内部链接上（Obsidian 用来弹页面预览） */
  onHover?: (href: string, ev: MouseEvent, el: HTMLElement) => void;
}

const WIKILINK_ONLY = /^\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/;

/** 标签整个就是一个 wiki 链接时，返回目标与别名 */
export function wikilinkOf(text: string): { target: string; alias?: string } | null {
  const m = WIKILINK_ONLY.exec(text);
  return m ? { target: m[1].trim(), alias: m[2]?.trim() } : null;
}

const TOKEN_RE =
  /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|~~(.+?)~~|==(.+?)==|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])/g;

const BR_RE = /<br\s*\/?>/i;

/** 节点标签里的 <br> 是多行文本的存储形式（标题里放不下真正的换行） */
export function renderInline(el: HTMLElement, text: string, opts: InlineOptions = {}): void {
  el.textContent = "";
  const segments = text.split(BR_RE);
  segments.forEach((seg, i) => {
    if (i > 0) el.appendChild(document.createElement("br"));
    renderSegment(el, seg, opts);
  });
}

function renderSegment(el: HTMLElement, text: string, opts: InlineOptions): void {
  let rest = text;
  const task = /^\[( |x|X)\]\s+/.exec(rest);
  if (task) {
    const box = document.createElement("span");
    box.className = "mm-task" + (task[1] === " " ? "" : " is-done");
    el.appendChild(box);
    rest = rest.slice(task[0].length);
  }
  let last = 0;
  for (const m of rest.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) el.appendChild(document.createTextNode(rest.slice(last, idx)));
    last = idx + m[0].length;
    if (m[1] !== undefined) {
      el.appendChild(link(m[2] ?? m[1], m[1], true, opts));
    } else if (m[3] !== undefined) {
      el.appendChild(link(m[3], m[4], false, opts));
    } else if (m[5] !== undefined || m[6] !== undefined) {
      el.appendChild(wrap("strong", m[5] ?? m[6]));
    } else if (m[7] !== undefined) {
      el.appendChild(wrap("code", m[7]));
    } else if (m[8] !== undefined) {
      el.appendChild(wrap("del", m[8]));
    } else if (m[9] !== undefined) {
      el.appendChild(wrap("mark", m[9]));
    } else if (m[10] !== undefined || m[11] !== undefined) {
      el.appendChild(wrap("em", m[10] ?? m[11]));
    }
  }
  if (last < rest.length) el.appendChild(document.createTextNode(rest.slice(last)));
}

function wrap(tag: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function link(label: string, href: string, internal: boolean, opts: InlineOptions): HTMLElement {
  const a = document.createElement("a");
  a.textContent = label;
  a.className = internal ? "internal-link mm-link" : "external-link mm-link";
  a.setAttribute("data-href", href);
  a.href = internal ? "#" : href;
  if (!internal) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    opts.onLink?.(href, internal, ev);
  });
  if (internal && opts.onHover) a.addEventListener("mouseover", (ev) => opts.onHover?.(href, ev, a));
  return a;
}

/** 编辑框里的换行 ⇄ 存储用的 <br> */
export function toEditableText(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n");
}
export function fromEditableText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("<br>");
}

/** 节点标签的纯文本版本，用于测量和搜索 */
export function plainText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|~~(.+?)~~|==(.+?)==/g, (_, a, b, c, d, e) => a ?? b ?? c ?? d ?? e);
}
