import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateAIConnection } from './ai-validation';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('ai validation', () => {
  it('passes cloudflare validation when AI returns a response', async () => {
    const env = {
      AI: {
        run: vi.fn().mockResolvedValue({ response: 'OK' }),
      },
    };

    const result = await validateAIConnection(env, { serviceName: 'cloudflare-ai' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('检测通过');
  });

  it('rejects openai-compatible validation when api key is missing', async () => {
    const result = await validateAIConnection({ AI: {} }, {
      serviceName: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('API Key');
  });

  it('passes openai-compatible validation on successful completion response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateAIConnection({ AI: {} }, {
      serviceName: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
    });

    expect(result.success).toBe(true);
    expect(result.resolvedBaseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('returns provider error messages for failed openai-compatible validation', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateAIConnection({ AI: {} }, {
      serviceName: 'qwen',
      apiKey: 'bad-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('invalid api key');
  });

  it('passes anthropic validation on successful message response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ text: 'OK' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateAIConnection({ AI: {} }, {
      serviceName: 'claude',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-20250514',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Claude');
  });
});
