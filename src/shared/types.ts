export type PurchaseStatus = "已下单" | "在途" | "工厂缺货" | "已入库" | "部分入库";
export type UserRole = "admin" | "operator" | "purchaser" | "inbound" | "outbound" | "operation";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Part {
  id: string;
  code: string;
  name: string;
  weight: number | null;
  imageUrl: string | null;
  specification: string | null;
  remark: string | null;
  currentStock?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreProduct {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  remark: string | null;
}

export interface OutboundOperator {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type OutboundPlanStatus = "预出库" | "部分发货" | "已出库" | "已取消";
export type OutboundShipmentStatus = "待审核" | "已出库";

export interface OutboundPlanItem {
  id: string;
  planId: string;
  productId: string;
  productCode: string;
  productName: string;
  productImageUrl: string | null;
  preOutboundQuantity: number;
  shippedQuantity: number;
  cancelledQuantity: number;
  remainingQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundPlan {
  id: string;
  planNo: string;
  storeId: string;
  storeName: string;
  operatorName: string;
  status: OutboundPlanStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  items: OutboundPlanItem[];
}

export interface OutboundShipmentItem {
  id: string;
  shipmentId: string;
  planItemId: string;
  productId: string;
  productCode: string;
  productName: string;
  shippedQuantity: number;
  beforeRemainingQuantity: number;
  afterRemainingQuantity: number;
  finishRemaining: boolean;
  createdAt: string;
}

export interface OutboundShipment {
  id: string;
  shipmentNo: string;
  planId: string;
  status: OutboundShipmentStatus;
  outboundTime: string;
  operatorName: string;
  shipmentType: string | null;
  goodsId: string | null;
  pickupNo: string | null;
  cartonCount: number | null;
  weight: number | null;
  dimensions: string | null;
  remark: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OutboundShipmentItem[];
}

export interface LockedPartStock {
  partId: string;
  partCode: string;
  partName: string;
  currentStock: number;
  lockedQuantity: number;
  availableQuantity: number;
}

export interface ProductBomItem {
  productId: string;
  partId: string;
  quantity: number;
}

export interface PartStock {
  partId: string;
  quantity: number;
  remark?: string | null;
  lastStocktakeAt?: string | null;
}

export interface NamedPartStock {
  partId: string;
  partName: string;
  quantity: number;
}

export interface PartUsage {
  partId: string;
  quantity: number;
}

export interface LowStockPart {
  partId: string;
  partName: string;
  currentStock: number;
  averageDailyUsage: number;
  remainingDays: number;
}
