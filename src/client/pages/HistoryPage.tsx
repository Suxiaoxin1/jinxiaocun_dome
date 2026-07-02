import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import DataTable from "../components/DataTable";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { buildExportHref, dateInputToLocalNextDayIso, dateInputToLocalStartIso } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

interface HistoryResponse {
  from: string;
  to: string;
  purchaseOrders: AnyRow[];
  purchaseReceipts: AnyRow[];
  otherInbounds: AnyRow[];
  outboundRecords: AnyRow[];
  stocktakes: AnyRow[];
}

export default function HistoryPage(_props: PageProps) {
  const [fromDateDraft, setFromDateDraft] = useState("");
  const [toDateDraft, setToDateDraft] = useState("");
  const [partQueryDraft, setPartQueryDraft] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [partQuery, setPartQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoryResponse>({
    from: "",
    to: "",
    purchaseOrders: [],
    purchaseReceipts: [],
    otherInbounds: [],
    outboundRecords: [],
    stocktakes: [],
  });
  const [message, setMessage] = useTransientMessage();

  async function load() {
    setLoading(true);
    try {
      const query = historyQuery(fromDate, toDate, partQuery);
      const response = await apiGet<HistoryResponse>(`/api/history${query}`);
      setData(response);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "历史数据加载失败"));
  }, [fromDate, toDate, partQuery]);

  const exportLinks = useMemo(
    () => [
      { href: buildExportHref("/api/history/purchase-orders", historyParams(fromDate, toDate)), label: "采购订单" },
      { href: buildExportHref("/api/history/purchase-receipts", historyParams(fromDate, toDate)), label: "采购入库" },
      { href: buildExportHref("/api/history/other-inbounds", historyParams(fromDate, toDate)), label: "其它入库" },
      { href: buildExportHref("/api/history/outbound-records", historyParams(fromDate, toDate, partQuery)), label: "出库" },
      { href: buildExportHref("/api/history/stocktakes", historyParams(fromDate, toDate)), label: "盘点" },
    ],
    [fromDate, toDate, partQuery],
  );

  function applyDates() {
    setFromDate(fromDateDraft);
    setToDate(toDateDraft);
    setPartQuery(partQueryDraft.trim());
  }

  function resetDates() {
    setFromDateDraft("");
    setToDateDraft("");
    setPartQueryDraft("");
    setFromDate("");
    setToDate("");
    setPartQuery("");
  }

  function applyRecentDays(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    const nextFromDate = dateToInputValue(start);
    const nextToDate = dateToInputValue(end);
    setFromDateDraft(nextFromDate);
    setToDateDraft(nextToDate);
    setFromDate(nextFromDate);
    setToDate(nextToDate);
    setPartQuery(partQueryDraft.trim());
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>历史数据</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          开始日期
          <input type="date" value={fromDateDraft} onChange={(event) => setFromDateDraft(event.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={toDateDraft} onChange={(event) => setToDateDraft(event.target.value)} />
        </label>
        <label>
          配件搜索
          <input value={partQueryDraft} onChange={(event) => setPartQueryDraft(event.target.value)} placeholder="配件编号或名称" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={applyDates}>
            搜索
          </button>
          <button className="ghost-button" type="button" onClick={resetDates}>
            重置
          </button>
          <button className="secondary-button" type="button" onClick={resetDates}>
            当前自然月
          </button>
          <button className="secondary-button" type="button" onClick={() => applyRecentDays(7)}>
            最近7天
          </button>
          <button className="secondary-button" type="button" onClick={() => applyRecentDays(15)}>
            最近15天
          </button>
          <button className="secondary-button" type="button" onClick={() => applyRecentDays(30)}>
            最近30天
          </button>
        </div>
        <div className="button-row export-row">
          {exportLinks.map((link) => (
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
          loading={loading}
          columns={[
            { key: "orderNo", header: "采购订单编号" },
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
          loading={loading}
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
          loading={loading}
          columns={[
            { key: "inboundSource", header: "入库途径" },
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
        <DataTable
          rows={data.outboundRecords}
          loading={loading}
          columns={[
            { key: "skuCode", header: "SKU码" },
            { key: "goodsCode", header: "货品编码" },
            { key: "productName", header: "产品" },
            {
              key: "productImageUrl",
              header: "产品图片",
              render: (row) => <ImageThumb src={String(row.productImageUrl ?? "")} alt={String(row.productName ?? "产品图片")} />,
            },
            { key: "storeName", header: "店铺" },
            { key: "preOutboundQuantity", header: "预出库数量" },
            { key: "actualOutboundQuantity", header: "实际出库数量" },
            { key: "outboundTime", header: "时间" },
            { key: "operatorName", header: "出库人" },
            { key: "status", header: "审核状态" },
            { key: "reviewedBy", header: "审核人" },
            { key: "reviewedAt", header: "审核时间" },
            { key: "remark", header: "备注" },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>盘点</h3>
        <DataTable
          rows={data.stocktakes}
          loading={loading}
          columns={[
            { key: "partCode", header: "配件编号" },
            { key: "partName", header: "配件" },
            {
              key: "partImageUrl",
              header: "图片",
              render: (row) => <ImageThumb src={String(row.partImageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
            },
            { key: "previousQuantity", header: "盘前数量" },
            { key: "actualQuantity", header: "盘后数量" },
            { key: "stocktakeTime", header: "盘点时间" },
            { key: "remark", header: "备注" },
          ]}
        />
      </section>
    </section>
  );
}

function historyQuery(fromDate: string, toDate: string, partQuery = "") {
  const params = new URLSearchParams();
  Object.entries(historyParams(fromDate, toDate, partQuery)).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function historyParams(fromDate: string, toDate: string, partQuery = "") {
  return {
    from: dateInputToLocalStartIso(fromDate),
    to: dateInputToLocalNextDayIso(toDate),
    partQuery: partQuery.trim(),
  };
}

function dateToInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
