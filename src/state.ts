import type { App, DataAdapter } from "obsidian";
import type { SavedViewport } from "./settings";

/**
 * 按文件记的视图状态，和插件设置（data.json）分开存：
 * - 视口（平移、缩放、选中）写得最勤，各台设备屏幕也不一样，只存本机（按库的 localStorage，不同步）
 * - 锁定、备注展开、隐藏标注写得少，存插件目录下的 state.json；同步冲突最坏丢这些状态，连累不到设置
 * 样式类的东西（颜色、折叠、外框……）照旧写在笔记里，不归这里管
 */

/** 一条展开备注单独的状态：单独收起、拖出来的宽高（像素，未乘节点字号） */
export interface NoteCardState {
  collapsed?: boolean;
  w?: number;
  h?: number;
}
/** 一个文件里各条备注的状态：键是节点在树里的文字路径（见 canvas 的 noteKey） */
export type NoteCards = Record<string, NoteCardState>;

interface SectionValues {
  hiddenCallouts: boolean;
  locked: boolean;
  notesExpanded: boolean;
  noteCards: NoteCards;
}
export type StateSection = keyof SectionValues;
type StateData = { [S in StateSection]: Record<string, SectionValues[S]> };

const SECTIONS: StateSection[] = ["hiddenCallouts", "locked", "notesExpanded", "noteCards"];
const VIEWPORT_KEY = "gogoga-mindmap-viewports";
const MAX_VIEWPORTS = 50;

const empty = (): StateData => ({ hiddenCallouts: {}, locked: {}, notesExpanded: {}, noteCards: {} });

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/** 只认得出的那部分：文件被手改坏、或是别的版本写的多余字段，都丢掉 */
function cleanCards(v: unknown): NoteCards | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: NoteCards = {};
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const card: NoteCardState = {};
    if (r.collapsed === true) card.collapsed = true;
    const w = num(r.w);
    const h = num(r.h);
    if (w) card.w = w;
    if (h) card.h = h;
    if (Object.keys(card).length) out[k] = card;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalize(raw: unknown): StateData {
  const out = empty();
  if (!raw || typeof raw !== "object") return out;
  for (const s of SECTIONS) {
    const v = (raw as Record<string, unknown>)[s];
    if (!v || typeof v !== "object") continue;
    for (const [k, b] of Object.entries(v)) {
      if (s === "noteCards") {
        const cards = cleanCards(b);
        if (cards) out.noteCards[k] = cards;
      } else if (typeof b === "boolean") out[s][k] = b;
    }
  }
  return out;
}

export class FileStateStore {
  private data = empty();
  /** 上次读到 / 写出时文件的修改时间：写之前对一下，别的设备同步过来改过就先合并 */
  private mtime = 0;
  /** 读进来以后本机改过的键（值为 undefined 表示删掉），合并时盖在磁盘内容上 */
  private dirty = new Map<string, { section: StateSection; path: string; value: unknown }>();
  private timer: number | null = null;
  private saving: Promise<void> | null = null;

  constructor(
    private adapter: DataAdapter,
    private file: string,
  ) {}

  async load(): Promise<void> {
    try {
      if (!(await this.adapter.exists(this.file))) return;
      this.data = normalize(JSON.parse(await this.adapter.read(this.file)));
      this.mtime = (await this.adapter.stat(this.file))?.mtime ?? 0;
    } catch {
      // 文件坏了就当没有：这里只有视图状态，丢了不要紧
      this.data = empty();
    }
  }

  get<S extends StateSection>(section: S, path: string): SectionValues[S] | undefined {
    return this.data[section][path];
  }

  set<S extends StateSection>(section: S, path: string, value: SectionValues[S] | undefined): void {
    const sec = this.data[section] as Record<string, SectionValues[S]>;
    if (!path || JSON.stringify(sec[path]) === JSON.stringify(value)) return;
    if (value === undefined) delete sec[path];
    else sec[path] = value;
    this.dirty.set(`${section}\u0001${path}`, { section, path, value });
    this.saveSoon();
  }

  /** 迁移用：只补上还没有的键，已有的（比如别的设备先迁好的）不覆盖 */
  fill<S extends StateSection>(section: S, entries: Record<string, SectionValues[S]>): void {
    for (const [path, value] of Object.entries(entries)) if (this.data[section][path] === undefined) this.set(section, path, value);
  }

  rename(oldPath: string, newPath: string): void {
    for (const s of SECTIONS) {
      const v = this.data[s][oldPath];
      if (v === undefined) continue;
      this.set(s, oldPath, undefined);
      this.set(s, newPath, v as never);
    }
  }

  remove(path: string): void {
    for (const s of SECTIONS) this.set(s, path, undefined);
  }

  /** 窗口重新拿到焦点时：别的设备同步过来改过，就读回来（本机没改动时） */
  async refresh(): Promise<boolean> {
    if (this.dirty.size || this.saving) return false;
    const st = await this.adapter.stat(this.file).catch(() => null);
    if (!st || st.mtime === this.mtime) return false;
    await this.load();
    return true;
  }

  private saveSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 500);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.saving) await this.saving;
    if (!this.dirty.size) return;
    this.saving = this.write().finally(() => (this.saving = null));
    await this.saving;
  }

  private async write(): Promise<void> {
    const changes = [...this.dirty.values()];
    this.dirty.clear();
    try {
      const st = await this.adapter.stat(this.file);
      if (st && st.mtime !== this.mtime) {
        // 磁盘上的版本比我们读到的新：以它为底，再把本机这次的改动盖上去
        const disk = normalize(JSON.parse(await this.adapter.read(this.file)));
        for (const c of changes) {
          const sec = disk[c.section] as Record<string, unknown>;
          if (c.value === undefined) delete sec[c.path];
          else sec[c.path] = c.value;
        }
        this.data = disk;
      }
    } catch {
      // 读不到就用内存里的
    }
    const out: Record<string, unknown> = {};
    for (const s of SECTIONS) if (Object.keys(this.data[s]).length) out[s] = this.data[s];
    await this.adapter.write(this.file, JSON.stringify(out, null, 2) + "\n");
    this.mtime = (await this.adapter.stat(this.file))?.mtime ?? Date.now();
  }
}

/** 视口只存本机：按库的 localStorage，不进同步 */
export class ViewportStore {
  private all: Record<string, SavedViewport>;

  constructor(private app: App) {
    const raw = this.app.loadLocalStorage(VIEWPORT_KEY) as unknown;
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    this.all = parsed && typeof parsed === "object" ? (parsed as Record<string, SavedViewport>) : {};
  }

  get(path: string): SavedViewport | undefined {
    return this.all[path];
  }

  set(path: string, vp: SavedViewport): void {
    this.all[path] = vp;
    const keys = Object.keys(this.all);
    if (keys.length > MAX_VIEWPORTS) {
      keys.sort((a, b) => this.all[a].at - this.all[b].at);
      for (const k of keys.slice(0, keys.length - MAX_VIEWPORTS)) delete this.all[k];
    }
    this.save();
  }

  /** 迁移用：只补上还没有的 */
  fill(entries: Record<string, SavedViewport>): void {
    for (const [k, v] of Object.entries(entries)) this.all[k] ??= v;
    this.save();
  }

  rename(oldPath: string, newPath: string): void {
    const vp = this.all[oldPath];
    if (!vp) return;
    delete this.all[oldPath];
    this.all[newPath] = vp;
    this.save();
  }

  remove(path: string): void {
    if (!(path in this.all)) return;
    delete this.all[path];
    this.save();
  }

  clear(): void {
    this.all = {};
    this.save();
  }

  private save(): void {
    this.app.saveLocalStorage(VIEWPORT_KEY, Object.keys(this.all).length ? JSON.stringify(this.all) : null);
  }
}

/** 0.28.2 以前记在 data.json 里的按文件状态，加载时迁走 */
export interface LegacyFileState {
  viewports?: Record<string, SavedViewport>;
  hiddenCallouts?: string[];
  notesExpandedFiles?: Record<string, boolean>;
  lockedFiles?: string[];
}
export const LEGACY_KEYS: (keyof LegacyFileState)[] = ["viewports", "hiddenCallouts", "notesExpandedFiles", "lockedFiles"];
