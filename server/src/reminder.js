import { EventEmitter } from 'node:events';
import { toMinutes, nowMinutes, todayStr, weekdayName } from './time.js';
import * as repo from './repo.js';

/**
 * 提醒调度 + SSE 推送。
 * 服务端每 20 秒对一次表，到点后把事件推给所有已连接的页面，
 * 前端收到后弹 toast + 系统通知。
 */

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const fired = new Map(); // date -> Set(eventKey)
let timer = null;

function keyOf(date) {
  if (!fired.has(date)) fired.set(date, new Set());
  return fired.get(date);
}

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const onEvent = (evt) => {
    try {
      res.write(`event: message\ndata: ${JSON.stringify(evt)}\n\n`);
    } catch {
      /* 忽略 */
    }
  };
  bus.on('event', onEvent);

  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* 忽略 */
    }
  }, 25000);
  if (typeof ping.unref === 'function') ping.unref();

  req.on('close', () => {
    clearInterval(ping);
    bus.off('event', onEvent);
    try {
      res.end();
    } catch {
      /* 忽略 */
    }
  });
}

function emit(evt) {
  bus.emit('event', { ...evt, at: new Date().toISOString() });
}

/** 手动推一条（调试用） */
export function pushTestEvent() {
  emit({ id: `test-${Date.now()}`, type: 'test', title: '测试提醒', body: '如果你看到这条，说明提醒通道是通的。' });
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, 20000);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(tick, 2500);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function tick() {
  try {
    const settings = repo.getSettings();
    const reminder = settings.reminder || {};
    if (!reminder.enabled) return;

    const date = todayStr();
    const now = nowMinutes();
    const done = keyOf(date);
    const wd = weekdayName(date);

    const day = repo.getDayRaw(date);
    const blocks = (day?.blocks?.length ? day.blocks : settings.blocks || []).filter(
      (b) => !Array.isArray(b.days) || b.days.includes(new Date().getDay()),
    );

    for (const block of blocks) {
      if (reminder.blockStart !== false) {
        const startAt = toMinutes(block.start);
        const k = `${date}|start|${block.id}`;
        if (!done.has(k) && now >= startAt && now < startAt + 2) {
          done.add(k);
          emit({
            id: k,
            type: 'block-start',
            title: `${block.start} · ${block.label}`,
            body: block.note || '该开始了，先把手机放远一点。',
            blockId: block.id,
          });
        }
      }
      if (reminder.blockEnd) {
        const endAt = toMinutes(block.end);
        const k = `${date}|end|${block.id}`;
        if (!done.has(k) && now >= endAt && now < endAt + 2) {
          done.add(k);
          emit({
            id: k,
            type: 'block-end',
            title: `${block.label} 结束`,
            body: '去打个卡，顺便记一行感受。',
            blockId: block.id,
          });
        }
      }
    }

    // 晚间收尾提醒
    const wrapAt = toMinutes(reminder.dailyWrapUp || '22:00');
    const kw = `${date}|wrapup`;
    if (!done.has(kw) && now >= wrapAt && now < wrapAt + 2) {
      done.add(kw);
      const items = day?.items || [];
      const unfinished = items.filter((i) => (i.record?.status || 'pending') === 'pending');
      emit({
        id: kw,
        type: 'wrapup',
        title: '该收尾了',
        body:
          unfinished.length > 0
            ? `还有 ${unfinished.length} 项没确认：${unfinished.slice(0, 3).map((i) => i.title).join('、')}。录完总结视频就把今天关掉。`
            : '所有条目都确认过了，录个总结视频收工。',
      });
    }

    // 深夜还没关闭今天
    const kc = `${date}|close`;
    if (!done.has(kc) && now >= 23 * 60 + 20) {
      done.add(kc);
      if (day && !day.closed) {
        emit({
          id: kc,
          type: 'day-not-closed',
          title: '今天还没关闭',
          body: '去「今日」页做日终确认，把没做的标记一下原因。',
        });
      }
    }

    // 每天 0 点后清掉旧记录
    for (const k of fired.keys()) {
      if (k !== date && fired.size > 3) fired.delete(k);
    }
    void wd;
  } catch (err) {
    console.error('[reminder] tick 出错：', err.message);
  }
}
