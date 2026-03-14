# 🚀 Deploy to Render in 5 Minutes

This is a **quick reference** for deploying the FBM/FBA Hub. For detailed steps, see [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md).

## Prerequisites
- GitHub account (to host code)
- Render account (free, sign up with GitHub)
- Resend account (free, for emails)
- A domain (optional, can use Render's free subdomain)

## One-Time Setup

### 1. Push to GitHub (3 min)
```bash
cd /Users/parthsharma/Desktop/babaclick

# If not already a git repo:
git init

# Commit everything except .env
git add .
git commit -m "Initial FBM/FBA Hub deployment"
git branch -M main

# Create new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/fbm-fba-hub.git
git push -u origin main
```

### 2. Create Render PostgreSQL (2 min)
1. Go to [render.com/dashboard](https://render.com/dashboard)
2. **New +** → **PostgreSQL**
3. Name: `fbm-hub-db`
4. Database: `fbm_hub_prod`
5. Create
6. **Copy the connection string** (save it!)

### 3. Deploy to Render (5 min)
1. **New +** → **Web Service**
2. Select your GitHub repo
3. Name: `fbm-hub-api`
4. Build: `npm install`
5. Start: `npm start`
6. Click **Advanced** and add these environment variables:

| Key | Value |
|-----|-------|
| `NODE_ENV` | production |
| `DATABASE_URL` | (paste from step 2) |
| `PUBLIC_URL` | `https://fbm-hub-api.render.com` |
| `JWT_SECRET` | `$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")` |
| `RESEND_API_KEY` | (from resend.com) |
| `EMAIL_FROM` | `Babaclick <onboarding@resend.dev>` |
| `ADMIN_EMAIL` | your@email.com |
| `OWNER_EMAIL` | your@email.com |

7. **Deploy Web Service**
8. Wait 2-3 minutes for build & deploy ✅

---

## Verify Deployment

Visit: `https://fbm-hub-api.render.com`

You should see the login page. Default login:
- **Username:** `owner`
- **Password:** `owner123`

🎉 **You're live!** Share the URL with your team.

---

## Custom Domain (Optional)

If you have a domain like `fbm.yourcompany.com`:

1. In Render dashboard → your service → **Settings**
2. **Custom Domains** → Add domain
3. Follow DNS instructions
4. Update `PUBLIC_URL` env var to your domain

---

## Troubleshooting

**App crashes on startup?**
- Check Render logs: Dashboard → Logs tab
- Common: `DATABASE_URL` is wrong, verify copy-paste

**Can't log in?**
- Check browser console (F12 → Console)
- Verify env vars are set

**Email not sending?**
- Verify `RESEND_API_KEY` is valid
- Check email address in resend domain

---

## Next Steps

1. **User management:** Update DEFAULT_ACCOUNTS in `public/index.html` line ~1020
2. **Custom domain:** See section above
3. **Backups:** Render auto-backs up PostgreSQL daily ✅
4. **Team access:** Share URL, users sign up via email

---

For detailed instructions, see: [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md)
