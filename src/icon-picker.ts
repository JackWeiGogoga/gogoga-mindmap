import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";
import { MINDMAP_ICON } from "./icon";
import { t } from "./i18n";
import { bareId } from "./icon-value";

export type PickedIcon = { kind: "icon"; id: string } | { kind: "emoji"; value: string };

export { bareId, displayEmoji, iconIdOf, isEmojiValue } from "./icon-value";

/** 选中之后写进属性的值 */
export function storedValue(pick: PickedIcon): string {
  return pick.kind === "emoji" ? pick.value : `lucide:${bareId(pick.id)}`;
}

const RECOMMENDED = ["mindmap-tree", "lucide-network", "lucide-waypoints", "lucide-workflow", "lucide-list-tree", "lucide-git-fork", "lucide-brain"];

/** 带搜索和预览的图标选择器；输入 emoji 时第一项直接用这个 emoji */
export class IconPickerModal extends FuzzySuggestModal<PickedIcon> {
  private picked = false;

  constructor(app: App, private onPick: (pick: PickedIcon | null) => void) {
    super(app);
    this.setPlaceholder(t("iconPicker.placeholder"));
    this.setInstructions([
      { command: "↑↓", purpose: t("picker.navigate") },
      { command: "↵", purpose: t("picker.use") },
      { command: "esc", purpose: t("picker.dismiss") },
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
    return ordered.map((id) => ({ kind: "icon", id }));
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
      el.createSpan({ text: t("iconPicker.useEmoji"), cls: "mm-icon-label" });
      return;
    }
    setIcon(preview, match.item.id);
    el.createSpan({ text: bareId(match.item.id), cls: "mm-icon-label" });
    if (match.item.id === MINDMAP_ICON) el.createSpan({ text: t("iconPicker.builtIn"), cls: "mm-icon-tag" });
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
