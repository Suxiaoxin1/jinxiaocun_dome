import { FormEvent, useState } from "react";
import type { SessionUser } from "../../shared/types";
import { apiPost } from "../api";

export default function LoginPage({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("请输入账号和密码");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const data = await apiPost<{ user: SessionUser }>("/api/auth/login", { username, password });
      onLogin(data.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-layout" aria-label="伯尼科技进销存系统登录">
        <div className="login-intro">
          <div className="login-brand-row">
            <div className="brand-mark">伯</div>
            <div>
              <h1>伯尼科技</h1>
              <p>进销存管理系统</p>
            </div>
          </div>
          <div className="login-intro-copy">
            <p className="login-kicker">企业库存与采购协同平台</p>
            <h2>统一管理采购、入库、出库、盘点与库存预警。</h2>
            <p>面向日常业务操作，聚焦数据准确、流程清晰和权限可控。</p>
          </div>
          <div className="login-feature-grid" aria-label="系统能力">
            <span>采购跟踪</span>
            <span>库存预警</span>
            <span>角色权限</span>
            <span>历史追溯</span>
          </div>
        </div>
        <form className="login-panel" onSubmit={handleSubmit}>
          <div className="login-heading">
            <p>账号登录</p>
            <h2>欢迎使用伯尼科技 ERP</h2>
          </div>
          <label>
            账号
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button login-submit" type="submit" disabled={submitting}>
            {submitting ? "登录中..." : "登录"}
          </button>
          <p className="login-help">新用户请联系管理员开通账号；忘记密码请由管理员重置。</p>
        </form>
      </section>
    </main>
  );
}
