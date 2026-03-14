require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Pool = require('pg').Pool;
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

// ═══ SECURITY MODULES ═══
const security = require('./security');

// ═══ INITIALIZE EXPRESS + HTTP SERVER + WEBSOCKET ═══
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Generate request ID for tracking
app.use((req, res, next) => {
  req.id = crypto.randomBytes(8).toString('hex');
  next();
});

// ═══ SECURITY HEADERS & PROTECTION ═══
app.use(security.helmetConfig);
app.use(security.customSecurityHeaders);

// ═══ CORS CONFIGURATION ═══
app.use(cors({
  origin: process.env.PUBLIC_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-email', 'x-user-role'],
}));

// ═══ REQUEST SIZE & PARSING ═══
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ═══ SANITIZATION ═══
app.use(security.sanitizationMiddleware);

// ═══ RATE LIMITING ═══
app.use(security.apiLimiter);
app.use(security.authLimiter);
app.use(security.uploadLimiter);

// ═══ STATIC FILES ═══
app.use(express.static('public'));

// ═══ POSTGRESQL DATABASE ═══
// Validate DATABASE_URL exists before creating pool
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  console.error('❌ ERROR: DATABASE_URL environment variable is not set!');
  console.error('   On Render: Dashboard → Web Service → Environment → Add DATABASE_URL');
  console.error('   Get the value from: Dashboard → PostgreSQL instance → Connections');
  process.exit(1);
}

const pool = new Pool({
  // Use connection string from environment; never hardcode credentials
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('   → Database is unreachable. Check DATABASE_URL and network connectivity.');
  }
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    if (!process.env.DATABASE_URL) {
      console.error('   → DATABASE_URL is not set. Add it to environment variables.');
    } else {
      console.error('   → Check: region match, credentials, and firewall rules.');
    }
  } else {
    console.log('✅ PostgreSQL Database connected:', res.rows[0].now);
  }
});

// ═══ IN-MEMORY DATA FOR AUTH ═══
const users = new Map();
const pendingApprovals = new Map();
const loginTokens = new Map();

const OWNER_EMAIL = 'parttthh@gmail.com';

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
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// ═══ WEBSOCKET CONNECTION ═══
wss.on('connection', (ws) => {
  console.log('✅ WebSocket client connected (total:', wss.clients.size, ')');
  ws.on('close', () => {
    console.log('❌ WebSocket disconnected (remaining:', wss.clients.size, ')');
  });
  ws.on('error', (err) => console.error('WebSocket error:', err.message));
});

// ═══ AUTHENTICATION ENDPOINTS ═══

// Validate and sanitize email input
app.post('/api/auth/request-login', security.validateRequest(security.schemas.emailSchema), async (req, res) => {
  try {
    const { email } = req.body;

    // Rate limit per email
    const recentAttempts = Array.from(loginTokens.values()).filter(
      t => t.email === email && Date.now() - t.createdAt < 60000
    );
    if (recentAttempts.length > 3) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 1 minute.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    loginTokens.set(token, { email, createdAt: Date.now(), used: false });

    const loginUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/auth/verify?token=${token}`;
    await sendEmail(email, 'Login Link - FBM Operations Hub', `Click here to login: <a href="${loginUrl}">${loginUrl}</a>`);

    res.json({ ok: true, msg: 'Login link sent to email' });
  } catch (error) {
    console.error('Login request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate token format
app.get('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.query;

    // Validate token format (should be 64 hex chars)
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Invalid token format' });
    }

    const loginData = loginTokens.get(token);

    // Check token validity
    if (!loginData || loginData.used || Date.now() - loginData.createdAt > 3600000) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const email = loginData.email;
    // Validate email format before DB query
    if (!email || !email.includes('@') || email.length > 254) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      // New user - create
      const approvalHash = crypto.randomBytes(16).toString('hex');
      await pool.query(
        'INSERT INTO users (email, role, approved, created_at) VALUES ($1, $2, $3, NOW())',
        [email, 'viewer', false]
      );

      if (email === OWNER_EMAIL) {
        await pool.query('UPDATE users SET role = $1, approved = $2 WHERE email = $3', ['owner', true, email]);
      } else {
        pendingApprovals.set(approvalHash, { email, date: new Date() });
        broadcast('user-pending-approval', { email, approvalHash });
        await sendEmail(OWNER_EMAIL, `New user approval needed: ${email}`, `<a href="${process.env.PUBLIC_URL || 'http://localhost:3000'}/approve?hash=${approvalHash}">Approve ${email}</a>`);
      }
    }

    // Use JWT_SECRET from environment, require it in production
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET not configured');
    }

    const sessionToken = jwt.sign(
      { email, role: user?.role || 'viewer' },
      jwtSecret || 'dev-secret',
      { expiresIn: '30d', issuer: 'fbm-hub', audience: 'fbm-hub-client' }
    );

    loginTokens.set(token, { ...loginData, used: true });

    res.json({ ok: true, sessionToken });
  } catch (error) {
    console.error('Verification error:', error);
    // Don't expose error details
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token' });
    }

    const token = authHeader.slice(7);
    const jwtSecret = process.env.JWT_SECRET || 'dev-secret';

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret, { issuer: 'fbm-hub', audience: 'fbm-hub-client' });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Validate email before query
    if (!decoded.email || !decoded.email.includes('@')) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await pool.query('SELECT email, role, approved FROM users WHERE email = $1', [decoded.email]);
    const user = result.rows[0];

    res.json({
      email: decoded.email,
      role: user?.role || 'viewer',
      approved: user?.approved || false,
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ═══ ORDERS ENDPOINTS ═══

app.get('/api/orders', async (req, res) => {
  try {
    const { offset = 0, limit = 10000, search = '', status = '', carrier = '', dhl = '' } = req.query;
    
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    let paramCount = 0;
    
    // Search filter (across multiple fields)
    if (search && search.trim()) {
      paramCount++;
      query += ` AND (
        LOWER(order_id) LIKE LOWER($${paramCount}) OR
        LOWER(sku) LIKE LOWER($${paramCount}) OR
        LOWER(product_name) LIKE LOWER($${paramCount}) OR
        LOWER(asin) LIKE LOWER($${paramCount}) OR
        LOWER(po_id) LIKE LOWER($${paramCount}) OR
        LOWER(buy_link) LIKE LOWER($${paramCount})
      )`;
      params.push(`%${search}%`);
    }
    
    // Status filter
    if (status && status.trim()) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }
    
    // Carrier filter
    if (carrier && carrier.trim()) {
      paramCount++;
      query += ` AND carrier = $${paramCount}`;
      params.push(carrier);
    }
    
    // DHL filter
    if (dhl === 'true' || dhl === '1') {
      query += ` AND dhl = true`;
    } else if (dhl === 'false' || dhl === '0') {
      query += ` AND dhl = false`;
    }
    
    // Get total count before pagination
    const countResult = await pool.query(
      query.replace('SELECT *', 'SELECT COUNT(*) as count'),
      params
    );
    const total = parseInt(countResult.rows[0].count) || 0;
    
    // Add pagination and ordering
    const offsetVal = parseInt(offset) || 0;
    const limitVal = parseInt(limit) || 10000;
    
    params.push(limitVal);
    params.push(offsetVal);
    
    const nextParamNum = params.length;
    query += ` ORDER BY imported_at DESC LIMIT $${nextParamNum - 1} OFFSET $${nextParamNum}`;
    
    const result = await pool.query(query, params);
    
    // Helper to safely convert dates
    const safeDate = (dateVal) => {
      if (!dateVal || dateVal === '' || dateVal === 'null') return null;
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
      } catch {
        return null;
      }
    };
    
    const orders = result.rows.map(r => ({
      ...r,
      order_date: safeDate(r.order_date),
      delivery_date: safeDate(r.delivery_date),
      ship_by_date: safeDate(r.ship_by_date),
      expected_delivery_date: safeDate(r.expected_delivery_date),
      supplier_order_date: safeDate(r.supplier_order_date),
      refund_date: safeDate(r.refund_date),
      marked_dispatched_on: safeDate(r.marked_dispatched_on),
    }));
    
    res.json({ 
      orders,
      total,
      offset: offsetVal,
      limit: limitVal
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/create', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const {
      order_id, order_date, product_name, total_sell_price, ship_by_date,
      asin, sku, s_qty, b_qty, po_id, buy_link, is_dhl,
      exception_reason, exception_po_created, status
    } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    const result = await pool.query(
      `INSERT INTO orders (order_id, order_date, product_name, total_sell_price, ship_by_date,
        asin, sku, s_qty, b_qty, po_id, buy_link, is_dhl,
        exception_reason, exception_po_created, status, imported_by, imported_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
       RETURNING *`,
      [order_id, order_date, product_name, total_sell_price, ship_by_date,
       asin, sku, s_qty, b_qty, po_id, buy_link, is_dhl || false,
       exception_reason, exception_po_created || false, status || 'pending', userEmail]
    );

    const order = result.rows[0];
    broadcast('order-created', order);
    res.json({ ok: true, order });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/update-cell', async (req, res) => {
  try {
    const { orderId, col, value } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';

    // Whitelist allowed column names to prevent SQL injection
    const ALLOWED_COLS = [
      'order_id','sku','qty','product_name','order_date','delivery_date','ship_by_date',
      'carrier','tracking_num','total_sell_price','buy_link','po_id','status',
      'exception_type','exception_notes','dhl','asin','weight','label_printed',
      's_qty','b_qty','qty_received','discrepancy','exception_reason',
      'exception_stock_solution','exception_po_created','goods_not_available',
      'purchased_by','checked_by','is_dhl','is_multi_po','locked_by',
      'total_buy_price_inc_vat','total_buy_price_exc_vat','shipping_cost_gbp',
      'expected_profit','unit_buy_price_inc_vat','delivery_fee_per_line',
      'vat_status','suggested_weight','shipstation_link','refunded','refund_date',
      'expected_delivery_date','supplier_order_date','supplier_order_ref',
      'expected_delivery_time','marked_dispatched_on'
    ];

    if (!ALLOWED_COLS.includes(col)) {
      return res.status(400).json({ error: `Invalid column: ${col}` });
    }

    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const oldValue = order[col];
    await pool.query(
      `UPDATE orders SET "${col}" = $1, updated_at = NOW() WHERE id = $2`,
      [value, orderId]
    );

    // Log to audit_logs
    try {
      await pool.query(
        `INSERT INTO audit_logs (order_id, user_email, action, field_name, old_value, new_value, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [orderId, userEmail, 'UPDATE', col, String(oldValue || ''), String(value || '')]
      );
    } catch (auditErr) {
      console.warn('Audit logging failed:', auditErr.message);
    }

    broadcast('order-updated', { orderId, col, value, updatedBy: userEmail });
    res.json({ ok: true });
  } catch (error) {
    console.error('Update cell error:', error);
    res.status(500).json({ error: error.message });
  }
});

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

    const validIds = orderIds.filter(id => Number.isInteger(Number(id)));
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'No valid order IDs provided' });
    }

    console.log(`🗑️  Bulk delete: Attempting to delete ${validIds.length} orders by ${userEmail}`);

    // Use transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
      const deleteResult = await client.query(
        `DELETE FROM orders WHERE id IN (${placeholders})`,
        validIds.map(Number)
      );

      console.log(`✅ Bulk delete: Successfully deleted ${deleteResult.rowCount} orders`);

      // Audit log
      try {
        await client.query(
          `INSERT INTO audit_logs (user_email, action, field_name, old_value, new_value, changed_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [userEmail, 'BULK_DELETE', 'orders_deleted', String(validIds.length), 'deleted']
        );
        console.log(`📝 Audit log recorded for bulk delete`);
      } catch (auditErr) {
        console.warn(`⚠️  Audit logging skipped: ${auditErr.message}`);
      }

      await client.query('COMMIT');
      broadcast('orders-deleted', { ids: validIds.map(Number), deletedBy: userEmail });

      res.json({ ok: true, deleted: deleteResult.rowCount });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`❌ Bulk delete error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ═══ INDIVIDUAL ORDER ENDPOINTS ═══

app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM orders WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = result.rows[0];
    res.json({
      ...order,
      order_date: order.order_date ? new Date(order.order_date).toISOString().split('T')[0] : null,
      delivery_date: order.delivery_date ? new Date(order.delivery_date).toISOString().split('T')[0] : null,
      ship_by_date: order.ship_by_date ? new Date(order.ship_by_date).toISOString().split('T')[0] : null,
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';
    
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Whitelist allowed column names to prevent SQL injection
    const ALLOWED_COLS = [
      'order_id','sku','qty','product_name','order_date','delivery_date','ship_by_date',
      'carrier','tracking_num','total_sell_price','buy_link','po_id','status',
      'exception_type','exception_notes','dhl','asin','weight','label_printed',
      's_qty','b_qty','qty_received','discrepancy','exception_reason',
      'exception_stock_solution','exception_po_created','goods_not_available',
      'purchased_by','checked_by','is_dhl','is_multi_po','locked_by',
      'total_buy_price_inc_vat','total_buy_price_exc_vat','shipping_cost_gbp',
      'expected_profit','unit_buy_price_inc_vat','delivery_fee_per_line',
      'vat_status','suggested_weight','shipstation_link','refunded','refund_date',
      'expected_delivery_date','supplier_order_date','supplier_order_ref',
      'expected_delivery_time','marked_dispatched_on'
    ];

    const safeKeys = Object.keys(updates).filter(k => ALLOWED_COLS.includes(k));
    if (safeKeys.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    // Get current order
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const oldOrder = result.rows[0];
    
    // Build update query with safe column names
    const setClauses = safeKeys
      .map((key, i) => `"${key}" = $${i + 1}`)
      .join(', ');
    const values = safeKeys.map(k => updates[k]);
    values.push(id);
    
    await pool.query(
      `UPDATE orders SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
    
    // Audit log changes (only for whitelisted fields)
    for (const key of safeKeys) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (order_id, user_email, action, field_name, old_value, new_value, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [id, userEmail, 'UPDATE', key, String(oldOrder[key] || ''), String(updates[key] || '')]
        );
      } catch (auditErr) {
        console.warn('Audit logging failed:', auditErr.message);
      }
    }
    
    broadcast('order-updated', { id: parseInt(id), ...updates, updatedBy: userEmail });
    res.json({ ok: true });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:id/lock', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.headers['x-user-email'] || 'unknown';
    
    // Lock is handled via beingEdited flag in frontend
    // We'll update a locked_by field if it exists
    const result = await pool.query(
      `UPDATE orders SET updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ ok: true, order: result.rows[0], locked_by: userEmail });
  } catch (error) {
    console.error('Lock order error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:id/unlock', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE orders SET updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ ok: true, order: result.rows[0] });
  } catch (error) {
    console.error('Unlock order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══ IMPORT ENDPOINTS ═══

app.post('/api/shipstation/import-csv', async (req, res) => {
  try {
    const { csvContent, apply } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';

    if (!csvContent) {
      return res.status(400).json({ error: 'CSV content required' });
    }

    // Parse CSV
    const lines = csvContent.split('\n').filter(line => line.trim());
    const validRows = lines.slice(1); // Skip header

    if (validRows.length === 0) {
      return res.status(400).json({ error: 'No rows to import' });
    }

    console.log(`📊 CSV split into ${lines.length} total lines`);
    console.log(`📊 After trim & filter: ${validRows.length} non-empty lines`);

    const items = validRows.map((line, idx) => {
      const cols = line.split(',');
      return {
        order_id: cols[0]?.trim() || `ORDER-${Date.now()}-${idx}`,
        sku: cols[1]?.trim() || null,
        qty: parseInt(cols[2]?.trim()) || 1,
        product_name: cols[3]?.trim() || null,
        order_date: cols[4]?.trim() || null,
        delivery_date: cols[5]?.trim() || null,
        ship_by_date: cols[6]?.trim() || null,
        carrier: cols[7]?.trim() || null,
        buy_link: cols[8]?.trim() || null,
        po_id: cols[9]?.trim() || null,
      };
    });

    if (!apply) {
      return res.json({
        ok: true,
        dryRun: true,
        validRows: items.length,
        uniqueOrderIds: new Set(items.map(i => i.order_id)).size,
      });
    }

    // Insert into database
    console.log(`Processing ${items.length} items`);
    let created = 0;
    let updated = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        const existing = await client.query(
          'SELECT id FROM orders WHERE order_id = $1',
          [item.order_id]
        );

        if (existing.rows.length === 0) {
          await client.query(
            `INSERT INTO orders (order_id, sku, qty, product_name, order_date, delivery_date, ship_by_date, carrier, buy_link, po_id, imported_by, imported_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
            [item.order_id, item.sku, item.qty, item.product_name, item.order_date, item.delivery_date, item.ship_by_date, item.carrier, item.buy_link, item.po_id, userEmail]
          );
          created++;
        }
      }

      await client.query('COMMIT');
      console.log(`Successfully inserted ${created} orders`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    broadcast('orders-imported', { created, updated, importedBy: userEmail });

    res.json({
      ok: true,
      validRows: items.length,
      created,
      updated,
      uniqueOrderIds: new Set(items.map(i => i.order_id)).size,
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══ ADMIN APPROVAL ═══

app.post('/api/admin/approve-user', async (req, res) => {
  try {
    const { email } = req.body;
    const requesterEmail = req.headers['x-user-email'] || 'unknown';

    // Only owner can approve
    const requesterResult = await pool.query('SELECT role FROM users WHERE email = $1', [requesterEmail]);
    if (requesterResult.rows[0]?.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can approve users' });
    }

    await pool.query(
      'UPDATE users SET role = $1, approved = $2, approved_at = NOW(), approved_by = $3 WHERE email = $4',
      ['importer', true, requesterEmail, email]
    );

    broadcast('user-approved', { email, approvedBy: requesterEmail });
    res.json({ ok: true });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══ AUDIT LOG ═══

app.get('/api/audit-logs', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM audit_logs ORDER BY changed_at DESC LIMIT 5000'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══ HEALTH CHECK ═══

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: 'postgresql' });
});

// ═══════════════════════════════════════════════════════════════
// ═══ FBA ENDPOINTS ═══
// ═══════════════════════════════════════════════════════════════

// --- FBA Products (Mission Control + Personal Reckon) ---

// List products (filtered by sheet_type and optionally owner)
app.get('/api/fba/products', async (req, res) => {
  try {
    const { sheet_type, owner } = req.query;
    let query = 'SELECT * FROM fba_products WHERE 1=1';
    const params = [];
    let n = 0;
    if (sheet_type) { n++; query += ` AND sheet_type = $${n}`; params.push(sheet_type); }
    if (owner) { n++; query += ` AND owner_email = $${n}`; params.push(owner); }
    query += ' ORDER BY updated_at DESC';
    const result = await pool.query(query, params);
    res.json({ ok: true, products: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('FBA products error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single product
app.get('/api/fba/products/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fba_products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create product
app.post('/api/fba/products', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const data = req.body;
    const sheetType = data.sheet_type || 'mission_control';

    const FBA_COLS = [
      'sku','asin','fnsku','asin_link','product_name','supplier_name','supplier_url',
      'supplier_country','supplier_code','order_method','order_instructions',
      'buy_price_inc_vat','buy_price_ex_vat','buy_price_ex_vat_usd','is_vatable',
      'actual_weight_kg','dimensional_weight_kg','weight_lb','length_inch','width_inch',
      'height_inch','shipping_route','freight_price_per_kg','freight_cost',
      'fba_fee','amazon_category','referral_fee','buy_box_price','landed_cost_usd',
      'profit_per_unit','roi','ninety_day_lowest_price','ninety_day_lowest_roi',
      'est_sales_per_month','est_profit_per_month','total_sales_per_month',
      'total_profit_per_month','est_investment','sales_category','sales_rank',
      'sales_based_on_rank','tariff_per_unit','hts_code','hts_code_finder',
      'column1_pct','column1_fixed_usd','reciprocal_tariff','total_tariff_pct',
      'legal_category','declaration_name','declaration_description','prep_required',
      'manufacturer_name','manufacturer_country_code','manufacturer_address_line',
      'manufacturer_city','manufacturer_postal_code','continue_discontinue'
    ];

    const cols = ['sheet_type', 'owner_email'];
    const vals = [sheetType, userEmail];
    let n = 2;

    FBA_COLS.forEach(col => {
      if (data[col] !== undefined) {
        n++;
        cols.push(col);
        vals.push(data[col]);
      }
    });

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `INSERT INTO fba_products (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    broadcast('fba-product-created', { product: result.rows[0], by: userEmail });
    res.json({ ok: true, product: result.rows[0] });
  } catch (error) {
    console.error('FBA create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update product
app.patch('/api/fba/products/:id', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const { id } = req.params;
    const data = req.body;

    // Verify ownership (only owner or admin can edit)
    const existing = await pool.query('SELECT owner_email FROM fba_products WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    const userRole = req.headers['x-user-role'] || '';
    if (existing.rows[0].owner_email !== userEmail && userRole !== 'owner') {
      return res.status(403).json({ error: 'Can only edit your own products' });
    }

    const FBA_COLS = [
      'sku','asin','fnsku','asin_link','product_name','supplier_name','supplier_url',
      'supplier_country','supplier_code','order_method','order_instructions',
      'buy_price_inc_vat','buy_price_ex_vat','buy_price_ex_vat_usd','is_vatable',
      'actual_weight_kg','dimensional_weight_kg','weight_lb','length_inch','width_inch',
      'height_inch','shipping_route','freight_price_per_kg','freight_cost',
      'fba_fee','amazon_category','referral_fee','buy_box_price','landed_cost_usd',
      'profit_per_unit','roi','ninety_day_lowest_price','ninety_day_lowest_roi',
      'est_sales_per_month','est_profit_per_month','total_sales_per_month',
      'total_profit_per_month','est_investment','sales_category','sales_rank',
      'sales_based_on_rank','tariff_per_unit','hts_code','hts_code_finder',
      'column1_pct','column1_fixed_usd','reciprocal_tariff','total_tariff_pct',
      'legal_category','declaration_name','declaration_description','prep_required',
      'manufacturer_name','manufacturer_country_code','manufacturer_address_line',
      'manufacturer_city','manufacturer_postal_code','continue_discontinue'
    ];

    const sets = ['updated_at = NOW()', 'updated_by = $1'];
    const vals = [userEmail];
    let n = 1;

    FBA_COLS.forEach(col => {
      if (data[col] !== undefined) {
        n++;
        sets.push(`${col} = $${n}`);
        vals.push(data[col]);
      }
    });

    n++;
    vals.push(id);
    const result = await pool.query(
      `UPDATE fba_products SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      vals
    );
    broadcast('fba-product-updated', { product: result.rows[0], by: userEmail });
    res.json({ ok: true, product: result.rows[0] });
  } catch (error) {
    console.error('FBA update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete product
app.delete('/api/fba/products/:id', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const { id } = req.params;
    const existing = await pool.query('SELECT owner_email FROM fba_products WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    const userRole = req.headers['x-user-role'] || '';
    if (existing.rows[0].owner_email !== userEmail && userRole !== 'owner') {
      return res.status(403).json({ error: 'Can only delete your own products' });
    }

    await pool.query('DELETE FROM fba_products WHERE id = $1', [id]);
    broadcast('fba-product-deleted', { id: parseInt(id), by: userEmail });
    res.json({ ok: true, deleted: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- FBA Approvals (Expense Sheet) ---

// List approvals
app.get('/api/fba/approvals', async (req, res) => {
  try {
    const { status, sourced_by } = req.query;
    let query = 'SELECT * FROM fba_approvals WHERE 1=1';
    const params = [];
    let n = 0;
    if (status) { n++; query += ` AND approval_status = $${n}`; params.push(status); }
    if (sourced_by) { n++; query += ` AND sourced_by = $${n}`; params.push(sourced_by); }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json({ ok: true, approvals: result.rows, total: result.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create approval request (owner enters ASIN → auto-fills from Central Command)
app.post('/api/fba/approvals', async (req, res) => {
  try {
    const { asin, qty } = req.body;
    if (!asin) return res.status(400).json({ error: 'ASIN is required' });

    // Look up product from Central Command (mission_control entries only)
    const product = await pool.query(
      'SELECT * FROM fba_products WHERE asin = $1 AND sheet_type = $2 ORDER BY updated_at DESC LIMIT 1',
      [asin, 'mission_control']
    );

    if (product.rows.length === 0) {
      return res.status(404).json({ error: 'ASIN not found in Central Command' });
    }

    const p = product.rows[0];
    const quantity = parseInt(qty) || 1;
    const totalBuy = p.buy_price_ex_vat ? (parseFloat(p.buy_price_ex_vat) * quantity) : null;

    const result = await pool.query(
      `INSERT INTO fba_approvals 
       (product_id, asin, sourced_by, product_name, supplier_name, supplier_url, 
        buy_price_ex_vat, buy_box_price, profit_per_unit, roi, asin_link, qty, total_buy_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [p.id, p.asin, p.owner_email, p.product_name, p.supplier_name, p.supplier_url,
       p.buy_price_ex_vat, p.buy_box_price, p.profit_per_unit, p.roi, p.asin_link,
       quantity, totalBuy]
    );

    broadcast('fba-approval-created', { approval: result.rows[0] });
    res.json({ ok: true, approval: result.rows[0] });
  } catch (error) {
    console.error('FBA approval create error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve or reject
app.patch('/api/fba/approvals/:id/decide', async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, rejection_reason } = req.body; // 'approved' or 'rejected'
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const userRole = req.headers['x-user-role'] || '';

    if (userRole !== 'owner') {
      return res.status(403).json({ error: 'Only owner can approve/reject' });
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approved or rejected' });
    }

    const result = await pool.query(
      `UPDATE fba_approvals 
       SET approval_status = $1, approved_by = $2, approved_at = NOW(), 
           rejection_reason = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [decision, userEmail, rejection_reason || null, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Approval not found' });
    broadcast('fba-approval-decided', { approval: result.rows[0], by: userEmail });
    res.json({ ok: true, approval: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark purchase made (sourcer fills in STB, supplier ref, verifies total)
app.patch('/api/fba/approvals/:id/purchase', async (req, res) => {
  try {
    const { id } = req.params;
    const { stb_id, supplier_order_ref, verified_total } = req.body;
    const userEmail = req.headers['x-user-email'] || 'unknown';

    // Verify it's approved first
    const existing = await pool.query('SELECT * FROM fba_approvals WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Approval not found' });
    if (existing.rows[0].approval_status !== 'approved') {
      return res.status(400).json({ error: 'Can only purchase approved items' });
    }
    if (!stb_id) return res.status(400).json({ error: 'STB/PO ID is required' });

    const result = await pool.query(
      `UPDATE fba_approvals 
       SET stb_id = $1, supplier_order_ref = $2, purchase_date = CURRENT_DATE,
           purchase_made = true, purchased_by = $3, total_buy_price = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [stb_id, supplier_order_ref, userEmail, verified_total, id]
    );

    broadcast('fba-purchase-made', { approval: result.rows[0], by: userEmail });
    res.json({ ok: true, approval: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get next STB number
app.post('/api/fba/next-stb', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE fba_stb_counter SET current_stb = current_stb + 1 WHERE id = 1 RETURNING current_stb'
    );
    const num = result.rows[0].current_stb;
    res.json({ ok: true, stb: `STB${num}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lookup ASIN in Central Command (for approval auto-fill)
app.get('/api/fba/lookup/:asin', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM fba_products WHERE asin = $1 AND sheet_type = $2 ORDER BY updated_at DESC LIMIT 1',
      [req.params.asin, 'mission_control']
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ASIN not found' });
    res.json({ ok: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══ SCHEMA ENDPOINT - Single source of truth for all columns ═══
app.get('/api/schema', (req, res) => {
  // Define all columns with metadata
  const COLUMNS = {
    // Order identification
    id: { db: 'id', name: 'ID', type: 'integer', editable: false, group: 'identification' },
    order_id: { db: 'order_id', name: 'Order ID', type: 'string', editable: false, group: 'identification' },
    order_date: { db: 'order_date', name: 'Order Date', type: 'date', editable: false, group: 'identification' },
    sheet_row: { db: 'sheet_row', name: 'Sheet Row', type: 'integer', editable: false, group: 'identification' },
    
    // Product info
    product_name: { db: 'product_name', name: 'Product', type: 'string', editable: true, group: 'product' },
    asin: { db: 'asin', name: 'ASIN', type: 'string', editable: false, group: 'product' },
    sku: { db: 'sku', name: 'SKU', type: 'string', editable: false, group: 'product' },
    hts_code: { db: 'hts_code', name: 'HTS Code', type: 'string', editable: true, group: 'product' },
    
    // Quantity & fulfillment
    qty: { db: 'qty', name: 'Qty', type: 'integer', editable: false, group: 'fulfillment' },
    s_qty: { db: 's_qty', name: 'S-Qty', type: 'integer', editable: true, group: 'fulfillment' },
    b_qty: { db: 'b_qty', name: 'B-Qty', type: 'integer', editable: true, group: 'fulfillment' },
    qty_received: { db: 'qty_received', name: 'Qty Received', type: 'integer', editable: true, group: 'fulfillment' },
    discrepancy: { db: 'discrepancy', name: 'Discrepancy', type: 'integer', editable: false, group: 'fulfillment' },
    
    // Pricing & financials
    total_sell_price: { db: 'total_sell_price', name: 'Total Sell Price (USD)', type: 'numeric', editable: false, group: 'financials' },
    unit_buy_price_inc_vat: { db: 'unit_buy_price_inc_vat', name: 'Unit Buy Price (Inc VAT)', type: 'numeric', editable: true, group: 'financials' },
    total_buy_price_inc_vat: { db: 'total_buy_price_inc_vat', name: 'Total Buy Price (Inc VAT)', type: 'numeric', editable: true, group: 'financials' },
    total_buy_price_exc_vat: { db: 'total_buy_price_exc_vat', name: 'Total Buy Price (Exc VAT)', type: 'numeric', editable: false, group: 'financials' },
    vat_status: { db: 'vat_status', name: 'VAT Status', type: 'string', editable: true, group: 'financials' },
    expected_profit: { db: 'expected_profit', name: 'Expected Profit', type: 'numeric', editable: false, group: 'financials' },
    shipping_cost_gbp: { db: 'shipping_cost_gbp', name: 'Shipping (GBP)', type: 'numeric', editable: true, group: 'financials' },
    delivery_fee_per_line: { db: 'delivery_fee_per_line', name: 'Delivery Fee/Line', type: 'numeric', editable: true, group: 'financials' },
    
    // Shipping & logistics
    weight: { db: 'weight', name: 'Weight (kg)', type: 'numeric', editable: true, group: 'shipping' },
    suggested_weight: { db: 'suggested_weight', name: 'Suggested Weight', type: 'numeric', editable: false, group: 'shipping' },
    is_dhl: { db: 'is_dhl', name: 'Is DHL', type: 'boolean', editable: true, group: 'shipping' },
    carrier: { db: 'carrier', name: 'Carrier', type: 'string', editable: true, group: 'shipping' },
    tracking_num: { db: 'tracking_num', name: 'Tracking #', type: 'string', editable: true, group: 'shipping' },
    shipstation_link: { db: 'shipstation_link', name: 'ShipStation Link', type: 'string', editable: false, group: 'shipping' },
    
    // Dates
    ship_by_date: { db: 'ship_by_date', name: 'Ship By', type: 'date', editable: false, group: 'dates' },
    expected_delivery_date: { db: 'expected_delivery_date', name: 'Expected Delivery', type: 'date', editable: true, group: 'dates' },
    delivery_date: { db: 'delivery_date', name: 'Delivered', type: 'date', editable: true, group: 'dates' },
    supplier_order_date: { db: 'supplier_order_date', name: 'Supplier Order Date', type: 'date', editable: true, group: 'dates' },
    expected_delivery_time: { db: 'expected_delivery_time', name: 'Expected Delivery Time', type: 'string', editable: true, group: 'dates' },
    marked_dispatched_on: { db: 'marked_dispatched_on', name: 'Marked Dispatched', type: 'date', editable: true, group: 'dates' },
    
    // Sourcing
    supplier: { db: 'supplier', name: 'Supplier', type: 'string', editable: true, group: 'sourcing' },
    supplier_order_ref: { db: 'supplier_order_ref', name: 'Supplier Order Ref', type: 'string', editable: true, group: 'sourcing' },
    buy_link: { db: 'buy_link', name: 'Buy Link', type: 'string', editable: true, group: 'sourcing' },
    purchased_by: { db: 'purchased_by', name: 'Purchased By', type: 'string', editable: true, group: 'sourcing' },
    po_id: { db: 'po_id', name: 'PO ID', type: 'string', editable: true, group: 'sourcing' },
    
    // Status & exceptions
    status: { db: 'status', name: 'Status', type: 'string', editable: true, group: 'status' },
    label_printed: { db: 'label_printed', name: 'Label Printed', type: 'boolean', editable: true, group: 'status' },
    is_multi_po: { db: 'is_multi_po', name: 'Is Multi-PO', type: 'boolean', editable: false, group: 'status' },
    locked_by: { db: 'locked_by', name: 'Locked By', type: 'string', editable: false, group: 'status' },
    
    // Exceptions & refunds
    exception_type: { db: 'exception_type', name: 'Exception Type', type: 'string', editable: true, group: 'exceptions' },
    exception_notes: { db: 'exception_notes', name: 'Exception Notes', type: 'string', editable: true, group: 'exceptions' },
    exception_reason: { db: 'exception_reason', name: 'Exception Reason', type: 'string', editable: true, group: 'exceptions' },
    exception_stock_solution: { db: 'exception_stock_solution', name: 'Exception Solution', type: 'string', editable: true, group: 'exceptions' },
    exception_po_created: { db: 'exception_po_created', name: 'Exception PO Created', type: 'boolean', editable: true, group: 'exceptions' },
    goods_not_available: { db: 'goods_not_available', name: 'Goods Not Available', type: 'boolean', editable: true, group: 'exceptions' },
    refunded: { db: 'refunded', name: 'Refunded', type: 'boolean', editable: true, group: 'exceptions' },
    refund_date: { db: 'refund_date', name: 'Refund Date', type: 'date', editable: true, group: 'exceptions' },
    
    // Quality control
    checked_by: { db: 'checked_by', name: 'Checked By', type: 'string', editable: true, group: 'qc' },
  };

  res.json({ 
    ok: true, 
    columns: COLUMNS,
    // Also provide allowed columns for validation
    allowedCols: Object.keys(COLUMNS).map(k => COLUMNS[k].db),
    // Group columns by category for UI organization
    groups: {
      identification: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'identification').map(([k, v]) => ({...v, key: k})),
      product: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'product').map(([k, v]) => ({...v, key: k})),
      fulfillment: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'fulfillment').map(([k, v]) => ({...v, key: k})),
      financials: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'financials').map(([k, v]) => ({...v, key: k})),
      shipping: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'shipping').map(([k, v]) => ({...v, key: k})),
      dates: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'dates').map(([k, v]) => ({...v, key: k})),
      sourcing: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'sourcing').map(([k, v]) => ({...v, key: k})),
      status: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'status').map(([k, v]) => ({...v, key: k})),
      exceptions: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'exceptions').map(([k, v]) => ({...v, key: k})),
      qc: Object.entries(COLUMNS).filter(([_, c]) => c.group === 'qc').map(([k, v]) => ({...v, key: k})),
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══ GLOBAL ERROR HANDLER ═══
// Must be registered after all other middleware and routes
app.use(security.errorHandler);

// ═══ STARTUP VALIDATION ═══
const validateStartup = () => {
  const errors = [];

  // Check critical environment variables
  if (!process.env.DATABASE_URL) {
    errors.push('❌ DATABASE_URL not set');
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      errors.push('❌ JWT_SECRET not set (required for production)');
    }
    if (!process.env.PUBLIC_URL) {
      errors.push('❌ PUBLIC_URL not set (required for production)');
    }
    if (!process.env.RESEND_API_KEY) {
      errors.push('⚠️  RESEND_API_KEY not set (emails will fail)');
    }
  }

  if (errors.length > 0) {
    console.error('🚨 STARTUP ERRORS:');
    errors.forEach(e => console.error(e));
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  console.log('✅ Environment validation passed');
};

// ═══ START SERVER ═══

validateStartup();

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 WebSocket: ws://localhost:${PORT}`);
  console.log(`🔧 Database: PostgreSQL`);
  console.log(`🔐 Security: Rate limiting, input validation, helmet headers enabled`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
