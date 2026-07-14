// 前端演示数据层：用 localStorage 持久化模拟后端数据库
import type { AnyRow } from "./types";
import type { OutboundPlan, OutboundShipment, SessionUser, UserRole } from "../shared/types";

const STORAGE_KEY = "berni-inventory-mock";

export interface MockDb {
  currentUser: SessionUser | null;
  users: AnyRow[];
  parts: AnyRow[];
  products: AnyRow[];
  stores: AnyRow[];
  purchaseOrders: AnyRow[];
  purchaseReceipts: AnyRow[];
  otherInbounds: AnyRow[];
  outboundPlans: OutboundPlan[];
  outboundShipments: OutboundShipment[];
  stocktakes: AnyRow[];
  stock: AnyRow[];
  outboundOperators: AnyRow[];
  auditLogs: AnyRow[];
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return nowIso().slice(0, 10);
}

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const initialParts: AnyRow[] = [
  { id: "part_001", code: "BJ-001", name: "电机 12V", weight: 2.5, imageUrl: null, specification: "12V/100W", remark: "常用", currentStock: 120, createdAt: "2025-01-15T08:00:00.000Z", updatedAt: nowIso() },
  { id: "part_002", code: "BJ-002", name: "控制器主板", weight: 0.8, imageUrl: null, specification: "V2.3", remark: "", currentStock: 45, createdAt: "2025-01-15T08:00:00.000Z", updatedAt: nowIso() },
  { id: "part_003", code: "BJ-003", name: "锂电池组 48V", weight: 5.2, imageUrl: null, specification: "48V20Ah", remark: "", currentStock: 8, createdAt: "2025-02-10T08:00:00.000Z", updatedAt: nowIso() },
  { id: "part_004", code: "BJ-004", name: "轮胎 16寸", weight: 3, imageUrl: null, specification: "16x2.5", remark: "", currentStock: 200, createdAt: "2025-01-20T08:00:00.000Z", updatedAt: nowIso() },
  { id: "part_005", code: "BJ-005", name: "刹车片", weight: 0.3, imageUrl: null, specification: "通用型", remark: "", currentStock: 15, createdAt: "2025-03-05T08:00:00.000Z", updatedAt: nowIso() },
];

const initialProducts: AnyRow[] = [
  { id: "prod_001", code: "CP-001", name: "电动滑板车 A1", imageUrl: null, remark: "", bomItems: [{ partId: "part_001", quantity: 1 }, { partId: "part_002", quantity: 1 }, { partId: "part_003", quantity: 1 }, { partId: "part_004", quantity: 2 }], createdAt: "2025-01-15T08:00:00.000Z", updatedAt: nowIso() },
  { id: "prod_002", code: "CP-002", name: "电动自行车 B2", imageUrl: null, remark: "", bomItems: [{ partId: "part_001", quantity: 1 }, { partId: "part_003", quantity: 1 }, { partId: "part_004", quantity: 2 }, { partId: "part_005", quantity: 2 }], createdAt: "2025-02-01T08:00:00.000Z", updatedAt: nowIso() },
];

const initialStores: AnyRow[] = [
  { id: "store_001", name: "京东旗舰店", remark: "", enabled: true, createdAt: "2025-01-10T08:00:00.000Z", updatedAt: nowIso() },
  { id: "store_002", name: "天猫旗舰店", remark: "", enabled: true, createdAt: "2025-01-10T08:00:00.000Z", updatedAt: nowIso() },
  { id: "store_003", name: "抖音小店", remark: "", enabled: false, createdAt: "2025-03-01T08:00:00.000Z", updatedAt: nowIso() },
];

const initialOutboundOperators: AnyRow[] = [
  { id: "op_001", name: "张发货", enabled: true, createdAt: "2025-01-10T08:00:00.000Z", updatedAt: nowIso() },
  { id: "op_002", name: "李物流", enabled: true, createdAt: "2025-01-15T08:00:00.000Z", updatedAt: nowIso() },
];

const initialPurchaseOrders: AnyRow[] = [
  { id: "po_001", orderNo: "PO-20250701-001", logisticsNo: "SF1234567890", partId: "part_003", partCode: "BJ-003", partName: "锂电池组 48V", orderQuantity: 50, inboundQuantity: 42, status: "在途", remark: "", orderTime: "2025-07-01T10:00:00.000Z", createdAt: "2025-07-01T10:00:00.000Z", updatedAt: nowIso() },
  { id: "po_002", orderNo: "PO-20250705-002", logisticsNo: "", partId: "part_005", partCode: "BJ-005", partName: "刹车片", orderQuantity: 100, inboundQuantity: 0, status: "已下单", remark: "", orderTime: "2025-07-05T09:00:00.000Z", createdAt: "2025-07-05T09:00:00.000Z", updatedAt: nowIso() },
  { id: "po_003", orderNo: "PO-20250620-003", logisticsNo: "JD9876543210", partId: "part_002", partCode: "BJ-002", partName: "控制器主板", orderQuantity: 80, inboundQuantity: 80, status: "已入库", remark: "", orderTime: "2025-06-20T08:00:00.000Z", createdAt: "2025-06-20T08:00:00.000Z", updatedAt: nowIso() },
];

const initialPurchaseReceipts: AnyRow[] = [
  { id: "rc_001", receiptNo: "RC-20250701-001", purchaseOrderId: "po_001", orderNo: "PO-20250701-001", logisticsNo: "SF1234567890", partCode: "BJ-003", partName: "锂电池组 48V", purchaseQuantity: 50, inboundQuantity: 42, status: "在途", remark: "", inboundTime: "2025-07-01T10:00:00.000Z", createdAt: "2025-07-01T10:00:00.000Z", updatedAt: nowIso() },
  { id: "rc_002", receiptNo: "RC-20250705-001", purchaseOrderId: "po_002", orderNo: "PO-20250705-002", logisticsNo: "", partCode: "BJ-005", partName: "刹车片", purchaseQuantity: 100, inboundQuantity: 0, status: "已下单", remark: "", inboundTime: "", createdAt: "2025-07-05T09:00:00.000Z", updatedAt: nowIso() },
  { id: "rc_003", receiptNo: "RC-20250620-001", purchaseOrderId: "po_003", orderNo: "PO-20250620-003", logisticsNo: "JD9876543210", partCode: "BJ-002", partName: "控制器主板", purchaseQuantity: 80, inboundQuantity: 80, status: "已入库", remark: "", inboundTime: "2025-06-20T08:00:00.000Z", createdAt: "2025-06-20T08:00:00.000Z", updatedAt: nowIso() },
];

const initialOtherInbounds: AnyRow[] = [
  { id: "oi_001", inboundSource: "客户退货", partId: "part_004", partCode: "BJ-004", partName: "轮胎 16寸", inboundQuantity: 10, inboundTime: "2025-07-10T14:00:00.000Z", operatorName: "管理员", remark: "", createdAt: "2025-07-10T14:00:00.000Z", updatedAt: nowIso() },
];

const initialOutboundPlans: OutboundPlan[] = [
  {
    id: "plan_001",
    planNo: "OUT-20250710-001",
    storeId: "store_001",
    storeName: "京东旗舰店",
    operatorName: "张发货",
    status: "预出库",
    remark: "",
    createdAt: "2025-07-10T08:00:00.000Z",
    updatedAt: nowIso(),
    items: [
      { id: "planitem_001", planId: "plan_001", productId: "prod_001", productCode: "CP-001", productName: "电动滑板车 A1", productImageUrl: null, preOutboundQuantity: 5, shippedQuantity: 0, cancelledQuantity: 0, remainingQuantity: 5, createdAt: "2025-07-10T08:00:00.000Z", updatedAt: nowIso() },
      { id: "planitem_002", planId: "plan_001", productId: "prod_002", productCode: "CP-002", productName: "电动自行车 B2", productImageUrl: null, preOutboundQuantity: 3, shippedQuantity: 0, cancelledQuantity: 0, remainingQuantity: 3, createdAt: "2025-07-10T08:00:00.000Z", updatedAt: nowIso() },
    ],
  },
];

const initialOutboundShipments: OutboundShipment[] = [];

const initialStocktakes: AnyRow[] = [
  { id: "st_001", partId: "part_001", partCode: "BJ-001", partName: "电机 12V", actualQuantity: 118, remark: "", stocktakeTime: "2025-07-01T10:00:00.000Z", createdAt: "2025-07-01T10:00:00.000Z", updatedAt: nowIso() },
];

const initialStock: AnyRow[] = initialParts.map((part) => ({
  partId: part.id,
  partCode: part.code,
  partName: part.name,
  specification: part.specification,
  weight: part.weight,
  quantity: Number(part.currentStock),
  lockedQuantity: part.id === "part_001" ? 20 : 0,
  availableQuantity: Number(part.currentStock) - (part.id === "part_001" ? 20 : 0),
  purchaseInTransit: part.id === "part_003" ? 8 : part.id === "part_005" ? 100 : 0,
  outbound7Days: part.id === "part_004" ? 30 : 0,
  outbound14Days: part.id === "part_004" ? 55 : 0,
  remark: part.remark,
  lastStocktakeAt: part.id === "part_001" ? "2025-07-01T10:00:00.000Z" : null,
  isLowStock: Number(part.currentStock) <= 20,
  averageDailyUsage: part.id === "part_003" ? 2 : part.id === "part_005" ? 5 : 0,
  remainingDays: part.id === "part_003" ? 4 : part.id === "part_005" ? 3 : 999,
  createdAt: part.createdAt,
  updatedAt: part.updatedAt,
}));

const initialAuditLogs: AnyRow[] = [
  { id: "audit_001", actorUsername: "admin", action: "登录", entityType: "auth", entityId: "", details: "", createdAt: nowIso() },
];

const initialUsers: AnyRow[] = [
  { id: "user_admin", username: "admin", displayName: "系统管理员", role: "admin", enabled: true, createdAt: "2025-01-01T08:00:00.000Z", updatedAt: nowIso() },
  { id: "user_001", username: "caigou", displayName: "采购人员", role: "purchaser", enabled: true, createdAt: "2025-01-02T08:00:00.000Z", updatedAt: nowIso() },
  { id: "user_002", username: "chuku", displayName: "出库人员", role: "outbound", enabled: true, createdAt: "2025-01-02T08:00:00.000Z", updatedAt: nowIso() },
];

export function createInitialDb(): MockDb {
  return {
    currentUser: null,
    users: initialUsers,
    parts: initialParts,
    products: initialProducts,
    stores: initialStores,
    purchaseOrders: initialPurchaseOrders,
    purchaseReceipts: initialPurchaseReceipts,
    otherInbounds: initialOtherInbounds,
    outboundPlans: initialOutboundPlans,
    outboundShipments: initialOutboundShipments,
    stocktakes: initialStocktakes,
    stock: initialStock,
    outboundOperators: initialOutboundOperators,
    auditLogs: initialAuditLogs,
  };
}

export function loadDb(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as MockDb;
    }
  } catch {
    // ignore
  }
  const db = createInitialDb();
  saveDb(db);
  return db;
}

export function saveDb(db: MockDb) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

export function getCurrentUser(): SessionUser | null {
  const db = loadDb();
  return db.currentUser;
}

export function setCurrentUser(user: SessionUser | null) {
  const db = loadDb();
  db.currentUser = user;
  saveDb(db);
}

export function findById<T extends AnyRow>(items: T[], id: string) {
  return items.find((item) => String(item.id) === id);
}

export function removeById<T extends AnyRow>(items: T[], id: string) {
  return items.filter((item) => String(item.id) !== id);
}

export function generateNextNo(prefix: string) {
  const date = todayIso().replace(/-/g, "");
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${date}-${suffix}`;
}

export function getPartName(db: MockDb, partId: string) {
  const part = findById(db.parts, partId);
  return part ? String(part.name) : "";
}

export function getPartCode(db: MockDb, partId: string) {
  const part = findById(db.parts, partId);
  return part ? String(part.code) : "";
}

export function getProductName(db: MockDb, productId: string) {
  const product = findById(db.products, productId);
  return product ? String(product.name) : "";
}

export function getProductCode(db: MockDb, productId: string) {
  const product = findById(db.products, productId);
  return product ? String(product.code) : "";
}

export function getStoreName(db: MockDb, storeId: string) {
  const store = findById(db.stores, storeId);
  return store ? String(store.name) : "";
}

export { generateId, nowIso };
