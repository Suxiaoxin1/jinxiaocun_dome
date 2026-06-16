import { calculateBomConsumption } from "../domain/inventory";
import type {
  Part,
  PartStock,
  PartUsage,
  Product,
  ProductBomItem,
  PurchaseStatus,
} from "../shared/types";
import { createId, nowIso, type SqliteDb } from "./db";

export interface CreatePartInput {
  code: string;
  name: string;
  weight?: number | null;
  imageUrl?: string | null;
  specification?: string | null;
  remark?: string | null;
  currentStock?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProductInput {
  code: string;
  name: string;
  imageUrl?: string | null;
  remark?: string | null;
  bomItems: Array<Pick<ProductBomItem, "partId" | "quantity">>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePurchaseOrderInput {
  orderNo?: string;
  logisticsNo?: string | null;
  partId: string;
  orderQuantity: number;
  status: PurchaseStatus;
  remark?: string | null;
  orderTime?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdatePurchaseOrderInput extends CreatePurchaseOrderInput {
  partId: string;
}

export interface ReceivePurchaseReceiptInput {
  id: string;
  inboundQuantity: number;
  addToExisting?: boolean;
  status?: PurchaseStatus;
  remark?: string | null;
  inboundTime?: string;
  updatedAt?: string;
}

export interface CreateStoreInput {
  name: string;
  remark?: string | null;
  enabled?: boolean;
}

export interface CreateOutboundInput {
  productId: string;
  storeId: string;
  outboundQuantity: number;
  outboundTime?: string;
  operatorName: string;
  remark?: string | null;
  createdAt?: string;
}

export interface CreateOutboundResult {
  id: string;
  warnings: string[];
}

interface PartRow {
  id: string;
  code: string;
  name: string;
  weight: number | null;
  image_url: string | null;
  specification: string | null;
  remark: string | null;
  current_stock?: number;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

interface PartStockRow {
  part_id: string;
  quantity: number;
  remark: string | null;
  last_stocktake_at: string | null;
}

interface BomItemRow {
  product_id: string;
  part_id: string;
  part_code: string;
  part_name: string;
  quantity: number;
}

interface PurchaseReceiptRow {
  id: string;
  purchase_order_id: string;
  part_id: string;
  purchase_quantity: number;
  inbound_quantity: number;
  status: PurchaseStatus;
  remark: string | null;
}

interface OutboundRecordRow {
  id: string;
  product_id: string;
  outbound_quantity: number;
}

interface OtherInboundRow {
  id: string;
  part_id: string;
  inbound_quantity: number;
  remark: string | null;
}

interface StocktakeRow {
  id: string;
  part_id: string;
  previous_quantity: number;
  actual_quantity: number;
  remark: string | null;
}

export async function createPart(db: SqliteDb, input: CreatePartInput) {
  const id = createId("part");
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  await db.transaction(async () => {
    await db.prepare(
      `
      INSERT INTO parts (
        id, code, name, weight, image_url, specification, remark, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.code,
      input.name,
      input.weight ?? null,
      input.imageUrl ?? null,
      input.specification ?? null,
      input.remark ?? null,
      createdAt,
      updatedAt,
    );
    await db.prepare("INSERT INTO part_stock (part_id, quantity, remark, updated_at) VALUES (?, ?, NULL, ?)")
      .run(id, input.currentStock ?? 0, updatedAt);
  });

  return mapPart(
    await db.prepare("SELECT * FROM parts WHERE id = ?").get(id) as PartRow,
  );
}

export async function createProductWithBom(db: SqliteDb, input: CreateProductInput) {
  const id = createId("product");
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  await db.transaction(async () => {
    await db.prepare(
      `
      INSERT INTO products (id, code, name, image_url, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(id, input.code, input.name, input.imageUrl ?? null, input.remark ?? null, createdAt, updatedAt);

    const insertBom = await db.prepare(
      "INSERT INTO product_bom_items (id, product_id, part_id, quantity) VALUES (?, ?, ?, ?)",
    );
    for (const item of input.bomItems) {
      await insertBom.run(createId("bom"), id, item.partId, item.quantity);
    }
  });

  return mapProduct(
    await db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow,
  );
}

export async function createPurchaseOrder(db: SqliteDb, input: CreatePurchaseOrderInput) {
  const id = createId("purchase_order");
  const receiptId = createId("purchase_receipt");
  const orderTime = input.orderTime ?? nowIso();
  const createdAt = input.createdAt ?? orderTime;
  const updatedAt = input.updatedAt ?? createdAt;
  const initialStatus = "在途";
  const orderNo = input.orderNo?.trim() || createGeneratedOrderNo();

  await db.transaction(async () => {
    await db.prepare(
      `
      INSERT INTO purchase_orders (
        id, order_no, logistics_no, part_id, order_quantity, status, remark, order_time, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      orderNo,
      input.logisticsNo ?? null,
      input.partId,
      input.orderQuantity,
      initialStatus,
      input.remark ?? null,
      orderTime,
      createdAt,
      updatedAt,
    );
    await db.prepare(
      `
      INSERT INTO purchase_receipts (
        id,
        receipt_no,
        purchase_order_id,
        logistics_no,
        part_id,
        purchase_quantity,
        inbound_quantity,
        status,
        remark,
        inbound_time,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
      `,
    ).run(
      receiptId,
      orderNo,
      id,
      input.logisticsNo ?? null,
      input.partId,
      input.orderQuantity,
      initialStatus,
      input.remark ?? null,
      createdAt,
      updatedAt,
    );
  });

  return { id };
}

export async function updatePurchaseOrder(db: SqliteDb, id: string, input: UpdatePurchaseOrderInput) {
  const orderNo = input.orderNo?.trim();
  if (!orderNo) {
    throw new Error("订单号不能为空");
  }
  const orderTime = input.orderTime ?? nowIso();
  const updatedAt = input.updatedAt ?? nowIso();

  await db.transaction(async () => {
    const receipt = await db.prepare(
      `
      SELECT id, inbound_quantity
      FROM purchase_receipts
      WHERE purchase_order_id = ?
      `,
    ).get(id) as { id: string; inbound_quantity: number } | undefined;
    if (!receipt) {
      throw new Error("采购订单不存在");
    }
    if (input.orderQuantity < receipt.inbound_quantity) {
      throw new Error("采购数量不能小于已入库数量");
    }

    const result = await db.prepare(
      `
      UPDATE purchase_orders
      SET order_no = ?,
          logistics_no = ?,
          part_id = ?,
          order_quantity = ?,
          status = ?,
          remark = ?,
          order_time = ?,
          updated_at = ?
      WHERE id = ?
      `,
    ).run(
      orderNo,
      input.logisticsNo ?? null,
      input.partId,
      input.orderQuantity,
      input.status,
      input.remark ?? null,
      orderTime,
      updatedAt,
      id,
    );
    if (result.changes === 0) {
      throw new Error("采购订单不存在");
    }

    await db.prepare(
      `
      UPDATE purchase_receipts
      SET receipt_no = ?,
          logistics_no = ?,
          part_id = ?,
          purchase_quantity = ?,
          status = ?,
          remark = ?,
          updated_at = ?
      WHERE purchase_order_id = ?
      `,
    ).run(
      orderNo,
      input.logisticsNo ?? null,
      input.partId,
      input.orderQuantity,
      input.status,
      input.remark ?? null,
      updatedAt,
      id,
    );
  });

  return { id };
}

export async function receivePurchaseReceipt(db: SqliteDb, input: ReceivePurchaseReceiptInput) {
  await db.transaction(async () => {
    const receipt = await db.prepare("SELECT * FROM purchase_receipts WHERE id = ? FOR UPDATE").get(input.id) as
      | PurchaseReceiptRow
      | undefined;
    if (!receipt) {
      throw new Error("采购入库单不存在");
    }
    if (!Number.isInteger(input.inboundQuantity) || input.inboundQuantity < 0) {
      throw new Error("入库数量必须为非负整数");
    }

    const nextInboundQuantity = input.addToExisting
      ? receipt.inbound_quantity + input.inboundQuantity
      : input.inboundQuantity;
    const quantityDelta = nextInboundQuantity - receipt.inbound_quantity;
    const status = input.status ?? derivePurchaseStatus(nextInboundQuantity, receipt.purchase_quantity);
    const inboundTime = input.inboundTime ?? nowIso();
    const updatedAt = input.updatedAt ?? inboundTime;

    await db.prepare(
      `
      UPDATE purchase_receipts
      SET inbound_quantity = ?, status = ?, remark = ?, inbound_time = ?, updated_at = ?
      WHERE id = ?
      `,
    ).run(nextInboundQuantity, status, input.remark ?? null, inboundTime, updatedAt, input.id);
    await db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, receipt.purchase_order_id);

    if (quantityDelta !== 0) {
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(quantityDelta, updatedAt, receipt.part_id);
      await insertMovement(db, {
        partId: receipt.part_id,
        movementType: "采购入库",
        quantityDelta,
        sourceId: input.id,
        sourceTable: "purchase_receipts",
        remark: input.remark ?? null,
        createdAt: updatedAt,
      });
    }
  });
}

export async function deletePurchaseReceipt(db: SqliteDb, id: string) {
  await db.transaction(async () => {
    const receipt = await db.prepare("SELECT * FROM purchase_receipts WHERE id = ?").get(id) as
      | PurchaseReceiptRow
      | undefined;
    if (!receipt) {
      throw new Error("采购入库单不存在");
    }

    const updatedAt = nowIso();
    if (receipt.inbound_quantity !== 0) {
      const delta = -receipt.inbound_quantity;
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, updatedAt, receipt.part_id);
      await insertMovement(db, {
        partId: receipt.part_id,
        movementType: "采购入库",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "purchase_receipts",
        remark: "删除采购入库补偿",
        createdAt: updatedAt,
      });
    }

    await db.prepare(
      `
      UPDATE purchase_receipts
      SET inbound_quantity = 0,
          status = '在途',
          remark = NULL,
          inbound_time = NULL,
          updated_at = ?
      WHERE id = ?
      `,
    ).run(updatedAt, id);
    await db.prepare("UPDATE purchase_orders SET status = '在途', updated_at = ? WHERE id = ?")
      .run(updatedAt, receipt.purchase_order_id);
  });
}

export async function createStore(db: SqliteDb, input: CreateStoreInput) {
  const id = createId("store");
  const createdAt = nowIso();

  await db.prepare(
    `
    INSERT INTO outbound_stores (id, name, remark, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(id, input.name, input.remark ?? null, input.enabled === false ? 0 : 1, createdAt, createdAt);

  return { id, name: input.name };
}

export async function updateStore(
  db: SqliteDb,
  id: string,
  input: CreateStoreInput,
) {
  const previous = await db.prepare("SELECT updated_at FROM outbound_stores WHERE id = ?").get(id) as
    | { updated_at: string }
    | undefined;
  if (!previous) {
    throw new Error("出库店铺不存在");
  }
  const updatedAt = nextIsoAfter(previous.updated_at);
  const result = await db.prepare(
    `
    UPDATE outbound_stores
    SET name = ?, remark = ?, enabled = ?, updated_at = ?
    WHERE id = ?
    `,
  ).run(input.name, input.remark ?? null, input.enabled === false ? 0 : 1, updatedAt, id);
  if (result.changes === 0) {
    throw new Error("出库店铺不存在");
  }

  return { id, name: input.name };
}

export async function createOutboundRecord(db: SqliteDb, input: CreateOutboundInput) {
  const id = createId("outbound");
  const outboundTime = input.outboundTime ?? nowIso();
  const createdAt = input.createdAt ?? outboundTime;
  const warnings: string[] = [];

  await db.transaction(async () => {
    const store = await db.prepare("SELECT enabled FROM outbound_stores WHERE id = ?").get(input.storeId) as
      | { enabled: number | string | boolean }
      | undefined;
    if (!store) {
      throw new Error("出库店铺不存在");
    }
    if (Number(store.enabled) !== 1) {
      throw new Error("该店铺已停用，不能用于新增出库");
    }
    const bomItems = await loadBomItems(db, input.productId);
    if (bomItems.length === 0) {
      throw new Error("产品 BOM 不能为空");
    }
    const stocks = await loadStocksForParts(db, bomItems.map((item) => item.partId));
    const stockByPart = new Map(stocks.map((stock) => [stock.partId, stock.quantity]));
    const required = calculateBomConsumption(bomItems, input.outboundQuantity);

    await db.prepare(
      `
      INSERT INTO outbound_records (
        id, product_id, store_id, outbound_quantity, outbound_time, operator_name, remark, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.productId,
      input.storeId,
      input.outboundQuantity,
      outboundTime,
      input.operatorName,
      input.remark ?? null,
      createdAt,
    );

    for (const item of required) {
      const current = stockByPart.get(item.partId) ?? 0;
      if (current < item.quantity) {
        const bomItem = bomItems.find((candidate) => candidate.partId === item.partId);
        const label = bomItem ? `${bomItem.partName}（${bomItem.partCode}）` : item.partId;
        warnings.push(`配件 ${label}库存不足：需要 ${item.quantity}，当前 ${current}，保存后为 ${current - item.quantity}`);
      }
      const delta = -item.quantity;
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, createdAt, item.partId);
      await insertMovement(db, {
        partId: item.partId,
        movementType: "产品出库",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "outbound_records",
        remark: input.remark ?? null,
        createdAt,
      });
    }
  });

  return { id, warnings };
}

export async function getPartStock(db: SqliteDb, partId: string) {
  const row = await db.prepare("SELECT * FROM part_stock WHERE part_id = ?").get(partId) as
    | PartStockRow
    | undefined;
  return row ? mapPartStock(row) : null;
}

export async function updateStockRemark(db: SqliteDb, partId: string, remark: string | null) {
  const previous = await db.prepare("SELECT updated_at FROM part_stock WHERE part_id = ?").get(partId) as
    | { updated_at: string }
    | undefined;
  if (!previous) {
    throw new Error("配件库存不存在");
  }
  const updatedAt = nextIsoAfter(previous.updated_at);
  await db.prepare("UPDATE part_stock SET remark = ?, updated_at = ? WHERE part_id = ?")
    .run(remark, updatedAt, partId);
  const stock = await getPartStock(db, partId);
  if (!stock) {
    throw new Error("配件库存不存在");
  }
  return stock;
}

export async function deletePurchaseOrder(db: SqliteDb, id: string) {
  await db.transaction(async () => {
    const receipts = await db.prepare(
      "SELECT inbound_quantity FROM purchase_receipts WHERE purchase_order_id = ?",
    ).all(id) as Array<{ inbound_quantity: number }>;
    if (receipts.length === 0) {
      throw new Error("采购订单不存在");
    }
    if (receipts.some((receipt) => receipt.inbound_quantity > 0)) {
      throw new Error("已入库采购订单不能删除");
    }
    await db.prepare("DELETE FROM purchase_orders WHERE id = ?").run(id);
  });
}

export async function deleteOtherInbound(db: SqliteDb, id: string) {
  await db.transaction(async () => {
    const row = await db.prepare("SELECT * FROM other_inbounds WHERE id = ?").get(id) as
      | OtherInboundRow
      | undefined;
    if (!row) {
      throw new Error("其它入库记录不存在");
    }
    const createdAt = nowIso();
    const delta = -row.inbound_quantity;
    await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
      .run(delta, createdAt, row.part_id);
    await insertMovement(db, {
      partId: row.part_id,
      movementType: "其它入库",
      quantityDelta: delta,
      sourceId: id,
      sourceTable: "other_inbounds",
      remark: row.remark,
      createdAt,
    });
    await db.prepare("DELETE FROM other_inbounds WHERE id = ?").run(id);
  });
}

export async function deleteOutboundRecord(db: SqliteDb, id: string) {
  await db.transaction(async () => {
    const outbound = await db.prepare("SELECT * FROM outbound_records WHERE id = ?").get(id) as
      | OutboundRecordRow
      | undefined;
    if (!outbound) {
      throw new Error("出库记录不存在");
    }
    const required = await db.prepare(
        `
        SELECT part_id AS "partId", -quantity_delta AS quantity
        FROM stock_movements
        WHERE source_table = 'outbound_records'
          AND source_id = ?
          AND quantity_delta < 0
        `,
      )
      .all(id) as PartUsage[];
    const createdAt = nowIso();

    for (const item of required) {
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(item.quantity, createdAt, item.partId);
      await insertMovement(db, {
        partId: item.partId,
        movementType: "产品出库",
        quantityDelta: item.quantity,
        sourceId: id,
        sourceTable: "outbound_records",
        remark: "删除出库记录补偿",
        createdAt,
      });
    }
    await db.prepare("DELETE FROM outbound_records WHERE id = ?").run(id);
  });
}

export async function deleteStocktake(db: SqliteDb, id: string) {
  await db.transaction(async () => {
    const row = await db.prepare("SELECT * FROM stocktakes WHERE id = ?").get(id) as
      | StocktakeRow
      | undefined;
    if (!row) {
      throw new Error("盘点记录不存在");
    }
    const delta = row.previous_quantity - row.actual_quantity;
    const createdAt = nowIso();
    if (delta !== 0) {
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, createdAt, row.part_id);
      await insertMovement(db, {
        partId: row.part_id,
        movementType: "盘点调整",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "stocktakes",
        remark: row.remark,
        createdAt,
      });
    }
    await db.prepare("DELETE FROM stocktakes WHERE id = ?").run(id);
  });
}

export async function getPartUsageFromOutboundSince(db: SqliteDb, sinceIso: string) {
  const rows = await db.prepare(
    `
    SELECT pbi.part_id AS "partId", SUM(orx.outbound_quantity * pbi.quantity) AS quantity
    FROM outbound_records orx
    JOIN product_bom_items pbi ON pbi.product_id = orx.product_id
    WHERE orx.outbound_time >= ?
    GROUP BY pbi.part_id
    ORDER BY pbi.part_id
    `,
  ).all(sinceIso) as Array<{ partId: string; quantity: number | string }>;
  return rows.map((row) => ({ partId: row.partId, quantity: Number(row.quantity) }));
}

async function loadBomItems(db: SqliteDb, productId: string) {
  const rows = await db.prepare(
    `
    SELECT
      product_bom_items.product_id,
      product_bom_items.part_id,
      parts.code AS part_code,
      parts.name AS part_name,
      product_bom_items.quantity
    FROM product_bom_items
    JOIN parts ON parts.id = product_bom_items.part_id
    WHERE product_bom_items.product_id = ?
    ORDER BY product_bom_items.id
    `,
  ).all(productId) as BomItemRow[];
  return rows.map((row) => ({
    productId: row.product_id,
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    quantity: row.quantity,
  }));
}

async function loadStocksForParts(db: SqliteDb, partIds: string[]) {
  if (partIds.length === 0) {
    return [];
  }
  const placeholders = partIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT part_id, quantity, remark, last_stocktake_at FROM part_stock WHERE part_id IN (${placeholders})`,
  ).all(...partIds) as PartStockRow[];
  return rows.map(mapPartStock);
}

async function insertMovement(
  db: SqliteDb,
  input: {
    partId: string;
    movementType: "采购入库" | "其它入库" | "产品出库" | "盘点调整";
    quantityDelta: number;
    sourceId: string;
    sourceTable: "purchase_receipts" | "other_inbounds" | "outbound_records" | "stocktakes";
    remark: string | null;
    createdAt: string;
  },
) {
  await db.prepare(
    `
    INSERT INTO stock_movements (
      id, part_id, movement_type, quantity_delta, source_id, source_table, remark, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    createId("movement"),
    input.partId,
    input.movementType,
    input.quantityDelta,
    input.sourceId,
    input.sourceTable,
    input.remark,
    input.createdAt,
  );
}

function derivePurchaseStatus(inboundQuantity: number, purchaseQuantity: number): PurchaseStatus {
  if (inboundQuantity === 0) {
    return "在途";
  }
  if (inboundQuantity >= purchaseQuantity) {
    return "已签收";
  }
  return "部分签收";
}

function createGeneratedOrderNo(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `PO${timestamp}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function nextIsoAfter(previousIso: string): string {
  const current = nowIso();
  if (current > previousIso) {
    return current;
  }
  return new Date(new Date(previousIso).getTime() + 1).toISOString();
}

function mapPart(row: PartRow): Part {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    weight: row.weight,
    imageUrl: row.image_url,
    specification: row.specification,
    remark: row.remark,
    currentStock: row.current_stock,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    imageUrl: row.image_url,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPartStock(row: PartStockRow): PartStock {
  return {
    partId: row.part_id,
    quantity: row.quantity,
    remark: row.remark,
    lastStocktakeAt: row.last_stocktake_at,
  };
}
