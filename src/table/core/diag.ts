/**
 * 诊断记录（只在电脑端）：笔记被拼坏、被清空这类问题事后查不出是谁写的，这里留证据。
 *
 * - 黑匣子（默认开）：内存里只留最近 500 条事件（时间、谁、长度、摘要、改了几行），不写盘、不存内容；
 *   发现异常（变空、一次少三成以上、出现拼坏的特征、合并冲突）时，把这些事件和变化前后的全文存一份「事故」。
 * - 详细诊断（默认关，打开 7 天后自动关）：每条事件都追加写进记录文件，和用户一起细查时用。
 *
 * 全部存在库外：系统给 Obsidian 的应用数据目录下的 gogoga-diagnostics/<库>/，git、网盘同步都碰不到。
 * 开关也存在那里（config.json），脑图和表格插件共用一份，按设备各管各的。
 * 两个插件各有一份这个文件（源头在脑图，sync-table 复制给表格），各自一个实例，事故按内容去重。
 * 这里不依赖 Obsidian，记录出任何错都吞掉：诊断不能影响保存和编辑。
 */

export type DiagOrigin = "mindmap" | "table" | "editor" | "external" | "follow";

export interface DiagEvent {
  t: number;
  src: string;
  ev: string;
  [k: string]: unknown;
}

export interface DiagConfig {
  /** 黑匣子：内存里记最近的事件，异常时留底 */
  blackbox: boolean;
  /** 详细诊断开到什么时候（毫秒时间戳），0 = 关 */
  detailedUntil: number;
  /** 留底时存笔记全文（关掉只存长度和摘要） */
  saveContent: boolean;
}

export interface Incident {
  id: string;
  dir: string;
  file: string;
  reason: string;
  origin: DiagOrigin;
  time: number;
}

export const DIAG_DEFAULTS: DiagConfig = { blackbox: true, detailedUntil: 0, saveContent: true };
export const DETAILED_DAYS = 7;
const RING = 500;
const MAX_INCIDENTS = 30;
const MAX_INCIDENT_BYTES = 20 * 1024 * 1024;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** 短摘要（cyrb53）：只用来比「是不是同一份内容」 */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(8, "0").slice(-8);
}

/**
 * 「拼坏」的特征分：没配对的 <span> / <mark>，加上一行中间冒出来的「Tab + - 」（别的行的开头被拼进来）。
 * 正常写作偶尔也会有一两处（正在打的标签），所以看的是变化量
 */
export function damageScore(s: string): number {
  const n = (re: RegExp) => s.match(re)?.length ?? 0;
  return Math.abs(n(/<span\b/g) - n(/<\/span>/g)) + Math.abs(n(/<mark\b/g) - n(/<\/mark>/g)) + n(/[^\s]\t+- /g);
}

/** Templater 的 <% … %> 写法（新建笔记时先写进模板原文，Templater 再换成日期、链接） */
const TEMPLATER_RE = /<%[\s\S]*?%>/g;

/** 这次变化算不算异常：变空、一次少三成以上、拼坏的特征多了 3 处以上 */
export function anomalyOf(before: string | null, after: string): string | null {
  if (before === null || before === after) return null;
  if (before.trim() !== "" && after.trim() === "") return "empty";
  if (before.length >= 200 && after.length < before.length * 0.7) {
    // 模板展开：少掉的是 <% … %> 换成了短得多的结果（首页、日记插件建笔记时常见）。不算模板写法再比一次
    const tags = before.match(TEMPLATER_RE)?.length ?? 0;
    const expanded = tags > (after.match(TEMPLATER_RE)?.length ?? 0);
    const plain = before.replace(TEMPLATER_RE, "").length;
    if (!expanded || after.length < plain * 0.7) return "shrink";
  }
  if (damageScore(after) - damageScore(before) >= 3) return "damage";
  return null;
}

/** 粗算改了几行：两边按行计数，对不上的算增删（不管顺序，够判断规模） */
export function lineDelta(before: string, after: string): { add: number; del: number } {
  const count = new Map<string, number>();
  for (const l of before.split("\n")) count.set(l, (count.get(l) ?? 0) + 1);
  let add = 0;
  for (const l of after.split("\n")) {
    const c = count.get(l) ?? 0;
    if (c > 0) count.set(l, c - 1);
    else add++;
  }
  let del = 0;
  for (const c of count.values()) del += c;
  return { add, del };
}

interface NodeApi {
  fs: {
    existsSync(p: string): boolean;
    mkdirSync(p: string, o: { recursive: boolean }): void;
    readFileSync(p: string, enc: "utf8"): string;
    writeFileSync(p: string, d: string): void;
    appendFileSync(p: string, d: string): void;
    readdirSync(p: string): string[];
    statSync(p: string): { size: number; isDirectory(): boolean };
    renameSync(a: string, b: string): void;
    rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  };
  path: { join(...p: string[]): string };
  home: string;
  platform: string;
  env: Record<string, string | undefined>;
}

function nodeApi(): NodeApi | null {
  try {
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    if (!req) return null;
    const proc = (window as unknown as { process?: { platform: string; env: Record<string, string | undefined> } }).process;
    if (!proc) return null;
    const os = req("os") as { homedir(): string };
    return { fs: req("fs") as NodeApi["fs"], path: req("path") as NodeApi["path"], home: os.homedir(), platform: proc.platform, env: proc.env };
  } catch {
    return null;
  }
}

/** 系统给 Obsidian 的应用数据目录（和 Obsidian 自己的 obsidian.json 同一处）下的 gogoga-diagnostics */
export function diagRoot(n: NodeApi): string {
  const { path, home, platform, env } = n;
  const appData =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "obsidian")
      : platform === "win32"
        ? path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "obsidian")
        : path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "obsidian");
  return path.join(appData, "gogoga-diagnostics");
}

const stamp = (t: number) => {
  const d = new Date(t);
  const p = (x: number, w = 2) => String(x).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export class Diag {
  /** 这个库的诊断目录；不是电脑端（拿不到文件系统）时为 null，整个诊断什么都不做 */
  readonly base: string | null;
  private readonly n: NodeApi | null;
  private ring: DiagEvent[] = [];
  private queue: string[] = [];
  private timer: number | null = null;
  private cfg: { at: number; v: DiagConfig } | null = null;
  /** 刚留过底的（文件 + 内容摘要）：同一次异常脑图和 Markdown 两边都会看到，只留一份 */
  private recent = new Map<string, number>();

  constructor(
    readonly src: string,
    vaultKey: string,
    private readonly env: () => Record<string, unknown>,
    private readonly onIncident?: (inc: Incident, before: string) => void,
  ) {
    this.n = nodeApi();
    this.base = this.n ? this.n.path.join(diagRoot(this.n), vaultKey) : null;
  }

  config(): DiagConfig {
    const now = Date.now();
    if (this.cfg && now - this.cfg.at < 2000) return this.cfg.v;
    let v = { ...DIAG_DEFAULTS };
    try {
      if (this.n && this.base) {
        const p = this.n.path.join(this.base, "config.json");
        if (this.n.fs.existsSync(p)) v = { ...v, ...(JSON.parse(this.n.fs.readFileSync(p, "utf8")) as Partial<DiagConfig>) };
      }
    } catch {
      // 配置坏了按默认
    }
    this.cfg = { at: now, v };
    return v;
  }

  setConfig(patch: Partial<DiagConfig>): void {
    if (!this.n || !this.base) return;
    const v = { ...this.config(), ...patch };
    try {
      this.n.fs.mkdirSync(this.base, { recursive: true });
      this.n.fs.writeFileSync(this.n.path.join(this.base, "config.json"), JSON.stringify(v, null, 2));
    } catch {
      // 写不了就算了
    }
    this.cfg = { at: Date.now(), v };
    this.log("config", { ...v });
  }

  /** 黑匣子开着（电脑端、没关） */
  get on(): boolean {
    return !!this.base && this.config().blackbox;
  }

  detailed(): boolean {
    if (!this.on) return false;
    const until = this.config().detailedUntil;
    return until > Date.now();
  }

  /** 最近的事件（导出时用） */
  events(): DiagEvent[] {
    return this.ring.slice();
  }

  log(ev: string, data: Record<string, unknown> = {}): void {
    if (!this.on) return;
    try {
      const e: DiagEvent = { t: Date.now(), src: this.src, ev, ...data };
      this.ring.push(e);
      if (this.ring.length > RING) this.ring.splice(0, this.ring.length - RING);
      if (this.detailed()) {
        this.queue.push(JSON.stringify(e));
        if (this.timer === null) this.timer = window.setTimeout(() => this.flush(), 2000);
      }
    } catch {
      // 诊断出错不影响任何功能
    }
  }

  /**
   * 一篇笔记的内容从 before 变成 after：记一条，异常就留底。
   * origin：谁让它变的（脑图写盘、表格写回、Markdown 编辑器存盘、外部改了文件、脑图跟随编辑器）
   */
  change(file: string, before: string | null, after: string, origin: DiagOrigin, extra: Record<string, unknown> = {}): Incident | null {
    if (!this.on) return null;
    try {
      const d = before === null ? null : lineDelta(before, after);
      this.log("change", { file, origin, len: after.length, h: hashText(after), prev: before === null ? null : hashText(before), prevLen: before?.length, add: d?.add, del: d?.del, ...extra });
      const reason = anomalyOf(before, after);
      if (reason && before !== null) return this.incident(file, reason, origin, before, after);
    } catch {
      // 同上
    }
    return null;
  }

  /** 脑图按行合并时两边改到同一处：三份都留下 */
  conflict(file: string, base: string, ours: string, theirs: string): Incident | null {
    if (!this.on) return null;
    try {
      this.log("conflict", { file, base: hashText(base), ours: hashText(ours), theirs: hashText(theirs) });
      return this.incident(file, "conflict", "external", ours, theirs, { "base.md": base });
    } catch {
      return null;
    }
  }

  private incident(file: string, reason: string, origin: DiagOrigin, before: string, after: string, extra: Record<string, string> = {}): Incident | null {
    const n = this.n;
    if (!n || !this.base) return null;
    const now = Date.now();
    const key = hashText(file + "\n" + after).slice(0, 6);
    for (const [k, t] of this.recent) if (now - t > 60_000) this.recent.delete(k);
    if (this.recent.has(key)) return null;
    this.recent.set(key, now);
    const root = n.path.join(this.base, "incidents");
    n.fs.mkdirSync(root, { recursive: true });
    // 另一个插件刚为同一份内容留过底
    if (n.fs.readdirSync(root).some((d) => d.endsWith("-" + key))) return null;
    const id = `${stamp(now)}-${this.src}-${key}`;
    const dir = n.path.join(root, id);
    n.fs.mkdirSync(dir, { recursive: true });
    const save = this.config().saveContent;
    n.fs.writeFileSync(
      n.path.join(dir, "info.json"),
      JSON.stringify(
        { id, time: new Date(now).toISOString(), src: this.src, file, reason, origin, before: { len: before.length, h: hashText(before), damage: damageScore(before) }, after: { len: after.length, h: hashText(after), damage: damageScore(after) }, content: save, env: this.env(), events: this.ring },
        null,
        1,
      ),
    );
    if (save) {
      n.fs.writeFileSync(n.path.join(dir, "before.md"), before);
      n.fs.writeFileSync(n.path.join(dir, "after.md"), after);
      for (const [name, text] of Object.entries(extra)) n.fs.writeFileSync(n.path.join(dir, name), text);
    }
    this.prune(root);
    const inc: Incident = { id, dir, file, reason, origin, time: now };
    this.log("incident", { file, reason, origin, id });
    this.flush();
    try {
      this.onIncident?.(inc, before);
    } catch {
      // 提示出错不影响留底
    }
    return inc;
  }

  /** 事故最多留 30 份、20 MB，多了删最旧的 */
  private prune(root: string): void {
    const n = this.n!;
    const dirs = n.fs.readdirSync(root).sort();
    const size = (d: string) => {
      let s = 0;
      for (const f of n.fs.readdirSync(n.path.join(root, d))) s += n.fs.statSync(n.path.join(root, d, f)).size;
      return s;
    };
    let total = 0;
    const sizes = dirs.map((d) => {
      const s = size(d);
      total += s;
      return s;
    });
    for (let i = 0; i < dirs.length && (dirs.length - i > MAX_INCIDENTS || total > MAX_INCIDENT_BYTES); i++) {
      n.fs.rmSync(n.path.join(root, dirs[i]), { recursive: true, force: true });
      total -= sizes[i];
    }
  }

  /** 详细诊断：攒着的事件追加进记录文件，满 5 MB 轮换一次 */
  flush(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const n = this.n;
    if (!n || !this.base || !this.queue.length) return;
    const lines = this.queue.splice(0).join("\n") + "\n";
    try {
      n.fs.mkdirSync(this.base, { recursive: true });
      const p = n.path.join(this.base, `${this.src}.jsonl`);
      if (n.fs.existsSync(p) && n.fs.statSync(p).size > MAX_LOG_BYTES) n.fs.renameSync(p, n.path.join(this.base, `${this.src}.1.jsonl`));
      n.fs.appendFileSync(p, lines);
    } catch {
      // 同上
    }
  }

  /** 已经存下的：事故份数、记录文件里的事件条数、占用空间 */
  stats(): { incidents: number; events: number; bytes: number } {
    const n = this.n;
    const out = { incidents: 0, events: this.ring.length, bytes: 0 };
    if (!n || !this.base || !n.fs.existsSync(this.base)) return out;
    try {
      const walk = (p: string): void => {
        for (const f of n.fs.readdirSync(p)) {
          const q = n.path.join(p, f);
          const st = n.fs.statSync(q);
          if (st.isDirectory()) walk(q);
          else out.bytes += st.size;
        }
      };
      walk(this.base);
      const inc = n.path.join(this.base, "incidents");
      if (n.fs.existsSync(inc)) out.incidents = n.fs.readdirSync(inc).length;
      for (const f of n.fs.readdirSync(this.base)) if (f.endsWith(".jsonl")) out.events += n.fs.readFileSync(n.path.join(this.base, f), "utf8").split("\n").filter(Boolean).length;
    } catch {
      // 同上
    }
    return out;
  }

  /**
   * 导出诊断包：环境、两个插件内存里的事件、记录文件、全部事故，合成一个 JSON 放进 exports/，返回路径。
   * content=false 不带笔记全文；hideNames 把文件路径换成摘要
   */
  exportBundle(opts: { content: boolean; hideNames: boolean }, others: DiagEvent[] = []): string | null {
    const n = this.n;
    if (!n || !this.base) return null;
    this.flush();
    const name = (p: unknown) => (opts.hideNames && typeof p === "string" ? "f-" + hashText(p) : p);
    const clean = (e: Record<string, unknown>) => ("file" in e ? { ...e, file: name(e.file) } : e);
    const events = [...this.ring, ...others].sort((a, b) => a.t - b.t).map(clean);
    const logs: Record<string, unknown>[] = [];
    const incidents: Record<string, unknown>[] = [];
    try {
      if (n.fs.existsSync(this.base)) {
        for (const f of n.fs.readdirSync(this.base).filter((x) => x.endsWith(".jsonl")).sort())
          for (const l of n.fs.readFileSync(n.path.join(this.base, f), "utf8").split("\n").filter(Boolean)) {
            try {
              logs.push(clean(JSON.parse(l) as Record<string, unknown>));
            } catch {
              // 半行（写到一半）跳过
            }
          }
        const root = n.path.join(this.base, "incidents");
        if (n.fs.existsSync(root))
          for (const d of n.fs.readdirSync(root).sort()) {
            const dir = n.path.join(root, d);
            const info = JSON.parse(n.fs.readFileSync(n.path.join(dir, "info.json"), "utf8")) as Record<string, unknown>;
            const item: Record<string, unknown> = { ...info, file: name(info.file), events: ((info.events as Record<string, unknown>[]) ?? []).map(clean) };
            if (opts.content) for (const f of n.fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) item[f] = n.fs.readFileSync(n.path.join(dir, f), "utf8");
            incidents.push(item);
          }
      }
      const out = n.path.join(this.base, "exports");
      n.fs.mkdirSync(out, { recursive: true });
      const p = n.path.join(out, `gogoga-diagnostics-${stamp(Date.now())}.json`);
      n.fs.writeFileSync(p, JSON.stringify({ generated: new Date().toISOString(), options: opts, config: this.config(), env: this.env(), events, logs, incidents }, null, 1));
      return p;
    } catch {
      return null;
    }
  }

  /** 清空记录和事故（开关设置留着） */
  clear(): void {
    const n = this.n;
    this.ring = [];
    this.queue = [];
    this.recent.clear();
    if (!n || !this.base || !n.fs.existsSync(this.base)) return;
    try {
      for (const f of n.fs.readdirSync(this.base)) if (f !== "config.json") n.fs.rmSync(n.path.join(this.base, f), { recursive: true, force: true });
    } catch {
      // 同上
    }
  }
}
