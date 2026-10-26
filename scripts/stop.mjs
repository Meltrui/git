#!/usr/bin/env node
/**
 * 停止正在运行的 Anchor 服务。
 *
 *   node scripts/stop.mjs
 *
 * 只会杀掉「监听 8787 端口」的那个进程，不会误杀其他 node 程序。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ANCHOR_PORT || 8787);

function runCapture(cmd, args, timeoutMs = 20000) {
  const outFile = path.join(ROOT, 'data', `.stop-${Date.now()}.txt`);
  try {
    fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  } catch {
    /* 忽略 */
  }
  let fd = null;
  try {
    fd = fs.openSync(outFile, 'w');
  } catch {
    return Promise.resolve({ code: -1, out: '' });
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', fd, fd] });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
    }, timeoutMs);
    const finish = (code) => {
      clearTimeout(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* 忽略 */
      }
      let out = '';
      try {
        out = fs.readFileSync(outFile, 'utf8');
        fs.rmSync(outFile, { force: true });
      } catch {
        /* 忽略 */
      }
      resolve({ code: code ?? -1, out });
    };
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

async function isRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await isRunning())) {
    console.log(`\n  ${PORT} 端口上没有在运行的服务，Anchor 本来就没开。\n`);
    return;
  }

  if (process.platform === 'win32') {
    const script = `
$pids = (Get-NetTCPConnection -State Listen -LocalPort ${PORT} -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
foreach ($p in $pids) {
  try { Stop-Process -Id $p -Force -ErrorAction Stop; Write-Output ("stopped " + $p) } catch { Write-Output ("failed " + $p) }
}
`.trim();
    const res = await runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const stopped = res.out.includes('stopped');
    console.log(stopped ? `\n  已停止（端口 ${PORT}）。\n` : `\n  停止失败，可以用任务管理器结束占用 ${PORT} 端口的 node 进程。\n`);
    return;
  }

  // macOS / Linux
  const res = await runCapture('sh', ['-c', `lsof -ti tcp:${PORT} | xargs -r kill`]);
  console.log(res.code === 0 ? `\n  已停止（端口 ${PORT}）。\n` : `\n  停止失败，试试：lsof -ti tcp:${PORT} | xargs kill\n`);
}

main().catch((err) => {
  console.error('出错：', err.message);
  process.exit(1);
});
