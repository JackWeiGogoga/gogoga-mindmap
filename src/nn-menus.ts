import type { App, MenuItem, TAbstractFile, TFile, TFolder } from "obsidian";

/**
 * Notebook Navigator 不派发 Obsidian 的 file-menu 事件，自己走一套扩展点。
 * 装了它（尤其是同时关掉了核心文件列表）的用户，靠 workspace.on("file-menu") 是看不到我们的菜单项的。
 * 这里只用它公开的 api.menus.*，拿不到就安静跳过。
 * 参考：Notebook Navigator 3.3.x 的 MenusController。
 */

const NN_ID = "notebook-navigator";

type NnAddItem = (cb: (item: MenuItem) => void) => void;
interface NnFolderCtx {
  addItem: NnAddItem;
  folder: TFolder;
}
interface NnFileCtx {
  addItem: NnAddItem;
  file: TFile;
}
interface NnMenusApi {
  registerFolderMenu?: (cb: (ctx: NnFolderCtx) => void) => () => void;
  registerFileMenu?: (cb: (ctx: NnFileCtx) => void) => () => void;
}

function menusApi(app: App): NnMenusApi | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
  const nn = plugins?.plugins?.[NN_ID] as { api?: { menus?: NnMenusApi } } | undefined;
  return nn?.api?.menus ?? null;
}

/** Obsidian 的 Menu 和 NN 的 addItem 都满足这个形状 */
export interface MenuLike {
  addItem(cb: (item: MenuItem) => unknown): unknown;
}

/**
 * NN 自己的菜单项一律不带 section，我们要是留着 action-primary，Obsidian 排序时会把它顶到最上面。
 * 所以跟 NN 对齐成空 section，再挪到第一个分隔符前面 —— 也就是「新建笔记 / 新建画布 / 新建绘图」那一组的末尾。
 * 按分隔符定位而不是按标题，NN 改文案或加项都不影响。
 */
export function placeInCreateGroup(item: MenuItem): void {
  item.setSection("");
  const owner = item as unknown as { menu?: { items?: unknown[] } };
  const items = owner.menu?.items;
  if (!Array.isArray(items)) return;
  const at = items.indexOf(item);
  // 分隔符没有 titleEl，MenuItem 才有
  const sep = items.findIndex((it) => !(it as { titleEl?: unknown } | null)?.titleEl);
  if (at < 0 || sep < 0 || sep >= at) return;
  items.splice(at, 1);
  items.splice(sep, 0, item);
}

export interface NnMenuHandlers {
  /** 文件夹右键：加「新建思维导图」之类的项；tweak 用来把项挪到 NN 的「新建」组末尾 */
  folder: (menu: MenuLike, folder: TFolder, tweak: (item: MenuItem) => void) => void;
  /** 笔记右键：加「以思维导图打开」之类的项 */
  file: (menu: MenuLike, file: TAbstractFile) => void;
}

/**
 * 把同一批菜单项接到 Notebook Navigator 上。返回注销函数。
 * NN 要求菜单项**同步**添加，所以异步活儿只能放进 onClick。
 */
export function registerNotebookNavigatorMenus(app: App, handlers: NnMenuHandlers): () => void {
  let offs: Array<() => void> = [];
  let disposed = false;

  const attach = (): boolean => {
    const api = menusApi(app);
    if (!api) return false;
    try {
      const asMenu = (addItem: NnAddItem): MenuLike => ({ addItem: (cb) => addItem(cb as (item: MenuItem) => void) });
      if (api.registerFolderMenu) {
        offs.push(
          api.registerFolderMenu((ctx) => handlers.folder(asMenu(ctx.addItem), ctx.folder, placeInCreateGroup)),
        );
      }
      if (api.registerFileMenu) {
        offs.push(api.registerFileMenu((ctx) => handlers.file(asMenu(ctx.addItem), ctx.file)));
      }
    } catch {
      // NN 换了 API 就算了，核心文件列表那条路还在
    }
    return offs.length > 0;
  };

  if (!attach()) {
    // NN 可能比我们晚启用；它建视图时会触发 layout-change，借这个再试一次
    const ref = app.workspace.on("layout-change", () => {
      if (disposed || attach()) app.workspace.offref(ref);
    });
    offs.push(() => app.workspace.offref(ref));
  }

  return () => {
    disposed = true;
    for (const off of offs) {
      try {
        off();
      } catch {
        /* 已经卸载了 */
      }
    }
    offs = [];
  };
}
