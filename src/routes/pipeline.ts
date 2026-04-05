import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import { AIServiceAccessError, ensureServiceReadyForGeneration } from '../services/ai-access';
import { getUserAIConfigSnapshot, getUserAIProvider } from '../services/ai-provider';
import { getAIServiceDefinition } from '../services/ai-catalog';
import { ensureStudioDefaults, getWorkflowTemplateDetail, listWorkflowTemplates } from '../services/studio';
import {
  executePipelinePhase1,
  executePipelinePhase2,
  executePipelinePhase3,
  executeStep1,
  executeStep2,
  executeStep3,
  executeStep4,
  type PipelineLogEntry,
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

type PipelineLogRecord = {
  id: number;
  task_id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  step_number: number | null;
  step_name: string | null;
  episode_number: number | null;
  message: string;
  detail: string | null;
  created_at: string;
};

type StreamClient = {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
  closed: boolean;
  lastLogId: number;
  lastEpisodeNumber: number;
};

const streamClients = new Map<string, Set<StreamClient>>();
const taskAbortControllers = new Map<string, AbortController>();
let transientLogId = -1;

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

async function appendPipelineLog(
  db: D1Database,
  taskId: string,
  entry: {
    level?: 'info' | 'success' | 'warning' | 'error';
    stepNumber?: number;
    stepName?: string;
    episodeNumber?: number;
    message: string;
    detail?: string;
  },
): Promise<PipelineLogRecord> {
  const createdAt = new Date().toISOString();
  const result = await db.prepare(
    `INSERT INTO pipeline_logs (task_id, level, step_number, step_name, episode_number, message, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    taskId,
    entry.level || 'info',
    entry.stepNumber ?? null,
    entry.stepName ?? null,
    entry.episodeNumber ?? null,
    entry.message,
    entry.detail ?? null,
    createdAt,
  ).run();

  return {
    id: Number((result as any).meta?.last_row_id || 0),
    task_id: taskId,
    level: entry.level || 'info',
    step_number: entry.stepNumber ?? null,
    step_name: entry.stepName ?? null,
    episode_number: entry.episodeNumber ?? null,
    message: entry.message,
    detail: entry.detail ?? null,
    created_at: createdAt,
  };
}

async function sendToClient(client: StreamClient, event: string, data: unknown): Promise<boolean> {
  if (client.closed) {
    return false;
  }

  try {
    await client.writer.write(
      client.encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
    return true;
  } catch {
    client.closed = true;
    return false;
  }
}

function registerStreamClient(taskId: string, client: StreamClient): void {
  const clients = streamClients.get(taskId) || new Set<StreamClient>();
  clients.add(client);
  streamClients.set(taskId, clients);
}

function unregisterStreamClient(taskId: string, client: StreamClient): void {
  const clients = streamClients.get(taskId);
  if (!clients) {
    return;
  }

  clients.delete(client);

  if (clients.size === 0) {
    streamClients.delete(taskId);
  }
}

async function broadcastEvent(
  taskId: string,
  event: string,
  data: unknown,
  options: { lastLogId?: number; lastEpisodeNumber?: number } = {},
): Promise<void> {
  const clients = streamClients.get(taskId);

  if (!clients?.size) {
    return;
  }

  await Promise.all(
    Array.from(clients).map(async (client) => {
      const sent = await sendToClient(client, event, data);

      if (!sent) {
        unregisterStreamClient(taskId, client);
        return;
      }

      if (typeof options.lastLogId === 'number') {
        client.lastLogId = Math.max(client.lastLogId, options.lastLogId);
      }

      if (typeof options.lastEpisodeNumber === 'number') {
        client.lastEpisodeNumber = Math.max(client.lastEpisodeNumber, options.lastEpisodeNumber);
      }
    })
  );
}

async function broadcastPipelineLog(taskId: string, log: PipelineLogRecord): Promise<void> {
  await broadcastEvent(taskId, log.level === 'error' ? 'error' : 'log', {
    id: log.id,
    taskId: log.task_id,
    level: log.level,
    step: log.step_number,
    stepName: log.step_name,
    episodeNumber: log.episode_number,
    message: log.message,
    detail: log.detail,
    timestamp: log.created_at,
  }, { lastLogId: log.id });
}

async function broadcastTransientLog(taskId: string, entry: PipelineLogEntry): Promise<void> {
  const createdAt = new Date().toISOString();
  const id = transientLogId;
  transientLogId -= 1;

  await broadcastEvent(taskId, entry.level === 'error' ? 'error' : 'log', {
    id,
    taskId,
    level: entry.level || 'info',
    step: entry.stepNumber,
    stepName: entry.stepName,
    episodeNumber: entry.episodeNumber,
    message: entry.message,
    detail: entry.detail,
    timestamp: createdAt,
  });
}

function shouldPersistLiveLog(entry: PipelineLogEntry): boolean {
  return entry.message.startsWith('[AI Input]') || entry.message.startsWith('[AI Output]');
}

function buildProgressPayload(taskId: string, task: any) {
  return {
    taskId,
    status: task.status,
    currentStep: task.current_step,
    totalEpisodes: task.total_episodes,
    completedEpisodes: task.completed_episodes,
    stepName: STEP_NAMES[task.current_step as number] || '',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveTaskAISelection(
  userId: number,
  env: { AI: any; DB: D1Database },
  serviceName = 'cloudflare-ai',
  requestedModel?: string,
): Promise<{ serviceName: string; model: string | null }> {
  const definition = getAIServiceDefinition(serviceName);

  if (!definition) {
    throw new Error('不支持的 AI 渠道');
  }

  if (serviceName !== 'cloudflare-ai') {
    await ensureServiceReadyForGeneration(env.DB, userId, serviceName);
  }

  const snapshot = await getUserAIConfigSnapshot(userId, env, serviceName);
  const resolvedModel = requestedModel?.trim() || snapshot.model || definition.defaultModel || null;

  return {
    serviceName,
    model: resolvedModel,
  };
}

async function resolveWorkflowTemplateForTask(
  db: D1Database,
  userId: number,
  workflowTemplateId?: number,
) {
  await ensureStudioDefaults(db);
  if (workflowTemplateId) {
    const detail = await getWorkflowTemplateDetail(db, workflowTemplateId, userId);
    if (!detail) {
      throw new Error('工作流模板不存在');
    }
    return detail;
  }

  const templates = await listWorkflowTemplates(db, userId) as any[];
  const selected = templates.find((item) => Number(item.user_id) === userId && Number(item.is_default) === 1)
    || templates.find((item) => Number(item.is_system) === 1 && Number(item.is_default) === 1)
    || templates[0];

  if (!selected) {
    throw new Error('未找到可用工作流模板');
  }

  const detail = await getWorkflowTemplateDetail(db, Number(selected.id), userId);
  if (!detail) {
    throw new Error('未找到可用工作流模板');
  }

  return detail;
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

function buildLineDiff(baseContent: string, targetContent: string) {
  const baseLines = baseContent.split('\n');
  const targetLines = targetContent.split('\n');
  const max = Math.max(baseLines.length, targetLines.length);
  const diff: Array<{ type: 'same' | 'added' | 'removed' | 'changed'; baseLine?: string; targetLine?: string; lineNumber: number }> = [];
  for (let i = 0; i < max; i += 1) {
    const baseLine = baseLines[i];
    const targetLine = targetLines[i];
    const type = baseLine === targetLine
      ? 'same'
      : baseLine == null
        ? 'added'
        : targetLine == null
          ? 'removed'
          : 'changed';
    diff.push({ type, baseLine, targetLine, lineNumber: i + 1 });
  }
  return diff;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const objectValue = item as Record<string, unknown>;
        return [objectValue.name, objectValue.role, objectValue.identity, objectValue.goal, objectValue.conflict]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join('｜')
          .trim();
      }
      return String(item || '').trim();
    })
    .filter(Boolean);

  return normalized.length ? normalized : undefined;
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
      characters_input, scene_input, ai_service, total_episodes, workflow_template_id,
    } = body;

    if (!title || !genre || !script_type) {
      return c.json({ success: false, error: '标题、题材和剧本类型是必填项' }, 400);
    }

    const aiSelection = await resolveTaskAISelection(
      payload.userId,
      c.env,
      ai_service || 'cloudflare-ai',
    );
    const workflowTemplate = await resolveWorkflowTemplateForTask(c.env.DB, Number(payload.userId), workflow_template_id ? Number(workflow_template_id) : undefined);
    const normalizedKeyPoints = normalizeStringArray(key_points);
    const normalizedCharactersInput = normalizeStringArray(characters_input);

    const taskId = generateTaskId();
    const now = new Date().toISOString();

    // 创建任务记录
    await c.env.DB.prepare(`
      INSERT INTO generation_tasks (
        id, user_id, title, genre, script_type, style, target_platform,
        target_duration, character_count, key_points, characters_input,
        scene_input, ai_service, ai_model, workflow_template_id, workflow_snapshot, total_episodes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
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
      normalizedKeyPoints ? JSON.stringify(normalizedKeyPoints) : null,
      normalizedCharactersInput ? JSON.stringify(normalizedCharactersInput) : null,
      scene_input || null,
      aiSelection.serviceName,
      aiSelection.model,
      Number((workflowTemplate as any).id),
      JSON.stringify(workflowTemplate.nodes || []),
      total_episodes || 50,
      now
    ).run();

    // 创建流水线步骤记录
    for (let i = 1; i <= 8; i++) {
      await c.env.DB.prepare(
        'INSERT INTO pipeline_steps (task_id, step_number, step_name, status) VALUES (?, ?, ?, ?)'
      ).bind(taskId, i, STEP_NAMES[i], i === 1 ? 'running' : 'pending').run();
    }

    await appendPipelineLog(c.env.DB, taskId, {
      level: 'info',
      stepNumber: 1,
      stepName: STEP_NAMES[1],
      message: '任务已启动',
      detail: `渠道=${aiSelection.serviceName}，模型=${aiSelection.model || 'default'}`,
    });

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
    if (error instanceof AIServiceAccessError) {
      return c.json({ success: false, error: error.message }, 400);
    }

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
    const taskId = c.req.param('id') || '';

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

    taskAbortControllers.get(taskId)?.abort(new Error('PIPELINE_ABORTED'));

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
    const body = await c.req.json().catch(() => ({}));
    const requestedServiceName = typeof body.ai_service === 'string' ? body.ai_service : undefined;
    const requestedModel = typeof body.ai_model === 'string' ? body.ai_model : undefined;

    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    if (task.status !== 'paused') {
      return c.json({ success: false, error: '只有暂停的任务可以恢复' }, 400);
    }

    const aiSelection = await resolveTaskAISelection(
      payload.userId,
      c.env,
      requestedServiceName || (task.ai_service as string) || 'cloudflare-ai',
      requestedModel || (task.ai_model as string | undefined),
    );

    await c.env.DB.prepare(
      'UPDATE generation_tasks SET status = ?, ai_service = ?, ai_model = ?, updated_at = ? WHERE id = ?'
    ).bind('running', aiSelection.serviceName, aiSelection.model, new Date().toISOString(), taskId).run();

    const resumeLog = await appendPipelineLog(c.env.DB, taskId, {
      level: 'info',
      stepNumber: task.current_step as number,
      stepName: STEP_NAMES[task.current_step as number],
      message: '任务已恢复',
      detail: `渠道=${aiSelection.serviceName}，模型=${aiSelection.model || 'default'}`,
    });
    await broadcastPipelineLog(taskId, resumeLog);

    // 重新启动流水线
    c.executionCtx.waitUntil(
      runPipeline(c, taskId, Number(payload.userId))
    );

    return c.json({
      success: true,
      message: '任务已恢复',
      data: {
        ai_service: aiSelection.serviceName,
        ai_model: aiSelection.model,
      },
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
    const taskId = c.req.param('id') || '';

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
  const taskId = c.req.param('id') || '';
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
    const taskId = c.req.param('id') || '';

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
    const taskId = c.req.param('id') || '';
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
    const taskId = c.req.param('id') || '';
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
    const taskId = c.req.param('id') || '';

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
    const taskId = c.req.param('id') || '';
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

pipelineRoutes.post('/:id/versions/compare', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';
    const body = await c.req.json().catch(() => ({}));
    const baseVersionId = Number(body.baseVersionId || 0);
    const targetVersionId = Number(body.targetVersionId || 0);

    const task = await c.env.DB.prepare('SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?').bind(taskId, payload.userId).first();
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);

    const [baseVersion, targetVersion] = await Promise.all([
      c.env.DB.prepare('SELECT id, version, label, content, created_at FROM script_versions WHERE id = ? AND task_id = ?').bind(baseVersionId, taskId).first<any>(),
      c.env.DB.prepare('SELECT id, version, label, content, created_at FROM script_versions WHERE id = ? AND task_id = ?').bind(targetVersionId, taskId).first<any>(),
    ]);

    if (!baseVersion || !targetVersion) {
      return c.json({ success: false, error: '对比版本不存在' }, 404);
    }

    return c.json({
      success: true,
      data: {
        baseVersion,
        targetVersion,
        diff: buildLineDiff(baseVersion.content || '', targetVersion.content || ''),
      },
    });
  } catch (error) {
    console.error('版本对比错误:', error);
    return c.json({ success: false, error: '版本对比失败' }, 500);
  }
});

pipelineRoutes.get('/:id/editor', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';
    const task = await c.env.DB.prepare('SELECT id, title FROM generation_tasks WHERE id = ? AND user_id = ?').bind(taskId, payload.userId).first<any>();
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);

    const draft = await c.env.DB.prepare('SELECT id, title, content, source_version_id, updated_at FROM script_drafts WHERE task_id = ? AND user_id = ?').bind(taskId, payload.userId).first<any>();
    const latestVersion = await c.env.DB.prepare('SELECT id, version, label, content, created_at FROM script_versions WHERE task_id = ? ORDER BY version DESC LIMIT 1').bind(taskId).first<any>();
    const fallbackContent = latestVersion?.content || await getFullTaskMarkdown(c.env.DB, taskId).catch(() => '');

    return c.json({
      success: true,
      data: {
        draft: draft || null,
        content: draft?.content || fallbackContent,
        title: draft?.title || task.title,
        sourceVersion: latestVersion || null,
      },
    });
  } catch (error) {
    console.error('获取编辑器内容错误:', error);
    return c.json({ success: false, error: '获取编辑器内容失败' }, 500);
  }
});

pipelineRoutes.put('/:id/editor', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';
    const body = await c.req.json();
    const task = await c.env.DB.prepare('SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?').bind(taskId, payload.userId).first();
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);

    const now = new Date().toISOString();
    const existing = await c.env.DB.prepare('SELECT id FROM script_drafts WHERE task_id = ? AND user_id = ?').bind(taskId, payload.userId).first<any>();
    if (existing) {
      await c.env.DB.prepare('UPDATE script_drafts SET title = ?, content = ?, source_version_id = ?, updated_at = ? WHERE id = ?').bind(body.title || null, body.content || '', body.sourceVersionId || null, now, existing.id).run();
    } else {
      await c.env.DB.prepare('INSERT INTO script_drafts (task_id, user_id, title, content, source_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(taskId, payload.userId, body.title || null, body.content || '', body.sourceVersionId || null, now, now).run();
    }
    return c.json({ success: true, message: '草稿已保存' });
  } catch (error) {
    console.error('保存草稿错误:', error);
    return c.json({ success: false, error: '保存草稿失败' }, 500);
  }
});

pipelineRoutes.post('/:id/editor/publish', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';
    const body = await c.req.json().catch(() => ({}));
    const task = await c.env.DB.prepare('SELECT id, title FROM generation_tasks WHERE id = ? AND user_id = ?').bind(taskId, payload.userId).first<any>();
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);

    const draft = await c.env.DB.prepare('SELECT title, content FROM script_drafts WHERE task_id = ? AND user_id = ?').bind(taskId, payload.userId).first<any>();
    const content = body.content || draft?.content;
    if (!content) return c.json({ success: false, error: '没有可发布内容' }, 400);

    const latestVersion = await c.env.DB.prepare('SELECT version FROM script_versions WHERE task_id = ? ORDER BY version DESC LIMIT 1').bind(taskId).first<any>();
    const nextVersion = Number(latestVersion?.version || 0) + 1;
    const label = body.label || `编辑版 ${nextVersion}`;
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare('INSERT INTO script_versions (task_id, version, label, content, change_notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(taskId, nextVersion, label, content, body.changeNotes || '来自剧本编辑器发布', now).run();
    const version = await c.env.DB.prepare('SELECT id, task_id, version, label, content, change_notes, created_at FROM script_versions WHERE id = ?').bind((result as any).meta?.last_row_id).first<any>();
    return c.json({ success: true, message: '已发布为新版本', data: { version } });
  } catch (error) {
    console.error('发布编辑版本错误:', error);
    return c.json({ success: false, error: '发布失败' }, 500);
  }
});

/**
 * POST /api/pipeline/:id/versions
 * 创建任务版本快照
 */
pipelineRoutes.post('/:id/versions', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';
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
 * POST /api/pipeline/:id/versions/:versionId/branch
 * 从历史版本派生新版本
 */
pipelineRoutes.post('/:id/versions/:versionId/branch', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id');
    const versionId = c.req.param('versionId');
    const body = await c.req.json().catch(() => ({}));
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const changeNotes = typeof body.changeNotes === 'string' ? body.changeNotes.trim() : '';

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const sourceVersion = await c.env.DB.prepare(`
      SELECT id, version, label, content, change_notes
      FROM script_versions
      WHERE id = ? AND task_id = ?
    `).bind(versionId, taskId).first();

    if (!sourceVersion) {
      return c.json({ success: false, error: '源版本不存在' }, 404);
    }

    const latestVersion = await c.env.DB.prepare(
      'SELECT version FROM script_versions WHERE task_id = ? ORDER BY version DESC LIMIT 1'
    ).bind(taskId).first();

    const nextVersion = Number(latestVersion?.version || 0) + 1;
    const finalLabel = label || `${sourceVersion.label || `版本 ${sourceVersion.version}`} · 派生版`;
    const finalNotes = [
      `派生自 v${sourceVersion.version}${sourceVersion.label ? `（${sourceVersion.label}）` : ''}`,
      changeNotes,
    ].filter(Boolean).join('\n');

    const result = await c.env.DB.prepare(`
      INSERT INTO script_versions (task_id, version, label, content, change_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      taskId,
      nextVersion,
      finalLabel,
      sourceVersion.content,
      finalNotes || null,
      new Date().toISOString()
    ).run();

    const version = await c.env.DB.prepare(`
      SELECT id, task_id, version, label, content, change_notes, created_at
      FROM script_versions
      WHERE id = ?
    `).bind(result.meta.last_row_id).first();

    return c.json({
      success: true,
      message: '已从历史版本创建派生版本',
      data: { version },
    });
  } catch (error) {
    console.error('派生版本错误:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : '派生版本失败' }, 500);
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
      'SELECT step_number, step_name, status, error_message, current_task_summary, started_at, completed_at FROM pipeline_steps WHERE task_id = ? ORDER BY step_number'
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

pipelineRoutes.get('/:id/logs', jwtAuth, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const taskId = c.req.param('id') || '';

    const task = await c.env.DB.prepare(
      'SELECT id FROM generation_tasks WHERE id = ? AND user_id = ?'
    ).bind(taskId, payload.userId).first();

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    const logs = await c.env.DB.prepare(
      'SELECT id, task_id, level, step_number, step_name, episode_number, message, detail, created_at FROM pipeline_logs WHERE task_id = ? ORDER BY id ASC LIMIT 500'
    ).bind(taskId).all();

    return c.json({
      success: true,
      data: { logs: logs.results || [] },
    });
  } catch (error) {
    console.error('获取流水线日志错误:', error);
    return c.json({ success: false, error: '获取流水线日志失败' }, 500);
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
        current_task_summary: step.current_task_summary,
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
  const abortController = new AbortController();

  taskAbortControllers.get(taskId)?.abort(new Error('PIPELINE_ABORTED'));
  taskAbortControllers.set(taskId, abortController);

  try {
    // 获取任务信息
    const task = await c.env.DB.prepare(
      'SELECT * FROM generation_tasks WHERE id = ?'
    ).bind(taskId).first();

    if (!task) return;

    // 获取AI Provider
    await ensureServiceReadyForGeneration(c.env.DB, userId, task.ai_service as string);

    const provider = await getUserAIProvider(userId, c.env, task.ai_service as string, {
      model: task.ai_model as string | undefined,
    });

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
    const workflowSnapshot = task.workflow_snapshot ? JSON.parse(task.workflow_snapshot as string) : null;
    const orderedWorkflowNodes = (Array.isArray(workflowSnapshot) ? workflowSnapshot : []).filter((node: any) => node.enabled !== false).sort((a: any, b: any) => Number(a.execution_order) - Number(b.execution_order));
    const orderedPhase1 = orderedWorkflowNodes.filter((node: any) => Number(node.step_number) <= 4).map((node: any) => Number(node.step_number));
    const orderedLoop = orderedWorkflowNodes.filter((node: any) => Number(node.step_number) >= 5 && Number(node.step_number) <= 7).map((node: any) => Number(node.step_number));
    const evaluateEnabled = orderedWorkflowNodes.length === 0 || orderedWorkflowNodes.some((node: any) => Number(node.step_number) === 8);

    // 构建上下文
    const buildContext = () => ({
      taskId,
      userId,
      input,
      provider,
      db: c.env.DB,
      totalEpisodes: task.total_episodes as number,
      abortSignal: abortController.signal,
      onStepComplete: async (step: number, name: string, data: any) => {
        stepResults[step] = data;
        const log = await appendPipelineLog(c.env.DB, taskId, {
          level: 'success',
          stepNumber: step,
          stepName: name,
          message: `步骤 ${step} 已完成`,
        });
        await broadcastPipelineLog(taskId, log);
        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET content = ?, status = ?, completed_at = ? WHERE task_id = ? AND step_number = ?'
        ).bind(JSON.stringify(data), 'completed', new Date().toISOString(), taskId, step).run();
        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET status = ?, started_at = ? WHERE task_id = ? AND step_number = ? AND status = ?'
        ).bind('running', new Date().toISOString(), taskId, step + 1, 'pending').run();
        await c.env.DB.prepare(
          'UPDATE generation_tasks SET current_step = ?, updated_at = ? WHERE id = ?'
        ).bind(Math.min(step + 1, 8), new Date().toISOString(), taskId).run();

        const refreshedTask = await c.env.DB.prepare(
          'SELECT status, current_step, total_episodes, completed_episodes FROM generation_tasks WHERE id = ?'
        ).bind(taskId).first();

        if (refreshedTask) {
          await broadcastEvent(taskId, 'progress', buildProgressPayload(taskId, refreshedTask));
        }
      },
      onEpisodeComplete: async (episode: {
        episodeNumber: number;
        total: number;
        title: string;
        contentPreview: string;
      }) => {
        const log = await appendPipelineLog(c.env.DB, taskId, {
          level: 'success',
          stepNumber: 7,
          stepName: 'compose',
          episodeNumber: episode.episodeNumber,
          message: `第${episode.episodeNumber}/${episode.total}集写作完成`,
        });
        await broadcastPipelineLog(taskId, log);
        await broadcastEvent(taskId, 'episode', {
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          contentPreview: episode.contentPreview,
        }, { lastEpisodeNumber: episode.episodeNumber });

        const refreshedTask = await c.env.DB.prepare(
          'SELECT status, current_step, total_episodes, completed_episodes FROM generation_tasks WHERE id = ?'
        ).bind(taskId).first();

        if (refreshedTask) {
          await broadcastEvent(taskId, 'progress', buildProgressPayload(taskId, refreshedTask));
        }
      },
      onLog: async (entry: PipelineLogEntry) => {
        const log = await appendPipelineLog(c.env.DB, taskId, entry);
        await broadcastPipelineLog(taskId, log);
      },
      onLiveLog: async (entry: PipelineLogEntry) => {
        if (shouldPersistLiveLog(entry)) {
          const log = await appendPipelineLog(c.env.DB, taskId, entry);
          await broadcastPipelineLog(taskId, log);
          return;
        }

        await broadcastTransientLog(taskId, entry);
      },
      onError: async (step: number, name: string, error: string) => {
        pendingErrors.push({ step, name, message: error });
        const log = await appendPipelineLog(c.env.DB, taskId, {
          level: 'error',
          stepNumber: step,
          stepName: name,
          message: `步骤 ${step} 执行失败`,
          detail: error,
        });
        await broadcastPipelineLog(taskId, log);
      },
    });

    // Phase 1: 步骤 1-4 (每个步骤独立 try-catch)
    if (currentStep < 4) {
      const context = buildContext();

      const stepExecutorMap: Record<number, () => Promise<any>> = {
        1: () => executeStep1(context),
        2: () => executeStep2(context, stepResults[1]),
        3: () => executeStep3(context, stepResults[1], stepResults[2]),
        4: () => executeStep4(context, stepResults[1], stepResults[3]),
      };

      for (const num of (orderedPhase1.length ? orderedPhase1 : [1, 2, 3, 4])) {
        const fn = stepExecutorMap[num];
        if (!fn) continue;
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
          if (errMsg === 'PIPELINE_ABORTED') {
            return;
          }
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
      await executePipelinePhase2(context2, stepResults[1], stepResults[2], stepResults[4], orderedLoop.length ? orderedLoop : [5, 6, 7]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === 'PIPELINE_ABORTED') {
        return;
      }
      console.error(`[${taskId}] Phase 2 失败:`, errMsg);
      pendingErrors.push({ step: 5, name: 'scenes/dialogue/compose', message: errMsg });
    }

    // Phase 3: 步骤 8（评分）
    if (evaluateEnabled) {
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
        if (errMsg === 'PIPELINE_ABORTED') {
          return;
        }
        console.error(`[${taskId}] Step 8 评分失败:`, errMsg);
        pendingErrors.push({ step: 8, name: 'evaluate', message: errMsg });
        await c.env.DB.prepare(
          'UPDATE pipeline_steps SET status = ?, error_message = ? WHERE task_id = ? AND step_number = ?'
        ).bind('failed', errMsg, taskId, 8).run();
      }
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
  } finally {
    const activeController = taskAbortControllers.get(taskId);
    if (activeController === abortController) {
      taskAbortControllers.delete(taskId);
    }
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
  const client: StreamClient = {
    writer,
    encoder,
    closed: false,
    lastLogId: 0,
    lastEpisodeNumber: 0,
  };

  registerStreamClient(taskId, client);

  const closeClient = async () => {
    if (client.closed) {
      unregisterStreamClient(taskId, client);
      return;
    }

    client.closed = true;
    unregisterStreamClient(taskId, client);

    try {
      await writer.close();
    } catch {}
  };

  const task = await c.env.DB.prepare(
    'SELECT * FROM generation_tasks WHERE id = ?'
  ).bind(taskId).first();

  if (task) {
    client.lastEpisodeNumber = Number(task.completed_episodes || 0);

    const latestLog = await c.env.DB.prepare(
      'SELECT id FROM pipeline_logs WHERE task_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(taskId).first() as { id?: number } | null;

    client.lastLogId = Number(latestLog?.id || 0);

    await sendToClient(client, 'status', {
      taskId,
      status: task.status,
      currentStep: task.current_step,
      totalEpisodes: task.total_episodes,
      completedEpisodes: task.completed_episodes,
    });
  }
  try {
    const startedAt = Date.now();

    while (!client.closed && Date.now() - startedAt < 60 * 60 * 1000) {
      const currentTask = await c.env.DB.prepare(
        'SELECT * FROM generation_tasks WHERE id = ?'
      ).bind(taskId).first();

      if (!currentTask) {
        await sendToClient(client, 'error', { message: '任务不存在' });
        break;
      }

      await sendToClient(client, 'progress', buildProgressPayload(taskId, currentTask));

      const newLogs = await c.env.DB.prepare(
        'SELECT id, task_id, level, step_number, step_name, episode_number, message, detail, created_at FROM pipeline_logs WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT 100'
      ).bind(taskId, client.lastLogId).all();

      if (newLogs.results?.length) {
        for (const log of newLogs.results as PipelineLogRecord[]) {
          const sent = await sendToClient(client, log.level === 'error' ? 'error' : 'log', {
            id: log.id,
            taskId: log.task_id,
            level: log.level,
            step: log.step_number,
            stepName: log.step_name,
            episodeNumber: log.episode_number,
            message: log.message,
            detail: log.detail,
            timestamp: log.created_at,
          });

          if (!sent) {
            break;
          }

          client.lastLogId = Math.max(client.lastLogId, log.id);
        }
      }

      if (currentTask.error_message) {
        await sendToClient(client, 'error', {
          step: 0,
          stepName: 'task',
          message: currentTask.error_message,
          timestamp: new Date().toISOString(),
        });
      }

      if (currentTask.status === 'completed' || currentTask.status === 'failed') {
        await sendToClient(client, 'done', {
          status: currentTask.status,
          message: currentTask.status === 'completed' ? '生成完成' : '生成失败',
        });
        break;
      }

      await sleep(5000);
    }
  } catch (error) {
    console.error('SSE推送错误:', error);
  } finally {
    await closeClient();
  }
}
