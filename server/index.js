import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, WEB_DIST, DATA_DIR, VIDEO_DIR, PORT, HOST, ensureDirs } from './src/paths.js';
import * as store from './src/store.js';
import { api } from './src/routes.js';
import { startScheduler } from './src/reminder.js';
import { mediaStatus } from './src/media.js';
import { localModelReady } from './src/asr.js';

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

ensureDirs();
const db = store.load();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

/* ---- 局域网口令保护 ---- */

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function isLoopback(req) {
  const ip = req.socket?.remoteAddress || '';
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

app.post('/api/access', (req, res) => {
  const code = String(req.body?.code || '');
  const expected = store.get().settings?.access?.code || '';
  if (!expected || code === expected) {
    if (expected) {
      res.setHeader('Set-Cookie', `anchorCode=${encodeURIComponent(code)}; Path=/; Max-Age=2592000; SameSite=Lax`);
    }
    res.json({ ok: true, data: { granted: true } });
    return;
  }
  res.status(401).json({ ok: false, error: '口令不对' });
});

app.use((req, res, next) => {
  const expected = store.get().settings?.access?.code || '';
  if (!expected) return next();
  if (isLoopback(req)) return next();
  if (req.path === '/api/access') return next();
  if (req.path === '/api/health') return next();

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.anchorCode === expected) return next();

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ ok: false, error: '需要口令', needCode: true });
    return;
  }
  res
    .status(401)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .end(`<!doctype html><meta charset="utf-8"><title>需要口令</title>
<body style="font-family:system-ui;background:#0f1115;color:#e6e8ee;display:grid;place-items:center;height:100vh;margin:0">
<form style="background:#171a21;padding:28px 32px;border-radius:14px;border:1px solid #262b36;text-align:center">
  <h3 style="margin:0 0 14px">Anchor · 输入访问口令</h3>
  <input name="c" type="password" autofocus style="padding:10px 14px;border-radius:8px;border:1px solid #303645;background:#0f1115;color:#e6e8ee;font-size:15px">
  <button type="submit" style="margin-left:8px;padding:10px 16px;border-radius:8px;border:0;background:#4f7cff;color:#fff;font-size:15px">进入</button>
</form>
<script>
document.querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.querySelector('input').value;
  const r = await fetch('/api/access', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
  if (r.ok) location.reload(); else alert('口令不对');
});
</script></body>`);
});

/* ---- API ---- */

app.use('/api', api);

/* ---- 前端静态资源 ---- */

const WEB_ROOT = fs.existsSync(path.join(WEB_DIST, 'index.html')) ? WEB_DIST : path.join(ROOT, 'web');

app.use(
  express.static(WEB_ROOT, {
    index: false,
    etag: true,
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// 本地模型等可选资源（设置页会用到下载状态）
app.use('/vendor', express.static(path.join(ROOT, 'node_modules'), { index: false, maxAge: '7d' }));
app.use('/asr-model', express.static(path.join(ROOT, '.asr', 'model'), { index: false, maxAge: '1h' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexFile = path.join(WEB_ROOT, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return res
      .status(500)
      .send('找不到前端文件 web/index.html。请确认项目文件完整，或者运行 npm run doctor 检查。');
  }
  return res.sendFile(indexFile);
});

/* ---- 错误兜底 ---- */

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[server]', err);
  if (res.headersSent) return;
  res.status(status).json({ ok: false, error: err.message || '服务器出错了' });
});

/* ------------------------------------------------------------------ */

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, address: info.address });
    }
  }
  return out;
}

const server = app.listen(PORT, HOST, () => {
  const media = mediaStatus();
  const lines = [
    '',
    '  ╭──────────────────────────────────────────────╮',
    '  │   Anchor · 锚点   自律监督系统               │',
    '  ╰──────────────────────────────────────────────╯',
    '',
    `  本机访问   http://127.0.0.1:${PORT}`,
  ];
  for (const { name, address } of lanAddresses()) {
    lines.push(`  手机/局域网 http://${address}:${PORT}   (${name})`);
  }
  lines.push('');
  lines.push(`  数据目录   ${DATA_DIR}`);
  lines.push(`  视频目录   ${VIDEO_DIR}`);
  lines.push(`  ffmpeg     ${media.ffmpeg ? '就绪' : '未找到（视频封面/周回顾合成不可用）'}`);
  lines.push(`  本地转写   ${localModelReady() ? '模型就绪' : '未下载模型（可用云端转写或手动粘贴文字稿）'}`);
  lines.push(`  已记录     ${Object.keys(db.days).length} 天 · ${db.tasks.length} 个任务 · ${db.videos.length} 个视频`);
  lines.push('');
  console.log(lines.join('\n'));

  startScheduler();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用。换一个端口：\n    Windows:  $env:ANCHOR_PORT=8899; npm start\n`);
  } else {
    console.error('\n  服务启动失败：', err.message, '\n');
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log(`\n  收到 ${signal}，正在保存数据…`);
  try {
    store.flush();
  } catch {
    /* 忽略 */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[未捕获异常]', err);
  try {
    store.flush();
  } catch {
    /* 忽略 */
  }
});
process.on('unhandledRejection', (err) => {
  console.error('[未处理的 Promise 拒绝]', err);
});
