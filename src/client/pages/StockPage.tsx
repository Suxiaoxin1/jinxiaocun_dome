import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../api";
import DataTable from "../components/DataTable";
import ImageThumb from "../components/ImageThumb";
import type { AnyRow, PageProps } from "../types";

export default function StockPage({ currentUser }: PageProps) {
  const [stock, setStock] = useState<AnyRow[]>([]);
  const [search, setSearch] = useState("");
  const [editingPartId, setEditingPartId] = useState("");
  const [remark, setRemark] = useState("");
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const data = await apiGet<{ stock: AnyRow[] }>("/api/stock");
    setStock(data.stock);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "库存加载失败"));
  }, []);

  const filteredStock = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return stock;
    return stock.filter((row) =>
      `${row.partCode ?? ""} ${row.partName ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [stock, search]);

  function startEdit(row: AnyRow) {
    setEditingPartId(String(row.partId ?? ""));
    setRemark(String(row.remark ?? ""));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPut(`/api/stock/${editingPartId}/remark`, { remark: remark || null });
      setEditingPartId("");
      setRemark("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新备注失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>库存查看</h2>
        <a className="secondary-button" href="/api/stock.csv">导出库存</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="配件名称或编号" />
        </label>
      </div>
      {isAdmin && editingPartId ? (
        <form className="form-grid" onSubmit={submit}>
          <label className="wide-field">
            备注
            <input value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">保存备注</button>
            <button type="button" className="ghost-button" onClick={() => { setEditingPartId(""); setRemark(""); }}>
              取消
            </button>
          </div>
        </form>
      ) : null}
      <DataTable
        rows={filteredStock}
        columns={[
          { key: "partCode", header: "编号" },
          { key: "partName", header: "名称" },
          {
            key: "imageUrl",
            header: "图片",
            render: (row) => <ImageThumb src={String(row.imageUrl ?? "")} alt={String(row.partName ?? "配件图片")} />,
          },
          { key: "quantity", header: "当前库存" },
          { key: "remark", header: "备注" },
          { key: "lastStocktakeAt", header: "盘点时间" },
          {
            key: "actions",
            header: "操作",
            render: (row) =>
              isAdmin ? (
                <button type="button" onClick={() => startEdit(row)}>
                  编辑备注
                </button>
              ) : "-",
          },
        ]}
      />
    </section>
  );
}
