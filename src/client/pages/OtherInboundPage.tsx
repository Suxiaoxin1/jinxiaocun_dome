import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { buildExportHref, rowMatchesKeyword, selectFirstVisibleOption } from "../tableTools";
import type { AnyRow, PageProps } from "../types";

export default function OtherInboundPage({ currentUser }: PageProps) {
  const [inbounds, setInbounds] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [form, setForm] = useState({
    inboundSource: "",
    partId: "",
    inboundQuantity: "1",
    inboundTime: toDateTimeLocalValue(),
    operatorName: currentUser.displayName,
    remark: "",
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();
  const isAdmin = currentUser.role === "admin";
  const filteredParts = useMemo(
    () => parts.filter((part) => rowMatchesKeyword(part, ["code", "name", "specification"], partSearch)),
    [parts, partSearch],
  );

  async function load() {
    setLoading(true);
    try {
      const [inboundData, partData] = await Promise.all([
        apiGet<{ otherInbounds: AnyRow[] }>("/api/other-inbounds"),
        apiGet<{ parts: AnyRow[] }>("/api/parts"),
      ]);
      setInbounds(inboundData.otherInbounds);
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
    load().catch((error) => setMessage(error instanceof Error ? error.message : "其它入库加载失败"));
  }, []);

  useEffect(() => {
    if (!showForm || !partSearch.trim()) {
      return;
    }
    setForm((current) => ({ ...current, partId: selectFirstVisibleOption(filteredParts, current.partId) }));
  }, [filteredParts, partSearch, showForm]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost("/api/other-inbounds", {
        inboundSource: form.inboundSource,
        partId: form.partId,
        inboundQuantity: Number(form.inboundQuantity),
        inboundTime: dateTimeLocalToIso(form.inboundTime),
        operatorName: form.operatorName,
        remark: form.remark || null,
      });
      clearMessage();
      setShowForm(false);
      await load();
      setMessage("其它入库已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存其它入库失败");
    }
  }

  const filteredInbounds = useMemo(() => {
    return inbounds.filter((inbound) =>
      rowMatchesKeyword(inbound, ["inboundSource", "partCode", "partName", "inboundQuantity", "inboundTime", "operatorName", "remark"], appliedSearch),
    );
  }, [inbounds, appliedSearch]);

  const exportHref = useMemo(() => buildExportHref("/api/other-inbounds", { q: appliedSearch }), [appliedSearch]);

  async function remove(inbound: AnyRow) {
    if (!inbound.id) return;
    if (!window.confirm(`确认删除其它入库记录 ${String(inbound.inboundSource ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/other-inbounds/${inbound.id}`);
      await load();
      setMessage("其它入库已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除其它入库失败");
    }
  }

  async function removeSelected() {
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条其它入库记录？`)) {
      return;
    }
    try {
      for (const id of selectedIds) {
        await apiDelete(`/api/other-inbounds/${id}`);
      }
      setSelectedIds([]);
      await load();
      setMessage("其它入库已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除其它入库失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>其它入库</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <label>
          搜索
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="入库途径、配件、备注" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={() => setAppliedSearch(searchDraft)}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setSearchDraft(""); setAppliedSearch(""); }}>重置</button>
          {isAdmin ? (
            <button className="secondary-button" type="button" onClick={() => { clearMessage(); setPartSearch(""); setShowForm(true); }}>
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
      {isAdmin && showForm ? (
        <FormDialog title="新增" onClose={() => { clearMessage(); setPartSearch(""); setShowForm(false); }}>
          <form id="other-inbound-form" className="form-grid dialog-form" onSubmit={submit}>
            <label>
              入库途径
              <input value={form.inboundSource} onChange={(event) => setForm({ ...form, inboundSource: event.target.value })} required />
            </label>
            <label>
              搜索配件
              <input value={partSearch} onChange={(event) => setPartSearch(event.target.value)} placeholder="输入配件编号或名称" />
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
              数量
              <input type="number" min="1" value={form.inboundQuantity} onChange={(event) => setForm({ ...form, inboundQuantity: event.target.value })} required />
            </label>
            <label>
              入库时间
              <input
                type="datetime-local"
                value={form.inboundTime}
                onChange={(event) => setForm({ ...form, inboundTime: event.target.value })}
                required
              />
            </label>
            <label>
              操作人
              <input value={form.operatorName} onChange={(event) => setForm({ ...form, operatorName: event.target.value })} required />
            </label>
            <label className="wide-field">
              备注
              <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button className="ghost-button" type="button" onClick={() => { clearMessage(); setPartSearch(""); setShowForm(false); }}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable
        rows={filteredInbounds}
        loading={loading}
        highlightKeyword={appliedSearch}
        selectable={isAdmin}
        selectedRowIds={selectedIds}
        onSelectedRowIdsChange={setSelectedIds}
        columns={[
          { key: "inboundSource", header: "入库途径" },
          { key: "partName", header: "配件" },
          {
            key: "partImageUrl",
            header: "图片",
            render: (inbound) => <ImageThumb src={String(inbound.partImageUrl ?? "")} alt={String(inbound.partName ?? "配件图片")} />,
          },
          { key: "inboundQuantity", header: "数量" },
          { key: "inboundTime", header: "入库时间" },
          { key: "operatorName", header: "操作人" },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (inbound) => (isAdmin ? <button type="button" onClick={() => remove(inbound)}>删除</button> : "-"),
          },
        ]}
      />
    </section>
  );
}
