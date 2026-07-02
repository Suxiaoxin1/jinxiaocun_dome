import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso } from "../formatters";
import type { AnyRow, PageProps } from "../types";

const emptyUserForm = {
  username: "",
  displayName: "",
  password: "",
  role: "operation",
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

const roleLabels: Record<string, string> = {
  admin: "管理员",
  operation: "运营人员",
  purchaser: "采购人员",
  inbound: "入库人员",
  outbound: "出库人员",
  operator: "普通操作员",
};

type AuditPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export default function SystemPage({ currentUser }: PageProps) {
  const [users, setUsers] = useState<AnyRow[]>([]);
  const [stores, setStores] = useState<AnyRow[]>([]);
  const [outboundOperators, setOutboundOperators] = useState<AnyRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AnyRow[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [showOutboundOperatorForm, setShowOutboundOperatorForm] = useState(false);
  const [editingOutboundOperatorId, setEditingOutboundOperatorId] = useState("");
  const [outboundOperatorName, setOutboundOperatorName] = useState("");
  const [outboundOperatorEnabled, setOutboundOperatorEnabled] = useState(true);
  const [bindingUser, setBindingUser] = useState<AnyRow | null>(null);
  const [boundStoreIds, setBoundStoreIds] = useState<string[]>([]);
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

  async function loadOutboundOperators() {
    const data = await apiGet<{ outboundOperators?: AnyRow[] }>("/api/outbound-operators");
    setOutboundOperators(data.outboundOperators ?? []);
  }

  async function load() {
    await Promise.all([
      loadUsers(),
      loadOutboundOperators(),
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
    loadOutboundOperators().catch((error) => setMessage(error instanceof Error ? error.message : "出库人员加载失败"));
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

  function openOutboundOperatorForm(operator?: AnyRow) {
    clearMessage();
    setEditingOutboundOperatorId(String(operator?.id ?? ""));
    setOutboundOperatorName(String(operator?.name ?? ""));
    setOutboundOperatorEnabled(operator?.enabled !== false);
    setShowOutboundOperatorForm(true);
  }

  function closeOutboundOperatorForm() {
    clearMessage();
    setEditingOutboundOperatorId("");
    setOutboundOperatorName("");
    setOutboundOperatorEnabled(true);
    setShowOutboundOperatorForm(false);
  }

  async function submitOutboundOperator(event: FormEvent) {
    event.preventDefault();
    try {
      if (editingOutboundOperatorId) {
        await apiPut(`/api/outbound-operators/${editingOutboundOperatorId}`, {
          name: outboundOperatorName,
          enabled: outboundOperatorEnabled,
        });
      } else {
        await apiPost("/api/outbound-operators", {
          name: outboundOperatorName,
          enabled: outboundOperatorEnabled,
        });
      }
      closeOutboundOperatorForm();
      await loadOutboundOperators();
      setMessage(editingOutboundOperatorId ? "出库人员已更新" : "出库人员已新增");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存出库人员失败");
    }
  }

  async function removeOutboundOperator(operator: AnyRow) {
    const id = String(operator.id ?? "");
    if (!id || !window.confirm(`确认删除出库人员 ${String(operator.name ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/outbound-operators/${id}`);
      await loadOutboundOperators();
      setMessage("出库人员已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除出库人员失败");
    }
  }

  async function openStoreBinding(user: AnyRow) {
    const userId = String(user.id ?? "");
    clearMessage();
    setBindingUser(user);
    setStores([]);
    setBoundStoreIds([]);
    try {
      const [storeData, bindingData] = await Promise.all([
        apiGet<{ stores?: AnyRow[] }>("/api/stores?status=active"),
        apiGet<{ storeIds?: string[] }>(`/api/users/${userId}/stores`),
      ]);
      setStores(storeData.stores ?? []);
      setBoundStoreIds(bindingData.storeIds ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号店铺权限加载失败");
    }
  }

  function closeStoreBinding() {
    clearMessage();
    setBindingUser(null);
    setStores([]);
    setBoundStoreIds([]);
  }

  function toggleBoundStore(storeId: string, checked: boolean) {
    setBoundStoreIds((current) => checked ? [...current, storeId] : current.filter((id) => id !== storeId));
  }

  async function submitStoreBinding(event: FormEvent) {
    event.preventDefault();
    const userId = String(bindingUser?.id ?? "");
    if (!userId) {
      return;
    }
    try {
      await apiPut(`/api/users/${userId}/stores`, { storeIds: boundStoreIds });
      closeStoreBinding();
      setMessage("账号店铺权限已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号店铺权限保存失败");
    }
  }

  async function removeUser(user: AnyRow) {
    const userId = String(user.id ?? "");
    if (!userId || userId === currentUser.id) return;
    if (!window.confirm(`确认删除账号 ${String(user.username ?? "")}？`)) {
      return;
    }
    try {
      await apiDelete(`/api/users/${userId}`);
      await loadUsers();
      await loadAuditLogs(1, auditPageSize, appliedAuditFilters);
      setMessage("用户已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除用户失败");
    }
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
                <option value="admin">管理员</option>
                <option value="operation">运营人员</option>
                <option value="purchaser">采购人员</option>
                <option value="inbound">入库人员</option>
                <option value="outbound">出库人员</option>
                <option value="operator">普通操作员</option>
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
      {bindingUser ? (
        <FormDialog title={`店铺权限：${String(bindingUser.displayName ?? bindingUser.username ?? "")}`} onClose={closeStoreBinding} size="large">
          <form className="form-grid dialog-form" onSubmit={submitStoreBinding}>
            <div className="wide-field">
              <span>负责店铺</span>
              {stores.length > 0 ? (
                <div className="checkbox-list">
                  {stores.map((store) => {
                    const storeId = String(store.id ?? "");
                    return (
                      <label className="checkbox-field" key={storeId}>
                        <input
                          type="checkbox"
                          checked={boundStoreIds.includes(storeId)}
                          onChange={(event) => toggleBoundStore(storeId, event.target.checked)}
                        />
                        {String(store.name ?? "")}
                      </label>
                    );
                  })}
                </div>
              ) : <p className="field-hint">暂无启用店铺可授权</p>}
            </div>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">保存权限</button>
              <button className="ghost-button" type="button" onClick={closeStoreBinding}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      {showOutboundOperatorForm ? (
        <FormDialog title={editingOutboundOperatorId ? "编辑出库人员" : "新增出库人员"} onClose={closeOutboundOperatorForm}>
          <form className="form-grid dialog-form" onSubmit={submitOutboundOperator}>
            <label>
              出库人
              <input value={outboundOperatorName} onChange={(event) => setOutboundOperatorName(event.target.value)} required />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={outboundOperatorEnabled} onChange={(event) => setOutboundOperatorEnabled(event.target.checked)} />
              启用
            </label>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">保 存</button>
              <button className="ghost-button" type="button" onClick={closeOutboundOperatorForm}>取 消</button>
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
            { key: "role", header: "角色", render: (user) => roleLabels[String(user.role ?? "")] ?? String(user.role ?? "") },
            { key: "enabled", header: "状态", render: (user) => (user.enabled ? "启用" : "停用") },
            {
              key: "actions",
              header: "操作",
              render: (user) => {
                const isCurrentUser = String(user.id ?? "") === currentUser.id;
                return (
                  <div className="row-actions">
                    <button type="button" onClick={() => editUser(user)} disabled={isCurrentUser}>
                      编辑
                    </button>
                    <button type="button" onClick={() => void openStoreBinding(user)}>
                      店铺权限
                    </button>
                    <button type="button" onClick={() => void removeUser(user)} disabled={isCurrentUser}>
                      删除
                    </button>
                  </div>
                );
              },
            },
          ]}
        />
      </section>
      <section className="content-section">
        <div className="section-header">
          <h3>出库人员</h3>
          <button className="secondary-button" type="button" onClick={() => openOutboundOperatorForm()}>
            新增出库人员
          </button>
        </div>
        <DataTable
          rows={outboundOperators}
          columns={[
            { key: "name", header: "出库人" },
            { key: "enabled", header: "状态", render: (operator) => operator.enabled === false ? "停用" : "启用" },
            {
              key: "actions",
              header: "操作",
              render: (operator) => (
                <div className="row-actions">
                  <button type="button" onClick={() => openOutboundOperatorForm(operator)}>编辑</button>
                  <button type="button" onClick={() => void removeOutboundOperator(operator)}>删除</button>
                </div>
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
              <option value="outbound_plan">预发货清单</option>
              <option value="outbound_shipment">发货批次</option>
              <option value="outbound_operator">出库人员</option>
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
