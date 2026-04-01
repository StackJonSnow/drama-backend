import { jwt } from 'hono/jwt';

type Env = {
  JWT_SECRET: string;
};

// JWT中间件工厂
export const jwtMiddleware = (secretKey: string = 'JWT_SECRET') => {
  return jwt({
    secret: secretKey,
    alg: 'HS256',
  });
};

// 获取JWT payload的类型
export type JwtPayload = {
  userId: number;
  email: string;
  exp: number;
};