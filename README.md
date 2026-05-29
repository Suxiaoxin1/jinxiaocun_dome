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
