/**
 * （和 gogoga-table 的 src/core/tokens.ts 是同一份，表格插件那份由脑图同步过去）
 * 节点、格子文字里能识别的行内写法：一个大正则 TOKEN_RE，分组含义见末尾。
 */

import { BG_OPEN_SRC, COLOR_OPEN_SRC } from "./format";

/**
 * 裸 URL 自动成链。放在 TOKEN_RE 最后，靠正则的「最左优先」保证
 * `[文字](url)` 和 `![alt](url)` 里的地址不会被单独抓出来 —— 它们从 `[` / `!` 开始，位置更靠前。
 *
 * 收尾规则：结尾不能是句读或成对的全角括号，所以「见 https://x.com。」里的句号会留在外面。
 * 半角括号是允许出现在里面的（维基那种 `..._(foo)` 才不会被截断），代价是
 * 「(https://x.com)」这种半角包起来的写法会把右括号一起吃进链接 —— 想精确控制就用 [文字](url)。
 */
// 一律不能出现在 URL 里的：空白、尖括号、引号，以及中文标点（中文里 URL 后面常常直接跟标点，不留空格）
const URL_STOP = String.raw`\s<>\]"'\x60。，、；：！？…「」『』【】〈〉《》（）“”‘’`;
// 半角句读可以出现在 URL 中间（a.cn/x.html），但不能收尾
const BARE_URL = String.raw`(https?:\/\/[^${URL_STOP}]*[^${URL_STOP},.;:!?])`;

/**
 * 直接粘 B 站 / YouTube 那种 `<iframe …></iframe>` 嵌入代码。只认这一个标签，
 * 属性另外解析（见 frame()），全程用 DOM API 建元素，不会把用户文本当 HTML 执行。
 * 放在 TOKEN_RE 最后，但 `<` 比 src 里的 `https://` 靠前，最左优先保证整段被它接走。
 */
const IFRAME = String.raw`<iframe\s([^>]*?)\/?>(?:\s*<\/iframe>)?`;

export const TOKEN_RE = new RegExp(
  String.raw`!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]` +
    String.raw`|!\[([^\]]*)\]\(([^)\s]+)\)` +
    // $公式$ 和 $$公式$$ 共用一个分组；$$ 的按 \displaystyle 排（节点里不另起一块，只是大一号）
    String.raw`|\$\$?(?!\s)([^$\n]+?)(?<!\s)\$\$?(?!\d)` +
    String.raw`|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]` +
    String.raw`|\[([^\]]+)\]\(([^)\s]+)\)` +
    String.raw`|\*\*(.+?)\*\*|__(.+?)__` +
    String.raw`|\x60([^\x60]+)\x60` +
    String.raw`|~~(.+?)~~|==(.+?)==` +
    String.raw`|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])` +
    String.raw`|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])` +
    String.raw`|(?<![\w#&])#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)` +
    `|${BARE_URL}` +
    `|${IFRAME}` +
    // 反斜杠转义：\<td\>、\*、\[ 之类只显示后面那个标点。反斜杠在被转义的符号前面，
    // 最左优先保证它先于以那个符号开头的标记被匹配到
    String.raw`|\\([!-/:-@[-\x60{-~])` +
    // 局部颜色：<span style="color:…">文字</span>、<mark style="background:…">文字</mark>，里面还能有别的格式
    `|${COLOR_OPEN_SRC}(.+?)</span>` +
    `|${BG_OPEN_SRC}(.+?)</mark>` +
    // 不带颜色的 <mark>文字</mark>：和 ==高亮== 一样
    String.raw`|<mark>(.+?)</mark>` +
    // 下划线：<u>文字</u>（Markdown 没有下划线语法，Obsidian 里通行这个 HTML 写法）
    String.raw`|<u>(.+?)</u>`,
  "gu",
);

// 分组含义：1-2 ![[图片|参数]]  3-4 ![alt](url)  5 $公式$  6-7 [[链接|别名]]  8-9 [文字](url)
// 10-11 粗体  12 行内代码  13 删除线  14 高亮  15-16 斜体  17 #标签  18 裸 URL  19 <iframe> 的属性串
// 20 被反斜杠转义的标点  21-22 文字颜色  23-24 荧光笔颜色  25 <mark> 高亮  26 <u> 下划线
