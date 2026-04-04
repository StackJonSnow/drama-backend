import { Hono } from 'hono';
import { verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import {
  ENTERPRISE_PROMPT_TEMPLATES,
  ensureStudioDefaults,
  getWorkflowTemplateDetail,
  listPromptTemplates,
  listWorkflowTemplates,
  normalizeWorkflowNodes,
  validateWorkflowNodes,
} from '../services/studio';

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
};

type Variables = {
  jwtPayload: {
    userId: number;
    email: string;
    exp: number;
  };
};

export const studioRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function jwtAuth(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: '未提供认证令牌' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('jwtPayload', payload as any);
    await next();
  } catch {
    return c.json({ success: false, error: '认证令牌无效或已过期' }, 401);
  }
}

studioRoutes.get('/workflows', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  await ensureStudioDefaults(c.env.DB);
  const templates = await listWorkflowTemplates(c.env.DB, Number(payload.userId));
  return c.json({ success: true, data: { templates } });
});

studioRoutes.get('/workflows/:id', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  const template = await getWorkflowTemplateDetail(c.env.DB, Number(c.req.param('id')), Number(payload.userId));
  if (!template) return c.json({ success: false, error: '工作流不存在' }, 404);
  return c.json({ success: true, data: { template } });
});

studioRoutes.post('/workflows', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  const body = await c.req.json();
  const nodes = normalizeWorkflowNodes(Array.isArray(body.nodes) ? body.nodes : []);
  validateWorkflowNodes(nodes);
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'INSERT INTO workflow_templates (user_id, name, description, is_default, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).bind(Number(payload.userId), body.name || '自定义工作流', body.description || null, body.is_default ? 1 : 0, now, now).run();
  const templateId = Number((result as any).meta?.last_row_id || 0);
  if (body.is_default) {
    await c.env.DB.prepare('UPDATE workflow_templates SET is_default = 0 WHERE user_id = ? AND id != ?').bind(Number(payload.userId), templateId).run();
  }
  for (const node of nodes) {
    await c.env.DB.prepare(
      'INSERT INTO workflow_nodes (template_id, step_number, node_key, display_name, execution_order, enabled, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(templateId, node.step_number, node.node_key, node.display_name, node.execution_order, node.enabled ? 1 : 0, JSON.stringify(node.metadata || {}), now, now).run();
  }
  const template = await getWorkflowTemplateDetail(c.env.DB, templateId, Number(payload.userId));
  return c.json({ success: true, message: '工作流已创建', data: { template } });
});

studioRoutes.put('/workflows/:id', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  const templateId = Number(c.req.param('id'));
  const body = await c.req.json();
  const template = await c.env.DB.prepare('SELECT * FROM workflow_templates WHERE id = ? AND user_id = ?').bind(templateId, Number(payload.userId)).first();
  if (!template) return c.json({ success: false, error: '工作流不存在或不可编辑' }, 404);
  const nodes = normalizeWorkflowNodes(Array.isArray(body.nodes) ? body.nodes : []);
  validateWorkflowNodes(nodes);
  const now = new Date().toISOString();
  await c.env.DB.prepare('UPDATE workflow_templates SET name = ?, description = ?, is_default = ?, updated_at = ? WHERE id = ?').bind(body.name || template.name, body.description || null, body.is_default ? 1 : 0, now, templateId).run();
  if (body.is_default) {
    await c.env.DB.prepare('UPDATE workflow_templates SET is_default = 0 WHERE user_id = ? AND id != ?').bind(Number(payload.userId), templateId).run();
  }
  await c.env.DB.prepare('DELETE FROM workflow_nodes WHERE template_id = ?').bind(templateId).run();
  for (const node of nodes) {
    await c.env.DB.prepare(
      'INSERT INTO workflow_nodes (template_id, step_number, node_key, display_name, execution_order, enabled, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(templateId, node.step_number, node.node_key, node.display_name, node.execution_order, node.enabled ? 1 : 0, JSON.stringify(node.metadata || {}), now, now).run();
  }
  const detail = await getWorkflowTemplateDetail(c.env.DB, templateId, Number(payload.userId));
  return c.json({ success: true, message: '工作流已更新', data: { template: detail } });
});

studioRoutes.get('/prompt-templates', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  const templates = await listPromptTemplates(c.env.DB, Number(payload.userId));
  return c.json({ success: true, data: { templates } });
});

studioRoutes.put('/prompt-templates/:nodeKey', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  const nodeKey = c.req.param('nodeKey');
  const body = await c.req.json();
  const now = new Date().toISOString();
  const latest = await c.env.DB.prepare(
    'SELECT version FROM prompt_templates WHERE node_key = ? AND user_id = ? ORDER BY version DESC LIMIT 1'
  ).bind(nodeKey, Number(payload.userId)).first<any>();
  await c.env.DB.prepare('UPDATE prompt_templates SET is_active = 0 WHERE node_key = ? AND user_id = ?').bind(nodeKey, Number(payload.userId)).run();
  await c.env.DB.prepare(
    `INSERT INTO prompt_templates (user_id, node_key, name, description, system_prompt, task_instruction, extra_rules, model_config, is_active, is_system, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`
  ).bind(
    Number(payload.userId),
    nodeKey,
    body.name || `${nodeKey} 自定义模板`,
    body.description || null,
    body.system_prompt,
    body.task_instruction,
    JSON.stringify(body.extra_rules || []),
    JSON.stringify(body.model_config || {}),
    Number(latest?.version || 0) + 1,
    now,
    now,
  ).run();
  const templates = await listPromptTemplates(c.env.DB, Number(payload.userId));
  return c.json({ success: true, message: '提示词模板已更新', data: { templates } });
});

studioRoutes.post('/prompt-templates/:nodeKey/reset', jwtAuth, async (c) => {
  const payload = c.get('jwtPayload');
  const nodeKey = c.req.param('nodeKey');
  await c.env.DB.prepare('DELETE FROM prompt_templates WHERE node_key = ? AND user_id = ?').bind(nodeKey, Number(payload.userId)).run();
  const fallback = ENTERPRISE_PROMPT_TEMPLATES.find((item) => item.node_key === nodeKey);
  return c.json({ success: true, message: '提示词模板已重置', data: { template: fallback || null } });
});
