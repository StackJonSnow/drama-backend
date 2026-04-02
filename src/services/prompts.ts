/**
 * 8步流水线 Prompt 模板
 * 每个模板要求AI输出结构化JSON
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

// ============================================
// Step 1: 故事大纲生成
// ============================================
export function storyOutlinePrompt(input: TaskInput): { system: string; user: string } {
  return {
    system: `你是一位资深剧本策划，擅长构建有吸引力的故事框架。你必须用中文回复，输出严格的JSON格式。`,
    user: `请根据以下创意输入，生成一个完整的故事大纲。

## 创意输入
- 标题: ${input.title}
- 题材: ${input.genre}
- 剧本类型: ${input.scriptType}
- 风格: ${input.style || '未指定'}
- 目标平台: ${input.targetPlatform || '未指定'}
- 用户提供的关键情节点: ${input.keyPoints?.length ? input.keyPoints.join('; ') : '无'}
- 用户指定场景: ${input.sceneInput || '无'}

## 输出要求
请输出以下JSON结构（不要输出其他内容）：
{
  "title": "故事标题",
  "logline": "一句话概括故事（20字以内）",
  "synopsis": "故事梗概（200-300字）",
  "theme": "主题表达",
  "coreConflict": "核心冲突描述",
  "worldSetting": "世界观设定",
  "tone": "整体基调",
  "threeActs": {
    "act1": {
      "name": "第一幕：建立世界",
      "description": "描述（100字）",
      "keyEvents": ["事件1", "事件2"]
    },
    "act2": {
      "name": "第二幕：冲突升级",
      "description": "描述（100字）",
      "keyEvents": ["事件1", "事件2", "事件3"]
    },
    "act3": {
      "name": "第三幕：高潮与结局",
      "description": "描述（100字）",
      "keyEvents": ["事件1", "事件2"]
    }
  }
}`,
  };
}

// ============================================
// Step 2: 角色生成
// ============================================
export function characterGenerationPrompt(input: TaskInput, storyOutline: any): { system: string; user: string } {
  return {
    system: `你是一位专业角色设计师，擅长创造立体、有深度的角色。你必须用中文回复，输出严格的JSON格式。`,
    user: `请根据以下故事大纲，生成完整的角色设定。

## 故事大纲
标题: ${storyOutline.title}
梗概: ${storyOutline.synopsis}
主题: ${storyOutline.theme}
核心冲突: ${storyOutline.coreConflict}
世界观: ${storyOutline.worldSetting}

## 用户指定的角色
${input.charactersInput?.length ? input.charactersInput.join('; ') : '无，由你自由创作'}

## 角色数量要求
${input.characterCount ? `请生成${input.characterCount}个角色` : '根据故事需要生成5-10个角色'}

## 输出要求
请输出以下JSON结构：
{
  "protagonist": {
    "name": "主角姓名",
    "age": "年龄",
    "gender": "性别",
    "appearance": "外貌描述",
    "personality": "性格特点",
    "background": "背景故事",
    "goal": "核心目标",
    "flaw": "致命缺陷",
    "arc": "角色弧线（从开始到结束的变化）"
  },
  "characters": [
    {
      "name": "角色姓名",
      "role": "角色类型（配角/反派/导师等）",
      "age": "年龄",
      "personality": "性格",
      "background": "背景",
      "goal": "目标",
      "relationship": "与主角的关系"
    }
  ],
  "relationships": [
    {
      "character1": "角色A",
      "character2": "角色B",
      "type": "关系类型",
      "description": "关系描述",
      "tension": "冲突点"
    }
  ]
}`,
  };
}

// ============================================
// Step 3: 剧情结构
// ============================================
export function plotStructurePrompt(input: TaskInput, storyOutline: any, characters: any): { system: string; user: string } {
  return {
    system: `你是一位资深编剧，擅长构建紧凑的剧情结构。你必须用中文回复，输出严格的JSON格式。`,
    user: `请根据故事大纲和角色设定，构建详细的剧情结构。

## 故事大纲
${JSON.stringify(storyOutline, null, 2)}

## 角色设定
主角: ${characters.protagonist.name} - ${characters.protagonist.personality}
配角: ${characters.characters.map((c: any) => `${c.name}(${c.role})`).join(', ')}

## 输出要求
请输出以下JSON结构：
{
  "act1": {
    "scenes": [
      {
        "sceneNumber": 1,
        "name": "场景名称",
        "location": "地点",
        "time": "时间（白天/夜晚）",
        "characters": ["出场角色"],
        "description": "场景描述",
        "purpose": "叙事目的",
        "emotion": "情绪基调",
        "conflict": "冲突点"
      }
    ]
  },
  "act2": {
    "scenes": [
      {
        "sceneNumber": 4,
        "name": "...",
        "location": "...",
        "time": "...",
        "characters": ["..."],
        "description": "...",
        "purpose": "...",
        "emotion": "...",
        "conflict": "..."
      }
    ]
  },
  "act3": {
    "scenes": [
      {
        "sceneNumber": 15,
        "name": "...",
        "location": "...",
        "time": "...",
        "characters": ["..."],
        "description": "...",
        "purpose": "...",
        "emotion": "...",
        "conflict": "..."
      }
    ]
  },
  "totalScenes": 20
}

注意：请生成足够多的场景来支撑${input.totalEpisodes || 50}集的剧情。每幕至少8-15个场景。`,
  };
}

// ============================================
// Step 4: 集数拆分计划
// ============================================
export function episodePlanningPrompt(input: TaskInput, storyOutline: any, plotStructure: any, totalEpisodes: number): { system: string; user: string } {
  return {
    system: `你是一位经验丰富的电视剧编剧，擅长将剧情拆分为多集连贯的剧本。你必须用中文回复，输出严格的JSON格式。`,
    user: `请将以下剧情结构拆分为${totalEpisodes}集的剧本计划。

## 故事大纲
标题: ${storyOutline.title}
三幕结构:
- 第一幕: ${storyOutline.threeActs.act1.description}
- 第二幕: ${storyOutline.threeActs.act2.description}
- 第三幕: ${storyOutline.threeActs.act3.description}

## 剧情结构
总场景数: ${plotStructure.totalScenes}
第一幕场景: ${plotStructure.act1.scenes.length}个
第二幕场景: ${plotStructure.act2.scenes.length}个
第三幕场景: ${plotStructure.act3.scenes.length}个

## 集数分配建议
- 第一幕 (建立世界): 约${Math.floor(totalEpisodes * 0.2)}集
- 第二幕 (冲突升级): 约${Math.floor(totalEpisodes * 0.55)}集
- 第三幕 (高潮与结局): 约${Math.floor(totalEpisodes * 0.25)}集

## 输出要求
请输出以下JSON结构（必须包含恰好${totalEpisodes}集）：
{
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "集标题",
      "act": "first_act",
      "summary": "本集摘要（100字）",
      "keyEvents": ["事件1", "事件2"],
      "cliffhanger": "结尾悬念",
      "scenes": ["涉及的场景编号"]
    }
  ],
  "arcBreakdown": {
    "firstActEpisodes": "1-10集",
    "secondActEpisodes": "11-37集",
    "thirdActEpisodes": "38-50集"
  }
}`,
  };
}

// ============================================
// Step 5: 单集场景生成
// ============================================
export function sceneGenerationPrompt(
  input: TaskInput,
  storyOutline: any,
  characters: any,
  episode: any,
  previousEpisodes: any[]
): { system: string; user: string } {
  const prevSummary = previousEpisodes.length > 0
    ? `## 前情提要\n${previousEpisodes.slice(-3).map(e => `第${e.episode_number}集: ${e.summary}`).join('\n')}`
    : '';

  return {
    system: `你是一位专业编剧，擅长设计有冲突和张力的场景。你必须用中文回复，输出严格的JSON格式。`,
    user: `请为第${episode.episode_number}集生成详细场景。

## 本集信息
标题: ${episode.title}
摘要: ${episode.summary}
关键事件: ${episode.key_events}
${prevSummary}

## 角色信息
主角: ${characters.protagonist.name} - ${characters.protagonist.personality}
可用角色: ${characters.characters.map((c: any) => `${c.name}(${c.role})`).join(', ')}

## 世界观
${storyOutline.worldSetting}

## 输出要求
请为本集生成4-6个场景，输出JSON：
{
  "scenes": [
    {
      "sceneNumber": 1,
      "intOrExt": "INT",
      "location": "具体地点",
      "time": "夜晚",
      "characters": ["出场角色名"],
      "action": "场景中的动作描述（200字）",
      "emotion": "情绪基调",
      "conflict": "场景中的冲突",
      "purpose": "叙事目的"
    }
  ]
}`,
  };
}

// ============================================
// Step 6: 对白生成
// ============================================
export function dialogueGenerationPrompt(
  input: TaskInput,
  characters: any,
  episode: any,
  scenes: any[]
): { system: string; user: string } {
  const charProfiles = [
    `主角 ${characters.protagonist.name}: ${characters.protagonist.personality}`,
    ...characters.characters.map((c: any) => `${c.name}: ${c.personality}`)
  ].join('\n');

  return {
    system: `你是一位顶级对白编剧，擅长写出符合人物性格、推动剧情、自然流畅的对话。你必须用中文回复，输出严格的JSON格式。`,
    user: `请为第${episode.episode_number}集的场景生成对白。

## 角色性格特征
${charProfiles}

## 本集场景
${scenes.map((s: any) => `场景${s.sceneNumber}: ${s.intOrExt}. ${s.location} - ${s.time}\n  动作: ${s.action}\n  冲突: ${s.conflict}`).join('\n\n')}

## 对白要求
1. 对话必须符合每个角色的性格特征
2. 对话要推动剧情发展
3. 语言要自然流畅，避免书面化
4. 包含适当的动作提示
5. 每个场景至少3-5轮对话

## 输出格式
请输出JSON：
{
  "dialogues": [
    {
      "sceneNumber": 1,
      "lines": [
        {
          "character": "角色名",
          "line": "对白内容",
          "action": "动作/表情提示（可选）"
        }
      ]
    }
  ]
}`,
  };
}

// ============================================
// Step 7: 剧本合成 (格式化为Markdown)
// ============================================
export function scriptCompositionPrompt(
  episode: any,
  scenes: any[],
  dialogues: any[]
): { system: string; user: string } {
  return {
    system: `你是一位专业剧本排版师，擅长将场景和对白合成为标准剧本格式。你必须用中文回复，输出标准Markdown格式的剧本。`,
    user: `请将以下内容合成为标准剧本格式，使用Markdown排版。

## 第${episode.episode_number}集: ${episode.title}

## 场景列表
${JSON.stringify(scenes, null, 2)}

## 对白内容
${JSON.stringify(dialogues, null, 2)}

## 输出格式要求
请严格按照以下Markdown格式输出：

\`\`\`markdown
# 第${episode.episode_number}集: ${episode.title}

> ${episode.summary}

---

## 场景 1

**${scenes[0]?.intOrExt || 'INT'}. ${scenes[0]?.location || '场景'} - ${scenes[0]?.time || '白天'}**

*[${scenes[0]?.action || ''}]*

**${dialogues[0]?.lines?.[0]?.character || '角色'}**
> 对白内容

*[动作提示]*

**另一角色**
> 对白内容

---

## 场景 2

...以此类推
\`\`\`

请输出完整的剧本内容，不要省略任何场景或对白。`,
  };
}

// ============================================
// Step 8: 剧本评分
// ============================================
export function evaluationPrompt(input: TaskInput, storyOutline: any, episodeContent: string): { system: string; user: string } {
  return {
    system: `你是一位专业的剧本评审专家，擅长从多个维度评估剧本质量。你必须用中文回复，输出严格的JSON格式。`,
    user: `请对以下剧本内容进行专业评分。

## 故事信息
标题: ${storyOutline.title}
题材: ${input.genre}
主题: ${storyOutline.theme}

## 剧本内容（节选前2000字）
${episodeContent.substring(0, 2000)}

## 评分维度（1-10分）
1. 剧情 (plot): 故事逻辑性、冲突设置、情节推进
2. 对白 (dialogue): 对话自然度、角色语言一致性、对话推动剧情
3. 人物 (character): 角色立体度、人物弧线、角色动机
4. 节奏 (pacing): 剧情节奏控制、张弛有度
5. 创意 (creativity): 原创性、创新元素

## 输出格式
请输出JSON：
{
  "plot": {
    "score": 8,
    "comment": "剧情评价"
  },
  "dialogue": {
    "score": 7,
    "comment": "对白评价"
  },
  "character": {
    "score": 8,
    "comment": "人物评价"
  },
  "pacing": {
    "score": 7,
    "comment": "节奏评价"
  },
  "creativity": {
    "score": 6,
    "comment": "创意评价"
  },
  "overall": 7.2,
  "suggestions": [
    "优化建议1",
    "优化建议2"
  ]
}`,
  };
}
