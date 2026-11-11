import 'dotenv/config';

export interface ModelCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  temperature: number;
}

export interface ModelResponse {
  content: string;
  provider: string;
  model: string;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  status: number;
}

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  models: string[];
  call: (config: ProviderConfig, opts: ModelCall) => Promise<ModelResponse>;
}

async function callOpenAI(config: ProviderConfig, opts: ModelCall): Promise<ModelResponse> {
  const start = Date.now();
  const r = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature
    })
  });
  const data = await r.json() as any;
  if (!r.ok) {
    throw new Error(`OpenAI ${r.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content || '';
  return {
    content,
    provider: config.name,
    model: opts.model,
    latency_ms: Date.now() - start,
    input_tokens: data.usage?.prompt_tokens,
    output_tokens: data.usage?.completion_tokens,
    status: r.status
  };
}

async function callAnthropic(config: ProviderConfig, opts: ModelCall): Promise<ModelResponse> {
  const start = Date.now();
  // Anthropic requires system messages as a top-level parameter
  const systemMsgs = opts.messages.filter(m => m.role === 'system');
  const nonSystemMsgs = opts.messages.filter(m => m.role !== 'system');
  const body: any = {
    model: opts.model,
    max_tokens: opts.max_tokens,
    messages: nonSystemMsgs
  };
  if (systemMsgs.length > 0) {
    body.system = systemMsgs.map(m => m.content).join('\n\n');
  }
  const r = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey!,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await r.json() as any;
  if (!r.ok) {
    throw new Error(`Anthropic ${r.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    content: data.content?.[0]?.text || '',
    provider: config.name,
    model: opts.model,
    latency_ms: Date.now() - start,
    input_tokens: data.usage?.input_tokens,
    output_tokens: data.usage?.output_tokens,
    status: r.status
  };
}

async function callGemini(config: ProviderConfig, opts: ModelCall): Promise<ModelResponse> {
  const start = Date.now();
  const r = await fetch(
    `${config.baseUrl}/models/${opts.model}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: opts.messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        generationConfig: {
          maxOutputTokens: opts.max_tokens,
          temperature: opts.temperature
        }
      })
    }
  );
  const data = await r.json() as any;
  if (!r.ok || data.error) {
    throw new Error(`Gemini ${r.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    provider: config.name,
    model: opts.model,
    latency_ms: Date.now() - start,
    input_tokens: data.usageMetadata?.promptTokenCount,
    output_tokens: data.usageMetadata?.candidatesTokenCount,
    status: r.status
  };
}

async function callOpenRouter(config: ProviderConfig, opts: ModelCall): Promise<ModelResponse> {
  const start = Date.now();
  const r = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3900',
      'X-Title': 'ESCMC Benchmark'
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature
    })
  });
  const data = await r.json() as any;
  if (!r.ok) {
    throw new Error(`OpenRouter ${r.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    content: data.choices?.[0]?.message?.content || '',
    provider: 'OpenRouter',
    model: opts.model,
    latency_ms: Date.now() - start,
    input_tokens: data.usage?.prompt_tokens,
    output_tokens: data.usage?.completion_tokens,
    status: r.status
  };
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    models: ['gpt-4o', 'gpt-4o-mini'],
    call: callOpenAI
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
    models: ['claude-opus-4-5-20251101', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    call: callAnthropic
  },
  google: {
    name: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: process.env.GEMINI_API_KEY,
    models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
    call: callGemini
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    models: ['meta-llama/llama-3.1-70b-instruct', 'mistralai/mistral-large-latest'],
    call: callOpenRouter
  }
};

export function getAvailableProviders() {
  return Object.entries(PROVIDERS).filter(([_, p]) => p.apiKey);
}

export function getAllModels(): Array<{ provider: string; model: string }> {
  const result: Array<{ provider: string; model: string }> = [];
  for (const [_, prov] of getAvailableProviders()) {
    for (const model of prov.models) {
      result.push({ provider: prov.name, model });
    }
  }
  return result;
}

export async function callAnyModel(model: string, opts: Omit<ModelCall, 'model'>): Promise<ModelResponse> {
  for (const [_, prov] of Object.entries(PROVIDERS)) {
    if (!prov.apiKey) continue;
    if (prov.models.includes(model)) {
      return prov.call(prov, { ...opts, model });
    }
  }
  // Fallback: try OpenRouter with the model ID as-is
  const or = PROVIDERS.openrouter;
  if (or.apiKey) {
    return or.call(or, { ...opts, model });
  }
  throw new Error(`No provider available for model: ${model}`);
}
