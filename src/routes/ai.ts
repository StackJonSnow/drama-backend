import { Hono } from 'hono';
import { verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import { getAIServiceCatalog, getAIServiceDefinition } from '../services/ai-catalog';
import { validateAIConnection } from '../services/ai-validation';
import { getUserAIProvider } from '../services/ai-provider';
import { ensureServiceReadyForGeneration } from '../services/ai-access';

type Bindings = {
  DB: D1Database;
  AI: any;
  JWT_SECRET: string;
};

type Variables = {
  user: any;
  jwtPayload: {
    userId: number;
    email: string;
    exp: number;
  };
};

export const aiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type AIConfigRecord = {
  id: number;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
  validation_status?: 'pending' | 'passed' | 'failed' | null;
  last_checked_at?: string | null;
  last_check_message?: string | null;
};

// 动态JWT认证中间件
async function jwtAuth(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: '未提供认证令牌' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('jwtPayload', payload as any);
    await next();
  } catch {
    return c.json({ success: false, error: '认证令牌无效或已过期' }, 401);
  }
}

// 获取支持的AI服务列表
aiRoutes.get('/services', async (c) => {
  return c.json({
    success: true,
    data: { services: getAIServiceCatalog() }
  });
});

// 获取用户的AI配置
aiRoutes.get('/config', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    
    const configs = await c.env.DB.prepare(
      `SELECT id, service_name, base_url, model, is_active, validation_status, last_checked_at, last_check_message, created_at
       FROM ai_configs
       WHERE user_id = ?
       ORDER BY is_active DESC, created_at DESC`
    ).bind(payload.userId).all();
    
    return c.json({
      success: true,
      data: { configs: configs.results }
    });
    
  } catch (error) {
    console.error('获取AI配置错误:', error);
    return c.json({ success: false, error: '服务器内部错误' }, 500);
  }
});

// 更新用户的AI配置
aiRoutes.put('/config', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { serviceName, apiKey, baseUrl, model } = await c.req.json();
    
    if (!serviceName) {
      return c.json({ success: false, error: '服务名称是必填项' }, 400);
    }

    const definition = getAIServiceDefinition(serviceName);

    if (!definition) {
      return c.json({ success: false, error: '不支持的 AI 渠道' }, 400);
    }

    const now = new Date().toISOString();
    
    const existingConfig = await c.env.DB.prepare(
      `SELECT id, api_key, base_url, model, validation_status, last_checked_at, last_check_message
       FROM ai_configs
       WHERE user_id = ? AND service_name = ?`
    ).bind(payload.userId, serviceName).first<AIConfigRecord>();

    const existingApiKey = decryptApiKey(existingConfig?.api_key);
    const submittedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const resolvedApiKey = submittedApiKey || existingApiKey;
    const resolvedBaseUrl = typeof baseUrl === 'string'
      ? baseUrl.trim() || null
      : (existingConfig?.base_url ?? null);
    const resolvedModel = typeof model === 'string'
      ? model.trim() || null
      : (existingConfig?.model ?? null);

    if (definition.requiresApiKey && !resolvedApiKey) {
      return c.json({ success: false, error: 'API Key 是必填项' }, 400);
    }

    if (definition.requiresBaseUrl && !resolvedBaseUrl) {
      return c.json({ success: false, error: 'Base URL 是必填项' }, 400);
    }

    if (definition.requiresModel && !resolvedModel) {
      return c.json({ success: false, error: '模型名称是必填项' }, 400);
    }

    const hasNewApiKey = submittedApiKey.length > 0;
    const configChanged = existingConfig
      ? (
        (hasNewApiKey && submittedApiKey !== existingApiKey)
        || resolvedBaseUrl !== (existingConfig.base_url ?? null)
        || resolvedModel !== (existingConfig.model ?? null)
      )
      : true;

    const nextValidationStatus = existingConfig && !configChanged
      ? (existingConfig.validation_status ?? 'pending')
      : 'pending';
    const nextCheckedAt = existingConfig && !configChanged
      ? (existingConfig.last_checked_at ?? null)
      : now;
    const nextCheckMessage = existingConfig && !configChanged
      ? (existingConfig.last_check_message || (nextValidationStatus === 'passed' ? '渠道检测通过' : '配置已保存'))
      : '配置已保存，建议重新检测';
    
    if (existingConfig) {
      await c.env.DB.prepare(
        `UPDATE ai_configs
         SET is_active = 1,
             updated_at = ?,
             api_key = ?,
             base_url = ?,
             model = ?,
             validation_status = ?,
             last_checked_at = ?,
             last_check_message = ?
         WHERE id = ?`
      ).bind(
        now,
        resolvedApiKey ? encryptApiKey(resolvedApiKey) : null,
        resolvedBaseUrl,
        resolvedModel,
        nextValidationStatus,
        nextCheckedAt,
        nextCheckMessage,
        existingConfig.id,
      ).run();
       
      await c.env.DB.prepare(
        'UPDATE ai_configs SET is_active = 0 WHERE user_id = ? AND id != ?'
      ).bind(payload.userId, existingConfig.id).run();
      
    } else {
      await c.env.DB.prepare(`
        INSERT INTO ai_configs (
          user_id, service_name, api_key, base_url, model, is_active,
          validation_status, last_checked_at, last_check_message, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).bind(
        payload.userId,
        serviceName,
        resolvedApiKey ? encryptApiKey(resolvedApiKey) : null,
        resolvedBaseUrl,
        resolvedModel,
        nextValidationStatus,
        nextCheckedAt,
        nextCheckMessage,
        now,
        now,
      ).run();
      
      await c.env.DB.prepare(
        'UPDATE ai_configs SET is_active = 0 WHERE user_id = ? AND service_name != ?'
      ).bind(payload.userId, serviceName).run();
    }
    
    return c.json({
      success: true,
      message: 'AI配置更新成功'
    });
    
  } catch (error) {
    console.error('更新AI配置错误:', error);
    return c.json({ success: false, error: '服务器内部错误' }, 500);
  }
});

// 删除AI配置
aiRoutes.delete('/config/:id', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const configId = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM ai_configs WHERE id = ? AND user_id = ?'
    ).bind(configId, payload.userId).run();
    
    if (!result.success) {
      return c.json({ success: false, error: '删除失败' }, 500);
    }
    
    return c.json({
      success: true,
      message: '删除成功'
    });
    
  } catch (error) {
    console.error('删除AI配置错误:', error);
    return c.json({ success: false, error: '服务器内部错误' }, 500);
  }
});

// 测试AI服务连接
aiRoutes.post('/test', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { serviceName, apiKey, baseUrl, model } = await c.req.json();

    const existingConfig = await c.env.DB.prepare(
      'SELECT id, api_key, is_active FROM ai_configs WHERE user_id = ? AND service_name = ?'
    ).bind(payload.userId, serviceName).first<{ id: number; api_key?: string | null; is_active?: number }>();

    const submittedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const resolvedApiKey = submittedApiKey || decryptApiKey(existingConfig?.api_key);
    const validation = await validateAIConnection(c.env, {
      serviceName,
      apiKey: resolvedApiKey,
      baseUrl,
      model,
    });

    const checkedAt = new Date().toISOString();
    const encryptedApiKey = resolvedApiKey ? encryptApiKey(resolvedApiKey) : null;

    if (existingConfig) {
      await c.env.DB.prepare(
        `UPDATE ai_configs
         SET api_key = COALESCE(?, api_key),
             validation_status = ?,
             last_checked_at = ?,
             last_check_message = ?,
             updated_at = ?,
             base_url = COALESCE(?, base_url),
             model = COALESCE(?, model)
         WHERE user_id = ? AND service_name = ?`
      ).bind(
        encryptedApiKey,
        validation.success ? 'passed' : 'failed',
        checkedAt,
        validation.message,
        checkedAt,
        validation.resolvedBaseUrl || null,
        validation.resolvedModel || null,
        payload.userId,
        serviceName,
      ).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO ai_configs (
           user_id, service_name, api_key, base_url, model, is_active,
           validation_status, last_checked_at, last_check_message, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
      ).bind(
        payload.userId,
        serviceName,
        encryptedApiKey,
        validation.resolvedBaseUrl || null,
        validation.resolvedModel || null,
        validation.success ? 'passed' : 'failed',
        checkedAt,
        validation.message,
        checkedAt,
        checkedAt,
      ).run();
    }
    
    return c.json({
      success: validation.success,
      message: validation.message,
      data: {
        resolvedBaseUrl: validation.resolvedBaseUrl,
        resolvedModel: validation.resolvedModel,
      }
    });
    
  } catch (error) {
    console.error('测试AI服务错误:', error);
    return c.json({ success: false, error: '服务器内部错误' }, 500);
  }
});

aiRoutes.post('/project-autofill', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const body = await c.req.json();
    const genre = typeof body.genre === 'string' ? body.genre.trim() : '';
    const scriptType = typeof body.script_type === 'string' ? body.script_type.trim() : '';
    const aiService = typeof body.ai_service === 'string' ? body.ai_service.trim() : 'cloudflare-ai';
    const generationMode = typeof body.generation_mode === 'string' ? body.generation_mode.trim() : 'balanced';

    if (!genre || !scriptType) {
      return c.json({ success: false, error: '题材和类型是必填项' }, 400);
    }

    if (aiService !== 'cloudflare-ai') {
      await ensureServiceReadyForGeneration(c.env.DB, Number(payload.userId), aiService);
    }

    const provider = await getUserAIProvider(Number(payload.userId), c.env as any, aiService);
    const modePrompt = generationMode === 'conservative'
      ? '整体方向偏稳健、市场友好、平台适配优先，避免过度猎奇。'
      : generationMode === 'wild'
        ? '整体方向偏高概念、强钩子、脑洞大、设定感强，允许更大胆的创意和反转。'
        : '整体方向兼顾市场可看性与创意新鲜感，保持平衡。';
    const response = await provider.chat([
      {
        role: 'system',
        content: [
          '你是一位网剧/短剧项目策划专家与制片开发顾问。',
          '用户只提供题材和类型，你需要自动补全一个可直接用于项目创建的创意包。',
          '输出必须严格为 JSON，不得输出解释性文字。',
          '内容要有商业感、可拍性、戏剧冲突和平台适配感。',
          modePrompt,
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `题材：${genre}`,
          `类型：${scriptType}`,
          `生成模式：${generationMode}`,
          '',
          '请自动生成并返回以下字段：',
          '- title: 剧本标题',
          '- style: 风格',
          '- target_platform: 目标平台',
          '- target_duration: 单集时长（整数）',
          '- total_episodes: 总集数（整数）',
          '- character_count: 角色数量（整数）',
          '- key_points: 5-8 条关键情节点数组',
          '- characters_input: 4-7 条角色设定数组',
          '- scene_input: 世界观/场景背景描述',
          '',
          '要求：',
          '1. 直接可填充创作参数',
          '2. 标题要具体，不要泛泛而谈',
          '3. 角色设定每条都包含姓名、身份、核心矛盾',
          '4. key_points 必须是剧情推进点，不要写空泛主题',
          '',
          '输出 JSON 结构：',
          JSON.stringify({
            title: '标题',
            style: '风格',
            target_platform: '平台',
            target_duration: 15,
            total_episodes: 60,
            character_count: 6,
            key_points: ['关键情节点'],
            characters_input: ['角色设定'],
            scene_input: '背景描述',
          }, null, 2),
        ].join('\n'),
      },
    ], {
      jsonMode: true,
      maxTokens: 1800,
      temperature: 0.85,
    });

    const parsed = JSON.parse(response.content);
    return c.json({ success: true, data: { suggestion: parsed } });
  } catch (error) {
    console.error('项目参数智能填充错误:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '智能填充失败' }, 500);
  }
});

// 加密API密钥（简化版，实际应用应使用更强的加密）
function encryptApiKey(apiKey: string): string {
  // 这里使用简单的Base64编码，实际应用应使用AES加密
  return btoa(apiKey);
}

function decryptApiKey(apiKey?: string | null): string | undefined {
  if (!apiKey) {
    return undefined;
  }

  try {
    return atob(apiKey);
  } catch {
    return apiKey;
  }
}
