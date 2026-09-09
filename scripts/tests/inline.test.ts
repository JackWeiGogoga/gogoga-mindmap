import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_RE } from "../../src/inline";

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
