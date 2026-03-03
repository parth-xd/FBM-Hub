# FBM Operations Hub — Production Deployment Guide

## 📋 Project Overview

Full-stack web app for Babaclick FBM operations with:
- ✅ Email-based authentication with admin approval
- ✅ Role-based access (Owner, Importer, Packer)
- ✅ Google Sheets integration for orders
- ✅ Audit logging for all changes
- ✅ Cloud deployment on Render (always running)

**Admin Email:** `parttthh@gmail.com` (approves new user signups)

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 18+ ([Download](https://nodejs.org))
- Git ([Download](https://git-scm.com))
- GitHub account (for git repo)

### 1. Install Dependencies
```bash
npm install
```

### 2. Create `.env` file (copy from `.env.example`)
```bash
cp .env.example .env
```

**Fill in these values:**
```
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3000

# Get from: https://console.firebase.google.com
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com

# Your existing Google Sheets
GOOGLE_SHEET_ID=1YSvua6QlTKGaR7skQiiYXJUaN6WNFIk2GD4eFuX-JW0
```

### 3. Run Locally
```bash
npm run dev
```

Visit: http://localhost:3000

---

## ☁️ Deploy to Render (Live with Your Domain)

### Step 1: Create GitHub Repository
```bash
git init
git add .
git commit -m "Initial commit: Full-stack FBM app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/babaclick-fbm-hub.git
git push -u origin main
```

### Step 2: Set Up Firebase
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project: `babaclick-fbm-hub`
3. Enable Firestore Database (Start in test mode)
4. Create service account:
   - Project Settings → Service Accounts
   - Generate new private key (JSON)
   - Copy entire JSON content

### Step 3: Deploy to Render
1. Go to [render.com](https://render.com) → Sign up (free)
2. Click "New +" → "Web Service"
3. Connect GitHub repo: `babaclick-fbm-hub`
4. Configure:
   - **Name:** `babaclick-fbm-hub`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (or Paid for better specs)

5. **Add Environment Variables:**
   - Paste all values from `.env` (Firebase key, Sheet ID, etc.)
   - `FRONTEND_URL=` will be shown after first deploy

6. Click **Create Web Service** → Deploy starts automatically

**Your URL:** `https://babaclick-fbm-hub.onrender.com` (you can customize)

---

## 🌐 Connect Your GoDaddy Domain

### 1. Get Render's Domain Info
After deployment on Render, you'll see:
- **Render's URL:** `https://babaclick-fbm-hub.onrender.com`
- **Custom domain settings** in Render dashboard

### 2. Point GoDaddy to Render
1. GoDaddy Dashboard → Your Domains
2. Click your domain → DNS Settings
3. Update nameservers to Render's (Render will show exact values)
   - Or add CNAME Record pointing to Render URL

4. Add to Render dashboard:
   - Settings → Custom Domains
   - Add your GoDaddy domain
   - Follow verification steps

**Wait 24-48 hours for DNS propagation**

---

## 📝 How It Works

### User Flow
1. **New user** visits site and clicks "Sign up"
2. Enters email + name → Request submitted
3. **Admin** (you at `parttthh@gmail.com`) gets notification
4. Admin approves user with role (Owner/Importer/Packer)
5. User can now login with email

### After Login
User sees dashboard based on role:
- **Owner:** Admin panel + full analytics + audit logs
- **Importer:** Operations table + exception handling
- **Packer:** Basket view + packing workflow

### Every Change is Logged
- Who made the change
- When (timestamp)
- What changed (field, old value, new value)
- All queryable in Audit Log tab

---

## 🔄 Making Changes & Deploying

### Local Development
```bash
# Make code changes in VS Code
npm run dev  # Test locally
```

### Push to Live
```bash
git add .
git commit -m "Fix: [describe change]"
git push origin main
```

**Render auto-deploys in ~30 seconds. Your live site updates immediately.**

---

## 🗂 Project Structure

```
babaclick-web/
├── server.js          # Express backend + API routes
├── public/
│   └── index.html     # React frontend (single-page app)
├── package.json       # Dependencies & scripts
├── .env.example       # Environment template
├── render.yaml        # Render deployment config
└── .gitignore         # Git ignore file
```

---

## 🔐 Security Notes

- All passwords stored hashed in Firebase
- Audit logs immutable (for compliance)
- Admin email (`parttthh@gmail.com`) has special access
- Rate limiting on API (100 requests/15 min)
- CORS enabled only for your domain

---

## 🛠 Troubleshooting

### "Firebase initialization failed"
- Check `FIREBASE_SERVICE_ACCOUNT` in `.env` is valid JSON
- Restart server: `npm run dev`

### "Domain not working"
- DNS can take 24-48 hours to propagate
- Check GoDaddy nameserver settings match Render

### "500 error on /api/admin"
- Verify `ADMIN_EMAIL` is correctly set
- Check user email sent in request header

### "Google Sheets not syncing"
- Verify `GOOGLE_SHEET_ID` in `.env`
- Ensure sheet is shared with service account email

---

## 📞 Support & Resources

- [Render Docs](https://render.com/docs)
- [Firebase Docs](https://firebase.google.com/docs)
- [Express.js Guide](https://expressjs.com)
- [React Docs](https://react.dev)

---

## 🎯 Next Steps

1. ✅ Set up Firebase project
2. ✅ Create GitHub repo
3. ✅ Deploy to Render
4. ✅ Connect GoDaddy domain
5. ✅ Share login link with team
6. ✅ Approve first users from admin email

**That's it! Your app is live and everyone can access it 24/7.** 🚀
