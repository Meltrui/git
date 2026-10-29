import fs from 'node:fs';
import path from 'node:path';
import { get, mutate } from './store.js';
import { defaultSettings } from './defaults.js';
import { planDay, mergePlan, cryptoRandomId } from './planner.js';
import { deepMerge } from './store.js';
import { todayStr, isoWeek, weekDates, addDays } from './time.js';
import { scoreDay, emptyRecord } from './score.js';

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

export function getSettings() {
  return get().settings;
}

export function updateSettings(patch) {
  return mutate((db) => {
    db.settings = deepMerge(db.settings, patch);
    return db.settings;
  });
}

export function resetSettings(section) {
  return mutate((db) => {
    const base = defaultSettings();
    if (section && base[section] !== undefined) db.settings[section] = base[section];
    else db.settings = base;
    return db.settings;
  });
}

/* ------------------------------------------------------------------ */
/* 日子                                                                */
/* ------------------------------------------------------------------ */

export function listDates() {
  return Object.keys(get().days).sort();
}

export function getDayRaw(date) {
  return get().days[date] || null;
}

/**
 * 取某天，必要时生成计划。
 * @param {string} date
 * @param {{generate?:boolean, force?:boolean, tasks?:Array}} [opts]
 */
export function ensureDay(date, opts = {}) {
  const db = get();
  const settings = db.settings;
  const existing = db.days[date] || null;

  const shouldGenerate =
    opts.force || (!existing && opts.generate !== false && settings.planner?.autoGenerateToday !== false);

  if (!shouldGenerate) return existing || synthesizeEmptyDay(date);

  const result = planDay({ date, settings, tasks: db.tasks });
  const items = existing ? mergePlan(result.items, existing.items) : result.items;

  const day = {
    date,
    generatedAt: new Date().toISOString(),
    generator: 'local',
    items,
    warnings: result.warnings,
    capacity: result.capacity,
    blocks: result.blocks,
    journal: existing?.journal || emptyJournal(),
    closed: existing?.closed || false,
    closedAt: existing?.closedAt || null,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  mutate((data) => {
    data.days[date] = day;
  });
  return day;
}

function synthesizeEmptyDay(date) {
  return {
    date,
    generatedAt: null,
    generator: null,
    items: [],
    warnings: [{ level: 'info', code: 'empty', message: '这一天还没有计划。' }],
    capacity: null,
    blocks: [],
    journal: emptyJournal(),
    closed: false,
    closedAt: null,
  };
}

export function emptyJournal() {
  return { mood: 3, energy: 3, note: '', wins: '' };
}

/** 读取某天（含实时算分） */
export function getDayView(date) {
  const db = get();
  const day = db.days[date] || null;
  const videos = db.videos.filter((v) => v.date === date);
  if (!day) {
    return { ...synthesizeEmptyDay(date), score: 0, stats: null, videos: videos.map(videoBrief) };
  }
  const score = scoreDay(day, db.settings);
  return { ...day, score, videos: videos.map(videoBrief) };
}

/**
 * 更新某个条目的打卡记录
 * @param {string} date
 * @param {string} itemId
 * @param {object} patch { status, value, cause, note }
 */
export function setRecord(date, itemId, patch) {
  return mutate((db) => {
    const day = db.days[date];
    if (!day) throw httpError(404, '这一天还没有计划');
    const item = day.items.find((i) => i.id === itemId);
    if (!item) throw httpError(404, '找不到这个计划项');

    const rec = item.record || emptyRecord();
    const next = { ...rec };

    if (patch.status !== undefined) {
      next.status = patch.status;
      if (patch.status === 'done') {
        if (patch.value === undefined && (next.value === 0 || next.value == null)) {
          next.value = item.countMode === 'boolean' ? 1 : item.target;
        }
        next.cause = '';
      }
      if (patch.status === 'pending') {
        next.cause = '';
      }
    }
    if (patch.value !== undefined) next.value = Math.max(0, Number(patch.value) || 0);
    if (patch.cause !== undefined) next.cause = String(patch.cause || '');
    if (patch.note !== undefined) next.note = String(patch.note || '');
    next.updatedAt = new Date().toISOString();

    // 有数值但没明确状态时，按目标自动判定
    if (patch.status === undefined && patch.value !== undefined) {
      const target = Number(item.target) || 0;
      if (next.value >= target && target > 0) next.status = 'done';
      else if (next.value > 0) next.status = 'partial';
      else next.status = 'pending';
    }

    item.record = next;

    // 任务完成后回写任务池
    if (item.taskId && next.status === 'done') {
      const task = db.tasks.find((t) => t.id === item.taskId);
      if (task) {
        task.progress = (task.progress || 0) + (Number(item.plannedMinutes) || 0);
        if (task.progress >= (task.minutes || 0) - 1) {
          task.status = 'done';
          task.doneAt = new Date().toISOString();
        }
        task.updatedAt = new Date().toISOString();
      }
    }
    if (item.taskId) {
      const task = db.tasks.find((t) => t.id === item.taskId);
      if (task) task.lastScheduledAt = date;
    }

    return item;
  });
}

/** 手动添加一个自定义条目到某天 */
export function addCustomItem(date, payload) {
  return mutate((db) => {
    const day = db.days[date] || (db.days[date] = synthesizeEmptyDay(date));
    const item = {
      id: cryptoRandomId(),
      ref: `custom:${cryptoRandomId()}`,
      type: 'custom',
      title: String(payload.title || '未命名').slice(0, 120),
      category: payload.category || '其他',
      indicatorId: null,
      taskId: payload.taskId || null,
      blockId: payload.blockId || null,
      start: payload.start || null,
      end: payload.end || null,
      plannedMinutes: Number(payload.plannedMinutes) || Number(payload.minutes) || 30,
      target: Number(payload.target) || Number(payload.plannedMinutes) || 30,
      unit: payload.unit || '分钟',
      countMode: payload.countMode || 'value',
      weight: Number(payload.weight) || 1,
      essential: !!payload.essential,
      detail: payload.detail || '',
      note: payload.note || '',
      manual: true,
      source: 'custom',
      record: emptyRecord(),
    };
    day.items.push(item);
    return item;
  });
}

export function updateItem(date, itemId, patch) {
  return mutate((db) => {
    const day = db.days[date];
    if (!day) throw httpError(404, '这一天还没有计划');
    const item = day.items.find((i) => i.id === itemId);
    if (!item) throw httpError(404, '找不到这个计划项');
    const allowed = ['title', 'detail', 'note', 'start', 'end', 'blockId', 'plannedMinutes', 'category'];
    for (const key of allowed) {
      if (patch[key] !== undefined) item[key] = patch[key];
    }
    item.manual = true;
    return item;
  });
}

export function removeItem(date, itemId) {
  return mutate((db) => {
    const day = db.days[date];
    if (!day) throw httpError(404, '这一天还没有计划');
    const idx = day.items.findIndex((i) => i.id === itemId);
    if (idx < 0) throw httpError(404, '找不到这个计划项');
    day.items.splice(idx, 1);
    return true;
  });
}

/** 重新生成某天计划（保留打卡记录与手动条目） */
export function regenerateDay(date) {
  const db = get();
  const existing = db.days[date] || null;
  const result = planDay({ date, settings: db.settings, tasks: db.tasks });
  const items = existing ? mergePlan(result.items, existing.items) : result.items;
  return mutate((data) => {
    data.days[date] = {
      ...(data.days[date] || {}),
      date,
      generatedAt: new Date().toISOString(),
      generator: 'local',
      items,
      warnings: result.warnings,
      capacity: result.capacity,
      blocks: result.blocks,
      journal: existing?.journal || emptyJournal(),
      closed: existing?.closed || false,
      closedAt: existing?.closedAt || null,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    return data.days[date];
  });
}

/** 生成一周计划 */
export function generateWeek(startDate) {
  const db = get();
  const settings = db.settings;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  const usedInWeek = new Set();
  const result = {};

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const plan = planDay({ date, settings, tasks: db.tasks, usedInWeek, dayIndex: i });
    for (const it of plan.items) if (it.taskId) usedInWeek.add(it.taskId);
    result[date] = plan;
  }

  mutate((data) => {
    for (const date of dates) {
      const existing = data.days[date] || null;
      const plan = result[date];
      data.days[date] = {
        ...(existing || {}),
        date,
        generatedAt: new Date().toISOString(),
        generator: 'local',
        items: existing ? mergePlan(plan.items, existing.items) : plan.items,
        warnings: plan.warnings,
        capacity: plan.capacity,
        blocks: plan.blocks,
        journal: existing?.journal || emptyJournal(),
        closed: existing?.closed || false,
        closedAt: existing?.closedAt || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
    }
  });

  return dates.map((d) => getDayView(d));
}

/** 关闭一天：把仍是 pending 的条目标记为 missed，并记录原因占位 */
export function closeDay(date, { autoMiss = true } = {}) {
  return mutate((db) => {
    const day = db.days[date];
    if (!day) throw httpError(404, '这一天还没有计划');
    let missed = 0;
    if (autoMiss) {
      for (const item of day.items) {
        const rec = item.record || emptyRecord();
        item.record = rec;
        if (rec.status === 'pending' || !rec.status) {
          rec.status = 'missed';
          rec.updatedAt = new Date().toISOString();
          missed += 1;
        }
      }
    }
    day.closed = true;
    day.closedAt = new Date().toISOString();
    return { closed: true, missed };
  });
}

export function reopenDay(date) {
  return mutate((db) => {
    const day = db.days[date];
    if (!day) throw httpError(404, '这一天还没有计划');
    day.closed = false;
    day.closedAt = null;
    return day;
  });
}

export function updateJournal(date, patch) {
  return mutate((db) => {
    const day = db.days[date] || (db.days[date] = synthesizeEmptyDay(date));
    day.journal = { ...emptyJournal(), ...(day.journal || {}), ...patch };
    return day.journal;
  });
}

/* ------------------------------------------------------------------ */
/* 任务池                                                              */
/* ------------------------------------------------------------------ */

export function listTasks({ includeDone = false } = {}) {
  const tasks = get().tasks;
  return includeDone ? tasks : tasks.filter((t) => t.status !== 'dropped');
}

export function createTask(payload) {
  return mutate((db) => {
    const task = {
      id: cryptoRandomId(),
      title: String(payload.title || '未命名任务').slice(0, 160),
      category: payload.category || '其他',
      subject: payload.subject || '',
      priority: payload.priority || 'mid',
      minutes: Number(payload.minutes) || 45,
      dueDate: payload.dueDate || null,
      status: 'open',
      progress: 0,
      notes: payload.notes || '',
      pinned: !!payload.pinned,
      weight: Number(payload.weight) || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastScheduledAt: null,
      doneAt: null,
    };
    db.tasks.unshift(task);
    return task;
  });
}

export function updateTask(id, patch) {
  return mutate((db) => {
    const task = db.tasks.find((t) => t.id === id);
    if (!task) throw httpError(404, '找不到这个任务');
    const allowed = [
      'title',
      'category',
      'subject',
      'priority',
      'minutes',
      'dueDate',
      'notes',
      'pinned',
      'status',
      'weight',
      'progress',
    ];
    for (const key of allowed) if (patch[key] !== undefined) task[key] = patch[key];
    if (patch.status === 'done' && !task.doneAt) task.doneAt = new Date().toISOString();
    if (patch.status === 'open') task.doneAt = null;
    task.updatedAt = new Date().toISOString();
    return task;
  });
}

export function deleteTask(id) {
  return mutate((db) => {
    const idx = db.tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw httpError(404, '找不到这个任务');
    db.tasks.splice(idx, 1);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 周                                                                  */
/* ------------------------------------------------------------------ */

export function weekBundle(weekKey) {
  const db = get();
  const key = weekKey || isoWeek(todayStr()).key;
  const dates = weekDates(
    (() => {
      const first = weekKeyToStart(key);
      return first;
    })(),
  );
  const days = dates.map((d) => getDayView(d));
  const cached = db.weeks[key] || null;
  return { key, dates, days, report: cached };
}

function weekKeyToStart(key) {
  // 复用 time.js 的实现，避免循环依赖问题
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key));
  if (!m) return todayStr();
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - jan4Day);
  firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7);
  const pad = (n) => String(n).padStart(2, '0');
  return `${firstMonday.getFullYear()}-${pad(firstMonday.getMonth() + 1)}-${pad(firstMonday.getDate())}`;
}

export function saveWeekReport(key, report) {
  return mutate((db) => {
    db.weeks[key] = report;
    return report;
  });
}

/* ------------------------------------------------------------------ */
/* 视频                                                                */
/* ------------------------------------------------------------------ */

export function listVideos({ date, limit } = {}) {
  let videos = get().videos.slice();
  if (date) videos = videos.filter((v) => v.date === date);
  videos.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (limit) videos = videos.slice(0, limit);
  return videos;
}

export function getVideo(id) {
  return get().videos.find((v) => v.id === id) || null;
}

export function saveVideo(video) {
  return mutate((db) => {
    db.videos.push(video);
    return video;
  });
}

export function updateVideo(id, patch) {
  return mutate((db) => {
    const video = db.videos.find((v) => v.id === id);
    if (!video) throw httpError(404, '找不到这个视频');
    Object.assign(video, patch, { updatedAt: new Date().toISOString() });
    return video;
  });
}

export function deleteVideo(id) {
  return mutate((db) => {
    const idx = db.videos.findIndex((v) => v.id === id);
    if (idx < 0) throw httpError(404, '找不到这个视频');
    const [video] = db.videos.splice(idx, 1);
    return video;
  });
}

export function videoBrief(v) {
  return {
    id: v.id,
    date: v.date,
    size: v.size,
    durationSec: v.durationSec,
    thumb: v.thumb || null,
    createdAt: v.createdAt,
    transcribeStatus: v.transcript?.status || 'none',
    analyzed: !!v.analysis,
    analysisSummary: v.analysis?.summary || '',
    oneLiner: v.analysis?.oneLiner || '',
    encouragement: v.analysis?.encouragement || '',
    title: v.title || (v.originalName || '').replace(/\.[^.]+$/, ''),
  };
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function stats() {
  const db = get();
  return {
    days: Object.keys(db.days).length,
    tasks: db.tasks.filter((t) => t.status === 'open').length,
    videos: db.videos.length,
    weeks: Object.keys(db.weeks).length,
  };
}
