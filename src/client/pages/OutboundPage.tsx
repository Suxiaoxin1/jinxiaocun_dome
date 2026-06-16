import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, dateInputToLocalNextDayIso, dateInputToLocalStartIso, rowMatchesKeyword, selectFirstVisibleOption } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

const emptyOutboundFilters = {
  fromDate: "",
  toDate: "",
  productCode: "",
  productName: "",
  storeName: "",
  operatorName: "",
  remark: "",
};

export default function OutboundPage({ currentUser }: PageProps) {
  const [records, setRecords] = useState<AnyRow[]>([]);
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [stores, setStores] = useState<AnyRow[]>([]);
  const [form, setForm] = useState({
    productId: "",
    storeId: "",
    outboundQuantity: "1",
    outboundTime: toDateTimeLocalValue(),
    operatorName: currentUser.displayName,
    remark: "",
  });
  const [filters, setFilters] = useState(emptyOutboundFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyOutboundFilters);
  const [productSearch, setProductSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const isAdmin = currentUser.role === "admin";
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();

  async function load() {
    setLoading(true);
    try {
      const recordQuery = new URLSearchParams();
      Object.entries(toOutboundQueryParams(appliedFilters)).forEach(([key, value]) => {
        if (value.trim()) {
          recordQuery.set(key, value.trim());
        }
      });
      const recordSuffix = recordQuery.toString() ? `?${recordQuery.toString()}` : "";
      const [recordData, productData, storeData] = await Promise.all([
        apiGet<{ outboundRecords: AnyRow[] }>(`/api/outbound-records${recordSuffix}`),
        apiGet<{ products: AnyRow[] }>("/api/products"),
        apiGet<{ stores: AnyRow[] }>("/api/stores?status=active"),
      ]);
      setRecords(recordData.outboundRecords);
      setSelectedIds([]);
      setProducts(productData.products);
      setStores(storeData.stores);
      if (!form.productId && productData.products[0]?.id) {
        setForm((current) => ({ ...current, productId: String(productData.products[0].id) }));
      }
      setForm((current) => {
        const currentStoreStillActive = storeData.stores.some((store) => String(store.id) === current.storeId);
        if (current.storeId && currentStoreStillActive) {
          return current;
        }
        return { ...current, storeId: String(storeData.stores[0]?.id ?? "") };
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "出库加载失败"));
  }, [appliedFilters]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await apiPost<{ outboundRecord: AnyRow }>("/api/outbound-records", {
        productId: form.productId,
        storeId: form.storeId,
        outboundQuantity: Number(form.outboundQuantity),
        outboundTime: dateTimeLocalToIso(form.outboundTime),
        operatorName: form.operatorName,
        remark: form.remark || null,
      });
      const warnings = Array.isArray(response.outboundRecord.warnings) ? response.outboundRecord.warnings : [];
      const savedMessage = warnings.length > 0 ? warnings.map(String).join("；") : "出库已保存";
      clearMessage();
      setShowForm(false);
      await load();
      setMessage(savedMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存出库失败");
    }
  }

  const filteredRecords = useMemo(() => {
    return records;
  }, [records]);

  const exportHref = useMemo(() => buildExportHref("/api/outbound-records", toOutboundQueryParams(appliedFilters)), [appliedFilters]);
  const highlightKeyword = useMemo(() => [
    appliedFilters.productCode,
    appliedFilters.productName,
    appliedFilters.storeName,
    appliedFilters.operatorName,
    appliedFilters.remark,
  ].find((value) => value.trim()) ?? "", [appliedFilters]);
  const operatorOptions = useMemo(
    () => uniqueTexts([currentUser.displayName, ...records.map((record) => record.operatorName)]),
    [currentUser.displayName, records],
  );
  const filteredProducts = useMemo(
    () => products.filter((product) => rowMatchesKeyword(product, ["code", "name", "remark"], productSearch)),
    [products, productSearch],
  );

  useEffect(() => {
    if (!showForm || !productSearch.trim()) {
      return;
    }
    setForm((current) => ({ ...current, productId: selectFirstVisibleOption(filteredProducts, current.productId) }));
  }, [filteredProducts, productSearch, showForm]);

  function applyFilters() {
    if (isDateRangeOverLimit(filters.fromDate, filters.toDate, 90)) {
      setMessage("出库时间范围不能超过90天");
      return;
    }
    clearMessage();
    setAppliedFilters(filters);
  }

  async function remove(record: AnyRow) {
    if (!record.id) return;
    if (!window.confirm(`确认删除出库记录 ${String(record.productName ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/outbound-records/${record.id}`);
      await load();
      setMessage("出库记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除出库失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条出库记录？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/outbound-records/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("出库记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除出库失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>出库管理</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar filter-panel">
        <label>
          开始日期
          <input type="date" value={filters.fromDate} onChange={(event) => setFilters({ ...filters, fromDate: event.target.value })} />
        </label>
        <label>
          结束日期
          <input type="date" value={filters.toDate} onChange={(event) => setFilters({ ...filters, toDate: event.target.value })} />
        </label>
        <label>
          产品编号
          <input value={filters.productCode} onChange={(event) => setFilters({ ...filters, productCode: event.target.value })} placeholder="产品编号" />
        </label>
        <label>
          产品名称
          <input value={filters.productName} onChange={(event) => setFilters({ ...filters, productName: event.target.value })} placeholder="产品名称" />
        </label>
        <label>
          店铺
          <input value={filters.storeName} onChange={(event) => setFilters({ ...filters, storeName: event.target.value })} placeholder="店铺名称" />
        </label>
        <label>
          出库人
          <input value={filters.operatorName} onChange={(event) => setFilters({ ...filters, operatorName: event.target.value })} placeholder="出库人" />
        </label>
        <label>
          备注
          <input value={filters.remark} onChange={(event) => setFilters({ ...filters, remark: event.target.value })} placeholder="备注" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={applyFilters}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setFilters(emptyOutboundFilters); setAppliedFilters(emptyOutboundFilters); }}>重置</button>
          <button className="secondary-button" type="button" onClick={() => { clearMessage(); setProductSearch(""); setShowForm(true); }}>
            新增
          </button>
          <a className="success-button" href={exportHref} role="button">导出</a>
          {isAdmin ? (
            <button className="danger-button" type="button" disabled={selectedIds.length === 0} onClick={() => void removeSelected()}>
              删除
            </button>
          ) : null}
        </div>
      </div>
      {showForm ? (
        <FormDialog title="新增" onClose={() => { clearMessage(); setProductSearch(""); setShowForm(false); }}>
          <form id="outbound-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              搜索产品
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="输入产品编号或名称" />
            </label>
            <label>
              产品
              <select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} required>
                <option value="">选择产品</option>
                {filteredProducts.map((product) => (
                  <option key={String(product.id)} value={String(product.id)}>
                    {String(product.code ?? "")} {String(product.name ?? "")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              店铺
              <select value={form.storeId} onChange={(event) => setForm({ ...form, storeId: event.target.value })} required>
                <option value="">选择店铺</option>
                {stores.map((store) => (
                  <option key={String(store.id)} value={String(store.id)}>
                    {String(store.name ?? "")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              数量
              <input type="number" min="1" value={form.outboundQuantity} onChange={(event) => setForm({ ...form, outboundQuantity: event.target.value })} required />
            </label>
            <label>
              出库时间
              <input
                type="datetime-local"
                value={form.outboundTime}
                onChange={(event) => setForm({ ...form, outboundTime: event.target.value })}
                required
              />
            </label>
            <label>
              出库人
              <select value={form.operatorName} onChange={(event) => setForm({ ...form, operatorName: event.target.value })} required>
                {operatorOptions.map((operatorName) => (
                  <option key={operatorName} value={operatorName}>
                    {operatorName}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide-field">
              备注
              <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button className="ghost-button" type="button" onClick={() => { clearMessage(); setProductSearch(""); setShowForm(false); }}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredRecords}
        loading={loading}
        highlightKeyword={highlightKeyword}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "productCode", header: "产品编号" },
          { key: "productName", header: "产品" },
          {
            key: "productImageUrl",
            header: "产品图片",
            render: (record) => <ImageThumb src={String(record.productImageUrl ?? "")} alt={`${String(record.productName ?? "产品")}图片`} />,
          },
          { key: "storeName", header: "店铺" },
          { key: "outboundQuantity", header: "数量" },
          { key: "outboundTime", header: "时间" },
          { key: "operatorName", header: "出库人" },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (record) => (isAdmin ? <button type="button" onClick={() => remove(record)}>删除</button> : "-"),
          },
        ]}
      />
    </section>
  );
}

function toOutboundQueryParams(filters: typeof emptyOutboundFilters) {
  return {
    from: dateInputToLocalStartIso(filters.fromDate),
    to: dateInputToLocalNextDayIso(filters.toDate),
    productCode: filters.productCode,
    productName: filters.productName,
    storeName: filters.storeName,
    operatorName: filters.operatorName,
    remark: filters.remark,
  };
}

function uniqueTexts(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function isDateRangeOverLimit(fromDate: string, toDate: string, maxDays: number) {
  if (!fromDate || !toDate) {
    return false;
  }
  const from = new Date(`${fromDate}T00:00:00`).getTime();
  const to = new Date(`${toDate}T00:00:00`).getTime();
  return to >= from && (to - from) / 86400000 > maxDays;
}
