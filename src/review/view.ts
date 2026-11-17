/**
 * 复习标签页，界面和按键照 Anki：
 * - 复习主页：牌组列表（按文件夹分层），新卡蓝、学习中红、待复习绿
 * - 牌组概览：三个数和「开始学习」
 * - 复习：内容居中；底栏左「编辑」、中间剩余数和主按钮、右「更多」。空格翻面，翻面后 1–4 评分，空格 = 良好
 * 卡片内容每次从笔记现读，按脑图的样子渲染（Obsidian 的 Markdown 渲染）；填空的高亮遮成横线。
 */
import { ItemView, MarkdownRenderer, Menu, Modal, Notice, Platform, Scope, setIcon, setTooltip, TFile, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { subtreeToList } from "../markdown";
import { type MindNode, pathOf } from "../model";
import { taskState } from "../inline";
import { dayNumber, formatInterval, type Grade, Rating, State } from "./core/schedule";
import { Session } from "./core/session";
import { todayCounts } from "./core/store";
import { crumbOf, displayText, isMultiChoice, type MapCard } from "./mindmap-cards";
import type { ReviewService, Scope as ReviewScope } from "./service";

export const VIEW_TYPE_REVIEW = "gogoga-mindmap-review";

export interface ReviewViewHost {
  service: ReviewService;
  settings(): { reviewTimer: boolean; reviewCrumb: boolean };
  /** 在脑图里打开这张图，选中 rv 是 id 的节点 */
  openNode(file: TFile, reviewId: string | undefined, path: string): Promise<void>;
  openSettings(): void;
}

type Screen = { kind: "home" } | { kind: "overview"; scope: ReviewScope } | { kind: "study"; scope: ReviewScope };

const GRADE_KEYS: Record<Grade, "review.again" | "review.hard" | "review.good" | "review.easy"> = {
  [Rating.Again]: "review.again",
  [Rating.Hard]: "review.hard",
  [Rating.Good]: "review.good",
  [Rating.Easy]: "review.easy",
};

const units = () => ({ m: t("review.unitM"), h: t("review.unitH"), d: t("review.unitD"), mo: t("review.unitMo"), y: t("review.unitY") });

export class ReviewView extends ItemView {
  private screen: Screen = { kind: "home" };
  private session: Session | null = null;
  private byKey = new Map<string, { file: TFile; card: MapCard }>();
  private shown = false;
  private cardStart = 0;
  private timer = 0;
  private waitTimer = 0;
  private collapsed = new Set<string>();
  private unsub: (() => void) | null = null;
  private renderSeq = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private host: ReviewViewHost,
  ) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    const key = (k: string, fn: () => void, mods: ("Mod" | "Shift")[] = []) =>
      this.scope!.register(mods, k, (ev) => {
        if (ev.isComposing) return;
        fn();
        return false;
      });
    key(" ", () => this.onPrimary());
    key("Enter", () => this.onPrimary());
    for (const g of [1, 2, 3, 4] as Grade[]) key(String(g), () => this.shown && void this.grade(g));
    key("e", () => void this.openCurrent());
    key("E", () => void this.openCurrent(), ["Shift"]);
    key("-", () => void this.setAside("bury"));
    key("@", () => void this.setAside("suspend"), ["Shift"]);
    key("i", () => this.cardInfo());
    key("Escape", () => this.back());
    key("z", () => void this.undo(), ["Mod"]);
  }

  getViewType(): string {
    return VIEW_TYPE_REVIEW;
  }

  getDisplayText(): string {
    return this.screen.kind === "home" ? t("review.title") : `${t("review.title")} · ${this.screen.scope.title}`;
  }

  getIcon(): string {
    return "layers";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("ggmm-review");
    this.contentEl.tabIndex = -1;
    const ro = new ResizeObserver(() => this.updateInset());
    ro.observe(this.contentEl);
    this.register(() => ro.disconnect());
    this.unsub = this.host.service.onChange(() => {
      if (this.screen.kind !== "study") void this.render();
    });
    await this.render();
  }

  async onClose(): Promise<void> {
    this.unsub?.();
    window.clearInterval(this.timer);
    window.clearTimeout(this.waitTimer);
  }

  /** 从别处打开：复习这张图（可以只要一个分支）、一个文件夹，或回到主页 */
  async show(screen: Screen): Promise<void> {
    this.screen = screen;
    this.session = null;
    await this.render();
    this.contentEl.focus();
  }

  private onPrimary(): void {
    if (this.screen.kind === "overview") void this.startStudy(this.screen.scope);
    else if (this.screen.kind === "study") {
      if (!this.session?.current) return;
      if (!this.shown) this.reveal();
      else void this.grade(Rating.Good);
    }
  }

  private back(): void {
    if (this.screen.kind === "study") void this.show({ kind: "overview", scope: this.screen.scope });
    else if (this.screen.kind === "overview") void this.show({ kind: "home" });
  }

  private async render(): Promise<void> {
    const seq = ++this.renderSeq;
    window.clearInterval(this.timer);
    window.clearTimeout(this.waitTimer);
    const el = this.contentEl;
    if (this.screen.kind === "home") {
      const body = createDiv({ cls: "ggmm-rv-home" });
      await this.renderHome(body);
      if (seq !== this.renderSeq) return;
      el.replaceChildren(body);
    } else if (this.screen.kind === "overview") {
      const body = createDiv({ cls: "ggmm-rv-overview" });
      await this.renderOverview(body, this.screen.scope);
      if (seq !== this.renderSeq) return;
      el.replaceChildren(body);
    } else await this.renderStudy();
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }

  // ---------- 复习主页 ----------

  private async renderHome(el: HTMLElement): Promise<void> {
    const svc = this.host.service;
    el.createEl("h4", { text: t("review.title") });
    const files = svc.deckFiles();
    if (!files.length) {
      el.createDiv({ cls: "ggmm-rv-empty", text: t("review.empty") });
      return;
    }
    // 文件夹树：每层先文件夹后文件
    interface Folder {
      path: string;
      name: string;
      folders: Map<string, Folder>;
      files: TFile[];
    }
    const root: Folder = { path: "", name: "", folders: new Map(), files: [] };
    for (const f of files) {
      let cur = root;
      const parts = f.path.split("/").slice(0, -1);
      for (const p of parts) {
        const path = cur.path ? `${cur.path}/${p}` : p;
        let next = cur.folders.get(p);
        if (!next) {
          next = { path, name: p, folders: new Map(), files: [] };
          cur.folders.set(p, next);
        }
        cur = next;
      }
      cur.files.push(f);
    }
    const all = (f: Folder): TFile[] => [...f.files, ...[...f.folders.values()].flatMap(all)];
    // 只有一层文件夹又只有它：不画外面那层
    let top = root;
    while (!top.files.length && top.folders.size === 1) top = [...top.folders.values()][0];

    const table = el.createEl("table", { cls: "ggmm-rv-decks" });
    const head = table.createEl("tr");
    head.createEl("th", { text: t("review.colDeck") });
    for (const k of ["review.colNew", "review.colLearn", "review.colReview"] as const) head.createEl("th", { text: t(k) });
    const row = async (name: string, scope: ReviewScope, depth: number, folder?: Folder) => {
      const c = await svc.counts(scope);
      const tr = table.createEl("tr", { cls: "ggmm-rv-deck" });
      const td = tr.createEl("td");
      td.setCssProps({ "--depth": String(depth) });
      if (folder) {
        const fold = td.createSpan({ cls: "ggmm-rv-fold", text: this.collapsed.has(folder.path) ? "▸" : "▾" });
        fold.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (!this.collapsed.delete(folder.path)) this.collapsed.add(folder.path);
          void this.render();
        });
      } else td.createSpan({ cls: "ggmm-rv-fold" });
      const link = td.createSpan({ cls: "ggmm-rv-name", text: name });
      link.addEventListener("click", () => void this.show({ kind: "overview", scope }));
      for (const [n, cls] of [
        [c.new, "is-new"],
        [c.learn, "is-learn"],
        [c.review, "is-review"],
      ] as const)
        tr.createEl("td", { cls: `ggmm-rv-num ${n ? cls : "is-zero"}`, text: String(n) });
    };
    const walk = async (f: Folder, depth: number) => {
      for (const sub of f.folders.values()) {
        await row(sub.name, { files: all(sub), title: sub.name, capTotal: true }, depth, sub);
        if (!this.collapsed.has(sub.path)) await walk(sub, depth + 1);
      }
      for (const file of f.files) await row(file.basename, { files: [file], title: file.basename }, depth);
    };
    await walk(top, 0);

    // 今天复习了多少
    let n = 0;
    let ms = 0;
    const p = svc.prefs();
    for (const f of files) {
      const parsed = await svc.read(f);
      if (!parsed.deckId) continue;
      const d = await svc.store.deck(parsed.deckId, f.path);
      const today = dayNumber(Date.now(), p.dayStartHour);
      for (const e of d.log) if (dayNumber(e.t, p.dayStartHour) === today) {
        n++;
        ms += e.ms ?? 0;
      }
    }
    const foot = el.createDiv({ cls: "ggmm-rv-foot" });
    foot.createDiv({ text: t("review.studiedToday", { n, min: Math.round(ms / 60000) }) });
    const btns = foot.createDiv({ cls: "ggmm-rv-btns" });
    const study = btns.createEl("button", { text: t("review.studyAll") });
    study.addEventListener("click", () => void this.show({ kind: "overview", scope: { files, title: t("review.studyAll"), capTotal: false } }));
    const set = btns.createEl("button", { cls: "mod-muted", text: t("review.settings") });
    set.addEventListener("click", () => this.host.openSettings());
  }

  // ---------- 牌组概览 ----------

  private async renderOverview(el: HTMLElement, scope: ReviewScope): Promise<void> {
    const c = await this.host.service.counts(scope);
    el.createEl("h4", { text: scope.title });
    if (scope.files.length === 1) el.createDiv({ cls: "ggmm-rv-src", text: scope.files[0].path });
    const dl = el.createEl("dl");
    for (const [k, n, cls] of [
      ["review.colNew", c.new, "is-new"],
      ["review.colLearn", c.learn, "is-learn"],
      ["review.colReview", c.review, "is-review"],
    ] as const) {
      dl.createEl("dt", { text: t(k) });
      dl.createEl("dd", { cls, text: String(n) });
    }
    const total = c.new + c.learn + c.review;
    if (total) {
      const go = el.createEl("button", { cls: "mod-cta ggmm-rv-start", text: t("review.start") });
      go.addEventListener("click", () => void this.startStudy(scope));
    } else el.createDiv({ cls: "ggmm-rv-msg", text: t("review.doneTitle") });
    const row = el.createDiv({ cls: "ggmm-rv-btns" });
    if (scope.files.length === 1) {
      const open = row.createEl("button", { cls: "mod-muted", text: t("review.openMap") });
      open.addEventListener("click", () => void this.host.openNode(scope.files[0], undefined, scope.branch ?? ""));
    }
    const back = row.createEl("button", { cls: "mod-muted", text: t("review.backHome") });
    back.addEventListener("click", () => void this.show({ kind: "home" }));
  }

  // ---------- 复习 ----------

  private async startStudy(scope: ReviewScope): Promise<void> {
    const svc = this.host.service;
    await svc.ensureIds(scope.files);
    const { decks, byKey } = await svc.scopeDecks(scope);
    // 补 id 之后不该再有临时 id；万一有（笔记读不了），不出这些卡
    for (const d of decks) d.cards = d.cards.filter((c) => !c.id.startsWith("tmp-"));
    this.byKey = byKey;
    this.session = new Session(
      decks.filter((d) => !d.deckId.startsWith("tmp-")),
      svc.prefs(),
      svc.scheduler(),
      Date.now(),
      scope.capTotal ?? decks.length > 1,
    );
    this.screen = { kind: "study", scope };
    await this.render();
    this.contentEl.focus();
  }

  private current(): { file: TFile; card: MapCard } | null {
    const s = this.session;
    const ref = s?.current?.ref;
    return ref ? (this.byKey.get(`${ref.deckId}|${ref.id}`) ?? null) : null;
  }

  private async renderStudy(): Promise<void> {
    const s = this.session;
    const el = this.contentEl;
    if (!s) return;
    const now = Date.now();
    const ref = s.next(now);
    this.shown = false;
    if (!ref) return this.renderDone();
    const hit = this.current();
    if (!hit) {
      // 题删了或移出了复习：跳过
      new Notice(t("review.missing"));
      s.setAside("bury", now);
      return this.renderStudy();
    }
    this.cardStart = now;
    const wrap = createDiv({ cls: "ggmm-rv-study" });
    const top = wrap.createDiv({ cls: "ggmm-rv-top" });
    const crumb = top.createDiv({ cls: "ggmm-rv-crumb" });
    if (this.host.settings().reviewCrumb) {
      // 中心主题 › … › 上级；问答卡的正面就是上级，路径到上级的上级
      const parts = crumbOf(hit.card.node);
      if (hit.card.kind === "answer") parts.pop();
      crumb.setText(parts.join(" › "));
      crumb.addEventListener("click", () => void this.openCurrent());
    }
    const clock = top.createDiv({ cls: "ggmm-rv-clock" });
    if (this.host.settings().reviewTimer) {
      const tick = () => {
        const sec = Math.floor((Date.now() - this.cardStart) / 1000);
        clock.setText(`⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`);
      };
      tick();
      this.timer = window.setInterval(tick, 1000);
    }
    const card = wrap.createDiv({ cls: "ggmm-rv-card" });
    const bot = wrap.createDiv({ cls: "ggmm-rv-bot" });
    el.replaceChildren(wrap);
    await this.renderCard(card, hit, false);
    // 手机上点卡片也能翻面
    card.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("a, img")) return;
      if (!this.shown) this.reveal();
    });
    this.renderBar(bot);
  }

  /**
   * 底栏给浮在上面的东西让位置：手机上 Obsidian 底部悬浮的导航栏（position: fixed）、电脑上右下角的状态栏。
   * 量出压住了多少，底栏下面多留这么多（和脑图工具栏的做法一样，#37）
   */
  private updateInset(): void {
    const doc = this.contentEl.ownerDocument;
    const desktop = !doc.body.classList.contains("is-mobile");
    const r = this.contentEl.getBoundingClientRect();
    let inset = 0;
    for (const b of doc.querySelectorAll<HTMLElement>(desktop ? ".status-bar" : ".mobile-navbar, .mobile-toolbar")) {
      const br = b.getBoundingClientRect();
      if (!br.width || !br.height || getComputedStyle(b).visibility === "hidden") continue;
      if (br.top < r.bottom && br.bottom > r.top && br.left < r.right && br.right > r.left) inset = Math.max(inset, r.bottom - br.top);
    }
    this.contentEl.setCssProps({ "--ggmm-rv-inset": `${Math.round(inset)}px` });
  }

  private renderBar(bot: HTMLElement): void {
    const s = this.session;
    if (!s) return;
    window.requestAnimationFrame(() => this.updateInset());
    bot.empty();
    const edit = bot.createEl("button", { cls: "ggmm-rv-edit", text: t("review.edit") });
    edit.addEventListener("click", () => void this.openCurrent());
    const mid = bot.createDiv({ cls: "ggmm-rv-mid" });
    if (!this.shown) {
      const c = s.counts();
      const kind = s.currentKind();
      const counts = mid.createDiv({ cls: "ggmm-rv-counts" });
      // 和 Anki 一样只写三个数；悬停说清是什么（没用过 Anki 的看不懂）
      const num = (n: number, cls: string, on: boolean, tip: string) => {
        const sp = counts.createSpan({ cls: `${cls}${on ? " is-current" : ""}`, text: String(n) });
        setTooltip(sp, on ? `${tip}\n${t("review.tipCurrent")}` : tip, { placement: "top" });
        return sp;
      };
      num(c.new, "is-new", kind === "new", t("review.tipNew", { n: c.new }));
      counts.appendText(" + ");
      num(c.learn, "is-learn", kind === "learn", t("review.tipLearn", { n: c.learn }));
      counts.appendText(" + ");
      num(c.review, "is-review", kind === "review", t("review.tipReview", { n: c.review }));
      const show = mid.createEl("button", { cls: "mod-cta ggmm-rv-show" });
      show.createSpan({ text: t("review.showAnswer") });
      if (!Platform.isMobile) show.createSpan({ cls: "ggmm-rv-kbd", text: t("review.space") });
      show.addEventListener("click", () => this.reveal());
    } else {
      const now = Date.now();
      const p = s.preview(now);
      const grades = mid.createDiv({ cls: "ggmm-rv-grades" });
      for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
        const b = grades.createEl("button", { cls: `ggmm-rv-grade is-g${g}` });
        b.createSpan({ cls: "ggmm-rv-iv", text: p ? formatInterval(p[g].due - now, units()) : "" });
        b.createSpan({ cls: "ggmm-rv-gname", text: t(GRADE_KEYS[g]) });
        if (!Platform.isMobile) b.createSpan({ cls: "ggmm-rv-kbd", text: g === Rating.Good ? `${g} / ${t("review.space")}` : String(g) });
        b.addEventListener("click", () => void this.grade(g));
      }
    }
    const more = bot.createEl("button", { cls: "ggmm-rv-more", text: `${t("review.more")} ▾` });
    more.addEventListener("click", (ev) => this.moreMenu(ev));
  }

  private reveal(): void {
    const hit = this.current();
    if (!hit || this.shown) return;
    this.shown = true;
    const card = this.contentEl.querySelector<HTMLElement>(".ggmm-rv-card");
    const bot = this.contentEl.querySelector<HTMLElement>(".ggmm-rv-bot");
    if (card) void this.renderCard(card, hit, true);
    if (bot) this.renderBar(bot);
  }

  private async grade(g: Grade): Promise<void> {
    const s = this.session;
    if (!s?.current || !this.shown) return;
    const now = Date.now();
    const deckId = s.grade(g, now, Math.min(now - this.cardStart, 60_000));
    if (deckId) await this.host.service.store.save(deckId);
    this.host.service.changed();
    await this.renderStudy();
  }

  private async setAside(how: "bury" | "suspend"): Promise<void> {
    const s = this.session;
    if (this.screen.kind !== "study" || !s?.current) return;
    const deckId = s.setAside(how, Date.now());
    if (deckId) await this.host.service.store.save(deckId);
    new Notice(t(how === "bury" ? "review.buried" : "review.suspended"));
    this.host.service.changed();
    await this.renderStudy();
  }

  private async undo(): Promise<void> {
    const s = this.session;
    if (this.screen.kind !== "study" || !s?.canUndo()) return;
    // 正在出的那张还没评分：撤销后它回到队列里（快照里有它），上一张重新出
    s.current = null;
    const done = s.undo();
    if (!done) return;
    await this.host.service.store.save(done.deckId);
    this.host.service.changed();
    const hit = this.current();
    if (done.grade) new Notice(t("review.undone", { g: t(GRADE_KEYS[done.grade]) }));
    this.shown = false;
    const card = this.contentEl.querySelector<HTMLElement>(".ggmm-rv-card");
    const bot = this.contentEl.querySelector<HTMLElement>(".ggmm-rv-bot");
    if (card && hit) await this.renderCard(card, hit, false);
    this.cardStart = Date.now();
    if (bot) this.renderBar(bot);
  }

  private async openCurrent(): Promise<void> {
    const hit = this.current();
    if (!hit) return;
    await this.host.openNode(hit.file, hit.card.node.reviewId, pathOf(hit.card.node));
  }

  private moreMenu(ev: MouseEvent): void {
    const m = new Menu();
    m.addItem((i) => i.setTitle(`${t("review.menuOpen")}  E`).setIcon("network").onClick(() => void this.openCurrent()));
    m.addSeparator();
    m.addItem((i) => i.setTitle(`${t("review.menuBury")}  -`).setIcon("eye-off").onClick(() => void this.setAside("bury")));
    m.addItem((i) => i.setTitle(`${t("review.menuSuspend")}  @`).setIcon("pause").onClick(() => void this.setAside("suspend")));
    m.addSeparator();
    m.addItem((i) =>
      i
        .setTitle(`${t("review.menuUndo")}  ${Platform.isMacOS ? "⌘Z" : "Ctrl+Z"}`)
        .setIcon("undo-2")
        .setDisabled(!this.session?.canUndo())
        .onClick(() => void this.undo()),
    );
    m.addItem((i) => i.setTitle(`${t("review.menuInfo")}  I`).setIcon("info").onClick(() => this.cardInfo()));
    m.showAtMouseEvent(ev);
  }

  private cardInfo(): void {
    const s = this.session;
    const ref = s?.current?.ref;
    if (!s || !ref) return;
    const rec = s.record(ref);
    const modal = new Modal(this.app);
    modal.titleEl.setText(t("review.menuInfo"));
    const table = modal.contentEl.createEl("table", { cls: "ggmm-rv-info" });
    const row = (k: string, v: string) => {
      const tr = table.createEl("tr");
      tr.createEl("th", { text: k });
      tr.createEl("td", { text: v });
    };
    const fmt = (ms: number) => new Date(ms).toLocaleString();
    const st: Record<State, string> = { [State.New]: t("review.stateNew"), [State.Learning]: t("review.stateLearn"), [State.Review]: t("review.stateReview"), [State.Relearning]: t("review.stateRelearn") };
    if (!rec || rec.reps === 0) row(t("review.infoState"), t("review.infoNone"));
    else {
      const deck = this.host.service.store.cached(ref.deckId);
      const first = deck?.log.find((e) => e.c === ref.id);
      row(t("review.infoState"), st[rec.st]);
      if (first) row(t("review.infoAdded"), fmt(first.t));
      row(t("review.infoDue"), fmt(rec.due));
      row(t("review.infoReps"), String(rec.reps));
      row(t("review.infoLapses"), String(rec.lapses));
      row(t("review.infoStability"), t("review.days", { n: Math.round(rec.s * 10) / 10 }));
      row(t("review.infoDifficulty"), `${Math.round(rec.d * 10) / 10} / 10`);
    }
    modal.open();
  }

  private renderDone(): void {
    const s = this.session;
    const el = this.contentEl;
    const box = createDiv({ cls: "ggmm-rv-done" });
    const wait = s?.nextLearnAt();
    if (wait) {
      box.createDiv({ cls: "ggmm-rv-msg", text: t("review.waitLearn", { when: formatInterval(wait - Date.now(), units()).replace(/^</, "") }) });
      // 到点了自动出
      this.waitTimer = window.setTimeout(() => void this.renderStudy(), Math.max(1000, wait - Date.now() - 20 * 60_000 + 1000));
    } else {
      box.createDiv({ cls: "ggmm-rv-title", text: t("review.doneTitle") });
      if (s?.done) box.createDiv({ cls: "ggmm-rv-msg", text: t("review.doneStats", { n: s.done, min: Math.max(1, Math.round(s.spent / 60000)) }) });
      void this.nextDue().then((when) => box.createDiv({ cls: "ggmm-rv-msg", text: when ? t("review.doneNext", { when }) : t("review.doneNone") }));
    }
    const back = box.createEl("button", { text: t("review.backHome") });
    back.addEventListener("click", () => void this.show({ kind: "home" }));
    el.replaceChildren(box);
  }

  /** 学完后：范围里下一张什么时候到期 */
  private async nextDue(): Promise<string | null> {
    if (this.screen.kind !== "study") return null;
    const { decks } = await this.host.service.scopeDecks(this.screen.scope);
    let min = Infinity;
    for (const d of decks)
      for (const c of d.cards) {
        const r = d.data.cards[c.id];
        if (r && !r.susp && r.st !== State.New) min = Math.min(min, r.due);
      }
    if (!Number.isFinite(min)) return null;
    const p = this.host.service.prefs();
    const days = dayNumber(min, p.dayStartHour) - dayNumber(Date.now(), p.dayStartHour);
    const time = new Date(min).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (days <= 0) return ` ${time} `;
    if (days === 1) return ` ${t("review.tomorrow")} ${time} `;
    return ` ${new Date(min).toLocaleDateString()} `;
  }

  // ---------- 卡片内容 ----------

  private async md(el: HTMLElement, text: string, path: string): Promise<void> {
    await MarkdownRenderer.render(this.app, text, el, path, this);
  }

  private async renderCard(el: HTMLElement, hit: { file: TFile; card: MapCard }, back: boolean): Promise<void> {
    const { card, file } = hit;
    const n = card.node;
    const body = createDiv({ cls: `ggmm-rv-body is-${card.kind}` });
    if (card.kind === "cloze") {
      const q = body.createDiv({ cls: "ggmm-rv-q" });
      await this.md(q, displayText(n.text), file.path);
      for (const m of q.querySelectorAll("mark")) m.addClass(back ? "ggmm-rv-reveal" : "ggmm-rv-mask");
      if (back && n.note) await this.extra(body, n.note, file.path);
    } else if (card.kind === "answer") {
      const parent = n.parent as MindNode;
      const q = body.createDiv({ cls: "ggmm-rv-q" });
      await this.md(q, displayText(parent.text), file.path);
      if (back) {
        body.createEl("hr", { cls: "ggmm-rv-hr" });
        const a = body.createDiv({ cls: "ggmm-rv-a" });
        await this.md(a, displayText(n.text), file.path);
        await this.subtree(body, n, file.path);
      }
    } else {
      const quiz = body.createDiv({ cls: "ggmm-rv-quiz" });
      const stem = quiz.createDiv({ cls: "ggmm-rv-stem" });
      await this.md(stem, displayText(n.text), file.path);
      stem.createSpan({ cls: "ggmm-rv-badge", text: t(isMultiChoice(n) ? "review.multi" : "review.single") });
      for (const o of n.children) {
        const state = taskState(o.text);
        if (!state) continue;
        const opt = quiz.createDiv({ cls: "ggmm-rv-opt" });
        if (back) opt.addClass(state === "done" ? "is-ok" : "is-no");
        const box = opt.createSpan({ cls: "ggmm-rv-box" });
        if (back && state === "done") setIcon(box, "check");
        const txt = opt.createDiv({ cls: "ggmm-rv-opttext" });
        await this.md(txt, displayText(o.text), file.path);
        if (back) await this.subtree(txt, o, file.path);
      }
      if (back && n.note) await this.extra(body, n.note, file.path);
    }
    // 读完再换，翻面时不闪
    el.replaceChildren(body);
  }

  /** 子节点（和备注）按缩进列在答案下面，小一号、灰一点 */
  private async subtree(el: HTMLElement, n: MindNode, path: string): Promise<void> {
    if (n.note) await this.extra(el, n.note, path);
    if (!n.children.length) return;
    const list = n.children.map((c) => subtreeToList(c, "\t", true)).join("");
    const box = el.createDiv({ cls: "ggmm-rv-extra" });
    await this.md(box, list, path);
  }

  private async extra(el: HTMLElement, note: string, path: string): Promise<void> {
    const box = el.createDiv({ cls: "ggmm-rv-extra" });
    await this.md(box, note, path);
  }
}

/** 今天这个牌组学了几张（给别处用：比如工具栏的提示） */
export { todayCounts };
