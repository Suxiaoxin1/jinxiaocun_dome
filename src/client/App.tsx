import type { ComponentType } from "react";
import { useState } from "react";
import type { SessionUser } from "../shared/types";
import { apiPost } from "./api";
import DashboardPage from "./pages/DashboardPage";
import HistoryPage from "./pages/HistoryPage";
import LoginPage from "./pages/LoginPage";
import OutboundPage from "./pages/OutboundPage";
import OtherInboundPage from "./pages/OtherInboundPage";
import PartsPage from "./pages/PartsPage";
import ProductsPage from "./pages/ProductsPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseReceiptsPage from "./pages/PurchaseReceiptsPage";
import StockPage from "./pages/StockPage";
import StocktakePage from "./pages/StocktakePage";
import StoresPage from "./pages/StoresPage";
import type { PageKey, PageProps } from "./types";

const pages: Array<[PageKey, string]> = [
  ["dashboard", "首页"],
  ["parts", "配件管理"],
  ["products", "产品组装"],
  ["purchaseOrders", "采购订单"],
  ["purchaseReceipts", "采购入库"],
  ["otherInbound", "其它入库"],
  ["stores", "店铺管理"],
  ["outbound", "出库管理"],
  ["stock", "库存查看"],
  ["stocktake", "盘点管理"],
  ["history", "历史数据"],
];

const pageComponents: Record<PageKey, ComponentType<PageProps>> = {
  dashboard: DashboardPage,
  parts: PartsPage,
  products: ProductsPage,
  purchaseOrders: PurchaseOrdersPage,
  purchaseReceipts: PurchaseReceiptsPage,
  otherInbound: OtherInboundPage,
  stores: StoresPage,
  outbound: OutboundPage,
  stock: StockPage,
  stocktake: StocktakePage,
  history: HistoryPage,
};

export default function App({ initialUser = null }: { initialUser?: SessionUser | null }) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [page, setPage] = useState<PageKey>("dashboard");
  const [pageParams, setPageParams] = useState<Record<string, string>>({});
  const CurrentPage = pageComponents[page];

  async function handleLogout() {
    await apiPost("/api/auth/logout", {});
    setUser(null);
    setPage("dashboard");
    setPageParams({});
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const navigate = (nextPage: PageKey, params: Record<string, string> = {}) => {
    setPage(nextPage);
    setPageParams(params);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <h1>伯尼库存管理系统</h1>
          <p>{user.displayName}</p>
          <p>{user.role === "admin" ? "管理员" : "普通操作员"}</p>
        </div>
        <nav className="nav-stack" aria-label="主导航">
          {pages.map(([key, label]) => (
            <button key={key} className={page === key ? "active" : ""} type="button" onClick={() => navigate(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="ghost-button" type="button" onClick={() => void handleLogout()}>
          退出登录
        </button>
      </aside>
      <main className="content">
        <CurrentPage navigate={navigate} params={pageParams} currentUser={user} />
      </main>
    </div>
  );
}

export { App };
