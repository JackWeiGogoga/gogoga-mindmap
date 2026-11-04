import { type InlineFormat } from "./format";
import { t } from "./i18n";

export interface FormatPalette { text: string[]; highlight: string[] }

/** The same palette and actions are used in nodes and Markdown editors. */
export function buildFormatBar(palette: FormatPalette, apply: (format: InlineFormat) => void): HTMLElement {
  const bar = createDiv({ cls: "mm-format-bar" });
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("format.toolbar"));
  bar.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  bar.addEventListener("mousedown", (ev) => ev.preventDefault());
  const button = (cls: string, title: string, text: string, format: InlineFormat) => {
    const b = bar.createEl("button", { cls: `mm-format-btn ${cls}`, text });
    b.type = "button";
    b.setAttribute("aria-label", title);
    b.title = title;
    b.addEventListener("click", (ev) => { ev.stopPropagation(); apply(format); });
    return b;
  };
  button("is-bold", t("format.bold"), "B", { kind: "bold" });
  button("is-italic", t("format.italic"), "I", { kind: "italic" });
  button("is-highlight", t("format.highlight"), "H", { kind: "highlight" });
  const sep = () => bar.createSpan({ cls: "mm-format-sep" });
  if (palette.text.length) sep();
  for (const color of palette.text) button("is-color", t("format.textColor", { color }), "A", { kind: "color", color }).style.color = color;
  if (palette.highlight.length) sep();
  for (const color of palette.highlight) button("is-bg", t("format.highlightColor", { color }), "A", { kind: "bg", color }).style.background = color;
  sep();
  button("is-clear", t("format.clear"), "×", { kind: "clear" });
  return bar;
}
