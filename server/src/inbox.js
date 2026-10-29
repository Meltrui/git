import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { INBOX_DIR, INBOX_DONE_DIR, INBOX_LOG, TMP_DIR } from './paths.js';
import { isVideoFile, ingest, startProcessJob } from './video.js';
import * as repo from './repo.js';
import { todayStr } from './time.js';

/**
 * 收件箱。
 *
 * 手机传 1-2 GB 的视频，用浏览器上传很容易中途断掉。
 * 更可靠的路子是：手机用微信/QQ 传到电脑，再把文件拖进 data/inbox，
 * 这里每 20 秒扫一次，自动导入、归档、转写、让 AI 读。
 */

const state = {
  timer: null,
  scanning: false,
  seen: new Map(), // filename -> { size, mtime, hits }
  lastScanAt: null,
  lastError: null,
};

function mediaCfg(settings) {
  const m = settings?.media || {};
  return {
    enabled: m.inboxEnabled !== false,
    scanMs: Math.max(5, Number(m.inboxScanSeconds) || 20) * 1000,
    dateFrom: m.inboxDateFrom === 'today' ? 'today' : 'filetime',
  };
}

function readLog() {
  try {
    const raw = fs.readFileSync(INBOX_LOG, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    fs.writeFileSync(INBOX_LOG, JSON.stringify(entries.slice(0, 60), null, 2), 'utf8');
  } catch {
    /* 忽略 */
  }
}

function pushLog(entry) {
  const log = readLog();
  log.unshift(entry);
  writeLog(log);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateFromMtime(mtime) {
  const d = new Date(mtime);
  if (Number.isNaN(d.getTime())) return todayStr();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 扫描一次收件箱。返回这次真正导入了什么。 */
export async function scanOnce(settings) {
  if (state.scanning) return { skipped: true, imported: [], reason: '上一次扫描还没结束' };
  const cfg = mediaCfg(settings);
  state.scanning = true;
  state.lastScanAt = new Date().toISOString();
  const imported = [];
  try {
    fs.mkdirSync(INBOX_DIR, { recursive: true });
    let entries = [];
    try {
      entries = fs.readdirSync(INBOX_DIR, { withFileTypes: true });
    } catch (err) {
      state.lastError = err.message;
      return { imported: [], reason: err.message };
    }

    const alive = new Set();
    let scanned = 0;
    let waiting = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!isVideoFile(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      const abs = path.join(INBOX_DIR, e.name);
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      alive.add(e.name);
      scanned += 1;

      const prev = state.seen.get(e.name);
      const sameSize = prev && prev.size === stat.size;
      const hits = sameSize ? prev.hits + 1 : 0;
      state.seen.set(e.name, { size: stat.size, mtime: stat.mtimeMs, hits });
      // 连续两次大小不变、且最后修改在 3 秒前，才认为传完了
      if (hits < 1 || Date.now() - stat.mtimeMs < 3000) {
        waiting += 1;
        continue;
      }

      state.seen.delete(e.name);
      try {
        const date = cfg.dateFrom === 'today' ? todayStr() : dateFromMtime(stat.mtimeMs);
        const video = await ingest({
          tempPath: abs,
          originalName: e.name,
          mimetype: '',
          date,
          title: e.name.replace(/\.[^.]+$/, ''),
          size: stat.size,
          source: 'inbox',
        });
        const job = startProcessJob(video.id, repo.getSettings());
        imported.push({ id: video.id, file: e.name, date, size: stat.size, jobId: job.id });
        pushLog({
          id: video.id,
          file: e.name,
          date,
          size: stat.size,
          at: new Date().toISOString(),
          ok: true,
        });
      } catch (err) {
        state.lastError = err.message;
        pushLog({
          file: e.name,
          at: new Date().toISOString(),
          ok: false,
          error: err.message,
        });
      }
    }

    /* 已经不在收件箱里的，从 seen 里删掉 */
    for (const name of [...state.seen.keys()]) {
      if (!alive.has(name)) state.seen.delete(name);
    }

    return { imported, scanned, waiting };
  } finally {
    state.scanning = false;
  }
}

export function inboxStatus(settings) {
  const cfg = mediaCfg(settings);
  let files = [];
  try {
    files = fs
      .readdirSync(INBOX_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && isVideoFile(e.name) && !e.name.startsWith('.'))
      .map((e) => {
        let size = 0;
        try {
          size = fs.statSync(path.join(INBOX_DIR, e.name)).size;
        } catch {
          /* 忽略 */
        }
        return { name: e.name, size };
      });
  } catch {
    /* 忽略 */
  }
  return {
    enabled: cfg.enabled,
    dir: INBOX_DIR,
    scanSeconds: Math.round(cfg.scanMs / 1000),
    dateFrom: cfg.dateFrom,
    pending: files,
    pendingBytes: files.reduce((a, b) => a + b.size, 0),
    lastScanAt: state.lastScanAt,
    lastError: state.lastError,
    watching: !!state.timer,
    recent: readLog().slice(0, 12),
  };
}

/** 在资源管理器里打开收件箱，省得用户自己照着路径找 */
export function openInboxFolder() {
  try {
    fs.mkdirSync(INBOX_DIR, { recursive: true });
    const child = spawn('explorer.exe', [INBOX_DIR], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', () => {});
    child.unref();
    return { ok: true, dir: INBOX_DIR };
  } catch (err) {
    return { ok: false, dir: INBOX_DIR, error: err.message };
  }
}

/** 启动后台扫描 */
export function startInboxWatcher(getSettings) {
  stopInboxWatcher();
  const cfg = mediaCfg(getSettings());
  if (!cfg.enabled) return null;
  const run = async () => {
    try {
      const s = getSettings();
      if (!mediaCfg(s).enabled) return;
      const r = await scanOnce(s);
      if (r?.imported?.length) {
        console.log(`[inbox] 自动导入 ${r.imported.length} 个视频`);
      }
    } catch (err) {
      state.lastError = err.message;
      console.error('[inbox] 扫描出错：', err);
    }
  };
  state.timer = setInterval(run, cfg.scanMs);
  if (state.timer.unref) state.timer.unref();
  // 启动 5 秒后先扫一次，别让开机时堆积的文件等太久
  setTimeout(run, 5000).unref?.();
  return state.timer;
}

export function stopInboxWatcher() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/** 设置改了之后重启扫描（间隔可能变了） */
export function restartInboxWatcher(getSettings) {
  stopInboxWatcher();
  return startInboxWatcher(getSettings);
}

export { INBOX_DIR, TMP_DIR };
