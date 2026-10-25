/** 视频上传组件。用 XHR 拿上传进度，大文件体验好很多。 */

import { html } from 'htm/preact';
import { useRef, useState } from 'preact/hooks';
import { Icon } from '../lib/icons.js';
import { humanBytes } from '../lib/format.js';
import { toastErr, toastOk } from '../store.js';

export function VideoUploader({ date, onDone, compact = false, label = '上传今日总结视频' }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [filename, setFilename] = useState('');
  const xhrRef = useRef(null);

  const pick = () => inputRef.current?.click();

  const upload = (file) => {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
      toastErr('这个文件看起来不是视频');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('date', date);

    setFilename(file.name);
    setProgress({ loaded: 0, total: file.size, pct: 0 });

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/videos');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress({ loaded: e.loaded, total: e.total, pct: Math.round((e.loaded / e.total) * 100) });
      }
    };
    xhr.onload = () => {
      setProgress(null);
      try {
        const payload = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && payload.ok) {
          toastOk('视频已保存到本地');
          onDone?.(payload.data.video);
        } else {
          toastErr(payload.error || '上传失败');
        }
      } catch {
        toastErr('上传失败（返回内容异常）');
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      toastErr('上传中断了，检查一下磁盘空间或网络');
    };
    xhr.send(form);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) upload(file);
  };

  if (progress) {
    return html`
      <div class="dropzone" style=${{ cursor: 'default' }}>
        <div class="dz-icon"><${Icon} name="upload" size=${19} /></div>
        <div class="sm strong" style=${{ marginBottom: '4px' }}>正在保存 ${filename}</div>
        <div class="bar" style=${{ maxWidth: '320px', margin: '10px auto 6px' }}>
          <i style=${{ width: `${progress.pct}%` }}></i>
        </div>
        <div class="tiny faint num">
          ${humanBytes(progress.loaded)} / ${humanBytes(progress.total)} · ${progress.pct}%
        </div>
        <button
          class="btn btn-sm btn-ghost"
          style=${{ marginTop: '10px' }}
          onClick=${() => {
            xhrRef.current?.abort();
            setProgress(null);
          }}
        >
          取消
        </button>
      </div>
    `;
  }

  return html`
    <div
      class=${`dropzone ${over ? 'over' : ''}`}
      onClick=${pick}
      onDragOver=${(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave=${() => setOver(false)}
      onDrop=${onDrop}
      style=${compact ? { padding: '16px' } : undefined}
    >
      <div class="dz-icon" style=${compact ? { width: '32px', height: '32px', marginBottom: '8px' } : undefined}>
        <${Icon} name="camera" size=${compact ? 15 : 19} />
      </div>
      <div class="sm strong">${label}</div>
      ${compact
        ? null
        : html`<div class="tiny faint" style=${{ marginTop: '4px' }}>
            拖文件进来，或者点这里选。视频只存在你自己电脑上。
          </div>`}
      <input
        ref=${inputRef}
        type="file"
        accept="video/*"
        style=${{ display: 'none' }}
        onChange=${(e) => {
          upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  `;
}
