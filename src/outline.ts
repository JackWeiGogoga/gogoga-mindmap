/**
 * 大纲面板：树的列表视图，和画布双向联动。
 * 点行选中并居中；双击改名；键盘 ↑↓ 移动、Tab/Shift+Tab 升降级、Alt+↑↓ 排序、Enter 加兄弟、Delete 删除、Space 折叠。
 * 所有改动都通过画布的方法进行，Markdown 与画布随之更新。
 */

import type { MindMapCanvas } from "./canvas";
import { t } from "./i18n";
import { InlineEditor } from "./inline-editor";
import { plainText } from "./inline";
import { isSummaryTopic, MindNode, visibleChildren, withTopics } from "./model";

export class OutlinePanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private editing: { node: MindNode; editor: InlineEditor; isNew: boolean } | null = null;
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement, private canvas: MindMapCanvas, onClose: () => void) {
    this.el = container;
    this.el.classList.add("mm-outline");
    this.el.tabIndex = 0;
    const header = createDiv();
    header.className = "mm-outline-header";
    const title = createSpan();
    title.textContent = t("outline.title");
    const close = createEl("button");
    close.type = "button";
    close.className = "mm-tool mm-outline-close";
    canvas.tipFor(close, t("outline.close"), "left");
    close.textContent = "×";
    close.addEventListener("click", onClose);
    header.append(title, close);
    this.list = createDiv();
    this.list.className = "mm-outline-list";
    this.el.append(header, this.list);

    const onKey = (ev: KeyboardEvent) => this.onKeyDown(ev);
    this.el.addEventListener("keydown", onKey);
    this.disposers.push(() => this.el.removeEventListener("keydown", onKey));
    this.refresh();
  }

  destroy(): void {
    this.editing?.editor.destroy();
    this.editing = null;
    for (const d of this.disposers) d();
    this.el.replaceChildren();
    this.el.classList.remove("mm-outline");
  }

  /** 按当前树重建所有行；折叠的子树不显示 */
  refresh(): void {
    const doc = this.canvas.getDoc();
    if (!doc) return;
    if (this.editing) return; // 改名途中不重建，免得丢焦点
    const scroll = this.list.scrollTop;
    this.list.replaceChildren();
    this.rows.clear();
    const primary = this.canvas.getPrimary();
    const visit = (node: MindNode) => {
      const row = createDiv();
      row.className = "mm-outline-row";
      row.dataset.id = node.id;
      row.style.setProperty("--depth", String(node.depth));
      if (node === primary) row.classList.add("is-selected");
      // 概要主题按 Markdown 里的位置列在它括住的兄弟后面，标一下是概要
      if (isSummaryTopic(node)) row.classList.add("is-summary-topic");

      const chevron = createSpan();
      chevron.className = "mm-outline-chevron" + (node.children.length ? "" : " is-leaf") + (node.folded ? " is-folded" : "");
      chevron.textContent = node.children.length ? "▾" : "";
      chevron.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.canvas.toggleFold(node);
      });
      row.append(chevron);

      if (node.color) {
        const dot = createSpan();
        dot.className = "mm-outline-dot";
        dot.dataset.color = node.color;
        if (!/^[a-z]+$/.test(node.color)) dot.style.background = node.color;
        row.append(dot);
      }

      const text = createSpan();
      text.className = "mm-outline-text";
      if (plainText(node.text)) this.canvas.renderOutlineText(text, node.text);
      else text.textContent = node.depth === 0 ? t("canvas.centralTopic") : "";
      row.append(text);

      if (node.note) {
        const n = createSpan();
        n.className = "mm-outline-note";
        n.textContent = "≡";
        row.append(n);
      }

      row.addEventListener("click", () => {
        this.canvas.select(node);
        this.canvas.centerOn(node);
        this.el.focus({ preventScroll: true });
      });
      row.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        this.startRename(node);
      });
      this.list.append(row);
      this.rows.set(node.id, row);
      for (const c of withTopics(visibleChildren(node))) visit(c);
    };
    visit(doc.root);
    this.list.scrollTop = scroll;
  }

  syncSelection(primary: MindNode | null): void {
    for (const row of this.rows.values()) row.classList.remove("is-selected");
    if (!primary) return;
    const row = this.rows.get(primary.id);
    if (!row) return;
    row.classList.add("is-selected");
    row.scrollIntoView({ block: "nearest" });
  }

  private visibleNodes(): MindNode[] {
    const doc = this.canvas.getDoc();
    if (!doc) return [];
    const out: MindNode[] = [];
    const visit = (n: MindNode) => {
      out.push(n);
      for (const c of withTopics(visibleChildren(n))) visit(c);
    };
    visit(doc.root);
    return out;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.editing) {
      // 输入法组字中的按键归输入法，不然回车会把拼音分隔符一起提交
      if (ev.isComposing || ev.keyCode === 229) {
        ev.stopPropagation();
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.commitRename();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.commitRename(true);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        const node = this.editing.node;
        this.commitRename();
        if (ev.shiftKey) this.canvas.outdentNode(node);
        else this.canvas.indentNode(node);
      }
      ev.stopPropagation();
      return;
    }
    const node = this.canvas.getPrimary();
    const list = this.visibleNodes();
    const idx = node ? list.indexOf(node) : -1;
    const alt = ev.altKey;
    switch (ev.key) {
      case "ArrowUp":
      case "ArrowDown": {
        ev.preventDefault();
        if (alt && node) {
          this.canvas.moveSibling(node, ev.key === "ArrowUp" ? -1 : 1);
          return;
        }
        const next = list[ev.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(list.length - 1, idx + 1)];
        if (next) {
          this.canvas.select(next);
          this.canvas.centerOn(next);
        }
        return;
      }
      case "Tab":
        ev.preventDefault();
        if (!node) return;
        if (ev.shiftKey) this.canvas.outdentNode(node);
        else this.canvas.indentNode(node);
        return;
      case "Enter": {
        ev.preventDefault();
        if (!node) return;
        const created = node.parent ? this.canvas.insertSibling(node) : this.canvas.insertChild(node);
        if (created) this.startRename(created, true);
        return;
      }
      case "Delete":
      case "Backspace":
        ev.preventDefault();
        if (node) this.canvas.deleteNode(node);
        return;
      case " ":
        ev.preventDefault();
        if (node?.children.length) this.canvas.toggleFold(node);
        return;
      case "F2":
        ev.preventDefault();
        if (node) this.startRename(node);
        return;
      default:
        return;
    }
  }

  startRename(node: MindNode, isNew = false): void {
    if (!this.canvas.isEditable()) return;
    if (this.editing) this.commitRename();
    const row = this.rows.get(node.id);
    const text = row?.querySelector<HTMLElement>(".mm-outline-text");
    if (!row || !text) return;
    this.canvas.select(node);
    row.classList.add("is-editing");
    const editor: InlineEditor = new InlineEditor(text, {
      text: node.text,
      selectAll: true,
      multiline: false,
      linkTitle: this.canvas.linkTitle,
      hideSyntax: this.canvas.hideSyntax(),
      // Enter、Esc、Tab 走面板的按键处理（编辑中它会拦下事件，不再往面板上冒）；别的键归编辑框
      onKey: (ev) => {
        this.onKeyDown(ev);
        return ev.defaultPrevented;
      },
      onBlur: () => {
        if (this.editing?.editor === editor) this.commitRename();
      },
    });
    this.editing = { node, editor, isNew };
  }

  commitRename(cancel = false): void {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const raw = e.editor.savedText.replace(/\s*\n\s*/g, " ").trim();
    e.editor.destroy();
    if (cancel ? e.isNew : raw === "" && e.isNew) {
      this.canvas.deleteNode(e.node);
      this.el.focus({ preventScroll: true });
      return;
    }
    if (!cancel && raw !== e.node.text) this.canvas.renameNode(e.node, raw);
    else this.refresh();
    this.el.focus({ preventScroll: true });
  }
}
