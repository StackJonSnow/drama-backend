import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import { getUserAIProvider } from '../services/ai-provider';
import {
  executePipelinePhase1,
  executePipelinePhase2,
  executePipelinePhase3,
  executeStep1,
  executeStep2,
  executeStep3,
  executeStep4,
  STEP_NAMES,
} from '../services/pipeline';
import type { TaskInput } from '../services/prompts';

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

export const pipelineRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// JWT认证中间件
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

// 生成任务ID
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

async function getFullTaskMarkdown(db: D1Database, taskId: string): Promise<string> {
  const task = await db.prepare(
    'SELECT * FROM generation_tasks WHERE id = ?'
  ).bind(taskId).first();

  if (!task) {
    throw new Error('任务不存在');
  }

  const episodes = await db.prepare(
    'SELECT * FROM episodes WHERE task_id = ? ORDER BY episode_number'
  ).bind(taskId).all();

  if (!episodes.results?.length) {
    throw new Error('暂无已生成的集数');
  }

  const outlineStep = await db.prepare(
    'SELECT content FROM pipeline_steps WHERE task_id = ? AND step_number = 1'
  ).bind(taskId).first();

  const outline = outlineStep?.content ? JSON.parse(outlineStep.content as string) : {};

  let markdown = `# ${task.title}\n\n`;
  markdown += `> **题材**: ${task.genre} | **类型**: ${task.script_type} | **总集数**: ${task.total_episodes}\n\n`;

  if (outline.synopsis) {
    markdown += `## 故事梗概\n\n${outline.synopsis}\n\n`;
  }

  markdown += `---\n\n`;

  for (const ep of episodes.results) {
    markdown += `${ep.content}\n\n---\n\n`;
  }

  return markdown;
}

/**
 * POST /api/pipeline/start
 * 创建新的生成任务并开始流水线
 */
pipelineRoutes.post('/start', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const body = await c.req.json();

    const {
      title, genre, script_type, style, target_platform,
      target_duration, character_count, key_points,
      characters_input, scene_input, ai_service, total_episodes,
    } = body;

    if (!title || !genre || !script_type) {
      return c.json({ success: false, error: '标题、题材和剧本类型是必填项' }, 400);
    }

    const taskId = generateTaskId();
    const now = new Date().toISOString();

    // 创建任务记录
    await c.env.DB.prepare(`
      INSERT INTO generation_tasks (
        id, user_id, title, genre, script_type, style, target_platform,
        target_duration, character_count, key_points, characters_input,
        scene_input, ai_service, total_episodes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
    `).bind(
      taskId,
      payload.userId,
      title,
      genre,
      script_type,
      style || null,
      target_platform || null,
      target_duration || null,
      character_count || null,
      key_points ? JSON.stringify(key_points) : null,
      characters_input ? JSON.stringify(characters_input) : null,
      scene_input || null,
      ai_service || 'cloudflare-ai',
      total_episodes || 50,
      now
    ).run();

    // 创建流水线步骤记录
    for (let i = 1; i <= 8; i++) {
      await c.env.DB.prepare(
        'INSERT INTO pipeline_steps (task_id, step_number, step_name, status) VALUES (?, ?, ?, ?)'
      ).bind(taskId, i, STEP_NAMES[i], i === 1 ? 'running' : 'pending').run();
    }

    // 使用 waitUntil 在后台执行流水线（不阻塞响应）
    c.executionCtx.waitUntil(
      runPipeline(c, taskId, payload.userId)
    );

    return c.json({
      success: true,
      message: '剧本生成任务已启动',
      data: { taskId },
    });

  } catch (error) {
    console.error('创建流水线任务错误:', error);
    return c.json({ success: false, error: '创建任务失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/status
 * 获取任务状态
 */
pipelineRoutes.get('/:id/status', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');

    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    // 获取步骤状态
    const steps = await c.env.DB.prepare(
      'SELECT * FROM pipeline_steps WHERE task_id = ? ORDER BY step_number'
    ).bind(taskId).all();

    // 获取已完成的集数
    const episodes = await c.env.DB.prepare(
      'SELECT episode_number, title, status, word_count FROM episodes WHERE task_id = ? ORDER BY episode_number'
    ).bind(taskId).all();

    // 获取评分
    const score = await c.env.DB.prepare(
      'SELECT * FROM scores WHERE task_id = ?'
    ).bind(taskId).first();

    return c.json({
      success: true,
      data: {
        task,
        steps: steps.results,
        episodes: episodes.results,
        score,
      },
    });

  } catch (error) {
    console.error('获取任务状态错误:', error);
    return c.json({ success: false, error: '获取状态失败' }, 500);
  }
});

/**
 * POST /api/pipeline/:id/pause
 * 暂停任务
 */
pipelineRoutes.post('/:id/pause', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';

    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    if (task.status !== 'running') {
      return c.json({ success: false, error: '只有运行中的任务可以暂停' }, 400);
    }

    await c.env.DB.prepare(
      'UPDATE generation_tasks SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('paused', new Date().toISOString(), taskId).run();

    return c.json({
      success: true,
      message: '任务已暂停，下次可从当前进度继续',
    });

  } catch (error) {
    console.error('暂停任务错误:', error);
    return c.json({ success: false, error: '暂停失败' }, 500);
  }
});

/**
 * POST /api/pipeline/:id/resume
 * 恢复任务
 */
pipelineRoutes.post('/:id/resume', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';

    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    if (task.status !== 'paused') {
      return c.json({ success: false, error: '只有暂停的任务可以恢复' }, 400);
    }

    await c.env.DB.prepare(
      'UPDATE generation_tasks SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('running', new Date().toISOString(), taskId).run();

    // 重新启动流水线
    c.executionCtx.waitUntil(
      runPipeline(c, taskId, Number(payload.userId))
    );

    return c.json({
      success: true,
      message: '任务已恢复',
    });

  } catch (error) {
    console.error('恢复任务错误:', error);
    return c.json({ success: false, error: '恢复失败' }, 500);
  }
});

/**
 * POST /api/pipeline/:id/cancel
 * 取消任务
 */
pipelineRoutes.post('/:id/cancel', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');

    const result = await c.env.DB.prepare(
      'UPDATE generation_tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    ).bind('failed', new Date().toISOString(), taskId, payload.userId).run();

    if (!result.success) {
      return c.json({ success: false, error: '取消失败' }, 500);
    }

    return c.json({
      success: true,
      message: '任务已取消',
    });

  } catch (error) {
    console.error('取消任务错误:', error);
    return c.json({ success: false, error: '取消失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/stream
 * SSE 流式获取生成进度
 */
pipelineRoutes.get('/:id/stream', async (c) => {
  const taskId = c.req.param('id');
  const token = c.req.query('token');

  // SSE需要通过query参数传递token（EventSource不支持自定义header）
  if (!token) {
    return c.json({ success: false, error: '未提供认证令牌' }, 401);
  }

  try {
    await verify(token, c.env.JWT_SECRET, 'HS256');
  } catch {
    return c.json({ success: false, error: '认证令牌无效' }, 401);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // 启动SSE推送
  c.executionCtx.waitUntil(
    pushSSEUpdates(c, taskId, writer, encoder)
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

/**
 * GET /api/pipeline/:id/episodes
 * 获取任务的所有集数
 */
pipelineRoutes.get('/:id/episodes', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');

    // 验证任务归属
    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '10');
    const offset = (page - 1) * limit;

    const episodes = await c.env.DB.prepare(
      'SELECT * FROM episodes WHERE task_id = ? ORDER BY episode_number LIMIT ? OFFSET ?'
    ).bind(taskId, limit, offset).all();

    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM episodes WHERE task_id = ?'
    ).bind(taskId).first();

    return c.json({
      success: true,
      data: {
        episodes: episodes.results,
        pagination: {
          page,
          limit,
          total: countResult?.total || 0,
          totalPages: Math.ceil((Number(countResult?.total) || 0) / limit),
        },
      },
    });

  } catch (error) {
    console.error('获取集数列表错误:', error);
    return c.json({ success: false, error: '获取集数失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/episodes/:ep
 * 获取单集详情
 */
pipelineRoutes.get('/:id/episodes/:ep', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');
    const episodeNumber = parseInt(c.req.param('ep') || '0');

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const episode = await c.env.DB.prepare(
      'SELECT * FROM episodes WHERE task_id = ? AND episode_number = ?'
    ).bind(taskId, episodeNumber).first();

    if (!episode) {
      return c.json({ success: false, error: '该集尚未生成' }, 404);
    }

    return c.json({
      success: true,
      data: { episode },
    });

  } catch (error) {
    console.error('获取集数详情错误:', error);
    return c.json({ success: false, error: '获取集数详情失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/export
 * 导出完整剧本 (Markdown)
 */
pipelineRoutes.get('/:id/export', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');
    const format = c.req.query('format') || 'markdown';

    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const markdown = await getFullTaskMarkdown(c.env.DB, taskId);

    if (format === 'markdown') {
      return new Response(markdown, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(task.title as string)}.md"`,
        },
      });
    }

    return c.json({
      success: true,
      data: { content: markdown },
    });

  } catch (error) {
    console.error('导出剧本错误:', error);
    return c.json({ success: false, error: '导出失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/versions
 * 获取任务版本列表
 */
pipelineRoutes.get('/:id/versions', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const versions = await c.env.DB.prepare(`
      SELECT id, task_id, version, label, change_notes, created_at
      FROM script_versions
      WHERE task_id = ?
      ORDER BY version DESC, created_at DESC
    `).bind(taskId).all();

    return c.json({
      success: true,
      data: { versions: versions.results || [] },
    });
  } catch (error) {
    console.error('获取版本列表错误:', error);
    return c.json({ success: false, error: '获取版本列表失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/versions/:versionId
 * 获取单个版本详情
 */
pipelineRoutes.get('/:id/versions/:versionId', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');
    const versionId = c.req.param('versionId');

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const version = await c.env.DB.prepare(`
      SELECT id, task_id, version, label, content, change_notes, created_at
      FROM script_versions
      WHERE id = ? AND task_id = ?
    `).bind(versionId, taskId).first();

    if (!version) {
      return c.json({ success: false, error: '版本不存在' }, 404);
    }

    return c.json({
      success: true,
      data: { version },
    });
  } catch (error) {
    console.error('获取版本详情错误:', error);
    return c.json({ success: false, error: '获取版本详情失败' }, 500);
  }
});

/**
 * POST /api/pipeline/:id/versions
 * 创建任务版本快照
 */
pipelineRoutes.post('/:id/versions', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const changeNotes = typeof body.changeNotes === 'string' ? body.changeNotes.trim() : '';

    const task = await c.env.DB.prepare(
      'SELECT id, title FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const markdown = await getFullTaskMarkdown(c.env.DB, taskId);

    const latestVersion = await c.env.DB.prepare(
      'SELECT version FROM script_versions WHERE task_id = ? ORDER BY version DESC LIMIT 1'
    ).bind(taskId).first();

    const nextVersion = Number(latestVersion?.version || 0) + 1;
    const finalLabel = label || `版本 ${nextVersion}`;

    const result = await c.env.DB.prepare(`
      INSERT INTO script_versions (task_id, version, label, content, change_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      taskId,
      nextVersion,
      finalLabel,
      markdown,
      changeNotes || null,
      new Date().toISOString()
    ).run();

    const version = await c.env.DB.prepare(`
      SELECT id, task_id, version, label, content, change_notes, created_at
      FROM script_versions
      WHERE id = ?
    `).bind(result.meta.last_row_id).first();

    return c.json({
      success: true,
      message: '版本快照已创建',
      data: { version },
    });
  } catch (error) {
    console.error('创建版本快照错误:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '创建版本失败' }, 500);
  }
});

/**
 * GET /api/pipeline/list
 * 获取用户的任务列表
 */
pipelineRoutes.get('/list', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '10');
    const offset = (page - 1) * limit;

    const tasks = await c.env.DB.prepare(`
      SELECT id, title, genre, script_type, total_episodes, completed_episodes, 
             current_step, status, created_at, updated_at
      FROM generation_tasks 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).bind(payload.userId, limit, offset).all();

    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM generation_tasks WHERE user_id = ?'
    ).bind(payload.userId).first();

    return c.json({
      success: true,
      data: {
        tasks: tasks.results,
        pagination: {
          page,
          limit,
          total: countResult?.total || 0,
          totalPages: Math.ceil((Number(countResult?.total) || 0) / limit),
        },
      },
    });

  } catch (error) {
    console.error('获取任务列表错误:', error);
    return c.json({ success: false, error: '获取任务列表失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/steps
 * 获取流水线所有步骤状态和内容
 */
pipelineRoutes.get('/:id/steps', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const steps = await c.env.DB.prepare(
      'SELECT step_number, step_name, status, error_message, started_at, completed_at FROM pipeline_steps WHERE task_id = ? ORDER BY step_number'
    ).bind(taskId).all();

    return c.json({
      success: true,
      data: { steps: steps.results },
    });

  } catch (error) {
    console.error('获取步骤状态错误:', error);
    return c.json({ success: false, error: '获取步骤状态失败' }, 500);
  }
});

/**
 * GET /api/pipeline/:id/steps/:step/content
 * 获取单个步骤的生成内容（预览）
 */
pipelineRoutes.get('/:id/steps/:step/content', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';
    const stepNumber = parseInt(c.req.param('step') || '0');

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const step = await c.env.DB.prepare(
      'SELECT * FROM pipeline_steps WHERE task_id = ? AND step_number = ?'
    ).bind(taskId, stepNumber).first();

    if (!step) {
      return c.json({ success: false, error: '步骤不存在' }, 404);
    }

    return c.json({
      success: true,
      data: {
        step_number: step.step_number,
        step_name: step.step_name,
        status: step.status,
        content: step.content ? JSON.parse(step.content as string) : null,
        error_message: step.error_message,
        started_at: step.started_at,
        completed_at: step.completed_at,
      },
    });

  } catch (error) {
    console.error('获取步骤内容错误:', error);
    return c.json({ success: false, error: '获取步骤内容失败' }, 500);
  }
});

// ============================================
// 后台流水线执行
// ============================================

async function runPipeline(
  c: Context<any>,
  taskId: string,
  userId: number
) {
  const pendingErrors: { step: number; name: string; message: string }[] = [];

  try {
    // 获取任务信息
    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ?'
    ).bind(taskId).first();

    if (!task) return;

    // 获取AI Provider
    const provider = await getUserAIProvider(userId, c.env);

    const input: TaskInput = {
      title: task.title as string,
      genre: task.genre as string,
      scriptType: task.script_type as string,
      style: task.style as string || undefined,
      targetPlatform: task.target_platform as string || undefined,
      targetDuration: task.target_duration as number || undefined,
      characterCount: task.character_count as number || undefined,
      keyPoints: task.key_points ? JSON.parse(task.key_points as string) : undefined,
      charactersInput: task.characters_input ? JSON.parse(task.characters_input as string) : undefined,
      sceneInput: task.scene_input as string || undefined,
      totalEpisodes: task.total_episodes as number,
    };

    // 读取已完成的步骤
    const existingSteps = await c.env.DB.prepare(
      'SELECT * FROM pipeline_steps WHERE task_id = ? ORDER BY step_number'
    ).bind(taskId).all();

    const stepResults: Record<number, any> = {};
    for (const step of existingSteps.results || []) {
      if (step.status === 'completed' && step.content) {
        stepResults[step.step_number as number] = JSON.parse(step.content as string);
      }
    }

    const currentStep = task.current_step as number;

    // 构建上下文
    const buildContext = () => ({
      taskId,
      userId,
      input,
      provider,
      db: c.env.DB,
      totalEpisodes: task.total_episodes as number,
      onStepComplete: async (step: number, name: string, data: any) => {
        stepResults[step] = data;
        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET content = ?, status = ?, completed_at = ? WHERE task_id = ? AND step_number = ?'
        ).bind(JSON.stringify(data), 'completed', new Date().toISOString(), taskId, step).run();
        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET status = ?, started_at = ? WHERE task_id = ? AND step_number = ? AND status = ?'
        ).bind('running', new Date().toISOString(), taskId, step + 1, 'pending').run();
        await c.env.DB.prepare(
          'UPDATE generation_tasks SET current_step = ?, updated_at = ? WHERE id = ?'
        ).bind(step, new Date().toISOString(), taskId).run();
      },
      onEpisodeComplete: async () => {},
      onLog: (msg: string) => console.log(`[${taskId}] ${msg}`),
      onError: async (step: number, name: string, error: string) => {
        pendingErrors.push({ step, name, message: error });
      },
    });

    // Phase 1: 步骤 1-4 (每个步骤独立 try-catch)
    if (currentStep < 4) {
      const context = buildContext();

      const STEP_CONFIG: { num: number; fn: () => Promise<any> }[] = [
        { num: 1, fn: () => executeStep1(context) },
        { num: 2, fn: () => executeStep2(context, stepResults[1]) },
        { num: 3, fn: () => executeStep3(context, stepResults[1], stepResults[2]) },
        { num: 4, fn: () => executeStep4(context, stepResults[1], stepResults[3]) },
      ];

      for (const { num, fn } of STEP_CONFIG) {
        if (stepResults[num]) continue; // 已完成则跳过

        // 检查任务是否被暂停
        const taskStatus = await c.env.DB.prepare(
          'SELECT status FROM generation_tasks WHERE id = ?'
        ).bind(taskId).first();
        if (taskStatus?.status === 'paused') {
          console.log(`[${taskId}] 任务已暂停`);
          return;
        }

        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET status = ?, started_at = ? WHERE task_id = ? AND step_number = ?'
        ).bind('running', new Date().toISOString(), taskId, num).run();

        try {
          stepResults[num] = await fn();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[${taskId}] Step ${num} 失败:`, errMsg);

          // 更新步骤状态为失败
          await c.env.DB.prepare(
            'UPDATE pipeline_steps SET status = ?, error_message = ?, completed_at = ? WHERE task_id = ? AND step_number = ?'
          ).bind('failed', errMsg, new Date().toISOString(), taskId, num).run();

          // 收集错误（不中断后续步骤，让stepResults留空以便重试）
          pendingErrors.push({ step: num, name: STEP_NAMES[num], message: errMsg });
        }
      }
    }

    // 检查关键步骤是否完成（step1-4必须全部完成才能继续）
    if (!stepResults[1] || !stepResults[2] || !stepResults[3] || !stepResults[4]) {
      const failedSteps = [1,2,3,4].filter(n => !stepResults[n]);
      await c.env.DB.prepare(
        'UPDATE generation_tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?'
      ).bind(
        'failed',
        `步骤 ${failedSteps.join(',')} 生成失败，请重试`,
        new Date().toISOString(),
        taskId
      ).run();
      return;
    }

    // Phase 2: 步骤 5-7（逐集生成）
    const context2 = buildContext();

    try {
      await executePipelinePhase2(context2, stepResults[1], stepResults[2], stepResults[4]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${taskId}] Phase 2 失败:`, errMsg);
      pendingErrors.push({ step: 5, name: 'scenes/dialogue/compose', message: errMsg });
    }

    // Phase 3: 步骤 8（评分）
    await c.env.DB.prepare(
      'UPDATE pipeline_steps SET status = ?, started_at = ? WHERE task_id = ? AND step_number = ?'
    ).bind('running', new Date().toISOString(), taskId, 8).run();

    try {
      const score = await executePipelinePhase3(context2, stepResults[1]);

      if (score) {
        await c.env.DB.prepare(
          'INSERT INTO scores (task_id, plot_score, dialogue_score, character_score, pacing_score, creativity_score, overall_score, suggestions, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          taskId,
          score.plot?.score || 0, score.dialogue?.score || 0, score.character?.score || 0,
          score.pacing?.score || 0, score.creativity?.score || 0, score.overall || 0,
          JSON.stringify(score.suggestions || []), new Date().toISOString()
        ).run();

        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET content = ?, status = ?, completed_at = ? WHERE task_id = ? AND step_number = ?'
        ).bind(JSON.stringify(score), 'completed', new Date().toISOString(), taskId, 8).run();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${taskId}] Step 8 评分失败:`, errMsg);
      pendingErrors.push({ step: 8, name: 'evaluate', message: errMsg });
      await c.env.DB.prepare(
        'UPDATE pipeline_steps SET status = ?, error_message = ? WHERE task_id = ? AND step_number = ?'
      ).bind('failed', errMsg, taskId, 8).run();
    }

    // 标记任务完成（即使有部分非关键错误）
    await c.env.DB.prepare(
      'UPDATE generation_tasks SET current_step = 8, status = ?, error_message = ?, updated_at = ? WHERE id = ?'
    ).bind(
      'completed',
      pendingErrors.length > 0 ? JSON.stringify(pendingErrors) : null,
      new Date().toISOString(),
      taskId
    ).run();

    // 创建初始版本
    const fullMarkdown = await getFullTaskMarkdown(c.env.DB, taskId).catch(() => null);

    if (fullMarkdown) {
      await c.env.DB.prepare(
        'INSERT INTO script_versions (task_id, version, label, content, created_at) VALUES (?, 1, ?, ?, ?)'
      ).bind(taskId, '初稿', fullMarkdown, new Date().toISOString()).run();
    }

    console.log(`[${taskId}] 流水线完成 (${pendingErrors.length} 个警告)`);

  } catch (error) {
    console.error(`[${taskId}] 流水线错误:`, error);

    const task = await c.env.DB.prepare(
      'SELECT status FROM generation_tasks WHERE id = ?'
    ).bind(taskId).first();

    if (task?.status === 'paused') {
      console.log(`[${taskId}] 任务已暂停，等待恢复`);
      return;
    }

    await c.env.DB.prepare(
      'UPDATE generation_tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?'
    ).bind('failed', (error as Error).message, new Date().toISOString(), taskId).run();
  }
}

// ============================================
// SSE 推送更新
// ============================================

async function pushSSEUpdates(
  c: Context<any>,
  taskId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
) {
  const send = async (event: string, data: any) => {
    try {
      await writer.write(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      );
    } catch {
      // 连接已关闭
    }
  };

  // 初始推送当前状态
  const task = await c.env.DB.prepare(
    'SELECT * FROM generation_tasks WHERE id = ?'
  ).bind(taskId).first();

  if (task) {
    await send('status', {
      taskId,
      status: task.status,
      currentStep: task.current_step,
      totalEpisodes: task.total_episodes,
      completedEpisodes: task.completed_episodes,
    });
  }

  // 推送更新（每2秒检查一次）
  const interval = setInterval(async () => {
    try {
      const currentTask = await c.env.DB.prepare(
        'SELECT * FROM generation_tasks WHERE id = ?'
      ).bind(taskId).first();

      if (!currentTask) {
        await send('error', { message: '任务不存在' });
        clearInterval(interval);
        await writer.close();
        return;
      }

      // 推送状态更新
      await send('progress', {
        taskId,
        status: currentTask.status,
        currentStep: currentTask.current_step,
        totalEpisodes: currentTask.total_episodes,
        completedEpisodes: currentTask.completed_episodes,
        stepName: STEP_NAMES[currentTask.current_step as number] || '',
      });

      // 推送最近完成的集数内容
      const latestEpisode = await c.env.DB.prepare(
        'SELECT episode_number, title, content FROM episodes WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1'
      ).bind(taskId).first();

      if (latestEpisode) {
        await send('episode', {
          episodeNumber: latestEpisode.episode_number,
          title: latestEpisode.title,
          contentPreview: (latestEpisode.content as string)?.substring(0, 200) || '',
        });
      }

      // 推送错误日志（失败的步骤）
      const failedSteps = await c.env.DB.prepare(
        'SELECT step_number, step_name, error_message FROM pipeline_steps WHERE task_id = ? AND status = ? AND error_message IS NOT NULL'
      ).bind(taskId, 'failed').all();

      if (failedSteps.results?.length) {
        for (const step of failedSteps.results) {
          await send('error', {
            step: step.step_number,
            stepName: step.step_name,
            message: step.error_message,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 推送任务级别的错误
      if (currentTask.error_message) {
        await send('error', {
          step: 0,
          stepName: 'task',
          message: currentTask.error_message,
          timestamp: new Date().toISOString(),
        });
      }

      // 如果任务已完成或失败，关闭连接
      if (currentTask.status === 'completed' || currentTask.status === 'failed') {
        await send('done', {
          status: currentTask.status,
          message: currentTask.status === 'completed' ? '生成完成' : '生成失败',
        });
        clearInterval(interval);
        await writer.close();
      }
    } catch (error) {
      console.error('SSE推送错误:', error);
      clearInterval(interval);
      try { await writer.close(); } catch {}
    }
  }, 2000);

  // 连接关闭时清理
  try {
    await new Promise((resolve) => {
      // 60分钟后超时
      setTimeout(() => {
        clearInterval(interval);
        resolve(null);
      }, 60 * 60 * 1000);
    });
  } finally {
    clearInterval(interval);
    try { await writer.close(); } catch {}
  }
}
