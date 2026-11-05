/**
 * 编辑节点文字时粘贴网址：选中了文字就包成 [文字](网址)，和 Obsidian 编辑器里一样；
 * 本地文件、文件夹的绝对路径也照此处理，转成 file:// 地址。
 * 另外可选在没选中文字时抓网页标题，粘成 [标题](网址)（设置里开，默认关）。
 */

// 带 :// 的都算（https、file、zotero://…）；不带的只认这几个常见的，免得「备注:内容」被当成网址
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?:mailto|tel|obsidian):\S+)$/i;
// 本地绝对路径：至少两段的 /a/b、Windows 的 C:\a、网络路径 \\server\share。路径里可以有空格
const POSIX_PATH_RE = /^\/[^/\s][^\n]*\/[^\n]*[^/\s]$/;
const WIN_PATH_RE = /^[a-z]:[\\/][^\n]*$/i;
const UNC_PATH_RE = /^\\\\[^\\\s]+\\[^\n]+$/;

/** 渲染时地址只认到第一个空白或右括号为止（见 inline.ts 的 [文字](url)），这几个字符要转义 */
function escapeDest(s: string): string {
  return s.replace(/[\s()<>]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

/** 剪贴板文字是一个网址或本地路径时，返回放进 (…) 的地址；否则 null */
export function linkDestination(clip: string): string | null {
  const s = clip.trim();
  if (!s || s.includes("\n")) return null;
  if (URL_RE.test(s)) return escapeDest(s);
  let path: string | null = null;
  if (POSIX_PATH_RE.test(s)) path = s;
  else if (WIN_PATH_RE.test(s)) path = "/" + s.replace(/\\/g, "/");
  else if (UNC_PATH_RE.test(s)) path = s.replace(/\\/g, "/").replace(/^\/\//, "");
  if (path === null) return null;
  // /Users/a → file:///Users/a，C:\a → file:///C:/a，\\server\share → file://server/share。
  // % 先转，后面的 %20 才不会被当成原文里的百分号
  return "file://" + escapeDest(path.replace(/%/g, "%25"));
}

/** 选中的文字能不能当链接文字：一行、不含方括号（会把 [文字] 截断） */
export function linkableLabel(selected: string): boolean {
  return !!selected.trim() && !/[\n[\]]/.test(selected);
}

/** 选中文字 + 粘贴的网址 → [文字](网址)；不适用返回 null，照常粘贴 */
export function pastedLink(selected: string, clip: string): string | null {
  if (!linkableLabel(selected)) return null;
  const dest = linkDestination(clip);
  return dest ? `[${selected}](${dest})` : null;
}

/** 只有网页地址才去抓标题 */
export function isWebUrl(clip: string): boolean {
  return /^https?:\/\/\S+$/i.test(clip.trim());
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** 网页的标题：先看 og:title，没有再用 <title>；整理成能放进 [ ] 的一行 */
export function titleFromHtml(html: string): string | null {
  const og =
    /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["']/i.exec(html)?.[1];
  const raw = og || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "";
  const title = decodeEntities(raw)
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || null;
}

/** 网页声明的编码：响应头里的 charset 优先，其次 <meta charset> */
export function htmlCharset(contentType: string | undefined, head: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return (fromHeader || fromMeta || "utf-8").toLowerCase();
}
