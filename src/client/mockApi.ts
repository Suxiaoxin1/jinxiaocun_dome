import type { AnyRow } from "./types";
import {
  createInitialDb,
  findById,
  generateId,
  generateNextNo,
  getCurrentUser,
  getPartCode,
  getPartName,
  getProductCode,
  getProductName,
  getStoreName,
  loadDb,
  removeById,
  saveDb,
  setCurrentUser,
} from "./mockData";
import type { OutboundPlan, OutboundPlanItem, OutboundShipment, OutboundShipmentItem, SessionUser } from "../shared/types";

const mockAdmin: SessionUser = { id: "user_admin", username: "admin", displayName: "系统管理员", role: "admin" };

export function isMockApiEnabled() {
  return true;
}

function str(value: unknown) {
  return String(value ?? "");
}

function num(value: unknown) {
  return Number(value ?? 0);
}

export async function mockRequest(path: string, init?: RequestInit): Promise<unknown> {
  const method = (init?.method ?? "GET").toUpperCase();
  const rawBody: unknown = init?.body ?? undefined;
  const body: AnyRow = typeof rawBody === "string" ? JSON.parse(rawBody) : (rawBody as AnyRow) ?? {};
  const url = new URL(path, "http://localhost");
  const query = url.searchParams;

  await simulateLatency();

  const route = `${method} ${url.pathname}`;

  if (route === "POST /api/auth/login") {
    setCurrentUser(mockAdmin);
    return { user: mockAdmin };
  }

  if (route === "GET /api/auth/me") {
    const user = getCurrentUser() ?? mockAdmin;
    setCurrentUser(user);
    return { user };
  }

  if (route === "POST /api/auth/logout") {
    setCurrentUser(null);
    return {};
  }

  if (route === "GET /api/dashboard") {
    return buildDashboard();
  }

  if (route.match(/^POST \/api\/low-stock\/[^/]+\/ignore$/)) {
    return {};
  }

  if (route === "GET /api/parts") {
    const db = loadDb();
    return { parts: db.parts };
  }

  if (route === "POST /api/parts") {
    const db = loadDb();
    const part = {
      id: generateId("part"),
      code: str(body.code) || generateNextNo("BJ"),
      name: str(body.name) || "新配件",
      weight: body.weight ?? null,
      imageUrl: body.imageUrl ?? null,
      specification: body.specification ?? null,
      remark: body.remark ?? null,
      currentStock: num(body.currentStock),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.parts.push(part);
    recalcStock(db);
    saveDb(db);
    return { part };
  }

  if (route.match(/^PUT \/api\/parts\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const part = findById(db.parts, id);
    if (!part) throw new Error("配件不存在");
    Object.assign(part, body, { updatedAt: new Date().toISOString() });
    recalcStock(db);
    saveDb(db);
    return { part };
  }

  if (route.match(/^DELETE \/api\/parts\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.parts = removeById(db.parts, id);
    recalcStock(db);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/products") {
    const db = loadDb();
    return { products: db.products };
  }

  if (route === "POST /api/products") {
    const db = loadDb();
    const product = {
      id: generateId("prod"),
      code: str(body.code) || generateNextNo("CP"),
      name: str(body.name) || "新产品",
      imageUrl: body.imageUrl ?? null,
      remark: body.remark ?? null,
      bomItems: body.bomItems || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.products.push(product);
    saveDb(db);
    return { product };
  }

  if (route.match(/^PUT \/api\/products\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const product = findById(db.products, id);
    if (!product) throw new Error("产品不存在");
    Object.assign(product, body, { updatedAt: new Date().toISOString() });
    saveDb(db);
    return { product };
  }

  if (route.match(/^DELETE \/api\/products\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.products = removeById(db.products, id);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/stores") {
    const db = loadDb();
    const status = query.get("status");
    let stores = db.stores;
    if (status === "active") stores = stores.filter((s) => s.enabled !== false);
    return { stores };
  }

  if (route === "POST /api/stores") {
    const db = loadDb();
    const store = {
      id: generateId("store"),
      name: str(body.name) || "新店铺",
      remark: body.remark ?? null,
      enabled: body.enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.stores.push(store);
    saveDb(db);
    return { store };
  }

  if (route.match(/^PUT \/api\/stores\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const store = findById(db.stores, id);
    if (!store) throw new Error("店铺不存在");
    Object.assign(store, body, { updatedAt: new Date().toISOString() });
    saveDb(db);
    return { store };
  }

  if (route.match(/^PUT \/api\/stores\/[^/]+\/products$/)) {
    return {};
  }

  if (route.match(/^DELETE \/api\/stores\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.stores = removeById(db.stores, id);
    saveDb(db);
    return {};
  }

  if (route.match(/^GET \/api\/stores\/[^/]+\/products$/)) {
    const db = loadDb();
    return { products: db.products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl, remark: p.remark })) };
  }

  if (route === "GET /api/purchase-orders") {
    const db = loadDb();
    return { purchaseOrders: db.purchaseOrders };
  }

  if (route === "POST /api/purchase-orders") {
    const db = loadDb();
    const partId = str(body.partId);
    const order = {
      id: generateId("po"),
      orderNo: str(body.orderNo) || generateNextNo("PO"),
      logisticsNo: body.logisticsNo ?? null,
      partId,
      partCode: getPartCode(db, partId),
      partName: getPartName(db, partId),
      orderQuantity: num(body.orderQuantity),
      inboundQuantity: 0,
      status: str(body.status) || "已下单",
      remark: body.remark ?? null,
      orderTime: str(body.orderTime) || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.purchaseOrders.push(order);
    db.purchaseReceipts.push({
      id: generateId("rc"),
      receiptNo: generateNextNo("RC"),
      purchaseOrderId: order.id,
      orderNo: order.orderNo,
      logisticsNo: order.logisticsNo,
      partCode: order.partCode,
      partName: order.partName,
      purchaseQuantity: order.orderQuantity,
      inboundQuantity: 0,
      status: order.status,
      remark: order.remark,
      inboundTime: "",
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
    recalcStock(db);
    saveDb(db);
    return { purchaseOrder: order };
  }

  if (route.match(/^PUT \/api\/purchase-orders\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const order = findById(db.purchaseOrders, id);
    if (!order) throw new Error("采购订单不存在");
    Object.assign(order, body, { updatedAt: new Date().toISOString() });
    order.partCode = getPartCode(db, str(order.partId));
    order.partName = getPartName(db, str(order.partId));
    const receipt = db.purchaseReceipts.find((r) => String(r.purchaseOrderId) === id);
    if (receipt) {
      Object.assign(receipt, {
        orderNo: order.orderNo,
        logisticsNo: order.logisticsNo,
        partCode: order.partCode,
        partName: order.partName,
        purchaseQuantity: order.orderQuantity,
        status: order.status,
        updatedAt: order.updatedAt,
      });
    }
    recalcStock(db);
    saveDb(db);
    return { purchaseOrder: order };
  }

  if (route.match(/^DELETE \/api\/purchase-orders\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.purchaseOrders = removeById(db.purchaseOrders, id);
    db.purchaseReceipts = db.purchaseReceipts.filter((r) => String(r.purchaseOrderId) !== id);
    recalcStock(db);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/purchase-receipts") {
    const db = loadDb();
    let receipts = db.purchaseReceipts;
    const receiptState = query.get("receiptState");
    const status = query.get("status");
    if (status === "abnormal") {
      receipts = receipts.filter((r) => ["工厂缺货", "部分入库"].includes(String(r.status)));
    } else if (receiptState === "pending") {
      receipts = receipts.filter((r) => ["已下单", "在途", "工厂缺货", "部分入库"].includes(String(r.status)));
    } else if (receiptState === "received") {
      receipts = receipts.filter((r) => String(r.status) === "已入库");
    }
    if (query.get("status") && query.get("status") !== "abnormal") {
      receipts = receipts.filter((r) => String(r.status) === query.get("status"));
    }
    return { purchaseReceipts: receipts };
  }

  if (route.match(/^POST \/api\/purchase-receipts\/[^/]+\/receive$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const order = findById(db.purchaseOrders, id);
    if (!order) throw new Error("采购订单不存在");
    const quantity = num(body.inboundQuantity);
    const previousInbound = num(order.inboundQuantity);
    const inboundTotal = Math.min(num(order.orderQuantity), previousInbound + quantity);
    order.inboundQuantity = inboundTotal;
    order.status = inboundTotal >= num(order.orderQuantity) ? "已入库" : inboundTotal > 0 ? "部分入库" : str(body.status) || "在途";
    order.logisticsNo = body.logisticsNo ?? order.logisticsNo ?? null;

    const receipt = db.purchaseReceipts.find((r) => String(r.purchaseOrderId) === id);
    if (receipt) {
      receipt.inboundQuantity = inboundTotal;
      receipt.status = order.status;
      receipt.logisticsNo = order.logisticsNo;
      receipt.inboundTime = str(body.inboundTime) || new Date().toISOString();
    }
    recalcStock(db);
    saveDb(db);
    return { purchaseOrder: order };
  }

  if (route.match(/^DELETE \/api\/purchase-receipts\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.purchaseReceipts = removeById(db.purchaseReceipts, id);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/other-inbounds") {
    const db = loadDb();
    return { otherInbounds: db.otherInbounds };
  }

  if (route === "POST /api/other-inbounds") {
    const db = loadDb();
    const partId = str(body.partId);
    const inbound = {
      id: generateId("oi"),
      inboundSource: str(body.inboundSource),
      partId,
      partCode: getPartCode(db, partId),
      partName: getPartName(db, partId),
      inboundQuantity: num(body.inboundQuantity),
      inboundTime: str(body.inboundTime) || new Date().toISOString(),
      operatorName: str(body.operatorName) || "管理员",
      remark: body.remark ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.otherInbounds.push(inbound);
    recalcStock(db);
    saveDb(db);
    return { otherInbound: inbound };
  }

  if (route.match(/^DELETE \/api\/other-inbounds\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.otherInbounds = removeById(db.otherInbounds, id);
    recalcStock(db);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/stock") {
    const db = loadDb();
    return { stock: db.stock };
  }

  if (route.match(/^PUT \/api\/stock\/[^/]+\/remark$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const row = db.stock.find((s) => String(s.partId) === id);
    if (row) {
      row.remark = body.remark ?? null;
      row.updatedAt = new Date().toISOString();
      saveDb(db);
    }
    return {};
  }

  if (route === "GET /api/stocktakes") {
    const db = loadDb();
    let rows = db.stocktakes;
    const partCode = query.get("partCode");
    const partName = query.get("partName");
    const stocktakeDate = query.get("stocktakeDate");
    const remark = query.get("remark");
    if (partCode) rows = rows.filter((r) => String(r.partCode).toLowerCase().includes(partCode.toLowerCase()));
    if (partName) rows = rows.filter((r) => String(r.partName).toLowerCase().includes(partName.toLowerCase()));
    if (stocktakeDate) rows = rows.filter((r) => String(r.stocktakeTime).startsWith(stocktakeDate));
    if (remark) rows = rows.filter((r) => String(r.remark).toLowerCase().includes(remark.toLowerCase()));
    return { stocktakes: rows };
  }

  if (route === "POST /api/stocktakes") {
    const db = loadDb();
    const partId = str(body.partId);
    const stocktake = {
      id: generateId("st"),
      partId,
      partCode: getPartCode(db, partId),
      partName: getPartName(db, partId),
      actualQuantity: num(body.actualQuantity),
      remark: body.remark ?? null,
      stocktakeTime: str(body.stocktakeTime) || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.stocktakes.push(stocktake);
    const stockRow = db.stock.find((s) => String(s.partId) === partId);
    if (stockRow) {
      stockRow.lastStocktakeAt = stocktake.stocktakeTime;
    }
    recalcStock(db);
    saveDb(db);
    return { stocktake };
  }

  if (route.match(/^DELETE \/api\/stocktakes\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.stocktakes = removeById(db.stocktakes, id);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/outbound-plans") {
    const db = loadDb();
    return { outboundPlans: db.outboundPlans };
  }

  if (route === "POST /api/outbound-plans") {
    const db = loadDb();
    const items = (body.items as Array<{ productId: string; preOutboundQuantity: number }> | undefined) || [];
    const planItems: OutboundPlanItem[] = items.map((item) => ({
      id: generateId("planitem"),
      planId: "",
      productId: str(item.productId),
      productCode: getProductCode(db, str(item.productId)),
      productName: getProductName(db, str(item.productId)),
      productImageUrl: null,
      preOutboundQuantity: num(item.preOutboundQuantity),
      shippedQuantity: 0,
      cancelledQuantity: 0,
      remainingQuantity: num(item.preOutboundQuantity),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const plan: OutboundPlan = {
      id: generateId("plan"),
      planNo: generateNextNo("OUT"),
      storeId: str(body.storeId),
      storeName: getStoreName(db, str(body.storeId)),
      operatorName: str(body.operatorName),
      status: "预出库",
      remark: (body.remark as string | null) ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: planItems,
    };
    plan.items.forEach((item) => (item.planId = plan.id));
    db.outboundPlans.push(plan);
    recalcStock(db);
    saveDb(db);
    return { outboundPlan: plan };
  }

  if (route.match(/^DELETE \/api\/outbound-plans\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.outboundPlans = db.outboundPlans.filter((p) => p.id !== id);
    recalcStock(db);
    saveDb(db);
    return {};
  }

  if (route.match(/^POST \/api\/outbound-plans\/[^/]+\/shipments$/)) {
    const db = loadDb();
    const planId = pathPart(url.pathname, 3);
    const plan = db.outboundPlans.find((p) => p.id === planId);
    if (!plan) throw new Error("出库计划不存在");
    const shipmentItems: OutboundShipmentItem[] = [];
    const bodyItems = (body.items as Array<{ planItemId: string; shippedQuantity: number; finishRemaining: boolean }> | undefined) || [];
    for (const item of bodyItems) {
      const planItem = plan.items.find((i) => i.id === str(item.planItemId));
      if (!planItem) continue;
      const qty = item.finishRemaining ? planItem.remainingQuantity : Math.min(num(item.shippedQuantity), planItem.remainingQuantity);
      if (qty <= 0) continue;
      planItem.shippedQuantity += qty;
      planItem.remainingQuantity -= qty;
      shipmentItems.push({
        id: generateId("shipitem"),
        shipmentId: "",
        planItemId: str(item.planItemId),
        productId: planItem.productId,
        productCode: planItem.productCode,
        productName: planItem.productName,
        shippedQuantity: qty,
        beforeRemainingQuantity: planItem.remainingQuantity + qty,
        afterRemainingQuantity: planItem.remainingQuantity,
        finishRemaining: Boolean(item.finishRemaining),
        createdAt: new Date().toISOString(),
      });
    }
    plan.status = plan.items.every((i) => i.remainingQuantity <= 0) ? "已出库" : "部分发货";
    const shipment: OutboundShipment = {
      id: generateId("ship"),
      shipmentNo: generateNextNo("SHIP"),
      planId,
      status: "待审核",
      outboundTime: str(body.outboundTime) || new Date().toISOString(),
      operatorName: str(body.operatorName),
      shipmentType: (body.shipmentType as string | null) ?? null,
      goodsId: (body.goodsId as string | null) ?? null,
      pickupNo: (body.pickupNo as string | null) ?? null,
      cartonCount: (body.cartonCount as number | null) ?? null,
      weight: (body.weight as number | null) ?? null,
      dimensions: (body.dimensions as string | null) ?? null,
      remark: (body.remark as string | null) ?? null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: shipmentItems,
    };
    shipment.items.forEach((i) => (i.shipmentId = shipment.id));
    db.outboundShipments.push(shipment);
    recalcStock(db);
    saveDb(db);
    return { outboundShipment: shipment };
  }

  if (route === "GET /api/stock-locks") {
    const db = loadDb();
    return { stockLocks: db.stock.filter((s) => Number(s.lockedQuantity) > 0).map((s) => ({ partId: s.partId, partCode: s.partCode, partName: s.partName, currentStock: s.quantity, lockedQuantity: s.lockedQuantity, availableQuantity: s.availableQuantity })) };
  }

  if (route === "GET /api/outbound-operators") {
    const db = loadDb();
    let operators = db.outboundOperators;
    if (query.get("status") === "active") operators = operators.filter((o) => o.enabled !== false);
    return { outboundOperators: operators };
  }

  if (route === "POST /api/outbound-operators") {
    const db = loadDb();
    const operator = { id: generateId("op"), name: str(body.name), enabled: body.enabled !== false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.outboundOperators.push(operator);
    saveDb(db);
    return { outboundOperator: operator };
  }

  if (route.match(/^PUT \/api\/outbound-operators\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const operator = findById(db.outboundOperators, id);
    if (!operator) throw new Error("出库人员不存在");
    Object.assign(operator, body, { updatedAt: new Date().toISOString() });
    saveDb(db);
    return { outboundOperator: operator };
  }

  if (route.match(/^DELETE \/api\/outbound-operators\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.outboundOperators = removeById(db.outboundOperators, id);
    saveDb(db);
    return {};
  }

  if (route === "GET /api/outbound-shipments") {
    const db = loadDb();
    const status = query.get("status");
    let shipments = db.outboundShipments;
    if (status) shipments = shipments.filter((s) => s.status === status);
    return { outboundShipments: shipments };
  }

  if (route.match(/^POST \/api\/outbound-shipments\/[^/]+\/approve$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const shipment = db.outboundShipments.find((s) => s.id === id);
    if (!shipment) throw new Error("出库批次不存在");
    shipment.status = "已出库";
    shipment.reviewedBy = "admin";
    shipment.reviewedAt = new Date().toISOString();
    recalcStock(db);
    saveDb(db);
    return { outboundShipment: { ...shipment, warnings: [] } };
  }

  if (route === "GET /api/users") {
    const db = loadDb();
    return { users: db.users };
  }

  if (route === "POST /api/users") {
    const db = loadDb();
    const user = { id: generateId("user"), username: str(body.username), displayName: str(body.displayName), role: str(body.role) || "operator", enabled: body.enabled !== false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.users.push(user);
    saveDb(db);
    return { user };
  }

  if (route.match(/^PUT \/api\/users\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    const user = findById(db.users, id);
    if (!user) throw new Error("用户不存在");
    Object.assign(user, body, { updatedAt: new Date().toISOString() });
    saveDb(db);
    return { user };
  }

  if (route.match(/^DELETE \/api\/users\/[^/]+$/)) {
    const db = loadDb();
    const id = pathPart(url.pathname, 3);
    db.users = removeById(db.users, id);
    saveDb(db);
    return {};
  }

  if (route.match(/^GET \/api\/users\/[^/]+\/stores$/)) {
    return { storeIds: [] };
  }

  if (route.match(/^PUT \/api\/users\/[^/]+\/stores$/)) {
    return {};
  }

  if (route === "GET /api/audit-logs") {
    const db = loadDb();
    const page = Number(query.get("page") || 1);
    const pageSize = Number(query.get("pageSize") || 20);
    const total = db.auditLogs.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return { auditLogs: db.auditLogs.slice(start, start + pageSize), pagination: { page, pageSize, total, totalPages } };
  }

  if (route === "GET /api/history") {
    const db = loadDb();
    return { from: "", to: "", purchaseOrders: db.purchaseOrders, purchaseReceipts: db.purchaseReceipts, otherInbounds: db.otherInbounds, outboundRecords: db.outboundShipments, stocktakes: db.stocktakes };
  }

  if (route.match(/^POST \/api\/uploads\/.*$/)) {
    return { imageUrl: `https://placehold.co/80x80?text=${encodeURIComponent(String(init?.body || "img"))}` };
  }

  throw new Error(`未模拟的接口: ${route}`);
}

function pathPart(path: string, index: number) {
  return path.split("/")[index] as string;
}

function buildDashboard() {
  const db = loadDb();
  const pendingInboundReceipts = db.purchaseReceipts.filter((r) => ["已下单", "在途", "工厂缺货", "部分入库"].includes(String(r.status)));
  const abnormalPurchaseOrders = db.purchaseReceipts.filter((r) => ["工厂缺货", "部分入库"].includes(String(r.status)));
  return {
    pendingInboundCount: pendingInboundReceipts.length,
    pendingInboundReceipts,
    abnormalPurchaseOrderCount: abnormalPurchaseOrders.length,
    abnormalPurchaseOrders,
    lowStockParts: db.stock.filter((s) => s.isLowStock).map((s) => ({ partId: s.partId, partName: s.partName, currentStock: s.quantity, averageDailyUsage: s.averageDailyUsage, remainingDays: s.remainingDays })),
  };
}

function recalcStock(db: ReturnType<typeof loadDb>) {
  for (const row of db.stock) {
    const inbound = db.purchaseReceipts
      .filter((r) => String(r.partCode) === String(row.partCode))
      .reduce((sum, r) => sum + Number(r.inboundQuantity), 0);
    const other = db.otherInbounds
      .filter((o) => String(o.partCode) === String(row.partCode))
      .reduce((sum, o) => sum + Number(o.inboundQuantity), 0);
    const outboundLocked = 0;
    const quantity = Math.max(0, Number(row.quantity) + inbound + other - outboundLocked);
    (row.quantity as number) = quantity;
    (row.availableQuantity as number) = Math.max(0, quantity - Number(row.lockedQuantity));
    (row.isLowStock as boolean) = quantity <= 20;
    (row.purchaseInTransit as number) = db.purchaseOrders
      .filter((o) => String(o.partCode) === String(row.partCode) && !["已入库", "已取消"].includes(String(o.status)))
      .reduce((sum, o) => sum + Number(o.orderQuantity) - Number(o.inboundQuantity), 0);
    (row.updatedAt as string) = new Date().toISOString();
  }
}

function simulateLatency() {
  return new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 120));
}
