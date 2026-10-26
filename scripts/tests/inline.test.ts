import assert from "node:assert/strict";
import test from "node:test";
import { noAutoplay, setFrameSize, taskState, TOKEN_RE } from "../../src/inline";

/** 把一段文字里所有 token 抓出来：[命中的分组号, 匹配到的文本] */
function tokens(text: string): [number, string][] {
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  const out: [number, string][] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const g = m.findIndex((v, i) => i > 0 && v !== undefined);
    out.push([g, m[0]]);
  }
  return out;
}

/** 裸 URL 是第 18 组 */
const URL_GROUP = 18;
const MD_LINK_GROUP = 8;
const MD_IMAGE_GROUP = 3;
const TAG_GROUP = 17;
const FRAME_GROUP = 19;

test("裸 URL 单独成链", () => {
  assert.deepEqual(tokens("https://obsidian.md"), [[URL_GROUP, "https://obsidian.md"]]);
  assert.deepEqual(tokens("http://a.cn/x?y=1&z=2"), [[URL_GROUP, "http://a.cn/x?y=1&z=2"]]);
});

test("句子中间的裸 URL", () => {
  assert.deepEqual(tokens("见 https://obsidian.md 官网"), [[URL_GROUP, "https://obsidian.md"]]);
});

test("结尾的句读不吃进链接", () => {
  for (const [text, url] of [
    ["见 https://obsidian.md。", "https://obsidian.md"],
    ["见 https://obsidian.md，还有别的", "https://obsidian.md"],
    ["see https://obsidian.md.", "https://obsidian.md"],
    ["see https://obsidian.md, and", "https://obsidian.md"],
    ["真的吗 https://obsidian.md？", "https://obsidian.md"],
    ["（见 https://obsidian.md）", "https://obsidian.md"],
    ["「https://obsidian.md」", "https://obsidian.md"],
  ] as const) {
    assert.deepEqual(tokens(text), [[URL_GROUP, url]], text);
  }
});

test("路径里的半角括号保留", () => {
  const u = "https://zh.wikipedia.org/wiki/Rust_(编程语言)";
  assert.deepEqual(tokens(u), [[URL_GROUP, u]]);
});

test("结尾的斜杠和 # 锚点保留", () => {
  assert.deepEqual(tokens("https://obsidian.md/"), [[URL_GROUP, "https://obsidian.md/"]]);
  assert.deepEqual(tokens("https://a.cn/x#锚点"), [[URL_GROUP, "https://a.cn/x#锚点"]]);
});

test("[文字](url) 仍然整体匹配，URL 不再被单独抓一次", () => {
  assert.deepEqual(tokens("[官网](https://obsidian.md)"), [[MD_LINK_GROUP, "[官网](https://obsidian.md)"]]);
  assert.deepEqual(tokens("![图](https://a.cn/x.png)"), [[MD_IMAGE_GROUP, "![图](https://a.cn/x.png)"]]);
});

test("wiki 链接里的地址不受影响", () => {
  assert.deepEqual(tokens("[[笔记|https://a.cn]]"), [[6, "[[笔记|https://a.cn]]"]]);
});

test("URL 里的下划线不会被当成斜体", () => {
  const u = "https://a.cn/foo/_bar_/baz";
  assert.deepEqual(tokens(u), [[URL_GROUP, u]]);
});

test("锚点不会被当成 #标签，标签本身还认", () => {
  assert.deepEqual(tokens("https://a.cn/#tag"), [[URL_GROUP, "https://a.cn/#tag"]]);
  assert.deepEqual(tokens("#标签 https://a.cn"), [
    [TAG_GROUP, "#标签"],
    [URL_GROUP, "https://a.cn"],
  ]);
});

test("不成形的地址不匹配", () => {
  assert.deepEqual(tokens("https://"), []);
  assert.deepEqual(tokens("ftp://a.cn"), []);
  assert.deepEqual(tokens("说了句 https 而已"), []);
});

const BILI =
  '<iframe width="560" height="315" src="https://player.bilibili.com/player.html?bvid=BV1WAuG6wEWZ&page=1" title="Bilibili video player" frameborder="0" allowfullscreen></iframe>';

test("<iframe> 整段被当成一个 token，src 里的地址不再被单独抓一次", () => {
  assert.deepEqual(tokens(BILI), [[FRAME_GROUP, BILI]]);
});

test("自闭合和带 </iframe> 都认", () => {
  const open = '<iframe src="https://a.cn/x" width="300" height="200">';
  assert.deepEqual(tokens(open), [[FRAME_GROUP, open]]);
  const self = '<iframe src="https://a.cn/x" />';
  assert.deepEqual(tokens(self), [[FRAME_GROUP, self]]);
});

test("iframe 前后的文字照常解析", () => {
  const text = `看这个 ${BILI} #标签`;
  assert.deepEqual(tokens(text), [
    [FRAME_GROUP, BILI],
    [TAG_GROUP, "#标签"],
  ]);
});

test("只认 iframe，别的标签当普通文字", () => {
  // <script> 不会变成 token，标签本身原样显示（renderInline 从不写 innerHTML，不存在执行风险）；
  // 里面的地址跟正文里的裸链一样会成链，仅此而已
  assert.deepEqual(tokens('<script src="https://a.cn/x.js"></script>'), [[URL_GROUP, "https://a.cn/x.js"]]);
  assert.deepEqual(tokens("<b>粗</b>"), []);
  assert.deepEqual(tokens("<iframe>没有属性</iframe>"), []);
});

test("setFrameSize 改写 width / height，其余属性原样保留", () => {
  const out = setFrameSize(BILI, { w: 400, h: 225 });
  assert.match(out, /^<iframe width="400" height="225" /);
  assert.match(out, /src="https:\/\/player\.bilibili\.com/);
  assert.match(out, /title="Bilibili video player"/);
  assert.match(out, /allowfullscreen><\/iframe>$/);
  // 不能留下旧的 width / height
  assert.equal(out.match(/width=/g)?.length, 1);
  assert.equal(out.match(/height=/g)?.length, 1);
});

test("setFrameSize 传 null 恢复 560×315", () => {
  const small = setFrameSize(BILI, { w: 200, h: 113 });
  assert.match(setFrameSize(small, null), /^<iframe width="560" height="315" /);
});

test("setFrameSize 钳住上下限", () => {
  assert.match(setFrameSize(BILI, { w: 5, h: 5 }), /width="80" height="80"/);
  assert.match(setFrameSize(BILI, { w: 9999, h: 9999 }), /width="1200" height="1200"/);
});

test("setFrameSize 给没写宽高的 iframe 补上", () => {
  const bare = '<iframe src="https://a.cn/x"></iframe>';
  assert.equal(setFrameSize(bare, { w: 320, h: 180 }), '<iframe width="320" height="180" src="https://a.cn/x"></iframe>');
});

test("setFrameSize 只动 iframe，句子里的其他文字不变", () => {
  const text = `看这个 ${BILI} 结束`;
  const out = setFrameSize(text, { w: 300, h: 169 });
  assert.ok(out.startsWith("看这个 "));
  assert.ok(out.endsWith(" 结束"));
});

test("默认补上 autoplay=0", () => {
  assert.equal(noAutoplay("https://a.cn/p?x=1"), "https://a.cn/p?x=1&autoplay=0");
  assert.equal(noAutoplay("https://a.cn/p"), "https://a.cn/p?autoplay=0");
});

test("用户写了 autoplay 就不动它", () => {
  assert.equal(noAutoplay("https://a.cn/p?autoplay=1"), "https://a.cn/p?autoplay=1");
  assert.equal(noAutoplay("https://a.cn/p?x=1&autoplay=1&y=2"), "https://a.cn/p?x=1&autoplay=1&y=2");
  // 只认真正的参数，路径里带 autoplay 字样的不算
  assert.equal(noAutoplay("https://a.cn/autoplay/x"), "https://a.cn/autoplay/x?autoplay=0");
});

test("公式：$…$ 与 $$…$$ 都识别成一个公式，金额里的 $ 不算", () => {
  assert.deepEqual(tokens("行内 $E=mc^2$ 块级 $$\\int_0^1 x\\,dx$$ 价格 $5 和 $6"), [
    [5, "$E=mc^2$"],
    [5, "$$\\int_0^1 x\\,dx$$"],
  ]);
});

test("反斜杠转义：只留后面的标点，并且先于以那个标点开头的标记", () => {
  const ESC = 20;
  assert.deepEqual(tokens(String.raw`行内块元素：\<td\>表格中的特例`), [[ESC, "\\<"], [ESC, "\\>"]]);
  // \* 不会开启斜体，\[\[ 不会变成双链
  assert.deepEqual(tokens(String.raw`\*不是斜体*`), [[ESC, "\\*"]]);
  assert.deepEqual(tokens(String.raw`\[\[不是链接]]`), [[ESC, "\\["], [ESC, "\\["]]);
  // 反斜杠后面不是标点就原样留着；行内代码和公式里的反斜杠不动
  assert.deepEqual(tokens(String.raw`C:\Users`), []);
  assert.deepEqual(tokens("`a\\*b`"), [[12, "`a\\*b`"]]);
  assert.deepEqual(tokens(String.raw`$\frac{1}{2}$`), [[5, String.raw`$\frac{1}{2}$`]]);
});

test("选择题选项：[x] 正确、[ ] 错误，前面可以有标记 emoji，其余不算选项", () => {
  assert.equal(taskState("[x] 鲸鱼"), "done");
  assert.equal(taskState("[X] 鲸鱼"), "done");
  assert.equal(taskState("[ ] 鲨鱼"), "todo");
  assert.equal(taskState("🚩 [x] 蝙蝠"), "done");
  assert.equal(taskState("鲸鱼"), null);
  assert.equal(taskState("[x]没有空格"), null);
  assert.equal(taskState("[[链接]]"), null);
});

test("自定义标记：只认 emoji 和非 ASCII 符号，和内置重复的跳过；加进来后能识别、切换，同组互斥可选", async () => {
  const { parseCustomMarkers, setCustomMarkers, splitMarkers, toggleMarker, MARKER_GROUPS } = await import("../../src/inline");
  assert.deepEqual(parseCustomMarkers("🎯 📎, ★◆ A 1 # - 中 👨‍👩‍👧 ⭐ 🎯"), ["🎯", "📎", "★", "◆", "👨‍👩‍👧", "⭐"]);
  const before = MARKER_GROUPS.length;
  setCustomMarkers(["🎯", "📎", "⭐"], false);
  assert.equal(MARKER_GROUPS.length, before + 1);
  assert.deepEqual(MARKER_GROUPS[before].emojis, ["🎯", "📎"], "和内置的 ⭐ 重复，不进自定义组");
  assert.deepEqual(splitMarkers("🎯 📎 方案").markers, ["🎯", "📎"]);
  // 排序：内置在前，自定义在后
  assert.equal(toggleMarker("🎯 方案", "⭐"), "⭐ 🎯 方案");
  assert.equal(toggleMarker("🎯 方案", "📎"), "🎯 📎 方案");
  setCustomMarkers(["🎯", "📎"], true);
  assert.equal(toggleMarker("🎯 方案", "📎"), "📎 方案", "同组互斥时替换");
  // 清空：自定义组去掉，原来的 emoji 回到普通文字
  setCustomMarkers([], false);
  assert.equal(MARKER_GROUPS.length, before);
  assert.deepEqual(splitMarkers("🎯 方案"), { markers: [], rest: "🎯 方案" });
});
