# 🎯 Render Deployment - Step-by-Step for You

Your repo is already pushed to GitHub: `https://github.com/parth-xd/FBM-Hub`

Follow these steps to go live!

---

## Step 1: Create Render Account (1 min)

1. Go to [render.com](https://render.com)
2. Click **Sign Up**
3. Choose **Continue with GitHub** (easiest)
4. Authorize Render to access your GitHub account
5. Dashboard loads → ready to deploy

---

## Step 2: Create PostgreSQL Database (5 min)

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New +** (top right)
3. Select **PostgreSQL**
4. Fill in:
   - **Name:** `fbm-hub-db` (or any name you want)
   - **Database:** `fbm_hub_prod`
   - **User:** `postgres`
   - **Password:** (Render generates one)
   - **Region:** Choose one near you (e.g., `us-east`)
   - **PostgreSQL Version:** 15
5. Click **Create Database**
6. **Wait 2-3 minutes** for provisioning...

### ⚠️ IMPORTANT: Save Your Database URL
Once ready, you'll see a green checkmark and a connection string like:
```
postgresql://postgres:XXXX@dpg-XXXX.render.internal:5432/fbm_hub_prod
```

**Copy this entire string** and save it in a text file. You'll need it in Step 3.

---

## Step 3: Deploy Your App (5 min)

1. Back on Render dashboard, click **New +**
2. Select **Web Service**
3. Click **Connect a repository**
4. Find & select `FBM-Hub` repo
5. Fill in:
   - **Name:** `fbm-hub-api`
   - **Region:** Same as your database (e.g., `us-east`)
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. Scroll down to **Advanced** section
7. Click **Add Environment Variable** multiple times and add:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | (paste the connection string from Step 2) |
| `PUBLIC_URL` | `https://fbm-hub-api.render.com` |
| `JWT_SECRET` | (paste a 32-character random string - see below) |
| `RESEND_API_KEY` | (get from resend.com - see below) |
| `EMAIL_FROM` | `Babaclick <onboarding@resend.dev>` |
| `ADMIN_EMAIL` | your@email.com |
| `OWNER_EMAIL` | your@email.com |

### Generate JWT_SECRET
Open Terminal and run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output and paste into `JWT_SECRET`

### Get Resend API Key
1. Go to [resend.com](https://resend.com)
2. Sign up (free)
3. Go to **API Keys**
4. Create new API key
5. Copy and paste into `RESEND_API_KEY`

8. Click **Create Web Service**
9. **Wait 2-3 minutes** for build and deployment

---

## Step 4: Verify It's Working (2 min)

1. Render dashboard → click **fbm-hub-api** service
2. Wait until you see **Last Deploy Status: Success** ✅
3. Click the URL at the top (should be `fbm-hub-api.render.com`)
4. You should see the FBM Hub login page!

### Test Login
- **Username:** `owner`
- **Password:** `owner123`
- Click the FBA tab to verify the full app works

---

## Step 5: Share with Your Team

The app is now live! Share the URL:
```
https://fbm-hub-api.render.com
```

Team members can:
1. Visit the URL
2. Enter their email
3. Receive magic link to log in
4. Use the app!

---

## Step 6: Setup Custom Domain (Optional but Recommended)

If you own a domain like `fbm.yourcompany.com`:

1. Render dashboard → **fbm-hub-api** service
2. **Settings** (scroll down)
3. **Custom Domains** → Add domain
4. Enter your domain (e.g., `fbm.yourcompany.com`)
5. Render shows DNS records to add
6. Go to your domain registrar (Namecheap, GoDaddy, etc.)
7. Add those DNS records
8. Wait 5-15 minutes for DNS to propagate
9. Back in Render → **Settings** → update `PUBLIC_URL` to your custom domain

---

## Common Issues & Fixes

### "Can't connect to database"
- **Check:** Is `DATABASE_URL` exactly pasted correctly?
- **Verify:** Database is marked green/ready in Render dashboard
- **Fix:** Delete service, recreate with correct URL

### "Application won't start"
- Go to **Logs** tab
- Read error message
- Check if all env vars are set
- Most common: missing `DATABASE_URL` or wrong value

### "Login page loads but can't sign in"
- Check browser console (F12 → Console tab)
- May need to wait 30 seconds for cache clear
- Try incognito/private window

### "Email not sending"
- Verify `RESEND_API_KEY` is correct
- Verify `EMAIL_FROM` is from Resend domain
- Check Render logs for errors

---

## Monitoring Your Deployment

### View Logs (real-time)
1. Render dashboard → **fbm-hub-api**
2. **Logs** tab
3. See all server messages in real-time

### Check if app is running
1. Visit the app URL
2. If app sleeps after 15 min on free tier (normal)
3. Just visit again, it wakes up automatically

### Monitor database
1. Render dashboard → **fbm-hub-db**
2. **Monitoring** tab

---

## Upgrading Later

**Free tier limitations:**
- Web service sleeps after 15 min of inactivity
- Database: 256MB (enough for ~50k products)

**To upgrade to paid (~$12/month):**
1. Each service → **Plan**
2. Click **Upgrade to Paid**
3. No downtime!

---

## Next Steps

1. ✅ Database created
2. ✅ App deployed
3. ✅ Custom domain (optional)
4. ⏭️ **Update user credentials** (currently uses demo accounts)
5. ⏭️ **Train team** on using FBM/FBA sections
6. ⏭️ **Set up backups** (Render does this automatically)

---

## Support & Troubleshooting

**Need help?** Check:
1. This guide (top to bottom)
2. [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md) (detailed guide)
3. [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) (verify everything)
4. Render docs: [render.com/docs](https://render.com/docs)

---

## 🎉 You're Live!

Your FBM/FBA Hub is now ready for your team to use. Share the link and monitor the logs to ensure everything runs smoothly.

Good luck! 🚀
