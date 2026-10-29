import assert from "node:assert/strict";
import test from "node:test";
import { isPdfCrop, setImageWidth } from "../../src/inline";
import { parseClipboard } from "../../src/markdown";

const texts = (text: string) => parseClipboard(text).map((n) => [n.text, n.note]);

test("粘贴 PDF++ 默认复制的标注块：合成一个节点，原文做文字、链接到那段选区", () => {
  const clip = "> [!PDF|] [[reading.pdf#page=1&selection=9,0,9,116|reading, p.1]]\n> > Skilled readers do not read blindly, but purposely.\n> \n> \n";
  assert.deepEqual(texts(clip), [["[[reading.pdf#page=1&selection=9,0,9,116|Skilled readers do not read blindly, but purposely.]]", ""]]);
  // 带颜色、原文跨多行
  const multi = "> [!PDF|yellow] [[书/一本书.pdf#page=3&selection=1,2,4,5&color=yellow|一本书, p.3]]\n> > 第一行\n> > 第二行\n";
  assert.deepEqual(texts(multi), [["[[书/一本书.pdf#page=3&selection=1,2,4,5&color=yellow|第一行 第二行]]", ""]]);
});

test("粘贴 PDF++ 的其他模板：引用 + 括号里的链接、没有原文时用链接自己的显示文字", () => {
  assert.deepEqual(texts("> 选中的原文 ([[a.pdf#page=2&selection=1,0,1,9|a, p.2]])"), [["[[a.pdf#page=2&selection=1,0,1,9|选中的原文]]", ""]]);
  assert.deepEqual(texts("> [!PDF|] [[a.pdf#page=2&selection=1,0,1,9|a, p.2]]"), [["[[a.pdf#page=2&selection=1,0,1,9|a, p.2]]", ""]]);
  // 原文里的 | 和方括号会弄断链接，换掉
  assert.deepEqual(texts("> [!PDF|] [[a.pdf#page=1&selection=1,0,1,3|a, p.1]]\n> > x | y [1]"), [["[[a.pdf#page=1&selection=1,0,1,3|x / y (1)]]", ""]]);
});

test("连续粘贴几段 PDF++ 引用（空行隔开）：一段一个节点", () => {
  const clip = "> [!PDF|] [[a.pdf#page=1&selection=1,0,1,3|a, p.1]]\n> > 甲\n\n> [!PDF|] [[a.pdf#page=2&selection=2,0,2,3|a, p.2]]\n> > 乙\n";
  assert.deepEqual(texts(clip), [
    ["[[a.pdf#page=1&selection=1,0,1,3|甲]]", ""],
    ["[[a.pdf#page=2&selection=2,0,2,3|乙]]", ""],
  ]);
});

test("粘贴 PDF++ 截区：原样做一个节点（节点里显示裁切的图）", () => {
  assert.deepEqual(texts("![[a.pdf#page=1&rect=55,250,200,340|a, p.1]]"), [["![[a.pdf#page=1&rect=55,250,200,340|a, p.1]]", ""]]);
  assert.deepEqual(texts("> [!PDF|] ![[a.pdf#page=1&rect=55,250,200,340|a, p.1]]\n"), [["![[a.pdf#page=1&rect=55,250,200,340|a, p.1]]", ""]]);
});

test("粘贴普通引用和标注：一块一个节点，不再拆出只有 > 的空节点", () => {
  assert.deepEqual(texts("> 第一行\n> 第二行\n>\n"), [["第一行", "第二行"]]);
  assert.deepEqual(texts("> [!note] 标题\n> 正文"), [["标题", "正文"]]);
  assert.deepEqual(texts("> [!tip]\n> 只有正文"), [["tip", "只有正文"]]);
  // 不是整段引用：照旧按普通 Markdown 解析
  assert.deepEqual(texts("甲\n> 引用"), parseClipboard("甲\n> 引用").map((n) => [n.text, n.note]));
  assert.deepEqual(texts("- 甲\n- 乙"), [["甲", ""], ["乙", ""]]);
});

test("PDF 截区的识别和改宽度", () => {
  assert.ok(isPdfCrop("a.pdf#page=1&rect=1,2,3,4"));
  assert.ok(!isPdfCrop("a.pdf#page=1&selection=1,2,3,4"));
  assert.ok(!isPdfCrop("a.png"));
  assert.equal(setImageWidth("![[a.pdf#page=1&rect=1,2,3,4|a, p.1]]", 200), "![[a.pdf#page=1&rect=1,2,3,4|a, p.1|200]]");
  // 再改一次只换宽度，不会一段段接下去
  assert.equal(setImageWidth("![[a.pdf#page=1&rect=1,2,3,4|a, p.1|200]]", 260), "![[a.pdf#page=1&rect=1,2,3,4|a, p.1|260]]");
  assert.equal(setImageWidth("![[a.pdf#page=1&rect=1,2,3,4|a, p.1|200]]", null), "![[a.pdf#page=1&rect=1,2,3,4|a, p.1]]");
  assert.equal(setImageWidth("![[a.png|说明|120]]", 160), "![[a.png|说明|160]]");
});
