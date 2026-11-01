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
  /** 自由主题（XMind 的 detached，只认中心主题下的）：相对中心主题的位置 */
  float?: { x: number; y: number };
  /** 标注（XMind 的 callout 主题）；一个主题有好几条时按行合并 */
  callout?: string;
  /** 主题上的图片：src 是包里的路径（去掉 xap: 前缀），after 为真时图片排在文字后面 */
  image?: { src: string; width?: number; after?: boolean };
  children: XmindTopic[];
}

/** 插件还不支持、打开和转换时会丢掉的内容，按条数统计，用来提示用户 */
export interface XmindLost {
  detached: number;
  relationships: number;
  summaries: number;
  comments: number;
  /** 主题上有图片、包里却找不到图片文件的 */
  images: number;
}

/** XMind 的关联线：两端是主题 id */
export interface XmindRelationship {
  from: string;
  to: string;
  title: string;
}

export interface XmindSheet {
  title: string;
  root: XmindTopic;
  lost: XmindLost;
  /** 转换时两端都找得到主题的才画出来，找不到的算进 lost.relationships */
  relationships?: XmindRelationship[];
  /** 这张图用到、包里也找得到的图片：包内路径 → 文件内容 */
  images?: Map<string, Uint8Array>;
}

const noLoss = (): XmindLost => ({ detached: 0, relationships: 0, summaries: 0, comments: 0, images: 0 });

/** "xap:resources/a.png" → "resources/a.png"；不是包内图片（外链等）返回 null */
function packagePath(src: string | undefined): string | null {
  const m = /^xap:(.+)$/.exec((src ?? "").trim());
  return m ? m[1] : null;
}

function imageOf(src: string | undefined, width: number | undefined, align: string | undefined): XmindTopic["image"] {
  const path = packagePath(src);
  if (!path) return undefined;
  const w = Number.isFinite(width) && width! > 0 ? Math.round(width!) : undefined;
  // XMind 默认图片在文字上方；align 为 bottom / right 时在文字后面
  return { src: path, width: w, after: align === "bottom" || align === "right" || undefined };
}

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
  image?: { src?: string; width?: number; height?: number; align?: string };
  children?: { attached?: JsonTopic[]; detached?: JsonTopic[]; summary?: JsonTopic[]; callout?: JsonTopic[] };
  position?: { x?: number; y?: number };
  branch?: string;
  style?: { properties?: Record<string, string> };
  labels?: string[];
}

interface JsonSheet {
  title?: string;
  rootTopic?: JsonTopic;
  relationships?: { end1Id?: string; end2Id?: string; title?: string }[];
}

function cleanTitle(s: string | undefined): string {
  return (s ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** 标注文字保留换行（标题里的换行在别处会被压成空格） */
function calloutText(titles: (string | undefined)[]): string | undefined {
  const text = titles
    .map((s) => (s ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

/** 自由主题的位置；文件里没写就在中心主题右下方依次往下排 */
function floatPos(x: number | undefined, y: number | undefined, i: number): { x: number; y: number } {
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x!), y: Math.round(y!) } : { x: 360, y: 160 + i * 80 };
}

function fromJsonTopic(t: JsonTopic, lost: XmindLost = noLoss(), isRoot = false): XmindTopic {
  const fill = t.style?.properties?.["fill"];
  const color = fill && /^#[0-9a-f]{6}/i.test(fill) ? fill.slice(0, 7).toLowerCase() : undefined;
  const notes: string[] = [];
  const plain = t.notes?.plain?.content?.trim();
  if (plain) notes.push(plain);
  if (t.labels?.length) notes.push(t.labels.map((l) => `#${l.replace(/\s+/g, "-")}`).join(" "));
  // 中心主题下的自由主题转成带位置的自由主题；别处的（很少见）还显示不了，算丢掉
  const detached = t.children?.detached ?? [];
  if (!isRoot) lost.detached += detached.length;
  lost.comments += t.comments?.length ?? 0;
  const topic: XmindTopic = {
    id: t.id,
    title: cleanTitle(t.title),
    note: notes.length ? notes.join("\n\n") : undefined,
    color,
    folded: t.branch === "folded" || undefined,
    callout: calloutText((t.children?.callout ?? []).map((c) => c.title)),
    image: imageOf(t.image?.src, t.image?.width, t.image?.align),
    children: [
      ...(t.children?.attached ?? []).map((c) => fromJsonTopic(c, lost)),
      ...(isRoot ? detached.map((d, i) => ({ ...fromJsonTopic(d, lost), float: floatPos(d.position?.x, d.position?.y, i) })) : []),
    ],
  };
  for (const b of t.boundaries ?? []) applyBoundary(topic, b.range, b.title ?? "");
  for (const s of t.summaries ?? []) {
    const st = t.children?.summary?.find((x) => x.id === s.topicId);
    applySummary(topic, s.range, st?.title ?? "");
    if (st?.children?.attached?.length) lost.summaries += 1;
  }
  return topic;
}

/** 两端都是这张图里的主题的关联线留下；连到概要、外框这些上的画不了，算丢掉 */
function withRelationships(sheet: XmindSheet, rels: XmindRelationship[]): XmindSheet {
  const ids = new Set<string>();
  collectIds(sheet.root, ids);
  const ok = rels.filter((r) => r.from && r.to && r.from !== r.to && ids.has(r.from) && ids.has(r.to));
  sheet.lost.relationships += rels.length - ok.length;
  if (ok.length) sheet.relationships = ok;
  return sheet;
}

function parseContentJson(text: string): XmindSheet[] {
  const sheets = JSON.parse(text) as JsonSheet[];
  return sheets
    .filter((s) => s.rootTopic)
    .map((s, i) => {
      const lost = noLoss();
      const relationships = (s.relationships ?? []).map((r) => ({ from: r.end1Id ?? "", to: r.end2Id ?? "", title: cleanTitle(r.title) }));
      const root = fromJsonTopic(s.rootTopic!, lost, true);
      return withRelationships({ title: cleanTitle(s.title) || t("xmind.sheet", { n: i + 1 }), root, lost }, relationships);
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

function fromXmlTopic(el: XEl, lost: XmindLost = noLoss(), isRoot = false): XmindTopic {
  const title = cleanTitle(childrenByName(el, "title")[0]?.text ?? "");
  const notesEl = childrenByName(el, "notes")[0];
  const plain = notesEl ? childrenByName(notesEl, "plain")[0]?.text.trim() : undefined;
  const children: XmindTopic[] = [];
  const floats: XmindTopic[] = [];
  const callouts: string[] = [];
  for (const ch of childrenByName(el, "children")) {
    for (const topics of childrenByName(ch, "topics")) {
      if (topics.attrs["type"] === "callout") {
        for (const t of childrenByName(topics, "topic")) callouts.push(childrenByName(t, "title")[0]?.text ?? "");
        continue;
      }
      if (topics.attrs["type"] === "detached") {
        if (!isRoot) {
          lost.detached += childrenByName(topics, "topic").length;
          continue;
        }
        for (const t of childrenByName(topics, "topic")) {
          const pos = childrenByName(t, "position")[0];
          floats.push({ ...fromXmlTopic(t, lost), float: floatPos(Number(pos?.attrs["svg:x"]), Number(pos?.attrs["svg:y"]), floats.length) });
        }
        continue;
      }
      if (topics.attrs["type"] !== "attached") continue;
      for (const t of childrenByName(topics, "topic")) children.push(fromXmlTopic(t, lost));
    }
  }
  // 自由主题排在普通子主题之后，外框 / 概要按下标换算时不受影响
  children.push(...floats);
  const img = childrenByName(el, "img")[0];
  const topic: XmindTopic = {
    id: el.attrs["id"],
    title,
    note: plain || undefined,
    image: img ? imageOf(img.attrs["xhtml:src"] ?? img.attrs["src"], Number(img.attrs["svg:width"]), img.attrs["align"]) : undefined,
    folded: el.attrs["branch"] === "folded" || undefined,
    callout: calloutText(callouts),
    children,
  };
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
      const relationships = childrenByName(s, "relationships")
        .flatMap((r) => childrenByName(r, "relationship"))
        .map((r) => ({ from: r.attrs["end1"] ?? "", to: r.attrs["end2"] ?? "", title: cleanTitle(childrenByName(r, "title")[0]?.text ?? "") }));
      const root = fromXmlTopic(topic, lost, true);
      return withRelationships({ title: cleanTitle(childrenByName(s, "title")[0]?.text ?? "") || t("xmind.sheet", { n: i + 1 }), root, lost }, relationships);
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
  for (const sheet of sheets) attachImages(sheet, sheet.root, entries);
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

/** 把主题用到的图片从包里取出来挂到工作表上；包里没有的去掉，算进丢失 */
function attachImages(sheet: XmindSheet, topic: XmindTopic, entries: Map<string, Uint8Array>): void {
  if (topic.image) {
    const data = entries.get(topic.image.src);
    if (data) (sheet.images ??= new Map()).set(topic.image.src, data);
    else {
      sheet.lost.images += 1;
      topic.image = undefined;
    }
  }
  for (const c of topic.children) attachImages(sheet, c, entries);
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

export function imageExt(src: string): string {
  return /\.([a-z0-9]+)$/i.exec(src)?.[1].toLowerCase() ?? "png";
}

/**
 * 只读显示用：把工作表里的图片做成 blob: 地址。不往 vault 里写文件；
 * 换工作表、关掉视图时调 revoke 释放
 */
export function sheetImageUrls(sheet: XmindSheet): { link: (src: string) => string | null; revoke: () => void } {
  const urls = new Map<string, string>();
  for (const [src, data] of sheet.images ?? []) {
    urls.set(src, URL.createObjectURL(new Blob([data as BlobPart], { type: IMAGE_TYPES[imageExt(src)] ?? "application/octet-stream" })));
  }
  return {
    link: (src) => urls.get(src) ?? null,
    revoke: () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}

/** 提示里列出的丢失项；没有返回空串 */
export function describeLost(lost: XmindLost): string {
  const items = (["detached", "relationships", "summaries", "comments", "images"] as const)
    .filter((k) => lost[k] > 0)
    .map((k) => t(`xmind.lost.${k}`, { n: lost[k] }));
  return items.length ? t("xmind.lost", { items: items.join(t("xmind.lost.sep")) }) : "";
}

// ---------- → Markdown ----------

/** 节点文字加上图片：`![[链接|宽度]]` 按 XMind 里的位置放在文字前或后 */
function withImage(title: string, image: XmindTopic["image"], link: string | null): string {
  if (!image || !link) return title;
  const img = `![[${link}${image.width ? `|${image.width}` : ""}]]`;
  if (!title) return img;
  return image.after ? `${title} ${img}` : `${img} ${title}`;
}

/**
 * imageLink：把包内图片路径换成节点里能用的链接（只读显示用 blob: 地址，转换时用存进 vault 的附件）；
 * 不给或返回 null 时只留文字
 */
export function xmindSheetToDoc(sheet: XmindSheet, style: Partial<DocStyle> = {}, imageLink?: (src: string) => string | null): MindDoc {
  const st: DocStyle = { ...DEFAULT_STYLE, ...style };
  const maxHeading = Math.min(6, Math.max(1, st.maxHeadingLevel));
  const byId = new Map<string, MindNode>();
  const build = (t: XmindTopic, parent: MindNode | null, depth: number): MindNode => {
    const asHeading = depth + 1 <= maxHeading;
    const node = createNode({
      parent,
      text: withImage(t.title, t.image, t.image && imageLink ? imageLink(t.image.src) : null),
      note: t.note ?? "",
      color: t.color,
      folded: !!t.folded,
      box: t.box && { ...t.box },
      summary: t.summary && { ...t.summary },
      float: parent && !parent.parent && t.float ? { ...t.float } : undefined,
      callout: t.callout,
      kind: asHeading ? "heading" : "list",
      level: asHeading ? depth + 1 : 0,
    });
    if (t.id) byId.set(t.id, node);
    node.children = t.children.map((c) => build(c, node, depth + 1));
    return node;
  };
  const root = build(sheet.root, null, 0);
  if (!root.text) root.text = sheet.title;
  let n = 0;
  for (const r of sheet.relationships ?? []) {
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    if (!from || !to) continue;
    to.anchor ??= `r${++n}`;
    (from.rels ??= []).push({ to: to.anchor, label: r.title.replace(/["%]/g, "").trim() });
  }
  return { root, frontmatter: "---\nmindmap: true\n---", preamble: "", rootFromHeading: true, style: st };
}

export function xmindSheetToMarkdown(sheet: XmindSheet, style: Partial<DocStyle> = {}, imageLink?: (src: string) => string | null): string {
  return serializeMarkdown(xmindSheetToDoc(sheet, style, imageLink));
}
