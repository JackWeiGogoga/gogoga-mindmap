import assert from "node:assert/strict";
import test from "node:test";
import type { DataAdapter } from "obsidian";
import { FileStateStore } from "../../src/state";

(globalThis as unknown as { window: typeof globalThis }).window ??= globalThis;

/** 内存里的假文件系统：mtime 每写一次加一，模拟别的设备同步过来改文件 */
function fakeAdapter() {
  const files = new Map<string, { text: string; mtime: number }>();
  let clock = 1;
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p)!.text,
    write: async (p: string, text: string) => void files.set(p, { text, mtime: clock++ }),
    stat: async (p: string) => (files.has(p) ? { type: "file", ctime: 0, mtime: files.get(p)!.mtime, size: 0 } : null),
  };
  return { adapter: adapter as unknown as DataAdapter, files, remote: (text: string) => files.set("s.json", { text, mtime: clock++ }) };
}

test("state.json：读写、删到空的分组不写出来", async () => {
  const { adapter, files } = fakeAdapter();
  const s = new FileStateStore(adapter, "s.json");
  await s.load();
  s.set("locked", "a.md", true);
  s.set("notesExpanded", "b.md", false);
  await s.flush();
  assert.deepEqual(JSON.parse(files.get("s.json")!.text), { locked: { "a.md": true }, notesExpanded: { "b.md": false } });
  s.set("locked", "a.md", undefined);
  await s.flush();
  assert.deepEqual(JSON.parse(files.get("s.json")!.text), { notesExpanded: { "b.md": false } });
  const again = new FileStateStore(adapter, "s.json");
  await again.load();
  assert.equal(again.get("notesExpanded", "b.md"), false);
  assert.equal(again.get("locked", "a.md"), undefined);
});

test("state.json：别的设备改过文件，本机改动合并上去，不覆盖对方", async () => {
  const { adapter, files, remote } = fakeAdapter();
  const s = new FileStateStore(adapter, "s.json");
  s.set("locked", "x.md", true);
  await s.flush();
  remote(JSON.stringify({ locked: { "x.md": true, "远端.md": true }, hiddenCallouts: { "h.md": true } }));
  s.set("locked", "x.md", undefined);
  s.set("notesExpanded", "本机.md", true);
  await s.flush();
  assert.deepEqual(JSON.parse(files.get("s.json")!.text), { hiddenCallouts: { "h.md": true }, locked: { "远端.md": true }, notesExpanded: { "本机.md": true } });
  assert.equal(s.get("locked", "远端.md"), true);
});

test("state.json：改名、删除、迁移只补不覆盖、坏文件当空", async () => {
  const { adapter, files, remote } = fakeAdapter();
  const s = new FileStateStore(adapter, "s.json");
  s.set("locked", "old.md", true);
  s.rename("old.md", "new.md");
  assert.equal(s.get("locked", "new.md"), true);
  assert.equal(s.get("locked", "old.md"), undefined);
  s.remove("new.md");
  assert.equal(s.get("locked", "new.md"), undefined);
  s.set("notesExpanded", "c.md", false);
  s.fill("notesExpanded", { "c.md": true, "d.md": true });
  assert.equal(s.get("notesExpanded", "c.md"), false);
  assert.equal(s.get("notesExpanded", "d.md"), true);
  await s.flush();
  assert.ok(files.has("s.json"));
  remote("{oops");
  const broken = new FileStateStore(adapter, "s.json");
  await broken.load();
  assert.equal(broken.get("notesExpanded", "d.md"), undefined);
});

test("state.json：别的设备改过、本机没改动时 refresh 读回来", async () => {
  const { adapter, remote } = fakeAdapter();
  const s = new FileStateStore(adapter, "s.json");
  s.set("locked", "a.md", true);
  await s.flush();
  assert.equal(await s.refresh(), false);
  remote(JSON.stringify({ locked: { "b.md": true } }));
  assert.equal(await s.refresh(), true);
  assert.equal(s.get("locked", "b.md"), true);
  assert.equal(s.get("locked", "a.md"), undefined);
});
