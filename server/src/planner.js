import { toMinutes, toHHMM, span, weekday, addDays, diffDays } from './time.js';

/**
 * 确定性规划器。不依赖任何外部服务，永远可用。
 *
 * 输入：某一天的日期 + 设置（时间块 / 每日指标）+ 任务池
 * 输出：带具体起止时间的条目列表 + 计划诊断（超载 / 空档 / 截止风险）
 *
 * 设计原则
 *  1. 核心指标优先：essential 先落地，保证「每天必须做的」一定在计划里
 *  2. 科目轮转：按类别交替排，避免一上午只磕数学
 *  3. 容量诚实：排不下就明说，绝不假装今天有 8 小时
 *  4. 只排「块」：每个条目一定落在某个时间块之内
 */

const KIND_ORDER = { study: 0, exercise: 1, review: 2, flex: 3, routine: 4 };

function blocksForDay(settings, date) {
  const wd = weekday(date);
  return (settings.blocks || [])
    .filter((b) => !Array.isArray(b.days) || b.days.includes(wd))
    .slice()
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function indicatorKey(ind) {
  return `indicator:${ind.id}`;
}

/** 指标 → 该往哪类块里放 */
function targetKind(ind) {
  return ind.kind || 'study';
}

function roundRobinInterleave(groups) {
  const out = [];
  const queues = groups.map((g) => g.slice());
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const q of queues) {
      if (q.length) {
        out.push(q.shift());
        progressed = true;
      }
    }
  }
  return out;
}

/**
 * 把一组条目按顺序塞进候选块。
 *
 * 先尝试「整块放得下就整块放」，只有任何块都装不下时才拆开跨块续排 ——
 * 一个 50 分钟的数学练习被午休切成 12+38 分钟是毁灭性的。
 */
function placeIntoBlocks(entries, candidates, warnings) {
  const placed = [];
  const pending = [];

  for (const entry of entries) {
    const need = entry.minutes;
    if (need <= 0) {
      const b = candidates[0];
      if (!b) {
        warnings.push({
          level: 'warn',
          code: 'no-block',
          message: `「${entry.title}」没有可用的时间块，已放到「随时可做」。`,
        });
        continue;
      }
      placed.push({
        ...entry,
        blockId: b.id,
        start: toHHMM(b.cursor),
        end: toHHMM(b.cursor + 5),
        plannedMinutes: 5,
      });
      b.cursor += 5;
      b.used += 5;
      continue;
    }

    // 第一轮：找第一个「整块装得下」的块
    let target = null;
    for (const block of candidates) {
      if (block.capacity - block.used >= need) {
        target = block;
        break;
      }
    }
    if (target) {
      const start = target.cursor;
      target.cursor += need;
      target.used += need;
      placed.push({
        ...entry,
        blockId: target.id,
        start: toHHMM(start),
        end: toHHMM(start + need),
        plannedMinutes: need,
      });
    } else {
      pending.push(entry);
    }
  }

  // 第二轮：确实装不下的才拆
  for (const entry of pending) {
    const need = entry.minutes;
    const parts = [];
    let remaining = need;
    for (const block of candidates) {
      if (remaining <= 0) break;
      const left = block.capacity - block.used;
      if (left < 10) continue; // 不足 10 分钟的空隙不算数
      const take = Math.min(left, remaining);
      const start = block.cursor;
      block.cursor += take;
      block.used += take;
      remaining -= take;
      parts.push({
        ...entry,
        blockId: block.id,
        start: toHHMM(start),
        end: toHHMM(start + take),
        plannedMinutes: take,
        splitPart: parts.length + 1,
      });
    }
    if (parts.length > 1) {
      warnings.push({
        level: 'info',
        code: 'split',
        message: `「${entry.title}」需要 ${need} 分钟，被拆成 ${parts.length} 段才排得下。想一次做完的话，把它拆成几个更小的任务。`,
      });
    }
    if (remaining > 0) {
      warnings.push({
        level: 'warn',
        code: 'overflow',
        message: `「${entry.title}」还差 ${Math.round(remaining)} 分钟没排进去 —— 今天的时间不够。`,
      });
    }
    placed.push(...parts);
  }

  return placed;
}

function scoreTask(task, { date, dayIndex, usedInWeek }) {
  let score = 0;
  score += { high: 300, mid: 200, low: 100 }[task.priority] || 150;

  if (task.dueDate) {
    const d = diffDays(date, task.dueDate);
    if (d < 0) score += 400; // 已逾期
    else if (d === 0) score += 320; // 今天到期
    else if (d <= 2) score += 200;
    else if (d <= 7) score += 100;
  }

  // 越久没碰越该碰（避免永远排不到）
  if (task.lastScheduledAt) {
    const days = Math.max(0, diffDays(task.lastScheduledAt, date));
    score += Math.min(days, 20) * 8;
  } else {
    score += 160;
  }

  // 本周已经排过的降权，让任务在一周内摊开
  if (usedInWeek && usedInWeek.has(task.id)) score -= 260;
  if (dayIndex > 0) score -= dayIndex * 4;

  // 有截止、且预估不长的优先（更容易闭环）
  if (task.minutes && task.minutes <= 45) score += 20;
  if (task.pinned) score += 500;
  return score;
}

/**
 * 生成一天的计划。
 * @param {object} opts
 * @param {string} opts.date 'YYYY-MM-DD'
 * @param {object} opts.settings
 * @param {Array}  [opts.tasks] 任务池
 * @param {Set}    [opts.usedInWeek] 本周已排过的任务 id（跨天排程用）
 * @param {number} [opts.dayIndex] 本周第几天（0 起）
 */
export function planDay({ date, settings, tasks = [], usedInWeek = new Set(), dayIndex = 0 }) {
  const warnings = [];
  const rawBlocks = blocksForDay(settings, date);
  const plannerCfg = settings.planner || {};

  const blocks = rawBlocks.map((b) => {
    const slack = b.kind === 'study' ? plannerCfg.studySlackMinutes || 0 : 0;
    return {
      id: b.id,
      label: b.label,
      kind: b.kind,
      start: b.start,
      end: b.end,
      allowTasks: b.allowTasks !== false,
      capacity: Math.max(0, span(b.start, b.end) - slack),
      cursor: toMinutes(b.start),
      used: 0,
    };
  });

  if (!blocks.length) {
    warnings.push({ level: 'warn', code: 'no-blocks', message: '今天没有任何时间块，去设置里添加你的作息。' });
    return { items: [], warnings, capacity: emptyCapacity(), blocks: [] };
  }

  const byKind = (kind) => blocks.filter((b) => b.kind === kind);
  const studyBlocks = byKind('study');
  const exerciseBlocks = byKind('exercise');
  const reviewBlocks = byKind('review');
  const flexBlocks = byKind('flex');

  const indicators = (settings.indicators || []).filter((i) => i.enabled !== false);

  /* ---------- 1. 核心指标：按科目轮转，essential 优先 ---------- */

  const groups = new Map();
  for (const ind of indicators) {
    const cat = ind.category || '其他';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(ind);
  }
  const orderedGroups = [...groups.entries()]
    .map(([cat, list]) => [
      cat,
      list.slice().sort((a, b) => Number(b.essential ? 1 : 0) - Number(a.essential ? 1 : 0)),
    ])
    .sort((a, b) => {
      const ea = a[1].filter((i) => i.essential).length;
      const eb = b[1].filter((i) => i.essential).length;
      if (ea !== eb) return eb - ea;
      return a[0].localeCompare(b[0], 'zh');
    });

  const interleaved = roundRobinInterleave(orderedGroups.map(([, list]) => list));

  const indicatorEntries = interleaved.map((ind) => ({
    ref: indicatorKey(ind),
    type: 'indicator',
    title: ind.name,
    category: ind.category || '其他',
    indicatorId: ind.id,
    minutes: Number(ind.minutes) || 0,
    target: Number(ind.target) || 0,
    unit: ind.unit || '分钟',
    countMode: ind.countMode || 'value',
    weight: Number(ind.weight) || 1,
    essential: !!ind.essential,
    blockPref: ind.blockPref || null,
    note: '',
    source: 'indicator',
  }));

  const kindBuckets = { study: [], exercise: [], review: [], flex: [], routine: [] };
  for (const entry of indicatorEntries) {
    const ind = indicators.find((i) => `indicator:${i.id}` === entry.ref);
    const kind = targetKind(ind || {});
    (kindBuckets[kind] || kindBuckets.study).push(entry);
  }

  const items = [];
  const placedRefs = new Set();

  const pushPlaced = (list) => {
    for (const it of list) {
      items.push(it);
      placedRefs.add(it.ref);
    }
  };

  pushPlaced(placeIntoBlocks(kindBuckets.study, studyBlocks, warnings));
  pushPlaced(placeIntoBlocks(kindBuckets.exercise, exerciseBlocks.length ? exerciseBlocks : flexBlocks, warnings));
  pushPlaced(placeIntoBlocks(kindBuckets.review, reviewBlocks.length ? reviewBlocks : flexBlocks, warnings));
  pushPlaced(placeIntoBlocks(kindBuckets.flex, flexBlocks.length ? flexBlocks : studyBlocks, warnings));
  pushPlaced(placeIntoBlocks(kindBuckets.routine, byKind('routine'), warnings));

  // 没排进去的指标 → 挂到「随时可做」，仍然算今天的任务
  for (const entry of indicatorEntries) {
    if (placedRefs.has(entry.ref)) continue;
    items.push({
      ...entry,
      blockId: null,
      start: null,
      end: null,
      plannedMinutes: entry.minutes,
    });
  }

  /* ---------- 2. 任务池：填进剩余容量 ---------- */

  const maxTasks = plannerCfg.maxTasksPerDay ?? 4;
  const taskCandidates = (tasks || [])
    .filter((t) => t.status === 'open')
    .map((t) => ({ ...t, _score: scoreTask(t, { date, dayIndex, usedInWeek }) }))
    .sort((a, b) => b._score - a._score);

  const taskBlocks = [
    ...studyBlocks,
    ...(plannerCfg.fillEveningWithTasks ? flexBlocks : []),
  ].filter((b) => b.allowTasks);

  const taskEntries = [];
  let placedTasks = 0;
  const minSlice = plannerCfg.minTaskSlice || 25;

  for (const task of taskCandidates) {
    if (placedTasks >= maxTasks) break;
    const freeNow = taskBlocks.reduce((sum, b) => sum + Math.max(0, b.capacity - b.used), 0);
    if (freeNow < Math.min(minSlice, 15)) break;

    const want = Number(task.minutes) || 45;
    const take = Math.min(want, freeNow);
    if (take < 15) break;

    taskEntries.push({
      ref: `task:${task.id}`,
      type: 'task',
      title: task.title,
      category: task.category || task.subject || '任务',
      taskId: task.id,
      minutes: take,
      wantMinutes: want,
      target: take,
      unit: '分钟',
      countMode: 'value',
      weight: Number(task.weight) || 1,
      essential: !!task.pinned,
      note: task.notes || '',
      source: 'task',
    });
    placedTasks += 1;
  }

  const placedTasksItems = placeIntoBlocks(taskEntries, taskBlocks, warnings);
  pushPlaced(placedTasksItems);

  /* ---------- 3. 诊断 ---------- */

  const capacity = emptyCapacity();
  for (const b of blocks) {
    const key = b.kind === 'study' ? 'study' : b.kind === 'flex' ? 'flex' : b.kind;
    if (!capacity[key]) capacity[key] = { total: 0, used: 0, free: 0 };
    capacity[key].total += b.capacity;
    capacity[key].used += b.used;
    capacity[key].free += Math.max(0, b.capacity - b.used);
  }

  const studyDemand = indicatorEntries
    .filter((e) => (indicators.find((i) => `indicator:${i.id}` === e.ref)?.kind || 'study') === 'study')
    .reduce((s, e) => s + e.minutes, 0);

  if (studyDemand > capacity.study.total) {
    warnings.push({
      level: 'warn',
      code: 'overload',
      message: `每日必做指标共需 ${studyDemand} 分钟，但学习块只有 ${capacity.study.total} 分钟，超出 ${
        studyDemand - capacity.study.total
      } 分钟。要么调低某个指标，要么加长学习块。`,
    });
  }

  if (capacity.study.free >= 25 && placedTasks === 0) {
    const openTasks = (tasks || []).filter((t) => t.status === 'open').length;
    warnings.push({
      level: 'info',
      code: 'idle',
      message:
        openTasks > 0
          ? `学习块还剩 ${capacity.study.free} 分钟，任务池里有 ${openTasks} 个任务没排进来（可能是时间太长排不下）。`
          : `学习块还剩 ${capacity.study.free} 分钟空着，给任务池加个具体任务吧（比如「高数第 3 讲」）。`,
    });
  }

  const dueSoon = (tasks || []).filter(
    (t) => t.status === 'open' && t.dueDate && diffDays(date, t.dueDate) <= 1,
  );
  const duePlaced = new Set(placedTasksItems.map((i) => i.taskId));
  for (const t of dueSoon) {
    if (!duePlaced.has(t.id)) {
      warnings.push({
        level: 'warn',
        code: 'due',
        message: `「${t.title}」${diffDays(date, t.dueDate) < 0 ? '已经逾期' : '今天到期'}，但没排进今天。`,
      });
    }
  }

  /* ---------- 4. 排序 & 收尾 ---------- */
  items.sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return 1;
    if (!b.start) return -1;
    return toMinutes(a.start) - toMinutes(b.start);
  });

  return { items: items.map(normalizeItem), warnings, capacity, blocks: blocks.map(stripBlock) };
}

function stripBlock(b) {
  return { id: b.id, label: b.label, kind: b.kind, start: b.start, end: b.end, capacity: b.capacity, used: b.used };
}

function normalizeItem(it) {
  return {
    id: it.id || cryptoRandomId(),
    ref: it.ref,
    type: it.type,
    title: it.title,
    category: it.category,
    indicatorId: it.indicatorId || null,
    taskId: it.taskId || null,
    blockId: it.blockId || null,
    start: it.start || null,
    end: it.end || null,
    plannedMinutes: Math.round(it.plannedMinutes ?? it.minutes ?? 0),
    target: it.target ?? 0,
    unit: it.unit || '',
    countMode: it.countMode || 'value',
    weight: it.weight ?? 1,
    essential: !!it.essential,
    detail: it.detail || '',
    note: it.note || '',
    manual: !!it.manual,
    source: it.source || 'indicator',
    record: {
      status: 'pending',
      value: 0,
      cause: '',
      note: '',
      updatedAt: null,
    },
  };
}

function emptyCapacity() {
  return {
    study: { total: 0, used: 0, free: 0 },
    exercise: { total: 0, used: 0, free: 0 },
    review: { total: 0, used: 0, free: 0 },
    flex: { total: 0, used: 0, free: 0 },
    routine: { total: 0, used: 0, free: 0 },
  };
}

let idCounter = 0;
export function cryptoRandomId() {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.floor(
    Math.random() * 1e6,
  )
    .toString(36)
    .padStart(4, '0')}`;
}

/**
 * 把新生成的计划与「已经存在的今日计划」合并：
 * - 同 ref 的条目保留用户的打卡记录、备注、手动改动
 * - 用户手动添加的条目（manual=true / source='custom'）原样保留
 */
export function mergePlan(freshItems, existingItems = []) {
  const existingByRef = new Map();
  const manualCustom = [];
  for (const old of existingItems) {
    if (old.source === 'custom' || (old.manual && !old.ref)) manualCustom.push(old);
    else if (old.ref) existingByRef.set(old.ref, old);
  }

  const merged = freshItems.map((fresh) => {
    const old = existingByRef.get(fresh.ref);
    if (!old) return fresh;
    return {
      ...fresh,
      id: old.id,
      detail: old.detail ?? fresh.detail,
      note: old.note ?? fresh.note,
      record: old.record || fresh.record,
      manual: old.manual || fresh.manual,
      // 用户挪过位置就保留位置
      blockId: old.manual ? old.blockId : fresh.blockId,
      start: old.manual ? old.start : fresh.start,
      end: old.manual ? old.end : fresh.end,
    };
  });

  return [...merged, ...manualCustom].sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return 1;
    if (!b.start) return -1;
    return toMinutes(a.start) - toMinutes(b.start);
  });
}

/**
 * 按给定顺序重新铺排一天的时间。
 * 用于「AI 建议的执行顺序」「拖动调整」之后重算起止时间。
 *
 * @param {object} day    当天的数据（含 items / blocks）
 * @param {string[]} order  按执行顺序排列的 ref 列表
 * @param {Array<{ref:string, minutes?:number, blockId?:string}>} changes  时长/归属块的调整
 */
export function relayout(day, order = [], changes = []) {
  const warnings = [];
  const blocks = (day.blocks || []).slice().sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  if (!blocks.length) return { items: day.items || [], warnings };

  const changeMap = new Map((changes || []).filter((c) => c && c.ref).map((c) => [c.ref, c]));
  const orderIndex = new Map((order || []).map((ref, i) => [ref, i]));

  // 先应用「换块」
  const items = (day.items || []).map((item) => {
    const ch = changeMap.get(item.ref);
    if (ch?.blockId && blocks.some((b) => b.id === ch.blockId)) {
      return { ...item, blockId: ch.blockId };
    }
    return item;
  });

  const byBlock = new Map(blocks.map((b) => [b.id, []]));
  const orphan = [];
  for (const item of items) {
    if (item.blockId && byBlock.has(item.blockId)) byBlock.get(item.blockId).push(item);
    else orphan.push(item);
  }

  const out = [];
  for (const block of blocks) {
    const list = byBlock.get(block.id) || [];
    list.sort((a, b) => {
      const ai = orderIndex.has(a.ref) ? orderIndex.get(a.ref) : 999 + (toMinutes(a.start || '23:59') || 0);
      const bi = orderIndex.has(b.ref) ? orderIndex.get(b.ref) : 999 + (toMinutes(b.start || '23:59') || 0);
      return ai - bi;
    });

    let cursor = toMinutes(block.start);
    const limit = toMinutes(block.end);
    for (const item of list) {
      const ch = changeMap.get(item.ref);
      let minutes = Number(ch?.minutes) || Number(item.plannedMinutes) || 30;
      if (cursor >= limit) {
        warnings.push({
          level: 'warn',
          code: 'overflow',
          message: `「${item.title}」放不进 ${block.label}（时间块已满），先留在列表末尾。`,
        });
        out.push({ ...item, manual: true });
        continue;
      }
      if (cursor + minutes > limit) {
        const squeezed = Math.max(5, limit - cursor);
        warnings.push({
          level: 'info',
          code: 'squeezed',
          message: `「${item.title}」被压到 ${squeezed} 分钟才放得进 ${block.label}。`,
        });
        minutes = squeezed;
      }
      out.push({
        ...item,
        start: toHHMM(cursor),
        end: toHHMM(cursor + minutes),
        plannedMinutes: Math.round(minutes),
        manual: true,
      });
      cursor += minutes;
    }
  }

  for (const item of orphan) out.push({ ...item, manual: true });
  return { items: out, warnings };
}

/** 一周的排程：让任务在 7 天里摊开，不要同一天堆 4 个同科目的任务 */
export function planWeek({ startDate, settings, tasks = [] }) {
  const usedInWeek = new Set();
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(startDate, i);
    const result = planDay({ date, settings, tasks, usedInWeek, dayIndex: i });
    for (const it of result.items) {
      if (it.taskId) usedInWeek.add(it.taskId);
    }
    days.push({ date, ...result });
  }
  return days;
}
