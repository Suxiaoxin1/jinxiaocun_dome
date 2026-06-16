import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool, type PoolClient, type QueryResultRow } from "pg";
import { newDb } from "pg-mem";

export type SqliteDb = PostgresDb;

type QueryExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
};

type PoolClientLike = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  release(): void;
};

type PoolLike = QueryExecutor & {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
};

type PreparedStatement = {
  all<T extends QueryResultRow = QueryResultRow>(...params: unknown[]): Promise<T[]>;
  get<T extends QueryResultRow = QueryResultRow>(...params: unknown[]): Promise<T | undefined>;
  run(...params: unknown[]): Promise<{ changes: number }>;
};

type DatabaseOptions = {
  baseUrl: string;
  schemaName: string | null;
  testSchema: boolean;
  memory: boolean;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POOL_MAX = 10;

export class PostgresDb {
  readonly ready: Promise<void>;

  constructor(
    private readonly pool: PoolLike,
    private readonly executor: QueryExecutor,
    private readonly options: DatabaseOptions,
    private readonly transactionStore: AsyncLocalStorage<PoolClientLike>,
    ready: Promise<void>,
  ) {
    this.ready = ready;
  }

  prepare(sql: string): PreparedStatement {
    const compiledSql = compileSql(sql);
    return {
      all: async <T extends QueryResultRow = QueryResultRow>(...params: unknown[]) => {
        const result = await this.query<T>(compiledSql, params);
        return result.rows;
      },
      get: async <T extends QueryResultRow = QueryResultRow>(...params: unknown[]) => {
        const result = await this.query<T>(compiledSql, params);
        return result.rows[0];
      },
      run: async (...params: unknown[]) => {
        const result = await this.query(compiledSql, params);
        return { changes: result.rowCount };
      },
    };
  }

  async exec(sql: string) {
    await this.ready;
    await (this.currentExecutor() as any).query(sql);
  }

  async transaction<T>(handler: (database: PostgresDb) => Promise<T>) {
    await this.ready;
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const transactionDb = new PostgresDb(
        this.pool,
        client,
        this.options,
        this.transactionStore,
        this.ready,
      );
      const result = await this.transactionStore.run(client, async () => handler(transactionDb));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors when the transaction has already been closed.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
    if (this.options.memory || !this.options.testSchema || !this.options.schemaName) {
      return;
    }

    const client = new Client({ connectionString: this.options.baseUrl });
    try {
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(this.options.schemaName)} CASCADE`);
    } finally {
      await client.end();
    }
  }

  private async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[],
  ) {
    await this.ready;
    return (await (this.currentExecutor() as any).query(sql, params)) as { rows: T[]; rowCount: number };
  }

  private currentExecutor() {
    return this.transactionStore.getStore() ?? this.executor;
  }
}

export async function migrate(db: SqliteDb) {
  await db.ready;
  const schemaPath = findSchemaPath();
  const schema = fs.readFileSync(schemaPath, "utf-8");
  await db.exec(schema);
  await migrateStoreEnabledColumn(db);
  await migrateProductBomPrimaryKey(db);
}

export function openDatabase(connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "") {
  if (connectionString === ":memory:") {
    return openMemoryDatabase();
  }

  const baseUrl = resolveConnectionString(connectionString);
  const schemaName = null;
  const pool = new Pool(
    {
      connectionString: baseUrl,
      max: databasePoolMax(),
    },
  );

  const ready = Promise.resolve();
  const transactionStore = new AsyncLocalStorage<PoolClientLike>();

  return new PostgresDb(
    pool,
    pool,
    {
      baseUrl,
      schemaName,
      testSchema: false,
      memory: false,
    },
    transactionStore,
    ready,
  );
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function databasePoolMax() {
  const configured = Number.parseInt(process.env.PG_POOL_MAX ?? "", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_POOL_MAX;
}

function resolveConnectionString(connectionString: string) {
  if (connectionString && connectionString !== ":memory:") {
    return connectionString;
  }

  const envUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!envUrl) {
    throw new Error("未设置 DATABASE_URL，请提供 PostgreSQL 连接串");
  }
  return envUrl;
}

function compileSql(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
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

async function ensureSchemaExists(baseUrl: string, schemaName: string) {
  const client = new Client({ connectionString: baseUrl });
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
  } finally {
    await client.end();
  }
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function openMemoryDatabase() {
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool: MemoryPool } = memoryDb.adapters.createPg();
  const pool = new MemoryPool() as PoolLike;
  const transactionStore = new AsyncLocalStorage<PoolClientLike>();

  return new PostgresDb(
    pool,
    pool,
    {
      baseUrl: ":memory:",
      schemaName: null,
      testSchema: false,
      memory: true,
    },
    transactionStore,
    Promise.resolve(),
  );
}

async function migrateProductBomPrimaryKey(db: SqliteDb) {
  const columns = await db.prepare(
    `
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'product_bom_items'
    `,
  ).all<{ name: string }>();
  if (columns.some((column) => column.name === "id")) {
    return;
  }

  await db.exec("ALTER TABLE product_bom_items ADD COLUMN id TEXT");
  const rows = await db.prepare("SELECT product_id, part_id FROM product_bom_items").all<{
    product_id: string;
    part_id: string;
  }>();
  for (const row of rows) {
    await db.prepare("UPDATE product_bom_items SET id = ? WHERE product_id = ? AND part_id = ?")
      .run(createId("bom"), row.product_id, row.part_id);
  }
  await db.exec("ALTER TABLE product_bom_items DROP CONSTRAINT IF EXISTS product_bom_items_pkey");
  await db.exec("ALTER TABLE product_bom_items ALTER COLUMN id SET NOT NULL");
  await db.exec("ALTER TABLE product_bom_items ADD PRIMARY KEY (id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_product_bom_items_product_id ON product_bom_items(product_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_product_bom_items_part_id ON product_bom_items(part_id)");
}

async function migrateStoreEnabledColumn(db: SqliteDb) {
  const columns = await db.prepare(
    `
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outbound_stores'
    `,
  ).all<{ name: string }>();
  if (columns.some((column) => column.name === "enabled")) {
    return;
  }

  await db.exec("ALTER TABLE outbound_stores ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))");
}
