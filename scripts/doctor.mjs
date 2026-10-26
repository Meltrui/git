#!/usr/bin/env node
/**
 * 体检：一条命令看清当前环境哪些能力可用。
 *
 *   npm run doctor
 *
 * 出问题时把这里的输出发出来就能定位。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DATA_DIR, VIDEO_DIR, PORT } from '../server/src/paths.js';
import { mediaStatus, probe } from '../server/src/media.js';
import { asrStatus } from '../server/src/asr.js';
import * as store from '../server/src/store.js';

const line = (label, value, hint = '') => {
  const pad = label.padEnd(16, ' ');
  console.log(`  ${pad} ${value}${hint ? `  \x1b[2m${hint}\x1b[0m` : ''}`);
};

const yes = (v) => (v ? '\x1b[32m可用\x1b[0m' : '\x1b[33m不可用\x1b[0m');

async function main() {
  console.log('\n\x1b[1mAnchor · 环境体检\x1b[0m\n');

  console.log('\x1b[1m运行时\x1b[0m');
  line('Node', process.version);
  line('平台', `${process.platform} ${process.arch}`);
  line('CPU', `${os.cpus().length} 核`);
  line('内存', `${Math.round(os.freemem() / 1024 ** 3)} / ${Math.round(os.totalmem() / 1024 ** 3)} GB 可用`);
  line('项目目录', ROOT);

  console.log('\n\x1b[1m依赖\x1b[0m');
  for (const dep of ['express', 'multer', 'preact', 'htm', 'sherpa-onnx-node']) {
    const exists = fs.existsSync(path.join(ROOT, 'node_modules', dep));
    line(dep, exists ? '\x1b[32m已安装\x1b[0m' : '\x1b[33m未安装\x1b[0m');
  }

  console.log('\n\x1b[1m媒体能力\x1b[0m');
  const media = mediaStatus();
  line('ffmpeg', yes(media.ffmpeg), media.ffmpeg ? media.ffmpegPath : '视频封面 / 转码 / 周回顾需要它');
  line('ffprobe', yes(media.ffprobe), media.ffprobe ? media.ffprobePath : '读取视频时长需要它');

  console.log('\n\x1b[1m语音转写\x1b[0m');
  let settings = null;
  try {
    store.load();
    settings = store.get().settings;
  } catch (err) {
    line('数据文件', `\x1b[31m读取失败 ${err.message}\x1b[0m`);
  }
  const asr = asrStatus(settings);
  line('方式', asr.provider);
  line('本地模型', yes(asr.localReady), asr.localReady ? `${asr.localModelSizeMb} MB` : asr.localModelDir);
  line('可以转写', yes(asr.canTranscribe));

  console.log('\n\x1b[1m数据\x1b[0m');
  const stats = store.stats();
  line('数据文件', stats.path);
  line('大小', `${Math.round(stats.bytes / 1024)} KB`);
  line('记录', `${stats.days} 天 · ${stats.tasks} 任务 · ${stats.videos} 视频`);
  line('视频目录', VIDEO_DIR, fs.existsSync(VIDEO_DIR) ? '存在' : '还没创建');
  line('数据目录', DATA_DIR);

  console.log('\n\x1b[1m大模型\x1b[0m');
  line('启用', settings?.ai?.enabled ? '\x1b[32m是\x1b[0m' : '否（核心功能不受影响）');
  line('服务商', settings?.ai?.provider || '-');
  line('模型', settings?.ai?.model || '-');
  line('Key', settings?.ai?.apiKey ? '\x1b[32m已配置\x1b[0m' : '\x1b[33m未配置\x1b[0m');

  console.log('\n\x1b[1m服务\x1b[0m');
  line('端口', String(PORT));
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json();
    line('本地服务', data.ok ? '\x1b[32m运行中\x1b[0m' : '\x1b[31m异常\x1b[0m');
  } catch {
    line('本地服务', '\x1b[33m没在跑\x1b[0m', '双击 Anchor.vbs，或 npm run launch');
  }

  // 开机自启状态
  if (process.platform === 'win32') {
    const startupDir = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
      : '';
    let auto = false;
    if (startupDir) {
      try {
        auto = fs.readdirSync(startupDir).some((f) => f.toLowerCase().includes('anchor'));
      } catch {
        /* 忽略 */
      }
    }
    line(
      '开机自启',
      auto ? '\x1b[32m已设置\x1b[0m' : '\x1b[33m未设置\x1b[0m',
      auto ? '' : '双击 install-autostart.cmd 设置一次',
    );
  }

  // 日志
  const logNames = ['anchor.log', 'anchor-launch.log'];
  const present = logNames.filter((f) => {
    try {
      return fs.existsSync(path.join(DATA_DIR, f));
    } catch {
      return false;
    }
  });
  line('日志', present.length ? present.join('  ') : '还没有', DATA_DIR);

  const errFile = path.join(DATA_DIR, 'anchor-launch-error.txt');
  try {
    if (fs.existsSync(errFile)) {
      const text = fs.readFileSync(errFile, 'utf8').trim();
      if (text) {
        console.log('\n  \x1b[33m上次启动失败记录（anchor-launch-error.txt）：\x1b[0m');
        for (const l of text.split('\n').slice(0, 10)) console.log(`    ${l}`);
      }
    }
  } catch {
    /* 忽略 */
  }

  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  if (lan.length) line('局域网地址', lan.map((ip) => `http://${ip}:${PORT}`).join('  '));

  // 顺手校验一下第一个视频能不能读
  if (stats.videos > 0) {
    const v = store.get().videos[0];
    const abs = path.join(VIDEO_DIR, v.relPath);
    const info = fs.existsSync(abs) ? await probe(abs) : null;
    line('首个视频', fs.existsSync(abs) ? (info?.error ? `\x1b[33m${info.error}\x1b[0m` : `\x1b[32m可读 ${Math.round(info?.durationSec || 0)}s\x1b[0m`) : '\x1b[31m文件缺失\x1b[0m');
  }

  console.log('');
}

main().catch((err) => {
  console.error('体检失败：', err);
  process.exit(1);
});
