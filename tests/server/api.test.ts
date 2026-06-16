import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createApp } from "../../src/server/app";
import { migrate, openDatabase, type SqliteDb } from "../../src/server/db";
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

afterEach(async () => {
  vi.useRealTimers();
  await db?.close();
  db = null;
});

async function openMigratedDatabase() {
  db = openDatabase(":memory:");
  await migrate(db);
  return db;
}

async function openApi() {
  db = openDatabase(":memory:");
  const app = await createApp(db);
  return { app, database: db };
}

async function loginAgent(app: Awaited<ReturnType<typeof createApp>>, username = "admin", password = "admin123") {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username, password }).expect(200);
  return agent;
}

async function createApiPart(agent: ReturnType<typeof request.agent>, code: string) {
  const response = await agent
    .post("/api/parts")
    .send({
      code,
      name: `API Part ${code}`,
      weight: null,
      imageUrl: null,
      specification: "api spec",
      remark: null,
      currentStock: 0,
    })
    .expect(201);
  return response.body.part as { id: string; code: string; name: string };
}

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createPngBuffer(width: number, height: number) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rows = Array.from({ length: height }, () => {
    const row = Buffer.alloc(width * 4 + 1);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 4;
      row[offset] = 220;
      row[offset + 1] = 48;
      row[offset + 2] = 48;
      row[offset + 3] = 255;
    }
    return row;
  });

  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

describe("database schema", () => {
  it("creates the core inventory tables", async () => {
    const database = await openMigratedDatabase();

    const rows = (await database
      .prepare(
        `
        SELECT table_name AS name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
        `,
      )
      .all()) as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "users",
        "sessions",
        "parts",
        "products",
        "product_bom_items",
        "part_stock",
        "purchase_orders",
        "purchase_receipts",
        "other_inbounds",
        "outbound_stores",
        "outbound_records",
        "stocktakes",
        "stock_movements",
        "low_stock_ignores",
      ]),
    );
  });

  it("uses the V3 column layout", async () => {
    const database = await openMigratedDatabase();

    const partColumns = ((await database
      .prepare(
        `
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'parts'
        ORDER BY ordinal_position
        `,
      )
      .all()) as Array<{ name: string }>).map((column) => column.name);
    const otherInboundColumns = ((await database
      .prepare(
        `
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'other_inbounds'
        ORDER BY ordinal_position
        `,
      )
      .all()) as Array<{ name: string }>).map((column) => column.name);

    expect(partColumns).not.toContain("status");
    expect(otherInboundColumns).toContain("inbound_source");
    expect(otherInboundColumns).not.toContain("inbound_no");
  });

  it("can be applied again without dropping existing data", async () => {
    const database = await openMigratedDatabase();

    await database
      .prepare(
        `
        INSERT INTO parts (id, code, name, created_at, updated_at)
        VALUES ('part-pre', 'P-PRE', 'Preloaded Part', ?, ?)
        `,
      )
      .run(timestamp, timestamp);

    await migrate(database);

    expect((await database.prepare("SELECT code, name FROM parts WHERE id = 'part-pre'").get()) as {
      code: string;
      name: string;
    }).toEqual({
      code: "P-PRE",
      name: "Preloaded Part",
    });
  });
});

describe("inventory repositories", () => {
  async function createTestPart(database: SqliteDb, suffix: string) {
    return createPart(database, {
      code: `P-${suffix}`,
      name: `Part ${suffix}`,
      weight: null,
      imageUrl: null,
      specification: null,
      remark: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  it("createPart returns part fields and creates empty stock", async () => {
    const database = await openMigratedDatabase();

    const part = await createPart(database, {
      code: "P-CREATE",
      name: "Created Part",
      weight: 1.25,
      imageUrl: "https://example.com/part.png",
      specification: "M8",
      remark: "created directly",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(part).toEqual({
      id: expect.stringMatching(/^part_/),
      code: "P-CREATE",
      name: "Created Part",
      weight: 1.25,
      imageUrl: "https://example.com/part.png",
      specification: "M8",
      remark: "created directly",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(await getPartStock(database, part.id)).toEqual({
      partId: part.id,
      quantity: 0,
      remark: null,
      lastStocktakeAt: null,
    });
  });

  it("createProductWithBom inserts the product and BOM item quantities", async () => {
    const database = await openMigratedDatabase();
    const partA = await createTestPart(database, "BOM-A");
    const partB = await createTestPart(database, "BOM-B");

    const product = await createProductWithBom(database, {
      code: "SKU-CREATE",
      name: "Created Product",
      remark: "bom product",
      bomItems: [
        { partId: partA.id, quantity: 2 },
        { partId: partB.id, quantity: 5 },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(product).toEqual({
      id: expect.stringMatching(/^product_/),
      code: "SKU-CREATE",
      name: "Created Product",
      imageUrl: null,
      remark: "bom product",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const bomRows = (await database
      .prepare("SELECT product_id, part_id, quantity FROM product_bom_items WHERE product_id = ?")
      .all(product.id)) as Array<{ product_id: string; part_id: string; quantity: number }>;
    expect(bomRows).toEqual(
      expect.arrayContaining([
        { product_id: product.id, part_id: partA.id, quantity: 2 },
        { product_id: product.id, part_id: partB.id, quantity: 5 },
      ]),
    );
  });

  it("allows duplicate BOM rows and merges them when consuming stock", async () => {
    const database = await openMigratedDatabase();
    const partA = await createTestPart(database, "DUP-A");
    const partB = await createTestPart(database, "DUP-B");
    await database.prepare("UPDATE part_stock SET quantity = 100 WHERE part_id IN (?, ?)").run(partA.id, partB.id);

    const product = await createProductWithBom(database, {
      code: "SKU-DUP",
      name: "Duplicate BOM Product",
      bomItems: [
        { partId: partA.id, quantity: 3 },
        { partId: partA.id, quantity: 2 },
        { partId: partB.id, quantity: 1 },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const store = await createStore(database, { name: "Duplicate BOM Store", remark: null });

    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 2,
      outboundTime: timestamp,
      operatorName: "Operator",
      remark: null,
    });

    expect((await getPartStock(database, partA.id))?.quantity).toBe(90);
    expect((await getPartStock(database, partB.id))?.quantity).toBe(98);
  });

  it("createPurchaseOrder creates a matching empty purchase receipt", async () => {
    const database = await openMigratedDatabase();
    const part = await createTestPart(database, "PO");

    const order = await createPurchaseOrder(database, {
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

    const receipt = (await database
      .prepare(
        `
        SELECT receipt_no, purchase_order_id, part_id, purchase_quantity, inbound_quantity, status
        FROM purchase_receipts
        WHERE purchase_order_id = ?
        `,
      )
      .get(order.id)) as {
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

  it("receivePurchaseReceipt updates receipt, stock, order status, and movement", async () => {
    const database = await openMigratedDatabase();
    const part = await createTestPart(database, "RECEIVE");
    const order = await createPurchaseOrder(database, {
      orderNo: "PO-002",
      partId: part.id,
      orderQuantity: 10,
      status: "在途",
      orderTime: timestamp,
    });
    const receipt = (await database
      .prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(order.id)) as { id: string };

    await receivePurchaseReceipt(database, {
      id: receipt.id,
      inboundQuantity: 6,
      status: "部分签收",
      remark: "arrived partly",
      inboundTime: "2026-05-29T01:00:00.000Z",
    });

    const updatedReceipt = (await database
      .prepare("SELECT inbound_quantity, status, remark, inbound_time FROM purchase_receipts WHERE id = ?")
      .get(receipt.id)) as {
      inbound_quantity: number;
      status: string;
      remark: string;
      inbound_time: string;
    };
    const stock = await getPartStock(database, part.id);

    expect(updatedReceipt).toEqual({
      inbound_quantity: 6,
      status: "部分签收",
      remark: "arrived partly",
      inbound_time: "2026-05-29T01:00:00.000Z",
    });
    expect(stock?.quantity).toBe(6);
    expect((await database.prepare("SELECT status FROM purchase_orders WHERE id = ?").get(order.id)) as { status: string }).toEqual({
      status: "部分签收",
    });
    expect((await database.prepare("SELECT movement_type, quantity_delta, source_id, source_table FROM stock_movements").get()) as {
      movement_type: string;
      quantity_delta: number;
      source_id: string;
      source_table: string;
    }).toEqual({
      movement_type: "采购入库",
      quantity_delta: 6,
      source_id: receipt.id,
      source_table: "purchase_receipts",
    });
  });

  it("receivePurchaseReceipt can add a later partial receipt without replacing earlier inbound quantity", async () => {
    const database = await openMigratedDatabase();
    const part = await createTestPart(database, "SPLIT");
    const order = await createPurchaseOrder(database, {
      orderNo: "PO-SPLIT",
      partId: part.id,
      orderQuantity: 100,
      status: "在途",
      orderTime: timestamp,
    });
    const receipt = (await database
      .prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(order.id)) as { id: string };

    await receivePurchaseReceipt(database, {
      id: receipt.id,
      inboundQuantity: 90,
      inboundTime: "2026-05-29T01:00:00.000Z",
    });
    await receivePurchaseReceipt(database, {
      id: receipt.id,
      inboundQuantity: 10,
      inboundTime: "2026-05-30T01:00:00.000Z",
      addToExisting: true,
    } as unknown as Parameters<typeof receivePurchaseReceipt>[1]);

    expect((await database.prepare("SELECT inbound_quantity, status FROM purchase_receipts WHERE id = ?").get(receipt.id)) as {
      inbound_quantity: number;
      status: string;
    }).toEqual({
      inbound_quantity: 100,
      status: "已签收",
    });
    expect((await getPartStock(database, part.id))?.quantity).toBe(100);
    expect((await database.prepare("SELECT SUM(quantity_delta) AS total FROM stock_movements WHERE source_id = ?").get(receipt.id)) as {
      total: number;
    }).toEqual({ total: 100 });
  });

  it("createOutboundRecord consumes BOM stock and writes movements", async () => {
    const database = await openMigratedDatabase();
    const partA = await createTestPart(database, "A");
    const partB = await createTestPart(database, "B");
    await database.prepare("UPDATE part_stock SET quantity = 20 WHERE part_id = ?").run(partA.id);
    await database.prepare("UPDATE part_stock SET quantity = 20 WHERE part_id = ?").run(partB.id);
    console.log("before", await getPartStock(database, partA.id), await getPartStock(database, partB.id));
    const product = await createProductWithBom(database, {
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
    const store = await createStore(database, { name: "Main Store", remark: "store remark" });

    const outbound = await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 4,
      outboundTime: timestamp,
      operatorName: "Operator",
      remark: "ship",
    });

    const partAStock = await getPartStock(database, partA.id);
    const partBStock = await getPartStock(database, partB.id);
    const movements = (await database
      .prepare("SELECT part_id, movement_type, quantity_delta, source_id FROM stock_movements ORDER BY part_id")
      .all()) as Array<{ part_id: string; movement_type: string; quantity_delta: number; source_id: string }>;

    expect(partAStock?.quantity).toBe(12);
    expect(partBStock?.quantity).toBe(8);
    expect(movements).toEqual(
      expect.arrayContaining([
        { part_id: partA.id, movement_type: "产品出库", quantity_delta: -8, source_id: outbound.id },
        { part_id: partB.id, movement_type: "产品出库", quantity_delta: -12, source_id: outbound.id },
      ]),
    );
  });

  it("returns readable low stock warnings with part names and codes", async () => {
    const database = await openMigratedDatabase();
    const part = await createPart(database, {
      code: "P-SHORT",
      name: "短缺配件",
      currentStock: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const product = await createProductWithBom(database, {
      code: "SKU-SHORT",
      name: "Short Product",
      bomItems: [{ partId: part.id, quantity: 3 }],
    });
    const store = await createStore(database, { name: "Short Store", remark: null });

    const outbound = await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 1,
      outboundTime: timestamp,
      operatorName: "Operator",
      remark: null,
    });

    expect(outbound.warnings[0]).toContain("短缺配件（P-SHORT）库存不足：需要 3，当前 1，保存后为 -2");
    expect(outbound.warnings[0]).not.toContain(part.id);
  });

  it("updateStore and updateStockRemark modify only the expected fields", async () => {
    const database = await openMigratedDatabase();
    const store = await createStore(database, { name: "Old Store", remark: "old" });
    const part = await createTestPart(database, "REMARK");
    await database.prepare("UPDATE part_stock SET quantity = 9 WHERE part_id = ?").run(part.id);

    const updatedStore = await updateStore(database, store.id, { name: "New Store", remark: "new" });
    const stock = await updateStockRemark(database, part.id, "counted");

    expect(updatedStore).toEqual({ id: store.id, name: "New Store" });
    expect(stock.quantity).toBe(9);
    expect(stock.remark).toBe("counted");
    expect((await database.prepare("SELECT name, remark FROM outbound_stores WHERE id = ?").get(store.id)) as {
      name: string;
      remark: string;
    }).toEqual({ name: "New Store", remark: "new" });
  });

  it("deletePurchaseOrder only deletes orders with empty matching receipts", async () => {
    const database = await openMigratedDatabase();
    const part = await createTestPart(database, "DELETE-PO");
    const deletable = await createPurchaseOrder(database, {
      orderNo: "PO-DEL-1",
      partId: part.id,
      orderQuantity: 2,
      status: "在途",
      orderTime: timestamp,
    });
    const blocked = await createPurchaseOrder(database, {
      orderNo: "PO-DEL-2",
      partId: part.id,
      orderQuantity: 2,
      status: "在途",
      orderTime: timestamp,
    });
    const blockedReceipt = (await database
      .prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(blocked.id)) as { id: string };
    await receivePurchaseReceipt(database, {
      id: blockedReceipt.id,
      inboundQuantity: 1,
      status: "部分签收",
      inboundTime: timestamp,
    });

    await expect(deletePurchaseOrder(database, blocked.id)).rejects.toThrow(/已入库/);
    await deletePurchaseOrder(database, deletable.id);

    expect((await database.prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE id = ?").get(deletable.id)) as {
      count: number;
    }).toEqual({ count: 0 });
    expect((await database.prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE id = ?").get(blocked.id)) as {
      count: number;
    }).toEqual({ count: 1 });
  });

  it("deleteOtherInbound reverses stock and deletes the source row", async () => {
    const database = await openMigratedDatabase();
    const part = await createTestPart(database, "OTHER");

    await database
      .prepare(
        `
        INSERT INTO other_inbounds (
          id,
          inbound_source,
          part_id,
          inbound_quantity,
          inbound_time,
          operator_name,
          remark,
          created_at
        )
        VALUES ('other-1', 'OI-other-1', ?, 5, ?, 'Operator', 'manual inbound', ?)
        `,
      )
      .run(part.id, timestamp, timestamp);
    await database.prepare("UPDATE part_stock SET quantity = quantity + ? WHERE part_id = ?").run(5, part.id);

    await deleteOtherInbound(database, "other-1");

    expect((await getPartStock(database, part.id))?.quantity).toBe(0);
    expect((await database.prepare("SELECT COUNT(*) AS count FROM other_inbounds WHERE id = 'other-1'").get()) as {
      count: number;
    }).toEqual({ count: 0 });
  });

  it("deleteOutboundRecord restores BOM stock", async () => {
    const database = await openMigratedDatabase();
    const partA = await createTestPart(database, "RESTORE-A");
    const partB = await createTestPart(database, "RESTORE-B");
    await database.prepare("UPDATE part_stock SET quantity = 20 WHERE part_id IN (?, ?)").run(partA.id, partB.id);
    const product = await createProductWithBom(database, {
      code: "SKU-RESTORE",
      name: "Restore Product",
      bomItems: [
        { partId: partA.id, quantity: 1 },
        { partId: partB.id, quantity: 2 },
      ],
    });
    const store = await createStore(database, { name: "Restore Store", remark: null });
    const outbound = await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 3,
      outboundTime: timestamp,
      operatorName: "Operator",
      remark: null,
    });

    await deleteOutboundRecord(database, outbound.id);

    expect((await getPartStock(database, partA.id))?.quantity).toBe(20);
    expect((await getPartStock(database, partB.id))?.quantity).toBe(20);
  });

  it("deleteStocktake reverses adjustment", async () => {
    const database = await openMigratedDatabase();
    const part = await createTestPart(database, "STOCKTAKE");
    await database.prepare("UPDATE part_stock SET quantity = 7 WHERE part_id = ?").run(part.id);
    await database
      .prepare(
        `
        INSERT INTO stocktakes (id, part_id, previous_quantity, actual_quantity, remark, stocktake_time, created_at)
        VALUES ('stocktake-1', ?, 10, 7, 'count', ?, ?)
        `,
      )
      .run(part.id, timestamp, timestamp);

    await deleteStocktake(database, "stocktake-1");

    expect((await getPartStock(database, part.id))?.quantity).toBe(10);
  });

  it("getPartUsageFromOutboundSince aggregates BOM usage since a timestamp", async () => {
    const database = await openMigratedDatabase();
    const partA = await createTestPart(database, "USAGE-A");
    const partB = await createTestPart(database, "USAGE-B");
    await database.prepare("UPDATE part_stock SET quantity = 100 WHERE part_id IN (?, ?)").run(partA.id, partB.id);
    const product = await createProductWithBom(database, {
      code: "SKU-USAGE",
      name: "Usage Product",
      bomItems: [
        { partId: partA.id, quantity: 2 },
        { partId: partB.id, quantity: 5 },
      ],
    });
    const store = await createStore(database, { name: "Usage Store", remark: null });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 1,
      outboundTime: "2026-05-28T23:59:59.000Z",
      operatorName: "Operator",
      remark: null,
    });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 3,
      outboundTime: "2026-05-29T00:00:00.000Z",
      operatorName: "Operator",
      remark: null,
    });

    const usage = await getPartUsageFromOutboundSince(database, "2026-05-29T00:00:00.000Z");
    expect(usage).toEqual(
      expect.arrayContaining([
        { partId: partA.id, quantity: 6 },
        { partId: partB.id, quantity: 15 },
      ]),
    );
  });
});

describe("inventory API routes", () => {
  it("POST /api/parts creates a part and stock row behind admin auth", async () => {
    const { app, database } = await openApi();
    const operator = await loginAgent(app, "operator", "operator123");
    await operator
      .post("/api/parts")
      .send({
        code: "API-FORBIDDEN",
        name: "Forbidden",
        weight: null,
        imageUrl: null,
        specification: null,
        remark: null,
        currentStock: 0,
      })
      .expect(403);

    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "API-PART");

    expect(part).toMatchObject({ code: "API-PART", name: "API Part API-PART" });
    expect((await database.prepare("SELECT quantity FROM part_stock WHERE part_id = ?").get(part.id)) as { quantity: number }).toEqual({
      quantity: 0,
    });
  });

  it("purchase order receipt flow updates stock and receipt status", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "API-PO");

    const orderResponse = await admin
      .post("/api/purchase-orders")
      .send({
        orderNo: "API-PO-001",
        logisticsNo: null,
        partId: part.id,
        orderQuantity: 6,
        status: "已签收",
        remark: null,
        orderTime: timestamp,
      })
      .expect(201);

    await admin
      .post(`/api/purchase-receipts/${orderResponse.body.purchaseOrder.id}/receive`)
      .send({
        inboundQuantity: 4,
        status: "部分签收",
        remark: "arrived",
        inboundTime: timestamp,
      })
      .expect(200);

    expect((await database.prepare("SELECT quantity FROM part_stock WHERE part_id = ?").get(part.id)) as { quantity: number }).toEqual({
      quantity: 4,
    });
    expect((await database.prepare("SELECT status, inbound_quantity FROM purchase_receipts WHERE purchase_order_id = ?").get(orderResponse.body.purchaseOrder.id)) as {
      status: string;
      inbound_quantity: number;
    }).toEqual({
      status: "部分签收",
      inbound_quantity: 4,
    });
  });

  it("purchase receipt rows include purchase order time and current stock for list display", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "RECEIPT-TIME");
    await database.prepare("UPDATE part_stock SET quantity = 12 WHERE part_id = ?").run(part.id);

    await admin
      .post("/api/purchase-orders")
      .send({
        orderNo: "PO-RECEIPT-TIME",
        partId: part.id,
        orderQuantity: 2,
        orderTime: "2026-06-10T07:20:00.000Z",
      })
      .expect(201);

    const response = await admin.get("/api/purchase-receipts?q=PO-RECEIPT-TIME").expect(200);

    expect(response.body.purchaseReceipts).toEqual([
      expect.objectContaining({
        orderNo: "PO-RECEIPT-TIME",
        orderTime: "2026-06-10T07:20:00.000Z",
        currentStock: 12,
      }),
    ]);
  });

  it("updates purchase orders and keeps the matching receipt in sync", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "PO-EDIT");
    const created = await admin
      .post("/api/purchase-orders")
      .send({
        orderNo: "PO-EDIT-1",
        logisticsNo: "LOG-OLD",
        partId: part.id,
        orderQuantity: 5,
        status: "在途",
        remark: "旧备注",
        orderTime: "2026-06-09T08:00:00.000Z",
      })
      .expect(201);

    await admin
      .put(`/api/purchase-orders/${created.body.purchaseOrder.id}`)
      .send({
        orderNo: "PO-EDIT-2",
        logisticsNo: "LOG-NEW",
        partId: part.id,
        orderQuantity: 8,
        status: "缺货",
        remark: "厂家缺货，延迟发货",
        orderTime: "2026-06-10T08:00:00.000Z",
      })
      .expect(200);

    const order = await admin.get("/api/purchase-orders?orderNo=PO-EDIT-2").expect(200);
    expect(order.body.purchaseOrders).toEqual([
      expect.objectContaining({
        orderNo: "PO-EDIT-2",
        logisticsNo: "LOG-NEW",
        orderQuantity: 8,
        status: "缺货",
        remark: "厂家缺货，延迟发货",
        orderTime: "2026-06-10T08:00:00.000Z",
      }),
    ]);
    const receipt = await admin.get("/api/purchase-receipts?q=PO-EDIT-2").expect(200);
    expect(receipt.body.purchaseReceipts).toEqual([
      expect.objectContaining({
        receiptNo: "PO-EDIT-2",
        orderNo: "PO-EDIT-2",
        logisticsNo: "LOG-NEW",
        purchaseQuantity: 8,
        status: "缺货",
        remark: "厂家缺货，延迟发货",
      }),
    ]);
  });

  it("filters outbound records by product code, product name, store name, and operator", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const operator = await loginAgent(app, "operator", "operator123");
    const partA = await createApiPart(admin, "OUT-FILTER-A");
    const partB = await createApiPart(admin, "OUT-FILTER-B");
    await database.prepare("UPDATE part_stock SET quantity = 50 WHERE part_id IN (?, ?)").run(partA.id, partB.id);
    const productA = await createProductWithBom(database, {
      code: "SKU-FILTER-A",
      name: "筛选产品甲",
      bomItems: [{ partId: partA.id, quantity: 1 }],
    });
    const productB = await createProductWithBom(database, {
      code: "SKU-FILTER-B",
      name: "筛选产品乙",
      bomItems: [{ partId: partB.id, quantity: 1 }],
    });
    const storeA = await createStore(database, { name: "筛选店铺甲", remark: null });
    const storeB = await createStore(database, { name: "筛选店铺乙", remark: null });

    await operator.post("/api/outbound-records").send({
      productId: productA.id,
      storeId: storeA.id,
      outboundQuantity: 1,
      outboundTime: timestamp,
      operatorName: "张三",
      remark: "备注甲",
    }).expect(201);
    await operator.post("/api/outbound-records").send({
      productId: productB.id,
      storeId: storeB.id,
      outboundQuantity: 1,
      outboundTime: timestamp,
      operatorName: "李四",
      remark: "备注乙",
    }).expect(201);

    const byCode = await admin.get("/api/outbound-records?productCode=SKU-FILTER-A").expect(200);
    expect(byCode.body.outboundRecords.map((record: { productCode: string }) => record.productCode)).toEqual(["SKU-FILTER-A"]);

    const byName = await admin.get("/api/outbound-records?productName=产品乙").expect(200);
    expect(byName.body.outboundRecords.map((record: { productCode: string }) => record.productCode)).toEqual(["SKU-FILTER-B"]);

    const byStore = await admin.get("/api/outbound-records?storeName=店铺甲").expect(200);
    expect(byStore.body.outboundRecords.map((record: { productCode: string }) => record.productCode)).toEqual(["SKU-FILTER-A"]);

    const byOperator = await admin.get("/api/outbound-records?operatorName=李四").expect(200);
    expect(byOperator.body.outboundRecords.map((record: { productCode: string }) => record.productCode)).toEqual(["SKU-FILTER-B"]);

    const byRemark = await admin.get("/api/outbound-records?remark=备注乙").expect(200);
    expect(byRemark.body.outboundRecords.map((record: { productCode: string }) => record.productCode)).toEqual(["SKU-FILTER-B"]);
  });

  it("filters outbound records by time range and rejects ranges longer than 90 days", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "OUT-RANGE");
    await database.prepare("UPDATE part_stock SET quantity = 50 WHERE part_id = ?").run(part.id);
    const product = await createProductWithBom(database, {
      code: "SKU-RANGE",
      name: "范围产品",
      bomItems: [{ partId: part.id, quantity: 1 }],
    });
    const store = await createStore(database, { name: "范围店铺", remark: null });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 1,
      outboundTime: "2026-06-01T00:00:00.000Z",
      operatorName: "范围操作人",
      remark: "范围内",
    });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 1,
      outboundTime: "2026-02-01T00:00:00.000Z",
      operatorName: "范围操作人",
      remark: "范围外",
    });

    const response = await admin
      .get("/api/outbound-records?from=2026-05-01T00:00:00.000Z&to=2026-06-30T23:59:59.999Z")
      .expect(200);
    expect(response.body.outboundRecords.map((record: { remark: string }) => record.remark)).toEqual(["范围内"]);

    await admin
      .get("/api/outbound-records?from=2026-01-01T00:00:00.000Z&to=2026-06-30T23:59:59.999Z")
      .expect(400);
  });

  it("stock rows include 7 and 15 day outbound usage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-11T08:00:00.000Z"));
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "USAGE-STOCK");
    await database.prepare("UPDATE part_stock SET quantity = 50 WHERE part_id = ?").run(part.id);
    const product = await createProductWithBom(database, {
      code: "SKU-USAGE-STOCK",
      name: "库存用量产品",
      bomItems: [{ partId: part.id, quantity: 2 }],
    });
    const store = await createStore(database, { name: "库存用量店铺", remark: null });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 3,
      outboundTime: "2026-06-10T00:00:00.000Z",
      operatorName: "管理员",
      remark: "7天内",
    });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 4,
      outboundTime: "2026-06-01T00:00:00.000Z",
      operatorName: "管理员",
      remark: "15天内",
    });
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 5,
      outboundTime: "2026-05-01T00:00:00.000Z",
      operatorName: "管理员",
      remark: "15天外",
    });

    const response = await admin.get("/api/stock?q=USAGE-STOCK").expect(200);

    expect(response.body.stock).toEqual([
      expect.objectContaining({
        partCode: "USAGE-STOCK",
        outbound7Days: 6,
        outbound15Days: 14,
      }),
    ]);
  });

  it("filters stocktakes by part code, name, date, and remark", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const targetPart = await createApiPart(admin, "ST-FILTER-A");
    const otherPart = await createApiPart(admin, "ST-FILTER-B");
    await admin
      .post("/api/stocktakes")
      .send({ partId: targetPart.id, actualQuantity: 3, remark: "目标备注", stocktakeTime: "2026-06-10T08:00:00.000Z" })
      .expect(201);
    await admin
      .post("/api/stocktakes")
      .send({ partId: otherPart.id, actualQuantity: 5, remark: "其它备注", stocktakeTime: "2026-06-09T08:00:00.000Z" })
      .expect(201);

    const byCode = await admin.get("/api/stocktakes?partCode=ST-FILTER-A").expect(200);
    expect(byCode.body.stocktakes.map((row: { partCode: string }) => row.partCode)).toEqual(["ST-FILTER-A"]);

    const byName = await admin.get(`/api/stocktakes?partName=${encodeURIComponent("API Part ST-FILTER-B")}`).expect(200);
    expect(byName.body.stocktakes.map((row: { partCode: string }) => row.partCode)).toEqual(["ST-FILTER-B"]);

    const byDate = await admin.get("/api/stocktakes?stocktakeDate=2026-06-10").expect(200);
    expect(byDate.body.stocktakes.map((row: { partCode: string }) => row.partCode)).toEqual(["ST-FILTER-A"]);

    const byRemark = await admin.get("/api/stocktakes?remark=其它").expect(200);
    expect(byRemark.body.stocktakes.map((row: { partCode: string }) => row.partCode)).toEqual(["ST-FILTER-B"]);
  });

  it("list APIs return materialized arrays", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const listRoutes = [
      ["/api/parts", "parts"],
      ["/api/purchase-orders", "purchaseOrders"],
      ["/api/purchase-receipts", "purchaseReceipts"],
      ["/api/other-inbounds", "otherInbounds"],
      ["/api/outbound-records", "outboundRecords"],
      ["/api/stock", "stock"],
      ["/api/stocktakes", "stocktakes"],
    ] as const;

    for (const [routePath, bodyKey] of listRoutes) {
      const response = await admin.get(routePath).expect(200);
      expect(Array.isArray(response.body[bodyKey])).toBe(true);
    }

    const history = await admin.get("/api/history").expect(200);
    expect(Array.isArray(history.body.purchaseOrders)).toBe(true);
    expect(Array.isArray(history.body.purchaseReceipts)).toBe(true);
  });

  it("blocks deleting stores that are referenced by outbound records", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const operator = await loginAgent(app, "operator", "operator123");
    const part = await createApiPart(admin, "STORE-REF");
    const productResponse = await admin
      .post("/api/products")
      .send({
        code: "SKU-STORE-REF",
        name: "引用店铺产品",
        imageUrl: null,
        remark: null,
        bomItems: [{ partId: part.id, quantity: 1 }],
      })
      .expect(201);
    const storeResponse = await admin.post("/api/stores").send({ name: "已引用店铺", remark: null }).expect(201);
    const storeId = storeResponse.body.store.id;

    await operator
      .post("/api/outbound-records")
      .send({
        productId: productResponse.body.product.id,
        storeId,
        outboundQuantity: 1,
        outboundTime: timestamp,
        operatorName: "普通操作员",
      })
      .expect(201);

    const response = await admin.delete(`/api/stores/${storeId}`).expect(400);

    expect(response.body).toEqual({ error: "该店铺已有出库记录，不能删除。请保留店铺用于历史数据追溯。" });
    expect((await database.prepare("SELECT COUNT(*) AS count FROM outbound_stores WHERE id = ?").get(storeId)) as {
      count: number;
    }).toEqual({ count: 1 });
  });

  it("keeps disabled stores for history while excluding them from new outbound choices", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const operator = await loginAgent(app, "operator", "operator123");
    const part = await createApiPart(admin, "DISABLED-STORE");
    const productResponse = await admin
      .post("/api/products")
      .send({
        code: "SKU-DISABLED-STORE",
        name: "停用店铺测试产品",
        imageUrl: null,
        remark: null,
        bomItems: [{ partId: part.id, quantity: 1 }],
      })
      .expect(201);
    const storeResponse = await admin.post("/api/stores").send({ name: "待停用店铺", remark: null }).expect(201);
    const storeId = storeResponse.body.store.id;

    await admin
      .put(`/api/stores/${storeId}`)
      .send({ name: "待停用店铺", remark: null, enabled: false })
      .expect(200);

    const activeStores = await admin.get("/api/stores?status=active").expect(200);
    expect(activeStores.body.stores.map((store: { id: string }) => store.id)).not.toContain(storeId);
    const disabledStores = await admin.get("/api/stores?status=inactive").expect(200);
    expect(disabledStores.body.stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: storeId, name: "待停用店铺", enabled: false }),
      ]),
    );

    const response = await operator
      .post("/api/outbound-records")
      .send({
        productId: productResponse.body.product.id,
        storeId,
        outboundQuantity: 1,
        outboundTime: timestamp,
        operatorName: "普通操作员",
      })
      .expect(400);

    expect(response.body).toEqual({ error: "该店铺已停用，不能用于新增出库" });
  });

  it("operator direct access is limited to outbound, stock, and stocktake APIs", async () => {
    const { app, database } = await openApi();
    const operator = await loginAgent(app, "operator", "operator123");

    const forbiddenRoutes = [
      "/api/dashboard",
      "/api/purchase-orders",
      "/api/purchase-receipts",
      "/api/other-inbounds",
      "/api/history",
      "/api/purchase-orders.csv",
      "/api/purchase-receipts.csv",
      "/api/other-inbounds.csv",
      "/api/history/purchase-orders.csv",
      "/api/audit-logs",
    ];

    for (const routePath of forbiddenRoutes) {
      await operator.get(routePath).expect(403);
    }

    await operator.get("/api/outbound-records.csv").expect(200);
    await operator.get("/api/stock.csv").expect(200);
    await operator.get("/api/stocktakes.csv").expect(200);
  });

  it("CSV routes return text/csv content type", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const routes = [
      "/api/parts.csv",
      "/api/products.csv",
      "/api/purchase-orders.csv",
      "/api/purchase-receipts.csv",
      "/api/other-inbounds.csv",
      "/api/stores.csv",
      "/api/outbound-records.csv",
      "/api/stock.csv",
      "/api/stocktakes.csv",
      "/api/history/purchase-orders.csv",
      "/api/history/purchase-receipts.csv",
      "/api/history/other-inbounds.csv",
      "/api/history/outbound-records.csv",
      "/api/history/stocktakes.csv",
    ];

    for (const routePath of routes) {
      const response = await admin.get(routePath).expect(200);
      expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    }
  });

  it("all CSV routes use Chinese headers and Chinese dated filenames", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const expected = [
      ["/api/parts.csv", "配件管理", "配件编号,配件名称,重量,图片,尺寸/规格,备注,当前库存量,创建时间,更新时间"],
      ["/api/products.csv", "产品组装", "产品编号,产品名称,产品图片,产品备注,配件编号,配件名称,配件图片,用量"],
      ["/api/purchase-orders.csv", "采购订单", "订单号,物流单号,配件编号,配件名称,配件图片,订单数量,状态,下单时间,备注"],
      ["/api/purchase-receipts.csv", "采购入库", "入库单号,采购订单,物流单号,配件编号,配件名称,配件图片,采购数,已入库,状态,到货时间,备注"],
      ["/api/other-inbounds.csv", "其它入库", "入库途径,配件编号,配件名称,配件图片,入库数量,入库时间,操作人,备注"],
      ["/api/stores.csv", "店铺管理", "店铺/去向,状态,备注,创建时间,更新时间"],
      ["/api/outbound-records.csv", "出库管理", "产品编号,产品名称,店铺/去向,出库数量,出库时间,操作人,备注"],
      ["/api/stock.csv", "库存查看", "配件编号,配件名称,图片,规格,重量,当前库存,备注,上次盘点时间,更新时间"],
      ["/api/stocktakes.csv", "盘点管理", "配件编号,配件名称,配件图片,盘前数量,盘后数量,盘点时间,备注"],
    ] as const;

    for (const [routePath, title, header] of expected) {
      const response = await admin.get(routePath).expect(200);
      expect(response.headers["content-disposition"]).toMatch(
        new RegExp(`filename\\*=UTF-8''${encodeURIComponent(title)}-\\d{4}_\\d{4}_\\d{6}\\.csv`),
      );
      expect(response.text.replace(/^\uFEFF/, "").split("\n")[0]).toBe(header);
    }
  });

  it("exports filtered rows with the same search fields used by pages", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const targetPart = await admin
      .post("/api/parts")
      .send({
        code: "FILTER-A",
        name: "目标导出配件",
        weight: 2.5,
        imageUrl: null,
        specification: "L20",
        remark: "筛选备注",
        currentStock: 7,
      })
      .expect(201);
    await createApiPart(admin, "FILTER-B");
    await admin
      .post("/api/purchase-orders")
      .send({
        logisticsNo: "LOG-FILTER-A",
        partId: targetPart.body.part.id,
        orderQuantity: 3,
        remark: "导出筛选订单",
        orderTime: "2026-05-29T08:00:00.000Z",
      })
      .expect(201);
    await admin
      .post("/api/purchase-orders")
      .send({
        logisticsNo: "LOG-FILTER-B",
        partId: targetPart.body.part.id,
        orderQuantity: 3,
        orderTime: "2026-05-29T08:00:00.000Z",
      })
      .expect(201);

    const parts = await admin.get("/api/parts.csv?q=L20").expect(200);
    expect(parts.text).toContain("FILTER-A");
    expect(parts.text).not.toContain("FILTER-B");

    const orders = await admin.get("/api/purchase-orders.csv?logisticsNo=LOG-FILTER-A").expect(200);
    expect(orders.text).toContain("LOG-FILTER-A");
    expect(orders.text).not.toContain("LOG-FILTER-B");
    expect(orders.text).toContain("2026-05-29 08:00");
  });

  it("XLSX exports embed real part images", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-09T07:39:20.000Z"));
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const uploadsDir = path.resolve("uploads", "parts");
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(
      path.join(uploadsDir, "test-export.png"),
      createPngBuffer(20, 40),
    );
    await admin
      .post("/api/parts")
      .send({
        code: "XLSX-IMG",
        name: "图片导出配件",
        weight: null,
        imageUrl: "/uploads/parts/test-export.png",
        specification: "图片规格",
        remark: null,
        currentStock: 1,
      })
      .expect(201);

    const response = await admin
      .get("/api/parts.xlsx?q=XLSX-IMG")
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(response.headers["content-disposition"]).toMatch(/filename\*=UTF-8''%E9%85%8D%E4%BB%B6%E7%AE%A1%E7%90%86-2026_0609_153920\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const worksheet = workbook.getWorksheet("配件管理");
    expect(worksheet?.getRow(1).values).toContain("图片");
    expect(worksheet?.getCell("D2").value).toBeNull();
    const image = worksheet?.getImages()[0];
    const imageRange = image?.range as ExcelJS.ImageRange & { editAs?: string; ext: { width: number; height: number } };
    expect(imageRange.editAs).toBe("oneCell");
    expect(imageRange.tl.nativeCol).toBe(3);
    expect(imageRange.tl.nativeRow).toBe(1);
    expect(imageRange.ext.height).toBeGreaterThan(imageRange.ext.width);
    expect(imageRange.ext.height).toBeGreaterThan(60);
    expect(imageRange.ext.height / imageRange.ext.width).toBeGreaterThan(1.8);
    expect(imageRange.ext.height / imageRange.ext.width).toBeLessThan(2.2);
    expect(worksheet?.getRow(2).height).toBeGreaterThan(42);
  });

  it("rejects image uploads when the file content does not match the declared type", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const uploadsDir = path.resolve("uploads", "parts");
    fs.mkdirSync(uploadsDir, { recursive: true });
    const beforeFiles = new Set(fs.readdirSync(uploadsDir));

    const response = await admin
      .post("/api/uploads/parts")
      .attach("file", Buffer.from("this is not a png"), { filename: "fake.png", contentType: "image/png" })
      .expect(400);

    expect(response.body).toEqual({ error: "图片内容与格式不匹配" });
    const afterFiles = fs.readdirSync(uploadsDir);
    expect(afterFiles.filter((file) => !beforeFiles.has(file))).toEqual([]);
  });

  it("low-stock ignore increments without SQL ambiguity", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "LOW-IGNORE");

    await admin.post(`/api/low-stock/${part.id}/ignore`).send({}).expect(200);
    await admin.post(`/api/low-stock/${part.id}/ignore`).send({}).expect(200);
  });

  it("low-stock ignores follow the 15, 10, and 7 day reminder ladder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-09T08:00:00.000Z"));
    process.env.LOW_STOCK_PERIOD_DAYS = "30";
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "LOW-LADDER");
    const product = await createProductWithBom(database, {
      code: "SKU-LOW-LADDER",
      name: "Low Ladder Product",
      bomItems: [{ partId: part.id, quantity: 1 }],
    });
    const store = await createStore(database, { name: "Low Ladder Store", remark: null });
    await database.prepare("UPDATE part_stock SET quantity = 12 WHERE part_id = ?").run(part.id);
    await createOutboundRecord(database, {
      productId: product.id,
      storeId: store.id,
      outboundQuantity: 30,
      outboundTime: "2026-06-01T00:00:00.000Z",
      operatorName: "Operator",
      remark: null,
    });
    await database.prepare("UPDATE part_stock SET quantity = 12 WHERE part_id = ?").run(part.id);

    let dashboard = await admin.get("/api/dashboard").expect(200);
    expect(dashboard.body.lowStockParts.map((item: { partId: string }) => item.partId)).toContain(part.id);

    await admin.post(`/api/low-stock/${part.id}/ignore`).send({}).expect(200);
    dashboard = await admin.get("/api/dashboard").expect(200);
    expect(dashboard.body.lowStockParts.map((item: { partId: string }) => item.partId)).not.toContain(part.id);

    await database.prepare("UPDATE part_stock SET quantity = 9 WHERE part_id = ?").run(part.id);
    dashboard = await admin.get("/api/dashboard").expect(200);
    expect(dashboard.body.lowStockParts.map((item: { partId: string }) => item.partId)).toContain(part.id);

    await admin.post(`/api/low-stock/${part.id}/ignore`).send({}).expect(200);
    await database.prepare("UPDATE part_stock SET quantity = 8 WHERE part_id = ?").run(part.id);
    dashboard = await admin.get("/api/dashboard").expect(200);
    expect(dashboard.body.lowStockParts.map((item: { partId: string }) => item.partId)).not.toContain(part.id);

    await database.prepare("UPDATE part_stock SET quantity = 6 WHERE part_id = ?").run(part.id);
    dashboard = await admin.get("/api/dashboard").expect(200);
    expect(dashboard.body.lowStockParts.map((item: { partId: string }) => item.partId)).toContain(part.id);

    await admin.post(`/api/low-stock/${part.id}/ignore`).send({}).expect(200);
    dashboard = await admin.get("/api/dashboard").expect(200);
    expect(dashboard.body.lowStockParts.map((item: { partId: string }) => item.partId)).not.toContain(part.id);
    delete process.env.LOW_STOCK_PERIOD_DAYS;
  });

  it("history date filters exclude records outside the selected range", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const mayPart = await createApiPart(admin, "MAY");
    const junePart = await createApiPart(admin, "JUNE");

    await admin
      .post("/api/purchase-orders")
      .send({
        partId: mayPart.id,
        orderQuantity: 1,
        orderTime: "2026-05-15T00:00:00.000Z",
      })
      .expect(201);
    await admin
      .post("/api/purchase-orders")
      .send({
        partId: junePart.id,
        orderQuantity: 1,
        status: "缺货",
        orderTime: "2026-06-01T00:00:00.000Z",
      })
      .expect(201);
    await database.prepare("UPDATE purchase_orders SET status = '缺货' WHERE part_id = ?").run(junePart.id);
    await database.prepare("UPDATE purchase_receipts SET status = '缺货' WHERE part_id = ?").run(junePart.id);

    const response = await admin
      .get("/api/history?from=2026-05-01T00:00:00.000Z&to=2026-05-31T23:59:59.999Z")
      .expect(200);

    expect(response.body.purchaseOrders.map((order: { partName: string }) => order.partName)).toContain("API Part MAY");
    expect(response.body.purchaseOrders.map((order: { partName: string }) => order.partName)).not.toContain("API Part JUNE");
  });

  it("history default range uses the local natural month and includes cross-month abnormal orders", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-09T08:00:00.000Z"));
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const mayNormal = await createApiPart(admin, "MAY-NORMAL");
    const mayAbnormal = await createApiPart(admin, "MAY-ABNORMAL");
    const juneEarly = await createApiPart(admin, "JUNE-EARLY");

    await admin.post("/api/purchase-orders").send({ partId: mayNormal.id, orderQuantity: 1, orderTime: "2026-05-20T10:00:00.000Z" }).expect(201);
    await admin.post("/api/purchase-orders").send({ partId: mayAbnormal.id, orderQuantity: 1, orderTime: "2026-05-20T10:00:00.000Z" }).expect(201);
    await admin.post("/api/purchase-orders").send({ partId: juneEarly.id, orderQuantity: 1, orderTime: "2026-05-31T16:30:00.000Z" }).expect(201);
    await database.prepare("UPDATE purchase_orders SET status = '缺货' WHERE part_id = ?").run(mayAbnormal.id);
    await database.prepare("UPDATE purchase_receipts SET status = '缺货' WHERE part_id = ?").run(mayAbnormal.id);

    const response = await admin.get("/api/history").expect(200);
    const names = response.body.purchaseOrders.map((order: { partName: string }) => order.partName);
    expect(response.body.from).toBe("2026-05-31T16:00:00.000Z");
    expect(response.body.to).toBe("2026-06-30T16:00:00.000Z");
    expect(names).toContain("API Part JUNE-EARLY");
    expect(names).toContain("API Part MAY-ABNORMAL");
    expect(names).not.toContain("API Part MAY-NORMAL");
  });

  it("CSV downloads use Chinese headers and dated Chinese filenames", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    await createApiPart(admin, "CSV-CN");
    await createApiPart(admin, "CSV-OTHER");

    const response = await admin.get("/api/parts.csv?q=CSV-CN").expect(200);

    expect(response.headers["content-disposition"]).toMatch(/filename\*=UTF-8''%E9%85%8D%E4%BB%B6%E7%AE%A1%E7%90%86-\d{4}_\d{4}_\d{6}\.csv/);
    expect(response.text.split("\n")[0]).toContain("配件编号,配件名称,重量,图片,尺寸/规格,备注,当前库存量,创建时间,更新时间");
    expect(response.text).toContain("CSV-CN");
    expect(response.text).not.toContain("CSV-OTHER");
  });

  it("syncs edited part remarks into stock remarks", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "REMARK-SYNC");

    await admin
      .put(`/api/parts/${part.id}`)
      .send({
        code: "REMARK-SYNC",
        name: "API Part REMARK-SYNC",
        weight: null,
        imageUrl: null,
        specification: "api spec",
        remark: "配件编辑后的备注",
        currentStock: 0,
      })
      .expect(200);

    expect((await database.prepare("SELECT remark FROM part_stock WHERE part_id = ?").get(part.id)) as { remark: string }).toEqual({
      remark: "配件编辑后的备注",
    });
  });

  it("waits for stock movement persistence before returning other inbound responses", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const part = await createApiPart(admin, "MOVE-AWAIT");
    const originalPrepare = database.prepare.bind(database);
    const gate = createGate();
    let delayedMovementReached = false;

    database.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!sql.includes("INSERT INTO stock_movements")) {
        return statement;
      }
      return {
        ...statement,
        run: async (...params: unknown[]) => {
          delayedMovementReached = true;
          await gate.promise;
          return statement.run(...params);
        },
      };
    }) as typeof database.prepare;

    const responsePromise = admin
      .post("/api/other-inbounds")
      .send({
        inboundSource: "回归测试入库",
        partId: part.id,
        inboundQuantity: 3,
        inboundTime: timestamp,
        operatorName: "管理员",
        remark: "await movement",
      })
      .expect(201);

    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(delayedMovementReached).toBe(true);
    expect(settled).toBe(false);

    gate.release();
    await responsePromise;
    database.prepare = originalPrepare;
  });

  it("writes audit logs for core mutating operations and limits audit access to admins", async () => {
    const { app } = await openApi();
    const admin = await loginAgent(app);
    const operator = await loginAgent(app, "operator", "operator123");
    const partResponse = await admin
      .post("/api/parts")
      .send({
        code: "AUDIT-PART",
        name: "审计配件",
        weight: null,
        imageUrl: null,
        specification: "api spec",
        remark: null,
        currentStock: 100,
      })
      .expect(201);
    const part = partResponse.body.part as { id: string };

    await admin
      .put(`/api/parts/${part.id}`)
      .send({
        code: "AUDIT-PART",
        name: "API Part AUDIT-PART",
        weight: null,
        imageUrl: null,
        specification: "api spec",
        remark: "审计备注",
        currentStock: 0,
      })
      .expect(200);
    const product = await admin
      .post("/api/products")
      .send({
        code: "AUDIT-SKU",
        name: "审计产品",
        imageUrl: null,
        remark: null,
        bomItems: [{ partId: part.id, quantity: 1 }],
      })
      .expect(201);
    const store = await admin.post("/api/stores").send({ name: "审计店铺", remark: null }).expect(201);
    const order = await admin
      .post("/api/purchase-orders")
      .send({ partId: part.id, orderQuantity: 3, orderTime: timestamp })
      .expect(201);
    await admin
      .post(`/api/purchase-receipts/${order.body.purchaseOrder.id}/receive`)
      .send({ inboundQuantity: 1, status: "部分签收", inboundTime: timestamp })
      .expect(200);
    await admin
      .post("/api/other-inbounds")
      .send({ inboundSource: "审计入库", partId: part.id, inboundQuantity: 2, inboundTime: timestamp, operatorName: "管理员" })
      .expect(201);
    await operator
      .post("/api/outbound-records")
      .send({
        productId: product.body.product.id,
        storeId: store.body.store.id,
        outboundQuantity: 1,
        outboundTime: timestamp,
        operatorName: "普通操作员",
      })
      .expect(201);
    await admin.put(`/api/stock/${part.id}/remark`).send({ remark: "审计库存备注" }).expect(200);
    await operator.post("/api/stocktakes").send({ partId: part.id, actualQuantity: 20, remark: "审计盘点", stocktakeTime: timestamp }).expect(201);
    await admin.post(`/api/low-stock/${part.id}/ignore`).send({}).expect(200);
    await admin
      .post("/api/users")
      .send({ username: "audit-user", displayName: "审计用户", password: "secret123", role: "operator", enabled: true })
      .expect(201);

    await operator.get("/api/audit-logs").expect(403);
    const logs = await admin.get("/api/audit-logs").expect(200);

    expect(logs.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorUsername: "admin", action: "新增配件", entityType: "part" }),
        expect.objectContaining({ actorUsername: "admin", action: "编辑配件", entityType: "part", entityId: part.id }),
        expect.objectContaining({ actorUsername: "admin", action: "新增产品", entityType: "product" }),
        expect.objectContaining({ actorUsername: "admin", action: "新增店铺", entityType: "store" }),
        expect.objectContaining({ actorUsername: "admin", action: "新增采购订单", entityType: "purchase_order" }),
        expect.objectContaining({ actorUsername: "admin", action: "采购入库签收", entityType: "purchase_receipt" }),
        expect.objectContaining({ actorUsername: "admin", action: "新增其它入库", entityType: "other_inbound" }),
        expect.objectContaining({ actorUsername: "operator", action: "新增出库", entityType: "outbound_record" }),
        expect.objectContaining({ actorUsername: "admin", action: "编辑库存备注", entityType: "stock", entityId: part.id }),
        expect.objectContaining({ actorUsername: "operator", action: "新增盘点", entityType: "stocktake" }),
        expect.objectContaining({ actorUsername: "admin", action: "忽略低库存", entityType: "low_stock_ignore", entityId: part.id }),
        expect.objectContaining({ actorUsername: "admin", action: "新增用户", entityType: "user" }),
      ]),
    );
  });

  it("paginates and filters audit logs", async () => {
    const { app, database } = await openApi();
    const admin = await loginAgent(app);
    const rows = [
      ["audit-1", "admin", "admin", "新增配件", "part", "part-1", "2026-06-09T08:00:00.000Z"],
      ["audit-2", "operator", "operator", "新增出库", "outbound_record", "outbound-1", "2026-06-10T08:00:00.000Z"],
      ["audit-3", "admin", "admin", "编辑库存备注", "stock", "part-2", "2026-06-11T08:00:00.000Z"],
    ];
    for (const row of rows) {
      await database.prepare(
        `
        INSERT INTO audit_logs (
          id, actor_user_id, actor_username, actor_role, action, entity_type, entity_id,
          before_data, after_data, ip, user_agent, created_at
        )
        VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)
        `,
      ).run(...row);
    }

    const filtered = await admin
      .get("/api/audit-logs?page=1&pageSize=1&actorUsername=admin&action=库存&entityType=stock&from=2026-06-11T00:00:00.000Z")
      .expect(200);

    expect(filtered.body.auditLogs).toHaveLength(1);
    expect(filtered.body.auditLogs[0]).toEqual(expect.objectContaining({ id: "audit-3", action: "编辑库存备注", entityType: "stock" }));
    expect(filtered.body.pagination).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });

    const secondPage = await admin.get("/api/audit-logs?page=2&pageSize=1").expect(200);
    expect(secondPage.body.auditLogs).toHaveLength(1);
    expect(secondPage.body.auditLogs[0]).toEqual(expect.objectContaining({ id: "audit-2" }));
    expect(secondPage.body.pagination).toEqual({ page: 2, pageSize: 1, total: 3, totalPages: 3 });
  });
});
