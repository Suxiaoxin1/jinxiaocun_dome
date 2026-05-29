import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import ImageThumb from "../components/ImageThumb";
import type { AnyRow, PageProps } from "../types";

export default function StocktakePage({ currentUser }: PageProps) {
  const [stocktakes, setStocktakes] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [form, setForm] = useState({
    partId: "",
    actualQuantity: "0",
    remark: "",
    stocktakeTime: new Date().toISOString(),
  });
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const [stocktakeData, partData] = await Promise.all([
      apiGet<{ stocktakes: AnyRow[] }>("/api/stocktakes"),
      apiGet<{ parts: AnyRow[] }>("/api/parts"),
    ]);
    setStocktakes(stocktakeData.stocktakes);
    setParts(partData.parts);
    if (!form.partId && partData.parts[0]?.id) {
      setForm((current) => ({ ...current, partId: String(partData.parts[0].id) }));
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "盘点加载失败"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost("/api/stocktakes", {
        partId: form.partId,
        actualQuantity: Number(form.actualQuantity),
        remark: form.remark || null,
        stocktakeTime: form.stocktakeTime,
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存盘点失败");
    }
  }

  async function remove(stocktake: AnyRow) {
    if (!stocktake.id) return;
    try {
      await apiDelete(`/api/stocktakes/${stocktake.id}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除盘点失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>盘点管理</h2>
        <a className="secondary-button" href="/api/stocktakes.csv">导出盘点记录</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <form className="form-grid" onSubmit={submit}>
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
          实盘数量
          <input type="number" min="0" value={form.actualQuantity} onChange={(event) => setForm({ ...form, actualQuantity: event.target.value })} required />
        </label>
        <label>
          盘点时间
          <input value={form.stocktakeTime} onChange={(event) => setForm({ ...form, stocktakeTime: event.target.value })} required />
        </label>
        <label className="wide-field">
          备注
          <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
        </label>
        <div className="form-actions">
          <button className="primary-button" type="submit">新增盘点</button>
        </div>
      </form>
      <DataTable
        rows={stocktakes}
        columns={[
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
