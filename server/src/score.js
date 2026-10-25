import { nowMinutes, toMinutes } from './time.js';

/** 一条未填写的打卡记录 */
export function emptyRecord() {
  return { status: 'pending', value: 0, cause: '', note: '', updatedAt: null };
}

/** 单条计划项的完成度 0~1 */
export function itemProgress(item) {
  const rec = item.record || emptyRecord();
  const target = Number(item.target) || 0;

  if (rec.status === 'skipped') return 1; // 计划内主动跳过，不算失分
  if (rec.status === 'done') return 1;
  if (rec.status === 'missed') return 0;

  const value = Number(rec.value) || 0;
  if (item.countMode === 'boolean') {
    if (rec.status === 'done' || value > 0) return 1;
    return 0;
  }
  if (target <= 0) return rec.status === 'done' ? 1 : 0;
  return Math.max(0, Math.min(1, value / target));
}

/**
 * 条目的实时状态（用于今日页展示「该做了 / 已超时」）
 */
export function itemTimeState(item, date, todayDate, nowMin) {
  if (!item.start || !item.end) return 'anytime';
  if (date !== todayDate) return 'other-day';
  const start = toMinutes(item.start);
  const end = toMinutes(item.end);
  if (nowMin < start) return 'upcoming';
  if (nowMin <= end) return 'active';
  return 'past';
}

/** 计算一天的得分与统计 */
export function scoreDay(day, settings) {
  const items = day?.items || [];
  let weightSum = 0;
  let gained = 0;
  let plannedMinutes = 0;
  let achievedMinutes = 0;

  const byCategory = {};
  const byStatus = { done: 0, partial: 0, missed: 0, pending: 0, skipped: 0 };
  const studyMinutes = { planned: 0, achieved: 0 };

  for (const item of items) {
    const rec = item.record || emptyRecord();
    const progress = itemProgress(item);
    const weight = Number(item.weight) || 1;
    weightSum += weight;
    gained += weight * progress;

    const status = rec.status || 'pending';
    byStatus[status] = (byStatus[status] || 0) + 1;

    const planned = Number(item.plannedMinutes) || 0;
    plannedMinutes += planned;
    achievedMinutes += planned * progress;

    const cat = item.category || '其他';
    if (!byCategory[cat]) byCategory[cat] = { weight: 0, gained: 0, plannedMinutes: 0, achievedMinutes: 0, count: 0, done: 0 };
    const c = byCategory[cat];
    c.weight += weight;
    c.gained += weight * progress;
    c.plannedMinutes += planned;
    c.achievedMinutes += planned * progress;
    c.count += 1;
    if (progress >= 0.999) c.done += 1;

    if (item.category !== '身体' && item.category !== '复盘') {
      studyMinutes.planned += planned;
      if (rec.value && String(item.unit) === '分钟') studyMinutes.achieved += Number(rec.value) || 0;
    }
  }

  const score = weightSum > 0 ? Math.round((gained / weightSum) * 1000) / 10 : 0;

  for (const k of Object.keys(byCategory)) {
    const c = byCategory[k];
    c.rate = c.weight > 0 ? Math.round((c.gained / c.weight) * 1000) / 10 : 0;
  }

  return {
    score,
    plannedMinutes: Math.round(plannedMinutes),
    achievedMinutes: Math.round(achievedMinutes),
    studyMinutes: { planned: Math.round(studyMinutes.planned), achieved: Math.round(studyMinutes.achieved) },
    byStatus,
    byCategory,
    total: items.length,
    completed: byStatus.done,
    threshold: settings?.scoring?.streakMinScore ?? 70,
  };
}

/** 一条记录的「是否算漏做」 */
export function isMiss(item) {
  const rec = item.record || emptyRecord();
  return rec.status === 'missed';
}

/** 把一批天聚合成周/月统计 */
export function aggregateDays(days, settings) {
  const scores = [];
  const byCategory = {};
  const byIndicator = new Map();
  const causes = new Map();
  const byBlock = new Map();
  let planned = 0;
  let achieved = 0;
  let studyPlanned = 0;
  let studyAchieved = 0;
  let doneCount = 0;
  let totalCount = 0;
  let missedCount = 0;
  let videoDays = 0;

  const ordered = days.slice().sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const day of ordered) {
    if (!day || !day.date) continue;
    const s = day.score && typeof day.score === 'object' ? day.score : scoreDay(day, settings);
    if (!day.items?.length) continue;

    scores.push({ date: day.date, score: s.score, plannedMinutes: s.plannedMinutes, achievedMinutes: s.achievedMinutes });
    planned += s.plannedMinutes;
    achieved += s.achievedMinutes;
    studyPlanned += s.studyMinutes.planned;
    studyAchieved += s.studyMinutes.achieved;
    doneCount += s.byStatus.done || 0;
    missedCount += s.byStatus.missed || 0;
    totalCount += s.total || 0;
    if (day.videos?.length) videoDays += 1;

    for (const [cat, v] of Object.entries(s.byCategory || {})) {
      if (!byCategory[cat]) byCategory[cat] = { weight: 0, gained: 0, plannedMinutes: 0, achievedMinutes: 0, count: 0, done: 0 };
      const t = byCategory[cat];
      t.weight += v.weight;
      t.gained += v.gained;
      t.plannedMinutes += v.plannedMinutes;
      t.achievedMinutes += v.achievedMinutes;
      t.count += v.count;
      t.done += v.done;
    }

    for (const item of day.items) {
      const key = item.ref || item.id;
      if (!byIndicator.has(key)) {
        byIndicator.set(key, {
          ref: key,
          title: item.title,
          category: item.category,
          unit: item.unit,
          target: item.target,
          weight: item.weight,
          appearances: 0,
          done: 0,
          missed: 0,
          partial: 0,
          valueSum: 0,
          minutesPlanned: 0,
          minutesAchieved: 0,
        });
      }
      const rec = item.record || emptyRecord();
      const row = byIndicator.get(key);
      row.appearances += 1;
      row.valueSum += Number(rec.value) || 0;
      row.minutesPlanned += Number(item.plannedMinutes) || 0;
      row.minutesAchieved += (Number(item.plannedMinutes) || 0) * itemProgress(item);
      if (rec.status === 'done') row.done += 1;
      else if (rec.status === 'missed') row.missed += 1;
      else if (rec.status === 'partial') row.partial += 1;

      if (rec.status === 'missed' || rec.status === 'partial') {
        const cause = rec.cause || '未填写原因';
        causes.set(cause, (causes.get(cause) || 0) + 1);
      }

      const blockKey = item.blockId || 'anytime';
      if (!byBlock.has(blockKey)) byBlock.set(blockKey, { blockId: blockKey, planned: 0, achieved: 0, total: 0, done: 0 });
      const b = byBlock.get(blockKey);
      b.planned += Number(item.plannedMinutes) || 0;
      b.achieved += (Number(item.plannedMinutes) || 0) * itemProgress(item);
      b.total += 1;
      if (rec.status === 'done') b.done += 1;
    }
  }

  for (const [, v] of Object.entries(byCategory)) {
    v.rate = v.weight > 0 ? Math.round((v.gained / v.weight) * 1000) / 10 : 0;
  }

  const indicatorRows = [...byIndicator.values()]
    .map((r) => ({
      ...r,
      minutesAchieved: Math.round(r.minutesAchieved),
      rate: r.appearances > 0 ? Math.round((r.done / r.appearances) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.appearances - a.appearances);

  const avgScore = scores.length ? Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 10) / 10 : 0;

  return {
    days: scores,
    avgScore,
    dayCount: scores.length,
    plannedMinutes: Math.round(planned),
    achievedMinutes: Math.round(achieved),
    studyMinutesPlanned: Math.round(studyPlanned),
    studyMinutesAchieved: Math.round(studyAchieved),
    completionRate: planned > 0 ? Math.round((achieved / planned) * 1000) / 10 : 0,
    itemCompletionRate: totalCount > 0 ? Math.round((doneCount / totalCount) * 1000) / 10 : 0,
    totalItems: totalCount,
    doneItems: doneCount,
    missedItems: missedCount,
    videoDays,
    byCategory,
    byIndicator: indicatorRows,
    byBlock: [...byBlock.values()].map((b) => ({
      ...b,
      planned: Math.round(b.planned),
      achieved: Math.round(b.achieved),
      rate: b.planned > 0 ? Math.round((b.achieved / b.planned) * 1000) / 10 : 0,
    })),
    causes: [...causes.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count),
  };
}

/** 连击天数：从今天（或昨天）往回数，得分达标且（可选）录了视频 */
export function computeStreak(allDays, settings, todayDate) {
  const minScore = settings?.scoring?.streakMinScore ?? 70;
  const requireVideo = settings?.scoring?.requireVideoForStreak !== false;
  const dates = Object.keys(allDays).sort();

  const qualifies = (date) => {
    const day = allDays[date];
    if (!day) return false;
    const s = scoreDay(day, settings);
    if (!day.items?.length) return false;
    if (s.score < minScore) return false;
    if (requireVideo) {
      const hasVideo = (day.videos && day.videos.length > 0) || day.items.some((i) => i.ref === 'indicator:daily-video' && i.record?.status === 'done');
      if (!hasVideo) return false;
    }
    return true;
  };

  if (!dates.length) return { current: 0, best: 0, todayQualified: false };

  // 当前连击：今天没过就看昨天
  let current = 0;
  let cursor = todayDate;
  if (!qualifies(cursor)) {
    cursor = null;
    const todayIdx = dates.indexOf(todayDate);
    if (todayIdx > 0) cursor = dates[todayIdx - 1];
    else if (todayIdx < 0) cursor = dates[dates.length - 1];
  }
  // 从 cursor 往回走，直到断
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of dates) {
    if (prev && dayGap(prev, d) !== 1) run = 0;
    if (qualifies(d)) run += 1;
    else run = 0;
    best = Math.max(best, run);
    prev = d;
  }

  if (cursor) {
    // 允许从最近一天往回数
    let d = cursor;
    const set = new Set(dates);
    let safety = 0;
    while (set.has(d) && qualifies(d) && safety < 5000) {
      current += 1;
      const idx = dates.indexOf(d);
      if (idx <= 0) break;
      d = dates[idx - 1];
      safety += 1;
    }
  }

  return { current, best: Math.max(best, current), todayQualified: qualifies(todayDate) };
}

function dayGap(a, b) {
  const da = new Date(a);
  const dbb = new Date(b);
  return Math.round((dbb - da) / 86400000);
}

export { nowMinutes };
