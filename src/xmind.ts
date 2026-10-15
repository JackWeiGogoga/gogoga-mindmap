/**
 * 读取 .xmind 文件（zip 包）：XMind Zen/2020+ 的 content.json 与 XMind 8 的 content.xml 都支持。
 * 解压用浏览器自带的 DecompressionStream，不引第三方库。
 */

import { t } from "./i18n";
import { createNode, DocStyle, MindDoc, MindNode } from "./model";
import { DEFAULT_STYLE, serializeMarkdown } from "./markdown";

export interface XmindTopic {
  title: string;
  note?: string;
  color?: string;
  folded?: boolean;
  children: XmindTopic[];
}

export interface XmindSheet {
  title: string;
  root: XmindTopic;
}

// ---------- zip ----------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(t("xmind.notZip"));
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(t("xmind.zipCorrupt"));
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, await inflateRaw(data));
    else throw new Error(t("xmind.unsupportedCompression", { method }));
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

// ---------- content.json (XMind Zen / 2020+) ----------

interface JsonTopic {
  title?: string;
  notes?: { plain?: { content?: string } };
  children?: { attached?: JsonTopic[] };
  branch?: string;
  style?: { properties?: Record<string, string> };
  labels?: string[];
}

interface JsonSheet {
  title?: string;
  rootTopic?: JsonTopic;
}

function cleanTitle(s: string | undefined): string {
  return (s ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

function fromJsonTopic(t: JsonTopic): XmindTopic {
  const fill = t.style?.properties?.["fill"];
  const color = fill && /^#[0-9a-f]{6}/i.test(fill) ? fill.slice(0, 7).toLowerCase() : undefined;
  const notes: string[] = [];
  const plain = t.notes?.plain?.content?.trim();
  if (plain) notes.push(plain);
  if (t.labels?.length) notes.push(t.labels.map((l) => `#${l.replace(/\s+/g, "-")}`).join(" "));
  return {
    title: cleanTitle(t.title),
    note: notes.length ? notes.join("\n\n") : undefined,
    color,
    folded: t.branch === "folded" || undefined,
    children: (t.children?.attached ?? []).map(fromJsonTopic),
  };
}

function parseContentJson(text: string): XmindSheet[] {
  const sheets = JSON.parse(text) as JsonSheet[];
  return sheets
    .filter((s) => s.rootTopic)
    .map((s, i) => ({ title: cleanTitle(s.title) || t("xmind.sheet", { n: i + 1 }), root: fromJsonTopic(s.rootTopic!) }));
}

// ---------- content.xml (XMind 8) ----------

interface XEl {
  name: string;
  attrs: Record<string, string>;
  children: XEl[];
  /** 直接子文本节点拼接 */
  text: string;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) => {
    const low = e.toLowerCase();
    if (low === "lt") return "<";
    if (low === "gt") return ">";
    if (low === "amp") return "&";
    if (low === "quot") return '"';
    if (low === "apos") return "'";
    if (low.startsWith("#x")) return String.fromCodePoint(parseInt(low.slice(2), 16));
    if (low.startsWith("#")) return String.fromCodePoint(parseInt(low.slice(1), 10));
    return m;
  });
}

/** 够用的 XML 解析：元素、属性、文本、CDATA、注释、处理指令；不做校验 */
function parseXml(src: string): XEl {
  const root: XEl = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XEl[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      top().text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt);
      top().text += src.slice(lt + 9, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    // 找标签结尾，跳过引号里的 >
    let j = lt + 1;
    let quote = "";
    while (j < src.length) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
      j++;
    }
    const tag = src.slice(lt + 1, j).trim();
    i = j + 1;
    if (tag.startsWith("/")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClose = tag.endsWith("/");
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = /^(\S+)\s*([\s\S]*)$/.exec(body);
    if (!m) continue;
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? "");
    const el: XEl = { name: m[1].replace(/^.*:/, ""), attrs, children: [], text: "" };
    top().children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

function childrenByName(el: XEl, name: string): XEl[] {
  return el.children.filter((c) => c.name === name);
}

function fromXmlTopic(el: XEl): XmindTopic {
  const title = cleanTitle(childrenByName(el, "title")[0]?.text ?? "");
  const notesEl = childrenByName(el, "notes")[0];
  const plain = notesEl ? childrenByName(notesEl, "plain")[0]?.text.trim() : undefined;
  const children: XmindTopic[] = [];
  for (const ch of childrenByName(el, "children")) {
    for (const topics of childrenByName(ch, "topics")) {
      if (topics.attrs["type"] !== "attached") continue;
      for (const t of childrenByName(topics, "topic")) children.push(fromXmlTopic(t));
    }
  }
  return { title, note: plain || undefined, folded: el.attrs["branch"] === "folded" || undefined, children };
}

function parseContentXml(text: string): XmindSheet[] {
  const root = parseXml(text);
  const content = root.children.find((c) => c.name === "xmap-content") ?? root;
  return childrenByName(content, "sheet")
    .map((s, i) => {
      const topic = childrenByName(s, "topic")[0];
      if (!topic) return null;
      return { title: cleanTitle(childrenByName(s, "title")[0]?.text ?? "") || t("xmind.sheet", { n: i + 1 }), root: fromXmlTopic(topic) };
    })
    .filter((s): s is XmindSheet => !!s);
}

export async function parseXmind(buf: ArrayBuffer): Promise<XmindSheet[]> {
  const entries = await readZip(buf);
  const decoder = new TextDecoder();
  const json = entries.get("content.json");
  if (json) return parseContentJson(decoder.decode(json));
  const xml = entries.get("content.xml");
  if (xml) return parseContentXml(decoder.decode(xml));
  throw new Error(t("xmind.noContent"));
}

// ---------- → Markdown ----------

export function xmindSheetToDoc(sheet: XmindSheet, style: Partial<DocStyle> = {}): MindDoc {
  const st: DocStyle = { ...DEFAULT_STYLE, ...style };
  const maxHeading = Math.min(6, Math.max(1, st.maxHeadingLevel));
  const build = (t: XmindTopic, parent: MindNode | null, depth: number): MindNode => {
    const asHeading = depth + 1 <= maxHeading;
    const node = createNode({
      parent,
      text: t.title,
      note: t.note ?? "",
      color: t.color,
      folded: !!t.folded,
      kind: asHeading ? "heading" : "list",
      level: asHeading ? depth + 1 : 0,
    });
    node.children = t.children.map((c) => build(c, node, depth + 1));
    return node;
  };
  const root = build(sheet.root, null, 0);
  if (!root.text) root.text = sheet.title;
  return { root, frontmatter: "---\nmindmap: true\n---", preamble: "", rootFromHeading: true, style: st };
}

export function xmindSheetToMarkdown(sheet: XmindSheet, style: Partial<DocStyle> = {}): string {
  return serializeMarkdown(xmindSheetToDoc(sheet, style));
}
