import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import {google} from 'googleapis';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CREDENTIALS_PATH = './credentials/service-account-key.json';
const FIREBASE_KEY_PATH = './credentials/firebase-key.json';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Initialize Firebase (disabled for now - UI-only mode)
let db = null;
let admin = null;
console.log('ℹ Firebase auth disabled - UI-only mode');

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS // App password, not regular password
  }
});

async function getSheetsClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Missing service account key at ${CREDENTIALS_PATH}. Place your JSON there.`);
  }
  const auth = new google.auth.GoogleAuth({keyFile: CREDENTIALS_PATH, scopes: SCOPES});
  const client = await auth.getClient();
  return google.sheets({version: 'v4', auth: client});
}

const app = express();
app.use(cors());
app.use(express.json({limit: '50mb'}));

// Serve static files (HTML, CSS, JS)
app.use(express.static(__dirname));

const DEFAULT_RANGE = 'Main STB Expenses!A3:AN';

// ═══ HEALTH CHECK & BASIC ENDPOINTS ═══
app.get('/health', (req, res) => res.json({ok: true, service: 'fbm-ops'}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'fbm-operations-hub-v3.html'));
});

// ═══ GOOGLE SHEETS ENDPOINTS ═══
app.get('/api/read', async (req, res) => {
  try {
    const spreadsheetId = req.query.spreadsheetId || process.env.SPREADSHEET_ID;
    if (!spreadsheetId) return res.status(400).json({error: 'spreadsheetId required'});
    const range = req.query.range || DEFAULT_RANGE;
    const sheets = await getSheetsClient();
    const r = await sheets.spreadsheets.values.get({spreadsheetId, range});
    res.json({values: r.data.values || []});
  } catch (e) { 
    console.error('Read error:', e.message);
    res.status(500).json({error: e.message}); 
  }
});

app.post('/api/write', async (req, res) => {
  try {
    const {spreadsheetId, range, values} = req.body;
    const id = spreadsheetId || process.env.SPREADSHEET_ID;
    if (!id) return res.status(400).json({error: 'spreadsheetId required'});
    if (!range || !values) return res.status(400).json({error: 'range and values required'});
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });
    res.json({ok: true});
  } catch (e) { 
    console.error('Write error:', e.message);
    res.status(500).json({error: e.message}); 
  }
});

// Append a new row to the sheet
app.post('/api/append', async (req, res) => {
  try {
    const {spreadsheetId, range, values} = req.body;
    const id = spreadsheetId || process.env.SPREADSHEET_ID;
    if (!id) return res.status(400).json({error: 'spreadsheetId required'});
    if (!range || !values) return res.status(400).json({error: 'range and values required'});
    
    const sheets = await getSheetsClient();
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });
    
    res.json({
      ok: true,
      updates: appendResponse.data.updates,
      updatedRows: appendResponse.data.updates?.updatedRows
    });
  } catch (e) { 
    console.error('Append error:', e.message);
    res.status(500).json({error: e.message}); 
  }
});

// Delete a row from the sheet
app.post('/api/delete-row', async (req, res) => {
  try {
    const {spreadsheetId, sheetName, rowNumber} = req.body;
    const id = spreadsheetId || process.env.SPREADSHEET_ID;
    if (!id) return res.status(400).json({error: 'spreadsheetId required'});
    if (!sheetName || !rowNumber) return res.status(400).json({error: 'sheetName and rowNumber required'});
    
    console.log(`🗑 Deleting row ${rowNumber} from sheet "${sheetName}"`);
    
    const sheets = await getSheetsClient();
    
    // Get sheet ID by name
    const spreadsheet = await sheets.spreadsheets.get({spreadsheetId: id});
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    
    if (!sheet) {
      console.error(`❌ Sheet "${sheetName}" not found. Available sheets:`, spreadsheet.data.sheets.map(s => s.properties.title));
      return res.status(404).json({error: `Sheet "${sheetName}" not found`});
    }
    
    const sheetId = sheet.properties.sheetId;
    console.log(`✓ Found sheet "${sheetName}" with ID ${sheetId}`);
    
    // Delete the row using batchUpdate
    const deleteResponse = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: rowNumber - 1, // Convert to 0-based index
                endIndex: rowNumber // Delete one row
              }
            }
          }
        ]
      }
    });
    
    console.log('✓ Row deleted successfully');
    res.json({ok: true, response: deleteResponse.data});
  } catch (e) { 
    console.error('❌ Delete row error:', e.message, e);
    res.status(500).json({error: e.message}); 
  }
});

// ═══ SHIPSTATION ENDPOINTS ═══

// Fulfill order - create shipping label using ShipStation v2 API
app.post('/api/shipstation/fulfill-order', async (req, res) => {
  try {
    const {orderId, weight} = req.body;
    
    if (!orderId || !weight) {
      return res.status(400).json({error: 'orderId and weight required'});
    }
    
    const apiKey = process.env.SHIPSTATION_API_KEY;
    if (!apiKey) {
      return res.status(500).json({error: 'ShipStation API key not configured'});
    }
    
    console.log(`🚚 Creating label for order ${orderId}...`);
    
    // Warehouse address
    const shipFrom = {
      name: 'ATTN MAX',
      company_name: 'Babaclick Trading Limited',
      address_line1: 'W71, Bletchley Business Campus, 1-9 Barton Road',
      city_locality: 'Bletchley',
      state_province: 'Buckinghamshire',
      postal_code: 'MK2 3JD',
      country_code: 'GB'
    };
    
    // Fetch order from ShipStation to get customer address
    let shipTo = null;
    try {
      const shipRes = await fetch(`https://api.shipstation.com/v2/shipments?order_number=${encodeURIComponent(orderId)}`, {
        headers: {'API-Key': apiKey}
      });
      if (shipRes.ok) {
        const shipData = await shipRes.json();
        if (shipData.data && shipData.data.length > 0) {
          const shipment = shipData.data[0];
          if (shipment.to && shipment.to.residential !== undefined) {
            // Got shipment with customer address
            shipTo = {
              name: shipment.to.name || 'Customer',
              address_line1: shipment.to.line1 || shipment.to.address_line1 || 'Unknown',
              city_locality: shipment.to.city_locality || shipment.to.city || 'Unknown',
              state_province: shipment.to.state_province || shipment.to.state || 'XX',
              postal_code: shipment.to.postal_code || shipment.to.zip || '00000',
              country_code: shipment.to.country_code || 'GB'
            };
          }
        }
      }
    } catch (e) {
      console.log('⚠ Could not fetch from ShipStation shipments:', e.message);
    }
    
    // Fallback if fetch failed - use placeholder
    if (!shipTo) {
      shipTo = {
        name: 'Customer',
        address_line1: 'Check ShipStation for address',
        city_locality: 'See Order',
        state_province: 'GB',
        postal_code: '',
        country_code: 'GB'
      };
    }
    
    // Detect service based on destination country
    const destCountry = shipTo.country_code?.toUpperCase() || 'GB';
    const euCountries = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
    
    let serviceCode;
    if (destCountry === 'GB') {
      serviceCode = 'rm_cnd_walleted_tracked24';
    } else if (euCountries.includes(destCountry)) {
      serviceCode = 'rm_cnd_walleted_gp_eu';
    } else {
      serviceCode = 'rm_cnd_walleted_gp_row';
    }
    
    const carrierId = 'se-370099';
    
    // Create label request
    const labelRequest = {
      shipment: {
        carrier_id: carrierId,
        service_code: serviceCode,
        ship_from: shipFrom,
        ship_to: shipTo,
        packages: [
          {
            weight: {
              value: parseFloat(weight),
              unit: 'kilogram'
            }
          }
        ]
      },
      label_format: 'pdf',
      label_layout: '4x6'
    };
    
    const createRes = await fetch('https://api.shipstation.com/v2/labels', {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(labelRequest)
    });
    
    const responseText = await createRes.text();
    
    if (!createRes.ok) {
      console.error('❌ Label failed:', createRes.status);
      return res.status(createRes.status).json({
        error: `ShipStation error: ${createRes.status}`,
        details: responseText.substring(0, 200)
      });
    }
    
    const labelData = JSON.parse(responseText);
    console.log(`✓ Label created - ID: ${labelData.label_id}, Tracking: ${labelData.tracking_number}`);
    
    res.json({
      ok: true,
      orderId: orderId,
      labelId: labelData.label_id,
      trackingNumber: labelData.tracking_number,
      labelUrl: labelData.label_download?.pdf,
      shipmentCost: labelData.shipment_cost,
      message: 'Label created successfully'
    });
    
  } catch (e) {
    console.error('❌ Fulfill order error:', e.message);
    res.status(500).json({error: e.message});
  }
});

// ═══ AUTHENTICATION ENDPOINTS ═══

// Send login email
app.post('/api/auth/send-login-email', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {email} = req.body;
    if (!email) return res.status(400).json({error: 'Email required'});

    const emailLower = email.toLowerCase();
    const usersRef = db.collection('users');
    const userDoc = await usersRef.doc(emailLower).get();

    if (!userDoc.exists) {
      // New user - create pending approval request
      await usersRef.doc(emailLower).set({
        email: emailLower,
        status: 'pending_approval',
        createdAt: new Date(),
        role: null,
        name: null
      });
      
      // Send admin notification email
      if (process.env.ADMIN_EMAIL) {
        await transporter.sendMail({
          from: process.env.GMAIL_USER,
          to: process.env.ADMIN_EMAIL,
          subject: `🔔 New User Signup: ${emailLower}`,
          html: `<p>New user <strong>${emailLower}</strong> is awaiting approval.</p>
                 <p>Visit the admin panel to approve or reject.</p>`
        }).catch(err => console.error('Email error:', err));
      }

      return res.json({ 
        message: 'Account created. Awaiting admin approval.',
        status: 'pending'
      });
    }

    const user = userDoc.data();
    
    if (user.status === 'pending_approval') {
      return res.json({ 
        message: 'Your account is awaiting admin approval',
        status: 'pending'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ 
        error: 'Access denied. Contact your administrator.'
      });
    }

    // Existing approved user - create login token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Math.floor(Date.now() / 1000) + (15 * 60); // 15 min
    
    await db.collection('login_tokens').doc(token).set({
      email: emailLower,
      expires,
      used: false,
      createdAt: new Date()
    });

    const loginUrl = `${process.env.FRONTEND_URL}?token=${token}`;

    // Send login email
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: emailLower,
      subject: '🔐 Your FBM Ops Hub Login Link',
      html: `<p>Click below to login (link expires in 15 minutes):</p>
             <p><a href="${loginUrl}"><strong>Login to FBM Ops Hub</strong></a></p>
             <p>Link: ${loginUrl}</p>`
    }).catch(err => console.error('Email error:', err));

    res.json({ 
      message: 'Login link sent to email',
      status: 'sent',
      debug: process.env.DEBUG === 'true' ? {token, loginUrl} : undefined
    });
  } catch (error) {
    console.error('Login email error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Verify login token
app.post('/api/auth/verify-token', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {token} = req.body;
    if (!token) return res.status(400).json({error: 'Token required'});

    const tokenDoc = await db.collection('login_tokens').doc(token).get();

    if (!tokenDoc.exists) {
      return res.status(401).json({error: 'Invalid token'});
    }

    const tokenData = tokenDoc.data();
    const now = Math.floor(Date.now() / 1000);

    if (tokenData.used || tokenData.expires < now) {
      return res.status(401).json({error: 'Token expired or already used'});
    }

    // Mark token as used
    await tokenDoc.ref.update({used: true});

    // Get user data
    const userDoc = await db.collection('users').doc(tokenData.email).get();
    const user = userDoc.data();

    if (user.status !== 'approved') {
      return res.status(403).json({error: 'User not approved'});
    }

    // Create session (7 days)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionExpires = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    await db.collection('sessions').doc(sessionToken).set({
      email: tokenData.email,
      role: user.role,
      userName: user.name,
      loginTime: new Date(),
      expires: sessionExpires
    });

    res.json({
      sessionToken,
      user: {
        email: tokenData.email,
        name: user.name,
        role: user.role,
        id: user.id || tokenData.email
      }
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Verify session
app.post('/api/auth/verify-session', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {sessionToken} = req.body;
    if (!sessionToken) return res.status(401).json({error: 'No session'});

    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();

    if (!sessionDoc.exists) {
      return res.status(401).json({error: 'Invalid session'});
    }

    const session = sessionDoc.data();
    const now = Math.floor(Date.now() / 1000);

    if (session.expires < now) {
      return res.status(401).json({error: 'Session expired'});
    }

    res.json({
      valid: true,
      user: {
        email: session.email,
        name: session.userName,
        role: session.role,
        loginTime: session.loginTime
      }
    });
  } catch (error) {
    res.status(500).json({error: 'Server error'});
  }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
  try {
    if (!db) return res.json({logged_out: true});

    const {sessionToken} = req.body;
    if (sessionToken) {
      await db.collection('sessions').doc(sessionToken).delete();
    }
    res.json({logged_out: true});
  } catch (error) {
    res.status(500).json({error: 'Server error'});
  }
});

// ═══ ADMIN ENDPOINTS ═══

// Get pending user approvals
app.get('/api/admin/pending-users', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {sessionToken} = req.query;
    
    // Verify admin session
    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();
    if (!sessionDoc.exists) return res.status(401).json({error: 'Unauthorized'});

    const session = sessionDoc.data();
    const now = Math.floor(Date.now() / 1000);
    
    if (session.role !== 'owner' || session.expires < now) {
      return res.status(403).json({error: 'Admin access required'});
    }

    const pendingSnapshot = await db.collection('users')
      .where('status', '==', 'pending_approval')
      .get();

    const pending = [];
    pendingSnapshot.forEach(doc => {
      pending.push({email: doc.id, ...doc.data()});
    });

    res.json({pending});
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

// Approve user
app.post('/api/admin/approve-user', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {sessionToken, email, role, name} = req.body;
    
    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();
    if (!sessionDoc.exists) return res.status(401).json({error: 'Unauthorized'});

    const session = sessionDoc.data();
    const now = Math.floor(Date.now() / 1000);
    
    if (session.role !== 'owner' || session.expires < now) {
      return res.status(403).json({error: 'Admin access required'});
    }

    const emailLower = email.toLowerCase();
    await db.collection('users').doc(emailLower).update({
      status: 'approved',
      role,
      name,
      approvedAt: new Date(),
      approvedBy: session.email,
      id: emailLower
    });

    // Send approval email
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: emailLower,
      subject: '✅ Your FBM Ops Hub Account is Approved!',
      html: `<p>Welcome to FBM Operations Hub!</p>
             <p>Your account has been approved with role: <strong>${role}</strong></p>
             <p><a href="${process.env.FRONTEND_URL}"><strong>Go to Dashboard</strong></a></p>`
    }).catch(err => console.error('Email error:', err));

    res.json({message: 'User approved and notified'});
  } catch (error) {
    res.status(500).json({error: 'Server error'});
  }
});

// Reject user
app.post('/api/admin/reject-user', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {sessionToken, email} = req.body;
    
    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();
    if (!sessionDoc.exists) return res.status(401).json({error: 'Unauthorized'});

    const session = sessionDoc.data();
    const now = Math.floor(Date.now() / 1000);
    
    if (session.role !== 'owner' || session.expires < now) {
      return res.status(403).json({error: 'Admin access required'});
    }

    const emailLower = email.toLowerCase();
    await db.collection('users').doc(emailLower).update({
      status: 'rejected',
      rejectedAt: new Date(),
      rejectedBy: session.email
    });

    res.json({message: 'User rejected'});
  } catch (error) {
    res.status(500).json({error: 'Server error'});
  }
});

// ═══ AUDIT LOG ═══
app.post('/api/audit/log', async (req, res) => {
  try {
    if (!db) return res.status(503).json({error: 'Auth service unavailable'});

    const {sessionToken, orderId, field, oldValue, newValue, details} = req.body;

    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();
    if (!sessionDoc.exists) return res.status(401).json({error: 'Invalid session'});

    const session = sessionDoc.data();
    const now = Math.floor(Date.now() / 1000);

    if (session.expires < now) {
      return res.status(401).json({error: 'Session expired'});
    }

    await db.collection('audit_logs').add({
      timestamp: new Date(),
      email: session.email,
      user: session.userName,
      role: session.role,
      orderId,
      field,
      oldValue,
      newValue,
      details
    });

    res.json({logged: true});
  } catch (error) {
    console.error('Audit log error:', error);
    res.status(500).json({error: 'Server error'});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 FBM Ops Backend running on port ${PORT}`);
  console.log(`📊 Google Sheets API: ${process.env.SPREADSHEET_ID ? '✓ Configured' : '⚠ Not configured'}`);
  console.log(`🔐 Firebase Auth: ${db ? '✓ Ready' : '⚠ Disabled'}\n`);
});
