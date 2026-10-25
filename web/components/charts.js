/** 手写 SVG 图表。没有第三方图表库，省依赖也更好控制样式。 */

import { html } from 'htm/preact';
import { Icon } from '../lib/icons.js';
import { WEEKDAYS_SHORT, humanMinutesShort } from '../lib/format.js';

/* ---------------- 每日得分柱状图 ---------------- */

export function ScoreBars({ rows = [], height = 120, showValue = true }) {
  const max = 100;
  return html`
    <div style=${{ display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
      ${rows.map((row) => {
        const has = row.score !== null && row.score !== undefined && row.planned > 0;
        const pct = has ? Math.max(3, Math.min(100, row.score)) : 0;
        const tone = !has
          ? 'var(--surface-3)'
          : row.score >= 85
            ? 'var(--teal)'
            : row.score >= 70
              ? 'var(--accent)'
              : row.score >= 50
                ? 'var(--amber)'
                : 'var(--rose)';
        return html`
          <div style=${{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
            <div class="tiny num" style=${{ color: has ? 'var(--text-dim)' : 'var(--text-faint)', height: '14px' }}>
              ${has && showValue ? Math.round(row.score) : ''}
            </div>
            <div
              title=${has ? `${row.label}  得分 ${Math.round(row.score)}  ·  完成 ${humanMinutesShort(row.achieved)} / ${humanMinutesShort(row.planned)}` : `${row.label} 没有记录`}
              style=${{
                width: '100%',
                height: `${(pct / 100) * height}px`,
                minHeight: '4px',
                background: tone,
                borderRadius: '5px 5px 2px 2px',
                transition: 'height 500ms cubic-bezier(.22,.61,.36,1)',
                opacity: has ? 1 : 0.5,
              }}
            ></div>
            <div class="tiny faint" style=${{ whiteSpace: 'nowrap' }}>${row.shortLabel || row.label}</div>
          </div>
        `;
      })}
    </div>
  `;
}

/* ---------------- 热力图 ---------------- */

export function Heatmap({ cells = [] }) {
  if (!cells.length) return null;
  // 对齐到周一开头
  const first = new Date(cells[0].date);
  const lead = (first.getDay() + 6) % 7;
  const padded = [...Array.from({ length: lead }, () => null), ...cells];

  const levelOf = (cell) => {
    if (!cell || cell.score === null || cell.score === undefined) return cell ? '0' : '';
    if (cell.score >= 90) return '4';
    if (cell.score >= 75) return '3';
    if (cell.score >= 60) return '2';
    if (cell.score > 0) return '1';
    return '0';
  };

  return html`
    <div>
      <div style=${{ display: 'flex', gap: '3px' }}>
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '3px', marginRight: '3px' }}>
          ${WEEKDAYS_SHORT.map(
            (w, i) =>
              html`<div class="tiny faint" style=${{ height: '12px', lineHeight: '12px', fontSize: '9px', width: '11px', textAlign: 'center', opacity: i % 2 ? 1 : 0 }}>
                ${w}
              </div>`,
          )}
        </div>
        <div class="heatmap">
          ${padded.map((cell) =>
            cell
              ? html`<div
                  class="hm-cell"
                  data-level=${levelOf(cell)}
                  title=${`${cell.date}  ${cell.score === null ? '无记录' : `得分 ${Math.round(cell.score)}`}${cell.hasVideo ? ' · 有视频' : ''}`}
                ></div>`
              : html`<div></div>`,
          )}
        </div>
      </div>
      <div class="row tiny faint" style=${{ marginTop: '8px', gap: '4px', justifyContent: 'flex-end' }}>
        <span>低</span>
        <div class="hm-cell" data-level="0"></div>
        <div class="hm-cell" data-level="1"></div>
        <div class="hm-cell" data-level="2"></div>
        <div class="hm-cell" data-level="3"></div>
        <div class="hm-cell" data-level="4"></div>
        <span>高</span>
      </div>
    </div>
  `;
}

/* ---------------- 环形分布 ---------------- */

const PALETTE = ['var(--accent)', 'var(--teal)', 'var(--gold)', 'var(--violet)', 'var(--amber)', 'var(--rose)'];

export function Donut({ segments = [], size = 132, stroke = 15, centerLabel, centerSub }) {
  const total = segments.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let acc = 0;

  return html`
    <div class="row" style=${{ gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
      <div class="ring" style=${{ width: `${size}px`, height: `${size}px` }}>
        <svg width=${size} height=${size}>
          <circle cx=${size / 2} cy=${size / 2} r=${radius} fill="none" stroke="var(--surface-3)" stroke-width=${stroke} />
          ${total > 0 &&
          segments.map((seg, i) => {
            const frac = (Number(seg.value) || 0) / total;
            const dash = frac * circumference;
            const offset = -acc * circumference;
            acc += frac;
            return html`<circle
              cx=${size / 2}
              cy=${size / 2}
              r=${radius}
              fill="none"
              stroke=${seg.color || PALETTE[i % PALETTE.length]}
              stroke-width=${stroke}
              stroke-dasharray=${`${Math.max(0, dash - 2)} ${circumference}`}
              stroke-dashoffset=${offset}
              style=${{ transition: 'stroke-dasharray 600ms cubic-bezier(.22,.61,.36,1)' }}
            ></circle>`;
          })}
        </svg>
        <div class="ring-label">
          <div>
            <b style=${{ fontSize: '17px' }}>${centerLabel ?? ''}</b>
            ${centerSub ? html`<span>${centerSub}</span>` : null}
          </div>
        </div>
      </div>
      <div class="stack-sm" style=${{ flex: '1 1 120px', minWidth: '120px', gap: '6px' }}>
        ${segments.map(
          (seg, i) => html`
            <div class="row" style=${{ gap: '7px', fontSize: '12.5px' }}>
              <span
                style=${{
                  width: '8px',
                  height: '8px',
                  borderRadius: '2px',
                  background: seg.color || PALETTE[i % PALETTE.length],
                  flex: '0 0 auto',
                }}
              ></span>
              <span class="muted" style=${{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${seg.label}</span>
              <span class="num faint">${seg.display ?? `${Math.round((Number(seg.value) || 0))}`}</span>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

/* ---------------- 横向条形列表 ---------------- */

export function HBars({ rows = [], onRowClick }) {
  return html`
    <div class="stack-sm" style=${{ gap: '10px' }}>
      ${rows.map((row) => {
        const pct = Math.max(0, Math.min(100, Number(row.rate) || 0));
        const tone = pct >= 85 ? 'teal' : pct >= 70 ? '' : pct >= 50 ? 'amber' : 'rose';
        return html`
          <div
            class="stack-sm"
            style=${{ gap: '4px', cursor: onRowClick ? 'pointer' : 'default' }}
            onClick=${onRowClick ? () => onRowClick(row) : undefined}
          >
            <div class="row-between" style=${{ gap: '10px' }}>
              <span class="sm" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ${row.label}
                ${row.tag ? html`<span class="cat-tag" style=${{ marginLeft: '6px' }}>${row.tag}</span>` : null}
              </span>
              <span class="sm num faint nowrap">${row.right ?? `${Math.round(pct)}%`}</span>
            </div>
            <div class=${`bar ${tone}`}><i style=${{ width: `${pct}%` }}></i></div>
          </div>
        `;
      })}
    </div>
  `;
}

/* ---------------- 迷你趋势线 ---------------- */

export function Sparkline({ values = [], width = 120, height = 32, color = 'var(--accent)' }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;

  return html`
    <svg width=${width} height=${height} style=${{ display: 'block', overflow: 'visible' }}>
      <path d=${area} fill=${color} opacity="0.12" />
      <path d=${path} fill="none" stroke=${color} stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  `;
}

/* ---------------- 能力状态点 ---------------- */

export function CapabilityDot({ ok, label }) {
  return html`
    <div class="row" style=${{ gap: '6px', fontSize: '12.5px' }}>
      <span
        style=${{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: ok ? 'var(--teal)' : 'var(--text-faint)',
          flex: '0 0 auto',
          boxShadow: ok ? '0 0 0 3px color-mix(in srgb, var(--teal) 16%, transparent)' : 'none',
        }}
      ></span>
      <span class=${ok ? '' : 'faint'}>${label}</span>
      ${ok ? null : html`<${Icon} name="alert" size=${11} />`}
    </div>
  `;
}
