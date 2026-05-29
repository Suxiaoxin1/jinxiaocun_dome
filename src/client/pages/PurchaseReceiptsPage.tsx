import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

export default function PurchaseReceiptsPage({ params }: PageProps) {
  const [receipts, setReceipts] = useState<AnyRow[]>([]);
  const [search, setSearch] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [inboundQuantity, setInboundQuantity] = useState("0");
  const [status, setStatus] = useState("部分签收");
  const [remark, setRemark] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const suffix = params.status === "pending" ? "?status=pending" : "";
    const data = await apiGet<{ purchaseReceipts: AnyRow[] }>(`/api/purchase-receipts${suffix}`);
    setReceipts(data.purchaseReceipts);
    if (!purchaseOrderId && data.purchaseReceipts[0]?.purchaseOrderId) {
      setPurchaseOrderId(String(data.purchaseReceipts[0].purchaseOrderId));
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "采购入库加载失败"));
  }, [params.status]);

  const filteredReceipts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return receipts;
    return receipts.filter((receipt) =>
      `${receipt.receiptNo ?? ""} ${receipt.orderNo ?? ""} ${receipt.partName ?? ""} ${receipt.remark ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [receipts, search]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost(`/api/purchase-receipts/${purchaseOrderId}/receive`, {
        inboundQuantity: Number(inboundQuantity),
        status,
        remark: remark || null,
        inboundTime: new Date().toISOString(),
      });
      setRemark("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采购入库失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>采购入库</h2>
        <a className="secondary-button" href="/api/purchase-receipts.csv">导出采购入库</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="入库单、配件、备注" />
        </label>
      </div>
      <form className="form-grid" onSubmit={submit}>
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
            <option value="在途">在途</option>
            <option value="部分签收">部分签收</option>
            <option value="已签收">已签收</option>
          </select>
        </label>
        <label className="wide-field">
          备注
          <input value={remark} onChange={(event) => setRemark(event.target.value)} />
        </label>
        <div className="form-actions">
          <button className="primary-button" type="submit">确认入库</button>
        </div>
      </form>
      <DataTable
        rows={filteredReceipts}
        columns={[
          { key: "receiptNo", header: "入库单号" },
          { key: "orderNo", header: "采购订单" },
          { key: "partName", header: "配件" },
          { key: "purchaseQuantity", header: "采购数" },
          { key: "inboundQuantity", header: "已入库" },
          { key: "inboundTime", header: "到货时间" },
          { key: "remark", header: "备注" },
        ]}
      />
    </section>
  );
}
