/**
 * 读取 .xmind 文件（zip 包）：XMind Zen/2020+ 的 content.json 与 XMind 8 的 content.xml 都支持。
 * 解压用浏览器自带的 DecompressionStream，不引第三方库。
 */

import { t } from "./i18n";
import { createNode, DocStyle, MindDoc, MindNode } from "./model";
import { DEFAULT_STYLE, serializeMarkdown } from "./markdown";

export interface XmindTopic {
  id?: string;
  title: string;
  note?: string;
  color?: string;
  folded?: boolean;
  /** 外框：XMind 的 boundary 挂在父主题上、按子主题下标框一段；这里换算成挂在起始子主题上 */
  box?: { span: number; title: string };
  /** 概要：同外框，按子主题下标括一段，文字取自 XMind 的概要主题 */
  summary?: { span: number; text: string };
  children: XmindTopic[];
}

/** 插件还不支持、打开和转换时会丢掉的内容，按条数统计，用来提示用户 */
export interface XmindLost {
  detached: number;
  relationships: number;
  summaries: number;
  comments: number;
}

export interface XmindSheet {
  title: string;
  root: XmindTopic;
  lost: XmindLost;
}

const noLoss = (): XmindLost => ({ detached: 0, relationships: 0, summaries: 0, comments: 0 });

/** 把 XMind 的 boundary range 落到子主题上："(0,2)" 框住第 0–2 个子主题，"master" 框住主题自己 */
function applyBoundary(topic: XmindTopic, range: string | undefined, title: string): void {
  const m = /^\(\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(range ?? "");
  const box = (span: number) => ({ span: Math.max(1, span), title: cleanTitle(title).replace(/["%]/g, "") });
  if (!m) {
    if (range === "master" && !topic.box) topic.box = box(1);
    return;
  }
  const a = Number(m[1]);
  const b = Math.min(Number(m[2]), topic.children.length - 1);
  const start = topic.children[a];
  if (start && b >= a && !start.box) start.box = box(b - a + 1);
}

/**
 * XMind 的概要：父主题上记 range "(0,2)" 和概要主题的 id，概要主题本身放在 children.summary 里。
 * 概要主题下面还挂着子主题的，那些子主题这边还显示不了，算进「丢掉的内容」
 */
function applySummary(topic: XmindTopic, range: string | undefined, text: string): void {
  const m = /^\(\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(range ?? "");
  if (!m) return;
  const a = Number(m[1]);
  const b = Math.min(Number(m[2]), topic.children.length - 1);
  const start = topic.children[a];
  if (start && b >= a && !start.summary) start.summary = { span: b - a + 1, text: cleanTitle(text).replace(/["%]/g, "") };
}

function collectIds(t: XmindTopic, out: Set<string>): void {
  if (t.id) out.add(t.id);
  for (const c of t.children) collectIds(c, out);
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
  id?: string;
  title?: string;
  boundaries?: { range?: string; title?: string }[];
  summaries?: { range?: string; topicId?: string }[];
  comments?: unknown[];
  notes?: { plain?: { content?: string } };
  children?: { attached?: JsonTopic[]; detached?: JsonTopic[]; summary?: JsonTopic[] };
  branch?: string;
  style?: { properties?: Record<string, string> };
  labels?: string[];
}

interface JsonSheet {
  title?: string;
  rootTopic?: JsonTopic;
  relationships?: unknown[];
}

function cleanTitle(s: string | undefined): string {
  return (s ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

function fromJsonTopic(t: JsonTopic, lost: XmindLost = noLoss()): XmindTopic {
  const fill = t.style?.properties?.["fill"];
  const color = fill && /^#[0-9a-f]{6}/i.test(fill) ? fill.slice(0, 7).toLowerCase() : undefined;
  const notes: string[] = [];
  const plain = t.notes?.plain?.content?.trim();
  if (plain) notes.push(plain);
  if (t.labels?.length) notes.push(t.labels.map((l) => `#${l.replace(/\s+/g, "-")}`).join(" "));
  lost.detached += t.children?.detached?.length ?? 0;
  lost.comments += t.comments?.length ?? 0;
  const topic: XmindTopic = {
    id: t.id,
    title: cleanTitle(t.title),
    note: notes.length ? notes.join("\n\n") : undefined,
    color,
    folded: t.branch === "folded" || undefined,
    children: (t.children?.attached ?? []).map((c) => fromJsonTopic(c, lost)),
  };
  for (const b of t.boundaries ?? []) applyBoundary(topic, b.range, b.title ?? "");
  for (const s of t.summaries ?? []) {
    const st = t.children?.summary?.find((x) => x.id === s.topicId);
    applySummary(topic, s.range, st?.title ?? "");
    if (st?.children?.attached?.length) lost.summaries += 1;
  }
  return topic;
}

function parseContentJson(text: string): XmindSheet[] {
  const sheets = JSON.parse(text) as JsonSheet[];
  return sheets
    .filter((s) => s.rootTopic)
    .map((s, i) => {
      const lost = noLoss();
      lost.relationships = s.relationships?.length ?? 0;
      return { title: cleanTitle(s.title) || t("xmind.sheet", { n: i + 1 }), root: fromJsonTopic(s.rootTopic!, lost), lost };
    });
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

function fromXmlTopic(el: XEl, lost: XmindLost = noLoss()): XmindTopic {
  const title = cleanTitle(childrenByName(el, "title")[0]?.text ?? "");
  const notesEl = childrenByName(el, "notes")[0];
  const plain = notesEl ? childrenByName(notesEl, "plain")[0]?.text.trim() : undefined;
  const children: XmindTopic[] = [];
  for (const ch of childrenByName(el, "children")) {
    for (const topics of childrenByName(ch, "topics")) {
      if (topics.attrs["type"] === "detached") lost.detached += childrenByName(topics, "topic").length;
      if (topics.attrs["type"] !== "attached") continue;
      for (const t of childrenByName(topics, "topic")) children.push(fromXmlTopic(t, lost));
    }
  }
  const topic: XmindTopic = { id: el.attrs["id"], title, note: plain || undefined, folded: el.attrs["branch"] === "folded" || undefined, children };
  for (const bs of childrenByName(el, "boundaries")) {
    for (const b of childrenByName(bs, "boundary")) applyBoundary(topic, b.attrs["range"], childrenByName(b, "title")[0]?.text ?? "");
  }
  // 概要主题在 <children><topics type="summary"> 里，<summaries> 用 topic-ref 指过去
  const summaryTopics = childrenByName(el, "children")
    .flatMap((ch) => childrenByName(ch, "topics"))
    .filter((ts) => ts.attrs["type"] === "summary")
    .flatMap((ts) => childrenByName(ts, "topic"));
  for (const s of childrenByName(el, "summaries")) {
    for (const sm of childrenByName(s, "summary")) {
      const st = summaryTopics.find((x) => x.attrs["id"] === sm.attrs["topic-ref"]);
      applySummary(topic, sm.attrs["range"], st ? (childrenByName(st, "title")[0]?.text ?? "") : "");
      if (st && childrenByName(st, "children").some((ch) => childrenByName(ch, "topics").some((ts) => childrenByName(ts, "topic").length))) lost.summaries += 1;
    }
  }
  return topic;
}

function parseContentXml(text: string): XmindSheet[] {
  const root = parseXml(text);
  const content = root.children.find((c) => c.name === "xmap-content") ?? root;
  return childrenByName(content, "sheet")
    .map((s, i) => {
      const topic = childrenByName(s, "topic")[0];
      if (!topic) return null;
      const lost = noLoss();
      for (const r of childrenByName(s, "relationships")) lost.relationships += childrenByName(r, "relationship").length;
      return { title: cleanTitle(childrenByName(s, "title")[0]?.text ?? "") || t("xmind.sheet", { n: i + 1 }), root: fromXmlTopic(topic, lost), lost };
    })
    .filter((s): s is XmindSheet => !!s);
}

export async function parseXmind(buf: ArrayBuffer): Promise<XmindSheet[]> {
  const entries = await readZip(buf);
  const decoder = new TextDecoder();
  const json = entries.get("content.json");
  const xml = entries.get("content.xml");
  const sheets = json ? parseContentJson(decoder.decode(json)) : xml ? parseContentXml(decoder.decode(xml)) : null;
  if (!sheets) throw new Error(t("xmind.noContent"));
  // XMind 8 的评论在单独的 comments.xml 里，按 object-id 归到所在的工作表
  const comments = entries.get("comments.xml");
  if (comments) {
    const targets = [...decoder.decode(comments).matchAll(/<(?:\w+:)?comment\b[^>]*\bobject-id\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    for (const sheet of sheets) {
      const ids = new Set<string>();
      collectIds(sheet.root, ids);
      sheet.lost.comments += targets.filter((id) => ids.has(id)).length;
    }
  }
  return sheets;
}

/** 提示里列出的丢失项；没有返回空串 */
export function describeLost(lost: XmindLost): string {
  const items = (["detached", "relationships", "summaries", "comments"] as const)
    .filter((k) => lost[k] > 0)
    .map((k) => t(`xmind.lost.${k}`, { n: lost[k] }));
  return items.length ? t("xmind.lost", { items: items.join(t("xmind.lost.sep")) }) : "";
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
      box: t.box && { ...t.box },
      summary: t.summary && { ...t.summary },
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
