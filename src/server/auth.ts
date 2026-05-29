import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import type { SessionUser, UserRole } from "../shared/types";
import { createId, nowIso, type SqliteDb } from "./db";

export const SESSION_COOKIE_NAME = "berni_session";

const PASSWORD_KEY_LENGTH = 64;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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

export function seedDefaultUsers(db: SqliteDb) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (existing.count > 0) {
    return;
  }

  const timestamp = nowIso();
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
    `,
  );

  insert.run(
    createId("user"),
    "admin",
    "管理员",
    hashPassword(process.env.BERNI_ADMIN_PASSWORD ?? "admin123"),
    "admin",
    timestamp,
    timestamp,
  );
  insert.run(
    createId("user"),
    "operator",
    "普通操作员",
    hashPassword(process.env.BERNI_OPERATOR_PASSWORD ?? "operator123"),
    "operator",
    timestamp,
    timestamp,
  );
}

export function login(db: SqliteDb, username: string, password: string) {
  const user = db
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
  db.prepare(
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

export function currentUser(db: SqliteDb, rawToken: string | undefined) {
  if (!rawToken) {
    return null;
  }

  const session = db
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

export function clearSession(db: SqliteDb, rawToken: string | undefined) {
  if (!rawToken) {
    return;
  }

  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(rawToken));
}

export function setSessionCookie(response: Response, rawToken: string) {
  response.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export function requireAuth(db: SqliteDb) {
  return (request: Request, response: Response, next: NextFunction) => {
    const user = currentUser(db, request.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
    if (!user) {
      response.status(401).json({ error: "请先登录" });
      return;
    }

    response.locals.user = user;
    next();
  };
}

export function requireRole(role: UserRole) {
  return (_request: Request, response: Response, next: NextFunction) => {
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
