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

// ============================================
// Step 1: Story Outline
// ============================================
export function storyOutlinePrompt(input: TaskInput) {
  const genre = genreLabel(input.genre);
  const type = typeLabel(input.scriptType);
  const totalEps = input.totalEpisodes || 50;

  return {
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

    user: [
      `## 项目信息`,
      `- 项目名称：${input.title}`,
      `- 题材类型：${genre}`,
      `- 内容形式：${type}`,
      `- 总集数：${totalEps}集`,
      `- 风格定位：${input.style || '未指定，根据题材自行判断'}`,
      `- 目标平台：${input.targetPlatform || '未指定'}`,
      `- 用户关键情节点：${input.keyPoints?.length ? input.keyPoints.join('；') : '无'}`,
      `- 场景描述：${input.sceneInput || '由你创意发挥'}`,
      '',
      '## 任务',
      '请基于以上信息，创作一个完整的故事大纲。',
      '',
      '## 输出格式（严格JSON）',
      JSON.stringify({
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
    ].join('\n'),
  };
}

// ============================================
// Step 2: Character Generation
// ============================================
export function characterGenerationPrompt(input: TaskInput, storyOutline: any) {
  const charCount = input.characterCount || 6;

  return {
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

    user: [
      `## 故事背景`,
      `标题：${storyOutline.title}`,
      `梗概：${storyOutline.synopsis}`,
      `主题：${storyOutline.theme}`,
      `核心冲突：${storyOutline.coreConflict}`,
      `世界观：${storyOutline.worldSetting}`,
      '',
      `## 用户指定角色`,
      input.charactersInput?.length ? input.charactersInput.join('；') : '无，请根据故事需要自由创作',
      '',
      `## 角色数量要求：恰好 ${charCount} 个主要角色`,
      '',
      '## 输出格式（严格JSON）',
      JSON.stringify({
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
    ].join('\n'),
  };
}

// ============================================
// Step 3: Plot Structure
// ============================================
export function plotStructurePrompt(input: TaskInput, storyOutline: any, characters: any) {
  const totalEps = input.totalEpisodes || 50;
  const totalScenes = totalEps * 4;

  return {
    system: [
      '你是一位资深编剧行业的结构专家，精通好莱坞三幕式、英雄之旅、序列编剧法等多种叙事结构。',
      '你设计的剧情结构必须：',
      '1. 每个场景有明确的叙事功能（推进剧情、揭示信息、塑造角色）',
      '2. 场景之间有因果链连接，非松散拼接',
      '3. 冲突必须层层递进，张弛有度',
      '4. 伏笔与呼应必须有清晰的对应关系',
      '',
      '输出要求：仅输出JSON。',
    ].join('\n'),

    user: [
      `## 故事信息`,
      `标题：${storyOutline.title}`,
      `三幕结构：${storyOutline.threeActs.act1.name} → ${storyOutline.threeActs.act2.name} → ${storyOutline.threeActs.act3.name}`,
      '',
      `## 角色信息`,
      `主角：${characters.protagonist.name}（${characters.protagonist.personality}）`,
      `配角：${characters.characters.map((c: any) => `${c.name}(${c.role})`).join('、')}`,
      '',
      `## 场景数量：约 ${totalScenes} 个`,
      `- 第一幕：约 ${Math.floor(totalScenes * 0.2)} 个`,
      `- 第二幕：约 ${Math.floor(totalScenes * 0.55)} 个`,
      `- 第三幕：约 ${Math.floor(totalScenes * 0.25)} 个`,
      '',
      '## 输出格式（严格JSON）',
      JSON.stringify({
        act1: { scenes: [{ sceneNumber: 1, name: '场景名', location: '地点', time: '时间', characters: ['角色名'], description: '场景描述（80字）', purpose: '叙事功能', emotion: '情绪基调', conflict: '冲突点', turningPoint: false }] },
        act2: { scenes: '同上格式' },
        act3: { scenes: '同上格式' },
        totalScenes: '总数',
        turningPoints: [{ sceneNumber: 1, description: '转折点描述' }],
      }, null, 2),
    ].join('\n'),
  };
}

// ============================================
// Step 4: Episode Planning
// ============================================
export function episodePlanningPrompt(input: TaskInput, storyOutline: any, plotStructure: any, totalEpisodes: number) {
  const act1End = Math.floor(totalEpisodes * 0.2);
  const act2End = Math.floor(totalEpisodes * 0.75);

  return {
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

    user: [
      `## 故事信息`,
      `标题：${storyOutline.title}`,
      `梗概：${storyOutline.synopsis}`,
      '',
      `## 剧情结构概览`,
      `总场景数：${plotStructure.totalScenes}`,
      '',
      `## 集数分配（共${totalEpisodes}集）`,
      `- 第一幕：第1-${act1End}集`,
      `- 第二幕：第${act1End + 1}-${act2End}集`,
      `- 第三幕：第${act2End + 1}-${totalEpisodes}集`,
      '',
      `## 输出格式（严格JSON，episodes必须恰好${totalEpisodes}项）`,
      JSON.stringify({
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
    ].join('\n'),
  };
}

// ============================================
// Step 5: Scene Generation
// ============================================
export function sceneGenerationPrompt(input: TaskInput, storyOutline: any, characters: any, episode: any, previousEpisodes: any[]) {
  const prevSummary = previousEpisodes.length > 0
    ? previousEpisodes.slice(-2).map(e => `第${e.episode_number}集「${e.title}」: ${e.summary}`).join('\n')
    : '这是第一集，无前情。';

  return {
    system: [
      '你是一位专业的场景编剧，擅长设计紧凑、有张力、有视觉冲击力的场景。',
      '每个场景必须有明确的进入点和退出点，包含至少一个戏剧冲突，动作描写具体可拍摄。',
      '',
      '输出要求：仅输出JSON。',
    ].join('\n'),

    user: [
      `## 第${episode.episodeNumber}集：${episode.title}`,
      `摘要：${episode.summary}`,
      `核心事件：${episode.key_events || (Array.isArray(episode.keyEvents) ? episode.keyEvents.join('；') : '')}`,
      `结尾悬念：${episode.cliffhanger}`,
      '',
      `## 前情提要`,
      prevSummary,
      '',
      `## 角色库`,
      `主角：${characters.protagonist.name}（${characters.protagonist.personality}）`,
      characters.characters.map((c: any) => `${c.name}（${c.role}：${c.personality}）`).join('\n'),
      '',
      `## 请生成4-6个场景`,
      '## 输出格式（严格JSON）',
      JSON.stringify({
        scenes: [{
          sceneNumber: 1, intOrExt: 'INT | EXT',
          location: '具体地点', timeOfDay: '白天/黄昏/夜晚',
          characters: ['出场角色'],
          action: '场景动作描写（150-200字，具体、可拍摄）',
          emotion: '情绪基调', conflict: '核心冲突',
          purpose: '叙事目的',
        }],
      }, null, 2),
    ].join('\n'),
  };
}

// ============================================
// Step 6: Dialogue Generation
// ============================================
export function dialogueGenerationPrompt(input: TaskInput, characters: any, episode: any, scenes: any[]) {
  const charProfiles = [
    `【主角】${characters.protagonist.name}：${characters.protagonist.personality}。说话风格：${inferSpeechStyle(characters.protagonist.personality)}`,
    ...characters.characters.map((c: any) => `【${c.role}】${c.name}：${c.personality}。说话风格：${inferSpeechStyle(c.personality)}`),
  ].join('\n');

  const sceneDescs = scenes.map((s: any) =>
    `场景${s.sceneNumber}: ${s.intOrExt}. ${s.location} - ${s.timeOfDay}\n  情绪：${s.emotion} | 冲突：${s.conflict}\n  动作：${s.action}`
  ).join('\n\n');

  return {
    system: [
      '你是一位顶级对白编剧，精通"潜台词"和"冰山理论"。',
      '对白必须：符合角色语言习惯、表面与真实意图有张力、节奏有变化、用对话推动剧情。',
      '避免"说明书式"对话（角色不会直接说出内心想法）。',
      '',
      '输出要求：仅输出JSON。',
    ].join('\n'),

    user: [
      `## 第${episode.episodeNumber}集：${episode.title}`,
      '',
      `## 角色语言档案`,
      charProfiles,
      '',
      `## 场景列表`,
      sceneDescs,
      '',
      `## 对白要求`,
      '- 每个场景4-6轮对话，每句不超过40字',
      '- 包含动作/表情提示（方括号内）',
      '- 结尾为下一场景或集尾悬念做铺垫',
      '',
      '## 输出格式（严格JSON）',
      JSON.stringify({
        dialogues: [{
          sceneNumber: 1,
          lines: [
            { character: '角色名', line: '对白内容', action: '动作提示（可选）' },
          ],
        }],
      }, null, 2),
    ].join('\n'),
  };
}

// ============================================
// Step 7: Script Composition
// ============================================
export function scriptCompositionPrompt(episode: any, scenes: any[], dialogues: any[]) {
  return {
    system: [
      '你是一位专业的剧本排版师，熟悉国际标准剧本格式和Markdown排版规范。',
      '使用标准剧本格式（INT./EXT.、角色名居中大写、对白缩进），Markdown语法实现格式化。',
      '仅输出排版好的剧本内容，不输出任何解释。',
    ].join('\n'),

    user: [
      `# 第${episode.episodeNumber}集：${episode.title}`,
      '',
      `> ${episode.summary}`,
      '',
      `## 场景数据`,
      JSON.stringify(scenes, null, 2),
      '',
      `## 对白数据`,
      JSON.stringify(dialogues, null, 2),
      '',
      `## 输出格式`,
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
export function evaluationPrompt(input: TaskInput, storyOutline: any, episodeContent: string) {
  return {
    system: [
      '你是一位资深剧本评审专家，曾担任多个影视奖项的评委。',
      '评分标准：1-3差 | 4-5及格 | 6-7良好 | 8-9优秀 | 10卓越',
      '',
      '输出要求：仅输出JSON，评分必须是1-10的整数。',
    ].join('\n'),

    user: [
      `## 项目信息`,
      `标题：${storyOutline.title}`,
      `题材：${genreLabel(input.genre)}`,
      `主题：${storyOutline.theme}`,
      '',
      `## 评审样本（第一集节选）`,
      episodeContent.substring(0, 2000),
      '',
      '## 输出格式（严格JSON）',
      JSON.stringify({
        plot: { score: 8, comment: '剧情结构评价（50字）' },
        dialogue: { score: 7, comment: '对白质量评价（50字）' },
        character: { score: 8, comment: '角色塑造评价（50字）' },
        pacing: { score: 7, comment: '节奏控制评价（50字）' },
        creativity: { score: 6, comment: '创意价值评价（50字）' },
        overall: 7.2,
        strengths: ['优点1', '优点2'],
        suggestions: ['优化建议1', '优化建议2'],
      }, null, 2),
    ].join('\n'),
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
