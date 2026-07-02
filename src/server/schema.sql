CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'purchaser', 'inbound', 'outbound', 'operation')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
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
  image_url TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_bom_items (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_product_bom_items_product_id ON product_bom_items(product_id);
CREATE INDEX IF NOT EXISTS idx_product_bom_items_part_id ON product_bom_items(part_id);

CREATE TABLE IF NOT EXISTS part_stock (
  part_id TEXT PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
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
  status TEXT NOT NULL CONSTRAINT purchase_orders_status_check CHECK (status IN ('已下单', '在途', '工厂缺货', '已入库', '部分入库')),
 remark TEXT,
 order_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, part_id)
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  logistics_no TEXT,
  part_id TEXT NOT NULL REFERENCES parts(id),
  purchase_quantity INTEGER NOT NULL CHECK (purchase_quantity > 0),
 inbound_quantity INTEGER NOT NULL DEFAULT 0 CHECK (inbound_quantity >= 0),
  status TEXT NOT NULL CONSTRAINT purchase_receipts_status_check CHECK (status IN ('已下单', '在途', '工厂缺货', '已入库', '部分入库')),
 remark TEXT,
 inbound_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (purchase_order_id, part_id) REFERENCES purchase_orders(id, part_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS other_inbounds (
  id TEXT PRIMARY KEY,
  inbound_source TEXT NOT NULL,
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
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_products (
  store_id TEXT NOT NULL REFERENCES outbound_stores(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (store_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_store_products_product_id ON store_products(product_id);

CREATE TABLE IF NOT EXISTS user_stores (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES outbound_stores(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stores_store_id ON user_stores(store_id);

CREATE TABLE IF NOT EXISTS outbound_records (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  store_id TEXT NOT NULL REFERENCES outbound_stores(id),
  outbound_quantity INTEGER NOT NULL CHECK (outbound_quantity > 0),
  pre_outbound_quantity INTEGER NOT NULL DEFAULT 1 CHECK (pre_outbound_quantity > 0),
  actual_outbound_quantity INTEGER NOT NULL DEFAULT 1 CHECK (actual_outbound_quantity > 0),
  outbound_time TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '已出库' CHECK (status IN ('待审核', '已出库')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_plans (
  id TEXT PRIMARY KEY,
  plan_no TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES outbound_stores(id),
  operator_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('预出库', '部分发货', '已出库', '已取消')),
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_plans_store_id ON outbound_plans(store_id);
CREATE INDEX IF NOT EXISTS idx_outbound_plans_status ON outbound_plans(status);

CREATE TABLE IF NOT EXISTS outbound_plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES outbound_plans(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  pre_outbound_quantity INTEGER NOT NULL CHECK (pre_outbound_quantity > 0),
  shipped_quantity INTEGER NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0),
  cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_plan_items_plan_id ON outbound_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_outbound_plan_items_product_id ON outbound_plan_items(product_id);

CREATE TABLE IF NOT EXISTS outbound_shipments (
  id TEXT PRIMARY KEY,
  shipment_no TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL REFERENCES outbound_plans(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('待审核', '已出库')),
  outbound_time TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  shipment_type TEXT,
  goods_id TEXT,
  pickup_no TEXT,
  carton_count INTEGER,
  weight REAL,
  dimensions TEXT,
  remark TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_shipments_plan_id ON outbound_shipments(plan_id);
CREATE INDEX IF NOT EXISTS idx_outbound_shipments_status ON outbound_shipments(status);

CREATE TABLE IF NOT EXISTS outbound_shipment_items (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES outbound_shipments(id) ON DELETE CASCADE,
  plan_item_id TEXT NOT NULL REFERENCES outbound_plan_items(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  shipped_quantity INTEGER NOT NULL CHECK (shipped_quantity >= 0),
  before_remaining_quantity INTEGER NOT NULL CHECK (before_remaining_quantity >= 0),
  after_remaining_quantity INTEGER NOT NULL CHECK (after_remaining_quantity >= 0),
  finish_remaining INTEGER NOT NULL DEFAULT 0 CHECK (finish_remaining IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_shipment_items_shipment_id ON outbound_shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_outbound_shipment_items_plan_item_id ON outbound_shipment_items(plan_item_id);

CREATE TABLE IF NOT EXISTS stocktakes (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  previous_quantity INTEGER NOT NULL,
  actual_quantity INTEGER NOT NULL,
  remark TEXT,
  stocktake_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('采购入库', '其它入库', '产品出库', '盘点调整')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  source_id TEXT NOT NULL,
  source_table TEXT NOT NULL CHECK (source_table IN ('purchase_receipts', 'other_inbounds', 'outbound_records', 'outbound_shipments', 'stocktakes')),
  remark TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS low_stock_ignores (
  part_id TEXT PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
  ignore_count INTEGER NOT NULL DEFAULT 0 CHECK (ignore_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_username TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data TEXT,
  after_data TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
