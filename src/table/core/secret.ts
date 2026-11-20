/**
 * 加密列的密文：和 Meld Encrypt 3.x 的行内加密（γ，v3）一模一样，两边能互相解开。
 *
 *   %%🔐γ <base64> 🔐%%            笔记里藏起来的写法（我们写这种）
 *   🔐γ 💡提示💡<base64> 🔐         阅读视图里看得见的写法、带提示的写法（读得懂）
 *
 * base64 解出来：第 0 字节 1（算法套件：PBKDF2-SHA512 + AES-256-GCM），1～3 字节迭代次数，4～19 salt，20～31 iv，后面是密文（含 16 字节认证标签）。
 * 认证附加数据（AAD）是 {version, kdf, cipher} 的 JSON，键的顺序和 Meld 一样，改一个字都解不开。
 *
 * 也读得懂 Meld 更早的 β（v2）：base64 解出来是 iv 16 字节 + salt 16 字节 + 密文，PBKDF2-SHA512 21 万次，没有 AAD。
 * 只读不写：改过的 β 格子重新加密成 γ。
 *
 * 只用 WebCrypto（Obsidian 桌面、手机、node 测试都有），不碰 Obsidian。
 * 同一个主密码下所有格子共用一个 salt（存在设置里的校验密文上）：一次会话只派生一次密钥，每格的 iv 各不相同。
 * Meld 每格自带 salt，照样能单独解开任何一格
 */

const PREFIX_HIDDEN = "%%🔐γ ";
const PREFIX_SHOWN = "🔐γ ";
const PREFIX_HIDDEN_B = "%%🔐β ";
const PREFIX_SHOWN_B = "🔐β ";
/** β 的迭代次数（写死在 Meld 的 CryptoHelper2304 里） */
const ITERATIONS_B = 210000;
const SUFFIX_HIDDEN = " 🔐%%";
const SUFFIX_SHOWN = " 🔐";
const HINT = "💡";

/** Meld 现在写的迭代次数，也是它 v3 读的时候认的最少次数 */
export const ITERATIONS = 220000;
const MAX_ITERATIONS = 2000000;

/** 笔记里的一段密文 */
export interface SecretText {
  /** base64（套件、迭代、salt、iv、密文） */
  data: string;
  hint: string;
  /** 🔐γ … 🔐（阅读视图里看得见）还是 %%🔐γ … 🔐%% */
  shown: boolean;
  /** 3 是 γ，2 是 Meld 更早的 β */
  v: 2 | 3;
}

/** 一段密文（整段就是它，前后可以有空白）；不是 γ、β 格式的返回 null */
export function parseSecret(text: string): SecretText | null {
  const s = text.trim();
  const prefix = [PREFIX_HIDDEN, PREFIX_SHOWN, PREFIX_HIDDEN_B, PREFIX_SHOWN_B].find((p) => s.startsWith(p));
  if (!prefix) return null;
  const shown = !prefix.startsWith("%%");
  const v = prefix.includes("β") ? 2 : 3;
  const suffix = shown ? SUFFIX_SHOWN : SUFFIX_HIDDEN;
  if (!s.endsWith(suffix) || s.length < prefix.length + suffix.length) return null;
  let body = s.slice(prefix.length, s.length - suffix.length);
  let hint = "";
  if (body.startsWith(HINT)) {
    const end = body.indexOf(HINT, HINT.length);
    if (end < 0) return null;
    hint = body.slice(HINT.length, end);
    body = body.slice(end + HINT.length);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) return null;
  return { data: body, hint, shown, v };
}

/** 写成笔记里的样子（默认藏起来的 %%…%% 写法） */
export function writeSecret(data: string, hint = "", shown = false): string {
  const h = hint ? HINT + hint + HINT : "";
  return shown ? `${PREFIX_SHOWN}${h}${data}${SUFFIX_SHOWN}` : `${PREFIX_HIDDEN}${h}${data}${SUFFIX_HIDDEN}`;
}

const SECRET_RUN = /(?:%%)?🔐[γβ] [\s\S]*? 🔐(?:%%)?/g;

/**
 * 一格里的几段密文（合并格子会把几格拼在一起）：整格只有密文和空白时返回各段，有别的字（明文）返回 null。
 * 空格子返回 []
 */
export function secretParts(text: string): SecretText[] | null {
  const parts: SecretText[] = [];
  let rest = text;
  for (const m of text.match(SECRET_RUN) ?? []) {
    const p = parseSecret(m);
    if (!p) return null;
    parts.push(p);
    rest = rest.replace(m, "");
  }
  return rest.trim() ? null : parts;
}

/** 一段文字（整篇笔记）里所有的密文段 */
export function findSecrets(text: string): string[] {
  return (text.match(SECRET_RUN) ?? []).filter((m) => parseSecret(m));
}

/** 整格都是密文（或空的） */
export function isSealed(text: string): boolean {
  return secretParts(text) !== null;
}

// ---------- base64（Meld 要标准的、带补齐的写法） ----------

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- 加密、解密 ----------

export interface Envelope {
  /** 3 是 γ（有 AAD），2 是 β（没有） */
  v: 2 | 3;
  iterations: number;
  salt: Uint8Array;
  iv: Uint8Array;
  cipher: Uint8Array;
}

/** 拆开 base64（v 是 parseSecret 认出的版本）；格式不对返回 null */
export function openData(data: string, v: 2 | 3 = 3): Envelope | null {
  let b: Uint8Array;
  try {
    b = fromBase64(data);
  } catch {
    return null;
  }
  if (v === 2) return b.length < 48 ? null : { v, iterations: ITERATIONS_B, iv: b.slice(0, 16), salt: b.slice(16, 32), cipher: b.slice(32) };
  if (b.length < 48 || b[0] !== 1) return null;
  const iterations = b[1] * 65536 + b[2] * 256 + b[3];
  if (iterations < ITERATIONS || iterations > MAX_ITERATIONS) return null;
  return { v, iterations, salt: b.slice(4, 20), iv: b.slice(20, 32), cipher: b.slice(32) };
}

/** 一段笔记里的密文直接拆开 */
export function envelopeOf(text: string): Envelope | null {
  const p = parseSecret(text);
  return p ? openData(p.data, p.v) : null;
}

function packData(e: Envelope): string {
  const b = new Uint8Array(32 + e.cipher.length);
  b[0] = 1;
  b[1] = (e.iterations >>> 16) & 255;
  b[2] = (e.iterations >>> 8) & 255;
  b[3] = e.iterations & 255;
  b.set(e.salt, 4);
  b.set(e.iv, 20);
  b.set(e.cipher, 32);
  return toBase64(b);
}

/** Meld 的认证附加数据：键的顺序不能变 */
function aad(iterations: number, salt: Uint8Array, iv: Uint8Array): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      version: "3.0",
      kdf: { name: "PBKDF2", hash: "SHA-512", iterations, salt: toBase64(salt) },
      cipher: { name: "AES-GCM", keyLength: 256, iv: toBase64(iv), tagLength: 128 },
    }),
  );
}

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

/** 主密码 + salt → 密钥（PBKDF2-SHA512，桌面上 22 万次约 35ms，手机上要慢几倍，所以要缓存） */
export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", buf(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-512", salt: buf(salt), iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** 用派生好的密钥加密，返回 base64（每次新的随机 iv） */
export async function encryptData(key: CryptoKey, salt: Uint8Array, iterations: number, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv), tagLength: 128, additionalData: buf(aad(iterations, salt, iv)) }, key, buf(new TextEncoder().encode(text)));
  return packData({ v: 3, iterations, salt, iv, cipher: new Uint8Array(cipher) });
}

/** 解开；密钥不对、被改过返回 null */
export async function decryptData(key: CryptoKey, e: Envelope): Promise<string | null> {
  try {
    const algo: AesGcmParams = e.v === 2 ? { name: "AES-GCM", iv: buf(e.iv) } : { name: "AES-GCM", iv: buf(e.iv), tagLength: 128, additionalData: buf(aad(e.iterations, e.salt, e.iv)) };
    const plain = await crypto.subtle.decrypt(algo, key, buf(e.cipher));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** 一次性：用密码加密成笔记里的写法（测试、校验密文用；大量加密走 SecretBox，密钥只派生一次） */
export async function encryptText(password: string, text: string, salt = newSalt(), iterations = ITERATIONS): Promise<string> {
  return writeSecret(await encryptData(await deriveKey(password, salt, iterations), salt, iterations, text));
}

/** 一次性：用密码解开笔记里的一段密文 */
export async function decryptText(password: string, text: string): Promise<string | null> {
  const e = envelopeOf(text);
  if (!e) return null;
  return decryptData(await deriveKey(password, e.salt, e.iterations), e);
}
