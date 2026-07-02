import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, formatDateTime, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, dateInputToLocalNextDayIso, dateInputToLocalStartIso, rowMatchesKeyword } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

type InlineReceiptDraft = {
  orderNo: string;
  logisticsNo: string;
  inboundQuantity: string;
  inboundTime: string;
  status: string;
  remark: string;
};

const purchaseReceiptStatusOptions = [
  { value: "已下单", label: "已下单" },
  { value: "在途", label: "在途" },
  { value: "工厂缺货", label: "缺货" },
  { value: "部分入库", label: "部分入库" },
  { value: "已入库", label: "已入库" },
];
const emptyFilters = {
  codeQuery: "",
  partQuery: "",
  status: "",
  createdDate: "",
};
type ReceiptState = "pending" | "received";

export default function PurchaseReceiptsPage({ currentUser, params }: PageProps) {
  const [receipts, setReceipts] = useState<AnyRow[]>([]);
  const [inlineReceipts, setInlineReceipts] = useState<Record<string, InlineReceiptDraft>>({});
  const [receiptState, setReceiptState] = useState<ReceiptState>(() => initialReceiptState(params));
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [logisticsNo, setLogisticsNo] = useState("");
  const [inboundQuantity, setInboundQuantity] = useState("0");
  const [inboundTime, setInboundTime] = useState(toDateTimeLocalValue());
  const [status, setStatus] = useState("在途");
  const [remark, setRemark] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";

  useEffect(() => {
    setReceiptState(initialReceiptState(params));
  }, [params.receiptState, params.status]);

  async function load() {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      const routeStatus = params.status === "abnormal" ? "abnormal" : "";
      if (routeStatus) {
        queryParams.set("status", routeStatus);
      } else {
        queryParams.set("receiptState", receiptState);
      }
      if (!routeStatus && appliedFilters.status) {
        queryParams.set("status", appliedFilters.status);
      }
      if (appliedFilters.codeQuery.trim()) {
        queryParams.set("codeQuery", appliedFilters.codeQuery.trim());
      }
      if (appliedFilters.partQuery.trim()) {
        queryParams.set("partQuery", appliedFilters.partQuery.trim());
      }
      if (appliedFilters.createdDate) {
        queryParams.set("createdFrom", dateInputToLocalStartIso(appliedFilters.createdDate));
        queryParams.set("createdTo", dateInputToLocalNextDayIso(appliedFilters.createdDate));
      }
      const suffix = queryParams.toString() ? `?${queryParams.toString()}` : "";
      const data = await apiGet<{ purchaseReceipts: AnyRow[] }>(`/api/purchase-receipts${suffix}`);
      setReceipts(data.purchaseReceipts);
      setInlineReceipts(Object.fromEntries(data.purchaseReceipts.map((receipt) => [
        String(receipt.id),
        {
          orderNo: String(receipt.orderNo ?? ""),
          logisticsNo: String(receipt.logisticsNo ?? ""),
          inboundQuantity: "0",
          inboundTime: toDateTimeLocalValue(String(receipt.inboundTime ?? new Date().toISOString())),
          status: initialInlineStatus(receipt.status),
          remark: String(receipt.remark ?? ""),
        },
      ])));
      setSelectedIds([]);
      if (!purchaseOrderId && data.purchaseReceipts[0]?.purchaseOrderId) {
        setPurchaseOrderId(String(data.purchaseReceipts[0].purchaseOrderId));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "采购入库加载失败"));
  }, [params.status, receiptState, appliedFilters]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter((receipt) => {
      if (params.status !== "abnormal") {
        if (receiptState === "pending" && !["已下单", "在途", "工厂缺货", "部分入库"].includes(String(receipt.status ?? ""))) {
          return false;
        }
        if (receiptState === "received" && String(receipt.status ?? "") !== "已入库") {
          return false;
        }
      }
      if (appliedFilters.codeQuery && !rowMatchesKeyword(receipt, ["receiptNo", "orderNo", "logisticsNo"], appliedFilters.codeQuery)) return false;
      if (appliedFilters.partQuery && !rowMatchesKeyword(receipt, ["partCode", "partName"], appliedFilters.partQuery)) return false;
      if (appliedFilters.status && String(receipt.status ?? "") !== appliedFilters.status) return false;
      if (appliedFilters.createdDate && !String(receipt.createdAt ?? "").startsWith(appliedFilters.createdDate)) return false;
      return true;
    });
  }, [receipts, appliedFilters, params.status, receiptState]);

  const highlightKeyword = useMemo(() => [
    appliedFilters.codeQuery,
    appliedFilters.partQuery,
    appliedFilters.status,
    appliedFilters.createdDate,
  ].find((value) => value.trim()) ?? "", [appliedFilters]);

  const exportHref = useMemo(
    () => buildExportHref("/api/purchase-receipts", {
      receiptState: params.status === "abnormal" ? "" : receiptState,
      codeQuery: appliedFilters.codeQuery,
      partQuery: appliedFilters.partQuery,
      status: params.status === "abnormal" ? "abnormal" : appliedFilters.status,
      createdFrom: appliedFilters.createdDate ? dateInputToLocalStartIso(appliedFilters.createdDate) : "",
      createdTo: appliedFilters.createdDate ? dateInputToLocalNextDayIso(appliedFilters.createdDate) : "",
    }),
    [appliedFilters, params.status, receiptState],
  );

  function updateFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  }

  function getReceiptLogisticsNo(purchaseOrderIdValue: string) {
    return String(receipts.find((receipt) => String(receipt.purchaseOrderId ?? "") === purchaseOrderIdValue)?.logisticsNo ?? "");
  }

  function openForm() {
    clearMessage();
    const nextPurchaseOrderId = purchaseOrderId || String(receipts[0]?.purchaseOrderId ?? "");
    if (nextPurchaseOrderId && nextPurchaseOrderId !== purchaseOrderId) {
      setPurchaseOrderId(nextPurchaseOrderId);
    }
    setLogisticsNo(getReceiptLogisticsNo(nextPurchaseOrderId));
    setShowForm(true);
  }

  function closeForm() {
    clearMessage();
    setLogisticsNo("");
    setRemark("");
    setStatus("在途");
    setShowForm(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost(`/api/purchase-receipts/${purchaseOrderId}/receive`, {
        inboundQuantity: Number(inboundQuantity),
        addToExisting: true,
        logisticsNo: logisticsNo.trim() ? logisticsNo.trim() : undefined,
        status,
        remark: remark || null,
        inboundTime: dateTimeLocalToIso(inboundTime),
      });
      closeForm();
      await load();
      setMessage("采购入库已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采购入库失败");
    }
  }

  async function saveInlineReceipt(receipt: AnyRow) {
    const receiptId = String(receipt.id ?? "");
    const purchaseOrderIdValue = String(receipt.purchaseOrderId ?? "");
    const draft = inlineReceipts[receiptId];
    if (!receiptId || !purchaseOrderIdValue || !draft) {
      return;
    }
    const quantity = Number(draft.inboundQuantity);
    const nextTotal = Number(receipt.inboundQuantity ?? 0) + quantity;
    try {
      await apiPost(`/api/purchase-receipts/${purchaseOrderIdValue}/receive`, {
        orderNo: draft.orderNo.trim() || undefined,
        logisticsNo: draft.logisticsNo.trim() ? draft.logisticsNo.trim() : null,
        inboundQuantity: quantity,
        addToExisting: true,
        status: draft.status || "在途",
        remark: draft.remark || null,
        inboundTime: dateTimeLocalToIso(draft.inboundTime),
      });
      await load();
      setMessage("到货数量已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存到货数量失败");
    }
  }

  function updateInlineReceipt(receiptId: string, patch: Partial<InlineReceiptDraft>) {
    setInlineReceipts((current) => ({
      ...current,
      [receiptId]: {
        orderNo: current[receiptId]?.orderNo ?? "",
        logisticsNo: current[receiptId]?.logisticsNo ?? "",
        inboundQuantity: current[receiptId]?.inboundQuantity ?? "0",
        inboundTime: current[receiptId]?.inboundTime ?? toDateTimeLocalValue(),
        status: current[receiptId]?.status ?? "",
        remark: current[receiptId]?.remark ?? "",
        ...patch,
      },
    }));
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条采购入库记录？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/purchase-receipts/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("采购入库已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除采购入库失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>采购入库</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      {params.status === "abnormal" ? null : (
        <div className="view-tabs" role="tablist" aria-label="采购入库视图">
          <button
            className={receiptState === "pending" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={receiptState === "pending"}
            onClick={() => setReceiptState("pending")}
          >
            待入库
          </button>
          <button
            className={receiptState === "received" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={receiptState === "received"}
            onClick={() => setReceiptState("received")}
          >
            已入库
          </button>
        </div>
      )}
      <div className="toolbar filter-panel">
        <label>
          入库单号 / 采购订单编号 / 运单号
          <input value={filters.codeQuery} onChange={(event) => updateFilter("codeQuery", event.target.value)} placeholder="请输入单号" />
        </label>
        <label>
          配件
          <input value={filters.partQuery} onChange={(event) => updateFilter("partQuery", event.target.value)} placeholder="请输入配件" />
        </label>
        <label>
          状态
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">全部状态</option>
            {purchaseReceiptStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          新增时间
          <input type="date" value={filters.createdDate} onChange={(event) => updateFilter("createdDate", event.target.value)} />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedFilters(filters)}>搜索</button>
          <button className="ghost-button" type="button" onClick={clearFilters}>重置</button>
          {isAdmin ? (
            <button className="secondary-button" type="button" onClick={openForm}>
              新增
            </button>
          ) : null}
          <a className="success-button" href={exportHref} role="button">导出</a>
          {isAdmin ? (
            <button className="danger-button" type="button" disabled={selectedIds.length === 0} onClick={() => void removeSelected()}>
              删除
            </button>
          ) : null}
        </div>
      </div>
      {isAdmin && showForm ? (
        <FormDialog title="新增" size="large" onClose={closeForm}>
          <form id="purchase-receipt-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              待入库订单
              <select
                value={purchaseOrderId}
                onChange={(event) => {
                  const value = event.target.value;
                  setPurchaseOrderId(value);
                  setLogisticsNo((current) => (current.trim() ? current : getReceiptLogisticsNo(value)));
                }}
                required
              >
                <option value="">选择订单</option>
                {receipts.map((receipt) => (
                  <option key={String(receipt.id)} value={String(receipt.purchaseOrderId)}>
                    {String(receipt.orderNo)} {String(receipt.partName)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              运单号
              <input maxLength={100} value={logisticsNo} onChange={(event) => setLogisticsNo(event.target.value)} />
            </label>
            <label>
              入库数量
              <input type="number" min="0" value={inboundQuantity} onChange={(event) => setInboundQuantity(event.target.value)} required />
            </label>
            <label>
              状态
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {purchaseReceiptStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              入库时间
              <input
                type="datetime-local"
                value={inboundTime}
                onChange={(event) => setInboundTime(event.target.value)}
                required
              />
            </label>
            <label className="wide-field">
              备注
              <input value={remark} onChange={(event) => setRemark(event.target.value)} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button className="ghost-button" type="button" onClick={closeForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <div className="purchase-receipts-table">
        <DataTable
          rows={filteredReceipts}
          loading={loading}
          highlightKeyword={highlightKeyword}
          selectable={isAdmin}
          selectedRowIds={selectedIds}
          onSelectedRowIdsChange={setSelectedIds}
          columns={[
          { key: "receiptNo", header: "入库单号", render: (receipt) => compactText(receipt.receiptNo, "receipt-no-compact") },
          {
            key: "orderNo",
            header: "采购订单编号",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <label className="inline-arrival-cell">
                  采购订单编号
                  <input
                    className="table-input compact-code-input"
                    title={draft?.orderNo ?? ""}
                    value={draft?.orderNo ?? ""}
                    onChange={(event) => updateInlineReceipt(id, { orderNo: event.target.value })}
                  />
                </label>
              ) : compactText(receipt.orderNo, "order-no-compact");
            },
          },
          {
            key: "logisticsNo",
            header: "运单号",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <label className="inline-arrival-cell">
                  运单号
                  <input
                    className="table-input compact-code-input"
                    title={draft?.logisticsNo ?? ""}
                    maxLength={100}
                    value={draft?.logisticsNo ?? ""}
                    onChange={(event) => updateInlineReceipt(id, { logisticsNo: event.target.value })}
                  />
                </label>
              ) : compactText(receipt.logisticsNo, "logistics-no-compact");
            },
          },
          { key: "partName", header: "配件", render: (receipt) => compactText(receipt.partName, "part-name-compact") },
          {
            key: "partImageUrl",
            header: "图片",
            render: (receipt) => <ImageThumb src={String(receipt.partImageUrl ?? "")} alt={String(receipt.partName ?? "配件图片")} />,
          },
          {
            key: "purchaseQuantity",
            header: "采购数",
            className: "quantity-emphasis-column",
            render: (receipt) => <span className="quantity-badge purchase-quantity-badge">{String(receipt.purchaseQuantity ?? "-")}</span>,
          },
          {
            key: "currentStock",
            header: "现货库存数量",
            render: (receipt) => <span className="compact-number">{String(receipt.currentStock ?? "-")}</span>,
          },
          {
            key: "inboundQuantity",
            header: "已入库",
            className: "inbound-emphasis-column",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              const inboundQuantityValue = Number(receipt.inboundQuantity ?? 0);
              const purchaseQuantityValue = Number(receipt.purchaseQuantity ?? 0);
              return isAdmin ? (
                <div className="inline-arrival-cell">
                  <div className={`receipt-progress ${receiptProgressTone(inboundQuantityValue, purchaseQuantityValue)}`}>
                    <span className="receipt-progress-label">已入库</span>
                    <strong className="receipt-progress-value">{`${inboundQuantityValue} / ${purchaseQuantityValue}`}</strong>
                  </div>
                  <label>
                    本次到货
                    <input
                      className="table-input compact-arrival-input"
                      type="number"
                      min="0"
                      value={draft?.inboundQuantity ?? "0"}
                      onChange={(event) => updateInlineReceipt(id, { inboundQuantity: event.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <div className={`receipt-progress ${receiptProgressTone(inboundQuantityValue, purchaseQuantityValue)}`}>
                  <span className="receipt-progress-label">已入库</span>
                  <strong className="receipt-progress-value">{`${inboundQuantityValue} / ${purchaseQuantityValue}`}</strong>
                </div>
              );
            },
          },
          {
            key: "status",
            header: "状态",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <label className="inline-arrival-cell">
                  状态
                  <select className="table-input compact-status-select" value={draft?.status ?? ""} onChange={(event) => updateInlineReceipt(id, { status: event.target.value })}>
                    {purchaseReceiptStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ) : (
                <span className={String(receipt.status ?? "") === "已入库" ? "status-badge success" : "status-badge warning"}>
                  {String(receipt.status ?? "")}
                </span>
              );
            },
          },
          { key: "orderTime", header: "下单时间", render: (receipt) => compactDateText(receipt.orderTime) },
          {
            key: "inboundTime",
            header: "到货时间",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <label className="inline-arrival-cell">
                  到货时间
                  <input
                    className="table-datetime-input compact-date-input"
                    title={draft?.inboundTime ?? ""}
                    type="datetime-local"
                    value={draft?.inboundTime ?? toDateTimeLocalValue(String(receipt.inboundTime ?? new Date().toISOString()))}
                    onChange={(event) => updateInlineReceipt(id, { inboundTime: event.target.value })}
                  />
                </label>
              ) : compactDateText(receipt.inboundTime);
            },
          },
          {
            key: "remark",
            header: "备注",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <label className="inline-arrival-cell">
                  备注
                  <input
                    className="table-input compact-remark-input"
                    title={draft?.remark ?? ""}
                    value={draft?.remark ?? ""}
                    onChange={(event) => updateInlineReceipt(id, { remark: event.target.value })}
                  />
                </label>
              ) : String(receipt.remark ?? "-");
            },
          },
          {
            key: "actions",
            header: "操作",
            render: (receipt) => isAdmin ? (
              <button className="compact-action-button" type="button" onClick={() => void saveInlineReceipt(receipt)}>保存到货</button>
            ) : "-",
          },
          ]}
        />
      </div>
    </section>
  );
}

function compactText(value: unknown, className = "") {
  const text = displayText(value);
  return <span className={["compact-cell-text", className].filter(Boolean).join(" ")} title={text}>{text}</span>;
}

function compactDateText(value: unknown) {
  const text = displayText(value);
  const display = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? formatDateTime(value) : text;
  return <span className="compact-cell-text compact-date-text" title={display}>{display}</span>;
}

function displayText(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function receiptProgressTone(inboundQuantity: number, purchaseQuantity: number) {
  if (purchaseQuantity > 0 && inboundQuantity > purchaseQuantity) {
    return "danger";
  }
  if (purchaseQuantity > 0 && inboundQuantity >= purchaseQuantity) {
    return "success";
  }
  if (inboundQuantity > 0) {
    return "warning";
  }
  return "pending";
}

function initialInlineStatus(status: unknown) {
  const value = String(status ?? "");
  if (value === "工厂缺货" || value === "缺货") return "工厂缺货";
  if (value === "已入库" || value === "全部入库") return "已入库";
  return "在途";
}

function initialReceiptState(params: Record<string, string>): ReceiptState {
  return params.receiptState === "received" ? "received" : "pending";
}
