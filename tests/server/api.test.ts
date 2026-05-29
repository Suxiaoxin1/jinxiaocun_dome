import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, type SqliteDb } from "../../src/server/db";

let db: SqliteDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("database schema", () => {
  it("creates core inventory tables", () => {
    db = openDatabase(":memory:");
    migrate(db);

    const rows = db
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
    expect(tables).toContain("outbound_records");
    expect(tables).toContain("stock_movements");
  });
});
