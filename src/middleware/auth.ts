import { verify } from 'hono/jwt';
import type { Context, Next } from 'hono';

type Env = {
  JWT_SECRET: string;
};

export type JwtPayload = {
  userId: number;
  email: string;
  exp: number;
};

export async function jwtAuth(c: Context<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: '未提供认证令牌' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('jwtPayload', payload as JwtPayload);
    await next();
  } catch {
    return c.json({ success: false, error: '认证令牌无效或已过期' }, 401);
  }
}
