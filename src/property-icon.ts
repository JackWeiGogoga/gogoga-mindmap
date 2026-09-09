import { App, setIcon, setTooltip, TFile } from "obsidian";
import { IconPickerModal, storedValue } from "./icon-picker";
import { displayEmoji, iconIdOf, isEmojiValue } from "./icon-value";

/**
 * 属性面板里的 `icon` 一行装饰。
 *
 * 值里带冒号（lucide:mindmap-tree），Obsidian 的文本控件会把它当成 scheme:path 的外部链接，
 * 渲染成蓝色下划线加一个外链箭头，点了还什么都打不开。这里做三件事：
 * 在值前面放一个实时预览、点预览直接打开图标选择器、给这一行加个类由样式表还原成普通文本。
 *
 * 属性面板是 Obsidian 的内部结构，选择器万一变了这里只是静默失效，不影响别的功能。
 */
const KEY = "icon";
const MARK = "mm-icon-prop";

export class PropertyIconDecorator {
  private timer: number | null = null;

  constructor(private app: App) {}

  /** 合并短时间内的多次触发 */
  schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.run();
    }, 60);
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    for (const el of Array.from(document.querySelectorAll(`.${MARK}`))) {
      el.classList.remove(MARK);
      el.querySelector(".mm-icon-prop-preview")?.remove();
    }
  }

  private run(): void {
    try {
      const rows = document.querySelectorAll<HTMLElement>(`.metadata-property[data-property-key="${KEY}"]`);
      for (const row of Array.from(rows)) this.decorate(row);
    } catch {
      // 内部结构变了就当没这回事
    }
  }

  /** 这一行属于哪个文件：先看它所在的视图，取不到就退回当前活动文件 */
  private fileOf(row: HTMLElement): TFile | null {
    let found: TFile | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const view = leaf.view as { containerEl?: HTMLElement; file?: TFile };
      if (view.file && view.containerEl?.contains(row)) found = view.file;
    });
    return found ?? this.app.workspace.getActiveFile();
  }

  private pick(row: HTMLElement): void {
    const file = this.fileOf(row);
    if (!file) return;
    new IconPickerModal(this.app, (choice) => {
      if (!choice) return;
      void this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm[KEY] = storedValue(choice);
      });
    }).open();
  }

  private decorate(row: HTMLElement): void {
    const valueEl = row.querySelector<HTMLElement>(".metadata-property-value");
    if (!valueEl) return;
    const raw = (valueEl.textContent ?? "").trim();
    let preview = valueEl.querySelector<HTMLElement>(".mm-icon-prop-preview");
    if (!raw) {
      preview?.remove();
      row.classList.remove(MARK);
      return;
    }
    if (!preview) {
      preview = createSpan({ cls: "mm-icon-prop-preview" });
      preview.setAttribute("role", "button");
      preview.tabIndex = 0;
      setTooltip(preview, "选择图标", { placement: "top" });
      // 用 mousedown 抢在属性控件把焦点交给输入框之前
      preview.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.pick(row);
      });
      preview.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        this.pick(row);
      });
      valueEl.prepend(preview);
    }
    if (preview.dataset.value === raw) return;
    preview.dataset.value = raw;
    // empty() 会连事件一起清掉？不会，只清子节点；监听挂在 preview 本身
    preview.empty();
    preview.toggleClass("is-emoji", isEmojiValue(raw));
    if (isEmojiValue(raw)) preview.setText(displayEmoji(raw));
    else {
      const id = iconIdOf(raw);
      if (id) setIcon(preview, id);
    }
    // 没渲染出东西就别占位，也别去掉链接样式（可能真是个链接）
    const ok = preview.childElementCount > 0 || !!preview.textContent;
    row.classList.toggle(MARK, ok);
    if (!ok) preview.remove();
  }
}
