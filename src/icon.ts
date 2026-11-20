import { addIcon } from "obsidian";

/**
 * 插件自带的脑图图标：Phosphor 的 tree-structure（MIT），
 * 形状是一个节点向右分出两个子节点，正是脑图的样子。
 * 自己注册而不是借用 Lucide 的 git-fork，一来语义准确，二来不依赖任何主题或图标插件。
 */
export const MINDMAP_ICON = "mindmap-tree";

/**
 * 写进笔记 `icon` 属性时用的值。Notebook Navigator 只有走 `lucide:` 这一分支才会
 * 调用 Obsidian 的图标查找，从而找到上面注册的自定义图标；裸名字会被它当成无效值丢掉。
 */
export const MINDMAP_LIST_ICON = `lucide:${MINDMAP_ICON}`;

// Phosphor 画在 256 的网格上，Obsidian 的自定义图标用 100 的网格
const SCALE = "scale(0.390625)";
// 实心图标必须显式跟着 currentColor 走 —— SVG 的 fill 默认是黑色，
// 而 Obsidian 的 .svg-icon 只给 color，深色模式下就成了一坨黑。
// stroke 也一并关掉，免得被主题的 .svg-icon { stroke: currentColor } 描一圈变粗。
const CONTENT = '<path d="M160,112h48a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H160a16,16,0,0,0-16,16V64H128a24,24,0,0,0-24,24v32H72v-8A16,16,0,0,0,56,96H24A16,16,0,0,0,8,112v32a16,16,0,0,0,16,16H56a16,16,0,0,0,16-16v-8h32v32a24,24,0,0,0,24,24h16v16a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V160a16,16,0,0,0-16-16H160a16,16,0,0,0-16,16v16H128a8,8,0,0,1-8-8V88a8,8,0,0,1,8-8h16V96A16,16,0,0,0,160,112ZM56,144H24V112H56v32Zm104,16h48v48H160Zm0-112h48V96H160Z"/>';

/**
 * 「以 Markdown 打开」按钮的图标：Lucide 的 file-text（ISC），自己注册一份。
 * 有用户反馈部分安卓版本上借用的 file-text 显示成空白、按钮点不到，自带的不受 Obsidian 版本影响。
 * Lucide 画在 24 的网格上，放大到 100；描边跟着一起放大，粗细和 Obsidian 自带图标一致
 */
export const MARKDOWN_ICON = "mindmap-markdown";
const MARKDOWN_CONTENT =
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>';

export function registerMindMapIcon(): void {
  addIcon(MINDMAP_ICON, `<g transform="${SCALE}" fill="currentColor" stroke="none">${CONTENT}</g>`);
  addIcon(MARKDOWN_ICON, `<g transform="scale(4.1666667)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${MARKDOWN_CONTENT}</g>`);
}
