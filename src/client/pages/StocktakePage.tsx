import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, rowMatchesKeyword } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

const emptyStocktakeFilters = {
  partCode: "",
  partName: "",
  stocktakeDate: "",
  remark: "",
};

export default function StocktakePage({ currentUser }: PageProps) {
  const [stocktakes, setStocktakes] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [form, setForm] = useState({
    partId: "",
    actualQuantity: "0",
    remark: "",
    stocktakeTime: toDateTimeLocalValue(),
  });
  const [partSearch, setPartSearch] = useState("");
  const [filters, setFilters] = useState(emptyStocktakeFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyStocktakeFilters);
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";
  const selectedPart = parts.find((part) => String(part.id) === form.partId);
  const filteredParts = useMemo(
    () => parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], partSearch)),
    [parts, partSearch],
  );

  useEffect(() => {
    if (!showForm || !partSearch.trim()) {
      return;
    }
    setForm((current) => {
      const selectedPartVisible = filteredParts.some((part) => String(part.id) === current.partId);
      if (selectedPartVisible) {
        return current;
      }
      return { ...current, partId: String(filteredParts[0]?.id ?? "") };
    });
  }, [filteredParts, partSearch, showForm]);

  async function load() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (value.trim()) {
          query.set(key, value.trim());
        }
      });
      const stocktakeSuffix = query.toString() ? `?${query.toString()}` : "";
      const [stocktakeData, partData] = await Promise.all([
        apiGet<{ stocktakes: AnyRow[] }>(`/api/stocktakes${stocktakeSuffix}`),
        apiGet<{ parts: AnyRow[] }>("/api/parts"),
      ]);
      setStocktakes(stocktakeData.stocktakes);
      setSelectedIds([]);
      setParts(partData.parts);
      if (!form.partId && partData.parts[0]?.id) {
        setForm((current) => ({ ...current, partId: String(partData.parts[0].id) }));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "盘点加载失败"));
  }, [appliedFilters]);

  const filteredStocktakes = useMemo(() => {
    return stocktakes;
  }, [stocktakes]);

  const exportHref = useMemo(() => buildExportHref("/api/stocktakes", appliedFilters), [appliedFilters]);
  const highlightKeyword = useMemo(() => [
    appliedFilters.partCode,
    appliedFilters.partName,
    appliedFilters.stocktakeDate,
    appliedFilters.remark,
  ].find((value) => value.trim()) ?? "", [appliedFilters]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost("/api/stocktakes", {
        partId: form.partId,
        actualQuantity: Number(form.actualQuantity),
        remark: form.remark || null,
        stocktakeTime: dateTimeLocalToIso(form.stocktakeTime),
      });
      clearMessage();
      setShowForm(false);
      await load();
      setMessage("盘点已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存盘点失败");
    }
  }

  async function remove(stocktake: AnyRow) {
    if (!stocktake.id) return;
    if (!window.confirm(`确认删除盘点记录 ${String(stocktake.partName ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/stocktakes/${stocktake.id}`);
      await load();
      setMessage("盘点记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除盘点失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条盘点记录？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/stocktakes/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("盘点记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除盘点失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>盘点管理</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar filter-panel">
        <label>
          配件编号
          <input value={filters.partCode} onChange={(event) => setFilters({ ...filters, partCode: event.target.value })} placeholder="配件编号" />
        </label>
        <label>
          配件名称
          <input value={filters.partName} onChange={(event) => setFilters({ ...filters, partName: event.target.value })} placeholder="配件名称" />
        </label>
        <label>
          盘点日期
          <input type="date" value={filters.stocktakeDate} onChange={(event) => setFilters({ ...filters, stocktakeDate: event.target.value })} />
        </label>
        <label>
          备注
          <input value={filters.remark} onChange={(event) => setFilters({ ...filters, remark: event.target.value })} placeholder="备注" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedFilters(filters)}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setFilters(emptyStocktakeFilters); setAppliedFilters(emptyStocktakeFilters); }}>重置</button>
          <button className="secondary-button" type="button" onClick={() => { clearMessage(); setPartSearch(""); setShowForm(true); }}>
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
        <FormDialog title="新增" onClose={() => { clearMessage(); setShowForm(false); }}>
          <form id="stocktake-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              搜索配件
              <input
                value={partSearch}
                onChange={(event) => setPartSearch(event.target.value)}
                placeholder="输入配件编号或名称"
              />
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
              实盘数量
              <input type="number" value={form.actualQuantity} onChange={(event) => setForm({ ...form, actualQuantity: event.target.value })} required />
            </label>
            <div className="form-inline-summary">
              <ImageThumb src={String(selectedPart?.imageUrl ?? "")} alt={String(selectedPart?.name ?? "配件图片")} />
              <span>当前库存：{String(selectedPart?.currentStock ?? "-")}</span>
            </div>
            <label>
              盘点时间
              <input
                type="datetime-local"
                value={form.stocktakeTime}
                onChange={(event) => setForm({ ...form, stocktakeTime: event.target.value })}
                required
              />
            </label>
            <label className="wide-field">
              备注
              <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button className="ghost-button" type="button" onClick={() => { clearMessage(); setShowForm(false); }}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredStocktakes}
        loading={loading}
        highlightKeyword={highlightKeyword}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "partCode", header: "配件编号" },
          { key: "partName", header: "配件" },
          {
            key: "partImageUrl",
            header: "图片",
            render: (stocktake) => <ImageThumb src={String(stocktake.partImageUrl ?? "")} alt={String(stocktake.partName ?? "配件图片")} />,
          },
          { key: "previousQuantity", header: "盘前数量" },
          { key: "actualQuantity", header: "盘后数量" },
          { key: "stocktakeTime", header: "盘点时间" },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (stocktake) => (isAdmin ? <button type="button" onClick={() => remove(stocktake)}>删除</button> : "-"),
          },
        ]}
      />
    </section>
  );
}
