import { getAIServiceDefinition, normalizeBaseUrl } from './ai-catalog';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void | Promise<void>;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  name: string;
  model?: string;
  chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse>;
}

export interface UserAIConfigSnapshot {
  serviceName: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

type DBUserAIConfigRecord = {
  service_name: string;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
};

export class CloudflareAIProvider implements AIProvider {
  name = 'cloudflare-ai';
  model: string;
  private ai: any;

  constructor(ai: any, model = '@cf/meta/llama-3.1-8b-instruct') {
    this.ai = ai;
    this.model = model;
  }

  async chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    const model = options?.model || this.model;

    const cfMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const response = await this.ai.run(model, {
      messages: cfMessages,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
    });

    return {
      content: response.response,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens || 0,
        completionTokens: response.usage.completion_tokens || 0,
        totalTokens: response.usage.total_tokens || 0,
      } : undefined,
    };
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  name: string;
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(serviceName: string, apiKey: string, baseUrl: string, model: string) {
    this.name = serviceName;
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.model = model;
  }

  async chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    const model = options?.model || this.model;

    const body: any = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.onChunk) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      signal: options?.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${err}`);
    }

    if (options?.onChunk && response.body) {
      return this.readStreamingResponse(response, options.onChunk);
    }

    const data: any = await response.json();

    return {
      content: data.choices[0].message.content,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  private async readStreamingResponse(response: Response, onChunk: (chunk: string) => void | Promise<void>): Promise<AIResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`${this.name} API error: response body is not readable`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage: AIResponse['usage'];

    const processLine = async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return;

      const data = JSON.parse(payload);
      const delta = data.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta;
        await onChunk(delta);
      }

      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
        };
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        await processLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        await processLine(line);
      }
    }

    return { content, usage };
  }
}

export class ClaudeProvider implements AIProvider {
  name: string;
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string, model: string, serviceName = 'claude') {
    this.name = serviceName;
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.model = model;
  }

  async chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    const model = options?.model || this.model;

    // Claude uses separate system message
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const body: any = {
      model,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      messages: chatMessages,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: options?.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${err}`);
    }

    const data: any = await response.json();

    return {
      content: data.content[0].text,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      } : undefined,
    };
  }
}

export function createAIProvider(
  serviceName: string,
  env: { AI: any; DB: D1Database },
  config?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }
): AIProvider {
  const definition = getAIServiceDefinition(serviceName);

  if (!definition) {
    throw new Error(`不支持的AI服务: ${serviceName}`);
  }

  if (definition.protocol === 'cloudflare') {
    return new CloudflareAIProvider(env.AI, config?.model || definition.defaultModel);
  }

  if (!config?.apiKey) {
    throw new Error(`${definition.name}需要配置API密钥`);
  }

  const resolvedBaseUrl = config.baseUrl || definition.defaultBaseUrl;
  const resolvedModel = config.model || definition.defaultModel;

  if (!resolvedBaseUrl) {
    throw new Error(`${definition.name}需要配置Base URL`);
  }

  if (!resolvedModel) {
    throw new Error(`${definition.name}需要配置模型名称`);
  }

  if (definition.protocol === 'anthropic') {
    return new ClaudeProvider(config.apiKey, resolvedBaseUrl, resolvedModel, serviceName);
  }

  return new OpenAICompatibleProvider(serviceName, config.apiKey, resolvedBaseUrl, resolvedModel);
}

export async function getUserAIConfigSnapshot(
  userId: number,
  env: { AI: any; DB: D1Database },
  serviceName = 'cloudflare-ai',
): Promise<UserAIConfigSnapshot> {
  const config = await env.DB.prepare(
    'SELECT service_name, api_key, base_url, model FROM ai_configs WHERE user_id = ? AND service_name = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1'
  ).bind(userId, serviceName).first() as DBUserAIConfigRecord | null;

  const definition = getAIServiceDefinition(serviceName);

  let apiKey: string | undefined;
  if (config?.api_key) {
    try {
      apiKey = atob(config.api_key as string);
    } catch {
      apiKey = config.api_key as string;
    }
  }

  return {
    serviceName,
    apiKey,
    baseUrl: (config?.base_url as string | undefined) || definition?.defaultBaseUrl,
    model: (config?.model as string | undefined) || definition?.defaultModel,
  };
}

export async function getUserAIProvider(
  userId: number,
  env: { AI: any; DB: D1Database },
  serviceName?: string,
  overrides?: {
    model?: string;
  },
): Promise<AIProvider> {
  const config = (serviceName
    ? await getUserAIConfigSnapshot(userId, env, serviceName)
    : await env.DB.prepare(
      'SELECT service_name, api_key, base_url, model FROM ai_configs WHERE user_id = ? AND is_active = 1'
    ).bind(userId).first() as DBUserAIConfigRecord | null) as UserAIConfigSnapshot | DBUserAIConfigRecord | null;

  if (!config) {
    if (serviceName === 'cloudflare-ai') {
      return new CloudflareAIProvider(env.AI, overrides?.model);
    }

    return new CloudflareAIProvider(env.AI, overrides?.model);
  }

  let apiKey: string | undefined;
  if ('api_key' in config && typeof config.api_key === 'string' && config.api_key) {
    try {
      apiKey = atob(config.api_key as string);
    } catch {
      apiKey = config.api_key as string;
    }
  } else if ('apiKey' in config && typeof config.apiKey === 'string') {
    apiKey = config.apiKey;
  }

  const resolvedServiceName = 'service_name' in config ? config.service_name : config.serviceName;
  const resolvedBaseUrl: string | undefined = 'base_url' in config
    ? (typeof config.base_url === 'string' ? config.base_url : undefined)
    : ((config as UserAIConfigSnapshot).baseUrl || undefined);
  const resolvedModel: string | undefined = overrides?.model || (
    'model' in config
      ? (typeof config.model === 'string' ? config.model : undefined)
      : ((config as UserAIConfigSnapshot).model || undefined)
  );

  return createAIProvider(resolvedServiceName, env, {
    apiKey,
    baseUrl: resolvedBaseUrl,
    model: resolvedModel,
  });
}
