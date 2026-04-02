import { sign, verify } from 'hono/jwt';
import type { Context, Next } from 'hono';

type Env = {
  JWT_SECRET: string;
};

export type JwtPayload = {
  userId: number;
  email: string;
  exp: number;
};

const RENEW_THRESHOLD = 2 * 24 * 60 * 60;

export async function jwtAuth(c: Context<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: '未提供认证令牌' }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as JwtPayload;
    c.set('jwtPayload', payload);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp - now < RENEW_THRESHOLD) {
      const newExp = now + (7 * 24 * 60 * 60);
      const newToken = await sign(
        { userId: payload.userId, email: payload.email, exp: newExp },
        c.env.JWT_SECRET,
        'HS256'
      );
      c.header('X-Renewed-Token', newToken);
    }

    await next();
  } catch {
    return c.json({ success: false, error: '认证令牌无效或已过期' }, 401);
  }
}
