import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import useTransientMessage from "../hooks/useTransientMessage";
import { buildExportHref, rowMatchesKeyword } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

type StoreStatusFilter = "all" | "active" | "inactive";

export default function StoresPage({ currentUser }: PageProps) {
  const [stores, setStores] = useState<AnyRow[]>([]);
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [boundProductIds, setBoundProductIds] = useState<string[]>([]);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StoreStatusFilter>("active");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";

  async function load() {
    setLoading(true);
    try {
      const suffix = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const data = await apiGet<{ stores: AnyRow[] }>(`/api/stores${suffix}`);
      setStores(data.stores);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "店铺加载失败"));
  }, [statusFilter]);

  const filteredStores = useMemo(() => {
    return stores.filter((store) => rowMatchesKeyword(store, ["name", "remark"], appliedSearch));
  }, [stores, appliedSearch]);

  const exportHref = useMemo(
    () => buildExportHref("/api/stores", { q: appliedSearch, status: statusFilter === "all" ? "" : statusFilter }),
    [appliedSearch, statusFilter],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (editingId) {
        await apiPut(`/api/stores/${editingId}`, { name, remark: remark || null, enabled });
        if (bindingLoaded) {
          await apiPut(`/api/stores/${editingId}/products`, { productIds: boundProductIds });
        }
      } else {
        await apiPost("/api/stores", { name, remark: remark || null, enabled: true });
      }
      setName("");
      setRemark("");
      setEnabled(true);
      setEditingId("");
      setShowForm(false);
      await load();
      setMessage(editingId ? "店铺已更新" : "店铺已新增");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存店铺失败");
    }
  }

  async function edit(store: AnyRow) {
    const storeId = String(store.id ?? "");
    clearMessage();
    setEditingId(storeId);
    setShowForm(true);
    setName(String(store.name ?? ""));
    setRemark(String(store.remark ?? ""));
    setEnabled(store.enabled !== false);
    setBindingLoaded(false);
    setProducts([]);
    setBoundProductIds([]);
    try {
      const [productData, bindingData] = await Promise.all([
        apiGet<{ products?: AnyRow[] }>("/api/products"),
        apiGet<{ products?: AnyRow[] }>(`/api/stores/${storeId}/products`),
      ]);
      setProducts(productData.products ?? []);
      setBoundProductIds((bindingData.products ?? []).map((product) => String(product.id ?? "")));
      setBindingLoaded(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "店铺产品加载失败");
    }
  }

  function closeForm() {
    clearMessage();
    setEditingId("");
    setName("");
    setRemark("");
    setEnabled(true);
    setProducts([]);
    setBoundProductIds([]);
    setBindingLoaded(false);
    setShowForm(false);
  }

  function toggleBoundProduct(productId: string, checked: boolean) {
    setBoundProductIds((current) =>
      checked ? [...current, productId] : current.filter((id) => id !== productId),
    );
  }

  async function toggleStore(store: AnyRow) {
    if (!store.id) return;
    const nextEnabled = store.enabled === false;
    if (!nextEnabled && !window.confirm(`确认停用店铺 ${String(store.name ?? "")}？停用后将不会出现在新增出库的店铺选择中。`)) {
      return;
    }
    try {
      await apiPut(`/api/stores/${store.id}`, {
        name: String(store.name ?? ""),
        remark: store.remark ?? null,
        enabled: nextEnabled,
      });
      await load();
      setMessage(nextEnabled ? "店铺已启用" : "店铺已停用");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新店铺状态失败");
    }
  }

  async function remove(store: AnyRow) {
    if (!store.id) return;
    if (!window.confirm(`确认删除店铺 ${String(store.name ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/stores/${store.id}`);
      await load();
      setMessage("店铺已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除店铺失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 个店铺？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/stores/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("店铺已删除");
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
      <div className="toolbar">
        <label>
          搜索
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="店铺名称、备注" />
        </label>
        <label>
          状态
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StoreStatusFilter)}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
            <option value="all">全部</option>
          </select>
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedSearch(searchDraft)}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setSearchDraft(""); setAppliedSearch(""); setStatusFilter("active"); }}>重置</button>
          {isAdmin ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                clearMessage();
                setEditingId("");
                setName("");
                setRemark("");
                setEnabled(true);
                setShowForm(true);
              }}
            >
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
      {isAdmin && (showForm || editingId) ? (
        <FormDialog title={editingId ? "编辑" : "新增"} onClose={closeForm} size={editingId ? "large" : "default"}>
          <form id="store-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              店铺名称
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="wide-field">
              备注
              <input value={remark} onChange={(event) => setRemark(event.target.value)} />
            </label>
            {editingId ? (
              <label className="wide-field checkbox-field">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                启用店铺
              </label>
            ) : null}
            {editingId ? (
              <div className="wide-field">
                <span>可出库产品</span>
                {bindingLoaded ? (
                  products.length > 0 ? (
                    <div className="checkbox-list">
                      {products.map((product) => {
                        const productId = String(product.id ?? "");
                        return (
                          <label className="checkbox-field" key={productId}>
                            <input
                              type="checkbox"
                              checked={boundProductIds.includes(productId)}
                              onChange={(event) => toggleBoundProduct(productId, event.target.checked)}
                            />
                            {String(product.code ?? "")} {String(product.name ?? "")}
                          </label>
                        );
                      })}
                    </div>
                  ) : <p className="field-hint">暂无产品可绑定</p>
                ) : <p className="field-hint">正在加载产品...</p>}
              </div>
            ) : null}
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button type="button" className="ghost-button" onClick={closeForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredStores}
        loading={loading}
        highlightKeyword={appliedSearch}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "name", header: "店铺名称" },
          {
            key: "enabled",
            header: "状态",
            render: (store) => (
              <span className={store.enabled === false ? "status-badge warning" : "status-badge success"}>
                {store.enabled === false ? "停用" : "启用"}
              </span>
            ),
          },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (store) =>
              isAdmin ? (
                <div className="row-actions">
                  <button type="button" onClick={() => void edit(store)}>编辑</button>
                  <button type="button" onClick={() => void toggleStore(store)}>
                    {store.enabled === false ? "启用" : "停用"}
                  </button>
                  <button type="button" onClick={() => remove(store)}>删除</button>
                </div>
              ) : "-",
          },
        ]}
      />
    </section>
  );
}
