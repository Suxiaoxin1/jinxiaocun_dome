import { inject } from "vitest";

export const TEST_DATABASE_URL_KEY = "TEST_DATABASE_URL";

export function getTestDatabaseUrl() {
  const injected = inject(TEST_DATABASE_URL_KEY as never) as string | undefined;
  const url = injected ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("未提供测试数据库连接串");
  }
  return url;
}

export function setTestDatabaseEnv() {
  const url = getTestDatabaseUrl();
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
  return url;
}
