/**
 * 跟随当前笔记（设置 followActiveNote）：编辑器里换了笔记，挑哪张脑图跟着换。纯逻辑，单测直接 import。
 * 先看和这篇笔记同一个窗口里的脑图：两块屏幕各开一套「笔记 + 脑图」时各跟各的，不交叉（#56）；
 * 这个窗口里一张脑图都没有时才跟别的窗口里的（脑图单独放在第二块屏幕上跟着主窗口的笔记）。
 * 已经有脑图显示着这篇就不换；钉住的不换；剩下的挑最近用过的那张
 */
export interface FollowCandidate {
  win: unknown;
  file: string | null;
  pinned: boolean;
  activeTime: number;
}

export function pickFollowTarget<T extends FollowCandidate>(maps: T[], noteWin: unknown, file: string): T | null {
  const same = maps.filter((m) => m.win === noteWin);
  const pool = same.length ? same : maps;
  if (!pool.length || pool.some((m) => m.file === file)) return null;
  const free = pool.filter((m) => !m.pinned).sort((a, b) => b.activeTime - a.activeTime);
  return free[0] ?? null;
}
