import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";
import { TEST_DATABASE_URL_KEY } from "./support/postgres";

const execFileAsync = promisify(execFile);
const postgresImage = process.env.BERNI_TEST_POSTGRES_IMAGE ?? "postgres:16-alpine";

type SetupContext = {
  provide(key: string, value: string): void;
};

export default async function setup(context: SetupContext) {
  const containerName = `berni-inventory-test-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

  let containerId = "";
  try {
    const startResult = await execFileAsync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      "POSTGRES_DB=berni_inventory_test",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-p",
      "127.0.0.1::5432",
      postgresImage,
    ]);
    containerId = startResult.stdout.trim();
  } catch (error) {
    context.provide(TEST_DATABASE_URL_KEY, ":memory:");
    return async () => {};
  }

  const teardown = async () => {
    if (!containerId) {
      return;
    }
    try {
      await execFileAsync("docker", ["stop", containerId]);
    } catch {
      // Ignore teardown failures so test cleanup does not mask real failures.
    }
  };

  try {
    const portResult = await execFileAsync("docker", ["port", containerId, "5432/tcp"]);
    const mappedPort = parseMappedPort(portResult.stdout);
    const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${mappedPort}/berni_inventory_test`;

    await waitForPostgres(databaseUrl);
    context.provide(TEST_DATABASE_URL_KEY, databaseUrl);
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}

function parseMappedPort(output: string) {
  const match = output.trim().match(/:(\d+)$/);
  if (!match) {
    throw new Error(`无法解析 PostgreSQL 端口映射: ${output.trim()}`);
  }
  return Number(match[1]);
}

async function waitForPostgres(databaseUrl: string) {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 1_000,
    });

    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore
      }
      await delay(1000);
    }
  }

  throw new Error(`PostgreSQL 测试容器启动超时: ${formatSetupError(lastError)}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSetupError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
