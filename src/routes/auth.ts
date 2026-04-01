import { Hono } from 'hono';
import { jwt } from 'hono/jwt';

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
};

type Variables = {
  user: any;
  jwtPayload: {
    userId: number;
    email: string;
    exp: number;
  };
};

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 用户注册
authRoutes.post('/register', async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    
    // 验证输入
    if (!email || !password) {
      return c.json({ error: '邮箱和密码是必填项' }, 400);
    }
    
    // 检查邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ error: '邮箱格式不正确' }, 400);
    }
    
    // 检查用户是否已存在
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email).first();
    
    if (existingUser) {
      return c.json({ error: '该邮箱已注册' }, 400);
    }
    
    // 生成密码哈希（在实际应用中应使用bcrypt等）
    const passwordHash = await hashPassword(password);
    
    // 插入新用户
    const result = await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)'
    ).bind(email, passwordHash, name || '', new Date().toISOString()).run();
    
    if (!result.success) {
      return c.json({ error: '注册失败，请稍后重试' }, 500);
    }
    
    // 生成JWT token
    const token = await sign(
      { 
        userId: result.meta.last_row_id, 
        email,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7天
      },
      c.env.JWT_SECRET
    );
    
    return c.json({
      success: true,
      message: '注册成功',
      user: {
        id: result.meta.last_row_id,
        email,
        name: name || ''
      },
      token
    });
    
  } catch (error) {
    console.error('注册错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 用户登录
authRoutes.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    // 验证输入
    if (!email || !password) {
      return c.json({ error: '邮箱和密码是必填项' }, 400);
    }
    
    // 查找用户
    const user = await c.env.DB.prepare(
      'SELECT id, email, password_hash, name FROM users WHERE email = ?'
    ).bind(email).first();
    
    if (!user) {
      return c.json({ error: '邮箱或密码错误' }, 401);
    }
    
    // 验证密码
    const passwordMatch = await verifyPassword(password, user.password_hash as string);
    if (!passwordMatch) {
      return c.json({ error: '邮箱或密码错误' }, 401);
    }
    
    // 生成JWT token
    const token = await sign(
      { 
        userId: user.id, 
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7天
      },
      c.env.JWT_SECRET
    );
    
    return c.json({
      success: true,
      message: '登录成功',
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      token
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 获取当前用户信息
authRoutes.get('/me', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    
    const user = await c.env.DB.prepare(
      'SELECT id, email, name, created_at FROM users WHERE id = ?'
    ).bind(payload.userId).first();
    
    if (!user) {
      return c.json({ error: '用户不存在' }, 404);
    }
    
    return c.json({
      success: true,
      user
    });
    
  } catch (error) {
    console.error('获取用户信息错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 更新用户信息
authRoutes.put('/profile', jwt({ secret: 'JWT_SECRET', alg: 'HS256' }), async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { name, currentPassword, newPassword } = await c.req.json();
    
    // 获取当前用户信息
    const user = await c.env.DB.prepare(
      'SELECT id, password_hash FROM users WHERE id = ?'
    ).bind(payload.userId).first();
    
    if (!user) {
      return c.json({ error: '用户不存在' }, 404);
    }
    
    let updateFields = [];
    let updateValues: any[] = [];
    
    // 更新名字
    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    
    // 更新密码
    if (currentPassword && newPassword) {
      const passwordMatch = await verifyPassword(currentPassword, user.password_hash as string);
      if (!passwordMatch) {
        return c.json({ error: '当前密码错误' }, 400);
      }
      
      const newPasswordHash = await hashPassword(newPassword);
      updateFields.push('password_hash = ?');
      updateValues.push(newPasswordHash);
    }
    
    if (updateFields.length === 0) {
      return c.json({ error: '没有需要更新的字段' }, 400);
    }
    
    updateFields.push('updated_at = ?');
    updateValues.push(new Date().toISOString());
    updateValues.push(payload.userId);
    
    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    const result = await c.env.DB.prepare(query).bind(...updateValues).run();
    
    if (!result.success) {
      return c.json({ error: '更新失败' }, 500);
    }
    
    return c.json({
      success: true,
      message: '更新成功'
    });
    
  } catch (error) {
    console.error('更新用户信息错误:', error);
    return c.json({ error: '服务器内部错误' }, 500);
  }
});

// 辅助函数：密码哈希（简化版，实际应用应使用bcrypt）
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'salt-drama-generator');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 辅助函数：验证密码
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

// 辅助函数：JWT签名（简化版）
async function sign(payload: any, secret: string): Promise<string> {
  // 这里使用简化的JWT实现，实际应用应使用成熟的JWT库
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const signature = btoa(`${encodedHeader}.${encodedPayload}.${secret}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
