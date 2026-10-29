import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_DIR, THUMB_DIR, REEL_DIR, TMP_DIR } from './paths.js';
import {
  probe,
  makeThumbnail,
  transcodeWeb,
  transcodeArchive,
  extractAudioCompact,
  concatVideos,
  mediaStatus,
  fileSize,
} from './media.js';
import { transcribeFile, asrStatus } from './asr.js';
import { runJob } from './jobs.js';
import { chatJson } from './ai.js';
import { videoAnalysisMessages } from './prompts.js';
import * as repo from './repo.js';
import { todayStr, isoWeek, weekDates } from './time.js';
import { scoreDay } from './score.js';

const WEB_SAFE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const WEB_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.3gp', '.avi', '.mpg', '.mpeg']);

function safeExt(name = '', mime = '') {
  const fromName = path.extname(name).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(fromName) && VIDEO_EXTS.has(fromName)) return fromName;
  if (/^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('matroska')) return '.mkv';
  if (mime.includes('mpeg')) return '.mpg';
  return '.mp4';
}

export function isVideoFile(name) {
  return VIDEO_EXTS.has(path.extname(String(name || '')).toLowerCase());
}

/* ------------------------------------------------------------------ */
/* 路径                                                                */
/* ------------------------------------------------------------------ */

/**
 * 一个视频可能有三份文件：原片（可能已删）、归档视频、归档音频。
 * `files` 是新的权威字段；老数据只有 relPath，这里做兼容。
 */
function filesOf(video) {
  if (video.files) return video.files;
  // 兼容旧记录：relPath 就是原片
  return { raw: video.relPath || null, archive: null, audio: null };
}

/** 当前应该播放哪个文件 */
export function primaryRel(video) {
  const f = filesOf(video);
  if (video.proxyPath && fs.existsSync(path.join(VIDEO_DIR, video.proxyPath))) return video.proxyPath;
  if (f.archive && fs.existsSync(path.join(VIDEO_DIR, f.archive))) return f.archive;
  if (f.raw && fs.existsSync(path.join(VIDEO_DIR, f.raw))) return f.raw;
  if (video.relPath) return video.relPath;
  return null;
}

export function primaryAbs(video) {
  const rel = primaryRel(video);
  return rel ? path.join(VIDEO_DIR, rel) : null;
}

export function videoFilePath(video) {
  return primaryAbs(video) || path.join(VIDEO_DIR, video.relPath || '');
}

export function audioAbs(video) {
  const f = filesOf(video);
  if (!f.audio) return null;
  const abs = path.join(VIDEO_DIR, f.audio);
  return fs.existsSync(abs) ? abs : null;
}

function absOf(rel) {
  return rel ? path.join(VIDEO_DIR, rel) : null;
}

/** 跨盘/跨卷时 rename 会报 EXDEV，退回「复制再删」 */
function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    if (err && (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EACCES')) {
      fs.copyFileSync(from, to);
      try {
        fs.unlinkSync(from);
      } catch {
        /* 原文件删不掉也无所谓 */
      }
      return;
    }
    throw err;
  }
}

/** 用新文件替换旧文件（Windows 上 rename 覆盖会失败，先挪开再删，失败还能退回去） */
function replaceFile(nextAbs, targetAbs) {
  if (!fs.existsSync(targetAbs)) {
    fs.renameSync(nextAbs, targetAbs);
    return;
  }
  const backup = `${targetAbs}.bak`;
  try {
    fs.renameSync(targetAbs, backup);
  } catch {
    /* 挪不开就试试直接盖 */
  }
  try {
    fs.renameSync(nextAbs, targetAbs);
    fs.rmSync(backup, { force: true });
  } catch (err) {
    try {
      if (fs.existsSync(backup)) fs.renameSync(backup, targetAbs);
    } catch {
      /* 尽力而为 */
    }
    throw err;
  }
}

export function isWebPlayable(video) {
  if (video.proxyPath) return true;
  const f = filesOf(video);
  if (f.archive) return true; // 归档版永远是我们自己压的 h264
  const v = video.video;
  if (!v) return true;
  const vcodec = String(v.codec || '').toLowerCase();
  const acodec = String(video.audio?.codec || '').toLowerCase();
  return WEB_SAFE_VIDEO.has(vcodec) && (!acodec || WEB_SAFE_AUDIO.has(acodec));
}

/* ------------------------------------------------------------------ */
/* 收片                                                                */
/* ------------------------------------------------------------------ */

/**
 * 收下一个视频：先把文件落盘、拿到基本信息，立刻返回。
 * 压缩 / 抽音频 / 转写都在后台 job 里做（见 startProcessJob）。
 */
export async function ingest({ tempPath, originalName, mimetype, date, title, size, source = 'upload' }) {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayStr();
  const id = `v-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const ext = safeExt(originalName, mimetype);
  const dir = path.join(VIDEO_DIR, day);
  fs.mkdirSync(dir, { recursive: true });

  const rawName = `${id}.raw${ext}`;
  const rawAbs = path.join(dir, rawName);
  moveFile(tempPath, rawAbs);

  const info = await probe(rawAbs);
  const durationSec = Math.round(info?.durationSec || 0);

  let thumb = null;
  try {
    const thumbAbs = path.join(THUMB_DIR, `${id}.jpg`);
    const at = durationSec > 10 ? Math.min(5, durationSec * 0.15) : 0;
    const made = await makeThumbnail(rawAbs, thumbAbs, { atSec: at });
    if (made) thumb = `${id}.jpg`;
  } catch {
    /* 封面失败不影响主流程 */
  }

  const rawSize = Number(size) || fileSize(rawAbs);

  const video = {
    id,
    date: day,
    title: String(title || '').slice(0, 120) || (originalName || '').replace(/\.[^.]+$/, ''),
    originalName: originalName || rawName,
    source,
    relPath: path.join(day, rawName), // 兼容字段，归档完成后指向归档版
    files: { raw: path.join(day, rawName), archive: null, audio: null },
    proxyPath: null,
    size: rawSize,
    mime: mimetype || '',
    durationSec,
    video: info?.video || null,
    audio: info?.audio || null,
    thumb,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storage: {
      state: 'pending', // pending -> processing -> ready | failed
      mode: '',
      rawSize,
      archiveSize: 0,
      audioSize: 0,
      note: '',
      error: null,
      at: null,
    },
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

/* ------------------------------------------------------------------ */
/* 处理流水线：压缩归档 + 抽音频 + 转写 + AI 阅读                        */
/* ------------------------------------------------------------------ */

function mediaSettings(settings) {
  const m = settings?.media || {};
  return {
    archive: m.archive || 'compact',
    compactHeight: Number(m.compactHeight) || 540,
    compactCrf: Number(m.compactCrf) || 30,
    compactAudioKbps: Number(m.compactAudioKbps) || 64,
    keepOriginal: m.keepOriginal || 'off',
    keepOriginalDays: Number(m.keepOriginalDays) || 7,
    skipTranscodeBelowMb: Number(m.skipTranscodeBelowMb) ?? 120,
    keepAudio: m.keepAudio !== false,
  };
}

/**
 * 把原片处理成「能长期存」的样子。
 *
 * 默认策略（compact + 原片归档后删除）：
 *   1-2 GB 的原片 → 几十 MB 的 540p 归档版 + 几 MB 的音频 + 文字稿
 */
export function startProcessJob(videoId, settings) {
  return runJob('video-process', '处理视频', async (setProgress) => {
    const video = repo.getVideo(videoId);
    if (!video) throw new Error('找不到这个视频');
    const ms = mediaSettings(settings);
    const files = { ...filesOf(video) };
    const rawAbs = absOf(files.raw);
    const dayDir = path.join(VIDEO_DIR, video.date);
    const archiveRel = path.join(video.date, `${video.id}.mp4`);
    const archiveAbs = path.join(dayDir, `${video.id}.mp4`);
    const archivePartAbs = path.join(dayDir, `${video.id}.part.mp4`);
    const audioRel = path.join(video.date, `${video.id}.m4a`);
    const audioAbsPath = path.join(dayDir, `${video.id}.m4a`);

    const patch = {
      storage: {
        ...(video.storage || {}),
        state: 'processing',
        mode: ms.archive,
        rawSize: video.storage?.rawSize || video.size || 0,
        error: null,
        note: '',
      },
    };
    repo.updateVideo(video.id, patch);

    const stageLog = [];
    const note = (s) => {
      stageLog.push(s);
      const cur = repo.getVideo(video.id);
      if (cur) repo.updateVideo(video.id, { storage: { ...(cur.storage || {}), stages: stageLog.slice() } });
    };

    try {
      const rawExists = Boolean(rawAbs) && fs.existsSync(rawAbs);
      const archiveExists = Boolean(files.archive) && fs.existsSync(absOf(files.archive));
      if (!rawExists && !archiveExists) {
        throw new Error('原片和归档版都找不到了，这个视频可能已经被删了');
      }
      /* 重新归档时原片往往已被清理，那就拿现在能播的那份当源 */
      const sourceIsArchive = !rawExists;
      const sourceAbs = sourceIsArchive ? absOf(files.archive) : rawAbs;

      const info = await probe(sourceAbs);
      const totalSec = Number(info?.durationSec) || video.durationSec || 0;
      const sourceBytes = fileSize(sourceAbs);
      const uploadedBytes = video.storage?.rawSize || video.size || sourceBytes;

      /* --- 1. 归档音频（很小，回听 + 转写都用它） --- */
      let audioSize = 0;
      if (ms.keepAudio && info?.audio) {
        setProgress({ progress: 8, step: '抽出归档音频' });
        try {
          const a = await extractAudioCompact(sourceAbs, audioAbsPath, { kbps: 48 });
          files.audio = audioRel;
          audioSize = a.size;
          note('audio-ok');
        } catch (err) {
          note(`audio-fail:${String(err.message).slice(0, 80)}`);
        }
      }

      /* --- 2. 归档视频 --- */
      let archiveSize = 0;
      const height = ms.archive === 'high' ? 720 : ms.compactHeight;
      const playable = WEB_SAFE_VIDEO.has(String(video.video?.codec || '').toLowerCase());
      const alreadyTiny = sourceBytes <= ms.skipTranscodeBelowMb * 1024 * 1024;
      const currentHeight = Number(video.video?.height) || 0;
      const transcodeOpts = {
        height,
        crf: ms.compactCrf,
        audioKbps: ms.compactAudioKbps,
        totalSec,
        onProgress: (p) => setProgress({ progress: 15 + Math.round(p * 0.6), step: `压缩到 ${height}p…` }),
      };

      if (ms.archive === 'audio') {
        /* 只留音频：不压视频，后面直接删原片 */
        note('mode-audio');
      } else if (ms.archive === 'original') {
        /* 保留原片：原片能播就直接用；不能播才转一份能播的 */
        if (!sourceIsArchive) files.archive = files.raw;
        archiveSize = sourceBytes;
        note('mode-original');
      } else if (sourceIsArchive) {
        /* 已经是归档版了：分辨率够用就不再压一遍，否则重新压并替换 */
        if (currentHeight && currentHeight <= height && playable) {
          archiveSize = sourceBytes;
          note('already-archived');
        } else {
          setProgress({
            progress: 15,
            step: `重新压到 ${height}p（现在 ${(sourceBytes / 1048576).toFixed(0)} MB）`,
          });
          const r = await transcodeArchive(sourceAbs, archivePartAbs, transcodeOpts);
          replaceFile(archivePartAbs, archiveAbs);
          files.archive = archiveRel;
          archiveSize = r.size;
          note('recompress-ok');
        }
      } else if (alreadyTiny && playable && height >= 540) {
        /* 本来就小又能播，直接把原片改名当归档版，省一遍 CPU */
        setProgress({ progress: 45, step: '原片已经够小，直接归档' });
        try {
          fs.renameSync(rawAbs, archiveAbs);
          files.archive = archiveRel;
          files.raw = null;
          archiveSize = fileSize(archiveAbs);
          note('skip-transcode');
        } catch {
          files.archive = files.raw;
          archiveSize = sourceBytes;
        }
      } else {
        setProgress({
          progress: 15,
          step: `压缩到 ${height}p（原片 ${(sourceBytes / 1048576).toFixed(0)} MB）`,
        });
        const r = await transcodeArchive(rawAbs, archiveAbs, transcodeOpts);
        files.archive = archiveRel;
        archiveSize = r.size;
        note('transcode-ok');
      }

      /* --- 3. 按策略处理原片 --- */
      const keepOriginal =
        ms.keepOriginal === 'always' || (ms.keepOriginal === 'days' && ms.keepOriginalDays > 0);
      const archiveIsRaw = Boolean(files.archive && files.raw && files.archive === files.raw);

      if (files.raw && !archiveIsRaw && fs.existsSync(rawAbs)) {
        if (keepOriginal) {
          note(`raw-kept:${ms.keepOriginalDays}d`);
        } else if (files.archive || ms.archive === 'audio' || ms.archive === 'original') {
          setProgress({ progress: 80, step: '清理原片释放空间' });
          try {
            fs.unlinkSync(rawAbs);
            files.raw = null;
            note('raw-deleted');
          } catch {
            note('raw-delete-fail');
          }
        } else {
          note('raw-kept:no-archive');
        }
      }

      /* 只留音频模式下，旧归档视频也一并清掉（音频已抽出或已有文字稿才动手） */
      if (
        ms.archive === 'audio' &&
        files.archive &&
        !archiveIsRaw &&
        fs.existsSync(absOf(files.archive))
      ) {
        const safeToDrop = audioSize > 0 || Boolean(repo.getVideo(video.id)?.transcript?.text);
        if (safeToDrop) {
          try {
            fs.unlinkSync(absOf(files.archive));
            files.archive = null;
            note('archive-dropped-audio-mode');
          } catch {
            note('archive-drop-fail');
          }
        } else {
          note('archive-kept-no-audio');
        }
      }

      /* --- 4. 更新记录 --- */
      const playableRel =
        files.archive || files.raw || (ms.archive === 'audio' ? null : video.relPath);
      repo.updateVideo(video.id, {
        files,
        relPath: playableRel,
        size: archiveSize || uploadedBytes,
        video: info?.video || video.video,
        audio: info?.audio || video.audio,
        durationSec: Math.round(totalSec),
        storage: {
          state: 'ready',
          mode: ms.archive,
          rawSize: uploadedBytes,
          archiveSize,
          audioSize,
          keptOriginal: keepOriginal && !archiveIsRaw,
          stages: stageLog,
          note: describeMode(ms),
          error: null,
          at: new Date().toISOString(),
        },
      });
      setProgress({ progress: 88, step: '归档完成' });

      /* --- 5. 自动转写 → 自动 AI 阅读 --- */
      let transcribeStarted = false;
      if (settings?.asr?.autoTranscribe !== false) {
        const st = asrStatus(settings);
        if (st.canTranscribe) {
          setProgress({ progress: 92, step: '转录文字稿…' });
          transcribeStarted = true;
          await runTranscribeInline(video.id, settings, (p, s) =>
            setProgress({ progress: 92 + Math.round(p * 0.05), step: s }),
          );
        }
      }

      let analyzed = false;
      if (settings?.ai?.enabled && settings?.ai?.apiKey && settings?.ai?.sendTranscripts !== false) {
        const latest = repo.getVideo(video.id);
        if (latest?.transcript?.text?.trim()) {
          setProgress({ progress: 97, step: '让 AI 读一遍你的总结…' });
          try {
            await runAnalyzeInline(video.id, settings, () => {});
            analyzed = true;
          } catch (err) {
            repo.updateVideo(video.id, { analysisError: err.message || String(err) });
          }
        }
      }

      return {
        id: video.id,
        storage: repo.getVideo(video.id)?.storage,
        transcribeStarted,
        analyzed,
      };
    } catch (err) {
      const cur = repo.getVideo(video.id);
      const stillPlayable = Boolean(cur?.files?.archive || cur?.files?.raw);
      repo.updateVideo(video.id, {
        storage: {
          ...(cur?.storage || {}),
          /* 归档重做失败但原来的文件还能播，就别把整条记录标成失败 */
          state: stillPlayable ? 'ready' : 'failed',
          error: err.message || String(err),
          stages: stageLog,
          at: new Date().toISOString(),
        },
      });
      throw err;
    }
  });
}

function describeMode(ms) {
  if (ms.archive === 'audio') return '只保留音频 + 文字稿，不存视频';
  if (ms.archive === 'original') return '保留原片';
  if (ms.archive === 'high') return '归档为 720p';
  return `归档为 ${ms.compactHeight}p`;
}

/** 转写（不单独开 job，供流水线内部调用） */
async function runTranscribeInline(videoId, settings, setProgress) {
  const video = repo.getVideo(videoId);
  const src = primaryAbs(video);
  if (!src) throw new Error('找不到可转写的文件');
  // 优先用归档音频，转写更快更省
  const audio = audioAbs(video);
  repo.updateVideo(videoId, {
    transcript: { ...(video.transcript || {}), status: 'running', error: null },
  });
  try {
    const result = await transcribeFile(audio || src, settings, {
      onProgress: (ratio, label) => setProgress(Math.round(5 + ratio * 90), label || '转写中'),
    });
    setProgress(95, '保存文字稿');
    repo.updateVideo(videoId, {
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
    return result;
  } catch (err) {
    repo.updateVideo(videoId, {
      transcript: {
        ...(repo.getVideo(videoId)?.transcript || {}),
        status: 'failed',
        error: err.message,
        at: new Date().toISOString(),
      },
    });
    throw err;
  }
}

/** AI 分析（不单独开 job） */
async function runAnalyzeInline(videoId, settings, setProgress) {
  const latest = repo.getVideo(videoId);
  const transcript = latest.transcript?.text || '';
  if (!transcript.trim()) throw new Error('这个视频还没有文字稿');
  if (!settings.ai?.enabled || !settings.ai?.apiKey) throw new Error('还没有配置大模型 API Key');

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

  setProgress(50, '让模型对照分析…');
  const { data, model } = await chatJson(
    settings,
    videoAnalysisMessages({ date: latest.date, items, score, transcript }),
    { maxTokens: 3000 },
  );

  const analysis = normalizeAnalysis(data, items);
  repo.updateVideo(videoId, {
    analysis,
    analysisError: null,
    analysisModel: model,
    analysisAt: new Date().toISOString(),
  });
  return analysis;
}

/* ------------------------------------------------------------------ */
/* 手动触发的 job                                                       */
/* ------------------------------------------------------------------ */

/** 转写（本地或云端） */
export function startTranscribeJob(video, settings) {
  return runJob('video-transcribe', `转写 ${video.date}`, async (setProgress) => {
    setProgress({ progress: 10, step: '提取音频并识别…' });
    const result = await runTranscribeInline(video.id, settings, (p, s) =>
      setProgress({ progress: 10 + Math.round(p * 0.85), step: s }),
    );
    return { id: video.id, text: result.text, provider: result.provider };
  });
}

/** AI 分析今日总结视频 */
export function startAnalyzeJob(video, settings) {
  return runJob('video-analyze', `分析 ${video.date}`, async (setProgress) => {
    setProgress({ progress: 20, step: '整理当天打卡记录' });
    const analysis = await runAnalyzeInline(video.id, settings, setProgress);
    setProgress({ progress: 95, step: '保存分析结果' });
    return { id: video.id, analysis };
  });
}

/** 重新归档一个视频（改了策略后手动补跑） */
export function startReprocessJob(video, settings) {
  return startProcessJob(video.id, settings);
}

/** 生成浏览器能播的版本（mode=original 且原片播不了时用） */
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
  const strArr = (v, n, max = 300) =>
    Array.isArray(v) ? v.map((s) => String(s).slice(0, max)).filter(Boolean).slice(0, n) : [];

  return {
    /* 深度阅读：把他的话完整读进去之后的理解 */
    reading: String(data.reading || '').slice(0, 1600),
    summary: String(data.summary || '').slice(0, 600),
    /* AI 给你的话 */
    encouragement: String(data.encouragement || '').slice(0, 800),
    oneLiner: String(data.oneLiner || '').slice(0, 80),
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
    gaps: strArr(data.gaps, 6),
    mood: data.mood
      ? { label: String(data.mood.label || '').slice(0, 20), evidence: String(data.mood.evidence || '').slice(0, 300) }
      : null,
    /* 学习方法上的观察 + 明天能做的 */
    methodFeedback: strArr(data.methodFeedback, 4),
    insights: strArr(data.insights, 15),
    tomorrowTips: strArr(data.tomorrowTips, 5),
    advice: strArr(data.advice, 5),
    suggestedChecks: checks,
  };
}

/* ------------------------------------------------------------------ */
/* 存储统计与清理                                                       */
/* ------------------------------------------------------------------ */

export function storageReport() {
  const videos = repo.listVideos();
  const byKind = { raw: 0, archive: 0, audio: 0, thumb: 0, reel: 0, other: 0 };
  const rows = [];
  const referenced = new Set();

  for (const v of videos) {
    const f = filesOf(v);
    const rawSize = f.raw && fs.existsSync(absOf(f.raw)) ? fileSize(absOf(f.raw)) : 0;
    const archiveSize = f.archive && f.archive !== f.raw && fs.existsSync(absOf(f.archive)) ? fileSize(absOf(f.archive)) : 0;
    const audioSize = f.audio && fs.existsSync(absOf(f.audio)) ? fileSize(absOf(f.audio)) : 0;
    const thumbSize = v.thumb && fs.existsSync(path.join(THUMB_DIR, v.thumb)) ? fileSize(path.join(THUMB_DIR, v.thumb)) : 0;
    const proxySize = v.proxyPath && fs.existsSync(absOf(v.proxyPath)) ? fileSize(absOf(v.proxyPath)) : 0;

    for (const rel of [f.raw, f.archive, f.audio, v.proxyPath, v.relPath]) if (rel) referenced.add(rel);
    if (v.thumb) referenced.add(`thumb:${v.thumb}`);

    byKind.raw += rawSize;
    byKind.archive += archiveSize + proxySize;
    byKind.audio += audioSize;
    byKind.thumb += thumbSize;

    rows.push({
      id: v.id,
      date: v.date,
      title: v.title || '',
      durationSec: v.durationSec || 0,
      state: v.storage?.state || 'ready',
      mode: v.storage?.mode || '',
      rawSize,
      archiveSize: archiveSize + proxySize,
      audioSize,
      thumbSize,
      totalSize: rawSize + archiveSize + audioSize + thumbSize + proxySize,
      hasAudio: !!audioSize,
      transcript: v.transcript?.status || 'none',
      analyzed: !!v.analysis,
      error: v.storage?.error || null,
    });
  }

  /* 磁盘上没被记录的孤儿文件 */
  let orphanBytes = 0;
  const orphans = [];
  scanVideoDir((rel, size) => {
    if (referenced.has(rel)) return;
    if (rel.startsWith('reels')) return;
    orphanBytes += size;
    orphans.push({ rel, size });
  });
  byKind.other += orphanBytes;

  let reels = 0;
  try {
    for (const f of fs.readdirSync(REEL_DIR)) {
      const s = fileSize(path.join(REEL_DIR, f));
      reels += s;
    }
  } catch {
    /* 忽略 */
  }
  byKind.reel = reels;

  const total = Object.values(byKind).reduce((a, b) => a + b, 0);

  /* 归档到底省了多少：原片大小（入库时记下的）减去现在实际留下的归档重量 */
  let originalBytes = 0;
  let keptBytes = 0;
  for (const r of rows) {
    const v = videos.find((x) => x.id === r.id);
    const rawAtIngest = Number(v?.storage?.rawSize) || r.rawSize;
    originalBytes += rawAtIngest;
    keptBytes += r.archiveSize + r.audioSize + r.thumbSize;
  }
  const savedBytes = Math.max(0, originalBytes - keptBytes);
  const savedRatio = originalBytes > 0 ? savedBytes / originalBytes : 0;

  let disk = null;
  try {
    const st = fs.statfsSync(VIDEO_DIR);
    disk = {
      freeBytes: Number(st.bavail) * Number(st.bsize),
      totalBytes: Number(st.blocks) * Number(st.bsize),
    };
  } catch {
    /* Windows 上个别版本不支持，忽略 */
  }

  return {
    totalBytes: total,
    byKind,
    disk,
    counts: {
      videos: videos.length,
      withRaw: rows.filter((r) => r.rawSize > 0).length,
      pending: rows.filter((r) => r.state === 'pending' || r.state === 'processing').length,
      failed: rows.filter((r) => r.state === 'failed').length,
      orphans: orphans.length,
    },
    /* 省下了多少：原片大小 vs 现在留在盘上的归档重量 */
    originalBytes,
    keptBytes,
    savedBytes,
    savedRatio,
    videos: rows.sort((a, b) => (a.date < b.date ? 1 : -1)),
    orphans: orphans.sort((a, b) => b.size - a.size).slice(0, 50),
    settings: repo.getSettings()?.media || {},
  };
}

function scanVideoDir(cb, base = VIDEO_DIR, prefix = '') {
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = prefix ? path.join(prefix, e.name) : e.name;
    const abs = path.join(base, e.name);
    if (e.isDirectory()) {
      if (e.name === 'thumbs' || e.name === '.imported') continue;
      scanVideoDir(cb, abs, rel);
    } else {
      cb(rel.replace(/\\/g, path.sep), fileSize(abs));
    }
  }
}

/**
 * 清理存储。what:
 *   raw    删除所有原片（归档版和文字稿都还在）
 *   audio  删除所有归档音频
 *   orphans 删除没被任何记录引用的孤儿文件
 *   failed 把处理失败的记录及其文件一起清掉
 */
export function cleanupStorage({ what = 'raw' } = {}) {
  const result = { removed: 0, freedBytes: 0, details: [] };
  const bump = (size, label) => {
    result.removed += 1;
    result.freedBytes += size;
    if (result.details.length < 30) result.details.push(label);
  };
  const rm = (abs, label) => {
    if (!abs || !fs.existsSync(abs)) return;
    const size = fileSize(abs);
    try {
      fs.unlinkSync(abs);
      bump(size, label);
    } catch {
      /* 忽略 */
    }
  };

  if (what === 'raw') {
    for (const v of repo.listVideos()) {
      const f = filesOf(v);
      if (!f.raw) continue;
      if (f.archive === f.raw) continue; // 原片就是归档版，不能删
      const abs = absOf(f.raw);
      if (!abs || !fs.existsSync(abs)) continue;
      rm(abs, `${v.date}/${path.basename(f.raw)}`);
      repo.updateVideo(v.id, {
        files: { ...f, raw: null },
        storage: { ...(v.storage || {}), rawSize: 0, note: '原片已清理' },
      });
    }
  } else if (what === 'audio') {
    for (const v of repo.listVideos()) {
      const f = filesOf(v);
      if (!f.audio) continue;
      rm(absOf(f.audio), `${v.date}/${path.basename(f.audio)}`);
      repo.updateVideo(v.id, {
        files: { ...f, audio: null },
        storage: { ...(v.storage || {}), audioSize: 0 },
      });
    }
  } else if (what === 'orphans') {
    const referenced = new Set();
    for (const v of repo.listVideos()) {
      const f = filesOf(v);
      for (const rel of [f.raw, f.archive, f.audio, v.proxyPath, v.relPath]) if (rel) referenced.add(rel);
    }
    scanVideoDir((rel, size) => {
      if (referenced.has(rel)) return;
      if (rel.split(path.sep)[0] === 'reels') return;
      const abs = path.join(VIDEO_DIR, rel);
      try {
        fs.unlinkSync(abs);
        bump(size, rel);
      } catch {
        /* 忽略 */
      }
    });
  } else if (what === 'failed') {
    for (const v of repo.listVideos()) {
      if (v.storage?.state !== 'failed') continue;
      deleteVideoFiles(v);
      repo.deleteVideo(v.id);
      result.removed += 1;
    }
  } else {
    throw new Error(`不认识的清理类型：${what}`);
  }

  return result;
}

/** 删掉一个视频的所有文件 */
export function deleteVideoFiles(video) {
  const f = filesOf(video);
  const targets = [f.raw, f.archive, f.audio, video.proxyPath, video.relPath]
    .filter(Boolean)
    .map((rel) => absOf(rel));
  /* 转码中间产物 */
  if (f.archive) targets.push(`${absOf(f.archive)}.part.mp4`, `${absOf(f.archive)}.bak`);
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

/** 只删这一个视频的原片，保留归档版 */
export function deleteRawOnly(video) {
  const f = filesOf(video);
  if (!f.raw || f.raw === f.archive) return { removed: false, freedBytes: 0 };
  const abs = absOf(f.raw);
  if (!abs || !fs.existsSync(abs)) return { removed: false, freedBytes: 0 };
  const size = fileSize(abs);
  try {
    fs.unlinkSync(abs);
  } catch (err) {
    return { removed: false, freedBytes: 0, error: err.message };
  }
  repo.updateVideo(video.id, {
    files: { ...f, raw: null },
    storage: { ...(video.storage || {}), rawSize: 0, note: '原片已清理' },
  });
  return { removed: true, freedBytes: size };
}

/**
 * keepOriginal='days' 的时候，把超过保留期的原片清掉。
 * 只在「归档版确实还在」时才删，绝不会把唯一的能播文件删掉。
 */
export function sweepExpiredRaw(settings) {
  const ms = mediaSettings(settings);
  if (ms.keepOriginal !== 'days') return { removed: 0, freedBytes: 0, checked: 0 };
  const days = Math.max(1, ms.keepOriginalDays);
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  let freedBytes = 0;
  let checked = 0;

  for (const video of repo.listVideos()) {
    const f = filesOf(video);
    if (!f.raw || f.raw === f.archive) continue;
    if (!video.storage?.keptOriginal) continue;
    const createdAt = Date.parse(video.createdAt || '') || 0;
    if (createdAt && createdAt > cutoff) continue;
    // 归档版不在了就别删原片
    if (!f.archive || !fs.existsSync(absOf(f.archive))) continue;
    checked += 1;
    const r = deleteRawOnly(video);
    if (r.removed) {
      removed += 1;
      freedBytes += r.freedBytes || 0;
    }
  }

  if (removed) console.log(`[storage] 清理了 ${removed} 个过期原片，释放 ${Math.round(freedBytes / 1024 / 1024)}MB`);
  return { removed, freedBytes, checked };
}

/* ------------------------------------------------------------------ */
/* 周回顾视频                                                          */
/* ------------------------------------------------------------------ */

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

    await concatVideos(videos.map((v) => videoFilePath(v)), outAbs, workDir);

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
    canArchive: media.ffmpeg,
    canReel: media.ffmpeg,
    canTranscribe: asr.canTranscribe,
  };
}

/** 给列表用的瘦身信息 */
export function storageBrief(video) {
  const f = filesOf(video);
  const rawSize = f.raw && fs.existsSync(absOf(f.raw)) ? fileSize(absOf(f.raw)) : 0;
  const archiveSize =
    f.archive && f.archive !== f.raw && fs.existsSync(absOf(f.archive)) ? fileSize(absOf(f.archive)) : 0;
  const audioSize = f.audio && fs.existsSync(absOf(f.audio)) ? fileSize(absOf(f.audio)) : 0;
  /* 原片删掉之后 rawSize 就是 0 了，所以另外留一个「当初上传多大」的数字给界面用 */
  const originalSize = video.storage?.rawSize || rawSize || video.size || 0;
  return {
    state: video.storage?.state || 'ready',
    mode: video.storage?.mode || '',
    rawSize,
    originalSize,
    archiveSize,
    audioSize,
    hasRaw: rawSize > 0,
    hasAudio: audioSize > 0,
    error: video.storage?.error || null,
    note: video.storage?.note || '',
  };
}
