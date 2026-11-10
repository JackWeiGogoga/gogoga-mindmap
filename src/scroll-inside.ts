/**
 * 只滚指定的那个滚动容器，不往外传（#29）。
 * 浏览器的 el.scrollIntoView 和 CodeMirror 的滚动都会一层层往外找能滚的祖先，`overflow: hidden` 的也照滚。
 * 有的主题（Border 的卡片布局）让 Obsidian 外层的 .horizontal-main-container 比可视区高一截，
 * 被滚走后顶部标签栏就被裁掉一块。脑图这边要滚的只有笔记 / 编辑框自己，用这里的办法直接改 scrollTop。
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** 在 scroller 里把 el 滚到中间（center）或刚好露出来（nearest），只动 scroller 自己 */
export function scrollWithin(scroller: HTMLElement, el: HTMLElement, block: "center" | "nearest" = "center"): void {
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  scrollRectWithin(scroller, r.top - s.top, r.bottom - s.top, block);
}

/** el 往外第一个能上下滚的容器，找到 boundary 为止（不出 boundary）；没有就返回 null */
export function scrollParentWithin(el: HTMLElement, boundary: HTMLElement): HTMLElement | null {
  const win = el.ownerDocument.defaultView ?? window;
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const oy = win.getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
    if (cur === boundary) return null;
  }
  return null;
}

/** top/bottom 是相对 scroller 可视区顶部的坐标 */
function scrollRectWithin(scroller: HTMLElement, top: number, bottom: number, block: "center" | "nearest"): void {
  const h = scroller.clientHeight;
  let delta = 0;
  if (block === "center") delta = (top + bottom) / 2 - h / 2;
  else if (top < 0) delta = top;
  else if (bottom > h) delta = Math.min(bottom - h, top);
  if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
}

/**
 * Markdown 编辑器（Obsidian 的 CodeMirror）把第 line 行（0 起）滚到中间，只滚编辑器自己的滚动区。
 * 不在可视范围的行，高度是估算的：先滚一次，等 CodeMirror 量好实际高度再校正两次
 */
export function scrollEditorLineToCenter(cm: EditorView, line: number): void {
  const go = () => {
    if (!cm.dom.isConnected || line + 1 > cm.state.doc.lines) return;
    const block = cm.lineBlockAt(cm.state.doc.line(line + 1).from);
    const sd = cm.scrollDOM;
    const top = cm.documentTop - sd.getBoundingClientRect().top + block.top;
    scrollRectWithin(sd, top, top + block.height, "center");
  };
  go();
  const win = cm.dom.ownerDocument.defaultView ?? window;
  // 用 setTimeout 不用 requestAnimationFrame：编辑器在被挡住的独立窗口里时动画帧不触发
  win.setTimeout(() => {
    go();
    win.setTimeout(go, 50);
  }, 16);
}

/**
 * 节点编辑框用：CodeMirror 要把光标滚进视野时，只在编辑框自己的滚动区里滚，不去滚画布外面的容器。
 * 画布会自己把正在编辑的节点挪进视野。旧版 CodeMirror 没有 scrollHandler 时什么也不加
 */
export function scrollInsideEditor(): Extension {
  const facet = (EditorView as unknown as { scrollHandler?: typeof EditorView.scrollHandler }).scrollHandler;
  if (!facet) return [];
  return facet.of((view, range) => {
    const c = view.coordsAtPos(range.head);
    if (!c) return true;
    // 从编辑框往外，只滚脑图 / 大纲里面那些本来就能滚的容器（大纲列表），到脑图 / 大纲的边界为止
    const win = view.dom.ownerDocument.defaultView ?? window;
    let top = c.top;
    let bottom = c.bottom;
    for (let el: HTMLElement | null = view.scrollDOM; el; el = el.parentElement) {
      const oy = win.getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
        const s = el.getBoundingClientRect();
        const before = el.scrollTop;
        scrollRectWithin(el, top - s.top, bottom - s.top, "nearest");
        top -= el.scrollTop - before;
        bottom -= el.scrollTop - before;
      }
      if (el.classList.contains("gg-mm-root") || el.classList.contains("mm-outline")) break;
    }
    return true;
  });
}
