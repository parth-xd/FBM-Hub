# 🚀 GO LIVE CHECKLIST - FBM Ops Hub

Follow these steps in order to launch your app live on your GoDaddy domain.

---

## ✅ STEP 1: GitHub Setup (5 minutes)

### 1.1 Create GitHub Repository
1. Go to [github.com](https://github.com) → Sign in/Create account
2. Click "+" → "New repository"
3. Name: `babaclick-fbm-hub` → Create

### 1.2 Push Code to GitHub
Open Terminal in VS Code (Ctrl+`) and run:
```bash
cd /Users/parthsharma/Desktop/babaclick-web
git init
git add .
git commit -m "Initial commit: FBM Ops Hub with email auth and admin approval"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/babaclick-fbm-hub.git
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username**

---

## ✅ STEP 2: Firebase Setup (10 minutes)

### 2.1 Create Firebase Project
1. Go to [firebase.google.com](https://firebase.google.com)
2. Click "Get Started" → Create project → Name: `babaclick-fbm-hub`
3. Enable Google Analytics (optional) → Create

### 2.2 Enable Firestore Database
1. Left sidebar → "Firestore Database"
2. Click "Create database" → "Start in test mode" → USA → Create

### 2.3 Create Service Account
1. Left sidebar → "Project Settings" (gear icon)
2. → "Service Accounts" tab
3. Click "Generate New Private Key"
4. A JSON file downloads — **Open it and copy all content**

### 2.4 Get Database URL
1. Still in "Project Settings" → Look for: `databaseURL`
2. It looks like: `https://your-project-id.firebaseio.com`

---

## ✅ STEP 3: Render Deployment (15 minutes)

### 3.1 Create Render Account
1. Go to [render.com](https://render.com)
2. Click "Sign Up" → Use GitHub account → Authorize

### 3.2 Create Web Service
1. Dashboard → "New +" → "Web Service"
2. Repository: `babaclick-fbm-hub` → Connect
3. Fill in:
   - **Name:** `babaclick-fbm-hub`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (you can upgrade later)

### 3.3 Add Environment Variables
In Render, click "Environment" on left → Add these:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `FIREBASE_SERVICE_ACCOUNT` | *Paste entire JSON from Step 2.3* |
| `FIREBASE_DATABASE_URL` | *From Step 2.4* |
| `GOOGLE_SHEET_ID` | `1YSvua6QlTKGaR7skQiiYXJUaN6WNFIk2GD4eFuX-JW0` |

### 3.4 Deploy
Click "Create Web Service" → **Wait 3-5 minutes**

You'll see: `https://babaclick-fbm-hub.onrender.com` ✅

**Copy this URL** — you'll need it next.

### 3.5 Update Frontend URL
Back in Render Dashboard:
- Add new environment variable: `FRONTEND_URL` = `https://babaclick-fbm-hub.onrender.com`
- Service restarts automatically

---

## ✅ STEP 4: Connect GoDaddy Domain (15 minutes)

### 4.1 Get Nameservers from Render
1. Render Dashboard → Your service → Settings → Custom Domain
2. Click "Add Custom Domain" → Enter your domain
3. Look for **Render's nameservers** (you'll see 4 of them)

**Example:**
```
ns1.render.com
ns2.render.com
ns3.render.com
ns4.render.com
```

### 4.2 Update GoDaddy Nameservers
1. Go to [godaddy.com](https://godaddy.com) → My Products
2. Click your domain → DNS
3. Find "Nameservers" section → "Change Nameservers"
4. Paste Render's 4 nameservers from Step 4.1
5. Click Save

**⏰ DNS takes 24-48 hours to propagate. Be patient!**

Check status: `nslookup yourdomain.com` in terminal

### 4.3 Verify in Render
1. Back to Render → Custom Domain section
2. Status shows "Connected" when ready ✅
3. Your domain now routes to your app!

---

## ✅ STEP 5: Test Live App (5 minutes)

### 5.1 Visit Your Live Site
Open browser: `https://yourdomain.com` (your actual GoDaddy domain)

You should see: **FBM Operations Hub** login screen

### 5.2 Test Signup Flow
1. Email: `test@example.com`
2. Name: `Test User`
3. Click "Request Access"
4. Message: "Signup request sent. Awaiting admin approval."

### 5.3 Approve First User (Admin)
1. **Login as admin** with email: `parttthh@gmail.com`
   - (Or your admin email)
   - You'll need to approve yourself first in Firestore
2. See admin panel → Approve test user as "Packer"
3. Test user can now login

---

## ✅ STEP 6: Finalize Setup

### 6.1 Update .env (if needed)
```bash
# In your local repo
cp .env.example .env
# Fill in all values (Firebase, Sheets, etc.)
```

### 6.2 Make Changes & Deploy
From now on, any code changes:
```bash
git add .
git commit -m "What changed"
git push origin main
```

**Render auto-deploys in ~30 seconds** ✅

### 6.3 Monitor Usage
- Admin Panel → "Google Cloud Usage"
- Shows spending vs $300 budget
- Should be under $1/month

---

## 📊 Success Metrics

- ✅ App loads at `https://yourdomain.com`
- ✅ Signup/login works
- ✅ Admin can approve users
- ✅ Usage dashboard shows $0 spent
- ✅ `git push` auto-deploys
- ✅ Team can access with their emails

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Domain not found" | Wait 24-48 hours for DNS. Check GoDaddy nameservers are updated. |
| "Firebase initialization failed" | Copy entire JSON (with quotes) from service account key. Include `{` and `}`. |
| "500 error on login" | Check `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_DATABASE_URL` in Render env vars. |
| "Render won't deploy" | Make sure `server.js`, `package.json` exist in repo root. Check GitHub connection. |
| "Google Sheets won't sync" | Verify `GOOGLE_SHEET_ID` is correct in `.env` |

---

## 🎯 Next: Team Onboarding

Once live, share with team:

**📨 Invite Email Template:**
```
Subject: Login to FBM Operations Hub

Hi [Name],

You can now access the FBM Operations Hub at:
👉 https://yourdomain.com

To access:
1. Go to the link above
2. Click "Sign up" 
3. Enter your email + name
4. Wait for approval from the admin

Once approved, you can login and manage operations!

Your role: [Owner/Importer/Packer]

Questions? Contact Parth at parttthh@gmail.com
```

---

## 📞 Support

- **Render issues:** [render.com/docs](https://render.com/docs)
- **Firebase issues:** [firebase.google.com/docs](https://firebase.google.com/docs)
- **Domain issues:** [GoDaddy support](https://www.godaddy.com/help)

---

## ✨ You're Live! 🎉

Your app is now:
- ✅ Running 24/7 on Render (no laptop needed)
- ✅ Accessible via your GoDaddy domain
- ✅ Auto-deploying when you push code
- ✅ Using paid credits efficiently ($300 budget = years of operation)
- ✅ Ready for your team to use

**Share the link with your team and start managing operations!**
