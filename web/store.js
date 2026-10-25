/** 全局状态 + 轻量 store + 通用 hooks + toast */

import { useEffect, useReducer, useRef, useState, useCallback } from 'preact/hooks';
import { api, ApiError, waitForJob } from './lib/api.js';

const listeners = new Set();

export const S = {
  boot: null,
  loading: true,
  fatal: null,
  route: 'today',
  params: {},
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  toasts: [],
  jobs: [],
};

export function setS(patch) {
  Object.assign(S, patch);
  emit();
}

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (err) {
      console.error('[store] listener error', err);
    }
  }
}

/** 订阅全局状态；返回最新的 S */
export function useS() {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => listeners.delete(bump);
  }, []);
  return S;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

export const ROUTES = [
  { id: 'today', label: '今日', icon: 'target' },
  { id: 'plan', label: '计划', icon: 'calendar' },
  { id: 'review', label: '复盘', icon: 'chart' },
  { id: 'videos', label: '视频', icon: 'film' },
  { id: 'settings', label: '设置', icon: 'sliders' },
];

function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [route, ...rest] = path.split('/');
  const params = {};
  for (const kv of (query || '').split('&')) {
    if (!kv) continue;
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return {
    route: ROUTES.some((r) => r.id === route) ? route : 'today',
    params: { ...params, sub: rest[0] || '' },
  };
}

export function navigate(route, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  location.hash = `#/${route}${qs ? `?${qs}` : ''}`;
}

export function initRouter() {
  const apply = () => {
    const { route, params } = parseHash();
    setS({ route, params });
    window.scrollTo({ top: 0 });
  };
  window.addEventListener('hashchange', apply);
  apply();
}

/* ------------------------------------------------------------------ */
/* 主题                                                                */
/* ------------------------------------------------------------------ */

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('anchor-theme', theme);
  } catch {
    /* 忽略 */
  }
  setS({ theme });
}

export function toggleTheme() {
  applyTheme(S.theme === 'dark' ? 'light' : 'dark');
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastSeq = 0;

export function toast(message, type = 'info', ttl = 2800) {
  const id = ++toastSeq;
  setS({ toasts: [...S.toasts, { id, message, type }] });
  setTimeout(() => {
    setS({ toasts: S.toasts.filter((t) => t.id !== id) });
  }, ttl);
}

export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err', 4200);

/** 把一次异步操作包起来：自动 toast 错误、自动 loading 状态 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (fn, { okMessage, errorPrefix = '' } = {}) => {
    setPending(true);
    try {
      const result = await fn();
      if (okMessage) toastOk(okMessage);
      return result;
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      const msg = err instanceof ApiError ? err.message : err?.message || '出错了';
      toastErr(errorPrefix ? `${errorPrefix}：${msg}` : msg);
      return null;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, run, setPending };
}

/* ------------------------------------------------------------------ */
/* 数据 hooks                                                          */
/* ------------------------------------------------------------------ */

/**
 * 拉一份数据。deps 变化时自动重拉。
 */
export function useFetch(fetcher, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const my = ++seq.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fetcher();
        if (seq.current === my) setState({ data, loading: false, error: null });
        return data;
      } catch (err) {
        if (seq.current === my) setState({ data: null, loading: false, error: err });
        return null;
      }
    },
    deps,
  );

  useEffect(() => {
    if (!skip) load();
  }, deps);

  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: d })) };
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

export async function loadBoot() {
  try {
    const boot = await api.get('/api/bootstrap');
    setS({ boot, loading: false, fatal: null });
    if (boot.settings?.profile?.name) {
      document.title = `Anchor · 锚点`;
    }
    return boot;
  } catch (err) {
    setS({ loading: false, fatal: err.message || '启动失败' });
    return null;
  }
}

/** 局部刷新 boot（比如打卡后更新连击、今日得分） */
export async function refreshBoot() {
  try {
    const boot = await api.get('/api/bootstrap');
    setS({ boot });
  } catch {
    /* 静默失败 */
  }
}

export async function apiCall(fn) {
  return fn(api);
}

export { api, ApiError, waitForJob };
