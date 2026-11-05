import assert from "node:assert/strict";
import test from "node:test";
import { htmlCharset, isWebUrl, linkDestination, pastedLink, titleFromHtml } from "../../src/paste-link";
import { TOKEN_RE } from "../../src/inline";

test("选中文字粘网址：包成 [文字](网址)", () => {
  assert.equal(pastedLink("bilibili", "https://www.bilibili.com"), "[bilibili](https://www.bilibili.com)");
  assert.equal(pastedLink("文档", "  https://a.cn/x?q=1#h \n"), "[文档](https://a.cn/x?q=1#h)");
  assert.equal(pastedLink("写信", "mailto:a@b.cn"), "[写信](mailto:a@b.cn)");
  assert.equal(pastedLink("库", "obsidian://open?vault=JackWei"), "[库](obsidian://open?vault=JackWei)");
  assert.equal(pastedLink("文献", "zotero://select/items/ABC"), "[文献](zotero://select/items/ABC)");
});

test("网址里的括号转义，渲染时地址才不会在右括号处断开", () => {
  const link = pastedLink("词条", "https://en.wikipedia.org/wiki/Foo_(bar)")!;
  assert.equal(link, "[词条](https://en.wikipedia.org/wiki/Foo_%28bar%29)");
  const m = [...link.matchAll(TOKEN_RE)][0];
  assert.equal(m[0], link);
  assert.equal(m[9], "https://en.wikipedia.org/wiki/Foo_%28bar%29");
});

test("本地路径转成 file:// 地址", () => {
  assert.equal(linkDestination("/Users/jack/Documents/a.pdf"), "file:///Users/jack/Documents/a.pdf");
  assert.equal(linkDestination("/Users/jack/My Docs/b (1).pdf"), "file:///Users/jack/My%20Docs/b%20%281%29.pdf");
  assert.equal(linkDestination("/Users/jack/读书笔记"), "file:///Users/jack/读书笔记");
  assert.equal(linkDestination("/Users/jack/100%.txt"), "file:///Users/jack/100%25.txt");
  assert.equal(linkDestination("C:\\Users\\jack\\a.pdf"), "file:///C:/Users/jack/a.pdf");
  assert.equal(linkDestination("D:/资料"), "file:///D:/资料");
  assert.equal(linkDestination("\\\\nas\\share\\a.pdf"), "file://nas/share/a.pdf");
  const link = pastedLink("合同", "/Users/jack/My Docs/b (1).pdf")!;
  assert.equal([...link.matchAll(TOKEN_RE)][0][0], link);
});

test("不是网址或路径的照常粘贴", () => {
  for (const clip of ["普通文字", "备注:内容", "TODO:写完", "a/b", "/", "/单段", "https://a.cn\nhttps://b.cn", "https://a.cn 和别的", ""]) {
    assert.equal(linkDestination(clip), null, clip);
    assert.equal(pastedLink("文字", clip), null, clip);
  }
});

test("选中的文字不适合当链接文字时照常粘贴", () => {
  assert.equal(pastedLink("", "https://a.cn"), null);
  assert.equal(pastedLink("  ", "https://a.cn"), null);
  assert.equal(pastedLink("两\n行", "https://a.cn"), null);
  assert.equal(pastedLink("[[笔记]]", "https://a.cn"), null);
  assert.equal(pastedLink("a]b", "https://a.cn"), null);
});

test("只有网页地址才抓标题", () => {
  assert.ok(isWebUrl("https://www.bilibili.com/video/BV1"));
  assert.ok(isWebUrl(" http://a.cn "));
  assert.ok(!isWebUrl("file:///Users/a"));
  assert.ok(!isWebUrl("mailto:a@b.cn"));
  assert.ok(!isWebUrl("https://a.cn b"));
});

test("网页标题：og:title 优先，实体解码，去掉方括号和换行", () => {
  assert.equal(titleFromHtml("<html><head><title>  哔哩哔哩 (゜-゜)つロ\n 干杯~ </title></head></html>"), "哔哩哔哩 (゜-゜)つロ 干杯~");
  assert.equal(titleFromHtml('<meta property="og:title" content="视频标题"><title>别的</title>'), "视频标题");
  assert.equal(titleFromHtml('<meta content="反过来写" property="og:title"><title>别的</title>'), "反过来写");
  assert.equal(titleFromHtml("<title>A &amp; B &#39;C&#39; &#x4e2d;</title>"), "A & B 'C' 中");
  assert.equal(titleFromHtml("<title>[置顶] 公告</title>"), "置顶 公告");
  assert.equal(titleFromHtml("<title>  </title>"), null);
  assert.equal(titleFromHtml("<p>没有标题</p>"), null);
});

test("网页编码：响应头优先，其次 meta", () => {
  assert.equal(htmlCharset("text/html; charset=GBK", '<meta charset="utf-8">'), "gbk");
  assert.equal(htmlCharset("text/html", '<meta charset="gb2312">'), "gb2312");
  assert.equal(htmlCharset(undefined, '<meta http-equiv="Content-Type" content="text/html; charset=big5">'), "big5");
  assert.equal(htmlCharset(undefined, "<html>"), "utf-8");
});
