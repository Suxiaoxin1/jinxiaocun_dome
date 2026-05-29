import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

export default function StoresPage({ currentUser }: PageProps) {
  const [stores, setStores] = useState<AnyRow[]>([]);
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const data = await apiGet<{ stores: AnyRow[] }>("/api/stores");
    setStores(data.stores);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "店铺加载失败"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (editingId) {
        await apiPut(`/api/stores/${editingId}`, { name, remark: remark || null });
      } else {
        await apiPost("/api/stores", { name, remark: remark || null });
      }
      setName("");
      setRemark("");
      setEditingId("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存店铺失败");
    }
  }

  function edit(store: AnyRow) {
    setEditingId(String(store.id ?? ""));
    setName(String(store.name ?? ""));
    setRemark(String(store.remark ?? ""));
  }

  async function remove(store: AnyRow) {
    if (!store.id) return;
    try {
      await apiDelete(`/api/stores/${store.id}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除店铺失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>店铺管理</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      {isAdmin ? (
        <form className="form-grid" onSubmit={submit}>
          <label>
            店铺名称
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="wide-field">
            备注
            <input value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">{editingId ? "保存店铺" : "新增店铺"}</button>
            {editingId ? <button type="button" className="ghost-button" onClick={() => { setEditingId(""); setName(""); setRemark(""); }}>取消</button> : null}
          </div>
        </form>
      ) : null}
      <DataTable
        rows={stores}
        columns={[
          { key: "name", header: "店铺名称" },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (store) =>
              isAdmin ? (
                <div className="row-actions">
                  <button type="button" onClick={() => edit(store)}>编辑</button>
                  <button type="button" onClick={() => remove(store)}>删除</button>
                </div>
              ) : "-",
          },
        ]}
      />
    </section>
  );
}
