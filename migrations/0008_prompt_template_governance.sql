ALTER TABLE prompt_templates ADD COLUMN release_tag TEXT DEFAULT 'draft';
ALTER TABLE prompt_templates ADD COLUMN published_at TEXT;
