import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, type SqliteDb } from "../../src/server/db";

let db: SqliteDb | null = null;
const timestamp = "2026-05-29T00:00:00.000Z";

afterEach(() => {
  db?.close();
  db = null;
});

describe("database schema", () => {
  function openMigratedDatabase() {
    db = openDatabase(":memory:");
    migrate(db);
    return db;
  }

  function insertPart(database: SqliteDb, id: string, code: string) {
    database
      .prepare(
        `
        INSERT INTO parts (id, code, name, status, created_at, updated_at)
        VALUES (?, ?, ?, '在售', ?, ?)
        `,
      )
      .run(id, code, code, timestamp, timestamp);
  }

  function insertProduct(database: SqliteDb, id: string, code: string) {
    database
      .prepare(
        `
        INSERT INTO products (id, code, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(id, code, code, timestamp, timestamp);
  }

  function insertPurchaseOrder(database: SqliteDb, id: string, partId: string) {
    database
      .prepare(
        `
        INSERT INTO purchase_orders (
          id,
          order_no,
          part_id,
          order_quantity,
          status,
          order_time,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 5, '在途', ?, ?, ?)
        `,
      )
      .run(id, `po-${id}`, partId, timestamp, timestamp, timestamp);
  }

  it("creates core inventory tables", () => {
    const database = openMigratedDatabase();

    const rows = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tables = rows.map((row) => row.name);

    expect(tables).toContain("users");
    expect(tables).toContain("sessions");
    expect(tables).toContain("parts");
    expect(tables).toContain("products");
    expect(tables).toContain("product_bom_items");
    expect(tables).toContain("part_stock");
    expect(tables).toContain("purchase_orders");
    expect(tables).toContain("purchase_receipts");
    expect(tables).toContain("other_inbounds");
    expect(tables).toContain("outbound_stores");
    expect(tables).toContain("outbound_records");
    expect(tables).toContain("stocktakes");
    expect(tables).toContain("stock_movements");
  });

  it("rejects purchase receipt inbound quantities above purchase quantity", () => {
    const database = openMigratedDatabase();
    insertPart(database, "part-1", "P-1");
    insertPurchaseOrder(database, "order-1", "part-1");

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO purchase_receipts (
            id,
            receipt_no,
            purchase_order_id,
            part_id,
            purchase_quantity,
            inbound_quantity,
            status,
            created_at,
            updated_at
          )
          VALUES ('receipt-1', 'R-1', 'order-1', 'part-1', 2, 3, '部分签收', ?, ?)
          `,
        )
        .run(timestamp, timestamp),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects purchase receipt parts that differ from the purchase order part", () => {
    const database = openMigratedDatabase();
    insertPart(database, "part-1", "P-1");
    insertPart(database, "part-2", "P-2");
    insertPurchaseOrder(database, "order-1", "part-1");

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO purchase_receipts (
            id,
            receipt_no,
            purchase_order_id,
            part_id,
            purchase_quantity,
            inbound_quantity,
            status,
            created_at,
            updated_at
          )
          VALUES ('receipt-1', 'R-1', 'order-1', 'part-2', 2, 1, '部分签收', ?, ?)
          `,
        )
        .run(timestamp, timestamp),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects stock movements with zero quantity deltas", () => {
    const database = openMigratedDatabase();
    insertPart(database, "part-1", "P-1");

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO stock_movements (
            id,
            part_id,
            movement_type,
            quantity_delta,
            source_id,
            source_table,
            created_at
          )
          VALUES ('movement-1', 'part-1', '采购入库', 0, 'receipt-1', 'purchase_receipts', ?)
          `,
        )
        .run(timestamp),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects stock movements with invalid source tables", () => {
    const database = openMigratedDatabase();
    insertPart(database, "part-1", "P-1");

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO stock_movements (
            id,
            part_id,
            movement_type,
            quantity_delta,
            source_id,
            source_table,
            created_at
          )
          VALUES ('movement-1', 'part-1', '采购入库', 1, 'receipt-1', 'unknown_table', ?)
          `,
        )
        .run(timestamp),
    ).toThrow(/CHECK constraint failed/);
  });

  it("cascades product deletion to product BOM items", () => {
    const database = openMigratedDatabase();
    insertPart(database, "part-1", "P-1");
    insertProduct(database, "product-1", "SKU-1");
    database
      .prepare("INSERT INTO product_bom_items (product_id, part_id, quantity) VALUES (?, ?, ?)")
      .run("product-1", "part-1", 2);

    database.prepare("DELETE FROM products WHERE id = ?").run("product-1");

    const count = database
      .prepare("SELECT COUNT(*) AS count FROM product_bom_items")
      .get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("cascades user deletion to sessions", () => {
    const database = openMigratedDatabase();
    database
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
        VALUES ('user-1', 'admin', 'Admin', 'hash', 'admin', ?, ?)
        `,
      )
      .run(timestamp, timestamp);
    database
      .prepare(
        `
        INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
        VALUES ('session-1', 'user-1', 'token-hash', ?, ?)
        `,
      )
      .run(timestamp, timestamp);

    database.prepare("DELETE FROM users WHERE id = ?").run("user-1");

    const count = database.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });
});
