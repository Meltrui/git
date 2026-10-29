import { aggregateDays, scoreDay, computeStreak } from './score.js';
import { weeklyReviewMessages } from './prompts.js';
import { chatJson } from './ai.js';
import { humanMinutes, weekdayName, parseDate, diffDays, todayStr } from './time.js';

/**
 * 周总结：先用统计算清楚「发生了什么」，再让大模型解释「为什么」和「下周怎么办」。
 * 没有 API Key 或调用失败时，规则引擎会给出一份同样能落地的报告。
 */

/* ------------------------------------------------------------------ */
/* 统计事实                                                            */
/* ------------------------------------------------------------------ */

export function buildWeeklyFacts({ key, dates, days, settings, tasks = [], videos = [], allDays = {} }) {
  const rows = dates.map((date, i) => {
    const day = days[i] || null;
    const s = day && day.items?.length ? scoreDay(day, settings) : null;
    return {
      date,
      weekday: weekdayName(date),
      planned: day?.items?.length || 0,
      score: s?.score ?? null,
      plannedMinutes: s?.plannedMinutes ?? 0,
      achievedMinutes: s?.achievedMinutes ?? 0,
      done: s?.byStatus.done ?? 0,
      partial: s?.byStatus.partial ?? 0,
      missed: s?.byStatus.missed ?? 0,
      pending: s?.byStatus.pending ?? 0,
      hasVideo: (day?.videos?.length || 0) > 0,
      closed: !!day?.closed,
    };
  });

  const activeDays = days.filter((d) => d && d.items && d.items.length);
  const agg = aggregateDays(activeDays, settings);

  const indicatorCatalog = (settings.indicators || []).map(
    (i) => `- ${i.id} / ${i.name} / 目标 ${i.target}${i.unit} / 时长 ${i.minutes} 分钟 / 权重 ${i.weight}${
      i.essential ? ' / 每日必做' : ''
    }`,
  );

  const blockCatalog = (settings.blocks || []).map(
    (b) => `- ${b.id} / ${b.label} / ${b.start}-${b.end} / 类型 ${b.kind}`,
  );

  const taskCatalog = tasks
    .filter((t) => t.status === 'open')
    .slice(0, 40)
    .map(
      (t) =>
        `- ${t.id} / ${t.title} / ${t.minutes} 分钟 / 截止 ${t.dueDate || '无'} / 优先级 ${t.priority}${
          t.progress ? ` / 已完成 ${t.progress} 分钟` : ''
        }`,
    );

  /* 本周他自己的话：优先用文字稿原文（那才是「他自己的话」），
     没有文字稿时退回 AI 提炼的 summary */
  const videoGists = videos
    .filter((v) => v.date && dates.includes(v.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((v) => {
      const raw = String(v.transcript?.text || '').trim();
      const body = raw
        ? raw.slice(0, 700) + (raw.length > 700 ? '…（后略）' : '')
        : v.analysis?.summary || '（这天没录视频 / 没转出文字）';
      return `- ${v.date}：${body}`;
    });

  const examDate = settings.profile?.examDate;
  const daysLeft = examDate ? Math.max(0, diffDays(todayStr(), examDate)) : null;

  return {
    key,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    range: `${dates[0]} ~ ${dates[dates.length - 1]}`,
    rows,
    agg,
    payload: {
      profile: {
        examName: settings.profile?.examName || '',
        examDate: examDate || '',
        daysLeft,
        weeklyStudyTarget: humanMinutes(settings.weekly?.targetStudyMinutes || 0),
        wakeTime: settings.profile?.wakeTime,
        sleepTime: settings.profile?.sleepTime,
      },
      summary: {
        周次: key,
        统计区间: `${dates[0]} ~ ${dates[dates.length - 1]}`,
        有记录天数: agg.dayCount,
        平均得分: agg.avgScore,
        计划总时长: humanMinutes(agg.plannedMinutes),
        实际完成时长: humanMinutes(agg.achievedMinutes),
        时长完成率: `${agg.completionRate}%`,
        条目完成率: `${agg.itemCompletionRate}%`,
        完成条目: agg.doneItems,
        未完成条目: agg.missedItems,
        录了总结视频的天数: agg.videoDays,
      },
      daily: rows.map((r) => ({
        日期: r.date,
        星期: r.weekday,
        得分: r.score,
        计划项: r.planned,
        完成: r.done,
        部分完成: r.partial,
        未完成: r.missed,
        学习时长分钟: r.achievedMinutes,
        录了视频: r.hasVideo,
      })),
      byCategory: agg.byCategory,
      byIndicator: agg.byIndicator.map((r) => ({
        指标: r.title,
        类别: r.category,
        目标: `${r.target}${r.unit || ''}`,
        出现天数: r.appearances,
        完成天数: r.done,
        部分完成天数: r.partial,
        未完成天数: r.missed,
        完成率: `${r.rate}%`,
        累计数值: r.valueSum,
      })),
      byBlock: agg.byBlock,
      causes: agg.causes,
      indicatorCatalog,
      blockCatalog,
      taskCatalog,
      videoGists,
    },
  };
}

function lastWeekPayload(agg) {
  if (!agg || !agg.dayCount) return null;
  return {
    平均得分: agg.avgScore,
    时长完成率: `${agg.completionRate}%`,
    条目完成率: `${agg.itemCompletionRate}%`,
    完成条目: agg.doneItems,
    未完成条目: agg.missedItems,
  };
}

/* ------------------------------------------------------------------ */
/* 规则引擎兜底                                                        */
/* ------------------------------------------------------------------ */

export function buildRuleReport(facts) {
  const { agg, rows, payload } = facts;
  const adjustments = [];
  const highlights = [];
  const problems = [];
  const patterns = [];
  const settings = facts.settings || {};

  // 亮点
  const bestDay = rows.filter((r) => r.score != null).sort((a, b) => b.score - a.score)[0];
  if (bestDay) {
    highlights.push(
      `${bestDay.date}（${bestDay.weekday}）得分 ${bestDay.score}，完成 ${bestDay.done}/${bestDay.planned} 项，是本周最稳的一天。`,
    );
  }
  const videoDays = rows.filter((r) => r.hasVideo).length;
  if (videoDays >= 5) highlights.push(`本周录了 ${videoDays} 天总结视频，自我观测没有断线。`);

  const solidCats = Object.entries(agg.byCategory)
    .filter(([, v]) => v.count >= 3 && v.rate >= 80)
    .map(([k, v]) => `${k} ${v.rate}%`);
  if (solidCats.length) highlights.push(`完成率稳定在 80% 以上的科目：${solidCats.join('、')}。`);

  // 问题
  const weak = agg.byIndicator.filter((r) => r.appearances >= 2 && r.rate < 60).slice(0, 4);
  for (const w of weak) {
    problems.push(`「${w.title}」出现 ${w.appearances} 天只完成 ${w.done} 天（完成率 ${w.rate}%）。`);
  }
  if (agg.missedItems > 0 && agg.doneItems + agg.missedItems > 0) {
    problems.push(`本周共 ${agg.missedItems} 项被标记为未完成，占全部条目的 ${Math.round(
      (agg.missedItems / (agg.doneItems + agg.missedItems)) * 100,
    )}%。`);
  }
  if (videoDays < 4) problems.push(`本周只录了 ${videoDays} 天总结视频，自我观测断档会影响复盘质量。`);

  // 规律
  const byWeekday = new Map();
  for (const r of rows) {
    if (r.score == null) continue;
    if (!byWeekday.has(r.weekday)) byWeekday.set(r.weekday, []);
    byWeekday.get(r.weekday).push(r.score);
  }
  const weekdayScores = [...byWeekday.entries()].map(([w, list]) => ({
    w,
    avg: list.reduce((s, x) => s + x, 0) / list.length,
  }));
  if (weekdayScores.length >= 2) {
    const sorted = weekdayScores.slice().sort((a, b) => a.avg - b.avg);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    if (best.avg - worst.avg >= 15) {
      patterns.push(`${worst.w}（平均 ${worst.avg.toFixed(0)} 分）明显弱于 ${best.w}（${best.avg.toFixed(0)} 分），落差 ${(best.avg - worst.avg).toFixed(0)} 分。`);
    }
  }

  const causeTop = agg.causes[0];
  if (causeTop && causeTop.count >= 2) {
    patterns.push(`未完成原因里出现最多的是「${causeTop.cause}」（${causeTop.count} 次）。`);
  }

  const blocks = agg.byBlock.filter((b) => b.planned > 0).sort((a, b) => a.rate - b.rate);
  if (blocks.length >= 2 && blocks[0].rate + 20 < blocks[blocks.length - 1].rate) {
    patterns.push(
      `最低效的时间块是「${blocks[0].blockId}」（完成率 ${blocks[0].rate}%），最高效的是「${blocks[blocks.length - 1].blockId}」（${blocks[blocks.length - 1].rate}%）。`,
    );
  }

  /* ---- 调整建议（规则） ---- */
  const indicators = settings.indicators || [];

  for (const w of weak.slice(0, 2)) {
    const ind = indicators.find((i) => i.name === w.title || `indicator:${i.id}` === w.ref);
    if (!ind) continue;
    const newTarget = Math.max(1, Math.round((Number(ind.target) || 1) * 0.8));
    adjustments.push({
      id: `adj-${ind.id}-target`,
      type: 'indicator_target',
      indicatorId: ind.id,
      target: newTarget,
      title: `把「${ind.name}」的目标从 ${ind.target}${ind.unit || ''} 降到 ${newTarget}${ind.unit || ''}`,
      reason: `本周完成率只有 ${w.rate}%，目标定太高会连续失分，先降到你稳定能做到的量，再慢慢加。`,
    });
  }

  const timeCause = agg.causes.find((c) => c.cause.includes('时间'));
  if (timeCause && timeCause.count >= 2) {
    const studyBlock = (settings.blocks || []).find((b) => b.kind === 'study');
    if (studyBlock) {
      adjustments.push({
        id: `adj-${studyBlock.id}-extend`,
        type: 'note',
        blockId: studyBlock.id,
        title: `给「${studyBlock.label}」加 20 分钟，或砍掉一个非核心指标`,
        reason: `本周有 ${timeCause.count} 次未完成原因是「时间不够」，说明时间块容量本身就装不下现在的清单。`,
      });
    }
  }

  const phoneCause = agg.causes.find((c) => c.cause.includes('分心') || c.cause.includes('娱乐'));
  if (phoneCause && phoneCause.count >= 2) {
    adjustments.push({
      id: 'adj-focus',
      type: 'note',
      title: '学习块期间手机放到另一个房间，用「番茄 25+5」把块切碎',
      reason: `有 ${phoneCause.count} 次未完成是因为分心，这不是意志力问题，是环境问题。`,
    });
  }

  if (agg.avgScore >= 85 && agg.dayCount >= 4) {
    const firstStudy = indicators.find((i) => i.kind === 'study' && !i.essential) || indicators.find((i) => i.kind === 'study');
    if (firstStudy) {
      const newMinutes = Math.min(120, (Number(firstStudy.minutes) || 30) + 10);
      adjustments.push({
        id: `adj-${firstStudy.id}-minutes`,
        type: 'indicator_minutes',
        indicatorId: firstStudy.id,
        minutes: newMinutes,
        title: `把「${firstStudy.name}」的时长从 ${firstStudy.minutes} 分钟提到 ${newMinutes} 分钟`,
        reason: `本周平均得分 ${agg.avgScore}，说明当前强度还有余量，该往上加一点了。`,
      });
    }
  }

  const worstDay = rows.filter((r) => r.score != null).sort((a, b) => a.score - b.score)[0];

  // 数据太少时也给一条能做的，别让建议列表空着
  if (!adjustments.length) {
    if (agg.dayCount < 3) {
      adjustments.push({
        id: 'adj-bootstrap',
        type: 'note',
        title: '先连续跑顺 3 天，再谈调整目标',
        reason: `本周只有 ${agg.dayCount} 天有记录，样本太小，现在改指标是瞎猜。先把「按时开始 + 每天录总结视频」这两件事做到，再来调数值。`,
      });
    } else if (agg.itemCompletionRate >= 80) {
      const firstStudy = indicators.find((i) => i.kind === 'study');
      if (firstStudy) {
        adjustments.push({
          id: `adj-${firstStudy.id}-minutes`,
          type: 'indicator_minutes',
          indicatorId: firstStudy.id,
          minutes: Math.min(120, (Number(firstStudy.minutes) || 30) + 10),
          title: `把「${firstStudy.name}」加 10 分钟`,
          reason: `本周条目完成率 ${agg.itemCompletionRate}%，节奏稳住了，可以往上加一点强度。`,
        });
      }
    }
  }

  const narrative = [
    `这周（${facts.range}）你有 ${agg.dayCount} 天留下了记录，平均得分 ${agg.avgScore}，` +
      `计划总时长 ${humanMinutes(agg.plannedMinutes)}，实际完成 ${humanMinutes(agg.achievedMinutes)}，` +
      `时长完成率 ${agg.completionRate}%。`,
    problems.length
      ? `最需要盯的是：${problems[0]}`
      : `没有明显掉链子的地方，节奏是稳的。`,
    adjustments.length
      ? `下周先动一个旋钮：${adjustments[0].title}。`
      : `下周保持当前安排，重点是把每一天的每一块都按时间开始。`,
  ].join('\n\n');

  return {
    source: 'rules',
    narrative,
    highlights: highlights.slice(0, 3),
    problems: problems.slice(0, 3),
    patterns: patterns.slice(0, 3),
    adjustments: adjustments.slice(0, 5),
    nextWeekFocus: adjustments.length ? [adjustments[0].title] : ['保持当前节奏，重点是准时开始'],
    yourOwnWords: buildRuleYourOwnWords(facts),
    riskScore: Math.max(0, Math.min(100, Math.round(100 - agg.avgScore))),
    bestDay: bestDay?.date || null,
    toughestDay: worstDay?.date || null,
  };
}

/** 没有大模型时，「你自己的话」这一节用能算出来的事实凑一段 */
function buildRuleYourOwnWords(facts) {
  const { agg, rows } = facts;
  const videoDays = rows.filter((r) => r.hasVideo).length;
  if (!videoDays) {
    return (
      `这周你有 ${agg.dayCount} 天记录了打卡，但一个总结视频都没录。` +
      '没有声音的这一周，数据只能告诉你「做了/没做」，告诉不了你「为什么」。' +
      '明天开始，哪怕只对着手机讲一分钟：今天学了什么、卡在哪、明天先做哪件事。'
    );
  }
  const missed = rows.filter((r) => r.score != null && r.score < 70).length;
  return (
    `这周你录了 ${videoDays} 天总结视频，平均得分 ${agg.avgScore}。` +
    (missed
      ? `有 ${missed} 天没到 70 分——翻回去听那几天的视频，你自己当时说的原因，往往就是下一个要修的地方。`
      : '没有哪天掉到 70 分以下，节奏是稳的，可以把注意力放到「每一块有没有真学进去」上。') +
    '把这一周的视频连着听一遍，比看任何报表都管用。'
  );
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

export async function generateWeeklyReport({ key, dates, days, settings, tasks, videos, allDays, lastWeekAgg }) {
  const facts = buildWeeklyFacts({ key, dates, days: days.slice(0, 7), settings, tasks, videos, allDays });
  facts.settings = settings;

  const fallback = buildRuleReport(facts);
  const report = {
    key,
    startDate: facts.startDate,
    endDate: facts.endDate,
    generatedAt: new Date().toISOString(),
    stats: {
      avgScore: facts.agg.avgScore,
      dayCount: facts.agg.dayCount,
      plannedMinutes: facts.agg.plannedMinutes,
      achievedMinutes: facts.agg.achievedMinutes,
      completionRate: facts.agg.completionRate,
      itemCompletionRate: facts.agg.itemCompletionRate,
      doneItems: facts.agg.doneItems,
      missedItems: facts.agg.missedItems,
      videoDays: facts.agg.videoDays,
      byCategory: facts.agg.byCategory,
      byIndicator: facts.agg.byIndicator,
      byBlock: facts.agg.byBlock,
      causes: facts.agg.causes,
      rows: facts.rows,
    },
    ai: fallback,
    model: null,
    error: null,
  };

  const aiEnabled = settings?.ai?.enabled && settings?.ai?.apiKey;
  if (!aiEnabled) {
    report.error = null;
    report.note = '未启用大模型，本报告由内置规则引擎生成。填上 API Key 后可以获得更有针对性的分析。';
    return report;
  }

  if (!facts.agg.dayCount) {
    report.note = '这一周没有任何记录，先生成计划并打卡再来复盘。';
    return report;
  }

  try {
    const payload = {
      ...facts.payload,
      lastWeek: lastWeekPayload(lastWeekAgg),
    };
    const { data, model } = await chatJson(settings, weeklyReviewMessages(payload), { maxTokens: 3500 });
    report.ai = normalizeAiReport(data, fallback, settings);
    report.source = 'ai';
    report.model = model;
  } catch (err) {
    report.error = err.message;
    report.note = `大模型调用失败，已回退到规则引擎：${err.message}`;
  }

  return report;
}

function normalizeAiReport(data, fallback, settings) {
  const indicators = settings.indicators || [];
  const blocks = settings.blocks || [];
  const strArr = (v, max = 5) =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.title || x?.text || '')).filter(Boolean).slice(0, max) : [];

  const adjustments = Array.isArray(data.adjustments)
    ? data.adjustments
        .map((raw, i) => {
          if (!raw || typeof raw !== 'object') return null;
          const type = String(raw.type || 'note');
          const adj = {
            id: `ai-adj-${i}`,
            type,
            title: String(raw.title || '').slice(0, 200),
            reason: String(raw.reason || '').slice(0, 500),
          };
          if (!adj.title) return null;
          if (type.startsWith('indicator')) {
            const ind = indicators.find((x) => x.id === raw.indicatorId);
            if (!ind) return null;
            adj.indicatorId = ind.id;
            adj.indicatorName = ind.name;
            if (type === 'indicator_target') {
              const t = Number(raw.target);
              if (!Number.isFinite(t) || t <= 0) return null;
              adj.target = Math.round(t * 100) / 100;
              adj.from = ind.target;
              adj.unit = ind.unit;
            } else {
              const m = Number(raw.minutes);
              if (!Number.isFinite(m) || m <= 0 || m > 480) return null;
              adj.minutes = Math.round(m);
              adj.from = ind.minutes;
            }
          } else if (type === 'block_time') {
            const b = blocks.find((x) => x.id === raw.blockId);
            if (!b) return null;
            const okTime = (s) => /^\d{1,2}:\d{2}$/.test(String(s || ''));
            if (!okTime(raw.start) || !okTime(raw.end)) return null;
            adj.blockId = b.id;
            adj.blockLabel = b.label;
            adj.start = raw.start;
            adj.end = raw.end;
            adj.fromStart = b.start;
            adj.fromEnd = b.end;
          } else if (type === 'add_task') {
            adj.taskTitle = String(raw.taskTitle || raw.title || '').slice(0, 160);
            if (!adj.taskTitle) return null;
            adj.category = raw.category || '其他';
            adj.minutes = Math.max(10, Math.min(240, Number(raw.minutes) || 45));
            adj.priority = ['high', 'mid', 'low'].includes(raw.priority) ? raw.priority : 'mid';
          } else if (type === 'task_priority') {
            if (!raw.taskId) return null;
            adj.taskId = raw.taskId;
            adj.priority = ['high', 'mid', 'low'].includes(raw.priority) ? raw.priority : 'mid';
          }
          return adj;
        })
        .filter(Boolean)
        .slice(0, 6)
    : fallback.adjustments;

  return {
    source: 'ai',
    narrative: String(data.narrative || fallback.narrative).slice(0, 4000),
    highlights: strArr(data.highlights, 4),
    problems: strArr(data.problems, 4),
    patterns: strArr(data.patterns, 4),
    adjustments,
    nextWeekFocus: strArr(data.nextWeekFocus, 4),
    yourOwnWords: String(data.yourOwnWords || fallback.yourOwnWords || '').slice(0, 3000),
    riskScore: Number.isFinite(Number(data.riskScore)) ? Math.max(0, Math.min(100, Number(data.riskScore))) : fallback.riskScore,
    bestDay: data.bestDay || fallback.bestDay,
    toughestDay: data.toughestDay || fallback.toughestDay,
  };
}

/* ------------------------------------------------------------------ */
/* 采纳建议                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把一条调整建议真正应用到设置/任务池。
 * @returns {{applied:boolean, message:string, kind:string}}
 */
export function applyAdjustment(adj, { settings, createTask, updateSettings, updateTask }) {
  if (!adj || !adj.type) return { applied: false, message: '这条建议无效' };

  switch (adj.type) {
    case 'indicator_target': {
      const indicators = settings.indicators.map((i) =>
        i.id === adj.indicatorId ? { ...i, target: adj.target } : i,
      );
      updateSettings({ indicators });
      return { applied: true, message: `已把目标改为 ${adj.target}${adj.unit || ''}`, kind: 'indicator' };
    }
    case 'indicator_minutes': {
      const indicators = settings.indicators.map((i) =>
        i.id === adj.indicatorId ? { ...i, minutes: adj.minutes } : i,
      );
      updateSettings({ indicators });
      return { applied: true, message: `已把时长改为 ${adj.minutes} 分钟`, kind: 'indicator' };
    }
    case 'block_time': {
      const blocks = settings.blocks.map((b) =>
        b.id === adj.blockId ? { ...b, start: adj.start, end: adj.end } : b,
      );
      updateSettings({ blocks });
      return { applied: true, message: `已把「${adj.blockLabel || adj.blockId}」改成 ${adj.start}-${adj.end}`, kind: 'block' };
    }
    case 'add_task': {
      createTask({
        title: adj.taskTitle,
        category: adj.category || '其他',
        minutes: adj.minutes || 45,
        priority: adj.priority || 'mid',
        notes: `来自周复盘建议：${adj.reason || ''}`,
      });
      return { applied: true, message: `已把「${adj.taskTitle}」加进任务池`, kind: 'task' };
    }
    case 'task_priority': {
      updateTask(adj.taskId, { priority: adj.priority });
      return { applied: true, message: `已把任务优先级改为 ${adj.priority}`, kind: 'task' };
    }
    case 'note':
    default:
      return {
        applied: false,
        message: '这条是纯建议，需要你自己动手（照着改就行）。',
        kind: 'note',
      };
  }
}

export { computeStreak };
