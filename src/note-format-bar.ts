/**
 * 「选中文字时显示格式栏」（设置，默认关，只在电脑上）：Markdown 笔记的实时预览里选中一段文字，
 * 上方浮出和脑图编辑框一样的格式栏，写进文件的格式也一样（**加粗**、<u>、==高亮==、<span style="color">、<mark style>），
 * 所以在笔记里标的重点脑图里照样显示，反过来也一样。
 * 跨好几行选中时每行分别加；列表符号、标题的 #、引用的 >、任务框、行尾的 %%…%% 标记和 ^块编号 不算进去。
 * 源码模式、阅读视图、代码块、公式块、frontmatter 里不出现
 */

import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { type InlineFormat } from "./format";
import { createFormatBar, type FormatBarOptions } from "./format-bar";
import { canShowFormatBar, formatSelection } from "./note-format-core";

export interface NoteFormatBarOptions {
  /** 每次显示前取：颜色列表跟着设置走 */
  bar: () => Omit<FormatBarOptions, "onFormat">;
}

export function noteFormatBarExtension(o: NoteFormatBarOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      bar: HTMLElement | null = null;
      /** 鼠标按着拖选时先不出来，松开再出 */
      dragging = false;
      readonly onDown = (ev: PointerEvent) => {
        if (ev.button !== 0) return;
        this.dragging = true;
        this.hide();
      };
      readonly onUp = () => {
        if (!this.dragging) return;
        this.dragging = false;
        this.schedule();
      };
      readonly onScroll = () => this.schedule();
      readonly onBlur = () => this.hide();

      constructor(readonly view: EditorView) {
        view.dom.addEventListener("pointerdown", this.onDown);
        view.dom.ownerDocument.addEventListener("pointerup", this.onUp, true);
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
        view.contentDOM.addEventListener("blur", this.onBlur);
      }

      update(u: ViewUpdate) {
        if (u.selectionSet || u.docChanged || u.geometryChanged || u.focusChanged || u.viewportChanged) this.schedule();
      }

      schedule() {
        if (this.dragging) return;
        const view = this.view;
        view.requestMeasure({
          read: () => {
            const state = view.state;
            if (!view.hasFocus || !state.field(editorLivePreviewField, false) || !canShowFormatBar(state)) return null;
            const sel = state.selection.main;
            const a = view.coordsAtPos(sel.from, 1);
            const b = view.coordsAtPos(sel.to, -1);
            const box = view.scrollDOM.getBoundingClientRect();
            if (!a || !b || b.bottom < box.top || a.top > box.bottom) return null;
            return { a, b, box };
          },
          write: (m) => {
            if (!m) {
              this.hide();
              return;
            }
            const bar = this.bar ?? this.show();
            const win = this.view.dom.ownerDocument.defaultView ?? window;
            const w = bar.offsetWidth;
            const h = bar.offsetHeight;
            // 一行里：放在选区正中上方；跨行：从选区开头那里往上放
            const oneLine = Math.abs(m.a.top - m.b.top) < 2;
            const center = oneLine ? (m.a.left + m.b.right) / 2 : m.a.left + w / 2;
            const left = Math.max(8, Math.min(win.innerWidth - w - 8, center - w / 2));
            const above = m.a.top - h - 8;
            const top = above >= Math.max(8, m.box.top) ? above : m.b.bottom + 8;
            bar.style.left = `${Math.round(left)}px`;
            bar.style.top = `${Math.round(top)}px`;
          },
        });
      }

      show(): HTMLElement {
        const doc = this.view.dom.ownerDocument;
        const bar = createFormatBar(doc, { ...o.bar(), onFormat: (fmt) => this.apply(fmt) });
        bar.classList.add("mm-note-format-bar");
        doc.body.append(bar);
        this.bar = bar;
        return bar;
      }

      hide() {
        this.bar?.remove();
        this.bar = null;
      }

      apply(fmt: InlineFormat) {
        const r = formatSelection(this.view.state, fmt);
        if (!r) return;
        this.view.dispatch({ changes: r.changes, selection: r.selection, userEvent: "input.format", scrollIntoView: false });
        this.view.focus();
      }

      destroy() {
        this.hide();
        this.view.dom.removeEventListener("pointerdown", this.onDown);
        this.view.dom.ownerDocument.removeEventListener("pointerup", this.onUp, true);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.view.contentDOM.removeEventListener("blur", this.onBlur);
      }
    },
  );
}
