import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { ASR_DIR } from './paths.js';
import { extractAudioWav, ffmpegPath, probe } from './media.js';

/**
 * 语音转写。
 *
 * 三条腿：
 *  1. local      —— sherpa-onnx + SenseVoice 模型，完全离线免费（首次要下 240MB 模型）
 *  2. siliconflow / openai 等 OpenAI 兼容的 /audio/transcriptions 接口，需要 Key
 *  3. none       —— 不做转写，用户可以手动粘贴文字稿
 *
 * 任何一条腿失败都不影响打卡和计划，只会让「AI 分析视频」暂时不可用。
 */

const MODEL_DIR = path.join(ASR_DIR, 'model', 'sense-voice');
const MODEL_FILE = path.join(MODEL_DIR, 'model.int8.onnx');
const TOKENS_FILE = path.join(MODEL_DIR, 'tokens.txt');

export function localModelReady() {
  try {
    return (
      fs.existsSync(MODEL_FILE) &&
      fs.statSync(MODEL_FILE).size > 10 * 1024 * 1024 &&
      fs.existsSync(TOKENS_FILE)
    );
  } catch {
    return false;
  }
}

function modelSizeMb() {
  try {
    return Math.round(fs.statSync(MODEL_FILE).size / 1024 / 1024);
  } catch {
    return 0;
  }
}

/** 给设置页展示的能力状态 */
export function asrStatus(settings) {
  const cfg = settings?.asr || {};
  return {
    provider: cfg.provider || 'local',
    language: cfg.language || 'zh',
    localReady: localModelReady(),
    localModelDir: MODEL_DIR,
    localModelSizeMb: modelSizeMb(),
    ffmpeg: !!ffmpegPath(),
    cloudConfigured: !!(cfg.apiKey && cfg.baseUrl),
    canTranscribe:
      (cfg.provider === 'local' && localModelReady() && !!ffmpegPath()) ||
      (cfg.provider !== 'local' && cfg.provider !== 'none' && !!cfg.apiKey && !!cfg.baseUrl && !!ffmpegPath()),
  };
}

/* ------------------------------------------------------------------ */
/* 本地：sherpa-onnx                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 本地：sherpa-onnx（跑在 worker 线程里）                              */
/* ------------------------------------------------------------------ */

/**
 * 注意：sherpa 的 decode 是同步阻塞的。一段 30 分钟录音会卡住主线程几分钟，
 * 那期间网页完全点不动。所以模型和推理都放在 worker 里跑。
 */
const WORKER_URL = new URL('./asr-worker.mjs', import.meta.url);
const DECODE_TIMEOUT_MS = 45 * 60 * 1000;
const IDLE_TERMINATE_MS = 10 * 60 * 1000;

let worker = null;
let workerLoad = null;
let idleTimer = null;
let seq = 0;
const pending = new Map();

function failPending(err) {
  for (const job of pending.values()) job.reject(err);
  pending.clear();
}

function resetWorker() {
  const w = worker;
  worker = null;
  workerLoad = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (w) {
    try {
      w.terminate();
    } catch {
      /* 已经没了 */
    }
  }
}

function scheduleIdleExit() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => resetWorker(), IDLE_TERMINATE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

function spawnWorker() {
  const w = new Worker(WORKER_URL);
  w.on('message', (msg) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (msg.ok) job.resolve(msg);
    else job.reject(new Error(msg.error || '转写失败'));
  });
  w.on('error', (err) => {
    failPending(err instanceof Error ? err : new Error(String(err)));
    resetWorker();
  });
  w.on('exit', (code) => {
    if (worker === w) {
      worker = null;
      workerLoad = null;
    }
    if (code !== 0) failPending(new Error(`转写线程异常退出（code ${code}）`));
  });
  return w;
}

function call(type, extra = {}, timeoutMs = DECODE_TIMEOUT_MS) {
  if (!worker) throw new Error('转写线程没起来');
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('转写超时：超过 45 分钟还没出结果'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    worker.postMessage({ id, type, ...extra });
  });
}

function workerThreads() {
  try {
    return Math.max(1, Math.min(4, os.cpus().length - 1));
  } catch {
    return 2;
  }
}

function ensureWorker() {
  if (workerLoad) return workerLoad;
  workerLoad = (async () => {
    if (!worker) worker = spawnWorker();
    await call(
      'load',
      { modelFile: MODEL_FILE, tokensFile: TOKENS_FILE, numThreads: workerThreads() },
      180000,
    );
    return worker;
  })().catch((err) => {
    resetWorker();
    throw new Error(
      `加载本地识别模型失败：${err.message}。可以运行 npm run fetch:asr 重新下载模型，或在设置里改用云端转写。`,
    );
  });
  return workerLoad;
}

async function transcribeLocal(filePath, settings, opts = {}) {
  if (!localModelReady()) {
    throw new Error('本地识别模型还没下载（设置页有下载按钮，或在命令行跑 npm run fetch:asr）');
  }
  if (!ffmpegPath()) throw new Error('缺少 ffmpeg，无法从视频里提取音频');

  await ensureWorker();

  const wavPath = path.join(
    path.dirname(filePath),
    `.asr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`,
  );
  try {
    opts.onProgress?.(0.12, '提取音频');
    await extractAudioWav(filePath, wavPath);
    opts.onProgress?.(0.25, '识别中');

    // 解码本身没法报进度，按「音频时长 → 预估耗时」给一条爬升的进度线
    let durationSec = 0;
    try {
      const info = await probe(wavPath);
      durationSec = info?.durationSec || 0;
    } catch {
      /* 拿不到时长就按最短估 */
    }
    const estMs = Math.max(8000, durationSec * 170);
    const started = Date.now();
    const ticker = setInterval(() => {
      const ratio = Math.min(0.92, 0.25 + ((Date.now() - started) / estMs) * 0.67);
      opts.onProgress?.(ratio, '识别中');
    }, 1200);
    if (ticker.unref) ticker.unref();

    let result;
    try {
      result = await call('transcribe', { wavPath });
    } finally {
      clearInterval(ticker);
    }

    opts.onProgress?.(0.97, '整理文字稿');
    scheduleIdleExit();
    return {
      text: cleanTranscript(result.text || ''),
      segments:
        result.tokens && result.tokens.length
          ? [{ tokens: result.tokens, timestamps: result.timestamps }]
          : [],
      language: settings?.asr?.language || 'zh',
      provider: 'local:sense-voice',
    };
  } finally {
    try {
      fs.unlinkSync(wavPath);
    } catch {
      /* 忽略 */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 云端：OpenAI 兼容 /audio/transcriptions                             */
/* ------------------------------------------------------------------ */

async function transcribeCloud(filePath, settings) {
  const cfg = settings?.asr || {};
  if (!cfg.apiKey) throw new Error('没有填写语音服务的 API Key');
  if (!cfg.baseUrl) throw new Error('没有填写语音服务的接口地址');
  if (!ffmpegPath()) throw new Error('缺少 ffmpeg，无法从视频里提取音频');

  const wavPath = path.join(path.dirname(filePath), `.asr-${Date.now()}.wav`);
  try {
    await extractAudioWav(filePath, wavPath);
    const buf = fs.readFileSync(wavPath);
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', cfg.model || 'FunAudioLLM/SenseVoiceSmall');
    if (cfg.language) form.append('language', cfg.language);

    const url = `${String(cfg.baseUrl).replace(/\/+$/, '')}/audio/transcriptions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`语音服务返回 ${res.status}：${text.slice(0, 300)}`);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { text: cleanTranscript(text), segments: [], provider: cfg.provider, language: cfg.language };
    }
    const content = parsed.text || parsed.output?.text || parsed.result?.text || '';
    return {
      text: cleanTranscript(content),
      segments: parsed.segments || [],
      provider: cfg.provider,
      language: parsed.language || cfg.language,
    };
  } finally {
    try {
      fs.unlinkSync(wavPath);
    } catch {
      /* 忽略 */
    }
  }
}

function cleanTranscript(raw) {
  let text = String(raw || '').trim();
  // SenseVoice 会在开头塞 <|zh|><|NEUTRAL|> 之类的标签
  text = text.replace(/<\|[^|]*\|>/g, '').trim();
  text = text.replace(/\[[A-Z_]+\]/g, '').trim();
  return text;
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {string} filePath 视频或音频文件
 * @param {object} settings
 * @param {{onProgress?:(ratio:number,label:string)=>void}} [opts]
 * @returns {Promise<{text:string, provider:string, language:string, durationSec:number}>}
 */
export async function transcribeFile(filePath, settings, opts = {}) {
  const cfg = settings?.asr || {};
  if (cfg.provider === 'none') throw new Error('当前设置为不转写');

  const info = await probe(filePath);
  const durationSec = info?.durationSec || 0;

  const out =
    cfg.provider === 'local'
      ? await transcribeLocal(filePath, settings, opts)
      : await transcribeCloud(filePath, settings);

  return { ...out, durationSec };
}

/** 退出前把 worker 收掉，避免留下孤儿线程 */
export function disposeAsr() {
  resetWorker();
  failPending(new Error('转写已取消'));
}

/** 支持的云端语音服务预设 */
export const ASR_PRESETS = {
  siliconflow: {
    label: '硅基流动 SenseVoice',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    note: '便宜、国内直连，中文识别很准',
  },
  openai: {
    label: 'OpenAI Whisper',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    note: '需要能访问 openai.com 的网络',
  },
  dashscope: {
    label: '阿里通义（兼容模式）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'paraformer-v2',
    note: '需确认该接口是否支持 /audio/transcriptions',
  },
};
