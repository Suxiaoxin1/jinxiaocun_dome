import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import type { AnyRow, PageProps } from "../types";

const emptyForm = {
  code: "",
  name: "",
  status: "在售",
  weight: "",
  imageUrl: "",
  specification: "",
  remark: "",
};

export default function PartsPage({ currentUser }: PageProps) {
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function loadParts() {
    const data = await apiGet<{ parts: AnyRow[] }>("/api/parts");
    setParts(data.parts);
  }

  useEffect(() => {
    loadParts().catch((error) => setMessage(error instanceof Error ? error.message : "配件加载失败"));
  }, []);

  const filteredParts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return parts;
    return parts.filter((part) =>
      `${part.code ?? ""} ${part.name ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [parts, search]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      code: form.code,
      name: form.name,
      status: form.status,
      weight: form.weight === "" ? null : Number(form.weight),
      imageUrl: form.imageUrl || null,
      specification: form.specification || null,
      remark: form.remark || null,
    };
    try {
      if (editingId) {
        await apiPut(`/api/parts/${editingId}`, payload);
      } else {
        await apiPost("/api/parts", payload);
      }
      setForm(emptyForm);
      setEditingId("");
      setMessage("");
      await loadParts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存配件失败");
    }
  }

  function editPart(part: AnyRow) {
    setEditingId(String(part.id ?? ""));
    setForm({
      code: String(part.code ?? ""),
      name: String(part.name ?? ""),
      status: String(part.status ?? "在售"),
      weight: part.weight === null || part.weight === undefined ? "" : String(part.weight),
      imageUrl: String(part.imageUrl ?? ""),
      specification: String(part.specification ?? ""),
      remark: String(part.remark ?? ""),
    });
  }

  async function removePart(part: AnyRow) {
    if (!part.id) return;
    try {
      await apiDelete(`/api/parts/${part.id}`);
      await loadParts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除配件失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>配件管理</h2>
        <a className="secondary-button" href="/api/parts.csv">
          导出配件
        </a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称或编号" />
        </label>
      </div>
      {isAdmin ? (
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            配件编号
            <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
          </label>
          <label>
            配件名称
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            状态
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="在售">在售</option>
              <option value="不在售">不在售</option>
            </select>
          </label>
          <label>
            重量
            <input type="number" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} />
          </label>
          <label>
            图片
            <input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} />
          </label>
          <label>
            规格
            <input value={form.specification} onChange={(event) => setForm({ ...form, specification: event.target.value })} />
          </label>
          <label className="wide-field">
            备注
            <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">
              {editingId ? "保存修改" : "新增配件"}
            </button>
            {editingId ? (
              <button type="button" className="ghost-button" onClick={() => { setForm(emptyForm); setEditingId(""); }}>
                取消
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      <DataTable
        rows={filteredParts}
        columns={[
          { key: "code", header: "编号" },
          { key: "name", header: "名称" },
          {
            key: "imageUrl",
            header: "图片",
            render: (part) =>
              typeof part.imageUrl === "string" && part.imageUrl ? (
                <img className="inline-image" src={part.imageUrl} alt={String(part.name ?? "配件图片")} />
              ) : "-",
          },
          { key: "status", header: "状态" },
          { key: "specification", header: "规格" },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (part) =>
              isAdmin ? (
                <div className="row-actions">
                  <button type="button" onClick={() => editPart(part)}>编辑</button>
                  <button type="button" onClick={() => removePart(part)}>删除</button>
                </div>
              ) : "-",
          },
        ]}
      />
    </section>
  );
}
