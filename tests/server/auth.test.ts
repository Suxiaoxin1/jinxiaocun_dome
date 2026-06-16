import type { Express } from "express";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { migrate, openDatabase, type SqliteDb } from "../../src/server/db";
import { seedDefaultUsers } from "../../src/server/auth";

type SupertestResponse = {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type SupertestChain = {
  send(body: unknown): SupertestChain;
  set(name: string, value: string | string[]): SupertestChain;
  expect(status: number): Promise<SupertestResponse>;
};

type SupertestRequest = (app: Express) => {
  get(path: string): SupertestChain;
  post(path: string): SupertestChain;
  put(path: string): SupertestChain;
};

const require = createRequire(import.meta.url);
const request = require("supertest") as SupertestRequest;

let db: SqliteDb | null = null;
const originalNodeEnv = process.env.NODE_ENV;
const originalAdminPassword = process.env.BERNI_ADMIN_PASSWORD;
const originalOperatorPassword = process.env.BERNI_OPERATOR_PASSWORD;
const originalAllowedOrigins = process.env.BERNI_ALLOWED_ORIGINS;

afterEach(() => {
  db?.close();
  db = null;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  if (originalAdminPassword === undefined) {
    delete process.env.BERNI_ADMIN_PASSWORD;
  } else {
    process.env.BERNI_ADMIN_PASSWORD = originalAdminPassword;
  }
  if (originalOperatorPassword === undefined) {
    delete process.env.BERNI_OPERATOR_PASSWORD;
  } else {
    process.env.BERNI_OPERATOR_PASSWORD = originalOperatorPassword;
  }
  if (originalAllowedOrigins === undefined) {
    delete process.env.BERNI_ALLOWED_ORIGINS;
  } else {
    process.env.BERNI_ALLOWED_ORIGINS = originalAllowedOrigins;
  }
});

async function openSeededApp() {
  db = openDatabase(":memory:");
  await migrate(db);
  await seedDefaultUsers(db);
  return await createApp(db);
}

function sessionCookies(response: SupertestResponse) {
  const cookie = response.headers["set-cookie"];
  if (Array.isArray(cookie)) {
    return cookie;
  }
  if (typeof cookie === "string") {
    return [cookie];
  }
  throw new Error("Expected response to set a cookie");
}

describe("authentication", () => {
  it("allows the seeded admin to log in and read the current user", async () => {
    const app = await openSeededApp();

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    expect(cookie.some((value) => value.startsWith("berni_session="))).toBe(true);
    expect(loginResponse.body).toEqual({
      user: {
        id: expect.any(String),
        username: "admin",
        displayName: "管理员",
        role: "admin",
      },
    });

    const meResponse = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);

    expect(meResponse.body).toEqual({
      user: {
        id: expect.any(String),
        username: "admin",
        displayName: "管理员",
        role: "admin",
      },
    });
  });

  it("rejects an invalid password", async () => {
    const app = await openSeededApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" })
      .expect(401);

    expect(response.body).toEqual({ error: "账号或密码错误" });
  });

  it("marks session cookies as secure in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.BERNI_ADMIN_PASSWORD = "ProdAdmin#2026";
    process.env.BERNI_OPERATOR_PASSWORD = "ProdOperator#2026";
    process.env.BERNI_ALLOWED_ORIGINS = "https://erp.example.com";
    const app = await openSeededApp();

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .set("X-Berni-CSRF", "1")
      .send({ username: "admin", password: "ProdAdmin#2026" })
      .expect(200);

    expect(sessionCookies(loginResponse).some((value) => /;\s*Secure/i.test(value))).toBe(true);
  });

  it("requires the csrf header for production write requests", async () => {
    process.env.NODE_ENV = "production";
    process.env.BERNI_ADMIN_PASSWORD = "ProdAdmin#2026";
    process.env.BERNI_OPERATOR_PASSWORD = "ProdOperator#2026";
    process.env.BERNI_ALLOWED_ORIGINS = "https://erp.example.com";
    const app = await openSeededApp();

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "ProdAdmin#2026" })
      .expect(403);
    expect(blocked.body).toEqual({ error: "CSRF 校验失败" });

    await request(app)
      .post("/api/auth/login")
      .set("X-Berni-CSRF", "1")
      .send({ username: "admin", password: "ProdAdmin#2026" })
      .expect(200);
  });

  it("rejects production startup when seeded default passwords would be used", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BERNI_ADMIN_PASSWORD;
    delete process.env.BERNI_OPERATOR_PASSWORD;
    process.env.BERNI_ALLOWED_ORIGINS = "https://erp.example.com";
    db = openDatabase(":memory:");
    await migrate(db);

    await expect(createApp(db)).rejects.toThrow("生产环境必须通过环境变量设置默认账号密码");
  });

  it("limits production CORS to configured origins", async () => {
    process.env.NODE_ENV = "production";
    process.env.BERNI_ADMIN_PASSWORD = "ProdAdmin#2026";
    process.env.BERNI_OPERATOR_PASSWORD = "ProdOperator#2026";
    process.env.BERNI_ALLOWED_ORIGINS = "https://erp.example.com,https://ops.example.com";
    const app = await openSeededApp();

    const allowed = await request(app)
      .get("/api/health")
      .set("Origin", "https://erp.example.com")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://erp.example.com");

    const blocked = await request(app)
      .get("/api/health")
      .set("Origin", "https://evil.example.com")
      .expect(200);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reports database failures through the health endpoint", async () => {
    const app = await openSeededApp();
    const database = db!;
    const originalExec = database.exec.bind(database);
    database.exec = async () => {
      throw new Error("db unavailable");
    };

    try {
      const response = await request(app).get("/api/health").expect(503);
      expect(response.body).toEqual({ ok: false, error: "数据库不可用" });
    } finally {
      database.exec = originalExec;
    }
  });

  it("sets baseline security response headers", async () => {
    const app = await openSeededApp();

    const response = await request(app).get("/api/health").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("rate limits repeated failed login attempts", async () => {
    const app = await openSeededApp();

    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: "admin", password: "wrong-password" })
        .expect(401);
    }

    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" })
      .expect(429);

    expect(response.body).toEqual({ error: "登录失败次数过多，请稍后再试" });
  });

  it("returns JSON errors when auth middleware fails unexpectedly", async () => {
    const app = await openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);
    const database = db!;
    const originalPrepare = database.prepare.bind(database);
    database.prepare = (() => {
      throw new Error("db unavailable");
    }) as typeof database.prepare;

    try {
      const response = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(500);
      expect(response.body).toEqual({ error: "服务器内部错误" });
    } finally {
      database.prepare = originalPrepare;
    }
  });

  it("removes expired sessions during app startup", async () => {
    db = openDatabase(":memory:");
    await migrate(db);
    await seedDefaultUsers(db);
    const user = await db.prepare("SELECT id FROM users WHERE username = ?").get("admin") as { id: string };
    await db.prepare(
      `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES
        ('session-expired', ?, 'expired-hash', '2026-05-28T00:00:00.000Z', '2026-05-20T00:00:00.000Z'),
        ('session-active', ?, 'active-hash', '2999-01-01T00:00:00.000Z', '2026-05-20T00:00:00.000Z')
      `,
    ).run(user.id, user.id);

    await createApp(db);

    const sessions = await db.prepare("SELECT id FROM sessions ORDER BY id").all() as Array<{ id: string }>;
    expect(sessions).toEqual([{ id: "session-active" }]);
  });

  it("clears the server session on logout", async () => {
    const app = await openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "operator123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    await request(app).post("/api/auth/logout").set("Cookie", cookie).expect(200);

    const response = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    expect(response.body).toEqual({ error: "请先登录" });
  });

  it("rejects expired sessions", async () => {
    const app = await openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "operator123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    await db!.prepare("UPDATE sessions SET expires_at = ?").run("2026-05-28T00:00:00.000Z");

    const response = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    expect(response.body).toEqual({ error: "请先登录" });
  });

  it("blocks operators from admin-only user routes", async () => {
    const app = await openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "operator123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    const response = await request(app).get("/api/users").set("Cookie", cookie).expect(403);

    expect(response.body).toEqual({ error: "当前账号无权限执行此操作" });
  });

  it("seeds missing default users without overwriting existing users", async () => {
    db = openDatabase(":memory:");
    await await migrate(db);
    await db.prepare(
        `
        INSERT INTO users (
          id,
          username,
          display_name,
          password_hash,
          role,
          created_at,
          updated_at
        )
        VALUES ('existing-admin', 'admin', '已有管理员', 'existing-hash', 'admin', ?, ?)
        `,
      )
      .run("2026-05-29T00:00:00.000Z", "2026-05-29T00:00:00.000Z");

    await await createApp(db);

    const users = await db.prepare("SELECT username, display_name, password_hash FROM users ORDER BY username")
      .all() as Array<{ username: string; display_name: string; password_hash: string }>;

    expect(users).toEqual([
      { username: "admin", display_name: "已有管理员", password_hash: "existing-hash" },
      {
        username: "operator",
        display_name: "普通操作员",
        password_hash: expect.stringMatching(/^scrypt:/),
      },
    ]);
  });

  it("returns camelCase users without password hashes for admins", async () => {
    const app = await openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    const response = await request(app).get("/api/users").set("Cookie", cookie).expect(200);
    const body = response.body as { users: Array<Record<string, unknown>> };

    expect(body.users).toEqual([
      {
        id: expect.any(String),
        username: "admin",
        displayName: "管理员",
        role: "admin",
        enabled: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      {
        id: expect.any(String),
        username: "operator",
        displayName: "普通操作员",
        role: "operator",
        enabled: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
    expect(body.users[0]).not.toHaveProperty("password_hash");
    expect(body.users[0]).not.toHaveProperty("display_name");
    expect(body.users[0]).not.toHaveProperty("created_at");
    expect(body.users[0]).not.toHaveProperty("updated_at");
  });

  it("lets admins create and disable operator users", async () => {
    const app = await openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    const createResponse = await request(app)
      .post("/api/users")
      .set("Cookie", cookie)
      .send({ username: "new-operator", displayName: "新操作员", password: "secret123", role: "operator", enabled: true })
      .expect(201);
    const createdUser = createResponse.body as { user: { id: string } };

    await request(app).post("/api/auth/login").send({ username: "new-operator", password: "secret123" }).expect(200);

    await request(app)
      .put(`/api/users/${createdUser.user.id}`)
      .set("Cookie", cookie)
      .send({ displayName: "新操作员", password: "", role: "operator", enabled: false })
      .expect(200);

    await request(app).post("/api/auth/login").send({ username: "new-operator", password: "secret123" }).expect(401);
  });

  it("invalidates existing sessions when an admin changes a user password", async () => {
    const app = await openSeededApp();
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);
    const adminCookie = sessionCookies(adminLogin);
    const createResponse = await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .send({ username: "session-user", displayName: "会话用户", password: "old-secret", role: "operator", enabled: true })
      .expect(201);
    const createdUser = createResponse.body as { user: { id: string } };
    const userLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "session-user", password: "old-secret" })
      .expect(200);
    const oldUserCookie = sessionCookies(userLogin);

    await request(app)
      .put(`/api/users/${createdUser.user.id}`)
      .set("Cookie", adminCookie)
      .send({ displayName: "会话用户", password: "new-secret", role: "operator", enabled: true })
      .expect(200);

    await request(app).get("/api/auth/me").set("Cookie", oldUserCookie).expect(401);
    await request(app).post("/api/auth/login").send({ username: "session-user", password: "new-secret" }).expect(200);
  });
});
