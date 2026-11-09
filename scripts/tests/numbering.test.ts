import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown";
import { createNode, moveNode, numberLabel } from "../../src/model";

const parse = (t: string) => parseMarkdown(t, { fallbackTitle: "" });
const round = (t: string) => serializeMarkdown(parse(t));

test("有序列表读进来就是编号组，写回一字不差（按顺序、全是 1.、补零、1) 都保留）", () => {
  for (const md of [
    "# T\n\n- 步骤\n\t1. 一\n\t2. 二\n\t3. 三\n",
    "# T\n\n1. 一\n1. 二\n1. 三\n",
    "# T\n\n01. 一\n02. 二\n",
    "# T\n\n1) 一\n2) 二\n",
    "# T\n\n5. 五\n6. 六\n",
  ]) assert.equal(round(md), md);
  const doc = parse("# T\n\n- 步骤\n\t1. 一\n\t2. 二\n");
  const steps = doc.root.children[0];
  assert.equal(steps.numbered, true);
  assert.deepEqual(steps.children.map(numberLabel), ["1.", "2."]);
  assert.equal(parse("# T\n\n5. 五\n6. 六\n").root.children.map(numberLabel).join(" "), "5. 6.");
});

test("混着写的（先 - 再 1.）不算编号组，原样写回", () => {
  // 两种列表中间的空行由「保留原格式」那一层保住（真实笔记对照里验过），这里只看项目符号不变
  const md = "# T\n\n- 甲\n- 乙\n1. 一\n2. 二\n";
  assert.equal(round(md), md);
  assert.ok(!parse(md).root.numbered);
});

test("编号组里插入、挪动：写回时重新按顺序编号；拖到没编号的组换回 -", () => {
  const doc = parse("# T\n\n- 步骤\n\t1. 一\n\t2. 二\n\t3. 三\n- 别的\n\t- 甲\n");
  const [steps, other] = doc.root.children;
  const added = createNode({ parent: steps, text: "插在最前", kind: "list", bullet: "" });
  steps.children.unshift(added);
  assert.equal(serializeMarkdown(doc), "# T\n\n- 步骤\n\t1. 插在最前\n\t2. 一\n\t3. 二\n\t4. 三\n- 别的\n\t- 甲\n");
  moveNode(steps.children[3], other, 1, doc.style);
  assert.equal(serializeMarkdown(doc), "# T\n\n- 步骤\n\t1. 插在最前\n\t2. 一\n\t3. 二\n- 别的\n\t- 甲\n\t- 三\n");
});

test("标题子节点编号记在父节点的 %%num%%；列表子节点不用记", () => {
  const doc = parse("# T\n\n## 第一章\n\n## 第二章\n");
  doc.root.numbered = true;
  const md = serializeMarkdown(doc);
  assert.equal(md, "# T\n%%num%%\n\n## 第一章\n\n## 第二章\n");
  const back = parse(md);
  assert.equal(back.root.numbered, true);
  assert.deepEqual(back.root.children.map(numberLabel), ["1.", "2."]);
  assert.equal(serializeMarkdown(back), md);
});

test("取消编号后列表写回普通项目符号", () => {
  const doc = parse("# T\n\n1. 一\n2. 二\n");
  doc.root.numbered = undefined;
  for (const c of doc.root.children) c.bullet = "";
  assert.equal(serializeMarkdown(doc), "# T\n\n- 一\n- 二\n");
});

test("开编号时去掉这组手打的序号：全都带才去，有一个不带就不碰", async () => {
  const { stripTypedNumbers } = await import("../../src/model");
  const doc = parse("# T\n\n- 1. 一\n- 2) 二\n- 3、三\n");
  assert.equal(stripTypedNumbers(doc.root), true);
  assert.deepEqual(doc.root.children.map((c) => c.text), ["一", "二", "三"]);
  doc.root.numbered = true;
  assert.equal(serializeMarkdown(doc), "# T\n\n1. 一\n2. 二\n3. 三\n");
  const mixed = parse("# T\n\n- 1. 一\n- 二\n");
  assert.equal(stripTypedNumbers(mixed.root), false);
  assert.deepEqual(mixed.root.children.map((c) => c.text), ["1. 一", "二"]);
  // 「2024. 年」「1.5 倍」不算序号
  const year = parse("# T\n\n- 2024. 年\n- 1.5 倍\n");
  assert.equal(stripTypedNumbers(year.root), false);
});
