/**
 * 浮动工具栏、主工具栏的按钮：显示哪些、按什么顺序。设置里存成字符串数组，按顺序一项一个 id，
 * 前面带「!」的是藏起来的。读的时候和默认清单合并：认不得的 id 丢掉，新版本加的按钮插到默认位置（按它默认显示不显示）
 */

export interface BarItem {
  id: string;
  on: boolean;
}

/** 浮动工具栏：颜色一整组算一项；后面五个是可选的，默认不显示 */
export const NODEBAR_DEFAULT = ["colors", "child", "sibling", "marker", "note", "box", "link", "copy", "paste", "trash", "!rel", "!table", "!fold", "!moveUp", "!moveDown"];

/** 主工具栏：sep1…sep4 是分隔线，也能挪、能藏；两条分隔线中间没有按钮时自动不显示 */
export const TOOLBAR_DEFAULT = [
  "outline",
  "lock",
  "splitSync",
  "sep1",
  "structure",
  "palette",
  "edge",
  "sep2",
  "zoomOut",
  "zoom",
  "zoomIn",
  "fit",
  "center",
  "sep3",
  "undo",
  "redo",
  "sep4",
  "search",
  "callout",
  "notes",
  "hidden",
  "recite",
  "layers",
];

const parse = (s: string): BarItem => (s.startsWith("!") ? { id: s.slice(1), on: false } : { id: s, on: true });

export function isSep(id: string): boolean {
  return /^sep\d+$/.test(id);
}

/** 存的清单 + 默认清单 → 完整的按钮列表（顺序、显示与否） */
export function mergeLayout(saved: readonly string[] | undefined, defaults: readonly string[]): BarItem[] {
  const defs = defaults.map(parse);
  const known = new Set(defs.map((d) => d.id));
  const out: BarItem[] = [];
  const seen = new Set<string>();
  for (const s of saved ?? []) {
    const it = parse(s);
    if (!known.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  // 没存过的（新版本加的）：插在默认清单里它前面那一项的后面，没有就放最前
  defs.forEach((d, i) => {
    if (seen.has(d.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === defs[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, { ...d });
    seen.add(d.id);
  });
  return out;
}

export function encodeLayout(items: readonly BarItem[]): string[] {
  return items.map((x) => (x.on ? x.id : `!${x.id}`));
}

/** 和默认一样就存空数组（以后默认改了照样跟着走） */
export function sameAsDefault(items: readonly BarItem[], defaults: readonly string[]): boolean {
  const e = encodeLayout(items);
  return e.length === defaults.length && e.every((x, i) => x === defaults[i]);
}

/** 挪一格：dir = -1 往前，1 往后 */
export function moveItem(items: readonly BarItem[], index: number, dir: -1 | 1): BarItem[] {
  const j = index + dir;
  if (j < 0 || j >= items.length) return [...items];
  const out = [...items];
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}

/** 分隔线该不该显示：前面（到上一条显示的分隔线为止）和后面（到下一条分隔线为止）都得有看得见的按钮 */
export function visibleSeps(kinds: readonly ("sep" | "tool" | "gone")[]): boolean[] {
  const show = kinds.map(() => false);
  let toolBefore = false;
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === "tool") toolBefore = true;
    if (kinds[i] !== "sep") continue;
    let toolAfter = false;
    for (let j = i + 1; j < kinds.length && kinds[j] !== "sep"; j++) if (kinds[j] === "tool") toolAfter = true;
    show[i] = toolBefore && toolAfter;
    if (show[i]) toolBefore = false;
  }
  return show;
}
