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
  chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse>;
}

export class CloudflareAIProvider implements AIProvider {
  name = 'cloudflare-ai';
  private ai: any;
  private model: string;

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
  private apiKey: string;
  private baseUrl: string;
  private model: string;

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

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${err}`);
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
}

export class ClaudeProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

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

export async function getUserAIProvider(
  userId: number,
  env: { AI: any; DB: D1Database },
  serviceName?: string,
): Promise<AIProvider> {
  const config = serviceName
    ? await env.DB.prepare(
      'SELECT service_name, api_key, base_url, model FROM ai_configs WHERE user_id = ? AND service_name = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1'
    ).bind(userId, serviceName).first()
    : await env.DB.prepare(
      'SELECT service_name, api_key, base_url, model FROM ai_configs WHERE user_id = ? AND is_active = 1'
    ).bind(userId).first();

  if (!config) {
    if (serviceName === 'cloudflare-ai') {
      return new CloudflareAIProvider(env.AI);
    }

    return new CloudflareAIProvider(env.AI);
  }

  let apiKey: string | undefined;
  if (config.api_key) {
    try {
      apiKey = atob(config.api_key as string);
    } catch {
      apiKey = config.api_key as string;
    }
  }

  return createAIProvider(config.service_name as string, env, {
    apiKey,
    baseUrl: config.base_url as string | undefined,
    model: config.model as string | undefined,
  });
}
