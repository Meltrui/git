/** 视频页：上传、播放、转写、AI 对照分析、周回顾 */

import { html } from 'htm/preact';
import { useMemo, useState } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import { api, useS, useFetch, useAction, waitForJob, toastOk, toastErr, refreshBoot } from '../store.js';
import { todayStr, prettyDate, humanBytes, humanDuration, timeAgo, isoWeekOf } from '../lib/format.js';
import { Modal, Notice, Empty, Loading, Field, confirmDialog, Bar } from '../components/ui.js';
import { CapabilityDot } from '../components/charts.js';
import { VideoUploader } from '../components/video-upload.js';

export function VideosPage() {
  const s = useS();
  const today = s.boot?.today || todayStr();
  const [uploadDate, setUploadDate] = useState(today);
  const [playing, setPlaying] = useState(null);
  const { run } = useAction();

  const { data, loading, reload } = useFetch(() => api.get('/api/videos'), []);
  const caps = data?.capabilities || s.boot?.capabilities;

  const groups = useMemo(() => {
    const map = new Map();
    for (const v of data?.videos || []) {
      if (!map.has(v.date)) map.set(v.date, []);
      map.get(v.date).push(v);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data?.videos]);

  if (loading && !data) return html`<${Loading} text="正在读取视频库…" />`;

  const asr = caps?.asr;
  const media = caps?.media;

  return html`
    <div class="fade-in stack" style=${{ gap: '16px' }}>
      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <${Icon} name="camera" size=${16} />
            <h2>上传总结视频</h2>
          </div>
          <div class="card-body stack">
            <${Field} label="记到哪一天">
              <input
                class="input"
                type="date"
                value=${uploadDate}
                max=${today}
                onInput=${(e) => setUploadDate(e.target.value)}
              />
            </${Field}>
            <${VideoUploader}
              date=${uploadDate}
              onDone=${async () => {
                await reload();
                refreshBoot();
              }}
            />
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <${Icon} name="cpu" size=${16} />
            <h2>能力状态</h2>
          </div>
          <div class="card-body stack-sm" style=${{ gap: '10px' }}>
            <${CapabilityDot}
              ok=${media?.ffmpeg}
              label=${media?.ffmpeg ? 'ffmpeg 就绪（封面 / 转码 / 周回顾可用）' : '缺少 ffmpeg（封面与周回顾不可用）'}
            />
            <${CapabilityDot}
              ok=${asr?.localReady}
              label=${asr?.localReady
                ? `本地转写模型就绪（${asr.localModelSizeMb} MB，完全离线）`
                : '本地转写模型未下载'}
            />
            <${CapabilityDot}
              ok=${asr?.canTranscribe}
              label=${asr?.canTranscribe ? '现在可以自动转写' : '暂时不能自动转写（可以手动粘贴文字稿）'}
            />
            <${CapabilityDot}
              ok=${s.boot?.capabilities?.ai?.configured}
              label=${s.boot?.capabilities?.ai?.configured
                ? '大模型已配置，可做 AI 对照分析'
                : '大模型未配置（无法做 AI 分析）'}
            />

            ${!asr?.localReady
              ? html`
                  <${Notice} level="info">
                    想让视频自动生成文字稿？在「设置 → 语音转写」里一键下载本地模型（约 240MB，只需一次，之后完全离线免费）。
                  </${Notice}>
                `
              : null}

            <div class="row-between" style=${{ paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
              <span class="tiny faint">共 ${data?.videos?.length || 0} 段视频 · 全部存在本机</span>
              <button class="btn btn-sm" onClick=${() => reload(true)}>
                <${Icon} name="refresh" size=${13} /> 刷新
              </button>
            </div>
          </div>
        </div>
      </div>

      ${renderReels(data?.reels || [], today, run)}

      ${groups.length
        ? groups.map(
            ([date, videos]) => html`
              <div class="card">
                <div class="card-head">
                  <${Icon} name="film" size=${16} />
                  <h2>${prettyDate(date)}</h2>
                  <span class="hint">${videos.length} 段</span>
                </div>
                <div class="card-body">
                  <div class="video-grid">
                    ${videos.map((v) => renderVideoCard(v, () => setPlaying(v)))}
                  </div>
                </div>
              </div>
            `,
          )
        : html`
            <${Empty}
              icon="film"
              title="还没有视频"
              description="每天学习结束后录一段 1–3 分钟的总结视频上传。攒够几天以后，AI 能对照你的打卡记录找出「嘴上说做了、实际没做」的地方。"
            />
          `}

      ${playing
        ? html`<${VideoDetail}
            video=${playing}
            caps=${caps}
            onClose=${async () => {
              setPlaying(null);
              await reload(true);
            }}
            onChanged=${reload}
            onDeleted=${async () => {
              setPlaying(null);
              await reload();
            }}
          />`
        : null}
    </div>
  `;
}

/* ------------------------------------------------------------------ */

function renderVideoCard(v, onOpen) {
  return html`
    <button class="video-card" onClick=${onOpen}>
      <div class="video-thumb">
        ${v.thumbUrl ? html`<img src=${v.thumbUrl} alt="" loading="lazy" />` : html`<${Icon} name="film" size=${22} />`}
        <div class="play"><${Icon} name="play" size=${26} /></div>
        ${v.durationSec ? html`<span class="badge-dur">${humanDuration(v.durationSec)}</span>` : null}
      </div>
      <div class="video-meta">
        <span class="vt">${v.title || '总结视频'}</span>
        <div class="row wrap" style=${{ gap: '4px' }}>
          ${v.transcribeStatus === 'done'
            ? html`<span class="chip plain" style=${{ fontSize: '10px' }}>已转写</span>`
            : v.transcribeStatus === 'running'
              ? html`<span class="chip active" style=${{ fontSize: '10px' }}>转写中</span>`
              : null}
          ${v.analyzed ? html`<span class="chip violet" style=${{ fontSize: '10px' }}>已分析</span>` : null}
          ${v.playable === false ? html`<span class="chip amber" style=${{ fontSize: '10px' }}>需转码</span>` : null}
          <span class="tiny faint">${humanBytes(v.size)}</span>
        </div>
      </div>
    </button>
  `;
}

/* ------------------------------------------------------------------ */

function renderReels(reels, today, run) {
  const currentWeek = isoWeekOf(today);
  return html`
    <div class="card">
      <div class="card-head">
        <${Icon} name="play" size=${16} />
        <h2>周回顾</h2>
        <span class="hint">把一周的录像拼成一条，方便整体回看</span>
        <button
          class="btn btn-sm"
          style=${{ marginLeft: 'auto' }}
          onClick=${async () => {
            const res = await run(() => api.post(`/api/weeks/${currentWeek}/reel`));
            if (res?.job) toastOk('正在后台合成，稍等片刻刷新看看');
          }}
        >
          <${Icon} name="sparkles" size=${13} /> 合成 ${currentWeek.slice(5)} 周
        </button>
      </div>
      <div class="card-body">
        ${reels.length
          ? html`<div class="video-grid">
              ${reels.map(
                (r) => html`
                  <div class="video-card" style=${{ cursor: 'default' }}>
                    <div class="video-thumb">
                      <video
                        src=${`/api/reels/${r.filename}`}
                        controls
                        preload="metadata"
                        style=${{ width: '100%', height: '100%', objectFit: 'cover' }}
                      ></video>
                    </div>
                    <div class="video-meta">
                      <span class="vt">${r.filename.replace('reel-', '').replace('.mp4', '')} 周回顾</span>
                      <span class="tiny faint">${humanBytes(r.size)}</span>
                    </div>
                  </div>
                `,
              )}
            </div>`
          : html`<div class="tiny faint">还没有合成过周回顾。攒够 2 段以上同一周的视频，点右上角合成。</div>`}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */

function VideoDetail({ video: initial, caps, onClose, onChanged, onDeleted }) {
  const [video, setVideo] = useState(initial);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [transcriptDraft, setTranscriptDraft] = useState(initial.transcript?.text || '');
  const [savingTranscript, setSavingTranscript] = useState(false);

  const refreshVideo = async () => {
    const res = await api.get(`/api/videos?date=${video.date}`);
    const fresh = (res.videos || []).find((v) => v.id === video.id);
    if (fresh) {
      setVideo(fresh);
      setTranscriptDraft(fresh.transcript?.text || '');
    }
    return fresh;
  };

  const doTranscribe = async () => {
    setBusy('transcribe');
    setProgress(0);
    try {
      const { job } = await api.post(`/api/videos/${video.id}/transcribe`);
      await waitForJob(job.id, {
        onTick: (j) => {
          setProgress(j.progress || 0);
          setStep(j.step || '');
        },
      });
      await refreshVideo();
      await onChanged?.(true);
      toastOk('转写完成');
    } catch (err) {
      toastErr(err.message);
      await refreshVideo();
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const doAnalyze = async () => {
    setBusy('analyze');
    setProgress(0);
    try {
      const { job } = await api.post(`/api/videos/${video.id}/analyze`);
      await waitForJob(job.id, {
        onTick: (j) => {
          setProgress(j.progress || 0);
          setStep(j.step || '');
        },
      });
      await refreshVideo();
      await onChanged?.(true);
      toastOk('分析完成');
    } catch (err) {
      toastErr(err.message);
      await refreshVideo();
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const doProxy = async () => {
    setBusy('proxy');
    setStep('正在转码…');
    try {
      const { job } = await api.post(`/api/videos/${video.id}/proxy`);
      await waitForJob(job.id, { onTick: (j) => setStep(j.step || '') });
      await refreshVideo();
      toastOk('已生成可播放版本');
    } catch (err) {
      toastErr(err.message);
    } finally {
      setBusy(null);
      setStep('');
    }
  };

  const saveTranscript = async () => {
    setSavingTranscript(true);
    try {
      await api.patch(`/api/videos/${video.id}`, { transcriptText: transcriptDraft });
      await refreshVideo();
      toastOk('文字稿已保存');
    } catch (err) {
      toastErr(err.message);
    } finally {
      setSavingTranscript(false);
    }
  };

  const doDelete = async () => {
    const ok = await confirmDialog({
      title: '删除这段视频',
      message: '视频文件和它的文字稿、分析结果都会从本机删掉，不能恢复。',
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    try {
      await api.del(`/api/videos/${video.id}`);
      toastOk('已删除');
      onDeleted?.();
    } catch (err) {
      toastErr(err.message);
    }
  };

  const applyChecks = async (itemIds) => {
    try {
      const res = await api.post(`/api/videos/${video.id}/apply-checks`, { itemIds });
      toastOk(`已补勾 ${res.applied} 项`);
      await refreshVideo();
      await onChanged?.(true);
      refreshBoot();
    } catch (err) {
      toastErr(err.message);
    }
  };

  const a = video.analysis;
  const transcript = video.transcript || {};

  return html`
    <${Modal}
      open
      wide
      title=${video.title || '总结视频'}
      onClose=${onClose}
      footer=${html`
        <span class="tiny faint" style=${{ marginRight: 'auto' }}>
          ${video.date} · ${humanBytes(video.size)}
          ${video.durationSec ? ` · ${humanDuration(video.durationSec)}` : ''}
          · ${timeAgo(video.createdAt)}
        </span>
        <button class="btn btn-sm btn-danger" onClick=${doDelete}>
          <${Icon} name="trash" size=${13} /> 删除
        </button>
        <button class="btn" onClick=${onClose}>关闭</button>
      `}
    >
      <div class="player-wrap">
        <video src=${`/api/videos/${video.id}/file`} controls playsinline preload="metadata"></video>
      </div>

      ${video.playable === false
        ? html`
            <${Notice} level="warn">
              这个视频的编码浏览器可能放不了（手机录的 HEVC 常见）。
              <button class="link-btn" onClick=${doProxy} disabled=${busy === 'proxy'}>
                ${busy === 'proxy' ? '正在转码…' : '点这里转成网页可播版本'}
              </button>
            </${Notice}>
          `
        : null}

      <div class="row wrap" style=${{ gap: '8px' }}>
        <button class="btn btn-sm" onClick=${doTranscribe} disabled=${!!busy || !caps?.asr?.canTranscribe}>
          ${busy === 'transcribe' ? html`<span class="spinner"></span>` : html`<${Icon} name="mic" size=${13} />`}
          ${transcript.status === 'done' ? '重新转写' : '转写文字稿'}
        </button>
        <button class="btn btn-sm btn-primary" onClick=${doAnalyze} disabled=${!!busy || !video.transcript?.text}>
          ${busy === 'analyze' ? html`<span class="spinner"></span>` : html`<${Icon} name="sparkles" size=${13} />`}
          AI 对照分析
        </button>
        ${transcript.provider ? html`<span class="chip plain">${transcript.provider}</span>` : null}
        ${busy && step ? html`<span class="tiny faint">${step}</span>` : null}
      </div>

      ${busy && progress > 0 ? html`<div class="stack-sm"><${Bar} value=${progress} /></div>` : null}
      ${transcript.error ? html`<${Notice} level="danger">${transcript.error}</${Notice}>` : null}

      <div class="stack-sm">
        <div class="row-between">
          <div class="section-title" style=${{ margin: 0 }}>文字稿</div>
          <div class="row" style=${{ gap: '6px' }}>
            ${transcriptDraft && transcriptDraft !== (transcript.text || '')
              ? html`<button class="btn btn-sm btn-primary" onClick=${saveTranscript} disabled=${savingTranscript}>
                  保存
                </button>`
              : null}
            <span class="tiny faint">${transcriptDraft.length} 字</span>
          </div>
        </div>
        <textarea
          class="textarea"
          style=${{ minHeight: '110px', fontSize: '13px', lineHeight: 1.8 }}
          placeholder="点上面「转写文字稿」自动生成；也可以自己粘贴一段今天的学习总结。"
          value=${transcriptDraft}
          onInput=${(e) => setTranscriptDraft(e.target.value)}
        ></textarea>
      </div>

      ${a ? renderAnalysis(a, applyChecks) : null}
    </${Modal}>
  `;
}

function renderAnalysis(a, applyChecks) {
  return html`
    <div class="stack" style=${{ gap: '14px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
      <div class="row" style=${{ gap: '8px' }}>
        <${Icon} name="sparkles" size=${15} />
        <strong style=${{ fontSize: '14px' }}>AI 对照分析</strong>
        ${a.mood?.label ? html`<span class="chip violet">${a.mood.label}</span>` : null}
      </div>

      ${a.summary ? html`<p class="report-narrative" style=${{ fontSize: '14px' }}>${a.summary}</p>` : null}

      ${a.selfReport?.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">你说的 vs 你记的</div>
              ${a.selfReport.map(
                (r) => html`
                  <div class="row" style=${{ gap: '8px', alignItems: 'flex-start', fontSize: '13px' }}>
                    <span
                      style=${{
                        color:
                          r.matchesRecord === false
                            ? 'var(--rose)'
                            : r.matchesRecord === true
                              ? 'var(--teal)'
                              : 'var(--text-faint)',
                        marginTop: '3px',
                        flex: '0 0 auto',
                      }}
                    >
                      <${Icon} name=${r.matchesRecord === false ? 'x' : 'check'} size=${13} />
                    </span>
                    <div class="stack-sm" style=${{ gap: '1px', minWidth: 0 }}>
                      <span>${r.text}</span>
                      ${r.note ? html`<span class="tiny faint">${r.note}</span>` : null}
                    </div>
                  </div>
                `,
              )}
            </div>
          `
        : null}

      ${a.gaps?.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">对不上的地方</div>
              <ul class="list-bullets bad">
                ${a.gaps.map((g) => html`<li>${g}</li>`)}
              </ul>
            </div>
          `
        : null}

      ${a.suggestedChecks?.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">建议你补勾这些</div>
              ${a.suggestedChecks.map(
                (c) => html`
                  <div class="adjustment">
                    <div class="adj-main">
                      <span class="adj-title">${c.title}</span>
                      <span class="adj-reason">${c.reason}</span>
                    </div>
                    <button class="btn btn-sm btn-primary" onClick=${() => applyChecks([c.itemId])}>补勾</button>
                  </div>
                `,
              )}
            </div>
          `
        : null}

      ${a.insights?.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">学习方法上的观察</div>
              <ul class="list-bullets violet">
                ${a.insights.map((i) => html`<li>${i}</li>`)}
              </ul>
            </div>
          `
        : null}

      ${a.tomorrowTips?.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">明天就能用上的</div>
              <ul class="list-bullets good">
                ${a.tomorrowTips.map((i) => html`<li>${i}</li>`)}
              </ul>
            </div>
          `
        : null}
    </div>
  `;
}
