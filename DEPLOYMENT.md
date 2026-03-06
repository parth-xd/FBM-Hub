# Deployment Guide - Babaclick FBM Operations Hub

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- npm or yarn
- MongoDB (local or MongoDB Atlas)
- Gmail account with app password
- Google Sheets API credentials
- Git

### Step 1: Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd babaclick-web

# Install dependencies
npm install
npm install --prefix server
npm install --prefix client
```

### Step 2: Configure Environment Variables

```bash
# Copy example file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

**Required Environment Variables:**

```
# Server
SERVER_PORT=5000
NODE_ENV=development

# Email (Gmail)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/babaclick

# JWT
JWT_SECRET=your-secret-key-min-32-characters-long

# Google Sheets
GOOGLE_SHEETS_ID=your-spreadsheet-id
GOOGLE_SHEETS_API_KEY=your-google-api-key

# Admin
ADMIN_EMAIL=admin@babaclick.com

# Frontend
REACT_APP_API_URL=http://localhost:5000
```

### Step 3: Set Up MongoDB

**Option A: MongoDB Atlas (Cloud)**
1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free account
3. Create a new cluster
4. Get connection string and update `MONGODB_URI` in `.env`

**Option B: Local MongoDB**
```bash
# Install MongoDB (macOS)
brew tap mongodb/brew
brew install mongodb-community

# Start MongoDB
brew services start mongodb-community

# Verify (should return version)
mongosh --version
```

### Step 4: Gmail App Password Setup

1. Enable 2-Factor Authentication on your Gmail account
2. Go to https://myaccount.google.com/apppasswords
3. Select "Mail" and "Windows Computer" (or your OS)
4. Copy the 16-character password
5. Add to `.env` as `EMAIL_PASSWORD`

### Step 5: Google Sheets API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Google Sheets API and Google Drive API
4. Create OAuth 2.0 credentials (API Key)
5. Copy the API key to `.env` as `GOOGLE_SHEETS_API_KEY`
6. Create a Google Sheet and copy its ID to `.env` as `GOOGLE_SHEETS_ID`

### Step 6: Run in Development

```bash
# Run both server and client (from root directory)
npm run dev

# Or run separately in different terminals
npm run server:dev
npm run client:dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:5000

## Production Deployment on Render

### Step 1: Create Render Account

1. Go to https://render.com
2. Sign up with GitHub account
3. Authorize Render to access your repositories

### Step 2: Create Web Service

1. In Render dashboard, click "New +"
2. Select "Web Service"
3. Connect your GitHub repository
4. Configure Build and Start:
   - **Name:** babaclick-fbm-hub
   - **Build Command:** `npm install && npm run build && npm install --prefix client && npm run client:build`
   - **Start Command:** `npm start`

### Step 3: Set Environment Variables

In Render dashboard, add these variables:

```
NODE_ENV=production
SERVER_PORT=5000
MONGODB_URI=<your-atlas-connection-string>
JWT_SECRET=<generate-a-long-random-string>
EMAIL_USER=<your-gmail>
EMAIL_PASSWORD=<your-app-password>
EMAIL_SERVICE=gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
GOOGLE_SHEETS_ID=<your-sheet-id>
GOOGLE_SHEETS_API_KEY=<your-api-key>
ADMIN_EMAIL=<admin-email>
REACT_APP_API_URL=<your-render-domain>
```

### Step 4: Deploy

1. Click "Create Web Service"
2. Render automatically deploys on every push to main branch
3. Check deployment status in "Logs"
4. Once deployed, your app is live at the provided URL

### Step 5: Configure Custom Domain (Optional)

1. Go to Settings > Custom Domain
2. Enter your domain (e.g., babaclick-hub.com)
3. Update DNS records according to Render instructions
4. Wait for SSL certificate (automatic via Let's Encrypt)

## Database Schema

### User Collection

```javascript
{
  _id: ObjectId,
  email: String (unique),
  password: String (hashed),
  role: 'user' | 'admin' (default: 'user'),
  isApproved: Boolean (default: false),
  emailVerified: Boolean (default: false),
  verificationToken: String,
  verificationTokenExpiry: Date,
  createdAt: Date,
  updatedAt: Date
}
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/logout` - Logout

### Admin
- `GET /api/admin/pending-approvals` - List pending users
- `POST /api/admin/approve/:userId` - Approve user
- `POST /api/admin/reject/:userId` - Reject user

### Google Sheets
- `GET /api/sheets/data` - Get sheet data
- `POST /api/sheets/update` - Update sheet row

## Monitoring and Logs

### Render Logs
1. Go to Render dashboard
2. Select your service
3. Click "Logs" tab
4. Real-time logs appear automatically

### Local Testing
```bash
# Check server health
curl http://localhost:5000/api/health

# Check error logs
tail ~/.npm/_logs/<latest-log-file>
```

## Troubleshooting

### MongoDB Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
**Solution:**
- Verify MongoDB is running: `brew services list`
- Check connection string in `.env`
- Ensure IP whitelist in MongoDB Atlas includes your IP

### Email Not Sending
```
Error: connect ECONNREFUSED 587
```
**Solution:**
- Verify Gmail app password (not regular password)
- Enable "Less secure apps" if using older Gmail
- Check EMAIL_USER and EMAIL_PASSWORD in `.env`

### CORS Errors
```
Access to XMLHttpRequest blocked by CORS policy
```
**Solution:**
- Update `REACT_APP_API_URL` in frontend `.env`
- Verify backend CORS configuration in `server/index.js`

### Port Already in Use
```bash
# macOS/Linux
lsof -i :5000
kill -9 <PID>

# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

## Scaling and Performance

### Database Optimization
```javascript
// Create indexes in MongoDB Atlas
db.users.createIndex({ email: 1 })
db.users.createIndex({ createdAt: 1 })
```

### Environment-Specific Settings
- **Development:** Verbose logging, hot reload
- **Production:** Error monitoring, authentication caching

## Security Checklist

- [ ] JWT_SECRET is long and random (32+ characters)
- [ ] MONGODB_URI uses authentication
- [ ] EMAIL credentials from app password (not main password)
- [ ] CORS only allows trusted domains
- [ ] Sensitive data in `.env`, not in code
- [ ] HTTPS enabled on production
- [ ] Rate limiting configured (recommended)

## Support & Documentation

- [Express.js Docs](https://expressjs.com/)
- [React Docs](https://react.dev/)
- [MongoDB Docs](https://docs.mongodb.com/)
- [Render Docs](https://render.com/docs)
- [Google Sheets API](https://developers.google.com/sheets/api)

## Next Steps

1. Test registration and email verification locally
2. Test admin approval workflow
3. Test Google Sheets data sync
4. Deploy to Render staging environment
5. Monitor logs and performance
6. Set up automated backups for MongoDB
7. Configure error monitoring (Sentry, etc.)
