import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { editorInfoField } from "obsidian";
import { colorEditing } from "./color-editing";
import { markdownFormatBar } from "./markdown-format-bar";
import type { MindMapSettings } from "./settings";
import { parseColorList } from "./format";

/** HTML display is scoped to map notes; the optional selection bar works in Markdown editors. */
export function markdownColors(isMindMap: (path: string) => boolean, settings: () => MindMapSettings) {
  const isMap = (state: EditorState) => {
    const file = state.field(editorInfoField, false)?.file;
    return !!file && isMindMap(file.path);
  };
  return [colorEditing({
    enabled: (state) => {
      return settings().markdownHtmlRendering && isMap(state);
    },
    exclude: (state, span) => {
      for (const pos of [span.from, span.closeStart]) {
        for (let node = syntaxTree(state).resolveInner(pos, 1); node.parent; node = node.parent) {
          if (/code|frontmatter/i.test(node.type.name)) return true;
        }
      }
      return false;
    },
  }), markdownFormatBar((state) => settings().markdownFormatBar && !!state.field(editorInfoField, false)?.file, () => ({
    text: parseColorList(settings().textColors), highlight: parseColorList(settings().highlightColors),
  }))];
}
