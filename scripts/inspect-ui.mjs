#!/usr/bin/env node
/**
 * 开发用：用真实浏览器（Chrome/Edge headless）打开 Anchor，
 * 抓控制台错误并截图，方便验证界面改动。
 *
 *   node scripts/inspect-ui.mjs                     # 截全部页面
 *   node scripts/inspect-ui.mjs --routes=today,plan # 只截指定页面
 *   node scripts/inspect-ui.mjs --mobile            # 手机视口
 *   node scripts/inspect-ui.mjs --port=8787
 *
 * 截图输出到 .shots/ 目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT } from '../server/src/paths.js';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const APP_PORT = Number(getArg('port', 8787));
const BASE = `http://127.0.0.1:${APP_PORT}`;
const CDP_PORT = Number(getArg('cdp', 9333));
const MOBILE = hasFlag('mobile');
const ROUTES = getArg('routes', 'today,plan,review,videos,settings').split(',').filter(Boolean);
const OUT_DIR = path.join(ROOT, '.shots');
const PROFILE_DIR = path.join(ROOT, '.chrome-profile');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return '';
}

async function waitForCdp(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  throw new Error('浏览器调试端口没起来');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    this.handlers = new Map();
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        const hs = this.handlers.get(msg.method);
        if (hs) for (const h of hs) h(msg.params);
      }
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 30000);
    });
  }
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error('没找到 Chrome / Edge');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1440,1000',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  let cdp = null;
  try {
    await waitForCdp();

    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
    const target = await res.json();

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    cdp = new Cdp(ws);
    const problems = [];

    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        problems.push(`[console.${p.type}] ${text}`);
      }
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      problems.push(`[异常] ${d.text} ${d.exception?.description || ''} @${d.url || ''}:${d.lineNumber}`);
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry.level === 'error') problems.push(`[log] ${p.entry.text} ${p.entry.url || ''}`);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    const width = MOBILE ? 402 : 1440;
    const height = MOBILE ? 880 : 1000;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: MOBILE ? 2 : 1,
      mobile: MOBILE,
    });

    const theme = getArg('theme', '');
    if (theme) {
      await cdp.send('Page.navigate', { url: `${BASE}/` });
      await sleep(600);
      await cdp.send('Runtime.evaluate', {
        expression: `localStorage.setItem('anchor-theme','${theme}');document.documentElement.setAttribute('data-theme','${theme}');`,
      });
    }

    for (const route of ROUTES) {
      const url = `${BASE}/#/${route}`;
      const before = problems.length;
      await cdp.send('Page.navigate', { url });
      await sleep(2200);

      // 确认 React/Preact 真的挂载了内容
      const mounted = await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('.shell') ? document.querySelector('.content')?.innerText.slice(0,120) : 'MOUNT_FAILED'`,
        returnByValue: true,
      });

      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      const file = path.join(OUT_DIR, `${MOBILE ? 'm-' : ''}${route}${theme ? `-${theme}` : ''}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

      const newProblems = problems.slice(before);
      console.log(`\n── ${route} ──────────────────────────`);
      console.log(`  截图 ${path.relative(ROOT, file)}`);
      const text = String(mounted.result?.value || '').replace(/\s+/g, ' ').slice(0, 110);
      console.log(`  首屏文字: ${text}`);
      if (text === 'MOUNT_FAILED') console.log('  ✗ 应用没有挂载！');
      if (newProblems.length) {
        console.log('  ✗ 控制台问题:');
        for (const p of [...new Set(newProblems)]) console.log(`    ${p}`);
      } else {
        console.log('  ✓ 无控制台报错');
      }
    }

    console.log(`\n截图目录：${OUT_DIR}\n`);
    await ws.close();
  } finally {
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
  }
}

main().catch((err) => {
  console.error('检查失败：', err.message);
  process.exit(1);
});
