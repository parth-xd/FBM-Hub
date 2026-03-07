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
const PORT = process.env.PORT || 5000;

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
        sheet_row INTEGER UNIQUE,
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
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id)
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
    `);

    console.log('✅ Database schema initialized');
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

    const approveUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/auth/approve?token=${approvalToken}`;
    const rejectUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/auth/reject?token=${approvalToken}`;

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

    const loginUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}?token=${token}`;
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

app.post('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { weight, status, label_printed, qty_received, discrepancy, ...updates } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';

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
    if (discrepancy !== undefined) { updateFields.push('discrepancy = ?'); values.push(discrepancy); }

    Object.entries(updates).forEach(([key, val]) => {
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
