/**
 * 双击查看中的备注进入编辑：找出鼠标下那个字在备注原文里的位置，编辑器打开后光标放在那里（不再跳到最后）。
 *
 * 渲染出来的备注和原文不一一对应（**粗体**、[[链接]] 这些记号渲染后没了），但同一个文字节点里的字和原文是连着的。
 * 取鼠标位置前后各一小段（只在这个文字节点里取），到原文里找；找到几处时挑在全文里相对位置最接近的那处。
 */

/** 原文里找「before + after」这一段，返回 before 结尾处的位置；ratio 是这个字在渲染文字里的相对位置（0～1），多处匹配时挑最近的 */
export function locateSnippet(source: string, before: string, after: string, ratio: number): number | null {
  // 先用长的一段找（越长越不容易认错），找不到再逐步缩短；至少要有 2 个字，免得落到不相干的地方
  for (let n = Math.min(before.length, 16), m = Math.min(after.length, 16); n + m >= 2; ) {
    const b = before.slice(before.length - n);
    const key = b + after.slice(0, m);
    const hits: number[] = [];
    for (let i = source.indexOf(key); i >= 0; i = source.indexOf(key, i + 1)) hits.push(i + b.length);
    if (hits.length) {
      const want = ratio * source.length;
      return hits.reduce((best, h) => (Math.abs(h - want) < Math.abs(best - want) ? h : best));
    }
    // 两边轮流缩短，先缩长的那边
    if (n >= m && n > 0) n--;
    else if (m > 0) m--;
    else break;
  }
  return null;
}

/** 渲染好的备注 container 里，屏幕上 (x, y) 处的字对应原文 source 的位置；对不上返回 null */
export function spotInSource(container: HTMLElement, x: number, y: number, source: string): number | null {
  const doc = container.ownerDocument;
  // 标准的 caretPositionFromPoint（Chromium 128 起有）；没有的（旧的 iOS WebKit）用老的 caretRangeFromPoint
  const pos = doc.caretPositionFromPoint?.(x, y);
  const old = pos ? null : (doc as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
  const node = pos ? pos.offsetNode : old?.startContainer;
  const at = pos ? pos.offset : (old?.startOffset ?? 0);
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;
  const text = node.textContent ?? "";
  // 这个字在整段渲染文字里的相对位置
  const all = doc.createRange();
  all.selectNodeContents(container);
  all.setEnd(node, at);
  const total = container.textContent?.length ?? 0;
  const ratio = total ? all.toString().length / total : 0;
  return locateSnippet(source, text.slice(0, at), text.slice(at), ratio);
}
