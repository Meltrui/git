/** 计划页：任务池、本周排程、AI 拆解与重排 */

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import { api, useS, useFetch, useAction, refreshBoot, toastOk, navigate } from '../store.js';
import {
  todayStr,
  addDays,
  prettyDate,
  weekdayName,
  weekDatesOf,
  isoWeekOf,
  shiftWeekKey,
  weekStartFromKey,
  humanMinutes,
  humanMinutesShort,
  diffDays,
  toMinutes,
} from '../lib/format.js';
import {
  Modal,
  Field,
  Notice,
  Empty,
  Loading,
  Bar,
  confirmDialog,
  Segmented,
} from '../components/ui.js';

const CATEGORIES = ['数学', '英语', '408', '政治', '身体', '复盘', '其他'];
const PRIORITY_LABEL = { high: '高', mid: '中', low: '低' };

export function PlanPage() {
  const s = useS();
  const today = s.boot?.today || todayStr();
  const [weekKey, setWeekKey] = useState(() => s.params?.w || isoWeekOf(today));
  const { pending, run } = useAction();

  const { data, loading, reload, setData } = useFetch(() => api.get(`/api/weeks/${weekKey}`), [weekKey]);
  const tasks = useFetch(() => api.get('/api/tasks'), []);

  const [showAdd, setShowAdd] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState(null);

  /* ---------------- 操作 ---------------- */

  const generateWeek = async () => {
    const ok = await confirmDialog({
      title: '生成本周计划',
      message: '会按当前作息和任务池，把这一周 7 天全部重排一遍。已经打过的卡不受影响。',
      confirmText: '生成',
    });
    if (!ok) return;
    const res = await run(() => api.post(`/api/weeks/${weekKey}/generate`));
    if (res) {
      await reload();
      refreshBoot();
      toastOk('本周计划已生成');
    }
  };

  const createTask = async (payload) => {
    const res = await run(() => api.post('/api/tasks', payload), { okMessage: '已加入任务池' });
    if (res) {
      await tasks.reload();
      setShowAdd(false);
    }
  };

  const updateTask = async (id, patch) => {
    const res = await run(() => api.patch(`/api/tasks/${id}`, patch));
    if (res) await tasks.reload();
  };

  const deleteTask = async (id) => {
    const ok = await confirmDialog({ title: '删除任务', message: '确定要从任务池里删掉这个任务？', danger: true, confirmText: '删除' });
    if (!ok) return;
    const res = await run(() => api.del(`/api/tasks/${id}`), { okMessage: '已删除' });
    if (res) await tasks.reload();
  };

  if (loading && !data) return html`<${Loading} text="正在读取这一周…" />`;

  const days = data?.days || [];
  const agg = data?.aggregates;
  const isCurrentWeek = weekKey === isoWeekOf(today);
  const dates = data?.dates || weekDatesOf(today);

  return html`
    <div class="fade-in stack" style=${{ gap: '16px' }}>
      <div class="row-between wrap" style=${{ gap: '10px' }}>
        <div class="row" style=${{ gap: '6px' }}>
          <button class="btn btn-icon" onClick=${() => setWeekKey(shiftWeekKey(weekKey, -1))}>
            <${Icon} name="chevronLeft" size=${16} />
          </button>
          <div class="stack-sm" style=${{ gap: '0px', minWidth: '132px', textAlign: 'center' }}>
            <strong style=${{ fontSize: '15px' }}>
              ${weekKey.slice(5)} 周${isCurrentWeek ? '（本周）' : ''}
            </strong>
            <span class="tiny faint">
              ${dates[0]?.slice(5)} ~ ${dates[6]?.slice(5)}
            </span>
          </div>
          <button class="btn btn-icon" onClick=${() => setWeekKey(shiftWeekKey(weekKey, 1))}>
            <${Icon} name="chevronRight" size=${16} />
          </button>
        </div>
        <div class="row wrap" style=${{ gap: '8px' }}>
          <button class="btn" onClick=${generateWeek} disabled=${pending}>
            <${Icon} name="wand" size=${15} /> 生成本周计划
          </button>
          <button class="btn btn-primary" onClick=${() => setShowAdd(true)}>
            <${Icon} name="plus" size=${15} /> 加任务
          </button>
        </div>
      </div>

      ${agg
        ? html`
            <div class="grid-4">
              <div class="card stat">
                <div class="stat-label"><${Icon} name="target" size=${13} />平均得分</div>
                <div class="stat-value">${agg.avgScore}</div>
                <div class="stat-sub">${agg.dayCount} 天有记录</div>
              </div>
              <div class="card stat">
                <div class="stat-label"><${Icon} name="clock" size=${13} />计划时长</div>
                <div class="stat-value">${Math.round(agg.plannedMinutes / 60)}<small>小时</small></div>
                <div class="stat-sub">完成 ${Math.round(agg.achievedMinutes / 60)} 小时</div>
              </div>
              <div class="card stat">
                <div class="stat-label"><${Icon} name="check" size=${13} />条目完成率</div>
                <div class="stat-value">${agg.itemCompletionRate}<small>%</small></div>
                <div class="stat-sub">${agg.doneItems} 完成 / ${agg.missedItems} 未完成</div>
              </div>
              <div class="card stat">
                <div class="stat-label"><${Icon} name="flame" size=${13} />连击</div>
                <div class="stat-value">${data?.streak?.current ?? 0}<small>天</small></div>
                <div class="stat-sub">最长 ${data?.streak?.best ?? 0} 天</div>
              </div>
            </div>
          `
        : null}

      <div class="card">
        <div class="card-head">
          <${Icon} name="calendar" size=${16} />
          <h2>本周排程</h2>
          <span class="hint">点某一天进去执行</span>
        </div>
        <div class="card-body stack-sm" style=${{ gap: '8px' }}>
          ${days.map((day, i) => renderDayRow(day, dates[i], today))}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <${Icon} name="list" size=${16} />
          <h2>任务池</h2>
          <span class="hint">${(tasks.data?.tasks || []).filter((t) => t.status === 'open').length} 个待做</span>
          <button class="btn btn-sm" onClick=${() => setShowBreakdown(true)} style=${{ marginLeft: '8px' }}>
            <${Icon} name="sparkles" size=${13} /> AI 拆解目标
          </button>
        </div>
        <div class="card-body">
          ${tasks.loading
            ? html`<${Loading} text="读取任务…" />`
            : (tasks.data?.tasks || []).length
              ? html`<div class="stack-sm" style=${{ gap: '6px' }}>
                  ${(tasks.data.tasks || []).map((task) =>
                    renderTask(task, { onUpdate: updateTask, onDelete: deleteTask, onEdit: setEditing }),
                  )}
                </div>`
              : html`<${Empty}
                  icon="list"
                  title="任务池是空的"
                  description="任务池里放「具体要做什么」——比如「高数第 3 讲 听课」「C 语言指针」。规划器会把它们塞进学习块的空档。"
                  action=${html`<button class="btn btn-primary btn-sm" onClick=${() => setShowAdd(true)}>加第一个任务</button>`}
                />`}
        </div>
      </div>

      ${showAdd
        ? html`<${TaskModal} onClose=${() => setShowAdd(false)} onSubmit=${createTask} pending=${pending} />`
        : null}
      ${editing
        ? html`<${TaskModal}
            task=${editing}
            onClose=${() => setEditing(null)}
            onSubmit=${async (payload) => {
              await updateTask(editing.id, payload);
              setEditing(null);
            }}
            pending=${pending}
          />`
        : null}
      ${showBreakdown
        ? html`<${BreakdownModal}
            onClose=${() => setShowBreakdown(false)}
            onApply=${async (list) => {
              const res = await run(() => api.post('/api/tasks/breakdown/apply', { tasks: list }), {
                okMessage: `已加入 ${list.length} 个任务`,
              });
              if (res) {
                await tasks.reload();
                setShowBreakdown(false);
              }
            }}
          />`
        : null}
    </div>
  `;
}

/* ------------------------------------------------------------------ */

function renderDayRow(day, date, today) {
  const items = day?.items || [];
  const blocks = day?.blocks || [];
  const score = day?.score?.score;
  const planned = day?.capacity
    ? Object.values(day.capacity).reduce((sum, c) => sum + (c.used || 0), 0)
    : 0;
  const isToday = date === today;
  const warn = (day?.warnings || []).filter((w) => w.level === 'warn');

  return html`
    <button
      class="card"
      style=${{
        display: 'block',
        textAlign: 'left',
        padding: items.length ? '10px 12px' : '7px 12px',
        borderColor: isToday ? 'var(--accent)' : undefined,
        background: isToday ? 'var(--accent-soft)' : 'var(--surface-2)',
        boxShadow: 'none',
        width: '100%',
        opacity: items.length ? 1 : 0.75,
      }}
      onClick=${() => navigate('today', { d: date })}
    >
      <div class="row-between" style=${{ gap: '10px', marginBottom: items.length ? '8px' : '0' }}>
        <div class="row" style=${{ gap: '8px' }}>
          <span class="sm strong" style=${{ minWidth: '86px' }}>${prettyDate(date)}</span>
          ${isToday ? html`<span class="chip active" style=${{ fontSize: '10px' }}>今天</span>` : null}
          ${warn.length ? html`<span class="chip amber" style=${{ fontSize: '10px' }}><${Icon} name="alert" size=${10} /> ${warn.length}</span>` : null}
          ${!items.length ? html`<span class="tiny faint">还没生成计划 · 点这里去生成</span>` : null}
        </div>
        <div class="row" style=${{ gap: '10px' }}>
          <span class="tiny faint num">${items.length} 项 · ${humanMinutesShort(planned)}</span>
          ${score !== undefined && score !== null && items.length
            ? html`<span
                class="chip"
                style=${{
                  fontSize: '10px',
                  background:
                    score >= 85 ? 'var(--teal-soft)' : score >= 70 ? 'var(--accent-soft)' : score > 0 ? 'var(--amber-soft)' : 'var(--surface-3)',
                  color: score >= 85 ? 'var(--teal)' : score >= 70 ? 'var(--accent)' : score > 0 ? 'var(--amber)' : 'var(--text-faint)',
                }}
              >
                ${Math.round(score)}
              </span>`
            : null}
        </div>
      </div>
      ${items.length
        ? html`<div class="row wrap" style=${{ gap: '4px' }}>
            ${items.slice(0, 14).map((item) => {
              const st = item.record?.status || 'pending';
              return html`
                <span
                  class="chip"
                  style=${{
                    fontSize: '10.5px',
                    background: st === 'done' ? 'var(--teal-soft)' : st === 'missed' ? 'var(--rose-soft)' : 'var(--surface-3)',
                    color: st === 'done' ? 'var(--teal)' : st === 'missed' ? 'var(--rose)' : 'var(--text-dim)',
                  }}
                >
                  ${item.title.slice(0, 10)}
                </span>
              `;
            })}
            ${items.length > 14 ? html`<span class="tiny faint">+${items.length - 14}</span>` : null}
          </div>`
        : html`<div class="tiny faint" style=${{ marginTop: '4px' }}>还没生成计划</div>`}
    </button>
  `;
}

function renderTask(task, { onUpdate, onDelete, onEdit }) {
  const overdue = task.dueDate && diffDays(todayStr(), task.dueDate) < 0 && task.status === 'open';
  const dueSoon = task.dueDate && diffDays(todayStr(), task.dueDate) === 0;
  const done = task.status === 'done';

  return html`
    <div
      class="item"
      style=${{
        border: '1px solid var(--border)',
        borderRadius: '10px',
        background: 'var(--surface-2)',
        opacity: done ? 0.55 : 1,
      }}
    >
      <button class="tick" onClick=${() => onUpdate(task.id, { status: done ? 'open' : 'done' })}>
        <${Icon} name="check" size=${12} />
      </button>
      <div class="item-main" style=${{ cursor: 'default' }}>
        <div class="item-titleline">
          <span class="item-title" style=${{ textDecoration: done ? 'line-through' : 'none' }}>${task.title}</span>
          <span class="cat-tag">${task.category}</span>
          <span
            class="chip"
            style=${{
              fontSize: '10px',
              background: task.priority === 'high' ? 'var(--rose-soft)' : task.priority === 'mid' ? 'var(--amber-soft)' : 'var(--surface-3)',
              color: task.priority === 'high' ? 'var(--rose)' : task.priority === 'mid' ? 'var(--amber)' : 'var(--text-faint)',
            }}
          >
            ${PRIORITY_LABEL[task.priority]}
          </span>
          ${task.pinned ? html`<span class="chip gold" style=${{ fontSize: '10px' }}>锁定</span>` : null}
          ${overdue ? html`<span class="chip missed" style=${{ fontSize: '10px' }}>逾期</span>` : null}
          ${dueSoon ? html`<span class="chip amber" style=${{ fontSize: '10px' }}>今天到期</span>` : null}
        </div>
        <div class="item-extra">
          <span class="num">${task.minutes} 分钟</span>
          ${task.dueDate ? html`<span>· 截止 ${task.dueDate.slice(5)}</span>` : null}
          ${task.progress ? html`<span>· 已做 ${task.progress} 分钟</span>` : null}
          ${task.lastScheduledAt ? html`<span>· 上次排 ${task.lastScheduledAt.slice(5)}</span>` : null}
        </div>
      </div>
      <div class="item-actions">
        <button class="btn btn-icon" title="编辑" onClick=${() => onEdit(task)}>
          <${Icon} name="edit" size=${14} />
        </button>
        <button class="btn btn-icon" title="删除" onClick=${() => onDelete(task.id)}>
          <${Icon} name="trash" size=${14} />
        </button>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */

function TaskModal({ task, onClose, onSubmit, pending }) {
  const [title, setTitle] = useState(task?.title || '');
  const [category, setCategory] = useState(task?.category || '数学');
  const [minutes, setMinutes] = useState(task?.minutes ?? 45);
  const [priority, setPriority] = useState(task?.priority || 'mid');
  const [dueDate, setDueDate] = useState(task?.dueDate || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [pinned, setPinned] = useState(!!task?.pinned);

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      category,
      minutes: Number(minutes) || 45,
      priority,
      dueDate: dueDate || null,
      notes,
      pinned,
    });
  };

  return html`
    <${Modal}
      open
      title=${task ? '编辑任务' : '加一个任务'}
      onClose=${onClose}
      footer=${html`
        <button class="btn" onClick=${onClose}>取消</button>
        <button class="btn btn-primary" onClick=${submit} disabled=${pending || !title.trim()}>
          ${pending ? html`<span class="spinner"></span>` : task ? '保存' : '加入任务池'}
        </button>
      `}
    >
      <${Field} label="做什么" desc="越具体越好：「高数第 3 讲 听课 + 做例题」，别写「学数学」">
        <input
          class="input"
          autofocus
          value=${title}
          placeholder="比如：C 语言 指针与数组 第 1 节"
          onInput=${(e) => setTitle(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && submit()}
        />
      </${Field}>
      <div class="grid-2 tight">
        <${Field} label="科目">
          <select class="select" value=${category} onChange=${(e) => setCategory(e.target.value)}>
            ${CATEGORIES.map((c) => html`<option value=${c}>${c}</option>`)}
          </select>
        </${Field}>
        <${Field} label="预估时长（分钟）">
          <input
            class="input"
            type="number"
            min="10"
            max="240"
            step="5"
            value=${minutes}
            onInput=${(e) => setMinutes(e.target.value)}
          />
        </${Field}>
      </div>
      <div class="grid-2 tight">
        <${Field} label="优先级">
          <div class="row" style=${{ gap: '4px' }}>
            ${['high', 'mid', 'low'].map(
              (p) => html`<button
                class=${`btn btn-sm ${priority === p ? 'btn-primary' : ''}`}
                onClick=${() => setPriority(p)}
              >
                ${PRIORITY_LABEL[p]}
              </button>`,
            )}
          </div>
        </${Field}>
        <${Field} label="截止日期" desc="留空表示不急">
          <input class="input" type="date" value=${dueDate} onInput=${(e) => setDueDate(e.target.value)} />
        </${Field}>
      </div>
      <${Field} label="备注">
        <textarea class="textarea" style=${{ minHeight: '56px' }} value=${notes} onInput=${(e) => setNotes(e.target.value)}></textarea>
      </${Field}>
      <label class="row" style=${{ gap: '8px', cursor: 'pointer' }}>
        <input type="checkbox" checked=${pinned} onChange=${(e) => setPinned(e.target.checked)} />
        <span class="sm">锁定：优先排进计划，不会被其他任务挤掉</span>
      </label>
    </${Modal}>
  `;
}

/* ------------------------------------------------------------------ */

function BreakdownModal({ onClose, onApply }) {
  const [goal, setGoal] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runBreakdown = async () => {
    if (goal.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/api/tasks/breakdown', { goal: goal.trim(), dueDate: dueDate || null });
      setResult(res);
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
      title="把一个大目标拆成能塞进日程的任务"
      onClose=${onClose}
      footer=${html`
        <button class="btn" onClick=${onClose}>关闭</button>
        ${result?.tasks?.length
          ? html`<button class="btn btn-primary" onClick=${() => onApply(result.tasks)}>
              全部加入任务池（${result.tasks.length}）
            </button>`
          : html`<button class="btn btn-primary" onClick=${runBreakdown} disabled=${loading || goal.trim().length < 2}>
              ${loading ? html`<span class="spinner"></span>` : html`<${Icon} name="sparkles" size=${14} />`} 拆解
            </button>`}
      `}
    >
      <${Field} label="要学什么" desc="例如「高数上册 极限与连续，两周内过一遍并做完课后题」">
        <textarea
          class="textarea"
          value=${goal}
          placeholder="把目标写清楚：范围、要产出什么、大概多久"
          onInput=${(e) => setGoal(e.target.value)}
        ></textarea>
      </${Field}>
      <${Field} label="希望什么时候完成">
        <input class="input" type="date" value=${dueDate} onInput=${(e) => setDueDate(e.target.value)} />
      </${Field}>

      ${error ? html`<${Notice} level="danger">${error}</${Notice}>` : null}
      ${loading
        ? html`<div class="loading-block"><span class="spinner spinner-lg"></span> 正在拆解…</div>`
        : null}
      ${result
        ? html`
            ${result.note ? html`<${Notice} level="info">${result.note}</${Notice}>` : null}
            <div class="stack-sm">
              ${result.tasks.map(
                (t, i) => html`
                  <div class="row" style=${{ gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span class="avatar-ring" style=${{ width: '22px', height: '22px', fontSize: '11px' }}>${i + 1}</span>
                    <span class="sm" style=${{ flex: '1 1 auto' }}>${t.title}</span>
                    <span class="cat-tag">${t.category}</span>
                    <span class="chip plain">${t.minutes} 分钟</span>
                  </div>
                `,
              )}
            </div>
          `
        : null}
    </${Modal}>
  `;
}
