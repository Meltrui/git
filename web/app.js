/** Anchor · 锚点 — 应用外壳、路由、全局副作用 */

import { html } from 'htm/preact';
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './lib/icons.js';
import { prettyDate, todayStr, humanMinutes } from './lib/format.js';
import { ROUTES, S, useS, setS, initRouter, loadBoot, navigate, toggleTheme, toast } from './store.js';
import { Ring, ToastHost, ConfirmHost, Loading, Spinner } from './components/ui.js';
import { TodayPage } from './pages/today.js';
import { PlanPage } from './pages/plan.js';
import { ReviewPage } from './pages/review.js';
import { VideosPage } from './pages/videos.js';
import { SettingsPage } from './pages/settings.js';

const PAGES = {
  today: TodayPage,
  plan: PlanPage,
  review: ReviewPage,
  videos: VideosPage,
  settings: SettingsPage,
};

const TITLES = {
  today: '今日',
  plan: '计划',
  review: '复盘',
  videos: '视频',
  settings: '设置',
};

/* ------------------------------------------------------------------ */
/* 侧栏                                                                */
/* ------------------------------------------------------------------ */

function Sidebar() {
  const s = useS();
  const boot = s.boot;
  const day = boot?.day;
  const score = day?.score?.score ?? 0;
  const done = day?.score?.completed ?? 0;
  const total = day?.score?.total ?? 0;
  const streak = boot?.streak?.current ?? 0;

  return html`
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
            <path d="M12 3.5v10.2" />
            <circle cx="12" cy="16.6" r="2.2" />
            <path d="M6.4 7.6a8 8 0 1011.2 0" />
          </svg>
        </div>
        <div class="brand-text">
          <strong>Anchor</strong>
          <span>锚点 · 自律</span>
        </div>
      </div>

      <nav class="nav">
        ${ROUTES.map(
          (r) => html`
            <button
              class=${`nav-item ${s.route === r.id ? 'active' : ''}`}
              onClick=${() => navigate(r.id)}
            >
              <${Icon} name=${r.icon} size=${17} />
              <span>${r.label}</span>
              ${r.id === 'plan' && boot?.counts?.openTasks
                ? html`<span class="nav-badge">${boot.counts.openTasks}</span>`
                : r.id === 'videos' && boot?.counts?.videos
                  ? html`<span class="nav-badge">${boot.counts.videos}</span>`
                  : null}
            </button>
          `,
        )}
      </nav>

      <div class="sidebar-foot">
        <div class="row-between">
          <div class="row" style=${{ gap: '8px' }}>
            <${Ring} value=${score} size=${38} stroke=${4} sub=${null} label=${Math.round(score)} />
            <div class="stack-sm" style=${{ gap: '1px' }}>
              <span class="tiny faint">今天的进度</span>
              <span class="sm strong num">${done}/${total} 项</span>
            </div>
          </div>
        </div>
        <div class="sf-row" style=${{ paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
          <span class="row" style=${{ gap: '5px' }}>
            <${Icon} name="flame" size=${13} /> 连击
          </span>
          <b>${streak}<span class="tiny faint"> 天</span></b>
        </div>
        ${boot?.exam
          ? html`<div class="sf-row">
              <span>距 ${boot.settings?.profile?.examName || '考试'}</span>
              <b>${boot.exam.daysLeft}<span class="tiny faint"> 天</span></b>
            </div>`
          : null}
      </div>
    </aside>
  `;
}

/* ------------------------------------------------------------------ */
/* 顶栏                                                                */
/* ------------------------------------------------------------------ */

function Topbar() {
  const s = useS();
  const boot = s.boot;
  const isToday = s.route === 'today';
  const dateLabel = isToday ? prettyDate(boot?.today || todayStr()) : TITLES[s.route] || '';

  return html`
    <header class="topbar">
      <div class="stack-sm" style=${{ gap: '0px', minWidth: 0 }}>
        <h1 style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          ${isToday ? dateLabel : TITLES[s.route]}
          ${isToday && boot?.day?.closed
            ? html`<span class="chip done" style=${{ fontSize: '10px' }}>已收工</span>`
            : null}
        </h1>
        ${isToday && boot?.profile
          ? null
          : html`<span class="sub">${isToday ? '' : subTitle(s.route, boot)}</span>`}
      </div>
      <div class="topbar-actions">
        ${isToday && boot?.day?.capacity?.study
          ? html`<span class="chip plain nowrap" title="今天学习块的使用情况">
              学习 ${humanMinutes(boot.day.capacity.study.used)} / ${humanMinutes(boot.day.capacity.study.total)}
            </span>`
          : null}
        <button class="btn btn-icon" title="切换深浅色" onClick=${toggleTheme}>
          <${Icon} name=${s.theme === 'dark' ? 'sun' : 'moon'} size=${16} />
        </button>
        <button class="btn btn-icon" title="刷新" onClick=${() => loadBoot()}>
          <${Icon} name="refresh" size=${16} />
        </button>
      </div>
    </header>
  `;
}

function subTitle(route, boot) {
  if (route === 'plan') return '任务池 / 本周排程 / 计划诊断';
  if (route === 'review') return '周总结 · 趋势 · 调整建议';
  if (route === 'videos') return '每日总结视频 · 转写 · AI 对照分析';
  if (route === 'settings') return '作息 / 指标 / AI / 数据';
  return '';
}

/* ------------------------------------------------------------------ */
/* 移动端底部导航                                                      */
/* ------------------------------------------------------------------ */

function Tabbar() {
  const s = useS();
  return html`
    <nav class="tabbar">
      ${ROUTES.map(
        (r) => html`
          <button class=${s.route === r.id ? 'active' : ''} onClick=${() => navigate(r.id)}>
            <${Icon} name=${r.icon} size=${20} />
            <span>${r.label}</span>
          </button>
        `,
      )}
    </nav>
  `;
}

/* ------------------------------------------------------------------ */
/* 提醒：SSE + 系统通知                                                */
/* ------------------------------------------------------------------ */

function useReminders() {
  const retryRef = useRef(0);
  useEffect(() => {
    let es = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource('/api/events');
      } catch {
        return;
      }
      es.addEventListener('message', (evt) => {
        retryRef.current = 0;
        try {
          const data = JSON.parse(evt.data);
          handleReminder(data);
        } catch {
          /* 忽略 */
        }
      });
      es.addEventListener('error', () => {
        try {
          es.close();
        } catch {
          /* 忽略 */
        }
        const wait = Math.min(30000, 2000 * (retryRef.current + 1));
        retryRef.current += 1;
        setTimeout(connect, wait);
      });
    };

    connect();
    return () => {
      closed = true;
      try {
        es?.close();
      } catch {
        /* 忽略 */
      }
    };
  }, []);
}

function handleReminder(evt) {
  if (!evt || evt.type === 'test') {
    toast(evt?.body || '提醒通道正常', 'ok');
    return;
  }
  toast(`${evt.title} · ${evt.body}`, 'info', 6000);

  if (S.boot?.settings?.reminder?.desktopNotification === false) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(evt.title || 'Anchor', { body: evt.body || '', tag: evt.id, silent: false });
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ */
/* 根组件                                                              */
/* ------------------------------------------------------------------ */

function App() {
  const s = useS();
  useReminders();

  useEffect(() => {
    initRouter();
    loadBoot();
    const t = setInterval(() => {
      // 每 5 分钟轻刷一次连击和今日进度
      if (document.visibilityState === 'visible') loadBoot();
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  if (s.loading) {
    return html`<div style=${{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div class="stack" style=${{ alignItems: 'center', gap: '14px' }}>
        <div class="brand-mark" style=${{ width: '46px', height: '46px', borderRadius: '14px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" style=${{ width: '24px', height: '24px' }}>
            <path d="M12 3.5v10.2" /><circle cx="12" cy="16.6" r="2.2" /><path d="M6.4 7.6a8 8 0 1011.2 0" />
          </svg>
        </div>
        <${Spinner} />
        <span class="sm faint">正在读取本地数据…</span>
      </div>
    </div>`;
  }

  if (s.fatal) {
    return html`
      <div style=${{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
        <div class="card card-pad stack" style=${{ maxWidth: '460px' }}>
          <div class="row" style=${{ gap: '10px', color: 'var(--rose)' }}>
            <${Icon} name="alert" size=${18} />
            <strong>连接不上本地服务</strong>
          </div>
          <p class="sm muted" style=${{ lineHeight: 1.75 }}>
            ${s.fatal}<br /><br />
            请确认终端里 <code class="mono">npm start</code> 还在运行，然后刷新页面。
          </p>
          <button class="btn btn-primary" onClick=${() => location.reload()}>重新连接</button>
        </div>
      </div>
    `;
  }

  const Page = PAGES[s.route] || TodayPage;

  return html`
    <div class="shell">
      <${Sidebar} />
      <div class="main">
        <${Topbar} />
        <main class="content">
          <${Page} />
        </main>
      </div>
      <${Tabbar} />
    </div>
    <${ToastHost} />
    <${ConfirmHost} />
  `;
}

render(html`<${App} />`, document.getElementById('root'));
