import cookieParser from "cookie-parser";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { calculateLowStockParts } from "../domain/inventory";
import {
  loginSchema,
  otherInboundSchema,
  outboundOperatorSchema,
  outboundPlanSchema,
  outboundSchema,
  outboundShipmentApprovalSchema,
  outboundShipmentSchema,
  partSchema,
  productSchema,
  purchaseOrderSchema,
  receivePurchaseReceiptSchema,
  stockRemarkSchema,
  stocktakeSchema,
  storeSchema,
  storeProductBindingSchema,
  userCreateSchema,
  userStoreBindingSchema,
  userUpdateSchema,
} from "../shared/schemas";
import type { LowStockPart, NamedPartStock, Part, Product, ProductBomItem, User, UserRole } from "../shared/types";
import {
  cleanupExpiredSessions,
  clearSession,
  clearSessionCookie,
  clearUserSessions,
  hashPassword,
  login,
  requireAuth,
  requireRole,
  requireAnyRole,
  seedDefaultUsers,
  setSessionCookie,
  SESSION_COOKIE_NAME,
} from "./auth";
import { createId, migrate, nowIso, openDatabase, type SqliteDb } from "./db";
import { toCsv, type CsvColumn } from "./export";
import {
  approveOutboundShipment,
  approveOutboundRecord,
  createOutboundPlan,
  createOutboundRecord,
  createOutboundShipment,
  createPart,
  createProductWithBom,
  createPurchaseOrder,
  createStore,
  deleteOtherInbound,
  deleteOutboundRecord,
  deletePurchaseOrder,
  deletePurchaseReceipt,
  deleteStocktake,
  getPartUsageFromOutboundSince,
  listLockedPartStock,
  listOutboundPlans,
  listOutboundShipments,
  listStoreProducts,
  listUserStoreIds,
  receivePurchaseReceipt,
  setStoreProducts,
  setUserStores,
  updatePurchaseOrder,
  updateStockRemark,
  updateStore,
} from "./repositories";
import { handlePartImageUpload, handleProductImageUpload, uploadPartImage, uploadProductImage } from "./uploads";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  enabled: 0 | 1;
 created_at: string;
  updated_at: string;
  inbound_quantity: number;
};

type OutboundOperatorRow = {
  id: string;
  name: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type PartRow = {
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
};

type ProductRow = {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
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
  inbound_quantity: number;
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
  order_time: string;
  logistics_no: string | null;
  part_id: string;
  part_code: string;
  part_name: string;
  part_image_url: string | null;
  current_stock?: number;
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
  inbound_source: string;
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
  enabled: number;
  created_at: string;
  updated_at: string;
};

type OutboundRecordRow = {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  product_image_url?: string | null;
  store_id: string;
  store_name: string;
  outbound_quantity: number;
  pre_outbound_quantity: number;
  actual_outbound_quantity: number;
  outbound_time: string;
  operator_name: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  remark: string | null;
  created_at: string;
};

type OutboundFilters = {
  from?: string | null;
  to?: string | null;
  q?: string | null;
  skuCode?: string | null;
  goodsCode?: string | null;
  productCode?: string | null;
  productName?: string | null;
  partQuery?: string | null;
  storeName?: string | null;
  operatorName?: string | null;
  remark?: string | null;
};

type StockRow = {
  part_id: string;
  part_code: string;
  part_name: string;
  image_url: string | null;
  specification: string | null;
  weight: number | null;
  quantity: number;
  remark: string | null;
  last_stocktake_at: string | null;
  outbound_7_days?: number | string | null;
  outbound_14_days?: number | string | null;
  purchase_in_transit?: number | string | null;
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

type LowStockIgnoreRow = {
  part_id: string;
  ignore_count: number;
};

type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  actor_username: string | null;
  actor_role: UserRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: string | null;
  after_data: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

type AuditLogFilters = {
  q?: string | null;
  actorUsername?: string | null;
  action?: string | null;
  entityType?: string | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
};

type RouteHandler = (request: Request, response: Response) => void | Promise<void>;
type CorsOriginCallback = (error: Error | null, origin?: boolean | string) => void;

export async function createApp(db: SqliteDb = openDatabase()) {
  await migrate(db);
  await seedDefaultUsers(db);
  await cleanupExpiredSessions(db);

  const app = express();
  const operatorRoutes = [requireAuth(db)];
  const adminRoutes = [requireAuth(db), requireRole("admin")];
  const purchaserRoutes = [requireAuth(db), requireAnyRole(["admin", "purchaser"])];
  const inboundRoutes = [requireAuth(db), requireAnyRole(["admin", "inbound"])];
  const outboundRoutes = [requireAuth(db), requireAnyRole(["admin", "outbound", "operation", "operator"])];
  const operationRoutes = [requireAuth(db), requireAnyRole(["admin", "operation"])];
  const productReadRoutes = [requireAuth(db), requireAnyRole(["admin", "operation", "purchaser"])];
  const stockRoutes = [requireAuth(db), requireAnyRole(["admin", "purchaser", "outbound", "operator"])];
  const stocktakeRoutes = [requireAuth(db), requireAnyRole(["admin", "outbound", "operator"])];
  const dashboardRoutes = [requireAuth(db), requireAnyRole(["admin", "purchaser"])];
  const loginRateLimiter = createLoginRateLimiter();

  app.use(securityHeaders);
  app.use(cors(createCorsOptions()));
  app.use(csrfProtection);
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use("/uploads", express.static(path.resolve("uploads")));

  app.get("/api/health", route(async (_request, response) => {
    try {
      await db.exec("SELECT 1");
      response.json({ ok: true });
    } catch {
      response.status(503).json({ ok: false, error: "数据库不可用" });
    }
  }));

  app.post("/api/auth/login", route(async (request, response) => {
    const body = parseBody(loginSchema, request.body);
    const rateLimitKey = loginRateLimiter.keyFor(request, body.username);
    if (loginRateLimiter.isLimited(rateLimitKey)) {
      response.status(429).json({ error: "登录失败次数过多，请稍后再试" });
      return;
    }
    const result = await login(db, body.username, body.password);
    if (!result) {
      loginRateLimiter.recordFailure(rateLimitKey);
      response.status(401).json({ error: "账号或密码错误" });
      return;
    }

    loginRateLimiter.recordSuccess(rateLimitKey);
    setSessionCookie(response, result.token);
    response.json({ user: result.user });
  }));

  app.get("/api/auth/me", requireAuth(db), (_request, response) => {
    response.json({ user: response.locals.user });
  });

  app.post("/api/auth/logout", async (request, response) => {
    await clearSession(db, request.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/users", requireAuth(db), requireRole("admin"), async (_request, response) => {
    const users = await db.prepare(
        `
        SELECT id, username, display_name, role, enabled, created_at, updated_at
        FROM users
        ORDER BY username
        `,
      )
      .all() as UserRow[];

    response.json({ users: users.map(toUser) });
  });
  app.post("/api/users", ...adminRoutes, route(async (request, response) => {
    const input = parseBody(userCreateSchema, request.body);
    const timestamp = nowIso();
    const id = createId("user");
    await db.prepare(
      `
      INSERT INTO users (
        id, username, display_name, password_hash, role, enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.username,
      input.displayName,
      hashPassword(input.password),
      input.role,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp,
    );
    const user = await getUser(db, id);
    await insertAuditLog(db, request, response, "新增用户", "user", id, null, user);
    response.status(201).json({ user });
  }));
  app.put("/api/users/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const input = parseBody(userUpdateSchema, request.body);
    const currentUser = response.locals.user as User | undefined;
    if (currentUser?.id === id && !input.enabled) {
      throw new Error("不能停用当前登录账号");
    }
    const before = await getUser(db, id);
    const timestamp = nowIso();
    if (input.password?.trim()) {
      await db.prepare(
        `
        UPDATE users
        SET display_name = ?, password_hash = ?, role = ?, enabled = ?, updated_at = ?
        WHERE id = ?
        `,
      ).run(input.displayName, hashPassword(input.password), input.role, input.enabled ? 1 : 0, timestamp, id);
      await clearUserSessions(db, id);
    } else {
      await db.prepare(
        `
        UPDATE users
        SET display_name = ?, role = ?, enabled = ?, updated_at = ?
        WHERE id = ?
        `,
      ).run(input.displayName, input.role, input.enabled ? 1 : 0, timestamp, id);
      if (!input.enabled) {
        await clearUserSessions(db, id);
      }
    }
    const user = await getUser(db, id);
    await insertAuditLog(db, request, response, "编辑用户", "user", id, before, user);
    response.json({ user });
  }));
  app.delete("/api/users/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const currentUser = response.locals.user as User | undefined;
    if (currentUser?.id === id) {
      throw new Error("不能删除当前登录账号");
    }
    const before = await getUser(db, id);
    if (before.role === "admin") {
      const adminCount = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1")
        .get() as { count: number | string };
      if (Number(adminCount.count) <= 1) {
        throw new Error("不能删除最后一个管理员账号");
      }
    }
    await clearUserSessions(db, id);
    await deleteById(db, "users", id, "用户不存在");
    await insertAuditLog(db, request, response, "删除用户", "user", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/outbound-operators", ...operatorRoutes, route(async (request, response) => {
    const status = queryString(request.query.status);
    response.json({ outboundOperators: await listOutboundOperators(db, status === "active" ? true : status === "inactive" ? false : null) });
  }));
  app.post("/api/outbound-operators", ...adminRoutes, route(async (request, response) => {
    const input = parseBody(outboundOperatorSchema, request.body);
    const timestamp = nowIso();
    const id = createId("outbound_operator");
    await db.prepare(
      "INSERT INTO outbound_operators (id, name, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, input.name, input.enabled ? 1 : 0, timestamp, timestamp);
    const outboundOperator = await getOutboundOperator(db, id);
    await insertAuditLog(db, request, response, "新增出库人员", "outbound_operator", id, null, outboundOperator);
    response.status(201).json({ outboundOperator });
  }));
  app.put("/api/outbound-operators/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const input = parseBody(outboundOperatorSchema, request.body);
    const before = await getOutboundOperator(db, id);
    const timestamp = nowIso();
    const result = await db.prepare(
      "UPDATE outbound_operators SET name = ?, enabled = ?, updated_at = ? WHERE id = ?",
    ).run(input.name, input.enabled ? 1 : 0, timestamp, id);
    if (result.changes === 0) {
      throw new Error("出库人员不存在");
    }
    const outboundOperator = await getOutboundOperator(db, id);
    await insertAuditLog(db, request, response, "编辑出库人员", "outbound_operator", id, before, outboundOperator);
    response.json({ outboundOperator });
  }));
  app.delete("/api/outbound-operators/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getOutboundOperator(db, id);
    await deleteById(db, "outbound_operators", id, "出库人员不存在");
    await insertAuditLog(db, request, response, "删除出库人员", "outbound_operator", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/audit-logs", ...adminRoutes, route(async (request, response) => {
    const result = await listAuditLogs(db, auditLogFiltersFromQuery(request));
    response.json(result);
  }));

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

  app.post("/api/uploads/products", ...adminRoutes, (request, response) => {
    uploadProductImage.single("file")(request, response, (error) => {
      if (error) {
        sendError(response, error);
        return;
      }
      try {
        handleProductImageUpload(request, response);
      } catch (innerError) {
        sendError(response, innerError);
      }
    });
  });

  app.get("/api/parts", ...purchaserRoutes, route(async (request, response) => {
    response.json({ parts: await listParts(db, queryString(request.query.q ?? request.query.search)) });
  }));
  app.post("/api/parts", ...adminRoutes, route(async (request, response) => {
    const part = await createPart(db, parseBody(partSchema, request.body));
    await insertAuditLog(db, request, response, "新增配件", "part", part.id, null, part);
    response.status(201).json({ part });
  }));
  app.put("/api/parts/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getPart(db, id).catch(() => null);
    const part = await updatePart(db, id, parseBody(partSchema, request.body));
    await insertAuditLog(db, request, response, "编辑配件", "part", id, before, part);
    response.json({ part });
  }));
  app.delete("/api/parts/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getPart(db, id).catch(() => null);
    await assertPartCanBeDeleted(db, id);
    await deleteById(db, "parts", id, "配件不存在");
    await insertAuditLog(db, request, response, "删除配件", "part", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/products", ...productReadRoutes, route(async (_request, response) => {
    response.json({ products: await listProducts(db) });
  }));
  app.post("/api/products", ...adminRoutes, route(async (request, response) => {
    const product = await createProductWithBom(db, parseBody(productSchema, request.body));
    const savedProduct = await getProduct(db, product.id);
    await insertAuditLog(db, request, response, "新增产品", "product", product.id, null, savedProduct);
    response.status(201).json({ product: savedProduct });
  }));
  app.put("/api/products/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getProduct(db, id);
    const product = await updateProduct(db, id, parseBody(productSchema, request.body));
    await insertAuditLog(db, request, response, "编辑产品", "product", id, before, product);
    response.json({ product });
  }));
  app.delete("/api/products/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getProduct(db, id);
    await deleteById(db, "products", id, "产品不存在");
    await insertAuditLog(db, request, response, "删除产品", "product", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/purchase-orders", ...purchaserRoutes, route(async (request, response) => {
    response.json({
      purchaseOrders: await listPurchaseOrders(db, {
        from: queryString(request.query.from),
        to: queryString(request.query.to),
        orderNo: queryString(request.query.orderNo),
        logisticsNo: queryString(request.query.logisticsNo),
        partId: queryString(request.query.partId),
        status: queryString(request.query.status),
        orderDate: queryString(request.query.orderDate),
        remark: queryString(request.query.remark),
        q: queryString(request.query.q ?? request.query.search),
      }),
    });
  }));
  app.post("/api/purchase-orders", ...purchaserRoutes, route(async (request, response) => {
    const purchaseOrder = await createPurchaseOrder(db, parseBody(purchaseOrderSchema, request.body));
    const savedOrder = await getPurchaseOrder(db, purchaseOrder.id);
    await insertAuditLog(db, request, response, "新增采购订单", "purchase_order", purchaseOrder.id, null, savedOrder);
    response.status(201).json({ purchaseOrder: savedOrder });
  }));
  app.put("/api/purchase-orders/:id", ...purchaserRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getPurchaseOrder(db, id);
    await updatePurchaseOrder(db, id, parseBody(purchaseOrderSchema, request.body));
    const purchaseOrder = await getPurchaseOrder(db, id);
    await insertAuditLog(db, request, response, "编辑采购订单", "purchase_order", id, before, purchaseOrder);
    response.json({ purchaseOrder });
  }));
  app.delete("/api/purchase-orders/:id", ...purchaserRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getPurchaseOrder(db, id);
    await deletePurchaseOrder(db, id);
    await insertAuditLog(db, request, response, "删除采购订单", "purchase_order", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/purchase-receipts", ...inboundRoutes, route(async (request, response) => {
    response.json({
      purchaseReceipts: await listPurchaseReceipts(db, purchaseReceiptFiltersFromQuery(request)),
    });
  }));
  app.post("/api/purchase-receipts/:purchaseOrderId/receive", ...inboundRoutes, route(async (request, response) => {
    const receipt = await db.prepare("SELECT id FROM purchase_receipts WHERE purchase_order_id = ?")
      .get(paramString(request.params.purchaseOrderId, "purchaseOrderId")) as { id: string } | undefined;
    if (!receipt) {
      throw new Error("采购入库单不存在");
    }

    const before = await getPurchaseReceipt(db, receipt.id);
    await receivePurchaseReceipt(db, { id: receipt.id, ...parseBody(receivePurchaseReceiptSchema, request.body) });
    const purchaseReceipt = await getPurchaseReceipt(db, receipt.id);
    await insertAuditLog(db, request, response, "采购入库签收", "purchase_receipt", receipt.id, before, purchaseReceipt);
    response.json({ purchaseReceipt });
  }));
  app.delete("/api/purchase-receipts/:id", ...inboundRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getPurchaseReceipt(db, id);
    await deletePurchaseReceipt(db, id);
    await insertAuditLog(db, request, response, "删除采购入库", "purchase_receipt", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/other-inbounds", ...inboundRoutes, route(async (request, response) => {
    response.json({
      otherInbounds: await listOtherInbounds(db, {
        from: queryString(request.query.from),
        to: queryString(request.query.to),
        q: queryString(request.query.q ?? request.query.search),
      }),
    });
  }));
  app.post("/api/other-inbounds", ...inboundRoutes, route(async (request, response) => {
    const otherInbound = await createOtherInboundRecord(db, parseBody(otherInboundSchema, request.body));
    await insertAuditLog(db, request, response, "新增其它入库", "other_inbound", otherInbound.id, null, otherInbound);
    response.status(201).json({ otherInbound });
  }));
  app.delete("/api/other-inbounds/:id", ...inboundRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getOtherInbound(db, id);
    await deleteOtherInbound(db, id);
    await insertAuditLog(db, request, response, "删除其它入库", "other_inbound", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/stores", ...outboundRoutes, route(async (request, response) => {
    const storeIds = await storeScopeForUser(db, response.locals.user as User);
    const stores = await listStores(
      db,
      queryString(request.query.q ?? request.query.search),
      storeStatusQuery(request.query.status),
    );
    response.json({
      stores: storeIds === null ? stores : stores.filter((store) => storeIds.includes(store.id)),
    });
  }));
  app.post("/api/stores", ...adminRoutes, route(async (request, response) => {
    const store = await createStore(db, parseBody(storeSchema, request.body));
    const savedStore = await getStore(db, store.id);
    await insertAuditLog(db, request, response, "新增店铺", "store", store.id, null, savedStore);
    response.status(201).json({ store: savedStore });
  }));
  app.get("/api/stores/:id/products", ...outboundRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    await assertCanAccessStore(db, response, id);
    response.json({ products: await listStoreProducts(db, id) });
  }));
  app.put("/api/stores/:id/products", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await listStoreProducts(db, id);
    const products = await setStoreProducts(db, id, parseBody(storeProductBindingSchema, request.body).productIds);
    await insertAuditLog(db, request, response, "绑定店铺产品", "store", id, before, products);
    response.json({ products });
  }));
  app.put("/api/stores/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getStore(db, id);
    await updateStore(db, id, parseBody(storeSchema, request.body));
    const store = await getStore(db, id);
    await insertAuditLog(db, request, response, "编辑店铺", "store", id, before, store);
    response.json({ store });
  }));
  app.delete("/api/stores/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getStore(db, id);
    await assertStoreCanBeDeleted(db, id);
    await deleteById(db, "outbound_stores", id, "店铺不存在");
    await insertAuditLog(db, request, response, "删除店铺", "store", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/users/:id/stores", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    response.json({ storeIds: await listUserStoreIds(db, id) });
  }));
  app.put("/api/users/:id/stores", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await listUserStoreIds(db, id);
    const storeIds = await setUserStores(db, id, parseBody(userStoreBindingSchema, request.body).storeIds);
    await insertAuditLog(db, request, response, "绑定用户店铺", "user", id, before, storeIds);
    response.json({ storeIds });
  }));

  app.get("/api/outbound-plans", ...outboundRoutes, route(async (_request, response) => {
    const user = response.locals.user as User;
    response.json({ outboundPlans: await listOutboundPlans(db, { storeIds: await storeScopeForUser(db, user) }) });
  }));
  app.post("/api/outbound-plans", ...outboundRoutes, route(async (request, response) => {
    const input = parseBody(outboundPlanSchema, request.body);
    await assertCanAccessStore(db, response, input.storeId);
    const outboundPlan = await createOutboundPlan(db, input);
    await insertAuditLog(db, request, response, "新增预发货清单", "outbound_plan", outboundPlan.id, null, outboundPlan);
    response.status(201).json({ outboundPlan });
  }));
  app.get("/api/outbound-plans/:id", ...outboundRoutes, route(async (request, response) => {
    const outboundPlan = (await listOutboundPlans(db, { storeIds: await storeScopeForUser(db, response.locals.user as User) }))
      .find((plan) => plan.id === paramString(request.params.id, "id"));
    if (!outboundPlan) {
      response.status(404).json({ error: "预发货清单不存在" });
      return;
    }
    response.json({ outboundPlan });
  }));
  app.post("/api/outbound-plans/:id/shipments", ...outboundRoutes, route(async (request, response) => {
    const planId = paramString(request.params.id, "id");
    const currentPlan = (await listOutboundPlans(db, { storeIds: await storeScopeForUser(db, response.locals.user as User) }))
      .find((plan) => plan.id === planId);
    if (!currentPlan) {
      response.status(403).json({ error: "当前账号无权限操作该店铺" });
      return;
    }
    const input = parseBody(outboundShipmentSchema, request.body);
    const outboundShipment = await createOutboundShipment(db, { ...input, planId });
    await insertAuditLog(db, request, response, "新增发货批次", "outbound_shipment", outboundShipment.id, null, outboundShipment);
    response.status(201).json({ outboundShipment });
  }));
  app.get("/api/outbound-shipments", ...adminRoutes, route(async (request, response) => {
    response.json({ outboundShipments: await listOutboundShipments(db, { status: queryString(request.query.status) }) });
  }));
  app.post("/api/outbound-shipments/:id/approve", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const currentUser = response.locals.user as User | undefined;
    const input = parseBody(outboundShipmentApprovalSchema, request.body);
    const outboundShipment = await approveOutboundShipment(db, id, currentUser?.displayName ?? null, input.items);
    await insertAuditLog(db, request, response, "审核发货批次", "outbound_shipment", id, null, outboundShipment);
    response.json({ outboundShipment });
  }));
  app.get("/api/stock-locks", ...outboundRoutes, route(async (_request, response) => {
    response.json({ stockLocks: await listLockedPartStock(db) });
  }));

  app.get("/api/outbound-records", ...outboundRoutes, route(async (request, response) => {
    const storeIds = await storeScopeForUser(db, response.locals.user as User);
    response.json({
      outboundRecords: filterOutboundRecordsByStoreIds(
        await listOutboundRecords(db, outboundFiltersFromQuery(request)),
        storeIds,
      ),
    });
  }));
  app.post("/api/outbound-records", ...outboundRoutes, route(async (request, response) => {
    const input = parseBody(outboundSchema, request.body);
    await assertCanAccessStore(db, response, input.storeId);
    const outboundRecord = await createOutboundRecord(db, input);
    const savedOutbound = await getOutboundRecord(db, outboundRecord.id);
    await insertAuditLog(db, request, response, "新增预出库", "outbound_record", outboundRecord.id, null, {
      ...savedOutbound,
      warnings: outboundRecord.warnings,
    });
    response.status(201).json({
      outboundRecord: { ...savedOutbound, warnings: outboundRecord.warnings },
    });
  }));
  app.post("/api/outbound-records/:id/approve", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getOutboundRecord(db, id);
    const currentUser = response.locals.user as User | undefined;
    const result = await approveOutboundRecord(db, id, currentUser?.displayName ?? null);
    const after = await getOutboundRecord(db, id);
    await insertAuditLog(db, request, response, "审核出库", "outbound_record", id, before, {
      ...after,
      warnings: result.warnings,
    });
    response.json({ outboundRecord: { ...after, warnings: result.warnings } });
  }));
  app.delete("/api/outbound-records/:id", ...adminRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getOutboundRecord(db, id);
    await deleteOutboundRecord(db, id);
    await insertAuditLog(db, request, response, "删除出库", "outbound_record", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/stock", ...stockRoutes, route(async (request, response) => {
    response.json({ stock: await listStock(db, queryString(request.query.q ?? request.query.search)) });
  }));
  app.put("/api/stock/:partId/remark", ...adminRoutes, route(async (request, response) => {
    const partId = paramString(request.params.partId, "partId");
    const before = await getStock(db, partId);
    const stock = await updateStockRemark(
      db,
      partId,
      parseBody(stockRemarkSchema, request.body).remark,
    );
    await insertAuditLog(db, request, response, "编辑库存备注", "stock", partId, before, stock);
    response.json({ stock });
  }));

  app.get("/api/stocktakes", ...stocktakeRoutes, route(async (request, response) => {
    response.json({
      stocktakes: await listStocktakes(db, {
        from: queryString(request.query.from),
        to: queryString(request.query.to),
        q: queryString(request.query.q ?? request.query.search),
        partCode: queryString(request.query.partCode),
        partName: queryString(request.query.partName),
        stocktakeDate: queryString(request.query.stocktakeDate),
        remark: queryString(request.query.remark),
      }),
    });
  }));
  app.post("/api/stocktakes", ...stocktakeRoutes, route(async (request, response) => {
    const stocktake = await createStocktakeRecord(db, parseBody(stocktakeSchema, request.body));
    await insertAuditLog(db, request, response, "新增盘点", "stocktake", stocktake.id, null, stocktake);
    response.status(201).json({ stocktake });
  }));
  app.delete("/api/stocktakes/:id", ...stocktakeRoutes, route(async (request, response) => {
    const id = paramString(request.params.id, "id");
    const before = await getStocktake(db, id);
    await deleteStocktake(db, id);
    await insertAuditLog(db, request, response, "删除盘点", "stocktake", id, before, null);
    response.json({ ok: true });
  }));

  app.get("/api/history", ...purchaserRoutes, route(async (request, response) => {
    const range = historyRange(request);
    const partQuery = queryString(request.query.partQuery);
    response.json({
      from: range.from,
      to: range.to,
      purchaseOrders: await listPurchaseOrders(db, {
        from: range.from,
        to: range.to,
        includeAbnormalOutsideRange: range.isDefault,
      }),
      purchaseReceipts: await listPurchaseReceipts(db, {
        from: range.from,
        to: range.to,
        includeAbnormalOutsideRange: range.isDefault,
      }),
      otherInbounds: await listOtherInbounds(db, { from: range.from, to: range.to }),
      outboundRecords: await listOutboundRecords(db, { from: range.from, to: range.to, partQuery }),
      stocktakes: await listStocktakes(db, { from: range.from, to: range.to }),
    });
  }));

  app.get("/api/dashboard", ...dashboardRoutes, route(async (_request, response) => {
    const periodDays = positiveIntegerFromEnv(process.env.LOW_STOCK_PERIOD_DAYS, 30);
    const sinceIso = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const pendingInboundReceipts = (await listPurchaseReceipts(db, { status: "pending" })).map((receipt) => ({
      purchaseOrderId: receipt.purchaseOrderId,
      receiptId: receipt.id,
      orderNo: receipt.orderNo,
      partName: receipt.partName,
      partImageUrl: receipt.partImageUrl,
      purchaseQuantity: receipt.purchaseQuantity,
      inboundQuantity: receipt.inboundQuantity,
      status: receipt.status,
    }));
    const abnormalPurchaseOrders = (await listPurchaseReceipts(db, { status: "abnormal" })).map((receipt) => ({
      purchaseOrderId: receipt.purchaseOrderId,
      receiptId: receipt.id,
      orderNo: receipt.orderNo,
      partName: receipt.partName,
      partImageUrl: receipt.partImageUrl,
      purchaseQuantity: receipt.purchaseQuantity,
      inboundQuantity: receipt.inboundQuantity,
      status: receipt.status,
    }));
    const stocks = await db.prepare(
        `
        SELECT part_stock.part_id AS "partId", parts.name AS "partName", part_stock.quantity AS quantity
        FROM part_stock
        JOIN parts ON parts.id = part_stock.part_id
        ORDER BY parts.name
        `,
      )
      .all() as NamedPartStock[];
    const usage = await getPartUsageFromOutboundSince(db, sinceIso);

    response.json({
      pendingInboundCount: pendingInboundReceipts.length,
      pendingInboundReceipts,
      abnormalPurchaseOrderCount: abnormalPurchaseOrders.length,
      abnormalPurchaseOrders,
      lowStockParts: await filterIgnoredLowStockParts(db, calculateLowStockParts(stocks, usage, periodDays, 15)),
    });
  }));

  app.post("/api/low-stock/:partId/ignore", ...adminRoutes, route(async (request, response) => {
    const partId = paramString(request.params.partId, "partId");
    const before = await getLowStockIgnore(db, partId);
    await ignoreLowStockPart(db, partId);
    const after = await getLowStockIgnore(db, partId);
    await insertAuditLog(db, request, response, "忽略低库存", "low_stock_ignore", partId, before, after);
    response.json({ ok: true });
  }));

  registerCsvRoutes(db, app, operatorRoutes, adminRoutes);

  app.use(express.static(path.resolve("dist/client")));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.resolve("dist/client/index.html"));
  });

  app.use(errorHandler);

  return app;
}

function securityHeaders(_request: Request, response: Response, next: NextFunction) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  next();
}

function csrfProtection(request: Request, response: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== "production" || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  if (request.get("X-Berni-CSRF") === "1") {
    next();
    return;
  }
  response.status(403).json({ error: "CSRF 校验失败" });
}

function createLoginRateLimiter() {
  const attempts = new Map<string, { count: number; firstAttemptAt: number }>();
  const maxFailures = 5;
  const windowMs = 15 * 60 * 1000;

  function activeEntry(key: string) {
    const entry = attempts.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.firstAttemptAt > windowMs) {
      attempts.delete(key);
      return null;
    }
    return entry;
  }

  return {
    keyFor(request: Request, username: string) {
      return `${request.ip ?? "unknown"}:${username.trim().toLowerCase()}`;
    },
    isLimited(key: string) {
      return (activeEntry(key)?.count ?? 0) >= maxFailures;
    },
    recordFailure(key: string) {
      const entry = activeEntry(key);
      if (!entry) {
        attempts.set(key, { count: 1, firstAttemptAt: Date.now() });
        return;
      }
      entry.count += 1;
    },
    recordSuccess(key: string) {
      attempts.delete(key);
    },
  };
}

function createCorsOptions() {
  if (process.env.NODE_ENV !== "production") {
    return { credentials: true, origin: true };
  }
  const allowedOrigins = parseAllowedOrigins();
  return {
    credentials: true,
    origin(requestOrigin: string | undefined, callback: CorsOriginCallback) {
      if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
        callback(null, false);
        return;
      }
      callback(null, requestOrigin);
    },
  };
}

function parseAllowedOrigins() {
  const origins = (process.env.BERNI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error("生产环境必须设置 BERNI_ALLOWED_ORIGINS");
  }
  return origins;
}

function route(handler: RouteHandler) {
  return (request: Request, response: Response) => {
    try {
      void Promise.resolve(handler(request, response)).catch((error) => sendError(response, error));
    } catch (error) {
      sendError(response, error);
    }
  };
}

function errorHandler(_error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (response.headersSent) {
    return;
  }
  response.status(500).json({ error: "服务器内部错误" });
}

function sendError(response: Response, error: unknown) {
  if (response.headersSent || error instanceof ResponseAlreadySentError) {
    return;
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: error.issues[0]?.message ?? "请求参数错误" });
    return;
  }
  const message = error instanceof Error ? error.message : "请求处理失败";
  response.status(400).json({ error: message });
}

async function insertAuditLog(
  db: SqliteDb,
  request: Request,
  response: Response,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeData: unknown,
  afterData: unknown,
) {
  const user = response.locals.user as User | undefined;
  await db.prepare(
    `
    INSERT INTO audit_logs (
      id, actor_user_id, actor_username, actor_role, action, entity_type, entity_id,
      before_data, after_data, ip, user_agent, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    createId("audit"),
    user?.id ?? null,
    user?.username ?? null,
    user?.role ?? null,
    action,
    entityType,
    entityId,
    beforeData === null || beforeData === undefined ? null : JSON.stringify(beforeData),
    afterData === null || afterData === undefined ? null : JSON.stringify(afterData),
    request.ip ?? null,
    request.get("user-agent") ?? null,
    nowIso(),
  );
}

async function getUser(db: SqliteDb, id: string) {
  const row = await db.prepare(
      `
      SELECT id, username, display_name, role, enabled, created_at, updated_at
      FROM users
      WHERE id = ?
      `,
    )
    .get(id) as UserRow | undefined;
  if (!row) {
    throw new Error("用户不存在");
  }
  return toUser(row);
}

async function listOutboundOperators(db: SqliteDb, enabled: boolean | null) {
  const rows = await db.prepare(
    [
      "SELECT id, name, enabled, created_at, updated_at",
      "FROM outbound_operators",
      enabled === null ? "" : "WHERE enabled = ?",
      "ORDER BY name",
    ].filter(Boolean).join("\n"),
  ).all(...(enabled === null ? [] : [enabled ? 1 : 0])) as OutboundOperatorRow[];
  return rows.map(toOutboundOperator);
}

async function getOutboundOperator(db: SqliteDb, id: string) {
  const row = await db.prepare(
    "SELECT id, name, enabled, created_at, updated_at FROM outbound_operators WHERE id = ?",
  ).get(id) as OutboundOperatorRow | undefined;
  if (!row) {
    throw new Error("出库人员不存在");
  }
  return toOutboundOperator(row);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function queryString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveQueryInteger(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function auditLogFiltersFromQuery(request: Request): AuditLogFilters {
  return {
    q: queryString(request.query.q),
    actorUsername: queryString(request.query.actorUsername),
    action: queryString(request.query.action),
    entityType: queryString(request.query.entityType),
    from: queryString(request.query.from),
    to: queryString(request.query.to),
    page: positiveQueryInteger(request.query.page, 1),
    pageSize: positiveQueryInteger(request.query.pageSize, 20, 100),
  };
}

function storeStatusQuery(value: unknown): "active" | "inactive" | null {
  return value === "active" || value === "inactive" ? value : null;
}

function paramString(value: string | string[] | undefined, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} 参数错误`);
  }
  return value;
}

async function storeScopeForUser(db: SqliteDb, user: User) {
  if (user.role === "admin") {
    return null;
  }
  return await listUserStoreIds(db, user.id);
}

async function assertCanAccessStore(db: SqliteDb, response: Response, storeId: string) {
  const storeIds = await storeScopeForUser(db, response.locals.user as User);
  if (storeIds !== null && !storeIds.includes(storeId)) {
    response.status(403).json({ error: "当前账号无权限操作该店铺" });
    throw new ResponseAlreadySentError();
  }
}

function filterOutboundRecordsByStoreIds(records: ReturnType<typeof toOutboundRecord>[], storeIds: string[] | null) {
  if (storeIds === null) {
    return records;
  }
  return records.filter((record) => storeIds.includes(record.storeId));
}

class ResponseAlreadySentError extends Error {}

function historyRange(request: Request) {
  const from = queryString(request.query.from);
  const to = queryString(request.query.to);
  if (from || to) {
    return {
      from: from ?? new Date(0).toISOString(),
      to: to ?? new Date("9999-12-31T23:59:59.999Z").toISOString(),
      isDefault: false,
    };
  }
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: monthStart.toISOString(), to: nextMonthStart.toISOString(), isDefault: true };
}

function positiveIntegerFromEnv(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dateRangeCondition(column: string, filters: { from?: string | null; to?: string | null }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.from) {
    conditions.push(`${column} >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`${column} < ?`);
    params.push(filters.to);
  }
  return { condition: conditions.join(" AND "), params };
}

function assertRangeWithinDays(from: string | null | undefined, to: string | null | undefined, maxDays: number, message: string) {
  if (!from || !to) {
    return;
  }
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
    return;
  }
  if (toTime - fromTime > maxDays * 24 * 60 * 60 * 1000) {
    throw new Error(message);
  }
}

function whereClause(conditions: string[]) {
  return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
}

async function listAuditLogs(db: SqliteDb, filters: AuditLogFilters) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.q) {
    conditions.push(`
      (
        actor_username LIKE ?
        OR actor_role LIKE ?
        OR action LIKE ?
        OR entity_type LIKE ?
        OR entity_id LIKE ?
      )
    `);
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.actorUsername) {
    conditions.push("actor_username LIKE ?");
    params.push(`%${filters.actorUsername}%`);
  }
  if (filters.action) {
    conditions.push("action LIKE ?");
    params.push(`%${filters.action}%`);
  }
  if (filters.entityType) {
    conditions.push("entity_type = ?");
    params.push(filters.entityType);
  }
  if (filters.from) {
    conditions.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("created_at < ?");
    params.push(filters.to);
  }
  const where = whereClause(conditions);
  const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM audit_logs ${where}`).get(...params) as { total: number };
  const pageSize = filters.pageSize;
  const totalPages = Math.max(1, Math.ceil(totalRow.total / pageSize));
  const page = Math.min(filters.page, totalPages);
  const offset = (page - 1) * pageSize;
  const rows = await db.prepare(
    `
    SELECT *
    FROM audit_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
    `,
  ).all(...params, pageSize, offset) as AuditLogRow[];
  return {
    auditLogs: rows.map(toAuditLog),
    pagination: {
      page,
      pageSize,
      total: totalRow.total,
      totalPages,
    },
  };
}

async function listParts(db: SqliteDb, search: string | null = null) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(`
      (
        parts.code LIKE ?
        OR parts.name LIKE ?
        OR CAST(parts.weight AS TEXT) LIKE ?
        OR parts.specification LIKE ?
        OR CAST(part_stock.quantity AS TEXT) LIKE ?
        OR parts.remark LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const where = whereClause(conditions);
  return (await db.prepare(
      `
      SELECT parts.*, part_stock.quantity AS current_stock
      FROM parts
      JOIN part_stock ON part_stock.part_id = parts.id
      ${where}
      ORDER BY parts.created_at DESC
      `,
    )
    .all(...params) as PartRow[]).map(toPart);
}

async function updatePart(db: SqliteDb, id: string, input: z.infer<typeof partSchema>) {
  const updatedAt = nowIso();
  const result = await db.prepare(
      `
      UPDATE parts
      SET code = ?, name = ?, weight = ?, image_url = ?, specification = ?, remark = ?, updated_at = ?
      WHERE id = ?
      `,
    )
    .run(
      input.code,
      input.name,
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
  if (input.currentStock !== undefined) {
    await db.prepare("UPDATE part_stock SET quantity = ?, remark = ?, updated_at = ? WHERE part_id = ?")
      .run(input.currentStock, input.remark, updatedAt, id);
  } else {
    await db.prepare("UPDATE part_stock SET remark = ?, updated_at = ? WHERE part_id = ?")
      .run(input.remark, updatedAt, id);
  }
  const row = await db.prepare(
      `
      SELECT parts.*, part_stock.quantity AS current_stock
      FROM parts
      JOIN part_stock ON part_stock.part_id = parts.id
      WHERE parts.id = ?
      `,
    )
    .get(id) as PartRow;
  return toPart(row);
}

async function getPart(db: SqliteDb, id: string) {
  const row = await db.prepare(
      `
      SELECT parts.*, part_stock.quantity AS current_stock
      FROM parts
      JOIN part_stock ON part_stock.part_id = parts.id
      WHERE parts.id = ?
      `,
    )
    .get(id) as PartRow | undefined;
  if (!row) {
    throw new Error("配件不存在");
  }
  return toPart(row);
}

async function getProduct(db: SqliteDb, id: string) {
  const row = await db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
  if (!row) {
    throw new Error("产品不存在");
  }
  return { ...toProduct(row), bomItems: await listProductBomItems(db, id) };
}

async function listProducts(db: SqliteDb) {
  const rows = await db.prepare("SELECT * FROM products ORDER BY created_at DESC").all() as ProductRow[];
  return Promise.all(rows.map(async (row) => ({ ...toProduct(row), bomItems: await listProductBomItems(db, row.id) })));
}

async function updateProduct(db: SqliteDb, id: string, input: z.infer<typeof productSchema>) {
  const updatedAt = nowIso();
  await db.transaction(async () => {
    const result = await db.prepare("UPDATE products SET code = ?, name = ?, image_url = ?, remark = ?, updated_at = ? WHERE id = ?")
      .run(input.code, input.name, input.imageUrl, input.remark, updatedAt, id);
    if (result.changes === 0) {
      throw new Error("产品不存在");
    }

    await db.prepare("DELETE FROM product_bom_items WHERE product_id = ?").run(id);
    const insertBom = await db.prepare(
      "INSERT INTO product_bom_items (id, product_id, part_id, quantity) VALUES (?, ?, ?, ?)",
    );
    for (const item of input.bomItems) {
      await insertBom.run(createId("bom"), id, item.partId, item.quantity);
    }
  });
  return await getProduct(db, id);
}

async function listProductBomItems(db: SqliteDb, productId: string) {
  return await db.prepare(
      `
      SELECT
        product_bom_items.product_id AS "productId",
        product_bom_items.part_id AS "partId",
        parts.code AS "partCode",
        parts.name AS "partName",
        parts.image_url AS "partImageUrl",
        product_bom_items.quantity AS quantity
      FROM product_bom_items
      JOIN parts ON parts.id = product_bom_items.part_id
      WHERE product_bom_items.product_id = ?
      ORDER BY parts.code
      `,
    )
    .all(productId) as Array<ProductBomItem & { partCode: string; partName: string }>;
}

async function listPurchaseOrders(
  db: SqliteDb,
  filters: {
    from?: string | null;
    to?: string | null;
    orderNo?: string | null;
    logisticsNo?: string | null;
    partId?: string | null;
    status?: string | null;
    orderDate?: string | null;
    remark?: string | null;
    q?: string | null;
    includeAbnormalOutsideRange?: boolean;
  } = {},
) {
  const range = dateRangeCondition("purchase_orders.order_time", filters);
  const conditions: string[] = [];
  const params = [...range.params];
  if (range.condition) {
    conditions.push(
      filters.includeAbnormalOutsideRange
         ? `(${range.condition} OR purchase_orders.status IN ('工厂缺货', '部分入库'))`
        : range.condition,
    );
  }
  if (filters.orderNo) {
    conditions.push("purchase_orders.order_no LIKE ?");
    params.push(`%${filters.orderNo}%`);
  }
  if (filters.logisticsNo) {
    conditions.push("purchase_orders.logistics_no LIKE ?");
    params.push(`%${filters.logisticsNo}%`);
  }
  if (filters.partId) {
    conditions.push("purchase_orders.part_id = ?");
    params.push(filters.partId);
  }
  if (filters.status) {
    conditions.push("purchase_orders.status = ?");
    params.push(filters.status);
  }
  if (filters.orderDate) {
    conditions.push("purchase_orders.order_time LIKE ?");
    params.push(`${filters.orderDate}%`);
  }
  if (filters.remark) {
    conditions.push("purchase_orders.remark LIKE ?");
    params.push(`%${filters.remark}%`);
  }
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(`
      (
        purchase_orders.order_no LIKE ?
        OR purchase_orders.logistics_no LIKE ?
        OR parts.code LIKE ?
        OR parts.name LIKE ?
        OR purchase_orders.status LIKE ?
        OR purchase_orders.order_time LIKE ?
        OR purchase_orders.remark LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const where = whereClause(conditions);
  return (await db.prepare(
      `
      SELECT
        purchase_orders.*,
        COALESCE(purchase_receipts.inbound_quantity, 0) AS inbound_quantity,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
    FROM purchase_orders
    JOIN parts ON parts.id = purchase_orders.part_id
    LEFT JOIN purchase_receipts ON purchase_receipts.purchase_order_id = purchase_orders.id
     ${where}
      ORDER BY purchase_orders.order_time DESC
      `,
    )
    .all(...params) as PurchaseOrderRow[]).map(toPurchaseOrder);
}

async function getPurchaseOrder(db: SqliteDb, id: string) {
  const row = await db.prepare(
      `
      SELECT
        purchase_orders.*,
        COALESCE(purchase_receipts.inbound_quantity, 0) AS inbound_quantity,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM purchase_orders
      JOIN parts ON parts.id = purchase_orders.part_id
      LEFT JOIN purchase_receipts ON purchase_receipts.purchase_order_id = purchase_orders.id
      WHERE purchase_orders.id = ?
      `,
    )
    .get(id) as PurchaseOrderRow | undefined;
  if (!row) {
    throw new Error("采购订单不存在");
  }
  return toPurchaseOrder(row);
}

async function listPurchaseReceipts(
  db: SqliteDb,
  filters: {
    from?: string | null;
    to?: string | null;
    createdFrom?: string | null;
    createdTo?: string | null;
    receiptState?: string | null;
    status?: string | null;
    codeQuery?: string | null;
    partQuery?: string | null;
    q?: string | null;
    includeAbnormalOutsideRange?: boolean;
  } = {},
) {
  const params: unknown[] = [];
  const dateConditions: string[] = [];
  const conditions: string[] = [];
  if (filters.from) {
    dateConditions.push("COALESCE(purchase_receipts.inbound_time, purchase_receipts.created_at) >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    dateConditions.push("COALESCE(purchase_receipts.inbound_time, purchase_receipts.created_at) < ?");
    params.push(filters.to);
  }
  if (filters.createdFrom) {
    conditions.push("purchase_receipts.created_at >= ?");
    params.push(filters.createdFrom);
  }
  if (filters.createdTo) {
    conditions.push("purchase_receipts.created_at < ?");
    params.push(filters.createdTo);
  }
  if (dateConditions.length > 0) {
    const dateExpression = dateConditions.join(" AND ");
    conditions.push(
      filters.includeAbnormalOutsideRange
        ? `(${dateExpression} OR purchase_receipts.status IN ('工厂缺货', '部分入库'))`
        : dateExpression,
    );
  }
  const pendingStatuses = ["已下单", "在途", "工厂缺货", "部分入库"];
  if (filters.status === "pending") {
    conditions.push(`purchase_receipts.status IN (${pendingStatuses.map(() => "?").join(", ")})`);
    params.push(...pendingStatuses);
  } else if (filters.status === "abnormal") {
    conditions.push("purchase_receipts.status IN ('工厂缺货', '部分入库')");
  } else {
    if (filters.receiptState === "pending") {
      conditions.push(`purchase_receipts.status IN (${pendingStatuses.map(() => "?").join(", ")})`);
      params.push(...pendingStatuses);
    } else if (filters.receiptState === "received") {
      conditions.push("purchase_receipts.status = '已入库'");
    }
    if (filters.status) {
      conditions.push("purchase_receipts.status = ?");
      params.push(filters.status);
    }
  }
  if (filters.codeQuery) {
    const pattern = `%${filters.codeQuery}%`;
    conditions.push(`
      (
        purchase_receipts.receipt_no LIKE ?
        OR purchase_orders.order_no LIKE ?
        OR purchase_receipts.logistics_no LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern);
  }
  if (filters.partQuery) {
    const pattern = `%${filters.partQuery}%`;
    conditions.push(`
      (
        parts.code LIKE ?
        OR parts.name LIKE ?
      )
    `);
    params.push(pattern, pattern);
  }
  if (filters.q && !filters.codeQuery && !filters.partQuery) {
    const pattern = `%${filters.q}%`;
    conditions.push(`
      (
        purchase_receipts.receipt_no LIKE ?
        OR purchase_orders.order_no LIKE ?
        OR purchase_receipts.logistics_no LIKE ?
        OR parts.code LIKE ?
        OR parts.name LIKE ?
        OR purchase_receipts.status LIKE ?
        OR purchase_receipts.remark LIKE ?
        OR COALESCE(purchase_receipts.inbound_time, purchase_receipts.created_at) LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return (await db.prepare(
      `
      SELECT
        purchase_receipts.*,
        purchase_orders.order_no AS order_no,
        purchase_orders.order_time AS order_time,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url,
        part_stock.quantity AS current_stock
      FROM purchase_receipts
      JOIN purchase_orders ON purchase_orders.id = purchase_receipts.purchase_order_id
      JOIN parts ON parts.id = purchase_receipts.part_id
      JOIN part_stock ON part_stock.part_id = purchase_receipts.part_id
      ${where}
      ORDER BY COALESCE(purchase_receipts.inbound_time, purchase_receipts.created_at) DESC
      `,
    )
    .all(...params) as PurchaseReceiptRow[]).map(toPurchaseReceipt);
}

async function getPurchaseReceipt(db: SqliteDb, id: string) {
  const row = await db.prepare(
      `
      SELECT
        purchase_receipts.*,
        purchase_orders.order_no AS order_no,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url,
        part_stock.quantity AS current_stock
      FROM purchase_receipts
      JOIN purchase_orders ON purchase_orders.id = purchase_receipts.purchase_order_id
      JOIN parts ON parts.id = purchase_receipts.part_id
      JOIN part_stock ON part_stock.part_id = purchase_receipts.part_id
      WHERE purchase_receipts.id = ?
      `,
    )
    .get(id) as PurchaseReceiptRow | undefined;
  if (!row) {
    throw new Error("采购入库单不存在");
  }
  return toPurchaseReceipt(row);
}

async function createOtherInboundRecord(db: SqliteDb, input: z.infer<typeof otherInboundSchema>) {
  const id = createId("other_inbound");
  const createdAt = nowIso();
  await db.transaction(async () => {
    await db.prepare(
      `
      INSERT INTO other_inbounds (
        id, inbound_source, part_id, inbound_quantity, inbound_time, operator_name, remark, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      input.inboundSource,
      input.partId,
      input.inboundQuantity,
      input.inboundTime,
      input.operatorName,
      input.remark,
      createdAt,
    );
    const stock = await db.prepare("UPDATE part_stock SET quantity = quantity + ?, updated_at = ? WHERE part_id = ?")
      .run(input.inboundQuantity, input.inboundTime, input.partId);
    if (stock.changes === 0) {
      throw new Error("配件库存不存在");
    }
    await insertStockMovement(db, {
      partId: input.partId,
      movementType: "其它入库",
      quantityDelta: input.inboundQuantity,
      sourceId: id,
      sourceTable: "other_inbounds",
      remark: input.remark,
      createdAt: input.inboundTime,
    });
  });
  return await getOtherInbound(db, id);
}

async function listOtherInbounds(db: SqliteDb, filters: { from?: string | null; to?: string | null; q?: string | null } = {}) {
  const range = dateRangeCondition("other_inbounds.inbound_time", filters);
  const conditions = range.condition ? [range.condition] : [];
  const params = [...range.params];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(`
      (
        other_inbounds.inbound_source LIKE ?
        OR parts.code LIKE ?
        OR parts.name LIKE ?
        OR CAST(other_inbounds.inbound_quantity AS TEXT) LIKE ?
        OR other_inbounds.inbound_time LIKE ?
        OR other_inbounds.operator_name LIKE ?
        OR other_inbounds.remark LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const where = whereClause(conditions);
  return (await db.prepare(
      `
      SELECT
        other_inbounds.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM other_inbounds
      JOIN parts ON parts.id = other_inbounds.part_id
      ${where}
      ORDER BY other_inbounds.inbound_time DESC
      `,
    )
    .all(...params) as OtherInboundRow[]).map(toOtherInbound);
}

async function getOtherInbound(db: SqliteDb, id: string) {
  const row = await db.prepare(
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

async function listStores(db: SqliteDb, search: string | null = null, status: "active" | "inactive" | null = null) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push("(name LIKE ? OR remark LIKE ?)");
    params.push(pattern, pattern);
  }
  if (status === "active") {
    conditions.push("enabled = 1");
  }
  if (status === "inactive") {
    conditions.push("enabled = 0");
  }
  const where = whereClause(conditions);
  return (await db.prepare(`SELECT * FROM outbound_stores ${where} ORDER BY created_at DESC`).all(...params) as StoreRow[]).map(toStore);
}

async function getStore(db: SqliteDb, id: string) {
  const row = await db.prepare("SELECT * FROM outbound_stores WHERE id = ?").get(id) as StoreRow | undefined;
  if (!row) {
    throw new Error("店铺不存在");
  }
  return toStore(row);
}

async function listOutboundRecords(
  db: SqliteDb,
  filters: OutboundFilters = {},
) {
  assertRangeWithinDays(filters.from, filters.to, 90, "出库时间范围不能超过90天");
  const range = dateRangeCondition("outbound_records.outbound_time", filters);
  const conditions = range.condition ? [range.condition] : [];
  const params = [...range.params];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(`
      (
        products.code LIKE ?
        OR products.name LIKE ?
        OR outbound_stores.name LIKE ?
        OR CAST(outbound_records.pre_outbound_quantity AS TEXT) LIKE ?
        OR CAST(outbound_records.actual_outbound_quantity AS TEXT) LIKE ?
        OR outbound_records.outbound_time LIKE ?
        OR outbound_records.operator_name LIKE ?
        OR outbound_records.remark LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.productCode) {
    conditions.push("products.code LIKE ?");
    params.push(`%${filters.productCode}%`);
  }
  if (filters.skuCode) {
    conditions.push("products.code LIKE ?");
    params.push(`%${filters.skuCode}%`);
  }
  if (filters.goodsCode) {
    conditions.push("products.code LIKE ?");
    params.push(`%${filters.goodsCode}%`);
  }
  if (filters.productName) {
    conditions.push("products.name LIKE ?");
    params.push(`%${filters.productName}%`);
  }
  if (filters.partQuery) {
    conditions.push(`
      products.id IN (
        SELECT product_bom_items.product_id
        FROM product_bom_items
        JOIN parts ON parts.id = product_bom_items.part_id
        WHERE parts.code LIKE ? OR parts.name LIKE ?
      )
    `);
    const pattern = `%${filters.partQuery}%`;
    params.push(pattern, pattern);
  }
  if (filters.storeName) {
    conditions.push("outbound_stores.name LIKE ?");
    params.push(`%${filters.storeName}%`);
  }
  if (filters.operatorName) {
    conditions.push("outbound_records.operator_name LIKE ?");
    params.push(`%${filters.operatorName}%`);
  }
  if (filters.remark) {
    conditions.push("outbound_records.remark LIKE ?");
    params.push(`%${filters.remark}%`);
  }
  const where = whereClause(conditions);
  const legacyRecords = (await db.prepare(
      `
      SELECT
        outbound_records.*,
        products.code AS product_code,
        products.name AS product_name,
        products.image_url AS product_image_url,
        outbound_stores.name AS store_name
      FROM outbound_records
      JOIN products ON products.id = outbound_records.product_id
      JOIN outbound_stores ON outbound_stores.id = outbound_records.store_id
      ${where}
      ORDER BY outbound_records.outbound_time DESC
      `,
    )
    .all(...params) as OutboundRecordRow[]).map(toOutboundRecord);
  const shipmentRecords = await listApprovedShipmentRecords(db, filters);
  return [...legacyRecords, ...shipmentRecords].sort((left, right) =>
    `${right.outboundTime}:${right.id}`.localeCompare(`${left.outboundTime}:${left.id}`),
  );
}

async function getOutboundRecord(db: SqliteDb, id: string) {
  const row = await db.prepare(
      `
      SELECT
        outbound_records.*,
        products.code AS product_code,
        products.name AS product_name,
        products.image_url AS product_image_url,
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

async function listApprovedShipmentRecords(db: SqliteDb, filters: OutboundFilters) {
  const range = dateRangeCondition("outbound_shipments.outbound_time", filters);
  const conditions = ["outbound_shipments.status = '已出库'", ...(range.condition ? [range.condition] : [])];
  const params = [...range.params];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(`
      (
        products.code LIKE ?
        OR products.name LIKE ?
        OR outbound_stores.name LIKE ?
        OR CAST(outbound_plan_items.pre_outbound_quantity AS TEXT) LIKE ?
        OR CAST(outbound_shipment_items.shipped_quantity AS TEXT) LIKE ?
        OR outbound_shipments.outbound_time LIKE ?
        OR outbound_shipments.operator_name LIKE ?
        OR outbound_shipments.remark LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.productCode || filters.skuCode || filters.goodsCode) {
    const productCode = filters.productCode ?? filters.skuCode ?? filters.goodsCode;
    conditions.push("products.code LIKE ?");
    params.push(`%${productCode}%`);
  }
  if (filters.productName) {
    conditions.push("products.name LIKE ?");
    params.push(`%${filters.productName}%`);
  }
  if (filters.partQuery) {
    const pattern = `%${filters.partQuery}%`;
    conditions.push(`
      products.id IN (
        SELECT product_bom_items.product_id
        FROM product_bom_items
        JOIN parts ON parts.id = product_bom_items.part_id
        WHERE parts.code LIKE ? OR parts.name LIKE ?
      )
    `);
    params.push(pattern, pattern);
  }
  if (filters.storeName) {
    conditions.push("outbound_stores.name LIKE ?");
    params.push(`%${filters.storeName}%`);
  }
  if (filters.operatorName) {
    conditions.push("outbound_shipments.operator_name LIKE ?");
    params.push(`%${filters.operatorName}%`);
  }
  if (filters.remark) {
    conditions.push("outbound_shipments.remark LIKE ?");
    params.push(`%${filters.remark}%`);
  }

  return (await db.prepare(
      `
      SELECT
        outbound_shipment_items.id,
        outbound_shipment_items.product_id,
        products.code AS product_code,
        products.name AS product_name,
        products.image_url AS product_image_url,
        outbound_plans.store_id,
        outbound_stores.name AS store_name,
        outbound_shipment_items.shipped_quantity AS outbound_quantity,
        outbound_plan_items.pre_outbound_quantity,
        outbound_shipment_items.shipped_quantity AS actual_outbound_quantity,
        outbound_shipments.outbound_time,
        outbound_shipments.operator_name,
        outbound_shipments.status,
        outbound_shipments.reviewed_by,
        outbound_shipments.reviewed_at,
        outbound_shipments.remark,
        outbound_shipments.created_at
      FROM outbound_shipment_items
      JOIN outbound_shipments ON outbound_shipments.id = outbound_shipment_items.shipment_id
      JOIN outbound_plan_items ON outbound_plan_items.id = outbound_shipment_items.plan_item_id
      JOIN outbound_plans ON outbound_plans.id = outbound_shipments.plan_id
      JOIN outbound_stores ON outbound_stores.id = outbound_plans.store_id
      JOIN products ON products.id = outbound_shipment_items.product_id
      ${whereClause(conditions)}
      ORDER BY outbound_shipments.outbound_time DESC, outbound_shipment_items.id
      `,
    )
    .all(...params) as OutboundRecordRow[]).map(toOutboundRecord);
}

async function listStock(db: SqliteDb, search: string | null = null) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(`
      (
        parts.code LIKE ?
        OR parts.name LIKE ?
        OR parts.specification LIKE ?
        OR CAST(parts.weight AS TEXT) LIKE ?
        OR CAST(part_stock.quantity AS TEXT) LIKE ?
        OR part_stock.remark LIKE ?
        OR part_stock.last_stocktake_at LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const where = whereClause(conditions);
  const stockRows = (await db.prepare(
      `
      SELECT
        part_stock.part_id,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS image_url,
        parts.specification AS specification,
        parts.weight AS weight,
        part_stock.quantity,
        part_stock.remark,
        part_stock.last_stocktake_at,
        COALESCE(usage.outbound_7_days, 0) AS outbound_7_days,
        COALESCE(usage.outbound_14_days, 0) AS outbound_14_days,
        COALESCE(purchase_transit.quantity, 0) AS purchase_in_transit,
        part_stock.updated_at
      FROM part_stock
      JOIN parts ON parts.id = part_stock.part_id
      LEFT JOIN (
        SELECT
          part_id,
          SUM(CASE WHEN outbound_time >= ? THEN quantity ELSE 0 END) AS outbound_7_days,
          SUM(CASE WHEN outbound_time >= ? THEN quantity ELSE 0 END) AS outbound_14_days
        FROM (
          SELECT
            product_bom_items.part_id,
            outbound_records.outbound_time,
            COALESCE(outbound_records.actual_outbound_quantity, outbound_records.outbound_quantity) * product_bom_items.quantity AS quantity
          FROM outbound_records
          JOIN product_bom_items ON product_bom_items.product_id = outbound_records.product_id
          WHERE outbound_records.status = '已出库'
          UNION ALL
          SELECT
            product_bom_items.part_id,
            outbound_shipments.outbound_time,
            outbound_shipment_items.shipped_quantity * product_bom_items.quantity AS quantity
          FROM outbound_shipment_items
          JOIN outbound_shipments ON outbound_shipments.id = outbound_shipment_items.shipment_id
          JOIN product_bom_items ON product_bom_items.product_id = outbound_shipment_items.product_id
          WHERE outbound_shipments.status = '已出库'
        ) outbound_usage
        GROUP BY part_id
      ) usage ON usage.part_id = part_stock.part_id
      LEFT JOIN (
        SELECT part_id, SUM(purchase_quantity - inbound_quantity) AS quantity
        FROM purchase_receipts
        WHERE status IN ('在途', '部分入库')
          AND inbound_quantity < purchase_quantity
        GROUP BY part_id
      ) purchase_transit ON purchase_transit.part_id = part_stock.part_id
      ${where}
      ORDER BY parts.code
      `,
    )
    .all(sevenDaysAgo, fourteenDaysAgo, ...params) as StockRow[]).map(toStock);
  const locksByPartId = new Map((await listLockedPartStock(db)).map((lock) => [lock.partId, lock]));
  return stockRows.map((stock) => {
    const lock = locksByPartId.get(stock.partId);
    const lockedQuantity = lock?.lockedQuantity ?? 0;
    return {
      ...stock,
      lockedQuantity,
      availableQuantity: stock.quantity - lockedQuantity,
    };
  });
}

async function getStock(db: SqliteDb, partId: string) {
  const row = await db.prepare(
      `
      SELECT
        part_stock.part_id,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS image_url,
        parts.specification AS specification,
        parts.weight AS weight,
        part_stock.quantity,
        part_stock.remark,
        part_stock.last_stocktake_at,
        part_stock.updated_at
      FROM part_stock
      JOIN parts ON parts.id = part_stock.part_id
      WHERE part_stock.part_id = ?
      `,
    )
    .get(partId) as StockRow | undefined;
  if (!row) {
    throw new Error("配件库存不存在");
  }
  return toStock(row);
}

async function listStocktakes(
  db: SqliteDb,
  filters: {
    from?: string | null;
    to?: string | null;
    q?: string | null;
    partCode?: string | null;
    partName?: string | null;
    stocktakeDate?: string | null;
    remark?: string | null;
  } = {},
) {
  const range = dateRangeCondition("stocktakes.stocktake_time", filters);
  const conditions = range.condition ? [range.condition] : [];
  const params = [...range.params];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(`
      (
        parts.code LIKE ?
        OR parts.name LIKE ?
        OR CAST(stocktakes.previous_quantity AS TEXT) LIKE ?
        OR CAST(stocktakes.actual_quantity AS TEXT) LIKE ?
        OR stocktakes.stocktake_time LIKE ?
        OR stocktakes.remark LIKE ?
      )
    `);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.partCode) {
    conditions.push("parts.code LIKE ?");
    params.push(`%${filters.partCode}%`);
  }
  if (filters.partName) {
    conditions.push("parts.name LIKE ?");
    params.push(`%${filters.partName}%`);
  }
  if (filters.stocktakeDate) {
    conditions.push("stocktakes.stocktake_time LIKE ?");
    params.push(`${filters.stocktakeDate}%`);
  }
  if (filters.remark) {
    conditions.push("stocktakes.remark LIKE ?");
    params.push(`%${filters.remark}%`);
  }
  const where = whereClause(conditions);
  return (await db.prepare(
      `
      SELECT
        stocktakes.*,
        parts.code AS part_code,
        parts.name AS part_name,
        parts.image_url AS part_image_url
      FROM stocktakes
      JOIN parts ON parts.id = stocktakes.part_id
      ${where}
      ORDER BY stocktakes.stocktake_time DESC
      `,
    )
    .all(...params) as StocktakeRow[]).map(toStocktake);
}

async function createStocktakeRecord(db: SqliteDb, input: z.infer<typeof stocktakeSchema>) {
  const id = createId("stocktake");
  const createdAt = nowIso();
  await db.transaction(async () => {
    const stock = await db.prepare("SELECT quantity FROM part_stock WHERE part_id = ? FOR UPDATE")
      .get(input.partId) as { quantity: number } | undefined;
    if (!stock) {
      throw new Error("配件库存不存在");
    }
    const delta = input.actualQuantity - stock.quantity;
    await db.prepare(
      `
      INSERT INTO stocktakes (
        id, part_id, previous_quantity, actual_quantity, remark, stocktake_time, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(id, input.partId, stock.quantity, input.actualQuantity, input.remark, input.stocktakeTime, createdAt);
    await db.prepare(
      `
      UPDATE part_stock
      SET quantity = ?, remark = ?, last_stocktake_at = ?, updated_at = ?
      WHERE part_id = ?
      `,
    ).run(input.actualQuantity, input.remark, input.stocktakeTime, input.stocktakeTime, input.partId);
    if (delta !== 0) {
      await insertStockMovement(db, {
        partId: input.partId,
        movementType: "盘点调整",
        quantityDelta: delta,
        sourceId: id,
        sourceTable: "stocktakes",
        remark: input.remark,
        createdAt: input.stocktakeTime,
      });
    }
  });
  return await getStocktake(db, id);
}

async function getStocktake(db: SqliteDb, id: string) {
  const row = await db.prepare(
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

async function insertStockMovement(
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

async function deleteById(db: SqliteDb, table: string, id: string, notFoundMessage: string) {
  const allowedTables = new Set(["parts", "products", "outbound_stores", "users"]);
  if (!allowedTables.has(table)) {
    throw new Error("不支持的删除表");
  }
  const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (result.changes === 0) {
    throw new Error(notFoundMessage);
  }
}

async function assertStoreCanBeDeleted(db: SqliteDb, id: string) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM outbound_records WHERE store_id = ?").get(id) as
    | { count: number | string }
    | undefined;
  if (Number(row?.count ?? 0) > 0) {
    throw new Error("该店铺已有出库记录，不能删除。请保留店铺用于历史数据追溯。");
  }
}

async function assertPartCanBeDeleted(db: SqliteDb, id: string) {
  const references = [
    ["product_bom_items", "part_id", "该配件已被产品BOM引用，不能删除。请先调整产品组装后再删除配件。"],
    ["purchase_orders", "part_id", "该配件已有采购订单，不能删除。请保留配件用于历史数据追溯。"],
    ["other_inbounds", "part_id", "该配件已有其它入库记录，不能删除。请保留配件用于历史数据追溯。"],
    ["stocktakes", "part_id", "该配件已有盘点记录，不能删除。请保留配件用于历史数据追溯。"],
    ["stock_movements", "part_id", "该配件已有库存流水，不能删除。请保留配件用于历史数据追溯。"],
  ] as const;

  for (const [table, column, message] of references) {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(id) as
      | { count: number | string }
      | undefined;
    if (Number(row?.count ?? 0) > 0) {
      throw new Error(message);
    }
  }
}

type ExportColumn = CsvColumn & {
  image?: boolean;
};

type ExportRoute = {
  path: string;
  title: string;
  routes: ReturnType<typeof requireAuth>[];
  columns: ExportColumn[];
  rows: (request: Request, response: Response) => Promise<Record<string, unknown>[]>;
};

function registerCsvRoutes(
  db: SqliteDb,
  app: ReturnType<typeof express>,
  operatorRoutes: ReturnType<typeof requireAuth>[],
  adminRoutes: ReturnType<typeof requireAuth>[],
) {
  const purchaserRoutes = [requireAuth(db), requireAnyRole(["admin", "purchaser"])];
  const inboundRoutes = [requireAuth(db), requireAnyRole(["admin", "inbound"])];
  const outboundRoutes = [requireAuth(db), requireAnyRole(["admin", "outbound", "operation", "operator"])];
  const stockRoutes = [requireAuth(db), requireAnyRole(["admin", "purchaser", "outbound", "operator"])];
  const stocktakeRoutes = [requireAuth(db), requireAnyRole(["admin", "outbound", "operator"])];
  const routes: ExportRoute[] = [
    {
      path: "/api/parts",
      title: "配件管理",
      routes: adminRoutes,
      columns: partCsvColumns,
      rows: async (request) => await listParts(db, queryString(request.query.q ?? request.query.search)) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/products",
      title: "产品组装",
      routes: adminRoutes,
      columns: productCsvColumns,
      rows: async (request) => await listProductExportRows(db, queryString(request.query.q ?? request.query.search)),
    },
    {
      path: "/api/purchase-orders",
      title: "采购订单",
      routes: purchaserRoutes,
      columns: purchaseOrderCsvColumns,
      rows: async (request) => await listPurchaseOrders(db, purchaseOrderFiltersFromQuery(request)) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/purchase-receipts",
      title: "采购入库",
      routes: inboundRoutes,
      columns: purchaseReceiptCsvColumns,
      rows: async (request) => await listPurchaseReceipts(db, purchaseReceiptFiltersFromQuery(request)) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/other-inbounds",
      title: "其它入库",
      routes: inboundRoutes,
      columns: otherInboundCsvColumns,
      rows: async (request) => await listOtherInbounds(db, rangeAndSearchFiltersFromQuery(request)) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/stores",
      title: "店铺管理",
      routes: adminRoutes,
      columns: storeCsvColumns,
      rows: async (request) =>
        await listStores(
          db,
          queryString(request.query.q ?? request.query.search),
          storeStatusQuery(request.query.status),
        ) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/outbound-records",
      title: "出库管理",
      routes: outboundRoutes,
      columns: outboundCsvColumns,
      rows: async (request, response) =>
        filterOutboundRecordsByStoreIds(
          await listOutboundRecords(db, outboundFiltersFromQuery(request)),
          await storeScopeForUser(db, response.locals.user as User),
        ) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/stock",
      title: "库存查看",
      routes: stockRoutes,
      columns: stockCsvColumns,
      rows: async (request) => await listStock(db, queryString(request.query.q ?? request.query.search)) as unknown as Record<string, unknown>[],
    },
    {
      path: "/api/stocktakes",
      title: "盘点管理",
      routes: stocktakeRoutes,
      columns: stocktakeCsvColumns,
      rows: async (request) => await listStocktakes(db, stocktakeFiltersFromQuery(request)) as unknown as Record<string, unknown>[],
    },
  ];

  for (const exportRoute of routes) {
    app.get(`${exportRoute.path}.csv`, ...exportRoute.routes, route(async (request, response) => {
      sendCsv(response, exportRoute.title, await exportRoute.rows(request, response), exportRoute.columns);
    }));
    app.get(`${exportRoute.path}.xlsx`, ...exportRoute.routes, route(async (request, response) => {
      await sendXlsx(response, exportRoute.title, await exportRoute.rows(request, response), exportRoute.columns);
    }));
  }

  const historyRoutes: ExportRoute[] = [
    {
      path: "/api/history/purchase-orders",
      title: "历史采购订单",
      routes: purchaserRoutes,
      columns: historyPurchaseOrderCsvColumns,
      rows: async (request) => {
        const range = historyRange(request);
        return await listPurchaseOrders(db, { from: range.from, to: range.to, includeAbnormalOutsideRange: range.isDefault }) as unknown as Record<string, unknown>[];
      },
    },
    {
      path: "/api/history/purchase-receipts",
      title: "历史采购入库",
      routes: inboundRoutes,
      columns: historyPurchaseReceiptCsvColumns,
      rows: async (request) => {
        const range = historyRange(request);
        return await listPurchaseReceipts(db, { from: range.from, to: range.to, includeAbnormalOutsideRange: range.isDefault }) as unknown as Record<string, unknown>[];
      },
    },
    {
      path: "/api/history/other-inbounds",
      title: "历史其它入库",
      routes: inboundRoutes,
      columns: historyOtherInboundCsvColumns,
      rows: async (request) => {
        const range = historyRange(request);
        return await listOtherInbounds(db, { from: range.from, to: range.to }) as unknown as Record<string, unknown>[];
      },
    },
    {
      path: "/api/history/outbound-records",
      title: "历史出库",
      routes: outboundRoutes,
      columns: historyOutboundCsvColumns,
      rows: async (request, response) => {
        const range = historyRange(request);
        return filterOutboundRecordsByStoreIds(
          await listOutboundRecords(db, { from: range.from, to: range.to, partQuery: queryString(request.query.partQuery) }),
          await storeScopeForUser(db, response.locals.user as User),
        ) as unknown as Record<string, unknown>[];
      },
    },
    {
      path: "/api/history/stocktakes",
      title: "历史盘点",
      routes: stocktakeRoutes,
      columns: historyStocktakeCsvColumns,
      rows: async (request) => {
        const range = historyRange(request);
        return await listStocktakes(db, { from: range.from, to: range.to }) as unknown as Record<string, unknown>[];
      },
    },
  ];

  for (const exportRoute of historyRoutes) {
    app.get(`${exportRoute.path}.csv`, ...exportRoute.routes, route(async (request, response) => {
      sendCsv(response, exportRoute.title, await exportRoute.rows(request, response), exportRoute.columns);
    }));
    app.get(`${exportRoute.path}.xlsx`, ...exportRoute.routes, route(async (request, response) => {
      await sendXlsx(response, exportRoute.title, await exportRoute.rows(request, response), exportRoute.columns);
    }));
  }
}

function purchaseOrderFiltersFromQuery(request: Request) {
  return {
    from: queryString(request.query.from),
    to: queryString(request.query.to),
    orderNo: queryString(request.query.orderNo),
    logisticsNo: queryString(request.query.logisticsNo),
    partId: queryString(request.query.partId),
    status: queryString(request.query.status),
    orderDate: queryString(request.query.orderDate),
    remark: queryString(request.query.remark),
    q: queryString(request.query.q ?? request.query.search),
  };
}

function purchaseReceiptFiltersFromQuery(request: Request) {
  return {
    from: queryString(request.query.from),
    to: queryString(request.query.to),
    createdFrom: queryString(request.query.createdFrom),
    createdTo: queryString(request.query.createdTo),
    receiptState: queryString(request.query.receiptState),
    status: queryString(request.query.status),
    codeQuery: queryString(request.query.codeQuery),
    partQuery: queryString(request.query.partQuery),
    q: queryString(request.query.q ?? request.query.search),
  };
}

function rangeAndSearchFiltersFromQuery(request: Request) {
  return {
    from: queryString(request.query.from),
    to: queryString(request.query.to),
    q: queryString(request.query.q ?? request.query.search),
  };
}

function outboundFiltersFromQuery(request: Request) {
  return {
    from: queryString(request.query.from),
    to: queryString(request.query.to),
    q: queryString(request.query.q ?? request.query.search),
    skuCode: queryString(request.query.skuCode),
    goodsCode: queryString(request.query.goodsCode),
    productCode: queryString(request.query.productCode),
    productName: queryString(request.query.productName),
    partQuery: queryString(request.query.partQuery),
    storeName: queryString(request.query.storeName),
    operatorName: queryString(request.query.operatorName),
    remark: queryString(request.query.remark),
  };
}

function stocktakeFiltersFromQuery(request: Request) {
  return {
    from: queryString(request.query.from),
    to: queryString(request.query.to),
    q: queryString(request.query.q ?? request.query.search),
    partCode: queryString(request.query.partCode),
    partName: queryString(request.query.partName),
    stocktakeDate: queryString(request.query.stocktakeDate),
    remark: queryString(request.query.remark),
  };
}

function sendCsv(response: Response, title: string, rows: Record<string, unknown>[], columns: ExportColumn[]) {
  const filename = `${title}-${timestampForFilename()}.csv`;
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.send(`\ufeff${toCsv(rows, columns)}`);
}

async function sendXlsx(response: Response, title: string, rows: Record<string, unknown>[], columns: ExportColumn[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(title.slice(0, 31));
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.image ? 14 : Math.max(12, Math.min(28, column.header.length * 3)),
  }));
  worksheet.getRow(1).font = { bold: true };

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const values = columns.map((column) => {
      if (column.image) {
        return null;
      }
      return column.format ? column.format(row[column.key], row) : row[column.key] ?? "";
    });
    worksheet.addRow(values);
    columns.forEach((column, columnIndex) => {
      if (!column.image) return;
      const imagePath = resolveUploadPath(row[column.key]);
      if (!imagePath) return;
      const extension = path.extname(imagePath).slice(1).toLowerCase();
      if (!["png", "jpeg", "jpg"].includes(extension)) return;
      const dimensions = readImageDimensions(imagePath);
      if (!dimensions) return;
      const thumbnail = fitImageToBox(dimensions.width, dimensions.height, 72, 72);
      worksheet.getRow(rowNumber).height = Math.max(42, Math.ceil((thumbnail.height + 8) * 0.75));
      const imageId = workbook.addImage({
        filename: imagePath,
        extension: extension === "jpg" ? "jpeg" : extension as "png" | "jpeg",
      });
      worksheet.addImage(imageId, {
        tl: { col: columnIndex + 0.08, row: rowNumber - 0.9 },
        ext: { width: thumbnail.width, height: thumbnail.height },
      });
    });
  });

  const filename = `${title}-${timestampForFilename()}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.send(Buffer.from(buffer));
}

function timestampForFilename() {
  const utcPlus8 = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const compact = utcPlus8.toISOString().replace(/\D/g, "").slice(0, 14);
  return `${compact.slice(0, 4)}_${compact.slice(4, 8)}_${compact.slice(8, 14)}`;
}

function resolveUploadPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/uploads/")) {
    return null;
  }
  const relative = value.replace(/^\/+/, "");
  const resolved = path.resolve(relative);
  const uploadsRoot = path.resolve("uploads");
  if (!resolved.startsWith(uploadsRoot) || !fs.existsSync(resolved)) {
    return null;
  }
  return resolved;
}

function readImageDimensions(imagePath: string) {
  const buffer = fs.readFileSync(imagePath);
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 7 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          width: buffer.readUInt16BE(offset + 5),
          height: buffer.readUInt16BE(offset + 3),
        };
      }
      offset += segmentLength;
    }
  }
  return null;
}

function fitImageToBox(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: width * scale,
    height: height * scale,
  };
}

function formatDateForExport(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const text = String(value);
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]} ${isoMatch[2]}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function imageExportText(value: unknown) {
  return value ? "有图片" : "";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

const partCsvColumns: ExportColumn[] = [
  { key: "code", header: "编号" },
  { key: "name", header: "名称" },
  { key: "imageUrl", header: "图片", format: imageExportText, image: true },
  { key: "weight", header: "重量" },
  { key: "specification", header: "尺寸/规格" },
  { key: "currentStock", header: "当前库存量" },
  { key: "remark", header: "备注" },
];

const productCsvColumns: ExportColumn[] = [
  { key: "code", header: "产品编号" },
  { key: "name", header: "产品名称" },
  { key: "imageUrl", header: "图片", format: imageExportText, image: true },
  { key: "bomText", header: "BOM" },
  { key: "remark", header: "备注" },
];

const purchaseOrderCsvColumns: ExportColumn[] = [
  { key: "orderNo", header: "采购订单编号" },
  { key: "logisticsNo", header: "运单号" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
   { key: "orderQuantity", header: "数量" },
   { key: "status", header: "状态" },
    { key: "inboundQuantity", header: "已入库数量" },
   { key: "orderTime", header: "下单时间", format: formatDateForExport },
  { key: "remark", header: "备注" },
];

const purchaseReceiptCsvColumns: ExportColumn[] = [
  { key: "receiptNo", header: "入库单号" },
  { key: "orderNo", header: "采购订单编号" },
  { key: "logisticsNo", header: "运单号" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
  { key: "purchaseQuantity", header: "采购数" },
  { key: "currentStock", header: "现货库存数量" },
  { key: "inboundQuantity", header: "已入库" },
  { key: "status", header: "状态" },
  { key: "orderTime", header: "下单时间", format: formatDateForExport },
  { key: "inboundTime", header: "到货时间", format: formatDateForExport },
  { key: "remark", header: "备注" },
];

const otherInboundCsvColumns: ExportColumn[] = [
  { key: "inboundSource", header: "入库途径" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
  { key: "inboundQuantity", header: "数量" },
  { key: "inboundTime", header: "入库时间", format: formatDateForExport },
  { key: "operatorName", header: "操作人" },
  { key: "remark", header: "备注" },
];

const storeCsvColumns: ExportColumn[] = [
  { key: "name", header: "店铺名称" },
  { key: "enabled", header: "状态", format: (value) => value === false ? "停用" : "启用" },
  { key: "remark", header: "备注" },
];

const outboundCsvColumns: ExportColumn[] = [
  { key: "skuCode", header: "SKU码" },
  { key: "goodsCode", header: "货品编码" },
  { key: "productName", header: "产品" },
  { key: "productImageUrl", header: "产品图片", format: imageExportText, image: true },
  { key: "storeName", header: "店铺" },
  { key: "preOutboundQuantity", header: "预出库数量" },
  { key: "actualOutboundQuantity", header: "实际出库数量" },
  { key: "outboundTime", header: "时间", format: formatDateForExport },
  { key: "operatorName", header: "出库人" },
  { key: "status", header: "审核状态" },
  { key: "remark", header: "备注" },
];

const stockCsvColumns: ExportColumn[] = [
  { key: "partCode", header: "编号" },
  { key: "partName", header: "名称" },
  { key: "imageUrl", header: "图片", format: imageExportText, image: true },
  { key: "specification", header: "规格" },
  { key: "weight", header: "重量" },
  { key: "quantity", header: "现货库存数量" },
  { key: "lockedQuantity", header: "锁定库存" },
  { key: "availableQuantity", header: "可用库存" },
  { key: "purchaseInTransit", header: "采购在途" },
  { key: "outbound7Days", header: "7天出库量" },
  { key: "outbound14Days", header: "14天出库量" },
  { key: "remark", header: "备注" },
  { key: "lastStocktakeAt", header: "盘点时间", format: formatDateForExport },
];

const stocktakeCsvColumns: ExportColumn[] = [
  { key: "partCode", header: "配件编号" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
  { key: "previousQuantity", header: "盘前数量" },
  { key: "actualQuantity", header: "盘后数量" },
  { key: "stocktakeTime", header: "盘点时间", format: formatDateForExport },
  { key: "remark", header: "备注" },
];

const historyPurchaseOrderCsvColumns: ExportColumn[] = [
  { key: "orderNo", header: "采购订单编号" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
  { key: "status", header: "状态" },
  { key: "orderTime", header: "时间", format: formatDateForExport },
];

const historyPurchaseReceiptCsvColumns: ExportColumn[] = [
  { key: "receiptNo", header: "单号" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
  { key: "status", header: "状态" },
  { key: "inboundTime", header: "时间", format: formatDateForExport },
];

const historyOtherInboundCsvColumns: ExportColumn[] = [
  { key: "inboundSource", header: "入库途径" },
  { key: "partName", header: "配件" },
  { key: "partImageUrl", header: "图片", format: imageExportText, image: true },
  { key: "inboundTime", header: "时间", format: formatDateForExport },
];

const historyOutboundCsvColumns: ExportColumn[] = [
  { key: "skuCode", header: "SKU码" },
  { key: "goodsCode", header: "货品编码" },
  { key: "productName", header: "产品" },
  { key: "productImageUrl", header: "产品图片", format: imageExportText, image: true },
  { key: "storeName", header: "店铺" },
  { key: "preOutboundQuantity", header: "预出库数量" },
  { key: "actualOutboundQuantity", header: "实际出库数量" },
  { key: "outboundTime", header: "时间", format: formatDateForExport },
  { key: "operatorName", header: "出库人" },
  { key: "status", header: "审核状态" },
  { key: "reviewedBy", header: "审核人" },
  { key: "reviewedAt", header: "审核时间", format: formatDateForExport },
  { key: "remark", header: "备注" },
];

const historyStocktakeCsvColumns = stocktakeCsvColumns;

async function listProductExportRows(db: SqliteDb, search: string | null = null) {
  const products = await listProducts(db);
  const normalized = search?.trim().toLowerCase();
  const filteredProducts = normalized
    ? products.filter((product) =>
        ["code", "name", "remark"].some((key) =>
          String((product as Record<string, unknown>)[key] ?? "").toLowerCase().includes(normalized),
        ),
      )
    : products;
  return filteredProducts.map((product) => ({
    ...product,
    bomText: formatBomForExport(product.bomItems),
  })) as Record<string, unknown>[];
}

function formatBomForExport(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  return items
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = String(row.partName ?? row.partId ?? "");
      const quantity = String(row.quantity ?? "");
      return quantity ? `${name} x ${quantity}` : name;
    })
    .join("；");
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

function toOutboundOperator(row: OutboundOperatorRow) {
  return {
    id: row.id,
    name: row.name,
    enabled: Number(row.enabled) === 1,
    createdAt: row.created_at,
   updatedAt: row.updated_at,
  };
}

function toAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeData: row.before_data ? JSON.parse(row.before_data) : null,
    afterData: row.after_data ? JSON.parse(row.after_data) : null,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

function toPart(row: PartRow): Part {
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

function toProduct(row: ProductRow): Product {
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
    inboundQuantity: row.inbound_quantity,
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
    orderTime: row.order_time,
    logisticsNo: row.logistics_no,
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    partImageUrl: row.part_image_url,
    currentStock: row.current_stock,
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
    inboundSource: row.inbound_source,
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
    enabled: Number(row.enabled) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOutboundRecord(row: OutboundRecordRow) {
  const preOutboundQuantity = Number(row.pre_outbound_quantity ?? row.outbound_quantity);
  const actualOutboundQuantity = Number(row.actual_outbound_quantity ?? row.outbound_quantity);
  return {
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    skuCode: row.product_code,
    goodsCode: row.product_code,
    productName: row.product_name,
    productImageUrl: row.product_image_url ?? null,
    storeId: row.store_id,
    storeName: row.store_name,
    outboundQuantity: row.outbound_quantity,
    preOutboundQuantity,
    actualOutboundQuantity,
    outboundTime: row.outbound_time,
    operatorName: row.operator_name,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    remark: row.remark,
    createdAt: row.created_at,
  };
}

function toStock(row: StockRow) {
  const quantity = Number(row.quantity);
  const outbound14Days = Number(row.outbound_14_days ?? 0);
  const averageDailyUsage = outbound14Days / 14;
  return {
    partId: row.part_id,
    partCode: row.part_code,
    partName: row.part_name,
    imageUrl: row.image_url,
    specification: row.specification,
    weight: row.weight,
    quantity,
    remark: row.remark,
    lastStocktakeAt: row.last_stocktake_at,
    outbound7Days: Number(row.outbound_7_days ?? 0),
    outbound14Days,
    purchaseInTransit: Number(row.purchase_in_transit ?? 0),
    isLowStock: averageDailyUsage > 0 && quantity / averageDailyUsage < 15,
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

async function ignoreLowStockPart(db: SqliteDb, partId: string) {
  const part = await db.prepare("SELECT id FROM parts WHERE id = ?").get(partId) as { id: string } | undefined;
  if (!part) {
    throw new Error("配件不存在");
  }
  const updatedAt = nowIso();
  await db.prepare(
    `
    INSERT INTO low_stock_ignores (part_id, ignore_count, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(part_id) DO UPDATE SET
      ignore_count = low_stock_ignores.ignore_count + 1,
      updated_at = excluded.updated_at
    `,
  ).run(partId, updatedAt);
}

async function getLowStockIgnore(db: SqliteDb, partId: string) {
  const row = await db.prepare("SELECT part_id, ignore_count FROM low_stock_ignores WHERE part_id = ?")
    .get(partId) as LowStockIgnoreRow | undefined;
  return row ? { partId: row.part_id, ignoreCount: row.ignore_count } : null;
}

async function filterIgnoredLowStockParts(db: SqliteDb, lowStockParts: LowStockPart[]) {
  if (lowStockParts.length === 0) {
    return lowStockParts;
  }
  const ignoredRows = await db.prepare("SELECT part_id, ignore_count FROM low_stock_ignores").all() as LowStockIgnoreRow[];
  const ignoreCountByPart = new Map(ignoredRows.map((row) => [row.part_id, row.ignore_count]));

  return lowStockParts.filter((part) => {
    const ignoreCount = ignoreCountByPart.get(part.partId) ?? 0;
    if (ignoreCount <= 0) {
      return true;
    }
    if (ignoreCount === 1) {
      return part.remainingDays < 10;
    }
    if (ignoreCount === 2) {
      return part.remainingDays < 7;
    }
    return false;
  });
}
