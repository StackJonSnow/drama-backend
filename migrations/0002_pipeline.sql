-- 生成任务表
CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  genre TEXT NOT NULL,
  script_type TEXT NOT NULL,
  style TEXT,              -- 剧情风格
  target_platform TEXT,    -- 目标平台
  target_duration INTEGER, -- 目标时长(分钟)
  character_count INTEGER, -- 角色数量
  key_points TEXT,         -- JSON数组: 关键情节点
  characters_input TEXT,   -- JSON数组: 用户指定角色
  scene_input TEXT,        -- 用户指定场景描述
  ai_service TEXT NOT NULL DEFAULT 'cloudflare-ai',
  total_episodes INTEGER NOT NULL DEFAULT 50,
  completed_episodes INTEGER NOT NULL DEFAULT 0,
  current_step INTEGER NOT NULL DEFAULT 0,  -- 0=未开始, 1-8=进行中, 9=已完成
  status TEXT NOT NULL DEFAULT 'pending',    -- pending, running, paused, completed, failed
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 流水线步骤结果表
CREATE TABLE IF NOT EXISTS pipeline_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,   -- 1-8
  step_name TEXT NOT NULL,        -- story_outline, characters, plot_structure, episode_plan, scenes, dialogue, compose, evaluate
  content TEXT,                   -- JSON: 该步骤的输出
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, skipped
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_steps_task ON pipeline_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_step ON pipeline_steps(task_id, step_number);

-- 剧集表
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT,
  act TEXT,                   -- 幕: first_act, second_act, third_act
  summary TEXT,               -- 集摘要
  scenes TEXT,                -- JSON: 场景列表
  dialogue TEXT,              -- JSON: 对白内容
  content TEXT,               -- 合成后的完整剧本内容 (Markdown)
  word_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, generating, completed, failed
  error_message TEXT,
  created_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task_id);
CREATE INDEX IF NOT EXISTS idx_episodes_number ON episodes(task_id, episode_number);

-- 评分表
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  plot_score INTEGER,         -- 剧情 (1-10)
  dialogue_score INTEGER,     -- 对白 (1-10)
  character_score INTEGER,    -- 人物 (1-10)
  pacing_score INTEGER,       -- 节奏 (1-10)
  creativity_score INTEGER,   -- 创意 (1-10)
  overall_score REAL,         -- 综合分
  suggestions TEXT,           -- JSON: 优化建议
  evaluated_at TEXT,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

-- 剧本版本表
CREATE TABLE IF NOT EXISTS script_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  label TEXT,                 -- 版本标签 (如 "初稿", "优化版")
  content TEXT,               -- 完整剧本内容 (Markdown)
  change_notes TEXT,          -- 变更说明
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_script_versions_task ON script_versions(task_id);
