export type WorkflowNodeDefinition = {
  step_number: number;
  node_key: string;
  display_name: string;
  execution_order: number;
  enabled: boolean;
  metadata: {
    category: string;
    enterpriseNotes: string;
    supportsPauseResume?: boolean;
    promptNodeKey?: string;
  };
};

export type PromptTemplateDefinition = {
  node_key: string;
  name: string;
  description: string;
  system_prompt: string;
  task_instruction: string;
  extra_rules: string[];
  model_config: {
    temperature: number;
    maxTokens: number;
    summaryMode: 'layered-summary';
  };
};

const NOW = () => new Date().toISOString();

export const ENTERPRISE_WORKFLOW_NODES: WorkflowNodeDefinition[] = [
  { step_number: 1, node_key: 'story_outline', display_name: '故事大纲', execution_order: 1, enabled: true, metadata: { category: 'foundation', enterpriseNotes: '建立主题、冲突与三幕式基线', supportsPauseResume: true, promptNodeKey: 'story_outline' } },
  { step_number: 2, node_key: 'characters', display_name: '角色设定', execution_order: 2, enabled: true, metadata: { category: 'foundation', enterpriseNotes: '建立主配角功能与关系张力', supportsPauseResume: true, promptNodeKey: 'characters' } },
  { step_number: 3, node_key: 'plot_structure', display_name: '剧情结构', execution_order: 3, enabled: true, metadata: { category: 'planning', enterpriseNotes: '形成场景级因果结构', supportsPauseResume: true, promptNodeKey: 'plot_structure' } },
  { step_number: 4, node_key: 'episode_plan', display_name: '集数计划', execution_order: 4, enabled: true, metadata: { category: 'planning', enterpriseNotes: '输出分集纲要与大钩子', supportsPauseResume: true, promptNodeKey: 'episode_plan' } },
  { step_number: 5, node_key: 'scenes', display_name: '场景生成', execution_order: 5, enabled: true, metadata: { category: 'episode-loop', enterpriseNotes: '按集输出可拍摄场景', supportsPauseResume: true, promptNodeKey: 'scenes' } },
  { step_number: 6, node_key: 'dialogue', display_name: '对白生成', execution_order: 6, enabled: true, metadata: { category: 'episode-loop', enterpriseNotes: '建立人物语言风格与潜台词', supportsPauseResume: true, promptNodeKey: 'dialogue' } },
  { step_number: 7, node_key: 'compose', display_name: '剧本合成', execution_order: 7, enabled: true, metadata: { category: 'episode-loop', enterpriseNotes: '按标准剧本格式合成 Markdown', supportsPauseResume: true, promptNodeKey: 'compose' } },
  { step_number: 8, node_key: 'evaluate', display_name: '剧本评分', execution_order: 8, enabled: true, metadata: { category: 'quality', enterpriseNotes: '输出多维评分与优化建议', supportsPauseResume: true, promptNodeKey: 'evaluate' } },
];

export const ENTERPRISE_PROMPT_TEMPLATES: PromptTemplateDefinition[] = [
  { node_key: 'story_outline', name: '企业级故事大纲模板', description: '面向长剧项目的主题/冲突/三幕式模板', system_prompt: '你是一位拥有20年从业经验的资深编剧和故事策划，负责输出可进入开发会审的企业级故事大纲。', task_instruction: '基于当前任务摘要，产出具备主题、核心冲突、世界观与三幕式结构的高质量故事大纲。', extra_rules: ['必须保证商业化表达与艺术深度并存', '所有关键情节点都要服务主冲突'], model_config: { temperature: 0.7, maxTokens: 2200, summaryMode: 'layered-summary' } },
  { node_key: 'characters', name: '企业级角色设计模板', description: '强调角色功能、弧线与关系网络', system_prompt: '你是一位剧集开发公司的首席角色设计师，专门为连续剧项目构建具有商业识别度和弧线的角色。', task_instruction: '基于当前任务摘要，设计角色阵容、关系网络与反派动机，确保后续剧情可持续推进。', extra_rules: ['主角、关键配角、反派必须功能清晰', '角色关系要支持长期叙事张力'], model_config: { temperature: 0.55, maxTokens: 2200, summaryMode: 'layered-summary' } },
  { node_key: 'plot_structure', name: '企业级结构设计模板', description: '聚焦因果链与结构稳定性', system_prompt: '你是一位经验丰富的结构统筹编剧，负责将项目设定转化为可执行的剧情结构。', task_instruction: '基于当前任务摘要，输出场景级剧情结构，强调因果关系、转折点与冲突递进。', extra_rules: ['避免无叙事功能的场景', '转折点必须改变人物目标或关系'], model_config: { temperature: 0.55, maxTokens: 2200, summaryMode: 'layered-summary' } },
  { node_key: 'episode_plan', name: '企业级分集规划模板', description: '面向短剧/剧集的分集编排模板', system_prompt: '你是一位资深总编剧，负责把长故事拆分为可生产、可追更的分集计划。', task_instruction: '基于当前任务摘要，为整季/整部作品输出分集规划、节奏安排和关键悬念。', extra_rules: ['每集都要有独立推进和 hook', '确保集间节奏变化'], model_config: { temperature: 0.6, maxTokens: 2400, summaryMode: 'layered-summary' } },
  { node_key: 'scenes', name: '企业级场景生成模板', description: '面向单集场景结构与镜头可拍性', system_prompt: '你是一位专业场景编剧，擅长构建可拍摄、具视觉冲击力且高效推进剧情的场景。', task_instruction: '基于当前任务摘要，生成单集场景列表与动作推进。', extra_rules: ['优先保留人物状态、目标和冲突', '场景必须有进入点与退出点'], model_config: { temperature: 0.6, maxTokens: 1600, summaryMode: 'layered-summary' } },
  { node_key: 'dialogue', name: '企业级对白模板', description: '强调人物语言风格与潜台词', system_prompt: '你是一位顶级对白编剧，擅长用潜台词、节奏和冲突推进叙事。', task_instruction: '基于当前任务摘要，为场景生成符合角色语言习惯的对白。', extra_rules: ['禁止说明书式台词', '对白必须推动人物关系或情节'], model_config: { temperature: 0.6, maxTokens: 1600, summaryMode: 'layered-summary' } },
  { node_key: 'compose', name: '企业级剧本合成模板', description: '标准剧本格式与交付模板', system_prompt: '你是一位专业剧本排版与交付专员，负责生成符合行业标准的剧本成稿。', task_instruction: '基于当前任务摘要和已继承的场景/对白数据，输出标准 Markdown 剧本。', extra_rules: ['不得改动角色归属与场景顺序', '格式必须利于后续编辑与制作'], model_config: { temperature: 0.35, maxTokens: 2800, summaryMode: 'layered-summary' } },
  { node_key: 'evaluate', name: '企业级评估模板', description: '多维评分与开发建议模板', system_prompt: '你是一位剧本开发评审专家，需要给出结构化评分和可执行建议。', task_instruction: '基于当前任务摘要，对剧本样本进行多维评分与建议输出。', extra_rules: ['评分必须可解释', '建议必须具体到结构、人物或对白层面'], model_config: { temperature: 0.25, maxTokens: 1200, summaryMode: 'layered-summary' } },
];

const WORKFLOW_DEPENDENCIES: Record<string, string[]> = {
  story_outline: [],
  characters: ['story_outline'],
  plot_structure: ['story_outline', 'characters'],
  episode_plan: ['story_outline', 'plot_structure'],
  scenes: ['story_outline', 'characters', 'episode_plan'],
  dialogue: ['characters', 'scenes'],
  compose: ['scenes', 'dialogue'],
  evaluate: ['story_outline', 'compose'],
};

export async function ensureStudioDefaults(db: D1Database): Promise<void> {
  const workflowExists = await db.prepare('SELECT id FROM workflow_templates WHERE is_system = 1 LIMIT 1').first();
  if (!workflowExists) {
    const now = NOW();
    const result = await db.prepare(
      'INSERT INTO workflow_templates (user_id, name, description, is_default, is_system, created_at, updated_at) VALUES (NULL, ?, ?, 1, 1, ?, ?)'
    ).bind('企业级线性短剧流水线', '默认企业级生产流水线，支持节点排序、启停与元信息配置。', now, now).run();
    const templateId = Number((result as any).meta?.last_row_id || 0);
    for (const node of ENTERPRISE_WORKFLOW_NODES) {
      await db.prepare(
        'INSERT INTO workflow_nodes (template_id, step_number, node_key, display_name, execution_order, enabled, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(templateId, node.step_number, node.node_key, node.display_name, node.execution_order, node.enabled ? 1 : 0, JSON.stringify(node.metadata), now, now).run();
    }
  }

  const promptExists = await db.prepare('SELECT id FROM prompt_templates WHERE is_system = 1 LIMIT 1').first();
  if (!promptExists) {
    const now = NOW();
    for (const template of ENTERPRISE_PROMPT_TEMPLATES) {
      await db.prepare(
        'INSERT INTO prompt_templates (user_id, node_key, name, description, system_prompt, task_instruction, extra_rules, model_config, is_active, is_system, version, release_tag, published_at, created_at, updated_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, ?)'
      ).bind(template.node_key, template.name, template.description, template.system_prompt, template.task_instruction, JSON.stringify(template.extra_rules), JSON.stringify(template.model_config), 'production', now, now, now).run();
      }
  }
}

export async function listWorkflowTemplates(db: D1Database, userId: number) {
  await ensureStudioDefaults(db);
  const templates = await db.prepare(
    'SELECT id, user_id, name, description, is_default, is_system, created_at, updated_at FROM workflow_templates WHERE user_id IS NULL OR user_id = ? ORDER BY is_system DESC, is_default DESC, updated_at DESC'
  ).bind(userId).all();
  return templates.results || [];
}

export async function getWorkflowTemplateDetail(db: D1Database, templateId: number, userId: number) {
  await ensureStudioDefaults(db);
  const template = await db.prepare(
    'SELECT id, user_id, name, description, is_default, is_system, created_at, updated_at FROM workflow_templates WHERE id = ? AND (user_id IS NULL OR user_id = ?)'
  ).bind(templateId, userId).first();
  if (!template) return null;
  const nodes = await db.prepare(
    'SELECT id, step_number, node_key, display_name, execution_order, enabled, metadata FROM workflow_nodes WHERE template_id = ? ORDER BY execution_order ASC, step_number ASC'
  ).bind(templateId).all();
  return {
    ...template,
    nodes: (nodes.results || []).map((node: any) => ({ ...node, enabled: Boolean(node.enabled), metadata: node.metadata ? JSON.parse(node.metadata) : {} })),
  };
}

export async function listPromptTemplates(db: D1Database, userId: number) {
  await ensureStudioDefaults(db);
  const templates = await db.prepare(
    'SELECT id, user_id, node_key, name, description, system_prompt, task_instruction, extra_rules, model_config, is_active, is_system, version, release_tag, published_at, created_at, updated_at FROM prompt_templates WHERE user_id IS NULL OR user_id = ? ORDER BY node_key ASC, is_system DESC, version DESC, updated_at DESC'
  ).bind(userId).all();
  return (templates.results || []).map((template: any) => ({
    ...template,
    extra_rules: template.extra_rules ? JSON.parse(template.extra_rules) : [],
    model_config: template.model_config ? JSON.parse(template.model_config) : {},
    is_active: Boolean(template.is_active),
    is_system: Boolean(template.is_system),
    release_tag: template.release_tag || 'draft',
  }));
}

export async function getEffectivePromptTemplate(db: D1Database, userId: number, nodeKey: string) {
  await ensureStudioDefaults(db);
  const template = await db.prepare(
    `SELECT id, node_key, name, description, system_prompt, task_instruction, extra_rules, model_config, is_system, version
     FROM prompt_templates
     WHERE node_key = ? AND is_active = 1 AND (user_id = ? OR user_id IS NULL)
     ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, is_system DESC, version DESC
     LIMIT 1`
  ).bind(nodeKey, userId, userId).first<any>();

  if (!template) {
    const fallback = ENTERPRISE_PROMPT_TEMPLATES.find((item) => item.node_key === nodeKey);
    return fallback ? {
      ...fallback,
      extra_rules: fallback.extra_rules,
      model_config: fallback.model_config,
      is_system: true,
      version: 1,
    } : null;
  }

  return {
    ...template,
    extra_rules: template.extra_rules ? JSON.parse(template.extra_rules) : [],
    model_config: template.model_config ? JSON.parse(template.model_config) : {},
    is_system: Boolean(template.is_system),
  };
}

export function validateWorkflowNodes(nodes: Array<Pick<WorkflowNodeDefinition, 'node_key' | 'execution_order' | 'enabled'>>) {
  const enabledNodes = nodes.filter((node) => node.enabled).sort((a, b) => a.execution_order - b.execution_order);
  const order = new Map(enabledNodes.map((node, index) => [node.node_key, index]));
  for (const node of enabledNodes) {
    const deps = WORKFLOW_DEPENDENCIES[node.node_key] || [];
    for (const dep of deps) {
      const depIndex = order.get(dep);
      const nodeIndex = order.get(node.node_key);
      if (depIndex == null || nodeIndex == null || depIndex > nodeIndex) {
        throw new Error(`节点 ${node.node_key} 依赖 ${dep}，执行顺序无效`);
      }
    }
  }
}

export function normalizeWorkflowNodes(nodes: any[]): WorkflowNodeDefinition[] {
  return nodes
    .map((node, index) => ({
      step_number: Number(node.step_number),
      node_key: String(node.node_key),
      display_name: String(node.display_name || node.node_key),
      execution_order: Number(node.execution_order ?? index + 1),
      enabled: node.enabled !== false,
      metadata: typeof node.metadata === 'object' && node.metadata ? node.metadata : {},
    }))
    .sort((a, b) => a.execution_order - b.execution_order);
}
