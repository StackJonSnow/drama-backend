import { describe, expect, it } from 'vitest';
import { getAIServiceCatalog, getAIServiceDefinition, normalizeBaseUrl } from './ai-catalog';

describe('ai catalog', () => {
  it('contains mainstream domestic providers and defaults', () => {
    const catalog = getAIServiceCatalog();
    const ids = catalog.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining([
      'cloudflare-ai',
      'deepseek',
      'qwen',
      'zhipu',
      'kimi',
      'doubao',
      'siliconflow',
      'openai',
      'claude',
    ]));

    expect(getAIServiceDefinition('deepseek')?.defaultBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(getAIServiceDefinition('qwen')?.defaultModel).toBe('qwen-plus');
    expect(getAIServiceDefinition('cloudflare-ai')?.requiresApiKey).toBe(false);
  });

  it('normalizes trailing slashes in base urls', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1///')).toBe('https://api.deepseek.com/v1');
  });
});
