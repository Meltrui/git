import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { TMP_DIR, REEL_DIR, THUMB_DIR, VIDEO_DIR, ROOT } from './paths.js';
import * as store from './store.js';
import * as repo from './repo.js';
import * as videoSvc from './video.js';
import * as inbox from './inbox.js';
import { planDay, relayout } from './planner.js';
import { scoreDay, aggregateDays, computeStreak } from './score.js';
import { aiStatus, testConnection, chat, chatJson, PROVIDERS } from './ai.js';
import { generateWeeklyReport, applyAdjustment } from './report.js';
import { planAdviceMessages, coachMessages, taskBreakdownMessages } from './prompts.js';
import { asrStatus, ASR_PRESETS } from './asr.js';
import { mediaStatus, run as runProcess } from './media.js';
import { isoWeek, weekDates, weekStartFromKey, todayStr, addDays, diffDays, weekdayName, humanMinutes } from './time.js';
import { getJob, listJobs, runJob } from './jobs.js';
import { sseHandler, pushTestEvent } from './reminder.js';
import { MISS_CAUSES } from './defaults.js';

export const api = express.Router();

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 6 * 1024 * 1024 * 1024, files: 1 },
});

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function ok(res, data) {
  res.json({ ok: true, data });
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function maskSettings(s) {
  const copy = JSON.parse(JSON.stringify(s));
  copy.ai = { ...copy.ai, apiKeySet: !!copy.ai?.apiKey, apiKey: '' };
  copy.asr = { ...copy.asr, apiKeySet: !!copy.asr?.apiKey, apiKey: '' };
  copy.access = { ...copy.access, codeSet: !!copy.access?.code, code: '' };
  return copy;
}

function mergeSettingsPatch(current, patch) {
  const clean = JSON.parse(JSON.stringify(patch || {}));
  // 空的 key 表示「不改」，避免前端拿不到原值又把 key 抹掉
  if (clean.ai && (clean.ai.apiKey === '' || clean.ai.apiKey === undefined)) {
    delete clean.ai.apiKey;
    delete clean.ai.apiKeySet;
  }
  if (clean.asr && (clean.asr.apiKey === '' || clean.asr.apiKey === undefined)) {
    delete clean.asr.apiKey;
    delete clean.asr.apiKeySet;
  }
  if (clean.access && (clean.access.code === '' || clean.access.code === undefined)) {
    delete clean.access.code;
    delete clean.access.codeSet;
  }
  return clean;
}

function videoAbsPath(video) {
  return videoSvc.primaryAbs(video);
}

function datesOfWeek(key) {
  const start = weekStartFromKey(key);
  if (!start) return null;
  return { start, dates: weekDates(start) };
}

function enrichedDays() {
  const db = store.get();
  const byDate = {};
  for (const v of db.videos) {
    if (!byDate[v.date]) byDate[v.date] = [];
    byDate[v.date].push(v);
  }
  const out = {};
  for (const [date, day] of Object.entries(db.days)) {
    out[date] = { ...day, videos: byDate[date] || [] };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 基础                                                                */
/* ------------------------------------------------------------------ */

api.get('/health', (req, res) => {
  res.json({ ok: true, data: { app: 'anchor', version: '1.0.0', time: new Date().toISOString() } });
});

api.get(
  '/bootstrap',
  wrap(async (req, res) => {
    const settings = repo.getSettings();
    const today = todayStr();
    const db = store.get();
    const day = repo.ensureDay(today);
    const allDays = enrichedDays();
    const streak = computeStreak(allDays, settings, today);

    const examDate = settings.profile?.examDate;
    const todayVideo = db.videos.filter((v) => v.date === today);

    ok(res, {
      serverTime: new Date().toISOString(),
      today,
      weekday: weekdayName(today),
      weekKey: isoWeek(today).key,
      settings: maskSettings(settings),
      day: { ...repo.getDayView(today), videos: todayVideo.length },
      streak,
      counts: {
        openTasks: db.tasks.filter((t) => t.status === 'open').length,
        videos: db.videos.length,
        days: Object.keys(db.days).length,
      },
      exam: examDate ? { date: examDate, daysLeft: Math.max(0, diffDays(today, examDate)) } : null,
      capabilities: {
        media: mediaStatus(),
        asr: asrStatus(settings),
        ai: aiStatus(settings),
        aiProviders: PROVIDERS,
        asrPresets: ASR_PRESETS,
        causes: MISS_CAUSES,
        dataPath: store.stats().path,
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

api.get(
  '/settings',
  wrap(async (req, res) => {
    const settings = repo.getSettings();
    ok(res, {
      settings: maskSettings(settings),
      capabilities: {
        media: mediaStatus(),
        asr: asrStatus(settings),
        ai: aiStatus(settings),
        aiProviders: PROVIDERS,
        asrPresets: ASR_PRESETS,
        dataPath: store.stats().path,
        dataStats: store.stats(),
      },
    });
  }),
);

api.put(
  '/settings',
  wrap(async (req, res) => {
    const current = repo.getSettings();
    const patch = mergeSettingsPatch(current, req.body);
    const next = repo.updateSettings(patch);
    inbox.restartInboxWatcher(() => repo.getSettings());
    ok(res, { settings: maskSettings(next) });
  }),
);

api.post(
  '/settings/reset',
  wrap(async (req, res) => {
    const section = req.body?.section;
    ok(res, { settings: maskSettings(repo.resetSettings(section)) });
  }),
);

api.get(
  '/settings/export',
  wrap(async (req, res) => {
    const snap = store.snapshot();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="anchor-backup-${todayStr()}.json"`);
    res.send(JSON.stringify(snap, null, 2));
  }),
);

api.post(
  '/settings/import',
  upload.single('file'),
  wrap(async (req, res) => {
    let raw = null;
    if (req.file) {
      raw = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* 忽略 */
      }
    } else if (req.body?.data) {
      raw = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
    }
    if (!raw || !raw.settings) throw fail(400, '这不是 Anchor 的备份文件');
    store.replaceAll(raw);
    ok(res, { imported: true, stats: store.stats() });
  }),
);

/* ------------------------------------------------------------------ */
/* 今日 / 日计划                                                       */
/* ------------------------------------------------------------------ */

api.get(
  '/days/:date',
  wrap(async (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, '日期格式不对');
    const day = repo.ensureDay(date);
    const settings = repo.getSettings();
    const db = store.get();
    const prevDate = addDays(date, -1);
    const nextDate = addDays(date, 1);
    ok(res, {
      day: repo.getDayView(date),
      settings: maskSettings(settings),
      neighbours: {
        prev: repo.getDayRaw(prevDate) ? prevDate : null,
        next: repo.getDayRaw(nextDate) ? nextDate : null,
      },
      videos: db.videos.filter((v) => v.date === date).map(repo.videoBrief),
      weekDates: weekDates(date),
    });
    void day;
  }),
);

api.post(
  '/days/:date/regenerate',
  wrap(async (req, res) => {
    const { date } = req.params;
    ok(res, { day: repo.getDayView(repo.regenerateDay(date).date) });
  }),
);

api.post(
  '/days/:date/close',
  wrap(async (req, res) => {
    const { date } = req.params;
    const result = repo.closeDay(date, { autoMiss: req.body?.autoMiss !== false });
    ok(res, { ...result, day: repo.getDayView(date) });
  }),
);

api.post(
  '/days/:date/reopen',
  wrap(async (req, res) => {
    repo.reopenDay(req.params.date);
    ok(res, { day: repo.getDayView(req.params.date) });
  }),
);

api.patch(
  '/days/:date/journal',
  wrap(async (req, res) => {
    ok(res, { journal: repo.updateJournal(req.params.date, req.body || {}) });
  }),
);

api.post(
  '/days/:date/items',
  wrap(async (req, res) => {
    const item = repo.addCustomItem(req.params.date, req.body || {});
    ok(res, { item, day: repo.getDayView(req.params.date) });
  }),
);

api.patch(
  '/days/:date/items/:itemId',
  wrap(async (req, res) => {
    const item = repo.updateItem(req.params.date, req.params.itemId, req.body || {});
    ok(res, { item, day: repo.getDayView(req.params.date) });
  }),
);

api.delete(
  '/days/:date/items/:itemId',
  wrap(async (req, res) => {
    repo.removeItem(req.params.date, req.params.itemId);
    ok(res, { day: repo.getDayView(req.params.date) });
  }),
);

api.patch(
  '/days/:date/items/:itemId/record',
  wrap(async (req, res) => {
    const item = repo.setRecord(req.params.date, req.params.itemId, req.body || {});
    ok(res, { item, day: repo.getDayView(req.params.date) });
  }),
);

/** 一键全部完成 / 全部标记未完成 */
api.post(
  '/days/:date/bulk',
  wrap(async (req, res) => {
    const { date } = req.params;
    const { action, blockId, itemIds } = req.body || {};
    const day = repo.getDayRaw(date) || repo.ensureDay(date);
    const targets = day.items.filter((i) => {
      if (itemIds?.length) return itemIds.includes(i.id);
      if (blockId) return i.blockId === blockId;
      return true;
    });
    for (const item of targets) {
      if (action === 'done') repo.setRecord(date, item.id, { status: 'done' });
      else if (action === 'missed') repo.setRecord(date, item.id, { status: 'missed', cause: req.body?.cause || '' });
      else if (action === 'reset') repo.setRecord(date, item.id, { status: 'pending', value: 0 });
    }
    ok(res, { affected: targets.length, day: repo.getDayView(date) });
  }),
);

/* ------------------------------------------------------------------ */
/* 周                                                                  */
/* ------------------------------------------------------------------ */

api.get(
  '/weeks/:key',
  wrap(async (req, res) => {
    const key = req.params.key;
    const info = datesOfWeek(key);
    if (!info) throw fail(400, '周次格式应为 2026-W43');
    const rows = info.dates.map((d) => repo.getDayView(d));
    const settings = repo.getSettings();
    const db = store.get();

    const active = rows.filter((r) => r.items?.length);
    const agg = aggregateDays(active, settings);
    const allDays = enrichedDays();
    const streak = computeStreak(allDays, settings, todayStr());

    ok(res, {
      key,
      startDate: info.dates[0],
      endDate: info.dates[6],
      dates: info.dates,
      days: rows,
      aggregates: agg,
      streak,
      report: db.weeks[key] || null,
      videos: db.videos.filter((v) => info.dates.includes(v.date)).map(repo.videoBrief),
      settings: maskSettings(settings),
    });
  }),
);

api.post(
  '/weeks/:key/generate',
  wrap(async (req, res) => {
    const info = datesOfWeek(req.params.key);
    if (!info) throw fail(400, '周次格式不对');
    const days = repo.generateWeek(info.start);
    ok(res, { days, key: req.params.key });
  }),
);

api.post(
  '/weeks/:key/report',
  wrap(async (req, res) => {
    const key = req.params.key;
    const info = datesOfWeek(key);
    if (!info) throw fail(400, '周次格式不对');
    const settings = repo.getSettings();
    const db = store.get();
    const rows = info.dates.map((d) => repo.getDayView(d));

    const prevKey = isoWeek(addDays(info.dates[0], -7)).key;
    const prevInfo = datesOfWeek(prevKey);
    const prevRows = prevInfo ? prevInfo.dates.map((d) => repo.getDayView(d)) : [];
    const lastWeekAgg = aggregateDays(
      prevRows.filter((r) => r.items?.length),
      settings,
    );

    const report = await generateWeeklyReport({
      key,
      dates: info.dates,
      days: rows,
      settings,
      tasks: db.tasks,
      videos: db.videos,
      allDays: enrichedDays(),
      lastWeekAgg,
    });
    repo.saveWeekReport(key, report);
    ok(res, { report });
  }),
);

api.post(
  '/weeks/:key/apply',
  wrap(async (req, res) => {
    const key = req.params.key;
    const { adjustmentId } = req.body || {};
    const report = store.get().weeks[key];
    if (!report) throw fail(404, '还没有这一周的报告');
    const adj = (report.ai?.adjustments || []).find((a) => a.id === adjustmentId);
    if (!adj) throw fail(404, '找不到这条建议');

    const result = applyAdjustment(adj, {
      settings: repo.getSettings(),
      updateSettings: (patch) => repo.updateSettings(patch),
      createTask: (payload) => repo.createTask(payload),
      updateTask: (id, patch) => repo.updateTask(id, patch),
    });

    const applied = new Set(report.appliedAdjustments || []);
    if (result.applied) applied.add(adj.id);
    repo.saveWeekReport(key, { ...report, appliedAdjustments: [...applied] });

    ok(res, { ...result, appliedAdjustments: [...applied], settings: maskSettings(repo.getSettings()) });
  }),
);

api.post(
  '/weeks/:key/reel',
  wrap(async (req, res) => {
    const job = videoSvc.startReelJob(req.params.key, repo.getSettings());
    ok(res, { job });
  }),
);

/* ------------------------------------------------------------------ */
/* 任务池                                                              */
/* ------------------------------------------------------------------ */

api.get(
  '/tasks',
  wrap(async (req, res) => {
    const includeDone = req.query.includeDone === '1';
    const tasks = repo.listTasks({ includeDone });
    ok(res, {
      tasks: tasks
        .map((t) => ({
          ...t,
          overdue: t.dueDate ? diffDays(todayStr(), t.dueDate) < 0 && t.status === 'open' : false,
          dueInDays: t.dueDate ? diffDays(todayStr(), t.dueDate) : null,
        }))
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
          const rank = { high: 0, mid: 1, low: 2 };
          if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
          return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1;
        }),
    });
  }),
);

api.post(
  '/tasks',
  wrap(async (req, res) => {
    const task = repo.createTask(req.body || {});
    ok(res, { task });
  }),
);

api.patch(
  '/tasks/:id',
  wrap(async (req, res) => {
    ok(res, { task: repo.updateTask(req.params.id, req.body || {}) });
  }),
);

api.delete(
  '/tasks/:id',
  wrap(async (req, res) => {
    repo.deleteTask(req.params.id);
    ok(res, { deleted: true });
  }),
);

api.post(
  '/tasks/breakdown',
  wrap(async (req, res) => {
    const settings = repo.getSettings();
    const { goal, dueDate, dailyMinutes } = req.body || {};
    if (!goal || String(goal).trim().length < 2) throw fail(400, '说说你要学什么');
    if (!settings.ai?.enabled || !settings.ai?.apiKey) throw fail(400, '需要先在设置里配置大模型');

    const studyCapacity = (settings.blocks || [])
      .filter((b) => b.kind === 'study')
      .reduce((sum, b) => {
        const [sh, sm] = b.start.split(':').map(Number);
        const [eh, em] = b.end.split(':').map(Number);
        return sum + (eh * 60 + em - (sh * 60 + sm));
      }, 0);

    const { data } = await chatJson(
      settings,
      taskBreakdownMessages({
        goal,
        dueDate: dueDate || '',
        dailyMinutes: dailyMinutes || studyCapacity,
        today: todayStr(),
      }),
      { maxTokens: 2000 },
    );

    const tasks = (Array.isArray(data.tasks) ? data.tasks : [])
      .map((t) => ({
        title: String(t.title || '').slice(0, 160),
        category: t.category || '其他',
        minutes: Math.max(10, Math.min(240, Number(t.minutes) || 45)),
        priority: ['high', 'mid', 'low'].includes(t.priority) ? t.priority : 'mid',
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(t.dueDate || '')) ? t.dueDate : dueDate || null,
      }))
      .filter((t) => t.title);

    ok(res, { tasks, note: data.note || '' });
  }),
);

api.post(
  '/tasks/breakdown/apply',
  wrap(async (req, res) => {
    const list = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const created = list.map((t) => repo.createTask(t));
    ok(res, { created });
  }),
);

/* ------------------------------------------------------------------ */
/* 视频                                                                */
/* ------------------------------------------------------------------ */

api.get(
  '/videos',
  wrap(async (req, res) => {
    const date = req.query.date;
    const videos = repo.listVideos(date ? { date } : {});
    ok(res, {
      videos: videos.map((v) => ({
        ...v,
        playable: videoSvc.isWebPlayable(v),
        url: `/api/videos/${v.id}/file`,
        thumbUrl: v.thumb ? `/api/videos/${v.id}/thumb` : null,
        audioUrl: videoSvc.audioAbs(v) ? `/api/videos/${v.id}/audio` : null,
        storage: videoSvc.storageBrief(v),
      })),
      reels: videoSvc.listReels(),
      capabilities: videoSvc.capabilityReport(repo.getSettings()),
      media: repo.getSettings().media,
    });
  }),
);

api.post(
  '/videos',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw fail(400, '没有收到文件');
    const video = await videoSvc.ingest({
      tempPath: req.file.path,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      date: req.body?.date,
      title: req.body?.title,
      source: 'upload',
    });
    const settings = repo.getSettings();
    const job = videoSvc.startProcessJob(video.id, settings);
    ok(res, {
      video: repo.getVideo(video.id) || video,
      playable: videoSvc.isWebPlayable(video),
      job,
    });
  }),
);

api.patch(
  '/videos/:id',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const patch = {};
    for (const key of ['title', 'date']) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    if (req.body?.transcriptText !== undefined) {
      patch.transcript = {
        ...(video.transcript || {}),
        status: String(req.body.transcriptText).trim() ? 'manual' : 'none',
        text: String(req.body.transcriptText),
        provider: 'manual',
        at: new Date().toISOString(),
      };
    }
    ok(res, { video: repo.updateVideo(req.params.id, patch) });
  }),
);

api.delete(
  '/videos/:id',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    videoSvc.deleteVideoFiles(video);
    repo.deleteVideo(req.params.id);
    ok(res, { deleted: true });
  }),
);

api.post(
  '/videos/:id/transcribe',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const settings = repo.getSettings();
    const status = asrStatus(settings);
    if (!status.canTranscribe) {
      throw fail(
        400,
        status.ffmpeg
          ? '转写还没准备好：本地模型没下载，或者云端语音服务的 Key 没填。设置页有引导。'
          : '缺少 ffmpeg，无法提取音频。',
      );
    }
    const job = videoSvc.startTranscribeJob(video, settings);
    ok(res, { job });
  }),
);

api.post(
  '/videos/:id/analyze',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const job = videoSvc.startAnalyzeJob(video, repo.getSettings());
    ok(res, { job });
  }),
);

api.post(
  '/videos/:id/apply-checks',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
    let applied = 0;
    for (const itemId of itemIds) {
      try {
        repo.setRecord(video.date, itemId, { status: 'done', note: '按视频分析补勾' });
        applied += 1;
      } catch {
        /* 忽略单项失败 */
      }
    }
    ok(res, { applied, day: repo.getDayView(video.date) });
  }),
);

api.post(
  '/videos/:id/proxy',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const job = videoSvc.startProxyJob(video);
    ok(res, { job });
  }),
);

/* 重新归档：换了清晰度/保留策略后，对已有视频再跑一次压缩流水线 */
api.post(
  '/videos/:id/archive',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const job = videoSvc.startReprocessJob(video, repo.getSettings());
    ok(res, { job });
  }),
);

/* 只删原片，保留归档版和文字稿 */
api.post(
  '/videos/:id/delete-raw',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    ok(res, videoSvc.deleteRawOnly(video));
  }),
);

api.get(
  '/videos/:id/audio',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const abs = videoSvc.audioAbs(video);
    if (!abs) throw fail(404, '这个视频还没有归档音频');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(abs);
  }),
);

/* ------------------------------------------------------------------ */
/* 存储与收件箱                                                        */
/* ------------------------------------------------------------------ */

api.get(
  '/storage',
  wrap(async (req, res) => {
    ok(res, videoSvc.storageReport());
  }),
);

api.post(
  '/storage/cleanup',
  wrap(async (req, res) => {
    const what = String(req.body?.what || 'raw');
    if (!['raw', 'audio', 'orphans', 'failed'].includes(what)) {
      throw fail(400, '清理类型只能是 raw / audio / orphans / failed');
    }
    ok(res, videoSvc.cleanupStorage({ what }));
  }),
);

api.get(
  '/inbox',
  wrap(async (req, res) => {
    ok(res, inbox.inboxStatus(repo.getSettings()));
  }),
);

api.post(
  '/inbox/scan',
  wrap(async (req, res) => {
    ok(res, await inbox.scanOnce(repo.getSettings()));
  }),
);

api.post(
  '/inbox/open',
  wrap(async (req, res) => {
    ok(res, inbox.openInboxFolder());
  }),
);

api.get(
  '/videos/:id/file',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video) throw fail(404, '找不到这个视频');
    const abs = videoAbsPath(video);
    if (!fs.existsSync(abs)) throw fail(404, '视频文件不见了');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(abs);
  }),
);

api.get(
  '/videos/:id/thumb',
  wrap(async (req, res) => {
    const video = repo.getVideo(req.params.id);
    if (!video || !video.thumb) throw fail(404, '没有封面');
    res.sendFile(path.join(THUMB_DIR, video.thumb));
  }),
);

api.get('/reels/:filename', (req, res, next) => {
  const name = path.basename(req.params.filename);
  const abs = path.join(REEL_DIR, name);
  if (!fs.existsSync(abs)) return next(fail(404, '找不到这个周回顾视频'));
  res.setHeader('Accept-Ranges', 'bytes');
  return res.sendFile(abs);
});

/* ------------------------------------------------------------------ */
/* 语音转写模型                                                        */
/* ------------------------------------------------------------------ */

api.get(
  '/asr/status',
  wrap(async (req, res) => {
    ok(res, asrStatus(repo.getSettings()));
  }),
);

api.post(
  '/asr/download',
  wrap(async (req, res) => {
    const status = asrStatus(repo.getSettings());
    if (status.localReady) {
      ok(res, { already: true, status });
      return;
    }
    const job = runJob('asr-model', '下载本地语音识别模型', async (setProgress) => {
      setProgress({ progress: 3, step: '连接下载源（约 240MB，只需一次）…' });
      const script = path.join(ROOT, 'scripts', 'fetch-asr-model.mjs');
      const result = await runProcess(process.execPath, [script], { timeoutMs: 60 * 60 * 1000 });
      if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || '下载失败').slice(-600));
      }
      setProgress({ progress: 100, step: '完成' });
      return { ok: true, status: asrStatus(repo.getSettings()) };
    });
    ok(res, { job });
  }),
);

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

api.get(
  '/stats/overview',
  wrap(async (req, res) => {
    const settings = repo.getSettings();
    const days = Number(req.query.days) || 120;
    const allDays = enrichedDays();
    const today = todayStr();
    const from = addDays(today, -days);

    const heatmap = [];
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const day = allDays[d];
      const s = day && day.items?.length ? scoreDay(day, settings) : null;
      heatmap.push({
        date: d,
        score: s?.score ?? null,
        hasVideo: (day?.videos?.length || 0) > 0,
        planned: s?.plannedMinutes ?? 0,
        achieved: s?.achievedMinutes ?? 0,
      });
    }

    const periodDays = Object.keys(allDays)
      .filter((d) => d >= from && d <= today)
      .sort()
      .map((d) => allDays[d]);

    const agg = aggregateDays(periodDays, settings);
    const streak = computeStreak(allDays, settings, today);

    // 按周汇总
    const weekMap = new Map();
    for (const day of periodDays) {
      if (!day.items?.length) continue;
      const key = isoWeek(day.date).key;
      if (!weekMap.has(key)) weekMap.set(key, []);
      weekMap.get(key).push(day);
    }
    const weeks = [...weekMap.entries()]
      .map(([key, list]) => {
        const a = aggregateDays(list, settings);
        return {
          key,
          avgScore: a.avgScore,
          completionRate: a.completionRate,
          studyMinutes: a.studyMinutesAchieved,
          days: a.dayCount,
        };
      })
      .sort((a, b) => (a.key < b.key ? -1 : 1));

    ok(res, {
      heatmap,
      aggregates: agg,
      streak,
      weeks,
      totals: {
        daysRecorded: Object.keys(allDays).length,
        avgScore: agg.avgScore,
        studyMinutes: agg.studyMinutesAchieved,
        videos: store.get().videos.length,
        openTasks: store.get().tasks.filter((t) => t.status === 'open').length,
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

api.post(
  '/ai/test',
  wrap(async (req, res) => {
    const settings = repo.getSettings();
    const result = await testConnection(settings);
    ok(res, result);
  }),
);

api.post(
  '/ai/plan-advice',
  wrap(async (req, res) => {
    const date = req.body?.date || todayStr();
    const settings = repo.getSettings();
    const day = repo.ensureDay(date);
    const db = store.get();

    const scopes = (settings.blocks || [])
      .filter((b) => !Array.isArray(b.days) || b.days.includes(new Date(date).getDay() + 0))
      .map((b) => `- ${b.id} / ${b.label} / ${b.start}-${b.end} / 类型 ${b.kind}`);

    const itemCatalog = day.items.map(
      (i) =>
        `- ${i.ref} / ${i.title} / ${i.start || '随时'}-${i.end || ''} / ${i.plannedMinutes} 分钟 / 目标 ${i.target}${i.unit}`,
    );

    // 最近 7 天各指标完成率
    const enriched = enrichedDays();
    const recentDates = Array.from({ length: 7 }, (_, i) => addDays(date, -i - 1)).filter((d) => enriched[d]);
    const recent = aggregateDays(recentDates.map((d) => enriched[d]), settings);

    const fallback = localPlanAdvice(day, settings);

    if (!settings.ai?.enabled || !settings.ai?.apiKey) {
      ok(res, { advice: fallback, source: 'rules' });
      return;
    }

    try {
      const { data, model } = await chatJson(
        settings,
        planAdviceMessages({
          date,
          weekday: weekdayName(date),
          blockCatalog: scopes,
          itemCatalog,
          capacity: day.capacity,
          warnings: (day.warnings || []).map((w) => w.message),
          taskCatalog: db.tasks
            .filter((t) => t.status === 'open')
            .slice(0, 20)
            .map((t) => `- ${t.id} / ${t.title} / ${t.minutes} 分钟 / 截止 ${t.dueDate || '无'}`),
          recentRates: recent.byIndicator.slice(0, 12).map((r) => ({
            指标: r.title,
            完成率: `${r.rate}%`,
            出现天数: r.appearances,
          })),
        }),
        { maxTokens: 1800 },
      );

      const refs = new Set(day.items.map((i) => i.ref));
      const order = Array.isArray(data.order) ? data.order.filter((r) => refs.has(r)) : [];
      for (const ref of refs) if (!order.includes(ref)) order.push(ref);

      ok(res, {
        advice: {
          verdict: String(data.verdict || '').slice(0, 300),
          notes: Array.isArray(data.notes) ? data.notes.map((n) => String(n).slice(0, 300)).slice(0, 5) : [],
          order,
          changes: Array.isArray(data.changes)
            ? data.changes
                .filter((c) => c && refs.has(c.ref))
                .map((c) => ({
                  ref: c.ref,
                  minutes: Number(c.minutes) || undefined,
                  blockId: c.blockId || undefined,
                  reason: String(c.reason || '').slice(0, 300),
                }))
                .slice(0, 6)
            : [],
        },
        source: 'ai',
        model,
      });
    } catch (err) {
      ok(res, { advice: fallback, source: 'rules', error: err.message });
    }
  }),
);

api.post(
  '/ai/plan-advice/apply',
  wrap(async (req, res) => {
    const { date, order, changes } = req.body || {};
    const d = date || todayStr();
    const day = repo.ensureDay(d);
    const next = relayout(day, order || [], changes || []);
    store.mutate((db) => {
      db.days[d] = { ...db.days[d], items: next.items };
    });
    ok(res, { day: repo.getDayView(d), warnings: next.warnings });
  }),
);

api.post(
  '/ai/coach',
  wrap(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) throw fail(400, '问点什么');
    const settings = repo.getSettings();
    if (!settings.ai?.enabled || !settings.ai?.apiKey) throw fail(400, '需要先配置大模型 API Key');

    const today = todayStr();
    const allDays = enrichedDays();
    const recentDates = Object.keys(allDays).sort().slice(-14);
    const agg = aggregateDays(recentDates.map((d) => allDays[d]), settings);
    const day = repo.getDayRaw(today);

    const snapshot = {
      日期: today,
      今日计划: (day?.items || []).map((i) => ({
        项目: i.title,
        状态: i.record?.status,
        实际: `${i.record?.value ?? 0}/${i.target}${i.unit || ''}`,
        原因: i.record?.cause || '',
      })),
      最近14天: {
        平均得分: agg.avgScore,
        时长完成率: `${agg.completionRate}%`,
        条目完成率: `${agg.itemCompletionRate}%`,
        指标: agg.byIndicator.map((r) => ({
          名称: r.title,
          出现: r.appearances,
          完成: r.done,
          未完成: r.missed,
          完成率: `${r.rate}%`,
        })),
        未完成原因: agg.causes,
      },
      作息: (settings.blocks || []).map((b) => `${b.label} ${b.start}-${b.end}`),
      目标: settings.profile,
    };

    const { content, model } = await chat(settings, coachMessages(question, snapshot), { maxTokens: 1500 });
    ok(res, { answer: content, model });
  }),
);

function localPlanAdvice(day, settings) {
  const notes = [];
  const items = day.items || [];
  const capacity = day.capacity || {};
  const studyFree = capacity.study?.free || 0;

  if (studyFree >= 30) notes.push(`学习块还空着 ${studyFree} 分钟，可以从任务池里挑一个填进去。`);
  const essentialMiss = items.filter((i) => i.essential && (i.record?.status || 'pending') === 'pending');
  if (essentialMiss.length) notes.push(`核心指标还有 ${essentialMiss.length} 项没打勾：${essentialMiss.map((i) => i.title).join('、')}。`);

  const heavy = items.filter((i) => /数学/.test(i.category) && i.start && i.start < '12:00');
  if (heavy.length >= 2) notes.push('上午连着两段数学，中间插 10 分钟掐表休息，避免第 80 分钟后效率掉下去。');

  return {
    verdict: (day.warnings || []).find((w) => w.level === 'warn')?.message || '这个计划的容量是够的，按时间开始就行。',
    notes: notes.length ? notes : ['没有发现明显的排程问题。'],
    order: items.map((i) => i.ref),
    changes: [],
  };
}

/* ------------------------------------------------------------------ */
/* 任务/提醒/系统                                                      */
/* ------------------------------------------------------------------ */

api.get('/jobs', (req, res) => ok(res, { jobs: listJobs(30) }));

api.get(
  '/jobs/:id',
  wrap(async (req, res) => {
    const job = getJob(req.params.id);
    if (!job) throw fail(404, '找不到这个任务');
    ok(res, { job });
  }),
);

api.get('/events', sseHandler);

api.post('/reminder/test', (req, res) => {
  pushTestEvent();
  ok(res, { pushed: true });
});

api.get(
  '/system/info',
  wrap(async (req, res) => {
    ok(res, {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      media: mediaStatus(),
      asr: asrStatus(repo.getSettings()),
      data: store.stats(),
      paths: { data: store.stats().path, video: VIDEO_DIR },
      human: { targetStudyMinutes: humanMinutes(repo.getSettings().weekly?.targetStudyMinutes || 0) },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 兜底                                                                */
/* ------------------------------------------------------------------ */

api.use((req, res) => {
  res.status(404).json({ ok: false, error: `没有这个接口：${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ ok: false, error: err.message || '服务器出错了' });
});
