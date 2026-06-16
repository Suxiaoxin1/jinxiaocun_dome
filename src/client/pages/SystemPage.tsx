import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso } from "../formatters";
import type { AnyRow, PageProps } from "../types";

const emptyUserForm = {
  username: "",
  displayName: "",
  password: "",
  role: "operator",
  enabled: true,
};

const emptyAuditFilters = {
  q: "",
  actorUsername: "",
  action: "",
  entityType: "",
  from: "",
  to: "",
};

type AuditPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export default function SystemPage({ currentUser }: PageProps) {
  const [users, setUsers] = useState<AnyRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AnyRow[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [auditFilters, setAuditFilters] = useState(emptyAuditFilters);
  const [appliedAuditFilters, setAppliedAuditFilters] = useState(emptyAuditFilters);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [auditPagination, setAuditPagination] = useState<AuditPagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [usersLoading, setUsersLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const userData = await apiGet<{ users: AnyRow[] }>("/api/users");
      setUsers(userData.users);
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadAuditLogs(page = auditPage, pageSize = auditPageSize, filters = appliedAuditFilters) {
    setAuditLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      Object.entries(filters).forEach(([key, value]) => {
        const normalized = value.trim();
        if (!normalized) {
          return;
        }
        query.set(key, key === "from" || key === "to" ? dateTimeLocalToIso(normalized) : normalized);
      });
      const auditData = await apiGet<{ auditLogs: AnyRow[]; pagination?: AuditPagination }>(`/api/audit-logs?${query.toString()}`);
      setAuditLogs(auditData.auditLogs);
      setAuditPagination(auditData.pagination ?? { page, pageSize, total: auditData.auditLogs.length, totalPages: 1 });
    } finally {
      setAuditLoading(false);
    }
  }

  async function load() {
    await Promise.all([
      loadUsers(),
      loadAuditLogs(1, auditPageSize, appliedAuditFilters),
    ]);
  }

  function applyAuditFilters() {
    setAuditPage(1);
    setAppliedAuditFilters(auditFilters);
  }

  function resetAuditFilters() {
    setAuditFilters(emptyAuditFilters);
    setAppliedAuditFilters(emptyAuditFilters);
    setAuditPage(1);
  }

  function changeAuditPage(nextPage: number) {
    setAuditPage(Math.min(Math.max(nextPage, 1), auditPagination.totalPages));
  }

  function changeAuditPageSize(nextPageSize: number) {
    setAuditPageSize(nextPageSize);
    setAuditPage(1);
  }

  function refreshAuditLogs() {
    void loadAuditLogs(auditPage, auditPageSize, appliedAuditFilters).catch((error) =>
      setMessage(error instanceof Error ? error.message : "审计日志加载失败"),
    );
  }

  useEffect(() => {
    loadUsers().catch((error) => setMessage(error instanceof Error ? error.message : "用户数据加载失败"));
  }, []);

  useEffect(() => {
    loadAuditLogs(auditPage, auditPageSize, appliedAuditFilters).catch((error) =>
      setMessage(error instanceof Error ? error.message : "审计日志加载失败"),
    );
  }, [auditPage, auditPageSize, appliedAuditFilters]);

  useEffect(() => {
    if (auditPagination.page !== auditPage) {
      setAuditPage(auditPagination.page);
    }
  }, [auditPagination.page, auditPage]);

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    const payload = {
      displayName: userForm.displayName,
      password: userForm.password || undefined,
      role: userForm.role,
      enabled: userForm.enabled,
    };
    try {
      if (editingUserId) {
        await apiPut(`/api/users/${editingUserId}`, payload);
      } else {
        await apiPost("/api/users", { username: userForm.username, ...payload, password: userForm.password });
      }
      closeUserForm();
      await loadUsers();
      await loadAuditLogs(1, auditPageSize, appliedAuditFilters);
      setMessage(editingUserId ? "用户已更新" : "用户已新增");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存用户失败");
    }
  }

  function editUser(user: AnyRow) {
    clearMessage();
    setEditingUserId(String(user.id ?? ""));
    setUserForm({
      username: String(user.username ?? ""),
      displayName: String(user.displayName ?? ""),
      password: "",
      role: String(user.role ?? "operator"),
      enabled: Boolean(user.enabled),
    });
    setShowUserForm(true);
  }

  function closeUserForm() {
    clearMessage();
    setEditingUserId("");
    setUserForm(emptyUserForm);
    setShowUserForm(false);
  }

  return (
    <section className="page-stack">
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar">
        <div className="toolbar-actions">
          <button className="secondary-button" type="button" onClick={() => { clearMessage(); setShowUserForm(true); }}>
            新增用户
          </button>
          <button className="ghost-button" type="button" onClick={() => void load()}>
            刷新审计
          </button>
        </div>
      </div>
      {showUserForm ? (
        <FormDialog title={editingUserId ? "编辑用户" : "新增用户"} onClose={closeUserForm}>
          <form className="form-grid dialog-form" onSubmit={submitUser}>
            <label>
              账号
              <input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} disabled={Boolean(editingUserId)} required />
            </label>
            <label>
              显示名称
              <input value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} required />
            </label>
            <label>
              密码
              <input
                type="password"
                value={userForm.password}
                onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                placeholder={editingUserId ? "留空则不修改" : "至少 6 位"}
                required={!editingUserId}
              />
            </label>
            <label>
              角色
              <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
                <option value="operator">普通操作员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label>
              状态
              <select value={userForm.enabled ? "1" : "0"} onChange={(event) => setUserForm({ ...userForm, enabled: event.target.value === "1" })}>
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确 定</button>
              <button className="ghost-button" type="button" onClick={closeUserForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <section className="content-section">
        <h3>用户管理</h3>
        <DataTable
          rows={users}
          loading={usersLoading}
          columns={[
            { key: "username", header: "账号" },
            { key: "displayName", header: "显示名称" },
            { key: "role", header: "角色" },
            { key: "enabled", header: "状态", render: (user) => (user.enabled ? "启用" : "停用") },
            {
              key: "actions",
              header: "操作",
              render: (user) => (
                <button type="button" onClick={() => editUser(user)} disabled={String(user.id ?? "") === currentUser.id}>
                  编辑
                </button>
              ),
            },
          ]}
        />
      </section>
      <section className="content-section">
        <h3>审计日志</h3>
        <div className="toolbar filter-panel audit-filter-panel">
          <label>
            关键字
            <input value={auditFilters.q} onChange={(event) => setAuditFilters({ ...auditFilters, q: event.target.value })} placeholder="账号、动作、对象ID" />
          </label>
          <label>
            账号
            <input value={auditFilters.actorUsername} onChange={(event) => setAuditFilters({ ...auditFilters, actorUsername: event.target.value })} placeholder="操作账号" />
          </label>
          <label>
            动作
            <input value={auditFilters.action} onChange={(event) => setAuditFilters({ ...auditFilters, action: event.target.value })} placeholder="新增、编辑、删除" />
          </label>
          <label>
            对象
            <select value={auditFilters.entityType} onChange={(event) => setAuditFilters({ ...auditFilters, entityType: event.target.value })}>
              <option value="">全部对象</option>
              <option value="part">配件</option>
              <option value="product">产品</option>
              <option value="purchase_order">采购订单</option>
              <option value="purchase_receipt">采购入库</option>
              <option value="other_inbound">其它入库</option>
              <option value="outbound_record">出库</option>
              <option value="stock">库存</option>
              <option value="stocktake">盘点</option>
              <option value="store">店铺</option>
              <option value="user">用户</option>
              <option value="low_stock_ignore">低库存忽略</option>
            </select>
          </label>
          <label>
            开始时间
            <input type="datetime-local" value={auditFilters.from} onChange={(event) => setAuditFilters({ ...auditFilters, from: event.target.value })} />
          </label>
          <label>
            结束时间
            <input type="datetime-local" value={auditFilters.to} onChange={(event) => setAuditFilters({ ...auditFilters, to: event.target.value })} />
          </label>
          <div className="toolbar-actions">
            <button className="primary-button" type="button" onClick={applyAuditFilters}>筛选日志</button>
            <button className="ghost-button" type="button" onClick={resetAuditFilters}>重置</button>
            <button className="ghost-button" type="button" onClick={refreshAuditLogs}>刷新</button>
          </div>
        </div>
        <DataTable
          rows={auditLogs}
          loading={auditLoading}
          columns={[
            { key: "createdAt", header: "时间" },
            { key: "actorUsername", header: "账号" },
            { key: "actorRole", header: "角色" },
            { key: "action", header: "动作" },
            { key: "entityType", header: "对象" },
            { key: "entityId", header: "对象ID" },
          ]}
        />
        <div className="pagination-bar">
          <span>共 {auditPagination.total} 条，第 {auditPagination.page} / {auditPagination.totalPages} 页</span>
          <label>
            每页
            <select value={auditPageSize} onChange={(event) => changeAuditPageSize(Number(event.target.value))}>
              <option value="10">10 条</option>
              <option value="20">20 条</option>
              <option value="50">50 条</option>
              <option value="100">100 条</option>
            </select>
          </label>
          <button className="ghost-button" type="button" disabled={auditPagination.page <= 1} onClick={() => changeAuditPage(auditPagination.page - 1)}>
            上一页
          </button>
          <button className="ghost-button" type="button" disabled={auditPagination.page >= auditPagination.totalPages} onClick={() => changeAuditPage(auditPagination.page + 1)}>
            下一页
          </button>
        </div>
      </section>
    </section>
  );
}
