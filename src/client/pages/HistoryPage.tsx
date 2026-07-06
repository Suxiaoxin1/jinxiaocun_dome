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

type TabKey = "purchaseOrders" | "purchaseReceipts" | "otherInbounds" | "outboundRecords" | "stocktakes";

interface TabConfig {
  key: TabKey;
  label: string;
  dataKey: keyof HistoryResponse;
  exportPath: string;
}

const tabs: TabConfig[] = [
  { key: "purchaseOrders", label: "采购订单", dataKey: "purchaseOrders", exportPath: "/api/history/purchase-orders" },
  { key: "purchaseReceipts", label: "采购入库", dataKey: "purchaseReceipts", exportPath: "/api/history/purchase-receipts" },
  { key: "otherInbounds", label: "其它入库", dataKey: "otherInbounds", exportPath: "/api/history/other-inbounds" },
  { key: "outboundRecords", label: "出库", dataKey: "outboundRecords", exportPath: "/api/history/outbound-records" },
  { key: "stocktakes", label: "盘点", dataKey: "stocktakes", exportPath: "/api/history/stocktakes" },
];

const pageSizeOptions = [10, 20, 50, 100];

export default function HistoryPage(_props: PageProps) {
  const [fromDateDraft, setFromDateDraft] = useState("");
  const [toDateDraft, setToDateDraft] = useState("");
  const [partQueryDraft, setPartQueryDraft] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [partQuery, setPartQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("purchaseOrders");
  const [pagination, setPagination] = useState<Record<TabKey, { page: number; pageSize: number }>>({
    purchaseOrders: { page: 1, pageSize: 20 },
    purchaseReceipts: { page: 1, pageSize: 20 },
    otherInbounds: { page: 1, pageSize: 20 },
    outboundRecords: { page: 1, pageSize: 20 },
    stocktakes: { page: 1, pageSize: 20 },
  });
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

  const activeConfig = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const activeRows = data[activeConfig.dataKey] as AnyRow[];
  const { page, pageSize } = pagination[activeTab];
  const total = activeRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedRows = useMemo(() => activeRows.slice(pageStart, pageStart + pageSize), [activeRows, pageStart, pageSize]);

  const exportLink = useMemo(
    () => buildExportHref(activeConfig.exportPath, historyParams(fromDate, toDate, activeTab === "outboundRecords" ? partQuery : "")),
    [activeConfig.exportPath, activeTab, fromDate, toDate, partQuery],
  );

  function applyDates() {
    setFromDate(fromDateDraft);
    setToDate(toDateDraft);
    setPartQuery(partQueryDraft.trim());
    resetAllPages();
  }

  function resetDates() {
    setFromDateDraft("");
    setToDateDraft("");
    setPartQueryDraft("");
    setFromDate("");
    setToDate("");
    setPartQuery("");
    resetAllPages();
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
    resetAllPages();
  }

  function resetAllPages() {
    setPagination((current) => {
      const next: Record<TabKey, { page: number; pageSize: number }> = { ...current };
      (Object.keys(next) as TabKey[]).forEach((key) => {
        next[key] = { ...next[key], page: 1 };
      });
      return next;
    });
  }

  function setActivePage(nextPage: number) {
    setPagination((current) => ({
      ...current,
      [activeTab]: { ...current[activeTab], page: Math.max(1, Math.min(nextPage, totalPages)) },
    }));
  }

  function setActivePageSize(nextPageSize: number) {
    setPagination((current) => ({
      ...current,
      [activeTab]: { ...current[activeTab], pageSize: nextPageSize, page: 1 },
    }));
  }

  function switchTab(nextTab: TabKey) {
    setActiveTab(nextTab);
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
          <a className="secondary-button" href={exportLink}>
            下载{activeConfig.label}
          </a>
        </div>
      </div>
      <div className="history-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`history-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => switchTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section className="content-section history-section">
        <h3>{activeConfig.label}</h3>
        <div className="pagination-bar">
          <span>共 {total} 项</span>
          <button
            type="button"
            className="ghost-button"
            disabled={page <= 1}
            onClick={() => setActivePage(page - 1)}
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页
          </span>
          <button
            type="button"
            className="ghost-button"
            disabled={page >= totalPages}
            onClick={() => setActivePage(page + 1)}
          >
            下一页
          </button>
          <label>
            每页显示
            <select
              value={pageSize}
              onChange={(event) => setActivePageSize(Number(event.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            条
          </label>
        </div>
        {activeTab === "purchaseOrders" ? (
          <DataTable
            rows={pagedRows}
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
        ) : null}
        {activeTab === "purchaseReceipts" ? (
          <DataTable
            rows={pagedRows}
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
        ) : null}
        {activeTab === "otherInbounds" ? (
          <DataTable
            rows={pagedRows}
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
        ) : null}
        {activeTab === "outboundRecords" ? (
          <DataTable
            rows={pagedRows}
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
        ) : null}
        {activeTab === "stocktakes" ? (
          <DataTable
            rows={pagedRows}
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
        ) : null}
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
