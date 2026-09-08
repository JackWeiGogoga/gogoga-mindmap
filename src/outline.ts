/**
 * 大纲面板：树的列表视图，和画布双向联动。
 * 点行选中并居中；双击改名；键盘 ↑↓ 移动、Tab/Shift+Tab 升降级、Alt+↑↓ 排序、Enter 加兄弟、Delete 删除、Space 折叠。
 * 所有改动都通过画布的方法进行，Markdown 与画布随之更新。
 */

import type { MindMapCanvas } from "./canvas";
import { plainText } from "./inline";
import { MindNode, visibleChildren } from "./model";

export class OutlinePanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private editing: { node: MindNode; el: HTMLElement; isNew: boolean } | null = null;
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement, private canvas: MindMapCanvas, onClose: () => void) {
    this.el = container;
    this.el.classList.add("mm-outline");
    this.el.tabIndex = 0;
    const header = document.createElement("div");
    header.className = "mm-outline-header";
    const title = document.createElement("span");
    title.textContent = "大纲";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mm-tool mm-outline-close";
    canvas.tipFor(close, "关闭大纲面板", "left");
    close.textContent = "×";
    close.addEventListener("click", onClose);
    header.append(title, close);
    this.list = document.createElement("div");
    this.list.className = "mm-outline-list";
    this.el.append(header, this.list);

    const onKey = (ev: KeyboardEvent) => this.onKeyDown(ev);
    this.el.addEventListener("keydown", onKey);
    this.disposers.push(() => this.el.removeEventListener("keydown", onKey));
    this.refresh();
  }

  destroy(): void {
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
      const row = document.createElement("div");
      row.className = "mm-outline-row";
      row.dataset.id = node.id;
      row.style.setProperty("--depth", String(node.depth));
      if (node === primary) row.classList.add("is-selected");

      const chevron = document.createElement("span");
      chevron.className = "mm-outline-chevron" + (node.children.length ? "" : " is-leaf") + (node.folded ? " is-folded" : "");
      chevron.textContent = node.children.length ? "▾" : "";
      chevron.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.canvas.toggleFold(node);
      });
      row.append(chevron);

      if (node.color) {
        const dot = document.createElement("span");
        dot.className = "mm-outline-dot";
        dot.dataset.color = node.color;
        if (!/^[a-z]+$/.test(node.color)) dot.style.background = node.color;
        row.append(dot);
      }

      const text = document.createElement("span");
      text.className = "mm-outline-text";
      text.textContent = plainText(node.text) || (node.depth === 0 ? "中心主题" : "");
      row.append(text);

      if (node.note) {
        const n = document.createElement("span");
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
      for (const c of visibleChildren(node)) visit(c);
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
      for (const c of visibleChildren(n)) visit(c);
    };
    visit(doc.root);
    return out;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.editing) {
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
    text.textContent = node.text;
    text.setAttribute("contenteditable", "plaintext-only");
    if (!text.isContentEditable) text.setAttribute("contenteditable", "true");
    row.classList.add("is-editing");
    this.editing = { node, el: text, isNew };
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const onBlur = () => {
      text.removeEventListener("blur", onBlur);
      if (this.editing?.el === text) this.commitRename();
    };
    text.addEventListener("blur", onBlur);
  }

  commitRename(cancel = false): void {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const raw = (e.el.textContent ?? "").replace(/\s*\n\s*/g, " ").trim();
    e.el.removeAttribute("contenteditable");
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
