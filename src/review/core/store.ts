/**
 * 复习数据：一个牌组（一张脑图）一个 JSON，放在插件文件夹的 review/ 下，按牌组 id 命名（改名、挪文件夹不受影响）。
 * 每复习一张只改这一个文件，两台设备同一天复习不同的图不会冲突。读写交给宿主（Obsidian 的 adapter），单测里用内存。
 */
import { type CardRecord, dayNumber, State, type Grade } from "./schedule";

/** 一次评分的记录（统计、每天上限、撤销用） */
export interface LogEntry {
  /** 卡片 id */
  c: string;
  /** 评分时刻（毫秒） */
  t: number;
  /** 评分 1～4 */
  r: Grade;
  /** 评分前的状态（新卡、学习中……）：算「今天学了几张新卡、复习了几张」 */
  st: State;
  /** 这张卡用了多少毫秒 */
  ms?: number;
}

export interface DeckData {
  v: 1;
  /** 最后一次见到的笔记路径（只做提示，认牌组靠 id） */
  path: string;
  cards: Record<string, CardRecord>;
  log: LogEntry[];
}

export interface StoreIO {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  list(): Promise<string[]>;
}

/** 复习记录最多留多少条（一条约 50 字节，十万条 5MB）；超了丢最旧的 */
const MAX_LOG = 100_000;

export function emptyDeck(path: string): DeckData {
  return { v: 1, path, cards: {}, log: [] };
}

export function parseDeck(text: string | null, path: string): DeckData {
  if (!text) return emptyDeck(path);
  try {
    const raw = JSON.parse(text) as Partial<DeckData>;
    return {
      v: 1,
      path: typeof raw.path === "string" ? raw.path : path,
      cards: raw.cards && typeof raw.cards === "object" ? raw.cards : {},
      log: Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e.c === "string" && typeof e.t === "number") : [],
    };
  } catch {
    return emptyDeck(path);
  }
}

export class ReviewStore {
  private decks = new Map<string, DeckData>();
  private loading = new Map<string, Promise<DeckData>>();
  private writing = new Map<string, Promise<void>>();

  constructor(private io: StoreIO) {}

  async deck(id: string, path: string): Promise<DeckData> {
    const have = this.decks.get(id);
    if (have) return have;
    let p = this.loading.get(id);
    if (!p) {
      p = this.io.read(`${id}.json`).then((text) => {
        const d = parseDeck(text, path);
        this.decks.set(id, d);
        this.loading.delete(id);
        return d;
      });
      this.loading.set(id, p);
    }
    return p;
  }

  /** 已经读进来的（同步拿，算状态栏数字用；没读过的返回 null） */
  cached(id: string): DeckData | null {
    return this.decks.get(id) ?? null;
  }

  /** 写回：同一个牌组排队写，后一次带的是最新内容 */
  save(id: string): Promise<void> {
    const d = this.decks.get(id);
    if (!d) return Promise.resolve();
    if (d.log.length > MAX_LOG) d.log.splice(0, d.log.length - MAX_LOG);
    const prev = this.writing.get(id) ?? Promise.resolve();
    const next = prev.then(() => this.io.write(`${id}.json`, JSON.stringify(d)));
    this.writing.set(id, next.catch(() => undefined));
    return next;
  }

  /** 所有复习数据文件：牌组 id → 记下的笔记路径（移出复习再加回来时按路径找回原来的牌组） */
  async index(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const name of await this.io.list()) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const d = this.decks.get(id) ?? parseDeck(await this.io.read(name), "");
      if (d.path) out.set(id, d.path);
    }
    return out;
  }

  /** 文件被别处改了（同步进来）：扔掉缓存，下次重读 */
  forget(id: string): void {
    this.decks.delete(id);
  }
}

/** 这个牌组今天已经学了几张新卡、复习了几张（按评分前的状态，同一张卡只算一次） */
export function todayCounts(d: DeckData, now: number, startHour: number): { newDone: number; reviewDone: number } {
  const today = dayNumber(now, startHour);
  const fresh = new Set<string>();
  const reviewed = new Set<string>();
  for (let i = d.log.length - 1; i >= 0; i--) {
    const e = d.log[i];
    if (dayNumber(e.t, startHour) !== today) {
      if (e.t < now) break;
      continue;
    }
    if (e.st === State.New) fresh.add(e.c);
    else if (e.st === State.Review) reviewed.add(e.c);
  }
  return { newDone: fresh.size, reviewDone: reviewed.size };
}
