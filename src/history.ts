/** 以 Markdown 全文为单位的撤销/重做栈 */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private limit = 200) {}

  push(state: string): void {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: string): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  reset(): void {
    this.past = [];
    this.future = [];
  }
}
