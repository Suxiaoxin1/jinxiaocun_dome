import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import DataTable from "../components/DataTable";
import ImageThumb from "../components/ImageThumb";
import type { AnyRow, PageProps } from "../types";

interface HistoryResponse {
  from: string;
  purchaseOrders: AnyRow[];
  purchaseReceipts: AnyRow[];
  otherInbounds: AnyRow[];
  outboundRecords: AnyRow[];
  stocktakes: AnyRow[];
}

export default function HistoryPage(_props: PageProps) {
  const [days, setDays] = useState("90");
  const [data, setData] = useState<HistoryResponse>({
    from: "",
    purchaseOrders: [],
    purchaseReceipts: [],
    otherInbounds: [],
    outboundRecords: [],
    stocktakes: [],
  });
  const [message, setMessage] = useState("");

  async function load() {
    const response = await apiGet<HistoryResponse>(`/api/history?days=${days || "90"}`);
    setData(response);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "历史数据加载失败"));
  }, [days]);

  const csvLinks = useMemo(
    () => [
      { href: "/api/history/purchase-orders.csv", label: "采购订单" },
      { href: "/api/history/purchase-receipts.csv", label: "采购入库" },
      { href: "/api/history/other-inbounds.csv", label: "其它入库" },
      { href: "/api/history/outbound-records.csv", label: "出库" },
      { href: "/api/history/stocktakes.csv", label: "盘点" },
    ],
    [],
  );

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>历史数据</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          统计天数
          <input value={days} onChange={(event) => setDays(event.target.value)} />
        </label>
        <div className="button-row">
          {csvLinks.map((link) => (
            <a key={link.href} className="secondary-button" href={link.href}>
              下载{link.label}
            </a>
          ))}
        </div>
      </div>
      <section className="content-section">
        <h3>采购订单</h3>
        <DataTable
          rows={data.purchaseOrders}
          columns={[
            { key: "orderNo", header: "订单号" },
            { key: "partName", header: "配件" },
            {
              key: "partImageUrl",
              header: "图片",
              render: (row) => <ImageThumb src={String(row.partImageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
            },
            { key: "status", header: "状态" },
            { key: "orderTime", header: "时间" },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>采购入库</h3>
        <DataTable
          rows={data.purchaseReceipts}
          columns={[
            { key: "receiptNo", header: "单号" },
            { key: "partName", header: "配件" },
            {
              key: "partImageUrl",
              header: "图片",
              render: (row) => <ImageThumb src={String(row.partImageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
            },
            { key: "status", header: "状态" },
            { key: "inboundTime", header: "时间" },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>其它入库</h3>
        <DataTable
          rows={data.otherInbounds}
          columns={[
            { key: "inboundNo", header: "单号" },
            { key: "partName", header: "配件" },
            {
              key: "partImageUrl",
              header: "图片",
              render: (row) => <ImageThumb src={String(row.partImageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
            },
            { key: "inboundTime", header: "时间" },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>出库</h3>
        <DataTable rows={data.outboundRecords} columns={[{ key: "productName", header: "产品" }, { key: "storeName", header: "店铺" }, { key: "outboundTime", header: "时间" }]} />
      </section>
      <section className="content-section">
        <h3>盘点</h3>
        <DataTable
          rows={data.stocktakes}
          columns={[
            { key: "partName", header: "配件" },
            {
              key: "partImageUrl",
              header: "图片",
              render: (row) => <ImageThumb src={String(row.partImageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
            },
            { key: "actualQuantity", header: "盘后数量" },
            { key: "stocktakeTime", header: "时间" },
          ]}
        />
      </section>
    </section>
  );
}
