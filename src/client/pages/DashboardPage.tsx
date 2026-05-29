import { useEffect, useState } from "react";
import { apiGet } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

interface DashboardData {
  pendingInboundCount: number;
  pendingInboundReceipts: AnyRow[];
  lowStockParts: AnyRow[];
}

const emptyDashboard: DashboardData = {
  pendingInboundCount: 0,
  pendingInboundReceipts: [],
  lowStockParts: [],
};

export default function DashboardPage({ navigate }: PageProps) {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<DashboardData>("/api/dashboard")
      .then(setData)
      .catch((dashboardError) => setError(dashboardError instanceof Error ? dashboardError.message : "首页数据加载失败"));
  }, []);

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>首页</h2>
      </header>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="metric-grid">
        <button className="metric-tile" type="button" onClick={() => navigate("purchaseReceipts", { status: "pending" })}>
          <span>待入库订单</span>
          <strong>{data.pendingInboundCount}</strong>
        </button>
        <div className="metric-tile">
          <span>低库存配件</span>
          <strong>{data.lowStockParts.length}</strong>
        </div>
      </div>
      <section className="content-section">
        <h3>待入库订单详情</h3>
        <DataTable
          rows={data.pendingInboundReceipts}
          columns={[
            { key: "orderNo", header: "订单号" },
            { key: "partName", header: "配件" },
            { key: "purchaseQuantity", header: "采购数" },
            { key: "inboundQuantity", header: "已入库" },
            { key: "status", header: "状态" },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>低库存配件</h3>
        <DataTable
          rows={data.lowStockParts}
          columns={[
            { key: "partName", header: "配件" },
            { key: "currentStock", header: "当前库存" },
            { key: "averageDailyUsage", header: "日均消耗" },
            { key: "remainingDays", header: "预计天数" },
          ]}
        />
      </section>
    </section>
  );
}
