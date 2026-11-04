import { syntaxTree } from "@codemirror/language";
import { editorInfoField, editorLivePreviewField } from "obsidian";
import { colorEditing } from "./color-editing";

/** Reading view already renders HTML. Only enhance Live Preview in mind map notes. */
export function markdownColors(isMindMap: (path: string) => boolean) {
  return colorEditing({
    enabled: (state) => {
      const file = state.field(editorInfoField, false)?.file;
      return state.field(editorLivePreviewField, false) === true && !!file && isMindMap(file.path);
    },
    exclude: (state, span) => {
      for (const pos of [span.from, span.closeStart]) {
        for (let node = syntaxTree(state).resolveInner(pos, 1); node.parent; node = node.parent) {
          if (/code|frontmatter/i.test(node.type.name)) return true;
        }
      }
      return false;
    },
  });
}
