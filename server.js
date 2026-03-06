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

// ═══ IN-MEMORY DATA STORE ═══
const users = new Map(); // {email: {email, name, role, status, createdAt}}
const pendingApprovals = new Map(); // {token: {email, name, role, createdAt}}
const loginTokens = new Map(); // {token: {email, expires, used}}

const OWNER_EMAIL = 'parttthh@gmail.com';
const crypto = require('crypto');
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

// ═══ NEW AUTH ENDPOINTS (Email-based Signup & Approval) ═══

// Signup endpoint (new users request access)
app.post('/api/auth/signup', async (req, res) => {
  try {
    const {email, name, role} = req.body;
    if (!email || !name || !role) {
      return res.status(400).json({error: 'Email, name, and role required'});
    }

    const emailLower = email.toLowerCase();
    
    // Check if user already exists
    if (users.has(emailLower)) {
      const user = users.get(emailLower);
      if (user.status === 'pending_approval') {
        return res.json({message: 'Your signup is already pending approval', status: 'pending'});
      }
    }

    // Create pending user
    users.set(emailLower, {
      email: emailLower,
      name: name,
      role: role,
      status: 'pending_approval',
      createdAt: new Date().toISOString()
    });

    // Create approval token
    const approvalToken = crypto.randomBytes(32).toString('hex');
    pendingApprovals.set(approvalToken, {email: emailLower, name, role, createdAt: new Date().toISOString()});

    // Send approval request email to owner
    const approveUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/auth/approve?token=${approvalToken}`;
    const rejectUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/auth/reject?token=${approvalToken}`;

    await sendEmail(
      process.env.EMAIL_ADMIN_RECIPIENTS || OWNER_EMAIL,
      `👤 New User Signup Request: ${name}`,
      `
        <h3>New User Signup Request</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${emailLower}</p>
        <p><strong>Requested Role:</strong> ${role.toUpperCase()}</p>
        <p><strong>Status:</strong> ⏳ Pending Your Approval</p>
        <hr>
        <p>
          <a href="${approveUrl}" style="background:#10b981;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin-right:10px;font-weight:bold;">✅ Approve</a>
          <a href="${rejectUrl}" style="background:#ef4444;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;">❌ Reject</a>
        </p>
      `
    ).catch(err => console.error('Email error:', err));

    return res.json({message: 'Signup request sent. Awaiting admin approval.', status: 'pending'});
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Send login email (for existing approved users)
app.post('/api/auth/send-login-email', async (req, res) => {
  try {
    const {email} = req.body;
    if (!email) return res.status(400).json({error: 'Email required'});

    const emailLower = email.toLowerCase();
    
    // Owner auto-login
    if (emailLower === OWNER_EMAIL) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Math.floor(Date.now() / 1000) + (15 * 60);
      loginTokens.set(token, {email: emailLower, expires, used: false});
      const loginUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}?token=${token}`;
      
      await sendEmail(
        emailLower,
        '🔐 Your FBM Ops Hub Login Link (Owner)',
        `<p>Click below to login as <strong>Owner</strong> (link expires in 15 minutes):</p>
               <p><a href="${loginUrl}" style="background:#3b82f6;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;">Login to FBM Ops Hub</a></p>`
      ).catch(err => console.error('Email error:', err));
      
      return res.json({message: 'Login link sent to email', status: 'sent'});
    }

    // Check if user exists
    const user = users.get(emailLower);
    
    if (!user) {
      return res.status(404).json({error: 'User not found. Please sign up first.'});
    }

    if (user.status === 'pending_approval') {
      return res.json({message: 'Your account is awaiting admin approval', status: 'pending'});
    }

    if (user.status === 'rejected') {
      return res.status(403).json({error: 'Access denied. Contact your administrator.'});
    }

    // Approved user - send login link
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Math.floor(Date.now() / 1000) + (15 * 60);
    loginTokens.set(token, {email: emailLower, expires, used: false});
    
    const loginUrl = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}?token=${token}`;

    await sendEmail(
      emailLower,
      `🔐 Your FBM Ops Hub Login Link (${user.role})`,
      `<p>Click below to login as <strong>${user.role.toUpperCase()}</strong> (link expires in 15 minutes):</p>
             <p><a href="${loginUrl}" style="background:#10b981;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;">Login to FBM Ops Hub</a></p>`
    ).catch(err => console.error('Email error:', err));

    res.json({message: 'Login link sent to email', status: 'sent'});
  } catch (error) {
    console.error('Login email error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Verify login token
app.post('/api/auth/verify-token', async (req, res) => {
  try {
    const {token} = req.body;
    if (!token) return res.status(400).json({error: 'Token required'});

    const tokenData = loginTokens.get(token);

    if (!tokenData) {
      return res.status(401).json({error: 'Invalid token'});
    }

    const now = Math.floor(Date.now() / 1000);

    if (tokenData.used || tokenData.expires < now) {
      return res.status(401).json({error: 'Token expired or already used'});
    }

    // Mark token as used
    tokenData.used = true;

    // Get user data
    const user = users.get(tokenData.email);

    if (tokenData.email === OWNER_EMAIL) {
      res.json({
        sessionToken: token,
        user: {
          email: OWNER_EMAIL,
          name: 'Parth Sharma',
          role: 'owner',
          id: OWNER_EMAIL
        }
      });
      return;
    }

    if (!user || user.status !== 'approved') {
      return res.status(403).json({error: 'User not approved'});
    }

    res.json({
      sessionToken: token,
      user: {
        email: tokenData.email,
        name: user.name,
        role: user.role,
        id: user.email
      }
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Approve user endpoint
app.get('/api/auth/approve', async (req, res) => {
  try {
    const {token} = req.query;
    if (!token || !pendingApprovals.has(token)) {
      return res.status(400).json({error: 'Invalid approval token'});
    }

    const {email, name, role} = pendingApprovals.get(token);
    pendingApprovals.delete(token);

    // Update user status
    users.set(email, {
      email, name, role,
      status: 'approved',
      approvedAt: new Date().toISOString()
    });

    // Send approval confirmation email
    await sendEmail(
      email,
      '✅ Your FBM Ops Hub Account Approved!',
      `<h3>Welcome to FBM Ops Hub!</h3>
        <p>Your account has been approved as a <strong>${role.toUpperCase()}</strong>.</p>
        <p>You can now log in with your email on the dashboard.</p>`
    ).catch(err => console.error('Email error:', err));

    res.json({message: 'User approved successfully'});
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Reject user endpoint
app.get('/api/auth/reject', async (req, res) => {
  try {
    const {token} = req.query;
    if (!token || !pendingApprovals.has(token)) {
      return res.status(400).json({error: 'Invalid rejection token'});
    }

    const {email} = pendingApprovals.get(token);
    pendingApprovals.delete(token);

    // Update user status
    users.set(email, {
      email,
      status: 'rejected',
      rejectedAt: new Date().toISOString()
    });

    // Send rejection email
    await sendEmail(
      email,
      '❌ Your FBM Ops Hub Signup Request',
      `<p>Your signup request has been rejected. Contact the administrator if you have questions.</p>`
    ).catch(err => console.error('Email error:', err));

    res.json({message: 'User rejected successfully'});
  } catch (error) {
    console.error('Rejection error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// ═══ HEALTH CHECK ═══
app.get('/api/health', (req, res) => {
  res.json({ status: '✅ Server is running', version: '2.0 - Email Auth Ready', time: new Date().toISOString() });
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
