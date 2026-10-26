/**
 * 日志。启动、报错、接口异常都同时写一份到 data/anchor.log。
 *
 * 为什么需要：用隐藏窗口（Anchor.vbs）启动时看不到控制台，
 * 出问题只能靠日志文件。日志超过 2MB 会自动轮转成 anchor.log.1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const LOG_FILE = path.join(DATA_DIR, 'anchor.log');
const MAX_BYTES = 2 * 1024 * 1024;

let stream = null;
let patched = false;

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const { size } = fs.statSync(LOG_FILE);
    if (size < MAX_BYTES) return;
    const backup = `${LOG_FILE}.1`;
    if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
    fs.renameSync(LOG_FILE, backup);
  } catch {
    /* 轮转失败不影响主流程 */
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}:${pad2(d.getSeconds())}`;
}

function stringify(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`;
  try {
    const json = JSON.stringify(value);
    return json && json.length > 2000 ? `${json.slice(0, 2000)}…` : json;
  } catch {
    return String(value);
  }
}

/**
 * @param {{echo?: boolean}} options echo=true 时仍然输出到控制台（默认）
 */
export function initLogger({ echo = true } = {}) {
  if (patched) return LOG_FILE;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    rotateIfNeeded();
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
    stream.on('error', () => {
      stream = null;
    });
  } catch {
    stream = null;
  }

  const levels = ['log', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (echo) {
        try {
          original(...args);
        } catch {
          /* 忽略 */
        }
      }
      if (!stream) return;
      try {
        stream.write(`[${stamp()}] [${level}] ${args.map(stringify).join(' ')}\n`);
      } catch {
        /* 忽略 */
      }
    };
  }

  patched = true;
  return LOG_FILE;
}

export function logPath() {
  return LOG_FILE;
}

/** 直接写一行（不经过 console） */
export function logLine(text) {
  if (!stream) return;
  try {
    stream.write(`[${stamp()}] ${text}\n`);
  } catch {
    /* 忽略 */
  }
}
