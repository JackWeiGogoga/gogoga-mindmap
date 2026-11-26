/**
 * 节点右键菜单的摆放：每一项放第一层、「更多」里，还是不显示。
 * 设置里只存和默认不一样的项（id → 位置）；菜单项本身还是按原来的条件出现（有备注才有「删除备注」），
 * 这里只决定它出现时放哪一层。顺序不能改，跟内置的一样
 */

export type MenuPlace = "top" | "more" | "hidden";

export interface MenuItemDef {
  id: string;
  /** 默认放哪一层 */
  place: "top" | "more";
  /** 菜单上的名字（i18n 键） */
  label: string;
  /** 核心操作：只能在第一层和「更多」之间挪，不能隐藏 */
  locked?: boolean;
}

/** 菜单里能挪的项，按菜单里的顺序。一个 id 可以对应几项（打开链接 + 取消链接、转标题 + 转列表） */
export const MENU_ITEMS: MenuItemDef[] = [
  { id: "edit", place: "top", label: "menu.edit", locked: true },
  { id: "addChild", place: "top", label: "menu.addChild", locked: true },
  { id: "addSibling", place: "top", label: "menu.addSibling", locked: true },
  { id: "insert", place: "top", label: "menu.insertGroup" },
  { id: "expandCollapse", place: "top", label: "menuLayout.expandCollapse" },
  { id: "fold", place: "top", label: "menu.foldGroup" },
  { id: "link", place: "top", label: "menu.linkNote" },
  { id: "note", place: "top", label: "menu.addNote" },
  { id: "deleteNote", place: "top", label: "menu.deleteNote" },
  { id: "callout", place: "top", label: "menu.addCallout" },
  { id: "rel", place: "top", label: "menu.addRel" },
  { id: "markers", place: "top", label: "menu.markers" },
  { id: "task", place: "top", label: "menu.task" },
  { id: "numbering", place: "top", label: "menu.numbering" },
  { id: "width", place: "top", label: "menu.widthGroup" },
  { id: "box", place: "top", label: "menu.addBox" },
  { id: "summary", place: "top", label: "menu.addSummary" },
  { id: "copy", place: "top", label: "menu.copy" },
  { id: "copyImage", place: "top", label: "menu.copyImage" },
  { id: "cut", place: "top", label: "menu.cut" },
  { id: "paste", place: "top", label: "menu.pasteChild" },
  { id: "delete", place: "top", label: "menu.delete", locked: true },
  { id: "review", place: "more", label: "menu.reviewGroup" },
  { id: "convert", place: "more", label: "menuLayout.convert" },
  { id: "split", place: "more", label: "menu.splitInto" },
  { id: "hide", place: "more", label: "menu.hideNode" },
  { id: "branchLayout", place: "more", label: "menu.branchLayout" },
  { id: "float", place: "more", label: "menu.toFloat" },
  { id: "nodeTable", place: "more", label: "menuLayout.nodeTable" },
  { id: "nodeLink", place: "more", label: "menu.copyNodeLink" },
  { id: "reveal", place: "more", label: "menu.revealInMarkdown" },
  { id: "textColor", place: "more", label: "menu.textColor" },
];

const DEFS = new Map(MENU_ITEMS.map((d) => [d.id, d]));

/** 这一项实际放哪：设置里没有、或者核心项被设成隐藏，都按默认 */
export function placeOf(id: string, layout: Record<string, MenuPlace> | undefined): MenuPlace {
  const def = DEFS.get(id);
  if (!def) return "top";
  const p = layout?.[id];
  if (p !== "top" && p !== "more" && p !== "hidden") return def.place;
  if (p === "hidden" && def.locked) return def.place;
  return p;
}

/** 存设置用：和默认一样的去掉，不认识的 id 去掉 */
export function cleanLayout(layout: Record<string, unknown> | undefined): Record<string, MenuPlace> {
  const out: Record<string, MenuPlace> = {};
  for (const [id, p] of Object.entries(layout ?? {})) {
    const def = DEFS.get(id);
    if (!def || (p !== "top" && p !== "more" && p !== "hidden")) continue;
    if (p === "hidden" && def.locked) continue;
    if (p !== def.place) out[id] = p;
  }
  return out;
}

interface Entry {
  id?: string;
  separator?: boolean;
}

/** 去掉开头、结尾和连着的分隔线 */
export function tidySeparators<E extends Entry>(list: E[]): E[] {
  const out: E[] = [];
  for (const e of list) {
    if (e.separator && (!out.length || out[out.length - 1].separator)) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

/**
 * 按设置挪：第一层里设成「更多」的放到「更多」最前面（后面一条分隔线），
 * 「更多」里设成第一层的放到 slot（「更多」这一项占的位置）前面（前面一条分隔线），隐藏的去掉。
 * slot 是 top 里的一项（id 为 MORE_SLOT），调用方再把它换成「更多 ▸」或去掉
 */
export const MORE_SLOT = "__more";

export function arrangeMenu<E extends Entry>(top: E[], more: E[], layout: Record<string, MenuPlace> | undefined, sep: () => E): { top: E[]; more: E[] } {
  const place = (e: E, home: "top" | "more"): MenuPlace => (e.id && e.id !== MORE_SLOT ? placeOf(e.id, layout) : home);
  const down = top.filter((e) => !e.separator && place(e, "top") === "more");
  const up = more.filter((e) => !e.separator && place(e, "more") === "top");
  const keepTop = top.filter((e) => e.separator || place(e, "top") === "top");
  const keepMore = more.filter((e) => e.separator || place(e, "more") === "more");
  const nextMore = tidySeparators(down.length ? [...down, sep(), ...keepMore] : keepMore);
  let nextTop = keepTop;
  if (up.length) {
    const i = keepTop.findIndex((e) => e.id === MORE_SLOT);
    const at = i < 0 ? keepTop.length : i;
    nextTop = [...keepTop.slice(0, at), sep(), ...up, sep(), ...keepTop.slice(at)];
  }
  return { top: tidySeparators(nextTop), more: nextMore };
}
