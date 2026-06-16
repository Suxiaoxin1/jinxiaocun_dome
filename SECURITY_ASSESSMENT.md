# 生产环境安全风险评估报告

**评估日期**: 2026-06-12
**系统**: 伯尼科技进销存系统
**技术栈**: TypeScript + Express + PostgreSQL

---

## 执行摘要

本系统在认证、授权、输入验证等方面有良好的基础安全实现，但存在 **3个关键级（CRITICAL）问题** 和 **5个高优先级（HIGH）问题** 必须在生产环境部署前修复。

**总体评分**: ⚠️ 6.5/10（修复关键问题后可达 8.5/10）

---

## 🔴 CRITICAL - 关键问题（必须修复，阻止上线）

### 1. Cookie 安全属性缺失 maxAge

**文件**: `src/server/auth.ts:218-225`

**问题描述**:
Session cookie 未设置过期时间，成为永久 cookie。即使服务器端 session 已过期，浏览器仍会持续发送旧 token。

**当前代码**:
```typescript
function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // ❌ 缺少 maxAge
  };
}
```

**潜在风险**:
- Session 劫持窗口无限延长
- 用户浏览器积累大量过期 token
- 无法强制客户端清除 session
- 用户登出后 cookie 仍然存在

**修复方案**:
```typescript
function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS, // ✅ 添加此行（7天）
  };
}
```

---

### 2. 默认密码硬编码在源代码中

**文件**: `src/server/auth.ts:10-11`

**问题描述**:
默认密码以明文常量形式存在代码库中。虽然生产环境会通过环境变量覆盖，但源代码泄露仍会暴露默认凭据。

**当前代码**:
```typescript
const DEFAULT_ADMIN_PASSWORD = "admin123";      // ❌ 硬编码弱密码
const DEFAULT_OPERATOR_PASSWORD = "operator123"; // ❌ 硬编码弱密码
```

**潜在风险**:
- 源代码泄露直接暴露凭据
- 开发/测试环境使用弱密码
- 心理锚定效应，运维可能设置类似密码
- Git 历史永久保留敏感信息

**修复方案**:
```typescript
// 移除硬编码，强制通过环境变量设置并验证强度
function getRequiredPassword(envKey: string, context: string): string {
  const password = process.env[envKey];
  
  if (!password) {
    throw new Error(`${context}密码未设置，请配置 ${envKey}`);
  }
  
  if (password.length < 12) {
    throw new Error(`${context}密码长度必须至少12字符`);
  }
  
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error(`${context}密码必须包含大小写字母和数字`);
  }
  
  return password;
}

export async function seedDefaultUsers(db: SqliteDb) {
  const timestamp = nowIso();
  const adminPassword = getRequiredPassword('BERNI_ADMIN_PASSWORD', '管理员');
  const operatorPassword = getRequiredPassword('BERNI_OPERATOR_PASSWORD', '操作员');
  // 继续原有逻辑...
}
```

**同步更新**: 更新 README.md 和 ecosystem.config.cjs.example，强调密码强度要求。

---

### 3. 缺少通用 API 速率限制

**文件**: `src/server/app.ts:254-271`（仅登录有速率限制）

**问题描述**:
仅对 `/api/auth/login` 实现了速率限制，其他所有 API 端点（查询、创建、修改、删除）均无保护。

**潜在风险**:
- API 滥用和 DoS 攻击
- 暴力枚举配件/产品/用户信息
- 恶意批量数据导出（CSV）
- 数据库连接池耗尽
- 存储空间攻击（大量上传）

**修复方案**:

1. 安装依赖：
```bash
npm install express-rate-limit
```

2. 添加全局和细分速率限制：
```typescript
import rateLimit from 'express-rate-limit';

export async function createApp(db: SqliteDb = openDatabase()) {
  await migrate(db);
  await seedDefaultUsers(db);
  await cleanupExpiredSessions(db);

  const app = express();
  
  // ... 其他中间件
  
  // ✅ 全局速率限制（宽松）
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 1000, // 每个IP最多1000次请求
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' },
    skip: (request) => request.path.startsWith('/uploads/')
  });
  
  app.use('/api/', generalLimiter);
  
  // ✅ 敏感操作严格限制
  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: '操作过于频繁' }
  });
  
  // 应用到管理员路由
  app.use('/api/users', requireAuth(db), requireRole('admin'), strictLimiter);
  app.use('/api/audit-logs', requireAuth(db), requireRole('admin'), strictLimiter);
  
  // ... 其余路由
}
```

---

## 🟠 HIGH - 高优先级问题（强烈建议修复）

### 4. Session 清理机制未自动执行

**文件**: `src/server/auth.ts:172-174`

**问题描述**:
`cleanupExpiredSessions()` 函数已实现但从未被调用，过期 session 永久留在数据库中。

**潜在风险**:
- `sessions` 表持续增长
- 查询性能逐渐下降
- 存储空间浪费
- 索引效率降低

**修复方案** - 在 `src/server/index.ts` 中添加定时任务：
```typescript
import { createApp } from "./app";
import { cleanupExpiredSessions } from "./auth";
import { openDatabase } from "./db";

const port = Number(process.env.PORT ?? 3001);
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 每小时

async function main() {
  const db = openDatabase();
  const app = await createApp(db);
  
  // ✅ 定期清理过期 session
  const cleanupTimer = setInterval(async () => {
    try {
      await cleanupExpiredSessions(db);
      console.log('[Cleanup] Expired sessions removed');
    } catch (error) {
      console.error('[Cleanup] Failed:', error);
    }
  }, CLEANUP_INTERVAL_MS);
  
  // 启动时立即清理一次
  await cleanupExpiredSessions(db).catch(console.error);
  
  app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
  
  // 优雅关闭
  process.on('SIGTERM', () => {
    clearInterval(cleanupTimer);
    db.close().then(() => process.exit(0));
  });
}

void main();
```

---

### 5. 文件上传路径遍历潜在风险

**文件**: `src/server/uploads.ts:32`

**问题描述**:
使用 `path.extname(file.originalname)` 作为回退，直接从用户输入获取扩展名。

**当前代码**:
```typescript
filename: (_request, file, callback) => {
  const extension = supportedImageTypes.get(file.mimetype) 
    ?? path.extname(file.originalname); // ❌ 可能不安全
  callback(null, `${filenamePrefix}-${Date.now()}-${randomUUID()}${extension}`);
}
```

**潜在风险**:
虽然 UUID 随机化了文件名，但在某些边缘情况下，恶意构造的 `originalname` 可能导致意外行为。

**修复方案**:
```typescript
filename: (_request, file, callback) => {
  // ✅ 仅从白名单 MIME 类型获取扩展名
  const extension = supportedImageTypes.get(file.mimetype);
  
  if (!extension) {
    callback(new Error("不支持的文件类型"));
    return;
  }
  
  callback(null, `${filenamePrefix}-${Date.now()}-${randomUUID()}${extension}`);
}
```

同时更新 `fileFilter` 确保一致性。

---

### 6. CORS 开发环境配置过于宽松

**文件**: `src/server/app.ts:768-770`

**问题描述**:
开发环境允许所有源（`origin: true`），可能被意外部署到生产。

**当前代码**:
```typescript
function createCorsOptions() {
  if (process.env.NODE_ENV !== "production") {
    return { credentials: true, origin: true }; // ❌ 允许所有源
  }
  // ...
}
```

**潜在风险**:
- 配置意外泄露到生产
- 跨站请求伪造攻击面扩大
- 凭据泄露给未授权源

**修复方案**:
```typescript
function createCorsOptions() {
  const allowedOrigins = parseAllowedOrigins();
  
  return {
    credentials: true,
    origin(requestOrigin: string | undefined, callback: CorsOriginCallback) {
      // ✅ 开发环境也验证，但允许 localhost
      if (process.env.NODE_ENV !== "production") {
        if (!requestOrigin || 
            requestOrigin.startsWith("http://localhost:") || 
            requestOrigin.startsWith("http://127.0.0.1:")) {
          callback(null, requestOrigin || true);
          return;
        }
      }
      
      if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
        callback(null, false);
        return;
      }
      
      callback(null, requestOrigin);
    },
  };
}
```

---

### 7. 审计日志未记录失败操作

**文件**: `src/server/auth.ts:184-207`

**问题描述**:
仅记录成功的操作，失败的认证/授权尝试未记录。

**潜在风险**:
- 无法追溯攻击尝试
- 缺少入侵检测数据
- 合规审计不完整
- 无法发现暴力破解

**修复方案** - 在认证和授权中间件中添加失败日志：
```typescript
export function requireAuth(db: SqliteDb) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const user = await currentUser(db, request.cookies?.[SESSION_COOKIE_NAME]);
    
    if (!user) {
      // ✅ 记录认证失败
      await db.prepare(
        `INSERT INTO audit_logs (
          id, action, entity_type, ip, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        "认证失败",
        "session",
        request.ip ?? null,
        request.get('user-agent') ?? null,
        nowIso()
      ).catch(() => {}); // 不阻塞响应
      
      response.status(401).json({ error: "请先登录" });
      return;
    }
    
    response.locals.user = user;
    next();
  };
}

export function requireRole(role: UserRole) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const user = response.locals.user as SessionUser | undefined;
    
    if (!user || user.role !== role) {
      // ✅ 记录授权失败
      await db.prepare(
        `INSERT INTO audit_logs (
          id, actor_user_id, actor_username, actor_role, 
          action, entity_type, ip, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("audit"),
        user?.id ?? null,
        user?.username ?? null,
        user?.role ?? null,
        "授权失败",
        "permission",
        request.ip ?? null,
        request.get('user-agent') ?? null,
        nowIso()
      ).catch(() => {});
      
      response.status(403).json({ error: "当前账号无权限执行此操作" });
      return;
    }
    
    next();
  };
}
```

---

### 8. 缺少数据库连接池监控

**文件**: `src/server/db.ts:156-160`

**问题描述**:
PostgreSQL 连接池已配置但无健康检查和监控。

**潜在风险**:
- 连接泄露无法及时发现
- 数据库故障无预警
- 性能问题难以诊断
- 无法评估负载

**修复方案** - 在 `src/server/index.ts` 中添加监控：
```typescript
async function main() {
  const db = openDatabase();
  const app = await createApp(db);
  
  // ✅ 数据库健康检查
  const healthCheckInterval = setInterval(async () => {
    try {
      await db.prepare("SELECT 1").get();
    } catch (error) {
      console.error('[Health] Database unreachable:', error);
      // 可选：触发告警系统
    }
  }, 60000); // 每分钟
  
  // ✅ 连接池状态监控（可选，用于调试）
  if (process.env.ENABLE_POOL_STATS === 'true') {
    const statsInterval = setInterval(() => {
      const pool = (db as any).pool;
      console.log(`[Pool] Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`);
    }, 300000); // 每5分钟
    
    process.on('SIGTERM', () => clearInterval(statsInterval));
  }
  
  // 优雅关闭时清理定时器
  process.on('SIGTERM', () => {
    clearInterval(healthCheckInterval);
  });
  
  // ... 其余代码
}
```

---

## 🟡 MEDIUM - 中优先级问题

### 9. CSP 策略包含 unsafe-inline

**文件**: `src/server/app.ts:713`

**问题**: `style-src 'self' 'unsafe-inline'` 降低了 XSS 保护效果。

**建议**: 如果前端使用 Vite 构建，考虑移除内联样式或使用 nonce-based CSP。

---

### 10. 登录速率限制基于内存存储

**文件**: `src/server/app.ts:730`

**问题**: 速率限制数据存储在内存 Map，多实例部署时无法共享。

**建议**: 使用 Redis 或数据库存储速率限制数据，支持横向扩展。

---

### 11. 环境变量缺少统一验证

**问题**: 环境变量读取后未统一验证格式和范围。

**建议**: 创建 `src/server/config.ts` 使用 Zod 统一验证所有环境变量。

---

### 12. 请求体大小未限制

**文件**: `src/server/app.ts:242`

**问题**: `express.json()` 设置了 `limit: "2mb"` 但可以更明确。

**当前实现**: ✅ 已设置 2MB 限制，这是合理的。可考虑根据实际需求调整。

---

## 🟢 LOW - 低优先级改进

### 13. Session token 熵可增强

**文件**: `src/server/auth.ts:121`

**建议**: 从 32 字节增加到 48 字节以提高安全边际。

```typescript
const rawToken = crypto.randomBytes(48).toString("base64url");
```

---

### 14. 密码哈希参数未版本化

**文件**: `src/server/auth.ts:29-32`

**建议**: 在哈希中存储参数版本，便于未来升级 scrypt 参数。

---

## ✅ 已做得好的安全实践

1. **✅ 参数化查询**: 所有 SQL 查询使用 `db.prepare()` 参数化，有效防止 SQL 注入
2. **✅ 密码哈希**: 使用 scrypt 算法，16字节盐值，64字节密钥长度
3. **✅ Session 安全**: Token 使用 SHA-256 哈希存储，不直接存储明文
4. **✅ CSRF 保护**: 生产环境要求自定义请求头
5. **✅ Cookie 安全**: httpOnly=true, sameSite=lax, secure=production
6. **✅ 输入验证**: 使用 Zod schema 验证所有用户输入
7. **✅ 文件验证**: 检查文件头魔术字节，防止类型伪造
8. **✅ 权限控制**: requireAuth 和 requireRole 中间件分层保护
9. **✅ 审计日志**: 记录所有数据变更的前后状态
10. **✅ 登录限制**: IP+用户名组合的登录速率限制

---

## 部署前检查清单

### 🔴 关键配置（必须完成）

- [ ] **修复 Cookie maxAge** - auth.ts:224
- [ ] **移除硬编码密码** - auth.ts:10-11
- [ ] **实现 API 速率限制** - app.ts
- [ ] **自动清理 Session** - index.ts
- [ ] **加固文件上传** - uploads.ts:32
- [ ] **收紧 CORS 配置** - app.ts:768

### 🟠 环境变量（必须设置）

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL=postgres://user:strong_password@host:5432/db`
- [ ] `BERNI_ADMIN_PASSWORD` ≥16字符，包含大小写、数字、特殊字符
- [ ] `BERNI_OPERATOR_PASSWORD` ≥16字符，包含大小写、数字、特殊字符
- [ ] `BERNI_ALLOWED_ORIGINS=https://your-frontend-domain.com`
- [ ] `PG_POOL_MAX=10`
- [ ] `PORT=3001`

### 🟡 基础设施（必须准备）

- [ ] PostgreSQL 定期自动备份（每日）
- [ ] `uploads/` 目录定期备份
- [ ] 日志轮转和归档策略
- [ ] 进程管理器配置（PM2/systemd）
- [ ] HTTPS/TLS 证书配置
- [ ] 防火墙规则配置
- [ ] 监控和告警系统

### 🟢 测试验证（必须通过）

- [ ] 在类生产环境测试所有修复
- [ ] 验证强密码策略生效
- [ ] 测试 API 速率限制触发
- [ ] 验证 CORS 仅允许配置的源
- [ ] 测试 Session 过期和清理
- [ ] 文件上传边界测试
- [ ] 压力测试数据库连接池

---

## 修复优先级建议

### 第一周（上线前必须完成）
1. 修复 3 个 CRITICAL 问题
2. 修复 5 个 HIGH 问题
3. 配置所有必需的环境变量
4. 完成部署前检查清单

### 第二周（上线后立即规划）
1. 修复 4 个 MEDIUM 问题
2. 实施数据库备份自动化
3. 配置监控和告警

### 后续迭代
1. 实施 Redis 速率限制（支持集群）
2. 增强密码策略（密码历史、过期策略）
3. 实施二次认证（可选）

---

## 总结

### 当前状态
- **安全基础**: 良好（参数化查询、密码哈希、CSRF 保护）
- **关键缺陷**: 存在（Cookie 配置、速率限制、默认密码）
- **推荐**: **暂缓上线，完成关键修复后再部署**

### 修复后预期
- **整体安全性**: 从 6.5/10 提升至 8.5/10
- **生产就绪**: ✅ 达到生产环境最低安全要求
- **持续改进**: 建议每季度进行安全复审

---

**评估人**: Claude Code (Security Review Agent)  
**评估日期**: 2026-06-12
