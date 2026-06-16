import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "../shared/types";
import { apiGet, apiPost, setUnauthorizedHandler } from "./api";
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
import SystemPage from "./pages/SystemPage";
import type { PageKey, PageProps } from "./types";

const pageLabels: Record<PageKey, string> = {
  dashboard: "首页",
  parts: "配件管理",
  products: "产品组装",
  purchaseOrders: "采购订单",
  purchaseReceipts: "采购入库",
  otherInbound: "其它入库",
  stores: "店铺管理",
  outbound: "出库管理",
  stock: "库存查看",
  stocktake: "盘点管理",
  history: "历史数据",
  system: "系统管理",
};

const navSections: Array<{ title: string; icon: string; pages: PageKey[] }> = [
  { title: "采购管理", icon: "A", pages: ["purchaseOrders", "purchaseReceipts"] },
  { title: "库存管理", icon: "▣", pages: ["stock", "otherInbound", "outbound", "stocktake", "history"] },
  { title: "产品管理", icon: "P", pages: ["parts", "products", "stores"] },
];

const defaultExpandedNavGroups = Object.fromEntries(["erp", ...navSections.map((section) => section.title)].map((key) => [key, true]));
const operatorPageKeys = new Set<PageKey>(["outbound", "stock", "stocktake"]);

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
  system: SystemPage,
};

export default function App({ initialUser = null }: { initialUser?: SessionUser | null }) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [page, setPage] = useState<PageKey>(initialUser ? defaultPageForUser(initialUser) : "dashboard");
  const [pageParams, setPageParams] = useState<Record<string, string>>({});
  const [expandedNavGroups, setExpandedNavGroups] = useState<Record<string, boolean>>(defaultExpandedNavGroups);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 960);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fontLarge, setFontLarge] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const menuSearchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setPage("dashboard");
      setPageParams({});
      setShowUserMenu(false);
      setShowTagMenu(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (initialUser) {
      return;
    }
    let cancelled = false;
    apiGet<{ user: SessionUser }>("/api/auth/me")
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setPage(defaultPageForUser(data.user));
        setExpandedNavGroups(defaultExpandedNavGroups);
      })
      .catch(() => {
        // No active server session; stay on the login page.
      });
    return () => {
      cancelled = true;
    };
  }, [initialUser]);

  async function handleLogout() {
    await apiPost("/api/auth/logout", {});
    setUser(null);
    setPage("dashboard");
    setPageParams({});
    setShowUserMenu(false);
  }

  function handleLogin(nextUser: SessionUser) {
    setUser(nextUser);
    setPage(defaultPageForUser(nextUser));
    setPageParams({});
    setExpandedNavGroups(defaultExpandedNavGroups);
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const visiblePageOrder = user.role === "admin" ? Object.keys(pageLabels) as PageKey[] : Array.from(operatorPageKeys);
  const visiblePageKeys = new Set<PageKey>(visiblePageOrder);
  const currentPage = visiblePageKeys.has(page) ? page : defaultPageForUser(user);
  const CurrentPage = pageComponents[currentPage];
  const breadcrumb = breadcrumbForPage(currentPage);
  const visibleSections = navSections
    .map((section) => ({ ...section, pages: section.pages.filter((key) => visiblePageKeys.has(key)) }))
    .filter((section) => section.pages.length > 0);

  const navigate = (nextPage: PageKey, params: Record<string, string> = {}) => {
    if (!visiblePageKeys.has(nextPage)) {
      return;
    }
    setPage(nextPage);
    setPageParams(params);
    setExpandedNavGroups((current) => ({ ...current, [groupForPage(nextPage)]: true }));
    setSidebarCollapsed(typeof window !== "undefined" && window.innerWidth <= 960);
    setShowTagMenu(false);
    setShowUserMenu(false);
    setMenuSearch("");
  };

  const navigateSibling = (offset: number) => {
    const currentIndex = visiblePageOrder.indexOf(currentPage);
    if (currentIndex < 0 || visiblePageOrder.length === 0) {
      return;
    }
    const nextIndex = (currentIndex + offset + visiblePageOrder.length) % visiblePageOrder.length;
    navigate(visiblePageOrder[nextIndex]);
  };

  const isGroupExpanded = (key: string) => expandedNavGroups[key] ?? true;
  const toggleNavGroup = (key: string) => {
    setExpandedNavGroups((current) => ({ ...current, [key]: !(current[key] ?? true) }));
  };
  const isErpExpanded = isGroupExpanded("erp");
  const menuSearchResults = menuSearch.trim()
    ? visiblePageOrder.filter((key) => {
      const keyword = menuSearch.trim().toLowerCase();
      return pageLabels[key].toLowerCase().includes(keyword) || groupForPage(key).toLowerCase().includes(keyword);
    })
    : [];

  return (
    <div className={["app-shell", sidebarCollapsed ? "sidebar-collapsed" : "", fontLarge ? "font-large" : ""].filter(Boolean).join(" ")}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">伯</div>
          <h1>伯尼科技</h1>
        </div>
        <nav className="nav-stack" aria-label="主导航">
          <button
            className="menu-group-title"
            type="button"
            aria-label="ERP 系统"
            aria-expanded={isErpExpanded}
            onClick={() => toggleNavGroup("erp")}
          >
            <span className="menu-icon">E</span>
            ERP 系统
            <span className="menu-arrow">{isErpExpanded ? "⌄" : "›"}</span>
          </button>
          {user.role === "admin" && isErpExpanded ? (
            <>
              <button
                className={currentPage === "dashboard" ? "child active-child" : "child"}
                type="button"
                aria-label="ERP 首页"
                onClick={() => navigate("dashboard")}
              >
                <span className="menu-icon">⌂</span>
                ERP 首页
              </button>
              <button
                className={currentPage === "system" ? "child active-child" : "child"}
                type="button"
                aria-label="系统管理"
                onClick={() => navigate("system")}
              >
                <span className="menu-icon">⚙</span>
                系统管理
              </button>
            </>
          ) : null}
          {visibleSections.map((section) => {
            const isExpanded = isGroupExpanded(section.title);
            return (
              <div className="menu-section" key={section.title}>
                <button
                  className="menu-group-title"
                  type="button"
                  aria-label={section.title}
                  aria-expanded={isExpanded}
                  onClick={() => toggleNavGroup(section.title)}
                >
                  <span className="menu-icon">{section.icon}</span>
                  {section.title}
                  <span className="menu-arrow">{isExpanded ? "⌄" : "›"}</span>
                </button>
                {isExpanded ? section.pages.map((key) => (
                  <button key={key} className={currentPage === key ? "child active-child" : "child"} type="button" onClick={() => navigate(key)}>
                    {pageLabels[key]}
                  </button>
                )) : null}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="layout-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="topbar-icon-button hamburger" type="button" aria-label="折叠菜单" onClick={() => setSidebarCollapsed((current) => !current)}>
              ☰
            </button>
            <span className="breadcrumb">{breadcrumb}</span>
          </div>
          <div className="topbar-right">
            <div className="menu-search-wrap">
              <input
                ref={menuSearchRef}
                className="menu-search"
                placeholder="请输入菜单内容"
                aria-label="请输入菜单内容"
                value={menuSearch}
                onChange={(event) => setMenuSearch(event.target.value)}
              />
              {menuSearchResults.length > 0 ? (
                <div className="menu-search-results" role="menu" aria-label="菜单搜索结果">
                  {menuSearchResults.map((key) => (
                    <button key={key} type="button" onClick={() => navigate(key)}>
                      {pageLabels[key]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="topbar-icon-button" type="button" aria-label="全屏" onClick={() => void document.documentElement.requestFullscreen?.()}>
              <TopbarIcon name="fullscreen" />
            </button>
            <button className="topbar-icon-button" type="button" aria-label="搜索菜单" onClick={() => menuSearchRef.current?.focus()}>
              <TopbarIcon name="search" />
            </button>
            <button className="topbar-icon-button" type="button" aria-label="文字大小" aria-pressed={fontLarge} onClick={() => setFontLarge((current) => !current)}>
              <TopbarIcon name="text" />
            </button>
            <div className="user-menu-wrap">
              <button
                className="user-chip"
                type="button"
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
                aria-label={user.displayName || user.username}
                onClick={() => setShowUserMenu((current) => !current)}
              >
                <span className="avatar">{user.displayName?.slice(0, 1) || user.username.slice(0, 1).toUpperCase()}</span>
                {user.displayName || user.username}
              </button>
              {showUserMenu ? (
                <div className="user-menu" role="menu" aria-label="用户菜单">
                  <button type="button" onClick={() => void handleLogout()}>
                    退出系统
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="tagbar">
          <button className="tag-tool" type="button" aria-label="上一个标签" onClick={() => navigateSibling(-1)}>≪</button>
          {user.role === "admin" && currentPage !== "dashboard" ? (
            <button className="tag-item" type="button" aria-label="打开首页标签" onClick={() => navigate("dashboard")}>
              ⌂ 首页
            </button>
          ) : null}
          <button className="tag-item active" type="button" aria-label={`当前标签：${pageLabels[currentPage]}`} aria-current="page">
            {pageLabels[currentPage]}
          </button>
          <span className="tag-spacer" />
          <button className="tag-tool" type="button" aria-label="下一个标签" onClick={() => navigateSibling(1)}>≫</button>
          <button className="tag-tool" type="button" aria-label="刷新当前页" onClick={() => setRefreshKey((current) => current + 1)}>⟳</button>
          <button className="tag-tool tag-list-tool" type="button" aria-label="标签列表" aria-expanded={showTagMenu} title="标签列表" onClick={() => setShowTagMenu((current) => !current)}>
            ▦ <span>标签</span>
          </button>
          {showTagMenu ? (
            <div className="tag-menu" role="menu" aria-label="标签列表">
              {visiblePageOrder.map((key) => (
                <button key={key} type="button" className={currentPage === key ? "active" : ""} onClick={() => navigate(key)}>
                  {pageLabels[key]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <main className="content">
          <CurrentPage key={`${currentPage}-${refreshKey}`} navigate={navigate} params={pageParams} currentUser={user} />
        </main>
      </div>
    </div>
  );
}

function defaultPageForUser(user: SessionUser): PageKey {
  return user.role === "admin" ? "dashboard" : "outbound";
}

function groupForPage(page: PageKey) {
  if (page === "dashboard") {
    return "erp";
  }
  if (page === "system") {
    return "erp";
  }
  return navSections.find((section) => section.pages.includes(page))?.title ?? "erp";
}

function breadcrumbForPage(page: PageKey) {
  if (page === "dashboard") {
    return "ERP 系统 / 首页";
  }
  if (page === "system") {
    return "ERP 系统 / 系统管理";
  }
  return `ERP 系统 / ${groupForPage(page)} / ${pageLabels[page]}`;
}

function TopbarIcon({ name }: { name: "fullscreen" | "search" | "text" }) {
  if (name === "fullscreen") {
    return (
      <svg className="topbar-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 9V5h4" />
        <path d="M15 5h4v4" />
        <path d="M19 15v4h-4" />
        <path d="M9 19H5v-4" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg className="topbar-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="5" />
        <path d="m15 15 4 4" />
      </svg>
    );
  }
  return (
    <svg className="topbar-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7V5h10v2" />
      <path d="M10 5v14" />
      <path d="M7 19h6" />
      <path d="M16 11h4" />
      <path d="M18 11v8" />
      <path d="M16 19h4" />
    </svg>
  );
}

export { App };
