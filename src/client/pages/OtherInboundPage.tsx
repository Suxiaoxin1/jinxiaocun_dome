import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import ImageThumb from "../components/ImageThumb";
import type { AnyRow, PageProps } from "../types";

export default function OtherInboundPage({ currentUser }: PageProps) {
  const [inbounds, setInbounds] = useState<AnyRow[]>([]);
  const [parts, setParts] = useState<AnyRow[]>([]);
  const [form, setForm] = useState({
    inboundNo: "",
    partId: "",
    inboundQuantity: "1",
    inboundTime: new Date().toISOString(),
    operatorName: currentUser.displayName,
    remark: "",
  });
  const [message, setMessage] = useState("");
  const isAdmin = currentUser.role === "admin";

  async function load() {
    const [inboundData, partData] = await Promise.all([
      apiGet<{ otherInbounds: AnyRow[] }>("/api/other-inbounds"),
      apiGet<{ parts: AnyRow[] }>("/api/parts"),
    ]);
    setInbounds(inboundData.otherInbounds);
    setParts(partData.parts);
    if (!form.partId && partData.parts[0]?.id) {
      setForm((current) => ({ ...current, partId: String(partData.parts[0].id) }));
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "其它入库加载失败"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiPost("/api/other-inbounds", {
        inboundNo: form.inboundNo,
        partId: form.partId,
        inboundQuantity: Number(form.inboundQuantity),
        inboundTime: form.inboundTime,
        operatorName: form.operatorName,
        remark: form.remark || null,
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存其它入库失败");
    }
  }

  async function remove(inbound: AnyRow) {
    if (!inbound.id) return;
    try {
      await apiDelete(`/api/other-inbounds/${inbound.id}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除其它入库失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>其它入库</h2>
        <a className="secondary-button" href="/api/other-inbounds.csv">导出其它入库</a>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <form className="form-grid" onSubmit={submit}>
        <label>
          入库单号
          <input value={form.inboundNo} onChange={(event) => setForm({ ...form, inboundNo: event.target.value })} required />
        </label>
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
          数量
          <input type="number" min="1" value={form.inboundQuantity} onChange={(event) => setForm({ ...form, inboundQuantity: event.target.value })} required />
        </label>
        <label>
          入库时间
          <input value={form.inboundTime} onChange={(event) => setForm({ ...form, inboundTime: event.target.value })} required />
        </label>
        <label>
          操作人
          <input value={form.operatorName} onChange={(event) => setForm({ ...form, operatorName: event.target.value })} required />
        </label>
        <label className="wide-field">
          备注
          <input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
        </label>
        <div className="form-actions">
          <button className="primary-button" type="submit">新增其它入库</button>
        </div>
      </form>
      <DataTable
        rows={inbounds}
        columns={[
          { key: "inboundNo", header: "单号" },
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
