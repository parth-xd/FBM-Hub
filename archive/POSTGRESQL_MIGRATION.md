# PostgreSQL Migration Guide for FBM Hub

## Step 1: Local PostgreSQL Setup (Development)

### 1a. Install PostgreSQL locally
```bash
# Mac - using Homebrew
brew install postgresql
brew services start postgresql

# Verify installation
psql --version
```

### 1b. Create local development database
```bash
# Connect to PostgreSQL
psql postgres

# Inside psql shell, run:
CREATE DATABASE fbm_hub_dev;
CREATE USER fbm_user WITH PASSWORD 'dev-password';
ALTER ROLE fbm_user SET client_encoding TO 'utf8';
ALTER ROLE fbm_user SET default_transaction_isolation TO 'read committed';
ALTER USER fbm_user CREATEDB;
\q
```

### 1c. Create schema locally
```bash
# From your project directory
psql postgres://fbm_user:dev-password@localhost:5432/fbm_hub_dev < schema-postgres.sql
```

### 1d. Update .env for local development
```env
DATABASE_URL=postgresql://fbm_user:dev-password@localhost:5432/fbm_hub_dev
RESEND_API_KEY=your_resend_key
EMAIL_FROM=Babaclick <onboarding@resend.dev>
PORT=3000
NODE_ENV=development
```

## Step 2: Start the PostgreSQL Server

```bash
# Stop the old SQLite server (if running)
# Then start the new PostgreSQL server
npm install  # Install any new dependencies
node server-postgres.js
```

You should see:
```
✅ PostgreSQL Database connected: [timestamp]
🚀 Server running at http://localhost:3000
🔧 Database: PostgreSQL
```

## Step 3: Deploy to Render (Production)

### 3a. Create PostgreSQL on Render
1. Go to [render.com](https://render.com)
2. Click "New +" → "PostgreSQL"
3. Fill in:
   - **Name:** `fbm-hub-db`
   - **Database:** fbm_hub_prod
   - **User:** fbm_user
   - **Region:** (pick closest)
4. Copy the **Internal Database URL** for later

### 3b. Create Web Service on Render
1. Click "New +" → "Web Service"
2. Connect your GitHub repo
3. Set up:
   - **Name:** `fbm-hub-server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server-postgres.js`
4. Add Environment Variables:
   ```
   DATABASE_URL=<paste from PostgreSQL step>
   RESEND_API_KEY=your_key
   EMAIL_FROM=Babaclick <onboarding@resend.dev>
   JWT_SECRET=your-secret-key-here
   NODE_ENV=production
   PUBLIC_URL=https://your-render-domain.onrender.com
   ```
5. Deploy!

### 3c. Initialize database on Render
After deployment, run the schema:
```bash
# From your local terminal
psql <INTERNAL_DATABASE_URL> < schema-postgres.sql

# Or via Render dashboard:
# Go to PostgreSQL → "Connect" → Run SQL
# Then paste contents of schema-postgres.sql
```

## Step 4: Database Visualization Tools

### What you saw: pgAdmin or DBeaver

#### Option 1: **pgAdmin** (Web-based, recommended for production)
- Built-in to most Render PostgreSQL instances
- Access URL: provided in Render dashboard
- Free tier available
- Great for monitoring remote databases

#### Option 2: **DBeaver** (Desktop app, recommended for development)
```bash
# Download from https://dbeaver.io or
brew install dbeaver-community
```
Then connect:
- Host: localhost (or render domain)
- Database: fbm_hub_dev
- User: fbm_user
- Password: dev-password

#### Option 3: **Adminer** (Lightweight web UI)
- Self-hosted web interface
- Minimal setup required
- Good for quick database checks

## Step 5: Update package.json

Change your start script:
```json
{
  "scripts": {
    "start": "node server-postgres.js",
    "start-sqlite": "node server-sqlite.js",
    "dev": "nodemon server-postgres.js"
  }
}
```

Then: `npm start`

## Step 6: Keep SQLite as Fallback (Optional)

Keep `server-sqlite.js` running on alternate port:
```bash
# Terminal 1 - PostgreSQL
node server-postgres.js

# Terminal 2 - SQLite (port 3001)
PORT=3001 node server-sqlite.js
```

## Data Migration from SQLite to PostgreSQL

If you want to migrate existing data:

```bash
# Export from SQLite
sqlite3 fbm_hub.db ".mode csv" ".headers on" \
  "SELECT * FROM orders" > orders-export.csv

# Import to PostgreSQL
psql $DATABASE_URL -c "\COPY orders FROM 'orders-export.csv' WITH CSV HEADER"
```

## Troubleshooting

### Connection refused
```bash
# Check if PostgreSQL is running
brew services list

# Start it
brew services start postgresql
```

### Authentication failed
Double-check your DATABASE_URL format:
```
postgresql://username:password@host:port/database
```

### Tables don't exist
Run the schema:
```bash
psql $DATABASE_URL < schema-postgres.sql
```

### WebSocket issues
Ensure WebSocket is enabled in Render settings (it is by default)

## Key Differences from SQLite

| Feature | SQLite | PostgreSQL |
|---------|--------|-----------|
| Type | File-based | Server-based |
| Async | No | Yes |
| Scaling | Limited | Excellent |
| Concurrent Users | ~10 | 1000+ |
| Backup | Copy file | Native tools |
| Hosting | Anywhere | Managed servers (Render, Heroku) |
| Cost | Free | Free tier available |

## Quick Command Reference

```bash
# Connect to local database
psql postgres://fbm_user:dev-password@localhost:5432/fbm_hub_dev

# View tables
\dt

# View table structure
\d orders

# Check logs
ps aux | grep postgres

# Restart PostgreSQL
brew services restart postgresql

# Stop PostgreSQL
brew services stop postgresql
```
