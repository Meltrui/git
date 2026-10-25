import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（server/src 往上两级） */
export const ROOT = path.resolve(here, '..', '..');

/** 数据目录，可用 ANCHOR_DATA_DIR 覆盖（便于放到网盘/移动硬盘） */
export const DATA_DIR = process.env.ANCHOR_DATA_DIR
  ? path.resolve(process.env.ANCHOR_DATA_DIR)
  : path.join(ROOT, 'data');

export const DB_FILE = path.join(DATA_DIR, 'anchor.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const VIDEO_DIR = path.join(DATA_DIR, 'videos');
export const REEL_DIR = path.join(VIDEO_DIR, 'reels');
export const THUMB_DIR = path.join(VIDEO_DIR, 'thumbs');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const ASR_DIR = path.join(ROOT, '.asr');

/** 前端构建产物 */
export const WEB_DIST = path.join(ROOT, 'web', 'dist');

export const PORT = Number(process.env.ANCHOR_PORT || 8787);
export const HOST = process.env.ANCHOR_HOST || '0.0.0.0';

const ALL_DIRS = [DATA_DIR, BACKUP_DIR, VIDEO_DIR, REEL_DIR, THUMB_DIR, TMP_DIR];

export function ensureDirs() {
  for (const dir of ALL_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
