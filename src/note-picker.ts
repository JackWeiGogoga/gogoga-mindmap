import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "./i18n";

export type PickItem = { kind: "new"; name: string } | { kind: "file"; file: TFile };

/** 选一篇已有笔记，或按输入的名字新建一篇；第一项永远是「新建」 */
export class NotePickerModal extends FuzzySuggestModal<PickItem> {
  private picked = false;

  constructor(app: App, private suggested: string, private onPick: (item: PickItem | null) => void) {
    super(app);
    this.setPlaceholder(t("notePicker.placeholder"));
    this.setInstructions([
      { command: "↑↓", purpose: t("picker.navigate") },
      { command: "↵", purpose: t("picker.link") },
      { command: "esc", purpose: t("picker.dismiss") },
    ]);
  }

  getItems(): PickItem[] {
    return this.app.vault
      .getMarkdownFiles()
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .map((file) => ({ kind: "file", file }));
  }

  getItemText(item: PickItem): string {
    if (item.kind === "new") return item.name;
    const folder = item.file.parent?.path;
    return folder && folder !== "/" ? `${item.file.basename}  ${folder}` : item.file.basename;
  }

  getSuggestions(query: string): FuzzyMatch<PickItem>[] {
    const name = query.trim() || this.suggested;
    const list = super.getSuggestions(query);
    const exact = list.find((m) => m.item.kind === "file" && m.item.file.basename === name);
    const head: FuzzyMatch<PickItem>[] = exact ? [] : [{ item: { kind: "new", name }, match: { score: 0, matches: [] } }];
    return [...head, ...list];
  }

  renderSuggestion(match: FuzzyMatch<PickItem>, el: HTMLElement): void {
    if (match.item.kind === "new") {
      el.createSpan({ text: t("notePicker.create", { name: match.item.name }), cls: "mm-picker-new" });
      return;
    }
    super.renderSuggestion(match, el);
  }

  onChooseItem(item: PickItem): void {
    this.picked = true;
    this.onPick(item);
  }

  onClose(): void {
    super.onClose();
    // 选中建议时 Obsidian 先 close 再调 onChooseItem，得等一拍再判定是否取消
    window.setTimeout(() => {
      if (!this.picked) this.onPick(null);
    }, 0);
  }
}
