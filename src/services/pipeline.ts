/**
 * 流水线编排器 (Pipeline Orchestrator)
 * 管理8步剧本生成流水线，支持中断/续传
 */

import type { AIProvider } from './ai-provider';
import {
  storyOutlinePrompt,
  characterGenerationPrompt,
  plotStructurePrompt,
  episodePlanningPrompt,
  sceneGenerationPrompt,
  dialogueGenerationPrompt,
  scriptCompositionPrompt,
  evaluationPrompt,
  type TaskInput,
} from './prompts';

export interface PipelineContext {
  taskId: string;
  userId: number;
  input: TaskInput;
  provider: AIProvider;
  db: D1Database;
  totalEpisodes: number;
  abortSignal?: AbortSignal;
  onStepComplete?: (step: number, name: string, data: any) => Promise<void>;
  onEpisodeComplete?: (episodeNumber: number, total: number) => Promise<void>;
  onLog?: (message: string) => void;
  onError?: (step: number, stepName: string, error: string) => Promise<void>;
}

export type PipelineStepResult = {
  stepNumber: number;
  stepName: string;
  content: any;
};

const STEP_NAMES = [
  '',
  'story_outline',
  'characters',
  'plot_structure',
  'episode_plan',
  'scenes',
  'dialogue',
  'compose',
  'evaluate',
];

/**
 * 解析AI返回的JSON，容错处理
 */
function parseJsonResponse(text: string): any {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {}

  // 尝试提取JSON块
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                     text.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, text];

  const jsonStr = jsonMatch[1] || text;

  // 清理常见问题
  const cleaned = jsonStr
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`无法解析AI返回的JSON: ${(e as Error).message}\n原始内容: ${text.substring(0, 500)}`);
  }
}

/**
 * 执行单个AI调用并解析结果（带超时）
 */
async function callAI(
  provider: AIProvider,
  systemMsg: string,
  userMsg: string,
  context: PipelineContext,
  jsonMode = true,
  timeoutMs = 120000
): Promise<any> {
  const messages = [
    { role: 'system' as const, content: systemMsg },
    { role: 'user' as const, content: userMsg },
  ];

  context.onLog?.(`[AI] 正在调用 ${provider.name}...`);

  const aiPromise = provider.chat(messages, {
    maxTokens: 8192,
    temperature: 0.7,
    jsonMode: jsonMode && provider.name === 'openai',
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AI调用超时 (${timeoutMs / 1000}秒)`));
    }, timeoutMs);
    context.abortSignal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('PIPELINE_ABORTED'));
    }, { once: true });
  });

  const response = await Promise.race([aiPromise, timeoutPromise]);

  const preview = response.content.substring(0, 200).replace(/\n/g, ' ');
  context.onLog?.(`[AI] 收到响应 ${response.content.length}字 | ${preview}...`);

  if (jsonMode) {
    try {
      return parseJsonResponse(response.content);
    } catch (parseErr) {
      context.onLog?.(`[AI] JSON解析失败，尝试截取有效部分...`);
      const extracted = extractJson(response.content);
      if (extracted) return extracted;
      throw parseErr;
    }
  }
  return response.content;
}

function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch {}
  }
  return null;
}

/**
 * 记录步骤错误到数据库并推送给SSE
 */
async function recordStepError(
  context: PipelineContext,
  stepNumber: number,
  stepName: string,
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  context.onLog?.(`[Step ${stepNumber}] 错误: ${errorMessage}`);

  // 更新步骤状态为失败
  try {
    await context.db.prepare(
      'UPDATE pipeline_steps SET status = ?, error_message = ?, completed_at = ? WHERE task_id = ? AND step_number = ?'
    ).bind('failed', errorMessage, new Date().toISOString(), context.taskId, stepNumber).run();
  } catch (dbErr) {
    console.error(`Failed to record step error:`, dbErr);
  }

  // 推送错误事件
  await context.onError?.(stepNumber, stepName, errorMessage);
}

/**
 * 检查是否被中断
 */
function checkAbort(context: PipelineContext): void {
  if (context.abortSignal?.aborted) {
    throw new Error('PIPELINE_ABORTED');
  }
}

// ============================================
// 8步流水线执行器
// ============================================

/**
 * Step 1: 生成故事大纲
 */
export async function executeStep1(context: PipelineContext): Promise<any> {
  context.onLog?.('[Step 1] 生成故事大纲...');
  const prompt = storyOutlinePrompt(context.input);
  const result = await callAI(context.provider, prompt.system, prompt.user, context);
  await context.onStepComplete?.(1, 'story_outline', result);
  return result;
}

/**
 * Step 2: 生成角色设定
 */
export async function executeStep2(context: PipelineContext, storyOutline: any): Promise<any> {
  checkAbort(context);
  context.onLog?.('[Step 2] 生成角色设定...');
  const prompt = characterGenerationPrompt(context.input, storyOutline);
  const result = await callAI(context.provider, prompt.system, prompt.user, context);
  await context.onStepComplete?.(2, 'characters', result);
  return result;
}

/**
 * Step 3: 生成剧情结构
 */
export async function executeStep3(context: PipelineContext, storyOutline: any, characters: any): Promise<any> {
  checkAbort(context);
  context.onLog?.('[Step 3] 生成剧情结构...');
  const prompt = plotStructurePrompt(context.input, storyOutline, characters);
  const result = await callAI(context.provider, prompt.system, prompt.user, context);
  await context.onStepComplete?.(3, 'plot_structure', result);
  return result;
}

/**
 * Step 4: 集数拆分计划
 */
export async function executeStep4(
  context: PipelineContext,
  storyOutline: any,
  plotStructure: any
): Promise<any> {
  checkAbort(context);
  context.onLog?.('[Step 4] 生成集数拆分计划...');
  const prompt = episodePlanningPrompt(context.input, storyOutline, plotStructure, context.totalEpisodes);
  const result = await callAI(context.provider, prompt.system, prompt.user, context);
  await context.onStepComplete?.(4, 'episode_plan', result);
  return result;
}

/**
 * Step 5-7: 逐集生成 (场景 → 对白 → 合成)
 */
export async function executeStep5To7(
  context: PipelineContext,
  storyOutline: any,
  characters: any,
  episodePlan: any
): Promise<void> {
  const episodes = episodePlan.episodes;
  const completedEpisodes: any[] = [];

  // 从DB读取已完成的集数（支持续传）
  const existingEpisodes = await context.db.prepare(
    'SELECT * FROM episodes WHERE task_id = ? AND status = ? ORDER BY episode_number'
  ).bind(context.taskId, 'completed').all();

  const completedNumbers = new Set(
    (existingEpisodes.results || []).map((e: any) => e.episode_number)
  );

  // 标记已完成的集数
  for (const ep of existingEpisodes.results || []) {
    completedEpisodes.push(ep);
  }

  for (const episode of episodes) {
    checkAbort(context);

    // 跳过已完成的集数
    if (completedNumbers.has(episode.episodeNumber)) {
      context.onLog?.(`[Step 5-7] 第${episode.episodeNumber}集已完成，跳过`);
      completedEpisodes.push(episode);
      continue;
    }

    context.onLog?.(`[Step 5-7] 生成第${episode.episodeNumber}集 (${episodes.length}集总量)...`);

    // Step 5: 场景生成
    context.onLog?.(`[Step 5] 第${episode.episodeNumber}集 - 场景生成`);
    const scenePrompt = sceneGenerationPrompt(
      context.input, storyOutline, characters, episode,
      completedEpisodes.slice(-3)
    );
    const scenes = await callAI(context.provider, scenePrompt.system, scenePrompt.user, context);

    checkAbort(context);

    // Step 6: 对白生成
    context.onLog?.(`[Step 6] 第${episode.episodeNumber}集 - 对白生成`);
    const dialoguePrompt = dialogueGenerationPrompt(
      context.input, characters, episode, scenes.scenes || []
    );
    const dialogues = await callAI(context.provider, dialoguePrompt.system, dialoguePrompt.user, context);

    checkAbort(context);

    // Step 7: 剧本合成
    context.onLog?.(`[Step 7] 第${episode.episodeNumber}集 - 剧本合成`);
    const composePrompt = scriptCompositionPrompt(
      episode, scenes.scenes || [], dialogues.dialogues || []
    );
    // 合成步骤不需要JSON模式
    const content = await callAI(
      context.provider,
      composePrompt.system,
      composePrompt.user,
      context,
      false
    );

    // 保存到DB
    await context.db.prepare(`
      INSERT INTO episodes (task_id, episode_number, title, act, summary, scenes, dialogue, content, word_count, status, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `).bind(
      context.taskId,
      episode.episodeNumber,
      episode.title,
      episode.act,
      episode.summary,
      JSON.stringify(scenes.scenes || []),
      JSON.stringify(dialogues.dialogues || []),
      content,
      content.length,
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

    // 更新任务进度
    await context.db.prepare(
      'UPDATE generation_tasks SET completed_episodes = ?, updated_at = ? WHERE id = ?'
    ).bind(episode.episodeNumber, new Date().toISOString(), context.taskId).run();

    completedEpisodes.push(episode);
    await context.onEpisodeComplete?.(episode.episodeNumber, episodes.length);
  }
}

/**
 * Step 8: 剧本评分
 */
export async function executeStep8(context: PipelineContext, storyOutline: any): Promise<any> {
  checkAbort(context);
  context.onLog?.('[Step 8] 剧本评分...');

  // 获取第一集内容作为样本
  const sampleEpisode = await context.db.prepare(
    'SELECT content FROM episodes WHERE task_id = ? ORDER BY episode_number LIMIT 1'
  ).bind(context.taskId).first();

  if (!sampleEpisode) {
    context.onLog?.('[Step 8] 跳过评分（无已完成的集数）');
    return null;
  }

  const prompt = evaluationPrompt(context.input, storyOutline, sampleEpisode.content as string);
  const result = await callAI(context.provider, prompt.system, prompt.user, context);
  await context.onStepComplete?.(8, 'evaluate', result);
  return result;
}

/**
 * 执行完整流水线 (1-4步)
 * 5-7步按集执行，8步最后执行
 */
export async function executePipelinePhase1(context: PipelineContext): Promise<{
  storyOutline: any;
  characters: any;
  plotStructure: any;
  episodePlan: any;
}> {
  // Step 1: 故事大纲
  const storyOutline = await executeStep1(context);

  // Step 2: 角色生成
  const characters = await executeStep2(context, storyOutline);

  // Step 3: 剧情结构
  const plotStructure = await executeStep3(context, storyOutline, characters);

  // Step 4: 集数拆分
  const episodePlan = await executeStep4(context, storyOutline, plotStructure);

  return { storyOutline, characters, plotStructure, episodePlan };
}

/**
 * 执行5-7步（逐集生成）
 */
export async function executePipelinePhase2(
  context: PipelineContext,
  storyOutline: any,
  characters: any,
  episodePlan: any
): Promise<void> {
  await executeStep5To7(context, storyOutline, characters, episodePlan);
}

/**
 * 执行8步（评分）
 */
export async function executePipelinePhase3(
  context: PipelineContext,
  storyOutline: any
): Promise<any> {
  return executeStep8(context, storyOutline);
}

// 导出step名称映射
export { STEP_NAMES };
