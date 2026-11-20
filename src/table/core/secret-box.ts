/**
 * 主密码的会话：解锁一次，所有表格的加密列都能看、能改；过一阵不用自动锁上（忘掉密码、密钥和解开的明文）。
 *
 * - 设置里存一段「校验密文」（主密码加密的固定文字，带提示）：解锁时拿它核对密码，所有格子都用它的 salt，
 *   一次会话只派生一次密钥（每格 iv 不同）。设置丢了（新设备）就拿要解的格子核对，再补一段校验密文
 * - 密码、密钥、明文只在内存里；文件里永远只有密文
 * - 问密码、存设置、钥匙串由宿主给（Obsidian 的弹窗、data.json、app.secretStorage），这里不碰 Obsidian
 */

import { decryptData, deriveKey, encryptData, envelopeOf, ITERATIONS, newSalt, openData, parseSecret, secretParts, toBase64, writeSecret } from "./secret";

/** 校验密文里加密的那句话 */
const CHECK_TEXT = "gogoga-table";

export interface SecretBoxIO {
  /**
   * 问主密码。setup：第一次设（输两遍，可以写提示），返回密码和提示；change：换新的主密码（和 setup 一样）；unlock：解锁，verify 核对（错了弹窗里提示、不关），
   * 返回核对通过的密码。取消返回 null
   */
  ask(mode: "setup" | "unlock" | "change", hint: string, verify: (password: string) => Promise<boolean>): Promise<{ password: string; hint: string } | null>;
  /** 设置里存的校验密文（没有返回 null） */
  loadCheck(): string | null;
  saveCheck(check: string): void;
  /** 钥匙串里记着的主密码（没开、没有返回 null） */
  remembered?(): string | null;
  /** 多久不用自动锁上（毫秒，0 不自动锁） */
  lockAfter(): number;
  /** 定时器（Obsidian 里用 window.setTimeout，测试里用 node 的）；返回取消的函数 */
  later(fn: () => void, ms: number): () => void;
  /** 锁上、解锁了（编辑器另外用 subscribe 听） */
  changed?(): void;
}

export class SecretBox {
  private password: string | null = null;
  /** 主 salt（校验密文的）：新加密的格子都用它 */
  private salt: Uint8Array | null = null;
  /** salt+迭代次数 → 密钥（当前主密码派生的） */
  private readonly keys = new Map<string, Promise<CryptoKey>>();
  /** 一段密文（base64）→ 明文；null 是这个主密码解不开 */
  private readonly plain = new Map<string, string | null>();
  /** 取消自动锁定的定时器 */
  private timer: (() => void) | null = null;
  private asking: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly io: SecretBoxIO) {}

  /**
   * 锁上、解锁、换了主密码时通知（编辑器据此重画加密格子）。返回取消订阅的函数。
   * 脑图里复制的表格编辑器也订阅这个（用表格插件的会话），所以不能靠编辑器模块里的全局变量
   */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.io.changed?.();
    for (const fn of [...this.listeners]) fn();
  }

  get unlocked(): boolean {
    return this.password !== null;
  }

  /**
   * 解锁（已经开着直接 true）。samples 是要解的格子：设置里没有校验密文时拿它核对密码。
   * 同时好几处要解锁时只弹一次
   */
  unlock(samples: readonly string[] = []): Promise<boolean> {
    if (this.unlocked) {
      this.touch();
      return Promise.resolve(true);
    }
    this.asking ??= this.doUnlock(samples).finally(() => (this.asking = null));
    return this.asking;
  }

  private async doUnlock(samples: readonly string[]): Promise<boolean> {
    const check = this.io.loadCheck();
    const checkEnv = check ? envelopeOf(check) : null;
    const sample = checkEnv ? null : samples.map(envelopeOf).find((e) => e);
    const target = checkEnv ?? sample ?? null;
    // 核对：派生出的密钥能解开校验密文（或要解的那格）就对
    const verify = async (pw: string): Promise<CryptoKey | null> => {
      if (!target) return null;
      const key = await deriveKey(pw, target.salt, target.iterations);
      return (await decryptData(key, target)) !== null ? key : null;
    };
    let password: string | null = null;
    let hint = "";
    const kept = this.io.remembered?.();
    // 钥匙串里的就是主密码：能核对就核对（不对的当没有），还没有任何密文时直接用
    if (kept && (!target || (await verify(kept)))) password = kept;
    else if (!target) {
      const r = await this.io.ask("setup", "", () => Promise.resolve(true));
      if (!r) return false;
      password = r.password;
      hint = r.hint;
    } else {
      const shownHint = check ? (parseSecret(check)?.hint ?? "") : (samples.map(parseSecret).find((p) => p?.hint)?.hint ?? "");
      const r = await this.io.ask("unlock", shownHint, async (pw) => (await verify(pw)) !== null);
      if (!r) return false;
      password = r.password;
      hint = shownHint;
    }
    this.password = password;
    if (checkEnv) this.salt = checkEnv.salt;
    else {
      // 第一次（或新设备上没有设置）：补一段校验密文，以后的格子都用它的 salt
      this.salt = newSalt();
      const key = await this.keyFor(this.salt, ITERATIONS);
      this.io.saveCheck(writeSecret(await encryptData(key, this.salt, ITERATIONS, CHECK_TEXT), hint));
    }
    this.touch();
    this.notify();
    return true;
  }

  /** 锁上：忘掉密码、密钥、明文 */
  lock(): void {
    this.timer?.();
    this.timer = null;
    const was = this.unlocked;
    this.password = null;
    this.salt = null;
    this.keys.clear();
    this.plain.clear();
    if (was) this.notify();
  }

  /** 用了一下：自动锁定重新计时 */
  touch(): void {
    this.timer?.();
    this.timer = null;
    const ms = this.io.lockAfter();
    if (this.unlocked && ms > 0) this.timer = this.io.later(() => this.lock(), ms);
  }

  private keyFor(salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const id = `${toBase64(salt)}:${iterations}`;
    let k = this.keys.get(id);
    if (!k) {
      k = deriveKey(this.password ?? "", salt, iterations);
      this.keys.set(id, k);
    }
    return k;
  }

  /**
   * 已经解开的格子的明文（同步，画格子用）：undefined 是还没解过（或锁着）、null 是解不开（不是这个主密码），
   * 空格子是 ""。几段密文（合并的格子）用换行连起来
   */
  peek(cell: string): string | null | undefined {
    const parts = secretParts(cell);
    if (!parts) return undefined;
    if (!parts.length) return "";
    if (!this.unlocked) return undefined;
    const out: string[] = [];
    for (const p of parts) {
      const v = this.plain.get(p.data);
      if (v === undefined || v === null) return v;
      out.push(v);
    }
    return out.join("\n");
  }

  /** 解开一格（要先解锁）；解不开返回 null */
  async open(cell: string): Promise<string | null> {
    await this.openAll([cell]);
    return this.peek(cell) ?? null;
  }

  /** 把这些格子都解开放进缓存；返回有没有新解开的（画格子的据此决定要不要重画） */
  async openAll(cells: readonly string[]): Promise<boolean> {
    if (!this.unlocked) return false;
    this.touch();
    let fresh = false;
    const jobs: Promise<void>[] = [];
    const seen = new Set<string>();
    for (const cell of cells)
      for (const p of secretParts(cell) ?? []) {
        if (this.plain.has(p.data) || seen.has(p.data)) continue;
        seen.add(p.data);
        const e = openData(p.data, p.v);
        const pw = this.password;
        jobs.push(
          (async () => {
            const v = e ? await decryptData(await this.keyFor(e.salt, e.iterations), e) : null;
            // 等的时候锁上了（或换了密码）：不往缓存里放
            if (this.password !== pw) return;
            this.plain.set(p.data, v);
            fresh = true;
          })(),
        );
      }
    await Promise.all(jobs);
    return fresh;
  }

  /**
   * 换主密码（要先解锁）：问新密码，返回换的工具。reseal 把一段旧密码的密文换成新密码的（写法、提示照旧；解不开的返回 null），
   * 全部写好后 commit 才换成新密码、存新的校验密文。中途放弃就不调 commit，旧密码照常能用
   */
  async beginRekey(): Promise<{ reseal(segment: string): Promise<string | null>; commit(): void } | null> {
    if (!this.unlocked) return null;
    const r = await this.io.ask("change", "", () => Promise.resolve(true));
    if (!r || !this.unlocked) return null;
    const salt = newSalt();
    const key = await deriveKey(r.password, salt, ITERATIONS);
    const check = writeSecret(await encryptData(key, salt, ITERATIONS, CHECK_TEXT), r.hint);
    return {
      reseal: async (segment) => {
        const p = parseSecret(segment);
        const e = p && openData(p.data, p.v);
        if (!p || !e || !this.unlocked) return null;
        const plain = await decryptData(await this.keyFor(e.salt, e.iterations), e);
        if (plain === null) return null;
        const data = await encryptData(key, salt, ITERATIONS, plain);
        // 写之前再解一次，确认新密文没问题
        const back = openData(data);
        if (!back || (await decryptData(key, back)) !== plain) return null;
        return writeSecret(data, p.hint, p.shown);
      },
      commit: () => {
        this.password = r.password;
        this.salt = salt;
        this.keys.clear();
        this.keys.set(`${toBase64(salt)}:${ITERATIONS}`, Promise.resolve(key));
        this.plain.clear();
        this.io.saveCheck(check);
        this.touch();
        this.notify();
      },
    };
  }

  /** 加密一格（要先解锁）：空的还是空的。顺手记下明文，画的时候不用再解 */
  async seal(text: string): Promise<string> {
    if (!text.trim()) return "";
    if (!this.unlocked || !this.salt) throw new Error("locked");
    this.touch();
    const data = await encryptData(await this.keyFor(this.salt, ITERATIONS), this.salt, ITERATIONS, text);
    this.plain.set(data, text);
    return writeSecret(data);
  }
}
