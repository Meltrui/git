/** 视频页：上传、播放、转写、AI 对照分析、周回顾 */

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
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
  const { data: storage, reload: reloadStorage } = useFetch(() => api.get('/api/storage'), []);
  const { data: inbox, reload: reloadInbox } = useFetch(() => api.get('/api/inbox'), []);
  const caps = data?.capabilities || s.boot?.capabilities;

  const refreshStorage = async () => {
    await Promise.all([reloadStorage(true), reloadInbox(true)]);
  };

  /* 有视频正在归档 / 转写时自动刷新，不用他手动点 */
  const busyCount = (data?.videos || []).filter(
    (v) =>
      v.storage?.state === 'pending' || v.storage?.state === 'processing' || v.transcribeStatus === 'running',
  ).length;

  useEffect(() => {
    if (!busyCount) return undefined;
    const timer = setInterval(() => {
      reload(true);
      reloadStorage(true);
    }, 4000);
    return () => clearInterval(timer);
  }, [busyCount]);

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

      ${html`<${StorageCard}
        storage=${storage}
        inbox=${inbox}
        onRefresh=${async () => {
          await refreshStorage();
          await reload(true);
        }}
      />`}

      ${renderReels(data?.reels || [], today, run)}

      ${(data?.videos || []).length
        ? html`
            <div class="card">
              <div class="card-head">
                <${Icon} name="film" size=${16} />
                <h2>视频库</h2>
                <span class="hint">${data.videos.length} 段 · 共 ${groups.length} 天</span>
                <span class="chip plain" style=${{ marginLeft: 'auto' }}>
                  <${Icon} name="clock" size=${11} /> 最近的在前
                </span>
              </div>
              <div class="card-body">
                <div class="video-grid">
                  ${data.videos.map((v) => renderVideoCard(v, () => setPlaying(v)))}
                </div>
              </div>
            </div>
          `
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
  const st = v.storage || {};
  const busyArchiving = st.state === 'pending' || st.state === 'processing';
  const keptBytes = (st.archiveSize || 0) + (st.audioSize || 0);
  const shownBytes = keptBytes || v.size || 0;
  const savedPct = st.originalSize ? Math.round((1 - keptBytes / st.originalSize) * 100) : 0;

  return html`
    <button class="video-card" onClick=${onOpen}>
      <div class="video-thumb">
        ${v.thumbUrl ? html`<img src=${v.thumbUrl} alt="" loading="lazy" />` : html`<${Icon} name="film" size=${22} />`}
        <div class="play"><${Icon} name="play" size=${26} /></div>
        ${v.durationSec ? html`<span class="badge-dur">${humanDuration(v.durationSec)}</span>` : null}
        ${busyArchiving
          ? html`<span
              class="chip active"
              style=${{ position: 'absolute', top: '8px', left: '8px', fontSize: '10px' }}
            >
                ${st.state === 'pending' ? '待归档' : '归档中'}
              </span>`
          : st.state === 'failed'
            ? html`<span
                class="chip amber"
                style=${{ position: 'absolute', top: '8px', left: '8px', fontSize: '10px' }}
              >
                归档失败
              </span>`
            : null}
      </div>
      <div class="video-meta">
        <span class="vt">${v.title || '总结视频'}</span>
        <div class="row wrap" style=${{ gap: '4px' }}>
          <span class="tiny faint nowrap">${prettyDate(v.date, { withWeekday: false })}</span>
          <span class="tiny faint nowrap">· ${humanBytes(shownBytes)}</span>
          ${savedPct > 0 ? html`<span class="tiny" style=${{ color: 'var(--teal)' }}>省 ${savedPct}%</span>` : null}
          ${v.transcribeStatus === 'done'
            ? html`<span class="chip plain" style=${{ fontSize: '10px' }}>已转写</span>`
            : v.transcribeStatus === 'running'
              ? html`<span class="chip active" style=${{ fontSize: '10px' }}>转写中</span>`
              : null}
          ${v.analyzed ? html`<span class="chip violet" style=${{ fontSize: '10px' }}>已分析</span>` : null}
          ${v.playable === false ? html`<span class="chip amber" style=${{ fontSize: '10px' }}>需转码</span>` : null}
        </div>
      </div>
    </button>
  `;
}

/* ------------------------------------------------------------------ */

/**
 * 存储与手机传输。
 *
 * 用户最初的担心是「一段视频 1-2GB，会不会把硬盘吃满」。
 * 这里直接把「原始多大 / 现在占多大 / 省了多少」摊开给他看，
 * 顺带告诉他手机传大文件的正确姿势（走收件箱，不走浏览器上传）。
 */
function StorageCard({ storage, inbox, onRefresh }) {
  const [busy, setBusy] = useState(null);
  const [scanning, setScanning] = useState(false);
  if (!storage) return null;

  const orig = storage.originalBytes || 0;
  const kept = storage.keptBytes || 0;
  const saved = storage.savedBytes || 0;
  const ratio = Math.round((storage.savedRatio || 0) * 100);
  const counts = storage.counts || {};
  const free = storage.disk?.freeBytes || 0;
  const pending = inbox?.pending || [];
  const pendingBytes = inbox?.pendingBytes || 0;

  const clean = async (what, message, okText) => {
    const yes = await confirmDialog({
      title: '清理文件',
      message,
      danger: true,
      confirmText: '清理',
    });
    if (!yes) return;
    setBusy(what);
    try {
      const res = await api.post('/api/storage/cleanup', { what });
      if (res.removed) toastOk(`${okText}：清掉 ${res.removed} 个文件，释放 ${humanBytes(res.freedBytes || 0)}`);
      else toastOk('没有可清理的文件');
      await onRefresh();
    } catch (err) {
      toastErr(err.message);
    } finally {
      setBusy(null);
    }
  };

  const doScan = async () => {
    setScanning(true);
    try {
      const res = await api.post('/api/inbox/scan');
      const n = (res.imported || []).length;
      if (n) toastOk(`导入 ${n} 个视频，正在后台归档`);
      else if (res.waiting) toastOk(`${res.waiting} 个文件还在传输中，稍后自动导入`);
      else toastOk('收件箱是空的');
      await onRefresh();
    } catch (err) {
      toastErr(err.message);
    } finally {
      setScanning(false);
    }
  };

  return html`
    <div class="card">
      <div class="card-head">
        <${Icon} name="database" size=${16} />
        <h2>存储</h2>
        <span class="hint">上传后自动压成 540p 归档，原片按设置清理</span>
        <button class="btn btn-sm" style=${{ marginLeft: 'auto' }} onClick=${onRefresh}>
          <${Icon} name="refresh" size=${13} /> 刷新
        </button>
      </div>
      <div class="card-body stack" style=${{ gap: '14px' }}>
        <div class="grid-4">
          <div class="stat">
            <div class="stat-label"><${Icon} name="film" size=${13} />现在占用</div>
            <div class="stat-value">${humanBytes(kept)}</div>
            <div class="stat-sub">${counts.videos || 0} 段视频</div>
          </div>
          <div class="stat">
            <div class="stat-label"><${Icon} name="download" size=${13} />已经省下</div>
            <div class="stat-value">${humanBytes(saved)}</div>
            <div class="stat-sub">${orig ? `原来的 ${ratio}%` : '还没有可比的数据'}</div>
          </div>
          <div class="stat">
            <div class="stat-label"><${Icon} name="copy" size=${13} />原片还在</div>
            <div class="stat-value">${humanBytes(storage.byKind?.raw || 0)}</div>
            <div class="stat-sub">${counts.withRaw || 0} 段留着原始文件</div>
          </div>
          <div class="stat">
            <div class="stat-label"><${Icon} name="database" size=${13} />磁盘剩余</div>
            <div class="stat-value">${free ? humanBytes(free) : '—'}</div>
            <div class="stat-sub">${storage.disk?.totalBytes ? `总 ${humanBytes(storage.disk.totalBytes)}` : '读不到磁盘信息'}</div>
          </div>
        </div>

        ${orig ? html`<div class="bar teal"><i style=${{ width: `${Math.max(2, 100 - ratio)}%` }}></i></div>` : null}

        <div class="row wrap" style=${{ gap: '8px' }}>
          <button
            class="btn btn-sm"
            disabled=${!!busy || !counts.withRaw}
            onClick=${() =>
              clean(
                'raw',
                '会把每段视频的原始大文件删掉，只保留压好的 540p 版本和文字稿。视频仍然能看，但不能恢复原画质。',
                '删除原片',
              )}
          >
            ${busy === 'raw' ? html`<span class="spinner"></span>` : html`<${Icon} name="trash" size=${13} />`}
            删除全部原片
          </button>
          <button
            class="btn btn-sm"
            disabled=${!!busy || !counts.orphans}
            onClick=${() =>
              clean(
                'orphans',
                '清理视频目录里没有对应记录的文件（比如导入失败留下的半截文件）。不会碰任何能播放的视频。',
                '清理孤儿文件',
              )}
          >
            ${busy === 'orphans' ? html`<span class="spinner"></span>` : html`<${Icon} name="wand" size=${13} />`}
            清理孤儿文件${counts.orphans ? `（${counts.orphans}）` : ''}
          </button>
          ${counts.failed
            ? html`<button
                class="btn btn-sm"
                disabled=${!!busy}
                onClick=${() => clean('failed', '把处理失败的视频记录和残留文件一起删掉。', '清理失败项')}
              >
                清理失败项（${counts.failed}）
              </button>`
            : null}
        </div>

        <div style=${{ borderTop: '1px solid var(--border)', paddingTop: '12px' }} class="stack-sm">
          <div class="row-between">
            <div class="row" style=${{ gap: '8px' }}>
              <${Icon} name="upload" size=${14} />
              <strong style=${{ fontSize: '13px' }}>手机传视频：丢进收件箱，自动导入</strong>
            </div>
            <span class="chip ${inbox?.watching ? 'active' : 'plain'}" style=${{ fontSize: '10px' }}>
              ${inbox?.watching ? `每 ${inbox.scanSeconds} 秒扫一次` : '自动扫描已关闭'}
            </span>
          </div>
          <div class="tiny faint" style=${{ lineHeight: 1.9 }}>
            手机用微信 / QQ 把视频传到电脑，然后把文件拖到这个文件夹：
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
              ? html`<span class="chip gold" style=${{ fontSize: '11px' }}>
                  ${pending.length} 个在等（${humanBytes(pendingBytes)}）
                </span>`
              : html`<span class="tiny faint">收件箱现在是空的</span>`}
            ${inbox?.lastScanAt ? html`<span class="tiny faint">上次扫描 ${timeAgo(inbox.lastScanAt)}</span>` : null}
          </div>
          ${inbox?.lastError ? html`<div class="tiny" style=${{ color: 'var(--rose)' }}>${inbox.lastError}</div>` : null}
          ${(inbox?.recent || []).length && !pending.length
            ? html`<div class="tiny faint">
                最近导入：${inbox.recent
                  .slice(0, 3)
                  .map((r) => `${r.date} ${humanBytes(r.size)}`)
                  .join(' · ')}
              </div>`
            : null}
        </div>
      </div>
    </div>
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

  const doArchive = async () => {
    setBusy('archive');
    setProgress(0);
    setStep('正在归档…');
    try {
      const { job } = await api.post(`/api/videos/${video.id}/archive`);
      await waitForJob(job.id, {
        onTick: (j) => {
          setProgress(j.progress || 0);
          setStep(j.step || '');
        },
      });
      await refreshVideo();
      await onChanged?.(true);
      toastOk('归档完成');
    } catch (err) {
      toastErr(err.message);
      await refreshVideo();
    } finally {
      setBusy(null);
      setProgress(0);
      setStep('');
    }
  };

  const doDeleteRaw = async () => {
    const yes = await confirmDialog({
      title: '只删原片',
      message: `删掉这段 ${humanBytes(st.rawSize || st.originalSize || video.size || 0)} 的原始文件，保留压好的归档版本和文字稿。省空间，但原画质恢复不了。`,
      danger: true,
      confirmText: '删原片',
    });
    if (!yes) return;
    setBusy('delete-raw');
    try {
      const res = await api.post(`/api/videos/${video.id}/delete-raw`);
      if (res.removed) toastOk(`已删原片，释放 ${humanBytes(res.freedBytes || 0)}`);
      else toastOk('没有可删的原片（可能之前已经清理过）');
      await refreshVideo();
      await onChanged?.(true);
    } catch (err) {
      toastErr(err.message);
    } finally {
      setBusy(null);
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
  const st = video.storage || {};
  const keptBytes = (st.archiveSize || 0) + (st.audioSize || 0);
  const shownBytes = keptBytes || video.size || 0;
  const savedPct = st.originalSize && keptBytes ? Math.round((1 - keptBytes / st.originalSize) * 100) : 0;
  const archiving = st.state === 'pending' || st.state === 'processing';

  return html`
    <${Modal}
      open
      wide
      title=${video.title || '总结视频'}
      onClose=${onClose}
      footer=${html`
        <span class="tiny faint" style=${{ marginRight: 'auto' }}>
          ${video.date} · ${humanBytes(shownBytes)}
          ${savedPct > 0 ? `（原片 ${humanBytes(st.originalSize || 0)}，省 ${savedPct}%）` : ''}
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

      ${archiving
        ? html`
            <${Notice} level="info">
              正在压成归档版本（原片 ${humanBytes(st.rawSize || st.originalSize || video.size || 0)}）。压完会自动转写、让 AI 读一遍，可以先去干别的。
            </${Notice}>
          `
        : st.state === 'failed'
          ? html`
              <${Notice} level="warn">
                归档没成功：${st.error || '未知原因'}。视频本身还能看，可以点下面「重新归档」再试一次。
              </${Notice}>
            `
          : savedPct > 0 || st.error
            ? html`
                ${st.error
                  ? html`
                      <${Notice} level="warn">
                        上次重新归档没成功：${st.error}。现在这份还能看，想再试一次点下面「重新归档」。
                      </${Notice}>
                    `
                  : null}
                <div class="row wrap tiny faint" style=${{ gap: '6px', alignItems: 'center' }}>
                  <${Icon} name="database" size=${12} />
                  <span>
                    原片 ${humanBytes(st.originalSize || 0)} → 归档 ${humanBytes(st.archiveSize || 0)}
                    ${st.audioSize ? `· 音频 ${humanBytes(st.audioSize)}` : ''} · 省了 ${savedPct}%
                  </span>
                  ${st.hasRaw
                    ? html`<button class="link-btn" onClick=${doDeleteRaw} disabled=${!!busy}>
                        ${busy === 'delete-raw' ? '正在删除…' : '只删原片'}
                      </button>`
                    : html`<span>· 原片已清理</span>`}
                </div>
              `
            : null}

      ${video.audioUrl
        ? html`
            <div class="stack-sm" style=${{ gap: '4px' }}>
              <div class="section-title" style=${{ margin: 0 }}>只听声音</div>
              <audio src=${video.audioUrl} controls preload="none" style=${{ width: '100%', height: '34px' }}></audio>
            </div>
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
        <button
          class="btn btn-sm"
          onClick=${doArchive}
          disabled=${!!busy || archiving}
          title="换了清晰度或保留策略后，可以对这段视频再压一次"
        >
          ${busy === 'archive' ? html`<span class="spinner"></span>` : html`<${Icon} name="refresh" size=${13} />`}
          重新归档
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

/* 模型偶尔会把列表给成字符串（甚至整个字段漏掉），这里统一成数组，
   避免一个字段的格式问题把整个弹窗崩掉——弹窗崩了用户就什么都看不到了。 */
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []);
const asObjectList = (v) =>
  asList(v).map((r) => (typeof r === 'string' ? { text: r, matchesRecord: null, note: '' } : r || {}));

function renderAnalysis(a, applyChecks) {
  const methods = asList(a.methodFeedback);
  const advices = asList(a.advice);
  const selfs = asObjectList(a.selfReport);
  const gaps = asList(a.gaps);
  const checks = asObjectList(a.suggestedChecks).filter((c) => c.itemId);
  const insights = asList(a.insights);
  const tips = asList(a.tomorrowTips);

  return html`
    <div class="stack" style=${{ gap: '14px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
      <div class="row" style=${{ gap: '8px' }}>
        <${Icon} name="sparkles" size=${15} />
        <strong style=${{ fontSize: '14px' }}>AI 读完了你这段视频</strong>
        ${a.mood?.label ? html`<span class="chip violet">${a.mood.label}</span>` : null}
      </div>

      ${a.oneLiner
        ? html`<div
            style=${{
              fontSize: '15px',
              fontWeight: 600,
              lineHeight: 1.7,
              paddingLeft: '10px',
              borderLeft: '3px solid var(--accent)',
            }}
          >
            ${a.oneLiner}
          </div>`
        : null}

      ${a.reading
        ? html`
            <div class="stack-sm" style=${{ gap: '4px' }}>
              <div class="section-title" style=${{ margin: 0 }}>我理解到的</div>
              <p class="report-narrative" style=${{ fontSize: '14px' }}>${a.reading}</p>
            </div>
          `
        : null}

      ${a.encouragement
        ? html`
            <div
              style=${{
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'var(--surface-2, rgba(127,127,127,0.08))',
                borderLeft: '3px solid var(--teal)',
              }}
            >
              <div class="section-title" style=${{ margin: '0 0 4px' }}>说给你听</div>
              <p class="report-narrative" style=${{ fontSize: '14px', margin: 0 }}>${a.encouragement}</p>
            </div>
          `
        : null}

      ${methods.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">方法上值得改的</div>
              <ul class="list-bullets violet">
                ${methods.map((i) => html`<li>${i}</li>`)}
              </ul>
            </div>
          `
        : null}

      ${advices.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">接下来几天可以试</div>
              <ul class="list-bullets good">
                ${advices.map((i) => html`<li>${i}</li>`)}
              </ul>
            </div>
          `
        : null}

      ${a.summary ? html`<p class="report-narrative" style=${{ fontSize: '14px' }}>${a.summary}</p>` : null}

      ${selfs.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">你说的 vs 你记的</div>
              ${selfs.map(
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

      ${gaps.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">对不上的地方</div>
              <ul class="list-bullets bad">
                ${gaps.map((g) => html`<li>${g}</li>`)}
              </ul>
            </div>
          `
        : null}

      ${checks.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">建议你补勾这些</div>
              ${checks.map(
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

      ${insights.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">学习方法上的观察</div>
              <ul class="list-bullets violet">
                ${insights.map((i) => html`<li>${i}</li>`)}
              </ul>
            </div>
          `
        : null}

      ${tips.length
        ? html`
            <div class="stack-sm">
              <div class="section-title">明天就能用上的</div>
              <ul class="list-bullets good">
                ${tips.map((i) => html`<li>${i}</li>`)}
              </ul>
            </div>
          `
        : null}
    </div>
  `;
}
