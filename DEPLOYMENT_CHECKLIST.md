# FBM/FBA Hub - Render Deployment Checklist

## Pre-Deployment (Local)
- [ ] Git repository created on GitHub
- [ ] Code pushed to GitHub (main branch)
- [ ] `.env` file is in `.gitignore`
- [ ] `.env.example` committed (for reference)
- [ ] Local testing passed: `npm start` works
- [ ] Database migrations tested locally

## Render Setup
- [ ] Render account created & GitHub connected
- [ ] PostgreSQL database created
  - [ ] Database URL copied & saved
  - [ ] Database name: `fbm_hub_prod`
  - [ ] Region selected
- [ ] Web service created
  - [ ] GitHub repository connected
  - [ ] Build command: `npm install`
  - [ ] Start command: `npm start`

## Environment Variables Set
- [ ] `NODE_ENV` = `production`
- [ ] `PORT` = `3000`
- [ ] `DATABASE_URL` = (from Render database)
- [ ] `PUBLIC_URL` = `https://fbm-hub-api.render.com`
- [ ] `JWT_SECRET` = (32+ character random string)
- [ ] `RESEND_API_KEY` = (API key from resend.com)
- [ ] `EMAIL_FROM` = `Babaclick <onboarding@resend.dev>`
- [ ] `ADMIN_EMAIL` = your@email.com
- [ ] `OWNER_EMAIL` = owner@email.com

## Post-Deployment
- [ ] Application deployed successfully (logs show "Server running")
- [ ] Database connected (logs show "PostgreSQL Database connected")
- [ ] Visit deployed URL → login page loads
- [ ] Test login with default credentials
- [ ] Send test email (login attempt → should receive magic link)
- [ ] Create a test product in FBA section
- [ ] Test approval workflow end-to-end

## Custom Domain (Optional)
- [ ] Domain registered & accessible
- [ ] DNS records added (Render instructions)
- [ ] `PUBLIC_URL` updated to custom domain
- [ ] SSL certificate auto-provisioned (Render handles this)
- [ ] Domain verified & working

## Team Access
- [ ] Update user credentials or set up team accounts
- [ ] Share deployment URL with team
- [ ] Verify all team members can access
- [ ] Test FBM Operations, INS Stock, FBA sections
- [ ] Verify permissions per role (owner, importer, packer)

## Monitoring Setup
- [ ] Render alerts configured (optional)
- [ ] Bookmark Render dashboard for log checking
- [ ] Document Render database backup location

## Security Verification
- [ ] `JWT_SECRET` is strong & unique
- [ ] No secrets in committed code
- [ ] Email verification working
- [ ] Only approved users can access
- [ ] Change default user credentials

---

## Estimated Setup Time
- GitHub setup: 5 min
- Render database: 10 min (includes wait for provisioning)
- Render web service: 10 min (includes build & deploy)
- Environment variables: 5 min
- Testing: 10 min
- **Total: ~40 minutes**

---

## Quick Deployment Link
Once ready, go to: [Create on Render](https://render.com/docs/deploy-node-express-app)
