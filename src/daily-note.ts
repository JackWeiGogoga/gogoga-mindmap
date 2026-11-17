/** 节点表格的日期列写成 [[日记]] 时用：按 Obsidian 日记插件（或 Periodic Notes）设的日期格式写名字、读名字 */
import { type App, moment } from "obsidian";
import type { Ymd } from "./table/core/coltype";

/** obsidian 导出的 moment 在类型上是个命名空间，这里按函数用 */
interface M {
  format(f: string): string;
  isValid(): boolean;
  year(): number;
  month(): number;
  date(): number;
}
const mo = moment as unknown as (input: unknown, format?: string, strict?: boolean) => M;

/** 日记的日期格式只取文件名那段（YYYY/MM/YYYY-MM-DD 的最后一段），链接按文件名就能找到 */
function noteFormat(app: App): string {
  const internal = (app as unknown as { internalPlugins?: { getPluginById?(id: string): { enabled?: boolean; instance?: { options?: { format?: string } } } | null } }).internalPlugins;
  const daily = internal?.getPluginById?.("daily-notes");
  const fmt = (daily?.enabled !== false && daily?.instance?.options?.format) || "YYYY-MM-DD";
  return fmt.split("/").pop() || "YYYY-MM-DD";
}

export function dailyNote(app: App): { name(v: Ymd): string; parse(name: string): Ymd | null } {
  return {
    name: (v) => mo({ year: v.y, month: v.m - 1, date: v.d }).format(noteFormat(app)),
    parse: (name) => {
      const m = mo(name, noteFormat(app), true);
      return m.isValid() ? { y: m.year(), m: m.month() + 1, d: m.date() } : null;
    },
  };
}
