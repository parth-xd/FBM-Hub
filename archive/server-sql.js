require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
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

// ═══ DATABASE CONNECTION POOL ═══
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('🚨 Unexpected error on idle client', err);
});

// ═══ IN-MEMORY DATA FOR AUTH + WEBSOCKET CLIENTS ═══
const users = new Map();
const pendingApprovals = new Map();
const loginTokens = new Map();
const wsClients = new Set(); // Active WebSocket connections

const OWNER_EMAIL = 'parttthh@gmail.com';
const crypto = require('crypto');

// ═══ EMAIL SERVICE (Using Resend API) ═══
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendEmail = async (to, subject, html) => {
  try {
    if (!resend) {
      console.warn('⚠️  RESEND_API_KEY not configured. Email delivery disabled.');
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

    console.log(`✅ Email sent to ${to}`, data);
    return true;
  } catch (error) {
    console.error('❌ Email service error:', error.message);
    return false;
  }
};

// ═══ BROADCAST TO ALL WEBSOCKET CLIENTS ═══
const broadcast = (type, data) => {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// ═══ WEBSOCKET CONNECTIONS ═══
wss.on('connection', (ws) => {
  console.log(`✅ WebSocket client connected (total: ${wss.clients.size})`);
  
  ws.on('close', () => {
    console.log(`❌ WebSocket client disconnected (remaining: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  // Send initial connection confirmation
  ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
});

// ═══ DATABASE HELPERS ═══

// Initialize DB (create tables if they don't exist)
const initializeDB = async () => {
  try {
    const schemaSQL = `
      CREATE TYPE IF NOT EXISTS order_status AS ENUM ('pending', 'packed', 'shipped');
      CREATE TYPE IF NOT EXISTS row_status AS ENUM ('normal', 'green', 'orange', 'red');

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        sheet_row INT UNIQUE,
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

      CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id);
      CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_sheet_row ON orders(sheet_row);
      CREATE INDEX IF NOT EXISTS idx_po_id ON orders(po_id);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON orders(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_locked_by ON orders(locked_by);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id),
        user_email VARCHAR(100),
        action VARCHAR(50),
        field_name VARCHAR(100),
        old_value TEXT,
        new_value TEXT,
        changed_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_logs(order_id);
      CREATE INDEX IF NOT EXISTS idx_audit_changed ON audit_logs(changed_at DESC);

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100),
        role VARCHAR(50),
        status VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `;

    await pool.query(schemaSQL);
    console.log('✅ Database schema initialized');
  } catch (err) {
    console.error('❌ DB initialization error:', err.message);
  }
};

// ═══ AUTH ENDPOINTS (unchanged from original) ═══

// Sign up endpoint
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
        <a href="${approveUrl}" style="padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 4px;">
          ✅ Approve
        </a>
        <a href="${rejectUrl}" style="margin-left: 10px; padding: 10px 20px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px;">
          ❌ Reject
        </a>
      </p>
    `;

    const userEmailHtml = `
      <h2>Welcome to FBM Operations Hub!</h2>
      <p>Account verification pending owner approval. You'll receive email once approved.</p>
    `;

    await Promise.all([
      sendEmail(OWNER_EMAIL, `New User Request: ${name}`, ownerEmailHtml),
      sendEmail(email, 'FBM Hub - Waiting for Approval', userEmailHtml),
    ]);

    res.json({ok: true, message: 'Signup request sent. Awaiting owner approval.'});
  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// Send login email
app.post('/api/auth/send-login-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({error: 'Email required'});

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND status = $2', [email, 'approved']);
    if (result.rows.length === 0) {
      return res.status(401).json({error: 'User not found or not approved'});
    }

    const token = crypto.randomBytes(32).toString('hex');
    loginTokens.set(token, { email, expires: Date.now() + 15 * 60 * 1000, used: false });

    const loginUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}?token=${token}`;
    const html = `
      <h2>FBM Hub Login Link</h2>
      <p>Click the link below to login (valid for 15 minutes):</p>
      <p><a href="${loginUrl}">🔐 Login to FBM Hub</a></p>
    `;

    await sendEmail(email, 'Your FBM Hub Login Link', html);
    res.json({ok: true});
  } catch (error) {
    console.error('Login email error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// Verify login token
app.post('/api/auth/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({error: 'Token required'});

    const tokenData = loginTokens.get(token);
    if (!tokenData) return res.status(401).json({error: 'Invalid token'});
    if (tokenData.expires < Date.now()) return res.status(401).json({error: 'Token expired'});
    if (tokenData.used) return res.status(401).json({error: 'Token already used'});

    loginTokens.delete(token);
    const jwtToken = jwt.sign({ email: tokenData.email }, process.env.JWT_SECRET || 'secret123', { expiresIn: '7d' });

    res.json({ok: true, token: jwtToken, email: tokenData.email});
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// Approve user
app.get('/api/auth/approve', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({error: 'Token required'});

    const approval = pendingApprovals.get(token);
    if (!approval) return res.status(401).json({error: 'Invalid approval token'});

    await pool.query(
      'INSERT INTO users (email, name, role, status) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET status = $4',
      [approval.email, approval.name, approval.role, 'approved']
    );

    pendingApprovals.delete(token);

    const html = `
      <h2>Welcome to FBM Operations Hub!</h2>
      <p>Your account has been approved. You can now login.</p>
    `;

    await sendEmail(approval.email, 'Account Approved - FBM Hub', html);
    res.redirect('/?message=approved');
  } catch (error) {
    console.error('Approval error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// ═══ SQL ORDERS ENDPOINTS ═══

// Get all orders
app.get('/api/orders', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset || '0');
    const limit = parseInt(req.query.limit || '100');

    const result = await pool.query(
      `SELECT * FROM orders ORDER BY sheet_row ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) FROM orders');
    const total = parseInt(countResult.rows[0].count);

    res.json({
      orders: result.rows,
      total,
      offset,
      limit,
    });
  } catch (error) {
    console.error('Get orders error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// Update single order (with WebSocket broadcast)
app.post('/api/orders/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { weight, status, label_printed, qty_received, discrepancy, ...updates } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';

    await client.query('BEGIN');

    // Get old values for audit log
    const oldResult = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({error: 'Order not found'});
    }

    const oldData = oldResult.rows[0];

    // Build update query
    const updates_list = ['updated_at = NOW()', 'updated_by = $3'];
    const values = [id, userEmail];
    let paramCount = 4;

    if (weight !== undefined) updates_list.push(`weight = $${paramCount++}`), values.push(weight);
    if (status !== undefined) updates_list.push(`status = $${paramCount++}`), values.push(status);
    if (label_printed !== undefined) updates_list.push(`label_printed = $${paramCount++}`), values.push(label_printed);
    if (qty_received !== undefined) updates_list.push(`qty_received = $${paramCount++}`), values.push(qty_received);
    if (discrepancy !== undefined) updates_list.push(`discrepancy = $${paramCount++}`), values.push(discrepancy);

    Object.entries(updates).forEach(([key, val]) => {
      updates_list.push(`${key} = $${paramCount++}`);
      values.push(val);
    });

    // Update order
    const updateSQL = `UPDATE orders SET ${updates_list.join(', ')} WHERE id = $1 RETURNING *`;
    values.unshift(id);
    values.splice(1, 1, userEmail); // Proper positioning

    const updateResult = await client.query(
      `UPDATE orders SET ${updates_list.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    const newData = updateResult.rows[0];

    // Log changes to audit log
    Object.keys(updates).forEach((key) => {
      if (oldData[key] !== updates[key]) {
        client.query(
          `INSERT INTO audit_logs (order_id, user_email, action, field_name, old_value, new_value) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, userEmail, 'UPDATE', key, String(oldData[key]), String(updates[key])]
        );
      }
    });

    await client.query('COMMIT');

    // Broadcast update to all WebSocket clients
    broadcast('order-updated', {
      id,
      changes: updates,
      updatedBy: userEmail,
      newData,
    });

    res.json({ok: true, order: newData});
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update order error:', error.message);
    res.status(500).json({error: error.message});
  } finally {
    client.release();
  }
});

// ═══ SHIPSTATION ENDPOINT ═══

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
      return res.status(response.status || 500).json({
        error: `ShipStation error (${response.status}): ${text.substring(0, 200)}`,
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({error: data.message || data.error || 'ShipStation error'});
    }

    res.json({ok: true, label: data});
  } catch (error) {
    console.error('ShipStation error:', error.message);
    res.status(500).json({error: error.message});
  }
});

// ═══ HEALTH CHECK ═══
app.get('/api/health', (req, res) => {
  res.json({
    status: '✅ Server is running',
    version: '3.0 - PostgreSQL + WebSocket',
    database: 'connected',
    websockets: wss.clients.size,
    timestamp: new Date().toISOString(),
  });
});

// ═══ FALLBACK: Serve React App ═══
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({error: 'Internal server error'});
});

// ═══ START SERVER ═══
(async () => {
  await initializeDB();

  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅ Babaclick FBM Operations Hub Server (PostgreSQL v3.0)  ║
║                                                            ║
║  🌐 Running on: http://localhost:${PORT}                     ║
║  📍 API: http://localhost:${PORT}/api                       ║
║  🔌 WebSocket: ws://localhost:${PORT}                       ║
║  ✔️  Frontend: http://localhost:${PORT}                     ║
║  🗄️  Database: PostgreSQL                                 ║
║                                                            ║
║  🎯 Real-time Multi-User Collaboration Enabled            ║
║  ✅ Active WebSocket connections: ${wss.clients.size}         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
})();

module.exports = { app, pool, broadcast };
