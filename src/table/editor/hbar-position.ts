/** Keep the floating scrollbar above an overlapping status bar. */
export function hbarBottom(left: number, right: number, bottom: number, height: number, status: { left: number; right: number; top: number; bottom: number } | null): number {
  return status && left < status.right && right > status.left && bottom > status.top && bottom - height < status.bottom ? status.top : bottom;
}
