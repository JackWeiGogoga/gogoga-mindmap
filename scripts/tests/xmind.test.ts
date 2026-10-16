import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describeLost, parseXmind, readZip, xmindSheetToMarkdown } from "../../src/xmind";

/** 用 Node 的 zlib 手工拼一个最小 zip（deflate 或 stored） */
function makeZip(files: Record<string, string>, stored = false): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const raw = enc.encode(content);
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const method = stored ? 0 : 8;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length), ...u16(nameB.length), ...u16(0), ...nameB, ...data,
    ]);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...nameB,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(locals.length), ...u16(locals.length), ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

const CONTENT_JSON = JSON.stringify([
  {
    title: "Sheet 1",
    rootTopic: {
      title: "中心\n主题",
      notes: { plain: { content: "根备注" } },
      children: {
        attached: [
          {
            title: "A",
            style: { properties: { fill: "#F9A3A3" } },
            children: { attached: [{ title: "A1" }, { title: "A2", branch: "folded", children: { attached: [{ title: "A21" }] } }] },
          },
          { title: "B", labels: ["重要"] },
        ],
      },
    },
  },
  { title: "Sheet 2", rootTopic: { title: "第二张" } },
]);

test("zip 读取：deflate 与 stored 都能解", async () => {
  for (const stored of [false, true]) {
    const entries = await readZip(makeZip({ "content.json": "[]", "metadata.json": "{}" }, stored));
    assert.deepEqual([...entries.keys()], ["content.json", "metadata.json"]);
    assert.equal(new TextDecoder().decode(entries.get("content.json")), "[]");
  }
});

test("content.json → Markdown", async () => {
  const sheets = await parseXmind(makeZip({ "content.json": CONTENT_JSON }));
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].root.title, "中心 主题");
  assert.equal(
    xmindSheetToMarkdown(sheets[0], { maxHeadingLevel: 2, indent: "\t" }),
    `---
mindmap: true
---

# 中心 主题

根备注

## A %%f9a3a3%%
- A1
- A2 %%fold%%
\t- A21

## B

#重要
`,
  );
});

test("content.xml (XMind 8) → Markdown", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" version="2.0">
  <sheet id="s1"><title>表一</title>
    <topic id="t1"><title>根</title>
      <children><topics type="attached">
        <topic id="t2" branch="folded"><title>甲</title><notes><plain>甲的备注</plain></notes>
          <children><topics type="attached"><topic id="t3"><title>甲一</title></topic></topics></children>
        </topic>
        <topic id="t4"><title>乙</title></topic>
      </topics></children>
    </topic>
  </sheet>
</xmap-content>`;
  const sheets = await parseXmind(makeZip({ "content.xml": xml }));
  assert.equal(sheets.length, 1);
  assert.equal(
    xmindSheetToMarkdown(sheets[0], { maxHeadingLevel: 3 }),
    `---
mindmap: true
---

# 根

## 甲 %%fold%%

甲的备注

### 甲一

## 乙
`,
  );
});

test("外框转成 %%box%%，不支持的内容计数提示", async () => {
  const json = JSON.stringify([
    {
      title: "S",
      relationships: [{ id: "r1" }, { id: "r2" }],
      rootTopic: {
        id: "root",
        title: "根",
        boundaries: [{ range: "(1,2)", title: "后两个" }, { range: "(0,0)" }],
        summaries: [{ range: "(0,1)" }],
        children: {
          attached: [{ id: "a", title: "A", boundaries: [{ range: "master" }] }, { id: "b", title: "B" }, { id: "c", title: "C" }],
          detached: [{ id: "f", title: "自由" }],
        },
      },
    },
  ]);
  const [sheet] = await parseXmind(makeZip({ "content.json": json }));
  assert.deepEqual(sheet.lost, { detached: 1, relationships: 2, summaries: 1, comments: 0 });
  assert.equal(
    xmindSheetToMarkdown(sheet, { maxHeadingLevel: 2 }),
    `---
mindmap: true
---

# 根

## A %%box%%

## B %%box=2 "后两个"%%

## C
`,
  );
  assert.ok(describeLost(sheet.lost).length > 0);
  assert.equal(describeLost({ detached: 0, relationships: 0, summaries: 0, comments: 0 }), "");

  const xml = `<xmap-content><sheet id="s"><title>X</title>
    <topic id="t1"><title>根</title>
      <children><topics type="attached"><topic id="t2"><title>甲</title></topic><topic id="t3"><title>乙</title></topic></topics>
      <topics type="detached"><topic id="t9"><title>浮</title></topic></topics></children>
      <boundaries><boundary range="(0,1)"><title>两个</title></boundary></boundaries>
    </topic>
    <relationships><relationship end1="t2" end2="t3"/></relationships>
  </sheet></xmap-content>`;
  const comments = `<comments><comment object-id="t2" author="a"><content>hi</content></comment><comment object-id="zz"/></comments>`;
  const [x] = await parseXmind(makeZip({ "content.xml": xml, "comments.xml": comments }));
  assert.deepEqual(x.lost, { detached: 1, relationships: 1, summaries: 0, comments: 1 });
  assert.match(xmindSheetToMarkdown(x, { maxHeadingLevel: 2 }), /## 甲 %%box=2 "两个"%%/);
});
