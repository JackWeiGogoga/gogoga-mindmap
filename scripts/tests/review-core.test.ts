/**
 * 间隔复习的排期核心：FSRS 封装、间隔文字、换天、每天上限、出题顺序、学习阶段、撤销、搁置和暂停
 */
import assert from "node:assert/strict";
import test from "node:test";
import { answer, dayEnd, dayNumber, DEFAULT_REVIEW_PREFS, formatInterval, makeScheduler, parseSteps, previewAll, Rating, State, type CardRecord } from "../../src/review/core/schedule";
import { countsOf, Session, type ScopeDeck } from "../../src/review/core/session";
import { emptyDeck, parseDeck, ReviewStore, todayCounts } from "../../src/review/core/store";

const P = DEFAULT_REVIEW_PREFS;
const F = makeScheduler(P);
const U = { m: "分钟", h: "小时", d: "天", mo: "个月", y: "年" };
// 本地时间 2026-11-17 10:00
const NOW = new Date(2026, 10, 17, 10, 0, 0).getTime();
const MIN = 60_000;
const DAY = 86400_000;

function deck(id: string, n: number, cards: Record<string, CardRecord> = {}): ScopeDeck {
  const data = emptyDeck(`${id}.md`);
  data.cards = cards;
  return { deckId: id, data, cards: Array.from({ length: n }, (_, i) => ({ deckId: id, id: `c${i}`, order: i })) };
}

test("学习阶段的写法", () => {
  assert.deepEqual(parseSteps("1m 10m"), ["1m", "10m"]);
  assert.deepEqual(parseSteps("1m, 1h  2d x 0m"), ["1m", "1h", "2d"]);
});

test("新卡第一次：四个按钮的间隔和 Anki 默认一样（<1分钟、<6分钟、<10分钟、几天）", () => {
  const p = previewAll(F, null, NOW);
  const iv = [1, 2, 3, 4].map((g) => formatInterval(p[g as 1].due - NOW, U));
  assert.deepEqual(iv.slice(0, 3), ["<1分钟", "<6分钟", "<10分钟"]);
  assert.match(iv[3], /^\d+天$/);
  assert.equal(p[Rating.Good].st, State.Learning);
  assert.equal(p[Rating.Easy].st, State.Review);
});

test("间隔文字：小时、天、月、年", () => {
  assert.equal(formatInterval(30 * MIN, U), "<30分钟");
  assert.equal(formatInterval(3 * 60 * MIN, U), "3小时");
  assert.equal(formatInterval(4 * DAY, U), "4天");
  assert.equal(formatInterval(45 * DAY, U), "1.5个月");
  assert.equal(formatInterval(400 * DAY, U), "1.1年");
});

test("换天：凌晨 4 点前算前一天", () => {
  const a = new Date(2026, 10, 18, 3, 59).getTime();
  const b = new Date(2026, 10, 18, 4, 0).getTime();
  assert.equal(dayNumber(a, 4), dayNumber(NOW, 4));
  assert.equal(dayNumber(b, 4), dayNumber(NOW, 4) + 1);
  assert.equal(dayEnd(dayNumber(NOW, 4), 4), b);
});

test("良好走完学习阶段进入待复习；忘了进重新学习、遗忘次数加一", () => {
  let r = answer(F, null, NOW, Rating.Good);
  assert.equal(r.st, State.Learning);
  r = answer(F, r, r.due, Rating.Good);
  assert.equal(r.st, State.Review);
  assert.ok(r.due - NOW >= DAY);
  const lapse = answer(F, r, r.due, Rating.Again);
  assert.equal(lapse.st, State.Relearning);
  assert.equal(lapse.lapses, 1);
});

test("每天新卡上限：一个牌组 20 张；几个牌组一起再截一次", () => {
  assert.deepEqual(countsOf([deck("a", 30)], NOW, P), { new: 20, learn: 0, review: 0 });
  assert.deepEqual(countsOf([deck("a", 15), deck("b", 15)], NOW, P), { new: 20, learn: 0, review: 0 });
});

test("到期的待复习、没到期的不算；暂停的、今天搁置的不出", () => {
  const due = answer(F, answer(F, null, NOW - 10 * DAY, Rating.Easy), NOW - 10 * DAY, Rating.Good);
  const rec = (d: number): CardRecord => ({ ...due, due: d });
  const cards = { c0: rec(NOW - DAY), c1: rec(NOW + 3 * DAY), c2: { ...rec(NOW - DAY), susp: 1 as const }, c3: { ...rec(NOW - DAY), bury: dayNumber(NOW, 4) } };
  assert.deepEqual(countsOf([deck("a", 4, cards)], NOW, P), { new: 0, learn: 0, review: 1 });
  // 搁置到昨天的今天照常出
  cards.c3.bury = dayNumber(NOW, 4) - 1;
  assert.equal(countsOf([deck("a", 4, cards)], NOW, P).review, 2);
});

test("今天已经学过的算进上限", () => {
  const d = deck("a", 30);
  for (let i = 0; i < 5; i++) d.data.log.push({ c: `x${i}`, t: NOW - MIN, r: 3, st: State.New });
  // 昨天的不算
  d.data.log.unshift({ c: "old", t: NOW - DAY, r: 3, st: State.New });
  assert.deepEqual(todayCounts(d.data, NOW, 4), { newDone: 5, reviewDone: 0 });
  assert.equal(countsOf([d], NOW, P).new, 15);
});

test("一次复习：新卡按图里的顺序出；点良好进学习中，10 分钟后再出；撤销回到上一张", () => {
  const d = deck("a", 3);
  const s = new Session([d], P, F, NOW);
  assert.deepEqual(s.counts(), { new: 3, learn: 0, review: 0 });
  assert.equal(s.next(NOW)?.id, "c0");
  s.grade(Rating.Good, NOW);
  assert.deepEqual(s.counts(), { new: 2, learn: 1, review: 0 });
  assert.equal(s.next(NOW)?.id, "c1");
  s.grade(Rating.Again, NOW);
  assert.equal(s.next(NOW)?.id, "c2");
  s.grade(Rating.Easy, NOW);
  assert.equal(d.data.cards.c2.st, State.Review);
  // 只剩学习中的：c1 一分钟后、c0 十分钟后，20 分钟内提前出，先到点的先出
  assert.equal(s.next(NOW)?.id, "c1");
  // 撤销：c1 回到「正在出」之前的样子 —— 撤销的是上一次评分（c2 的「简单」）
  assert.deepEqual(s.undo(), { deckId: "a", grade: Rating.Easy });
  assert.equal(s.current?.ref.id, "c2");
  assert.equal(d.data.cards.c2, undefined);
  assert.equal(d.data.log.length, 2);
  assert.equal(s.done, 2);
});

test("学完了：只剩 20 分钟以后才到点的学习中卡片时返回 null，并给出下一张的时间", () => {
  const s = new Session([deck("a", 1)], { ...P, learningSteps: "30m" }, makeScheduler({ ...P, learningSteps: "30m" }), NOW);
  s.next(NOW);
  s.grade(Rating.Again, NOW);
  assert.equal(s.next(NOW), null);
  assert.ok((s.nextLearnAt() ?? 0) - NOW >= 29 * MIN);
});

test("搁置和暂停：这张拿掉，能撤销", () => {
  const d = deck("a", 2);
  const s = new Session([d], P, F, NOW);
  s.next(NOW);
  s.setAside("bury", NOW);
  assert.equal(d.data.cards.c0.bury, dayNumber(NOW, 4));
  assert.equal(s.next(NOW)?.id, "c1");
  s.setAside("suspend", NOW);
  assert.equal(d.data.cards.c1.susp, 1);
  assert.equal(countsOf([d], NOW, P).new, 0);
  s.undo();
  assert.equal(d.data.cards.c1, undefined);
});

test("新卡均匀穿插在待复习里", () => {
  const due = answer(F, answer(F, null, NOW - 10 * DAY, Rating.Easy), NOW - 10 * DAY, Rating.Good);
  const cards: Record<string, CardRecord> = {};
  for (let i = 0; i < 4; i++) cards[`c${i}`] = { ...due, due: NOW - DAY };
  const s = new Session([deck("a", 6, cards)], P, F, NOW);
  const kinds: string[] = [];
  for (let i = 0; i < 6; i++) {
    s.next(NOW);
    kinds.push(s.currentKind()!);
    s.setAside("bury", NOW);
  }
  assert.deepEqual(kinds, ["new", "review", "review", "new", "review", "review"]);
});

test("复习数据：坏文件当空的；读写排队", async () => {
  assert.deepEqual(parseDeck("{oops", "x.md").cards, {});
  const files = new Map<string, string>();
  const store = new ReviewStore({ read: async (n) => files.get(n) ?? null, write: async (n, t) => void files.set(n, t), list: async () => [...files.keys()] });
  const d = await store.deck("abc", "x.md");
  d.cards.c0 = answer(F, null, NOW, Rating.Good);
  await store.save("abc");
  store.forget("abc");
  const again = await store.deck("abc", "x.md");
  assert.equal(again.cards.c0.st, State.Learning);
});
