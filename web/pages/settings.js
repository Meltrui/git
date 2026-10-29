/** 设置页：作息、指标、AI、转写、提醒、数据 */

import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import {
  api,
  useS,
  useFetch,
  useAction,
  refreshBoot,
  loadBoot,
  toastOk,
  toastErr,
  waitForJob,
} from '../store.js';
import { todayStr, normalizeTime, humanBytes } from '../lib/format.js';
import {
  Modal,
  Notice,
  Loading,
  Field,
  Switch,
  Empty,
  confirmDialog,
  NumberStepper,
  Bar,
} from '../components/ui.js';
import { CapabilityDot } from '../components/charts.js';

const SECTIONS = [
  { id: 'profile', label: '我的档案', icon: 'flag' },
  { id: 'blocks', label: '作息时间块', icon: 'clock' },
  { id: 'indicators', label: '每日指标', icon: 'target' },
  { id: 'plan', label: '规划与评分', icon: 'sliders' },
  { id: 'ai', label: '大模型', icon: 'sparkles' },
  { id: 'asr', label: '语音转写', icon: 'mic' },
  { id: 'storage', label: '存储与视频', icon: 'film' },
  { id: 'reminder', label: '提醒', icon: 'bolt' },
  { id: 'access', label: '访问与安全', icon: 'lock' },
  { id: 'data', label: '数据与备份', icon: 'database' },
];

const KINDS = [
  { value: 'study', label: '学习' },
  { value: 'exercise', label: '锻炼' },
  { value: 'review', label: '复盘' },
  { value: 'flex', label: '弹性' },
  { value: 'routine', label: '日常' },
];

const CATEGORIES = ['数学', '英语', '408', '政治', '身体', '复盘', '其他'];

export function SettingsPage() {
  const s = useS();
  const [section, setSection] = useState(s.params?.sub && SECTIONS.some((x) => x.id === s.params.sub) ? s.params.sub : 'profile');
  const { data, loading, reload, setData } = useFetch(() => api.get('/api/settings'), []);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef(null);

  const settings = data?.settings;
  const caps = data?.capabilities;

  const flash = () => {
    setSavedFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1600);
  };

  const save = async (patch) => {
    try {
      const res = await api.put('/api/settings', patch);
      setData({ ...data, settings: res.settings });
      flash();
      refreshBoot();
      return res.settings;
    } catch (err) {
      toastErr(err.message);
      return null;
    }
  };

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  if (loading && !settings) return html`<${Loading} text="正在读取设置…" />`;
  if (!settings) return html`<${Notice} level="danger">读不到设置</${Notice}>`;

  return html`
    <div class="fade-in settings-grid">
      <div class="settings-nav">
        ${SECTIONS.map(
          (sec) => html`
            <button class=${section === sec.id ? 'active' : ''} onClick=${() => setSection(sec.id)}>
              ${sec.label}
            </button>
          `,
        )}
        ${savedFlash ? html`<span class="tiny" style=${{ color: 'var(--teal)', padding: '8px 12px' }}>✓ 已保存</span>` : null}
      </div>

      <div class="stack" style=${{ gap: '16px', minWidth: 0 }}>
        ${section === 'profile' ? html`<${ProfileSection} settings=${settings} save=${save} />` : null}
        ${section === 'blocks' ? html`<${BlocksSection} settings=${settings} save=${save} />` : null}
        ${section === 'indicators' ? html`<${IndicatorsSection} settings=${settings} save=${save} />` : null}
        ${section === 'plan' ? html`<${PlanSection} settings=${settings} save=${save} />` : null}
        ${section === 'ai' ? html`<${AiSection} settings=${settings} save=${save} caps=${caps} />` : null}
        ${section === 'asr' ? html`<${AsrSection} settings=${settings} save=${save} caps=${caps} reload=${reload} />` : null}
        ${section === 'storage'
          ? html`<${StorageSection} settings=${settings} save=${save} reload=${reload} />`
          : null}
        ${section === 'reminder'
          ? html`<${ReminderSection} settings=${settings} save=${save} />`
          : null}
        ${section === 'access' ? html`<${AccessSection} settings=${settings} save=${save} />` : null}
        ${section === 'data' ? html`<${DataSection} caps=${caps} reload=${reload} />` : null}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */

function Section({ title, desc, children, actions }) {
  return html`
    <div class="card">
      <div class="card-head">
        <h2>${title}</h2>
        ${desc ? html`<span class="hint">${desc}</span>` : null}
        ${actions ? html`<div class="row" style=${{ marginLeft: 'auto', gap: '6px' }}>${actions}</div>` : null}
      </div>
      <div class="card-body stack">${children}</div>
    </div>
  `;
}

/* ---------------- 档案 ---------------- */

function ProfileSection({ settings, save }) {
  const p = settings.profile || {};
  const [name, setName] = useState(p.name || '');
  const [examName, setExamName] = useState(p.examName || '');
  const [examDate, setExamDate] = useState(p.examDate || '');
  const [motto, setMotto] = useState(p.motto || '');
  const [wakeTime, setWakeTime] = useState(p.wakeTime || '08:00');
  const [sleepTime, setSleepTime] = useState(p.sleepTime || '23:30');

  const daysLeft = examDate ? Math.max(0, Math.round((new Date(examDate) - new Date(todayStr())) / 86400000)) : null;

  return html`
    <${Section} title="我的档案" desc="只存在本机">
      <div class="grid-2 tight">
        <${Field} label="怎么称呼你">
          <input class="input" value=${name} placeholder="留空也行" onInput=${(e) => setName(e.target.value)}
            onBlur=${() => save({ profile: { name } })} />
        </${Field}>
        <${Field} label="目标名称">
          <input class="input" value=${examName} placeholder="考研 11408" onInput=${(e) => setExamName(e.target.value)}
            onBlur=${() => save({ profile: { examName } })} />
        </${Field}>
      </div>
      <div class="grid-2 tight">
        <${Field} label="目标日期" desc=${daysLeft !== null ? `还有 ${daysLeft} 天` : ''}>
          <input class="input" type="date" value=${examDate} onInput=${(e) => setExamDate(e.target.value)}
            onBlur=${() => save({ profile: { examDate } })} />
        </${Field}>
        <${Field} label="起床 / 睡觉时间">
          <div class="row">
            <input class="input" type="time" value=${wakeTime} onInput=${(e) => setWakeTime(e.target.value)}
              onBlur=${() => save({ profile: { wakeTime } })} />
            <input class="input" type="time" value=${sleepTime} onInput=${(e) => setSleepTime(e.target.value)}
              onBlur=${() => save({ profile: { sleepTime } })} />
          </div>
        </${Field}>
      </div>
      <${Field} label="一句话">
        <input class="input" value=${motto} placeholder="把一天钉在计划上。" onInput=${(e) => setMotto(e.target.value)}
          onBlur=${() => save({ profile: { motto } })} />
      </${Field}>
    </${Section}>
  `;
}

/* ---------------- 时间块 ---------------- */

function BlocksSection({ settings, save }) {
  const blocks = settings.blocks || [];

  const update = (id, patch) => {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    save({ blocks: next });
  };

  const remove = async (id) => {
    const ok = await confirmDialog({ title: '删除时间块', message: '删掉之后这个时段就不会再被排计划。', danger: true, confirmText: '删除' });
    if (!ok) return;
    save({ blocks: blocks.filter((b) => b.id !== id) });
  };

  const add = () => {
    const id = `block-${Date.now().toString(36)}`;
    const sorted = [...blocks];
    const last = sorted[sorted.length - 1];
    const next = [
      ...blocks,
      {
        id,
        label: '新时间块',
        start: last?.end || '09:00',
        end: '10:00',
        kind: 'study',
        days: [1, 2, 3, 4, 5, 6, 0],
        allowTasks: true,
      },
    ];
    save({ blocks: next });
  };

  const totalStudy = blocks
    .filter((b) => b.kind === 'study')
    .reduce((sum, b) => sum + Math.max(0, toMin(b.end) - toMin(b.start)), 0);
  const totalAll = blocks.reduce((sum, b) => sum + Math.max(0, toMin(b.end) - toMin(b.start)), 0);

  return html`
    <${Section}
      title="作息时间块"
      desc=${`${blocks.length} 个块 · 学习 ${Math.round(totalStudy / 60)}h · 全天 ${Math.round(totalAll / 60)}h`}
      actions=${html`<button class="btn btn-sm btn-primary" onClick=${add}><${Icon} name="plus" size=${13} /> 加一块</button>`}
    >
      <${Notice} level="info">
        规划器只会往这些块里排东西。一个条目的时长跨不出它所在的块，所以块的时长就是当天的真实容量。
      </${Notice}>
      <div class="stack-sm">
        ${blocks.map(
          (b) => html`
            <div class="edit-row" style=${{ gridTemplateColumns: 'minmax(120px,1.4fr) 92px 92px 96px 70px auto' }}>
              <input class="input input-sm" value=${b.label}
                onInput=${(e) => update(b.id, { label: e.target.value })} />
              <input class="input input-sm" type="time" value=${b.start}
                onBlur=${(e) => {
                  const v = normalizeTime(e.target.value);
                  if (v && toMin(v) < toMin(b.end)) update(b.id, { start: v });
                  else e.target.value = b.start;
                }} />
              <input class="input input-sm" type="time" value=${b.end}
                onBlur=${(e) => {
                  const v = normalizeTime(e.target.value);
                  if (v && toMin(v) > toMin(b.start)) update(b.id, { end: v });
                  else e.target.value = b.end;
                }} />
              <select class="select input-sm" value=${b.kind} onChange=${(e) => update(b.id, { kind: e.target.value })}>
                ${KINDS.map((k) => html`<option value=${k.value} selected=${k.value === b.kind}>${k.label}</option>`)}
              </select>
              <button
                class="btn btn-sm"
                title="是否允许排任务池里的任务"
                style=${{ fontSize: '11px', background: b.allowTasks ? 'var(--accent-soft)' : 'transparent', color: b.allowTasks ? 'var(--accent)' : 'var(--text-faint)' }}
                onClick=${() => update(b.id, { allowTasks: !b.allowTasks })}
              >
                排任务
              </button>
              <button class="btn btn-icon" onClick=${() => remove(b.id)}>
                <${Icon} name="trash" size=${14} />
              </button>
            </div>
          `,
        )}
      </div>
    </${Section}>
  `;
}

const toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/* ---------------- 指标 ---------------- */

function IndicatorsSection({ settings, save }) {
  const indicators = settings.indicators || [];

  const update = (id, patch) => {
    save({ indicators: indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  };

  const remove = async (id) => {
    const ok = await confirmDialog({ title: '删除指标', message: '删掉后每天的默认计划里就不会再有它。', danger: true, confirmText: '删除' });
    if (!ok) return;
    save({ indicators: indicators.filter((i) => i.id !== id) });
  };

  const add = () => {
    save({
      indicators: [
        ...indicators,
        {
          id: `ind-${Date.now().toString(36)}`,
          name: '新指标',
          category: '其他',
          kind: 'study',
          minutes: 30,
          target: 30,
          unit: '分钟',
          weight: 1,
          essential: false,
          countMode: 'value',
        },
      ],
    });
  };

  const totalMinutes = indicators
    .filter((i) => i.kind === 'study')
    .reduce((s, i) => s + (Number(i.minutes) || 0), 0);
  const studyCapacity = (settings.blocks || [])
    .filter((b) => b.kind === 'study')
    .reduce((s, b) => s + Math.max(0, toMin(b.end) - toMin(b.start)), 0);

  return html`
    <${Section}
      title="每日核心指标"
      desc=${`学习类指标合计 ${totalMinutes} 分钟 / 学习块容量 ${studyCapacity} 分钟`}
      actions=${html`<button class="btn btn-sm btn-primary" onClick=${add}><${Icon} name="plus" size=${13} /> 加指标</button>`}
    >
      ${totalMinutes > studyCapacity
        ? html`<${Notice} level="warn">
            指标总时长（${totalMinutes} 分钟）已经超过学习块容量（${studyCapacity} 分钟），规划器会报「装不下」。要么调低目标，要么加长学习块。
          </${Notice}>`
        : html`<${Notice} level="ok">
            指标合计 ${totalMinutes} 分钟，学习块有 ${studyCapacity} 分钟，还剩 ${studyCapacity - totalMinutes} 分钟留给任务池。
          </${Notice}>`}

      <${Notice} level="info">
        「时长」决定它占多少日程；「目标」决定打勾时算完成多少。比如英语新词：时长 8 分钟、目标 10 个。
      </${Notice}>

      <div class="stack-sm">
        ${indicators.map(
          (ind) => html`
            <div class="card" style=${{ background: 'var(--surface-2)', boxShadow: 'none' }}>
              <div class="card-body stack-sm" style=${{ padding: '12px 14px', gap: '10px' }}>
                <div class="row wrap" style=${{ gap: '8px' }}>
                  <input
                    class="input input-sm"
                    style=${{ flex: '1 1 160px', fontWeight: 500 }}
                    value=${ind.name}
                    onInput=${(e) => update(ind.id, { name: e.target.value })}
                  />
                  <select class="select input-sm" style=${{ width: '92px' }} value=${ind.category}
                    onChange=${(e) => update(ind.id, { category: e.target.value })}>
                    ${CATEGORIES.map((c) => html`<option value=${c} selected=${c === ind.category}>${c}</option>`)}
                  </select>
                  <select class="select input-sm" style=${{ width: '84px' }} value=${ind.kind}
                    onChange=${(e) => update(ind.id, { kind: e.target.value })}>
                    ${KINDS.map((k) => html`<option value=${k.value} selected=${k.value === ind.kind}>${k.label}</option>`)}
                  </select>
                  <button
                    class="btn btn-sm"
                    style=${{
                      background: ind.essential ? 'var(--gold-soft)' : 'transparent',
                      color: ind.essential ? 'var(--gold)' : 'var(--text-faint)',
                      borderColor: ind.essential ? 'transparent' : 'var(--border)',
                      fontSize: '11px',
                    }}
                    onClick=${() => update(ind.id, { essential: !ind.essential })}
                  >
                    核心
                  </button>
                  <button class="btn btn-icon" onClick=${() => remove(ind.id)}>
                    <${Icon} name="trash" size=${14} />
                  </button>
                </div>
                <div class="row wrap" style=${{ gap: '14px' }}>
                  <label class="row sm" style=${{ gap: '6px' }}>
                    <span class="faint">占日程</span>
                    <input class="input input-sm" type="number" min="0" max="300" step="5" style=${{ width: '64px' }}
                      value=${ind.minutes}
                      onInput=${(e) => update(ind.id, { minutes: Number(e.target.value) || 0 })} />
                    <span class="faint">分钟</span>
                  </label>
                  <label class="row sm" style=${{ gap: '6px' }}>
                    <span class="faint">目标</span>
                    <input class="input input-sm" type="number" min="0" step="1" style=${{ width: '64px' }}
                      value=${ind.target}
                      onInput=${(e) => update(ind.id, { target: Number(e.target.value) || 0 })} />
                    <input class="input input-sm" style=${{ width: '52px' }} value=${ind.unit}
                      onInput=${(e) => update(ind.id, { unit: e.target.value })} />
                  </label>
                  <label class="row sm" style=${{ gap: '6px' }}>
                    <span class="faint">权重</span>
                    <input class="input input-sm" type="number" min="0.1" max="5" step="0.1" style=${{ width: '60px' }}
                      value=${ind.weight}
                      onInput=${(e) => update(ind.id, { weight: Number(e.target.value) || 1 })} />
                  </label>
                  <label class="row sm" style=${{ gap: '6px' }}>
                    <span class="faint">打勾方式</span>
                    <select class="select input-sm" style=${{ width: '88px' }} value=${ind.countMode || 'value'}
                      onChange=${(e) => update(ind.id, { countMode: e.target.value })}>
                      <option value="value">填数值</option>
                      <option value="boolean">直接勾</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          `,
        )}
      </div>
    </${Section}>
  `;
}

/* ---------------- 规划与评分 ---------------- */

function PlanSection({ settings, save }) {
  const planner = settings.planner || {};
  const scoring = settings.scoring || {};
  const weekly = settings.weekly || {};

  return html`
    <${Section} title="规划与评分">
      <div class="grid-2 tight">
        <${Field} label="学习块预留空档（分钟）" desc="每个学习块留出这么多机动时间">
          <input class="input" type="number" min="0" max="60" step="5" value=${planner.studySlackMinutes || 0}
            onInput=${(e) => save({ planner: { studySlackMinutes: Number(e.target.value) || 0 } })} />
        </${Field}>
        <${Field} label="每天最多排几个任务" desc="任务池里的任务每天最多进几个">
          <input class="input" type="number" min="0" max="10" value=${planner.maxTasksPerDay ?? 4}
            onInput=${(e) => save({ planner: { maxTasksPerDay: Number(e.target.value) || 0 } })} />
        </${Field}>
      </div>
      <div class="grid-2 tight">
        <${Field} label="任务拆分最小片段（分钟）" desc="太碎没意义，小于这个数就不拆了">
          <input class="input" type="number" min="10" max="60" step="5" value=${planner.minTaskSlice || 25}
            onInput=${(e) => save({ planner: { minTaskSlice: Number(e.target.value) || 25 } })} />
        </${Field}>
        <${Field} label="每周学习时长目标（分钟）" desc="用于周复盘对比，例如 1500 = 25 小时">
          <input class="input" type="number" min="0" step="60" value=${weekly.targetStudyMinutes || 0}
            onInput=${(e) => save({ weekly: { targetStudyMinutes: Number(e.target.value) || 0 } })} />
        </${Field}>
      </div>

      <div class="divider"></div>

      <${Field} label="连击最低得分" desc="当天加权完成度达到这个分数才算「没断」">
        <input class="input" type="number" min="0" max="100" step="5" value=${scoring.streakMinScore ?? 70}
          onInput=${(e) => save({ scoring: { streakMinScore: Number(e.target.value) || 0 } })} />
      </${Field}>
      <${Switch}
        label="连击还要求录了当天总结视频"
        desc="打开后，只有录了视频的那天才算进连击"
        checked=${scoring.requireVideoForStreak !== false}
        onChange=${(v) => save({ scoring: { requireVideoForStreak: v } })}
      />
      <${Switch}
        label="打开今日页时自动生成当天计划"
        checked=${planner.autoGenerateToday !== false}
        onChange=${(v) => save({ planner: { autoGenerateToday: v } })}
      />
      <${Switch}
        label="晚间弹性块也可以排任务"
        desc="关掉的话，晚上那个块就完全留给你自己安排"
        checked=${!!planner.fillEveningWithTasks}
        onChange=${(v) => save({ planner: { fillEveningWithTasks: v } })}
      />
    </${Section}>
  `;
}

/* ---------------- AI ---------------- */

function AiSection({ settings, save, caps }) {
  const ai = settings.ai || {};
  const providers = caps?.aiProviders || {};
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [pickedProvider, setPickedProvider] = useState(ai.provider || 'deepseek');

  const provider = providers[pickedProvider] || {};

  const pick = (key) => {
    setPickedProvider(key);
    const preset = providers[key] || {};
    save({ ai: { provider: key, baseUrl: preset.baseUrl, model: preset.models?.[0] || ai.model } });
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/api/ai/test');
      setTestResult({ ok: true, sample: res.sample, model: res.model });
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return html`
    <${Section} title="大模型"
      actions=${html`<button class="btn btn-sm" onClick=${test} disabled=${testing || !ai.apiKeySet}>
        ${testing ? html`<span class="spinner"></span>` : html`<${Icon} name="bolt" size=${13} />`} 测试连接
      </button>`}
    >
      <${Notice} level="info">
        不配也能用全部核心功能（计划、打卡、统计、规则版周总结）。配了之后：周总结更有洞察、能对计划提建议、能对照分析你的总结视频。Key 只存在本机的 data/anchor.json 里。
      </${Notice}>

      <${Switch}
        label="启用大模型"
        desc="关掉时所有 AI 按钮会退回本地规则引擎"
        checked=${!!ai.enabled}
        onChange=${(v) => save({ ai: { enabled: v } })}
      />

      <${Field} label="服务商">
        <div class="row wrap" style=${{ gap: '6px' }}>
          ${Object.entries(providers).map(
            ([key, p]) => html`
              <button
                class=${`btn btn-sm ${pickedProvider === key ? 'btn-primary' : ''}`}
                onClick=${() => pick(key)}
                title=${p.note || ''}
              >
                ${p.label}
              </button>
            `,
          )}
        </div>
        ${provider.note ? html`<div class="desc">${provider.note}</div>` : null}
      </${Field}>

      <div class="grid-2 tight">
        <${Field} label="接口地址">
          <input class="input" value=${ai.baseUrl || ''} placeholder="https://api.deepseek.com"
            onInput=${(e) => save({ ai: { baseUrl: e.target.value } })} />
        </${Field}>
        <${Field} label="模型">
          <input class="input" value=${ai.model || ''} list="model-list"
            onInput=${(e) => save({ ai: { model: e.target.value } })} />
          <datalist id="model-list">
            ${(provider.models || []).map((m) => html`<option value=${m}></option>`)}
          </datalist>
        </${Field}>
      </div>

      <${Field}
        label="API Key"
        desc=${ai.apiKeySet ? '已经保存过一把 Key。要换的话在这里填新的，留空表示不改。' : '还没填。deepseek 的话去 platform.deepseek.com 申请。'}
      >
        <div class="row">
          <input
            class="input"
            type="password"
            placeholder=${ai.apiKeySet ? '••••••••（已保存）' : 'sk-...'}
            value=${apiKey}
            onInput=${(e) => setApiKey(e.target.value)}
          />
          <button
            class="btn"
            disabled=${!apiKey}
            onClick=${async () => {
              const res = await save({ ai: { apiKey } });
              if (res) {
                setApiKey('');
                toastOk('Key 已保存到本机');
              }
            }}
          >
            保存
          </button>
        </div>
      </${Field}>

      ${testResult
        ? testResult.ok
          ? html`<${Notice} level="ok">连接正常 · 模型 ${testResult.model} · 回复：${testResult.sample}</${Notice}>`
          : html`<${Notice} level="danger">${testResult.error}</${Notice}>`
        : null}

      <div class="grid-2 tight">
        <${Field} label="温度" desc="越低越稳，越高越发散">
          <input class="input" type="number" min="0" max="1.5" step="0.1" value=${ai.temperature ?? 0.6}
            onInput=${(e) => save({ ai: { temperature: Number(e.target.value) } })} />
        </${Field}>
        <${Field} label="超时（秒）">
          <input class="input" type="number" min="30" max="600" step="10" value=${Math.round((ai.timeoutMs || 180000) / 1000)}
            onInput=${(e) => save({ ai: { timeoutMs: (Number(e.target.value) || 180) * 1000 } })} />
        </${Field}>
      </div>
    </${Section}>
  `;
}

/* ---------------- 转写 ---------------- */

function AsrSection({ settings, save, caps, reload }) {
  const asr = settings.asr || {};
  const status = caps?.asr || {};
  const presets = caps?.asrPresets || {};
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [apiKey, setApiKey] = useState('');

  const startDownload = async () => {
    try {
      const res = await api.post('/api/asr/download', {});
      if (res.already) {
        toastOk('模型已经在了');
        return;
      }
      setJob(res.job);
      await waitForJob(res.job.id, {
        onTick: (j) => {
          setProgress(j.progress || 0);
          setStep(j.step || '');
        },
      });
      toastOk('模型下载完成');
      await reload();
    } catch (err) {
      toastErr(err.message);
    } finally {
      setJob(null);
      setProgress(0);
    }
  };

  return html`
    <${Section} title="语音转写" desc="把总结视频变成文字稿，AI 才能对照分析">
      <div class="stack-sm">
        <${CapabilityDot} ok=${status.localReady} label=${status.localReady ? `本地模型就绪（${status.localModelSizeMb} MB）` : '本地模型未下载'} />
        <${CapabilityDot} ok=${caps?.media?.ffmpeg} label=${caps?.media?.ffmpeg ? 'ffmpeg 就绪' : '缺少 ffmpeg'} />
        <${CapabilityDot} ok=${status.canTranscribe} label=${status.canTranscribe ? '可以自动转写' : '还不能自动转写'} />
      </div>

      <${Field} label="转写方式">
        <select class="select" value=${asr.provider || 'local'}
          onChange=${(e) => save({ asr: { provider: e.target.value } })}>
          <option value="local">本地模型（免费、离线、要下 240MB）</option>
          ${Object.entries(presets).map(([k, v]) => html`<option value=${k}>${v.label}（云端，需要 Key）</option>`)}
          <option value="none">不转写（手动粘贴文字稿）</option>
        </select>
      </${Field}>

      ${(asr.provider || 'local') === 'local'
        ? html`
            ${!status.localReady
              ? html`
                  <${Notice} level="info">
                    本地模型是 SenseVoice-Small（中英日韩粤），约 240MB，完全离线、免费、不消耗任何额度。只需要下载一次。
                  </${Notice}>
                  ${job
                    ? html`<div class="stack-sm">
                        <${Bar} value=${progress} />
                        <span class="tiny faint">${step || '下载中…'}</span>
                      </div>`
                    : html`<button class="btn btn-primary" onClick=${startDownload}>
                        <${Icon} name="download" size=${14} /> 下载本地模型
                      </button>`}
                `
              : html`<${Notice} level="ok">本地模型已经就绪，转写完全在本机跑。</${Notice}>`}
          `
        : (asr.provider || 'local') === 'none'
          ? html`<${Notice} level="info">不做自动转写。你仍然可以在视频详情里手动粘贴文字稿，然后让 AI 分析。</${Notice}>`
          : html`
              <${Field} label="接口地址">
                <input class="input" value=${asr.baseUrl || ''} placeholder=${presets[asr.provider]?.baseUrl || ''}
                  onInput=${(e) => save({ asr: { baseUrl: e.target.value } })} />
              </${Field}>
              <${Field} label="模型">
                <input class="input" value=${asr.model || ''} placeholder=${presets[asr.provider]?.model || ''}
                  onInput=${(e) => save({ asr: { model: e.target.value } })} />
              </${Field}>
              <${Field} label="API Key" desc=${asr.apiKeySet ? '已保存，留空表示不改' : '还没有填'}>
                <div class="row">
                  <input class="input" type="password" value=${apiKey} onInput=${(e) => setApiKey(e.target.value)} />
                  <button class="btn" disabled=${!apiKey}
                    onClick=${async () => {
                      const res = await save({ asr: { apiKey } });
                      if (res) {
                        setApiKey('');
                        toastOk('已保存');
                      }
                    }}>保存</button>
                </div>
              </${Field}>
            `}
    </${Section}>
  `;
}

/* ---------------- 提醒 ---------------- */

function ReminderSection({ settings, save }) {
  const reminder = settings.reminder || {};
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );

  const askPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      new Notification('Anchor · 锚点', { body: '提醒已开启，到点会叫你。' });
    }
  };

  return html`
    <${Section} title="提醒">
      <${Switch} label="启用提醒" checked=${reminder.enabled !== false} onChange=${(v) => save({ reminder: { enabled: v } })} />
      <${Switch}
        label="时间块开始时提醒"
        desc="比如 9:30 到点弹一条「上午学习开始」"
        checked=${reminder.blockStart !== false}
        onChange=${(v) => save({ reminder: { blockStart: v } })}
      />
      <${Switch}
        label="时间块结束时提醒"
        checked=${!!reminder.blockEnd}
        onChange=${(v) => save({ reminder: { blockEnd: v } })}
      />
      <${Field} label="晚间收尾时间" desc="到点提醒你录视频、做日终确认">
        <input class="input" type="time" value=${reminder.dailyWrapUp || '22:00'}
          onBlur=${(e) => save({ reminder: { dailyWrapUp: e.target.value } })} />
      </${Field}>

      <${Switch}
        label="系统通知"
        desc="需要浏览器授权，只有页面开着的时候才有效"
        checked=${reminder.desktopNotification !== false}
        onChange=${(v) => save({ reminder: { desktopNotification: v } })}
      />

      <div class="row wrap" style=${{ gap: '8px' }}>
        ${permission === 'granted'
          ? html`<${Notice} level="ok">系统通知已授权</${Notice}>`
          : permission === 'denied'
            ? html`<${Notice} level="warn">浏览器拒绝了通知权限，去地址栏左边的图标里改一下</${Notice}>`
            : html`<button class="btn btn-sm" onClick=${askPermission}>申请系统通知权限</button>`}
        <button
          class="btn btn-sm"
          onClick=${async () => {
            try {
              await api.post('/api/reminder/test', {});
              toastOk('已推送一条测试提醒');
            } catch (err) {
              toastErr(err.message);
            }
          }}
        >
          推送一条测试提醒
        </button>
      </div>

      <${Notice} level="info">
        提醒由本机服务发出，所以「npm start」得开着。想要手机上也收到，连同一个 WiFi 用局域网地址打开就行。
      </${Notice}>
    </${Section}>
  `;
}

/* ---------------- 访问控制 ---------------- */

function AccessSection({ settings, save }) {
  const access = settings.access || {};
  const [code, setCode] = useState('');

  return html`
    <${Section} title="访问与安全" desc="默认只能在你这台电脑上打开">
      <${Notice} level="info">
        服务默认监听所有网卡，所以你手机连同一个 WiFi 就能用局域网地址访问。如果家里网络不完全可信，就设一个访问口令。
      </${Notice}>

      <${Field}
        label="访问口令"
        desc=${access.codeSet ? '已设置。从其他设备访问需要输入口令；本机访问不需要。留空表示不修改。' : '还没设置（局域网内任何人都能打开）'}
      >
        <div class="row">
          <input
            class="input"
            type="password"
            placeholder=${access.codeSet ? '••••（已设置）' : '设一个 4 位以上口令'}
            value=${code}
            onInput=${(e) => setCode(e.target.value)}
          />
          <button class="btn" disabled=${!code}
            onClick=${async () => {
              const res = await save({ access: { code } });
              if (res) {
                setCode('');
                toastOk('口令已设置');
              }
            }}>
            设置
          </button>
        </div>
      </${Field}>

      ${access.codeSet
        ? html`<button class="btn btn-sm btn-danger"
            onClick=${async () => {
              const ok = await confirmDialog({ title: '取消口令', message: '取消后局域网内任何人都能访问。', danger: true, confirmText: '取消口令' });
              if (ok) {
                await api.put('/api/settings', { access: { code: ' ' } });
                await save({ access: { code: null } });
                toastOk('已取消口令，刷新后生效');
              }
            }}>
            <${Icon} name="lock" size=${13} /> 取消口令
          </button>`
        : null}
    </${Section}>
  `;
}

/* ---------------- 存储与视频 ---------------- */

function StorageSection({ settings, save, reload }) {
  const m = settings.media || {};
  const { data: storage, reload: reloadStorage } = useFetch(() => api.get('/api/storage'), []);
  const { data: inbox, reload: reloadInbox } = useFetch(() => api.get('/api/inbox'), []);
  const [scanning, setScanning] = useState(false);

  const archive = m.archive || 'compact';
  const compressed = archive === 'compact' || archive === 'high';
  const keepOriginal = m.keepOriginal || 'off';
  const pending = inbox?.pending || [];

  const doScan = async () => {
    setScanning(true);
    try {
      const res = await api.post('/api/inbox/scan');
      const n = (res.imported || []).length;
      if (n) toastOk(`导入 ${n} 个视频，正在后台归档`);
      else if (res.waiting) toastOk(`${res.waiting} 个文件还在传输中`);
      else toastOk('收件箱是空的');
      await reloadInbox(true);
    } catch (err) {
      toastErr(err.message);
    } finally {
      setScanning(false);
    }
  };

  return html`
    <${Section} title="存储与视频" desc="每天一段视频，别让硬盘先放弃">
      ${storage
        ? html`
            <div class="grid-3 tight">
              <div class="stat">
                <div class="stat-label">现在占用</div>
                <div class="stat-value">${humanBytes(storage.keptBytes || 0)}</div>
                <div class="stat-sub">${storage.counts?.videos || 0} 段视频</div>
              </div>
              <div class="stat">
                <div class="stat-label">压缩省下</div>
                <div class="stat-value">${humanBytes(storage.savedBytes || 0)}</div>
                <div class="stat-sub">${storage.originalBytes ? `原来的 ${Math.round((storage.savedRatio || 0) * 100)}%` : '暂无数据'}</div>
              </div>
              <div class="stat">
                <div class="stat-label">磁盘剩余</div>
                <div class="stat-value">${storage.disk?.freeBytes ? humanBytes(storage.disk.freeBytes) : '—'}</div>
                <div class="stat-sub">${storage.byKind?.raw ? `原片占 ${humanBytes(storage.byKind.raw)}` : '没有留存原片'}</div>
              </div>
            </div>
            <div class="tiny faint">
              详细的清理操作在「视频」页底部。这里只调策略。
            </div>
          `
        : null}

      <div class="divider"></div>

      <${Field}
        label="上传后怎么归档"
        desc="录完自动压小，画质对看自己说话够用；后面可以随时改，再用「重新归档」重跑"
      >
        <select class="select" value=${archive} onChange=${(e) => save({ media: { archive: e.target.value } })}>
          <option value="compact">压缩到 540p（推荐，一段 20 分钟约 20-40 MB）</option>
          <option value="high">压缩到 720p（更清楚，体积约 2 倍）</option>
          <option value="audio">只留音频 + 文字稿（最省，看不了画面）</option>
          <option value="original">不压缩，留原片（最占地方）</option>
        </select>
      </${Field}>

      ${compressed
        ? html`
            <div class="grid-2 tight">
              <${Field} label="归档高度（像素）" desc="540 够看表情和板书；横屏竖屏都按短边算">
                <input
                  class="input"
                  type="number"
                  min="240"
                  max="1080"
                  step="60"
                  value=${m.compactHeight || 540}
                  onInput=${(e) => save({ media: { compactHeight: Number(e.target.value) || 540 } })}
                />
              </${Field}>
              <${Field} label="压缩力度（CRF）" desc="数字越大越小越糊；30 很适合说话的画面">
                <input
                  class="input"
                  type="number"
                  min="18"
                  max="40"
                  step="1"
                  value=${m.compactCrf ?? 30}
                  onInput=${(e) => save({ media: { compactCrf: Number(e.target.value) || 30 } })}
                />
              </${Field}>
            </div>
          `
        : null}

      ${archive === 'audio'
        ? html`
            <${Field} label="音频码率（kbps）" desc="64 就能听清说话">
              <input
                class="input"
                type="number"
                min="32"
                max="192"
                step="16"
                value=${m.compactAudioKbps || 64}
                onInput=${(e) => save({ media: { compactAudioKbps: Number(e.target.value) || 64 } })}
              />
            </${Field}>
          `
        : null}

      ${archive !== 'audio'
        ? html`
            <${Switch}
              label="另外留一份纯音频"
              desc="坐着听自己的总结比看视频省时间，转写也更快"
              checked=${m.keepAudio !== false}
              onChange=${(v) => save({ media: { keepAudio: v } })}
            />
          `
        : null}

      <${Field} label="原片怎么处理" desc="转码完成后要不要留着原始的大文件">
        <select class="select" value=${keepOriginal} onChange=${(e) => save({ media: { keepOriginal: e.target.value } })}>
          <option value="off">压完就删（最省空间，推荐）</option>
          <option value="days">先留几天再删</option>
          <option value="always">一直留着</option>
        </select>
      </${Field}>

      ${keepOriginal === 'days'
        ? html`
            <${Field} label="留几天" desc="超过这个天数的原片会在后台被清掉，归档版一直留着">
              <input
                class="input"
                type="number"
                min="1"
                max="365"
                value=${m.keepOriginalDays || 7}
                onInput=${(e) => save({ media: { keepOriginalDays: Number(e.target.value) || 7 } })}
              />
            </${Field}>
          `
        : null}

      <${Field}
        label="小于这个大小就不压了（MB）"
        desc="原片本来就不大、格式也能直接播，压它只是浪费 CPU"
      >
        <input
          class="input"
          type="number"
          min="0"
          max="2000"
          step="10"
          value=${m.skipTranscodeBelowMb ?? 120}
          onInput=${(e) => save({ media: { skipTranscodeBelowMb: Number(e.target.value) || 0 } })}
        />
      </${Field}>
    </${Section}>

    <${Section} title="收件箱" desc="手机传大视频，走这里比浏览器上传靠谱">
      <div class="tiny faint" style=${{ lineHeight: 1.9 }}>
        手机用微信 / QQ 把视频传到电脑，把文件拖进下面这个文件夹，就会自动导入、归档、转写、让 AI 读一遍。
      </div>
      <code
        style=${{
          display: 'block',
          padding: '8px 10px',
          borderRadius: '8px',
          background: 'var(--surface-2, rgba(127,127,127,0.1))',
          fontSize: '12px',
          wordBreak: 'break-all',
          userSelect: 'all',
        }}
      >${inbox?.dir || 'data/inbox'}</code>

      <div class="row wrap" style=${{ gap: '8px', alignItems: 'center' }}>
        <button class="btn btn-sm" onClick=${doScan} disabled=${scanning}>
          ${scanning ? html`<span class="spinner"></span>` : html`<${Icon} name="refresh" size=${13} />`}
          立即扫描
        </button>
        ${pending.length
          ? html`<span class="chip gold" style=${{ fontSize: '11px' }}>${pending.length} 个在等</span>`
          : html`<span class="tiny faint">现在是空的</span>`}
        ${inbox?.lastScanAt ? html`<span class="tiny faint">上次扫描 ${inbox.lastScanAt.slice(11, 19)}</span>` : null}
        ${inbox?.watching ? null : html`<span class="chip plain" style=${{ fontSize: '11px' }}>自动扫描已关闭</span>`}
      </div>

      <${Switch}
        label="自动扫描收件箱"
        desc="关掉以后只能手动点「立即扫描」"
        checked=${m.inboxEnabled !== false}
        onChange=${(v) => save({ media: { inboxEnabled: v } })}
      />
      <${Switch}
        label="记到文件时间那一天"
        desc="打开＝按视频文件的修改日期归档；关掉＝都记到今天"
        checked=${(m.inboxDateFrom || 'filetime') === 'filetime'}
        onChange=${(v) => save({ media: { inboxDateFrom: v ? 'filetime' : 'today' } })}
      />
      <${Field} label="扫描间隔（秒）" desc="太短没必要，20 秒足够">
        <input
          class="input"
          type="number"
          min="5"
          max="600"
          step="5"
          value=${m.inboxScanSeconds || 20}
          onInput=${(e) => save({ media: { inboxScanSeconds: Number(e.target.value) || 20 } })}
        />
      </${Field}>
    </${Section}>
  `;
}

/* ---------------- 数据 ---------------- */

function DataSection({ caps, reload }) {
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const doImport = async (file) => {
    if (!file) return;
    const ok = await confirmDialog({
      title: '导入备份',
      message: '会用备份文件里的一切替换当前数据（设置、打卡、任务、视频索引）。确定继续？',
      danger: true,
      confirmText: '导入并覆盖',
    });
    if (!ok) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.upload('/api/settings/import', form);
      toastOk('导入完成，正在重新加载…');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toastErr(err.message);
    } finally {
      setImporting(false);
    }
  };

  return html`
    <${Section} title="数据与备份">
      <${Notice} level="ok">
        所有数据（打卡、视频、分析结果）都在你自己电脑上的 data 目录里，没有任何东西会上传到服务器。
        建议每周把 data 目录复制一份到网盘或移动硬盘。
      </${Notice}>

      <div class="stack-sm">
        <div class="row-between">
          <span class="sm muted">数据文件</span>
          <span class="mono tiny faint" style=${{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ${caps?.dataPath || ''}
          </span>
        </div>
        ${caps?.dataStats
          ? html`
              <div class="row-between">
                <span class="sm muted">大小</span>
                <span class="sm num faint">${humanBytes(caps.dataStats.bytes)}</span>
              </div>
              <div class="row-between">
                <span class="sm muted">记录</span>
                <span class="sm num faint">
                  ${caps.dataStats.days} 天 · ${caps.dataStats.tasks} 个任务 · ${caps.dataStats.videos} 个视频
                </span>
              </div>
            `
          : null}
      </div>

      <div class="row wrap" style=${{ gap: '8px' }}>
        <a class="btn btn-sm" href="/api/settings/export" download>
          <${Icon} name="download" size=${13} /> 导出备份
        </a>
        <button class="btn btn-sm" onClick=${() => fileRef.current?.click()} disabled=${importing}>
          ${importing ? html`<span class="spinner"></span>` : html`<${Icon} name="upload" size=${13} />`} 导入备份
        </button>
        <input ref=${fileRef} type="file" accept="application/json,.json" style=${{ display: 'none' }}
          onChange=${(e) => {
            doImport(e.target.files?.[0]);
            e.target.value = '';
          }} />
      </div>

      <div class="divider"></div>

      <${Field} label="危险操作">
        <div class="row wrap" style=${{ gap: '8px' }}>
          <button class="btn btn-sm btn-danger"
            onClick=${async () => {
              const ok = await confirmDialog({
                title: '恢复出厂设置',
                message: '作息、指标、AI 配置会全部恢复到初始模板。打卡记录、任务、视频不动。',
                danger: true,
                confirmText: '恢复设置',
              });
              if (!ok) return;
              try {
                await api.post('/api/settings/reset', {});
                toastOk('设置已恢复');
                await reload();
              } catch (err) {
                toastErr(err.message);
              }
            }}>
            恢复默认设置
          </button>
        </div>
      </${Field}>
    </${Section}>
  `;
}
