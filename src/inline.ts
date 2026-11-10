/**
 * 节点标签的行内 Markdown 渲染：粗体、斜体、行内代码、删除线、高亮、
 * wiki 链接、普通链接、任务复选框、局部颜色。粗体、斜体、删除线、高亮和颜色里面可以再套格式；
 * 输出全部用 DOM API 构造，不拼 HTML。
 */

import { highlightColor } from "./format";
import { t } from "./i18n";
import { TOKEN_RE } from "./tokens";
import { formatSpans } from "./live-preview";

export { TOKEN_RE };

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
  /**
   * PDF 截区 `![[文件.pdf#page=…&rect=…]]`：交给宿主渲染（PDF++ 画出裁切后的图），画好的图片交回 onImage。
   * 宿主画不了（没装 PDF++）返回 false，退回成指向那一页的链接
   */
  renderPdfCrop?: (link: string, el: HTMLElement, onImage: (img: HTMLImageElement) => void) => boolean;
  /** 点了 #标签 */
  onTag?: (tag: string, ev: MouseEvent) => void;
  /** 点了任务复选框 */
  onTaskToggle?: (ev: MouseEvent) => void;
  /**
   * 取回这个节点上已经建好的 iframe。iframe 一旦从 DOM 里摘下来再插回去就会重新加载，
   * 所以视频这类内容必须复用同一个元素，不能每次重渲染都新建。
   */
  reuseFrame?: (src: string) => HTMLIFrameElement | null;
}

/** 答案标记：背诵模式下带它的节点连同子树整个遮住，点一下揭开；截图题、文字题都能用 */
export const ANSWER_MARKER = "🙈";
/** 可加在节点开头的标记（emoji，存在文字里，任何地方都能显示） */
/** name 是界面上的分组名，用 getter 在用到时才查字典；emoji 本身是数据，不翻译 */
export const MARKER_GROUPS: { readonly name: string; emojis: string[]; exclusive: boolean }[] = [
  { get name() { return t("marker.priority"); }, emojis: ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"], exclusive: true },
  { get name() { return t("marker.progress"); }, emojis: ["⏳", "✅", "❌"], exclusive: true },
  { get name() { return t("marker.flags"); }, emojis: ["🚩", "🟧", "🟨", "🟩", "🟦", "🟪"], exclusive: false },
  { get name() { return t("marker.symbols"); }, emojis: ["⭐", "❗", "❓", "💡", "⚠️", "🔥", "❤️", "📌"], exclusive: false },
  { get name() { return t("marker.recite"); }, emojis: [ANSWER_MARKER], exclusive: false },
];
const BUILTIN_GROUPS = MARKER_GROUPS.length;
let ALL_MARKERS = MARKER_GROUPS.flatMap((g) => g.emojis);

/**
 * 设置里填的自定义标记：一个字形一个标记，只认 emoji 和非 ASCII 的符号。
 * 字母、数字、ASCII 符号不行：它们出现在节点开头再正常不过（「A 方案」「# 标题」），会被误当成标记
 */
export function parseCustomMarkers(input: string): string[] {
  // Intl.Segmenter 不在这里的 TS lib 里，Electron 有；万一没有就按空白切
  type Seg = { segment(s: string): Iterable<{ segment: string }> };
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => Seg }).Segmenter;
  const parts = Segmenter ? [...new Segmenter(undefined, { granularity: "grapheme" }).segment(input)].map((x) => x.segment) : input.split(/\s+/);
  const out: string[] = [];
  for (const segment of parts) {
    if (/^[\s,，、]+$/.test(segment)) continue;
    const emoji = /\p{Extended_Pictographic}|\u20e3/u.test(segment);
    const symbol = /^[\p{S}\p{P}]+$/u.test(segment) && ![...segment].some((ch) => ch.charCodeAt(0) < 0x80);
    if ((emoji || symbol) && !out.includes(segment)) out.push(segment);
  }
  return out;
}

/** 换掉自定义那一组（和内置重复的跳过）；空列表就是没有自定义组 */
export function setCustomMarkers(emojis: string[], exclusive: boolean): void {
  MARKER_GROUPS.splice(BUILTIN_GROUPS);
  const builtin = new Set(MARKER_GROUPS.flatMap((g) => g.emojis));
  const list = emojis.filter((e) => !builtin.has(e));
  if (list.length) MARKER_GROUPS.push({ get name() { return t("marker.custom"); }, emojis: list, exclusive });
  ALL_MARKERS = MARKER_GROUPS.flatMap((g) => g.emojis);
}

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

/** 节点开头有没有答案标记 */
export function isAnswer(text: string): boolean {
  return splitMarkers(text).markers.includes(ANSWER_MARKER);
}

const TASK_RE = /^\[( |x|X)\]\s+/;

/**
 * 切换任务复选框。check（点节点上的复选框）：[ ] ⇄ [x]，没有就加 [ ]；
 * add-remove（菜单「任务复选框」）：有就去掉，没有就加 [ ]
 */
export function toggleTask(text: string, mode: "check" | "add-remove" = "check"): string {
  const { markers, rest } = splitMarkers(text);
  const m = TASK_RE.exec(rest);
  let body: string;
  if (!m) body = `[ ] ${rest}`;
  else if (mode === "add-remove") body = rest.slice(m[0].length);
  else body = `${m[1] === " " ? "[x]" : "[ ]"} ${rest.slice(m[0].length)}`;
  return [...markers, body].join(" ");
}

/** 节点是不是一个选择题选项：[x] 是正确选项，[ ] 是错误选项，不是选项返回 null */
export function taskState(text: string): "done" | "todo" | null {
  const m = TASK_RE.exec(splitMarkers(text).rest);
  return m ? (m[1] === " " ? "todo" : "done") : null;
}

const WIKILINK_ONLY = /^\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/;

/** 格式记号：颜色、荧光笔、下划线的标签，换行，加粗、斜体、高亮、删除线的符号 */
const MARKUP_RE = /(<\/?(?:span|mark|u)\b[^>]*>|<br\s*\/?>|\*\*|\*|==(?:🔴|🟠|🟡|🟢|🔵|🟣)?|~~)/u;
const WIKILINK_G = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
/** Markdown 链接 [文字](地址)：文字里可以有转义的方括号 */
const MDLINK_G = /\[((?:\\.|[^\]\\])+)\]\(([^)\s]+)\)/g;

/** [文字](笔记.md) 的地址 → 笔记名（去掉 .md，还原 %20 这类转义） */
function noteHref(href: string): string {
  let h = href.replace(/^<|>$/g, "");
  try {
    h = decodeURI(h);
  } catch {
    // 不是合法的转义：原样
  }
  return h.replace(/\.md$/i, "");
}

const isUrl = (href: string) => /^[a-z][\w+.-]*:/i.test(href);

/**
 * 标签整个就是一个笔记链接时，返回目标与别名。带格式的节点做成链接后，是好几段指向同一篇的链接
 * （[[笔记|前面]][<span style="color:…">红字</span>](笔记.md)），去掉格式记号后只剩这些链接的也算
 */
export function wikilinkOf(text: string): { target: string; alias?: string } | null {
  const m = WIKILINK_ONLY.exec(text);
  if (m) return { target: m[1].trim(), alias: m[2]?.trim() };
  // Markdown 写的笔记链接先换成 [[笔记]]，再按段检查
  const t = text.replace(MDLINK_G, (all, _label: string, href: string) => (isUrl(href) ? all : `[[${noteHref(href)}]]`));
  const parts = t.split(MARKUP_RE).filter((p, i) => i % 2 === 0 && p.trim());
  if (!parts.length) return null;
  let target: string | null = null;
  for (const p of parts) {
    // 这一段只能是挨着的几个链接，中间不能有别的字
    if (p.replace(WIKILINK_G, "").trim()) return null;
    for (const one of p.matchAll(WIKILINK_G)) {
      const tg = one[1].trim();
      if (target !== null && tg !== target) return null;
      target = tg;
    }
  }
  return target ? { target } : null;
}

/** 笔记名写进 Markdown 链接的地址：空格这类转义，加上 .md */
function mdHref(target: string): string {
  return `${target.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")}.md`;
}
const escLabel = (s: string) => s.replace(/[[\]]/g, (c) => `\\${c}`);

/** 一段不含 HTML 标签的文字做成链接：格式符号之间的每段字各自 [[笔记|字]]，已经带链接的那段不动 */
function linkPlain(text: string, target: string): string {
  return text
    .split(MARKUP_RE)
    .map((p, i) => {
      if (i % 2 === 1 || !p.trim() || /\[\[|\]\(/.test(p)) return p;
      const lead = /^\s*/.exec(p)![0];
      const tail = /\s*$/.exec(p)![0];
      const body = p.trim();
      return `${lead}${body === target ? `[[${target}]]` : `[[${target}|${body}]]`}${tail}`;
    })
    .join("");
}

const HTML_TAG = /<(span|mark|u)\b[^>]*>|<\/(span|mark|u)>/gi;

/**
 * 把一段文字做成指向 target 的链接，保留格式：
 * - 包在颜色、荧光笔、下划线这些 HTML 标签里的部分，写成 [<span …>文字</span>](笔记.md)：Obsidian 的实时预览不解析标签里面的
 *   [[链接]]，会原样露出方括号；Markdown 链接的文字里放标签，阅读视图、实时预览、脑图里都显示成带颜色的链接
 * - 其余部分写成 [[笔记|文字]]，加粗这些符号留在链接外面
 * 没有格式时就是 [[笔记|文字]]（文字和笔记同名时 [[笔记]]）
 */
export function linkWholeText(text: string, target: string): string {
  let out = "";
  let last = 0;
  let depth = 0;
  let segStart = -1;
  for (const m of text.matchAll(HTML_TAG)) {
    const i = m.index ?? 0;
    if (m[1]) {
      if (depth === 0) {
        out += linkPlain(text.slice(last, i), target);
        segStart = i;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const end = i + m[0].length;
        const seg = text.slice(segStart, end);
        out += /\[\[|\]\(/.test(seg) ? seg : `[${escLabel(seg)}](${mdHref(target)})`;
        last = end;
      }
    }
  }
  // 没配对的标签：剩下的原样当普通文字处理
  out += depth > 0 ? text.slice(segStart) : linkPlain(text.slice(last), target);
  return out;
}

/**
 * 把 text 里 [from, to) 这段字做成链接（编辑时选中一段字按 ⌘K）。选区落在一段颜色（HTML 标签）中间时，
 * 在选区两头把那段颜色断开，选中的字单独做成带颜色的链接，不把 [[链接]] 塞进标签里
 */
export function linkRange(text: string, from: number, to: number, target: string): string {
  const html = formatSpans(text).filter((s) => s.html && s.innerFrom <= from && to <= s.innerTo);
  const outer = [...html].sort((a, b) => a.from - b.from);
  const opens = outer.map((s) => text.slice(s.from, s.innerFrom)).join("");
  const closes = [...outer]
    .reverse()
    .map((s) => text.slice(s.innerTo, s.to))
    .join("");
  const part = text.slice(from, to);
  const linked = html.length ? `[${escLabel(opens + part + closes)}](${mdHref(target)})` : linkWholeText(part, target);
  const joined = text.slice(0, from) + closes + linked + opens + text.slice(to);
  // 断开时两头可能留下空的标签对：<span …></span>
  return joined.replace(/<(span|mark|u)\b[^>]*><\/\1>/gi, "");
}

/** 取消链接：指向 target 的 [[target|文字]] 换回文字，[[target]] 换回 target，[文字](target.md) 换回文字；格式原样留着 */
export function unlinkText(text: string, target: string): string {
  return text
    .replace(WIKILINK_G, (all, tg: string, alias?: string) => (tg.trim() === target ? (alias ?? tg).trim() : all))
    .replace(MDLINK_G, (all, label: string, href: string) => (!isUrl(href) && noteHref(href) === target ? label.replace(/\\([[\]])/g, "$1") : all));
}

const BR_RE = /<br\s*\/?>/i;

const TAG_RE = /<(span|mark|u)\b[^>]*>|<\/(span|mark|u)>/gi;
const MD_DELIMS = ["**", "==", "~~"];

/**
 * 按 <br> 切开的几行：一个格式跨了行（<span style="color:…">第一行<br>第二行</span>、**粗<br>体**），
 * 在这一行末尾先收尾、下一行开头再接上，每一行自己就是完整的，才认得出来。只改显示，不动存的文字
 */
export function carryAcrossBreaks(segments: string[]): string[] {
  if (segments.length < 2) return segments;
  const open: { name: string; tag: string }[] = [];
  const md = new Set<string>();
  return segments.map((seg) => {
    const prefix = open.map((o) => o.tag).join("") + MD_DELIMS.filter((d) => md.has(d)).join("");
    for (const m of seg.matchAll(TAG_RE)) {
      if (m[1]) open.push({ name: m[1].toLowerCase(), tag: m[0] });
      else {
        const name = m[2].toLowerCase();
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i].name === name) {
            open.splice(i, 1);
            break;
          }
        }
      }
    }
    for (const d of MD_DELIMS) {
      if ((seg.split(d).length - 1) % 2) {
        if (md.has(d)) md.delete(d);
        else md.add(d);
      }
    }
    const suffix =
      MD_DELIMS.filter((d) => md.has(d))
        .reverse()
        .join("") +
      [...open]
        .reverse()
        .map((o) => `</${o.name}>`)
        .join("");
    return prefix + seg + suffix;
  });
}

/** 节点标签里的 <br> 是多行文本的存储形式（标题里放不下真正的换行） */
export function renderInline(el: HTMLElement, text: string, opts: InlineOptions = {}): void {
  el.textContent = "";
  const segments = carryAcrossBreaks(text.split(BR_RE));
  segments.forEach((seg, i) => {
    if (i > 0) el.appendChild(createEl("br"));
    renderSegment(el, seg, opts);
  });
}

function renderSegment(el: HTMLElement, text: string, opts: InlineOptions, nested = false): void {
  let rest = text;
  if (!nested && el.childElementCount === 0) {
    const { markers, rest: afterMarkers } = splitMarkers(rest);
    if (markers.length) {
      const span = createSpan();
      span.className = "mm-markers";
      span.textContent = markers.join(" ");
      el.appendChild(span);
      rest = afterMarkers;
    }
  }
  const task = nested ? null : /^\[( |x|X)\]\s+/.exec(rest);
  if (task) {
    const box = createSpan();
    box.className = "mm-task" + (task[1] === " " ? "" : " is-done");
    box.title = t("inline.toggleTask");
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
      el.appendChild(math(m[0].startsWith("$$") && m[0].endsWith("$$") ? `\\displaystyle ${m[5]}` : m[5], opts));
    } else if (m[6] !== undefined) {
      el.appendChild(link(m[7] ?? m[6], m[6], true, opts));
    } else if (m[8] !== undefined) {
      // [文字](笔记.md)：不是网址的是笔记链接；文字里能带格式（颜色做成链接时就是这样写的）
      const internal = !/^[a-z][\w+.-]*:/i.test(m[9]);
      const href = internal ? noteHref(m[9]) : m[9];
      const a = link("", href, internal, opts);
      renderSegment(a, m[8], opts, true);
      el.appendChild(a);
    } else if (m[10] !== undefined || m[11] !== undefined) {
      el.appendChild(nest("strong", m[10] ?? m[11], opts));
    } else if (m[12] !== undefined) {
      el.appendChild(wrap("code", m[12]));
    } else if (m[13] !== undefined) {
      el.appendChild(nest("del", m[13], opts));
    } else if (m[14] !== undefined) {
      const hc = highlightColor(m[14]);
      const e = nest("mark", hc ? m[14].slice(hc.length) : m[14], opts);
      if (hc) e.dataset.highlight = hc.color;
      el.appendChild(e);
    } else if (m[25] !== undefined) {
      el.appendChild(nest("mark", m[25], opts));
    } else if (m[26] !== undefined) {
      el.appendChild(nest("u", m[26], opts));
    } else if (m[15] !== undefined || m[16] !== undefined) {
      el.appendChild(nest("em", m[15] ?? m[16], opts));
    } else if (m[17] !== undefined) {
      el.appendChild(tag(m[17], opts));
    } else if (m[18] !== undefined) {
      el.appendChild(link(m[18], m[18], false, opts));
    } else if (m[19] !== undefined) {
      el.appendChild(frame(m[19], m[0], opts));
    } else if (m[20] !== undefined) {
      el.appendChild(document.createTextNode(m[20]));
    } else if (m[21] !== undefined || m[23] !== undefined) {
      const e = createEl(m[21] !== undefined ? "span" : "mark");
      if (m[21] !== undefined) e.style.color = m[21];
      else e.style.background = m[23];
      e.classList.add(m[21] !== undefined ? "mm-color" : "mm-bg");
      renderSegment(e, m[22] ?? m[24], opts, true);
      el.appendChild(e);
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

/** 图片节点允许的宽度范围（像素）：最小值固定，最大值是设置「图片最大宽度」（默认 800） */
export const IMAGE_MIN_WIDTH = 40;
export const IMAGE_MAX_WIDTH_DEFAULT = 800;
let imageMaxWidth = IMAGE_MAX_WIDTH_DEFAULT;
export function setImageMaxWidth(w: number): void {
  imageMaxWidth = Math.max(IMAGE_MIN_WIDTH, w);
}
export function getImageMaxWidth(): number {
  return imageMaxWidth;
}

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
    // 非数字参数（别名）保留；「别名|宽度」只换掉最后那段宽度，不然每拖一次就多接一段
    const segs = (wiki[2] ?? "").split("|");
    if (segs.length && /^\d+$/.test(segs[segs.length - 1].trim())) segs.pop();
    const keep = segs.join("|") || undefined;
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

/**
 * 改写 `<iframe …>` 上的 width / height。传 null 恢复默认 560×315
 * （iframe 没有「原始尺寸」这回事，属性本身就是尺寸）。
 */
export function setFrameSize(text: string, size: { w: number; h: number } | null): string {
  const m = FRAME_TAG_RE.exec(text);
  if (!m) return text;
  const w = size ? Math.max(FRAME_MIN, Math.min(FRAME_MAX, Math.round(size.w))) : FRAME_DEFAULT_W;
  const h = size ? Math.max(FRAME_MIN, Math.min(FRAME_MAX, Math.round(size.h))) : FRAME_DEFAULT_H;
  let attrs = m[1].replace(/\s*(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, "");
  attrs = `width="${w}" height="${h}"${attrs.startsWith(" ") ? "" : " "}${attrs}`.trimEnd();
  return text.slice(0, m.index) + `<iframe ${attrs}>${m[2] ?? ""}` + text.slice(m.index + m[0].length);
}

const FRAME_TAG_RE = /<iframe\s([^>]*?)\/?>(\s*<\/iframe>)?/i;

export const FRAME_MIN = 80;
export const FRAME_MAX = 1200;
export const FRAME_DEFAULT_W = 560;
export const FRAME_DEFAULT_H = 315;

const ATTR_RE = /([A-Za-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** 把 `<iframe …>` 的属性串拆成键值对，键统一小写 */
function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let m = ATTR_RE.exec(raw); m; m = ATTR_RE.exec(raw)) {
    out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  ATTR_RE.lastIndex = 0;
  return out;
}

function frameSize(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(FRAME_MIN, Math.min(FRAME_MAX, n));
}

/**
 * 默认不自动播放。B 站这类播放器不带参数就直接开播，而 iframe 的 allow 权限策略在
 * Obsidian 的 Electron 里拦不住（实测给不给 autoplay 权限都照播），只有 URL 参数管用。
 * `autoplay=0` 是各家播放器通用的写法，认不出这个参数的站点会忽略它，没有副作用。
 * 用户自己写了 autoplay= 就听用户的。只改渲染用的地址，笔记里的原文不动。
 */
export function noAutoplay(src: string): string {
  if (/[?&]autoplay=/i.test(src)) return src;
  return src + (src.includes("?") ? "&" : "?") + "autoplay=0";
}

/**
 * `<iframe …>` 嵌入。只接 http(s) 的 src —— javascript:／data: 一律退回显示原文，
 * 免得节点文本变成可执行的东西。宽高钳在 80–1200 之间，防止一个节点把画布撑爆。
 */
function frame(attrsRaw: string, original: string, opts: InlineOptions): HTMLElement {
  const attrs = parseAttrs(attrsRaw);
  const src = attrs.get("src") ?? "";
  if (!/^https?:\/\//i.test(src)) return wrap("span", original);
  const w = frameSize(attrs.get("width"), FRAME_DEFAULT_W);
  const h = frameSize(attrs.get("height"), FRAME_DEFAULT_H);
  const finalSrc = noAutoplay(src);
  // 复用已有的那个，不然每次重渲染视频都从头开始
  const existing = opts.reuseFrame?.(finalSrc);
  const f = existing ?? createEl("iframe");
  f.className = "mm-frame";
  // 拖手柄改大小时写的是行内样式，复用时先清掉，让下面的属性说了算
  f.setCssStyles({ width: "", height: "" });
  f.width = String(w);
  f.height = String(h);
  const title = attrs.get("title");
  if (title) f.title = title;
  if (attrs.has("allowfullscreen")) f.allowFullscreen = true;
  if (attrs.has("allow")) f.allow = attrs.get("allow")!;
  if (!existing) f.src = finalSrc;
  // 盖一层挡板：跨域 iframe 里点了哪儿我们看不见，不挡的话随手一点就跳去源站。
  // 挡板吃掉所有鼠标事件，节点照常能选能拖；双击挡板才把播放器放开（见 canvas.ts）。
  const box = createSpan();
  box.className = "mm-frame-box";
  const shield = createSpan();
  shield.className = "mm-frame-shield";
  // 双击画面之外再给一个明确的按钮，不用猜交互（点击处理在 canvas.ts 里挂）
  const activate = createEl("button");
  activate.type = "button";
  activate.className = "mm-frame-activate";
  activate.textContent = t("inline.activate");
  shield.append(activate);
  box.append(f, shield);
  return box;
}

/** 图片：`![[文件|宽度]]` 的参数若是数字就当宽度；解析不到就显示文字 */
function image(link: string, param: string | undefined, alt: string, opts: InlineOptions): HTMLElement {
  if (isPdfCrop(link)) return pdfCrop(link, param, opts);
  const src = opts.resolveImage ? opts.resolveImage(link) : /^https?:\/\//.test(link) ? link : null;
  if (!src) return wrap("span", alt || link);
  const img = createEl("img");
  img.className = "mm-img";
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  const width = param && /^\d+$/.test(param.trim()) ? Number(param) : null;
  if (width) {
    // 明确设了宽度就以它为准，不受默认缩略图上限约束
    img.style.width = `${Math.max(IMAGE_MIN_WIDTH, Math.min(imageMaxWidth, width))}px`;
    img.classList.add("has-size");
  }
  img.addEventListener("load", () => opts.onImageLoad?.());
  img.addEventListener("error", () => {
    img.replaceWith(wrap("span", alt || link));
    opts.onImageLoad?.();
  });
  return img;
}

/** PDF++ 的截区嵌入：链接指向 PDF 里的一块矩形（`#page=1&rect=x1,y1,x2,y2`） */
export function isPdfCrop(link: string): boolean {
  return /\.pdf#/i.test(link) && /[#&]rect=/i.test(link);
}

/**
 * PDF 截区：参数里最后一段是数字就当宽度（和普通图片一样拖手柄改），其余是 PDF++ 写的显示文字。
 * 宿主（PDF++）画出来的图片挂上 mm-img，看大图、复制图片、改宽度都和普通图片一样
 */
function pdfCrop(target: string, param: string | undefined, opts: InlineOptions): HTMLElement {
  const parts = (param ?? "").split("|");
  const last = parts[parts.length - 1].trim();
  const width = /^\d+$/.test(last) ? Number(last) : null;
  const label = parts.filter((p, i) => p.trim() && !(i === parts.length - 1 && width !== null)).join("|");
  const box = createSpan();
  box.className = "mm-pdf-crop";
  const ok = opts.renderPdfCrop?.(target, box, (img) => {
    img.classList.add("mm-img");
    img.draggable = false;
    if (width) {
      img.style.width = `${Math.max(IMAGE_MIN_WIDTH, Math.min(imageMaxWidth, width))}px`;
      img.classList.add("has-size");
    }
    opts.onImageLoad?.();
  });
  if (ok) {
    // 截区整块是图片（单击选中、双击看大图），跳回 PDF 走角上的按钮，和选区节点点文字跳过去一样
    const jump = createEl("button", { cls: "mm-pdf-jump" });
    jump.type = "button";
    jump.textContent = "↗";
    jump.setAttribute("aria-label", t("canvas.jumpToPdf"));
    jump.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    jump.addEventListener("dblclick", (ev) => ev.stopPropagation());
    jump.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      opts.onLink?.(target, true, ev);
    });
    box.append(jump);
    return box;
  }
  // 画不了截区：显示成指向那一页的链接
  const file = target.split("#")[0].split("/").pop() ?? target;
  const page = /[#&]page=(\d+)/.exec(target)?.[1];
  return link(label || (page ? `${file}, p.${page}` : file), target.replace(/&rect=[^&]*/i, ""), true, opts);
}

function tag(name: string, opts: InlineOptions): HTMLElement {
  const a = createEl("a");
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

/** 粗体、斜体这类里面还能再有格式（比如粗体里的一段颜色） */
function nest(tag: keyof HTMLElementTagNameMap, text: string, opts: InlineOptions): HTMLElement {
  const e = createEl(tag);
  renderSegment(e, text, opts, true);
  return e;
}

function wrap(tag: keyof HTMLElementTagNameMap, text: string): HTMLElement {
  const e = createEl(tag);
  e.textContent = text;
  return e;
}

function link(label: string, href: string, internal: boolean, opts: InlineOptions): HTMLElement {
  const a = createEl("a");
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
  // 跨行的格式在换行处收尾、下一行再接上：编辑框一行一行认格式，跨行的认不出来会露出源码
  return carryAcrossBreaks(text.split(/<br\s*\/?>/i)).join("\n");
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
    .replace(/<\/?(?:span|mark)\b[^>]*>/gi, "")
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_: string, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|~~(.+?)~~|==(.+?)==/g, (_: string, a?: string, b?: string, c?: string, d?: string, e?: string) =>
      a ?? b ?? c ?? d ?? (e !== undefined ? e.slice(highlightColor(e)?.length ?? 0) : ""),
    )
    .replace(/\\([!-/:-@[-`{-~])/g, "$1");
}
