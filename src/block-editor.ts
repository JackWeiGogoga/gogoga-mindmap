import { App, Component, Modal, Scope } from "obsidian";

/**
 * 代码块嵌入的「大窗口编辑」（#41）：铺满 Obsidian 窗口的编辑框，里面是一张完整的脑图。
 * 画布由调用方在 mount 里建好（写回代码块的逻辑在 main.ts），这里只管框本身：
 * - 自己的一层 Scope，不接 Obsidian 的全局热键：F2（重命名文件）、⌘B / ⌘I（加粗外面笔记的选区）
 *   这类不会穿到后面的笔记上，按键都交给画布处理；
 * - Esc 不关框（按惯了 Esc 退出节点编辑，不该一下把整个窗口关掉），关闭用右上角 × 或点框外
 */
export class BlockEditorModal extends Modal {
  private readonly component = new Component();
  private cleanup: (() => void) | null = null;

  constructor(
    app: App,
    private readonly title: string,
    private readonly mount: (host: HTMLElement, component: Component) => () => void,
    private readonly onClosed: () => void,
  ) {
    super(app);
    this.scope = new Scope();
  }

  onOpen(): void {
    this.modalEl.addClass("mm-block-editor");
    this.titleEl.setText(this.title);
    this.component.load();
    const host = this.contentEl.createDiv({ cls: "mm-block-editor-host" });
    this.cleanup = this.mount(host, this.component);
  }

  onClose(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.component.unload();
    this.contentEl.empty();
    this.onClosed();
  }
}
