/** 极薄的 fetch 封装。所有接口都返回 { ok, data } 或 { ok:false, error }。 */

class ApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, body, opts = {}) {
  const init = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (opts.signal) init.signal = opts.signal;

  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('连不上本地服务，确认 npm start 还在跑', { status: 0 });
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { ok: false, error: text.slice(0, 300) };
  }

  if (!res.ok || payload?.ok === false) {
    const message = payload?.error || `请求失败（${res.status}）`;
    throw new ApiError(message, { status: res.status, payload });
  }
  return payload?.data;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
  upload: (path, formData, opts) => request('POST', path, formData, opts),
};

export { ApiError };

/** 轮询一个后台任务直到结束 */
export async function waitForJob(jobId, { onTick, intervalMs = 900, timeoutMs = 30 * 60 * 1000 } = {}) {
  const started = Date.now();
  for (;;) {
    const { job } = await api.get(`/api/jobs/${jobId}`);
    if (onTick) onTick(job);
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new ApiError(job.error || '任务失败');
    if (Date.now() - started > timeoutMs) throw new ApiError('任务超时');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
