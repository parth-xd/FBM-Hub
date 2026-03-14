/**
 * Security Middleware & Utilities
 * Implements OWASP best practices for API hardening
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const Joi = require('joi');
const xss = require('xss');

// ═══ RATE LIMITING ═══
// IP-based: General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  },
  keyGenerator: (req) => {
    // Use user email if authenticated, otherwise use IP
    const userEmail = req.headers['x-user-email'];
    return userEmail || req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

// Strict login/auth rate limiting (per IP + email)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts. Please try again after 15 minutes.',
  keyGenerator: (req) => {
    const email = req.body?.email || req.headers['x-user-email'] || 'unknown';
    return `${req.ip}-${email}`;
  },
  skip: (req) => {
    // Only apply to auth endpoints
    return !req.path.includes('/auth/');
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

// Strict file upload rate limiting
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour
  message: 'Too many uploads. Please try again later.',
  skip: (req) => {
    // Only apply to import/upload endpoints
    return !req.path.includes('import') && !req.path.includes('upload');
  },
});

// ═══ SECURITY HEADERS ═══
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Required for Babel inline React
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:', 'wss:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// ═══ INPUT VALIDATION SCHEMAS ═══
const schemas = {
  // Authentication
  emailSchema: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Invalid email format',
      'any.required': 'Email is required',
    }),
  }),

  // Login token
  tokenSchema: Joi.object({
    token: Joi.string().length(64).required().messages({
      'string.length': 'Invalid token format',
    }),
  }),

  // User info
  userSchema: Joi.object({
    role: Joi.string().valid('owner', 'importer', 'packer').required(),
  }),

  // Order creation/update
  orderSchema: Joi.object({
    orderId: Joi.string().trim().max(100).required(),
    productId: Joi.string().trim().max(100),
    quantity: Joi.number().integer().min(0).max(999999),
    price: Joi.number().min(0).max(9999999),
    notes: Joi.string().trim().max(5000),
    // Allow other fields but validate known ones
  }).unknown(true).max(100), // Max 100 fields

  // Cell update
  cellUpdateSchema: Joi.object({
    orderId: Joi.string().trim().max(100).required(),
    column: Joi.string().alphanum().max(50).required(),
    value: Joi.any(), // Allow any value for cells
  }),

  // Bulk operations
  bulkDeleteSchema: Joi.object({
    orderIds: Joi.array()
      .items(Joi.string().trim().max(100))
      .min(1)
      .max(1000)
      .required()
      .messages({
        'array.max': 'Cannot delete more than 1000 items at once',
      }),
  }),

  // FBA Products
  fbaProductSchema: Joi.object({
    sheet_type: Joi.string().valid('mission_control', 'personal_reckon').required(),
    sku: Joi.string().trim().max(100),
    asin: Joi.string().trim().length(10).pattern(/^B[A-Z0-9]{9}$/),
    product_name: Joi.string().trim().max(500),
    supplier_name: Joi.string().trim().max(200),
    supplier_url: Joi.string().uri().max(2000),
    buy_price_ex_vat: Joi.number().min(0).max(99999),
    buy_price_inc_vat: Joi.number().min(0).max(99999),
    buy_box_price: Joi.number().min(0).max(99999),
    profit_per_unit: Joi.number().min(-99999).max(99999),
    roi: Joi.number().min(-999).max(99999),
    continue_discontinue: Joi.string().valid('continue', 'discontinue'),
    // Allow other columns but validate known ones
  }).unknown(true).max(80), // Max 80 fields

  // FBA Approvals
  fbaApprovalSchema: Joi.object({
    asin: Joi.string().trim().length(10).pattern(/^B[A-Z0-9]{9}$/).required(),
    qty: Joi.number().integer().min(1).max(999999).required(),
  }),

  // FBA Approval decision
  approvalDecisionSchema: Joi.object({
    decision: Joi.string().valid('approved', 'rejected').required(),
    rejection_reason: Joi.string().trim().max(500),
  }),

  // FBA Purchase
  purchaseSchema: Joi.object({
    stb_id: Joi.string().trim().max(50).required(),
    supplier_order_ref: Joi.string().trim().max(200).required(),
    verified_total: Joi.number().min(0).max(9999999).required(),
  }),

  // Query parameters
  querySchema: Joi.object({
    limit: Joi.number().integer().min(1).max(10000).default(100),
    offset: Joi.number().integer().min(0).max(1000000).default(0),
    sheet_type: Joi.string().alphanum().max(50),
    owner: Joi.string().email(),
    status: Joi.string().alphanum().max(50),
    filter: Joi.string().trim().max(500),
  }).unknown(true),
};

// ═══ SANITIZATION ═══
/**
 * Sanitize user input to prevent XSS attacks
 */
const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return xss(input.trim());
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        sanitized[key] = xss(value.trim());
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeInput(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  return input;
};

/**
 * Middleware to sanitize request body
 */
const sanitizationMiddleware = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeInput(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeInput(req.query);
  }
  next();
};

// ═══ VALIDATION MIDDLEWARE ═══
/**
 * Validate request body against schema
 */
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const messages = error.details.map(d => `${d.path.join('.')}: ${d.message}`);
      return res.status(400).json({
        error: 'Invalid request data',
        details: messages,
      });
    }

    req.body = value;
    next();
  };
};

/**
 * Validate query parameters
 */
const validateQuery = (req, res, next) => {
  const { error, value } = schemas.querySchema.validate(req.query);

  if (error) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      details: error.details.map(d => d.message),
    });
  }

  req.query = value;
  next();
};

// ═══ REQUEST SIZE LIMITS ═══
const requestSizeLimits = {
  json: { limit: '10mb' },
  urlencoded: { limit: '10mb' },
};

// ═══ SECURITY HEADERS MIDDLEWARE ═══
/**
 * Additional security headers beyond Helmet
 */
const customSecurityHeaders = (req, res, next) => {
  // Prevent information disclosure
  res.removeHeader('X-Powered-By');
  
  // API Security
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Prevent caching of sensitive data
  if (req.path.includes('/api/')) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
};

// ═══ AUTHENTICATION MIDDLEWARE ═══
/**
 * Verify JWT token from header
 */
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No authorization token' });
  }

  try {
    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'dev-secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Verify user email from request headers (for API key-like auth)
 */
const verifyUserHeader = (req, res, next) => {
  const email = req.headers['x-user-email'];
  const role = req.headers['x-user-role'];

  if (!email || !role) {
    return res.status(401).json({ error: 'Missing authentication headers' });
  }

  // Validate email format
  if (!email.includes('@') || email.length > 254) {
    return res.status(401).json({ error: 'Invalid email format' });
  }

  req.user = { email, role };
  next();
};

// ═══ PERMISSION MIDDLEWARE ═══
/**
 * Check if user has owner role
 */
const requireOwner = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' });
  }
  next();
};

/**
 * Check if user has importer role or higher
 */
const requireImporter = (req, res, next) => {
  if (!req.user || (req.user.role !== 'importer' && req.user.role !== 'owner')) {
    return res.status(403).json({ error: 'Importer role required' });
  }
  next();
};

// ═══ ERROR HANDLING ═══
/**
 * Global error handler (doesn't leak sensitive info)
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', {
    message: err.message,
    path: req.path,
    method: req.method,
    user: req.user?.email,
    timestamp: new Date().toISOString(),
  });

  // Production: don't leak stack traces
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      error: 'Internal server error',
      requestId: req.id, // For debugging support tickets
    });
  }

  // Development: include error details
  res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
};

module.exports = {
  // Rate limiting
  apiLimiter,
  authLimiter,
  uploadLimiter,
  
  // Security headers
  helmetConfig,
  customSecurityHeaders,
  requestSizeLimits,
  
  // Validation & sanitization
  schemas,
  validateRequest,
  validateQuery,
  sanitizationMiddleware,
  sanitizeInput,
  
  // Authentication
  verifyJWT,
  verifyUserHeader,
  requireOwner,
  requireImporter,
  
  // Error handling
  errorHandler,
};
