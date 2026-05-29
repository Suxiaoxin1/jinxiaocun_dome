import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

export default function OutboundPage({ currentUser }: PageProps) {
  const [records, setRecords] = useState<AnyRow[]>([]);
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [stores, setStores] = useState<AnyRow[]>([]);
  const [form, setForm] = useState({
    productId: "",
    storeId: "",
    outboundQuantity: "1",
    outboundTime: new Date().toISOString(),
    operatorName: currentUser.displayName,
    remark: "",
  });
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const [recordData, productData, storeData] = await Promise.all([
      apiGet<{ outboundRecords: AnyRow[] }>("/api/outbound-records"),
      apiGet<{ products: AnyRow[] }>("/api/products"),
      apiGet<{ stores: AnyRow[] }>("/api/stores"),
    ]);
    setRecords(recordData.outboundRecords);
    setProducts(productData.products);
    setStores(storeData.stores);
    if (!form.productId && productData.products[0]?.id) {
      setForm((current) => ({ ...current, productId: String(productData.products[0].id) }));
    }
    if (!form.storeId && storeData.stores[0]?.id) {
      setForm((current) => ({ ...current, storeId: String(storeData.stores[0].id) }));
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "出库加载失败"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost("/api/outbound-records", {
        productId: form.productId,
        storeId: form.storeId,
        outboundQuantity: Number(form.outboundQuantity),
        outboundTime: form.outboundTime,
        operatorName: form.operatorName,
        remark: form.remark || null,
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存出库失败");
    }
  }

  async function remove(record: AnyRow) {
    if (!record.id) return;
    try {
      await apiDelete(`/api/outbound-records/${record.id}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除出库失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>出库管理</h2>
        <a className="secondary-button" href="/api/outbound-records.csv">导出出库记录</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <form className="form-grid" onSubmit={submit}>
        <label>
          产品
          <select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} required>
            <option value="">选择产品</option>
            {products.map((product) => (
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
          <input value={form.outboundTime} onChange={(event) => setForm({ ...form, outboundTime: event.target.value })} required />
        </label>
        <label>
          操作人
          <input value={form.operatorName} onChange={(event) => setForm({ ...form, operatorName: event.target.value })} required />
        </label>
        <label className="wide-field">
          备注
          <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
        </label>
        <div className="form-actions">
          <button className="primary-button" type="submit">新增出库</button>
        </div>
      </form>
      <DataTable
        rows={records}
        columns={[
          { key: "productName", header: "产品" },
          { key: "storeName", header: "店铺" },
          { key: "outboundQuantity", header: "数量" },
          { key: "outboundTime", header: "时间" },
          { key: "operatorName", header: "操作人" },
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
