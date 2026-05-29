export type PartStatus = "在售" | "不在售";
export type PurchaseStatus = "缺货" | "在途" | "已签收" | "部分签收";
export type UserRole = "admin" | "operator";

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
  status: PartStatus;
  weight: number | null;
  imageUrl: string | null;
  specification: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
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
