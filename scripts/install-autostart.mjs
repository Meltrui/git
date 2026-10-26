#!/usr/bin/env node
/**
 * 让 Anchor 在「登录 Windows 时」自动在后台跑起来，并在桌面放一个启动图标。
 *
 *   node scripts/install-autostart.mjs              # 设置开机自启
 *   node scripts/install-autostart.mjs --desktop    # 顺便建桌面快捷方式
 *   node scripts/install-autostart.mjs --start      # 设置完立刻启动一次
 *   node scripts/install-autostart.mjs --remove     # 取消
 *
 * 原理：在「启动」文件夹里放一个指向 Anchor.vbs 的快捷方式。
 * 这种做法不需要管理员权限，也不改任何系统策略，删掉快捷方式就撤销了。
 * （计划任务如果可用也会顺带注册一份，可用性更高；不可用不影响主流程。）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VBS = path.join(ROOT, 'Anchor.vbs');
const TASK_NAME = 'Anchor';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);

const LINK_NAME = 'Anchor 锚点.lnk';

/* ------------------------------------------------------------------ */
/* 跑一条命令，输出重定向到文件再读回（不依赖管道）                    */
/* ------------------------------------------------------------------ */

function runCapture(cmd, args, timeoutMs = 30000) {
  const outFile = path.join(ROOT, 'data', `.install-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
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

/* ------------------------------------------------------------------ */
/* 用 COM 建 .lnk（PowerShell 调 WScript.Shell）                        */
/* ------------------------------------------------------------------ */

function psQuote(s) {
  return String(s).replace(/'/g, "''");
}

async function createShortcut(dirKind) {
  const script = `
$ErrorActionPreference = 'Stop'
$folder = switch ('${dirKind}') {
  'startup' { [Environment]::GetFolderPath('Startup') }
  'desktop' { [Environment]::GetFolderPath('Desktop') }
  default   { throw 'unknown folder' }
}
if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
$path = Join-Path $folder '${psQuote(LINK_NAME)}'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($path)
$lnk.TargetPath = '${psQuote(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe'))}'
$lnk.Arguments = '//B "${psQuote(VBS)}"'
$lnk.WorkingDirectory = '${psQuote(ROOT)}'
$lnk.IconLocation = '${psQuote(process.execPath)},0'
$lnk.Description = '启动 Anchor 锚点自律监督系统'
$lnk.WindowStyle = 7
$lnk.Save()
if (Test-Path -LiteralPath $path) { Write-Output ('OK ' + $path) } else { Write-Output 'MISSING' }
`.trim();

  return runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 45000);
}

/* ------------------------------------------------------------------ */

async function installTask() {
  // 计划任务可用就用一份（比启动文件夹更可靠），不可用就算了
  const res = await runCapture('schtasks', [
    '/create',
    '/tn',
    TASK_NAME,
    '/tr',
    `wscript.exe //B "${VBS}"`,
    '/sc',
    'onlogon',
    '/rl',
    'limited',
    '/f',
  ]);
  return res.code === 0;
}

async function removeTask() {
  const res = await runCapture('schtasks', ['/delete', '/tn', TASK_NAME, '/f']);
  return res.code === 0;
}

function removeShortcut(dirKind) {
  const script = `
$folder = switch ('${dirKind}') {
  'startup' { [Environment]::GetFolderPath('Startup') }
  'desktop' { [Environment]::GetFolderPath('Desktop') }
  default   { throw 'unknown folder' }
}
$p = Join-Path $folder '${psQuote(LINK_NAME)}'
if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Output 'REMOVED' } else { Write-Output 'ABSENT' }
`.trim();
  return runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 30000);
}

async function startNow() {
  const launcher = path.join(ROOT, 'scripts', 'launch.mjs');
  const res = await runCapture(process.execPath, [launcher, '--no-open'], 60000);
  return res.out;
}

/* ------------------------------------------------------------------ */

async function main() {
  if (process.platform !== 'win32') {
    console.log('这个脚本只处理 Windows 的开机自启。');
    console.log('macOS / Linux 可以把 `node scripts/launch.mjs` 加到登录项里。');
    return;
  }

  if (has('remove')) {
    console.log('\n取消开机自启…');
    const s = await removeShortcut('startup');
    console.log(s.out.includes('REMOVED') ? '  已移除「启动」文件夹里的快捷方式' : '  启动文件夹里没有快捷方式');
    const d = await removeShortcut('desktop');
    if (d.out.includes('REMOVED')) console.log('  已移除桌面快捷方式');
    if (await removeTask()) console.log('  已删除计划任务 Anchor');
    console.log('\n以后要启动就双击 Anchor.vbs。\n');
    return;
  }

  if (!fs.existsSync(VBS)) {
    console.error(`找不到 ${VBS}，项目文件可能不完整。`);
    process.exitCode = 1;
    return;
  }

  console.log('\n设置开机自启…');

  // 1) 启动文件夹（主路径）
  const startup = await createShortcut('startup');
  if (startup.out.startsWith('OK')) {
    console.log('  ✓ 已在「启动」文件夹创建快捷方式，下次登录 Windows 会自动在后台启动');
  } else {
    console.log('  ✗ 启动文件夹快捷方式创建失败');
    if (startup.out) console.log(`     ${startup.out.split('\n')[0]}`);
    console.log('    手动办法：Win+R 输入 shell:startup 回车，把 Anchor.vbs 拖进去');
  }

  // 2) 计划任务（额外保险，失败不影响）
  if (await installTask()) {
    console.log('  ✓ 额外注册了计划任务「Anchor」（可用「任务计划程序」查看）');
  }

  // 3) 桌面快捷方式
  if (has('desktop')) {
    const desk = await createShortcut('desktop');
    console.log(desk.out.startsWith('OK') ? '  ✓ 已在桌面创建「Anchor 锚点」图标' : '  ✗ 桌面快捷方式创建失败（可以自己把 Anchor.vbs 拖到桌面）');
  }

  // 4) 立刻启动
  if (has('start')) {
    console.log('\n启动一次…');
    const out = await startNow();
    if (out) console.log(out.split('\n').map((l) => `  ${l}`).join('\n'));
  }

  console.log('\n以后每天：');
  console.log('  · 电脑开机登录后，Anchor 会在后台自动起来');
  console.log('  · 浏览器打开 http://127.0.0.1:8787 （建议加书签或添加到主屏幕）');
  console.log('  · 页面打不开时，双击 Anchor.vbs 手动启动一下');
  console.log('\n撤销：双击 uninstall-autostart.cmd\n');
}

main().catch((err) => {
  console.error('出错：', err.message);
  process.exit(1);
});
