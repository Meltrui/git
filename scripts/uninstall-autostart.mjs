#!/usr/bin/env node
/**
 * 取消开机自启（移除「启动」文件夹快捷方式 + 计划任务 + 可选桌面图标）。
 *
 *   node scripts/uninstall-autostart.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK_NAME = 'Anchor';
const LINK_NAME = 'Anchor 锚点.lnk';

function runCapture(cmd, args, timeoutMs = 30000) {
  const outFile = path.join(ROOT, 'data', `.uninstall-${Date.now()}.txt`);
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
      resolve({ code: code ?? -1, out: out.trim() });
    };
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

function removeShortcut(folderExpr, label) {
  const script = `
$folder = ${folderExpr}
$p = Join-Path $folder '${LINK_NAME.replace(/'/g, "''")}'
if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Output 'REMOVED' } else { Write-Output 'ABSENT' }
`.trim();
  return runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('这个脚本只处理 Windows。');
    return;
  }
  console.log('\n取消开机自启…');

  const startup = await removeShortcut("[Environment]::GetFolderPath('Startup')", 'startup');
  console.log(startup.out.includes('REMOVED') ? '  ✓ 已移除「启动」文件夹里的快捷方式' : '  · 启动文件夹里没有快捷方式');

  const desk = await removeShortcut("[Environment]::GetFolderPath('Desktop')", 'desktop');
  if (desk.out.includes('REMOVED')) console.log('  ✓ 已移除桌面快捷方式');

  const task = await runCapture('schtasks', ['/delete', '/tn', TASK_NAME, '/f']);
  console.log(task.code === 0 ? '  ✓ 已删除计划任务 Anchor' : '  · 没有计划任务 Anchor（正常）');

  console.log('\n以后要启动就双击 Anchor.vbs。\n');
}

main().catch((err) => {
  console.error('出错：', err.message);
  process.exit(1);
});
