import { Hono } from 'hono';
import { jwt } from 'hono/jwt';

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

export const scriptRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 生成剧本
scriptRoutes.post('/generate', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { 
      title, 
      genre, 
      characters, 
      scene, 
      length, 
      keyPoints, 
      aiService,
      scriptType 
    } = await c.req.json();
    
    // 验证输入
    if (!title || !genre || !scriptType) {
      return c.json({ error: '标题、类型和剧本类型是必填项' }, 400);
    }
    
    // 获取用户的AI配置
    const aiConfig = await c.env.DB.prepare(
      'SELECT * FROM ai_configs WHERE user_id = ? AND is_active = 1'
    ).bind(payload.userId).first();
    
    // 构建提示词
    const prompt = buildScriptPrompt({
      title,
      genre,
      characters,
      scene,
      length,
      keyPoints,
      scriptType
    });
    
    // 调用AI服务生成剧本
    let scriptContent;
    let usedAiService = aiService || 'cloudflare-ai';
    
    if (aiService === 'cloudflare-ai' || !aiService) {
      // 使用Cloudflare Workers AI
      scriptContent = await generateWithCloudflareAI(c.env.AI, prompt);
    } else if (aiService === 'openai' && aiConfig?.api_key) {
      // 使用OpenAI API
      scriptContent = await generateWithOpenAI(aiConfig.api_key as string, prompt);
    } else if (aiService === 'claude' && aiConfig?.api_key) {
      // 使用Claude API
      scriptContent = await generateWithClaude(aiConfig.api_key as string, prompt);
    } else {
      return c.json({ error: '未配置AI服务或API密钥' }, 400);
    }
    
    // 保存到数据库
    const result = await c.env.DB.prepare(`
      INSERT INTO scripts (
        user_id, title, content, genre, characters, scene, 
        length, key_points, ai_service, script_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.userId,
      title,
      scriptContent,
      genre,
      JSON.stringify(characters || []),
      scene || '',
      length || 'short',
      JSON.stringify(keyPoints || []),
      usedAiService,
      scriptType,
      new Date().toISOString()
    ).run();
    
    if (!result.success) {
      return c.json({ error: '保存剧本失败' }, 500);
    }
    
    return c.json({
      success: true,
      message: '剧本生成成功',
      script: {
        id: result.meta.last_row_id,
        title,
        content: scriptContent,
        genre,
        scriptType,
        aiService: usedAiService,
        createdAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('生成剧本错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 获取用户剧本历史
scriptRoutes.get('/history', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '10');
    const offset = (page - 1) * limit;
    
    // 获取总数
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM scripts WHERE user_id = ?'
    ).bind(payload.userId).first();
    
    // 获取分页数据
    const scripts = await c.env.DB.prepare(`
      SELECT id, title, genre, script_type, ai_service, created_at, 
             SUBSTR(content, 1, 200) as preview
      FROM scripts 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).bind(payload.userId, limit, offset).all();
    
    return c.json({
      success: true,
      scripts: scripts.results,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((Number(countResult?.total) || 0) / limit)
      }
    });
    
  } catch (error) {
    console.error('获取历史记录错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 获取单个剧本详情
scriptRoutes.get('/:id', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const scriptId = c.req.param('id');
    
    const script = await c.env.DB.prepare(`
      SELECT * FROM scripts WHERE id = ? AND user_id = ?
    `).bind(scriptId, payload.userId).first();
    
    if (!script) {
      return c.json({ error: '剧本不存在' }, 404);
    }
    
    return c.json({
      success: true,
      script
    });
    
  } catch (error) {
    console.error('获取剧本详情错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 删除剧本
scriptRoutes.delete('/:id', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const scriptId = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM scripts WHERE id = ? AND user_id = ?'
    ).bind(scriptId, payload.userId).run();
    
    if (!result.success) {
      return c.json({ error: '删除失败' }, 500);
    }
    
    return c.json({
      success: true,
      message: '删除成功'
    });
    
  } catch (error) {
    console.error('删除剧本错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 构建提示词
function buildScriptPrompt(params: any): string {
  const { title, genre, characters, scene, length, keyPoints, scriptType } = params;
  
  let prompt = `请生成一个${getScriptTypeText(scriptType)}剧本。\n\n`;
  prompt += `标题：${title}\n`;
  prompt += `类型：${genre}\n`;
  
  if (characters && characters.length > 0) {
    prompt += `角色：${characters.join('、')}\n`;
  }
  
  if (scene) {
    prompt += `场景：${scene}\n`;
  }
  
  if (length) {
    prompt += `长度：${getLengthText(length)}\n`;
  }
  
  if (keyPoints && keyPoints.length > 0) {
    prompt += `关键情节点：\n`;
    keyPoints.forEach((point: string, index: number) => {
      prompt += `${index + 1}. ${point}\n`;
    });
  }
  
  prompt += `\n请按照专业的剧本格式生成，包括场景描述、角色对白、动作指示等。确保故事完整、情节连贯、对话自然。`;
  
  return prompt;
}

// 获取剧本类型文本
function getScriptTypeText(type: string): string {
  const types: Record<string, string> = {
    'movie': '电影',
    'tv': '电视剧',
    'short-video': '短视频',
    'commercial': '广告',
    'novel': '小说'
  };
  return types[type] || '电影';
}

// 获取长度文本
function getLengthText(length: string): string {
  const lengths: Record<string, string> = {
    'short': '短篇（5-10分钟）',
    'medium': '中篇（15-30分钟）',
    'long': '长篇（30分钟以上）'
  };
  return lengths[length] || '短篇';
}

// 使用Cloudflare Workers AI生成
async function generateWithCloudflareAI(ai: any, prompt: string): Promise<string> {
  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: '你是一个专业的剧本作家，擅长创作各种类型的剧本。请用中文回复。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2000
    });
    
    return response.response;
  } catch (error) {
    console.error('Cloudflare AI error:', error);
    throw new Error('AI生成失败');
  }
}

// 使用OpenAI生成
async function generateWithOpenAI(apiKey: string, prompt: string): Promise<string> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: '你是一个专业的剧本作家，擅长创作各种类型的剧本。请用中文回复。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.7
      })
    });
    
    const data = await response.json() as any;
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI error:', error);
    throw new Error('OpenAI生成失败');
  }
}

// 使用Claude生成
async function generateWithClaude(apiKey: string, prompt: string): Promise<string> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
        max_tokens: 2000,
        messages: [
          { role: 'user', content: `你是一个专业的剧本作家，擅长创作各种类型的剧本。请用中文回复。\n\n${prompt}` }
        ]
      })
    });
    
    const data = await response.json() as any;
    return data.content[0].text;
  } catch (error) {
    console.error('Claude error:', error);
    throw new Error('Claude生成失败');
  }
}
