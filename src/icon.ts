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

export function registerMindMapIcon(): void {
  addIcon(MINDMAP_ICON, `<g transform="${SCALE}" fill="currentColor" stroke="none">${CONTENT}</g>`);
}
