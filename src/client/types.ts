import type { SessionUser } from "../shared/types";

export type PageKey =
  | "dashboard"
  | "parts"
  | "products"
  | "purchaseOrders"
  | "purchaseReceipts"
  | "otherInbound"
  | "stores"
  | "outbound"
  | "stock"
  | "stocktake"
  | "history";

export type AnyRow = Record<string, unknown>;

export interface PageProps {
  navigate: (page: PageKey, params?: Record<string, string>) => void;
  params: Record<string, string>;
  currentUser: SessionUser;
}
