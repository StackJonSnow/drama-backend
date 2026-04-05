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
