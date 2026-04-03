ALTER TABLE ai_configs ADD COLUMN base_url TEXT;

ALTER TABLE ai_configs ADD COLUMN model TEXT;

ALTER TABLE ai_configs ADD COLUMN validation_status TEXT;

ALTER TABLE ai_configs ADD COLUMN last_checked_at TEXT;

ALTER TABLE ai_configs ADD COLUMN last_check_message TEXT;
