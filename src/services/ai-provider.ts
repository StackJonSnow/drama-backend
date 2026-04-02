/**
 * AI提供商抽象层
 * 统一 Cloudflare Workers AI / OpenAI / Claude 接口
 */

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;  // 强制JSON输出
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

// ============================================
// Cloudflare Workers AI Provider
// ============================================
export class CloudflareAIProvider implements AIProvider {
  name = 'cloudflare-ai';
  private ai: any;

  constructor(ai: any) {
    this.ai = ai;
  }

  async chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    const model = options?.model || '@cf/meta/llama-3.1-8b-instruct';

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

// ============================================
// OpenAI Provider
// ============================================
export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    const model = options?.model || 'gpt-4o-mini';

    const body: any = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${err}`);
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

// ============================================
// Claude (Anthropic) Provider
// ============================================
export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(messages: AIMessage[], options?: AIRequestOptions): Promise<AIResponse> {
    const model = options?.model || 'claude-sonnet-4-20250514';

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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
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

// ============================================
// Factory: 根据配置创建Provider
// ============================================
export function createAIProvider(
  serviceName: string,
  env: { AI: any; DB: D1Database },
  apiKey?: string
): AIProvider {
  switch (serviceName) {
    case 'cloudflare-ai':
      return new CloudflareAIProvider(env.AI);
    case 'openai':
      if (!apiKey) throw new Error('OpenAI需要配置API密钥');
      return new OpenAIProvider(apiKey);
    case 'claude':
      if (!apiKey) throw new Error('Claude需要配置API密钥');
      return new ClaudeProvider(apiKey);
    default:
      throw new Error(`不支持的AI服务: ${serviceName}`);
  }
}

// 便捷函数: 从数据库获取用户的AI配置并创建Provider
export async function getUserAIProvider(
  userId: number,
  env: { AI: any; DB: D1Database }
): Promise<AIProvider> {
  const config = await env.DB.prepare(
    'SELECT service_name, api_key FROM ai_configs WHERE user_id = ? AND is_active = 1'
  ).bind(userId).first();

  if (!config) {
    // 默认使用 Cloudflare AI
    return new CloudflareAIProvider(env.AI);
  }

  let apiKey: string | undefined;
  if (config.api_key) {
    // 解密API密钥 (Base64)
    try {
      apiKey = atob(config.api_key as string);
    } catch {
      apiKey = config.api_key as string;
    }
  }

  return createAIProvider(config.service_name as string, env, apiKey);
}
