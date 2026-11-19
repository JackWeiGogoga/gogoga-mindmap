/**
 * （和 gogoga-table 的 src/core/format-apply.ts 是同一份，表格插件那份由脑图同步过去）
 * 格式栏按钮的入口：清除格式走这里的 clearFormat，其余交给 format.ts 的 applyInlineFormat。
 * 单独放一个文件：清除格式要用 live-preview.ts 的 formatSpans，而 live-preview 本身引用 format.ts，放进 format.ts 会循环引用。
 */

import { applyInlineFormat, type FormatResult, type InlineFormat } from "./format";
import { formatSpans, type FormatSpan } from "./live-preview";

export function applyFormat(text: string, start: number, end: number, fmt: InlineFormat): FormatResult {
  return fmt.kind === "clear" ? clearFormat(text, start, end) : applyInlineFormat(text, start, end, fmt);
}

/**
 * 清除格式（#45）：选中的文字上的加粗、斜体、删除线、下划线、高亮、文字颜色、荧光笔都去掉，和 Obsidian 右键「清除格式」一样。
 * 选中的只是一段格式中间的一截：这段格式在选区两头断开，前后没选中的字保留原来的格式。行内代码不算格式，不动。
 * 选区为空时作用于整段。返回新文字和原来那些字的新位置
 */
export function clearFormat(text: string, start: number, end: number): FormatResult {
  // ***粗斜*** 这类：解析时外层是粗体、里面剩一对单星号，清一遍还留着斜体。在同一段上反复清到不再变
  let r = clearOnce(text, start, end);
  // 选区清完变空（空选区在 clearOnce 里表示「整段」）就不再接着清，免得把选区外的格式也清掉
  for (let i = 0; i < 4 && r.text !== text && r.start < r.end; i++) {
    text = r.text;
    const next = clearOnce(text, r.start, r.end);
    if (next.text === text) break;
    r = next;
  }
  return r;
}

function clearOnce(text: string, start: number, end: number): FormatResult {
  let [s, e] = start === end ? [0, text.length] : [Math.min(start, end), Math.max(start, end)];
  const spans = formatSpans(text).filter((x) => x.kind !== "code");
  // 选区两头切在标记符中间：挪到整个标记符外面（选了半个 ** 也当整个选中）
  for (const x of spans) {
    if (s > x.from && s < x.innerFrom) s = x.from;
    if (s > x.innerTo && s < x.to) s = x.innerTo;
    if (e > x.from && e < x.innerFrom) e = x.innerFrom;
    if (e > x.innerTo && e < x.to) e = x.to;
  }
  if (s >= e) return { text, start, end };
  // 选区两边紧挨着同样多的星号（或下划线）：***粗斜*** 这种解析不准（外层当粗体、里面剩一个星号），按两边较少的数一起算进选区
  for (const ch of ["*", "_"]) {
    let a = 0;
    let b = 0;
    while (s - a - 1 >= 0 && text[s - a - 1] === ch) a++;
    while (e + b < text.length && text[e + b] === ch) b++;
    const n = Math.min(a, b);
    s -= n;
    e += n;
  }
  // 选区两头紧贴着格式的开头 / 收尾标记（编辑框里标签藏着，选的正好是里面的字）：把这些标记也算进选区，一层层往外扩。
  // 不然外层格式会被当成「选区前后还有它的字」，补出空的 <span …></span>
  for (let moved = true; moved; ) {
    moved = false;
    for (const x of spans) {
      if (x.innerFrom === s && x.from < s && x.innerTo <= e) {
        s = x.from;
        moved = true;
      }
      if (x.innerTo === e && x.to > e && x.innerFrom >= s) {
        e = x.to;
        moved = true;
      }
    }
  }
  // 和选中的字有交集的格式。选区前面还有它的字：原来的开头标记留着，在选区开头补一个收尾；
  // 选区后面还有它的字：原来的收尾留着，在选区结尾补一个开头。别的开头 / 收尾标记都删掉
  const hit = spans.filter((x) => s < x.innerTo && e > x.innerFrom);
  if (!hit.length) return { text, start, end };
  const closeAtS: FormatSpan[] = [];
  const openAtE: FormatSpan[] = [];
  const del: [number, number][] = [];
  for (const x of hit) {
    if (x.innerFrom < s) closeAtS.push(x);
    else del.push([x.from, x.innerFrom]);
    if (x.innerTo > e) openAtE.push(x);
    else del.push([x.innerTo, x.to]);
  }
  // 在选区开头补收尾：先收里层再收外层；选区结尾补开头：先开外层再开里层
  closeAtS.sort((a, b) => b.from - a.from);
  openAtE.sort((a, b) => a.from - b.from);
  const closers = closeAtS.map((x) => text.slice(x.innerTo, x.to)).join("");
  const openers = openAtE.map((x) => text.slice(x.from, x.innerFrom)).join("");
  const gone = (i: number) => del.some(([a, b]) => i >= a && i < b);
  let out = "";
  let ns = -1;
  let ne = -1;
  for (let i = 0; i <= text.length; i++) {
    if (i === s) {
      out += closers;
      ns = out.length;
    }
    if (i === e) {
      ne = out.length;
      out += openers;
    }
    if (i < text.length && !gone(i)) out += text[i];
  }
  return { text: out, start: ns, end: ne };
}
