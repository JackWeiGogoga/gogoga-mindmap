import { type App, type TFile } from "obsidian";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * 编辑备注用的「所见即所得」编辑框：嵌入 Obsidian 自己的实时预览编辑器（和在笔记里写字一样，列表、标题、
 * 图片、表格直接显示效果，装了 gogoga Table 的话表格也能点格子改）。
 *
 * Obsidian 没有公开这个编辑器类，这里和 Kanban、Excalidraw 等插件一样，从 Markdown 嵌入的编辑模式里找到它的类再继承。
 * 找不到、建不起来（Obsidian 改了内部结构）就返回 null，调用方退回普通输入框。
 */

/** 画布用的编辑框接口：和普通输入框能做的一样（读写文字、选区、插入），外加销毁 */
export interface LiveNoteEditor {
  readonly el: HTMLElement;
  readonly value: string;
  readonly selection: { from: number; to: number };
  /** 整段换成 text，选中 [start, end)；只改真正变了的那一段，撤销记录里是一步 */
  replace(text: string, start: number, end: number): void;
  /** 在光标处插入（换掉选中的字） */
  insert(text: string): void;
  focus(): void;
  hasFocus(): boolean;
  destroy(): void;
}

export interface LiveNoteEditorOptions {
  text: string;
  /** 这一篇脑图笔记：编辑框里的图片、链接按它的位置找 */
  file: TFile | null;
  onChange: () => void;
  /** 额外挂在编辑器上的扩展（选中文字浮出的格式栏） */
  extensions?: Extension[];
  /** 按键先交给画布：返回 true 表示处理过了（Esc 关闭、格式快捷键） */
  onKey: (ev: KeyboardEvent) => boolean;
  /** 粘贴、拖入先交给画布：返回 true 表示处理过了（图片存成附件） */
  onPaste: (ev: ClipboardEvent) => boolean;
  onDrop: (ev: DragEvent) => boolean;
  onDragOver: (ev: DragEvent) => boolean;
}

interface BaseEditor {
  app: App;
  owner: { editor?: unknown; file?: TFile | null };
  containerEl: HTMLElement;
  editor: { cm: EditorView };
  set(text: string, clear: boolean): void;
  buildLocalExtensions(): Extension[];
  onUpdate(update: unknown, changed: boolean): void;
  destroy(): void;
  unload(): void;
  _loaded?: boolean;
}
type BaseCtor = new (app: App, container: HTMLElement, owner: object) => BaseEditor;

let found: BaseCtor | null | undefined;

/** Obsidian 的 Markdown 编辑器类：开一个看不见的 Markdown 嵌入、切到编辑模式，从它的原型链上取 */
function editorClass(app: App): BaseCtor | null {
  if (found !== undefined) return found;
  found = null;
  try {
    const registry = (app as unknown as { embedRegistry?: { embedByExtension?: Record<string, (ctx: object, file: null, sub: string) => unknown> } }).embedRegistry;
    const make = registry?.embedByExtension?.md;
    if (!make) return null;
    const embed = make({ app, containerEl: createDiv(), state: {} }, null, "") as {
      load(): void;
      unload(): void;
      editable: boolean;
      showEditor(): void;
      editMode?: object;
    };
    embed.load();
    embed.editable = true;
    embed.showEditor();
    const mode = embed.editMode;
    const ctor = mode ? (Object.getPrototypeOf(Object.getPrototypeOf(mode)) as { constructor: BaseCtor }).constructor : null;
    embed.unload();
    const proto = typeof ctor === "function" ? (ctor.prototype as Partial<Record<"set" | "buildLocalExtensions", unknown>>) : null;
    if (ctor && proto && typeof proto.set === "function" && typeof proto.buildLocalExtensions === "function") found = ctor;
  } catch (e) {
    console.warn("[gogoga-mindmap] 找不到 Obsidian 的编辑器，备注改用普通输入框", e);
  }
  return found;
}

export function createLiveNoteEditor(app: App, parent: HTMLElement, o: LiveNoteEditorOptions): LiveNoteEditor | null {
  const Base = editorClass(app);
  if (!Base) return null;
  const ws = app.workspace as unknown as { activeEditor: unknown };
  try {
    // 宿主（owner）：编辑器从它那里拿文件（图片、链接的位置）、模式；获得焦点时当成 Obsidian 的「当前编辑器」，
    // ⌘B、[[ 补全这些 Obsidian 自己的编辑功能才作用在它上面
    const owner: { app: App; file: TFile | null; editor?: unknown; editMode?: unknown; getMode: () => string; onMarkdownScroll: () => void } = {
      app,
      file: o.file,
      getMode: () => "source",
      onMarkdownScroll: () => {},
    };
    let prevActive: unknown = null;
    class Live extends Base {
      buildLocalExtensions(): Extension[] {
        const ext = super.buildLocalExtensions();
        ext.push(
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (ev) => o.onKey(ev),
              paste: (ev) => o.onPaste(ev),
              drop: (ev) => o.onDrop(ev),
              dragover: (ev) => o.onDragOver(ev),
              // 获得焦点时当成 Obsidian 的当前编辑器；失焦不还回去（斜杠菜单、插入表格的行列对话框抢走焦点后，
              // 命令还要把内容插到这里），编辑框关掉时才还
              focus: () => {
                if (ws.activeEditor !== owner) {
                  prevActive = ws.activeEditor;
                  ws.activeEditor = owner;
                }
                return false;
              },
            }),
          ),
          ...(o.extensions ?? []),
        );
        return ext;
      }
      onUpdate(update: unknown, changed: boolean): void {
        super.onUpdate(update, changed);
        if (changed) o.onChange();
      }
    }
    const box = parent.createDiv({ cls: "mm-note-live markdown-source-view mod-cm6 is-live-preview" });
    const ed = new Live(app, box, owner);
    owner.editor = ed.editor;
    owner.editMode = ed;
    ed.set(o.text, true);
    const cm = ed.editor.cm;
    // 和普通输入框一样，光标放在最后接着写
    cm.dispatch({ selection: { anchor: cm.state.doc.length } });
    let destroyed = false;
    return {
      el: box,
      get value() {
        return cm.state.doc.toString();
      },
      get selection() {
        const s = cm.state.selection.main;
        return { from: s.from, to: s.to };
      },
      replace(text, start, end) {
        const old = cm.state.doc.toString();
        // 只换中间变了的那段：光标、滚动位置不乱跳
        let a = 0;
        while (a < old.length && a < text.length && old[a] === text[a]) a++;
        let b = 0;
        while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
        cm.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, selection: EditorSelection.range(start, end), scrollIntoView: true });
      },
      insert(text) {
        cm.dispatch(cm.state.replaceSelection(text));
      },
      focus() {
        cm.focus();
      },
      hasFocus() {
        return cm.hasFocus;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (ws.activeEditor === owner) ws.activeEditor = prevActive;
        try {
          if (ed._loaded) ed.unload();
          ed.destroy();
        } catch {
          // Obsidian 内部的清理出错不影响备注（文字已经存好了）
        }
        box.remove();
      },
    };
  } catch (e) {
    console.warn("[gogoga-mindmap] 备注编辑框建不起来，改用普通输入框", e);
    return null;
  }
}
