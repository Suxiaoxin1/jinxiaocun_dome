import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

interface DashboardData {
  pendingInboundCount: number;
  pendingInboundReceipts: AnyRow[];
  abnormalPurchaseOrderCount: number;
  abnormalPurchaseOrders: AnyRow[];
  lowStockParts: AnyRow[];
}

const emptyDashboard: DashboardData = {
  pendingInboundCount: 0,
  pendingInboundReceipts: [],
  abnormalPurchaseOrderCount: 0,
  abnormalPurchaseOrders: [],
  lowStockParts: [],
};

export default function DashboardPage({ navigate }: PageProps) {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadDashboard() {
    setLoading(true);
    try {
      const dashboardData = await apiGet<DashboardData>("/api/dashboard");
      setData(dashboardData);
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : "首页数据加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function ignoreLowStock(part: AnyRow) {
    const partId = String(part.partId ?? "");
    if (!partId) return;
    try {
      await apiPost(`/api/low-stock/${partId}/ignore`, {});
      await loadDashboard();
    } catch (ignoreError) {
      setError(ignoreError instanceof Error ? ignoreError.message : "忽略低库存失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>首页</h2>
      </header>
      {error ? <p className="inline-error">{error}</p> : null}
      {loading ? (
        <p className="inline-status" role="status">
          加载中...
        </p>
      ) : (
        <div className="metric-grid">
          <button className="metric-tile" type="button" onClick={() => navigate("purchaseReceipts", { receiptState: "pending" })}>
            <span>待入库订单</span>
            <strong>{data.pendingInboundCount}</strong>
          </button>
          <button className="metric-tile warning-tile" type="button" onClick={() => navigate("purchaseReceipts", { status: "abnormal" })}>
            <span>状态异常采购订单</span>
            <strong>{data.abnormalPurchaseOrderCount}</strong>
          </button>
          <button
            aria-label={`低库存配件 ${data.lowStockParts.length}`}
            className="metric-tile"
            type="button"
            onClick={() => navigate("stock", { lowStock: "1" })}
          >
            <span>低库存配件</span>
            <strong>{data.lowStockParts.length}</strong>
          </button>
        </div>
      )}
      <section className="content-section">
        <h3>待入库订单详情</h3>
        <DataTable
          rows={data.pendingInboundReceipts}
          loading={loading}
          columns={[
            { key: "orderNo", header: "采购订单编号" },
            { key: "partName", header: "配件" },
            { key: "purchaseQuantity", header: "采购数" },
            { key: "inboundQuantity", header: "已入库" },
            { key: "status", header: "状态" },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>状态异常采购订单</h3>
        <DataTable
          rows={data.abnormalPurchaseOrders}
          loading={loading}
          columns={[
            { key: "orderNo", header: "采购订单编号" },
            { key: "partName", header: "配件" },
            { key: "purchaseQuantity", header: "采购数" },
            { key: "inboundQuantity", header: "已入库" },
            {
              key: "status",
              header: "状态",
              render: (row) => <span className="status-badge warning">{String(row.status ?? "")}</span>,
            },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>低库存配件</h3>
        <DataTable
          rows={data.lowStockParts}
          loading={loading}
          columns={[
            { key: "partName", header: "配件" },
            { key: "currentStock", header: "现货库存数量" },
            { key: "averageDailyUsage", header: "日均消耗" },
            { key: "remainingDays", header: "预计天数" },
            {
              key: "actions",
              header: "操作",
              render: (part) => (
                <div className="row-actions">
                  <button type="button" onClick={() => navigate("stock", { lowStock: "1" })}>
                    查看
                  </button>
                  <button type="button" onClick={() => void ignoreLowStock(part)}>
                    忽略
                  </button>
                  <button type="button" onClick={() => navigate("purchaseOrders", { partId: String(part.partId ?? "") })}>
                    去采购
                  </button>
                </div>
              ),
            },
          ]}
        />
      </section>
    </section>
  );
}
