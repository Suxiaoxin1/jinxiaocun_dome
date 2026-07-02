import type { CookieOptions, NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import type { SessionUser, UserRole } from "../shared/types";
import { createId, nowIso, type SqliteDb } from "./db";

export const SESSION_COOKIE_NAME = "berni_session";

const PASSWORD_KEY_LENGTH = 64;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_PASSWORD = "admin123";
const DEFAULT_OPERATOR_PASSWORD = "operator123";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
};

type SessionRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  expires_at: string;
};

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, salt, expectedHash] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const actual = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashSessionToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export async function seedDefaultUsers(db: SqliteDb) {
  validateDefaultUserPasswordConfig();
  const timestamp = nowIso();
  const adminPassword = process.env.BERNI_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  const operatorPassword = process.env.BERNI_OPERATOR_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD;
  const operationPassword = process.env.BERNI_OPERATION_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD;
  const purchaserPassword = process.env.BERNI_PURCHASER_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD;
  const inboundPassword = process.env.BERNI_INBOUND_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD;
  const outboundPassword = process.env.BERNI_OUTBOUND_PASSWORD ?? DEFAULT_OPERATOR_PASSWORD;
  await db.transaction(async () => {
    const insert = db.prepare(
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
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO NOTHING
      `,
    );
    await insert.run(
      createId("user"),
      "admin",
      "管理员",
      hashPassword(adminPassword),
      "admin",
      timestamp,
      timestamp,
    );
    await insert.run(
      createId("user"),
      "operator",
      "普通操作员",
      hashPassword(operatorPassword),
      "operator",
      timestamp,
      timestamp,
    );
    await insert.run(
      createId("user"),
      "operation",
      "运营人员",
      hashPassword(operationPassword),
      "operation",
      timestamp,
      timestamp,
    );
    await insert.run(
      createId("user"),
      "purchaser",
      "采购人员",
      hashPassword(purchaserPassword),
      "purchaser",
      timestamp,
      timestamp,
    );
    await insert.run(
      createId("user"),
      "inbound",
      "入库人员",
      hashPassword(inboundPassword),
      "inbound",
      timestamp,
      timestamp,
    );
    await insert.run(
      createId("user"),
      "outbound",
      "出库人员",
      hashPassword(outboundPassword),
      "outbound",
      timestamp,
      timestamp,
    );
  });
}

function validateDefaultUserPasswordConfig() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  const adminPassword = process.env.BERNI_ADMIN_PASSWORD;
  const operatorPassword = process.env.BERNI_OPERATOR_PASSWORD;
  const operationPassword = process.env.BERNI_OPERATION_PASSWORD;
  const purchaserPassword = process.env.BERNI_PURCHASER_PASSWORD;
  const inboundPassword = process.env.BERNI_INBOUND_PASSWORD;
  const outboundPassword = process.env.BERNI_OUTBOUND_PASSWORD;
 if (!adminPassword || !operatorPassword || !operationPassword || !purchaserPassword || !inboundPassword || !outboundPassword) {
    throw new Error("生产环境必须通过环境变量设置默认账号密码");
  }
  if (adminPassword === DEFAULT_ADMIN_PASSWORD || operatorPassword === DEFAULT_OPERATOR_PASSWORD || operationPassword === DEFAULT_OPERATOR_PASSWORD || purchaserPassword === DEFAULT_OPERATOR_PASSWORD || inboundPassword === DEFAULT_OPERATOR_PASSWORD || outboundPassword === DEFAULT_OPERATOR_PASSWORD) {
    throw new Error("生产环境不能使用默认账号密码");
  }
}

export async function login(db: SqliteDb, username: string, password: string) {
  const user = await db
    .prepare(
      `
      SELECT id, username, display_name, role, password_hash
      FROM users
      WHERE username = ? AND enabled = 1
      `,
    )
    .get(username) as UserRow | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return null;
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.prepare(
    `
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
    `,
  ).run(createId("session"), user.id, hashSessionToken(rawToken), expiresAt, createdAt);

  return {
    token: rawToken,
    user: toSessionUser(user),
  };
}

export async function currentUser(db: SqliteDb, rawToken: string | undefined) {
  if (!rawToken) {
    return null;
  }

  const session = await db
    .prepare(
      `
      SELECT users.id, users.username, users.display_name, users.role, sessions.expires_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND users.enabled = 1
      `,
    )
    .get(hashSessionToken(rawToken)) as SessionRow | undefined;

  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return toSessionUser(session);
}

export async function clearSession(db: SqliteDb, rawToken: string | undefined) {
  if (!rawToken) {
    return;
  }

  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(rawToken));
}

export async function clearUserSessions(db: SqliteDb, userId: string) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export async function cleanupExpiredSessions(db: SqliteDb) {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
}

export function setSessionCookie(response: Response, rawToken: string) {
  response.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}

export function requireAuth(db: SqliteDb) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const user = await currentUser(db, request.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
    if (!user) {
      response.status(401).json({ error: "请先登录" });
      return;
    }

    response.locals.user = user;
    next();
  };
}
export function requireAnyRole(roles: UserRole[]) {
  return async (_request: Request, response: Response, next: NextFunction) => {
    const user = response.locals.user as SessionUser | undefined;
    if (!user || !roles.includes(user.role)) {
      response.status(403).json({ error: "当前账号无权限执行此操作" });
      return;
    }
    next();
  };
}

export function requireRole(role: UserRole) {
  return async (_request: Request, response: Response, next: NextFunction) => {
    const user = response.locals.user as SessionUser | undefined;
    if (!user || user.role !== role) {
      response.status(403).json({ error: "当前账号无权限执行此操作" });
      return;
    }

    next();
  };
}

function toSessionUser(user: { id: string; username: string; display_name: string; role: UserRole }): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  };
}

function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}
