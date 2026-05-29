import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/client/App";
import ImageThumb from "../../src/client/components/ImageThumb";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJsonFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })),
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

  it("renders dashboard after login", async () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    expect(await screen.findByRole("button", { name: /待入库订单/ })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "低库存配件", level: 3 })).toBeInTheDocument();
  });

  it("renders compact navigation for confirmed modules", () => {
    mockJsonFetch({
      pendingInboundCount: 0,
      pendingInboundReceipts: [],
      lowStockParts: [],
    });

    render(<App initialUser={admin} />);
    expect(screen.getByRole("button", { name: "配件管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "产品组装" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "采购订单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "出库管理" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "财务管理" })).not.toBeInTheDocument();
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
