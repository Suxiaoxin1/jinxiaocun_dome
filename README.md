# 伯尼科技

轻量库存管理系统，围绕配件库存、产品组成、采购入库、其它入库、产品出库、库存查看、盘点和历史数据查询构建。

## 本地开发

本项目后端使用 PostgreSQL。本机调试时，先确认 PostgreSQL 服务已启动，并在同一个 PowerShell 窗口里设置 `DATABASE_URL` 后再运行开发命令。

```powershell
cd D:\5.28进销存系统

# 确保 PostgreSQL 服务启动
Start-Service postgresql-x64-18

# 当前终端设置数据库连接
$env:DATABASE_URL="postgres://postgres:123456@127.0.0.1:5432/berni_inventory"

npm install
npm run dev
```

启动成功后，终端应看到：

```text
API server listening on http://localhost:3001
Local: http://localhost:5173/
```

前端默认运行在 `http://localhost:5173`，后端 API 默认运行在 `http://localhost:3001`。如果 `5173` 被占用，Vite 会自动切换到 `5174` 等其它端口，以终端打印的 `Local:` 地址为准。

默认登录账号：

```text
admin / admin123
```

需要只启动后端时：

```powershell
$env:DATABASE_URL="postgres://postgres:123456@127.0.0.1:5432/berni_inventory"
npm run server
```

如果数据库还没有创建，先执行：

```powershell
$env:PGPASSWORD="123456"
& "D:\PostgreSQL\bin\createdb.exe" -h 127.0.0.1 -p 5432 -U postgres berni_inventory
```

## 常用命令

```powershell
npm run test
npm run test:e2e
npm run build
npm run lint
```

## 数据与文件

- PostgreSQL 数据库连接由 `DATABASE_URL` 指定
- PostgreSQL 连接池上限由 `PG_POOL_MAX` 指定，默认 `10`
- 配件图片默认路径：`uploads/parts/`
- 产品图片默认路径：`uploads/products/`

生产环境需要定期备份 PostgreSQL 数据库和 `uploads/` 目录，可使用 `scripts/backup-postgres-and-uploads.sh`。

## 部署建议

生产环境建议设置：

- `PORT=3001`
- `DATABASE_URL=postgres://<user>:<password>@<host>:5432/<database>`
- `BERNI_ADMIN_PASSWORD=<上线前设置强密码>`
- `BERNI_OPERATOR_PASSWORD=<上线前设置强密码>`
- `BERNI_ALLOWED_ORIGINS=https://你的前端域名`
- `PG_POOL_MAX=10`
- 定期备份 PostgreSQL 数据库和 `uploads/` 目录
- 可从 `ecosystem.config.cjs.example` 复制 PM2 配置模板后修改密码和域名

如果部署到 NAS 或云服务器，需要确保 Node.js 可运行、PostgreSQL 可连接、服务器端口开放、`uploads/` 目录可写。
