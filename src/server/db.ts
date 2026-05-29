import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SqliteDb = Database.Database;
const SCHEMA_VERSION = 1;
const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function openDatabase(filename = process.env.DB_FILE ?? "data/berni-inventory.sqlite") {
  if (filename !== ":memory:") {
    const dir = path.dirname(filename);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate(db: SqliteDb) {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    throw new Error(`数据库结构版本 ${version} 高于当前应用支持的版本 ${SCHEMA_VERSION}`);
  }

  if (version === 0 && hasUserTables(db)) {
    throw new Error("数据库结构版本未知，请备份后重建数据库");
  }

  const schemaPath = findSchemaPath();
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  if (version === 0) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

function hasUserTables(db: SqliteDb) {
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { count: number };
  return count.count > 0;
}

function findSchemaPath() {
  const candidates = [
    path.join(currentDir, "schema.sql"),
    path.resolve("src/server/schema.sql"),
    path.resolve("schema.sql"),
  ];
  const schemaPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!schemaPath) {
    throw new Error(`找不到数据库 schema.sql，已检查: ${candidates.join(", ")}`);
  }
  return schemaPath;
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
