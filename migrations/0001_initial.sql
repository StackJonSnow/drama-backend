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