require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const http = require('http');

// ═══ INITIALIZE EXPRESS + HTTP SERVER + WEBSOCKET ═══
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(cors());
app.use(express.json({limit: '50mb'}));
app.use(express.static('public'));

// ═══ SQLITE DATABASE ═══
const DB_PATH = path.join(__dirname, 'fbm_hub.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log(`📊 SQLite Database: ${DB_PATH}`);

// ═══ IN-MEMORY DATA FOR AUTH ═══
const users = new Map();
const pendingApprovals = new Map();
const loginTokens = new Map();

const OWNER_EMAIL = 'parttthh@gmail.com';
const crypto = require('crypto');

// ═══ EMAIL SERVICE ═══
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendEmail = async (to, subject, html) => {
  try {
    if (!resend) {
      console.warn('⚠️  RESEND_API_KEY not configured.');
      return false;
    }

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Babaclick <onboarding@resend.dev>',
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Email error:', error);
      return false;
    }

    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Email service error:', error.message);
    return false;
  }
};

// ═══ BROADCAST TO WEBSOCKET CLIENTS ═══
const broadcast = (type, data) => {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// ═══ WEBSOCKET ═══
wss.on('connection', (ws) => {
  console.log(`✅ WebSocket client connected (total: ${wss.clients.size})`);
  ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

  ws.on('close', () => {
    console.log(`❌ WebSocket disconnected (remaining: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// ═══ INITIALIZE DATABASE SCHEMA ═══
const initializeDB = () => {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_row INTEGER,
        order_id TEXT,
        order_date TEXT,
        product_name TEXT,
        total_sell_price REAL,
        total_buy_price_inc_vat REAL,
        total_buy_price_exc_vat REAL,
        shipping_cost_gbp REAL,
        expected_profit REAL,
        weight REAL,
        suggested_weight REAL,
        label_printed INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        is_dhl INTEGER DEFAULT 0,
        po_id TEXT,
        s_qty REAL,
        b_qty REAL,
        qty_received REAL,
        discrepancy REAL,
        exception_reason TEXT,
        exception_stock_solution TEXT,
        exception_po_created INTEGER DEFAULT 0,
        goods_not_available INTEGER DEFAULT 0,
        is_multi_po INTEGER DEFAULT 0,
        ship_by_date TEXT,
        expected_delivery_date TEXT,
        purchased_by TEXT,
        checked_by TEXT,
        buy_link TEXT,
        asin TEXT,
        sku TEXT,
        shipstation_link TEXT,
        unit_buy_price_inc_vat REAL,
        delivery_fee_per_line REAL,
        vat_status TEXT,
        supplier_order_date TEXT,
        supplier_order_ref TEXT,
        expected_delivery_time TEXT,
        marked_dispatched_on TEXT,
        refunded INTEGER DEFAULT 0,
        refund_date TEXT,
        rate_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT,
        locked_by TEXT,
        locked_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id);
      CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_sheet_row ON orders(sheet_row);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON orders(updated_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        user_email TEXT,
        action TEXT,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_logs(order_id);
      CREATE INDEX IF NOT EXISTS idx_audit_changed ON audit_logs(changed_at DESC);

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      CREATE TABLE IF NOT EXISTS reference_data (
        asin TEXT PRIMARY KEY,
        weight_kg REAL,
        vetted_supplier TEXT,
        buy_price_inc_vat REAL,
        vat_status TEXT,
        sourced_by TEXT,
        handling_time TEXT,
        min_sell_price REAL,
        buy_box_sell_price REAL,
        active_sell_price REAL
      );

      CREATE TABLE IF NOT EXISTS royal_mail_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route TEXT,
        weight_from REAL,
        weight_to REAL,
        service_name TEXT,
        price_per_item REAL,
        price_per_kg REAL,
        fuel_surcharge REAL,
        duty_handling_fee REAL
      );

      CREATE TABLE IF NOT EXISTS exchange_rates (
        date TEXT PRIMARY KEY,
        gbp_usd_rate REAL,
        source TEXT DEFAULT 'google-finance',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_exchange_date ON exchange_rates(date DESC);
    `);

    console.log('✅ Database schema initialized');

    // ═══ MIGRATION: Ensure rate_date column exists ═══
    try {
      db.prepare("SELECT rate_date FROM orders LIMIT 1").get();
    } catch (err) {
      console.log('🔄 Migrating: Adding rate_date column to orders table...');
      db.exec('ALTER TABLE orders ADD COLUMN rate_date TEXT');
      // Set rate_date to today's date for all existing orders
      db.prepare("UPDATE orders SET rate_date = ? WHERE rate_date IS NULL").run(getTodayDateString());
      console.log('✅ Migration complete: rate_date column added and populated');
    }

    // ═══ MIGRATION: Remove UNIQUE constraint from sheet_row ═══
    try {
      const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
      if (tableInfo && tableInfo.sql && tableInfo.sql.includes('sheet_row INTEGER UNIQUE')) {
        console.log('🔄 Migrating: Removing UNIQUE constraint from sheet_row...');
        db.exec(`
          CREATE TABLE orders_new AS SELECT * FROM orders;
          DROP TABLE orders;
          ALTER TABLE orders_new RENAME TO orders;
          CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id);
          CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
          CREATE INDEX IF NOT EXISTS idx_sheet_row ON orders(sheet_row);
          CREATE INDEX IF NOT EXISTS idx_updated_at ON orders(updated_at DESC);
        `);
        console.log('✅ Migration complete: sheet_row UNIQUE constraint removed');
      }
    } catch (err) {
      console.warn('⚠️  sheet_row migration error:', err.message);
    }

    // ═══ Initialize today's exchange rate (if not already set) ═══
    try {
      getCurrentRate(); // This will create default if doesn't exist
    } catch (err) {
      console.warn('⚠️  Could not initialize exchange rate:', err.message);
    }

  } catch (err) {
    console.error('❌ DB initialization error:', err.message);
  }
};

// ═══ AUTH ENDPOINTS ═══

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({error: 'Missing fields'});

    const approvalToken = crypto.randomBytes(32).toString('hex');
    pendingApprovals.set(approvalToken, { email, name, role: 'viewer', createdAt: new Date() });

    const approveUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:3000'}/api/auth/approve?token=${approvalToken}`;
    const rejectUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:3000'}/api/auth/reject?token=${approvalToken}`;

    const ownerEmailHtml = `
      <h2>New User Signup Request</h2>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Name:</strong> ${name}</p>
      <p style="margin-top: 20px;">
        <a href="${approveUrl}" style="padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 4px;">✅ Approve</a>
        <a href="${rejectUrl}" style="margin-left: 10px; padding: 10px 20px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px;">❌ Reject</a>
      </p>
    `;

    await sendEmail(OWNER_EMAIL, `New User Request: ${name}`, ownerEmailHtml);
    await sendEmail(email, 'FBM Hub - Waiting for Approval', '<p>Your request is pending owner approval.</p>');

    res.json({ok: true, message: 'Signup request sent.'});
  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(500).json({error: error.message});
  }
});

app.post('/api/auth/send-login-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({error: 'Email required'});

    const stmt = db.prepare('SELECT * FROM users WHERE email = ? AND status = ?');
    const user = stmt.get(email, 'approved');
    if (!user) return res.status(401).json({error: 'User not found or not approved'});

    const token = crypto.randomBytes(32).toString('hex');
    loginTokens.set(token, { email, expires: Date.now() + 15 * 60 * 1000, used: false });

    const loginUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:3000'}?token=${token}`;
    const html = `<h2>FBM Hub Login Link</h2><p><a href="${loginUrl}">🔐 Login (valid 15 mins)</a></p>`;

    await sendEmail(email, 'Your FBM Hub Login Link', html);
    res.json({ok: true});
  } catch (error) {
    console.error('Login email error:', error.message);
    res.status(500).json({error: error.message});
  }
});

app.post('/api/auth/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({error: 'Token required'});

    const tokenData = loginTokens.get(token);
    if (!tokenData) return res.status(401).json({error: 'Invalid token'});
    if (tokenData.expires < Date.now()) return res.status(401).json({error: 'Token expired'});

    loginTokens.delete(token);
    const jwtToken = jwt.sign({ email: tokenData.email }, process.env.JWT_SECRET || 'secret123', { expiresIn: '7d' });

    res.json({ok: true, token: jwtToken, email: tokenData.email});
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(500).json({error: error.message});
  }
});

app.get('/api/auth/approve', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({error: 'Token required'});

    const approval = pendingApprovals.get(token);
    if (!approval) return res.status(401).json({error: 'Invalid token'});

    const stmt = db.prepare('INSERT OR IGNORE INTO users (email, name, role, status) VALUES (?, ?, ?, ?)');
    stmt.run(approval.email, approval.name, approval.role, 'approved');

    const updateStmt = db.prepare('UPDATE users SET status = ? WHERE email = ?');
    updateStmt.run('approved', approval.email);

    pendingApprovals.delete(token);

    await sendEmail(approval.email, 'Account Approved - FBM Hub', '<h2>Welcome!</h2><p>Your account has been approved.</p>');
    res.redirect('/?message=approved');
  } catch (error) {
    console.error('Approval error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// ═══ ORDERS ENDPOINTS ═══

app.get('/api/orders', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset || '0');
    const limit = parseInt(req.query.limit || '100');

    const stmt = db.prepare('SELECT * FROM orders ORDER BY sheet_row ASC LIMIT ? OFFSET ?');
    const orders = stmt.all(limit, offset);

    const countStmt = db.prepare('SELECT COUNT(*) as count FROM orders');
    const { count } = countStmt.get();

    res.json({orders, total: count, offset, limit});
  } catch (error) {
    console.error('Get orders error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// ═══ BULK DELETE ORDERS ═══
app.post('/api/orders/bulk-delete', async (req, res) => {
  try {
    const { orderIds } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const userRole = req.headers['x-user-role'] || '';

    if (!['owner', 'importer'].includes(userRole)) {
      return res.status(403).json({ error: 'Only owners and importers can delete orders' });
    }

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'orderIds array required' });
    }

    if (orderIds.length > 5000) {
      return res.status(400).json({ error: 'Cannot delete more than 5000 orders at once' });
    }

    // Validate all IDs are integers
    const validIds = orderIds.filter(id => Number.isInteger(Number(id)));
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'No valid order IDs provided' });
    }

    console.log(`🗑️  Bulk delete: Attempting to delete ${validIds.length} orders by ${userEmail}`);

    // Temporarily disable foreign key constraints, delete, then re-enable
    let deletedCount = 0;
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      
      const tx = db.transaction(() => {
        const placeholders = validIds.map(() => '?').join(',');
        const deleteStmt = db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`);
        const result = deleteStmt.run(...validIds.map(Number));
        
        console.log(`✅ Bulk delete: Successfully deleted ${result.changes} orders`);
        
        // Log to audit_logs with NULL for order_id (bulk operation)
        try {
          const auditStmt = db.prepare(`
            INSERT INTO audit_logs (order_id, user_email, action, field_name, old_value, new_value)
            VALUES (NULL, ?, ?, ?, ?, ?)
          `);
          auditStmt.run(userEmail, 'BULK_DELETE', 'orders_deleted', String(validIds.length), 'deleted');
          console.log(`📝 Audit log recorded for bulk delete`);
        } catch (auditErr) {
          console.warn(`⚠️  Audit logging skipped: ${auditErr.message}`);
        }
        
        return result.changes;
      });

      deletedCount = tx();
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    broadcast('orders-deleted', { ids: validIds.map(Number), deletedBy: userEmail });
    
    res.json({ ok: true, deleted: deletedCount });
  } catch (error) {
    console.error(`❌ Bulk delete error: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Create a new order (used for Exception POs)
app.post('/api/orders/create', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const o = req.body;
    if (!o || !o.order_id) return res.status(400).json({ error: 'order_id is required' });

    const stmt = db.prepare(`
      INSERT INTO orders (
        order_id, order_date, product_name, total_sell_price, ship_by_date,
        asin, sku, s_qty, b_qty, po_id, buy_link, is_dhl,
        unit_buy_price_inc_vat, delivery_fee_per_line, total_buy_price_inc_vat,
        vat_status, total_buy_price_exc_vat, weight, shipping_cost_gbp,
        expected_profit, exception_reason, exception_po_created,
        status, purchased_by, updated_at, updated_by
      ) VALUES (
        @order_id, @order_date, @product_name, @total_sell_price, @ship_by_date,
        @asin, @sku, @s_qty, @b_qty, @po_id, @buy_link, @is_dhl,
        @unit_buy_price_inc_vat, @delivery_fee_per_line, @total_buy_price_inc_vat,
        @vat_status, @total_buy_price_exc_vat, @weight, @shipping_cost_gbp,
        @expected_profit, @exception_reason, @exception_po_created,
        @status, @purchased_by, datetime('now'), @updated_by
      )
    `);

    const result = stmt.run({
      order_id: o.order_id,
      order_date: o.order_date || null,
      product_name: o.product_name || null,
      total_sell_price: o.total_sell_price || null,
      ship_by_date: o.ship_by_date || null,
      asin: o.asin || null,
      sku: o.sku || null,
      s_qty: o.s_qty || null,
      b_qty: o.b_qty || null,
      po_id: o.po_id || null,
      buy_link: o.buy_link || null,
      is_dhl: o.is_dhl ? 1 : 0,
      unit_buy_price_inc_vat: o.unit_buy_price_inc_vat || null,
      delivery_fee_per_line: o.delivery_fee_per_line || null,
      total_buy_price_inc_vat: o.total_buy_price_inc_vat || null,
      vat_status: o.vat_status || null,
      total_buy_price_exc_vat: o.total_buy_price_exc_vat || null,
      weight: o.weight || null,
      shipping_cost_gbp: o.shipping_cost_gbp || null,
      expected_profit: o.expected_profit || null,
      exception_reason: o.exception_reason || null,
      exception_po_created: o.exception_po_created ? 1 : 0,
      status: o.status || 'pending_source',
      purchased_by: userEmail,
      updated_by: userEmail,
    });

    const newOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
    broadcast('order-created', { order: newOrder, createdBy: userEmail });
    res.json({ ok: true, order: newOrder });
  } catch (error) {
    console.error('Create order error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { weight, status, label_printed, qty_received, discrepancy, ...updates } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';

    // Allowed column names to prevent SQL injection
    const ALLOWED_COLUMNS = new Set([
      'weight', 'status', 'label_printed', 'qty_received', 'discrepancy',
      'order_id', 'order_date', 'product_name', 'total_sell_price',
      'total_buy_price_inc_vat', 'total_buy_price_exc_vat', 'shipping_cost_gbp',
      'expected_profit', 'suggested_weight', 'is_dhl', 'po_id', 's_qty', 'b_qty',
      'exception_reason', 'exception_stock_solution', 'exception_po_created',
      'goods_not_available', 'is_multi_po', 'ship_by_date', 'expected_delivery_date',
      'purchased_by', 'checked_by', 'buy_link', 'asin', 'sku', 'shipstation_link',
      'unit_buy_price_inc_vat', 'delivery_fee_per_line', 'vat_status',
      'supplier_order_date', 'supplier_order_ref', 'expected_delivery_time',
      'marked_dispatched_on', 'refunded', 'refund_date',
      'locked_by', 'locked_at'
    ]);

    // Get old values
    const getStmt = db.prepare('SELECT * FROM orders WHERE id = ?');
    const oldData = getStmt.get(id);
    if (!oldData) return res.status(404).json({error: 'Order not found'});

    // Build update query
    const updateFields = [];
    const values = [];

    if (weight !== undefined) { updateFields.push('weight = ?'); values.push(weight); }
    if (status !== undefined) { updateFields.push('status = ?'); values.push(status); }
    if (label_printed !== undefined) { updateFields.push('label_printed = ?'); values.push(label_printed ? 1 : 0); }
    if (qty_received !== undefined) { updateFields.push('qty_received = ?'); values.push(qty_received); }
    if (discrepancy !== undefined) {
      updateFields.push('discrepancy = ?');
      values.push(discrepancy);
    } else if (qty_received !== undefined) {
      const nextDiscrepancy = qty_received == null || oldData.b_qty == null ? null : Number(oldData.b_qty) - Number(qty_received);
      updateFields.push('discrepancy = ?');
      values.push(nextDiscrepancy);
    }

    Object.entries(updates).forEach(([key, val]) => {
      if (!ALLOWED_COLUMNS.has(key)) return; // skip disallowed columns
      updateFields.push(`${key} = ?`);
      values.push(val);
    });

    updateFields.push("updated_at = datetime('now')");
    updateFields.push('updated_by = ?');
    values.push(userEmail);
    values.push(id);

    const updateSQL = `UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?`;
    const updateStmt = db.prepare(updateSQL);
    updateStmt.run(...values);

    // Log changes (with graceful fallback if audit_logs doesn't exist)
    try {
      Object.entries(updates).forEach(([key, val]) => {
        if (String(oldData[key]) !== String(val)) {
          const auditStmt = db.prepare('INSERT INTO audit_logs (order_id, user_email, action, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)');
          auditStmt.run(id, userEmail, 'UPDATE', key, String(oldData[key] || ''), String(val || ''));
        }
      });
    } catch (auditErr) {
      console.warn('Audit logging skipped:', auditErr.message);
    }

    const newStmt = db.prepare('SELECT * FROM orders WHERE id = ?');
    const newData = newStmt.get(id);

    broadcast('order-updated', {id, changes: updates, updatedBy: userEmail, newData});

    res.json({ok: true, order: newData});
  } catch (error) {
    console.error('Update order error:', error.message);
    res.status(500).json({error: error.message});
  }
});

app.post('/api/orders/:id/lock', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.headers['x-user-email'] || req.body.userEmail || 'unknown';

    const stmt = db.prepare("UPDATE orders SET locked_by = ?, locked_at = datetime('now'), updated_at = datetime('now'), updated_by = ? WHERE id = ?");
    const result = stmt.run(userEmail, userEmail, id);
    if (result.changes === 0) return res.status(404).json({error: 'Order not found'});

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    broadcast('order-locked', {id: Number(id), locked_by: order.locked_by});
    broadcast('order-updated', {id: Number(id), changes: {locked_by: order.locked_by}, updatedBy: userEmail, newData: order});
    res.json({ok: true, order});
  } catch (error) {
    console.error('Lock order error:', error.message);
    res.status(500).json({error: error.message});
  }
});

app.post('/api/orders/:id/unlock', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.headers['x-user-email'] || req.body.userEmail || 'unknown';

    const stmt = db.prepare("UPDATE orders SET locked_by = NULL, locked_at = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?");
    const result = stmt.run(userEmail, id);
    if (result.changes === 0) return res.status(404).json({error: 'Order not found'});

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    broadcast('order-unlocked', {id: Number(id)});
    broadcast('order-updated', {id: Number(id), changes: {locked_by: null}, updatedBy: userEmail, newData: order});
    res.json({ok: true, order});
  } catch (error) {
    console.error('Unlock order error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// ═══ SHIPSTATION ═══

app.post('/api/shipstation/fulfill-order', async (req, res) => {
  try {
    const { orderId, weight, carrier } = req.body;

    if (!orderId || !weight) {
      return res.status(400).json({error: 'orderId and weight required'});
    }

    const shipstationKey = process.env.SHIPSTATION_API_KEY;
    const carrierId = carrier || process.env.SHIPSTATION_CARRIER_ID;

    if (!shipstationKey || !carrierId) {
      return res.status(400).json({error: 'ShipStation credentials not configured'});
    }

    const auth = Buffer.from(`${shipstationKey}:`).toString('base64');
    const response = await fetch('https://ssapi.shipstation.com/shipments/createlabel', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId,
        weight: {value: parseFloat(weight), units: 'ounces'},
        carrierId,
      }),
    });

    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (jsonErr) {
        return res.status(500).json({error: 'ShipStation returned invalid JSON'});
      }
    } else {
      const text = await response.text();
      return res.status(response.status || 500).json({error: `ShipStation error: ${text.substring(0, 200)}`});
    }

    if (!response.ok) {
      return res.status(response.status).json({error: data.message || 'ShipStation error'});
    }

    res.json({ok: true, label: data});
  } catch (error) {
    console.error('ShipStation error:', error.message);
    res.status(500).json({error: error.message});
  }
});

function parseShipstationCsv(content) {
  // Auto-detect delimiter: if first line has tabs, use tab; otherwise comma
  const firstLine = content.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function extractAsinFromSku(sku) {
  if (!sku) return null;
  const match = String(sku).match(/\b(B0[A-Z0-9]{8})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function isDhlCarrier(serviceRequested) {
  const v = String(serviceRequested || '').toLowerCase();
  return v.includes('expedited') || v.includes('dhl');
}

function extractOrderTokens(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const tokens = new Set([raw]);
  const amazonMatch = raw.match(/\b\d{3}-\d{7}-\d{7}\b/);
  if (amazonMatch) tokens.add(amazonMatch[0]);

  const longNumeric = raw.match(/\b\d{12,18}\b/g) || [];
  for (const n of longNumeric) tokens.add(n);

  return Array.from(tokens);
}

function findHeaderIndex(headers, aliases) {
  for (const a of aliases) {
    // Try exact case-insensitive match first
    const idx = headers.findIndex((h) => h.toLowerCase() === a.toLowerCase());
    if (idx !== -1) return idx;
    
    // Try normalized match (remove extra spaces)
    const normalizedAlias = a.toLowerCase().replace(/\s+/g, ' ').trim();
    const idx2 = headers.findIndex((h) => h.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedAlias);
    if (idx2 !== -1) return idx2;
  }
  return -1;
}

function parseNumber(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ═══ EXCHANGE RATE HELPERS ═══
function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Optional: Fetch live USD/GBP rate from external API
// Requires: import axios (npm install axios) or use native fetch
async function fetchLiveRate() {
  try {
    // This is a stub - you can integrate with:
    // - Google Finance API (requires authentication)
    // - exchangerate-api.com (free tier available)
    // - fixer.io or other exchange rate APIs
    // For now, returning null to use cached/default
    console.log('💱 Live rate fetch not yet configured. Using cached rate.');
    return null;
  } catch (err) {
    console.warn('⚠️  Could not fetch live rate:', err.message);
    return null;
  }
}

function getCurrentRate() {
  const today = getTodayDateString();
  let rate = db.prepare('SELECT gbp_usd_rate FROM exchange_rates WHERE date = ?').get(today);
  
  if (!rate) {
    // Rate not found, use default 1.34 and store it
    const defaultRate = 1.34;
    try {
      db.prepare('INSERT OR IGNORE INTO exchange_rates (date, gbp_usd_rate, source) VALUES (?, ?, ?)').run(today, defaultRate, 'default');
      console.log(`💱 Exchange rate set for ${today}: ${defaultRate} (default)`);
    } catch (err) {
      console.warn(`⚠️  Could not store default rate: ${err.message}`);
    }
    return defaultRate;
  }
  
  return rate.gbp_usd_rate;
}

function getRateForDate(dateStr) {
  if (!dateStr) return getCurrentRate();
  const rate = db.prepare('SELECT gbp_usd_rate FROM exchange_rates WHERE date = ?').get(dateStr);
  if (!rate) {
    // If rate doesn't exist for that date, return current rate as fallback
    console.warn(`⚠️  No rate found for date ${dateStr}, using current rate`);
    return getCurrentRate();
  }
  return rate.gbp_usd_rate;
}

function upsertImportedOrders(items, { apply, importedBy: rawImportedBy }) {
  const importedBy = (rawImportedBy && rawImportedBy !== 'unknown') ? rawImportedBy : 'shipstation-import';

  let withDhl = 0;
  let withAsin = 0;
  let created = 0;
  const creates = [];

  // items is an array — every entry becomes a new order row
  const itemList = Array.isArray(items) ? items : Array.from(items.values());
  console.log(`\ud83d\udcd1 upsertImportedOrders: Processing ${itemList.length} items (apply=${apply})`);
  
  for (const item of itemList) {
    if (item.isDhl) withDhl += 1;
    if (item.asin) withAsin += 1;

    creates.push({
      order_id: item.orderId,
      order_date: item.orderDate || null,
      ship_by_date: item.shipByDate || null,
      product_name: item.productName || null,
      total_sell_price: parseNumber(item.totalSellPrice, null),
      s_qty: parseNumber(item.qty, 1),
      b_qty: parseNumber(item.qty, 1),
      is_dhl: item.isDhl ? 1 : 0,
      asin: item.asin || null,
      sku: item.sku || null,
      buy_link: item.buyLink || null,
      po_id: item.poId || null,
      shipstation_link: item.shipstationLink || null,
      purchased_by: item.purchasedBy || importedBy || null,
      rate_date: getTodayDateString(),
    });
  }

  if (apply) {
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_id, order_date, ship_by_date, product_name,
        total_sell_price, s_qty, b_qty, is_dhl, asin, sku,
        buy_link, po_id, shipstation_link, purchased_by,
        rate_date, locked_by, locked_at, updated_at, updated_by
      ) VALUES (
        @order_id, @order_date, @ship_by_date, @product_name,
        @total_sell_price, @s_qty, @b_qty, @is_dhl, @asin, @sku,
        @buy_link, @po_id, @shipstation_link, @purchased_by,
        @rate_date, @importedBy, datetime('now'), datetime('now'), @importedBy
      )
    `);

    try {
      const tx = db.transaction(() => {
        for (const c of creates) {
          insertOrder.run({ ...c, importedBy: importedBy || 'shipstation-import' });
          created += 1;
        }
      });

      tx();
      console.log(`✅ upsertImportedOrders: Successfully inserted ${created} orders`);
      broadcast('orders-imported', { count: created });
    } catch (err) {
      console.error(`❌ upsertImportedOrders transaction failed: ${err.message}`);
      throw err;
    }
  } else {
    created = creates.length;
    console.log(`🔍 upsertImportedOrders (dry-run): Would insert ${created} orders`);
  }

  return {
    matched: 0,
    unmatched: creates.length,
    withDhl,
    withAsin,
    updatesRequired: 0,
    updatesApplied: 0,
    created,
  };
}

app.post('/api/shipstation/import-csv', async (req, res) => {
  try {
    const { csvContent, apply = false, mode = 'shipstation', importedBy } = req.body || {};
    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ error: 'csvContent is required' });
    }

    // Simple paste mode: each line is comma-separated values (no header row)
    // Format: Order ID, SKU, Qty, Product Name, Carrier, Order Date, Ship By, Sell Price, Buy Link, PO ID
    if (mode === 'simple') {
      const allLines = csvContent.split('\n');
      console.log(`📊 CSV split into ${allLines.length} total lines`);
      
      const lines = allLines.map(l => l.trim()).filter(l => l);
      console.log(`📊 After trim & filter: ${lines.length} non-empty lines`);
      
      if (lines.length === 0) {
        return res.status(400).json({ error: 'No order lines found' });
      }

      const allSimpleItems = [];
      let skippedCount = 0;
      for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        const orderId = parts[0] || '';
        if (!orderId) {
          skippedCount += 1;
          continue;
        }

        const sku = parts[1] || '';
        const qty = parseNumber(parts[2], 1);
        const productName = parts[3] || '';
        const carrier = parts[4] || '';
        const orderDate = parts[5] || '';
        const shipByDate = parts[6] || '';
        const totalSellPrice = parseNumber(parts[7], null);
        const buyLink = parts[8] || '';
        const poId = parts[9] || '';

        const asin = extractAsinFromSku(sku);
        const dhl = isDhlCarrier(carrier);

        allSimpleItems.push({
          orderId,
          isDhl: dhl,
          asin: asin || null,
          sku: sku || null,
          qty,
          productName: productName || null,
          orderDate: orderDate || null,
          shipByDate: shipByDate || null,
          totalSellPrice,
          buyLink: buyLink || null,
          poId: poId || null,
        });
      }

      const importedByUser = importedBy || req.headers['x-user-email'] || 'simple-import';
      const result = upsertImportedOrders(allSimpleItems, { apply, importedBy: importedByUser });
      
      console.log(`📊 Simple CSV Import: ${lines.length} total lines, ${skippedCount} skipped (no orderId), ${allSimpleItems.length} parsed, ${result.created} created`);

      return res.json({
        ok: true,
        summary: {
          csvRows: lines.length,
          validRows: allSimpleItems.length,
          uniqueOrderIds: new Set(allSimpleItems.map(i => i.orderId)).size,
          matched: result.matched,
          unmatched: result.unmatched,
          withDhl: result.withDhl,
          withAsin: result.withAsin,
          updatesRequired: result.updatesRequired,
          updatesApplied: result.updatesApplied,
          created: result.created,
          dryRun: !apply,
        },
      });
    }

    const rows = parseShipstationCsv(csvContent);
    if (rows.length < 2) {
      return res.status(400).json({ error: 'CSV appears empty or missing rows' });
    }

    const headers = rows[0].map((h) => String(h || '').trim()).filter(h => h); // Remove empty headers
    console.log('📋 CSV Headers detected:', headers);

    const allItems = [];
    let skippedDataRows = 0;
    
    // AUTO-DETECT format: Try ShipStation first, then fallback to custom
    const idxOrder = findHeaderIndex(headers, ['order_id', 'orderId', 'Order - Number', 'Order - Num', 'Order Number']);
    const idxSku = findHeaderIndex(headers, ['sku', 'Item - SKU']);
    const idxCarrier = findHeaderIndex(headers, ['carrier', 'Order - Carrier', 'Ord Carrier', 'Carrier - Service Requested']);
    const idxCarrierService = findHeaderIndex(headers, ['carrier_service', 'Carrier - Service', 'Carrier - Service Requested', 'Service']);
    const idxQty = findHeaderIndex(headers, ['qty', 's_qty', 'Item - Qty']);
    const idxName = findHeaderIndex(headers, ['product_name', 'productName', 'Item - Name']);
    const idxOrderDate = findHeaderIndex(headers, ['order_date', 'orderDate', 'Date - Order Date']);
    const idxShipBy = findHeaderIndex(headers, ['ship_by_date', 'shipByDate', 'Date - Ship By Date']);
    const idxTotal = findHeaderIndex(headers, ['total_sell_price', 'totalSellPrice', 'Amount - Order Total', 'Amount - Order Amount', 'Amount - Ord Amount']);
    const idxBuyLink = findHeaderIndex(headers, ['buy_link', 'buyLink']);
    const idxPo = findHeaderIndex(headers, ['po_id', 'poId']);

    console.log('🔍 Column indices:', { idxOrder, idxSku, idxCarrier, idxCarrierService, idxQty, idxName, idxOrderDate, idxShipBy, idxTotal });

    if (idxOrder === -1) {
      return res.status(400).json({ 
        error: `Missing order ID column. Expected: order_id, orderId, or Order - Number. Found columns: ${headers.join(', ')}` 
      });
    }

    // Parse all rows — each CSV row becomes a separate order (no dedup)
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];
      const orderId = String(r[idxOrder] || '').trim();
      if (!orderId) {
        skippedDataRows += 1;
        continue;
      }

      const sku = idxSku !== -1 ? String(r[idxSku] || '').trim() : '';
      const carrier = idxCarrier !== -1 ? String(r[idxCarrier] || '').trim() : '';
      const carrierService = idxCarrierService !== -1 ? String(r[idxCarrierService] || '').trim() : '';
      const asin = extractAsinFromSku(sku);
      const dhl = isDhlCarrier(carrier) || isDhlCarrier(carrierService);

      allItems.push({
        orderId,
        isDhl: dhl,
        asin: asin || null,
        sku: sku || null,
        qty: idxQty !== -1 ? parseNumber(r[idxQty], 1) : 1,
        productName: idxName !== -1 ? (String(r[idxName] || '').trim() || null) : null,
        orderDate: idxOrderDate !== -1 ? (String(r[idxOrderDate] || '').trim() || null) : null,
        shipByDate: idxShipBy !== -1 ? (String(r[idxShipBy] || '').trim() || null) : null,
        totalSellPrice: idxTotal !== -1 ? parseNumber(r[idxTotal], null) : null,
        buyLink: idxBuyLink !== -1 ? (String(r[idxBuyLink] || '').trim() || null) : null,
        poId: idxPo !== -1 ? (String(r[idxPo] || '').trim() || null) : null,
      });
    }

    const importedByUser = importedBy || req.headers['x-user-email'] || 'shipstation-import';
    const result = upsertImportedOrders(allItems, { apply, importedBy: importedByUser });
    
    console.log(`📊 ShipStation CSV Import: ${rows.length - 1} data rows, ${skippedDataRows} skipped (no orderId), ${allItems.length} parsed, ${result.created} created`);

    return res.json({
      ok: true,
      summary: {
        csvRows: rows.length - 1,
        validRows: allItems.length,
        uniqueOrderIds: new Set(allItems.map(i=>i.orderId)).size,
        matched: result.matched,
        unmatched: result.unmatched,
        withDhl: result.withDhl,
        withAsin: result.withAsin,
        updatesRequired: result.updatesRequired,
        updatesApplied: result.updatesApplied,
        created: result.created,
        dryRun: !apply,
      },
    });
  } catch (error) {
    console.error('ShipStation CSV import error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/shipstation/import-single', async (req, res) => {
  try {
    const payload = req.body || {};
    const orderId = String(payload.orderId || payload['Order - Number'] || '').trim();
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const sku = String(payload.sku || payload['Item - SKU'] || '').trim();
    const productName = String(payload.productName || payload['Item - Name'] || '').trim() || null;
    const carrier = String(payload.carrier || payload['Carrier - Service Requested'] || '').trim();
    const qty = parseNumber(payload.qty ?? payload['Item - Qty'], 1);
    const orderDate = String(payload.orderDate || payload['Date - Order Date'] || '').trim() || null;
    const shipByDate = String(payload.shipByDate || payload['Date - Ship By Date'] || '').trim() || null;
    const totalSellPrice = parseNumber(payload.totalSellPrice ?? payload['Amount - Order Total'], null);
    const asin = extractAsinFromSku(sku);
    const isDhl = isDhlCarrier(carrier);
    const importedByUser = payload.importedBy || req.headers['x-user-email'] || 'shipstation-import';

    // Use array instead of Map to allow multiple entries with same orderId
    const items = [{
      orderId,
      sku: sku || null,
      asin,
      isDhl,
      qty,
      productName,
      orderDate,
      shipByDate,
      totalSellPrice,
      buyLink: payload.buyLink || null,
      poId: payload.poId || null,
      purchasedBy: payload.purchasedBy || importedByUser,
    }];

    const result = upsertImportedOrders(items, { apply: true, importedBy: importedByUser });
    return res.json({ ok: true, summary: result });
  } catch (error) {
    console.error('ShipStation single import error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ═══ PROFITABILITY CALCULATOR ═══

// Lookup ASIN reference data (weight, VAT status, buy price, sell prices)
app.get('/api/reference/:asin', (req, res) => {
  try {
    const { asin } = req.params;
    const row = db.prepare('SELECT * FROM reference_data WHERE asin = ?').get(asin);
    if (!row) return res.status(404).json({ error: 'ASIN not found in reference data' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all Royal Mail rate bands
app.get('/api/rates', (req, res) => {
  try {
    const rates = db.prepare('SELECT * FROM royal_mail_rates ORDER BY weight_from ASC').all();
    res.json(rates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate profitability for a given set of inputs
app.post('/api/calculate-profitability', (req, res) => {
  try {
    const {
      order_id,
      asin,
      sell_price_usd,
      unit_buy_price,
      delivery_fee,
      b_qty,
      s_qty,
      gbp_usd_rate,
      weight_override,
      vat_override
    } = req.body;

    if (!sell_price_usd || !unit_buy_price) {
      return res.status(400).json({ error: 'sell_price_usd and unit_buy_price are required' });
    }

    // Determine rate: if order_id provided, use historical rate from that order's rate_date
    let rate = 1.34;
    if (order_id && !gbp_usd_rate) {
      // Lookup order's rate_date
      const orderRow = db.prepare('SELECT rate_date FROM orders WHERE id = ?').get(order_id);
      if (orderRow && orderRow.rate_date) {
        rate = getRateForDate(orderRow.rate_date);
        console.log(`💱 Using historical rate for order ${order_id} (date: ${orderRow.rate_date}): ${rate}`);
      } else {
        rate = getCurrentRate();
      }
    } else if (gbp_usd_rate) {
      rate = parseFloat(gbp_usd_rate);
    } else {
      rate = getCurrentRate();
    }

    const qty = parseFloat(b_qty) || 1;
    const sellQty = parseFloat(s_qty) || 1;
    const unitPrice = parseFloat(unit_buy_price);
    const delivFee = parseFloat(delivery_fee) || 0;
    const sellUsd = parseFloat(sell_price_usd);

    // Lookup ASIN data if provided
    let refData = null;
    if (asin) {
      refData = db.prepare('SELECT * FROM reference_data WHERE asin = ?').get(asin);
    }

    // Weight: override > reference data lookup
    let unitWeight = parseFloat(weight_override) || (refData ? refData.weight_kg : null);
    if (!unitWeight) {
      return res.status(400).json({ error: 'Could not determine weight. Provide weight_override or a valid ASIN.' });
    }
    const orderWeight = unitWeight * sellQty * 1.1; // 10% packaging buffer

    // VAT status
    const vatStatus = vat_override || (refData ? refData.vat_status : 'NO') || 'NO';

    // Total Buy Price inc. VAT = (unitPrice × b_qty) + deliveryFee
    const totalBuyIncVat = (unitPrice * qty) + delivFee;

    // Total Buy Price exc. VAT = (delivFee / 1.2) + IF(VAT=YES, (unitPrice × b_qty) / 1.2, unitPrice × b_qty)
    const totalBuyExcVat = (delivFee / 1.2) + (vatStatus === 'YES' ? (unitPrice * qty) / 1.2 : unitPrice * qty);

    // Shipping cost from Royal Mail rate card
    const rateRow = db.prepare('SELECT * FROM royal_mail_rates WHERE weight_from <= ? AND weight_to > ? ORDER BY weight_from DESC LIMIT 1').get(orderWeight, orderWeight);
    let shippingCostGbp = null;
    let rateBand = null;
    if (rateRow) {
      shippingCostGbp = ((rateRow.price_per_item + (rateRow.price_per_kg * orderWeight)) * (1 + rateRow.fuel_surcharge)) + rateRow.duty_handling_fee;
      rateBand = `${rateRow.weight_from}-${rateRow.weight_to}kg (${rateRow.service_name})`;
    }

    // Expected Profit = (sellUSD × 0.847) - ((totalBuyExcVat × 1.1 + shippingGBP) × GBP/USD) - 2
    // 0.847 = after Amazon 15.3% referral fee
    // × 1.1 = 10% import duty buffer
    // -2 = £2 handling buffer
    let expectedProfit = null;
    let profitMargin = null;
    if (shippingCostGbp !== null) {
      const revenueUsd = sellUsd * 0.847;
      const costUsd = ((totalBuyExcVat * 1.1) + shippingCostGbp) * rate;
      expectedProfit = revenueUsd - costUsd - 2;
      profitMargin = sellUsd > 0 ? (expectedProfit / sellUsd) * 100 : 0;
    }

    res.json({
      // Inputs echoed
      asin,
      sell_price_usd: sellUsd,
      unit_buy_price: unitPrice,
      delivery_fee: delivFee,
      b_qty: qty,
      s_qty: sellQty,
      gbp_usd_rate: rate,

      // Reference data
      ref_weight_kg: refData ? refData.weight_kg : null,
      ref_vat_status: refData ? refData.vat_status : null,
      ref_buy_price: refData ? refData.buy_price_inc_vat : null,
      ref_min_sell_price: refData ? refData.min_sell_price : null,
      ref_buy_box_price: refData ? refData.buy_box_sell_price : null,
      ref_active_sell_price: refData ? refData.active_sell_price : null,
      ref_vetted_supplier: refData ? refData.vetted_supplier : null,

      // Calculated
      vat_status: vatStatus,
      order_weight_kg: Math.round(orderWeight * 10000) / 10000,
      total_buy_inc_vat: Math.round(totalBuyIncVat * 100) / 100,
      total_buy_exc_vat: Math.round(totalBuyExcVat * 100) / 100,
      shipping_cost_gbp: shippingCostGbp !== null ? Math.round(shippingCostGbp * 100) / 100 : null,
      rate_band: rateBand,
      expected_profit_usd: expectedProfit !== null ? Math.round(expectedProfit * 100) / 100 : null,
      profit_margin_pct: profitMargin !== null ? Math.round(profitMargin * 10) / 10 : null,
      is_profitable: expectedProfit !== null ? expectedProfit > 0 : null,
    });
  } catch (error) {
    console.error('Profitability calc error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══ EXCHANGE RATE MANAGEMENT ═══

// Get current day's exchange rate (or today's rate if not already cached)
app.get('/api/exchange-rate/current', (req, res) => {
  try {
    const rate = getCurrentRate();
    const today = getTodayDateString();
    res.json({
      date: today,
      gbp_usd_rate: rate,
      source: 'cached or default',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get exchange rate history (last N days) - MUST come before :date route
app.get('/api/exchange-rate/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || 30), 365);
    const rates = db.prepare('SELECT date, gbp_usd_rate, source, created_at FROM exchange_rates ORDER BY date DESC LIMIT ?').all(limit);
    res.json(rates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get exchange rate for a specific date
app.get('/api/exchange-rate/:date', (req, res) => {
  try {
    const { date } = req.params;
    const rate = getRateForDate(date);
    res.json({
      date,
      gbp_usd_rate: rate,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set exchange rate for a specific date (admin only)
app.post('/api/exchange-rate/set', (req, res) => {
  try {
    const { date, gbp_usd_rate, source } = req.body;
    if (!date || gbp_usd_rate === undefined) {
      return res.status(400).json({ error: 'date and gbp_usd_rate are required' });
    }

    const rate = parseFloat(gbp_usd_rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'gbp_usd_rate must be a positive number' });
    }

    db.prepare('INSERT OR REPLACE INTO exchange_rates (date, gbp_usd_rate, source, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(date, rate, source || 'manual');
    
    console.log(`💱 Exchange rate updated for ${date}: ${rate} (source: ${source || 'manual'})`);
    
    // Broadcast rate change to all clients
    broadcast('exchange-rate-updated', { date, gbp_usd_rate: rate });
    
    res.json({ ok: true, date, gbp_usd_rate: rate });
  } catch (error) {
    console.error('Exchange rate set error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ASIN search/autocomplete
app.get('/api/reference/search/:query', (req, res) => {
  try {
    const q = req.params.query;
    const results = db.prepare('SELECT asin, weight_kg, vat_status, buy_price_inc_vat FROM reference_data WHERE asin LIKE ? LIMIT 10').all(q + '%');
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══ HEALTH CHECK ═══
app.get('/api/health', (req, res) => {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM orders');
  const { count } = countStmt.get();

  res.json({
    status: '✅ Server running',
    version: '3.0 - SQLite + WebSocket',
    database: 'SQLite',
    orders: count,
    websockets: wss.clients.size,
    timestamp: new Date().toISOString(),
  });
});

// ═══ FALLBACK ═══
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({error: 'Internal server error'});
});

// ═══ START SERVER ═══
initializeDB();

server.listen(PORT, () => {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM orders');
  const { count } = countStmt.get();

  console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅ Babaclick FBM Operations Hub (SQLite + WebSocket v3.0) ║
║                                                            ║
║  🌐 Running on: http://localhost:${PORT}                     ║
║  📍 API: http://localhost:${PORT}/api                       ║
║  🔌 WebSocket: ws://localhost:${PORT}                       ║
║  ✔️  Frontend: http://localhost:${PORT}                     ║
║  🗄️  Database: SQLite (${DB_PATH})                        ║
║  📦 Orders in database: ${count}                               ║
║  👥 WebSocket connections: ${wss.clients.size}                 ║
║                                                            ║
║  🎯 Real-time Multi-User Collaboration ✅                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, db, broadcast };
