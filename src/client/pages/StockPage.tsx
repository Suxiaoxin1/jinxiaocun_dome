import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, rowMatchesKeyword } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

export default function StockPage({ currentUser, params }: PageProps) {
  const [stock, setStock] = useState<AnyRow[]>([]);
  const [searchDraft, setSearchDraft] = useState(params.q ?? "");
  const [appliedSearch, setAppliedSearch] = useState(params.q ?? "");
  const [lowStockOnly, setLowStockOnly] = useState(params.lowStock === "1");
  const [editingPartId, setEditingPartId] = useState("");
  const [remark, setRemark] = useState("");
  const [purchasePart, setPurchasePart] = useState<AnyRow | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    orderNo: "",
    logisticsNo: "",
    orderQuantity: "1",
    orderTime: toDateTimeLocalValue(),
    remark: "",
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<{ stock: AnyRow[] }>("/api/stock");
      setStock(data.stock);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "库存加载失败"));
  }, []);

  useEffect(() => {
    if (params.q !== undefined) {
      setSearchDraft(params.q);
      setAppliedSearch(params.q);
    }
    if (params.lowStock !== undefined) {
      setLowStockOnly(params.lowStock === "1");
    }
  }, [params.q, params.lowStock]);

  const filteredStock = useMemo(() => {
    return stock.filter((row) => {
      if (lowStockOnly && !Boolean(row.isLowStock)) {
        return false;
      }
      return rowMatchesKeyword(row, ["partCode", "partName", "specification", "weight", "quantity", "lockedQuantity", "availableQuantity", "purchaseInTransit", "outbound7Days", "outbound14Days", "remark", "lastStocktakeAt"], appliedSearch);
    });
  }, [stock, appliedSearch, lowStockOnly]);

  const exportHref = useMemo(() => buildExportHref("/api/stock", { q: appliedSearch }), [appliedSearch]);

  function startEdit(row: AnyRow) {
    clearMessage();
    setEditingPartId(String(row.partId ?? ""));
    setRemark(String(row.remark ?? ""));
  }

  function startPurchase(row: AnyRow) {
    clearMessage();
    setEditingPartId("");
    setRemark("");
    setPurchasePart(row);
    setPurchaseForm({
      orderNo: "",
      logisticsNo: "",
      orderQuantity: "1",
      orderTime: toDateTimeLocalValue(),
      remark: "",
    });
  }

  function closePurchase() {
    clearMessage();
    setPurchasePart(null);
    setPurchaseForm({
      orderNo: "",
      logisticsNo: "",
      orderQuantity: "1",
      orderTime: toDateTimeLocalValue(),
      remark: "",
    });
  }

  async function submitRemark(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPut(`/api/stock/${editingPartId}/remark`, { remark: remark || null });
      setEditingPartId("");
      setRemark("");
      await load();
      setMessage("库存备注已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新备注失败");
    }
  }

  async function submitPurchaseOrder(event: FormEvent) {
    event.preventDefault();
    if (!purchasePart?.partId) return;
    try {
      await apiPost("/api/purchase-orders", {
        orderNo: purchaseForm.orderNo || undefined,
        logisticsNo: purchaseForm.logisticsNo || null,
        partId: String(purchasePart.partId),
        orderQuantity: Number(purchaseForm.orderQuantity),
        remark: purchaseForm.remark || null,
        orderTime: dateTimeLocalToIso(purchaseForm.orderTime),
      });
      closePurchase();
      setMessage("采购订单已创建");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采购下单失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>库存查看</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="编号、名称、规格、库存、锁定、可用、备注、盘点时间" />
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />仅低库存</label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedSearch(searchDraft)}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setSearchDraft(""); setAppliedSearch(""); setLowStockOnly(false); }}>重置</button>
          <a className="success-button" href={exportHref} role="button">导出</a>
        </div>
      </div>
      {isAdmin && editingPartId ? (
        <FormDialog title="编辑" onClose={() => { clearMessage(); setEditingPartId(""); setRemark(""); }}>
          <form className="form-grid dialog-form" onSubmit={submitRemark}>
            <label className="wide-field">
              备注
              <input value={remark} onChange={(event) => setRemark(event.target.value)} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button type="button" className="ghost-button" onClick={() => { clearMessage(); setEditingPartId(""); setRemark(""); }}>
                取 消
              </button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      {isAdmin && purchasePart ? (
        <FormDialog title="采购下单" onClose={closePurchase}>
          <form className="form-grid dialog-form" onSubmit={submitPurchaseOrder}>
            <label>
              配件
              <input value={`${String(purchasePart.partCode ?? "")} ${String(purchasePart.partName ?? "")}`.trim()} disabled />
            </label>
            <label>
              采购订单编号
              <input value={purchaseForm.orderNo} onChange={(event) => setPurchaseForm({ ...purchaseForm, orderNo: event.target.value })} placeholder="不填则自动生成" />
            </label>
            <label>
              运单号
              <input value={purchaseForm.logisticsNo} onChange={(event) => setPurchaseForm({ ...purchaseForm, logisticsNo: event.target.value })} />
            </label>
            <label>
              数量
              <input
                type="number"
                min="1"
                value={purchaseForm.orderQuantity}
                onChange={(event) => setPurchaseForm({ ...purchaseForm, orderQuantity: event.target.value })}
                required
              />
            </label>
            <label>
              下单时间
              <input
                type="datetime-local"
                value={purchaseForm.orderTime}
                onChange={(event) => setPurchaseForm({ ...purchaseForm, orderTime: event.target.value })}
                required
              />
            </label>
            <label className="wide-field">
              备注
              <input value={purchaseForm.remark} onChange={(event) => setPurchaseForm({ ...purchaseForm, remark: event.target.value })} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button type="button" className="ghost-button" onClick={closePurchase}>
                取 消
              </button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredStock}
        loading={loading}
        highlightKeyword={appliedSearch}
        columns={[
          { key: "partCode", header: "编号" },
          { key: "partName", header: "名称" },
          {
            key: "imageUrl",
            header: "图片",
            render: (row) => <ImageThumb src={String(row.imageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
          },
          { key: "specification", header: "规格" },
          { key: "weight", header: "重量" },
          { key: "quantity", header: "现货库存数量" },
          { key: "lockedQuantity", header: "锁定库存" },
          { key: "availableQuantity", header: "可用库存" },
          { key: "purchaseInTransit", header: "采购在途" },
          { key: "outbound7Days", header: "7天出库量" },
          { key: "outbound14Days", header: "14天出库量" },
          { key: "remark", header: "备注" },
          { key: "lastStocktakeAt", header: "盘点时间" },
          {
            key: "actions",
            header: "操作",
            render: (row) =>
              isAdmin ? (
                <div className="row-actions">
                  <button type="button" onClick={() => startEdit(row)}>
                    编辑备注
                  </button>
                  <button type="button" onClick={() => startPurchase(row)}>
                    采购下单
                  </button>
                </div>
              ) : "-",
          },
        ]}
      />
    </section>
  );
}
