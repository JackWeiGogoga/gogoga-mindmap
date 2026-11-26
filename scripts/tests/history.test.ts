import { test } from "node:test";
import assert from "node:assert/strict";
import { History } from "../../src/history";

const A = "# 图\n\n- 甲\n- 乙\n- 丙\n- 丁\n";
const B = A.replace("- 甲\n", "- 甲改\n");
const C = B.replace("- 丁\n", "- 丁改\n");

test("没有外部改动：撤销、重做按快照来回", () => {
  const h = new History();
  h.push(A, B);
  h.push(B, C);
  assert.deepEqual(h.undo(C), { text: B });
  assert.deepEqual(h.undo(B), { text: A });
  assert.equal(h.undo(A), null);
  assert.deepEqual(h.redo(A), { text: B });
  assert.deepEqual(h.redo(B), { text: C });
  assert.equal(h.redo(C), null);
});

test("这一步之后外面改了别处：撤销只退这一步，外面的改动留着", () => {
  const h = new History();
  h.push(A, B);
  const outside = B.replace("- 丙\n", "- 丙外部\n");
  assert.deepEqual(h.undo(outside), { text: A.replace("- 丙\n", "- 丙外部\n") });
  // 重做也一样：撤销之后外面又改了一处
  const outside2 = A.replace("- 丙\n", "- 丙外部\n").replace("- 丁\n", "- 丁外部\n");
  assert.deepEqual(h.redo(outside2), { text: B.replace("- 丙\n", "- 丙外部\n").replace("- 丁\n", "- 丁外部\n") });
  // 重做完再撤销，回到重做前
  assert.deepEqual(h.undo(B.replace("- 丙\n", "- 丙外部\n").replace("- 丁\n", "- 丁外部\n")), { text: outside2 });
});

test("外面改的正好是这一步改过的那一行：不撤销，更早的记录一起丢掉", () => {
  const h = new History();
  h.push(A, B);
  h.push(B, C);
  const outside = C.replace("- 丁改\n", "- 丁外改\n");
  assert.deepEqual(h.undo(outside), { conflict: true });
  assert.equal(h.undo(outside), null);
});

test("编辑前后一样的一步不记", () => {
  const h = new History();
  h.push(A, A);
  assert.equal(h.undo(A), null);
});

test("新的编辑清掉重做", () => {
  const h = new History();
  h.push(A, B);
  h.undo(B);
  h.push(A, C);
  assert.equal(h.redo(C), null);
});
