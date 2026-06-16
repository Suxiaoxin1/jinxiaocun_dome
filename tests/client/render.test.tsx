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

  it("renders login as the first screen when no session exists", () => {
    render(<App />);
    expect(screen.getByText("账号登录")).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
  });

  it("does not prefill login credentials on first visit", () => {
    render(<App />);
    expect(screen.getByLabelText("账号")).toHaveValue("");
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

    expect(await screen.findByText("ERP 系统 / 首页")).toBeInTheDocument();
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
    render(<App />);

    await user.clear(screen.getByLabelText("账号"));
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
    expect(screen.getByText("ERP 系统 / 首页")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /待入库订单/ })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "低库存配件", level: 3 })).toBeInTheDocument();
  });

  it("renders demo-style grouped navigation for confirmed modules", () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      abnormalPurchaseOrderCount: 0,
      abnormalPurchaseOrders: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(screen.getByRole("button", { name: "ERP 系统" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "ERP 系统" }));
    await user.click(screen.getByRole("button", { name: "采购管理" }));
    await user.click(screen.getByRole("button", { name: "库存管理" }));
    await user.click(screen.getByRole("button", { name: "产品管理" }));

    expect(screen.getByRole("button", { name: "ERP 系统" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "采购管理" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "库存管理" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "产品管理" })).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("button", { name: "ERP 首页" })).not.toBeInTheDocument();
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
    expect(await screen.findByText("ERP 系统 / 采购管理 / 采购订单")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "文字大小" }));
    expect(document.querySelector(".app-shell")).toHaveClass("font-large");

    await user.click(screen.getByRole("button", { name: "标签列表" }));
    const tagMenu = screen.getByRole("menu", { name: "标签列表" });
    expect(within(tagMenu).getByRole("button", { name: "采购入库" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一个标签" }));
    expect(await screen.findByText("ERP 系统 / 采购管理 / 采购入库")).toBeInTheDocument();
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

    expect(await screen.findByText("ERP 系统 / 产品管理 / 配件管理")).toBeInTheDocument();
  });

  it("navigates from the low-stock dashboard card to stock", async () => {
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

    expect(await screen.findByText("ERP 系统 / 库存管理 / 库存查看")).toBeInTheDocument();
    expect(screen.getByDisplayValue("低库存配件")).toBeInTheDocument();
  });

  it("limits operator navigation to outbound, stock, and stocktake workflows", () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      abnormalPurchaseOrderCount: 0,
      abnormalPurchaseOrders: [],
      lowStockParts: [],
    });

    const operator = { id: "u2", username: "operator", displayName: "操作员", role: "operator" as const };
    render(<App initialUser={operator} />);

    expect(screen.getByRole("button", { name: "ERP 系统" })).toBeInTheDocument();
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
    expect(screen.getByLabelText("订单号")).toBeInTheDocument();
    expect(screen.getByLabelText("物流单号")).toBeInTheDocument();
    expect(screen.getByLabelText("配件")).toBeInTheDocument();
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

    const orderNoInput = screen.getByLabelText("订单号");
    const logisticsNoInput = screen.getByLabelText("物流单号");

    await user.type(orderNoInput, "PO-001");
    await user.type(logisticsNoInput, "LOG-001");

    expect(screen.getByRole("button", { name: "清空订单号" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空订单号" }));

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
    await user.type(screen.getByLabelText("物流单号"), "LOG-STOCK-1");
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

  it("shows recent outbound usage in stock rows and allows custom purchase order number", async () => {
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
            outbound15Days: 14,
            remark: null,
            lastStocktakeAt: null,
          },
        ],
      },
      "/api/purchase-orders": { purchaseOrder: { id: "order-1" } },
    });

    render(<StockPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("7天出库量")).toBeInTheDocument();
    expect(screen.getByText("15天出库量")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "采购下单" }));
    await user.type(screen.getByLabelText("订单号"), "PO-STOCK-CUSTOM");
    await user.click(screen.getByRole("button", { name: "确 定" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/purchase-orders",
      expect.objectContaining({
        body: expect.stringContaining('"orderNo":"PO-STOCK-CUSTOM"'),
      }),
    );
  });

  it("uses split outbound filters and selected outbound operator", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/outbound-records": {
        outboundRecords: [
          {
            id: "outbound-1",
            productCode: "PR-TARGET",
            productName: "目标产品",
            productImageUrl: "/uploads/products/target.jpg",
            storeName: "目标店铺",
            outboundQuantity: 3,
            outboundTime: "2026-06-10T08:00:00.000Z",
            operatorName: "王五",
            remark: "目标备注",
          },
        ],
      },
      "/api/products": { products: [{ id: "product-1", code: "PR-TARGET", name: "目标产品" }] },
      "/api/stores": { stores: [{ id: "store-1", name: "目标店铺" }] },
    });

    render(<OutboundPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("产品图片")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "出库人" })).toBeInTheDocument();
    expect(screen.getByLabelText("出库人")).toBeInTheDocument();
    expect(screen.getByAltText("目标产品图片")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-06-10" } });
    await user.type(screen.getByLabelText("产品编号"), "PR-TARGET");
    await user.type(screen.getByLabelText("产品名称"), "目标产品");
    await user.type(screen.getByLabelText("店铺"), "目标店铺");
    await user.type(screen.getByLabelText("出库人"), "王五");
    await user.type(screen.getByLabelText("备注"), "目标备注");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const outboundCalls = calls.filter((path) => path.includes("/api/outbound-records?"));
      const params = new URL(outboundCalls[outboundCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("from")).toBeTruthy();
      expect(params.get("to")).toBeTruthy();
      expect(params.get("productCode")).toBe("PR-TARGET");
      expect(params.get("productName")).toBe("目标产品");
      expect(params.get("storeName")).toBe("目标店铺");
      expect(params.get("operatorName")).toBe("王五");
      expect(params.get("remark")).toBe("目标备注");
    });

    await user.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByLabelText("产品编号")).toHaveValue("");
    expect(screen.getByLabelText("备注")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "新增" }));

    const operatorSelect = screen.getByRole("combobox", { name: "出库人" });
    expect(operatorSelect).toHaveValue("管理员");
    expect(within(operatorSelect).getByRole("option", { name: "王五" })).toBeInTheDocument();
    expect(screen.queryByLabelText("操作人")).not.toBeInTheDocument();
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
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{ partId: "part-2" }} />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "配件" })).toHaveValue("part-2"));
    expect(screen.getByRole("dialog", { name: "新增" })).toBeInTheDocument();
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
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await user.click(await screen.findByRole("button", { name: "新增" }));
    await user.type(screen.getByPlaceholderText("输入配件编号或名称"), "TARGET");

    const dialog = screen.getByRole("dialog", { name: "新增" });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "配件" })).toHaveValue("part-2"));
    expect(within(dialog).queryByRole("option", { name: "P-DEFAULT 默认配件" })).not.toBeInTheDocument();
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
    await user.type(screen.getByPlaceholderText("输入配件编号或名称"), "TARGET");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "配件" })).toHaveValue("part-2"));
    expect(screen.queryByRole("option", { name: "P-DEFAULT 默认配件" })).not.toBeInTheDocument();
    otherInboundView.unmount();

    mockRouteFetch({
      "/api/outbound-records": { outboundRecords: [] },
      "/api/products": {
        products: [
          { id: "product-1", code: "PR-DEFAULT", name: "默认产品" },
          { id: "product-2", code: "PR-TARGET", name: "目标产品" },
        ],
      },
      "/api/stores": { stores: [{ id: "store-1", name: "目标店铺" }] },
    });
    const outboundView = render(<OutboundPage currentUser={admin} navigate={vi.fn()} params={{}} />);
    await user.click(await screen.findByRole("button", { name: "新增" }));
    await user.type(screen.getByPlaceholderText("输入产品编号或名称"), "TARGET");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "产品" })).toHaveValue("product-2"));
    expect(screen.queryByRole("option", { name: "PR-DEFAULT 默认产品" })).not.toBeInTheDocument();
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
    await user.type(screen.getByPlaceholderText("输入配件编号或名称"), "TARGET");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "配件" })).toHaveValue("part-2"));
    expect(screen.queryByRole("option", { name: "P-DEFAULT 默认配件" })).not.toBeInTheDocument();
  });

  it("filters purchase receipts by logistics number", async () => {
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

    expect(await screen.findByText("物流单号")).toBeInTheDocument();
    expect(screen.getByText("L-123")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("入库单、物流、配件、状态、备注"), "L-123");
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
            status: "部分签收",
            inboundTime: "2026-06-10T08:00:00.000Z",
            remark: null,
          },
        ],
      },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("PO-SPLIT")).toBeInTheDocument();
    expect(screen.getByText("当前库存")).toBeInTheDocument();
    expect(screen.getByText("已入库：90")).toBeInTheDocument();

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

  it("filters purchase receipts by selected status", async () => {
    const user = userEvent.setup();
    const calls = mockRouteFetchWithRecorder({
      "/api/purchase-receipts": { purchaseReceipts: [] },
    });

    render(<PurchaseReceiptsPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    await screen.findByRole("button", { name: "搜索" });
    await user.selectOptions(screen.getByLabelText("状态"), "部分签收");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      const receiptCalls = calls.filter((path) => path.includes("/api/purchase-receipts?"));
      const params = new URL(receiptCalls[receiptCalls.length - 1], "http://localhost").searchParams;
      expect(params.get("status")).toBe("部分签收");
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

  it("lets admins edit purchase orders and type order numbers", async () => {
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
      "/api/parts": { parts: [{ id: "part-1", code: "P-1", name: "目标配件" }] },
    });

    render(<PurchaseOrdersPage currentUser={admin} navigate={vi.fn()} params={{}} />);

    expect(await screen.findByText("PO-OLD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增" }));
    expect(within(screen.getByRole("dialog", { name: "新增" })).getByLabelText("订单号")).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取 消" }));

    await user.click(screen.getByRole("button", { name: "编辑" }));

    const dialog = screen.getByRole("dialog", { name: "编辑" });
    await user.clear(within(dialog).getByLabelText("订单号"));
    await user.type(within(dialog).getByLabelText("订单号"), "PO-NEW");
    await user.clear(within(dialog).getByLabelText("物流单号"));
    await user.type(within(dialog).getByLabelText("物流单号"), "LOG-NEW");
    await user.selectOptions(within(dialog).getByLabelText("状态"), "缺货");
    await user.clear(within(dialog).getByLabelText("备注"));
    await user.type(within(dialog).getByLabelText("备注"), "厂家缺货");
    await user.click(within(dialog).getByRole("button", { name: "确 定" }));

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

    await user.type(screen.getByPlaceholderText("输入配件编号或名称"), "TARGET");

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
