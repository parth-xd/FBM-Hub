require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

app.use(express.json({limit: '50mb'}));
app.use(express.static('public'));

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (Object.keys(serviceAccount).length > 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.firestore ? admin.firestore() : null;

// ═══ MODELS ═══
const Users = {
  async getAll() {
    if (!db) return [];
    const snap = await db.collection('users').get();
    return snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
  },
  
  async getByEmail(email) {
    if (!db) return null;
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    return snap.empty ? null : {id: snap.docs[0].id, ...snap.docs[0].data()};
  },
  
  async create(email, name) {
    if (!db) return null;
    const userId = uuidv4();
    const userData = {
      id: userId,
      email,
      name,
      role: null,
      approved: false,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      status: 'pending_approval'
    };
    await db.collection('users').doc(email).set(userData);
    return userData;
  },
  
  async updateRole(email, role) {
    if (!db) return null;
    await db.collection('users').doc(email).update({
      role,
      approved: true,
      lastLogin: new Date().toISOString()
    });
  },
  
  async updateLastLogin(email) {
    if (!db) return;
    await db.collection('users').doc(email).update({
      lastLogin: new Date().toISOString()
    });
  }
};

const AuditLogs = {
  async add(logEntry) {
    if (!db) return;
    await db.collection('audit_logs').add({
      ...logEntry,
      timestamp: new Date().toISOString()
    });
  },
  
  async getByOrder(orderId) {
    if (!db) return [];
    const snap = await db.collection('audit_logs').where('orderId', '==', orderId).get();
    return snap.docs.map(doc => doc.data()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },
  
  async getAll(filter = {}) {
    if (!db) return [];
    let query = db.collection('audit_logs');
    if (filter.user) query = query.where('user', '==', filter.user);
    if (filter.field) query = query.where('field', '==', filter.field);
    
    const snap = await query.orderBy('timestamp', 'desc').limit(1000).get();
    return snap.docs.map(doc => doc.data());
  }
};

// ═══ AUTH ROUTES ═══
app.post('/api/auth/register', async (req, res) => {
  try {
    const {email, name} = req.body;
    if (!email || !name) return res.status(400).json({error: 'Email and name required'});
    
    let user = await Users.getByEmail(email);
    if (user && user.approved) {
      return res.status(400).json({error: 'User already exists'});
    }
    
    if (!user) {
      user = await Users.create(email, name);
    }
    
    // Log signup request
    await AuditLogs.add({
      user: name,
      email,
      action: 'signup_requested',
      status: 'pending_approval'
    });
    
    res.json({
      message: 'Signup request sent. Awaiting admin approval.',
      email,
      status: 'pending_approval'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Signup failed'});
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const {email} = req.body;
    if (!email) return res.status(400).json({error: 'Email required'});
    
    const user = await Users.getByEmail(email);
    
    if (!user) {
      return res.status(401).json({error: 'User not found. Please register first.'});
    }
    
    if (!user.approved) {
      return res.status(403).json({error: 'Account pending admin approval'});
    }
    
    // Update last login
    await Users.updateLastLogin(email);
    
    // Generate session token
    const token = Buffer.from(JSON.stringify({
      email,
      name: user.name,
      role: user.role,
      loginTime: new Date().toISOString()
    })).toString('base64');
    
    res.json({
      success: true,
      token,
      user: {
        email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Login failed'});
  }
});

// ═══ USAGE TRACKING ═══
const UsageLog = {
  async recordWrite(sheets = 0, firebase = 0, other = 0) {
    if (!db) return;
    await db.collection('usage_logs').add({
      timestamp: new Date().toISOString(),
      sheets_writes: sheets,
      firebase_ops: firebase,
      estimated_cost_usd: (sheets * 0.000006) + (firebase * 0.000001),
      date: new Date().toISOString().split('T')[0]
    });
  },
  
  async getUsageStats() {
    if (!db) return {total_cost: 0, sheets_writes: 0, firebase_ops: 0, remaining_credits: 300};
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const snap = await db.collection('usage_logs')
      .where('timestamp', '>=', thirtyDaysAgo.toISOString())
      .get();
    
    let total_cost = 0;
    let sheets_writes = 0;
    let firebase_ops = 0;
    
    snap.docs.forEach(doc => {
      const data = doc.data();
      total_cost += data.estimated_cost_usd || 0;
      sheets_writes += data.sheets_writes || 0;
      firebase_ops += data.firebase_ops || 0;
    });
    
    return {
      total_cost: total_cost.toFixed(2),
      sheets_writes,
      firebase_ops,
      remaining_credits: (300 - total_cost).toFixed(2),
      period: 'Last 30 days'
    };
  }
};

// ═══ ADMIN ROUTES ═══
app.get('/api/admin/pending-users', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'];
    if (!ADMIN_USERS.includes(userEmail)) return res.status(403).json({error: 'Admin access required'});
    
    const users = await Users.getAll();
    const pending = users.filter(u => u.status === 'pending_approval');
    
    res.json({pending});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Failed to fetch pending users'});
  }
});

app.post('/api/admin/approve-user', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'];
    if (!ADMIN_USERS.includes(userEmail)) return res.status(403).json({error: 'Admin access required'});
    
    const {email, role} = req.body;
    if (!email || !role) return res.status(400).json({error: 'Email and role required'});
    
    const validRoles = ['owner', 'importer', 'packer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({error: 'Invalid role'});
    }
    
    await Users.updateRole(email, role);
    
    await AuditLogs.add({
      action: 'user_approved',
      email,
      role,
      approvedBy: 'admin'
    });
    
    res.json({success: true, message: `User ${email} approved as ${role}`});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Approval failed'});
  }
});

app.get('/api/admin/usage-stats', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'];
    if (!ADMIN_USERS.includes(userEmail)) return res.status(403).json({error: 'Admin access required'});
    
    const stats = await UsageLog.getUsageStats();
    res.json(stats);
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Failed to fetch usage stats'});
  }
});

// ═══ AUDIT LOG ROUTES ═══
app.get('/api/audit-logs', async (req, res) => {
  try {
    const logs = await AuditLogs.getAll();
    res.json({logs});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Failed to fetch audit logs'});
  }
});

app.post('/api/audit-logs', async (req, res) => {
  try {
    const {orderId, field, oldValue, newValue, details, user, role} = req.body;
    await AuditLogs.add({
      orderId,
      field,
      oldValue,
      newValue,
      details,
      user,
      role
    });
    res.json({success: true});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Failed to log change'});
  }
});

// ═══ SHEET SYNC ROUTES ═══
app.get('/api/google-sheet/sync', async (req, res) => {
  try {
    // This endpoint will sync with Google Sheets
    // Implementation depends on your sheets setup
    res.json({message: 'Sheet sync endpoint ready'});
  } catch (error) {
    res.status(500).json({error: 'Sync failed'});
  }
});

// ═══ HEALTH CHECK ═══
app.get('/api/health', (req, res) => {
  res.json({status: 'ok', timestamp: new Date().toISOString()});
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({error: 'Endpoint not found'});
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({error: 'Internal server error'});
});

app.listen(PORT, () => {
  console.log(`✓ FBM Ops Hub running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ Firebase initialized: ${!!db}`);
});

module.exports = app;
