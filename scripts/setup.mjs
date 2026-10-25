#!/usr/bin/env node
/**
 * 首次安装引导。
 *
 *   npm install
 *   npm run setup
 *   npm start
 *
 * 这个脚本只做三件事：检查环境、建目录、问你要不要顺手把语音模型下好。
 * 不会改系统设置，不会写项目目录以外的地方。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ROOT, DATA_DIR, WEB_DIST } from '../server/src/paths.js';
import { mediaStatus } from '../server/src/media.js';
import { localModelReady } from '../server/src/asr.js';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

async function main() {
  console.log('\n\x1b[1mAnchor · 锚点 —— 安装检查\x1b[0m\n');

  /* 1. Node 版本 */
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok(`Node 版本 ${process.versions.node}`);
  else bad(`Node 版本 ${process.versions.node} 太旧，需要 20 以上（推荐 22 / 24）`);

  /* 2. 依赖 */
  const missing = [];
  for (const dep of ['express', 'multer', 'preact', 'htm']) {
    if (!fs.existsSync(path.join(ROOT, 'node_modules', dep))) missing.push(dep);
  }
  if (!missing.length) ok('依赖已安装');
  else bad(`缺少依赖：${missing.join(', ')} —— 先运行 npm install`);

  /* 3. 前端文件 */
  const webIndex = fs.existsSync(path.join(WEB_DIST, 'index.html'))
    ? path.join(WEB_DIST, 'index.html')
    : path.join(ROOT, 'web', 'index.html');
  if (fs.existsSync(webIndex)) ok('前端文件就位（零构建，直接由服务端托管）');
  else bad('找不到 web/index.html，项目文件可能不完整');

  /* 4. ffmpeg */
  const media = mediaStatus();
  if (media.ffmpeg) ok(`ffmpeg 可用：${media.ffmpegPath}`);
  else warn('没有 ffmpeg：视频封面、转码、周回顾合成都用不了（打卡和计划不受影响）');

  /* 5. 数据目录 */
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ok(`数据目录：${DATA_DIR}`);

  /* 6. 可选：下载语音模型 */
  if (localModelReady()) {
    ok('本地语音识别模型已就绪');
  } else {
    console.log('');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    let answer = 'n';
    try {
      answer = (await rl.question('  要现在下载本地语音识别模型吗？（约 240MB，只需一次，之后完全离线）[y/N] ')).trim();
    } catch {
      /* 非交互环境 */
    }
    rl.close();

    if (/^y/i.test(answer)) {
      const { spawn } = await import('node:child_process');
      await new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'fetch-asr-model.mjs')], {
          stdio: 'inherit',
        });
        child.on('close', resolve);
      });
    } else {
      warn('跳过了。以后想要就点「设置 → 语音转写 → 下载本地模型」，或者跑 npm run fetch:asr');
    }
  }

  /* 7. 收尾 */
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  console.log('\n\x1b[1m下一步\x1b[0m');
  console.log('  npm start                     启动');
  console.log('  浏览器打开 http://127.0.0.1:8787');
  if (lan.length) console.log(`  手机上打开 http://${lan[0]}:8787 （需要连同一个 WiFi）`);
  console.log('\n  第一次打开建议先做两件事：');
  console.log('   1. 设置 → 我的档案：填目标日期');
  console.log('   2. 设置 → 我的指标：按你的实际情况改每日指标和目标值');
  console.log('\n  想用 AI：设置 → 大模型，填一个 DeepSeek 的 API Key（只存在本机）。');
  console.log('  不填也能用：计划、打卡、统计、规则版周总结都是本地算的。\n');
}

main().catch((err) => {
  console.error('安装检查出错：', err);
  process.exit(1);
});
