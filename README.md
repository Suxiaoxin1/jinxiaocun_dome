# 伯尼库存管理系统

轻量库存管理系统，围绕配件库存、产品组成、采购入库、其它入库、产品出库、库存查看、盘点和历史数据查询构建。

## 本地开发

```powershell
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端 API 默认运行在 `http://localhost:3001`。

需要只启动后端时：

```powershell
npm run server
```

## 常用命令

```powershell
npm run test
npm run test:e2e
npm run build
npm run lint
```

## 数据与文件

- SQLite 数据库默认路径：`data/berni-inventory.sqlite`
- 配件图片默认路径：`uploads/parts/`

这两个目录需要定期备份。

## 部署建议

生产环境建议设置：

- `PORT=3001`
- `DB_FILE=data/berni-inventory.sqlite`
- `BERNI_ADMIN_PASSWORD=<上线前设置强密码>`
- `BERNI_OPERATOR_PASSWORD=<上线前设置强密码>`
- 定期备份 `data/` 和 `uploads/` 目录

如果部署到 NAS 或云服务器，需要确保 Node.js 可运行、服务器端口开放、数据目录可写。
