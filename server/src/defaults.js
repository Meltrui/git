/**
 * 默认设置。首次启动时写入 data/anchor.json，
 * 之后用户的所有改动都以数据文件为准，这里只是「出厂模板」。
 *
 * 默认模板按用户的实际作息定制：
 *   08:00 起床 → 09:30-11:30 上午学习 → 14:20-16:20 下午学习
 *   → 16:30-18:00 体育活动 → 19:30-21:30 晚间弹性 → 22:10 录制每日总结视频
 */

export const APP_NAME = 'Anchor';
export const APP_NAME_CN = '锚点';
export const DATA_VERSION = 1;

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0]; // 周一…周日

export function defaultSettings() {
  return {
    profile: {
      name: '',
      examName: '考研 11408',
      examGoal: '上岸',
      examDate: '2026-12-19',
      motto: '把一天钉在计划上。',
      wakeTime: '08:00',
      sleepTime: '23:30',
    },

    /* 固定时间块：规划器只往这些块里放假 */
    blocks: [
      {
        id: 'morning',
        label: '晨起 · 准备',
        start: '08:00',
        end: '08:40',
        kind: 'routine',
        days: ALL_DAYS,
        allowTasks: false,
        note: '洗漱、早饭、把今天的计划过一遍',
      },
      {
        id: 'study-am',
        label: '上午学习',
        start: '09:30',
        end: '11:30',
        kind: 'study',
        days: ALL_DAYS,
        allowTasks: true,
      },
      {
        id: 'study-pm',
        label: '下午学习',
        start: '14:20',
        end: '16:20',
        kind: 'study',
        days: ALL_DAYS,
        allowTasks: true,
      },
      {
        id: 'sport',
        label: '体育活动',
        start: '16:30',
        end: '18:00',
        kind: 'exercise',
        days: ALL_DAYS,
        allowTasks: false,
      },
      {
        id: 'evening',
        label: '晚间弹性',
        start: '19:30',
        end: '21:30',
        kind: 'flex',
        days: ALL_DAYS,
        allowTasks: true,
        note: '娱乐 / 阅读 / 继续学习，按当天状态定',
      },
      {
        id: 'review',
        label: '每日总结视频',
        start: '22:10',
        end: '22:40',
        kind: 'review',
        days: ALL_DAYS,
        allowTasks: false,
      },
    ],

    /* 每日核心指标：每天必做，带目标值与单位 */
    indicators: [
      {
        id: 'math-lecture',
        name: '数学听课 + 总结',
        category: '数学',
        kind: 'study',
        minutes: 60,
        target: 60,
        unit: '分钟',
        weight: 1.5,
        essential: true,
        countMode: 'value',
      },
      {
        id: 'math-practice',
        name: '数学习题练习',
        category: '数学',
        kind: 'study',
        minutes: 50,
        target: 50,
        unit: '分钟',
        weight: 1.5,
        essential: true,
        countMode: 'value',
      },
      {
        id: 'math-review',
        name: '错题回顾',
        category: '数学',
        kind: 'study',
        minutes: 25,
        target: 25,
        unit: '分钟',
        weight: 1.2,
        essential: false,
        countMode: 'value',
      },
      {
        id: 'en-words-new',
        name: '英语新词',
        category: '英语',
        kind: 'study',
        minutes: 8,
        target: 10,
        unit: '个',
        weight: 1,
        essential: true,
        countMode: 'value',
      },
      {
        id: 'en-words-review',
        name: '英语复习词',
        category: '英语',
        kind: 'study',
        minutes: 10,
        target: 30,
        unit: '个',
        weight: 0.8,
        essential: false,
        countMode: 'value',
      },
      {
        id: 'en-listening',
        name: '外刊听力',
        category: '英语',
        kind: 'study',
        minutes: 15,
        target: 15,
        unit: '分钟',
        weight: 0.8,
        essential: false,
        countMode: 'value',
      },
      {
        id: 'c-basics',
        name: 'C 语言基础',
        category: '408',
        kind: 'study',
        minutes: 40,
        target: 40,
        unit: '分钟',
        weight: 1,
        essential: false,
        countMode: 'value',
      },
      {
        id: 'sport',
        name: '体育锻炼',
        category: '身体',
        kind: 'exercise',
        minutes: 90,
        target: 90,
        unit: '分钟',
        weight: 1.2,
        essential: true,
        countMode: 'value',
      },
      {
        id: 'daily-video',
        name: '录制每日总结视频',
        category: '复盘',
        kind: 'review',
        minutes: 20,
        target: 1,
        unit: '个',
        weight: 1.2,
        essential: true,
        countMode: 'boolean',
      },
    ],

    /* 规划器参数 */
    planner: {
      studySlackMinutes: 0, // 每个学习块预留的空档
      minTaskSlice: 25, // 任务被拆分时最少保留的分钟数
      autoGenerateToday: true, // 打开今天页时自动生成计划
      fillEveningWithTasks: false, // 晚间弹性块是否也塞任务
      maxTasksPerDay: 4,
    },

    /* 评分与连击 */
    scoring: {
      streakMinScore: 70, // 当日得分 ≥ 该值算「没断」
      requireVideoForStreak: true, // 录了总结视频才算连击
      weekStartsOn: 1, // 周一
    },

    /* 提醒 */
    reminder: {
      enabled: true,
      blockStart: true, // 时间块开始时提醒
      blockEnd: false, // 时间块结束时提醒
      dailyWrapUp: '22:00', // 晚间收尾提醒
      desktopNotification: true,
    },

    /* AI */
    ai: {
      enabled: false,
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',
      temperature: 0.6,
      maxTokens: 3000,
      timeoutMs: 180000,
      // 是否允许把当日打卡数据/视频文字稿发送给模型（只在你自己的机器上调用）
      sendTranscripts: true,
    },

    /* 语音转写 */
    asr: {
      provider: 'local', // local | siliconflow | openai | none
      model: 'small',
      language: 'zh',
      apiKey: '',
      baseUrl: '',
      autoTranscribe: true, // 上传后自动转写（本地模型，不花钱）
    },

    /* 视频存储：手机录的总结视频动辄 1-2 GB，这里决定怎么瘦身 */
    media: {
      archive: 'compact', // compact(540p，默认) | high(720p) | audio(只留音频+文字稿) | original(保留原片)
      compactHeight: 540,
      compactCrf: 30,
      compactAudioKbps: 64,
      keepOriginal: 'off', // off(归档完成就删原片，默认) | days(保留 N 天) | always(一直留)
      keepOriginalDays: 7,
      skipTranscodeBelowMb: 120, // 原片本来就小、又能在浏览器里播，就不再压一遍
      keepAudio: true, // 单独留一条音频，回听很省流量
      inboxEnabled: true, // 收件箱自动导入：把手机传来的视频丢进 data/inbox 就行
      inboxScanSeconds: 20,
      inboxDateFrom: 'filetime', // filetime(按文件修改日期归档) | today(一律算今天)
    },

    /* 访问控制（局域网/手机访问时用） */
    access: {
      code: '', // 非空时，非本机访问需要输入口令
      allowLan: true,
    },

    /* 周报 */
    weekly: {
      autoGenerate: true,
      dayOfWeek: 0, // 周日生成
      targetStudyMinutes: 1500, // 每周学习时长目标（分钟）
    },
  };
}

/** 未完成原因的候选列表（用户可自由输入） */
export const MISS_CAUSES = [
  '时间不够',
  '状态不好 / 犯困',
  '临时有事被打断',
  '任务太难卡住了',
  '计划本身不合理',
  '手机/娱乐分心',
];
