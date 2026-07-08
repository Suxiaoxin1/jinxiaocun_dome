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
  await migratePurchaseStatusValues(db);
  await migrateOutboundApprovalColumns(db);
  await migrateOutboundQuantityColumns(db);
  await migrateOutboundPlanTables(db);
  await migrateOutboundShipmentItemQuantities(db);
  await migrateOutboundOperators(db);
  await migrateStockMovementSourceTables(db);
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

async function migrateOutboundApprovalColumns(db: SqliteDb) {
  const columns = await db.prepare(
    `
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outbound_records'
    `,
  ).all<{ name: string }>();
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("status")) {
    await db.exec("ALTER TABLE outbound_records ADD COLUMN status TEXT NOT NULL DEFAULT '已出库'");
  }
  if (!names.has("reviewed_by")) {
    await db.exec("ALTER TABLE outbound_records ADD COLUMN reviewed_by TEXT");
  }
  if (!names.has("reviewed_at")) {
    await db.exec("ALTER TABLE outbound_records ADD COLUMN reviewed_at TEXT");
  }
}

async function migrateOutboundQuantityColumns(db: SqliteDb) {
  const columns = await db.prepare(
    `
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outbound_records'
    `,
  ).all<{ name: string }>();
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("pre_outbound_quantity")) {
    await db.exec("ALTER TABLE outbound_records ADD COLUMN pre_outbound_quantity INTEGER NOT NULL DEFAULT 1 CHECK (pre_outbound_quantity > 0)");
    await db.exec("UPDATE outbound_records SET pre_outbound_quantity = outbound_quantity");
  }
  if (!names.has("actual_outbound_quantity")) {
    await db.exec("ALTER TABLE outbound_records ADD COLUMN actual_outbound_quantity INTEGER NOT NULL DEFAULT 1 CHECK (actual_outbound_quantity > 0)");
    await db.exec("UPDATE outbound_records SET actual_outbound_quantity = outbound_quantity");
  }
}

async function migrateOutboundPlanTables(db: SqliteDb) {
  await db.exec([
    "CREATE TABLE IF NOT EXISTS store_products (",
    "  store_id TEXT NOT NULL REFERENCES outbound_stores(id) ON DELETE CASCADE,",
    "  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,",
    "  created_at TEXT NOT NULL,",
    "  PRIMARY KEY (store_id, product_id)",
    ")",
  ].join("\n"));
  await db.exec("CREATE INDEX IF NOT EXISTS idx_store_products_product_id ON store_products(product_id)");

  await db.exec([
    "CREATE TABLE IF NOT EXISTS user_stores (",
    "  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "  store_id TEXT NOT NULL REFERENCES outbound_stores(id) ON DELETE CASCADE,",
    "  created_at TEXT NOT NULL,",
    "  PRIMARY KEY (user_id, store_id)",
    ")",
  ].join("\n"));
  await db.exec("CREATE INDEX IF NOT EXISTS idx_user_stores_store_id ON user_stores(store_id)");

  await db.exec([
    "CREATE TABLE IF NOT EXISTS outbound_plans (",
    "  id TEXT PRIMARY KEY,",
    "  plan_no TEXT NOT NULL UNIQUE,",
    "  store_id TEXT NOT NULL REFERENCES outbound_stores(id),",
    "  operator_name TEXT NOT NULL,",
    "  status TEXT NOT NULL CHECK (status IN ('预出库', '部分发货', '已出库', '已取消')),",
    "  remark TEXT,",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL",
    ")",
  ].join("\n"));
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_plans_store_id ON outbound_plans(store_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_plans_status ON outbound_plans(status)");

  await db.exec([
    "CREATE TABLE IF NOT EXISTS outbound_plan_items (",
    "  id TEXT PRIMARY KEY,",
    "  plan_id TEXT NOT NULL REFERENCES outbound_plans(id) ON DELETE CASCADE,",
    "  product_id TEXT NOT NULL REFERENCES products(id),",
    "  pre_outbound_quantity INTEGER NOT NULL CHECK (pre_outbound_quantity > 0),",
    "  shipped_quantity INTEGER NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0),",
    "  cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL",
    ")",
  ].join("\n"));
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_plan_items_plan_id ON outbound_plan_items(plan_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_plan_items_product_id ON outbound_plan_items(product_id)");

  await db.exec([
    "CREATE TABLE IF NOT EXISTS outbound_shipments (",
    "  id TEXT PRIMARY KEY,",
    "  shipment_no TEXT NOT NULL UNIQUE,",
    "  plan_id TEXT NOT NULL REFERENCES outbound_plans(id) ON DELETE CASCADE,",
    "  status TEXT NOT NULL CHECK (status IN ('待审核', '已出库')),",
    "  outbound_time TEXT NOT NULL,",
    "  operator_name TEXT NOT NULL,",
    "  shipment_type TEXT,",
    "  goods_id TEXT,",
    "  pickup_no TEXT,",
    "  carton_count INTEGER,",
    "  weight REAL,",
    "  dimensions TEXT,",
    "  remark TEXT,",
    "  reviewed_by TEXT,",
    "  reviewed_at TEXT,",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL",
    ")",
  ].join("\n"));
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_shipments_plan_id ON outbound_shipments(plan_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_shipments_status ON outbound_shipments(status)");

  await db.exec([
    "CREATE TABLE IF NOT EXISTS outbound_shipment_items (",
    "  id TEXT PRIMARY KEY,",
    "  shipment_id TEXT NOT NULL REFERENCES outbound_shipments(id) ON DELETE CASCADE,",
    "  plan_item_id TEXT NOT NULL REFERENCES outbound_plan_items(id),",
    "  product_id TEXT NOT NULL REFERENCES products(id),",
    "  shipped_quantity INTEGER NOT NULL CHECK (shipped_quantity >= 0),",
    "  before_remaining_quantity INTEGER NOT NULL CHECK (before_remaining_quantity >= 0),",
    "  after_remaining_quantity INTEGER NOT NULL CHECK (after_remaining_quantity >= 0),",
    "  finish_remaining INTEGER NOT NULL DEFAULT 0 CHECK (finish_remaining IN (0, 1)),",
    "  created_at TEXT NOT NULL",
    ")",
  ].join("\n"));
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_shipment_items_shipment_id ON outbound_shipment_items(shipment_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_outbound_shipment_items_plan_item_id ON outbound_shipment_items(plan_item_id)");
}

async function migrateOutboundOperators(db: SqliteDb) {
  await db.exec([
    "CREATE TABLE IF NOT EXISTS outbound_operators (",
    "  id TEXT PRIMARY KEY,",
    "  name TEXT NOT NULL UNIQUE,",
    "  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL",
    ")",
  ].join("\n"));
}

async function migrateOutboundShipmentItemQuantities(db: SqliteDb) {
  await db.exec("ALTER TABLE outbound_shipment_items DROP CONSTRAINT IF EXISTS outbound_shipment_items_shipped_quantity_check");
  await db.exec("ALTER TABLE outbound_shipment_items DROP CONSTRAINT IF EXISTS outbound_shipment_items_constraint_1");
  await db.exec("ALTER TABLE outbound_shipment_items ADD CONSTRAINT outbound_shipment_items_shipped_quantity_check CHECK (shipped_quantity >= 0)");
}

async function migrateStockMovementSourceTables(db: SqliteDb) {
  await db.exec("ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source_table_check");
  await db.exec("ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_constraint_4");
  await db.exec("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source_table_check CHECK (source_table IN ('purchase_receipts', 'other_inbounds', 'outbound_records', 'outbound_shipments', 'stocktakes'))");
}

async function migratePurchaseStatusValues(db: SqliteDb) {
  await db.exec("ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check");
  await db.exec("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
  await db.exec("ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_constraint_1");
  await db.exec("ALTER TABLE purchase_receipts DROP CONSTRAINT IF EXISTS purchase_receipts_status_check");
  await db.exec("ALTER TABLE purchase_receipts DROP CONSTRAINT IF EXISTS purchase_receipts_constraint_3");

  await db.exec(`
    UPDATE purchase_orders
    SET status = CASE status
      WHEN '缺货' THEN '工厂缺货'
      WHEN '已签收' THEN '已入库'
      WHEN '部分签收' THEN '部分入库'
      ELSE status
    END
  `);
  await db.exec(`
    UPDATE purchase_receipts
    SET status = CASE status
      WHEN '缺货' THEN '工厂缺货'
      WHEN '已签收' THEN '已入库'
      WHEN '部分签收' THEN '部分入库'
      ELSE status
    END
  `);

  await db.exec("ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check");
  await db.exec("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('已下单', '在途', '工厂缺货', '已入库', '部分入库'))");
  await db.exec("ALTER TABLE purchase_receipts DROP CONSTRAINT IF EXISTS purchase_receipts_status_check");
  await db.exec("ALTER TABLE purchase_receipts ADD CONSTRAINT purchase_receipts_status_check CHECK (status IN ('已下单', '在途', '工厂缺货', '已入库', '部分入库'))");
  await db.exec("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator', 'purchaser', 'inbound', 'outbound', 'operation'))");
}
