import { describe, expect, it } from 'vitest';
import { AIServiceAccessError, ensureServiceReadyForGeneration } from './ai-access';

function createDb(validationStatus?: string | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => {
          if (validationStatus === undefined) {
            return null;
          }

          return {
            service_name: 'deepseek',
            validation_status: validationStatus,
          };
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('ai access', () => {
  it('allows cloudflare without stored config', async () => {
    await expect(ensureServiceReadyForGeneration(createDb(), 1, 'cloudflare-ai')).resolves.toBeUndefined();
  });

  it('rejects missing provider configuration', async () => {
    await expect(ensureServiceReadyForGeneration(createDb(), 1, 'deepseek')).rejects.toBeInstanceOf(AIServiceAccessError);
    await expect(ensureServiceReadyForGeneration(createDb(), 1, 'deepseek')).rejects.toThrow('所选渠道尚未保存配置');
  });

  it('rejects providers that have not passed validation', async () => {
    await expect(ensureServiceReadyForGeneration(createDb('failed'), 1, 'deepseek')).rejects.toThrow('所选渠道尚未通过检测');
  });

  it('allows providers with passed validation', async () => {
    await expect(ensureServiceReadyForGeneration(createDb('passed'), 1, 'deepseek')).resolves.toBeUndefined();
  });
});
