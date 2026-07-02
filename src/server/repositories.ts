import { calculateBomConsumption } from "../domain/inventory";
import type {
  LockedPartStock,
  OutboundPlan,
  OutboundPlanStatus,
  OutboundShipment,
  OutboundShipmentStatus,
  Part,
  PartStock,
  PartUsage,
  Product,
  ProductBomItem,
  PurchaseStatus,
  StoreProduct,
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
  status?: PurchaseStatus;
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
  orderNo?: string;
  inboundQuantity: number;
  addToExisting?: boolean;
  logisticsNo?: string | null;
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
  outboundQuantity?: number;
  preOutboundQuantity?: number;
  actualOutboundQuantity?: number;
  outboundTime?: string;
  operatorName: string;
  remark?: string | null;
  createdAt?: string;
}

export interface CreateOutboundResult {
  id: string;
  warnings: string[];
}

export interface CreateOutboundPlanInput {
  storeId: string;
  operatorName: string;
  remark?: string | null;
  createdAt?: string;
  items: Array<{
    productId: string;
    preOutboundQuantity: number;
  }>;
}

export interface CreateOutboundShipmentInput {
  planId: string;
  operatorName: string;
  outboundTime?: string;
  shipmentType?: string | null;
  goodsId?: string | null;
  pickupNo?: string | null;
  cartonCount?: number | null;
  weight?: number | null;
  dimensions?: string | null;
  remark?: string | null;
  items: Array<{
    planItemId: string;
    shippedQuantity: number;
    finishRemaining?: boolean;
  }>;
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
  logistics_no: string | null;
  purchase_quantity: number;
  inbound_quantity: number;
  status: PurchaseStatus;
  remark: string | null;
}

interface OutboundRecordRow {
  id: string;
  product_id: string;
  outbound_quantity: number;
  pre_outbound_quantity?: number;
  actual_outbound_quantity?: number;
  status: string;
  remark: string | null;
}

interface OutboundPlanRow {
  id: string;
  plan_no: string;
  store_id: string;
  store_name: string;
  operator_name: string;
  status: OutboundPlanStatus;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

interface OutboundPlanItemRow {
  id: string;
  plan_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  product_image_url: string | null;
  pre_outbound_quantity: number;
  shipped_quantity: number;
  cancelled_quantity: number;
  created_at: string;
  updated_at: string;
}

interface OutboundShipmentRow {
  id: string;
  shipment_no: string;
  plan_id: string;
  status: OutboundShipmentStatus;
  outbound_time: string;
  operator_name: string;
  shipment_type: string | null;
  goods_id: string | null;
  pickup_no: string | null;
  carton_count: number | null;
  weight: number | null;
  dimensions: string | null;
  remark: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface OutboundShipmentItemRow {
  id: string;
  shipment_id: string;
  plan_item_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  shipped_quantity: number;
  before_remaining_quantity: number;
  after_remaining_quantity: number;
  finish_remaining: number | boolean;
  created_at: string;
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
  const initialStatus = input.status ?? "已下单";
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
  const orderNo = input.orderNo?.trim() || createGeneratedOrderNo();
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
    const nextLogisticsNo = input.logisticsNo === undefined ? receipt.logistics_no : input.logisticsNo;
    const status = input.status ?? derivePurchaseStatus(nextInboundQuantity, receipt.purchase_quantity);
    const inboundTime = input.inboundTime ?? nowIso();
    const updatedAt = input.updatedAt ?? inboundTime;

    await db.prepare(
      `
      UPDATE purchase_receipts
      SET logistics_no = ?, inbound_quantity = ?, status = ?, remark = ?, inbound_time = ?, updated_at = ?
      WHERE id = ?
      `,
    ).run(nextLogisticsNo, nextInboundQuantity, status, input.remark ?? null, inboundTime, updatedAt, input.id);
    if (input.orderNo !== undefined) {
      await db.prepare("UPDATE purchase_orders SET order_no = ?, logistics_no = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(input.orderNo, nextLogisticsNo, status, updatedAt, receipt.purchase_order_id);
    } else {
      await db.prepare("UPDATE purchase_orders SET logistics_no = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(nextLogisticsNo, status, updatedAt, receipt.purchase_order_id);
    }

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

export async function setStoreProducts(db: SqliteDb, storeId: string, productIds: string[]) {
  const createdAt = nowIso();
  const uniqueProductIds = uniqueStrings(productIds);
  await db.transaction(async () => {
    await assertStoreExistsAndEnabled(db, storeId);
    await assertProductsExist(db, uniqueProductIds);
    await db.prepare("DELETE FROM store_products WHERE store_id = ?").run(storeId);
    const insert = db.prepare("INSERT INTO store_products (store_id, product_id, created_at) VALUES (?, ?, ?)");
    for (const productId of uniqueProductIds) {
      await insert.run(storeId, productId, createdAt);
    }
  });
  return listStoreProducts(db, storeId);
}

export async function listStoreProducts(db: SqliteDb, storeId: string): Promise<StoreProduct[]> {
  const rows = await db.prepare(
    [
      "SELECT products.id, products.code, products.name, products.image_url, products.remark",
      "FROM store_products",
      "JOIN products ON products.id = store_products.product_id",
      "WHERE store_products.store_id = ?",
      "ORDER BY products.code",
    ].join("\n"),
  ).all(storeId) as Array<Pick<ProductRow, "id" | "code" | "name" | "image_url" | "remark">>;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    imageUrl: row.image_url,
    remark: row.remark,
  }));
}

export async function setUserStores(db: SqliteDb, userId: string, storeIds: string[]) {
  const createdAt = nowIso();
  const uniqueStoreIds = uniqueStrings(storeIds);
  await db.transaction(async () => {
    const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: string } | undefined;
    if (!user) {
      throw new Error("用户不存在");
    }
    for (const storeId of uniqueStoreIds) {
      await assertStoreExistsAndEnabled(db, storeId);
    }
    await db.prepare("DELETE FROM user_stores WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO user_stores (user_id, store_id, created_at) VALUES (?, ?, ?)");
    for (const storeId of uniqueStoreIds) {
      await insert.run(userId, storeId, createdAt);
    }
  });
  return listUserStoreIds(db, userId);
}

export async function listUserStoreIds(db: SqliteDb, userId: string) {
  const rows = await db.prepare("SELECT store_id FROM user_stores WHERE user_id = ? ORDER BY store_id").all(userId) as Array<{
    store_id: string;
  }>;
  return rows.map((row) => row.store_id);
}

export async function createOutboundPlan(db: SqliteDb, input: CreateOutboundPlanInput): Promise<OutboundPlan> {
  const id = createId("outbound_plan");
  const createdAt = input.createdAt ?? nowIso();
  if (input.items.length === 0) {
    throw new Error("预发货明细不能为空");
  }

  await db.transaction(async () => {
    await assertStoreExistsAndEnabled(db, input.storeId);
    const boundProductIds = new Set((await listStoreProducts(db, input.storeId)).map((product) => product.id));
    if (boundProductIds.size === 0) {
      throw new Error("该店铺尚未绑定可出库产品");
    }
    for (const item of input.items) {
      if (!Number.isInteger(item.preOutboundQuantity) || item.preOutboundQuantity <= 0) {
        throw new Error("预出库数量必须为正整数");
      }
      if (!boundProductIds.has(item.productId)) {
        throw new Error("产品未绑定到该店铺");
      }
      const bomItems = await loadBomItems(db, item.productId);
      if (bomItems.length === 0) {
        throw new Error("产品 BOM 不能为空");
      }
    }

    await db.prepare(
      [
        "INSERT INTO outbound_plans (",
        "  id, plan_no, store_id, operator_name, status, remark, created_at, updated_at",
        ")",
        "VALUES (?, ?, ?, ?, '预出库', ?, ?, ?)",
      ].join("\n"),
    ).run(id, createGeneratedPlanNo(), input.storeId, input.operatorName, input.remark ?? null, createdAt, createdAt);

    const insertItem = db.prepare(
      [
        "INSERT INTO outbound_plan_items (",
        "  id, plan_id, product_id, pre_outbound_quantity, shipped_quantity, cancelled_quantity, created_at, updated_at",
        ")",
        "VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
      ].join("\n"),
    );
    for (const item of input.items) {
      await insertItem.run(createId("outbound_plan_item"), id, item.productId, item.preOutboundQuantity, createdAt, createdAt);
    }
  });

  return getOutboundPlan(db, id);
}

export async function listOutboundPlans(
  db: SqliteDb,
  filters: { storeIds?: string[] | null } = {},
): Promise<OutboundPlan[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.storeIds && filters.storeIds.length > 0) {
    conditions.push("outbound_plans.store_id IN (" + filters.storeIds.map(() => "?").join(", ") + ")");
    params.push(...filters.storeIds);
  } else if (filters.storeIds && filters.storeIds.length === 0) {
    return [];
  }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const rows = await db.prepare(
    [
      "SELECT outbound_plans.*, outbound_stores.name AS store_name",
      "FROM outbound_plans",
      "JOIN outbound_stores ON outbound_stores.id = outbound_plans.store_id",
      where,
      "ORDER BY outbound_plans.created_at DESC",
    ].filter(Boolean).join("\n"),
  ).all(...params) as OutboundPlanRow[];
  const plans: OutboundPlan[] = [];
  for (const row of rows) {
    plans.push(await toOutboundPlan(db, row));
  }
  return plans;
}

export async function getOutboundPlan(db: SqliteDb, id: string): Promise<OutboundPlan> {
  const row = await loadOutboundPlanRow(db, id);
  if (!row) {
    throw new Error("预发货清单不存在");
  }
  return toOutboundPlan(db, row);
}

export async function createOutboundShipment(db: SqliteDb, input: CreateOutboundShipmentInput): Promise<OutboundShipment> {
  const id = createId("outbound_shipment");
  const outboundTime = input.outboundTime ?? nowIso();
  await db.transaction(async () => {
    const plan = await loadOutboundPlanRow(db, input.planId);
    if (!plan) {
      throw new Error("预发货清单不存在");
    }
    if (plan.status === "已出库" || plan.status === "已取消") {
      throw new Error("该预发货清单已结束");
    }

    await db.prepare(
      [
        "INSERT INTO outbound_shipments (",
        "  id, shipment_no, plan_id, status, outbound_time, operator_name, shipment_type,",
        "  goods_id, pickup_no, carton_count, weight, dimensions, remark, reviewed_by, reviewed_at, created_at, updated_at",
        ")",
        "VALUES (?, ?, ?, '待审核', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
      ].join("\n"),
    ).run(
      id,
      createGeneratedShipmentNo(),
      input.planId,
      outboundTime,
      input.operatorName,
      input.shipmentType ?? null,
      input.goodsId ?? null,
      input.pickupNo ?? null,
      input.cartonCount ?? null,
      input.weight ?? null,
      input.dimensions ?? null,
      input.remark ?? null,
      outboundTime,
      outboundTime,
    );

    const insertItem = db.prepare(
      [
        "INSERT INTO outbound_shipment_items (",
        "  id, shipment_id, plan_item_id, product_id, shipped_quantity,",
        "  before_remaining_quantity, after_remaining_quantity, finish_remaining, created_at",
        ")",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join("\n"),
    );
    for (const item of input.items) {
      const planItem = await loadPlanItemForUpdate(db, item.planItemId);
      if (!planItem || planItem.plan_id !== input.planId) {
        throw new Error("预发货明细不存在");
      }
      const beforeRemaining = remainingQuantity(planItem);
      if (item.shippedQuantity === 0 && !item.finishRemaining) {
        throw new Error("本次发货数量必须大于 0，或勾选发货完结/移出发货单");
      }
      if (item.shippedQuantity > beforeRemaining) {
        throw new Error("本次发货数量不能超过剩余待发数量");
      }
      await insertItem.run(
        createId("outbound_shipment_item"),
        id,
        item.planItemId,
        planItem.product_id,
        item.shippedQuantity,
        beforeRemaining,
        beforeRemaining - item.shippedQuantity,
        item.finishRemaining ? 1 : 0,
        outboundTime,
      );
    }
  });

  return getOutboundShipment(db, id);
}

export async function listOutboundShipments(
  db: SqliteDb,
  filters: { status?: string | null } = {},
): Promise<OutboundShipment[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const rows = await db.prepare(
    [
      "SELECT *",
      "FROM outbound_shipments",
      where,
      "ORDER BY created_at DESC",
    ].filter(Boolean).join("\n"),
  ).all(...params) as OutboundShipmentRow[];
  const shipments: OutboundShipment[] = [];
  for (const row of rows) {
    shipments.push(await toOutboundShipment(db, row));
  }
  return shipments;
}

export async function approveOutboundShipment(
  db: SqliteDb,
  id: string,
  reviewerName: string | null = null,
  adjustments: Array<{ shipmentItemId: string; shippedQuantity: number }> = [],
) {
  const warnings: string[] = [];
  await db.transaction(async () => {
    const shipment = await db.prepare("SELECT * FROM outbound_shipments WHERE id = ? FOR UPDATE").get(id) as
      | OutboundShipmentRow
      | undefined;
    if (!shipment) {
      throw new Error("发货批次不存在");
    }
    if (shipment.status === "已出库") {
      throw new Error("该发货批次已审核");
    }

    const items = await loadShipmentItemRows(db, id);
    const adjustmentByItemId = new Map(adjustments.map((item) => [item.shipmentItemId, item.shippedQuantity]));
    if (adjustmentByItemId.size !== adjustments.length || Array.from(adjustmentByItemId.keys()).some((itemId) => !items.some((item) => item.id === itemId))) {
      throw new Error("发货批次明细不存在");
    }
    const reviewedAt = nowIso();
    const requiredByPart = new Map<string, { quantity: number; code: string; name: string }>();
    for (const item of items) {
      const planItem = await loadPlanItemForUpdate(db, item.plan_item_id);
      if (!planItem) {
        throw new Error("预发货明细不存在");
      }
      const currentRemaining = remainingQuantity(planItem);
      const shippedQuantity = adjustmentByItemId.get(item.id) ?? item.shipped_quantity;
      if (shippedQuantity === 0 && Number(item.finish_remaining) !== 1) {
        throw new Error("本次发货数量必须大于 0，或勾选发货完结/移出发货单");
      }
      if (shippedQuantity > currentRemaining) {
        throw new Error("本次发货数量不能超过剩余待发数量");
      }
      if (shippedQuantity !== item.shipped_quantity) {
        await db.prepare(
          [
            "UPDATE outbound_shipment_items",
            "SET shipped_quantity = ?, before_remaining_quantity = ?, after_remaining_quantity = ?",
            "WHERE id = ?",
          ].join("\n"),
        ).run(shippedQuantity, currentRemaining, currentRemaining - shippedQuantity, item.id);
      }
      const cancelled = Number(item.finish_remaining) === 1 ? currentRemaining - shippedQuantity : 0;
      await db.prepare(
        [
          "UPDATE outbound_plan_items",
          "SET shipped_quantity = shipped_quantity + ?,",
          "    cancelled_quantity = cancelled_quantity + ?,",
          "    updated_at = ?",
          "WHERE id = ?",
        ].join("\n"),
      ).run(shippedQuantity, cancelled, reviewedAt, item.plan_item_id);

      const bomItems = await loadBomItems(db, item.product_id);
      for (const required of calculateBomConsumption(bomItems, shippedQuantity)) {
        const bom = bomItems.find((candidate) => candidate.partId === required.partId);
        const previous = requiredByPart.get(required.partId);
        requiredByPart.set(required.partId, {
          quantity: (previous?.quantity ?? 0) + required.quantity,
          code: bom?.partCode ?? required.partId,
          name: bom?.partName ?? required.partId,
        });
      }
    }

    const stocks = await loadStocksForParts(db, Array.from(requiredByPart.keys()));
    const stockByPart = new Map(stocks.map((stock) => [stock.partId, stock.quantity]));
    for (const [partId, required] of requiredByPart.entries()) {
      const current = stockByPart.get(partId) ?? 0;
      if (current < required.quantity) {
        warnings.push("配件 " + required.name + "（" + required.code + "）库存不足：需要 " + required.quantity + "，当前 " + current + "，保存后为 " + (current - required.quantity));
      }
      const delta = -required.quantity;
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, reviewedAt, partId);
      await insertMovement(db, {
        partId,
        movementType: "产品出库",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "outbound_shipments",
        remark: shipment.remark ?? null,
        createdAt: reviewedAt,
      });
    }

    await db.prepare("UPDATE outbound_shipments SET status = '已出库', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
      .run(reviewerName, reviewedAt, reviewedAt, id);
    await refreshPlanStatus(db, shipment.plan_id, reviewedAt);
  });

  return { ...(await getOutboundShipment(db, id)), warnings };
}

export async function listLockedPartStock(db: SqliteDb): Promise<LockedPartStock[]> {
  const rows = await db.prepare(
    [
      "SELECT",
      "  parts.id AS part_id,",
      "  parts.code AS part_code,",
      "  parts.name AS part_name,",
      "  part_stock.quantity AS current_stock,",
      "  SUM((outbound_plan_items.pre_outbound_quantity - outbound_plan_items.shipped_quantity - outbound_plan_items.cancelled_quantity) * product_bom_items.quantity) AS locked_quantity",
      "FROM outbound_plan_items",
      "JOIN outbound_plans ON outbound_plans.id = outbound_plan_items.plan_id",
      "JOIN product_bom_items ON product_bom_items.product_id = outbound_plan_items.product_id",
      "JOIN parts ON parts.id = product_bom_items.part_id",
      "JOIN part_stock ON part_stock.part_id = parts.id",
      "WHERE outbound_plans.status IN ('预出库', '部分发货')",
      "  AND outbound_plan_items.pre_outbound_quantity > outbound_plan_items.shipped_quantity + outbound_plan_items.cancelled_quantity",
      "GROUP BY parts.id, parts.code, parts.name, part_stock.quantity",
      "ORDER BY parts.code",
    ].join("\n"),
  ).all() as Array<{
    part_id: string;
    part_code: string;
    part_name: string;
    current_stock: number;
    locked_quantity: number | string;
  }>;
  return rows.map((row) => {
    const currentStock = Number(row.current_stock);
    const lockedQuantity = Number(row.locked_quantity);
    return {
      partId: row.part_id,
      partCode: row.part_code,
      partName: row.part_name,
      currentStock,
      lockedQuantity,
      availableQuantity: currentStock - lockedQuantity,
    };
  });
}

export async function createOutboundRecord(db: SqliteDb, input: CreateOutboundInput) {
  const id = createId("outbound");
  const outboundTime = input.outboundTime ?? nowIso();
  const createdAt = input.createdAt ?? outboundTime;
  const preOutboundQuantity = input.preOutboundQuantity ?? input.outboundQuantity ?? 0;
  const actualOutboundQuantity = input.actualOutboundQuantity ?? preOutboundQuantity;
  if (!Number.isInteger(preOutboundQuantity) || preOutboundQuantity <= 0) {
    throw new Error("预出库数量必须为正整数");
  }
  if (!Number.isInteger(actualOutboundQuantity) || actualOutboundQuantity <= 0) {
    throw new Error("实际出库数量必须为正整数");
  }

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

    await db.prepare(
      `
      INSERT INTO outbound_records (
        id, product_id, store_id, outbound_quantity, pre_outbound_quantity, actual_outbound_quantity, outbound_time, operator_name, status, remark, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待审核', ?, ?)
      `,
    ).run(
      id,
      input.productId,
      input.storeId,
      preOutboundQuantity,
      preOutboundQuantity,
      actualOutboundQuantity,
      outboundTime,
      input.operatorName,
      input.remark ?? null,
      createdAt,
    );
  });

  return { id, warnings: [] };
}

export async function approveOutboundRecord(db: SqliteDb, id: string, reviewerName: string | null = null) {
  const warnings: string[] = [];
  await db.transaction(async () => {
    const outbound = await db.prepare("SELECT * FROM outbound_records WHERE id = ? FOR UPDATE").get(id) as
      | (OutboundRecordRow & { status?: string; reviewed_by?: string | null; reviewed_at?: string | null })
      | undefined;
    if (!outbound) {
      throw new Error("出库记录不存在");
    }
    if (outbound.status === "已出库") {
      throw new Error("该出库记录已审核");
    }

    const bomItems = await loadBomItems(db, outbound.product_id);
    if (bomItems.length === 0) {
      throw new Error("产品 BOM 不能为空");
    }
    const stocks = await loadStocksForParts(db, bomItems.map((item) => item.partId));
    const stockByPart = new Map(stocks.map((stock) => [stock.partId, stock.quantity]));
    const actualOutboundQuantity = Number(outbound.actual_outbound_quantity ?? outbound.outbound_quantity);
    const required = calculateBomConsumption(bomItems, actualOutboundQuantity);
    const reviewedAt = nowIso();

    for (const item of required) {
      const current = stockByPart.get(item.partId) ?? 0;
      if (current < item.quantity) {
        const bomItem = bomItems.find((candidate) => candidate.partId === item.partId);
        const label = bomItem ? `${bomItem.partName}（${bomItem.partCode}）` : item.partId;
        warnings.push(`配件 ${label}库存不足：需要 ${item.quantity}，当前 ${current}，保存后为 ${current - item.quantity}`);
      }
      const delta = -item.quantity;
      await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
        .run(delta, reviewedAt, item.partId);
      await insertMovement(db, {
        partId: item.partId,
        movementType: "产品出库",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "outbound_records",
        remark: outbound.remark ?? null,
        createdAt: reviewedAt,
      });
    }
    await db.prepare("UPDATE outbound_records SET status = '已出库', reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .run(reviewerName, reviewedAt, id);
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
      "SELECT inbound_quantity, status FROM purchase_receipts WHERE purchase_order_id = ?",
  ).all(id) as Array<{ inbound_quantity: number; status: string }>;
    if (receipts.length === 0) {
      throw new Error("采购订单不存在");
    }
    if (receipts.some((receipt) => receipt.inbound_quantity > 0)) {
      throw new Error("已入库采购订单不能删除");
    }
    if (receipts.some((receipt) => receipt.status !== "已下单")) {
      throw new Error("仅已下单状态的采购订单允许删除");
    }
    await db.prepare("DELETE FROM purchase_orders WHERE id = ?").run(id);
    await db.prepare("DELETE FROM purchase_receipts WHERE purchase_order_id = ?").run(id);
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
    SELECT part_id AS "partId", SUM(quantity) AS quantity
    FROM (
      SELECT
        product_bom_items.part_id,
        SUM(COALESCE(outbound_records.actual_outbound_quantity, outbound_records.outbound_quantity) * product_bom_items.quantity) AS quantity
      FROM outbound_records
      JOIN product_bom_items ON product_bom_items.product_id = outbound_records.product_id
      WHERE outbound_records.outbound_time >= ? AND outbound_records.status = '已出库'
      GROUP BY product_bom_items.part_id
      UNION ALL
      SELECT
        product_bom_items.part_id,
        SUM(outbound_shipment_items.shipped_quantity * product_bom_items.quantity) AS quantity
      FROM outbound_shipment_items
      JOIN outbound_shipments ON outbound_shipments.id = outbound_shipment_items.shipment_id
      JOIN product_bom_items ON product_bom_items.product_id = outbound_shipment_items.product_id
      WHERE outbound_shipments.outbound_time >= ? AND outbound_shipments.status = '已出库'
      GROUP BY product_bom_items.part_id
    ) usage
    GROUP BY part_id
    ORDER BY part_id
    `,
  ).all(sinceIso, sinceIso) as Array<{ partId: string; quantity: number | string }>;
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

async function assertStoreExistsAndEnabled(db: SqliteDb, storeId: string) {
  const store = await db.prepare("SELECT enabled FROM outbound_stores WHERE id = ?").get(storeId) as
    | { enabled: number | string | boolean }
    | undefined;
  if (!store) {
    throw new Error("出库店铺不存在");
  }
  if (Number(store.enabled) !== 1) {
    throw new Error("该店铺已停用，不能用于新增出库");
  }
}

async function assertProductsExist(db: SqliteDb, productIds: string[]) {
  for (const productId of productIds) {
    const product = await db.prepare("SELECT id FROM products WHERE id = ?").get(productId) as { id: string } | undefined;
    if (!product) {
      throw new Error("产品不存在");
    }
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

async function loadOutboundPlanRow(db: SqliteDb, id: string) {
  return await db.prepare(
    [
      "SELECT outbound_plans.*, outbound_stores.name AS store_name",
      "FROM outbound_plans",
      "JOIN outbound_stores ON outbound_stores.id = outbound_plans.store_id",
      "WHERE outbound_plans.id = ?",
    ].join("\n"),
  ).get(id) as OutboundPlanRow | undefined;
}

async function loadOutboundPlanItemRows(db: SqliteDb, planId: string) {
  return await db.prepare(
    [
      "SELECT",
      "  outbound_plan_items.*,",
      "  products.code AS product_code,",
      "  products.name AS product_name,",
      "  products.image_url AS product_image_url",
      "FROM outbound_plan_items",
      "JOIN products ON products.id = outbound_plan_items.product_id",
      "WHERE outbound_plan_items.plan_id = ?",
      "ORDER BY products.code, outbound_plan_items.id",
    ].join("\n"),
  ).all(planId) as OutboundPlanItemRow[];
}

async function loadPlanItemForUpdate(db: SqliteDb, id: string) {
  return await db.prepare(
    [
      "SELECT",
      "  outbound_plan_items.*,",
      "  products.code AS product_code,",
      "  products.name AS product_name,",
      "  products.image_url AS product_image_url",
      "FROM outbound_plan_items",
      "JOIN products ON products.id = outbound_plan_items.product_id",
      "WHERE outbound_plan_items.id = ?",
      "FOR UPDATE",
    ].join("\n"),
  ).get(id) as OutboundPlanItemRow | undefined;
}

async function getOutboundShipment(db: SqliteDb, id: string): Promise<OutboundShipment> {
  const row = await db.prepare("SELECT * FROM outbound_shipments WHERE id = ?").get(id) as OutboundShipmentRow | undefined;
  if (!row) {
    throw new Error("发货批次不存在");
  }
  return toOutboundShipment(db, row);
}

async function loadShipmentItemRows(db: SqliteDb, shipmentId: string) {
  return await db.prepare(
    [
      "SELECT",
      "  outbound_shipment_items.*,",
      "  products.code AS product_code,",
      "  products.name AS product_name",
      "FROM outbound_shipment_items",
      "JOIN products ON products.id = outbound_shipment_items.product_id",
      "WHERE outbound_shipment_items.shipment_id = ?",
      "ORDER BY outbound_shipment_items.created_at, outbound_shipment_items.id",
    ].join("\n"),
  ).all(shipmentId) as OutboundShipmentItemRow[];
}

async function refreshPlanStatus(db: SqliteDb, planId: string, updatedAt: string) {
  const rows = await db.prepare(
    "SELECT pre_outbound_quantity, shipped_quantity, cancelled_quantity FROM outbound_plan_items WHERE plan_id = ?",
  ).all(planId) as Array<{
    pre_outbound_quantity: number;
    shipped_quantity: number;
    cancelled_quantity: number;
  }>;
  const totalShipped = rows.reduce((sum, row) => sum + Number(row.shipped_quantity), 0);
  const totalRemaining = rows.reduce((sum, row) => sum + Number(row.pre_outbound_quantity) - Number(row.shipped_quantity) - Number(row.cancelled_quantity), 0);
  const status: OutboundPlanStatus = totalRemaining <= 0 ? "已出库" : totalShipped > 0 ? "部分发货" : "预出库";
  await db.prepare("UPDATE outbound_plans SET status = ?, updated_at = ? WHERE id = ?").run(status, updatedAt, planId);
}

function remainingQuantity(row: Pick<OutboundPlanItemRow, "pre_outbound_quantity" | "shipped_quantity" | "cancelled_quantity">) {
  return Number(row.pre_outbound_quantity) - Number(row.shipped_quantity) - Number(row.cancelled_quantity);
}

async function insertMovement(
  db: SqliteDb,
  input: {
    partId: string;
    movementType: "采购入库" | "其它入库" | "产品出库" | "盘点调整";
    quantityDelta: number;
    sourceId: string;
    sourceTable: "purchase_receipts" | "other_inbounds" | "outbound_records" | "outbound_shipments" | "stocktakes";
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
    return "已下单";
  }
  if (inboundQuantity >= purchaseQuantity) {
    return "已入库";
  }
  return "部分入库";
}

function createGeneratedOrderNo(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `PO${timestamp}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function createGeneratedPlanNo(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return "OP" + timestamp + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function createGeneratedShipmentNo(): string {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return "OS" + timestamp + Math.random().toString(36).slice(2, 6).toUpperCase();
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

async function toOutboundPlan(db: SqliteDb, row: OutboundPlanRow): Promise<OutboundPlan> {
  return {
    id: row.id,
    planNo: row.plan_no,
    storeId: row.store_id,
    storeName: row.store_name,
    operatorName: row.operator_name,
    status: row.status,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (await loadOutboundPlanItemRows(db, row.id)).map(toOutboundPlanItem),
  };
}

function toOutboundPlanItem(row: OutboundPlanItemRow) {
  return {
    id: row.id,
    planId: row.plan_id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    productImageUrl: row.product_image_url,
    preOutboundQuantity: Number(row.pre_outbound_quantity),
    shippedQuantity: Number(row.shipped_quantity),
    cancelledQuantity: Number(row.cancelled_quantity),
    remainingQuantity: remainingQuantity(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function toOutboundShipment(db: SqliteDb, row: OutboundShipmentRow): Promise<OutboundShipment> {
  return {
    id: row.id,
    shipmentNo: row.shipment_no,
    planId: row.plan_id,
    status: row.status,
    outboundTime: row.outbound_time,
    operatorName: row.operator_name,
    shipmentType: row.shipment_type,
    goodsId: row.goods_id,
    pickupNo: row.pickup_no,
    cartonCount: row.carton_count === null ? null : Number(row.carton_count),
    weight: row.weight === null ? null : Number(row.weight),
    dimensions: row.dimensions,
    remark: row.remark,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (await loadShipmentItemRows(db, row.id)).map(toOutboundShipmentItem),
  };
}

function toOutboundShipmentItem(row: OutboundShipmentItemRow) {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    planItemId: row.plan_item_id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    shippedQuantity: Number(row.shipped_quantity),
    beforeRemainingQuantity: Number(row.before_remaining_quantity),
    afterRemainingQuantity: Number(row.after_remaining_quantity),
    finishRemaining: Number(row.finish_remaining) === 1,
    createdAt: row.created_at,
  };
}
