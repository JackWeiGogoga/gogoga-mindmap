import assert from "node:assert/strict";
import test from "node:test";
import type { App, TFile } from "obsidian";
import { AttachmentJanitor, embedTargets } from "../../src/attachment-cleanup";

test("embedTargets：wiki 嵌入和 Markdown 图片，去掉别名、锚点、尺寸；网址不算；普通链接不算", () => {
  const text = [
    "- ![[a.png]]",
    "- ![[附件/b 图.jpg|300]] 和 ![[c.png#x]]",
    "- ![说明](附件/d%20图.png) ![x](<e f.png> \"标题\")",
    "- ![网图](https://x.com/y.png) ![d](data:image/png;base64,AAA)",
    "- [[不是嵌入.png]] [链接](g.png)",
    "- 重复 ![[a.png]]",
  ].join("\n");
  assert.deepEqual(embedTargets(text), ["a.png", "附件/b 图.jpg", "c.png", "附件/d 图.png", "e f.png"]);
});

/** 假的库：文件、链接索引、回收站 */
function fakeApp(files: Record<string, string>, links: Record<string, Record<string, number>> = {}) {
  const store = new Map<string, { file: TFile; data: ArrayBuffer }>();
  const mk = (path: string, text: string) => {
    const name = path.split("/").pop()!;
    const file = { path, name, extension: name.split(".").pop()!, stat: { size: text.length } } as unknown as TFile;
    store.set(path, { file, data: new TextEncoder().encode(text).buffer });
    return file;
  };
  for (const [p, t] of Object.entries(files)) mk(p, t);
  const trashed: string[] = [];
  const app = {
    metadataCache: {
      resolvedLinks: links,
      getFirstLinkpathDest: (lp: string) => [...store.values()].find((x) => x.file.path === lp || x.file.name === lp)?.file ?? null,
    },
    vault: {
      getAbstractFileByPath: (p: string) => store.get(p)?.file ?? (p === "附件" ? {} : null),
      getFiles: () => [...store.values()].map((x) => x.file),
      cachedRead: async (f: TFile) => new TextDecoder().decode(store.get(f.path)!.data),
      readBinary: async (f: TFile) => store.get(f.path)!.data,
      createBinary: async (p: string, d: ArrayBuffer) => {
        mk(p, new TextDecoder().decode(d));
      },
      createFolder: async () => undefined,
    },
    fileManager: {
      trashFile: async (f: TFile) => {
        trashed.push(f.path);
        store.delete(f.path);
      },
    },
  };
  return { app: app as unknown as App, store, trashed };
}

test("清理：只动没人用的图片，留备份；撤销让链接回来时写回原路径", async () => {
  const { app, store, trashed } = fakeApp({ "附件/a.png": "AAA", "附件/b.png": "BBB", "附件/c.png": "CCC", "附件/d.pdf": "D", "别处.canvas": '{"file":"附件/c.png"}' }, { "别的笔记.md": { "附件/b.png": 1 } });
  let notices = 0;
  const j = new AttachmentJanitor(app, (n) => (notices += n));
  const before = "- ![[a.png]]\n- ![[b.png]]\n- ![[c.png]]\n- ![[d.pdf]]";
  const known = j.images(before, "图.md");
  assert.deepEqual([...known.keys()].map((f) => f.path), ["附件/a.png", "附件/b.png", "附件/c.png"]);
  const after = "- 空";
  const n = await j.sweep(known, "图.md", () => after);
  assert.equal(n, 1);
  assert.deepEqual(trashed, ["附件/a.png"]);
  assert.equal(notices, 1);
  assert.ok(store.has("附件/b.png"), "别的笔记还在用的不动");
  assert.ok(store.has("附件/c.png"), "白板里用到的不动");
  // 撤销：链接回来了，文件写回原路径
  assert.equal(await j.restoreMissing(before, "图.md"), 1);
  assert.equal(new TextDecoder().decode(store.get("附件/a.png")!.data), "AAA");
  // 文本里还用着的（剪切后马上粘贴）不动
  const again = j.images(before, "图.md");
  assert.equal(await j.sweep(again, "图.md", () => before), 0);
});
