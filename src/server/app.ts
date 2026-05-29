import cookieParser from "cookie-parser";
import cors from "cors";
import type { Request, Response } from "express";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { calculateLowStockParts } from "../domain/inventory";
import {
  loginSchema,
  otherInboundSchema,
  outboundSchema,
  partSchema,
  productSchema,
  purchaseOrderSchema,
  receivePurchaseReceiptSchema,
  stockRemarkSchema,
  stocktakeSchema,
  storeSchema,
} from "../shared/schemas";
import type { NamedPartStock, Part, Product, ProductBomItem, User, UserRole } from "../shared/types";
import {
  clearSession,
  clearSessionCookie,
  login,
  requireAuth,
  requireRole,
  seedDefaultUsers,
  setSessionCookie,
  SESSION_COOKIE_NAME,
} from "./auth";
import { createId, migrate, nowIso, openDatabase, type SqliteDb } from "./db";
import { toCsv } from "./export";
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
  getPartUsageFromOutboundSince,
  receivePurchaseReceipt,
  updateStockRemark,
  updateStore,
} from "./repositories";
import { handlePartImageUpload, uploadPartImage } from "./uploads";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
};

type PartRow = {
  id: string;
  code: string;
  name: string;
  status: "在售" | "不在售";
  weight: number | null;
  image_url: string | null;
  specification: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  code: string;
  name: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

type PurchaseOrderRow = {
  id: string;
  order_no: string;
  logistics_no: string | null;
  part_id: string;
  part_code: string;
  part_name: string;
  part_image_url: string | null;
  order_quantity: number;
  status: string;
  remark: string | null;
  order_time: string;
  created_at: string;
  updated_at: string;
};

type PurchaseReceiptRow = {
  id: string;
  receipt_no: string;
  purchase_order_id: string;
  order_no: string;
  logistics_no: string | null;
  part_id: string;
  part_code: string;
  part_name: string;
  part_image_url: string | null;
  purchase_quantity: number;
  inbound_quantity: number;
  status: string;
  remark: string | null;
  inbound_time: string | null;
  created_at: string;
  updated_at: string;
};

type OtherInboundRow = {
  id: string;
  inbound_no: string;
  part_id: string;
  part_code: string;
  part_name: string;
  part_image_url: string | null;
  inbound_quantity: number;
  inbound_time: string;
  operator_name: string | null;
  remark: string | null;
  created_at: string;
};

type StoreRow = {
  id: string;
  name: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

type OutboundRecordRow = {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  store_id: string;
  store_name: string;
  outbound_quantity: number;
  outbound_time: string;
  operator_name: string;
  remark: string | null;
  created_at: string;
};

type StockRow = {
  part_id: string;
  part_code: string;
  part_name: string;
  status: string;
  image_url: string | null;
  specification: string | null;
  quantity: number;
  remark: string | null;
  last_stocktake_at: string | null;
  updated_at: string;
};

type StocktakeRow = {
  id: string;
  part_id: string;
  part_code: string;
  part_name: string;
  part_image_url: string | null;
  previous_quantity: number;
  actual_quantity: number;
  remark: string | null;
  stocktake_time: string;
  created_at: string;
};

type RouteHandler = (request: Request, response: Response) => void;

export function createApp(db: SqliteDb = openDatabase()) {
  migrate(db);
  seedDefaultUsers(db);

  const app = express();
  const operatorRoutes = [requireAuth(db)];
  const adminRoutes = [requireAuth(db), requireRole("admin")];

  app.use(cors({ credentials: true, origin: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use("/uploads", express.static(path.resolve("uploads")));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/auth/login", route((request, response) => {
    const body = parseBody(loginSchema, request.body);
    const result = login(db, body.username, body.password);
    if (!result) {
      response.status(401).json({ error: "账号或密码错误" });
      return;
    }

    setSessionCookie(response, result.token);
    response.json({ user: result.user });
  }));

  app.get("/api/auth/me", requireAuth(db), (_request, response) => {
    response.json({ user: response.locals.user });
  });

  app.post("/api/auth/logout", (request, response) => {
    clearSession(db, request.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/users", requireAuth(db), requireRole("admin"), (_request, response) => {
    const users = db
      .prepare(
        `
        SELECT id, username, display_name, role, enabled, created_at, updated_at
        FROM users
        ORDER BY username
        `,
      )
      .all() as UserRow[];

    response.json({ users: users.map(toUser) });
  });

  app.post("/api/uploads/parts", ...adminRoutes, (request, response) => {
    uploadPartImage.single("file")(request, response, (error) => {
      if (error) {
        sendError(response, error);
        return;
      }
      try {
        handlePartImageUpload(request, response);
      } catch (innerError) {
        sendError(response, innerError);
      }
    });
  });

  app.get("/api/parts", ...operatorRoutes, route((request, response) => {
    response.json({ parts: listParts(db, queryString(request.query.q ?? request.query.search)) });
  }));
  app.post("/api/parts", ...adminRoutes, route((request, response) => {
    const part = createPart(db, parseBody(partSchema, request.body));
    response.status(201).json({ part });
  }));
  app.put("/api/parts/:id", ...adminRoutes, route((request, response) => {
    response.json({ part: updatePart(db, paramString(request.params.id, "id"), parseBody(partSchema, request.body)) });
  }));
  app.delete("/api/parts/:id", ...adminRoutes, route((request, response) => {
    deleteById(db, "parts", paramString(request.params.id, "id"), "配件不存在");
    response.json({ ok: true });
  }));

  app.get("/api/products", ...operatorRoutes, route((_request, response) => {
    response.json({ products: listProducts(db) });
  }));
  app.post("/api/products", ...adminRoutes, route((request, response) => {
    const product = createProductWithBom(db, parseBody(productSchema, request.body));
    response.status(201).json({ product: getProduct(db, product.id) });
  }));
  app.put("/api/products/:id", ...adminRoutes, route((request, response) => {
    response.json({
      product: updateProduct(db, paramString(request.params.id, "id"), parseBody(productSchema, request.body)),
    });
  }));
  app.delete("/api/products/:id", ...adminRoutes, route((request, response) => {
    deleteById(db, "products", paramString(request.params.id, "id"), "产品不存在");
    response.json({ ok: true });
  }));

  app.get("/api/purchase-orders", ...operatorRoutes, route((request, response) => {
    response.json({ purchaseOrders: listPurchaseOrders(db, { from: queryString(request.query.from) }) });
  }));
  app.post("/api/purchase-orders", ...operatorRoutes, route((request, response) => {
    const purchaseOrder = createPurchaseOrder(db, parseBody(purchaseOrderSchema, request.body));
    response.status(201).json({ purchaseOrder: getPurchaseOrder(db, purchaseOrder.id) });
  }));
  app.delete("/api/purchase-orders/:id", ...adminRoutes, route((request, response) => {
    deletePurchaseOrder(db, paramString(request.params.id, "id"));
    response.json({ ok: true });
  }));

  app.get("/api/purchase-receipts", ...operatorRoutes, route((request, response) => {
    response.json({
      purchaseReceipts: listPurchaseReceipts(db, {
        from: queryString(request.query.from),
        status: queryString(request.query.status),
      }),
    });
  }));
  app.post("/api/purchase-receipts/:purchaseOrderId/receive", ...operatorRoutes, route((request, response) => {
    const receipt = db
      .prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(paramString(request.params.purchaseOrderId, "purchaseOrderId")) as { id: string } | undefined;
    if (!receipt) {
      throw new Error("采购入库单不存在");
    }

    receivePurchaseReceipt(db, { id: receipt.id, ...parseBody(receivePurchaseReceiptSchema, request.body) });
    response.json({ purchaseReceipt: getPurchaseReceipt(db, receipt.id) });
  }));

  app.get("/api/other-inbounds", ...operatorRoutes, route((request, response) => {
    response.json({ otherInbounds: listOtherInbounds(db, { from: queryString(request.query.from) }) });
  }));
  app.post("/api/other-inbounds", ...operatorRoutes, route((request, response) => {
    const otherInbound = createOtherInboundRecord(db, parseBody(otherInboundSchema, request.body));
    response.status(201).json({ otherInbound });
  }));
  app.delete("/api/other-inbounds/:id", ...adminRoutes, route((request, response) => {
    deleteOtherInbound(db, paramString(request.params.id, "id"));
    response.json({ ok: true });
  }));

  app.get("/api/stores", ...operatorRoutes, route((_request, response) => {
    response.json({ stores: listStores(db) });
  }));
  app.post("/api/stores", ...adminRoutes, route((request, response) => {
    const store = createStore(db, parseBody(storeSchema, request.body));
    response.status(201).json({ store: getStore(db, store.id) });
  }));
  app.put("/api/stores/:id", ...adminRoutes, route((request, response) => {
    const id = paramString(request.params.id, "id");
    updateStore(db, id, parseBody(storeSchema, request.body));
    response.json({ store: getStore(db, id) });
  }));
  app.delete("/api/stores/:id", ...adminRoutes, route((request, response) => {
    deleteById(db, "outbound_stores", paramString(request.params.id, "id"), "店铺不存在");
    response.json({ ok: true });
  }));

  app.get("/api/outbound-records", ...operatorRoutes, route((request, response) => {
    response.json({ outboundRecords: listOutboundRecords(db, { from: queryString(request.query.from) }) });
  }));
  app.post("/api/outbound-records", ...operatorRoutes, route((request, response) => {
    const outboundRecord = createOutboundRecord(db, parseBody(outboundSchema, request.body));
    response.status(201).json({ outboundRecord: getOutboundRecord(db, outboundRecord.id) });
  }));
  app.delete("/api/outbound-records/:id", ...adminRoutes, route((request, response) => {
    deleteOutboundRecord(db, paramString(request.params.id, "id"));
    response.json({ ok: true });
  }));

  app.get("/api/stock", ...operatorRoutes, route((request, response) => {
    response.json({ stock: listStock(db, queryString(request.query.q ?? request.query.search)) });
  }));
  app.put("/api/stock/:partId/remark", ...adminRoutes, route((request, response) => {
    const stock = updateStockRemark(
      db,
      paramString(request.params.partId, "partId"),
      parseBody(stockRemarkSchema, request.body).remark,
    );
    response.json({ stock });
  }));

  app.get("/api/stocktakes", ...operatorRoutes, route((request, response) => {
    response.json({ stocktakes: listStocktakes(db, { from: queryString(request.query.from) }) });
  }));
  app.post("/api/stocktakes", ...operatorRoutes, route((request, response) => {
    const stocktake = createStocktakeRecord(db, parseBody(stocktakeSchema, request.body));
    response.status(201).json({ stocktake });
  }));
  app.delete("/api/stocktakes/:id", ...adminRoutes, route((request, response) => {
    deleteStocktake(db, paramString(request.params.id, "id"));
    response.json({ ok: true });
  }));

  app.get("/api/history", ...operatorRoutes, route((request, response) => {
    const from = historyFrom(request);
    response.json({
      from,
      purchaseOrders: listPurchaseOrders(db, { from }),
      purchaseReceipts: listPurchaseReceipts(db, { from }),
      otherInbounds: listOtherInbounds(db, { from }),
      outboundRecords: listOutboundRecords(db, { from }),
      stocktakes: listStocktakes(db, { from }),
    });
  }));

  app.get("/api/dashboard", ...operatorRoutes, route((_request, response) => {
    const periodDays = positiveIntegerFromEnv(process.env.LOW_STOCK_PERIOD_DAYS, 30);
    const sinceIso = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const pendingInboundReceipts = listPurchaseReceipts(db, { status: "pending" }).map((receipt) => ({
      purchaseOrderId: receipt.purchaseOrderId,
      receiptId: receipt.id,
      orderNo: receipt.orderNo,
      partName: receipt.partName,
      partImageUrl: receipt.partImageUrl,
      purchaseQuantity: receipt.purchaseQuantity,
      inboundQuantity: receipt.inboundQuantity,
      status: receipt.status,
    }));
    const stocks = db
      .prepare(
        `
        SELECT part_stock.part_id AS partId, parts.name AS partName, part_stock.quantity AS quantity
        FROM part_stock
        JOIN parts ON parts.id = part_stock.part_id
        ORDER BY parts.name
        `,
      )
      .all() as NamedPartStock[];
    const usage = getPartUsageFromOutboundSince(db, sinceIso);

    response.json({
      pendingInboundCount: pendingInboundReceipts.length,
      pendingInboundReceipts,
      lowStockParts: calculateLowStockParts(stocks, usage, periodDays, 10),
    });
  }));

  registerCsvRoutes(db, app, operatorRoutes);

  return app;
}

function route(handler: RouteHandler) {
  return (request: Request, response: Response) => {
    try {
      handler(request, response);
    } catch (error) {
      sendError(response, error);
    }
  };
}

function sendError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: error.issues[0]?.message ?? "请求参数错误" });
    return;
  }
  const message = error instanceof Error ? error.message : "请求处理失败";
  response.status(400).json({ error: message });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function queryString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function paramString(value: string | string[] | undefined, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} 参数错误`);
  }
  return value;
}

function historyFrom(request: Request) {
  const explicit = queryString(request.query.from);
  if (explicit) {
    return explicit;
  }
  const days = positiveIntegerFromEnv(queryString(request.query.days), 90);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function positiveIntegerFromEnv(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function listParts(db: SqliteDb, search: string | null = null): Part[] {
  const pattern = search ? `%${search}%` : null;
  return (db
    .prepare(
      `
      SELECT *
      FROM parts
      WHERE (? IS NULL OR code LIKE ? OR name LIKE ?)
      ORDER BY created_at DESC
      `,
    )
    .all(pattern, pattern, pattern) as PartRow[]).map(toPart);
}

function updatePart(db: SqliteDb, id: string, input: z.infer<typeof partSchema>): Part {
  const updatedAt = nowIso();
  const result = db
    .prepare(
      `
      UPDATE parts
      SET code = ?, name = ?, status = ?, weight = ?, image_url = ?, specification = ?, remark = ?, updated_at = ?
      WHERE id = ?
      `,
    )
    .run(
      input.code,
      input.name,
      input.status,
      input.weight,
      input.imageUrl,
      input.specification,
      input.remark,
      updatedAt,
      id,
    );
  if (result.changes === 0) {
    throw new Error("配件不存在");
  }
  const row = db.prepare("SELECT * FROM parts WHERE id = ?").get(id) as PartRow;
  return toPart(row);
}

function getProduct(db: SqliteDb, id: string) {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
  if (!row) {
    throw new Error("产品不存在");
  }
  return { ...toProduct(row), bomItems: listProductBomItems(db, id) };
}

function listProducts(db: SqliteDb) {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all() as ProductRow[];
  return rows.map((row) => ({ ...toProduct(row), bomItems: listProductBomItems(db, row.id) }));
}

function updateProduct(db: SqliteDb, id: string, input: z.infer<typeof productSchema>) {
  const updatedAt = nowIso();
  db.transaction(() => {
    const result = db
      .prepare("UPDATE products SET code = ?, name = ?, remark = ?, updated_at = ? WHERE id = ?")
      .run(input.code, input.name, input.remark, updatedAt, id);
    if (result.changes === 0) {
      throw new Error("产品不存在");
    }

    db.prepare("DELETE FROM product_bom_items WHERE product_id = ?").run(id);
    const insertBom = db.prepare(
      "INSERT INTO product_bom_items (product_id, part_id, quantity) VALUES (?, ?, ?)",
    );
    for (const item of input.bomItems) {
      insertBom.run(id, item.partId, item.quantity);
    }
  })();
  return getProduct(db, id);
}

function listProductBomItems(db: SqliteDb, productId: string) {
  return db
    .prepare(
      `
      SELECT
        product_bom_items.product_id AS productId,
        product_bom_items.part_id AS partId,
        parts.code AS partCode,
        parts.name AS partName,
        parts.image_url AS partImageUrl,
        product_bom_items.quantity AS quantity
      FROM product_bom_items
      JOIN parts ON parts.id = product_bom_items.part_id
      WHERE product_bom_items.product_id = ?
      ORDER BY parts.code
      `,
    )
    .all(productId) as Array<ProductBomItem & { partCode: string; partName: string }>;
}

function listPurchaseOrders(db: SqliteDb, filters: { from?: string | null } = {}) {
  const from = filters.from ?? null;
  return (db
    .prepare(
      `
      SELECT
        purchase_orders.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM purchase_orders
      JOIN parts ON parts.id = purchase_orders.part_id
      WHERE (? IS NULL OR purchase_orders.order_time >= ?)
      ORDER BY purchase_orders.order_time DESC
      `,
    )
    .all(from, from) as PurchaseOrderRow[]).map(toPurchaseOrder);
}

function getPurchaseOrder(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `
      SELECT
        purchase_orders.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM purchase_orders
      JOIN parts ON parts.id = purchase_orders.part_id
      WHERE purchase_orders.id = ?
      `,
    )
    .get(id) as PurchaseOrderRow | undefined;
  if (!row) {
    throw new Error("采购订单不存在");
  }
  return toPurchaseOrder(row);
}

function listPurchaseReceipts(
  db: SqliteDb,
  filters: { from?: string | null; status?: string | null } = {},
) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (filters.from) {
    conditions.push("COALESCE(purchase_receipts.inbound_time, purchase_receipts.created_at) >= ?");
    params.push(filters.from);
  }
  if (filters.status === "pending") {
    conditions.push("purchase_receipts.inbound_quantity < purchase_receipts.purchase_quantity");
  } else if (filters.status) {
    conditions.push("purchase_receipts.status = ?");
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return (db
    .prepare(
      `
      SELECT
        purchase_receipts.*,
        purchase_orders.order_no AS order_no,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM purchase_receipts
      JOIN purchase_orders ON purchase_orders.id = purchase_receipts.purchase_order_id
      JOIN parts ON parts.id = purchase_receipts.part_id
      ${where}
      ORDER BY COALESCE(purchase_receipts.inbound_time, purchase_receipts.created_at) DESC
      `,
    )
    .all(...params) as PurchaseReceiptRow[]).map(toPurchaseReceipt);
}

function getPurchaseReceipt(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `
      SELECT
        purchase_receipts.*,
        purchase_orders.order_no AS order_no,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM purchase_receipts
      JOIN purchase_orders ON purchase_orders.id = purchase_receipts.purchase_order_id
      JOIN parts ON parts.id = purchase_receipts.part_id
      WHERE purchase_receipts.id = ?
      `,
    )
    .get(id) as PurchaseReceiptRow | undefined;
  if (!row) {
    throw new Error("采购入库单不存在");
  }
  return toPurchaseReceipt(row);
}

function createOtherInboundRecord(db: SqliteDb, input: z.infer<typeof otherInboundSchema>) {
  const id = createId("other_inbound");
  const createdAt = nowIso();
  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO other_inbounds (
        id, inbound_no, part_id, inbound_quantity, inbound_time, operator_name, remark, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.inboundNo,
      input.partId,
      input.inboundQuantity,
      input.inboundTime,
      input.operatorName,
      input.remark,
      createdAt,
    );
    const stock = db
      .prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
      .run(input.inboundQuantity, input.inboundTime, input.partId);
    if (stock.changes === 0) {
      throw new Error("配件库存不存在");
    }
    insertStockMovement(db, {
      partId: input.partId,
      movementType: "其它入库",
      quantityDelta: input.inboundQuantity,
      sourceId: id,
      sourceTable: "other_inbounds",
      remark: input.remark,
      createdAt: input.inboundTime,
    });
  })();
  return getOtherInbound(db, id);
}

function listOtherInbounds(db: SqliteDb, filters: { from?: string | null } = {}) {
  const from = filters.from ?? null;
  return (db
    .prepare(
      `
      SELECT
        other_inbounds.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM other_inbounds
      JOIN parts ON parts.id = other_inbounds.part_id
      WHERE (? IS NULL OR other_inbounds.inbound_time >= ?)
      ORDER BY other_inbounds.inbound_time DESC
      `,
    )
    .all(from, from) as OtherInboundRow[]).map(toOtherInbound);
}

function getOtherInbound(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `
      SELECT
        other_inbounds.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM other_inbounds
      JOIN parts ON parts.id = other_inbounds.part_id
      WHERE other_inbounds.id = ?
      `,
    )
    .get(id) as OtherInboundRow | undefined;
  if (!row) {
    throw new Error("其它入库记录不存在");
  }
  return toOtherInbound(row);
}

function listStores(db: SqliteDb) {
  return (db.prepare("SELECT * FROM outbound_stores ORDER BY created_at DESC").all() as StoreRow[]).map(toStore);
}

function getStore(db: SqliteDb, id: string) {
  const row = db.prepare("SELECT * FROM outbound_stores WHERE id = ?").get(id) as StoreRow | undefined;
  if (!row) {
    throw new Error("店铺不存在");
  }
  return toStore(row);
}

function listOutboundRecords(db: SqliteDb, filters: { from?: string | null } = {}) {
  const from = filters.from ?? null;
  return (db
    .prepare(
      `
      SELECT
        outbound_records.*,
        products.code AS product_code,
        products.name AS product_name,
        outbound_stores.name AS store_name
      FROM outbound_records
      JOIN products ON products.id = outbound_records.product_id
      JOIN outbound_stores ON outbound_stores.id = outbound_records.store_id
      WHERE (? IS NULL OR outbound_records.outbound_time >= ?)
      ORDER BY outbound_records.outbound_time DESC
      `,
    )
    .all(from, from) as OutboundRecordRow[]).map(toOutboundRecord);
}

function getOutboundRecord(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `
      SELECT
        outbound_records.*,
        products.code AS product_code,
        products.name AS product_name,
        outbound_stores.name AS store_name
      FROM outbound_records
      JOIN products ON products.id = outbound_records.product_id
      JOIN outbound_stores ON outbound_stores.id = outbound_records.store_id
      WHERE outbound_records.id = ?
      `,
    )
    .get(id) as OutboundRecordRow | undefined;
  if (!row) {
    throw new Error("出库记录不存在");
  }
  return toOutboundRecord(row);
}

function listStock(db: SqliteDb, search: string | null = null) {
  const pattern = search ? `%${search}%` : null;
  return (db
    .prepare(
      `
      SELECT
        part_stock.part_id,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.status AS status,
        parts.image_url AS image_url,
        parts.specification AS specification,
        part_stock.quantity,
        part_stock.remark,
        part_stock.last_stocktake_at,
        part_stock.updated_at
      FROM part_stock
      JOIN parts ON parts.id = part_stock.part_id
      WHERE (? IS NULL OR parts.code LIKE ? OR parts.name LIKE ?)
      ORDER BY parts.code
      `,
    )
    .all(pattern, pattern, pattern) as StockRow[]).map(toStock);
}

function listStocktakes(db: SqliteDb, filters: { from?: string | null } = {}) {
  const from = filters.from ?? null;
  return (db
    .prepare(
      `
      SELECT
        stocktakes.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM stocktakes
      JOIN parts ON parts.id = stocktakes.part_id
      WHERE (? IS NULL OR stocktakes.stocktake_time >= ?)
      ORDER BY stocktakes.stocktake_time DESC
      `,
    )
    .all(from, from) as StocktakeRow[]).map(toStocktake);
}

function createStocktakeRecord(db: SqliteDb, input: z.infer<typeof stocktakeSchema>) {
  const stock = db
    .prepare("SELECT quantity FROM part_stock WHERE part_id = ?")
    .get(input.partId) as { quantity: number } | undefined;
  if (!stock) {
    throw new Error("配件库存不存在");
  }

  const id = createId("stocktake");
  const createdAt = nowIso();
  const delta = input.actualQuantity - stock.quantity;
  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO stocktakes (
        id, part_id, previous_quantity, actual_quantity, remark, stocktake_time, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(id, input.partId, stock.quantity, input.actualQuantity, input.remark, input.stocktakeTime, createdAt);
    db.prepare(
      `
      UPDATE part_stock
      SET quantity = ?, remark = ?, last_stocktake_at = ?, updated_at = ?
      WHERE part_id = ?
      `,
    ).run(input.actualQuantity, input.remark, input.stocktakeTime, input.stocktakeTime, input.partId);
    if (delta !== 0) {
      insertStockMovement(db, {
        partId: input.partId,
        movementType: "盘点调整",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "stocktakes",
        remark: input.remark,
        createdAt: input.stocktakeTime,
      });
    }
  })();
  return getStocktake(db, id);
}

function getStocktake(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `
      SELECT
        stocktakes.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM stocktakes
      JOIN parts ON parts.id = stocktakes.part_id
      WHERE stocktakes.id = ?
      `,
    )
    .get(id) as StocktakeRow | undefined;
  if (!row) {
    throw new Error("盘点记录不存在");
  }
  return toStocktake(row);
}

function insertStockMovement(
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

function deleteById(db: SqliteDb, table: string, id: string, notFoundMessage: string) {
  const allowedTables = new Set(["parts", "products", "outbound_stores"]);
  if (!allowedTables.has(table)) {
    throw new Error("不支持的删除表");
  }
  const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (result.changes === 0) {
    throw new Error(notFoundMessage);
  }
}

function registerCsvRoutes(
  db: SqliteDb,
  app: ReturnType<typeof express>,
  operatorRoutes: ReturnType<typeof requireAuth>[],
) {
  app.get("/api/parts.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "parts.csv", listParts(db));
  }));
  app.get("/api/products.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "products.csv", listProductCsvRows(db));
  }));
  app.get("/api/purchase-orders.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "purchase-orders.csv", listPurchaseOrders(db));
  }));
  app.get("/api/purchase-receipts.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "purchase-receipts.csv", listPurchaseReceipts(db));
  }));
  app.get("/api/other-inbounds.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "other-inbounds.csv", listOtherInbounds(db));
  }));
  app.get("/api/outbound-records.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "outbound-records.csv", listOutboundRecords(db));
  }));
  app.get("/api/stock.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "stock.csv", listStock(db));
  }));
  app.get("/api/stocktakes.csv", ...operatorRoutes, route((_request, response) => {
    sendCsv(response, "stocktakes.csv", listStocktakes(db));
  }));
  app.get("/api/history/purchase-orders.csv", ...operatorRoutes, route((request, response) => {
    sendCsv(response, "history-purchase-orders.csv", listPurchaseOrders(db, { from: historyFrom(request) }));
  }));
  app.get("/api/history/purchase-receipts.csv", ...operatorRoutes, route((request, response) => {
    sendCsv(response, "history-purchase-receipts.csv", listPurchaseReceipts(db, { from: historyFrom(request) }));
  }));
  app.get("/api/history/other-inbounds.csv", ...operatorRoutes, route((request, response) => {
    sendCsv(response, "history-other-inbounds.csv", listOtherInbounds(db, { from: historyFrom(request) }));
  }));
  app.get("/api/history/outbound-records.csv", ...operatorRoutes, route((request, response) => {
    sendCsv(response, "history-outbound-records.csv", listOutboundRecords(db, { from: historyFrom(request) }));
  }));
  app.get("/api/history/stocktakes.csv", ...operatorRoutes, route((request, response) => {
    sendCsv(response, "history-stocktakes.csv", listStocktakes(db, { from: historyFrom(request) }));
  }));
}

function sendCsv(response: Response, filename: string, rows: object[]) {
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(toCsv(rows.map((row) => ({ ...row }))));
}

function listProductCsvRows(db: SqliteDb) {
  return db
    .prepare(
      `
      SELECT
        products.code AS productCode,
        products.name AS productName,
        products.remark AS productRemark,
        parts.code AS partCode,
        parts.name AS partName,
        product_bom_items.quantity AS quantity
      FROM products
      LEFT JOIN product_bom_items ON product_bom_items.product_id = products.id
      LEFT JOIN parts ON parts.id = product_bom_items.part_id
      ORDER BY products.code, parts.code
      `,
    )
    .all() as Record<string, unknown>[];
}

function toUser(user: UserRow): User {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    enabled: user.enabled === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function toPart(row: PartRow): Part {
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

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPurchaseOrder(row: PurchaseOrderRow) {
  return {
    id: row.id,
    orderNo: row.order_no,
    logisticsNo: row.logistics_no,
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    partImageUrl: row.part_image_url,
    orderQuantity: row.order_quantity,
    status: row.status,
    remark: row.remark,
    orderTime: row.order_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPurchaseReceipt(row: PurchaseReceiptRow) {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    purchaseOrderId: row.purchase_order_id,
    orderNo: row.order_no,
    logisticsNo: row.logistics_no,
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    partImageUrl: row.part_image_url,
    purchaseQuantity: row.purchase_quantity,
    inboundQuantity: row.inbound_quantity,
    status: row.status,
    remark: row.remark,
    inboundTime: row.inbound_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOtherInbound(row: OtherInboundRow) {
  return {
    id: row.id,
    inboundNo: row.inbound_no,
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    partImageUrl: row.part_image_url,
    inboundQuantity: row.inbound_quantity,
    inboundTime: row.inbound_time,
    operatorName: row.operator_name,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

function toStore(row: StoreRow) {
  return {
    id: row.id,
    name: row.name,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOutboundRecord(row: OutboundRecordRow) {
  return {
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    storeId: row.store_id,
    storeName: row.store_name,
    outboundQuantity: row.outbound_quantity,
    outboundTime: row.outbound_time,
    operatorName: row.operator_name,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

function toStock(row: StockRow) {
  return {
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    status: row.status,
    imageUrl: row.image_url,
    specification: row.specification,
    quantity: row.quantity,
    remark: row.remark,
    lastStocktakeAt: row.last_stocktake_at,
    updatedAt: row.updated_at,
  };
}

function toStocktake(row: StocktakeRow) {
  return {
    id: row.id,
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    partImageUrl: row.part_image_url,
    previousQuantity: row.previous_quantity,
    actualQuantity: row.actual_quantity,
    remark: row.remark,
    stocktakeTime: row.stocktake_time,
    createdAt: row.created_at,
  };
}
