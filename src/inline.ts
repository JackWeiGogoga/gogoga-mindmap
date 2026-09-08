/**
 * 节点标签的行内 Markdown 渲染：粗体、斜体、行内代码、删除线、高亮、
 * wiki 链接、普通链接、任务复选框。只做一层，不嵌套；输出全部用 DOM API 构造，不拼 HTML。
 */

export interface InlineOptions {
  onLink?: (href: string, internal: boolean, ev: MouseEvent) => void;
  /** 鼠标悬停在内部链接上（Obsidian 用来弹页面预览） */
  onHover?: (href: string, ev: MouseEvent, el: HTMLElement) => void;
  /** 渲染 $…$ 公式，返回 null 则退回显示原文 */
  renderMath?: (tex: string) => HTMLElement | null;
  /** 把 ![[图片]] 或 ![alt](url) 解析成可用的 src，返回 null 则只显示文字 */
  resolveImage?: (link: string) => string | null;
  /** 图片加载完成（尺寸变了，需要重新布局） */
  onImageLoad?: () => void;
  /** 点了 #标签 */
  onTag?: (tag: string, ev: MouseEvent) => void;
  /** 点了任务复选框 */
  onTaskToggle?: (ev: MouseEvent) => void;
}

/** 可加在节点开头的标记（emoji，存在文字里，任何地方都能显示） */
export const MARKER_GROUPS: { name: string; emojis: string[]; exclusive: boolean }[] = [
  { name: "优先级", emojis: ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"], exclusive: true },
  { name: "进度", emojis: ["⏳", "✅", "❌"], exclusive: true },
  { name: "旗帜", emojis: ["🚩", "🟧", "🟨", "🟩", "🟦", "🟪"], exclusive: false },
  { name: "符号", emojis: ["⭐", "❗", "❓", "💡", "⚠️", "🔥", "❤️", "📌"], exclusive: false },
];
const ALL_MARKERS = MARKER_GROUPS.flatMap((g) => g.emojis);

/** 标签开头连续的标记 emoji 与其余文字 */
export function splitMarkers(text: string): { markers: string[]; rest: string } {
  const markers: string[] = [];
  let rest = text;
  for (;;) {
    const hit = ALL_MARKERS.find((m) => rest.startsWith(m));
    if (!hit) break;
    markers.push(hit);
    rest = rest.slice(hit.length).replace(/^\s+/, "");
  }
  return { markers, rest };
}

/** 切换一个标记：同组互斥的会替换，已有的会移除 */
export function toggleMarker(text: string, emoji: string): string {
  const { markers, rest } = splitMarkers(text);
  const group = MARKER_GROUPS.find((g) => g.emojis.includes(emoji));
  let next: string[];
  if (markers.includes(emoji)) next = markers.filter((m) => m !== emoji);
  else if (group?.exclusive) next = [...markers.filter((m) => !group.emojis.includes(m)), emoji];
  else next = [...markers, emoji];
  // 组内顺序固定：优先级、进度、旗帜、符号
  next.sort((a, b) => ALL_MARKERS.indexOf(a) - ALL_MARKERS.indexOf(b));
  return [...next, rest].filter(Boolean).join(" ");
}

const TASK_RE = /^\[( |x|X)\]\s+/;

/** 切换任务复选框：无 → [ ]，[ ] → [x]，[x] → 去掉 */
export function toggleTask(text: string, mode: "cycle" | "add-remove" = "cycle"): string {
  const { markers, rest } = splitMarkers(text);
  const m = TASK_RE.exec(rest);
  let body: string;
  if (!m) body = `[ ] ${rest}`;
  else if (mode === "add-remove" || m[1] !== " ") body = rest.slice(m[0].length);
  else body = `[x] ${rest.slice(m[0].length)}`;
  return [...markers, body].join(" ");
}

const WIKILINK_ONLY = /^\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/;

/** 标签整个就是一个 wiki 链接时，返回目标与别名 */
export function wikilinkOf(text: string): { target: string; alias?: string } | null {
  const m = WIKILINK_ONLY.exec(text);
  return m ? { target: m[1].trim(), alias: m[2]?.trim() } : null;
}

const TOKEN_RE =
  /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!\[([^\]]*)\]\(([^)\s]+)\)|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|~~(.+?)~~|==(.+?)==|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])|(?<![\w#&])#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/gu;

// 分组含义：1-2 ![[图片|参数]]  3-4 ![alt](url)  5 $公式$  6-7 [[链接|别名]]  8-9 [文字](url)
// 10-11 粗体  12 行内代码  13 删除线  14 高亮  15-16 斜体  17 #标签

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
  if (el.childElementCount === 0) {
    const { markers, rest: afterMarkers } = splitMarkers(rest);
    if (markers.length) {
      const span = document.createElement("span");
      span.className = "mm-markers";
      span.textContent = markers.join(" ");
      el.appendChild(span);
      rest = afterMarkers;
    }
  }
  const task = /^\[( |x|X)\]\s+/.exec(rest);
  if (task) {
    const box = document.createElement("span");
    box.className = "mm-task" + (task[1] === " " ? "" : " is-done");
    box.title = "点击切换";
    box.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    box.addEventListener("click", (ev) => {
      ev.stopPropagation();
      opts.onTaskToggle?.(ev);
    });
    el.appendChild(box);
    rest = rest.slice(task[0].length);
  }
  let last = 0;
  for (const m of rest.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) el.appendChild(document.createTextNode(rest.slice(last, idx)));
    last = idx + m[0].length;
    if (m[1] !== undefined) {
      el.appendChild(image(m[1], m[2], m[1], opts));
    } else if (m[3] !== undefined) {
      // Obsidian 的 Markdown 图片用 ![alt|宽度](url) 表示尺寸
      const [alt, param] = splitAltParam(m[3]);
      el.appendChild(image(m[4], param, alt, opts));
    } else if (m[5] !== undefined) {
      el.appendChild(math(m[5], opts));
    } else if (m[6] !== undefined) {
      el.appendChild(link(m[7] ?? m[6], m[6], true, opts));
    } else if (m[8] !== undefined) {
      el.appendChild(link(m[8], m[9], false, opts));
    } else if (m[10] !== undefined || m[11] !== undefined) {
      el.appendChild(wrap("strong", m[10] ?? m[11]));
    } else if (m[12] !== undefined) {
      el.appendChild(wrap("code", m[12]));
    } else if (m[13] !== undefined) {
      el.appendChild(wrap("del", m[13]));
    } else if (m[14] !== undefined) {
      el.appendChild(wrap("mark", m[14]));
    } else if (m[15] !== undefined || m[16] !== undefined) {
      el.appendChild(wrap("em", m[15] ?? m[16]));
    } else if (m[17] !== undefined) {
      el.appendChild(tag(m[17], opts));
    }
  }
  if (last < rest.length) el.appendChild(document.createTextNode(rest.slice(last)));
}

function math(tex: string, opts: InlineOptions): HTMLElement {
  const rendered = opts.renderMath?.(tex);
  if (rendered) {
    rendered.classList.add("mm-math");
    return rendered;
  }
  const code = wrap("code", `$${tex}$`);
  code.className = "mm-math-fallback";
  return code;
}

/** 图片节点允许的宽度范围（像素） */
export const IMAGE_MIN_WIDTH = 40;
export const IMAGE_MAX_WIDTH = 800;

function splitAltParam(alt: string): [string, string | undefined] {
  const i = alt.lastIndexOf("|");
  return i >= 0 ? [alt.slice(0, i), alt.slice(i + 1)] : [alt, undefined];
}

const IMG_WIKI_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
const IMG_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/;

/** 改写标签里第一张图片的宽度参数；width 为 null 则去掉参数 */
export function setImageWidth(text: string, width: number | null): string {
  const w = width === null ? null : Math.max(1, Math.round(width));
  const wiki = IMG_WIKI_RE.exec(text);
  const md = IMG_MD_RE.exec(text);
  const first = wiki && md ? (wiki.index <= md.index ? "wiki" : "md") : wiki ? "wiki" : md ? "md" : null;
  if (first === "wiki" && wiki) {
    const param = wiki[2];
    const keep = param && !/^\d+$/.test(param.trim()) ? param : undefined; // 非数字参数（别名）保留
    const parts = [wiki[1], ...(keep ? [keep] : []), ...(w !== null ? [String(w)] : [])];
    return text.slice(0, wiki.index) + `![[${parts.join("|")}]]` + text.slice(wiki.index + wiki[0].length);
  }
  if (first === "md" && md) {
    const [alt, param] = splitAltParam(md[1]);
    const keepAlt = param !== undefined && !/^\d+$/.test(param.trim()) ? md[1] : alt;
    const newAlt = w !== null ? `${keepAlt}|${w}` : keepAlt;
    return text.slice(0, md.index) + `![${newAlt}](${md[2]})` + text.slice(md.index + md[0].length);
  }
  return text;
}

/** 图片：`![[文件|宽度]]` 的参数若是数字就当宽度；解析不到就显示文字 */
function image(link: string, param: string | undefined, alt: string, opts: InlineOptions): HTMLElement {
  const src = opts.resolveImage ? opts.resolveImage(link) : /^https?:\/\//.test(link) ? link : null;
  if (!src) return wrap("span", alt || link);
  const img = document.createElement("img");
  img.className = "mm-img";
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  const width = param && /^\d+$/.test(param.trim()) ? Number(param) : null;
  if (width) {
    // 明确设了宽度就以它为准，不受默认缩略图上限约束
    img.style.width = `${Math.max(IMAGE_MIN_WIDTH, Math.min(IMAGE_MAX_WIDTH, width))}px`;
    img.classList.add("has-size");
  }
  img.addEventListener("load", () => opts.onImageLoad?.());
  img.addEventListener("error", () => {
    img.replaceWith(wrap("span", alt || link));
    opts.onImageLoad?.();
  });
  return img;
}

function tag(name: string, opts: InlineOptions): HTMLElement {
  const a = document.createElement("a");
  a.className = "tag mm-tag";
  a.textContent = `#${name}`;
  a.href = "#";
  a.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    opts.onTag?.(`#${name}`, ev);
  });
  return a;
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
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|~~(.+?)~~|==(.+?)==/g, (_, a, b, c, d, e) => a ?? b ?? c ?? d ?? e);
}
