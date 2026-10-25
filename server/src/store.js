import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE, BACKUP_DIR, ensureDirs } from './paths.js';
import { defaultSettings, DATA_VERSION } from './defaults.js';

/**
 * 极简 JSON 存储。
 * - 单用户单进程，全量内存 + 原子落盘，数据量在几十年内都不会成问题
 * - 写入走 tmp → rename，避免断电写坏
 * - 每天首次启动留一份备份，最多保留 60 份
 */

let db = null;
let dirty = false;
let saveTimer = null;
let flushing = false;

const nowIso = () => new Date().toISOString();

function emptyDb() {
  return {
    version: DATA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: defaultSettings(),
    days: {},
    tasks: [],
    videos: [],
    weeks: {},
    meta: {},
  };
}

/** 把缺失的字段补齐（用于版本升级后兼容老数据） */
function migrate(raw) {
  const base = emptyDb();
  const out = { ...base, ...raw };
  out.settings = deepMerge(base.settings, raw.settings || {});
  out.days = out.days || {};
  out.tasks = out.tasks || [];
  out.videos = out.videos || [];
  out.weeks = out.weeks || {};
  out.meta = out.meta || {};
  out.version = DATA_VERSION;
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 用 defaults 做骨架合并：保留用户值，补齐新字段 */
export function deepMerge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override;
  const out = { ...base };
  if (!isPlainObject(override)) return out;
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

function backupIfNeeded(raw) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `anchor-${today}.json`);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, JSON.stringify(raw), 'utf8');
    }
    // 只留最近 60 份
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('anchor-') && f.endsWith('.json'))
      .sort();
    while (files.length > 60) {
      const victim = files.shift();
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, victim));
      } catch {
        /* 忽略 */
      }
    }
  } catch (err) {
    console.warn('[store] 备份失败：', err.message);
  }
}

export function load() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      backupIfNeeded(raw);
      db = migrate(raw);
    } catch (err) {
      console.error('[store] 数据文件损坏，已保留原文件并重建：', err.message);
      const broken = `${DB_FILE}.broken-${Date.now()}`;
      try {
        fs.copyFileSync(DB_FILE, broken);
      } catch {
        /* 忽略 */
      }
      db = emptyDb();
      dirty = true;
    }
  } else {
    db = emptyDb();
    dirty = true;
  }
  saveNow();
  return db;
}

export function get() {
  if (!db) load();
  return db;
}

/** 修改数据：同步执行 fn，然后延迟落盘 */
export function mutate(fn) {
  const data = get();
  const result = fn(data);
  data.updatedAt = nowIso();
  dirty = true;
  scheduleSave();
  return result;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 250);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

export function saveNow() {
  if (!db) return;
  if (flushing) return;
  flushing = true;
  try {
    ensureDirs();
    const tmp = `${DB_FILE}.tmp`;
    const json = JSON.stringify(db, null, 2);
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, DB_FILE);
    dirty = false;
  } catch (err) {
    console.error('[store] 落盘失败：', err.message);
  } finally {
    flushing = false;
  }
}

export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (dirty) saveNow();
}

/** 导出快照（给备份/下载用） */
export function snapshot() {
  return JSON.parse(JSON.stringify(get()));
}

/** 用快照整体替换（导入备份用） */
export function replaceAll(next) {
  db = migrate(next);
  dirty = true;
  saveNow();
  return db;
}

export function stats() {
  const data = get();
  let bytes = 0;
  try {
    bytes = fs.statSync(DB_FILE).size;
  } catch {
    /* 忽略 */
  }
  return {
    path: DB_FILE,
    bytes,
    days: Object.keys(data.days).length,
    tasks: data.tasks.length,
    videos: data.videos.length,
    weeks: Object.keys(data.weeks).length,
    updatedAt: data.updatedAt,
  };
}
