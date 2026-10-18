# gogoga Mind Map

[English](https://github.com/JackWeiGogoga/gogoga-mindmap/blob/main/README.md) | **简体中文**

XMind 风格的思维导图插件。Markdown 是唯一数据源：标题和列表就是节点，脑图视图只是同一个 `.md`
文件的另一种编辑器，改哪边另一边都跟着变。零运行时依赖，桌面端和移动端都能用。

界面语言跟随 Obsidian 的语言设置，支持简体中文和英文。

![演示：Markdown 与脑图双向同步、四种结构、七个主题、折叠与聚焦](https://raw.githubusercontent.com/JackWeiGogoga/gogoga-mindmap/main/docs/demo.gif)

![Mind Map 使用指南（snow 主题）](https://raw.githubusercontent.com/JackWeiGogoga/gogoga-mindmap/main/docs/snow.png)

## 用法

> [!tip] 想快速上手，把 `docs/` 下的两篇复制进 vault：
> [Mind Map 使用指南](https://github.com/JackWeiGogoga/gogoga-mindmap/blob/main/docs/Mind%20Map%20%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md) 用脑图打开就是一张可以点开、可以折叠的功能地图，
> 插件的每个能力都在上面，而且用它自己演示了一遍；它链到的
> [脑图代码块嵌入示例](https://github.com/JackWeiGogoga/gogoga-mindmap/blob/main/docs/%E8%84%91%E5%9B%BE%E4%BB%A3%E7%A0%81%E5%9D%97%E5%B5%8C%E5%85%A5%E7%A4%BA%E4%BE%8B.md) 则是一篇插了两块 `mindmap` 的普通笔记。

1. 命令面板 → **新建思维导图**，或者给任意笔记的 frontmatter 加上 `mindmap: true`。
2. 带这个键的笔记默认以脑图打开；视图右上角的按钮、命令 **在思维导图和 Markdown 之间切换**、
   文件右键菜单都能来回切。
   普通笔记切换成脑图时会写入 `mindmap: true`，以后一直以脑图打开；不想改文件的话，在设置里关掉**切换成思维导图时记住**，就只切换当前标签页。
   想边写边看，用命令或文件右键菜单里的**在右侧以思维导图预览**：脑图在右侧分屏打开，左边打字时实时跟着变，也不会改文件。
3. 普通笔记里写一个 ```` ```mindmap ```` 代码块，块内写同样的 Markdown，阅读模式和实时预览都会渲染成一张小图。
   默认只读；点工具栏的铅笔或双击节点进入编辑，改动直接写回这个代码块，撤销重做也只作用于块内。
4. 把 `.xmind` 文件放进 vault 直接打开：只读渲染，多工作表可切换，右上角一键**转换为 Markdown 笔记**。
   外框会一起转过来；自由主题、联系线、概要、评论暂不支持，右上角会提示丢掉了几项。
   XMind Zen / 2020 之后的 content.json 和 XMind 8 的 content.xml 都支持。
5. 视图菜单（右上角 ⋯）或命令面板：**导出为 PNG**、**导出为 SVG**、**复制为图片**。
   PNG 是 2 倍分辨率，Obsidian 自带的 Inter 字体会内嵌，导出和屏幕上看到的一致。

### 编辑

- 单击选中，双击编辑；选中后节点上方出现浮动工具栏：9 种颜色、编辑备注、删除。
- **拖拽节点**到另一个节点上成为它的子节点，拖到子节点列的空隙里则插到那个位置；左右分布时拖到另一侧也行。
- Shift 点击加选，⌘ 点击反选，**Shift 拖拽空白处框选**，⌘A 全选；多选后颜色和删除对整组生效。
- 点节点上的 ≡ 查看备注，工具栏里的备注按钮直接编辑；备注支持 Markdown，写回时保持在节点下方。
- ⌘F 搜索节点：匹配的节点高亮，Enter / Shift+Enter 在结果间跳转并居中，折叠着的祖先会自动展开。
- ⌘C / ⌘X / ⌘V 复制、剪切、粘贴子树。剪贴板里是缩进列表形式的 Markdown，可以粘到任何地方；
  反过来把一段列表、标题或纯文本行粘进来，会按结构变成当前节点的子节点。
- 工具栏的层级按钮：展开全部、只显示主主题、显示到第 2 / 3 层。
- 编辑时 Shift+Enter 换行，多行文本以 `<br>` 存在标题或列表项里，阅读模式照常渲染。
- 触屏：单指平移、双指缩放、轻点选中、按住 0.4 秒再拖动换父节点，按钮在触屏上自动放大。
- **大纲面板**：工具栏最左的按钮或命令「切换大纲面板」，左侧出现树形列表，与画布双向联动。
  面板里 ↑↓ 移动、Tab / Shift+Tab 降级升级、Alt+↑↓ 排序、Enter 加兄弟并就地改名、Delete 删除、Space 折叠。
  画布上同样支持 Alt+方向键排序与升降级。
- **节点链接笔记**：⌘K 或工具栏的链接按钮，选一篇已有笔记或直接新建，标签变成 `[[笔记|原文]]`；
  新建的笔记在右侧分栏打开。已链接的节点再按 ⌘K 可打开或取消链接。按住 ⌘ 悬停有页面预览。
- **结构**：逻辑图（向右）、思维导图（左右分布）、组织结构图（向下）、树形图，工具栏结构菜单切换。
- **主题**：工具栏的调色盘按钮切换，七个主题——雪松（默认，深色中心配灰底节点）、彩虹（分支各一色）、
  商务（蓝色系直角折线）、暖阳（橙调大圆角）、极简（黑白描边细线）、线条（纯文字节点配细折线）、森林（绿调分支）。
  切换结果写进 `mindmap-theme`，按文件生效；设置里可改新文件的默认主题。每个主题都配了深色模式。
- **公式与图片**：标签里写 `$E=mc^2$` 渲染成公式；`![[图片.png|160]]` 或 `![alt](url)` 渲染成缩略图，
  数字参数是宽度，选中后拖右下角手柄改大小。备注里的代码块带语法高亮。导出 PNG/SVG 时公式和图片都会内嵌。
- **右键菜单**：节点和空白处都有，编辑、增删、聚焦、折叠、链接、备注、标记、任务、本级转为标题 / 本级转为列表、复制节点链接、删除全在里面。
- **聚焦分支**：把某个分支当作根单独显示，顶部面包屑一键回到全图或任一祖先；Esc 也能退出。
- **标记**：节点工具栏的星形按钮打开选择器，优先级、进度、旗帜、符号四组，以 emoji 存在文字开头，任何地方都能显示。
- **节点宽度**：选中节点后拖它外侧边缘的手柄改宽度，文字自动换行、高度跟着变；双击手柄或右键 → **恢复自动宽度** 还原。存为 `%%w=240%%`。
- **外框**：点节点浮动工具栏的外框按钮、按 ⌘⇧B，或右键节点 → **添加外框**，把节点连同分支框起来；先多选几个相邻的兄弟再加，就框成一个。再次右键节点或右键外框标题，可以添加/编辑标题、移除外框，双击标题也能直接改。导出 PNG/SVG 时外框一起导出。
- **任务复选框**：`[ ] 事项` 渲染成复选框，点击在未完成、完成、去掉之间切换。
- **#标签**：节点里的 `#标签` 渲染成标签样式，点击打开全局搜索。
- **外部链接**：`[文字](https://…)` 或直接粘一个裸网址都会成链，点击用浏览器打开；句尾标点不会被吃进去。
- **视频等 iframe 嵌入**：B 站 / YouTube 复制的 `<iframe …>` 直接粘进节点就渲染成播放器。只认 iframe 这一个标签、`src` 必须是 http(s)，属性另行解析后用 DOM API 建元素，不写 innerHTML；默认不自动播放（渲染时补 `autoplay=0`，笔记原文不动；想自动播就自己写 `autoplay=1`），折叠着的分支不加载。备注里也能放，走 Obsidian 自己的渲染器。
  播放器上盖了一层挡板，单击只是选中节点，双击画面或点右下角的「激活」按钮才放行，避免顺手一点就跳去源站；激活的节点带一圈虚线，点别处自动收回。
  选中后右下角的手柄能拖着改大小（默认锁宽高比，Shift 单独拉高度，双击恢复 560×315）。
- **拖入与粘贴**：从文件列表把笔记拖到节点上变成 `[[链接]]` 子节点，拖入或粘贴图片会存到附件目录并生成图片节点。
- **复制节点链接**：标题节点给 `[[笔记#标题]]`，列表节点自动补块 id 给 `[[笔记#^id]]`，别的笔记里可以引用。
- **移动端**：节点工具栏有加子节点、加兄弟按钮，底部工具栏有撤销重做，没有键盘也能完整编辑。
- ⌘B / ⌘I 给选中节点整体加粗、斜体。

### Markdown 映射

```markdown
---
mindmap: true
mindmap-structure: mindmap   # 可选：logic-right（默认）| mindmap | org-down | tree-right
mindmap-theme: rainbow       # 可选：snow（默认）| rainbow | business | warm | mono | line | forest
---

# 中心主题                     ← 唯一的一级标题；没有就用文件名

这里的段落是中心主题的备注。

## 主主题 %%green%%            ← %%颜色%% 给节点上色，阅读模式里看不见
### 子主题
- 更深的层级用列表
	- 再深一层
- 折叠状态也存在文件里 %%fold%%
```

- 颜色名：`red orange yellow green teal blue purple pink gray`，或 `#hex`。
- 外框也写在这个注释里：`%%box%%` 框住节点和它的分支，`%%box=3%%` 连同后面两个兄弟一起框，`%%box "标题"%%` 带标题。
- 标题最多到 H6，之后自动改用列表。新建节点默认从第四级开始用列表，可在设置里改。
- 节点下面的段落、代码块原样保留为备注，节点上会显示一个 ≡ 图标，点开查看。
- XMind 导出的 Markdown 就是这套标题层级，可以直接打开；反过来也能被 XMind 导入。

### 快捷键（画布获得焦点时）

| 键 | 作用 |
|---|---|
| Tab | 添加子节点 |
| Enter | 添加兄弟节点（根节点上是添加子节点）；Shift+Enter 插到前面 |
| 双击 / 空格 / F2 | 编辑；Enter 提交，Esc 取消 |
| Delete / Backspace | 删除选中的节点及其子树 |
| ⌘F | 搜索节点，Enter / Shift+Enter 跳转 |
| ⌘C / ⌘X / ⌘V | 复制 / 剪切 / 粘贴子树 |
| Shift+Enter（编辑中） | 节点内换行 |
| ⌘K | 链接到笔记 / 新建笔记 |
| ⌘⇧B | 给选中的节点加外框 / 移除外框 |
| Alt+↑↓ / Alt+←→ | 兄弟间排序 / 升级降级 |
| Shift+点击 / ⌘+点击 / Shift+拖拽 / ⌘A | 加选 / 反选 / 框选 / 全选 |
| 拖拽节点 | 换父节点或调整顺序 |
| / | 折叠、展开 |
| 方向键 | 在节点间移动 |
| ⌘Z / ⌘⇧Z | 撤销 / 重做 |
| 滚轮 / 拖拽空白处 | 平移（可在设置 → 鼠标滚轮 改为滚轮缩放，此时 Shift + 滚轮平移） |
| ⌘+滚轮 / 双指捏合 / ⌘= ⌘- | 缩放；⌘0 适应画布 |

## 开发

```bash
pnpm install
pnpm test            # Markdown 往返与布局的单元测试
pnpm typecheck
pnpm lint            # 与 Obsidian 社区目录审核相同的 ESLint 规则
pnpm build           # 产物在 dist/main.js
pnpm install-vault   # 复制到 OBSIDIAN_VAULT=... 指定的 vault
pnpm harness         # 监听构建 dev/harness.js，然后用任意静态服务器打开 dev/index.html
pnpm gen-bench 3000  # 生成压测用的大脑图笔记到 vault 的 inbox
```

### 性能

3000 节点（Obsidian 桌面端实测，优化后）：打开 195ms，单次渲染 11ms，打字时每次重排 7ms，
平移每帧 0.2ms，折叠到第二层 55ms，导出 PNG 785ms。1000 节点分别是 53ms / 2ms / 1.6ms / 0.2ms / 10ms。
渲染按节点 id 复用 DOM，只重建内容变了的元素；连线复用 path 只改 `d`；打字时只重新测量正在编辑的节点。

`dev/index.html` 是脱离 Obsidian 的调试页，能切主题、结构、深色模式，并实时打印写回的 Markdown。

### 结构

| 文件 | 职责 |
|---|---|
| `src/markdown.ts` | Markdown ⇄ 树，往返无损 |
| `src/model.ts` | 树模型与增删移操作 |
| `src/layout.ts` | 布局引擎（逻辑图 / 左右分布）与连线几何 |
| `src/canvas.ts` | 渲染、平移缩放、选择、内联编辑、键盘 |
| `src/view.ts` | Obsidian 的 TextFileView，负责读写文件与撤销栈 |
| `src/main.ts` | 视图注册与重定向、命令、代码块（含写回）、菜单 |
| `src/codeblock.ts` | 在宿主笔记里定位并替换 mindmap 代码块 |
| `src/export.ts` | SVG / PNG 导出，内嵌字体 |
| `src/xmind.ts` | .xmind 读取（自带 zip 与 XML 解析）→ Markdown |
| `src/xmind-view.ts` | .xmind 只读视图与转换 |
| `src/outline.ts` | 大纲面板 |
| `src/note-picker.ts` | 链接笔记的选择器弹窗 |
| `src/theme.ts` | 主题注册表：连线形状、分支色、下划线层级、间距 |
| `src/icon.ts` | 插件自带的脑图图标（Phosphor tree-structure） |
| `src/icon-picker.ts` | 设置里的图标选择器，可搜索、可用 emoji |
| `src/icon-value.ts` | 图标取值的纯逻辑（前缀、emoji 判定） |
| `src/property-icon.ts` | 属性面板里 icon 一行的预览，点它可选图标 |
| `styles.css` | 主题变量与各主题的 `[data-theme]` 配色块，跟随 Obsidian 明暗模式 |

## 发布

推 tag 即发布：`git tag 0.3.1 && git push --tags`（tag 必须与 manifest.json 的 version 完全一致，不带 v），GitHub Actions 会构建并把 `main.js`、`manifest.json`、`styles.css`
挂到 Release。用 BRAT 的人填仓库地址就能装；手动安装把这三个文件放进
`<vault>/.obsidian/plugins/gogoga-mindmap/`。运行时不需要 Node。

## 支持作者

gogoga 系列全部免费开源。如果这个插件帮到了你，欢迎在 [爱发电](https://afdian.com/a/jackweigogoga) 支持一下，Obsidian 社区插件页面里也有赞助按钮。反馈 bug、提建议同样是很大的支持。

## 许可

MIT，见 [LICENSE](https://github.com/JackWeiGogoga/gogoga-mindmap/blob/main/LICENSE)。
