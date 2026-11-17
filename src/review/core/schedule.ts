/**
 * 间隔复习的排期：FSRS（ts-fsrs，Anki 23.10 起可选的算法）。不依赖脑图，也不依赖 Obsidian，单测直接跑。
 * 卡片状态和 Anki 一一对应：新卡 → 学习中（按学习阶段）→ 待复习（按天）；忘了进重新学习。
 */
import { createEmptyCard, fsrs, generatorParameters, type Card, type FSRS, type Grade, Rating, State, type StepUnit } from "ts-fsrs";

export { Rating, State };
export type { Grade };

/** 设置里的复习选项（名字和默认值照 Anki 的牌组选项） */
export interface ReviewPrefs {
  /** 每个牌组每天最多出几张新卡 */
  newPerDay: number;
  /** 每个牌组每天最多出几张到期的卡 */
  reviewPerDay: number;
  /** 学习阶段，空格隔开：1m 10m */
  learningSteps: string;
  /** 重新学习阶段：10m */
  relearningSteps: string;
  /** 目标记忆率 0.7～0.99 */
  retention: number;
  /** 新的一天从几点开始（0～23） */
  dayStartHour: number;
  /** 最长间隔（天） */
  maxInterval: number;
}

export const DEFAULT_REVIEW_PREFS: ReviewPrefs = {
  newPerDay: 20,
  reviewPerDay: 200,
  learningSteps: "1m 10m",
  relearningSteps: "10m",
  retention: 0.9,
  dayStartHour: 4,
  maxInterval: 36500,
};

/** 存进文件的卡片状态：字段名压短，一张卡几十个字节 */
export interface CardRecord {
  /** 下次到期（毫秒时间戳） */
  due: number;
  /** 稳定度、难度 */
  s: number;
  d: number;
  /** 上次复习到这次隔了几天、排的间隔天数 */
  ed: number;
  sd: number;
  /** 学习阶段走到第几步 */
  ls: number;
  reps: number;
  lapses: number;
  st: State;
  /** 上次复习（毫秒） */
  lr?: number;
  /** 暂停（Anki 的 suspend）：不出，直到恢复 */
  susp?: 1;
  /** 今天先不出（Anki 的 bury）：记的是哪一天，过了这天自动恢复 */
  bury?: number;
}

/** 「1m 10m」→ ["1m","10m"]；写错的项跳过 */
export function parseSteps(s: string): StepUnit[] {
  return s
    .split(/[\s,，]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^\d+(\.\d+)?[mhd]$/.test(x) && parseFloat(x) > 0) as StepUnit[];
}

export function makeScheduler(p: ReviewPrefs): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: Math.min(0.99, Math.max(0.7, p.retention)),
      maximum_interval: Math.max(1, Math.round(p.maxInterval)),
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: parseSteps(p.learningSteps),
      relearning_steps: parseSteps(p.relearningSteps),
    }),
  );
}

export function toCard(rec: CardRecord | null | undefined, now: number): Card {
  if (!rec) return createEmptyCard(new Date(now));
  return {
    due: new Date(rec.due),
    stability: rec.s,
    difficulty: rec.d,
    elapsed_days: rec.ed,
    scheduled_days: rec.sd,
    learning_steps: rec.ls,
    reps: rec.reps,
    lapses: rec.lapses,
    state: rec.st,
    last_review: rec.lr === undefined ? undefined : new Date(rec.lr),
  };
}

export function fromCard(c: Card, prev?: CardRecord | null): CardRecord {
  const out: CardRecord = {
    due: c.due.getTime(),
    s: round(c.stability),
    d: round(c.difficulty),
    ed: c.elapsed_days,
    sd: c.scheduled_days,
    ls: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    st: c.state,
  };
  if (c.last_review) out.lr = c.last_review.getTime();
  if (prev?.susp) out.susp = 1;
  return out;
}

const round = (x: number) => Math.round(x * 10000) / 10000;

export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

/** 四种评分各算一遍：翻面后按钮上方显示的「下次多久」 */
export function previewAll(f: FSRS, rec: CardRecord | null | undefined, now: number): Record<Grade, CardRecord> {
  const preview = f.repeat(toCard(rec, now), new Date(now));
  const out = {} as Record<Grade, CardRecord>;
  for (const g of GRADES) out[g] = fromCard(preview[g].card, rec);
  return out;
}

export function answer(f: FSRS, rec: CardRecord | null | undefined, now: number, grade: Grade): CardRecord {
  return fromCard(f.next(toCard(rec, now), new Date(now), grade).card, rec);
}

/** 第几天：按「新的一天从几点开始」切，凌晨 4 点前算前一天（本地时间） */
export function dayNumber(ms: number, startHour: number): number {
  const d = new Date(ms - startHour * 3600_000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400_000);
}

/** 这一天结束的时刻（下一天开始），毫秒 */
export function dayEnd(day: number, startHour: number): number {
  const d = new Date(day * 86400_000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, startHour).getTime();
}

/**
 * 按钮上方的间隔，照 Anki：不到一小时写「<10分钟」，往上是小时、天、月、年。
 * units：界面语言的单位
 */
export function formatInterval(ms: number, units: { m: string; h: string; d: string; mo: string; y: string }): string {
  const min = ms / 60_000;
  if (min < 60) return `<${Math.max(1, Math.ceil(min))}${units.m}`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}${units.h}`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}${units.d}`;
  if (d < 365) return `${trim1(d / 30)}${units.mo}`;
  return `${trim1(d / 365)}${units.y}`;
}

const trim1 = (x: number) => (Math.round(x * 10) / 10).toString();
