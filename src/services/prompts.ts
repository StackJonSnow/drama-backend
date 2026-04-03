/**
 * 8-step Pipeline Prompt Templates - Enterprise Grade
 */

export interface TaskInput {
  title: string;
  genre: string;
  scriptType: string;
  style?: string;
  targetPlatform?: string;
  targetDuration?: number;
  characterCount?: number;
  keyPoints?: string[];
  charactersInput?: string[];
  sceneInput?: string;
  totalEpisodes?: number;
}

export interface PromptPackage {
  system: string;
  user: string;
  currentTaskSummary: string;
}

const GENRE_MAP: Record<string, string> = {
  'sci-fi': '科幻', 'romance': '爱情', 'action': '动作',
  'comedy': '喜剧', 'drama': '剧情', 'horror': '恐怖',
  'thriller': '悬疑', 'fantasy': '奇幻', 'historical': '历史',
  'documentary': '纪实',
};

const TYPE_MAP: Record<string, string> = {
  'movie': '电影', 'tv': '电视剧', 'short-video': '短视频',
  'commercial': '广告', 'novel': '小说',
};

function genreLabel(g: string): string { return GENRE_MAP[g] || g; }
function typeLabel(t: string): string { return TYPE_MAP[t] || t; }

function squeezeText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string'
    ? value
    : value == null
      ? ''
      : JSON.stringify(value);

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function joinNonEmpty(values: Array<string | undefined | null>, separator = '；'): string {
  return values.map((value) => (value || '').trim()).filter(Boolean).join(separator);
}

function buildCurrentTaskSummary(sections: {
  globalSummary?: string;
  phaseSummary?: string;
  recentNodeSummary?: string;
  mustInherit?: string;
}): string {
  const candidates = [
    sections.globalSummary ? `全局摘要｜${squeezeText(sections.globalSummary, 180)}` : '',
    sections.phaseSummary ? `阶段摘要｜${squeezeText(sections.phaseSummary, 180)}` : '',
    sections.recentNodeSummary ? `最近节点摘要｜${squeezeText(sections.recentNodeSummary, 120)}` : '',
    sections.mustInherit ? `必须继承｜${squeezeText(sections.mustInherit, 180)}` : '',
  ].filter(Boolean);

  return squeezeText(candidates.join('\n'), 560);
}

function buildTaskDrivenUserPrompt(options: {
  taskInstruction: string;
  currentTaskSummary: string;
  outputFormat: string;
  extraRules?: string[];
}) {
  return [
    '【任务】',
    '在生成当前内容前，先基于已有摘要构建“当前任务摘要”，再基于该摘要生成结果。以下内容已完成筛选与压缩。',
    '',
    '【必须遵守规则】',
    '1. 只能基于“当前任务摘要”完成本次任务，不得回溯原始历史内容',
    '2. 必须严格遵守“必须继承”中的人物状态、目标、冲突和关键约束',
    '3. 若信息不足，只能在不违背摘要和继承信息的前提下补全',
    ...(options.extraRules || []).map((rule, index) => `${index + 4}. ${rule}`),
    '',
    '[当前任务摘要]',
    options.currentTaskSummary,
    '',
    '[生成任务]',
    options.taskInstruction,
    '',
    '[输出格式（严格JSON）]',
    options.outputFormat,
  ].join('\n');
}

function summarizeCharacters(characters: any): string {
  if (!characters) return '';

  const protagonist = characters.protagonist
    ? `主角:${joinNonEmpty([
      characters.protagonist.name,
      characters.protagonist.goal,
      characters.protagonist.flaw,
      characters.protagonist.arc,
    ], '｜')}`
    : '';

  const supporting = Array.isArray(characters.characters)
    ? characters.characters.slice(0, 6).map((character: any) => joinNonEmpty([
      character.name,
      character.role,
      character.goal,
      character.relationship,
    ], '｜')).join('；')
    : '';

  const relationships = Array.isArray(characters.relationships)
    ? characters.relationships.slice(0, 5).map((rel: any) => joinNonEmpty([
      `${rel.character1}-${rel.character2}`,
      rel.type,
      rel.tension,
    ], '｜')).join('；')
    : '';

  return joinNonEmpty([
    protagonist,
    supporting ? `关键角色:${supporting}` : '',
    relationships ? `关系张力:${relationships}` : '',
  ], '\n');
}

function summarizePlotStructure(plotStructure: any): string {
  if (!plotStructure) return '';

  const actSummary = ['act1', 'act2', 'act3'].map((actKey) => {
    const scenes = Array.isArray(plotStructure?.[actKey]?.scenes) ? plotStructure[actKey].scenes.slice(0, 3) : [];
    if (!scenes.length) return '';
    return `${actKey}:${scenes.map((scene: any) => joinNonEmpty([
      `#${scene.sceneNumber}`,
      scene.name,
      scene.purpose,
      scene.conflict,
    ], '｜')).join('；')}`;
  }).filter(Boolean).join('\n');

  const turningPoints = Array.isArray(plotStructure.turningPoints)
    ? plotStructure.turningPoints.slice(0, 5).map((point: any) => joinNonEmpty([
      `场景${point.sceneNumber}`,
      point.description,
    ], '｜')).join('；')
    : '';

  return joinNonEmpty([
    actSummary,
    turningPoints ? `转折点:${turningPoints}` : '',
  ], '\n');
}

function summarizeScenes(scenes: any[]): string {
  return (Array.isArray(scenes) ? scenes : []).slice(0, 6).map((scene: any) => joinNonEmpty([
    `场景${scene.sceneNumber}`,
    scene.location,
    scene.timeOfDay,
    scene.conflict,
    scene.purpose,
  ], '｜')).join('；');
}

function summarizeDialogues(dialogues: any[]): string {
  return (Array.isArray(dialogues) ? dialogues : []).slice(0, 6).map((dialogue: any) => {
    const firstLine = Array.isArray(dialogue.lines) && dialogue.lines.length > 0
      ? `${dialogue.lines[0].character}:${squeezeText(dialogue.lines[0].line, 24)}`
      : '';
    return joinNonEmpty([`场景${dialogue.sceneNumber}`, firstLine], '｜');
  }).join('；');
}

// ============================================
// Step 1: Story Outline
// ============================================
export function storyOutlinePrompt(input: TaskInput): PromptPackage {
  const genre = genreLabel(input.genre);
  const type = typeLabel(input.scriptType);
  const totalEps = input.totalEpisodes || 50;

  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: joinNonEmpty([
      `项目:${input.title}`,
      `题材:${genre}`,
      `形式:${type}`,
      `总集数:${totalEps}`,
      input.style ? `风格:${input.style}` : '',
      input.targetPlatform ? `平台:${input.targetPlatform}` : '',
    ], '｜'),
    phaseSummary: joinNonEmpty([
      input.keyPoints?.length ? `关键情节点:${input.keyPoints.join('；')}` : '',
      input.sceneInput ? `场景基底:${input.sceneInput}` : '',
    ], '\n'),
    mustInherit: joinNonEmpty([
      input.charactersInput?.length ? `指定角色:${input.charactersInput.join('；')}` : '',
      '必须产出完整三幕式、主题、核心冲突与世界观',
    ], '\n'),
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位拥有20年从业经验的资深编剧和故事策划，曾参与多部院线电影和长篇电视剧的创作。',
      '你的专长是构建具有商业价值和艺术深度的故事框架。',
      '',
      '核心原则：',
      '1. 故事必须有明确的主题表达和价值主张',
      '2. 三幕式结构必须遵循经典比例（25%-50%-25%）',
      '3. 核心冲突必须具有多层性和递进性',
      '4. 每一幕必须有清晰的转折点和情感高潮',
      '',
      '输出要求：仅输出JSON，不输出任何解释性文字。JSON必须可被标准解析器直接解析。',
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: '请基于当前任务摘要，创作完整故事大纲，确保主题、核心冲突、世界观与三幕式结构清晰闭环。',
      currentTaskSummary,
      outputFormat: JSON.stringify({
        title: '项目标题',
        logline: '一句话概括（30字以内，包含主角、目标、冲突）',
        synopsis: '故事梗概（300-500字，包含起承转合）',
        theme: '核心主题（如：牺牲与救赎、自由与责任）',
        coreConflict: '核心矛盾（一句话描述主要对立力量）',
        worldSetting: '世界观设定（时代背景、社会环境、特殊规则）',
        tone: '整体基调（如：紧张写实、温暖治愈、冷峻悬疑）',
        targetAudience: '目标受众画像',
        threeActs: {
          act1: { name: '第一幕：建置', description: '世界建立、人物出场、激励事件', keyEvents: ['事件1', '事件2', '转折点事件'] },
          act2: { name: '第二幕：对抗', description: '冲突升级、考验深化、中点反转', keyEvents: ['事件1', '事件2', '中点反转', '事件3', '最低谷'] },
          act3: { name: '第三幕：结局', description: '高潮对决、主题升华、最终落幕', keyEvents: ['最终对决', '主题呼应', '结局'] },
        },
      }, null, 2),
      extraRules: ['优先保留用户指定角色与关键情节点，不要发散到无关支线'],
    }),
  };
}

// ============================================
// Step 2: Character Generation
// ============================================
export function characterGenerationPrompt(input: TaskInput, storyOutline: any): PromptPackage {
  const charCount = input.characterCount || 6;
  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: joinNonEmpty([
      `标题:${storyOutline.title}`,
      `主题:${storyOutline.theme}`,
      `核心冲突:${storyOutline.coreConflict}`,
      `世界观:${storyOutline.worldSetting}`,
    ], '\n'),
    phaseSummary: joinNonEmpty([
      `梗概:${storyOutline.synopsis}`,
      storyOutline.logline ? `一句话概括:${storyOutline.logline}` : '',
    ], '\n'),
    mustInherit: joinNonEmpty([
      input.charactersInput?.length ? `用户指定角色:${input.charactersInput.join('；')}` : '',
      `角色数量:恰好${charCount}个主要角色`,
      '不得改变主角目标、主题与核心冲突',
    ], '\n'),
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位专业的角色设计师和心理学家，擅长创造立体、有深度、有弧线的角色。',
      '你设计的角色必须：',
      '1. 每个角色有明确的内在动机和外在目标',
      '2. 角色之间存在有机的关系网络和戏剧张力',
      '3. 配角必须服务于主线剧情，各有独特功能',
      '4. 反派必须有自洽的逻辑和令人同情的动机',
      '',
      '输出要求：仅输出JSON，不输出任何解释性文字。',
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: '请基于当前任务摘要，设计恰好指定数量的主要角色，重点保持人物目标、关系张力、功能分工和反派动机自洽。',
      currentTaskSummary,
      outputFormat: JSON.stringify({
        protagonist: {
          name: '姓名', age: '年龄', gender: '性别',
          appearance: '外貌特征（50字）',
          personality: '性格标签+具体表现（100字）',
          background: '成长经历（100字）',
          goal: '核心目标', flaw: '致命弱点',
          arc: '角色弧线变化（从A状态到B状态）',
        },
        characters: [{
          name: '姓名', role: '角色功能（盟友/对手/导师/催化剂等）',
          age: '年龄', personality: '性格', background: '背景',
          goal: '目标', relationship: '与主角的关系',
          dramaticFunction: '在剧情中的功能',
        }],
        relationships: [{
          character1: '角色A', character2: '角色B',
          type: '关系类型', description: '关系描述',
          tension: '潜在冲突点', evolution: '关系变化轨迹',
        }],
      }, null, 2),
      extraRules: ['优先保留人物状态、目标、冲突与关键设定，不要复述无关世界观细节'],
    }),
  };
}

// ============================================
// Step 3: Plot Structure
// ============================================
export function plotStructurePrompt(input: TaskInput, storyOutline: any, characters: any): PromptPackage {
  const act1Scenes = 5;
  const act2Scenes = 10;
  const act3Scenes = 5;

  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: joinNonEmpty([
      `标题:${storyOutline.title}`,
      `核心冲突:${storyOutline.coreConflict}`,
      `主题:${storyOutline.theme}`,
    ], '\n'),
    phaseSummary: joinNonEmpty([
      `故事梗概:${storyOutline.synopsis}`,
      summarizeCharacters(characters),
    ], '\n'),
    mustInherit: joinNonEmpty([
      '必须围绕主角目标、角色关系与冲突递进设计因果链',
      `场景总量控制:约${act1Scenes + act2Scenes + act3Scenes}场`,
    ], '\n'),
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位资深编剧行业的结构专家，精通好莱坞三幕式叙事结构。',
      '你设计的剧情结构必须：',
      '1. 每个场景有明确的叙事功能',
      '2. 场景之间有因果链连接',
      '3. 冲突层层递进，张弛有度',
      '',
      '输出要求：仅输出JSON，不要输出超过20个场景。',
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: `请生成高层级剧情结构：第一幕约${act1Scenes}场、第二幕约${act2Scenes}场、第三幕约${act3Scenes}场，确保场景之间有清晰因果链和转折。`,
      currentTaskSummary,
      outputFormat: JSON.stringify({
        act1: { scenes: [{ sceneNumber: 1, name: '场景名', location: '地点', time: '时间', characters: ['角色名'], description: '场景描述（80字）', purpose: '叙事功能', emotion: '情绪基调', conflict: '冲突点' }] },
        act2: { scenes: '同上格式，约10个' },
        act3: { scenes: '同上格式，约5个' },
        totalScenes: 20,
        turningPoints: [{ sceneNumber: 5, description: '转折点描述' }],
      }, null, 2),
    }),
  };
}

// ============================================
// Step 4: Episode Planning
// ============================================
export function episodePlanningPrompt(input: TaskInput, storyOutline: any, plotStructure: any, totalEpisodes: number): PromptPackage {
  const act1End = Math.floor(totalEpisodes * 0.2);
  const act2End = Math.floor(totalEpisodes * 0.75);

  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: joinNonEmpty([
      `标题:${storyOutline.title}`,
      `梗概:${storyOutline.synopsis}`,
      `主题:${storyOutline.theme}`,
    ], '\n'),
    phaseSummary: summarizePlotStructure(plotStructure),
    mustInherit: joinNonEmpty([
      `总集数:恰好${totalEpisodes}集`,
      `幕结构:1-${act1End}集 / ${act1End + 1}-${act2End}集 / ${act2End + 1}-${totalEpisodes}集`,
      '每集必须有独立冲突、小高潮和结尾悬念',
    ], '\n'),
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位经验丰富的电视剧总编剧，擅长将长篇叙事拆分为引人入胜的分集结构。',
      '你的分集策略必须：',
      '1. 每集有独立的小冲突和小高潮',
      '2. 每集结尾必须有悬念或转折，驱动观众看下一集',
      '3. 集与集之间有剧情连贯性，但也有节奏变化',
      '4. 关键情节点必须落在特定集数上形成大高潮',
      '',
      `输出要求：仅输出JSON，episodes数组必须恰好包含 ${totalEpisodes} 项。`,
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: `请把故事拆分为恰好${totalEpisodes}集的分集计划，并明确每集摘要、关键事件、节奏和 cliffhanger。`,
      currentTaskSummary,
      outputFormat: JSON.stringify({
        episodes: [{
          episodeNumber: 1, title: '集标题',
          act: 'first_act | second_act | third_act',
          summary: '本集摘要（100-150字）',
          keyEvents: ['核心事件1', '核心事件2'],
          cliffhanger: '结尾悬念（驱动观众看下一集）',
          emotionalTone: '情绪基调',
          pacing: 'slow-build | steady | accelerating | climax',
        }],
        majorCliffhangers: [{ episodeNumber: 5, description: '关键悬念' }],
      }, null, 2),
    }),
  };
}

// ============================================
// Step 5: Scene Generation
// ============================================
export function sceneGenerationPrompt(input: TaskInput, storyOutline: any, characters: any, episode: any, previousEpisodes: any[]): PromptPackage {
  const prevSummary = previousEpisodes.length > 0
    ? previousEpisodes.slice(-2).map(e => `第${e.episode_number}集:${joinNonEmpty([e.title, e.summary], '｜')}`).join('；')
    : '第一集，无前情';

  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: joinNonEmpty([
      `标题:${storyOutline.title}`,
      `主题:${storyOutline.theme}`,
      `核心冲突:${storyOutline.coreConflict}`,
      `主角:${characters?.protagonist?.name || ''}｜${characters?.protagonist?.goal || ''}`,
    ], '\n'),
    phaseSummary: joinNonEmpty([
      `本集:${joinNonEmpty([`第${episode.episodeNumber}集`, episode.title, episode.summary], '｜')}`,
      `关键事件:${episode.key_events || (Array.isArray(episode.keyEvents) ? episode.keyEvents.join('；') : '')}`,
      `结尾悬念:${episode.cliffhanger}`,
    ], '\n'),
    recentNodeSummary: `前情:${prevSummary}`,
    mustInherit: joinNonEmpty([
      summarizeCharacters(characters),
      '场景必须服务本集推进，保持角色状态与关系连续',
    ], '\n'),
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位专业的场景编剧，擅长设计紧凑、有张力、有视觉冲击力的场景。',
      '每个场景必须有明确的进入点和退出点，包含至少一个戏剧冲突，动作描写具体可拍摄。',
      '',
      '输出要求：仅输出JSON。',
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: `请为第${episode.episodeNumber}集生成4-6个可拍摄场景，突出进入点、退出点、冲突和叙事目的。`,
      currentTaskSummary,
      outputFormat: JSON.stringify({
        scenes: [{
          sceneNumber: 1, intOrExt: 'INT | EXT',
          location: '具体地点', timeOfDay: '白天/黄昏/夜晚',
          characters: ['出场角色'],
          action: '场景动作描写（150-200字，具体、可拍摄）',
          emotion: '情绪基调', conflict: '核心冲突',
          purpose: '叙事目的',
        }],
      }, null, 2),
    }),
  };
}

// ============================================
// Step 6: Dialogue Generation
// ============================================
export function dialogueGenerationPrompt(input: TaskInput, characters: any, episode: any, scenes: any[]): PromptPackage {
  const charProfiles = [
    `【主角】${characters.protagonist.name}：${characters.protagonist.personality}。说话风格：${inferSpeechStyle(characters.protagonist.personality)}`,
    ...characters.characters.map((c: any) => `【${c.role}】${c.name}：${c.personality}。说话风格：${inferSpeechStyle(c.personality)}`),
  ].join('\n');

  const sceneDescs = scenes.map((s: any) =>
    `场景${s.sceneNumber}: ${s.intOrExt}. ${s.location} - ${s.timeOfDay}\n  情绪：${s.emotion} | 冲突：${s.conflict}\n  动作：${s.action}`
  ).join('\n\n');

  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: summarizeCharacters(characters),
    phaseSummary: joinNonEmpty([
      `本集:${joinNonEmpty([`第${episode.episodeNumber}集`, episode.title, episode.summary], '｜')}`,
      `场景摘要:${summarizeScenes(scenes)}`,
    ], '\n'),
    mustInherit: joinNonEmpty([
      '对白必须符合角色语言风格，不能直接说教或解释剧情',
      charProfiles,
    ], '\n'),
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位顶级对白编剧，精通"潜台词"和"冰山理论"。',
      '对白必须：符合角色语言习惯、表面与真实意图有张力、节奏有变化、用对话推动剧情。',
      '避免"说明书式"对话（角色不会直接说出内心想法）。',
      '',
      '输出要求：仅输出JSON。',
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: [
        `请为第${episode.episodeNumber}集的各场景生成对白。`,
        '每个场景4-6轮对话，每句不超过40字，包含动作/表情提示，并为下一场景或集尾悬念铺垫。',
        `场景列表参考：${sceneDescs}`,
      ].join('\n'),
      currentTaskSummary,
      outputFormat: JSON.stringify({
        dialogues: [{
          sceneNumber: 1,
          lines: [
            { character: '角色名', line: '对白内容', action: '动作提示（可选）' },
          ],
        }],
      }, null, 2),
    }),
  };
}

// ============================================
// Step 7: Script Composition
// ============================================
export function scriptCompositionPrompt(episode: any, scenes: any[], dialogues: any[]): PromptPackage {
  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: `本集定位:${joinNonEmpty([`第${episode.episodeNumber}集`, episode.title, episode.summary], '｜')}`,
    phaseSummary: joinNonEmpty([
      `场景摘要:${summarizeScenes(scenes)}`,
      `对白摘要:${summarizeDialogues(dialogues)}`,
    ], '\n'),
    mustInherit: '必须保留场景顺序、角色发言归属、动作信息，并使用标准 Markdown 剧本格式输出。',
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位专业的剧本排版师，熟悉国际标准剧本格式和Markdown排版规范。',
      '使用标准剧本格式（INT./EXT.、角色名居中大写、对白缩进），Markdown语法实现格式化。',
      '仅输出排版好的剧本内容，不输出任何解释。',
    ].join('\n'),

    user: [
      '【任务】',
      '在生成当前内容前，先基于已有摘要构建“当前任务摘要”，再基于该摘要完成剧本合成。以下内容已完成筛选与压缩。',
      '',
      '[当前任务摘要]',
      currentTaskSummary,
      '',
      '[必须继承信息]',
      `完整场景数据：${JSON.stringify(scenes, null, 2)}`,
      '',
      `完整对白数据：${JSON.stringify(dialogues, null, 2)}`,
      '',
      '[生成任务]',
      '请基于当前任务摘要和必须继承信息，输出排版好的 Markdown 剧本。不得改动场景顺序、角色归属和核心动作。',
      '',
      '[输出格式]',
      '```markdown',
      `# 第${episode.episodeNumber}集：${episode.title}`,
      '',
      `> ${episode.summary}`,
      '',
      '---',
      '',
      '## 场景 1',
      '',
      '**INT. 地点 - 夜晚**',
      '',
      '*[场景动作描写]*',
      '',
      '**角色A**',
      '> 对白内容',
      '',
      '*[动作提示]*',
      '',
      '**角色B**',
      '> 对白内容',
      '',
      '---',
      '```',
    ].join('\n'),
  };
}

// ============================================
// Step 8: Evaluation
// ============================================
export function evaluationPrompt(input: TaskInput, storyOutline: any, episodeContent: string): PromptPackage {
  const currentTaskSummary = buildCurrentTaskSummary({
    globalSummary: joinNonEmpty([
      `标题:${storyOutline.title}`,
      `题材:${genreLabel(input.genre)}`,
      `主题:${storyOutline.theme}`,
      `核心冲突:${storyOutline.coreConflict}`,
    ], '\n'),
    phaseSummary: `评审样本:${squeezeText(episodeContent, 220)}`,
    mustInherit: '评分必须严格基于样本内容与项目主题，不得臆造未出现情节。',
  });

  return {
    currentTaskSummary,
    system: [
      '你是一位资深剧本评审专家，曾担任多个影视奖项的评委。',
      '评分标准：1-3差 | 4-5及格 | 6-7良好 | 8-9优秀 | 10卓越',
      '',
      '输出要求：仅输出JSON，评分必须是1-10的整数。',
    ].join('\n'),

    user: buildTaskDrivenUserPrompt({
      taskInstruction: '请基于当前任务摘要对样本剧本做结构化评分，给出分项评价、优点和建议。',
      currentTaskSummary,
      outputFormat: JSON.stringify({
        plot: { score: 8, comment: '剧情结构评价（50字）' },
        dialogue: { score: 7, comment: '对白质量评价（50字）' },
        character: { score: 8, comment: '角色塑造评价（50字）' },
        pacing: { score: 7, comment: '节奏控制评价（50字）' },
        creativity: { score: 6, comment: '创意价值评价（50字）' },
        overall: 7.2,
        strengths: ['优点1', '优点2'],
        suggestions: ['优化建议1', '优化建议2'],
      }, null, 2),
    }),
  };
}

function inferSpeechStyle(personality: string): string {
  if (personality.includes('幽默') || personality.includes('开朗')) return '轻松活泼，常用比喻和玩笑';
  if (personality.includes('严肃') || personality.includes('冷')) return '简洁克制，少用修饰语';
  if (personality.includes('温柔') || personality.includes('善良')) return '温和委婉，多用商量语气';
  if (personality.includes('强势') || personality.includes('果断')) return '直接有力，少废话';
  if (personality.includes('狡猾') || personality.includes('深沉')) return '话中有话，善于试探';
  return '自然口语化';
}
