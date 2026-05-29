PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('在售', '不在售')),
  weight REAL,
  image_url TEXT,
  specification TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_bom_items (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (product_id, part_id)
);

CREATE TABLE IF NOT EXISTS part_stock (
  part_id TEXT PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  remark TEXT,
  last_stocktake_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  logistics_no TEXT,
  part_id TEXT NOT NULL REFERENCES parts(id),
  order_quantity INTEGER NOT NULL CHECK (order_quantity > 0),
  status TEXT NOT NULL CHECK (status IN ('缺货', '在途', '已签收', '部分签收')),
  remark TEXT,
  order_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  logistics_no TEXT,
  part_id TEXT NOT NULL REFERENCES parts(id),
  purchase_quantity INTEGER NOT NULL CHECK (purchase_quantity > 0),
  inbound_quantity INTEGER NOT NULL DEFAULT 0 CHECK (inbound_quantity >= 0),
  status TEXT NOT NULL CHECK (status IN ('缺货', '在途', '已签收', '部分签收')),
  remark TEXT,
  inbound_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS other_inbounds (
  id TEXT PRIMARY KEY,
  inbound_no TEXT NOT NULL UNIQUE,
  part_id TEXT NOT NULL REFERENCES parts(id),
  inbound_quantity INTEGER NOT NULL CHECK (inbound_quantity > 0),
  inbound_time TEXT NOT NULL,
  operator_name TEXT,
  remark TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_records (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  store_id TEXT NOT NULL REFERENCES outbound_stores(id),
  outbound_quantity INTEGER NOT NULL CHECK (outbound_quantity > 0),
  outbound_time TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stocktakes (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
  actual_quantity INTEGER NOT NULL CHECK (actual_quantity >= 0),
  remark TEXT,
  stocktake_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('采购入库', '其它入库', '产品出库', '盘点调整')),
  quantity_delta INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL
);
