import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import ImageThumb from "../components/ImageThumb";
import type { AnyRow, PageProps } from "../types";

export default function PurchaseOrdersPage({ currentUser }: PageProps) {
  const [orders, setOrders] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    orderNo: "",
    logisticsNo: "",
    partId: "",
    orderQuantity: "1",
    status: "在途",
    remark: "",
    orderTime: new Date().toISOString(),
  });
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const [orderData, partData] = await Promise.all([
      apiGet<{ purchaseOrders: AnyRow[] }>("/api/purchase-orders"),
      apiGet<{ parts: AnyRow[] }>("/api/parts"),
    ]);
    setOrders(orderData.purchaseOrders);
    setParts(partData.parts);
    if (!form.partId && partData.parts[0]?.id) {
      setForm((current) => ({ ...current, partId: String(partData.parts[0].id) }));
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "采购订单加载失败"));
  }, []);

  const filteredOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return orders;
    return orders.filter((order) =>
      `${order.orderNo ?? ""} ${order.partName ?? ""} ${order.status ?? ""} ${order.remark ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [orders, search]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost("/api/purchase-orders", {
        orderNo: form.orderNo,
        logisticsNo: form.logisticsNo || null,
        partId: form.partId,
        orderQuantity: Number(form.orderQuantity),
        status: form.status,
        remark: form.remark || null,
        orderTime: form.orderTime,
      });
      setForm({ ...form, orderNo: "", logisticsNo: "", orderQuantity: "1", remark: "" });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存采购订单失败");
    }
  }

  async function remove(order: AnyRow) {
    if (!order.id) return;
    try {
      await apiDelete(`/api/purchase-orders/${order.id}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除采购订单失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>采购订单</h2>
        <a className="secondary-button" href="/api/purchase-orders.csv">导出采购订单</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="订单号、配件、状态" />
        </label>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          订单号
          <input value={form.orderNo} onChange={(event) => setForm({ ...form, orderNo: event.target.value })} required />
        </label>
        <label>
          物流单号
          <input value={form.logisticsNo} onChange={(event) => setForm({ ...form, logisticsNo: event.target.value })} />
        </label>
        <label>
          配件
          <select value={form.partId} onChange={(event) => setForm({ ...form, partId: event.target.value })} required>
            <option value="">选择配件</option>
            {parts.map((part) => (
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
          状态
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            <option value="缺货">缺货</option>
            <option value="在途">在途</option>
            <option value="部分签收">部分签收</option>
            <option value="已签收">已签收</option>
          </select>
        </label>
        <label>
          下单时间
          <input value={form.orderTime} onChange={(event) => setForm({ ...form, orderTime: event.target.value })} required />
        </label>
        <label className="wide-field">
          备注
          <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
        </label>
        <div className="form-actions">
          <button className="primary-button" type="submit">新增采购订单</button>
        </div>
      </form>
      <DataTable
        rows={filteredOrders}
        columns={[
          { key: "orderNo", header: "订单号" },
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
            render: (order) => isAdmin ? <button type="button" onClick={() => remove(order)}>删除</button> : "-",
          },
        ]}
      />
    </section>
  );
}
