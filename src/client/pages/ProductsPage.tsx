import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

export default function ProductsPage({ currentUser }: PageProps) {
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const [productData, partData] = await Promise.all([
      apiGet<{ products: AnyRow[] }>("/api/products"),
      apiGet<{ parts: AnyRow[] }>("/api/parts"),
    ]);
    setProducts(productData.products);
    setParts(partData.parts);
    if (!partId && partData.parts[0]?.id) {
      setPartId(String(partData.parts[0].id));
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "产品加载失败"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      code,
      name,
      remark: remark || null,
      bomItems: [{ partId, quantity: Number(quantity) }],
    };
    try {
      if (editingId) {
        await apiPut(`/api/products/${editingId}`, payload);
      } else {
        await apiPost("/api/products", payload);
      }
      reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存产品失败");
    }
  }

  function edit(product: AnyRow) {
    const bomItems = Array.isArray(product.bomItems) ? product.bomItems as AnyRow[] : [];
    const firstItem = bomItems[0] ?? {};
    setEditingId(String(product.id ?? ""));
    setCode(String(product.code ?? ""));
    setName(String(product.name ?? ""));
    setRemark(String(product.remark ?? ""));
    setPartId(String(firstItem.partId ?? parts[0]?.id ?? ""));
    setQuantity(String(firstItem.quantity ?? "1"));
  }

  function reset() {
    setEditingId("");
    setCode("");
    setName("");
    setRemark("");
    setQuantity("1");
    setPartId(parts[0]?.id ? String(parts[0].id) : "");
    setMessage("");
  }

  async function remove(product: AnyRow) {
    if (!product.id) return;
    try {
      await apiDelete(`/api/products/${product.id}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除产品失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>产品组装</h2>
        <a className="secondary-button" href="/api/products.csv">导出产品组成</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      {isAdmin ? (
        <form className="form-grid" onSubmit={submit}>
          <label>
            产品编号
            <input value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <label>
            产品名称
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            配件
            <select value={partId} onChange={(event) => setPartId(event.target.value)} required>
              <option value="">选择配件</option>
              {parts.map((part) => (
                <option key={String(part.id)} value={String(part.id)}>
                  {String(part.code ?? "")} {String(part.name ?? "")}
                </option>
              ))}
            </select>
          </label>
          <label>
            用量
            <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
          </label>
          <label className="wide-field">
            备注
            <input value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">{editingId ? "保存产品" : "新增产品"}</button>
            {editingId ? <button type="button" className="ghost-button" onClick={reset}>取消</button> : null}
          </div>
        </form>
      ) : null}
      <DataTable
        rows={products}
        columns={[
          { key: "code", header: "产品编号" },
          { key: "name", header: "产品名称" },
          {
            key: "bomItems",
            header: "BOM",
            render: (product) => {
              const bomItems = Array.isArray(product.bomItems) ? product.bomItems as AnyRow[] : [];
              return bomItems.map((item) => `${item.partName ?? item.partId} x ${item.quantity}`).join("；") || "-";
            },
          },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (product) =>
              isAdmin ? (
                <div className="row-actions">
                  <button type="button" onClick={() => edit(product)}>编辑</button>
                  <button type="button" onClick={() => remove(product)}>删除</button>
                </div>
              ) : "-",
          },
        ]}
      />
    </section>
  );
}
