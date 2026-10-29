/**
 * 本地语音识别跑在 worker 线程里。
 *
 * 为什么必须单独开线程：sherpa-onnx 的 decode 是**同步阻塞**的，一段 30 分钟的
 * 录音会卡住主线程好几分钟——那期间整个网页都点不动，连页面都刷不出来。
 * 放到 worker 里，主线程照常响应请求，进度条也能一直动。
 */
import { parentPort } from 'node:worker_threads';

let recognizer = null;
let sherpaMod = null;

function reply(id, payload) {
  parentPort.postMessage({ id, ...payload });
}

async function load(msg) {
  if (recognizer) return { ok: true, reused: true };
  const mod = await import('sherpa-onnx-node');
  sherpaMod = mod.default || mod;
  recognizer = new sherpaMod.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: msg.modelFile,
        language: 'auto',
        useInverseTextNormalization: 1,
      },
      tokens: msg.tokensFile,
      numThreads: msg.numThreads || 2,
      provider: 'cpu',
      debug: 0,
    },
  });
  return { ok: true, reused: false };
}

function transcribe(msg) {
  if (!recognizer) throw new Error('识别模型还没加载');
  const wave = sherpaMod.readWave(msg.wavPath);
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  return {
    ok: true,
    text: result.text || '',
    tokens: result.tokens || [],
    timestamps: result.timestamps || [],
    durationSec: wave.samples.length / (wave.sampleRate || 16000),
  };
}

parentPort.on('message', async (msg) => {
  const { id, type } = msg;
  try {
    if (type === 'load') reply(id, await load(msg));
    else if (type === 'transcribe') reply(id, transcribe(msg));
    else if (type === 'ping') reply(id, { ok: true, ready: !!recognizer });
    else reply(id, { ok: false, error: `未知指令 ${type}` });
  } catch (err) {
    reply(id, { ok: false, error: err?.message || String(err) });
  }
});
