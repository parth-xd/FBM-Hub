-- ═══════════════════════════════════════════════════════════
-- FBM Hub PostgreSQL Schema
-- ═══════════════════════════════════════════════════════════

-- Drop existing tables (if starting fresh)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ═══ USERS TABLE ═══
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  role VARCHAR(50) DEFAULT 'viewer', -- owner, importer, viewer
  approved BOOLEAN DEFAULT FALSE,which o
  approved_at TIMESTAMP,
  approved_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ═══ ORDERS TABLE ═══
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL,
  sku VARCHAR(100),
  qty INTEGER,
  product_name TEXT,
  order_date DATE,
  delivery_date DATE,
  ship_by_date DATE,
  carrier VARCHAR(100),
  tracking_num VARCHAR(255),
  total_sell_price NUMERIC(10, 2),
  buy_link TEXT,
  po_id VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending', -- pending, ready, shipped, exception
  exception_type VARCHAR(100),
  exception_notes TEXT,
  dhl BOOLEAN DEFAULT FALSE,
  asin VARCHAR(100),
  imported_by VARCHAR(255),
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_qty CHECK (qty > 0),
  CONSTRAINT check_price CHECK (total_sell_price >= 0)
);

CREATE INDEX idx_orders_order_id ON orders(order_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_sku ON orders(sku);
CREATE INDEX idx_orders_po_id ON orders(po_id);
CREATE INDEX idx_orders_carrier ON orders(carrier);
CREATE INDEX idx_orders_dhl ON orders(dhl);
CREATE INDEX idx_orders_imported_at ON orders(imported_at DESC);
CREATE INDEX idx_orders_updated_at ON orders(updated_at DESC);

-- ═══ AUDIT_LOGS TABLE ═══
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  user_email VARCHAR(255),
  action VARCHAR(100),
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_order ON audit_logs(order_id);
CREATE INDEX idx_audit_email ON audit_logs(user_email);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_changed ON audit_logs(changed_at DESC);

-- ═══ IMPORT_TRACKING TABLE (NEW - for better import tracking) ═══
CREATE TABLE import_tracking (
  id SERIAL PRIMARY KEY,
  import_id VARCHAR(100) UNIQUE NOT NULL,
  imported_by VARCHAR(255),
  import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  csv_filename VARCHAR(255),
  total_rows INTEGER,
  successfully_imported INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  import_mode VARCHAR(50), -- shipstation, simple, etc
  status VARCHAR(50) DEFAULT 'success' -- success, partial, failed
);

CREATE INDEX idx_import_tracking_user ON import_tracking(imported_by);
CREATE INDEX idx_import_tracking_date ON import_tracking(import_date DESC);

-- ═══ FUNCTION FOR UPDATED_AT TIMESTAMP ═══
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══ TRIGGERS FOR AUTO TIMESTAMP ═══
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
