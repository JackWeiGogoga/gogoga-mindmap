/**
 * 一次复习：按 Anki 的规则排出今天要出的卡，一张张给，评分后重新排。不依赖脑图，单测直接跑。
 * - 学习中的卡到点了先出；然后待复习和新卡按比例穿插；只剩学习中、20 分钟内到点的也提前出（Anki 的 learn ahead）
 * - 每个牌组每天新卡、复习有上限；复习的范围包含几个牌组时，总数再按同样的上限截一次
 * - 撤销回到上一张，排期、记录、队列都恢复
 */
import type { FSRS } from "ts-fsrs";
import { answer, type CardRecord, dayEnd, dayNumber, type Grade, previewAll, type ReviewPrefs, State } from "./schedule";
import { type DeckData, todayCounts } from "./store";

/** 题目来源给的一张卡：牌组、卡片 id、在图里的先后（新卡按它出） */
export interface CardRef {
  deckId: string;
  id: string;
  order: number;
}

export interface ScopeDeck {
  deckId: string;
  data: DeckData;
  cards: CardRef[];
}

/** 学习中的卡离到点还差这么多以内，没别的卡时提前出 */
export const LEARN_AHEAD = 20 * 60_000;

type Kind = "new" | "learn" | "review";
interface Item {
  ref: CardRef;
  kind: Kind;
  due: number;
}

export interface Counts {
  new: number;
  learn: number;
  review: number;
}

/** 一张卡现在算哪一类；暂停的、今天搁置的、还没到期的返回 null */
export function classify(rec: CardRecord | undefined, now: number, prefs: ReviewPrefs): { kind: Kind; due: number } | null {
  const today = dayNumber(now, prefs.dayStartHour);
  if (rec?.susp) return null;
  if (rec?.bury !== undefined && rec.bury >= today) return null;
  if (!rec || rec.st === State.New) return { kind: "new", due: 0 };
  const end = dayEnd(today, prefs.dayStartHour);
  if (rec.st === State.Learning || rec.st === State.Relearning) return rec.due < end ? { kind: "learn", due: rec.due } : null;
  return rec.due < end ? { kind: "review", due: rec.due } : null;
}

/** 几个牌组今天要出的卡，按上限截好：状态栏、牌组列表的数字和复习队列都用它 */
/** capTotal：几个牌组一起复习时总数再按上限截一次（复习一个文件夹，像 Anki 的上级牌组）；复习「全部」时不截 */
export function plan(decks: ScopeDeck[], now: number, prefs: ReviewPrefs, capTotal = decks.length > 1): { learn: Item[]; review: Item[]; fresh: Item[] } {
  const learn: Item[] = [];
  let review: Item[] = [];
  let fresh: Item[] = [];
  let newDoneAll = 0;
  let reviewDoneAll = 0;
  for (const d of decks) {
    const done = todayCounts(d.data, now, prefs.dayStartHour);
    newDoneAll += done.newDone;
    reviewDoneAll += done.reviewDone;
    const rv: Item[] = [];
    const nw: Item[] = [];
    for (const ref of d.cards) {
      const c = classify(d.data.cards[ref.id], now, prefs);
      if (!c) continue;
      const item = { ref, kind: c.kind, due: c.due };
      if (c.kind === "learn") learn.push(item);
      else if (c.kind === "review") rv.push(item);
      else nw.push(item);
    }
    rv.sort((a, b) => a.due - b.due || a.ref.order - b.ref.order);
    nw.sort((a, b) => a.ref.order - b.ref.order);
    review.push(...rv.slice(0, Math.max(0, prefs.reviewPerDay - done.reviewDone)));
    fresh.push(...nw.slice(0, Math.max(0, prefs.newPerDay - done.newDone)));
  }
  if (capTotal) {
    review = review.sort((a, b) => a.due - b.due).slice(0, Math.max(0, prefs.reviewPerDay - reviewDoneAll));
    fresh = fresh.slice(0, Math.max(0, prefs.newPerDay - newDoneAll));
  }
  learn.sort((a, b) => a.due - b.due);
  return { learn, review, fresh };
}

export function countsOf(decks: ScopeDeck[], now: number, prefs: ReviewPrefs, capTotal = decks.length > 1): Counts {
  const p = plan(decks, now, prefs, capTotal);
  return { new: p.fresh.length, learn: p.learn.length, review: p.review.length };
}

interface Snapshot {
  learn: Item[];
  review: Item[];
  fresh: Item[];
  shownNew: number;
  shownReview: number;
  item: Item;
  prev: CardRecord | undefined;
  logLen: number;
}

export class Session {
  private learn: Item[];
  private review: Item[];
  private fresh: Item[];
  private totalNew: number;
  private totalReview: number;
  private shownNew = 0;
  private shownReview = 0;
  private undoStack: Snapshot[] = [];
  private decks: Map<string, DeckData>;
  /** 正在出的那张 */
  current: Item | null = null;
  /** 这次复习了几张、用了多久（学完的画面用） */
  done = 0;
  spent = 0;

  constructor(
    decks: ScopeDeck[],
    private prefs: ReviewPrefs,
    private f: FSRS,
    now: number,
    capTotal = decks.length > 1,
  ) {
    this.decks = new Map(decks.map((d) => [d.deckId, d.data]));
    const p = plan(decks, now, prefs, capTotal);
    this.learn = p.learn;
    this.review = p.review;
    this.fresh = p.fresh;
    this.totalNew = p.fresh.length;
    this.totalReview = p.review.length;
  }

  counts(): Counts {
    const c = { new: this.fresh.length, learn: this.learn.length, review: this.review.length };
    if (this.current) c[this.current.kind === "new" ? "new" : this.current.kind === "learn" ? "learn" : "review"] += 1;
    return c;
  }

  /** 现在这张属于哪一类（底栏那个数加下划线） */
  currentKind(): Kind | null {
    return this.current?.kind ?? null;
  }

  record(ref: CardRef): CardRecord | undefined {
    return this.decks.get(ref.deckId)?.cards[ref.id];
  }

  /** 下一张；没有了返回 null。nextLearn：只剩学习中但还没到点时，最近那张什么时候到 */
  next(now: number): CardRef | null {
    if (this.current) return this.current.ref;
    let item: Item | undefined;
    if (this.learn.length && this.learn[0].due <= now) item = this.learn.shift();
    else if (this.review.length || this.fresh.length) {
      // 新卡均匀穿插在复习里：已出的新卡占比追着总数里的新卡占比
      const takeNew = !this.review.length || (this.fresh.length > 0 && this.shownNew * this.totalReview <= this.shownReview * this.totalNew);
      if (takeNew) {
        item = this.fresh.shift();
        this.shownNew++;
      } else {
        item = this.review.shift();
        this.shownReview++;
      }
    } else if (this.learn.length && this.learn[0].due <= now + LEARN_AHEAD) item = this.learn.shift();
    this.current = item ?? null;
    return this.current?.ref ?? null;
  }

  /** 只剩学习中的卡、都还没到点时：最近一张到点的时刻；没有返回 null */
  nextLearnAt(): number | null {
    return this.learn.length ? this.learn[0].due : null;
  }

  /** 翻面后四个按钮各自的下次到期 */
  preview(now: number): Record<Grade, CardRecord> | null {
    if (!this.current) return null;
    return previewAll(this.f, this.record(this.current.ref), now);
  }

  /** 评分：改排期、记一条记录；还在学习阶段、今天之内到点的放回学习队列。返回改了哪个牌组 */
  grade(g: Grade, now: number, ms?: number): string | null {
    const item = this.current;
    if (!item) return null;
    const deck = this.decks.get(item.ref.deckId);
    if (!deck) return null;
    const prev = deck.cards[item.ref.id];
    this.pushUndo(item, prev, deck.log.length);
    const next = answer(this.f, prev, now, g);
    deck.cards[item.ref.id] = next;
    const entry: { c: string; t: number; r: Grade; st: State; ms?: number } = { c: item.ref.id, t: now, r: g, st: prev?.st ?? State.New };
    if (ms !== undefined) entry.ms = Math.round(ms);
    deck.log.push(entry);
    if ((next.st === State.Learning || next.st === State.Relearning) && next.due < dayEnd(dayNumber(now, this.prefs.dayStartHour), this.prefs.dayStartHour)) {
      const it = { ref: item.ref, kind: "learn" as Kind, due: next.due };
      const at = this.learn.findIndex((x) => x.due > it.due);
      if (at < 0) this.learn.push(it);
      else this.learn.splice(at, 0, it);
    }
    this.current = null;
    this.done++;
    if (ms !== undefined) this.spent += ms;
    return item.ref.deckId;
  }

  /** 今天先不出（bury）/ 暂停（suspend）：这张拿掉，不算复习 */
  setAside(how: "bury" | "suspend", now: number): string | null {
    const item = this.current;
    if (!item) return null;
    const deck = this.decks.get(item.ref.deckId);
    if (!deck) return null;
    const prev = deck.cards[item.ref.id];
    this.pushUndo(item, prev, deck.log.length);
    const rec: CardRecord = prev ? { ...prev } : { due: now, s: 0, d: 0, ed: 0, sd: 0, ls: 0, reps: 0, lapses: 0, st: State.New };
    if (how === "bury") rec.bury = dayNumber(now, this.prefs.dayStartHour);
    else rec.susp = 1;
    deck.cards[item.ref.id] = rec;
    this.current = null;
    return item.ref.deckId;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * 撤销上一次评分（或搁置、暂停）：那张卡回到「正在出」（正在出的那张放回队列）。
   * 返回改了哪个牌组、撤销的是哪个评分（搁置、暂停的是 null）
   */
  undo(): { deckId: string; grade: Grade | null } | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    const deck = this.decks.get(s.item.ref.deckId);
    if (!deck) return null;
    const grade = deck.log.length > s.logLen ? deck.log[deck.log.length - 1].r : null;
    if (s.prev) deck.cards[s.item.ref.id] = s.prev;
    else delete deck.cards[s.item.ref.id];
    const graded = deck.log.length > s.logLen;
    deck.log.length = s.logLen;
    this.learn = s.learn;
    this.review = s.review;
    this.fresh = s.fresh;
    this.shownNew = s.shownNew;
    this.shownReview = s.shownReview;
    this.current = s.item;
    if (graded) this.done = Math.max(0, this.done - 1);
    return { deckId: s.item.ref.deckId, grade };
  }

  private pushUndo(item: Item, prev: CardRecord | undefined, logLen: number): void {
    this.undoStack.push({
      learn: this.learn.slice(),
      review: this.review.slice(),
      fresh: this.fresh.slice(),
      shownNew: this.shownNew,
      shownReview: this.shownReview,
      item,
      prev: prev ? { ...prev } : undefined,
      logLen,
    });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }
}
