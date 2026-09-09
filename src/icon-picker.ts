import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";
import { MINDMAP_ICON } from "./icon";

export type PickedIcon = { kind: "icon"; id: string } | { kind: "emoji"; value: string };

/**
 * 存进笔记 `icon` 属性的值。
 * Notebook Navigator 只有 `lucide:` 这一分支会调 Obsidian 的图标查找，
 * 自定义注册的图标也只有走这里才认得出来，所以统一带上前缀。
 */
export function storedValue(pick: PickedIcon): string {
  return pick.kind === "emoji" ? pick.value : `lucide:${bareId(pick.id)}`;
}

/** getIconIds() 返回的 Lucide 图标带 `lucide-` 前缀，写进属性时要去掉 */
export function bareId(id: string): string {
  return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

/** 把存储值还原成可以交给 setIcon 的图标 id；是 emoji 则返回 null */
export function iconIdOf(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("emoji:")) return null;
  const name = v.startsWith("lucide:") ? v.slice("lucide:".length) : v;
  // 纯符号（emoji）不是图标 id
  if (!/^[a-z0-9-]+$/i.test(name)) return null;
  return name;
}

export function isEmojiValue(value: string): boolean {
  const v = value.trim();
  return !!v && iconIdOf(v) === null;
}

export function displayEmoji(value: string): string {
  return value.trim().replace(/^emoji:/, "");
}

const RECOMMENDED = ["mindmap-tree", "lucide-network", "lucide-waypoints", "lucide-workflow", "lucide-list-tree", "lucide-git-fork", "lucide-brain"];

/** 带搜索和预览的图标选择器；输入 emoji 时第一项直接用这个 emoji */
export class IconPickerModal extends FuzzySuggestModal<PickedIcon> {
  private picked = false;

  constructor(app: App, private onPick: (pick: PickedIcon | null) => void) {
    super(app);
    this.setPlaceholder("搜索图标名，或直接粘贴一个 emoji");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "使用" },
      { command: "esc", purpose: "取消" },
    ]);
    this.modalEl.addClass("mm-icon-picker");
  }

  getItems(): PickedIcon[] {
    const all = getIconIds();
    const seen = new Set<string>();
    const ordered: string[] = [];
    // 常用的排在最前，其余按字母序
    for (const id of RECOMMENDED) {
      if (all.includes(id) && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    for (const id of [...all].sort()) {
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    return ordered.map((id) => ({ kind: "icon", id }) as PickedIcon);
  }

  getItemText(item: PickedIcon): string {
    return item.kind === "emoji" ? item.value : bareId(item.id);
  }

  getSuggestions(query: string): FuzzyMatch<PickedIcon>[] {
    const list = super.getSuggestions(query);
    const q = query.trim();
    // 查询里有非 ASCII 字符时，大概率是粘了个 emoji
    if (q && !/^[\x20-\x7e]*$/.test(q)) {
      return [{ item: { kind: "emoji", value: q }, match: { score: 0, matches: [] } }, ...list];
    }
    return list;
  }

  renderSuggestion(match: FuzzyMatch<PickedIcon>, el: HTMLElement): void {
    el.addClass("mm-icon-row");
    const preview = el.createSpan({ cls: "mm-icon-preview" });
    if (match.item.kind === "emoji") {
      preview.setText(match.item.value);
      el.createSpan({ text: `使用这个 emoji`, cls: "mm-icon-label" });
      return;
    }
    setIcon(preview, match.item.id);
    el.createSpan({ text: bareId(match.item.id), cls: "mm-icon-label" });
    if (match.item.id === MINDMAP_ICON) el.createSpan({ text: "插件自带", cls: "mm-icon-tag" });
  }

  onChooseItem(item: PickedIcon): void {
    this.picked = true;
    this.onPick(item);
  }

  onClose(): void {
    super.onClose();
    // 选中建议时 Obsidian 先 close 再回调，等一拍再判定取消
    window.setTimeout(() => {
      if (!this.picked) this.onPick(null);
    }, 0);
  }
}
