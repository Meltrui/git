#!/usr/bin/env node
/**
 * 下载本地语音识别模型（SenseVoice-Small，中英日韩粤，int8）。
 *
 *   node scripts/fetch-asr-model.mjs
 *
 * 模型存到 .asr/model/sense-voice/，约 240MB，只需要下载一次。
 * 采用「分块 Range 下载 + 断点续传」，网络抖一下不会白下。
 *
 * 换镜像：
 *   $env:HF_ENDPOINT="https://hf-mirror.com"; npm run fetch:asr
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/src/paths.js';

const REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const OUT = path.join(ROOT, '.asr', 'model', 'sense-voice');
const CHUNK = 4 * 1024 * 1024;
const RETRIES = 6;

const MIRRORS = [...new Set([process.env.HF_ENDPOINT, 'https://huggingface.co', 'https://hf-mirror.com'].filter(Boolean))];

function human(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fileUrl(base, file) {
  return `${base}/${REPO}/resolve/main/${file}`;
}

async function probeSize(url) {
  // 用 Range: 0-0 探大小。HEAD 有时候不返回 content-length。
  const res = await fetch(url, { headers: { range: 'bytes=0-0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const range = res.headers.get('content-range');
  const fromRange = range && /\/(\d+)$/.exec(range)?.[1];
  if (fromRange) return Number(fromRange);
  const len = Number(res.headers.get('content-length'));
  if (len > 1) return len;
  throw new Error('拿不到文件大小');
}

async function pickMirror(file) {
  const errors = [];
  for (const base of MIRRORS) {
    try {
      const size = await probeSize(fileUrl(base, file));
      if (size > 0) return { base, size };
      errors.push(`${base}: 大小为 0`);
    } catch (err) {
      errors.push(`${base}: ${err.message}`);
    }
  }
  throw new Error(`所有下载源都连不上（${errors.join('；')}），请检查网络，或设置 HF_ENDPOINT 指向可用镜像`);
}

/** 分块下载，可断点续传 */
async function downloadFile(file) {
  const dest = path.join(OUT, file);
  const part = `${dest}.part`;
  const { base, size } = await pickMirror(file);
  console.log(`  ${file}  大小 ${human(size)}  源 ${base}`);

  let have = 0;
  if (fs.existsSync(part)) {
    have = fs.statSync(part).size;
    if (have > size) {
      fs.rmSync(part);
      have = 0;
    }
  }
  if (fs.existsSync(dest) && fs.statSync(dest).size === size) {
    console.log(`  ${file} 已完整存在，跳过`);
    return;
  }

  const fd = fs.openSync(part, have > 0 ? 'r+' : 'w');
  let offset = have;
  let lastReport = 0;

  try {
    while (offset < size) {
      const end = Math.min(offset + CHUNK - 1, size - 1);
      let done = false;
      let lastErr = null;

      for (let attempt = 0; attempt < RETRIES && !done; attempt += 1) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 60000);
          const res = await fetch(fileUrl(base, file), {
            headers: { range: `bytes=${offset}-${end}` },
            signal: ctrl.signal,
            redirect: 'follow',
          });
          clearTimeout(timer);
          if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (!buf.length) throw new Error('空响应');
          fs.writeSync(fd, buf, 0, buf.length, offset);
          offset += buf.length;
          done = true;
        } catch (err) {
          lastErr = err;
          // 把「重试时已经写进去的部分」算清楚，避免跳块
          const nowSize = fs.fstatSync(fd).size;
          if (nowSize > offset) offset = nowSize;
          await sleep(500 * (attempt + 1));
        }
      }

      if (!done) throw new Error(`第 ${Math.floor(offset / CHUNK)} 块下载失败：${lastErr?.message}`);

      const now = Date.now();
      if (now - lastReport > 700 || offset >= size) {
        lastReport = now;
        process.stdout.write(`\r    ${human(offset)} / ${human(size)}  ${((offset / size) * 100).toFixed(1)}%   `);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  process.stdout.write('\n');
  const finalSize = fs.statSync(part).size;
  if (finalSize !== size) throw new Error(`大小不对：得到 ${finalSize}，应为 ${size}`);
  fs.renameSync(part, dest);
  console.log(`  ${file} 完成`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`模型目录：${OUT}\n`);

  for (const file of ['tokens.txt', 'model.int8.onnx']) {
    await downloadFile(file);
  }

  console.log('\n模型就绪。现在可以在「设置 → 语音转写」里点转写了。');
}

main().catch((err) => {
  console.error(`\n下载失败：${err.message}`);
  process.exit(1);
});
