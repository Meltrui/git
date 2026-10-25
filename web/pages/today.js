/** 今日页：时间轴打卡、未完成标记、日终确认 */

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import {
  api,
  S,
  useS,
  useFetch,
  useAction,
  refreshBoot,
  toastOk,
  toastErr,
  navigate,
} from '../store.js';
import {
  todayStr,
  prettyDate,
  weekdayName,
  toMinutes,
  nowMinutes,
  humanMinutes,
  humanMinutesShort,
  humanDuration,
  statusLabel,
  weekDatesOf,
  weekdayIndex,
} from '../lib/format.js';
import {
  Ring,
  Bar,
  Modal,
  Notice,
  Field,
  NumberStepper,
  StatusChip,
  Empty,
  Loading,
  useNow,
  confirmDialog,
  Icon as UIcon,
} from '../components/ui.js';
import { VideoUploader } from '../components/video-upload.js';

const CAUSES = [
  '时间不够',
  '状态不好 / 犯困',
  '临时有事被打断',
  '任务太难卡住了',
  '计划本身不合理',
  '手机/娱乐分心',
];

const MOOD_LABELS = { 1: '很糟', 2: '偏低', 3: '一般', 4: '不错', 5: '很好' };

/* ------------------------------------------------------------------ */

export function TodayPage() {
  const s = useS();
  const paramDate = /^\d{4}-\d{2}-\d{2}$/.test(s.params?.d || '') ? s.params.d : '';
  const [date, setDate] = useState(paramDate || s.boot?.today || todayStr());
  const now = useNow(30000);
  const { pending, run } = useAction();

  useEffect(() => {
    if (paramDate && paramDate !== date) setDate(paramDate);
  }, [paramDate]);

  const { data, loading, error, setData, reload } = useFetch(() => api.get(`/api/days/${date}`), [date]);

  const [openItem, setOpenItem] = useState(null);
  const [showAdvice, setShowAdvice] = useState(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [addBlock, setAddBlock] = useState(null);

  const today = s.boot?.today || todayStr();
  const isToday = date === today;
  const day = data?.day;
  const settings = data?.settings || s.boot?.settings;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // 日期变化后同步一下顶栏数据
  useEffect(() => {
    if (isToday && day) {
      // 只更新外壳里的进度，不打断当前页面数据
      const boot = S.boot;
      if (boot && boot.day && boot.day.date === day.date) {
        // 保持
      }
    }
  }, [date, isToday, day?.date]);

  if (loading && !day) return html`<${Loading} text="正在打开这一天…" />`;
  if (error) {
    return html`<${Notice} level="danger">读取失败：${error.message}</${Notice}>`;
  }
  if (!day) return html`<${Empty} icon="calendar" title="没有数据" />`;

  const items = day.items || [];
  const blockDefs = (day.blocks?.length ? day.blocks : settings?.blocks || []).filter(
    (b) => !Array.isArray(b.days) || b.days.includes(weekdayIndex(date)),
  );
  const anytime = items.filter((i) => !i.blockId);

  const applyDay = (nextDay) => setData({ ...data, day: nextDay });

  /* ---------------- 操作 ---------------- */

  const setRecord = async (itemId, patch, { silent = false } = {}) => {
    const res = await run(() => api.patch(`/api/days/${date}/items/${itemId}/record`, patch), {
      okMessage: silent ? undefined : undefined,
    });
    if (res?.day) {
      applyDay(res.day);
      if (isToday) refreshBoot();
    }
    return res;
  };

  const toggleDone = async (item) => {
    const status = item.record?.status;
    if (status === 'done') await setRecord(item.id, { status: 'pending', value: 0 });
    else await setRecord(item.id, { status: 'done' });
  };

  const markMissed = async (item, cause) => {
    await setRecord(item.id, { status: 'missed', cause });
    toastOk('已标记未完成');
  };

  const bulkDone = async (blockId, itemIds) => {
    const res = await run(() =>
      api.post(`/api/days/${date}/bulk`, { action: 'done', blockId, itemIds }),
    );
    if (res?.day) {
      applyDay(res.day);
      if (isToday) refreshBoot();
      toastOk(`已确认 ${res.affected} 项`);
    }
  };

  const regenerate = async () => {
    const ok = await confirmDialog({
      title: '重新生成今天的计划',
      message: '会按当前作息和任务池重排一遍。已经打过的卡、填过的备注都保留。',
      confirmText: '重新生成',
    });
    if (!ok) return;
    const res = await run(() => api.post(`/api/days/${date}/regenerate`));
    if (res?.day) {
      applyDay(res.day);
      toastOk('计划已重排');
    }
  };

  const closeDay = async () => {
    const pendingItems = items.filter((i) => (i.record?.status || 'pending') === 'pending');
    const ok = await confirmDialog({
      title: isToday ? '关闭今天' : `关闭 ${date}`,
      message:
        pendingItems.length > 0
          ? `还有 ${pendingItems.length} 项没确认，关闭后会全部标记为「未完成」：\n${pendingItems
              .slice(0, 6)
              .map((i) => `· ${i.title}`)
              .join('\n')}${pendingItems.length > 6 ? '\n…' : ''}`
          : '所有条目都已确认，关闭后就进入复盘阶段。',
      confirmText: '关闭这一天',
    });
    if (!ok) return;
    const res = await run(() => api.post(`/api/days/${date}/close`, { autoMiss: true }));
    if (res?.day) {
      applyDay(res.day);
      refreshBoot();
      toastOk(res.missed ? `已收工，${res.missed} 项标记为未完成` : '已收工');
    }
  };

  const reopen = async () => {
    const res = await run(() => api.post(`/api/days/${date}/reopen`));
    if (res?.day) {
      applyDay(res.day);
      refreshBoot();
      toastOk('已重新打开');
    }
  };

  const askAdvice = async () => {
    setAdviceLoading(true);
    setShowAdvice({ loading: true });
    try {
      const res = await api.post('/api/ai/plan-advice', { date });
      setShowAdvice(res);
    } catch (err) {
      setShowAdvice({ error: err.message });
    } finally {
      setAdviceLoading(false);
    }
  };

  const applyAdvice = async (advice) => {
    const res = await run(() =>
      api.post('/api/ai/plan-advice/apply', {
        date,
        order: advice.order,
        changes: advice.changes,
      }),
    );
    if (res?.day) {
      applyDay(res.day);
      setShowAdvice(null);
      toastOk('计划顺序已更新');
    }
  };

  const saveJournal = async (patch) => {
    const res = await run(() => api.patch(`/api/days/${date}/journal`, patch));
    if (res?.journal) {
      setData({ ...data, day: { ...day, journal: res.journal } });
    }
  };

  const score = day.score?.score ?? 0;
  const doneCount = day.score?.completed ?? 0;
  const totalCount = day.score?.total ?? 0;
  const studyUsed = day.capacity?.study?.used ?? 0;
  const studyTotal = day.capacity?.study?.total ?? 0;

  const setValue = async (item, v) => {
    if (v === (Number(item.record?.value) || 0)) return;
    await setRecord(item.id, { value: v });
  };

  const itemCtx = {
    date,
    today,
    nowMin,
    onToggle: toggleDone,
    onOpen: (item) => setOpenItem(item),
    onValue: setValue,
    onMissed: markMissed,
    onBulkDone: (blockId) => bulkDone(blockId),
    onAdd: (blockId) => setAddBlock({ blockId }),
  };

  /* ---------------- 渲染 ---------------- */

  return html`
    <div class="fade-in stack" style=${{ gap: '16px' }}>
      ${renderWeekStrip(date, today, setDate, day.score?.score)}

      <div class="hero">
        <${Ring}
          value=${score}
          size=${82}
          stroke=${7}
          label=${Math.round(score)}
          tone=${score >= 85 ? 'teal' : score >= 70 ? undefined : score >= 50 ? 'amber' : 'rose'}
        />
        <div class="hero-main">
          <div class="row wrap" style=${{ gap: '8px', alignItems: 'baseline' }}>
            <span class="hero-title">${prettyDate(date)}</span>
            ${day.closed ? html`<span class="chip done">已收工</span>` : null}
            ${isToday ? html`<span class="chip active">今天</span>` : html`<button class="link-btn" onClick=${() => setDate(today)}>回到今天</button>`}
          </div>
          <div class="hero-sub">
            ${doneCount} / ${totalCount} 项已确认 ·
            ${studyTotal ? `学习块 ${humanMinutes(studyUsed)} / ${humanMinutes(studyTotal)}` : '没有学习块'}
          </div>
          <div class="hero-tags">
            ${(day.score?.byStatus?.missed ?? 0) > 0
              ? html`<span class="chip missed"><i class="dot"></i>${day.score.byStatus.missed} 项未完成</span>`
              : null}
            ${(day.score?.byStatus?.pending ?? 0) > 0
              ? html`<span class="chip pending"><i class="dot"></i>${day.score.byStatus.pending} 项待确认</span>`
              : null}
            ${(data.videos || []).length > 0
              ? html`<span class="chip violet"><${Icon} name="film" size=${11} /> 已录 ${data.videos.length} 段视频</span>`
              : null}
          </div>
        </div>
        <div class="row wrap" style=${{ gap: '8px' }}>
          <button class="btn" onClick=${() => setAddBlock({})}>
            <${Icon} name="plus" size=${15} /> 加一条
          </button>
          <button class="btn" onClick=${regenerate} disabled=${pending}>
            <${Icon} name="refresh" size=${15} /> 重排今天
          </button>
          <button class="btn" onClick=${askAdvice} disabled=${adviceLoading}>
            ${adviceLoading
              ? html`<span class="spinner"></span>`
              : html`<${Icon} name="sparkles" size=${15} />`}
            AI 看今天
          </button>
        </div>
      </div>

      ${renderWarnings(day.warnings)}

      <div class="timeline">
        ${blockDefs.map((block) => renderBlock(block, items, itemCtx))}
      </div>

      ${anytime.length
        ? html`
            <div class="anytime-list">
              <div class="anytime-head">
                <${Icon} name="list" size=${14} />
                随时可做 · ${anytime.filter((i) => i.record?.status === 'done').length}/${anytime.length}
              </div>
              ${anytime.map((item) => html`<${ItemRow} item=${item} ctx=${itemCtx} />`)}
            </div>
          `
        : null}

      ${renderDayEnd({ day, date, settings, videos: data.videos || [], onUploaded: reload, saveJournal, closeDay, reopen, onPlay: setPlaying })}

      ${openItem
        ? html`<${ItemDetail}
            item=${openItem}
            date=${date}
            onClose=${() => setOpenItem(null)}
            onSave=${async (patch) => {
              const res = await setRecord(openItem.id, patch);
              setOpenItem(null);
              return res;
            }}
            onUpdate=${async (patch) => {
              const res = await run(() => api.patch(`/api/days/${date}/items/${openItem.id}`, patch));
              if (res?.day) {
                applyDay(res.day);
                const fresh = res.day.items.find((i) => i.id === openItem.id);
                if (fresh) setOpenItem(fresh);
              }
            }}
            onDelete=${async () => {
              const res = await run(() => api.del(`/api/days/${date}/items/${openItem.id}`));
              if (res?.day) {
                applyDay(res.day);
                setOpenItem(null);
                toastOk('已删除');
              }
            }}
          />`
        : null}

      ${showAdvice
        ? renderAdviceModal(showAdvice, () => setShowAdvice(null), applyAdvice, askAdvice)
        : null}

      ${playing
        ? html`<${VideoModal} video=${playing} onClose=${() => setPlaying(null)} />`
        : null}

      ${addBlock
        ? html`<${CustomItemModal}
            date=${date}
            blocks=${blockDefs}
            defaultBlockId=${addBlock.blockId || null}
            onClose=${() => setAddBlock(null)}
            onDone=${async () => {
              setAddBlock(null);
              await reload();
              toastOk('已加到今天的计划里');
            }}
          />`
        : null}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 加一条自定义计划                                                    */
/* ------------------------------------------------------------------ */

function CustomItemModal({ date, blocks, defaultBlockId, onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('其他');
  const [minutes, setMinutes] = useState(30);
  const [blockId, setBlockId] = useState(defaultBlockId || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/days/${date}/items`, {
        title: title.trim(),
        category,
        plannedMinutes: Number(minutes) || 30,
        target: Number(minutes) || 30,
        unit: '分钟',
        blockId: blockId || null,
      });
      onDone?.();
    } catch (err) {
      toastErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  return html`
    <${Modal}
      open
      title="往今天加一条"
      onClose=${onClose}
      footer=${html`
        <button class="btn" onClick=${onClose}>取消</button>
        <button class="btn btn-primary" onClick=${submit} disabled=${saving || !title.trim()}>
          ${saving ? html`<span class="spinner"></span>` : '加进去'}
        </button>
      `}
    >
      <${Field} label="做什么">
        <input
          class="input"
          autofocus
          value=${title}
          placeholder="比如：背政治 30 分钟 / 补昨天的错题"
          onInput=${(e) => setTitle(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && submit()}
        />
      </${Field}>
      <div class="grid-2 tight">
        <${Field} label="科目">
          <select class="select" value=${category} onChange=${(e) => setCategory(e.target.value)}>
            ${['数学', '英语', '408', '政治', '身体', '复盘', '其他'].map(
              (c) => html`<option value=${c}>${c}</option>`,
            )}
          </select>
        </${Field}>
        <${Field} label="计划时长（分钟）">
          <input
            class="input"
            type="number"
            min="5"
            max="300"
            step="5"
            value=${minutes}
            onInput=${(e) => setMinutes(e.target.value)}
          />
        </${Field}>
      </div>
      <${Field} label="放在哪个时间块" desc="留空就放到「随时可做」">
        <select class="select" value=${blockId} onChange=${(e) => setBlockId(e.target.value)}>
          <option value="">随时可做</option>
          ${blocks.map((b) => html`<option value=${b.id}>${b.start}–${b.end} ${b.label}</option>`)}
        </select>
      </${Field}>
    </${Modal}>
  `;
}

/* ------------------------------------------------------------------ */
/* 周导航条                                                            */
/* ------------------------------------------------------------------ */

function renderWeekStrip(date, today, setDate, score) {
  const dates = weekDatesOf(date);
  return html`
    <div class="weekstrip">
      ${dates.map((d) => {
        const isToday = d === today;
        const selected = d === date;
        return html`
          <button
            class=${`daychip ${isToday ? 'today' : ''} ${selected ? 'selected' : ''}`}
            onClick=${() => setDate(d)}
          >
            <span class="wd">${weekdayName(d).replace('周', '')}</span>
            <span class="dd">${Number(d.slice(8))}</span>
            <span class=${`mark ${selected && score >= 70 ? 'done' : ''}`}></span>
          </button>
        `;
      })}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 诊断告警                                                            */
/* ------------------------------------------------------------------ */

function renderWarnings(warnings = []) {
  const shown = warnings.filter((w) => w.level === 'warn' || w.code === 'idle' || w.code === 'split');
  if (!shown.length) return null;
  return html`
    <div class="stack-sm">
      ${shown.map(
        (w) => html`
          <${Notice} level=${w.level === 'warn' ? 'warn' : 'info'}>
            ${w.message}
            ${w.code === 'idle' || w.code === 'overload'
              ? html`<button
                  class="link-btn"
                  style=${{ marginLeft: '8px' }}
                  onClick=${() => navigate('plan')}
                >
                  去调整 →
                </button>`
              : null}
          </${Notice}>
        `,
      )}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 时间块                                                              */
/* ------------------------------------------------------------------ */

function renderBlock(block, allItems, ctx) {
  const items = allItems.filter((i) => i.blockId === block.id);
  const done = items.filter((i) => i.record?.status === 'done').length;
  const startMin = toMinutes(block.start);
  const endMin = toMinutes(block.end);
  const isNow = ctx.date === ctx.today && ctx.nowMin >= startMin && ctx.nowMin <= endMin;
  const isPast = ctx.date < ctx.today || (ctx.date === ctx.today && ctx.nowMin > endMin);
  const pct = items.length ? (done / items.length) * 100 : 0;
  const pendingCount = items.filter((i) => (i.record?.status || 'pending') === 'pending').length;

  const kindLabel = {
    study: '学习',
    exercise: '锻炼',
    review: '复盘',
    flex: '弹性',
    routine: '日常',
  }[block.kind];

  return html`
    <section class=${`block ${isNow ? 'is-now' : ''} ${isPast ? 'is-past' : ''}`} data-kind=${block.kind}>
      <div class="block-head">
        <span class="block-time">${block.start}–${block.end}</span>
        <span class="stack-sm" style=${{ gap: '0px', minWidth: 0 }}>
          <span class="block-title">${block.label}</span>
          <span class="block-meta">
            ${kindLabel}
            ${block.capacity ? ` · ${humanMinutesShort(block.capacity)}` : ''}
            ${isNow ? ' · 进行中' : ''}
          </span>
        </span>
        <div class="block-progress">
          ${items.length
            ? html`
                ${pendingCount > 1 && isPast
                  ? html`<button
                      class="btn btn-sm btn-ghost"
                      onClick=${(e) => {
                        e.stopPropagation();
                        ctx.onBulkDone?.(block.id);
                      }}
                    >
                      全部确认
                    </button>`
                  : null}
                <span class="frac">${done}/${items.length}</span>
                <${Bar} value=${pct} tone=${pct >= 100 ? 'teal' : ''} thin />
              `
            : html`<span class="tiny faint">空档</span>`}
        </div>
      </div>
      ${items.length
        ? html`<div class="block-body">
            ${items.map((item) => html`<${ItemRow} item=${item} ctx=${ctx} />`)}
          </div>`
        : html`<div class="block-body" style=${{ padding: '4px 16px 8px' }}>
            <button class="btn btn-sm btn-ghost" onClick=${() => ctx.onAdd?.(block.id)}>
              <${Icon} name="plus" size=${12} /> 往这块加一条
            </button>
          </div>`}
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/* 单个条目                                                            */
/* ------------------------------------------------------------------ */

function ItemRow({ item, ctx }) {
  const rec = item.record || { status: 'pending', value: 0 };
  const status = rec.status || 'pending';
  const [localValue, setLocalValue] = useState(Number(rec.value) || 0);

  useEffect(() => {
    setLocalValue(Number(rec.value) || 0);
  }, [rec.value]);

  const overdue =
    ctx.date === ctx.today &&
    item.end &&
    ctx.nowMin > toMinutes(item.end) &&
    (status === 'pending' || status === 'partial');
  const active =
    ctx.date === ctx.today && item.start && ctx.nowMin >= toMinutes(item.start) && ctx.nowMin <= toMinutes(item.end);
  const isValue = item.countMode === 'value' && Number(item.target) > 0;

  const changeValue = (v) => {
    const next = Math.max(0, Math.min(Math.max(item.target * 3, 200), v));
    setLocalValue(next);
    ctx.onValue?.(item, next);
  };

  return html`
    <div class=${`item ${status} ${overdue ? 'is-overdue' : ''}`} data-item=${item.id}>
      <button
        class="tick"
        onClick=${(e) => {
          e.stopPropagation();
          ctx.onToggle?.(item);
        }}
        aria-label="切换完成"
      >
        <${Icon} name=${status === 'missed' ? 'x' : 'check'} size=${12} />
      </button>

      <div class="item-main" onClick=${() => ctx.onOpen?.(item)} style=${{ cursor: 'pointer' }}>
        <div class="item-titleline">
          <span class="item-title">${item.title}</span>
          <span class="cat-tag">${item.category}</span>
          ${item.essential
            ? html`<span class="chip gold" style=${{ fontSize: '10px', padding: '1px 6px' }}>核心</span>`
            : null}
          ${active && status === 'pending' ? html`<span class="chip active" style=${{ fontSize: '10px' }}>该做了</span>` : null}
          ${overdue ? html`<span class="overdue-flag">已超时</span>` : null}
        </div>
        ${item.detail ? html`<div class="item-detail">${item.detail}</div>` : null}
        ${rec.cause ? html`<div class="item-cause"><${Icon} name="alert" size=${11} /> ${rec.cause}</div>` : null}
        ${rec.note ? html`<div class="tiny faint">备注：${rec.note}</div>` : null}
        <div class="item-extra">
          <span class="num">
            ${isValue
              ? `${localValue} / ${item.target}${item.unit || ''}`
              : item.countMode === 'boolean'
                ? status === 'done'
                  ? '已完成'
                  : '未完成'
                : `${item.plannedMinutes} 分钟`}
          </span>
          ${item.start ? html`<span>· ${item.start}–${item.end}</span>` : null}
          ${item.splitPart ? html`<span class="chip amber" style=${{ fontSize: '10px' }}>第 ${item.splitPart} 段</span>` : null}
        </div>
      </div>

      <div class="item-actions">
        ${isValue && status !== 'missed'
          ? html`<${NumberStepper}
              value=${localValue}
              min=${0}
              max=${Math.max(item.target * 3, 200)}
              step=${item.unit === '个' ? 1 : 5}
              onChange=${changeValue}
            />`
          : null}
        ${overdue
          ? html`<button
              class="btn btn-sm"
              style=${{ fontSize: '11px' }}
              onClick=${(e) => {
                e.stopPropagation();
                ctx.onOpen?.(item);
              }}
            >
              标注
            </button>`
          : null}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 条目详情                                                            */
/* ------------------------------------------------------------------ */

function ItemDetail({ item, date, onClose, onSave, onUpdate, onDelete }) {
  const rec = item.record || { status: 'pending', value: 0 };
  const [status, setStatus] = useState(rec.status || 'pending');
  const [value, setValue] = useState(Number(rec.value) || 0);
  const [cause, setCause] = useState(rec.cause || '');
  const [note, setNote] = useState(rec.note || '');
  const [detail, setDetail] = useState(item.detail || '');
  const isValue = item.countMode === 'value' && Number(item.target) > 0;

  const save = () => {
    onSave?.({ status, value, cause: status === 'missed' || status === 'partial' ? cause : '', note });
  };

  return html`
    <${Modal}
      open
      title=${item.title}
      onClose=${onClose}
      footer=${html`
        ${item.source === 'custom'
          ? html`<button class="btn btn-ghost btn-danger" style=${{ marginRight: 'auto' }} onClick=${onDelete}>
              <${Icon} name="trash" size=${14} /> 删除
            </button>`
          : null}
        <button class="btn" onClick=${onClose}>取消</button>
        <button class="btn btn-primary" onClick=${save}>保存</button>
      `}
    >
      <div class="row wrap" style=${{ gap: '6px' }}>
        <span class="cat-tag">${item.category}</span>
        ${item.essential ? html`<span class="chip gold">核心指标</span>` : null}
        ${item.start ? html`<span class="chip plain">${item.start}–${item.end}</span>` : null}
        ${item.plannedMinutes ? html`<span class="chip plain">${item.plannedMinutes} 分钟</span>` : null}
        <span class="chip plain">目标 ${item.target}${item.unit || ''}</span>
      </div>

      <${Field} label="今日具体内容" desc="比如「张宇高数第 3 讲」「阅读真题 2021 Text 2」">
        <input
          class="input"
          value=${detail}
          placeholder="填了之后今日页会显示在标题下面"
          onInput=${(e) => setDetail(e.target.value)}
          onBlur=${() => detail !== (item.detail || '') && onUpdate?.({ detail })}
        />
      </${Field}>

      ${isValue
        ? html`
            <${Field} label="实际完成" desc=${`目标 ${item.target}${item.unit || ''}`}>
              <div class="row">
                <${NumberStepper}
                  value=${value}
                  min=${0}
                  max=${Math.max(item.target * 3, 200)}
                  step=${item.unit === '个' ? 1 : 5}
                  unit=${item.unit}
                  onChange=${setValue}
                />
                <button class="btn btn-sm btn-ghost" onClick=${() => setValue(item.target)}>= 目标</button>
              </div>
            </${Field}>
          `
        : null}

      <${Field} label="完成情况">
        <div class="row wrap" style=${{ gap: '6px' }}>
          ${[
            { value: 'done', label: '完成' },
            { value: 'partial', label: '部分完成' },
            { value: 'missed', label: '未完成' },
            { value: 'pending', label: '还没做' },
          ].map(
            (opt) => html`
              <button
                class=${`btn btn-sm ${status === opt.value ? 'btn-primary' : ''}`}
                onClick=${() => setStatus(opt.value)}
              >
                ${opt.label}
              </button>
            `,
          )}
        </div>
      </${Field}>

      ${status === 'missed' || status === 'partial'
        ? html`
            <${Field} label="原因" desc="这个数据用来做周复盘的归因，别糊弄自己">
              <div class="row wrap" style=${{ gap: '6px' }}>
                ${CAUSES.map(
                  (c) => html`
                    <button
                      class=${`btn btn-sm ${cause === c ? 'btn-primary' : ''}`}
                      onClick=${() => setCause(cause === c ? '' : c)}
                    >
                      ${c}
                    </button>
                  `,
                )}
              </div>
              <input
                class="input input-sm"
                style=${{ marginTop: '8px' }}
                placeholder="或者自己写一句"
                value=${cause}
                onInput=${(e) => setCause(e.target.value)}
              />
            </${Field}>
          `
        : null}

      <${Field} label="备注">
        <textarea
          class="textarea"
          placeholder="今天这一项有什么值得记的？"
          value=${note}
          onInput=${(e) => setNote(e.target.value)}
        ></textarea>
      </${Field}>
    <//>
  `;
}

/* ------------------------------------------------------------------ */
/* 日终面板                                                            */
/* ------------------------------------------------------------------ */

function renderDayEnd({ day, date, settings, videos, onUploaded, saveJournal, closeDay, reopen, onPlay }) {
  const journal = day.journal || { mood: 3, energy: 3, note: '' };
  const pendingCount = (day.items || []).filter((i) => (i.record?.status || 'pending') === 'pending').length;

  return html`
    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <${Icon} name="camera" size=${16} />
          <h2>每日总结视频</h2>
          <span class="hint">${videos.length ? `${videos.length} 段` : '还没录'}</span>
        </div>
        <div class="card-body stack">
          ${videos.length
            ? html`<div class="stack-sm">
                ${videos.map(
                  (v) => html`
                    <div class="row" style=${{ gap: '10px' }}>
                      <button
                        class="video-thumb"
                        style=${{ width: '68px', height: '40px', borderRadius: '8px', flex: '0 0 auto', position: 'relative' }}
                        onClick=${() => onPlay(v)}
                      >
                        ${v.thumb
                          ? html`<img src=${`/api/videos/${v.id}/thumb`} alt="" />`
                          : html`<${Icon} name="film" size=${15} />`}
                      </button>
                      <div class="stack-sm" style=${{ gap: '1px', flex: '1 1 auto', minWidth: 0 }}>
                        <span class="sm strong" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ${v.title || '今日总结'}
                        </span>
                        <span class="tiny faint num">
                          ${v.durationSec ? humanDuration(v.durationSec) : '时长未知'}
                          ${v.transcript?.status === 'done' ? ' · 已转写' : ''}
                          ${v.analysis ? ' · 已分析' : ''}
                        </span>
                      </div>
                      <button class="btn btn-sm" onClick=${() => onPlay(v)}>播放</button>
                    </div>
                  `,
                )}
              </div>`
            : null}
          <${VideoUploader} date=${date} onDone=${onUploaded} compact=${videos.length > 0} />
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <${Icon} name="edit" size=${16} />
          <h2>日终确认</h2>
          <span class="hint">${pendingCount ? `${pendingCount} 项待确认` : '都确认过了'}</span>
        </div>
        <div class="card-body stack">
          <${Field} label="今天的状态">
            <div class="stack-sm" style=${{ gap: '8px' }}>
              <div class="row-between">
                <span class="sm faint">心情</span>
                <div class="row" style=${{ gap: '4px' }}>
                  ${[1, 2, 3, 4, 5].map(
                    (n) => html`
                      <button
                        class=${`btn btn-sm ${journal.mood === n ? 'btn-primary' : ''}`}
                        style=${{ minWidth: '34px' }}
                        onClick=${() => saveJournal({ mood: n })}
                      >
                        ${n}
                      </button>
                    `,
                  )}
                </div>
              </div>
              <div class="row-between">
                <span class="sm faint">精力</span>
                <div class="row" style=${{ gap: '4px' }}>
                  ${[1, 2, 3, 4, 5].map(
                    (n) => html`
                      <button
                        class=${`btn btn-sm ${journal.energy === n ? 'btn-primary' : ''}`}
                        style=${{ minWidth: '34px' }}
                        onClick=${() => saveJournal({ energy: n })}
                      >
                        ${n}
                      </button>
                    `,
                  )}
                </div>
              </div>
            </div>
          </${Field}>

          <${Field} label="一句话总结">
            <textarea
              class="textarea"
              style=${{ minHeight: '58px' }}
              placeholder="今天最有价值的一件事是什么？"
              value=${journal.note || ''}
              onBlur=${(e) => saveJournal({ note: e.target.value })}
            ></textarea>
          </${Field}>

          ${day.closed
            ? html`
                <${Notice} level="ok">
                  这一天已经收工，${(day.score?.byStatus?.missed ?? 0)} 项未完成已记录。
                </${Notice}>
                <button class="btn" onClick=${reopen}>
                  <${Icon} name="refresh" size=${14} /> 重新打开
                </button>
              `
            : html`
                <button class="btn btn-primary btn-block" onClick=${closeDay}>
                  <${Icon} name="check" size=${15} /> 关闭这一天${pendingCount ? `（${pendingCount} 项将标记未完成）` : ''}
                </button>
              `}
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* AI 计划建议                                                         */
/* ------------------------------------------------------------------ */

function renderAdviceModal(advice, onClose, onApply, onRetry) {
  if (advice.loading) {
    return html`
      <${Modal} open title="AI 正在看今天的计划" onClose=${onClose} closable=${false}>
        <div class="loading-block"><span class="spinner spinner-lg"></span> <span>分析容量、科目配比和历史完成率…</span></div>
      </${Modal}>
    `;
  }
  if (advice.error) {
    return html`
      <${Modal} open title="没有拿到建议" onClose=${onClose}>
        <${Notice} level="danger">${advice.error}</${Notice}>
        <p class="sm faint">没配置大模型也能用：今日页的「重排今天」是纯本地算法，永远可用。</p>
      </${Modal}>
    `;
  }
  const a = advice.advice;
  return html`
    <${Modal}
      open
      title="AI 对今天的建议"
      onClose=${onClose}
      footer=${html`
        <span class="tiny faint" style=${{ marginRight: 'auto' }}>
          ${advice.source === 'ai' ? `由 ${advice.model || '大模型'} 生成` : '规则引擎生成（未启用大模型）'}
        </span>
        <button class="btn" onClick=${onClose}>关闭</button>
        ${a.changes?.length || a.order?.length
          ? html`<button class="btn btn-primary" onClick=${() => onApply(a)}>按这个顺序重排</button>`
          : null}
      `}
    >
      <${Notice} level="info">${a.verdict}</${Notice}>
      ${a.notes?.length
        ? html`<div class="stack-sm">
            <div class="section-title">执行提醒</div>
            <ul class="list-bullets">
              ${a.notes.map((n) => html`<li>${n}</li>`)}
            </ul>
          </div>`
        : null}
      ${a.changes?.length
        ? html`<div class="stack-sm">
            <div class="section-title">建议改动</div>
            ${a.changes.map(
              (c) => html`
                <div class="adjustment">
                  <div class="adj-main">
                    <span class="adj-title">${c.reason || '调整这一项'}</span>
                    <span class="adj-reason">
                      ${c.minutes ? `时长改为 ${c.minutes} 分钟 · ` : ''}${c.blockId ? `挪到 ${c.blockId}` : ''}
                    </span>
                  </div>
                </div>
              `,
            )}
          </div>`
        : null}
      ${advice.error ? html`<${Notice} level="warn">${advice.error}</${Notice}>` : null}
    </${Modal}>
  `;
}

/* ------------------------------------------------------------------ */
/* 视频播放弹窗                                                        */
/* ------------------------------------------------------------------ */

export function VideoModal({ video, onClose, extra }) {
  return html`
    <${Modal}
      open
      wide
      title=${video.title || '总结视频'}
      onClose=${onClose}
      footer=${html`
        <span class="tiny faint" style=${{ marginRight: 'auto' }}>
          ${video.date}${video.durationSec ? ` · ${humanDuration(video.durationSec)}` : ''}
        </span>
        ${extra || null}
        <button class="btn" onClick=${onClose}>关闭</button>
      `}
    >
      <div class="player-wrap">
        <video src=${`/api/videos/${video.id}/file`} controls autoplay playsinline></video>
      </div>
      ${video.transcript?.text
        ? html`
            <div class="stack-sm">
              <div class="section-title">文字稿</div>
              <div class="transcript">${video.transcript.text}</div>
            </div>
          `
        : null}
    </${Modal}>
  `;
}

export { ItemRow };
