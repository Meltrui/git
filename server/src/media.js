import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

/**
 * 媒体处理：ffmpeg / ffprobe 封装。
 *
 * 注意：子进程的 stdout/stderr 一律重定向到临时文件再读回，
 *       不走管道。这样在任何受限环境里都能跑，也不会有缓冲区塞满卡死的问题。
 */

const TMP_PREFIX = 'anchor-media-';

let cachedFfmpeg = null;
let cachedFfprobe = null;

export function ffmpegPath() {
  if (cachedFfmpeg !== null) return cachedFfmpeg;
  const candidates = [
    () => ffmpegInstaller?.path,
    () => whichSync('ffmpeg'),
  ];
  for (const get of candidates) {
    try {
      const p = get();
      if (p && fs.existsSync(p)) {
        cachedFfmpeg = p;
        return p;
      }
    } catch {
      /* 忽略 */
    }
  }
  cachedFfmpeg = '';
  return '';
}

export function ffprobePath() {
  if (cachedFfprobe !== null) return cachedFfprobe;
  const candidates = [() => ffprobeInstaller?.path, () => whichSync('ffprobe')];
  for (const get of candidates) {
    try {
      const p = get();
      if (p && fs.existsSync(p)) {
        cachedFfprobe = p;
        return p;
      }
    } catch {
      /* 忽略 */
    }
  }
  cachedFfprobe = '';
  return '';
}

function whichSync(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* 忽略 */
      }
    }
  }
  return '';
}

export function mediaStatus() {
  const ff = ffmpegPath();
  const fp = ffprobePath();
  return {
    ffmpeg: !!ff,
    ffprobe: !!fp,
    ffmpegPath: ff,
    ffprobePath: fp,
  };
}

/**
 * 跑一个外部命令，把输出收进临时文件。
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
export function run(cmd, args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!cmd) return reject(new Error('可执行文件不存在'));
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const outFile = path.join(os.tmpdir(), `${TMP_PREFIX}${stamp}.out`);
    const errFile = path.join(os.tmpdir(), `${TMP_PREFIX}${stamp}.err`);
    const outFd = fs.openSync(outFile, 'w');
    const errFd = fs.openSync(errFile, 'w');

    let child;
    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      });
    } catch (err) {
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      reject(err);
      return;
    }

    const cleanup = () => {
      try {
        fs.closeSync(outFd);
      } catch {
        /* 忽略 */
      }
      try {
        fs.closeSync(errFd);
      } catch {
        /* 忽略 */
      }
    };

    const readAndRemove = (file) => {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        /* 忽略 */
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* 忽略 */
      }
      return text;
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 忽略 */
      }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      readAndRemove(outFile);
      readAndRemove(errFile);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      const stdout = readAndRemove(outFile);
      const stderr = readAndRemove(errFile);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 读取媒体信息 */
export async function probe(file) {
  const fp = ffprobePath();
  if (!fp) return null;
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ];
  const { code, stdout, stderr } = await run(fp, args, { timeoutMs: 60000 });
  if (code !== 0) {
    return { error: stderr.slice(0, 500) || `ffprobe 退出码 ${code}` };
  }
  try {
    const data = JSON.parse(stdout);
    const video = (data.streams || []).find((s) => s.codec_type === 'video');
    const audio = (data.streams || []).find((s) => s.codec_type === 'audio');
    return {
      durationSec: Number(data.format?.duration) || Number(video?.duration) || 0,
      sizeBytes: Number(data.format?.size) || 0,
      bitrate: Number(data.format?.bit_rate) || 0,
      video: video
        ? {
            codec: video.codec_name,
            width: video.width,
            height: video.height,
            fps: video.r_frame_rate,
          }
        : null,
      audio: audio ? { codec: audio.codec_name, channels: audio.channels, sampleRate: audio.sample_rate } : null,
    };
  } catch (err) {
    return { error: `解析 ffprobe 输出失败：${err.message}` };
  }
}

/** 抽一帧做封面 */
export async function makeThumbnail(input, output, { atSec = 1 } = {}) {
  const ff = ffmpegPath();
  if (!ff) return null;
  const args = [
    '-y',
    '-ss',
    String(Math.max(0, atSec)),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(640,iw)':-2",
    '-q:v',
    '4',
    output,
  ];
  const { code } = await run(ff, args, { timeoutMs: 120000 });
  if (code !== 0 || !fs.existsSync(output)) return null;
  return output;
}

/** 抽出 16k 单声道 wav（给语音识别用） */
export async function extractAudioWav(input, output) {
  const ff = ffmpegPath();
  if (!ff) throw new Error('没有找到 ffmpeg，无法提取音频');
  const args = [
    '-y',
    '-i',
    input,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-acodec',
    'pcm_s16le',
    output,
  ];
  const { code, stderr } = await run(ff, args, { timeoutMs: 30 * 60 * 1000 });
  if (code !== 0 || !fs.existsSync(output)) {
    throw new Error(`提取音频失败：${stderr.slice(-400)}`);
  }
  return output;
}

/** 转成浏览器一定能播的 H.264/AAC mp4（手机上录的 HEVC 常常播不了） */
export async function transcodeWeb(input, output) {
  const ff = ffmpegPath();
  if (!ff) throw new Error('没有找到 ffmpeg，无法转码');
  const args = [
    '-y',
    '-i',
    input,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    "scale='min(1280,iw)':-2",
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    output,
  ];
  const { code, stderr } = await run(ff, args, { timeoutMs: 60 * 60 * 1000 });
  if (code !== 0 || !fs.existsSync(output)) {
    throw new Error(`转码失败：${stderr.slice(-400)}`);
  }
  return output;
}

/* ------------------------------------------------------------------ */
/* 归档瘦身：把 1-2 GB 的总结视频压成几十 MB                            */
/* ------------------------------------------------------------------ */

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * 带进度的 ffmpeg 调用。
 * 注意不能用管道（受限环境 EPERM），所以用 `-progress <file>` 写进度文件，
 * 定时读回来算百分比。
 */
function runWithProgress(cmd, args, { timeoutMs = 60 * 60 * 1000, totalSec = 0, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!cmd) return reject(new Error('可执行文件不存在'));
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const outFile = path.join(os.tmpdir(), `${TMP_PREFIX}${stamp}.out`);
    const errFile = path.join(os.tmpdir(), `${TMP_PREFIX}${stamp}.err`);
    const progressFile = path.join(os.tmpdir(), `${TMP_PREFIX}${stamp}.progress`);
    fs.writeFileSync(progressFile, '');
    const outFd = fs.openSync(outFile, 'w');
    const errFd = fs.openSync(errFile, 'w');

    const fullArgs = [...args];
    // -progress 必须放在输出文件之前
    const outIdx = fullArgs.length - 1;
    fullArgs.splice(outIdx, 0, '-progress', progressFile, '-nostats');

    let child;
    try {
      child = spawn(cmd, fullArgs, { stdio: ['ignore', outFd, errFd], windowsHide: true });
    } catch (err) {
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      reject(err);
      return;
    }

    const readProgress = () => {
      try {
        const text = fs.readFileSync(progressFile, 'utf8');
        const m = [...text.matchAll(/out_time_ms=(\d+)/g)];
        if (!m.length) return;
        const us = Number(m[m.length - 1][1]);
        if (!Number.isFinite(us) || us <= 0) return;
        const sec = us / 1e6;
        if (totalSec > 0 && typeof onProgress === 'function') {
          const pct = Math.max(1, Math.min(99, Math.round((sec / totalSec) * 100)));
          onProgress(pct);
        }
      } catch {
        /* 进度读失败无所谓 */
      }
    };
    const ticker = onProgress && totalSec > 0 ? setInterval(readProgress, 1200) : null;

    const cleanup = () => {
      if (ticker) clearInterval(ticker);
      for (const fd of [outFd, errFd]) {
        try {
          fs.closeSync(fd);
        } catch {
          /* 忽略 */
        }
      }
    };

    const readAndRemove = (file) => {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        /* 忽略 */
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* 忽略 */
      }
      return text;
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 忽略 */
      }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      readAndRemove(outFile);
      readAndRemove(errFile);
      readAndRemove(progressFile);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      const stdout = readAndRemove(outFile);
      const stderr = readAndRemove(errFile);
      readAndRemove(progressFile);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * 压一条「归档版」：小体积、浏览器直接能播。
 * 540p / CRF 30 的说话头视频，10 分钟大约 25-45 MB。
 */
export async function transcodeArchive(input, output, opts = {}) {
  const ff = ffmpegPath();
  if (!ff) throw new Error('没有找到 ffmpeg，无法压缩');
  const height = Math.max(240, Math.min(1080, Number(opts.height) || 540));
  const crf = Math.max(18, Math.min(40, Number(opts.crf) || 30));
  const audioKbps = Math.max(32, Math.min(192, Number(opts.audioKbps) || 64));

  const args = [
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    // 竖屏也不变形：短边缩到目标高度
    '-vf',
    `scale='if(gt(iw,ih),-2,${height})':'if(gt(iw,ih),${height},-2)'`,
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-c:a',
    'aac',
    '-b:a',
    `${audioKbps}k`,
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  ];

  const { code, stderr } = await runWithProgress(ff, args, {
    timeoutMs: 90 * 60 * 1000,
    totalSec: Number(opts.totalSec) || 0,
    onProgress: opts.onProgress,
  });
  if (code !== 0 || !fs.existsSync(output)) {
    throw new Error(`压缩失败：${stderr.slice(-500)}`);
  }
  return { path: output, size: fileSize(output) };
}

/**
 * 抽一条「归档音频」：AAC 单声道 48 kbps。
 * 10 分钟约 3.6 MB —— 回听、转写、AI 阅读都够用。
 */
export async function extractAudioCompact(input, output, { kbps = 48 } = {}) {
  const ff = ffmpegPath();
  if (!ff) throw new Error('没有找到 ffmpeg，无法提取音频');
  const args = [
    '-y',
    '-i',
    input,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '32000',
    '-c:a',
    'aac',
    '-b:a',
    `${Math.max(24, Math.min(96, Number(kbps) || 48))}k`,
    '-movflags',
    '+faststart',
    output,
  ];
  const { code, stderr } = await run(ff, args, { timeoutMs: 30 * 60 * 1000 });
  if (code !== 0 || !fs.existsSync(output)) {
    throw new Error(`提取音频失败：${stderr.slice(-400)}`);
  }
  return { path: output, size: fileSize(output) };
}

export { fileSize };


/** 把多个视频拼成一个（周回顾） */
export async function concatVideos(inputs, output, workDir) {
  const ff = ffmpegPath();
  if (!ff) throw new Error('没有找到 ffmpeg，无法合成视频');
  if (!inputs.length) throw new Error('没有可拼接的视频');

  fs.mkdirSync(workDir, { recursive: true });
  const normalized = [];
  for (let i = 0; i < inputs.length; i += 1) {
    const tmp = path.join(workDir, `part-${i}.mp4`);
    const args = [
      '-y',
      '-i',
      inputs[i],
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-vf',
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      tmp,
    ];
    const { code, stderr } = await run(ff, args, { timeoutMs: 60 * 60 * 1000 });
    if (code !== 0) throw new Error(`预处理第 ${i + 1} 段失败：${stderr.slice(-300)}`);
    normalized.push(tmp);
  }

  const listFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listFile, normalized.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');

  const { code, stderr } = await run(
    ff,
    ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output],
    { timeoutMs: 60 * 60 * 1000 },
  );
  if (code !== 0) throw new Error(`拼接失败：${stderr.slice(-400)}`);

  for (const p of normalized) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* 忽略 */
    }
  }
  try {
    fs.unlinkSync(listFile);
  } catch {
    /* 忽略 */
  }
  return output;
}

/** 找到 python 可执行文件（给可选的外部转写脚本用） */
export function findPython() {
  for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe', 'py.exe'] : ['python3', 'python']) {
    const p = whichSync(name);
    if (p) return p;
  }
  return '';
}
