import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, apiUploadFile } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { buildExportHref, rowMatchesKeyword, selectFirstVisibleOption } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

type BomDraft = {
  partId: string;
  quantity: string;
};

const emptyBomItem: BomDraft = {
  partId: "",
  quantity: "1",
};

export default function ProductsPage({ currentUser }: PageProps) {
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [remark, setRemark] = useState("");
  const [bomItems, setBomItems] = useState<BomDraft[]>([emptyBomItem]);
  const [bomPartSearches, setBomPartSearches] = useState<string[]>([""]);
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";

  async function load() {
    setLoading(true);
    try {
      const [productData, partData] = await Promise.all([
        apiGet<{ products: AnyRow[] }>("/api/products"),
        apiGet<{ parts: AnyRow[] }>("/api/parts"),
      ]);
      setProducts(productData.products);
      setSelectedIds([]);
      setParts(partData.parts);
      setBomItems((current) =>
        current.map((item) => ({
          ...item,
          partId: item.partId || String(partData.parts[0]?.id ?? ""),
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "产品加载失败"));
  }, []);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => rowMatchesKeyword(product, ["code", "name", "remark"], appliedSearch));
  }, [products, appliedSearch]);

  const exportHref = useMemo(() => buildExportHref("/api/products", { q: appliedSearch }), [appliedSearch]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanedBomItems = bomItems
      .filter((item) => item.partId)
      .map((item) => ({ partId: item.partId, quantity: Number(item.quantity) }));
    const payload = {
      code,
      name,
      imageUrl: imageUrl || null,
      remark: remark || null,
      bomItems: cleanedBomItems,
    };
    try {
      const savedMessage = editingId ? "产品已更新" : "产品已新增";
      if (editingId) {
        await apiPut(`/api/products/${editingId}`, payload);
      } else {
        await apiPost("/api/products", payload);
      }
      reset();
      await load();
      setMessage(savedMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存产品失败");
    }
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await apiUploadFile<{ imageUrl: string }>("/api/uploads/products", file);
      setImageUrl(data.imageUrl);
      setMessage("产品图片已上传");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传产品图片失败");
    } finally {
      event.target.value = "";
    }
  }

  function edit(product: AnyRow) {
    clearMessage();
    const productBomItems = Array.isArray(product.bomItems) ? product.bomItems as AnyRow[] : [];
    setEditingId(String(product.id ?? ""));
    setShowForm(true);
    setCode(String(product.code ?? ""));
    setName(String(product.name ?? ""));
    setImageUrl(String(product.imageUrl ?? ""));
    setRemark(String(product.remark ?? ""));
    setBomItems(
      productBomItems.length > 0
        ? productBomItems.map((item) => ({
          partId: String(item.partId ?? ""),
          quantity: String(item.quantity ?? "1"),
        }))
        : [{ ...emptyBomItem, partId: String(parts[0]?.id ?? "") }],
    );
    setBomPartSearches(new Array(Math.max(productBomItems.length, 1)).fill(""));
  }

  function reset() {
    clearMessage();
    setEditingId("");
    setCode("");
    setName("");
    setImageUrl("");
    setRemark("");
    setBomItems([{ ...emptyBomItem, partId: String(parts[0]?.id ?? "") }]);
    setBomPartSearches([""]);
    setShowForm(false);
    setMessage("");
  }

  function updateBomItem(index: number, patch: Partial<BomDraft>) {
    setBomItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addBomItem() {
    setBomItems((current) => [...current, { ...emptyBomItem, partId: String(parts[0]?.id ?? "") }]);
    setBomPartSearches((current) => [...current, ""]);
  }

  function removeBomItem(index: number) {
    setBomItems((current) => current.filter((_item, itemIndex) => itemIndex !== index));
    setBomPartSearches((current) => current.filter((_item, itemIndex) => itemIndex !== index));
  }

  function updateBomPartSearch(index: number, value: string) {
    setBomPartSearches((current) => current.map((search, itemIndex) => (itemIndex === index ? value : search)));
    const visibleParts = parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], value));
    setBomItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, partId: selectFirstVisibleOption(visibleParts, item.partId) } : item,
      ),
    );
  }

  async function remove(product: AnyRow) {
    if (!product.id) return;
    if (!window.confirm(`确认删除产品 ${String(product.name ?? product.code ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/products/${product.id}`);
      await load();
      setMessage("产品已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除产品失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 个产品？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/products/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("产品已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除产品失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>产品组装</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="产品编号、名称、备注" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedSearch(searchDraft)}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setSearchDraft(""); setAppliedSearch(""); }}>重置</button>
          {isAdmin ? (
            <button className="secondary-button" type="button" onClick={() => { reset(); setShowForm(true); }}>
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
        <FormDialog title={editingId ? "编辑" : "新增"} onClose={reset}>
          <form id="product-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              产品编号
              <input value={code} onChange={(event) => setCode(event.target.value)} required />
            </label>
            <label>
              产品名称
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              产品图片
              <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
            </label>
            <label>
              图片地址
              <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
            </label>
            <div className="wide-field bom-editor">
              <div className="section-heading-row">
                <span>BOM 配件</span>
                <button className="secondary-button" type="button" onClick={addBomItem}>
                  新增配件
                </button>
              </div>
              {bomItems.map((item, index) => (
                <div className="bom-editor-row" key={`bom-${index}`}>
                  <div className="form-field-group">
                    <label className="group-label">选择配件</label>
                    <div className="search-select-control">
                      <div className="search-input-wrap">
                        <input 
                          aria-label="输入配件编号或名称"
                          value={bomPartSearches[index] ?? ""}
                          onChange={(event) => updateBomPartSearch(index, event.target.value)}
                          placeholder="输入配件编号或名称搜索..."
                          className="search-input"
                        />
                        {(bomPartSearches[index] ?? "").trim() && parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], bomPartSearches[index] ?? "")).length > 0 && (
                          <span className="match-badge">匹配 {parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], bomPartSearches[index] ?? "")).length} 个</span>
                        )}
                      </div>
                      <select 
                        aria-label="配件"
                        value={item.partId} 
                        onChange={(event) => updateBomItem(index, { partId: event.target.value })} 
                        required
                        className="select-dropdown"
                      >
                        <option value="">{parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], bomPartSearches[index] ?? "")).length === 0 ? "无匹配配件" : "请选择配件"}</option>
                        {parts
                          .filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], bomPartSearches[index] ?? ""))
                          .map((part) => (
                            <option key={String(part.id)} value={String(part.id)}>
                              {String(part.code ?? "")} - {String(part.name ?? "")}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <label>
                    用量
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(event) => updateBomItem(index, { quantity: event.target.value })}
                      required
                    />
                  </label>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => removeBomItem(index)}
                    disabled={bomItems.length === 1}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <label className="wide-field">
              备注
              <input value={remark} onChange={(event) => setRemark(event.target.value)} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button type="button" className="ghost-button" onClick={reset}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredProducts}
        loading={loading}
        highlightKeyword={appliedSearch}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "code", header: "产品编号" },
          { key: "name", header: "产品名称" },
          {
            key: "imageUrl",
            header: "图片",
            render: (product) => <ImageThumb src={String(product.imageUrl ?? "")} alt={String(product.name ?? "产品图片")} />,
          },
          {
            key: "bomItems",
            header: "BOM",
            render: (product) => {
              const productBomItems = Array.isArray(product.bomItems) ? product.bomItems as AnyRow[] : [];
              return productBomItems.length > 0 ? (
                <div className="bom-list">
                  {productBomItems.map((item) => (
                    <span className="bom-item" key={String(item.partId)}>
                      <ImageThumb src={String(item.partImageUrl ?? "")} alt={String(item.partName ?? "配件图片")} />
                      <span>{String(item.partName ?? item.partId)} x {String(item.quantity ?? "")}</span>
                    </span>
                  ))}
                </div>
              ) : "-";
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
