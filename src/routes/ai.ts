import { Hono } from 'hono';
import { jwt } from 'hono/jwt';

type Bindings = {
  DB: D1Database;
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

// 获取支持的AI服务列表
aiRoutes.get('/services', async (c) => {
  const services = [
    {
      id: 'cloudflare-ai',
      name: 'Cloudflare Workers AI',
      description: '使用Cloudflare内置的AI模型（Llama、Mistral等）',
      requiresApiKey: false,
      isDefault: true
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: '使用OpenAI的GPT-4等模型',
      requiresApiKey: true,
      apiKeyFormat: 'sk-...'
    },
    {
      id: 'claude',
      name: 'Claude (Anthropic)',
      description: '使用Anthropic的Claude模型',
      requiresApiKey: true,
      apiKeyFormat: 'sk-ant-...'
    }
  ];
  
  return c.json({
    success: true,
    services
  });
});

// 获取用户的AI配置
aiRoutes.get('/config', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    
    const configs = await c.env.DB.prepare(
      'SELECT id, service_name, is_active, created_at FROM ai_configs WHERE user_id = ?'
    ).bind(payload.userId).all();
    
    return c.json({
      success: true,
      configs: configs.results
    });
    
  } catch (error) {
    console.error('获取AI配置错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 更新用户的AI配置
aiRoutes.put('/config', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { serviceName, apiKey } = await c.req.json();
    
    if (!serviceName) {
      return c.json({ error: '服务名称是必填项' }, 400);
    }
    
    // 检查是否已存在该服务的配置
    const existingConfig = await c.env.DB.prepare(
      'SELECT id FROM ai_configs WHERE user_id = ? AND service_name = ?'
    ).bind(payload.userId, serviceName).first();
    
    if (existingConfig) {
      // 更新现有配置
      let updateQuery = 'UPDATE ai_configs SET is_active = 1, updated_at = ?';
      let updateValues: any[] = [new Date().toISOString()];
      
      if (apiKey) {
        updateQuery += ', api_key = ?';
        updateValues.push(encryptApiKey(apiKey));
      }
      
      updateQuery += ' WHERE id = ?';
      updateValues.push(existingConfig.id);
      
      await c.env.DB.prepare(updateQuery).bind(...updateValues).run();
      
      // 将其他配置设为非活跃
      await c.env.DB.prepare(
        'UPDATE ai_configs SET is_active = 0 WHERE user_id = ? AND id != ?'
      ).bind(payload.userId, existingConfig.id).run();
      
    } else {
      // 创建新配置
      await c.env.DB.prepare(`
        INSERT INTO ai_configs (user_id, service_name, api_key, is_active, created_at)
        VALUES (?, ?, ?, 1, ?)
      `).bind(
        payload.userId,
        serviceName,
        apiKey ? encryptApiKey(apiKey) : null,
        new Date().toISOString()
      ).run();
      
      // 将其他配置设为非活跃
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
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 删除AI配置
aiRoutes.delete('/config/:id', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const configId = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM ai_configs WHERE id = ? AND user_id = ?'
    ).bind(configId, payload.userId).run();
    
    if (!result.success) {
      return c.json({ error: '删除失败' }, 500);
    }
    
    return c.json({
      success: true,
      message: '删除成功'
    });
    
  } catch (error) {
    console.error('删除AI配置错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 测试AI服务连接
aiRoutes.post('/test', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { serviceName, apiKey } = await c.req.json();
    
    let testResult = false;
    let errorMessage = '';
    
    if (serviceName === 'cloudflare-ai') {
      testResult = true; // Cloudflare AI总是可用
    } else if (serviceName === 'openai' && apiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        testResult = response.ok;
        if (!testResult) {
          errorMessage = 'OpenAI API密钥无效';
        }
      } catch (e) {
        errorMessage = '无法连接到OpenAI API';
      }
    } else if (serviceName === 'claude' && apiKey) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        });
        testResult = response.ok;
        if (!testResult) {
          errorMessage = 'Claude API密钥无效';
        }
      } catch (e) {
        errorMessage = '无法连接到Claude API';
      }
    } else {
      errorMessage = '请提供API密钥';
    }
    
    return c.json({
      success: testResult,
      message: testResult ? '连接成功' : errorMessage
    });
    
  } catch (error) {
    console.error('测试AI服务错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 加密API密钥（简化版，实际应用应使用更强的加密）
function encryptApiKey(apiKey: string): string {
  // 这里使用简单的Base64编码，实际应用应使用AES加密
  return btoa(apiKey);
}
