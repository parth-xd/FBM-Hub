-- FBM Hub PostgreSQL Schema
-- Run this in Render PostgreSQL dashboard or via psql

-- Create ENUM types for statuses
CREATE TYPE order_status AS ENUM ('pending', 'packed', 'shipped');
CREATE TYPE row_status AS ENUM ('normal', 'green', 'orange', 'red');

-- Orders table (main data)
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  sheet_row INT NOT NULL UNIQUE,
  order_id VARCHAR(50),
  order_date TIMESTAMP,
  product_name TEXT,
  total_sell_price DECIMAL(10,2),
  total_buy_price_inc_vat DECIMAL(10,2),
  total_buy_price_exc_vat DECIMAL(10,2),
  shipping_cost_gbp DECIMAL(10,2),
  expected_profit DECIMAL(10,2),
  weight DECIMAL(8,3),
  suggested_weight DECIMAL(8,3),
  label_printed BOOLEAN DEFAULT false,
  status order_status DEFAULT 'pending',
  is_dhl BOOLEAN DEFAULT false,
  po_id VARCHAR(50),
  s_qty DECIMAL(10,2),
  b_qty DECIMAL(10,2),
  qty_received DECIMAL(10,2),
  discrepancy DECIMAL(10,2),
  exception_reason TEXT,
  exception_stock_solution TEXT,
  exception_po_created BOOLEAN DEFAULT false,
  goods_not_available BOOLEAN DEFAULT false,
  is_multi_po BOOLEAN DEFAULT false,
  ship_by_date TIMESTAMP,
  expected_delivery_date TIMESTAMP,
  purchased_by VARCHAR(100),
  checked_by VARCHAR(100),
  buy_link TEXT,
  asin VARCHAR(20),
  sku VARCHAR(100),
  shipstation_link TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(100),
  locked_by VARCHAR(100),
  locked_at TIMESTAMP
);

-- Create indexes for fast queries
CREATE INDEX idx_order_id ON orders(order_id);
CREATE INDEX idx_status ON orders(status);
CREATE INDEX idx_sheet_row ON orders(sheet_row);
CREATE INDEX idx_po_id ON orders(po_id);
CREATE INDEX idx_updated_at ON orders(updated_at DESC);
CREATE INDEX idx_locked_by ON orders(locked_by);

-- Audit log table
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  user_email VARCHAR(100),
  action VARCHAR(50),
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_order ON audit_logs(order_id);
CREATE INDEX idx_audit_user ON audit_logs(user_email);
CREATE INDEX idx_audit_changed ON audit_logs(changed_at DESC);

-- Issues table
CREATE TABLE issues (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  issue_type VARCHAR(50),
  description TEXT,
  severity VARCHAR(20),
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100)
);

CREATE INDEX idx_issues_order ON issues(order_id);
CREATE INDEX idx_issues_resolved ON issues(resolved);

-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(100),
  role VARCHAR(50),
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to determine row status (conditional formatting)
CREATE OR REPLACE FUNCTION get_row_status(
  label_printed BOOLEAN,
  qty_rec DECIMAL,
  disc DECIMAL
) RETURNS row_status AS $$
BEGIN
  -- Green: order is packed (label printed)
  IF label_printed = true THEN
    RETURN 'green'::row_status;
  END IF;
  
  -- Red: there's a discrepancy
  IF disc IS NOT NULL AND disc != 0 THEN
    RETURN 'red'::row_status;
  END IF;
  
  -- Orange: quantity has been received
  IF qty_rec IS NOT NULL AND qty_rec > 0 THEN
    RETURN 'orange'::row_status;
  END IF;
  
  -- Normal: no special status
  RETURN 'normal'::row_status;
END;
$$ LANGUAGE plpgsql;
