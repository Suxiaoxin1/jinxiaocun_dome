import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, apiUploadFile } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { buildExportHref, rowMatchesKeyword } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

const emptyForm = {
  code: "",
  name: "",
  weight: "",
  imageUrl: "",
  specification: "",
  currentStock: "",
  remark: "",
};

export default function PartsPage({ currentUser }: PageProps) {
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [quickInput, setQuickInput] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";

  const pageSizeOptions = [10, 20, 50, 100];

  async function loadParts() {
    setLoading(true);
    try {
      const data = await apiGet<{ parts: AnyRow[] }>("/api/parts");
      setParts(data.parts);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadParts().catch((error) => setMessage(error instanceof Error ? error.message : "配件加载失败"));
  }, []);

  useEffect(() => {
    if (searchDraft === appliedSearch) return;
    const timer = setTimeout(() => {
      setAppliedSearch(searchDraft);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const filteredParts = useMemo(() => {
    return parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "weight", "specification", "currentStock", "remark"], appliedSearch));
  }, [parts, appliedSearch]);

  const total = filteredParts.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedParts = useMemo(() => filteredParts.slice(pageStart, pageStart + pageSize), [filteredParts, pageStart, pageSize]);

  const exportHref = useMemo(() => {
    return buildExportHref("/api/parts", { q: appliedSearch });
  }, [appliedSearch]);

  function goToPage(nextPage: number) {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      code: form.code,
      name: form.name,
      weight: form.weight === "" ? null : Number(form.weight),
      imageUrl: form.imageUrl || null,
      specification: form.specification || null,
      currentStock: form.currentStock === "" ? undefined : Number(form.currentStock),
      remark: form.remark || null,
    };
    try {
      const savedMessage = editingId ? "配件已更新" : "配件已新增";
      if (editingId) {
        await apiPut(`/api/parts/${editingId}`, payload);
      } else {
        await apiPost("/api/parts", payload);
      }
      setForm(emptyForm);
      setEditingId("");
      setShowForm(false);
      await loadParts();
      setMessage(savedMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存配件失败");
    }
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await apiUploadFile<{ imageUrl: string }>("/api/uploads/parts", file);
      setForm((current) => ({ ...current, imageUrl: data.imageUrl }));
      setMessage("图片已上传");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传图片失败");
    } finally {
      event.target.value = "";
    }
  }

  function editPart(part: AnyRow) {
    clearMessage();
    setEditingId(String(part.id ?? ""));
    setShowForm(true);
    setForm({
      code: String(part.code ?? ""),
      name: String(part.name ?? ""),
      weight: part.weight === null || part.weight === undefined ? "" : String(part.weight),
      imageUrl: String(part.imageUrl ?? ""),
      specification: String(part.specification ?? ""),
      currentStock: part.currentStock === null || part.currentStock === undefined ? "" : String(part.currentStock),
      remark: String(part.remark ?? ""),
    });
  }

  function closeForm() {
    clearMessage();
    setForm(emptyForm);
    setEditingId("");
    setShowForm(false);
  }

  async function importQuickParts() {
    const rows = parseQuickParts(quickInput);
    if (rows.length === 0) {
      setMessage("没有可导入的配件数据");
      return;
    }
    try {
      for (const row of rows) {
        await apiPost("/api/parts", row);
      }
      setQuickInput("");
      setMessage(`已导入 ${rows.length} 条配件`);
      await loadParts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "快捷导入配件失败");
    }
  }

  async function removePart(part: AnyRow) {
    if (!part.id) return;
    if (!window.confirm(`确认删除配件 ${String(part.name ?? part.code ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/parts/${part.id}`);
      await loadParts();
      setMessage("配件已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除配件失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 个配件？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/parts/${id}`);
      }
      setSelectedIds([]);
      await loadParts();
      setMessage("配件已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除配件失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>配件管理</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="名称或编号" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => { setAppliedSearch(searchDraft); setPage(1); }}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setSearchDraft(""); setAppliedSearch(""); setPage(1); }}>重置</button>
          {isAdmin ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                clearMessage();
                setEditingId("");
                setForm(emptyForm);
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
      <div className="pagination-bar">
        <span>共 {total} 项</span>
        <button
          type="button"
          className="ghost-button"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
        >
          上一页
        </button>
        <span>
          第 {page} / {totalPages} 页
        </span>
        <button
          type="button"
          className="ghost-button"
          disabled={page >= totalPages}
          onClick={() => goToPage(page + 1)}
        >
          下一页
        </button>
        <label>
          每页显示
          <select
            value={pageSize}
            onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          条
        </label>
      </div>
      {isAdmin && (showForm || editingId) ? (
        <FormDialog title={editingId ? "编辑" : "新增"} onClose={closeForm}>
          <form id="parts-form" className="form-grid dialog-form" onSubmit={handleSubmit}>
            <label>
              配件编号
              <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
            </label>
            <label>
              配件名称
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <label>
              重量
              <input type="number" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} />
            </label>
            <label>
              图片
              <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
            </label>
            <label>
              图片地址
              <input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} />
            </label>
            <label>
              尺寸/规格
              <input value={form.specification} onChange={(event) => setForm({ ...form, specification: event.target.value })} />
            </label>
            <label>
              当前库存量
              <input
                type="number"
                min="0"
                value={form.currentStock}
                onChange={(event) => setForm({ ...form, currentStock: event.target.value })}
              />
            </label>
            <label className="wide-field">
              备注
              <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button type="button" className="ghost-button" onClick={closeForm}>取 消</button>
            </div>
          </form>
          {!editingId ? (
            <section className="content-section dialog-section">
              <h3>文档快捷录入配件</h3>
              <label className="stacked-field">
                编号、名称、图片、重量、尺寸、库存量
                <textarea
                  value={quickInput}
                  onChange={(event) => setQuickInput(event.target.value)}
                  placeholder={"编号\t名称\t图片\t重量\t尺寸\t库存量"}
                />
              </label>
              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={() => void importQuickParts()}>
                  导入配件
                </button>
              </div>
            </section>
          ) : null}
        </FormDialog>
      ) : null}
      <div className="parts-table-wrap">
        <DataTable
          rows={pagedParts}
          loading={loading}
          highlightKeyword={appliedSearch}
          selectable={isAdmin}
          selectedRowIds={selectedIds}
          onSelectedRowIdsChange={setSelectedIds}
          showRowNumber
          rowNumberStart={pageStart}
          columns={[
            { key: "code", header: "编号", className: "col-part-code" },
            { key: "name", header: "名称", className: "col-part-name" },
            {
              key: "imageUrl",
              header: "图片",
              className: "col-image",
              render: (part) => <ImageThumb src={String(part.imageUrl ?? "")} alt={String(part.name ?? "配件图片")} />,
            },
            { key: "weight", header: "重量", className: "col-weight" },
            { key: "specification", header: "尺寸/规格", className: "col-specification" },
            { key: "currentStock", header: "当前库存量", className: "col-quantity" },
            { key: "remark", header: "备注", className: "col-remark" },
            {
              key: "actions",
              header: "操作",
              className: "col-actions",
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
      </div>
    </section>
  );
}

function parseQuickParts(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitQuickLine)
    .filter((columns) => columns.length >= 2 && columns[0] !== "编号")
    .map(([code, name, imageUrl = "", weight = "", specification = "", currentStock = ""]) => ({
      code,
      name,
      weight: weight === "" ? null : Number(weight),
      imageUrl: imageUrl || null,
      specification: specification || null,
      currentStock: currentStock === "" ? 0 : Number(currentStock),
      remark: null,
    }));
}

function splitQuickLine(line: string) {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim());
  }
  if (line.includes(",") || line.includes("，")) {
    return line.split(/[,，]/).map((cell) => cell.trim());
  }
  return line.split(/\s{2,}/).map((cell) => cell.trim());
}
