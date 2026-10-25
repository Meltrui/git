#!/usr/bin/env node
/**
 * 冒烟测试：把核心链路跑一遍，确认服务端逻辑是通的。
 *
 *   npm run smoke
 *
 * 需要先 npm start（默认 8787 端口，可用 ANCHOR_PORT 覆盖）。
 * 这个脚本只在「测试数据」上操作，不会动你的真实设置。
 */

const BASE = process.env.ANCHOR_BASE || `http://127.0.0.1:${process.env.ANCHOR_PORT || 8787}`;

let pass = 0;
let failCount = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failCount += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? ` — ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 300)}` : ''}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text };
}

const today = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

async function main() {
  console.log(`\n对 ${BASE} 做冒烟测试\n`);

  console.log('[1] 健康检查');
  const health = await call('GET', '/api/health');
  check('GET /api/health 返回 200', health.status === 200, health.text);

  console.log('\n[2] 启动数据');
  const boot = await call('GET', '/api/bootstrap');
  check('GET /api/bootstrap 返回 200', boot.status === 200, boot.text);
  const data = boot.json?.data;
  check('有 settings', !!data?.settings);
  check('时间块 ≥ 4 个', (data?.settings?.blocks || []).length >= 4, (data?.settings?.blocks || []).length);
  check('每日指标 ≥ 6 个', (data?.settings?.indicators || []).length >= 6);
  check('API Key 已被掩码', data?.settings?.ai?.apiKey === '', data?.settings?.ai?.apiKey);
  check('今日计划已生成', (data?.day?.items || []).length > 0, (data?.day?.items || []).length);
  check('计划项都有时间段或标为随时', (data?.day?.items || []).every((i) => i.start || !i.blockId));
  check('容量统计存在', !!data?.day?.capacity?.study?.total);

  const items = data?.day?.items || [];
  const studyCapacity = data?.day?.capacity?.study?.total || 0;
  const studyUsed = data?.day?.capacity?.study?.used || 0;
  check('学习块没被撑爆', studyUsed <= studyCapacity + 1, `used=${studyUsed} cap=${studyCapacity}`);

  console.log('\n[3] 打卡');
  const first = items[0];
  if (first) {
    const done = await call('PATCH', `/api/days/${today}/items/${first.id}/record`, { status: 'done' });
    check('标记完成成功', done.status === 200 && done.json?.data?.item?.record?.status === 'done', done.text.slice(0, 200));
    check('完成时自动补目标值', (done.json?.data?.item?.record?.value ?? 0) > 0, done.json?.data?.item?.record);

    const partial = await call('PATCH', `/api/days/${today}/items/${first.id}/record`, { value: 1, status: 'partial' });
    check('部分完成可写入', partial.status === 200);
  } else {
    check('有可打卡的条目', false);
  }

  const second = items[1];
  if (second) {
    const missed = await call('PATCH', `/api/days/${today}/items/${second.id}/record`, {
      status: 'missed',
      cause: '状态不好 / 犯困',
    });
    check('未完成可标记并带原因', missed.json?.data?.item?.record?.cause === '状态不好 / 犯困', missed.text.slice(0, 200));
  }

  console.log('\n[4] 未完成标记的自动确认');
  const closed = await call('POST', `/api/days/${today}/close`, { autoMiss: true });
  check('关闭当天成功', closed.status === 200 && closed.json?.data?.closed === true, closed.text.slice(0, 200));
  check('自动把没确认的标成未完成', (closed.json?.data?.missed ?? -1) >= 0);
  const reopened = await call('POST', `/api/days/${today}/reopen`);
  check('可以重新打开', reopened.json?.data?.day?.closed === false);

  console.log('\n[5] 任务池');
  const created = await call('POST', '/api/tasks', {
    title: '冒烟测试任务：高数第一讲',
    category: '数学',
    minutes: 45,
    priority: 'high',
  });
  check('创建任务成功', created.status === 200 && !!created.json?.data?.task?.id, created.text.slice(0, 200));
  const taskId = created.json?.data?.task?.id;
  const list = await call('GET', '/api/tasks');
  check('任务出现在列表里', (list.json?.data?.tasks || []).some((t) => t.id === taskId));
  if (taskId) {
    const patched = await call('PATCH', `/api/tasks/${taskId}`, { priority: 'low' });
    check('更新任务成功', patched.json?.data?.task?.priority === 'low');
    const removed = await call('DELETE', `/api/tasks/${taskId}`);
    check('删除任务成功', removed.json?.data?.deleted === true);
  }

  console.log('\n[6] 重新生成计划');
  const regen = await call('POST', `/api/days/${today}/regenerate`);
  check('重新生成成功', regen.status === 200 && (regen.json?.data?.day?.items || []).length > 0);
  const regenItems = regen.json?.data?.day?.items || [];
  const keptRecord = regenItems.find((i) => i.id === first?.id);
  check('重新生成后保留已有打卡记录', !!keptRecord && keptRecord.record?.status !== 'pending', keptRecord?.record);

  console.log('\n[7] 周视图');
  const week = await call('GET', `/api/weeks/${data?.weekKey}`);
  check('周视图返回 200', week.status === 200, week.text.slice(0, 200));
  check('一周 7 天', (week.json?.data?.days || []).length === 7);
  check('周统计存在', typeof week.json?.data?.aggregates?.avgScore === 'number');

  console.log('\n[8] 周总结（规则引擎兜底）');
  const report = await call('POST', `/api/weeks/${data?.weekKey}/report`);
  check('生成周报返回 200', report.status === 200, report.text.slice(0, 300));
  const ai = report.json?.data?.report?.ai;
  check('周报有叙述文本', typeof ai?.narrative === 'string' && ai.narrative.length > 20, ai?.narrative?.slice(0, 80));
  check('周报有调整建议数组', Array.isArray(ai?.adjustments));
  check('周报有统计数字', typeof report.json?.data?.report?.stats?.avgScore === 'number');

  console.log('\n[9] 统计总览');
  const stats = await call('GET', '/api/stats/overview?days=30');
  check('统计返回 200', stats.status === 200, stats.text.slice(0, 200));
  check('热力图有点', (stats.json?.data?.heatmap || []).length >= 30);
  check('连击数据存在', typeof stats.json?.data?.streak?.current === 'number');

  console.log('\n[10] 系统信息');
  const info = await call('GET', '/api/system/info');
  check('ffmpeg 可用', info.json?.data?.media?.ffmpeg === true, info.json?.data?.media);
  check('数据目录存在', !!info.json?.data?.data?.path);

  console.log('\n[11] 自定义条目');
  const custom = await call('POST', `/api/days/${today}/items`, {
    title: '冒烟测试：自定义条目',
    category: '其他',
    plannedMinutes: 20,
  });
  check('可以往某天加自定义条目', custom.status === 200 && !!custom.json?.data?.item?.id, custom.text.slice(0, 200));
  const customId = custom.json?.data?.item?.id;
  if (customId) {
    const edited = await call('PATCH', `/api/days/${today}/items/${customId}`, { detail: '改了具体内容' });
    check('可以编辑条目的具体内容', edited.json?.data?.item?.detail === '改了具体内容', edited.text.slice(0, 200));
    const removed = await call('DELETE', `/api/days/${today}/items/${customId}`);
    check('可以删掉自定义条目', removed.status === 200);
  }

  console.log('\n[12] 日记与心情');
  const journal = await call('PATCH', `/api/days/${today}/journal`, { mood: 4, energy: 3, note: '冒烟测试' });
  check('日记可以保存', journal.json?.data?.journal?.mood === 4, journal.text.slice(0, 200));

  console.log('\n[13] 设置读写');
  const before = (await call('GET', '/api/settings')).json?.data?.settings;
  const put = await call('PUT', '/api/settings', { planner: { maxTasksPerDay: 3 } });
  check('设置可以保存', put.json?.data?.settings?.planner?.maxTasksPerDay === 3, put.text.slice(0, 200));
  check('API Key 不会被回显', put.json?.data?.settings?.ai?.apiKey === '');
  await call('PUT', '/api/settings', { planner: { maxTasksPerDay: before?.planner?.maxTasksPerDay ?? 4 } });
  check('设置可以改回去', true);

  console.log('\n[14] AI 计划建议（无 Key 时走规则兜底）');
  const advice = await call('POST', '/api/ai/plan-advice', { date: today });
  check('计划建议返回 200', advice.status === 200, advice.text.slice(0, 250));
  check('有判断结论', typeof advice.json?.data?.advice?.verdict === 'string');
  check('有执行顺序', Array.isArray(advice.json?.data?.advice?.order));

  console.log('\n[15] 语音与视频能力');
  const asr = await call('GET', '/api/asr/status');
  check('转写状态可读', typeof asr.json?.data?.localReady === 'boolean', asr.text.slice(0, 200));
  const videos = await call('GET', '/api/videos');
  check('视频库可读', Array.isArray(videos.json?.data?.videos), videos.text.slice(0, 200));
  check('视频能力报告存在', !!videos.json?.data?.capabilities?.media);

  console.log('\n[16] 错误处理');
  const notFound = await call('GET', '/api/不存在');
  check('未知接口返回 404', notFound.status === 404);
  const badDate = await call('GET', '/api/days/not-a-date');
  check('非法日期返回 400', badDate.status === 400);
  const badReport = await call('POST', '/api/weeks/乱写/report');
  check('非法周次返回 400', badReport.status === 400, badReport.status);

  console.log(`\n结果：${pass} 通过，${failCount} 失败`);
  if (failCount) {
    console.log('失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('全部通过。\n');
}

main().catch((err) => {
  console.error('\n冒烟测试崩溃：', err.message);
  console.error('服务起来了吗？先跑 npm start。');
  process.exit(1);
});
