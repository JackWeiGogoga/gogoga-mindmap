/**
 * 间隔复习和 Obsidian 之间的胶水：哪些笔记是牌组、读出卡片、复习数据存哪、补卡片 id 写回笔记、状态栏的数字。
 * 复习数据放在插件文件夹的 review/ 下，一张图一个 JSON（见 core/store.ts）。
 */
import { type App, normalizePath, TFile } from "obsidian";
import type { FSRS } from "ts-fsrs";
import { parseMarkdown, type RootRule, serializeMarkdown, setFrontmatterValue } from "../markdown";
import { preserveFormat } from "../merge";
import { type MindDoc, pathOf } from "../model";
import { blankBeforeNodeTables } from "../node-table";
import { DEFAULT_REVIEW_PREFS, makeScheduler, type ReviewPrefs } from "./core/schedule";
import { type CardRef, type Counts, countsOf, plan, type ScopeDeck } from "./core/session";
import { ReviewStore } from "./core/store";
import { assignReviewIds, deckIdOf, extractCards, type MapCard, newReviewId, REVIEW_KEY } from "./mindmap-cards";

export interface ReviewHost {
  app: App;
  /** 插件文件夹（.obsidian/plugins/gogoga-mindmap） */
  dir: string;
  prefs(): ReviewPrefs;
  rootRule(): RootRule;
  style(): { maxHeadingLevel: number; indent: string };
}

export interface ParsedDeck {
  file: TFile;
  deckId: string | null;
  doc: MindDoc;
  cards: MapCard[];
  mtime: number;
}

/** 复习范围：一张图（可以只要其中一个分支）、一个文件夹，或全部 */
export interface Scope {
  files: TFile[];
  /** 只复习这个分支（节点路径）；只在一张图时有用 */
  branch?: string;
  title: string;
  /** 几个牌组一起时总数按上限再截一次（文件夹）；「全部」不截 */
  capTotal?: boolean;
}

export class ReviewService {
  readonly store: ReviewStore;
  private cache = new Map<string, ParsedDeck>();
  private sched: FSRS | null = null;
  private schedKey = "";
  private listeners = new Set<() => void>();
  /** 笔记路径 → 它用过的牌组 id（移出复习后再加回来，沿用原来的排期） */
  private byPath = new Map<string, string>();

  constructor(private host: ReviewHost) {
    const adapter = host.app.vault.adapter;
    const dir = normalizePath(`${host.dir}/review`);
    this.store = new ReviewStore({
      read: async (name) => {
        const p = `${dir}/${name}`;
        return (await adapter.exists(p)) ? adapter.read(p) : null;
      },
      write: async (name, text) => {
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        await adapter.write(`${dir}/${name}`, text);
      },
      list: async () => ((await adapter.exists(dir)) ? (await adapter.list(dir)).files.map((f) => f.split("/").pop() ?? f) : []),
    });
  }

  prefs(): ReviewPrefs {
    return { ...DEFAULT_REVIEW_PREFS, ...this.host.prefs() };
  }

  scheduler(): FSRS {
    const p = this.prefs();
    const key = JSON.stringify(p);
    if (!this.sched || key !== this.schedKey) {
      this.sched = makeScheduler(p);
      this.schedKey = key;
    }
    return this.sched;
  }

  /** 读一遍复习数据文件夹，记下每个牌组对应的笔记（启动时调一次） */
  async loadIndex(): Promise<void> {
    for (const [id, path] of await this.store.index()) this.byPath.set(path, id);
  }

  /** 这篇笔记以前用过的牌组 id（没用过返回 null） */
  previousDeck(path: string): string | null {
    return this.byPath.get(path) ?? null;
  }

  /** 笔记改名、挪文件夹：复习数据里记的路径跟着改 */
  async renamed(oldPath: string, newPath: string): Promise<void> {
    this.forget(oldPath);
    const id = this.byPath.get(oldPath);
    if (!id) return;
    this.byPath.delete(oldPath);
    this.byPath.set(newPath, id);
    const d = await this.store.deck(id, newPath);
    d.path = newPath;
    await this.store.save(id);
  }

  /** 数字可能变了（复习了一张、笔记改了、换天了）：状态栏、工具栏、复习主页各自重算 */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** 加入了复习的笔记：frontmatter 里有 mindmap-review */
  deckFiles(): TFile[] {
    const out: TFile[] = [];
    for (const f of this.host.app.vault.getMarkdownFiles()) {
      const v: unknown = this.host.app.metadataCache.getFileCache(f)?.frontmatter?.[REVIEW_KEY];
      if (v === undefined || v === null || v === false || v === "false" || v === "") continue;
      out.push(f);
    }
    return out.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN", { numeric: true }));
  }

  isDeck(path: string): boolean {
    const v: unknown = this.host.app.metadataCache.getCache(path)?.frontmatter?.[REVIEW_KEY];
    return v !== undefined && v !== null && v !== false && v !== "false" && v !== "";
  }

  private parse(text: string, file: TFile): MindDoc {
    return parseMarkdown(text, { fallbackTitle: file.basename, ...this.host.rootRule(), showHidden: false, style: this.host.style() });
  }

  /** 读一张图的卡片（按修改时间缓存） */
  async read(file: TFile): Promise<ParsedDeck> {
    const have = this.cache.get(file.path);
    if (have && have.mtime === file.stat.mtime && have.file === file) return have;
    const doc = this.parse(await this.host.app.vault.cachedRead(file), file);
    const parsed: ParsedDeck = { file, deckId: deckIdOf(doc.frontmatter) || null, doc, cards: extractCards(doc), mtime: file.stat.mtime };
    this.cache.set(file.path, parsed);
    return parsed;
  }

  forget(path: string): void {
    this.cache.delete(path);
  }

  /**
   * 开始复习前：牌组还没有 id、卡片节点还没有 rv（或复制出来重复了）就补上，写回笔记（只改这几处）。
   * 两张笔记的牌组 id 撞了（复制了笔记）：后一张换新的
   */
  async ensureIds(files: TFile[]): Promise<void> {
    const ids = new Map<string, string>();
    for (const f of this.deckFiles()) {
      const id = deckIdOf(frontmatterOf(this.host.app, f));
      if (id && !ids.has(id)) ids.set(id, f.path);
    }
    for (const file of files) {
      const parsed = await this.read(file);
      const dupDeck = parsed.deckId && ids.get(parsed.deckId) !== file.path;
      const needCards = parsed.cards.some((c) => !c.id);
      if (parsed.deckId && !dupDeck && !needCards) continue;
      await this.host.app.vault.process(file, (text) => {
        const doc = this.parse(text, file);
        let changed = assignReviewIds(doc);
        let deckId = deckIdOf(doc.frontmatter);
        if (!deckId || ids.get(deckId) !== file.path) {
          deckId = newReviewId(new Set(ids.keys()));
          ids.set(deckId, file.path);
          doc.frontmatter = setFrontmatterValue(doc.frontmatter, REVIEW_KEY, deckId);
          changed = true;
        }
        if (!changed) return text;
        const next = serializeMarkdown(doc);
        return blankBeforeNodeTables(preserveFormat(text, next, (s) => serializeMarkdown(this.parse(s, file))));
      });
      this.forget(file.path);
    }
  }

  /**
   * 不开脑图也能加入 / 移出复习（命令、文件右键菜单）：直接改笔记，只动 frontmatter、%%review%% 和题上的 rv。
   * 加入时沿用这篇笔记以前用过的牌组 id；移出时 rv 留着。返回加入后有几张卡
   */
  async setFileReview(file: TFile, on: boolean): Promise<number> {
    let cards = 0;
    await this.host.app.vault.process(file, (text) => {
      const doc = this.parse(text, file);
      const clear = (n: MindDoc["root"]) => {
        n.review = undefined;
        n.children.forEach(clear);
        if (n.summary?.topic) clear(n.summary.topic);
      };
      clear(doc.root);
      if (on) {
        const id = deckIdOf(doc.frontmatter) || this.previousDeck(file.path) || newReviewId(new Set(this.byPath.values()));
        doc.frontmatter = setFrontmatterValue(doc.frontmatter, REVIEW_KEY, id);
        assignReviewIds(doc);
        cards = extractCards(doc).length;
      } else doc.frontmatter = setFrontmatterValue(doc.frontmatter, REVIEW_KEY, null);
      const next = serializeMarkdown(doc);
      return blankBeforeNodeTables(preserveFormat(text, next, (s) => serializeMarkdown(this.parse(s, file))));
    });
    this.forget(file.path);
    this.changed();
    return cards;
  }

  /** 复习范围里的牌组和卡片；还没有 id 的卡先用临时 id（只用来数数） */
  async scopeDecks(scope: Scope): Promise<{ decks: ScopeDeck[]; byKey: Map<string, { file: TFile; card: MapCard }> }> {
    const decks: ScopeDeck[] = [];
    const byKey = new Map<string, { file: TFile; card: MapCard }>();
    for (const file of scope.files) {
      const p = await this.read(file);
      const deckId = p.deckId ?? `tmp-${file.path}`;
      const data = p.deckId ? await this.store.deck(p.deckId, file.path) : { v: 1 as const, path: file.path, cards: {}, log: [] };
      if (p.deckId) {
        this.byPath.set(file.path, p.deckId);
        // 复习数据记下笔记路径：移出复习再加回来时按它找回
        if (data.path !== file.path) data.path = file.path;
      }
      const cards: CardRef[] = [];
      for (const c of p.cards) {
        if (scope.branch !== undefined && !under(pathOf(c.node), scope.branch)) continue;
        const id = c.id ?? `tmp-${c.order}`;
        cards.push({ deckId, id, order: c.order });
        byKey.set(`${deckId}|${id}`, { file, card: c });
      }
      decks.push({ deckId, data, cards });
    }
    return { decks, byKey };
  }

  async counts(scope: Scope): Promise<Counts> {
    const { decks } = await this.scopeDecks(scope);
    return countsOf(decks, Date.now(), this.prefs(), scope.capTotal ?? decks.length > 1);
  }

  /** 全库今天要复习多少（状态栏）：各牌组按自己的上限算再加起来 */
  async totalDue(): Promise<number> {
    let n = 0;
    for (const f of this.deckFiles()) {
      const c = await this.counts({ files: [f], title: f.basename });
      n += c.new + c.learn + c.review;
    }
    return n;
  }

  /** 一张图里今天到期（学习中、待复习）的卡片挂在哪些节点上（rv）：画布上画小绿点 */
  async dueNodes(file: TFile): Promise<{ ids: Set<string>; count: number; paths: string[] }> {
    const { decks, byKey } = await this.scopeDecks({ files: [file], title: file.basename });
    const p = plan(decks, Date.now(), this.prefs());
    const ids = new Set<string>();
    for (const it of [...p.learn, ...p.review]) ids.add(it.ref.id.split(":")[0]);
    // 今天要出的每张卡挂在哪个节点（路径）：右键「复习这个分支（N 张到期）」按它数
    const paths: string[] = [];
    for (const it of [...p.learn, ...p.review, ...p.fresh]) {
      const hit = byKey.get(`${it.ref.deckId}|${it.ref.id}`);
      if (hit) paths.push(pathOf(hit.card.node));
    }
    return { ids, count: p.learn.length + p.review.length + p.fresh.length, paths };
  }
}

/** 节点路径在分支下面（含分支自己） */
export function under(path: string, branch: string): boolean {
  return branch === "" || path === branch || path.startsWith(`${branch}/`);
}

function frontmatterOf(app: App, f: TFile): string {
  const v: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.[REVIEW_KEY];
  return `---\n${REVIEW_KEY}: ${typeof v === "string" ? v : String(v)}\n---`;
}

