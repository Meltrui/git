/**
 * 极简后台任务表。
 * 视频转写、AI 分析、周视频合成这类耗时操作都跑成 job，
 * 前端轮询 /api/jobs/:id，不会把 HTTP 请求卡死。
 */

const jobs = new Map();
let seq = 0;

const MAX_KEEP = 80;

export function createJob(type, label = '') {
  seq += 1;
  const id = `job-${Date.now().toString(36)}-${seq}`;
  const job = {
    id,
    type,
    label,
    status: 'running',
    progress: 0,
    step: '',
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  trim();
  return job;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs(limit = 20) {
  return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

export function hasRunning(type, predicate) {
  for (const job of jobs.values()) {
    if (job.status === 'running' && job.type === type && (!predicate || predicate(job))) return job;
  }
  return null;
}

/** 把一个 async 函数包装成 job */
export function runJob(type, label, fn) {
  const job = createJob(type, label);
  Promise.resolve()
    .then(() => fn((patch) => updateJob(job.id, patch)))
    .then((result) => {
      updateJob(job.id, { status: 'done', progress: 100, result, step: '完成' });
      if (typeof job.onDone === 'function') job.onDone(result);
    })
    .catch((err) => {
      console.error(`[job ${type}] 失败：`, err);
      updateJob(job.id, { status: 'failed', error: err.message || String(err) });
    });
  return job;
}

function trim() {
  if (jobs.size <= MAX_KEEP) return;
  const sorted = [...jobs.values()].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  while (jobs.size > MAX_KEEP) {
    const victim = sorted.shift();
    if (!victim) break;
    jobs.delete(victim.id);
  }
}
