import { ensureCanOutboundProduct } from "../domain/inventory";
import type {
  Part,
  PartStock,
  PartStatus,
  PartUsage,
  Product,
  ProductBomItem,
  PurchaseStatus,
} from "../shared/types";
import { createId, nowIso, type SqliteDb } from "./db";

export interface CreatePartInput {
  code: string;
  name: string;
  status: PartStatus;
  weight?: number | null;
  imageUrl?: string | null;
  specification?: string | null;
  remark?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProductInput {
  code: string;
  name: string;
  remark?: string | null;
  bomItems: Array<Pick<ProductBomItem, "partId" | "quantity">>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePurchaseOrderInput {
  orderNo: string;
  logisticsNo?: string | null;
  partId: string;
  orderQuantity: number;
  status: PurchaseStatus;
  remark?: string | null;
  orderTime?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReceivePurchaseReceiptInput {
  id: string;
  inboundQuantity: number;
  status?: PurchaseStatus;
  remark?: string | null;
  inboundTime?: string;
  updatedAt?: string;
}

export interface CreateStoreInput {
  name: string;
  remark?: string | null;
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

interface PartRow {
  id: string;
  code: string;
  name: string;
  status: PartStatus;
  weight: number | null;
  image_url: string | null;
  specification: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
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

interface PurchaseReceiptRow {
  id: string;
  purchase_order_id: string;
  part_id: string;
  purchase_quantity: number;
  inbound_quantity: number;
  status: PurchaseStatus;
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

export function createPart(db: SqliteDb, input: CreatePartInput): Part {
  const id = createId("part");
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO parts (
        id, code, name, status, weight, image_url, specification, remark, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.code,
      input.name,
      input.status,
      input.weight ?? null,
      input.imageUrl ?? null,
      input.specification ?? null,
      input.remark ?? null,
      createdAt,
      updatedAt,
    );
    db.prepare("INSERT INTO part_stock (part_id, quantity, remark, updated_at) VALUES (?, 0, NULL, ?)")
      .run(id, updatedAt);
  })();

  return mapPart(
    db.prepare("SELECT * FROM parts WHERE id = ?").get(id) as PartRow,
  );
}

export function createProductWithBom(db: SqliteDb, input: CreateProductInput): Product {
  const id = createId("product");
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO products (id, code, name, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(id, input.code, input.name, input.remark ?? null, createdAt, updatedAt);

    const insertBom = db.prepare(
      "INSERT INTO product_bom_items (product_id, part_id, quantity) VALUES (?, ?, ?)",
    );
    for (const item of input.bomItems) {
      insertBom.run(id, item.partId, item.quantity);
    }
  })();

  return mapProduct(
    db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow,
  );
}

export function createPurchaseOrder(db: SqliteDb, input: CreatePurchaseOrderInput): { id: string } {
  const id = createId("purchase_order");
  const receiptId = createId("purchase_receipt");
  const orderTime = input.orderTime ?? nowIso();
  const createdAt = input.createdAt ?? orderTime;
  const updatedAt = input.updatedAt ?? createdAt;

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO purchase_orders (
        id, order_no, logistics_no, part_id, order_quantity, status, remark, order_time, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.orderNo,
      input.logisticsNo ?? null,
      input.partId,
      input.orderQuantity,
      input.status,
      input.remark ?? null,
      orderTime,
      createdAt,
      updatedAt,
    );
    db.prepare(
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
      input.orderNo,
      id,
      input.logisticsNo ?? null,
      input.partId,
      input.orderQuantity,
      input.status,
      input.remark ?? null,
      createdAt,
      updatedAt,
    );
  })();

  return { id };
}

export function receivePurchaseReceipt(db: SqliteDb, input: ReceivePurchaseReceiptInput): void {
  db.transaction(() => {
    const receipt = db.prepare("SELECT * FROM purchase_receipts WHERE id = ?").get(input.id) as
      | PurchaseReceiptRow
      | undefined;
    if (!receipt) {
      throw new Error("采购入库单不存在");
    }
    if (input.inboundQuantity > receipt.purchase_quantity) {
      throw new Error("入库数量不能大于采购数量");
    }
    if (!Number.isInteger(input.inboundQuantity) || input.inboundQuantity < 0) {
      throw new Error("入库数量必须为非负整数");
    }

    const quantityDelta = input.inboundQuantity - receipt.inbound_quantity;
    const status = input.status ?? derivePurchaseStatus(input.inboundQuantity, receipt.purchase_quantity);
    const inboundTime = input.inboundTime ?? nowIso();
    const updatedAt = input.updatedAt ?? inboundTime;

    db.prepare(
      `
      UPDATE purchase_receipts
      SET inbound_quantity = ?, status = ?, remark = ?, inbound_time = ?, updated_at = ?
      WHERE id = ?
      `,
    ).run(input.inboundQuantity, status, input.remark ?? null, inboundTime, updatedAt, input.id);
    db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, receipt.purchase_order_id);

    if (quantityDelta !== 0) {
      db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(quantityDelta, updatedAt, receipt.part_id);
      insertMovement(db, {
        partId: receipt.part_id,
        movementType: "采购入库",
        quantityDelta,
        sourceId: input.id,
        sourceTable: "purchase_receipts",
        remark: input.remark ?? null,
        createdAt: updatedAt,
      });
    }
  })();
}

export function createStore(db: SqliteDb, input: CreateStoreInput): { id: string; name: string } {
  const id = createId("store");
  const createdAt = nowIso();

  db.prepare(
    `
    INSERT INTO outbound_stores (id, name, remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    `,
  ).run(id, input.name, input.remark ?? null, createdAt, createdAt);

  return { id, name: input.name };
}

export function updateStore(
  db: SqliteDb,
  id: string,
  input: CreateStoreInput,
): { id: string; name: string } {
  const previous = db.prepare("SELECT updated_at FROM outbound_stores WHERE id = ?").get(id) as
    | { updated_at: string }
    | undefined;
  if (!previous) {
    throw new Error("出库店铺不存在");
  }
  const updatedAt = nextIsoAfter(previous.updated_at);
  const result = db.prepare(
    `
    UPDATE outbound_stores
    SET name = ?, remark = ?, updated_at = ?
    WHERE id = ?
    `,
  ).run(input.name, input.remark ?? null, updatedAt, id);
  if (result.changes === 0) {
    throw new Error("出库店铺不存在");
  }

  return { id, name: input.name };
}

export function createOutboundRecord(db: SqliteDb, input: CreateOutboundInput): { id: string } {
  const id = createId("outbound");
  const outboundTime = input.outboundTime ?? nowIso();
  const createdAt = input.createdAt ?? outboundTime;

  db.transaction(() => {
    const bomItems = loadBomItems(db, input.productId);
    if (bomItems.length === 0) {
      throw new Error("产品 BOM 不能为空");
    }
    const stocks = loadStocksForParts(db, bomItems.map((item) => item.partId));
    const required = ensureCanOutboundProduct(stocks, bomItems, input.outboundQuantity);

    db.prepare(
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
      const delta = -item.quantity;
      db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, createdAt, item.partId);
      insertMovement(db, {
        partId: item.partId,
        movementType: "产品出库",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "outbound_records",
        remark: input.remark ?? null,
        createdAt,
      });
    }
  })();

  return { id };
}

export function getPartStock(db: SqliteDb, partId: string): PartStock | null {
  const row = db.prepare("SELECT * FROM part_stock WHERE part_id = ?").get(partId) as
    | PartStockRow
    | undefined;
  return row ? mapPartStock(row) : null;
}

export function updateStockRemark(db: SqliteDb, partId: string, remark: string | null): PartStock {
  const previous = db.prepare("SELECT updated_at FROM part_stock WHERE part_id = ?").get(partId) as
    | { updated_at: string }
    | undefined;
  if (!previous) {
    throw new Error("配件库存不存在");
  }
  const updatedAt = nextIsoAfter(previous.updated_at);
  db.prepare("UPDATE part_stock SET remark = ?, updated_at = ? WHERE part_id = ?")
    .run(remark, updatedAt, partId);
  const stock = getPartStock(db, partId);
  if (!stock) {
    throw new Error("配件库存不存在");
  }
  return stock;
}

export function deletePurchaseOrder(db: SqliteDb, id: string): void {
  db.transaction(() => {
    const receipts = db.prepare(
      "SELECT inbound_quantity FROM purchase_receipts WHERE purchase_order_id = ?",
    ).all(id) as Array<{ inbound_quantity: number }>;
    if (receipts.length === 0) {
      throw new Error("采购订单不存在");
    }
    if (receipts.some((receipt) => receipt.inbound_quantity > 0)) {
      throw new Error("已入库采购订单不能删除");
    }
    db.prepare("DELETE FROM purchase_orders WHERE id = ?").run(id);
  })();
}

export function deleteOtherInbound(db: SqliteDb, id: string): void {
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM other_inbounds WHERE id = ?").get(id) as
      | OtherInboundRow
      | undefined;
    if (!row) {
      throw new Error("其它入库记录不存在");
    }
    const createdAt = nowIso();
    const delta = -row.inbound_quantity;
    db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
      .run(delta, createdAt, row.part_id);
    insertMovement(db, {
      partId: row.part_id,
      movementType: "其它入库",
      quantityDelta: delta,
      sourceId: id,
      sourceTable: "other_inbounds",
      remark: row.remark,
      createdAt,
    });
    db.prepare("DELETE FROM other_inbounds WHERE id = ?").run(id);
  })();
}

export function deleteOutboundRecord(db: SqliteDb, id: string): void {
  db.transaction(() => {
    const outbound = db.prepare("SELECT * FROM outbound_records WHERE id = ?").get(id) as
      | OutboundRecordRow
      | undefined;
    if (!outbound) {
      throw new Error("出库记录不存在");
    }
    const bomItems = loadBomItems(db, outbound.product_id);
    const required = bomItems.map((item) => ({
      partId: item.partId,
      quantity: item.quantity * outbound.outbound_quantity,
    }));
    const createdAt = nowIso();

    for (const item of required) {
      db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(item.quantity, createdAt, item.partId);
      insertMovement(db, {
        partId: item.partId,
        movementType: "产品出库",
        quantityDelta: item.quantity,
        sourceId: id,
        sourceTable: "outbound_records",
        remark: "删除出库记录补偿",
        createdAt,
      });
    }
    db.prepare("DELETE FROM outbound_records WHERE id = ?").run(id);
  })();
}

export function deleteStocktake(db: SqliteDb, id: string): void {
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM stocktakes WHERE id = ?").get(id) as
      | StocktakeRow
      | undefined;
    if (!row) {
      throw new Error("盘点记录不存在");
    }
    const delta = row.previous_quantity - row.actual_quantity;
    const createdAt = nowIso();
    if (delta !== 0) {
      db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, createdAt, row.part_id);
      insertMovement(db, {
        partId: row.part_id,
        movementType: "盘点调整",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "stocktakes",
        remark: row.remark,
        createdAt,
      });
    }
    db.prepare("DELETE FROM stocktakes WHERE id = ?").run(id);
  })();
}

export function getPartUsageFromOutboundSince(db: SqliteDb, sinceIso: string): PartUsage[] {
  return db.prepare(
    `
    SELECT pbi.part_id AS partId, SUM(orx.outbound_quantity * pbi.quantity) AS quantity
    FROM outbound_records orx
    JOIN product_bom_items pbi ON pbi.product_id = orx.product_id
    WHERE orx.outbound_time >= ?
    GROUP BY pbi.part_id
    ORDER BY pbi.part_id
    `,
  ).all(sinceIso) as PartUsage[];
}

function loadBomItems(db: SqliteDb, productId: string): ProductBomItem[] {
  return db.prepare(
    `
    SELECT product_id AS productId, part_id AS partId, quantity
    FROM product_bom_items
    WHERE product_id = ?
    ORDER BY part_id
    `,
  ).all(productId) as ProductBomItem[];
}

function loadStocksForParts(db: SqliteDb, partIds: string[]): PartStock[] {
  if (partIds.length === 0) {
    return [];
  }
  const placeholders = partIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT part_id, quantity, remark, last_stocktake_at FROM part_stock WHERE part_id IN (${placeholders})`,
  ).all(...partIds) as PartStockRow[];
  return rows.map(mapPartStock);
}

function insertMovement(
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
  db.prepare(
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
  if (inboundQuantity === purchaseQuantity) {
    return "已签收";
  }
  return "部分签收";
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
    status: row.status,
    weight: row.weight,
    imageUrl: row.image_url,
    specification: row.specification,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
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
