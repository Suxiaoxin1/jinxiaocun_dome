import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, rowMatchesKeyword } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

type InlineReceiptDraft = {
  inboundQuantity: string;
  inboundTime: string;
};

export default function PurchaseReceiptsPage({ currentUser, params }: PageProps) {
  const [receipts, setReceipts] = useState<AnyRow[]>([]);
  const [inlineReceipts, setInlineReceipts] = useState<Record<string, InlineReceiptDraft>>({});
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [inboundQuantity, setInboundQuantity] = useState("0");
  const [inboundTime, setInboundTime] = useState(toDateTimeLocalValue());
  const [status, setStatus] = useState("部分签收");
  const [remark, setRemark] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";

  async function load() {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      const effectiveStatus = params.status === "pending" || params.status === "abnormal" ? params.status : statusFilter;
      if (params.status === "pending" || params.status === "abnormal") {
        queryParams.set("status", effectiveStatus);
      } else if (effectiveStatus) {
        queryParams.set("status", effectiveStatus);
      }
      if (query.trim()) {
        queryParams.set("q", query.trim());
      }
      const suffix = queryParams.toString() ? `?${queryParams.toString()}` : "";
      const data = await apiGet<{ purchaseReceipts: AnyRow[] }>(`/api/purchase-receipts${suffix}`);
      setReceipts(data.purchaseReceipts);
      setInlineReceipts(Object.fromEntries(data.purchaseReceipts.map((receipt) => [
        String(receipt.id),
        {
          inboundQuantity: "0",
          inboundTime: toDateTimeLocalValue(String(receipt.inboundTime ?? new Date().toISOString())),
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
  }, [params.status, query, statusFilter]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter((receipt) =>
      rowMatchesKeyword(receipt, ["receiptNo", "orderNo", "logisticsNo", "partCode", "partName", "status", "inboundTime", "remark"], query),
    );
  }, [receipts, query]);

  const exportHref = useMemo(
    () => buildExportHref("/api/purchase-receipts", {
      q: query,
      status: params.status === "pending" || params.status === "abnormal" ? params.status : statusFilter,
    }),
    [query, params.status, statusFilter],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost(`/api/purchase-receipts/${purchaseOrderId}/receive`, {
        inboundQuantity: Number(inboundQuantity),
        addToExisting: true,
        status,
        remark: remark || null,
        inboundTime: dateTimeLocalToIso(inboundTime),
      });
      setRemark("");
      clearMessage();
      setShowForm(false);
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
        inboundQuantity: quantity,
        addToExisting: true,
        status: deriveReceiptStatus(nextTotal, Number(receipt.purchaseQuantity ?? 0)),
        remark: receipt.remark ?? null,
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
        inboundQuantity: current[receiptId]?.inboundQuantity ?? "0",
        inboundTime: current[receiptId]?.inboundTime ?? toDateTimeLocalValue(),
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
      <div className="toolbar">
        <label>
          搜索
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="入库单、物流、配件、状态、备注" />
        </label>
        <label>
          状态
          <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
            <option value="">全部状态</option>
            <option value="缺货">缺货</option>
            <option value="在途">在途</option>
            <option value="部分签收">部分签收</option>
            <option value="已签收">已签收</option>
          </select>
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => { setQuery(searchDraft); setStatusFilter(statusDraft); }}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setSearchDraft(""); setQuery(""); setStatusDraft(""); setStatusFilter(""); }}>重置</button>
          {isAdmin ? (
            <button className="secondary-button" type="button" onClick={() => { clearMessage(); setShowForm(true); }}>
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
        <FormDialog title="新增" size="large" onClose={() => { clearMessage(); setShowForm(false); }}>
          <form id="purchase-receipt-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              待入库订单
              <select value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)} required>
                <option value="">选择订单</option>
                {receipts.map((receipt) => (
                  <option key={String(receipt.id)} value={String(receipt.purchaseOrderId)}>
                    {String(receipt.orderNo)} {String(receipt.partName)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              入库数量
              <input type="number" min="0" value={inboundQuantity} onChange={(event) => setInboundQuantity(event.target.value)} required />
            </label>
            <label>
              状态
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="缺货">缺货</option>
                <option value="在途">在途</option>
                <option value="部分签收">部分签收</option>
                <option value="已签收">已签收</option>
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
              <button className="ghost-button" type="button" onClick={() => { clearMessage(); setShowForm(false); }}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredReceipts}
        loading={loading}
        highlightKeyword={query}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "receiptNo", header: "入库单号" },
          { key: "orderNo", header: "采购订单" },
          { key: "logisticsNo", header: "物流单号" },
          { key: "partName", header: "配件" },
          {
            key: "partImageUrl",
            header: "图片",
            render: (receipt) => <ImageThumb src={String(receipt.partImageUrl ?? "")} alt={String(receipt.partName ?? "配件图片")} />,
          },
          { key: "purchaseQuantity", header: "采购数" },
          { key: "currentStock", header: "当前库存" },
          {
            key: "inboundQuantity",
            header: "已入库",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <div className="inline-arrival-cell">
                  <span>已入库：{String(receipt.inboundQuantity ?? 0)}</span>
                  <label>
                    本次到货
                    <input
                      className="table-input"
                      type="number"
                      min="0"
                      value={draft?.inboundQuantity ?? "0"}
                      onChange={(event) => updateInlineReceipt(id, { inboundQuantity: event.target.value })}
                    />
                  </label>
                </div>
              ) : String(receipt.inboundQuantity ?? "-");
            },
          },
          {
            key: "status",
            header: "状态",
            render: (receipt) => (
              <span className={String(receipt.status ?? "") === "已签收" ? "status-badge success" : "status-badge warning"}>
                {String(receipt.status ?? "")}
              </span>
            ),
          },
          { key: "orderTime", header: "下单时间" },
          {
            key: "inboundTime",
            header: "到货时间",
            render: (receipt) => {
              const id = String(receipt.id ?? "");
              const draft = inlineReceipts[id];
              return isAdmin ? (
                <input
                  className="table-datetime-input"
                  type="datetime-local"
                  value={draft?.inboundTime ?? toDateTimeLocalValue(String(receipt.inboundTime ?? new Date().toISOString()))}
                  onChange={(event) => updateInlineReceipt(id, { inboundTime: event.target.value })}
                />
              ) : String(receipt.inboundTime ?? "-");
            },
          },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (receipt) => isAdmin ? (
              <button type="button" onClick={() => void saveInlineReceipt(receipt)}>保存到货</button>
            ) : "-",
          },
        ]}
      />
    </section>
  );
}

function deriveReceiptStatus(inboundQuantity: number, purchaseQuantity: number) {
  if (inboundQuantity <= 0) {
    return "在途";
  }
  return inboundQuantity >= purchaseQuantity ? "已签收" : "部分签收";
}
