import { taskState } from "./inline";
import type { MindNode } from "./model";

/** 任务完成度怎么显示（群里蝈蝈的建议）：关、百分比、完成数/总数、两者都显示 */
export type TaskProgressMode = "off" | "percent" | "count" | "both";

/**
 * 节点下面任务的完成情况。只算在「清单的上一级非清单节点」上：节点自己不是任务、直接子节点里有任务。
 * 从这些子任务往下一路连着的任务都算（子任务也各算一项）；中间隔了普通节点的，那个普通节点算它自己的，
 * 不往上累加。不是这种节点返回 null
 */
export function taskProgress(node: MindNode): { done: number; total: number } | null {
  if (taskState(node.text)) return null;
  let done = 0;
  let total = 0;
  const walk = (n: MindNode): void => {
    const s = taskState(n.text);
    if (!s) return;
    total += 1;
    if (s === "done") done += 1;
    for (const c of n.children) walk(c);
  };
  for (const c of node.children) walk(c);
  return total ? { done, total } : null;
}

/** 显示的文字：20%、1/5、1/5 · 20%。百分比向下取整，没全做完不会显示成 100% */
export function progressLabel(p: { done: number; total: number }, mode: TaskProgressMode): string {
  const pct = `${Math.floor((p.done / p.total) * 100)}%`;
  const count = `${p.done}/${p.total}`;
  if (mode === "percent") return pct;
  if (mode === "count") return count;
  return `${count} · ${pct}`;
}
