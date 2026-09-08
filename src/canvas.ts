/**
 * 画布：把树渲染成 HTML 节点 + SVG 连线，负责平移缩放、选择（多选/框选）、拖拽换父、
 * 内联编辑、备注编辑、键盘操作。不依赖 obsidian 模块，浏览器调试页和代码块渲染器共用。
 */

import {
  addChild,
  addSibling,
  findByPath,
  isAncestor,
  MindDoc,
  MindNode,
  moveNode,
  pathOf,
  removeNode,
  visibleChildren,
  walk,
} from "./model";
import {
  Bounds,
  curvePath,
  DEFAULT_LAYOUT,
  edgeGeometry,
  elbowPath,
  layoutTree,
  LayoutOptions,
  LayoutResult,
  Placed,
  Size,
  Structure,
} from "./layout";
import { renderInline } from "./inline";
import { BRANCH_COLOR_COUNT, ThemeName, THEMES } from "./theme";
import { COLOR_NAMES, normalizeNote, unescapeNote } from "./markdown";

export interface CanvasHost {
  /** 渲染节点备注（Obsidian 里用 MarkdownRenderer），缺省为纯文本 */
  renderNote?: (el: HTMLElement, markdown: string) => void;
  openLink?: (href: string, internal: boolean, ev: MouseEvent) => void;
}

export interface CanvasOptions {
  structure: Structure;
  theme: ThemeName;
  editable: boolean;
  host?: CanvasHost;
  /** 树被编辑后调用（折叠、改文字、增删移节点、颜色、备注） */
  onChange?: (doc: MindDoc) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onStructureChange?: (structure: Structure) => void;
  /** 每次布局完成后调用，可用来按内容定高度 */
  onLayout?: (bounds: Bounds) => void;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const FIT_PADDING = 48;
const DRAG_THRESHOLD = 4;

const ICONS: Record<string, string> = {
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  center: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  logic: '<svg viewBox="0 0 24 24"><path d="M3 12h6M9 12v-6h6M9 12v6h6M9 12h6"/></svg>',
  mindmap: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M15 12h6M9 12H3M14.5 9.5l4-4M14.5 14.5l4 4M9.5 9.5l-4-4M9.5 14.5l-4 4"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  none: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
};

function icon(name: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "mm-icon";
  span.innerHTML = ICONS[name];
  return span;
}

function contrastText(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#1f1f1f" : "#ffffff";
}

interface DropTarget {
  parent: MindNode;
  index: number;
  /** 落在节点上（成为末尾子节点）还是落在子节点列之间（插入到指定位置） */
  kind: "node" | "gap";
}

export class MindMapCanvas {
  readonly el: HTMLElement;
  private viewport: HTMLElement;
  private svg: SVGSVGElement;
  private nodesEl: HTMLElement;
  private overlay: HTMLElement;
  private zoomLabel!: HTMLButtonElement;
  private structureButtons = new Map<Structure, HTMLElement>();
  private nodebar: HTMLElement | null = null;

  private doc: MindDoc | null = null;
  private layout: LayoutResult | null = null;
  private els = new Map<string, HTMLElement>();
  private sizes = new Map<string, Size>();

  private tx = 0;
  private ty = 0;
  private k = 1;
  private hasView = false;
  private needsRender = false;

  private selected = new Set<MindNode>();
  private primary: MindNode | null = null;
  private editing: MindNode | null = null;
  private editingIsNew = false;

  private pointers = new Map<number, { x: number; y: number }>();
  private pan: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private pinch: { dist: number; k: number } | null = null;
  private pendingDrag: { node: MindNode; x: number; y: number } | null = null;
  private lastTap: { node: MindNode; time: number } | null = null;
  private drag: { node: MindNode; ghost: HTMLElement; subtree: Set<MindNode>; target: DropTarget | null; indicator: HTMLElement } | null = null;
  private marquee: { x: number; y: number; el: HTMLElement; base: Set<MindNode> } | null = null;
  private popover: HTMLElement | null = null;
  private popoverSave: (() => void) | null = null;
  /** 备注编辑中：把文本框内容同步到节点上，返回是否有变化 */
  private popoverApply: (() => boolean) | null = null;
  private notifyTimer: number | null = null;
  private ro: ResizeObserver | null = null;
  private retryTimer: number | null = null;
  private retries = 0;
  private disposers: (() => void)[] = [];
  private opts: CanvasOptions;

  constructor(container: HTMLElement, opts: CanvasOptions) {
    this.opts = { ...opts };
    this.el = container;
    this.el.classList.add("mm-root");
    this.el.tabIndex = 0;
    this.el.dataset.theme = opts.theme;
    this.el.dataset.structure = opts.structure;
    this.el.classList.toggle("is-editable", opts.editable);

    this.viewport = document.createElement("div");
    this.viewport.className = "mm-viewport";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "mm-edges");
    this.nodesEl = document.createElement("div");
    this.nodesEl.className = "mm-nodes";
    this.overlay = document.createElement("div");
    this.overlay.className = "mm-overlay";
    this.viewport.append(this.svg, this.nodesEl, this.overlay);
    this.el.append(this.viewport);
    this.buildToolbar();
    this.bindEvents();

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => {
        if (this.needsRender) this.render();
        else this.positionNodebar();
      });
      this.ro.observe(this.el);
    }
  }

  // ---------- 公共 API ----------

  setDoc(doc: MindDoc): void {
    this.flush();
    const paths = [...this.selected].map(pathOf);
    const primaryPath = this.primary ? pathOf(this.primary) : null;
    this.doc = doc;
    this.editing = null;
    this.selected = new Set(paths.map((p) => findByPath(doc.root, p)).filter((n): n is MindNode => !!n));
    this.primary = primaryPath !== null ? findByPath(doc.root, primaryPath) : null;
    if (this.primary && !this.selected.has(this.primary)) this.primary = null;
    this.render();
  }

  getDoc(): MindDoc | null {
    return this.doc;
  }

  setStructure(structure: Structure): void {
    if (this.opts.structure === structure) return;
    this.opts.structure = structure;
    this.el.dataset.structure = structure;
    for (const [s, b] of this.structureButtons) b.classList.toggle("is-active", s === structure);
    this.render();
  }

  setTheme(theme: ThemeName): void {
    this.opts.theme = theme;
    this.el.dataset.theme = theme;
    this.render();
  }

  getBounds(): Bounds | null {
    return this.layout?.bounds ?? null;
  }

  /** 导出用：节点层与连线层 */
  get layers(): { nodes: HTMLElement; edges: SVGSVGElement } {
    return { nodes: this.nodesEl, edges: this.svg };
  }

  getSelection(): MindNode[] {
    return [...this.selected];
  }

  /**
   * 把进行中的编辑（标签、备注）同步到树上并通知，但不关闭编辑界面。
   * 视图自动保存前调用，保证写盘内容包含正在输入的文字。
   */
  syncPending(): boolean {
    let changed = false;
    if (this.editing) {
      const label = this.els.get(this.editing.id)?.querySelector<HTMLElement>(".mm-label");
      const text = (label?.textContent ?? "").replace(/\s*\n\s*/g, " ").trim();
      if (text && text !== this.editing.text) {
        this.editing.text = text;
        changed = true;
      }
    }
    if (this.popoverApply && this.popoverApply()) changed = true;
    if (changed) this.notify();
    return changed;
  }

  /** 结束所有进行中的编辑并落到树上；视图卸载或换文档前调用 */
  flush(): void {
    if (this.editing) this.commitEdit(false, false);
    if (this.popover) this.closePopover();
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  destroy(): void {
    this.ro?.disconnect();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    for (const d of this.disposers) d();
    this.el.replaceChildren();
    this.el.classList.remove("mm-root");
  }

  fit(): void {
    if (!this.layout) return;
    const { bounds } = this.layout;
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    if (!cw || !ch) return;
    let k = Math.min(1, (cw - FIT_PADDING * 2) / bounds.w, (ch - FIT_PADDING * 2) / bounds.h);
    if (k > 0.96) k = 1;
    this.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
    this.tx = cw / 2 - (bounds.x + bounds.w / 2) * this.k;
    this.ty = ch / 2 - (bounds.y + bounds.h / 2) * this.k;
    this.applyTransform();
  }

  /** 根节点居中，缩放归 100% */
  center(): void {
    this.k = 1;
    this.tx = this.el.clientWidth / 2;
    this.ty = this.el.clientHeight / 2;
    this.applyTransform();
  }

  zoomBy(factor: number, sx?: number, sy?: number): void {
    const cx = sx ?? this.el.clientWidth / 2;
    const cy = sy ?? this.el.clientHeight / 2;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.k * factor));
    const ratio = next / this.k;
    this.tx = cx - (cx - this.tx) * ratio;
    this.ty = cy - (cy - this.ty) * ratio;
    this.k = next;
    this.applyTransform();
  }

  // ---------- 渲染 ----------

  render(): void {
    if (!this.doc) return;
    if (!this.el.clientWidth && !this.el.clientHeight) {
      this.needsRender = true;
      return;
    }
    // 插件刚启用时 styles.css 可能晚于首次渲染注入，测出来的尺寸全是错的；等样式就绪再画
    if (getComputedStyle(this.viewport).position !== "absolute") {
      this.scheduleRetry();
      return;
    }
    this.needsRender = false;
    this.closePopover();
    this.editing = null;
    this.rebuild();
    this.reflow();
    if (!this.hasView) {
      this.hasView = true;
      this.fit();
    }
    this.positionNodebar();
  }

  private scheduleRetry(): void {
    this.needsRender = true;
    if (this.retryTimer !== null || this.retries > 50) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.retries += 1;
      if (this.needsRender) this.render();
    }, 100);
  }

  private rebuild(): void {
    const doc = this.doc!;
    const theme = THEMES[this.opts.theme];
    this.nodesEl.replaceChildren();
    this.els.clear();
    const branchOf = new Map<string, number>();
    doc.root.children.forEach((c, i) => walk(c, (n) => branchOf.set(n.id, i % BRANCH_COLOR_COUNT)));

    const visit = (node: MindNode) => {
      const el = document.createElement("div");
      el.className = "mm-node";
      el.dataset.id = node.id;
      el.dataset.depth = String(Math.min(node.depth, 3));
      const branch = branchOf.get(node.id);
      if (theme.branchColors && branch !== undefined) el.dataset.branch = String(branch);
      if (node.color) {
        if ((COLOR_NAMES as readonly string[]).includes(node.color)) {
          el.dataset.color = node.color;
        } else {
          el.style.setProperty("--mm-node-bg", node.color);
          el.style.setProperty("--mm-node-fg", contrastText(node.color));
          el.classList.add("has-custom-color");
        }
        el.classList.add("has-color");
      }
      if (theme.underlineFromDepth !== null && node.depth >= theme.underlineFromDepth && !node.color) {
        el.classList.add("is-underline");
      }
      if (this.selected.has(node)) el.classList.add("is-selected");

      const label = document.createElement("div");
      label.className = "mm-label";
      renderInline(label, node.text || (node.depth === 0 ? "中心主题" : ""), {
        onLink: (href, internal, ev) => this.opts.host?.openLink?.(href, internal, ev),
      });
      el.append(label);

      if (node.note) {
        const n = icon("note");
        n.classList.add("mm-note-icon");
        n.title = "查看备注";
        n.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        n.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleNotePopover(node);
        });
        el.append(n);
      }

      if (node.children.length) {
        const t = document.createElement("button");
        t.className = "mm-toggle" + (node.folded ? " is-folded" : "");
        t.type = "button";
        if (node.folded) t.textContent = String(node.children.length);
        else t.append(icon("minus"));
        t.title = node.folded ? `展开 ${node.children.length} 个子节点` : "折叠";
        t.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        t.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.toggleFold(node);
        });
        el.append(t);
      }

      this.nodesEl.append(el);
      this.els.set(node.id, el);
      for (const c of visibleChildren(node)) visit(c);
    };
    visit(doc.root);
  }

  /** 测量 → 布局 → 定位 → 画线。编辑中输入文字时也会调用，所以不重建 DOM */
  private reflow(): void {
    const doc = this.doc!;
    const theme = THEMES[this.opts.theme];
    this.sizes.clear();
    for (const [id, el] of this.els) this.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    const layoutOpts: LayoutOptions = { ...DEFAULT_LAYOUT, ...theme.layout, structure: this.opts.structure };
    this.layout = layoutTree(doc.root, (n) => this.sizes.get(n.id) ?? { w: 40, h: 24 }, layoutOpts);

    for (const p of this.layout.placed.values()) {
      const el = this.els.get(p.node.id);
      if (!el) continue;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.dataset.side = p.side;
    }

    this.svg.replaceChildren();
    const underline = theme.underlineFromDepth;
    const anchorBottom = (p: Placed) => underline !== null && p.node.depth >= underline && !p.node.color;
    for (const child of this.layout.placed.values()) {
      const parentNode = child.node.parent;
      if (!parentNode) continue;
      const parent = this.layout.placed.get(parentNode.id);
      if (!parent) continue;
      const g = edgeGeometry(parent, child);
      if (anchorBottom(parent)) g.y1 = parent.y + parent.h;
      if (anchorBottom(child)) g.y2 = child.y + child.h;
      const style = parentNode.depth === 0 ? theme.rootEdge : theme.edge;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", style === "curve" ? curvePath(g) : elbowPath(g));
      path.setAttribute("class", "mm-edge");
      path.dataset.depth = String(Math.min(child.node.depth, 3));
      const branch = this.els.get(child.node.id)?.dataset.branch;
      if (branch !== undefined) path.style.stroke = `var(--mm-branch-${branch})`;
      this.svg.append(path);
    }
    this.updateZoomLabel();
    this.opts.onLayout?.(this.layout.bounds);
  }

  private applyTransform(): void {
    this.viewport.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.k})`;
    this.updateZoomLabel();
    this.positionNodebar();
    this.closePopover();
  }

  private updateZoomLabel(): void {
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.k * 100)}%`;
  }

  private screenRectOf(node: MindNode): DOMRect | null {
    const el = this.els.get(node.id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    return new DOMRect(r.left - host.left, r.top - host.top, r.width, r.height);
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const host = this.el.getBoundingClientRect();
    return { x: (clientX - host.left - this.tx) / this.k, y: (clientY - host.top - this.ty) / this.k };
  }

  // ---------- 工具栏 ----------

  private buildToolbar(): void {
    const bar = document.createElement("div");
    bar.className = "mm-toolbar";
    const btn = (name: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-tool";
      b.title = title;
      b.append(icon(name));
      b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onClick();
      });
      bar.append(b);
      return b;
    };
    if (this.opts.editable) {
      this.structureButtons.set("logic-right", btn("logic", "逻辑图（向右）", () => this.changeStructure("logic-right")));
      this.structureButtons.set("mindmap", btn("mindmap", "思维导图（左右分布）", () => this.changeStructure("mindmap")));
      for (const [s, b] of this.structureButtons) b.classList.toggle("is-active", s === this.opts.structure);
      const sep = document.createElement("span");
      sep.className = "mm-tool-sep";
      bar.append(sep);
    }
    btn("minus", "缩小", () => this.zoomBy(1 / 1.2));
    this.zoomLabel = document.createElement("button");
    this.zoomLabel.type = "button";
    this.zoomLabel.className = "mm-tool mm-zoom-label";
    this.zoomLabel.title = "回到 100%";
    this.zoomLabel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this.zoomLabel.addEventListener("click", () => this.zoomBy(1 / this.k));
    bar.append(this.zoomLabel);
    btn("plus", "放大", () => this.zoomBy(1.2));
    btn("fit", "适应画布", () => this.fit());
    btn("center", "回到中心", () => this.center());
    this.el.append(bar);
    this.updateZoomLabel();
  }

  private changeStructure(s: Structure): void {
    this.setStructure(s);
    this.opts.onStructureChange?.(s);
  }

  // ---------- 节点浮动工具栏 ----------

  private buildNodebar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "mm-nodebar";
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const swatch = (color: string | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-swatch";
      b.title = color ?? "清除颜色";
      if (color) b.style.setProperty("--swatch", `var(--mm-c-${color})`);
      else b.append(icon("none"));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.applyColor(color);
      });
      bar.append(b);
    };
    swatch(null);
    for (const c of COLOR_NAMES) swatch(c);
    const sep = document.createElement("span");
    sep.className = "mm-tool-sep";
    bar.append(sep);
    const tool = (name: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-tool";
      b.title = title;
      b.append(icon(name));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onClick();
      });
      bar.append(b);
    };
    tool("note", "编辑备注", () => {
      if (this.primary) this.toggleNotePopover(this.primary, true);
    });
    tool("trash", "删除", () => this.deleteSelected());
    return bar;
  }

  private positionNodebar(): void {
    if (!this.opts.editable) return;
    const show = this.primary && this.selected.size > 0 && !this.editing && !this.drag && !this.marquee && this.els.has(this.primary.id);
    if (!show) {
      this.nodebar?.remove();
      this.nodebar = null;
      return;
    }
    if (!this.nodebar) {
      this.nodebar = this.buildNodebar();
      this.el.append(this.nodebar);
    }
    const r = this.screenRectOf(this.primary!);
    if (!r) return;
    // 先取消隐藏再测量，display:none 时 offsetHeight 是 0，算出来的位置会压在节点上
    this.nodebar.classList.remove("is-hidden");
    const bw = this.nodebar.offsetWidth;
    const bh = this.nodebar.offsetHeight;
    const left = Math.max(4, Math.min(r.x + r.width / 2 - bw / 2, this.el.clientWidth - bw - 4));
    let top = r.y - bh - 10;
    if (top < 4) top = r.y + r.height + 10;
    this.nodebar.style.left = `${left}px`;
    this.nodebar.style.top = `${top}px`;
    const hidden = r.y + r.height < 0 || r.y > this.el.clientHeight || r.x + r.width < 0 || r.x > this.el.clientWidth;
    this.nodebar.classList.toggle("is-hidden", hidden);
  }

  private applyColor(color: string | null): void {
    if (!this.selected.size) return;
    for (const n of this.selected) n.color = color ?? undefined;
    this.render();
    this.notify();
  }

  // ---------- 事件 ----------

  private on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    type: K,
    handler: (ev: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private bindEvents(): void {
    const el = this.el;

    this.on(el, "pointerdown", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".mm-toolbar, .mm-popover, .mm-nodebar")) return;
      const nodeEl = target.closest<HTMLElement>(".mm-node");
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: this.k };
        this.pan = null;
        this.pendingDrag = null;
        return;
      }
      if (nodeEl) {
        const node = this.nodeFromEl(nodeEl);
        if (!node) return;
        if (this.editing === node) return;
        if (this.editing) this.commitEdit();
        this.closePopover();
        if (ev.shiftKey) this.select(node, "add");
        else if (ev.metaKey || ev.ctrlKey) this.select(node, "toggle");
        else if (!this.selected.has(node)) this.select(node, "replace");
        else this.setPrimary(node);
        this.el.focus({ preventScroll: true });
        if (this.opts.editable && node.depth > 0 && ev.button === 0) {
          this.pendingDrag = { node, x: ev.clientX, y: ev.clientY };
        }
        return;
      }
      if (ev.button !== 0 && ev.button !== 1) return;
      if (this.editing) this.commitEdit();
      this.closePopover();
      this.el.focus({ preventScroll: true });
      el.setPointerCapture(ev.pointerId);
      if (ev.shiftKey && ev.button === 0) {
        this.startMarquee(ev);
        return;
      }
      this.pan = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, moved: false };
    });

    this.on(el, "pointermove", (ev) => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const rect = el.getBoundingClientRect();
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (this.pinch.k * dist) / this.pinch.dist));
        this.zoomBy(next / this.k, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        return;
      }
      if (this.marquee) {
        this.updateMarquee(ev);
        return;
      }
      if (this.drag) {
        this.updateDrag(ev);
        return;
      }
      if (this.pendingDrag) {
        if (Math.hypot(ev.clientX - this.pendingDrag.x, ev.clientY - this.pendingDrag.y) >= DRAG_THRESHOLD) {
          this.startDrag(this.pendingDrag.node, ev);
          this.pendingDrag = null;
          if (this.drag) el.setPointerCapture(ev.pointerId);
        }
        return;
      }
      if (!this.pan) return;
      const dx = ev.clientX - this.pan.x;
      const dy = ev.clientY - this.pan.y;
      if (!this.pan.moved && Math.hypot(dx, dy) < 3) return;
      this.pan.moved = true;
      this.tx = this.pan.tx + dx;
      this.ty = this.pan.ty + dy;
      this.applyTransform();
    });

    const endPointer = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.marquee) this.endMarquee();
      if (this.drag) this.endDrag(ev.type === "pointerup");
      const tapped = this.pendingDrag?.node ?? null;
      this.pendingDrag = null;
      if (tapped && ev.type === "pointerup") {
        const now = performance.now();
        if (this.lastTap && this.lastTap.node === tapped && now - this.lastTap.time < 400) {
          this.lastTap = null;
          if (this.opts.editable) this.startEdit(tapped);
        } else {
          this.lastTap = { node: tapped, time: now };
        }
      } else if (ev.type === "pointerup") {
        this.lastTap = null;
      }
      if (this.pan) {
        if (!this.pan.moved) this.select(null, "replace");
        this.pan = null;
      }
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    };
    this.on(el, "pointerup", endPointer);
    this.on(el, "pointercancel", endPointer);

    this.on(
      el,
      "wheel",
      (ev) => {
        if ((ev.target as HTMLElement).closest(".mm-popover")) return;
        ev.preventDefault();
        const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
        if (ev.ctrlKey || ev.metaKey) {
          const rect = el.getBoundingClientRect();
          this.zoomBy(Math.exp(-ev.deltaY * scale * 0.01), ev.clientX - rect.left, ev.clientY - rect.top);
        } else {
          this.tx -= ev.deltaX * scale;
          this.ty -= ev.deltaY * scale;
          this.applyTransform();
        }
      },
      { passive: false },
    );

    this.on(el, "dblclick", (ev) => {
      if (!this.opts.editable) return;
      const nodeEl = (ev.target as HTMLElement).closest<HTMLElement>(".mm-node");
      const node = nodeEl && this.nodeFromEl(nodeEl);
      if (node) {
        ev.preventDefault();
        this.startEdit(node);
      }
    });

    this.on(el, "keydown", (ev) => this.onKeyDown(ev));

    this.on(el, "input", (ev) => {
      if (this.editing && (ev.target as HTMLElement).classList.contains("mm-label")) this.reflow();
    });

    this.on(
      el,
      "blur",
      (ev) => {
        const t = ev.target as HTMLElement;
        if (this.editing && t.classList?.contains("mm-label")) this.commitEdit();
      },
      { capture: true },
    );
  }

  private onKeyDown(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    const target = ev.target as HTMLElement;
    if (target.tagName === "TEXTAREA") {
      if (ev.key === "Escape" || (ev.key === "Enter" && mod)) {
        ev.preventDefault();
        this.closePopover();
        this.el.focus({ preventScroll: true });
      }
      return;
    }
    if (this.editing) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        this.commitEdit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.commitEdit(true);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        this.commitEdit();
        this.addChildToSelected();
      }
      return;
    }
    if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this.opts.onRedo?.();
      else this.opts.onUndo?.();
      return;
    }
    if (mod && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && (ev.key === "=" || ev.key === "+")) {
      ev.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (mod && ev.key === "-") {
      ev.preventDefault();
      this.zoomBy(1 / 1.2);
      return;
    }
    if (mod && ev.key === "0") {
      ev.preventDefault();
      this.fit();
      return;
    }
    if (ev.key === "Escape") {
      this.closePopover();
      this.select(null, "replace");
      return;
    }
    const sel = this.primary;
    if (!sel) return;
    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        ev.preventDefault();
        this.navigate(sel, ev.key);
        return;
      case " ":
      case "F2":
        if (!this.opts.editable) return;
        ev.preventDefault();
        this.startEdit(sel);
        return;
      case "Tab":
        if (!this.opts.editable) return;
        ev.preventDefault();
        this.addChildToSelected();
        return;
      case "Enter":
        if (!this.opts.editable) return;
        ev.preventDefault();
        if (!sel.parent) this.addChildToSelected();
        else this.addSiblingToSelected(ev.shiftKey);
        return;
      case "Delete":
      case "Backspace":
        if (!this.opts.editable) return;
        ev.preventDefault();
        this.deleteSelected();
        return;
      case "/":
        ev.preventDefault();
        if (sel.children.length) this.toggleFold(sel);
        return;
      default:
        return;
    }
  }

  // ---------- 选择与导航 ----------

  private nodeFromEl(el: HTMLElement): MindNode | null {
    const id = el.dataset.id;
    if (!id || !this.doc) return null;
    let found: MindNode | null = null;
    walk(this.doc.root, (n) => {
      if (n.id === id) found = n;
    });
    return found;
  }

  select(node: MindNode | null, mode: "replace" | "add" | "toggle" = "replace"): void {
    if (mode === "replace") {
      this.selected.clear();
      this.primary = null;
    }
    if (node) {
      if (mode === "toggle" && this.selected.has(node)) {
        this.selected.delete(node);
        if (this.primary === node) this.primary = [...this.selected].pop() ?? null;
      } else {
        this.selected.add(node);
        this.primary = node;
      }
    }
    this.syncSelectionClasses();
  }

  private setPrimary(node: MindNode): void {
    this.primary = node;
    this.positionNodebar();
  }

  private selectAll(): void {
    if (!this.doc) return;
    this.selected.clear();
    walk(this.doc.root, (n) => {
      if (n.depth > 0 && this.els.has(n.id)) this.selected.add(n);
    });
    this.primary = this.primary && this.selected.has(this.primary) ? this.primary : [...this.selected][0] ?? null;
    this.syncSelectionClasses();
  }

  private syncSelectionClasses(): void {
    for (const [id, el] of this.els) {
      let node: MindNode | null = null;
      for (const s of this.selected) if (s.id === id) node = s;
      el.classList.toggle("is-selected", node !== null);
    }
    this.positionNodebar();
  }

  private navigate(node: MindNode, key: string): void {
    if (!this.layout) return;
    const p = this.layout.placed.get(node.id);
    if (!p) return;
    const towardChildren = (key === "ArrowRight" && p.side === "right") || (key === "ArrowLeft" && p.side === "left");
    if (key === "ArrowLeft" || key === "ArrowRight") {
      if (node.depth === 0) {
        const kids = visibleChildren(node).filter((c) => this.layout!.placed.get(c.id)?.side === (key === "ArrowRight" ? "right" : "left"));
        if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
        return;
      }
      if (towardChildren) {
        const kids = visibleChildren(node);
        if (kids.length) this.select(kids[Math.floor((kids.length - 1) / 2)]);
      } else if (node.parent) {
        this.select(node.parent);
      }
      return;
    }
    const cy = p.y + p.h / 2;
    const cx = p.x + p.w / 2;
    let best: Placed | null = null;
    let bestScore = Infinity;
    for (const q of this.layout.placed.values()) {
      if (q === p) continue;
      const qy = q.y + q.h / 2;
      if (key === "ArrowUp" ? qy >= cy - 1 : qy <= cy + 1) continue;
      const score = Math.abs(q.x + q.w / 2 - cx) * 2 + Math.abs(qy - cy);
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
    }
    if (best) this.select(best.node);
  }

  // ---------- 框选 ----------

  private startMarquee(ev: PointerEvent): void {
    const host = this.el.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "mm-marquee";
    this.el.append(box);
    this.marquee = { x: ev.clientX - host.left, y: ev.clientY - host.top, el: box, base: new Set(this.selected) };
    this.positionNodebar();
  }

  private updateMarquee(ev: PointerEvent): void {
    if (!this.marquee) return;
    const host = this.el.getBoundingClientRect();
    const x2 = ev.clientX - host.left;
    const y2 = ev.clientY - host.top;
    const left = Math.min(this.marquee.x, x2);
    const top = Math.min(this.marquee.y, y2);
    const w = Math.abs(x2 - this.marquee.x);
    const h = Math.abs(y2 - this.marquee.y);
    Object.assign(this.marquee.el.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    this.selected = new Set(this.marquee.base);
    for (const el of this.els.values()) {
      const r = el.getBoundingClientRect();
      const rx = r.left - host.left;
      const ry = r.top - host.top;
      if (rx < left + w && rx + r.width > left && ry < top + h && ry + r.height > top) {
        const node = this.nodeFromEl(el);
        if (node && node.depth > 0) this.selected.add(node);
      }
    }
    for (const [id, el] of this.els) {
      let hit = false;
      for (const s of this.selected) if (s.id === id) hit = true;
      el.classList.toggle("is-selected", hit);
    }
  }

  private endMarquee(): void {
    if (!this.marquee) return;
    this.marquee.el.remove();
    this.marquee = null;
    this.primary = [...this.selected].pop() ?? null;
    this.syncSelectionClasses();
  }

  // ---------- 拖拽 ----------

  private startDrag(node: MindNode, ev: PointerEvent): void {
    const el = this.els.get(node.id);
    if (!el || !this.doc) return;
    const subtree = new Set<MindNode>();
    walk(node, (n) => subtree.add(n));
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("mm-ghost");
    ghost.classList.remove("is-selected");
    ghost.querySelector(".mm-toggle")?.remove();
    ghost.style.transform = `scale(${this.k})`;
    this.el.append(ghost);
    const indicator = document.createElement("div");
    indicator.className = "mm-drop-indicator";
    this.overlay.append(indicator);
    for (const n of subtree) this.els.get(n.id)?.classList.add("is-dragging");
    this.drag = { node, ghost, subtree, target: null, indicator };
    this.el.classList.add("is-dragging-node");
    this.positionNodebar();
    this.updateDrag(ev);
  }

  private updateDrag(ev: PointerEvent): void {
    if (!this.drag) return;
    const host = this.el.getBoundingClientRect();
    this.drag.ghost.style.left = `${ev.clientX - host.left + 12}px`;
    this.drag.ghost.style.top = `${ev.clientY - host.top + 12}px`;
    const w = this.toWorld(ev.clientX, ev.clientY);
    const target = this.findDropTarget(w.x, w.y, this.drag.subtree);
    this.drag.target = target;
    for (const el of this.els.values()) el.classList.remove("is-drop-target");
    const ind = this.drag.indicator;
    ind.style.display = "none";
    if (!target || !this.layout) return;
    if (target.kind === "node") {
      this.els.get(target.parent.id)?.classList.add("is-drop-target");
      return;
    }
    const kids = visibleChildren(target.parent).filter((c) => !this.drag!.subtree.has(c)).map((c) => this.layout!.placed.get(c.id)!).filter(Boolean);
    if (!kids.length) return;
    const gap = target.parent.depth === 0 ? DEFAULT_LAYOUT.gapMain : DEFAULT_LAYOUT.gapSibling;
    const side = kids[0].side;
    const pos = kids.findIndex((k) => target.parent.children.indexOf(k.node) >= target.index);
    let y: number;
    if (pos === -1) y = kids[kids.length - 1].y + kids[kids.length - 1].h + gap / 2;
    else if (pos === 0) y = kids[0].y - gap / 2;
    else y = (kids[pos - 1].y + kids[pos - 1].h + kids[pos].y) / 2;
    const x = side === "right" ? kids[0].x : kids[0].x + kids[0].w - 48;
    Object.assign(ind.style, { display: "block", left: `${x}px`, top: `${y - 2}px` });
  }

  private findDropTarget(wx: number, wy: number, exclude: Set<MindNode>): DropTarget | null {
    if (!this.layout) return null;
    const placed = [...this.layout.placed.values()].filter((p) => !exclude.has(p.node));
    // 先看子节点列之间的空隙：插入到指定位置
    for (const p of placed) {
      const kids = visibleChildren(p.node).filter((c) => !exclude.has(c)).map((c) => this.layout!.placed.get(c.id)!).filter(Boolean);
      if (!kids.length) continue;
      const gap = p.node.depth === 0 ? DEFAULT_LAYOUT.gapMain : DEFAULT_LAYOUT.gapSibling;
      const minX = Math.min(...kids.map((k) => k.x)) - 12;
      const maxX = Math.max(...kids.map((k) => k.x + k.w)) + 12;
      const minY = kids[0].y - gap;
      const maxY = kids[kids.length - 1].y + kids[kids.length - 1].h + gap;
      if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;
      // 落在某个子节点自己的盒子里 → 成为它的子节点
      const hit = kids.find((k) => wx >= k.x && wx <= k.x + k.w && wy >= k.y + 4 && wy <= k.y + k.h - 4);
      if (hit) return { parent: hit.node, index: hit.node.children.length, kind: "node" };
      const before = kids.filter((k) => k.y + k.h / 2 < wy).length;
      const index = before < kids.length ? p.node.children.indexOf(kids[before].node) : p.node.children.length;
      return { parent: p.node, index, kind: "gap" };
    }
    for (const p of placed) {
      if (wx >= p.x - 8 && wx <= p.x + p.w + 8 && wy >= p.y - 8 && wy <= p.y + p.h + 8) {
        return { parent: p.node, index: p.node.children.length, kind: "node" };
      }
    }
    return null;
  }

  private endDrag(commit: boolean): void {
    if (!this.drag) return;
    const { node, ghost, indicator, target } = this.drag;
    ghost.remove();
    indicator.remove();
    for (const el of this.els.values()) el.classList.remove("is-dragging", "is-drop-target");
    this.el.classList.remove("is-dragging-node");
    this.drag = null;
    if (commit && target && this.doc && !isAncestor(node, target.parent) && target.parent !== node) {
      const parent = target.parent;
      const sameSpot = node.parent === parent && parent.children.indexOf(node) === target.index;
      if (!sameSpot) {
        if (parent.folded) parent.folded = false;
        if (moveNode(node, parent, target.index, this.doc.style)) {
          this.select(node);
          this.render();
          this.notify();
          return;
        }
      }
    }
    this.positionNodebar();
  }

  // ---------- 编辑 ----------

  private notify(): void {
    if (this.notifyTimer !== null) {
      window.clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    if (this.doc) this.opts.onChange?.(this.doc);
  }

  /** 输入过程中的延迟通知：让自动保存跟上，但不至于每个键都序列化一次 */
  private scheduleNotify(delay = 500): void {
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, delay);
  }

  private toggleFold(node: MindNode): void {
    if (this.editing) this.commitEdit();
    node.folded = !node.folded;
    this.select(node);
    this.render();
    if (this.opts.editable) this.notify();
  }

  private addChildToSelected(): void {
    const sel = this.primary;
    if (!sel || !this.doc) return;
    if (sel.folded) sel.folded = false;
    const node = addChild(sel, this.doc.style, "");
    this.select(node);
    this.render();
    this.startEdit(node, true);
  }

  private addSiblingToSelected(before: boolean): void {
    const sel = this.primary;
    if (!sel || !this.doc) return;
    const node = addSibling(sel, "", !before);
    if (!node) return;
    this.select(node);
    this.render();
    this.startEdit(node, true);
  }

  private deleteSelected(): void {
    const victims = [...this.selected].filter((n) => n.parent && ![...this.selected].some((o) => o !== n && isAncestor(o, n)));
    if (!victims.length) return;
    const primary = this.primary && victims.includes(this.primary) ? this.primary : victims[0];
    const parent = primary.parent!;
    const idx = parent.children.indexOf(primary);
    for (const v of victims) removeNode(v);
    const next = parent.children[Math.min(idx, parent.children.length - 1)] ?? parent;
    this.select(next);
    this.render();
    this.notify();
  }

  startEdit(node: MindNode, isNew = false): void {
    if (!this.opts.editable) return;
    if (this.editing === node) return;
    if (this.editing) this.commitEdit();
    const el = this.els.get(node.id);
    const label = el?.querySelector<HTMLElement>(".mm-label");
    if (!el || !label) return;
    this.closePopover();
    this.select(node);
    this.editing = node;
    this.editingIsNew = isNew;
    this.positionNodebar();
    label.textContent = node.text;
    label.setAttribute("contenteditable", "plaintext-only");
    if (!label.isContentEditable) label.setAttribute("contenteditable", "true");
    el.classList.add("is-editing");
    label.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(label);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    this.reflow();
  }

  commitEdit(cancel = false, refocus = true): void {
    const node = this.editing;
    if (!node) return;
    const isNew = this.editingIsNew;
    this.editing = null;
    this.editingIsNew = false;
    const label = this.els.get(node.id)?.querySelector<HTMLElement>(".mm-label");
    const raw = (label?.textContent ?? "").replace(/\s*\n\s*/g, " ").trim();
    const text = cancel ? node.text : raw;
    if (text === "" && isNew) {
      const parent = node.parent;
      removeNode(node);
      this.select(parent);
      this.render();
      if (refocus) this.el.focus({ preventScroll: true });
      return;
    }
    const changed = !cancel && (text !== node.text || isNew);
    node.text = text;
    this.render();
    if (refocus) this.el.focus({ preventScroll: true });
    if (changed) this.notify();
  }

  // ---------- 备注弹层 ----------

  private toggleNotePopover(node: MindNode, edit = false): void {
    const sameNode = this.popover?.dataset.id === node.id;
    const alreadyEditing = !!this.popover?.querySelector("textarea");
    // 再点一次图标就收起；但「编辑」请求要把查看态切成编辑态，不能当成收起
    if (sameNode && (!edit || alreadyEditing)) {
      this.closePopover();
      return;
    }
    this.closePopover();
    const nodeEl = this.els.get(node.id);
    if (!nodeEl) return;
    const pop = document.createElement("div");
    pop.className = "mm-popover";
    pop.dataset.id = node.id;
    pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    pop.addEventListener("wheel", (ev) => ev.stopPropagation());
    const editable = this.opts.editable && (edit || !node.note);
    if (editable) {
      const ta = document.createElement("textarea");
      ta.className = "mm-note-editor";
      ta.placeholder = "备注（支持 Markdown，可以写列表）";
      const plain = unescapeNote(node.note);
      ta.value = plain;
      ta.rows = Math.min(12, Math.max(3, plain.split("\n").length + 1));
      const initial = node.note;
      const apply = () => {
        const next = normalizeNote(ta.value.replace(/\s+$/, ""));
        if (next === node.note) return false;
        node.note = next;
        return true;
      };
      let saved = false;
      const save = () => {
        if (saved) return;
        saved = true;
        this.popoverApply = null;
        apply();
        if (node.note !== initial) {
          this.render();
          this.notify();
        }
      };
      ta.addEventListener("input", () => {
        if (apply()) this.scheduleNotify();
      });
      ta.addEventListener("blur", () => {
        if (this.popover === pop) this.closePopover();
      });
      this.popoverSave = save;
      this.popoverApply = apply;
      pop.append(ta);
      this.el.append(pop);
      this.placePopover(pop, nodeEl);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } else {
      const body = document.createElement("div");
      body.className = "mm-popover-body";
      if (this.opts.host?.renderNote) {
        body.classList.add("markdown-rendered");
        this.opts.host.renderNote(body, unescapeNote(node.note));
      } else {
        body.classList.add("is-plain");
        body.textContent = unescapeNote(node.note);
      }
      pop.append(body);
      if (this.opts.editable) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "mm-popover-edit";
        editBtn.textContent = "编辑";
        editBtn.addEventListener("click", () => this.toggleNotePopover(node, true));
        pop.append(editBtn);
      }
      this.el.append(pop);
      this.placePopover(pop, nodeEl);
    }
    this.popover = pop;
  }

  private placePopover(pop: HTMLElement, nodeEl: HTMLElement): void {
    const r = nodeEl.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - host.left, host.width - pop.offsetWidth - 8));
    let top = r.bottom - host.top + 8;
    if (top + pop.offsetHeight > host.height - 8) top = Math.max(8, r.top - host.top - pop.offsetHeight - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  private closePopover(): void {
    if (!this.popover) return;
    const pop = this.popover;
    const save = this.popoverSave;
    this.popover = null;
    this.popoverSave = null;
    this.popoverApply = null;
    pop.remove();
    save?.();
  }
}
