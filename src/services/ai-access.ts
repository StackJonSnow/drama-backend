export class AIServiceAccessError extends Error {}

export async function ensureServiceReadyForGeneration(
  db: D1Database,
  userId: number,
  serviceName: string,
): Promise<void> {
  if (serviceName === 'cloudflare-ai') {
    return;
  }

  const config = await db.prepare(
    'SELECT service_name, validation_status FROM ai_configs WHERE user_id = ? AND service_name = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1'
  ).bind(userId, serviceName).first();

  if (!config) {
    throw new AIServiceAccessError('所选渠道尚未保存配置，请先到设置页完成配置');
  }

  if (config.validation_status !== 'passed') {
    throw new AIServiceAccessError('所选渠道尚未通过检测，请在设置页面检测通过后再生成');
  }
}
