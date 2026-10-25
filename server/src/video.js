import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_DIR, THUMB_DIR, REEL_DIR, TMP_DIR } from './paths.js';
import { probe, makeThumbnail, transcodeWeb, concatVideos, mediaStatus } from './media.js';
import { transcribeFile, asrStatus } from './asr.js';
import { runJob } from './jobs.js';
import { chatJson } from './ai.js';
import { videoAnalysisMessages } from './prompts.js';
import * as repo from './repo.js';
import { todayStr, isoWeek, weekDates } from './time.js';
import { scoreDay } from './score.js';

const WEB_SAFE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const WEB_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

function safeExt(name = '', mime = '') {
  const fromName = path.extname(name).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('matroska')) return '.mkv';
  if (mime.includes('mpeg')) return '.mpg';
  return '.mp4';
}

export function videoFilePath(video, { proxy = false } = {}) {
  if (proxy && video.proxyPath) return path.join(VIDEO_DIR, video.proxyPath);
  return path.join(VIDEO_DIR, video.relPath);
}

export function isWebPlayable(video) {
  if (video.proxyPath) return true;
  const v = video.video;
  if (!v) return true; // 没有视频流信息时先按能播处理，让浏览器自己试
  const vcodec = String(v.codec || '').toLowerCase();
  const acodec = String(video.audio?.codec || '').toLowerCase();
  return WEB_SAFE_VIDEO.has(vcodec) && (!acodec || WEB_SAFE_AUDIO.has(acodec));
}

/**
 * 收下一个上传的视频
 */
export async function ingest({ tempPath, originalName, mimetype, date, title, size }) {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayStr();
  const id = `v-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const ext = safeExt(originalName, mimetype);
  const dir = path.join(VIDEO_DIR, day);
  fs.mkdirSync(dir, { recursive: true });

  const destName = `${id}${ext}`;
  const destAbs = path.join(dir, destName);
  fs.renameSync(tempPath, destAbs);

  const info = await probe(destAbs);
  const durationSec = Math.round(info?.durationSec || 0);

  let thumb = null;
  try {
    const thumbAbs = path.join(THUMB_DIR, `${id}.jpg`);
    const at = durationSec > 10 ? Math.min(5, durationSec * 0.15) : 0;
    const made = await makeThumbnail(destAbs, thumbAbs, { atSec: at });
    if (made) thumb = `${id}.jpg`;
  } catch {
    /* 封面失败不影响主流程 */
  }

  const video = {
    id,
    date: day,
    title: String(title || '').slice(0, 120) || (originalName || '').replace(/\.[^.]+$/, ''),
    originalName: originalName || destName,
    relPath: path.join(day, destName),
    proxyPath: null,
    size: Number(size) || fs.statSync(destAbs).size,
    mime: mimetype || '',
    durationSec,
    video: info?.video || null,
    audio: info?.audio || null,
    thumb,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    transcript: {
      status: 'none',
      text: '',
      segments: [],
      provider: '',
      at: null,
      error: null,
    },
    analysis: null,
    analysisError: null,
  };

  repo.saveVideo(video);
  markDailyVideoIndicator(day);
  return video;
}

/** 上传了视频，就把当天的「录制总结视频」指标自动勾上 */
function markDailyVideoIndicator(date) {
  const day = repo.getDayRaw(date);
  if (!day) return;
  const item = day.items?.find((i) => i.ref === 'indicator:daily-video' || i.indicatorId === 'daily-video');
  if (!item) return;
  const rec = item.record || {};
  if (rec.status === 'done') return;
  try {
    repo.setRecord(date, item.id, { status: 'done', value: 1, note: rec.note || '已上传视频' });
  } catch {
    /* 忽略 */
  }
}

export function deleteVideoFiles(video) {
  const targets = [videoFilePath(video), video.proxyPath ? videoFilePath(video, { proxy: true }) : null];
  for (const p of targets) {
    if (!p) continue;
    try {
      fs.unlinkSync(p);
    } catch {
      /* 忽略 */
    }
  }
  if (video.thumb) {
    try {
      fs.unlinkSync(path.join(THUMB_DIR, video.thumb));
    } catch {
      /* 忽略 */
    }
  }
}

/** 生成浏览器能播的版本（HEVC 等格式） */
export function startProxyJob(video) {
  return runJob('video-proxy', `转码 ${video.date}`, async (setProgress) => {
    setProgress({ progress: 5, step: '准备转码' });
    const src = videoFilePath(video);
    const outName = `${video.id}-web.mp4`;
    const outAbs = path.join(path.dirname(src), outName);
    await transcodeWeb(src, outAbs);
    setProgress({ progress: 90, step: '更新记录' });
    const rel = path.join(video.date, outName);
    repo.updateVideo(video.id, { proxyPath: rel });
    setProgress({ progress: 100, step: '完成' });
    return { id: video.id, proxyPath: rel };
  });
}

/** 转写（本地或云端） */
export function startTranscribeJob(video, settings) {
  return runJob('video-transcribe', `转写 ${video.date}`, async (setProgress) => {
    setProgress({ progress: 10, step: '提取音频并识别…' });
    repo.updateVideo(video.id, {
      transcript: { ...(video.transcript || {}), status: 'running', error: null },
    });
    try {
      const result = await transcribeFile(videoFilePath(video), settings);
      setProgress({ progress: 95, step: '保存文字稿' });
      repo.updateVideo(video.id, {
        transcript: {
          status: 'done',
          text: result.text,
          segments: result.segments || [],
          provider: result.provider,
          language: result.language,
          durationSec: result.durationSec,
          at: new Date().toISOString(),
          error: null,
        },
      });
      return { id: video.id, text: result.text, provider: result.provider };
    } catch (err) {
      repo.updateVideo(video.id, {
        transcript: {
          ...(video.transcript || {}),
          status: 'failed',
          error: err.message,
          at: new Date().toISOString(),
        },
      });
      throw err;
    }
  });
}

/** AI 分析今日总结视频 */
export function startAnalyzeJob(video, settings) {
  return runJob('video-analyze', `分析 ${video.date}`, async (setProgress) => {
    const latest = repo.getVideo(video.id) || video;
    const transcript = latest.transcript?.text || '';
    if (!transcript.trim()) {
      throw new Error('这个视频还没有文字稿。先点「转写」，或者手动粘贴一段文字稿。');
    }
    if (!settings.ai?.enabled || !settings.ai?.apiKey) {
      throw new Error('还没有配置大模型 API Key（设置 → AI）');
    }

    setProgress({ progress: 20, step: '整理当天打卡记录' });
    const day = repo.getDayRaw(latest.date);
    const score = day ? scoreDay(day, settings) : null;
    const items = (day?.items || []).map((i) => ({
      id: i.id,
      项目: i.title,
      类别: i.category,
      状态: i.record?.status || 'pending',
      目标: `${i.target}${i.unit || ''}`,
      实际: i.record?.value ?? 0,
      未完成原因: i.record?.cause || '',
      具体内容: i.detail || '',
    }));

    setProgress({ progress: 45, step: '让模型对照分析…' });
    const { data, model } = await chatJson(
      settings,
      videoAnalysisMessages({
        date: latest.date,
        items,
        score,
        transcript,
      }),
      { maxTokens: 2500 },
    );

    const analysis = normalizeAnalysis(data, items);
    setProgress({ progress: 95, step: '保存分析结果' });
    repo.updateVideo(video.id, {
      analysis,
      analysisError: null,
      analysisModel: model,
      analysisAt: new Date().toISOString(),
    });
    return { id: video.id, analysis };
  });
}

function normalizeAnalysis(data, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const checks = Array.isArray(data.suggestedChecks)
    ? data.suggestedChecks
        .map((c) => {
          const target = byId.get(c.itemId);
          if (!target) return null;
          return {
            itemId: c.itemId,
            title: target.项目,
            reason: String(c.reason || '').slice(0, 300),
            currentStatus: target.状态,
          };
        })
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    summary: String(data.summary || '').slice(0, 600),
    selfReport: Array.isArray(data.selfReport)
      ? data.selfReport
          .map((r) => ({
            text: String(r?.text || '').slice(0, 200),
            matchesRecord: r?.matchesRecord === true ? true : r?.matchesRecord === false ? false : null,
            note: String(r?.note || '').slice(0, 300),
          }))
          .filter((r) => r.text)
          .slice(0, 8)
      : [],
    gaps: Array.isArray(data.gaps) ? data.gaps.map((g) => String(g).slice(0, 300)).slice(0, 6) : [],
    mood: data.mood
      ? { label: String(data.mood.label || '').slice(0, 20), evidence: String(data.mood.evidence || '').slice(0, 300) }
      : null,
    insights: Array.isArray(data.insights) ? data.insights.map((s) => String(s).slice(0, 300)).slice(0, 5) : [],
    tomorrowTips: Array.isArray(data.tomorrowTips)
      ? data.tomorrowTips.map((s) => String(s).slice(0, 300)).slice(0, 5)
      : [],
    suggestedChecks: checks,
  };
}

/** 周回顾视频：把一周的录像拼成一条 */
export function startReelJob(weekKey, settings) {
  return runJob('weekly-reel', `周回顾 ${weekKey}`, async (setProgress) => {
    const status = mediaStatus();
    if (!status.ffmpeg) throw new Error('没有找到 ffmpeg，无法合成视频');

    const key = weekKey || isoWeek(todayStr()).key;
    const dates = weekDates(startOfWeek(key));
    const videos = repo
      .listVideos()
      .filter((v) => dates.includes(v.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    if (!videos.length) throw new Error('这一周还没有上传任何总结视频');
    if (videos.length === 1) throw new Error('这一周只有 1 个视频，直接看那个就行');

    setProgress({ progress: 10, step: `共 ${videos.length} 个视频待合成` });
    fs.mkdirSync(REEL_DIR, { recursive: true });
    const outName = `reel-${key}.mp4`;
    const outAbs = path.join(REEL_DIR, outName);
    const workDir = path.join(TMP_DIR, `reel-${key}-${Date.now()}`);

    await concatVideos(
      videos.map((v) => videoFilePath(v, { proxy: isWebPlayable(v) && !!v.proxyPath })),
      outAbs,
      workDir,
    );

    setProgress({ progress: 90, step: '读取时长' });
    const info = await probe(outAbs);
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
    return {
      weekKey: key,
      filename: outName,
      relPath: path.join('reels', outName),
      durationSec: Math.round(info?.durationSec || 0),
      sources: videos.length,
    };
  });
}

function startOfWeek(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key));
  if (!m) return todayStr();
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - jan4Day + (week - 1) * 7);
  const pad = (n) => String(n).padStart(2, '0');
  return `${firstMonday.getFullYear()}-${pad(firstMonday.getMonth() + 1)}-${pad(firstMonday.getDate())}`;
}

export function listReels() {
  try {
    return fs
      .readdirSync(REEL_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const stat = fs.statSync(path.join(REEL_DIR, f));
        return { filename: f, size: stat.size, createdAt: stat.birthtime || stat.mtime };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

export function capabilityReport(settings) {
  const media = mediaStatus();
  const asr = asrStatus(settings);
  return {
    media,
    asr,
    canThumbnail: media.ffmpeg,
    canTranscode: media.ffmpeg,
    canReel: media.ffmpeg,
    canTranscribe: asr.canTranscribe,
  };
}
