require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(cors());
app.use(express.json({limit: '50mb'}));
app.use(express.static('public'));

// ═══ IN-MEMORY DATA STORE (Demo Mode) ═══
const users = new Map();
const pendingApprovals = new Map();
// ═══ EMAIL SERVICE ═══
const sendEmail = async (to, subject, html) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.warn('⚠️  Email not configured. Simulating email send to:', to);
      return true;
    }

    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });

    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Email error:', error.message);
    return false;
  }
};

// ═══ JWT HELPERS ═══
const generateToken = (email, role) => {
  return jwt.sign({ email, role }, process.env.JWT_SECRET || 'dev-secret-key-12345', {
    expiresIn: '7d',
  });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-12345');
  } catch {
    return null;
  }
};

// ═══ MIDDLEWARE: Authenticate ═══
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  req.user = decoded;
  next();
};

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (users.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = Math.random().toString(36).substring(7);

  users.set(email, {
    id: userId,
    email,
    password: hashedPassword,
    name: name || email,
    role: 'user',
    approved: false,
    createdAt: new Date().toISOString(),
  });

  pendingApprovals.set(email, {
    email,
    name: name || email,
    requestedAt: new Date().toISOString(),
  });

  // Send verification email
  await sendEmail(
    email,
    'Welcome to Babaclick FBM Hub - Pending Admin Approval',
    `
    <h2>Welcome, ${name || email}!</h2>
    <p>Your account has been created and is pending admin approval.</p>
    <p>You'll receive an email once an administrator approves your access.</p>
    <p>Thank you!</p>
    `
  );

  // Notify admin
  if (process.env.ADMIN_EMAIL) {
    await sendEmail(
      process.env.ADMIN_EMAIL,
      'New User Pending Approval',
      `<p><strong>${name || email}</strong> (${email}) has registered and needs approval.</p>`
    );
  }

  res.json({ message: '✅ Registration successful. Pending admin approval.' });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = users.get(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.approved) {
    return res.status(403).json({ error: 'Account pending admin approval' });
  }

  const token = generateToken(email, user.role);
  res.json({
    message: '✅ Login successful',
    token,
    user: { email: user.email, name: user.name, role: user.role },
  });
});

// Get pending approvals (admin only)
app.get('/api/admin/pending-approvals', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const pending = Array.from(pendingApprovals.values());
  res.json({ pending });
});

// Approve user (admin only)
app.post('/api/admin/approve/:email', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { email } = req.params;
  const user = users.get(email);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.approved = true;
  user.role = 'user';
  pendingApprovals.delete(email);

  await sendEmail(
    email,
    '✅ Your Account Has Been Approved!',
    `
    <h2>Great news, ${user.name}!</h2>
    <p>Your account has been approved by an administrator.</p>
    <p>You can now login at: <a href="${process.env.FRONTEND_URL || 'https://babaclick-hub.com'}">FBM Operations Hub</a></p>
    `
  );

  res.json({ message: '✅ User approved' });
});

// Reject user (admin only)
app.post('/api/admin/reject/:email', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { email } = req.params;
  users.delete(email);
  pendingApprovals.delete(email);

  await sendEmail(
    email,
    'Account Request Rejected',
    '<p>Your account request has been rejected. Please contact support for details.</p>'
  );

  res.json({ message: '✅ User rejected' });
});

// Get user profile
app.get('/api/auth/profile', authenticate, (req, res) => {
  const user = users.get(req.user.email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    email: user.email,
    name: user.name,
    role: user.role,
    approved: user.approved,
    createdAt: user.createdAt,
  });
});

// Create admin account (first time only)
app.post('/api/auth/create-admin', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (Array.from(users.values()).some(u => u.role === 'admin')) {
    return res.status(403).json({ error: 'Admin already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = Math.random().toString(36).substring(7);

  users.set(email, {
    id: userId,
    email,
    password: hashedPassword,
    name: name || 'Admin',
    role: 'admin',
    approved: true,
    createdAt: new Date().toISOString(),
  });

  const token = generateToken(email, 'admin');
  res.json({
    message: '✅ Admin account created',
    token,
    user: { email, name: name || 'Admin', role: 'admin' },
  });
});

// ═══ HEALTH CHECK ═══
app.get('/api/health', (req, res) => {
  res.json({ status: '✅ Server is running', time: new Date().toISOString() });
});

// ═══ FALLBACK: Serve React App ═══
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 fallback - serve index.html for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({error: 'Internal server error'});
});

// ═══ START SERVER ═══
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅ Babaclick FBM Operations Hub Server                    ║
║                                                            ║
║  🌐 Running on: http://localhost:${PORT}                     ║
║  📍 API: http://localhost:${PORT}/api                       ║
║  ✔️  Frontend: http://localhost:${PORT}                     ║
║                                                            ║
║  📝 First: Create admin account:                           ║
║     POST http://localhost:${PORT}/api/auth/create-admin     ║
║     Body: {                                               ║
║       "email": "admin@test.com",                          ║
║       "password": "Test123!",                             ║
║       "name": "Admin"                                     ║
║     }                                                      ║
║                                                            ║
║  Then: Register regular user at login page               ║
║  Admin approves user in dashboard                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
