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
};

const require = createRequire(import.meta.url);
const request = require("supertest") as SupertestRequest;

let db: SqliteDb | null = null;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  db?.close();
  db = null;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

function openSeededApp() {
  db = openDatabase(":memory:");
  migrate(db);
  seedDefaultUsers(db);
  return createApp(db);
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
    const app = openSeededApp();

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
    const app = openSeededApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" })
      .expect(401);

    expect(response.body).toEqual({ error: "账号或密码错误" });
  });

  it("marks session cookies as secure in production", async () => {
    process.env.NODE_ENV = "production";
    const app = openSeededApp();

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);

    expect(sessionCookies(loginResponse).some((value) => /;\s*Secure/i.test(value))).toBe(true);
  });

  it("clears the server session on logout", async () => {
    const app = openSeededApp();
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
    const app = openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "operator123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    db?.prepare("UPDATE sessions SET expires_at = ?").run("2026-05-28T00:00:00.000Z");

    const response = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    expect(response.body).toEqual({ error: "请先登录" });
  });

  it("blocks operators from admin-only user routes", async () => {
    const app = openSeededApp();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: "operator", password: "operator123" })
      .expect(200);
    const cookie = sessionCookies(loginResponse);

    const response = await request(app).get("/api/users").set("Cookie", cookie).expect(403);

    expect(response.body).toEqual({ error: "当前账号无权限执行此操作" });
  });

  it("seeds missing default users without overwriting existing users", () => {
    db = openDatabase(":memory:");
    migrate(db);
    db
      .prepare(
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

    createApp(db);

    const users = db
      .prepare("SELECT username, display_name, password_hash FROM users ORDER BY username")
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
    const app = openSeededApp();
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
});
