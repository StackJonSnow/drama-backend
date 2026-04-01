import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { authRoutes } from './routes/auth';
import { scriptRoutes } from './routes/scripts';
import { aiRoutes } from './routes/ai';

// 定义环境变量类型
type Bindings = {
  DB: D1Database;
  AI: any;
  JWT_SECRET: string;
  ENVIRONMENT: string;
};

// 创建Hono应用
const app = new Hono<{ Bindings: Bindings }>();

// 中间件
app.use('/*', cors());

// 注意：JWT中间件在各个路由中单独应用，以便区分公开和需要认证的端点

// 路由
app.route('/api/auth', authRoutes);
app.route('/api/scripts', scriptRoutes);
app.route('/api/ai', aiRoutes);

// 健康检查
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'AI剧本生成工具后端服务',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 404处理
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;