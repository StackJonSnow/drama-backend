-- === 0001_initial.sql ===
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 剧本表
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  genre TEXT,
  characters TEXT, -- JSON数组
  scene TEXT,
  length TEXT,
  key_points TEXT, -- JSON数组
  ai_service TEXT,
  script_type TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- AI配置表
CREATE TABLE IF NOT EXISTS ai_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_name TEXT NOT NULL,
  api_key TEXT, -- 加密存储
  is_active INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_scripts_user_id ON scripts(user_id);
CREATE INDEX IF NOT EXISTS idx_scripts_created_at ON scripts(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_configs_user_id ON ai_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_configs_service_name ON ai_configs(service_name);

-- === 0002_pipeline.sql ===
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


-- === 0003_ai_channels.sql ===
ALTER TABLE ai_configs ADD COLUMN base_url TEXT;

ALTER TABLE ai_configs ADD COLUMN model TEXT;

ALTER TABLE ai_configs ADD COLUMN validation_status TEXT;

ALTER TABLE ai_configs ADD COLUMN last_checked_at TEXT;

ALTER TABLE ai_configs ADD COLUMN last_check_message TEXT;


-- === 0003_pipeline_ai_model.sql ===
ALTER TABLE generation_tasks ADD COLUMN ai_model TEXT;


-- === 0004_pipeline_logs.sql ===
CREATE TABLE IF NOT EXISTS pipeline_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  step_number INTEGER,
  step_name TEXT,
  episode_number INTEGER,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_logs_task_id ON pipeline_logs(task_id, id);


-- === 0005_pipeline_step_summary.sql ===
ALTER TABLE pipeline_steps ADD COLUMN current_task_summary TEXT;


-- === 0006_studio.sql ===
CREATE TABLE IF NOT EXISTS workflow_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  node_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  execution_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_user ON workflow_templates(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_template ON workflow_nodes(template_id, execution_order);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  node_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  task_instruction TEXT NOT NULL,
  extra_rules TEXT,
  model_config TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_node ON prompt_templates(node_key, is_active);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_user ON prompt_templates(user_id, node_key);

CREATE TABLE IF NOT EXISTS script_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  source_version_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_version_id) REFERENCES script_versions(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_script_drafts_task ON script_drafts(task_id);


-- === 0007_generation_task_workflow.sql ===
ALTER TABLE generation_tasks ADD COLUMN workflow_template_id INTEGER;
ALTER TABLE generation_tasks ADD COLUMN workflow_snapshot TEXT;


-- === 0008_prompt_template_governance.sql ===
ALTER TABLE generation_tasks ADD COLUMN workflow_snapshot TEXT;
ALTER TABLE prompt_templates ADD COLUMN published_at TEXT;


-- === 0009_prompt_template_runtime_tuning.sql ===
UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.55, '$.maxTokens', 2200)
WHERE is_system = 1 AND node_key = 'characters';

UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.55, '$.maxTokens', 2200)
WHERE is_system = 1 AND node_key = 'plot_structure';

UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.6, '$.maxTokens', 2400)
WHERE is_system = 1 AND node_key = 'episode_plan';

UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.6, '$.maxTokens', 1600)
WHERE is_system = 1 AND node_key = 'scenes';

UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.6, '$.maxTokens', 1600)
WHERE is_system = 1 AND node_key = 'dialogue';

UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.35, '$.maxTokens', 2800)
WHERE is_system = 1 AND node_key = 'compose';

UPDATE prompt_templates
SET model_config = json_set(COALESCE(model_config, '{}'), '$.temperature', 0.25, '$.maxTokens', 1200)
WHERE is_system = 1 AND node_key = 'evaluate';


