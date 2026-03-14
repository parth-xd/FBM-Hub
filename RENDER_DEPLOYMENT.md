# FBM/FBA Hub - Render Deployment Guide

## Overview
This guide walks you through deploying the FBM/FBA Hub to [Render](https://render.com) - a modern hosting platform with built-in PostgreSQL support.

**Cost estimate:** ~$12/month for the application + database (both on free tier to start)

---

## Step 1: Prepare Your GitHub Repository

The easiest way to deploy on Render is to push your code to GitHub.

### Local: Commit your code
```bash
cd /Users/parthsharma/Desktop/babaclick
git init
git add .
git commit -m "Initial FBM/FBA Hub deployment"
git branch -M main
```

### GitHub: Create a new repository
1. Go to [github.com/new](https://github.com/new)
2. Create repo: `fbm-fba-hub` (public or private)
3. **DO NOT** add README/license/gitignore yet

### Local: Push to GitHub
```bash
git remote add origin https://github.com/YOUR_USERNAME/fbm-fba-hub.git
git push -u origin main
```

💡 **Important:** Make sure `.env` is in `.gitignore` (it should be). Never commit secrets!

---

## Step 2: Create Render Account & PostgreSQL Database

### 2a. Sign up for Render
1. Go to [render.com](https://render.com)
2. Sign up with GitHub (easier for deployments)
3. Connect your GitHub account

### 2b. Create PostgreSQL Database
1. Go to **Dashboard** > **New +** > **PostgreSQL**
2. Configuration:
   - **Name:** `fbm-hub-db`
   - **Database:** `fbm_hub_prod`
   - **User:** `postgres`
   - **Region:** Choose closest to you
   - **PostgreSQL Version:** 15
3. Click **Create Database**
4. Wait ~2-3 minutes for creation
5. **IMPORTANT:** Copy the connection string that looks like:
   ```
   postgresql://postgres:XXXX@dpg-XXXX.render.internal:5432/fbm_hub_prod
   ```
   Save this somewhere safe - you'll need it!

---

## Step 3: Deploy Node.js Application

### 3a. Create Web Service
1. Go to **Dashboard** > **New +** > **Web Service**
2. Select **Connect a repository** > your `fbm-fba-hub` repo
3. Configuration:
   - **Name:** `fbm-hub-api`
   - **Region:** Same as database
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Click **Advanced** and add Environment Variables:

### 3b. Add Environment Variables
Click **Add Environment Variable** for each:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | (paste from Step 2b) |
| `PUBLIC_URL` | `https://fbm-hub-api.render.com` |
| `JWT_SECRET` | (generate a random 32+ char string) |
| `RESEND_API_KEY` | Your Resend API key |
| `EMAIL_FROM` | `Babaclick <onboarding@resend.dev>` |
| `ADMIN_EMAIL` | Your email |
| `OWNER_EMAIL` | Your email |

💡 **Generate JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. Click **Deploy Web Service** (this takes 2-3 minutes)

---

## Step 4: Initialize Database Schema

Once deployed, you need to create the database tables.

### 4a. Run Schema Setup
Go to your Render web service > **Shell** tab

Run:
```bash
curl -X GET https://fbm-hub-api.render.com/api/status
```

If you see `{"ok":true,"database":"postgresql"}` → Database is connected ✅

### 4b. Import Database Schema
You have two options:

**Option A: Using Render Shell (easiest)**
1. In the Render Shell, create a file: `schema.sql` with the FBA/FBM table structure
2. Use psql to import it

**Option B: Connect via DBeaver locally**
1. Get the external database URL (from Render dashboard)
2. Use DBeaver to connect and run schema.sql

> For now, let's use the migration approach: when users first log in, the server will create tables automatically if they don't exist (already implemented ✅)

---

## Step 5: Set Up Custom Domain (Optional)

### If you have a custom domain:
1. In Render dashboard > **fbm-hub-api** service > **Settings**
2. Scroll to **Custom Domains**
3. Add your domain (e.g., `fbm.yourcompany.com`)
4. Follow DNS instructions for your domain registrar
5. Update `PUBLIC_URL` environment variable to match

---

## Step 6: Connect from Your Team

### Access the Application
- **URL:** `https://fbm-hub-api.render.com` (or your custom domain)
- Default login: `owner` / `owner123`
- Share the link with your team

### Important: Change Default Passwords
Edit `public/index.html` line ~1020 (DEFAULT_ACCOUNTS) or deploy a user management system.

---

## Step 7: Enable Email Verification (Important!)

The app uses Resend for emails. Set it up:

1. Go to [resend.com](https://resend.com)
2. Create account & get API key
3. Add API key to Render environment variables
4. Update `EMAIL_FROM` to your Resend domain

Users will receive magic links to log in.

---

## Monitoring & Logs

### View application logs:
- Go to Render dashboard > your service > **Logs**
- Real-time streaming of all console output

### Monitor database:
- Render dashboard > your database > **Monitoring** tab

---

## Scaling & Performance Tips

### Free Tier Limits:
- ✅ Web service: 1GB RAM, auto-sleeps after 15 min of inactivity
- ✅ PostgreSQL: 256MB, shared storage
- Good for: 5-10 users

### Upgrade to Paid (~$12/month each):
- Web service: 2GB RAM, always running
- PostgreSQL: 1GB, dedicated
- Better for: 10-50 users

### If hitting limits:
1. Render dashboard > service > **Plan**
2. Click **Upgrade to Paid**

---

## Troubleshooting

### "Database connection refused"
- Check `DATABASE_URL` is exactly from Render dashboard
- Ensure database is in same region as web service

### "Application crashes immediately"
- View logs: Render > Logs tab
- Check environment variables are set correctly
- Verify `npm start` works locally: `npm start`

### "Email not sending"
- Verify `RESEND_API_KEY` is valid
- Check `EMAIL_FROM` matches Resend domain
- View logs for error messages

### "Login page loads but can't log in"
- Check browser console for errors (F12 > Console)
- Check server logs in Render dashboard

---

## Next Steps

1. **Add your team:** Update user credentials in code or set up OAuth
2. **Custom domain:** Point your domain to the Render URL
3. **Backups:** Render auto-backs up PostgreSQL daily
4. **Monitoring:** Set up alerts in Render dashboard for errors

---

## Render Dashboard Quick Links

- [Render Dashboard](https://dashboard.render.com)
- [Create Web Service](https://dashboard.render.com/create?type=web)
- [Create Database](https://dashboard.render.com/create?type=pgsql)
