#!/usr/bin/env node
/**
 * 生成一份「看起来像真的在用」的演示数据，方便你空跑看看界面长什么样、
 * 也方便截图和做产品对比。
 *
 *   node scripts/seed-demo.mjs                # 默认写 .demo-data/，不动你的真实数据
 *   node scripts/seed-demo.mjs --days=21      # 只生成最近 21 天
 *
 * 生成完这样启动看效果：
 *   Windows:  $env:ANCHOR_DATA_DIR=".demo-data"; npm start
 *   macOS/Linux:  ANCHOR_DATA_DIR=.demo-data npm start
 *
 * 想删掉演示数据：直接删除 .demo-data 目录。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const DAYS = Math.max(3, Math.min(120, Number(getArg('days', 21))));

const DEMO_DIR = getArg('dir', path.join(ROOT, '.demo-data'));
process.env.ANCHOR_DATA_DIR = DEMO_DIR;

const store = await import('../server/src/store.js');
const { planDay } = await import('../server/src/planner.js');
const { emptyRecord, scoreDay, aggregateDays } = await import('../server/src/score.js');
const { MISS_CAUSES } = await import('../server/src/defaults.js');
const { todayStr, addDays, isoWeek, weekDates } = await import('../server/src/time.js');
const { buildWeeklyFacts, buildRuleReport } = await import('../server/src/report.js');

/* ------------------------------------------------------------------ */
/* 随机数（固定种子，保证每次生成的样子一致）                          */
/* ------------------------------------------------------------------ */

let seed = 20261025;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const jitter = (base, spread) => Math.max(0, Math.round(base + (rnd() * 2 - 1) * spread));

/* 让不同类别有不同「人味」的完成率 */
const PROFILE_BY_CATEGORY = {
  数学: { done: 0.86, partial: 0.08 },
  英语: { done: 0.78, partial: 0.1 },
  '408': { done: 0.72, partial: 0.12 },
  政治: { done: 0.6, partial: 0.15 },
  身体: { done: 0.74, partial: 0.12 },
  复盘: { done: 0.68, partial: 0.05 },
  其他: { done: 0.7, partial: 0.1 },
};

const CAUSE_WEIGHTS = [
  ['状态不好 / 犯困', 4],
  ['时间不够', 3],
  ['手机/娱乐分心', 3],
  ['任务太难卡住了', 1],
  ['临时有事被打断', 1],
  ['计划本身不合理', 1],
];

function pickCause() {
  const total = CAUSE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [cause, w] of CAUSE_WEIGHTS) {
    r -= w;
    if (r <= 0) return cause;
  }
  return MISS_CAUSES[0];
}

/* ------------------------------------------------------------------ */

async function buildDemo() {
  if (fs.existsSync(DEMO_DIR)) {
    console.log(`清空旧的演示数据：${DEMO_DIR}`);
    fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  }

  const db = store.load();
  db.settings.profile = {
    ...db.settings.profile,
    name: '小南',
    examName: '27 考研 11408',
    examGoal: '上岸',
    examDate: addDays(todayStr(), 420),
    motto: '把一天钉在计划上。',
  };
  db.settings.ai = { ...db.settings.ai, enabled: false };

  const today = todayStr();
  const start = addDays(today, -(DAYS - 1));

  /* 任务池 */
  const taskSeeds = [
    ['高数 第 3 讲 数列极限 听课 + 例题', '数学', 60, 'high'],
    ['高数 第 3 讲 课后习题 1-20 题', '数学', 50, 'high'],
    ['错题本：上周极限计算错题重做', '数学', 30, 'mid'],
    ['线代 第 1 讲 行列式', '数学', 55, 'mid'],
    ['英语 真题 2021 Text 1 精读', '英语', 45, 'mid'],
    ['英语 真题 2021 Text 2 精读', '英语', 45, 'low'],
    ['C 语言 指针与数组', '408', 45, 'high'],
    ['C 语言 结构体与链表', '408', 50, 'mid'],
    ['408 数据结构 线性表', '408', 50, 'low'],
    ['政治 马原 第 1 章', '政治', 40, 'low'],
  ];
  db.tasks = taskSeeds.map(([title, category, minutes, priority], i) => ({
    id: `demo-task-${i}`,
    title,
    category,
    subject: category,
    priority,
    minutes,
    dueDate: chance(0.5) ? addDays(today, Math.floor(rnd() * 12) - 3) : null,
    status: i < 3 ? 'done' : 'open',
    progress: i < 3 ? minutes : 0,
    notes: '',
    pinned: false,
    weight: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastScheduledAt: null,
    doneAt: i < 3 ? new Date().toISOString() : null,
  }));

  /* 日子 */
  for (let i = 0; i < DAYS; i += 1) {
    const date = addDays(start, i);
    const plan = planDay({ date, settings: db.settings, tasks: db.tasks });

    // 越靠近今天，状态越好一点（模拟「慢慢上道」）
    const momentum = 0.72 + (i / Math.max(1, DAYS - 1)) * 0.24;
    // 周末容易崩一点
    const wd = new Date(date).getDay();
    const weekendPenalty = wd === 0 || wd === 6 ? 0.12 : 0;

    const items = plan.items.map((item) => {
      const prof = PROFILE_BY_CATEGORY[item.category] || PROFILE_BY_CATEGORY.其他;
      const p = Math.max(0.15, Math.min(0.97, prof.done * momentum - weekendPenalty));
      const rec = emptyRecord();

      if (chance(p)) {
        rec.status = 'done';
        rec.value = item.countMode === 'boolean' ? 1 : item.target;
      } else if (chance(prof.partial)) {
        rec.status = 'partial';
        rec.value = Math.max(1, Math.round(item.target * (0.35 + rnd() * 0.4)));
        rec.cause = pickCause();
      } else {
        rec.status = 'missed';
        rec.cause = pickCause();
      }
      rec.updatedAt = new Date(`${date}T20:30:00`).toISOString();
      return { ...item, record: rec };
    });

    const day = {
      date,
      generatedAt: new Date(`${date}T08:10:00`).toISOString(),
      generator: 'local',
      items,
      warnings: plan.warnings,
      capacity: plan.capacity,
      blocks: plan.blocks,
      journal: {
        mood: 2 + Math.floor(rnd() * 4),
        energy: 2 + Math.floor(rnd() * 4),
        note: pick([
          '数学那两小时是今天最值钱的部分。',
          '下午一坐下就走神，明天试试先做最难的。',
          '英语背得比昨天顺，词汇量真的会滚雪球。',
          '锻炼完之后晚上效率明显高。',
          '今天状态一般，但没断。',
        ]),
        wins: '',
      },
      closed: i < DAYS - 1,
      closedAt: i < DAYS - 1 ? new Date(`${date}T23:05:00`).toISOString() : null,
      createdAt: new Date(`${date}T08:00:00`).toISOString(),
    };

    // 80% 的日子录了视频（只记索引，不塞真实文件）
    if (chance(0.78)) {
      const vid = `demo-video-${date}`;
      db.videos.push({
        id: vid,
        date,
        title: `${date.slice(5)} 学习总结`,
        originalName: `${date}.mp4`,
        relPath: path.join(date, `${vid}.mp4`),
        proxyPath: null,
        size: 0,
        mime: 'video/mp4',
        durationSec: 60 + Math.floor(rnd() * 120),
        video: { codec: 'h264', width: 1280, height: 720, fps: '30/1' },
        audio: { codec: 'aac', channels: 1, sampleRate: '44100' },
        thumb: null,
        createdAt: new Date(`${date}T22:20:00`).toISOString(),
        updatedAt: new Date().toISOString(),
        transcript: {
          status: 'done',
          text: pick([
            '今天上午数学听课两讲，下午做了三十道极限的题，错了五道，都记到错题本了。英语背了十个新词，复习了三十个。感觉下午状态不如上午，坐下以后刷了会儿手机。',
            '今天数学主要复习了昨天的错题，发现都是符号看错，属于不该错的。英语听力听了十五分钟外刊，语速还是跟不上。晚上锻炼完状态好很多。',
            '今天效率一般，上午有点困，数学只推进了一讲。C 语言的指针还是没完全搞明白，明天想再看一遍。',
          ]),
          segments: [],
          provider: 'local:sense-voice',
          at: new Date(`${date}T22:35:00`).toISOString(),
          error: null,
        },
        analysis: null,
        analysisError: null,
      });
    }

    db.days[date] = day;
  }

  /* 两份周报（规则引擎生成，不调用大模型） */
  store.saveNow();

  const allDates = Object.keys(db.days).sort();
  const weekKeys = [...new Set(allDates.map((d) => isoWeek(d).key))].slice(-2);

  for (const key of weekKeys) {
    const dates = weekDates(allDates.find((d) => isoWeek(d).key === key));
    const days = dates.map((d) => {
      const day = db.days[d];
      if (!day) return { date: d, items: [] };
      const score = scoreDay(day, db.settings);
      return { ...day, score, videos: db.videos.filter((v) => v.date === d) };
    });
    const facts = buildWeeklyFacts({
      key,
      dates,
      days,
      settings: db.settings,
      tasks: db.tasks,
      videos: db.videos,
    });
    facts.settings = db.settings;
    const ai = buildRuleReport(facts);
    db.weeks[key] = {
      key,
      startDate: dates[0],
      endDate: dates[6],
      generatedAt: new Date().toISOString(),
      stats: {
        avgScore: facts.agg.avgScore,
        dayCount: facts.agg.dayCount,
        plannedMinutes: facts.agg.plannedMinutes,
        achievedMinutes: facts.agg.achievedMinutes,
        completionRate: facts.agg.completionRate,
        itemCompletionRate: facts.agg.itemCompletionRate,
        doneItems: facts.agg.doneItems,
        missedItems: facts.agg.missedItems,
        videoDays: facts.agg.videoDays,
        byCategory: facts.agg.byCategory,
        byIndicator: facts.agg.byIndicator,
        byBlock: facts.agg.byBlock,
        causes: facts.agg.causes,
        rows: facts.rows,
      },
      ai,
      model: null,
      error: null,
      note: '演示数据：由内置规则引擎生成。',
      appliedAdjustments: [],
    };
  }

  store.saveNow();

  const allDays = Object.values(db.days);
  const agg = aggregateDays(allDays, db.settings);
  console.log(`\n演示数据生成完毕 → ${DEMO_DIR}`);
  console.log(`  ${Object.keys(db.days).length} 天 · ${db.tasks.length} 个任务 · ${db.videos.length} 个视频索引`);
  console.log(`  平均得分 ${agg.avgScore} · 时长完成率 ${agg.completionRate}% · 条目完成率 ${agg.itemCompletionRate}%`);
  console.log('\n看效果：');
  console.log(`  Windows:      $env:ANCHOR_DATA_DIR="${DEMO_DIR}"; npm start`);
  console.log(`  macOS/Linux:  ANCHOR_DATA_DIR="${DEMO_DIR}" npm start`);
  console.log('\n注意：演示数据里只有视频索引，没有真实视频文件，播放会提示找不到。\n');
}

buildDemo().catch((err) => {
  console.error('生成失败：', err);
  process.exit(1);
});
