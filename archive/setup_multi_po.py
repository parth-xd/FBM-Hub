#!/usr/bin/env python3
import psycopg2

conn = psycopg2.connect(
    dbname="fbm_hub_dev",
    user="ops",
    password="26@December*o4",
    host="localhost",
    port=5432
)
cursor = conn.cursor()

# Drop the old orders table
cursor.execute("DROP TABLE IF EXISTS orders CASCADE;")
conn.commit()
print("✅ Dropped old orders table")

# Create new table without UNIQUE constraint on order_id
cursor.execute("""
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
  status VARCHAR(50) DEFAULT 'pending',
  exception_type VARCHAR(100),
  exception_notes TEXT,
  dhl BOOLEAN DEFAULT FALSE,
  asin VARCHAR(100),
  imported_by VARCHAR(255),  
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_qty CHECK (qty > 0),
  CONSTRAINT check_price CHECK (total_sell_price >= 0)
)
""")

cursor.execute("CREATE INDEX idx_orders_order_id ON orders(order_id);")
cursor.execute("CREATE INDEX idx_orders_status ON orders(status);")
cursor.execute("CREATE INDEX idx_orders_sku ON orders(sku);")
cursor.execute("CREATE INDEX idx_orders_po_id ON orders(po_id);")
cursor.execute("CREATE INDEX idx_orders_carrier ON orders(carrier);")
cursor.execute("CREATE INDEX idx_orders_dhl ON orders(dhl);")
cursor.execute("CREATE INDEX idx_orders_imported_at ON orders(imported_at DESC);")
cursor.execute("CREATE INDEX idx_orders_updated_at ON orders(updated_at DESC);")

conn.commit()
print("✅ Created new orders table (multi-PO ready)")

cursor.close()
conn.close()
