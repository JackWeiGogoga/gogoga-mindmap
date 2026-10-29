/**
 * 写回时保留原文格式：只有真正改动的地方用新生成的文字，其余行逐字节不动。
 *
 * 做法是三方合并（和 git 合并分支一个道理）：
 * - base：原文解析后再序列化，也就是「插件格式下的原文」
 * - ours：文件里实际的原文，和 base 只差格式（空行、缩进、行尾空格……）
 * - theirs：这次编辑后序列化出来的新文本，和 base 只差内容
 * 两边相对 base 的改动各自算出来，不碰同一段的都应用上；碰到同一段（编辑正好落在格式不同的地方）以新内容为准。
 * 合并完再解析一遍，和 theirs 不是同一棵树就整篇用 theirs —— 最坏也和以前的整篇重写一样。
 */

/**
 * 两个行数组之间的公共行，返回按顺序配对的下标。
 * 先只拿非空行对齐（标题、列表项才是结构的锚点），锚点之间再细对齐 —— 空行太多太像，
 * 直接一起比容易把「## 丙」对到别处，看起来像整段搬了家
 */
export function matchLines(a: string[], b: string[]): [number, number][] {
  const ia: number[] = [];
  const ib: number[] = [];
  a.forEach((l, i) => l.trim() !== "" && ia.push(i));
  b.forEach((l, i) => l.trim() !== "" && ib.push(i));
  if (ia.length === a.length && ib.length === b.length) return matchPlain(a, b);
  const anchors = matchPlain(ia.map((i) => a[i]), ib.map((i) => b[i])).map(([x, y]) => [ia[x], ib[y]] as [number, number]);
  const pairs: [number, number][] = [];
  let pa = 0;
  let pb = 0;
  for (const [x, y] of [...anchors, [a.length, b.length] as [number, number]]) {
    // 两个锚点之间（多是空行和改过的行）再对一次
    for (const [i, j] of matchPlain(a.slice(pa, x), b.slice(pb, y))) pairs.push([i + pa, j + pb]);
    if (x < a.length) pairs.push([x, y]);
    pa = x + 1;
    pb = y + 1;
  }
  return pairs;
}

/** Myers O(ND) 差异，头尾相同的部分先直接配上 */
function matchPlain(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // 头尾相同的部分先直接配上，中间才跑差异，编辑通常只碰一小段
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  const mid = myers(a.slice(head, n - tail), b.slice(head, m - tail));
  for (const [i, j] of mid) pairs.push([i + head, j + head]);
  for (let k = tail; k > 0; k--) pairs.push([n - k, m - k]);
  return pairs;
}

function myers(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // 每一步只存这一步会读到的那段 v（k 从 -d-1 到 d+1），格式差异多的长笔记也只占 O(D²)
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  // 从终点倒着走回去，沿途的斜线就是相同的行
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const at = (k: number) => vd[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  return pairs.reverse();
}

/** 相对 base 的一处改动：把 base[start, end) 换成 lines（start === end 是纯插入） */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

function hunksOf(base: string[], other: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let pb = 0;
  let po = 0;
  for (const [b, o] of [...matchLines(base, other), [base.length, other.length] as [number, number]]) {
    if (b > pb || o > po) hunks.push({ start: pb, end: b, lines: other.slice(po, o) });
    pb = b + 1;
    po = o + 1;
  }
  return hunks;
}

/** 两处改动碰到同一段 base：范围有交叠，或者在同一个位置都要插入；touching 时首尾相接也算 */
function clash(a: Hunk, b: Hunk, touching: boolean): boolean {
  if (touching) return a.start <= b.end && b.start <= a.end;
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  return a.start < b.end && b.start < a.end;
}

/**
 * 三方合并：ours（原文的格式差异）和 theirs（这次的编辑）各自相对 base 的改动，不碰同一段的都应用上；
 * 碰到同一段的合成一组，这一组以 theirs 为准（编辑落在格式不同的地方，那几行按新格式写）。
 * touching：首尾相接的改动也并成一组，用在第一次合并出来的结构不对时（比如备注里一行旧格式、一行新格式拼在一起）
 */
export function merge3(base: string[], ours: string[], theirs: string[], touching = false, refine = false): string[] {
  const all = [...hunksOf(base, ours).map((h) => ({ ...h, side: "ours" as const })), ...hunksOf(base, theirs).map((h) => ({ ...h, side: "theirs" as const }))].sort(
    (a, b) => a.start - b.start || a.end - b.end || (a.side === "theirs" ? 1 : -1),
  );
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < all.length; ) {
    // 收拢互相碰到的一组
    const group = [all[i]];
    let end = all[i].end;
    let j = i + 1;
    while (j < all.length && group.some((g) => clash(g, all[j], touching))) {
      group.push(all[j]);
      end = Math.max(end, all[j].end);
      j++;
    }
    const start = group[0].start;
    out.push(...base.slice(pos, start));
    const theirsHunks = group.filter((g) => g.side === "theirs");
    if (group.length === 1) {
      out.push(...group[0].lines);
    } else if (refine) {
      out.push(...resolve(base, start, end, group.filter((g) => g.side === "ours"), theirsHunks));
    } else {
      // 冲突：这一段按 theirs 的样子来，theirs 没动的 base 行照抄
      let p = start;
      for (const h of theirsHunks) {
        out.push(...base.slice(p, h.start), ...h.lines);
        p = h.end;
      }
      out.push(...base.slice(p, end));
    }
    pos = end;
    i = j;
  }
  out.push(...base.slice(pos));
  return out;
}

/** 把 base[start, end) 按一组改动改写 */
function applyHunks(base: string[], start: number, end: number, hunks: Hunk[]): string[] {
  const out: string[] = [];
  let p = start;
  for (const h of hunks) {
    out.push(...base.slice(p, h.start), ...h.lines);
    p = h.end;
  }
  out.push(...base.slice(p, end));
  return out;
}

const indentOf = (line: string) => /^\s*/.exec(line)![0];

/**
 * 冲突组的细合并：theirs 没动的 base 行，用原文里对应的那一行（只差空白的算对应，原文删掉的空行就不要）；
 * theirs 改了的行，沿用原文那一行的缩进。原文多出来的空行插在原来的位置
 */
function resolve(base: string[], start: number, end: number, oursHunks: Hunk[], theirsHunks: Hunk[]): string[] {
  const slice = base.slice(start, end);
  const oursLines = applyHunks(base, start, end, oursHunks);
  const counterpart = new Map(matchPlain(slice.map((l) => l.trim()), oursLines.map((l) => l.trim())).map(([b, o]) => [b + start, o]));
  const out: string[] = [];
  let q = 0; // oursLines 里下一行还没用过的位置
  const takeOursUpTo = (o: number) => {
    // 原文自己多出来的行（多半是空行）按原来的位置带上
    for (; q < o; q++) if (oursLines[q].trim() === "") out.push(oursLines[q]);
    q = o + 1;
  };
  let p = start;
  const emitBase = (to: number) => {
    for (; p < to; p++) {
      const o = counterpart.get(p);
      if (o === undefined) continue;
      takeOursUpTo(o);
      out.push(oursLines[o]);
    }
  };
  for (const h of theirsHunks) {
    emitBase(h.start);
    const same = h.end - h.start === h.lines.length;
    h.lines.forEach((line, k) => {
      const o = same ? counterpart.get(h.start + k) : undefined;
      if (o === undefined) {
        out.push(line);
        return;
      }
      takeOursUpTo(o);
      const from = indentOf(base[h.start + k]);
      out.push(line.startsWith(from) ? indentOf(oursLines[o]) + line.slice(from.length) : line);
    });
    p = h.end;
  }
  emitBase(end);
  takeOursUpTo(oursLines.length);
  return out;
}

/**
 * 挪了位置的行（移动分支、对调章节）：合并出来是新格式的，原文里同样的那一行被当成删掉了。
 * 新出现的行和「原文被删掉的某行在 base 里的写法」完全一样，说明只是换了位置、层级和内容都没变，就换回原文的写法；
 * 层级变了（缩进不同）的不换，比如删掉父节点后子节点提了一级
 */
function restoreMoved(base: string[], ours: string[], merged: string[]): string[] {
  const asBase = new Map(matchPlain(ours.map((l) => l.trim()), base.map((l) => l.trim())).map(([o, b]) => [o, base[b]]));
  const matched = matchLines(ours, merged);
  const keptOurs = new Set(matched.map(([o]) => o));
  const keptMerged = new Set(matched.map(([, m]) => m));
  const removed = new Map<string, string[]>();
  ours.forEach((l, i) => {
    const b = asBase.get(i);
    if (keptOurs.has(i) || b === undefined || l.trim() === "" || b === l) return;
    const list = removed.get(b) ?? [];
    list.push(l);
    removed.set(b, list);
  });
  return merged.map((l, i) => (keptMerged.has(i) ? l : (removed.get(l)?.shift() ?? l)));
}

/**
 * 把新序列化的文本合并进原文：原文里没被这次编辑碰到的行保持原样。
 * canonical 是「解析再序列化」：传入的文本按同一套解析规则规范化，用来算 base 和校验结果
 */
export function preserveFormat(original: string, next: string, canonical: (text: string) => string): string {
  if (next === original) return next;
  // 换行符按原文的来：整篇都是 \r\n 才先换成 \n 合并、结束后再换回；混着用的不动，\r 就当那一行原有的内容
  const crlf = original.includes("\r\n") && !/(^|[^\r])\n/.test(original);
  const ours = crlf ? original.replace(/\r\n/g, "\n") : original;
  const base = canonical(ours);
  // 原文本来就是插件的格式（插件新建的脑图）：没有要保留的东西
  if (base === ours) return next;
  if (base === next) return original;
  // 合并结果必须和这次编辑想要的完全是同一棵树：先按最细的粒度合并，不对就把相邻的改动并起来再试，还不对宁可整篇重写
  // 依次试：冲突组细合并（保留原文的空白）→ 冲突组按新格式 → 相邻改动也并成组
  const oursLines = ours.split("\n");
  const baseLines = base.split("\n");
  for (const [touching, refine] of [[false, true], [false, false], [true, true], [true, false]]) {
    const lines = merge3(baseLines, oursLines, next.split("\n"), touching, refine);
    for (const merged of [restoreMoved(baseLines, oursLines, lines).join("\n"), lines.join("\n")]) {
      if (canonical(merged) === next) return crlf ? merged.replace(/\n/g, "\r\n") : merged;
    }
  }
  return next;
}
