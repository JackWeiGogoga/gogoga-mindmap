/**
 * 下拉填充：按选中的几格（一列或一行）推出往后的值（和 WPS、飞书表格一样默认按规律填）：
 * - 数字：一个就加 1 往下排（16 → 17、18）；两个以上按等差接着排（1、3 → 5、7）
 * - 文字带编号（第 1 期、项目3、Q1）：编号接着加，一格也加；几格的编号差一样就按这个差
 * - 日期（2026-11-06、2026/11/06）：一格按天往后；几格按它们的间隔
 * - 周一…周日、星期一…、一月…十二月、Mon…、Jan…、甲乙丙丁…：按顺序接着排，转一圈回到开头
 * - 别的：把选中的几格循环照抄
 * backward 为 true 时往上 / 往左填（序列倒着走）；copy 为 true 时一律循环照抄（拖的时候按住 ⌥）
 */

const LISTS: string[][] = [
  ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
  ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"],
  ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"],
  ["春", "夏", "秋", "冬"],
];

const NUM_RE = /^-?\d+(?:\.\d+)?$/;
const DATE_RE = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/;
const TAIL_NUM_RE = /^(.*?)(\d+)(\D*)$/;

/** 小数位数（填出来的数和原来的位数一致，避免 0.1+0.2 这种浮点尾巴） */
function decimals(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function fmtNum(v: number, places: number): string {
  return places ? v.toFixed(places) : String(Math.round(v));
}

function parseDate(s: string): { t: number; sep: string; pad: boolean } | null {
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[3]);
  const d = Number(m[4]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  // 月份写了两位就补零（日子本来就常是两位，不能拿它判断）
  return { t, sep: m[2], pad: m[3].length === 2 };
}

function fmtDate(t: number, sep: string, pad: boolean): string {
  const d = new Date(t);
  const p = (n: number) => (pad ? String(n).padStart(2, "0") : String(n));
  return `${d.getUTCFullYear()}${sep}${p(d.getUTCMonth() + 1)}${sep}${p(d.getUTCDate())}`;
}

/**
 * 按 source（选中的几格，按填充方向排好）推出接下来 count 个值。
 * backward：往上 / 往左填，第 1 个值紧挨着 source[0] 的前面
 */
export function fillSeries(source: readonly string[], count: number, backward = false, copy = false): string[] {
  const src = source.map((s) => s.trim());
  const n = src.length;
  if (!n || count <= 0) return [];
  const out: string[] = [];
  // k：离 source 的距离（1 = 紧挨着）。往后填接在最后一格后面，往前填接在第一格前面
  const at = (k: number) => (backward ? -k : n - 1 + k);
  if (copy) {
    for (let k = 1; k <= count; k++) {
      const i = at(k);
      out.push(source[((i % n) + n) % n]);
    }
    return out;
  }

  // 数字
  if (src.every((s) => NUM_RE.test(s))) {
    const vals = src.map(Number);
    const step = n === 1 ? 1 : (vals[n - 1] - vals[0]) / (n - 1);
    const places = Math.max(...src.map(decimals), decimals(String(step)) > 6 ? 6 : decimals(String(step)));
    for (let k = 1; k <= count; k++) out.push(fmtNum(vals[0] + step * at(k), places));
    return out;
  }

  // 日期
  const dates = src.map(parseDate);
  if (dates.every((d) => d)) {
    const ds = dates as { t: number; sep: string; pad: boolean }[];
    const day = 86400000;
    const step = n === 1 ? day : (ds[n - 1].t - ds[0].t) / (n - 1);
    for (let k = 1; k <= count; k++) out.push(fmtDate(ds[0].t + step * at(k), ds[0].sep, ds[0].pad));
    return out;
  }

  // 固定的顺序（周几、月份……）
  for (const list of LISTS) {
    const idx = src.map((s) => list.indexOf(s));
    if (idx.every((i) => i >= 0)) {
      const step = n === 1 ? 1 : (idx[n - 1] - idx[0]) / (n - 1);
      if (Number.isInteger(step) && idx.every((v, i) => v === idx[0] + step * i)) {
        const len = list.length;
        for (let k = 1; k <= count; k++) out.push(list[(((idx[0] + step * at(k)) % len) + len) % len]);
        return out;
      }
    }
  }

  // 文字带编号：前缀、后缀一样，编号等差
  const parts = src.map((s) => TAIL_NUM_RE.exec(s));
  if (parts.every((m) => m) && parts.every((m) => m![1] === parts[0]![1] && m![3] === parts[0]![3])) {
    const ms = parts as RegExpExecArray[];
    const nums = ms.map((m) => Number(m[2]));
    const step = n === 1 ? 1 : (nums[n - 1] - nums[0]) / (n - 1);
    if (Number.isInteger(step) && nums.every((v, i) => v === nums[0] + step * i)) {
      const width = ms[0][2].length;
      const zeroPad = ms[0][2].startsWith("0") && width > 1;
      for (let k = 1; k <= count; k++) {
        const v = nums[0] + step * at(k);
        const body = v < 0 ? String(v) : zeroPad ? String(v).padStart(width, "0") : String(v);
        out.push(ms[0][1] + body + ms[0][3]);
      }
      return out;
    }
  }

  // 循环照抄
  for (let k = 1; k <= count; k++) {
    const i = at(k);
    out.push(source[((i % n) + n) % n]);
  }
  return out;
}
