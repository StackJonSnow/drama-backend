/**
 * 流水线编排器 (Pipeline Orchestrator)
 * 管理8步剧本生成流水线，支持中断/续传
 */

import type { AIProvider, AIRequestLog } from './ai-provider';
import {
  storyOutlinePrompt,
  characterGenerationPrompt,
  plotStructurePrompt,
  episodePlanningPrompt,
  sceneGenerationPrompt,
  dialogueGenerationPrompt,
  scriptCompositionPrompt,
  evaluationPrompt,
  type PromptPackage,
  type PromptTemplateOverride,
  type TaskInput,
} from './prompts';
import { getEffectivePromptTemplate } from './studio';

export interface PipelineContext {
  taskId: string;
  userId: number;
  input: TaskInput;
  provider: AIProvider;
  db: D1Database;
  totalEpisodes: number;
  abortSignal?: AbortSignal;
  onStepComplete?: (step: number, name: string, data: any) => Promise<void>;
  onEpisodeComplete?: (episode: {
    episodeNumber: number;
    total: number;
    title: string;
    contentPreview: string;
  }) => Promise<void>;
  onLog?: (entry: PipelineLogEntry) => Promise<void> | void;
  onLiveLog?: (entry: PipelineLogEntry) => Promise<void> | void;
  onError?: (step: number, stepName: string, error: string) => Promise<void>;
}

export interface PipelineLogEntry {
  level?: 'info' | 'success' | 'warning' | 'error';
  stepNumber?: number;
  stepName?: string;
  episodeNumber?: number;
  message: string;
  detail?: string;
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
  options: {
    jsonMode?: boolean;
    timeoutMs?: number;
    maxTokensOverride?: number;
    temperatureOverride?: number;
    stepNumber: number;
    stepName: string;
    episodeNumber?: number;
  }
): Promise<any> {
  const jsonMode = options.jsonMode ?? true;
  const timeoutMs = options.timeoutMs ?? 120000;

  const resolveMaxTokens = (stepNumber: number, compressed: boolean, plainText: boolean): number => {
    if (compressed) {
      return plainText ? 4500 : 2400;
    }

    switch (stepNumber) {
      case 1:
        return 2200;
      case 2:
        return 2200;
      case 3:
        return 2200;
      case 4:
        return 2600;
      case 5:
        return 1800;
      case 6:
        return 1800;
      case 7:
        return 3200;
      case 8:
        return 1200;
      default:
        return plainText ? 4500 : 2600;
    }
  };

  const runAttempt = async (attempt: number, compressed: boolean, currentSystem: string, currentUser: string): Promise<any> => {
    const messages = [
      { role: 'system' as const, content: currentSystem },
      { role: 'user' as const, content: currentUser },
    ];

    const startedAt = Date.now();
    const activeModel = provider.model || 'default';
    const maxTokens = options.maxTokensOverride || resolveMaxTokens(options.stepNumber, compressed, !jsonMode);
    const abortController = new AbortController();

    const onAbort = () => {
      abortController.abort(new Error('PIPELINE_ABORTED'));
    };

    context.abortSignal?.addEventListener('abort', onAbort, { once: true });

    let streamedOutput = '';
    let streamedSinceLastEmit = '';
    let lastStreamEmitAt = Date.now();

    const emitStreamChunk = async (force = false) => {
      if (!streamedSinceLastEmit) return;
      const now = Date.now();
      if (!force && streamedSinceLastEmit.length < 160 && now - lastStreamEmitAt < 1200) {
        return;
      }

      await context.onLiveLog?.({
        level: 'info',
        stepNumber: options.stepNumber,
        stepName: options.stepName,
        episodeNumber: options.episodeNumber,
        message: `[AI Output Stream] ${provider.name}/${activeModel}`,
        detail: streamedSinceLastEmit,
      });
      streamedSinceLastEmit = '';
      lastStreamEmitAt = now;
    };

    await context.onLog?.({
      level: 'info',
      stepNumber: options.stepNumber,
      stepName: options.stepName,
      episodeNumber: options.episodeNumber,
      message: `[AI] 请求 ${provider.name}/${activeModel} · 尝试 ${attempt}${compressed ? '（压缩上下文）' : ''}`,
      detail: `model=${activeModel}, system=${currentSystem.length} chars, user=${currentUser.length} chars, jsonMode=${jsonMode}, maxTokens=${maxTokens}`,
    });

    await context.onLiveLog?.({
      level: 'info',
      stepNumber: options.stepNumber,
      stepName: options.stepName,
      episodeNumber: options.episodeNumber,
      message: `[AI Input] ${provider.name}/${activeModel} · 尝试 ${attempt}${compressed ? '（压缩上下文）' : ''}`,
      detail: `[System]\n${currentSystem}\n\n[User]\n${currentUser}`,
    });

    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    try {
      heartbeatTimer = setInterval(() => {
        void context.onLiveLog?.({
          level: 'info',
          stepNumber: options.stepNumber,
          stepName: options.stepName,
          episodeNumber: options.episodeNumber,
          message: `[AI] ${provider.name}/${activeModel} 仍在响应中`,
          detail: `模型=${activeModel}，已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒`,
        });
      }, 15000);

      const aiPromise = provider.chat(messages, {
        maxTokens,
        temperature: options.temperatureOverride ?? 0.7,
        jsonMode,
        signal: abortController.signal,
        onChunk: async (chunk) => {
          streamedOutput += chunk;
          streamedSinceLastEmit += chunk;
          await emitStreamChunk();
        },
        onRequestLog: async (log: AIRequestLog) => {
          if (log.type === 'request') {
            await context.onLiveLog?.({
              level: 'info',
              stepNumber: options.stepNumber,
              stepName: options.stepName,
              episodeNumber: options.episodeNumber,
              message: `[HTTP Request] ${log.method} ${log.url}`,
              detail: [
                `[URL] ${log.url}`,
                log.headers ? `[Headers]\n${JSON.stringify(log.headers, null, 2)}` : '',
                `[Body]\n${log.body}`,
              ].filter(Boolean).join('\n\n'),
            });
          } else if (log.type === 'response') {
            await context.onLiveLog?.({
              level: 'success',
              stepNumber: options.stepNumber,
              stepName: options.stepName,
              episodeNumber: options.episodeNumber,
              message: `[HTTP Response] status=${log.statusCode || 'OK'}`,
              detail: `[Raw Response]\n${log.rawResponse}`,
            });
          } else if (log.type === 'stream_chunk') {
            await context.onLiveLog?.({
              level: 'info',
              stepNumber: options.stepNumber,
              stepName: options.stepName,
              episodeNumber: options.episodeNumber,
              message: `[Stream Chunk] ${provider.name}/${activeModel}`,
              detail: log.rawResponse,
            });
          } else if (log.type === 'stream_done') {
            await context.onLiveLog?.({
              level: 'success',
              stepNumber: options.stepNumber,
              stepName: options.stepName,
              episodeNumber: options.episodeNumber,
              message: `[Stream Done] ${provider.name}/${activeModel}`,
              detail: log.rawResponse,
            });
          } else if (log.type === 'error') {
            await context.onLiveLog?.({
              level: 'error',
              stepNumber: options.stepNumber,
              stepName: options.stepName,
              episodeNumber: options.episodeNumber,
              message: `[HTTP Error] status=${log.statusCode}`,
              detail: `[Error] ${log.error}\n\n[Raw Response]\n${log.rawResponse}`,
            });
          }
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          abortController.abort(new Error(`AI调用超时 (${timeoutMs / 1000}秒)`));
          reject(new Error(`AI调用超时 (${timeoutMs / 1000}秒)`));
        }, timeoutMs);
        context.abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          abortController.abort(new Error('PIPELINE_ABORTED'));
          reject(new Error('PIPELINE_ABORTED'));
        }, { once: true });
      });

      const response = await Promise.race([aiPromise, timeoutPromise]);
      await emitStreamChunk(true);
      const elapsedMs = Date.now() - startedAt;
      const usage = response.usage
        ? `tokens=${response.usage.totalTokens} (prompt=${response.usage.promptTokens}, completion=${response.usage.completionTokens})`
        : 'tokens=unknown';
      const finalContent = response.content || streamedOutput;
      const preview = finalContent.substring(0, 280).replace(/\n/g, ' ');

      await context.onLog?.({
        level: 'success',
        stepNumber: options.stepNumber,
        stepName: options.stepName,
        episodeNumber: options.episodeNumber,
        message: `[AI] 响应成功 · ${finalContent.length} chars · ${usage} · 耗时${elapsedMs}ms`,
        detail: preview,
      });

      await context.onLiveLog?.({
        level: 'success',
        stepNumber: options.stepNumber,
        stepName: options.stepName,
        episodeNumber: options.episodeNumber,
        message: `[AI Output] ${provider.name}/${activeModel}`,
        detail: `[Meta]\n耗时: ${elapsedMs}ms\n${usage}\n\n[Content]\n${finalContent}`,
      });

      if (jsonMode) {
        try {
          return parseJsonResponse(finalContent);
        } catch (parseErr) {
          await context.onLog?.({
            level: 'warning',
            stepNumber: options.stepNumber,
            stepName: options.stepName,
            episodeNumber: options.episodeNumber,
            message: '[AI] JSON解析失败，尝试提取可恢复片段',
            detail: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
          const extracted = extractJson(finalContent);
          if (extracted) return extracted;
          throw parseErr;
        }
      }

      return finalContent;
    } catch (error) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage === 'PIPELINE_ABORTED') {
        throw error;
      }

      const elapsedMs = Date.now() - startedAt;
      await context.onLog?.({
        level: 'error',
        stepNumber: options.stepNumber,
        stepName: options.stepName,
        episodeNumber: options.episodeNumber,
        message: `[AI] 调用失败 · 尝试 ${attempt}`,
        detail: `${errorMessage} · 已等待${elapsedMs}ms`,
      });

      const normalized = errorMessage.toLowerCase();
      const shouldRetry = attempt < 2 && (
        normalized.includes('context')
        || normalized.includes('token')
        || normalized.includes('too long')
        || normalized.includes('maximum')
        || normalized.includes('rate limit')
        || normalized.includes('timeout')
        || normalized.includes('overloaded')
        || normalized.includes('502')
        || normalized.includes('503')
        || normalized.includes('504')
      );

      if (!shouldRetry) {
        throw error;
      }

      const compressedSystem = compressPrompt(currentSystem, 3000, 'system');
      const compressedUser = compressPrompt(currentUser, 12000, 'user');

      await context.onLog?.({
        level: 'warning',
        stepNumber: options.stepNumber,
        stepName: options.stepName,
        episodeNumber: options.episodeNumber,
        message: '[AI] 检测到模型调用失败或上下文过长，已压缩上下文后自动重试',
        detail: `system=${compressedSystem.length} chars, user=${compressedUser.length} chars`,
      });

      return runAttempt(attempt + 1, true, compressedSystem, compressedUser);
    } finally {
      context.abortSignal?.removeEventListener('abort', onAbort);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  };

  return runAttempt(1, false, systemMsg, userMsg);
}

function compressPrompt(content: string, maxLength: number, label: string): string {
  if (content.length <= maxLength) return content;

  const headLength = Math.floor(maxLength * 0.65);
  const tailLength = Math.max(0, maxLength - headLength - 120);

  return [
    content.slice(0, headLength),
    '',
    `[${label} context compressed: removed ${content.length - headLength - tailLength} chars for retry]`,
    '',
    content.slice(content.length - tailLength),
  ].join('\n');
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
  await context.onLog?.({
    level: 'error',
    stepNumber,
    stepName,
    message: `[Step ${stepNumber}] 错误`,
    detail: errorMessage,
  });

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

async function persistCurrentTaskSummary(
  context: PipelineContext,
  prompt: PromptPackage,
  stepNumber: number,
  stepName: string,
  episodeNumber?: number,
): Promise<void> {
  await context.db.prepare(
    'UPDATE pipeline_steps SET current_task_summary = ? WHERE task_id = ? AND step_number = ?'
  ).bind(prompt.currentTaskSummary, context.taskId, stepNumber).run();

  await context.onLog?.({
    level: 'info',
    stepNumber,
    stepName,
    episodeNumber,
    message: '[Current Task Summary]',
    detail: prompt.currentTaskSummary,
  });
}

async function getPromptOverride(context: PipelineContext, nodeKey: string): Promise<PromptTemplateOverride | undefined> {
  const template = await getEffectivePromptTemplate(context.db, context.userId, nodeKey);
  if (!template) return undefined;
  return {
    system_prompt: template.system_prompt,
    task_instruction: template.task_instruction,
    extra_rules: template.extra_rules,
    model_config: template.model_config,
  };
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
  await context.onLog?.({ level: 'info', stepNumber: 1, stepName: 'story_outline', message: '[Step 1] 生成故事大纲' });
  const override = await getPromptOverride(context, 'story_outline');
  const prompt = storyOutlinePrompt(context.input, override);
  await persistCurrentTaskSummary(context, prompt, 1, 'story_outline');
  const result = await callAI(context.provider, prompt.system, prompt.user, context, { stepNumber: 1, stepName: 'story_outline', maxTokensOverride: override?.model_config?.maxTokens, temperatureOverride: override?.model_config?.temperature });
  await context.onStepComplete?.(1, 'story_outline', result);
  return result;
}

/**
 * Step 2: 生成角色设定
 */
export async function executeStep2(context: PipelineContext, storyOutline: any): Promise<any> {
  checkAbort(context);
  await context.onLog?.({ level: 'info', stepNumber: 2, stepName: 'characters', message: '[Step 2] 生成角色设定' });
  const override = await getPromptOverride(context, 'characters');
  const prompt = characterGenerationPrompt(context.input, storyOutline, override);
  await persistCurrentTaskSummary(context, prompt, 2, 'characters');
  const result = await callAI(context.provider, prompt.system, prompt.user, context, { stepNumber: 2, stepName: 'characters', maxTokensOverride: override?.model_config?.maxTokens, temperatureOverride: override?.model_config?.temperature });
  await context.onStepComplete?.(2, 'characters', result);
  return result;
}

/**
 * Step 3: 生成剧情结构
 */
export async function executeStep3(context: PipelineContext, storyOutline: any, characters: any): Promise<any> {
  checkAbort(context);
  await context.onLog?.({ level: 'info', stepNumber: 3, stepName: 'plot_structure', message: '[Step 3] 生成剧情结构' });
  const override = await getPromptOverride(context, 'plot_structure');
  const prompt = plotStructurePrompt(context.input, storyOutline, characters, override);
  await persistCurrentTaskSummary(context, prompt, 3, 'plot_structure');
  const result = await callAI(context.provider, prompt.system, prompt.user, context, { stepNumber: 3, stepName: 'plot_structure', maxTokensOverride: override?.model_config?.maxTokens, temperatureOverride: override?.model_config?.temperature });
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
  await context.onLog?.({ level: 'info', stepNumber: 4, stepName: 'episode_plan', message: '[Step 4] 生成集数拆分计划' });
  const override = await getPromptOverride(context, 'episode_plan');
  const prompt = episodePlanningPrompt(context.input, storyOutline, plotStructure, context.totalEpisodes, override);
  await persistCurrentTaskSummary(context, prompt, 4, 'episode_plan');
  const result = await callAI(context.provider, prompt.system, prompt.user, context, { stepNumber: 4, stepName: 'episode_plan', maxTokensOverride: override?.model_config?.maxTokens, temperatureOverride: override?.model_config?.temperature });
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
  episodePlan: any,
  loopStepOrder: number[] = [5, 6, 7],
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
      await context.onLog?.({
        level: 'info',
        stepNumber: 5,
        stepName: 'scenes',
        episodeNumber: episode.episodeNumber,
        message: `[Step 5-7] 第${episode.episodeNumber}集已完成，跳过`,
      });
      completedEpisodes.push(episode);
      continue;
    }

    await context.onLog?.({
      level: 'info',
      stepNumber: 5,
      stepName: 'scenes',
      episodeNumber: episode.episodeNumber,
      message: `[Step 5-7] 开始生成第${episode.episodeNumber}集 / 共${episodes.length}集`,
    });

    let scenes: any = { scenes: [] };
    let dialogues: any = { dialogues: [] };
    let content = '';

    for (const stepNumber of loopStepOrder) {
      checkAbort(context);

      await context.db.prepare(
        'UPDATE generation_tasks SET current_step = ?, updated_at = ? WHERE id = ?'
      ).bind(stepNumber, new Date().toISOString(), context.taskId).run();
      await context.db.prepare(
        `UPDATE pipeline_steps
         SET status = CASE WHEN step_number = ? THEN 'running' ELSE status END,
             started_at = CASE WHEN step_number = ? THEN ? ELSE started_at END
         WHERE task_id = ? AND step_number IN (5,6,7)`
      ).bind(stepNumber, stepNumber, new Date().toISOString(), context.taskId).run();

      if (stepNumber === 5) {
        const sceneOverride = await getPromptOverride(context, 'scenes');
        const scenePrompt = sceneGenerationPrompt(
          context.input, storyOutline, characters, episode, completedEpisodes.slice(-3), sceneOverride
        );
        await persistCurrentTaskSummary(context, scenePrompt, 5, 'scenes', episode.episodeNumber);
        scenes = await callAI(context.provider, scenePrompt.system, scenePrompt.user, context, {
          stepNumber: 5,
          stepName: 'scenes',
          episodeNumber: episode.episodeNumber,
          maxTokensOverride: sceneOverride?.model_config?.maxTokens,
          temperatureOverride: sceneOverride?.model_config?.temperature,
        });
      }

      if (stepNumber === 6) {
        const dialogueOverride = await getPromptOverride(context, 'dialogue');
        const dialoguePrompt = dialogueGenerationPrompt(
          context.input, characters, episode, scenes.scenes || [], dialogueOverride
        );
        await persistCurrentTaskSummary(context, dialoguePrompt, 6, 'dialogue', episode.episodeNumber);
        dialogues = await callAI(context.provider, dialoguePrompt.system, dialoguePrompt.user, context, {
          stepNumber: 6,
          stepName: 'dialogue',
          episodeNumber: episode.episodeNumber,
          maxTokensOverride: dialogueOverride?.model_config?.maxTokens,
          temperatureOverride: dialogueOverride?.model_config?.temperature,
        });
      }

      if (stepNumber === 7) {
        const composeOverride = await getPromptOverride(context, 'compose');
        const composePrompt = scriptCompositionPrompt(
          episode, scenes.scenes || [], dialogues.dialogues || [], composeOverride
        );
        await persistCurrentTaskSummary(context, composePrompt, 7, 'compose', episode.episodeNumber);
        content = await callAI(
          context.provider,
          composePrompt.system,
          composePrompt.user,
          context,
          {
            jsonMode: false,
            stepNumber: 7,
            stepName: 'compose',
            episodeNumber: episode.episodeNumber,
            maxTokensOverride: composeOverride?.model_config?.maxTokens,
            temperatureOverride: composeOverride?.model_config?.temperature,
          }
        );
      }
    }

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
    await context.onLog?.({
      level: 'success',
      stepNumber: 7,
      stepName: 'compose',
      episodeNumber: episode.episodeNumber,
      message: `[Step 7] 第${episode.episodeNumber}集已完成并写入数据库`,
      detail: `内容长度 ${content.length} chars`,
    });
    await context.onEpisodeComplete?.({
      episodeNumber: episode.episodeNumber,
      total: episodes.length,
      title: episode.title,
      contentPreview: content.substring(0, 200),
    });
  }

  await context.db.prepare(
    'UPDATE pipeline_steps SET status = ?, completed_at = ? WHERE task_id = ? AND step_number IN (5,6,7)'
  ).bind('completed', new Date().toISOString(), context.taskId).run();
}

/**
 * Step 8: 剧本评分
 */
export async function executeStep8(context: PipelineContext, storyOutline: any): Promise<any> {
  checkAbort(context);
  await context.onLog?.({ level: 'info', stepNumber: 8, stepName: 'evaluate', message: '[Step 8] 剧本评分' });

  // 获取第一集内容作为样本
  const sampleEpisode = await context.db.prepare(
    'SELECT content FROM episodes WHERE task_id = ? ORDER BY episode_number LIMIT 1'
  ).bind(context.taskId).first();

  if (!sampleEpisode) {
    await context.onLog?.({ level: 'warning', stepNumber: 8, stepName: 'evaluate', message: '[Step 8] 跳过评分（无已完成的集数）' });
    return null;
  }

  const override = await getPromptOverride(context, 'evaluate');
  const prompt = evaluationPrompt(context.input, storyOutline, sampleEpisode.content as string, override);
  await persistCurrentTaskSummary(context, prompt, 8, 'evaluate');
  const result = await callAI(context.provider, prompt.system, prompt.user, context, { stepNumber: 8, stepName: 'evaluate', maxTokensOverride: override?.model_config?.maxTokens, temperatureOverride: override?.model_config?.temperature });
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
  episodePlan: any,
  loopStepOrder: number[] = [5, 6, 7],
): Promise<void> {
  await executeStep5To7(context, storyOutline, characters, episodePlan, loopStepOrder);
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
