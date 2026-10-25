/**
 * 大模型客户端。走 OpenAI 兼容的 /chat/completions 协议，
 * 所以 DeepSeek / OpenAI / 月之暗面 / 通义 / 硅基流动 / 本地 Ollama 全都能接。
 *
 * 设计要点
 *  - 任何 AI 调用失败都不能影响打卡、计划、统计这些核心功能
 *  - 统一要求 JSON 输出，并在服务端做一次容错修复
 *  - 提示词写在 prompts.js，方便以后迭代
 */

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsJsonMode: true,
    note: '国内直连，中文强，性价比高',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    supportsJsonMode: true,
    note: '需要能访问 openai.com 的网络',
  },
  moonshot: {
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    supportsJsonMode: false,
    note: '国内直连，长文本好',
  },
  siliconflow: {
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    supportsJsonMode: true,
    note: '国内直连，也提供语音转写',
  },
  dashscope: {
    label: '阿里通义',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max'],
    supportsJsonMode: true,
    note: '国内直连，也提供语音转写',
  },
  ollama: {
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:7b', 'llama3.1:8b'],
    supportsJsonMode: false,
    note: '完全离线，需要先装 Ollama',
  },
};

export function aiStatus(settings) {
  const ai = settings?.ai || {};
  return {
    enabled: !!ai.enabled,
    configured: !!(ai.apiKey && ai.baseUrl && ai.model),
    provider: ai.provider || 'deepseek',
    model: ai.model || '',
    providers: PROVIDERS,
  };
}

class AiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.body = body;
  }
}

/** 调用一次 chat/completions */
export async function chat(settings, messages, { json = false, temperature, maxTokens, signal } = {}) {
  const ai = settings?.ai || {};
  if (!ai.enabled) throw new AiError('大模型功能未启用（在设置里打开并填写 API Key）');
  if (!ai.apiKey) throw new AiError('没有填写 API Key');
  if (!ai.baseUrl) throw new AiError('没有填写接口地址');

  const provider = PROVIDERS[ai.provider] || {};
  const url = `${String(ai.baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: ai.model,
    messages,
    temperature: temperature ?? ai.temperature ?? 0.6,
    max_tokens: maxTokens ?? ai.maxTokens ?? 3000,
    stream: false,
  };
  if (json && provider.supportsJsonMode !== false) {
    body.response_format = { type: 'json_object' };
  }

  const timeoutMs = ai.timeoutMs || 180000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('请求超时')), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      let msg = `接口返回 ${res.status}`;
      try {
        const parsed = JSON.parse(text);
        msg += `：${parsed?.error?.message || parsed?.message || text.slice(0, 300)}`;
      } catch {
        msg += `：${text.slice(0, 300)}`;
      }
      throw new AiError(msg, { status: res.status, body: text.slice(0, 2000) });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AiError(`返回内容不是合法 JSON：${text.slice(0, 200)}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new AiError('模型没有返回内容');
    return { content, usage: data.usage || null, model: data.model || ai.model };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err?.name === 'AbortError') throw new AiError('请求超时，换个模型或者稍后再试');
    throw new AiError(`请求失败：${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 去掉 ```json ``` 包裹，尽力解析出对象 */
export function parseJsonLoose(content) {
  if (!content) return null;
  let s = String(content).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* 继续尝试 */
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = s.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      /* 继续尝试 */
    }
    // 常见毛病：尾逗号
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

/** 要求模型返回 JSON 对象 */
export async function chatJson(settings, messages, opts = {}) {
  const { content, usage, model } = await chat(settings, messages, { ...opts, json: true });
  const parsed = parseJsonLoose(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new AiError(`模型返回的不是可解析的 JSON：${String(content).slice(0, 300)}`);
  }
  return { data: parsed, raw: content, usage, model };
}

/** 简单连通性测试 */
export async function testConnection(settings) {
  const res = await chat(
    { ...settings, ai: { ...settings.ai, maxTokens: 64 } },
    [
      { role: 'system', content: '你是一个测试助手，只回一句话。' },
      { role: 'user', content: '回复「连接正常」四个字。' },
    ],
    { maxTokens: 32, temperature: 0 },
  );
  return { ok: true, sample: res.content.slice(0, 120), model: res.model };
}

export { AiError };
