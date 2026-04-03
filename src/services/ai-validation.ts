import { getAIServiceDefinition, normalizeBaseUrl } from './ai-catalog';

type ValidationEnv = {
  AI: any;
};

export interface AIValidationInput {
  serviceName: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface AIValidationResult {
  success: boolean;
  message: string;
  resolvedBaseUrl?: string;
  resolvedModel?: string;
}

function buildUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json() as Record<string, unknown>;
    const error = data.error;

    if (typeof error === 'string') return error;

    if (error && typeof error === 'object') {
      const errorMessage = (error as { message?: unknown }).message;
      if (typeof errorMessage === 'string') return errorMessage;
    }

    const message = data.message;
    if (typeof message === 'string') return message;
  } catch {
    const text = await response.text().catch(() => '');
    if (text) return text;
  }

  return `HTTP ${response.status}`;
}

function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function validateAIConnection(
  env: ValidationEnv,
  input: AIValidationInput,
): Promise<AIValidationResult> {
  const definition = getAIServiceDefinition(input.serviceName);

  if (!definition) {
    return { success: false, message: '不支持的 AI 渠道' };
  }

  const resolvedBaseUrl = definition.defaultBaseUrl
    ? normalizeBaseUrl(input.baseUrl || definition.defaultBaseUrl)
    : undefined;
  const resolvedModel = (input.model || definition.defaultModel || '').trim() || undefined;

  try {
    if (definition.protocol === 'cloudflare') {
      const model = resolvedModel || '@cf/meta/llama-3.1-8b-instruct';
      const result = await env.AI.run(model, {
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 8,
        temperature: 0,
      });

      if (!result?.response || typeof result.response !== 'string') {
        return { success: false, message: 'Cloudflare AI 未返回有效结果' };
      }

      return {
        success: true,
        message: 'Cloudflare AI 检测通过',
        resolvedModel: model,
      };
    }

    const apiKey = input.apiKey?.trim();

    requireConfig(apiKey, '请填写 API Key');
    requireConfig(resolvedBaseUrl, '请填写 Base URL');
    requireConfig(resolvedModel, '请填写模型名称');

    if (definition.protocol === 'anthropic') {
      const response = await fetch(buildUrl(resolvedBaseUrl, '/messages'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: 8,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Claude 检测失败：${await readErrorMessage(response)}`,
          resolvedBaseUrl,
          resolvedModel,
        };
      }

      const data = await response.json() as { content?: Array<{ text?: string }> };
      const content = data.content?.[0]?.text?.trim();

      if (!content) {
        return {
          success: false,
          message: 'Claude 渠道未返回有效响应内容',
          resolvedBaseUrl,
          resolvedModel,
        };
      }

      return {
        success: true,
        message: 'Claude 渠道检测通过',
        resolvedBaseUrl,
        resolvedModel,
      };
    }

    const response = await fetch(buildUrl(resolvedBaseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 8,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        message: `${definition.name} 检测失败：${await readErrorMessage(response)}`,
        resolvedBaseUrl,
        resolvedModel,
      };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return {
        success: false,
        message: `${definition.name} 未返回有效响应内容`,
        resolvedBaseUrl,
        resolvedModel,
      };
    }

    return {
      success: true,
      message: `${definition.name} 检测通过`,
      resolvedBaseUrl,
      resolvedModel,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '渠道检测失败',
      resolvedBaseUrl,
      resolvedModel,
    };
  }
}
