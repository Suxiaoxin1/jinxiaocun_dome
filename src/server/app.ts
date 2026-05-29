import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import path from "node:path";
import type { User, UserRole } from "../shared/types";
import {
  clearSession,
  clearSessionCookie,
  login,
  requireAuth,
  requireRole,
  seedDefaultUsers,
  setSessionCookie,
  SESSION_COOKIE_NAME,
} from "./auth";
import { migrate, openDatabase, type SqliteDb } from "./db";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
};

export function createApp(db: SqliteDb = openDatabase()) {
  migrate(db);
  seedDefaultUsers(db);

  const app = express();

  app.use(cors({ credentials: true, origin: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use("/uploads", express.static(path.resolve("uploads")));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/auth/login", (request, response) => {
    const result = login(db, String(request.body?.username ?? ""), String(request.body?.password ?? ""));
    if (!result) {
      response.status(401).json({ error: "账号或密码错误" });
      return;
    }

    setSessionCookie(response, result.token);
    response.json({ user: result.user });
  });

  app.get("/api/auth/me", requireAuth(db), (_request, response) => {
    response.json({ user: response.locals.user });
  });

  app.post("/api/auth/logout", (request, response) => {
    clearSession(db, request.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/users", requireAuth(db), requireRole("admin"), (_request, response) => {
    const users = db
      .prepare(
        `
        SELECT id, username, display_name, role, enabled, created_at, updated_at
        FROM users
        ORDER BY username
        `,
      )
      .all() as UserRow[];

    response.json({ users: users.map(toUser) });
  });

  return app;
}

function toUser(user: UserRow): User {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    enabled: user.enabled === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
