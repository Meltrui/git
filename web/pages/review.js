/** 复盘页：周总结、趋势、AI 调整建议 */

import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import { api, useS, useFetch, useAction, toastOk } from '../store.js';
import {
  todayStr,
  isoWeekOf,
  shiftWeekKey,
  prettyDate,
  weekdayName,
  humanMinutes,
  humanMinutesShort,
} from '../lib/format.js';
import { Notice, Empty, Loading, Ring, Segmented, Modal, Field } from '../components/ui.js';
import { ScoreBars, Donut, HBars } from '../components/charts.js';

export function ReviewPage() {
  const s = useS();
  const today = s.boot?.today || todayStr();
  const [weekKey, setWeekKey] = useState(() => s.params?.w || isoWeekOf(today));
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const { run } = useAction();

  const { data, loading, reload } = useFetch(() => api.get(`/api/weeks/${weekKey}`), [weekKey]);

  if (loading && !data) return html`<${Loading} text="正在统计这一周…" />`;

  const days = data?.days || [];
  const dates = data?.dates || [];
  const agg = data?.aggregates;
  const report = data?.report;
  const settings = data?.settings || s.boot?.settings;
  const blockLabels = Object.fromEntries((settings?.blocks || []).map((b) => [b.id, b.label]));
  const isCurrentWeek = weekKey === isoWeekOf(today);

  const rows = dates.map((d, i) => {
    const day = days[i];
    const score = day?.score?.score;
    return {
      date: d,
      label: prettyDate(d, { withWeekday: false }),
      shortLabel: weekdayName(d).replace('周', ''),
      score: day?.items?.length ? score : null,
      planned: day?.score?.plannedMinutes || 0,
      achieved: day?.score?.achievedMinutes || 0,
      hasVideo: (data?.videos || []).some((v) => v.date === d),
    };
  });

  const generate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await api.post(`/api/weeks/${weekKey}/report`);
      await reload();
      toastOk('周总结已生成');
      return res;
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const applyAdjustment = async (adjId) => {
    const res = await run(() => api.post(`/api/weeks/${weekKey}/apply`, { adjustmentId: adjId }));
    if (res) {
      await reload();
      if (res.applied) toastOk(res.message);
    }
  };

  const generateReel = async () => {
    const res = await run(() => api.post(`/api/weeks/${weekKey}/reel`));
    if (res?.job) toastOk('正在合成周回顾视频，去「视频」页看进度');
  };

  if (!agg || agg.dayCount === 0) {
    return html`
      <div class="fade-in stack" style=${{ gap: '16px' }}>
        ${renderWeekNav(weekKey, isCurrentWeek, setWeekKey, dates)}
        <${Empty}
          icon="chart"
          title="这一周还没有任何记录"
          description="先按计划执行几天、每天打个卡，这里就会长出有意义的复盘。"
        />
      </div>
    `;
  }

  const ai = report?.ai;
  const applied = new Set(report?.appliedAdjustments || []);

  return html`
    <div class="fade-in stack" style=${{ gap: '16px' }}>
      ${renderWeekNav(weekKey, isCurrentWeek, setWeekKey, dates)}

      <div class="grid-4">
        <div class="card stat">
          <div class="stat-label"><${Icon} name="target" size=${13} />平均得分</div>
          <div class="stat-value">${agg.avgScore}</div>
          <div class="stat-sub">${agg.dayCount} / 7 天有记录</div>
        </div>
        <div class="card stat">
          <div class="stat-label"><${Icon} name="clock" size=${13} />时长完成率</div>
          <div class="stat-value">${agg.completionRate}<small>%</small></div>
          <div class="stat-sub">${humanMinutes(agg.achievedMinutes)} / ${humanMinutes(agg.plannedMinutes)}</div>
        </div>
        <div class="card stat">
          <div class="stat-label"><${Icon} name="check" size=${13} />条目完成率</div>
          <div class="stat-value">${agg.itemCompletionRate}<small>%</small></div>
          <div class="stat-sub">完成 ${agg.doneItems} · 未完成 ${agg.missedItems}</div>
        </div>
        <div class="card stat">
          <div class="stat-label"><${Icon} name="film" size=${13} />总结视频</div>
          <div class="stat-value">${agg.videoDays}<small>/ 天</small></div>
          <div class="stat-sub">
            ${agg.videoDays >= 5 ? '自我观测没断线' : '记录越完整，复盘越准'}
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <${Icon} name="chart" size=${16} />
            <h2>每日得分</h2>
            <span class="hint">柱高 = 加权完成度</span>
          </div>
          <div class="card-body">
            <${ScoreBars} rows=${rows} height=${132} />
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <${Icon} name="grid" size=${16} />
            <h2>时间去向</h2>
            <span class="hint">${agg.achievedMinutes >= 5 ? '按实际完成时长' : '完成记录还少，先按计划时长'}</span>
          </div>
          <div class="card-body">
            ${Object.keys(agg.byCategory).length
              ? html`<${Donut}
                  segments=${renderCategorySegments(agg)}
                  centerLabel=${String(
                    Math.round((agg.achievedMinutes >= 5 ? agg.achievedMinutes : agg.plannedMinutes) / 60),
                  )}
                  centerSub="小时"
                />`
              : html`<div class="tiny faint">还没有数据</div>`}
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <${Icon} name="list" size=${16} />
            <h2>各指标完成率</h2>
            <span class="hint">${agg.byIndicator.length} 个指标</span>
          </div>
          <div class="card-body">
            <${HBars}
              rows=${agg.byIndicator
                .slice()
                .sort((a, b) => a.rate - b.rate)
                .map((r) => ({
                  label: r.title,
                  tag: r.category,
                  rate: r.rate,
                  right: `${r.done}/${r.appearances} 天`,
                }))}
            />
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <${Icon} name="clock" size=${16} />
            <h2>时段效率</h2>
            <span class="hint">哪个块最容易掉链子</span>
          </div>
          <div class="card-body stack" style=${{ gap: '16px' }}>
            <${HBars}
              rows=${agg.byBlock
                .slice()
                .sort((a, b) => a.rate - b.rate)
                .map((b) => ({
                  label: blockLabels[b.blockId] || (b.blockId === 'anytime' ? '随时可做' : b.blockId),
                  rate: b.rate,
                  right: `${Math.round(b.achieved)}/${Math.round(b.planned)} 分`,
                }))}
            />
            ${agg.causes.length
              ? html`
                  <div class="stack-sm">
                    <div class="section-title">未完成原因</div>
                    ${agg.causes.map(
                      (c) => html`
                        <div class="row-between" style=${{ fontSize: '12.5px' }}>
                          <span class="muted">${c.cause}</span>
                          <span class="num faint">${c.count} 次</span>
                        </div>
                      `,
                    )}
                  </div>
                `
              : null}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <${Icon} name="sparkles" size=${16} />
          <h2>本周复盘与调整建议</h2>
          <span class="hint">
            ${report
              ? `${ai?.source === 'ai' ? ai.model || '大模型' : '规则引擎'} · ${report.generatedAt?.slice(0, 16).replace('T', ' ')}`
              : '还没生成'}
          </span>
          <div class="row" style=${{ marginLeft: 'auto', gap: '6px' }}>
            ${ai?.adjustments?.length
              ? html`<button class="btn btn-sm" onClick=${generateReel}>
                  <${Icon} name="film" size=${13} /> 合成周回顾
                </button>`
              : null}
            <button class="btn btn-sm btn-primary" onClick=${generate} disabled=${generating}>
              ${generating ? html`<span class="spinner"></span>` : html`<${Icon} name="sparkles" size=${13} />`}
              ${report ? '重新生成' : '生成周总结'}
            </button>
          </div>
        </div>
        <div class="card-body stack">
          ${genError ? html`<${Notice} level="danger">${genError}</${Notice}>` : null}
          ${generating
            ? html`<div class="loading-block">
                <span class="spinner spinner-lg"></span>
                <span>正在读这一周的数据、算因果、准备调整方案…（大模型通常要 20–60 秒）</span>
              </div>`
            : null}

          ${!report && !generating
            ? html`<${Empty}
                icon="sparkles"
                title="还没有生成这一周的复盘"
                description="点右上角「生成周总结」。没配大模型也能用——会用内置规则引擎算完成率、找短板、给可落地的调整。"
              />`
            : null}

          ${ai && !generating
            ? html`
                ${report?.error ? html`<${Notice} level="warn">${report.error}</${Notice}>` : null}
                ${report?.note ? html`<${Notice} level="info">${report.note}</${Notice}>` : null}

                <div class="report-narrative">
                  ${String(ai.narrative || '')
                    .split(/\n{2,}/)
                    .map((p) => html`<p>${p}</p>`)}
                </div>

                <div class="grid-2">
                  ${ai.highlights?.length
                    ? html`<div class="stack-sm">
                        <div class="section-title">做得好的</div>
                        <ul class="list-bullets good">
                          ${ai.highlights.map((h) => html`<li>${h}</li>`)}
                        </ul>
                      </div>`
                    : null}
                  ${ai.problems?.length
                    ? html`<div class="stack-sm">
                        <div class="section-title">要正视的</div>
                        <ul class="list-bullets bad">
                          ${ai.problems.map((h) => html`<li>${h}</li>`)}
                        </ul>
                      </div>`
                    : null}
                </div>

                ${ai.patterns?.length
                  ? html`<div class="stack-sm">
                      <div class="section-title">从数据里看出来的规律</div>
                      <ul class="list-bullets violet">
                        ${ai.patterns.map((h) => html`<li>${h}</li>`)}
                      </ul>
                    </div>`
                  : null}

                ${ai.adjustments?.length
                  ? html`
                      <div class="stack-sm">
                        <div class="section-title">下周的调整（点右边的按钮直接生效）</div>
                        ${ai.adjustments.map(
                          (adj) => html`
                            <div class=${`adjustment ${applied.has(adj.id) ? 'applied' : ''}`}>
                              <div class="adj-main">
                                <span class="adj-title">${adj.title}</span>
                                ${adj.reason ? html`<span class="adj-reason">${adj.reason}</span>` : null}
                              </div>
                              ${applied.has(adj.id)
                                ? html`<span class="chip done"><${Icon} name="check" size=${11} /> 已采纳</span>`
                                : adj.type === 'note'
                                  ? html`<span class="chip plain">手动执行</span>`
                                  : html`<button class="btn btn-sm btn-primary" onClick=${() => applyAdjustment(adj.id)}>
                                      采纳
                                    </button>`}
                            </div>
                          `,
                        )}
                      </div>
                    `
                  : null}

                ${ai.nextWeekFocus?.length
                  ? html`
                      <${Notice} level="ok">
                        下周就抓 ${ai.nextWeekFocus.length} 件事：${ai.nextWeekFocus.join(' · ')}
                      </${Notice}>
                    `
                  : null}

                <div class="row wrap" style=${{ gap: '10px', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
                  <span class="tiny faint">
                    风险指数 ${ai.riskScore ?? '-'} / 100
                    ${ai.bestDay ? ` · 最好的一天 ${ai.bestDay.slice(5)}` : ''}
                    ${ai.toughestDay ? ` · 最难的一天 ${ai.toughestDay.slice(5)}` : ''}
                  </span>
                  <div class="spacer"></div>
                  <button class="btn btn-sm" onClick=${() => setCoachOpen(true)}>
                    <${Icon} name="mic" size=${13} /> 追问教练
                  </button>
                </div>
              `
            : null}
        </div>
      </div>

      ${coachOpen ? html`<${CoachModal} weekKey=${weekKey} onClose=${() => setCoachOpen(false)} />` : null}
    </div>
  `;
}

/* ------------------------------------------------------------------ */

/** 分类时长分布：完成记录太少时退回用计划时长，避免出现误导性的「一个满圈」 */
function renderCategorySegments(agg) {
  const useAchieved = agg.achievedMinutes >= 5;
  return Object.entries(agg.byCategory)
    .map(([label, v]) => {
      const minutes = useAchieved ? v.achievedMinutes : v.plannedMinutes;
      return { label, value: Math.round(minutes), display: humanMinutesShort(minutes) };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

function renderWeekNav(weekKey, isCurrentWeek, setWeekKey, dates) {
  return html`
    <div class="row-between wrap" style=${{ gap: '10px' }}>
      <div class="row" style=${{ gap: '6px' }}>
        <button class="btn btn-icon" onClick=${() => setWeekKey(shiftWeekKey(weekKey, -1))}>
          <${Icon} name="chevronLeft" size=${16} />
        </button>
        <div class="stack-sm" style=${{ gap: '0px', minWidth: '140px', textAlign: 'center' }}>
          <strong style=${{ fontSize: '15px' }}>${weekKey.slice(5)} 周${isCurrentWeek ? '（本周）' : ''}</strong>
          <span class="tiny faint">${dates[0]?.slice(5)} ~ ${dates[6]?.slice(5)}</span>
        </div>
        <button class="btn btn-icon" onClick=${() => setWeekKey(shiftWeekKey(weekKey, 1))}>
          <${Icon} name="chevronRight" size=${16} />
        </button>
      </div>
    </div>
  `;
}

function CoachModal({ weekKey, onClose }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer('');
    try {
      const res = await api.post('/api/ai/coach', { question: question.trim(), weekKey });
      setAnswer(res.answer);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return html`
    <${Modal}
      open
      wide
      title="问教练"
      onClose=${onClose}
      footer=${html`
        <button class="btn" onClick=${onClose}>关闭</button>
        <button class="btn btn-primary" onClick=${ask} disabled=${loading || !question.trim()}>
          ${loading ? html`<span class="spinner"></span>` : html`<${Icon} name="send" size=${14} />`} 提问
        </button>
      `}
    >
      <${Field} label="想问什么" desc="它会读你最近 14 天的打卡数据、原因统计和作息安排">
        <textarea
          class="textarea"
          value=${question}
          placeholder="比如：为什么我下午的学习总是做不完？我该不该把体育锻炼挪到晚上？"
          onInput=${(e) => setQuestion(e.target.value)}
        ></textarea>
      </${Field}>
      ${error ? html`<${Notice} level="danger">${error}</${Notice}>` : null}
      ${loading ? html`<div class="loading-block"><span class="spinner spinner-lg"></span> 想一想…</div>` : null}
      ${answer
        ? html`<div class="report-narrative" style=${{ fontSize: '14px' }}>
            ${answer.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}
          </div>`
        : null}
    </${Modal}>
  `;
}
