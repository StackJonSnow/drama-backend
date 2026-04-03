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
