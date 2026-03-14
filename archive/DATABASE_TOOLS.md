# Database Visualization Tools Guide

## What You Saw: Likely pgAdmin or DBeaver

When your friend showed you their tables, they were probably using one of these tools:

---

## 1. **pgAdmin** (Most Likely for Web Apps) ✅

### What is it?
- Free, web-based PostgreSQL management tool
- Built into most hosted PostgreSQL services (Render, Heroku, etc.)
- Looks like a professional admin panel in your browser

### Features
- 🔍 View/edit tables in GUI
- 📊 Visual query builder
- 📈 Performance monitoring
- 🔐 User/permission management
- 💾 Backup/restore

### Access on Render
1. Go to your Render PostgreSQL instance
2. Click "Connect" button
3. Select "pgAdmin" tab
4. Opens in new browser tab
5. View all your databases visually

### Local Installation
```bash
# Using Docker (easiest)
docker run -p 5050:80 -e PGADMIN_DEFAULT_EMAIL=you@example.com \
  -e PGADMIN_DEFAULT_PASSWORD=password dpage/pgadmin4

# Then visit http://localhost:5050
# Register your local PostgreSQL server there
```

---

## 2. **DBeaver** (Best for Power Users)

### What is it?
- Free desktop app (like VS Code for databases)
- Supports 80+ database types
- Available for Mac, Windows, Linux

### Features
- 📋 Full table editor
- 🔧 Schema designer
- 📊 Query debugger
- 🎨 ERD (Entity-Relationship Diagram)
- 📁 Database comparison & sync
- 💻 SSH tunneling support

### Download
- https://dbeaver.io
- Or: `brew install dbeaver-community`

### Connect to Your Database
1. Open DBeaver
2. Right-click "Database" → "New Database Connection"
3. Select "PostgreSQL"
4. Configure:
   - **Host:** `localhost` (or `your-render-domain.onrender.com`)
   - **Database:** `fbm_hub_dev`
   - **User:** `fbm_user`
   - **Password:** `dev-password`
5. Click "Test Connection"
6. Explore your tables! 🎉

---

## 3. **Adminer** (Lightweight Option)

### What is it?
- Single PHP file database manager
- Minimal setup required
- Runs anywhere

### Deploy
```bash
# Create adminer.php in public folder
# Then access: http://localhost:3000/adminer.php
```

### Connect
- System: PostgreSQL
- Server: localhost
- Username: fbm_user
- Password: dev-password
- Database: fbm_hub_dev

---

## 4. **Metabase** (Dashboard & Analytics)

### What is it?
- Beautiful business intelligence tool
- Self-hosted or cloud
- Great for dashboards and reports

### Use Case
- See order statistics visually
- Create custom reports
- Share dashboards with team

---

## 5. **TablePlus** (Mac Only - Super Slick)

### What is it?
- Native macOS database client
- Beautiful UI, very smooth
- Paid ($69) but worth it for professionals

### Features
- ⚡ Super fast
- 🎨 Beautiful interface
- 🔄 Real-time collaboration
- 💾 Version history

---

## Quick Comparison

| Tool | Platform | Price | Best For | Setup |
|------|----------|-------|----------|-------|
| **pgAdmin** | Web | Free | Production, remote | Built-in |
| **DBeaver** | Desktop | Free | Development, power users | Download |
| **Adminer** | Web | Free | Quick checks, lightweight | Single file |
| **Metabase** | Web | Free/Paid | Dashboards, analytics | Docker |
| **TablePlus** | macOS | $69 | Mac users, professionals | Download |

---

## For Your Setup: Recommendation

### Development (Local)
- **Use:** DBeaver
- **Why:** Best local experience, powerful features

### Production (Render)
- **Use:** pgAdmin
- **Why:** Built-in, secure, no extra setup

### Quick Checks
- **Use:** pgAdmin or Adminer
- **Why:** Fast, no download needed

---

## Your Database Structure in GUI

When you open DBeaver or pgAdmin, you'll see:

```
fbm_hub_dev/
├── Tables/
│   ├── users
│   │   ├── id (PRIMARY KEY)
│   │   ├── email (UNIQUE)
│   │   ├── password_hash
│   │   ├── role (owner, importer, viewer)
│   │   └── approved (BOOLEAN)
│   │
│   ├── orders
│   │   ├── id (PRIMARY KEY)
│   │   ├── order_id (UNIQUE)
│   │   ├── sku
│   │   ├── qty
│   │   ├── status
│   │   ├── carrier
│   │   └── ... (more fields)
│   │
│   ├── audit_logs
│   │   ├── id (PRIMARY KEY)
│   │   ├── order_id (FOREIGN KEY)
│   │   ├── user_email
│   │   ├── action
│   │   └── changed_at
│   │
│   └── import_tracking
│       ├── id (PRIMARY KEY)
│       ├── import_id
│       ├── imported_by
│       └── status
│
├── Indexes/
├── Views/
└── Functions/
```

---

## Next Steps

1. **Local Development:** Install DBeaver + PostgreSQL
2. **Production:** Use Render's pgAdmin
3. **Team Sharing:** Set up pgAdmin or Metabase for team access

All of these let you:
- View all tables visually ✅
- Edit data directly ✅
- Run custom SQL queries ✅
- Monitor performance ✅
- Create backups ✅

---

## Pro Tips

### Run SQL Queries Directly
```sql
-- In any tool, you can run:
SELECT * FROM orders WHERE status = 'exception';

-- Get statistics
SELECT COUNT(*) as total_orders FROM orders;
SELECT status, COUNT(*) as count FROM orders GROUP BY status;

-- Find duplicates
SELECT order_id, COUNT(*) FROM orders GROUP BY order_id HAVING COUNT(*) > 1;
```

### Export Data
Most tools let you export as CSV, Excel, JSON, SQL...

### Monitor Performance
PostgreSQL has built-in performance monitoring - all tools can show you slow queries

### User Permissions
With pgAdmin, control who can access what tables
