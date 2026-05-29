import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, type SqliteDb } from "../../src/server/db";
import {
  createOutboundRecord,
  createPart,
  createProductWithBom,
  createPurchaseOrder,
  createStore,
  deleteOtherInbound,
  deleteOutboundRecord,
  deletePurchaseOrder,
  deleteStocktake,
  getPartStock,
  getPartUsageFromOutboundSince,
  receivePurchaseReceipt,
  updateStockRemark,
  updateStore,
} from "../../src/server/repositories";

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

  it("sets the schema version on a fresh database", () => {
    const database = openMigratedDatabase();

    const version = database.pragma("user_version", { simple: true });

    expect(version).toBe(1);
  });

  it("rejects unversioned non-empty databases", () => {
    db = openDatabase(":memory:");
    db.exec("CREATE TABLE legacy_table (id TEXT PRIMARY KEY)");

    expect(() => migrate(db as SqliteDb)).toThrow("数据库结构版本未知，请备份后重建数据库");
  });

  it("rejects databases newer than the app supports", () => {
    db = openDatabase(":memory:");
    db.pragma("user_version = 2");

    expect(() => migrate(db as SqliteDb)).toThrow(
      "数据库结构版本 2 高于当前应用支持的版本 1",
    );
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

  it("cascades purchase order deletion to purchase receipts", () => {
    const database = openMigratedDatabase();
    insertPart(database, "part-1", "P-1");
    insertPurchaseOrder(database, "order-1", "part-1");
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
        VALUES ('receipt-1', 'R-1', 'order-1', 'part-1', 2, 1, '部分签收', ?, ?)
        `,
      )
      .run(timestamp, timestamp);

    database.prepare("DELETE FROM purchase_orders WHERE id = ?").run("order-1");

    const count = database.prepare("SELECT COUNT(*) AS count FROM purchase_receipts").get() as {
      count: number;
    };
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

describe("inventory repositories", () => {
  function openMigratedDatabase() {
    db = openDatabase(":memory:");
    migrate(db);
    return db;
  }

  function createTestPart(database: SqliteDb, suffix: string) {
    return createPart(database, {
      code: `P-${suffix}`,
      name: `Part ${suffix}`,
      status: "在售",
      weight: null,
      imageUrl: null,
      specification: null,
      remark: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function addOtherInbound(
    database: SqliteDb,
    partId: string,
    quantity: number,
    id = "other-inbound-1",
  ) {
    database
      .prepare(
        `
        INSERT INTO other_inbounds (
          id,
          inbound_no,
          part_id,
          inbound_quantity,
          inbound_time,
          operator_name,
          remark,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, 'Operator', 'manual inbound', ?)
        `,
      )
      .run(id, `OI-${id}`, partId, quantity, timestamp, timestamp);
    database.prepare("UPDATE part_stock SET quantity = quantity + ? WHERE part_id = ?").run(quantity, partId);
  }

  it("createPurchaseOrder creates a matching empty purchase receipt", () => {
    const database = openMigratedDatabase();
    const part = createTestPart(database, "PO");

    const order = createPurchaseOrder(database, {
      orderNo: "PO-001",
      logisticsNo: "L-001",
      partId: part.id,
      orderQuantity: 8,
      status: "在途",
      remark: "order remark",
      orderTime: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const receipt = database
      .prepare(
        `
        SELECT receipt_no, purchase_order_id, part_id, purchase_quantity, inbound_quantity, status
        FROM purchase_receipts
        WHERE purchase_order_id = ?
        `,
      )
      .get(order.id) as {
      receipt_no: string;
      purchase_order_id: string;
      part_id: string;
      purchase_quantity: number;
      inbound_quantity: number;
      status: string;
    };
    expect(receipt).toEqual({
      receipt_no: "PO-001",
      purchase_order_id: order.id,
      part_id: part.id,
      purchase_quantity: 8,
      inbound_quantity: 0,
      status: "在途",
    });
  });

  it("receivePurchaseReceipt updates receipt, stock, order status, and movement", () => {
    const database = openMigratedDatabase();
    const part = createTestPart(database, "RECEIVE");
    const order = createPurchaseOrder(database, {
      orderNo: "PO-002",
      partId: part.id,
      orderQuantity: 10,
      status: "在途",
      orderTime: timestamp,
    });
    const receipt = database
      .prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(order.id) as { id: string };

    receivePurchaseReceipt(database, {
      id: receipt.id,
      inboundQuantity: 6,
      status: "部分签收",
      remark: "arrived partly",
      inboundTime: "2026-05-29T01:00:00.000Z",
    });

    const updatedReceipt = database
      .prepare("SELECT inbound_quantity, status, remark, inbound_time FROM purchase_receipts WHERE id = ?")
      .get(receipt.id) as {
      inbound_quantity: number;
      status: string;
      remark: string;
      inbound_time: string;
    };
    expect(updatedReceipt).toEqual({
      inbound_quantity: 6,
      status: "部分签收",
      remark: "arrived partly",
      inbound_time: "2026-05-29T01:00:00.000Z",
    });
    expect(getPartStock(database, part.id)?.quantity).toBe(6);
    expect(database.prepare("SELECT status FROM purchase_orders WHERE id = ?").get(order.id)).toEqual({
      status: "部分签收",
    });
    expect(
      database
        .prepare("SELECT movement_type, quantity_delta, source_id, source_table FROM stock_movements")
        .get(),
    ).toEqual({
      movement_type: "采购入库",
      quantity_delta: 6,
      source_id: receipt.id,
      source_table: "purchase_receipts",
    });
  });

  it("createOutboundRecord consumes BOM stock and writes movements", () => {
    const database = openMigratedDatabase();
    const partA = createTestPart(database, "A");
    const partB = createTestPart(database, "B");
    database.prepare("UPDATE part_stock SET quantity = 20 WHERE part_id = ?").run(partA.id);
    database.prepare("UPDATE part_stock SET quantity = 20 WHERE part_id = ?").run(partB.id);
    const product = createProductWithBom(database, {
      code: "SKU-001",
      name: "Product",
      remark: null,
      bomItems: [
        { partId: partA.id, quantity: 2 },
        { partId: partB.id, quantity: 3 },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const store = createStore(database, { name: "Main Store", remark: "store remark" });

    const outbound = createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 4,
      outboundTime: timestamp,
      operatorName: "Operator",
      remark: "ship",
    });

    expect(getPartStock(database, partA.id)?.quantity).toBe(12);
    expect(getPartStock(database, partB.id)?.quantity).toBe(8);
    const movements = database
      .prepare("SELECT part_id, movement_type, quantity_delta, source_id FROM stock_movements ORDER BY part_id")
      .all() as Array<{ part_id: string; movement_type: string; quantity_delta: number; source_id: string }>;
    expect(movements).toHaveLength(2);
    expect(movements).toEqual(expect.arrayContaining([
      { part_id: partA.id, movement_type: "产品出库", quantity_delta: -8, source_id: outbound.id },
      { part_id: partB.id, movement_type: "产品出库", quantity_delta: -12, source_id: outbound.id },
    ]));
  });

  it("createOutboundRecord rejects insufficient stock without partial deductions", () => {
    const database = openMigratedDatabase();
    const partA = createTestPart(database, "LOW-A");
    const partB = createTestPart(database, "LOW-B");
    database.prepare("UPDATE part_stock SET quantity = 10 WHERE part_id = ?").run(partA.id);
    database.prepare("UPDATE part_stock SET quantity = 1 WHERE part_id = ?").run(partB.id);
    const product = createProductWithBom(database, {
      code: "SKU-LOW",
      name: "Low Stock Product",
      bomItems: [
        { partId: partA.id, quantity: 2 },
        { partId: partB.id, quantity: 3 },
      ],
    });
    const store = createStore(database, { name: "Reject Store", remark: null });

    expect(() =>
      createOutboundRecord(database, {
        productId: product.id,
        storeId: store.id,
        outboundQuantity: 1,
        outboundTime: timestamp,
        operatorName: "Operator",
        remark: null,
      }),
    ).toThrow(/库存不足/);

    expect(getPartStock(database, partA.id)?.quantity).toBe(10);
    expect(getPartStock(database, partB.id)?.quantity).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbound_records").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM stock_movements").get()).toEqual({ count: 0 });
  });

  it("updateStore modifies name, remark, and updated_at", () => {
    const database = openMigratedDatabase();
    const store = createStore(database, { name: "Old Store", remark: "old" });
    const before = database.prepare("SELECT updated_at FROM outbound_stores WHERE id = ?").get(store.id) as {
      updated_at: string;
    };

    const updated = updateStore(database, store.id, { name: "New Store", remark: "new" });

    const row = database.prepare("SELECT name, remark, updated_at FROM outbound_stores WHERE id = ?").get(store.id) as {
      name: string;
      remark: string;
      updated_at: string;
    };
    expect(updated).toEqual({ id: store.id, name: "New Store" });
    expect(row.name).toBe("New Store");
    expect(row.remark).toBe("new");
    expect(row.updated_at).not.toBe(before.updated_at);
  });

  it("updateStockRemark changes only remark and updated_at", () => {
    const database = openMigratedDatabase();
    const part = createTestPart(database, "REMARK");
    database.prepare("UPDATE part_stock SET quantity = 9 WHERE part_id = ?").run(part.id);

    const stock = updateStockRemark(database, part.id, "counted");

    expect(stock.quantity).toBe(9);
    expect(stock.remark).toBe("counted");
    expect(getPartStock(database, part.id)?.quantity).toBe(9);
  });

  it("deletePurchaseOrder only deletes orders with empty matching receipts", () => {
    const database = openMigratedDatabase();
    const part = createTestPart(database, "DELETE-PO");
    const deletable = createPurchaseOrder(database, {
      orderNo: "PO-DEL-1",
      partId: part.id,
      orderQuantity: 2,
      status: "在途",
      orderTime: timestamp,
    });
    const blocked = createPurchaseOrder(database, {
      orderNo: "PO-DEL-2",
      partId: part.id,
      orderQuantity: 2,
      status: "在途",
      orderTime: timestamp,
    });
    const blockedReceipt = database
      .prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(blocked.id) as { id: string };
    receivePurchaseReceipt(database, {
      id: blockedReceipt.id,
      inboundQuantity: 1,
      status: "部分签收",
      inboundTime: timestamp,
    });

    expect(() => deletePurchaseOrder(database, blocked.id)).toThrow(/已入库/);
    deletePurchaseOrder(database, deletable.id);

    expect(database.prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE id = ?").get(deletable.id)).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE id = ?").get(blocked.id)).toEqual({
      count: 1,
    });
  });

  it("deleteOtherInbound reverses stock, writes compensation movement, and deletes source row", () => {
    const database = openMigratedDatabase();
    const part = createTestPart(database, "OTHER");
    addOtherInbound(database, part.id, 5, "other-1");

    deleteOtherInbound(database, "other-1");

    expect(getPartStock(database, part.id)?.quantity).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM other_inbounds WHERE id = 'other-1'").get()).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT movement_type, quantity_delta, source_id FROM stock_movements").get()).toEqual({
      movement_type: "其它入库",
      quantity_delta: -5,
      source_id: "other-1",
    });
  });

  it("deleteOutboundRecord restores BOM stock, writes compensation movements, and deletes source row", () => {
    const database = openMigratedDatabase();
    const partA = createTestPart(database, "RESTORE-A");
    const partB = createTestPart(database, "RESTORE-B");
    database.prepare("UPDATE part_stock SET quantity = 20 WHERE part_id IN (?, ?)").run(partA.id, partB.id);
    const product = createProductWithBom(database, {
      code: "SKU-RESTORE",
      name: "Restore Product",
      bomItems: [
        { partId: partA.id, quantity: 1 },
        { partId: partB.id, quantity: 2 },
      ],
    });
    const store = createStore(database, { name: "Restore Store", remark: null });
    const outbound = createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 3,
      outboundTime: timestamp,
      operatorName: "Operator",
      remark: null,
    });

    deleteOutboundRecord(database, outbound.id);

    expect(getPartStock(database, partA.id)?.quantity).toBe(20);
    expect(getPartStock(database, partB.id)?.quantity).toBe(20);
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbound_records WHERE id = ?").get(outbound.id)).toEqual({
      count: 0,
    });
    const compensation = database
      .prepare("SELECT part_id, quantity_delta FROM stock_movements WHERE quantity_delta > 0 ORDER BY part_id")
      .all() as Array<{ part_id: string; quantity_delta: number }>;
    expect(compensation).toHaveLength(2);
    expect(compensation).toEqual(expect.arrayContaining([
      { part_id: partA.id, quantity_delta: 3 },
      { part_id: partB.id, quantity_delta: 6 },
    ]));
  });

  it("deleteStocktake reverses adjustment, writes compensation movement, and deletes source row", () => {
    const database = openMigratedDatabase();
    const part = createTestPart(database, "STOCKTAKE");
    database.prepare("UPDATE part_stock SET quantity = 7 WHERE part_id = ?").run(part.id);
    database
      .prepare(
        `
        INSERT INTO stocktakes (id, part_id, previous_quantity, actual_quantity, remark, stocktake_time, created_at)
        VALUES ('stocktake-1', ?, 10, 7, 'count', ?, ?)
        `,
      )
      .run(part.id, timestamp, timestamp);

    deleteStocktake(database, "stocktake-1");

    expect(getPartStock(database, part.id)?.quantity).toBe(10);
    expect(database.prepare("SELECT COUNT(*) AS count FROM stocktakes WHERE id = 'stocktake-1'").get()).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT movement_type, quantity_delta, source_id FROM stock_movements").get()).toEqual({
      movement_type: "盘点调整",
      quantity_delta: 3,
      source_id: "stocktake-1",
    });
  });

  it("getPartUsageFromOutboundSince aggregates BOM usage since a timestamp", () => {
    const database = openMigratedDatabase();
    const partA = createTestPart(database, "USAGE-A");
    const partB = createTestPart(database, "USAGE-B");
    database.prepare("UPDATE part_stock SET quantity = 100 WHERE part_id IN (?, ?)").run(partA.id, partB.id);
    const product = createProductWithBom(database, {
      code: "SKU-USAGE",
      name: "Usage Product",
      bomItems: [
        { partId: partA.id, quantity: 2 },
        { partId: partB.id, quantity: 5 },
      ],
    });
    const store = createStore(database, { name: "Usage Store", remark: null });
    createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 1,
      outboundTime: "2026-05-28T23:59:59.000Z",
      operatorName: "Operator",
      remark: null,
    });
    createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 3,
      outboundTime: "2026-05-29T00:00:00.000Z",
      operatorName: "Operator",
      remark: null,
    });

    const usage = getPartUsageFromOutboundSince(database, "2026-05-29T00:00:00.000Z");
    expect(usage).toHaveLength(2);
    expect(usage).toEqual(expect.arrayContaining([
      { partId: partA.id, quantity: 6 },
      { partId: partB.id, quantity: 15 },
    ]));
  });
});
