import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost, apiUploadFile, setUnauthorizedHandler } from "../../src/client/api";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("client API helpers", () => {
  it("sends the csrf header on JSON write requests", async () => {
    const fetchMock = vi.fn(async () => (
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    vi.stubGlobal("fetch", fetchMock);

    await apiPost<{ ok: boolean }>("/api/parts", { code: "P-CSRF" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls.at(0) as unknown as Parameters<typeof fetch>;
    const init = call[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(fetchMock).toHaveBeenCalledWith("/api/parts", expect.objectContaining({ method: "POST" }));
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Berni-CSRF")).toBe("1");
  });

  it("sends the csrf header on file uploads", async () => {
    const fetchMock = vi.fn(async () => (
      new Response(JSON.stringify({ imageUrl: "/uploads/parts/test.png" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    await apiUploadFile<{ imageUrl: string }>("/api/uploads/parts", new File(["fake"], "test.png", { type: "image/png" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/uploads/parts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Berni-CSRF": "1",
        }),
      }),
    );
  });

  it("notifies the app when a request returns unauthorized", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "Content-Type": "application/json" } })),
    );

    await expect(apiGet("/api/stock")).rejects.toThrow("请先登录");

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
