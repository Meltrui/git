import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

let recognizerPromise = null;
let recognizerKey = '';

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

async function getRecognizer() {
  const key = `${MODEL_FILE}|${TOKENS_FILE}`;
  if (recognizerPromise && recognizerKey === key) return recognizerPromise;

  recognizerKey = key;
  recognizerPromise = (async () => {
    const mod = await import('sherpa-onnx-node');
    const sherpa = mod.default || mod;
    const numThreads = Math.max(1, Math.min(4, (os_cpus() || 4) - 1));

    const recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: MODEL_FILE,
          language: 'auto',
          useInverseTextNormalization: 1,
        },
        tokens: TOKENS_FILE,
        numThreads,
        provider: 'cpu',
        debug: 0,
      },
    });
    return { sherpa, recognizer };
  })();

  try {
    return await recognizerPromise;
  } catch (err) {
    recognizerPromise = null;
    recognizerKey = '';
    throw new Error(
      `加载本地识别模型失败：${err.message}。可以运行 npm run fetch:asr 重新下载模型，或在设置里改用云端转写。`,
    );
  }
}

function os_cpus() {
  try {
    return os.cpus().length;
  } catch {
    return 4;
  }
}

async function transcribeLocal(filePath, settings) {
  if (!localModelReady()) {
    throw new Error('本地识别模型还没下载（设置页有下载按钮，或在命令行跑 npm run fetch:asr）');
  }
  if (!ffmpegPath()) throw new Error('缺少 ffmpeg，无法从视频里提取音频');

  const { recognizer, sherpa } = await getRecognizer();
  const wavPath = path.join(path.dirname(filePath), `.asr-${Date.now()}.wav`);
  try {
    await extractAudioWav(filePath, wavPath);
    const wave = sherpa.readWave(wavPath);
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    const text = cleanTranscript(result.text || '');
    return {
      text,
      segments: result.tokens ? [{ tokens: result.tokens, timestamps: result.timestamps }] : [],
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
 * @returns {Promise<{text:string, provider:string, language:string, durationSec:number}>}
 */
export async function transcribeFile(filePath, settings) {
  const cfg = settings?.asr || {};
  if (cfg.provider === 'none') throw new Error('当前设置为不转写');

  const info = await probe(filePath);
  const durationSec = info?.durationSec || 0;

  const out =
    cfg.provider === 'local'
      ? await transcribeLocal(filePath, settings)
      : await transcribeCloud(filePath, settings);

  return { ...out, durationSec };
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
