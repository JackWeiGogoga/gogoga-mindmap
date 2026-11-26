import { mergeExternal } from "./merge";

/** 一步编辑：编辑前后的全文 */
interface Step {
  before: string;
  after: string;
}

/** 撤销或重做的结果：text 是新的全文；conflict 表示这一步之后别处改过同一段，没法单独撤销 */
export type HistoryResult = { text: string } | { conflict: true } | null;

/**
 * 以 Markdown 全文为单位的撤销/重做栈。
 *
 * 每一步记下编辑前后的全文。撤销时如果当前文本还是这一步刚做完的样子，直接退回编辑前；
 * 不是（旁边的 Markdown、别的程序在这之后改过文件），就只把这一步的改动反着合进当前文本，别处的改动留着
 * —— 以前直接退回编辑前的快照，会把外面后来的改动一起抹掉。
 * 外面改到了这一步改过的同一段时没法拆开，这一步连同更早的都丢掉，返回 conflict 由调用方提示
 */
export class History {
  private past: Step[] = [];
  private future: Step[] = [];

  constructor(private limit = 200) {}

  push(before: string, after: string): void {
    if (before === after) return;
    this.past.push({ before, after });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: string): HistoryResult {
    const step = this.past.pop();
    if (!step) return null;
    const text = current === step.after ? step.before : mergeExternal(step.after, step.before, current);
    if (text === null) {
      this.past = [];
      return { conflict: true };
    }
    this.future.push({ before: text, after: current });
    return { text };
  }

  redo(current: string): HistoryResult {
    const step = this.future.pop();
    if (!step) return null;
    const text = current === step.before ? step.after : mergeExternal(step.before, step.after, current);
    if (text === null) {
      this.future = [];
      return { conflict: true };
    }
    this.past.push({ before: current, after: text });
    return { text };
  }

  reset(): void {
    this.past = [];
    this.future = [];
  }
}
