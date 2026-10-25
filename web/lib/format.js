/** 格式化与日期工具（前端版，和后端 time.js 保持一致的语义） */

const pad = (n) => String(n).padStart(2, '0');

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

export function todayStr() {
  return fmtDate(new Date());
}

export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

export function weekdayName(dateStr) {
  return WEEKDAYS[parseDate(dateStr).getDay()];
}

export function weekdayIndex(dateStr) {
  return parseDate(dateStr).getDay();
}

export function isoWeekOf(dateStr) {
  const d = parseDate(dateStr);
  const day = (d.getDay() + 6) % 7;
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - day + 3);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.floor((thursday - jan1) / 86400000) + 1;
  return `${year}-W${pad(Math.ceil(dayOfYear / 7))}`;
}

export function weekDatesOf(dateStr) {
  const d = parseDate(dateStr);
  const day = (d.getDay() + 6) % 7;
  const monday = addDays(dateStr, -day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function weekStartFromKey(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key));
  if (!m) return todayStr();
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - jan4Day + (week - 1) * 7);
  return fmtDate(firstMonday);
}

export function shiftWeekKey(key, delta) {
  return isoWeekOf(addDays(weekStartFromKey(key), delta * 7));
}

export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/* ---------- 时间 ---------- */

export function toMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function humanMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}

export function humanMinutesShort(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${r}m` : `${h}h`;
}

export function humanDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}:${pad(rest)}`;
  return `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(rest)}`;
}

export function humanBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b > 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b > 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b > 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** '9:30' 之外的宽松解析，用户可能输入 930 / 9:3 */
export function normalizeTime(value) {
  const s = String(value || '').trim().replace(/[：.]/g, ':');
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (!m) {
    m = /^(\d{1,2})$/.exec(s);
    if (m) return `${pad(Math.min(23, Number(m[1])))}:00`;
    return null;
  }
  const h = Math.min(23, Number(m[1]));
  const mi = Math.min(59, Number(m[2]));
  return `${pad(h)}:${pad(mi)}`;
}

/** 相对时间：刚刚 / 3 分钟前 */
export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return '刚刚';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmtDate(new Date(t));
}

/** 今天 2026-10-25 → 10月25日 周日 */
export function prettyDate(dateStr, { withWeekday = true } = {}) {
  const d = parseDate(dateStr);
  const base = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withWeekday ? `${base} ${weekdayName(dateStr)}` : base;
}

export function scoreTone(score) {
  const s = Number(score) || 0;
  if (s >= 85) return 'teal';
  if (s >= 70) return 'accent';
  if (s >= 50) return 'amber';
  return 'rose';
}

export function statusLabel(status) {
  return (
    {
      done: '已完成',
      partial: '部分完成',
      missed: '未完成',
      pending: '未确认',
      skipped: '已跳过',
    }[status] || '未确认'
  );
}

/** 数组按 key 分组 */
export function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function sum(list, fn = (x) => x) {
  return list.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
}

export function average(list, fn = (x) => x) {
  const valid = list.filter((x) => Number.isFinite(Number(fn(x))));
  return valid.length ? sum(valid, fn) / valid.length : 0;
}
