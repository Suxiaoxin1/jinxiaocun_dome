import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, rowMatchesKeyword, selectFirstVisibleOption } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

const emptyFilters = {
  orderNo: "",
  logisticsNo: "",
  partId: "",
  status: "",
  orderDate: "",
  remark: "",
};

export default function PurchaseOrdersPage({ currentUser, params }: PageProps) {
  const [orders, setOrders] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [partSearch, setPartSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [showForm, setShowForm] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    orderNo: "",
    logisticsNo: "",
    partId: "",
    orderQuantity: "1",
    status: "在途",
    remark: "",
    orderTime: toDateTimeLocalValue(),
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";
  const filteredParts = useMemo(
    () => parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], partSearch)),
    [parts, partSearch],
  );

  async function load() {
    setLoading(true);
    try {
      const [orderData, partData] = await Promise.all([
        apiGet<{ purchaseOrders: AnyRow[] }>("/api/purchase-orders"),
        apiGet<{ parts: AnyRow[] }>("/api/parts"),
      ]);
      setOrders(orderData.purchaseOrders);
      setSelectedIds([]);
      setParts(partData.parts);
      const preferredPartId = params.partId || String(partData.parts[0]?.id ?? "");
      if ((!form.partId || params.partId) && preferredPartId) {
        setForm((current) => ({ ...current, partId: preferredPartId }));
      }
      if (params.partId && isAdmin) {
        setFilters((current) => ({ ...current, partId: params.partId ?? "" }));
        setAppliedFilters((current) => ({ ...current, partId: params.partId ?? "" }));
        clearMessage();
        setEditingOrderId("");
        setShowForm(true);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "采购订单加载失败"));
  }, [params.partId]);

  const filteredOrders = useMemo(() => {
    const normalizedFilters = {
      orderNo: appliedFilters.orderNo.trim().toLowerCase(),
      logisticsNo: appliedFilters.logisticsNo.trim().toLowerCase(),
      status: appliedFilters.status,
      orderDate: appliedFilters.orderDate,
      remark: appliedFilters.remark.trim().toLowerCase(),
    };
    return orders.filter((order) => {
      if (normalizedFilters.orderNo && !String(order.orderNo ?? "").toLowerCase().includes(normalizedFilters.orderNo)) return false;
      if (normalizedFilters.logisticsNo && !String(order.logisticsNo ?? "").toLowerCase().includes(normalizedFilters.logisticsNo)) return false;
      if (appliedFilters.partId && String(order.partId ?? "") !== appliedFilters.partId) return false;
      if (normalizedFilters.status && String(order.status ?? "") !== normalizedFilters.status) return false;
      if (normalizedFilters.orderDate && !String(order.orderTime ?? "").startsWith(normalizedFilters.orderDate)) return false;
      if (normalizedFilters.remark && !String(order.remark ?? "").toLowerCase().includes(normalizedFilters.remark)) return false;
      return true;
    });
  }, [orders, appliedFilters]);

  const exportHref = useMemo(() => buildExportHref("/api/purchase-orders", appliedFilters), [appliedFilters]);
  const highlightKeyword = useMemo(() => [
    appliedFilters.orderNo,
    appliedFilters.logisticsNo,
    appliedFilters.orderDate,
    appliedFilters.remark,
  ].find((value) => value.trim()) ?? "", [appliedFilters]);

  function updateFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilter(key: keyof typeof emptyFilters) {
    setFilters((current) => ({ ...current, [key]: "" }));
    setAppliedFilters((current) => ({ ...current, [key]: "" }));
  }

  function openAddForm() {
    clearMessage();
    setEditingOrderId("");
    setPartSearch("");
    setForm((current) => ({
      ...current,
      orderNo: "",
      logisticsNo: "",
      orderQuantity: "1",
      status: "在途",
      remark: "",
      orderTime: toDateTimeLocalValue(),
    }));
    setShowForm(true);
  }

  function closeForm() {
    clearMessage();
    setEditingOrderId("");
    setPartSearch("");
    setShowForm(false);
  }

  function startEdit(order: AnyRow) {
    clearMessage();
    setEditingOrderId(String(order.id ?? ""));
    setPartSearch("");
    setForm({
      orderNo: String(order.orderNo ?? ""),
      logisticsNo: String(order.logisticsNo ?? ""),
      partId: String(order.partId ?? form.partId),
      orderQuantity: String(order.orderQuantity ?? "1"),
      status: String(order.status ?? "在途"),
      remark: String(order.remark ?? ""),
      orderTime: toDateTimeLocalValue(String(order.orderTime ?? new Date().toISOString())),
    });
    setShowForm(true);
  }

  useEffect(() => {
    if (!showForm || !partSearch.trim()) {
      return;
    }
    setForm((current) => ({ ...current, partId: selectFirstVisibleOption(filteredParts, current.partId) }));
  }, [filteredParts, partSearch, showForm]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = {
        orderNo: form.orderNo || undefined,
        logisticsNo: form.logisticsNo || null,
        partId: form.partId,
        orderQuantity: Number(form.orderQuantity),
        status: form.status,
        remark: form.remark || null,
        orderTime: dateTimeLocalToIso(form.orderTime),
      };
      if (editingOrderId) {
        await apiPut(`/api/purchase-orders/${editingOrderId}`, payload);
      } else {
        await apiPost("/api/purchase-orders", payload);
      }
      setForm({ ...form, orderNo: "", logisticsNo: "", orderQuantity: "1", status: "在途", remark: "" });
      setEditingOrderId("");
      setShowForm(false);
      await load();
      setMessage("采购订单已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存采购订单失败");
    }
  }

  async function remove(order: AnyRow) {
    if (!order.id) return;
    if (!window.confirm(`确认删除采购订单 ${String(order.orderNo ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/purchase-orders/${order.id}`);
      await load();
      setMessage("采购订单已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除采购订单失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条采购订单？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/purchase-orders/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("采购订单已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除采购订单失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>采购订单</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar filter-panel">
        <ClearableFilterInput
          id="purchase-filter-order-no"
          label="订单号"
          value={filters.orderNo}
          placeholder="请输入订单号"
          onChange={(value) => updateFilter("orderNo", value)}
          onClear={() => clearFilter("orderNo")}
        />
        <ClearableFilterInput
          id="purchase-filter-logistics-no"
          label="物流单号"
          value={filters.logisticsNo}
          placeholder="请输入物流单号"
          onChange={(value) => updateFilter("logisticsNo", value)}
          onClear={() => clearFilter("logisticsNo")}
        />
        <label>
          配件
          <select
            aria-label="筛选配件"
            value={filters.partId}
            onChange={(event) => updateFilter("partId", event.target.value)}
          >
            <option value="">请选择配件</option>
            {parts.map((part) => (
              <option key={String(part.id)} value={String(part.id)}>
                {String(part.code ?? "")} {String(part.name ?? "")}
              </option>
            ))}
          </select>
        </label>
        <label>
          下单日期
          <input type="date" value={filters.orderDate} onChange={(event) => updateFilter("orderDate", event.target.value)} />
        </label>
        <label>
          状态
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">请选择状态</option>
            <option value="缺货">缺货</option>
            <option value="在途">在途</option>
            <option value="部分签收">部分签收</option>
            <option value="已签收">已签收</option>
          </select>
        </label>
        <ClearableFilterInput
          id="purchase-filter-remark"
          label="备注"
          value={filters.remark}
          placeholder="请输入备注"
          onChange={(value) => updateFilter("remark", value)}
          onClear={() => clearFilter("remark")}
        />
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedFilters(filters)}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setFilters(emptyFilters); setAppliedFilters(emptyFilters); }}>重置</button>
          {isAdmin ? (
            <button className="secondary-button" type="button" onClick={openAddForm}>
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
        <FormDialog title={editingOrderId ? "编辑" : "新增"} onClose={closeForm}>
          <form id="purchase-order-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              订单号
              <input value={form.orderNo} onChange={(event) => setForm({ ...form, orderNo: event.target.value })} placeholder="不填则自动生成" />
            </label>
            <label>
              物流单号
              <input value={form.logisticsNo} onChange={(event) => setForm({ ...form, logisticsNo: event.target.value })} />
            </label>
            <label>
              搜索配件
              <input value={partSearch} onChange={(event) => setPartSearch(event.target.value)} placeholder="输入配件编号或名称" />
            </label>
            <label>
              配件
              <select value={form.partId} onChange={(event) => setForm({ ...form, partId: event.target.value })} required>
                <option value="">选择配件</option>
                {filteredParts.map((part) => (
                  <option key={String(part.id)} value={String(part.id)}>
                    {String(part.code ?? "")} {String(part.name ?? "")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              数量
              <input type="number" min="1" value={form.orderQuantity} onChange={(event) => setForm({ ...form, orderQuantity: event.target.value })} required />
            </label>
            <label>
              下单时间
              <input
                type="datetime-local"
                value={form.orderTime}
                onChange={(event) => setForm({ ...form, orderTime: event.target.value })}
                required
              />
            </label>
            {editingOrderId ? (
              <label>
                状态
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="缺货">缺货</option>
                  <option value="在途">在途</option>
                  <option value="部分签收">部分签收</option>
                  <option value="已签收">已签收</option>
                </select>
              </label>
            ) : null}
            <label className="wide-field">
              备注
              <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button className="ghost-button" type="button" onClick={closeForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredOrders}
        loading={loading}
        highlightKeyword={highlightKeyword}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "orderNo", header: "订单号" },
          { key: "logisticsNo", header: "物流单号" },
          { key: "partName", header: "配件" },
          {
            key: "partImageUrl",
            header: "图片",
            render: (order) => <ImageThumb src={String(order.partImageUrl ?? "")} alt={String(order.partName ?? "配件图片")} />,
          },
          { key: "orderQuantity", header: "数量" },
          { key: "status", header: "状态" },
          { key: "orderTime", header: "下单时间" },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (order) => isAdmin ? (
              <div className="row-actions">
                <button type="button" onClick={() => startEdit(order)}>编辑</button>
                <button type="button" onClick={() => remove(order)}>删除</button>
              </div>
            ) : "-",
          },
        ]}
      />
    </section>
  );
}

function ClearableFilterInput({
  id,
  label,
  value,
  placeholder,
  onChange,
  onClear,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="toolbar-field clearable-field">
      <label htmlFor={id}>{label}</label>
      <span className="clearable-input-wrap">
        <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        {value ? (
          <button className="input-clear-button" type="button" aria-label={`清空${label}`} onClick={onClear}>
            ×
          </button>
        ) : null}
      </span>
    </div>
  );
}
