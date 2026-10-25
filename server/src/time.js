/**
 * 日期与时间工具。全部按本机本地时区处理，日期一律用 'YYYY-MM-DD' 字符串。
 */

const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD'（本地时区） */
export function fmtDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> 本地零点 Date */
export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

export function todayStr() {
  return fmtDate(new Date());
}

/** 日期加减天数 */
export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** 两个日期相差天数（b - a） */
export function diffDays(a, b) {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / 86400000);
}

/** 0=周日 … 6=周六 */
export function weekday(dateStr) {
  return parseDate(dateStr).getDay();
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekdayName = (dateStr) => WEEKDAY_NAMES[weekday(dateStr)];

/** 'HH:MM' -> 当天分钟数 */
export function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 分钟数 -> 'HH:MM' */
export function toHHMM(minutes) {
  const total = Math.max(0, Math.round(minutes));
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

/** 两个 'HH:MM' 之间的分钟数 */
export function span(start, end) {
  return Math.max(0, toMinutes(end) - toMinutes(start));
}

/** 当前时刻的分钟数 */
export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

/** ISO 周：返回 { year, week, key }，周一为一周开始 */
export function isoWeek(dateStr) {
  const d = parseDate(dateStr);
  // 移到本周周四，用于确定所属年份
  const day = (d.getDay() + 6) % 7; // 周一 = 0
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - day + 3);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.floor((thursday - jan1) / 86400000) + 1;
  const week = Math.ceil(dayOfYear / 7);
  return { year, week, key: `${year}-W${pad(week)}` };
}

/** 周 key -> 该周周一的日期 */
export function weekStartFromKey(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key));
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO：第 1 周的周一是包含 1 月 4 日的那一周的周一
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - jan4Day);
  const target = new Date(firstMonday);
  target.setDate(firstMonday.getDate() + (week - 1) * 7);
  return fmtDate(target);
}

/** 某日期所在周的周一到周日 7 天 */
export function weekDates(dateStr) {
  const d = parseDate(dateStr);
  const day = (d.getDay() + 6) % 7; // 周一 = 0
  const monday = addDays(dateStr, -day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 上一周 / 下一周的 key */
export function shiftWeekKey(key, delta) {
  const start = weekStartFromKey(key);
  if (!start) return key;
  return isoWeek(addDays(start, delta * 7)).key;
}

export function isWeekend(dateStr) {
  const w = weekday(dateStr);
  return w === 0 || w === 6;
}

/** 相对时间描述，例如「3 分钟前」 */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/** 以分钟展示时长：95 -> '1 小时 35 分' */
export function humanMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}
