# Project Structure

```
babaclick-web/
├── server/                          # Express backend
│   ├── models/
│   │   └── User.js                 # User database schema
│   ├── controllers/
│   │   ├── authController.js       # Auth logic
│   │   ├── adminController.js      # Admin approval logic
│   │   └── sheetsController.js     # Google Sheets integration
│   ├── routes/
│   │   ├── authRoutes.js           # Auth endpoints
│   │   ├── adminRoutes.js          # Admin endpoints
│   │   └── sheetsRoutes.js         # Google Sheets endpoints
│   ├── middleware/
│   │   └── auth.js                 # JWT authentication
│   ├── utils/
│   │   ├── emailService.js         # Email sending logic
│   │   └── tokenUtils.js           # JWT utilities
│   ├── package.json
│   └── index.js                    # Server entry point
│
├── client/                          # React frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── AuthPage.jsx        # Login/Register
│   │   │   ├── AuthPage.css
│   │   │   ├── Dashboard.jsx       # User dashboard
│   │   │   ├── Dashboard.css
│   │   │   ├── AdminPanel.jsx      # Admin approval panel
│   │   │   └── AdminPanel.css
│   │   ├── AuthContext.jsx         # Auth state management
│   │   ├── App.jsx                 # Main app component
│   │   ├── App.css
│   │   ├── index.js                # React entry point
│   │   └── index.css
│   ├── public/
│   │   └── index.html
│   └── package.json
│
├── .env.example                    # Environment template
├── .gitignore
├── package.json                    # Root package.json
├── README.md                       # Main documentation
├── DEPLOYMENT.md                   # Deployment guide
├── Procfile                        # Heroku/Render config
├── render.yaml                     # Render deployment
├── vercel.json                     # Vercel config
└── setup.sh                        # Setup script
```

## Key Features Implemented

### 🔐 Email Authentication
- User registration with email verification
- Login with email and password
- Password hashing with bcryptjs
- JWT token-based sessions

### ✅ Admin Approval System
- New users pending admin approval
- Admin dashboard to approve/reject users
- Email notifications on approval/rejection
- User role-based access control

### 📊 Google Sheets Integration
- Read data from Google Sheets
- Update rows in Google Sheets
- API key-based authentication
- Protected endpoints (admin-only)

### 🎨 React Frontend
- Authentication pages (Login/Register)
- User dashboard
- Admin panel for approvals
- Responsive design
- Context API for state management

### 🚀 Deployment Ready
- Render.yaml for Render deployment
- Procfile for Heroku
- Vercel.json configuration
- Environment variable management
- MongoDB Atlas support

## File Descriptions

### Backend Files

**User.js** - MongoDB schema with:
- Email and password fields
- Role-based access (user/admin)
- Email verification tracking
- Approval status
- Automatic password hashing

**authController.js** - Authentication logic:
- User registration
- Email verification
- Login with credentials
- JWT token generation

**adminController.js** - Admin functions:
- Get pending user approvals
- Approve users (send email)
- Reject users (send email and delete)

**sheetsController.js** - Google Sheets:
- Fetch data from sheets
- Update sheet rows
- Error handling

**auth.js Middleware** - Security:
- JWT verification
- User authentication
- Role-based authorization

**emailService.js** - Email utilities:
- Verification emails
- Approval notifications
- Rejection notifications
- Admin notifications

### Frontend Files

**AuthContext.jsx** - State management:
- User authentication state
- Register function
- Login function
- Logout function
- Email verification

**AuthPage.jsx** - Auth components:
- Login page with form
- Register page with validation
- Error and success messages

**Dashboard.jsx** - User interface:
- Welcome message
- Google Sheets data display
- User profile info
- Logout button

**AdminPanel.jsx** - Admin interface:
- List pending users
- Approve button for each user
- Reject button for each user
- Real-time updates

**App.jsx** - Main app:
- React Router setup
- Protected route component
- Authentication check
- Navigation routing

## Configuration Files

**package.json** (Root) - Project metadata:
- Dev script for concurrent running
- Build scripts
- Shared dependencies (concurrently, nodemon)

**server/package.json** - Server dependencies:
- Express, MongoDB, JWT
- Email (Nodemailer)
- Google Sheets API

**client/package.json** - Client dependencies:
- React, React Router
- Axios for API calls
- React Scripts (Create React App)

**.env.example** - Template for:
- Server port configuration
- Email credentials
- Database connection
- JWT secret
- Google Sheets API
- Admin email

**DEPLOYMENT.md** - Complete guide for:
- Local development setup
- MongoDB configuration
- Gmail setup
- Google Sheets API
- Render deployment steps
- Troubleshooting

**Procfile** - Runtime configuration:
- Start command for Heroku/Render

**render.yaml** - Render service:
- Build and start commands
- Environment variable setup
- Service configuration

## Security Features

1. **Password Security** - Hashed with bcryptjs
2. **JWT Authentication** - Token-based sessions
3. **Email Verification** - Required before login
4. **Admin Approval** - Additional access control
5. **Role-Based Access** - Different permissions per role
6. **CORS Protection** - Limited origins
7. **Input Validation** - Express-validator
8. **Environment Variables** - Secret key management

## Running the Project

### Development Mode
```bash
npm run dev
```
Runs both server and client with hot reload

### Server Only
```bash
npm run server:dev
```

### Client Only
```bash
npm run client:dev
```

### Production Build
```bash
npm run build
npm start
```

## API Response Examples

### Register Success
```json
{
  "message": "Registration successful",
  "userId": "507f1f77bcf86cd799439011"
}
```

### Login Success
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "role": "user",
    "isApproved": true
  }
}
```

### Pending Approvals
```json
{
  "message": "Pending approvals retrieved",
  "users": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "email": "newuser@example.com",
      "role": "user",
      "isApproved": false
    }
  ]
}
```

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `500` - Server error

## Environment Variables Explained

| Variable | Purpose | Example |
|----------|---------|---------|
| SERVER_PORT | Express server port | 5000 |
| MONGODB_URI | Database connection | mongodb+srv://user:pass@cluster.mongodb.net/db |
| JWT_SECRET | Token signing key | min32characterslong |
| EMAIL_USER | Gmail address | user@gmail.com |
| EMAIL_PASSWORD | Gmail app password | xxxx xxxx xxxx xxxx |
| GOOGLE_SHEETS_ID | Spreadsheet ID | 1BW8rTM8R9-... |
| GOOGLE_SHEETS_API_KEY | Google API key | AIzaSy... |
| ADMIN_EMAIL | Admin email for notifications | admin@babaclick.com |
| REACT_APP_API_URL | Backend API URL | http://localhost:5000 |
