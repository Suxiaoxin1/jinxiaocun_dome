import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SqliteDb = Database.Database;

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
  const schemaPath = path.resolve("src/server/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
