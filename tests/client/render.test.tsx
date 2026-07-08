import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/client/App";
import ImageThumb from "../../src/client/components/ImageThumb";
import HistoryPage from "../../src/client/pages/HistoryPage";
import OutboundPage from "../../src/client/pages/OutboundPage";
import OtherInboundPage from "../../src/client/pages/OtherInboundPage";
import PartsPage from "../../src/client/pages/PartsPage";
import ProductsPage from "../../src/client/pages/ProductsPage";
import PurchaseOrdersPage from "../../src/client/pages/PurchaseOrdersPage";
import PurchaseReceiptsPage from "../../src/client/pages/PurchaseReceiptsPage";
import StoresPage from "../../src/client/pages/StoresPage";
import StockPage from "../../src/client/pages/StockPage";
import StocktakePage from "../../src/client/pages/StocktakePage";
import SystemPage from "../../src/client/pages/SystemPage";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockJsonFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockRouteFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const route = Object.keys(routes).find((key) => path.includes(key));
      return new Response(JSON.stringify(route ? routes[route] : {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function mockRouteFetchWithRecorder(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(path);
      const route = Object.keys(routes).find((key) => path.includes(key));
      return new Response(JSON.stringify(route ? routes[route] : {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

function mockPartsCrudFetch(initialParts: Array<Record<string, unknown>> = []) {
  const parts = [...initialParts];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      if (path.includes("/api/parts") && method === "GET") {
        return new Response(JSON.stringify({ parts }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.includes("/api/parts") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const savedPart = {
          id: `part-${parts.length + 1}`,
          code: body.code ?? "",
          name: body.name ?? "",
          weight: body.weight ?? null,
          imageUrl: body.imageUrl ?? null,
          specification: body.specification ?? null,
          currentStock: body.currentStock ?? 0,
          remark: body.remark ?? null,
        };
        parts.push(savedPart);
        return new Response(JSON.stringify({ part: savedPart }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
}

describe("client app", () => {
  const admin = { id: "u1", username: "admin", displayName: "管理员", role: "admin" as const };

  it("renders login after confirming no server session exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "Content-Type": "application/json" } })),
    );

    render(<App />);
    expect(screen.getByText("正在恢复登录状态...")).toBeInTheDocument();
    expect(await screen.findByText("账号登录")).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
  });

  it("does not prefill login credentials on first visit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "Content-Type": "application/json" } })),
    );

    render(<App />);
    expect(await screen.findByLabelText("账号")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
  });

  it("restores the existing server session after a page refresh", async () => {
    mockRouteFetch({
      "/api/auth/me": { user: admin },
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [],
      },
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "首页" })).toBeInTheDocument();
    expect(screen.queryByText("账号登录")).not.toBeInTheDocument();
  });

  it("opens a user menu instead of logging out immediately from the avatar", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [],
      },
      "/api/auth/logout": { ok: true },
    });

    render(<App initialUser={admin} />);

    await user.click(screen.getByRole("button", { name: /管理员/ }));

    expect(screen.getByRole("menu", { name: "用户菜单" })).toBeInTheDocument();
    expect(screen.getByText("伯尼科技")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "退出系统" }));

    expect(await screen.findByText("账号登录")).toBeInTheDocument();
  });

  it("shows readable validation for empty login fields", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "Content-Type": "application/json" } })),
    );
    render(<App />);

    await user.clear(await screen.findByLabelText("账号"));
    await user.clear(screen.getByLabelText("密码"));
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByText("请输入账号和密码")).toBeInTheDocument();
  });

  it("renders dashboard after login", async () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      abnormalPurchaseOrderCount: 0,
      abnormalPurchaseOrders: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    expect(await screen.findByText("伯尼科技")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "请输入菜单内容" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "首页" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /待入库订单/ })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "低库存配件", level: 3 })).toBeInTheDocument();
  });

  it("renders demo-style grouped navigation for confirmed modules", async () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      abnormalPurchaseOrderCount: 0,
      abnormalPurchaseOrders: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    await screen.findByRole("button", { name: /待入库订单/ });
    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(screen.getByRole("button", { name: "采购管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "库存管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "产品管理" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "首页" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "ERP 首页" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "采购订单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "出库管理" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "财务管理" })).not.toBeInTheDocument();
  });

  it("collapses and expands sidebar menu groups", async () => {
    const user = userEvent.setup();
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      abnormalPurchaseOrderCount: 0,
      abnormalPurchaseOrders: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    const nav = screen.getByRole("navigation", { name: "主导航" });

    await user.click(screen.getByRole("button", { name: "采购管理" }));
    await user.click(screen.getByRole("button", { name: "库存管理" }));
    await user.click(screen.getByRole("button", { name: "产品管理" }));

    expect(screen.getByRole("button", { name: "采购管理" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "库存管理" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "产品管理" })).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).getByRole("button", { name: "ERP 首页" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "采购订单" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "库存查看" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "产品组装" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "采购管理" }));

    expect(screen.getByRole("button", { name: "采购管理" })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("button", { name: "采购订单" })).toBeInTheDocument();
  });

  it("gives topbar and tagbar controls visible behavior", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [],
      },
      "/api/purchase-orders": { purchaseOrders: [] },
      "/api/purchase-receipts": { purchaseReceipts: [] },
      "/api/parts": { parts: [] },
    });

    render(<App initialUser={admin} />);

    await user.click(screen.getByRole("button", { name: "采购订单" }));
    expect(await screen.findByRole("heading", { name: "采购订单" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文字大小" }));
    expect(document.querySelector(".app-shell")).toHaveClass("font-large");

    await user.click(screen.getByRole("button", { name: "标签列表" }));
    const tagMenu = screen.getByRole("menu", { name: "标签列表" });
    expect(within(tagMenu).getByRole("button", { name: "采购入库" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一个标签" }));
    expect(await screen.findByRole("heading", { name: "采购入库" })).toBeInTheDocument();
  });

  it("shows matching pages from the top menu search and navigates to them", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [],
      },
      "/api/parts": { parts: [] },
    });

    render(<App initialUser={admin} />);

    await user.type(screen.getByRole("textbox", { name: "请输入菜单内容" }), "配件");

    const searchMenu = screen.getByRole("menu", { name: "菜单搜索结果" });
    await user.click(within(searchMenu).getByRole("button", { name: "配件管理" }));

    expect(await screen.findByRole("heading", { name: "配件管理" })).toBeInTheDocument();
  });

  it("navigates from the low-stock dashboard card to all low-stock rows in stock", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [{ partId: "part-low", partName: "低库存配件", currentStock: 1, averageDailyUsage: 1, remainingDays: 1 }],
      },
      "/api/stock": { stock: [] },
    });

    render(<App initialUser={admin} />);

    await user.click(await screen.findByRole("button", { name: "低库存配件 1" }));

    expect(await screen.findByRole("heading", { name: "库存查看" })).toBeInTheDocument();
    expect(screen.getByLabelText("仅低库存")).toBeChecked();
  });

  it("limits operator navigation to outbound, stock, and stocktake workflows", async () => {
    mockRouteFetch({
      "/api/outbound-plans": { outboundPlans: [] },
      "/api/stores": { stores: [] },
      "/api/stock-locks": { stockLocks: [] },
      "/api/outbound-operators?status": { outboundOperators: [] },
    });

    const operator = { id: "u2", username: "operator", displayName: "操作员", role: "operator" as const };
    render(<App initialUser={operator} />);
    await screen.findByRole("button", { name: "创建预发货清单" });

    expect(screen.getByRole("button", { name: "出库管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "库存查看" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "盘点管理" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "首页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "配件管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "采购订单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "历史数据" })).not.toBeInTheDocument();
  });

  it("uses demo-style search actions on purchase order pages", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-orders": { purchaseOrders: [] },
      "/api/parts": { parts: [] },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByRole("button", { name: "搜索" })).toBeInTheDocument();
    expect(screen.getByLabelText("采购订单编号")).toBeInTheDocument();
    expect(screen.getByLabelText("运单号")).toBeInTheDocument();
    expect(screen.getByLabelText("筛选配件")).toBeInTheDocument();
    expect(screen.getByLabelText("下单日期")).toBeInTheDocument();
    expect(screen.getByLabelText("状态")).toBeInTheDocument();
    expect(screen.getByLabelText("备注")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增采购订单" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增" }));

    expect(screen.getByRole("dialog", { name: "新增" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确 定" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增采购订单" })).not.toBeInTheDocument();
    expect(screen.queryAllByLabelText("状态")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "取 消" }));

    expect(screen.queryByRole("dialog", { name: "新增" })).not.toBeInTheDocument();
  });

  it("uses selected history dates as local day boundaries in requests and xlsx links", async () => {
    const calls = mockRouteFetchWithRecorder({
      "/api/history": {
        from: "",
        to: "",
        purchaseOrders: [],
        purchaseReceipts: [],
        otherInbounds: [],
        outboundRecords: [],
        stocktakes: [],
      },
    });

    render(<HistoryPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-05-29" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-05-29" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const historyCalls = calls.filter((call) => call.includes("/api/history"));
      const lastCall = historyCalls[historyCalls.length - 1];
      const params = new URL(lastCall, "http://localhost").searchParams;
      expect(params.get("from")).toBe("2026-05-28T16:00:00.000Z");
      expect(params.get("to")).toBe("2026-05-29T16:00:00.000Z");
    });

    const exportLink = screen.getByRole("link", { name: "下载采购订单" }) as HTMLAnchorElement;
    expect(exportLink.pathname).toBe("/api/history/purchase-orders.xlsx");
    const exportParams = new URL(exportLink.href).searchParams;
    expect(exportParams.get("from")).toBe("2026-05-28T16:00:00.000Z");
    expect(exportParams.get("to")).toBe("2026-05-29T16:00:00.000Z");
  });

  it("applies recent history shortcuts and part search to history requests and outbound exports", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-22T02:00:00.000Z"));
    const calls = mockRouteFetchWithRecorder({
      "/api/history": {
        from: "",
        to: "",
        purchaseOrders: [],
        purchaseReceipts: [],
        otherInbounds: [],
        outboundRecords: [],
        stocktakes: [],
      },
    });

    render(<HistoryPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    fireEvent.click(screen.getByRole("button", { name: "最近7天" }));

    await waitFor(() => {
      const historyCalls = calls.filter((call) => call.includes("/api/history"));
      const lastCall = historyCalls[historyCalls.length - 1];
      const params = new URL(lastCall, "http://localhost").searchParams;
      expect(params.get("from")).toBe("2026-06-15T16:00:00.000Z");
      expect(params.get("to")).toBe("2026-06-22T16:00:00.000Z");
    });

    fireEvent.change(screen.getByLabelText("配件搜索"), { target: { value: "PART-001" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const historyCalls = calls.filter((call) => call.includes("/api/history"));
      const lastCall = historyCalls[historyCalls.length - 1];
      const params = new URL(lastCall, "http://localhost").searchParams;
      expect(params.get("partQuery")).toBe("PART-001");
    });

    fireEvent.click(screen.getByRole("button", { name: "出库" }));

    const exportLink = screen.getByRole("link", { name: "下载出库" }) as HTMLAnchorElement;
    const exportParams = new URL(exportLink.href).searchParams;
    expect(exportParams.get("partQuery")).toBe("PART-001");
  });

  it("shows detailed outbound and stocktake fields in history", async () => {
    mockRouteFetch({
      "/api/history": {
        from: "",
        to: "",
        purchaseOrders: [],
        purchaseReceipts: [],
        otherInbounds: [],
        outboundRecords: [
          {
            id: "outbound-1",
            skuCode: "SKU-001",
            goodsCode: "GOODS-001",
            productName: "历史产品",
            productImageUrl: null,
            storeName: "历史店铺",
            preOutboundQuantity: 4,
            actualOutboundQuantity: 3,
            outboundTime: "2026-06-10T08:00:00.000Z",
            operatorName: "张三",
            status: "已出库",
            reviewedBy: "管理员",
            reviewedAt: "2026-06-10T09:00:00.000Z",
            remark: "加急出库",
          },
        ],
        stocktakes: [
          {
            id: "stocktake-1",
            partCode: "PART-001",
            partName: "历史配件",
            partImageUrl: null,
            previousQuantity: 8,
            actualQuantity: 6,
            stocktakeTime: "2026-06-10T08:00:00.000Z",
            remark: "盘点损耗",
          },
        ],
      },
    });

    render(<HistoryPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    fireEvent.click(screen.getByRole("button", { name: "出库" }));

    expect(await screen.findByText("SKU-001")).toBeInTheDocument();
    expect(screen.getByText("GOODS-001")).toBeInTheDocument();
    expect(screen.getByText("历史产品")).toBeInTheDocument();
    expect(screen.getByText("历史店铺")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("已出库")).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
    expect(screen.getByText("加急出库")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "盘点" }));

    expect(await screen.findByText("PART-001")).toBeInTheDocument();
    expect(screen.getByText("历史配件")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("盘点损耗")).toBeInTheDocument();
  });

  it("applies parts search on click, highlights matches, and keeps the term in the xlsx export link", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/parts": {
        parts: [
          { id: "part-1", code: "P-1", name: "目标配件", weight: 2.5, specification: "M8", currentStock: 6 },
          { id: "part-2", code: "P-2", name: "其它配件", weight: 1, specification: "M10", currentStock: 2 },
        ],
      },
    });

    render(<PartsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("目标配件")).toBeInTheDocument();
    expect(screen.getByText("其它配件")).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索"), "目标配件");
    expect(screen.getByText("其它配件")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "搜索" }));

    const exportLink = screen.getByRole("button", { name: "导出" }) as HTMLAnchorElement;
    expect(exportLink.pathname).toBe("/api/parts.xlsx");
    expect(new URL(exportLink.href).searchParams.get("q")).toBe("目标配件");
    expect(screen.queryByText("其它配件")).not.toBeInTheDocument();
    expect(screen.getByText("目标配件").tagName.toLowerCase()).toBe("mark");
  });

  it("shows a loading state instead of empty data while parts are fetching", async () => {
    const deferred = createDeferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (path.includes("/api/parts")) {
          return deferred.promise;
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

    render(<PartsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(screen.queryByText("暂无数据")).not.toBeInTheDocument();

    deferred.resolve(
      new Response(JSON.stringify({ parts: [{ id: "part-1", code: "P-1", name: "目标配件", weight: 1, specification: "M8", currentStock: 3 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await screen.findByText("目标配件")).toBeInTheDocument();
  });

  it("clears part dialog messages when switching from add to edit", async () => {
    const user = userEvent.setup();
    mockPartsCrudFetch();

    render(<PartsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(screen.getByRole("button", { name: "新增" }));
    await user.type(screen.getByLabelText("配件编号"), "P-1");
    await user.type(screen.getByLabelText("配件名称"), "目标配件");
    await user.click(screen.getByRole("button", { name: "确 定" }));

    expect(await screen.findByText("配件已新增")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑" }));

    const dialog = screen.getByRole("dialog", { name: "编辑" });
    expect(within(dialog).queryByText("配件已新增")).not.toBeInTheDocument();
    expect(screen.queryByText("配件已新增")).not.toBeInTheDocument();
  });

  it("clears transient part messages automatically after a short delay", async () => {
    vi.useFakeTimers();
    mockPartsCrudFetch();

    render(<PartsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    fireEvent.change(screen.getByLabelText("配件编号"), { target: { value: "P-1" } });
    fireEvent.change(screen.getByLabelText("配件名称"), { target: { value: "目标配件" } });
    fireEvent.click(screen.getByRole("button", { name: "确 定" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("配件已新增")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("配件已新增")).not.toBeInTheDocument();
  });

  it("allows clearing a single purchase-order search field without resetting the others", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-orders": { purchaseOrders: [] },
      "/api/parts": {
        parts: [{ id: "part-1", code: "P-1", name: "目标配件" }],
      },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    const orderNoInput = screen.getByLabelText("采购订单编号");
    const logisticsNoInput = screen.getByLabelText("运单号");

    await user.type(orderNoInput, "PO-001");
    await user.type(logisticsNoInput, "LOG-001");

    expect(screen.getByRole("button", { name: "清空采购订单编号" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空采购订单编号" }));

    expect(orderNoInput).toHaveValue("");
    expect(logisticsNoInput).toHaveValue("LOG-001");
  });

  it("shows and filters stock by weight and last stocktake time", async () => {
    mockRouteFetch({
      "/api/stock": {
        stock: [
          {
            partId: "part-1",
            partCode: "P-1",
            partName: "目标配件",
            imageUrl: null,
            specification: "M8",
            weight: 2.75,
            quantity: 9,
            remark: "抽屉备注",
            lastStocktakeAt: "2026-05-30T08:00:00.000Z",
          },
          {
            partId: "part-2",
            partCode: "P-2",
            partName: "其它配件",
            imageUrl: null,
            specification: "M10",
            weight: 1.1,
            quantity: 4,
            remark: null,
            lastStocktakeAt: null,
          },
        ],
      },
    });

    render(<StockPage currentUser={admin} navigate={vi.fn()} params={{ q: "2026-05-30" }} />);

    expect(await screen.findByText("目标配件")).toBeInTheDocument();
    expect(screen.getByText("规格")).toBeInTheDocument();
    expect(screen.getByText("重量")).toBeInTheDocument();
    expect(screen.getByText("M8")).toBeInTheDocument();
    expect(screen.getByText("2.75")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-05-30")).toBeInTheDocument();
    expect(screen.queryByText("2026-05-30T08:00:00.000Z")).not.toBeInTheDocument();
    expect(screen.queryByText("其它配件")).not.toBeInTheDocument();
  });

  it("lets admins create a purchase order from a stock row", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/stock": {
        stock: [
          {
            partId: "part-1",
            partCode: "P-ORDER",
            partName: "待采购配件",
            imageUrl: null,
            specification: "M8",
            weight: 2.75,
            quantity: 9,
            remark: null,
            lastStocktakeAt: null,
          },
        ],
      },
      "/api/purchase-orders": { purchaseOrder: { id: "order-1" } },
    });

    render(<StockPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("待采购配件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "采购下单" }));

    expect(screen.getByRole("dialog", { name: "采购下单" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("P-ORDER 待采购配件")).toBeDisabled();

    await user.clear(screen.getByLabelText("数量"));
    await user.type(screen.getByLabelText("数量"), "12");
    await user.type(screen.getByLabelText("运单号"), "LOG-STOCK-1");
    await user.type(screen.getByLabelText("备注"), "库存总表下单");
    await user.click(screen.getByRole("button", { name: "确 定" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"partId":"part-1"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders",
      expect.objectContaining({
        body: expect.stringContaining('"orderQuantity":12'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders",
      expect.objectContaining({
        body: expect.stringContaining('"logisticsNo":"LOG-STOCK-1"'),
      }),
    );
  });

  it("shows recent outbound usage and purchase in-transit stock rows and allows custom purchase order number", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/stock": {
        stock: [
          {
            partId: "part-1",
            partCode: "P-USAGE",
            partName: "用量配件",
            imageUrl: null,
            specification: "M8",
            weight: null,
            quantity: 9,
            outbound7Days: 6,
            outbound14Days: 14,
            purchaseInTransit: 8,
            remark: null,
            lastStocktakeAt: null,
            isLowStock: true,
          },
          {
            partId: "part-2",
            partCode: "P-NORMAL",
            partName: "正常配件",
            imageUrl: null,
            specification: "M10",
            weight: null,
            quantity: 99,
            outbound7Days: 0,
            outbound14Days: 0,
            purchaseInTransit: 0,
            remark: null,
            lastStocktakeAt: null,
            isLowStock: false,
          },
        ],
      },
      "/api/purchase-orders": { purchaseOrder: { id: "order-1" } },
    });

    render(<StockPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("7天出库量")).toBeInTheDocument();
    expect(screen.getByText("14天出库量")).toBeInTheDocument();
    expect(screen.getByText("采购在途")).toBeInTheDocument();
    expect(screen.getByText("现货库存数量")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();

    await user.click(screen.getByLabelText("仅低库存"));
    expect(screen.getByText("用量配件")).toBeInTheDocument();
    expect(screen.queryByText("正常配件")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "采购下单" }));
    await user.type(screen.getByLabelText("采购订单编号"), "PO-STOCK-CUSTOM");
    await user.click(screen.getByRole("button", { name: "确 定" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders",
      expect.objectContaining({
        body: expect.stringContaining('"orderNo":"PO-STOCK-CUSTOM"'),
      }),
    );
  });

  it("creates pre-shipment plans, submits one-click shipments, and lets admins approve shipment batches", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/outbound-plans/plan-1/shipments": {
        outboundShipment: { id: "ship-1", shipmentNo: "OS001", planId: "plan-1", status: "待审核", operatorName: "出货人A", items: [] },
      },
      "/api/outbound-shipments/ship-1/approve": {
        outboundShipment: { id: "ship-1", status: "已出库", reviewedBy: "管理员", warnings: [] },
      },
      "/api/outbound-shipments?status": { outboundShipments: [] },
      "/api/outbound-operators?status": {
        outboundOperators: [{ id: "operator-1", name: "出货人A", enabled: true }],
      },
      "/api/stores/store-1/products": {
        products: [{ id: "product-1", code: "SKU-TARGET", name: "目标产品", imageUrl: "/uploads/products/target.jpg" }],
      },
      "/api/stores/store-2/products": {
        products: [{ id: "product-2", code: "SKU-OTHER", name: "其它产品" }],
      },
      "/api/outbound-plans": {
        outboundPlans: [
          {
            id: "plan-1",
            planNo: "OP001",
            storeId: "store-1",
            storeName: "目标店铺",
            operatorName: "运营王五",
            status: "预出库",
            remark: "目标备注",
            items: [
              {
                id: "item-1",
                productId: "product-1",
                productCode: "SKU-TARGET",
                productName: "目标产品",
                productImageUrl: "/uploads/products/target.jpg",
                preOutboundQuantity: 3,
                shippedQuantity: 1,
                cancelledQuantity: 0,
                remainingQuantity: 2,
              },
            ],
          },
        ],
      },
      "/api/stores": { stores: [{ id: "store-1", name: "目标店铺" }, { id: "store-2", name: "其它店铺" }] },
      "/api/stock-locks": { stockLocks: [] },
    });

    render(<OutboundPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("预发货单号")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "店铺" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "预出库总数" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "累计已发" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "剩余待发" })).toBeInTheDocument();
    expect(screen.getByText("SKU-TARGET")).toBeInTheDocument();
    expect(screen.getByAltText("目标产品图片")).toBeInTheDocument();
    expect(screen.getByText("剩余 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建预发货清单" }));
    const dialog = screen.getByRole("dialog", { name: "创建预发货清单" });

    expect(within(dialog).getByLabelText("搜索店铺")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("搜索店铺"), "目标");
    expect(within(dialog).getByText("匹配 1 个")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "店铺" })).toHaveValue("store-1");
    expect(within(dialog).queryByRole("option", { name: "其它店铺" })).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText("SKU-TARGET")).toBeInTheDocument());
    const quantityInput = within(dialog).getByLabelText("目标产品预出库数量");
    await user.clear(quantityInput);
    await user.type(quantityInput, "4");
    await user.type(within(dialog).getByLabelText("运营人员"), "运营王五");
    await user.click(within(dialog).getByRole("button", { name: "提交预发货" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/outbound-plans",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"preOutboundQuantity":4'),
      }),
    );

    await user.click(screen.getByRole("button", { name: "一键发货" }));
    const shipmentDialog = screen.getByRole("dialog", { name: "一键发货确认" });
    expect(within(shipmentDialog).getByText("剩余待发：2")).toBeInTheDocument();
    expect(within(shipmentDialog).getByLabelText("目标产品本次发货数量")).toHaveValue(2);
    await user.selectOptions(within(shipmentDialog).getByLabelText("出货人"), "出货人A");
    await user.click(within(shipmentDialog).getByRole("button", { name: "确认发货，提交审核" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/outbound-plans/plan-1/shipments",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"shippedQuantity":2'),
      }),
    );
    // 管理员一键发货后自动审核，无需再次点击审核按钮
    expect(fetch).toHaveBeenCalledWith(
      "/api/outbound-shipments/ship-1/approve",
      expect.objectContaining({ method: "POST" }),
    );

    expect(calls.some((path) => path.includes("/api/outbound-plans"))).toBe(true);
  });

  it("places system management after the other sidebar sections", async () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      abnormalPurchaseOrderCount: 0,
      abnormalPurchaseOrders: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    const nav = screen.getByRole("navigation", { name: "主导航" });
    const buttons = within(nav).getAllByRole("button");
    const systemIndex = buttons.findIndex((button) => button.getAttribute("aria-label") === "系统管理");
    const productIndex = buttons.findIndex((button) => button.getAttribute("aria-label") === "产品管理");

    expect(systemIndex).toBeGreaterThan(productIndex);
  });

  it("opens the purchase order form with the low-stock part selected", async () => {
    mockRouteFetch({
      "/api/purchase-orders": { purchaseOrders: [] },
      "/api/parts": {
        parts: [
          { id: "part-1", code: "P-1", name: "其它配件" },
          { id: "part-2", code: "P-2", name: "低库存配件" },
        ],
      },
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [],
      },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{ partId: "part-2" }} />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "配件" })).toHaveValue("P-2 - 低库存配件"));
    expect(screen.getByRole("dialog", { name: "新增" })).toBeInTheDocument();
  });

  it("shows a low-stock overview in purchase orders and starts an order from it", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-orders": { purchaseOrders: [] },
      "/api/parts": {
        parts: [
          { id: "part-low", code: "P-LOW", name: "低库存配件" },
          { id: "part-other", code: "P-OTHER", name: "其它配件" },
        ],
      },
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [
          {
            partId: "part-low",
            partName: "低库存配件",
            currentStock: 18,
            averageDailyUsage: 2,
            remainingDays: 9,
          },
        ],
      },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("配件低库存一览表")).toBeInTheDocument();
    expect(screen.getByText("现货库存数量")).toBeInTheDocument();
    expect(screen.getByText("预计天数")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建采购订单" }));

    const dialog = screen.getByRole("dialog", { name: "新增" });
    expect(within(dialog).getByRole("combobox", { name: "配件" })).toHaveValue("P-LOW - 低库存配件");
    expect(within(dialog).getByLabelText("数量")).toHaveValue(12);
  });

  it("filters the purchase-order part selector", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-orders": { purchaseOrders: [] },
      "/api/parts": {
        parts: [
          { id: "part-1", code: "P-DEFAULT", name: "默认配件" },
          { id: "part-2", code: "P-TARGET", name: "目标配件" },
        ],
      },
      "/api/dashboard": {
        pendingInboundCount: 0,
        pendingInboundReceipts: [],
        abnormalPurchaseOrderCount: 0,
        abnormalPurchaseOrders: [],
        lowStockParts: [],
      },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(await screen.findByRole("button", { name: "新增" }));
    const dialog = screen.getByRole("dialog", { name: "新增" });
    const partCombobox = within(dialog).getByRole("combobox", { name: "配件" });
    await user.click(partCombobox);
    await user.clear(partCombobox);
    await user.type(partCombobox, "TARGET");
    await user.click(await within(dialog).findByRole("option", { name: "P-TARGET - 目标配件" }));

    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "配件" })).toHaveValue("P-TARGET - 目标配件"));
    expect(within(dialog).queryByRole("option", { name: "P-DEFAULT - 默认配件" })).not.toBeInTheDocument();
  });

  it("filters part and product selectors in add forms", async () => {
    const user = userEvent.setup();

    mockRouteFetch({
      "/api/other-inbounds": { otherInbounds: [] },
      "/api/parts": {
        parts: [
          { id: "part-1", code: "P-DEFAULT", name: "默认配件" },
          { id: "part-2", code: "P-TARGET", name: "目标配件" },
        ],
      },
    });
    const otherInboundView = render(<OtherInboundPage currentUser={admin} navigate={vi.fn()} params={{}} />);
    await user.click(await screen.findByRole("button", { name: "新增" }));
    await user.type(screen.getByLabelText("输入配件编号或名称"), "TARGET");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "配件" })).toHaveValue("part-2"));
    expect(screen.queryByRole("option", { name: "P-DEFAULT 默认配件" })).not.toBeInTheDocument();
    otherInboundView.unmount();

    mockRouteFetch({
      "/api/stores/store-1/products": {
        products: [
          { id: "product-1", code: "PR-TARGET", name: "目标产品" },
        ],
      },
      "/api/outbound-plans": { outboundPlans: [] },
      "/api/outbound-shipments?status": { outboundShipments: [] },
      "/api/stock-locks": { stockLocks: [] },
      "/api/stores": { stores: [{ id: "store-1", name: "目标店铺" }, { id: "store-2", name: "其它店铺" }] },
    });
    const outboundView = render(<OutboundPage currentUser={admin} navigate={vi.fn()} params={{}} />);
    await user.click(await screen.findByRole("button", { name: "创建预发货清单" }));
    const outboundDialog = screen.getByRole("dialog", { name: "创建预发货清单" });
    await user.type(within(outboundDialog).getByLabelText("搜索店铺"), "目标");
    await waitFor(() => expect(within(outboundDialog).getByRole("combobox", { name: "店铺" })).toHaveValue("store-1"));
    expect(within(outboundDialog).queryByRole("option", { name: "其它店铺" })).not.toBeInTheDocument();
    expect(await within(outboundDialog).findByText("PR-TARGET")).toBeInTheDocument();
    outboundView.unmount();

    mockRouteFetch({
      "/api/products": { products: [] },
      "/api/parts": {
        parts: [
          { id: "part-1", code: "P-DEFAULT", name: "默认配件" },
          { id: "part-2", code: "P-TARGET", name: "目标配件" },
        ],
      },
    });
    render(<ProductsPage currentUser={admin} navigate={vi.fn()} params={{}} />);
    await user.click(await screen.findByRole("button", { name: "新增" }));
    await user.type(screen.getByLabelText("输入配件编号或名称"), "TARGET");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "配件" })).toHaveValue("part-2"));
    expect(screen.queryByRole("option", { name: "P-DEFAULT 默认配件" })).not.toBeInTheDocument();
  });

  it("filters purchase receipts by grouped fields", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    mockRouteFetch({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-TARGET",
            orderNo: "PO-1",
            logisticsNo: "L-123",
            partName: "目标配件",
            partImageUrl: null,
            purchaseQuantity: 5,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
          {
            id: "receipt-2",
            purchaseOrderId: "order-2",
            receiptNo: "R-OTHER",
            orderNo: "PO-2",
            logisticsNo: "L-999",
            partName: "其它配件",
            partImageUrl: null,
            purchaseQuantity: 3,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("入库单号 / 采购订单编号 / 运单号")).toBeInTheDocument();
    const toolbar = screen.getByText("入库单号 / 采购订单编号 / 运单号").closest(".toolbar") as HTMLElement;
    expect(within(toolbar).getByLabelText("入库单号 / 采购订单编号 / 运单号")).toBeInTheDocument();
    expect(within(toolbar).getByLabelText("配件")).toBeInTheDocument();
    expect(within(toolbar).getByLabelText("状态")).toBeInTheDocument();
    expect(within(toolbar).getByLabelText("新增时间")).toBeInTheDocument();

    await user.type(within(toolbar).getByLabelText("入库单号 / 采购订单编号 / 运单号"), "L-123");
    expect(screen.getByText("R-OTHER")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(screen.getByText("R-TARGET")).toBeInTheDocument();
    expect(screen.queryByText("R-OTHER")).not.toBeInTheDocument();

    const deleteButton = screen.getByRole("button", { name: "删除" });
    expect(deleteButton).toBeDisabled();

    await user.click(screen.getByLabelText("选择第 1 行"));
    expect(deleteButton).toBeEnabled();

    await user.click(deleteButton);
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/receipt-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("switches purchase receipts between pending and received views", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-PENDING",
            orderNo: "PO-PENDING",
            logisticsNo: "L-PENDING",
            partName: "待入库配件",
            partImageUrl: null,
            purchaseQuantity: 5,
            inboundQuantity: 0,
            status: "在途",
            createdAt: "2026-06-10T08:00:00.000Z",
            inboundTime: null,
            remark: null,
          },
          {
            id: "receipt-2",
            purchaseOrderId: "order-2",
            receiptNo: "R-RECEIVED",
            orderNo: "PO-RECEIVED",
            logisticsNo: "L-RECEIVED",
            partName: "已入库配件",
            partImageUrl: null,
            purchaseQuantity: 5,
            inboundQuantity: 3,
            status: "已入库",
            createdAt: "2026-06-11T08:00:00.000Z",
            inboundTime: "2026-06-11T09:00:00.000Z",
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await waitFor(() => {
      const receiptCalls = calls.filter((path) => path.includes("/api/purchase-receipts?"));
      const params = new URL(receiptCalls[receiptCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("receiptState")).toBe("pending");
    });

    expect(screen.getByText("R-PENDING")).toBeInTheDocument();
    expect(screen.queryByText("R-RECEIVED")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "已入库" }));

    await waitFor(() => {
      const receiptCalls = calls.filter((path) => path.includes("/api/purchase-receipts?"));
      const params = new URL(receiptCalls[receiptCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("receiptState")).toBe("received");
    });

    expect(screen.getByText("R-RECEIVED")).toBeInTheDocument();
  });

  it("sends inline purchase receipt quantity as an additional arrival", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-SPLIT",
            orderNo: "PO-SPLIT",
            logisticsNo: "L-SPLIT",
            partName: "分批配件",
            partImageUrl: null,
            purchaseQuantity: 100,
            currentStock: 90,
            inboundQuantity: 90,
            status: "部分入库",
            inboundTime: "2026-06-10T08:00:00.000Z",
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{ receiptState: "pending" }} />);

    expect(await screen.findByRole("columnheader", { name: "采购数" })).toHaveClass("quantity-emphasis-column");
    expect(screen.getByRole("columnheader", { name: "已入库" })).toHaveClass("inbound-emphasis-column");
    expect(await screen.findByDisplayValue("PO-SPLIT")).toHaveClass("compact-code-input");
    expect(screen.getByText("现货库存数量")).toBeInTheDocument();
    const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByDisplayValue("PO-SPLIT"));
    expect(row).toBeDefined();
    const receiptRow = within(row as HTMLElement);
    expect(receiptRow.getByText("100")).toHaveClass("purchase-quantity-badge");
    expect(receiptRow.getByText("90 / 100")).toHaveClass("receipt-progress-value");
    expect(receiptRow.getByTitle("R-SPLIT")).toHaveClass("compact-cell-text");
    expect(receiptRow.getByTitle("分批配件")).toHaveClass("part-name-compact");

    const arrivalInput = screen.getByLabelText("本次到货");
    expect(arrivalInput).toHaveValue(0);
    await user.clear(arrivalInput);
    await user.type(arrivalInput, "10");
    await user.click(screen.getByRole("button", { name: "保存到货" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"addToExisting":true'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"inboundQuantity":10'),
      }),
    );
  });

  it("lets admins edit purchase receipt fields inline", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-EDIT",
            orderNo: "PO-EDIT",
            logisticsNo: "L-EDIT",
            partName: "编辑入库配件",
            partImageUrl: null,
            purchaseQuantity: 100,
            currentStock: 0,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("编辑入库配件")).toBeInTheDocument();
    const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByText("编辑入库配件"));
    expect(row).toBeDefined();
    const editableRow = within(row as HTMLElement);

    await user.clear(editableRow.getByLabelText("采购订单编号"));
    await user.type(editableRow.getByLabelText("采购订单编号"), "PO-EDIT-NEW");
    await user.clear(editableRow.getByLabelText("运单号"));
    await user.type(editableRow.getByLabelText("运单号"), "LOG-EDIT-NEW");
    fireEvent.change(editableRow.getByLabelText("到货时间"), { target: { value: "2026-06-10T09:30" } });
    expect(within(editableRow.getByLabelText("状态")).getByRole("option", { name: "缺货" })).toBeInTheDocument();
    expect(within(editableRow.getByLabelText("状态")).getByRole("option", { name: "已入库" })).toBeInTheDocument();
    expect(within(editableRow.getByLabelText("状态")).queryByRole("option", { name: "自动判断" })).not.toBeInTheDocument();
    await user.selectOptions(editableRow.getByLabelText("状态"), "工厂缺货");
    await user.type(editableRow.getByLabelText("备注"), "厂家缺货");
    await user.click(editableRow.getByRole("button", { name: "保存到货" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"orderNo":"PO-EDIT-NEW"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"logisticsNo":"LOG-EDIT-NEW"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"inboundTime"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"status":"工厂缺货"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"remark":"厂家缺货"'),
      }),
    );
  });

  it("lets admins enter a logistics number when receiving a purchase receipt", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-LOGISTICS",
            orderNo: "PO-LOGISTICS",
            logisticsNo: "L-OLD",
            partName: "运单配件",
            partImageUrl: null,
            purchaseQuantity: 2,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(await screen.findByRole("button", { name: "新增" }));
    const dialog = screen.getByRole("dialog", { name: "新增" });
    const logisticsInput = within(dialog).getByLabelText("运单号");
    expect(logisticsInput).toHaveValue("L-OLD");
    await user.clear(logisticsInput);
    await user.type(logisticsInput, "LOG-RECEIPT-001");
    await user.click(screen.getByRole("button", { name: "确 定" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"logisticsNo":"LOG-RECEIPT-001"'),
      }),
    );
  });

  it("uses manual purchase receipt status options when receiving purchase receipts", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-MANUAL",
            orderNo: "PO-MANUAL",
            logisticsNo: null,
            partName: "手动状态配件",
            partImageUrl: null,
            purchaseQuantity: 2,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(await screen.findByRole("button", { name: "新增" }));
    const dialog = screen.getByRole("dialog", { name: "新增" });
    const statusSelect = within(dialog).getByLabelText("状态");
    expect(statusSelect).toHaveValue("在途");
    expect(within(statusSelect).queryByRole("option", { name: "自动判断" })).not.toBeInTheDocument();
    expect(within(statusSelect).queryByRole("option", { name: "部分签收" })).not.toBeInTheDocument();
    expect(within(statusSelect).queryByRole("option", { name: "已签收" })).not.toBeInTheDocument();
    expect(within(statusSelect).getByRole("option", { name: "缺货" })).toBeInTheDocument();
    expect(within(statusSelect).getByRole("option", { name: "在途" })).toBeInTheDocument();
    expect(within(statusSelect).getByRole("option", { name: "已入库" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "确 定" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-receipts/order-1/receive",
      expect.objectContaining({
        body: expect.stringContaining('"status":"在途"'),
      }),
    );
  });

  it("keeps a manually entered logistics number when switching purchase orders", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-LOGISTICS-1",
            orderNo: "PO-LOGISTICS-1",
            logisticsNo: "L-OLD",
            partName: "运单配件A",
            partImageUrl: null,
            purchaseQuantity: 2,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
          {
            id: "receipt-2",
            purchaseOrderId: "order-2",
            receiptNo: "R-LOGISTICS-2",
            orderNo: "PO-LOGISTICS-2",
            logisticsNo: "L-NEW",
            partName: "运单配件B",
            partImageUrl: null,
            purchaseQuantity: 4,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(await screen.findByRole("button", { name: "新增" }));
    const dialog = screen.getByRole("dialog", { name: "新增" });
    const logisticsInput = within(dialog).getByLabelText("运单号");
    await user.clear(logisticsInput);
    await user.type(logisticsInput, "MANUAL-001");
    await user.selectOptions(within(dialog).getByLabelText("待入库订单"), "order-2");

    expect(logisticsInput).toHaveValue("MANUAL-001");
  });

  it("filters purchase receipts by selected status", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/purchase-receipts": { purchaseReceipts: [] },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await screen.findByRole("button", { name: "搜索" });
    await user.selectOptions(screen.getByLabelText("状态"), "已入库");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const receiptCalls = calls.filter((path) => path.includes("/api/purchase-receipts?"));
      const params = new URL(receiptCalls[receiptCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("status")).toBe("已入库");
    });
  });

  it("does not delete selected purchase receipts when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/purchase-receipts": {
        purchaseReceipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "order-1",
            receiptNo: "R-TARGET",
            orderNo: "PO-1",
            logisticsNo: "L-123",
            partName: "目标配件",
            partImageUrl: null,
            purchaseQuantity: 5,
            inboundQuantity: 0,
            status: "在途",
            inboundTime: null,
            remark: null,
          },
        ],
      },
    });
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("R-TARGET")).toBeInTheDocument();
    await user.click(screen.getByLabelText("选择第 1 行"));
    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("确认删除"));
    expect(calls.some((path) => path.includes("/api/purchase-receipts/receipt-1"))).toBe(false);
  });

  it("loads abnormal purchase receipts when navigated from the dashboard card", async () => {
    const calls = mockRouteFetchWithRecorder({
      "/api/purchase-receipts": { purchaseReceipts: [] },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{ status: "abnormal" }} />);

    await waitFor(() => expect(calls.some((path) => path.includes("/api/purchase-receipts?status=abnormal"))).toBe(true));
  });

  it("filters purchase orders by order time", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-orders": {
        purchaseOrders: [
          {
            id: "order-1",
            orderNo: "PO-TODAY",
            logisticsNo: null,
            partName: "目标配件",
            partImageUrl: null,
            orderQuantity: 5,
            status: "在途",
            orderTime: "2026-05-29T00:00:00.000Z",
            remark: null,
          },
          {
            id: "order-2",
            orderNo: "PO-OLD",
            logisticsNo: null,
            partName: "其它配件",
            partImageUrl: null,
            orderQuantity: 3,
            status: "在途",
            orderTime: "2026-04-20T00:00:00.000Z",
            remark: null,
          },
        ],
      },
      "/api/parts": { parts: [] },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("PO-TODAY")).toBeInTheDocument();
    expect(screen.queryByText("2026-05-29T00:00:00.000Z")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("下单日期"), "2026-05-29");
    expect(screen.getByText("PO-OLD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(screen.getByText("PO-TODAY")).toBeInTheDocument();
    expect(screen.queryByText("PO-OLD")).not.toBeInTheDocument();
  });

  it("lets admins edit purchase orders inline and type order numbers", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/purchase-orders": {
        purchaseOrders: [
          {
            id: "order-1",
            orderNo: "PO-OLD",
            logisticsNo: "LOG-OLD",
            partId: "part-1",
            partName: "目标配件",
            partImageUrl: null,
            orderQuantity: 5,
            status: "在途",
            orderTime: "2026-06-09T08:00:00.000Z",
            remark: "旧备注",
          },
        ],
      },
      "/api/parts": {
        parts: [
          { id: "part-1", code: "P-1", name: "目标配件" },
          { id: "part-2", code: "P-2", name: "新配件" },
        ],
      },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("PO-OLD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增" }));
    expect(within(screen.getByRole("dialog", { name: "新增" })).getByLabelText("采购订单编号")).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取 消" }));

    await user.click(screen.getByRole("button", { name: "编辑" }));

    expect(screen.queryByRole("dialog", { name: "编辑" })).not.toBeInTheDocument();
    const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByDisplayValue("PO-OLD"));
    expect(row).toBeDefined();
    const editableRow = within(row as HTMLElement);
    await user.clear(editableRow.getByLabelText("采购订单编号"));
    await user.type(editableRow.getByLabelText("采购订单编号"), "PO-NEW");
    await user.clear(editableRow.getByLabelText("运单号"));
    await user.type(editableRow.getByLabelText("运单号"), "LOG-NEW");
    const inlinePartSelect = editableRow.getByRole("combobox", { name: "配件" });
    await user.click(inlinePartSelect);
    await user.clear(inlinePartSelect);
    await user.type(inlinePartSelect, "P-2");
    await user.click(await editableRow.findByRole("option", { name: "P-2 - 新配件" }));
    await user.selectOptions(editableRow.getByLabelText("状态"), "缺货");
    await user.clear(editableRow.getByLabelText("备注"));
    await user.type(editableRow.getByLabelText("备注"), "厂家缺货");
    await user.click(editableRow.getByRole("button", { name: "保存" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders/order-1",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"orderNo":"PO-NEW"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders/order-1",
      expect.objectContaining({
        body: expect.stringContaining('"status":"缺货"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders/order-1",
      expect.objectContaining({
        body: expect.stringContaining('"partId":"part-2"'),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument());
  });

  it("shows demo-style export action on store management", async () => {
    mockRouteFetch({
      "/api/stores": { stores: [] },
    });

    render(<StoresPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    const exportLink = await screen.findByRole("button", { name: "导出" }) as HTMLAnchorElement;
    expect(exportLink.pathname).toBe("/api/stores.xlsx");
  });

  it("shows and filters stocktakes by part code", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/stocktakes": {
        stocktakes: [
          {
            id: "stocktake-1",
            partId: "part-1",
            partCode: "P-TARGET",
            partName: "目标配件",
            partImageUrl: null,
            previousQuantity: 3,
            actualQuantity: -1,
            stocktakeTime: "2026-05-30T08:00:00.000Z",
            remark: "目标备注",
          },
          {
            id: "stocktake-2",
            partId: "part-2",
            partCode: "P-OTHER",
            partName: "其它配件",
            partImageUrl: null,
            previousQuantity: 5,
            actualQuantity: 5,
            stocktakeTime: "2026-05-29T08:00:00.000Z",
            remark: null,
          },
        ],
      },
      "/api/parts": { parts: [] },
    });

    render(<StocktakePage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("P-TARGET")).toBeInTheDocument();
    expect(screen.getByText("P-OTHER")).toBeInTheDocument();

    await user.type(screen.getByLabelText("配件编号"), "P-TARGET");
    expect(screen.getByText("其它配件")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const stocktakeCalls = calls.filter((path) => path.includes("/api/stocktakes?"));
      const params = new URL(stocktakeCalls[stocktakeCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("partCode")).toBe("P-TARGET");
    });
  });

  it("uses split stocktake filters in backend requests", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/stocktakes": { stocktakes: [] },
      "/api/parts": { parts: [] },
    });

    render(<StocktakePage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByLabelText("配件编号")).toBeInTheDocument();
    await user.type(screen.getByLabelText("配件编号"), "P-TARGET");
    await user.type(screen.getByLabelText("配件名称"), "目标配件");
    fireEvent.change(screen.getByLabelText("盘点日期"), { target: { value: "2026-06-10" } });
    await user.type(screen.getByLabelText("备注"), "目标备注");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const stocktakeCalls = calls.filter((path) => path.includes("/api/stocktakes?"));
      const params = new URL(stocktakeCalls[stocktakeCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("partCode")).toBe("P-TARGET");
      expect(params.get("partName")).toBe("目标配件");
      expect(params.get("stocktakeDate")).toBe("2026-06-10");
      expect(params.get("remark")).toBe("目标备注");
    });

    await user.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByLabelText("配件编号")).toHaveValue("");
    expect(screen.getByLabelText("盘点日期")).toHaveValue("");
  });

  it("filters the stocktake part selector and selects the matching part", async () => {
    const user = userEvent.setup();
    mockRouteFetch({
      "/api/stocktakes": { stocktakes: [] },
      "/api/parts": {
        parts: [
          {
            id: "part-1",
            code: "P-DEFAULT",
            name: "默认配件",
            imageUrl: null,
            currentStock: 1,
            specification: "默认规格",
          },
          {
            id: "part-2",
            code: "P-TARGET",
            name: "目标配件",
            imageUrl: null,
            currentStock: 8,
            specification: "目标规格",
          },
        ],
      },
    });

    render(<StocktakePage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(await screen.findByRole("button", { name: "新增" }));
    expect(screen.getByLabelText("配件")).toHaveValue("part-1");

    await user.type(screen.getByLabelText("输入配件编号或名称"), "TARGET");

    expect(screen.getByLabelText("配件")).toHaveValue("part-2");
    expect(screen.queryByRole("option", { name: "P-DEFAULT 默认配件" })).not.toBeInTheDocument();
    expect(screen.getByText("当前库存：8")).toBeInTheDocument();
  });

  it("filters and paginates audit logs from system management", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/users": { users: [] },
      "/api/audit-logs": {
        auditLogs: [
          {
            id: "audit-1",
            createdAt: "2026-06-11T08:00:00.000Z",
            actorUsername: "admin",
            actorRole: "admin",
            action: "编辑库存备注",
            entityType: "stock",
            entityId: "part-1",
          },
        ],
        pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
      },
    });

    render(<SystemPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("编辑库存备注")).toBeInTheDocument();
    await user.type(screen.getByLabelText("账号"), "admin");
    await user.type(screen.getByLabelText("动作"), "库存");
    await user.selectOptions(screen.getByLabelText("对象"), "stock");
    await user.click(screen.getByRole("button", { name: "筛选日志" }));

    await waitFor(() => {
      expect(calls.some((path) => path.includes("/api/audit-logs?") && path.includes("actorUsername=admin") && path.includes("action=%E5%BA%93%E5%AD%98") && path.includes("entityType=stock"))).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => {
      expect(calls.some((path) => path.includes("/api/audit-logs?") && path.includes("page=2"))).toBe(true);
    });
  });

  it("opens and closes image thumbnails in a modal", async () => {
    const user = userEvent.setup();
    render(<ImageThumb src="/uploads/parts/test.jpg" alt="测试配件图片" />);

    await user.click(screen.getByRole("button", { name: "测试配件图片" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByAltText("测试配件图片")).toHaveLength(2);

    await user.click(screen.getByRole("dialog"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
