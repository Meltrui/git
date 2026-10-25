/** 通用 UI 组件。全部基于 Preact + htm，无构建。 */

import { html } from 'htm/preact';
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import { S, setS, useS, toast } from '../store.js';

/* ---------------- 分数环 ---------------- */

export function Ring({ value = 0, size = 68, stroke = 6, label, sub, tone }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const offset = circumference * (1 - pct / 100);
  const color =
    tone === 'teal'
      ? 'var(--teal)'
      : tone === 'gold'
        ? 'var(--gold)'
        : tone === 'amber'
          ? 'var(--amber)'
          : tone === 'rose'
            ? 'var(--rose)'
            : 'var(--accent)';

  return html`
    <div class="ring" style=${{ width: `${size}px`, height: `${size}px` }}>
      <svg width=${size} height=${size}>
        <circle class="ring-track" cx=${size / 2} cy=${size / 2} r=${radius} fill="none" stroke-width=${stroke} />
        <circle
          class="ring-fill"
          cx=${size / 2}
          cy=${size / 2}
          r=${radius}
          fill="none"
          stroke-width=${stroke}
          stroke-dasharray=${circumference}
          stroke-dashoffset=${offset}
          style=${{ stroke: color }}
        />
      </svg>
      <div class="ring-label">
        <div>
          <b style=${{ color }}>${label ?? Math.round(pct)}</b>
          ${sub ? html`<span>${sub}</span>` : null}
        </div>
      </div>
    </div>
  `;
}

/* ---------------- 进度条 ---------------- */

export function Bar({ value = 0, tone = '', thin = false }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return html`<div class=${`bar ${thin ? 'thin' : ''} ${tone}`}><i style=${{ width: `${pct}%` }}></i></div>`;
}

/* ---------------- 统计卡 ---------------- */

export function Stat({ label, value, unit, sub, icon, tone }) {
  return html`
    <div class="card stat">
      <div class="stat-label">
        ${icon ? html`<${Icon} name=${icon} size=${13} />` : null}
        ${label}
      </div>
      <div class="stat-value" style=${tone ? { color: `var(--${tone})` } : undefined}>
        ${value}${unit ? html`<small>${unit}</small>` : null}
      </div>
      ${sub ? html`<div class="stat-sub">${sub}</div>` : null}
    </div>
  `;
}

/* ---------------- 开关 ---------------- */

export function Switch({ checked, onChange, label, desc }) {
  const node = html`
    <button
      type="button"
      class=${`switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked=${checked}
      onClick=${() => onChange(!checked)}
    ></button>
  `;
  if (!label) return node;
  return html`
    <div class="row-between" style=${{ gap: '16px' }}>
      <div class="stack-sm" style=${{ gap: '2px', minWidth: 0 }}>
        <span class="strong">${label}</span>
        ${desc ? html`<span class="tiny faint">${desc}</span>` : null}
      </div>
      ${node}
    </div>
  `;
}

/* ---------------- 表单 ---------------- */

export function Field({ label, desc, children, hint }) {
  return html`
    <div class="field">
      ${label ? html`<label>${label}</label>` : null}
      ${children}
      ${desc ? html`<div class="desc">${desc}</div>` : null}
      ${hint ? html`<div class="desc faint">${hint}</div>` : null}
    </div>
  `;
}

export function NumberStepper({ value, onChange, step = 1, min = 0, max = 9999, unit }) {
  const set = (v) => onChange(Math.max(min, Math.min(max, v)));
  return html`
    <div class="stepper">
      <button type="button" onClick=${() => set((Number(value) || 0) - step)} aria-label="减少">
        <${Icon} name="minus" size=${12} />
      </button>
      <div class="val">${value}${unit ? html`<small> ${unit}</small>` : null}</div>
      <button type="button" onClick=${() => set((Number(value) || 0) + step)} aria-label="增加">
        <${Icon} name="plus" size=${12} />
      </button>
    </div>
  `;
}

export function Segmented({ options, value, onChange }) {
  return html`
    <div class="row wrap" style=${{ gap: '4px', background: 'var(--surface-2)', padding: '3px', borderRadius: '10px', display: 'inline-flex' }}>
      ${options.map(
        (opt) => html`
          <button
            type="button"
            class="btn btn-sm"
            style=${{
              background: opt.value === value ? 'var(--accent)' : 'transparent',
              color: opt.value === value ? '#fff' : 'var(--text-dim)',
              borderColor: 'transparent',
            }}
            onClick=${() => onChange(opt.value)}
          >
            ${opt.label}
          </button>
        `,
      )}
    </div>
  `;
}

/* ---------------- 弹窗 ---------------- */

export function Modal({ open, title, onClose, children, footer, wide, closable = true }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && closable) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, closable]);

  if (!open) return null;
  return html`
    <div class="overlay" onClick=${(e) => e.target === e.currentTarget && closable && onClose?.()}>
      <div class=${`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        ${title
          ? html`
              <div class="modal-head">
                <h3>${title}</h3>
                <div class="spacer"></div>
                ${closable
                  ? html`<button class="btn btn-icon" onClick=${onClose} aria-label="关闭"><${Icon} name="x" size=${16} /></button>`
                  : null}
              </div>
            `
          : null}
        <div class="modal-body">${children}</div>
        ${footer ? html`<div class="modal-foot">${footer}</div>` : null}
      </div>
    </div>
  `;
}

/* ---------------- 确认框（Promise 版） ---------------- */

let confirmSeq = 0;

export function confirmDialog({ title = '确认', message = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const id = ++confirmSeq;
    setS({ confirmBox: { id, title, message, confirmText, cancelText, danger, resolve } });
  });
}

export function ConfirmHost() {
  const s = useS();
  const box = s.confirmBox;
  if (!box) return null;
  const close = (result) => {
    setS({ confirmBox: null });
    box.resolve(result);
  };
  return html`
    <${Modal}
      open
      title=${box.title}
      onClose=${() => close(false)}
      footer=${html`
        <button class="btn" onClick=${() => close(false)}>${box.cancelText}</button>
        <button
          class=${`btn ${box.danger ? 'btn-danger' : 'btn-primary'}`}
          onClick=${() => close(true)}
        >
          ${box.confirmText}
        </button>
      `}
    >
      <p class="muted" style=${{ lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>${box.message}</p>
    <//>
  `;
}

/* ---------------- Toast 容器 ---------------- */

export function ToastHost() {
  const s = useS();
  if (!s.toasts?.length) return null;
  return html`
    <div class="toasts">
      ${s.toasts.map(
        (t) => html`
          <div class=${`toast ${t.type}`}>
            <${Icon} name=${t.type === 'ok' ? 'check' : t.type === 'err' ? 'alert' : 'info'} size=${15} />
            <span>${t.message}</span>
          </div>
        `,
      )}
    </div>
  `;
}

/* ---------------- 空状态 ---------------- */

export function Empty({ icon = 'info', title, description, action }) {
  return html`
    <div class="empty">
      <div class="empty-icon"><${Icon} name=${icon} size=${20} /></div>
      <strong>${title}</strong>
      ${description ? html`<p>${description}</p>` : null}
      ${action || null}
    </div>
  `;
}

export function Spinner({ large }) {
  return html`<div class=${`spinner ${large ? 'spinner-lg' : ''}`}></div>`;
}

export function Loading({ text = '加载中…' }) {
  return html`<div class="loading-block"><${Spinner} /> <span>${text}</span></div>`;
}

/* ---------------- 通知条 ---------------- */

export function Notice({ level = 'info', icon, children, action }) {
  const iconName = icon || (level === 'danger' ? 'alert' : level === 'warn' ? 'alert' : level === 'ok' ? 'check' : 'info');
  return html`
    <div class=${`notice ${level}`}>
      <${Icon} name=${iconName} size=${15} />
      <div style=${{ flex: '1 1 auto', minWidth: 0 }}>${children}</div>
      ${action || null}
    </div>
  `;
}

/* ---------------- 状态标签 ---------------- */

export function StatusChip({ status }) {
  const map = {
    done: '已完成',
    partial: '部分完成',
    missed: '未完成',
    pending: '未确认',
    skipped: '已跳过',
  };
  return html`<span class=${`chip ${status}`}><i class="dot"></i>${map[status] || '未确认'}</span>`;
}

/* ---------------- 时间实时刷新 ---------------- */

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* ---------------- 文件下载 ---------------- */

export function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------------- 折叠区 ---------------- */

export function Collapsible({ title, hint, defaultOpen = false, children, right }) {
  const [open, setOpen] = useState(defaultOpen);
  return html`
    <div class="card">
      <div class="card-head" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(!open)}>
        <${Icon} name=${open ? 'chevronDown' : 'chevronRight'} size=${15} />
        <h2>${title}</h2>
        ${hint ? html`<span class="hint">${hint}</span>` : null}
        ${right ? html`<div onClick=${(e) => e.stopPropagation()}>${right}</div>` : null}
      </div>
      ${open ? html`<div class="card-body">${children}</div>` : null}
    </div>
  `;
}

export { toast, Icon };
