#!/usr/bin/env node
/**
 * 智能启动器。
 *
 *   node scripts/launch.mjs          # 没在跑就起一个（脱离终端），然后打开浏览器
 *   node scripts/launch.mjs --no-open  # 只启动，不开浏览器
 *   node scripts/launch.mjs --status   # 只看状态
 *
 * 被 Anchor.vbs（隐藏窗口）和 start-anchor.cmd 调用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ANCHOR_PORT || 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.ANCHOR_DATA_DIR
  ? path.resolve(process.env.ANCHOR_DATA_DIR)
  : path.join(ROOT, 'data');
const LOG = path.join(DATA_DIR, 'anchor.log');
const PID_FILE = path.join(DATA_DIR, 'anchor.pid');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health(timeoutMs = 1500) {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.ok ? body.data : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function tailLog(lines = 12) {
  try {
    const text = fs.readFileSync(LOG, 'utf8').trimEnd().split('\n');
    return text.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/**
 * 弹一个 Windows 消息框。
 * 用 PowerShell 的 -EncodedCommand（UTF-16LE + base64）传中文，
 * 避开命令行编码问题。
 */
function showErrorBox(title, message) {
  if (process.platform !== 'win32') return false;
  const script = `
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(${JSON.stringify(message)}, ${JSON.stringify(title)}, 'OK', 'Error') | Out-Null
`.trim();
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function writeLaunchError(details) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'anchor-launch-error.txt'), `${new Date().toISOString()}\n\n${details}\n`, 'utf8');
  } catch {
    /* 忽略 */
  }
}

async function main() {
  const already = await health();

  if (has('status')) {
    if (already) {
      console.log(`运行中  ${BASE}  （${already.version || 'anchor'}）`);
      console.log(`数据    ${DATA_DIR}`);
    } else {
      console.log('没有在运行');
    }
    return;
  }

  if (already) {
    console.log(`已经在运行了：${BASE}`);
    if (!has('no-open')) openBrowser(BASE);
    return;
  }

  console.log(`启动 Anchor…（端口 ${PORT}）`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const outFd = fs.openSync(path.join(DATA_DIR, 'anchor-stdout.log'), 'a');
  const errFd = fs.openSync(path.join(DATA_DIR, 'anchor-stderr.log'), 'a');

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env, ANCHOR_PORT: String(PORT) },
  });
  child.unref();

  try {
    fs.writeFileSync(PID_FILE, String(child.pid ?? ''), 'utf8');
  } catch {
    /* 忽略 */
  }

  // 等它起来（最多 20 秒）
  let ok = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    ok = await health(1200);
    if (ok) break;
    if (child.exitCode !== null && child.exitCode !== 0) break;
  }

  if (!ok) {
    const t = tailLog();
    const details = [
      `启动失败，端口 ${PORT}`,
      '',
      t || '（日志还没有内容）',
      '',
      `日志文件：${LOG}`,
      '排查：用 start-anchor.cmd 启动可以看到实时控制台输出。',
    ].join('\n');

    console.error('\n启动失败。最近日志：\n');
    console.error(t || '（日志还没有内容，可以试试用 start-anchor.cmd 启动看控制台输出）');
    console.error(`\n日志文件：${LOG}`);

    writeLaunchError(details);
    showErrorBox('Anchor 启动失败', `本地服务没能起来，端口 ${PORT}。\n\n${t ? t.split('\n').slice(-6).join('\n') : ''}\n\n详细日志：data\\anchor.log\n也可以双击 start-anchor.cmd 查看实时输出。`);

    process.exitCode = 1;
    return;
  }

  console.log(`已启动：${BASE}`);
  console.log(`数据：${DATA_DIR}`);
  if (!has('no-open')) openBrowser(BASE);
}

main().catch((err) => {
  console.error('启动器出错：', err.message);
  writeLaunchError(`启动器异常：${err.stack || err.message}`);
  showErrorBox('Anchor 启动失败', `启动器出错：${err.message}\n\n用 start-anchor.cmd 可以看到详细信息。`);
  process.exit(1);
});
