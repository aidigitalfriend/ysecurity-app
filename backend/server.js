const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const winston = require('winston');
const compression = require('compression');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? 'https://ysecurity.app' : 'http://localhost:3000'),
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Winston logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ysecurity-app-backend' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

const PORT = process.env.PORT || 4000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.socket.io"],
      scriptSrc: ["'self'", "https://unpkg.com", "https://cdn.socket.io", "https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "wss:", "ws:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Logging
app.use(morgan('combined', {
  stream: fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' })
}));

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? 'https://ysecurity.app' : 'http://localhost:3000'),
  credentials: true
}));
// Stripe webhook needs raw body for signature verification - must be before bodyParser.json
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || webhookSecret === 'whsec_replace_after_creating_webhook') {
    logger.error('Stripe webhook secret not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        logger.info(`Checkout completed: ${session.id}`);

        // Update member payment status
        const result = await pool.query(
          'SELECT member_id, email, payment_status FROM members WHERE stripe_session_id = $1',
          [session.id]
        );

        if (result.rows.length > 0 && result.rows[0].payment_status !== 'completed') {
          const member = result.rows[0];
          await pool.query(
            'UPDATE members SET payment_status = $1, stripe_payment_id = $2 WHERE stripe_session_id = $3',
            ['completed', session.payment_intent, session.id]
          );

          // Send Member ID email
          try {
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: member.email,
              subject: 'Your Ysecurity Member ID',
              html: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
                  <h2 style="color:#1a73e8;">🛡️ Welcome to Ysecurity!</h2>
                  <p>Your membership is now active. Here is your Member ID:</p>
                  <div style="background:#f8f9fa;padding:20px;border-radius:8px;margin:20px 0;text-align:center;">
                    <p style="margin:0 0 8px;font-size:0.9rem;color:#5f6368;"><strong>Your Member ID</strong></p>
                    <p style="font-size:2rem;font-weight:bold;color:#1a73e8;margin:0;font-family:monospace;letter-spacing:2px;">${member.member_id}</p>
                  </div>
                  <p style="color:#ea4335;"><strong>⚠️ Important:</strong> Save your Member ID securely! It cannot be recovered if lost.</p>
                  <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:20px 0;">
                    <p style="margin:0 0 8px;font-weight:600;">📲 Next Steps:</p>
                    <ol style="margin:0;padding-left:20px;color:#555;line-height:1.8;">
                      <li>Download the <strong>Ysecurity</strong> app on your device</li>
                      <li>Open the app and enter your <strong>Member ID</strong></li>
                      <li>Protection installs and stays dormant until needed</li>
                    </ol>
                  </div>
                  <hr style="border:none;border-top:1px solid #e8eaed;margin:24px 0;">
                  <p style="color:#5f6368;font-size:0.8rem;">Ysecurity - Smart Device Security<br>https://ysecurity.app</p>
                </div>
              `
            };
            transporter.sendMail(mailOptions);
          } catch (emailErr) {
            logger.error('Webhook: Failed to send Member ID email:', emailErr);
          }

          logger.info(`Member ${member.member_id} payment completed via webhook`);
        }
        break;
      }

      case 'payment_intent.succeeded':
        logger.info(`PaymentIntent succeeded: ${event.data.object.id}`);
        break;

      case 'payment_intent.payment_failed':
        logger.warn(`PaymentIntent failed: ${event.data.object.id}`);
        break;

      default:
        logger.info(`Unhandled webhook event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

const { body, param, validationResult } = require('express-validator');
const Joi = require('joi');

// Input validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

// Validation schemas
const deviceRegistrationSchema = Joi.object({
  deviceId: Joi.string().required().min(10).max(100),
  model: Joi.string().required().min(1).max(100),
  os: Joi.string().required().min(1).max(100),
  licenseKey: Joi.string().required().min(10).max(50)
});

const locationPingSchema = Joi.object({
  lat: Joi.number().required().min(-90).max(90),
  lng: Joi.number().required().min(-180).max(180),
  accuracy: Joi.number().required().min(0),
  battery: Joi.number().required().min(0).max(100),
  networkType: Joi.string().valid('wifi', 'cellular', 'none', 'unknown').required(),
  alert: Joi.string().optional()
});

// PostgreSQL database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create devices table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        os TEXT NOT NULL,
        owner TEXT,
        member_id TEXT,
        status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'reported', 'verified', 'active', 'recovered')),
        license_key TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add member_id column if not exists (migration)
    await pool.query(`
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS member_id TEXT
    `).catch(() => {});

    // Create location_pings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS location_pings (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        latitude DECIMAL(10,8) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
        longitude DECIMAL(11,8) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
        accuracy DECIMAL(10,2) NOT NULL CHECK (accuracy >= 0),
        battery INTEGER NOT NULL CHECK (battery >= 0 AND battery <= 100),
        network_type TEXT NOT NULL,
        alert TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create reports table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        user_info TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        stripe_payment_id TEXT UNIQUE,
        amount INTEGER NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create commands table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commands (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        command TEXT NOT NULL,
        params TEXT,
        executed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        member_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        password_hash TEXT,
        password_plain TEXT,
        stripe_session_id TEXT UNIQUE,
        stripe_payment_id TEXT,
        payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Make name and password_hash nullable (no longer required)
    await pool.query(`ALTER TABLE members ALTER COLUMN name DROP NOT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE members ALTER COLUMN password_hash DROP NOT NULL`).catch(() => {});

    // Create admins table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'admin',
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default admin if not exists
    const defaultPasswordHash = bcrypt.hashSync('admin123!@#', 12);
    await pool.query(`
      INSERT INTO admins (username, password_hash, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (username) DO NOTHING
    `, ['admin', defaultPasswordHash, 'info@ysecurity.app']);

    logger.info('Database tables initialized successfully');
  } catch (error) {
    logger.error('Error initializing database:', error);
    process.exit(1);
  }
}

// Initialize database on startup
initializeDatabase();

// Email transporter with environment variables (Microsoft 365 / GoDaddy)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.office365.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    ciphers: 'SSLv3'
  }
});

// Socket.IO real-time features
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Admin authentication for socket
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      socket.join('admin'); // Join admin room
      socket.emit('authenticated', { success: true });
      console.log(`Admin ${decoded.username} authenticated via socket`);
    } catch (error) {
      socket.emit('authenticated', { success: false, error: 'Invalid token' });
    }
  });

  // Device authentication for socket
  socket.on('device-authenticate', (data) => {
    const { deviceId } = data;
    // In production, verify device authentication
    socket.deviceId = deviceId;
    socket.join(`device-${deviceId}`);
    socket.emit('device-authenticated', { success: true });
    console.log(`Device ${deviceId} authenticated via socket`);
  });

  // Admin requesting real-time location updates
  socket.on('subscribe-locations', (deviceId) => {
    if (!socket.user || socket.user.role !== 'admin') {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    socket.join(`locations-${deviceId}`);
    console.log(`Admin ${socket.user.username} subscribed to device ${deviceId} locations`);
  });

  // Admin sending commands
  socket.on('send-command', async (data) => {
    if (!socket.user || socket.user.role !== 'admin') {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    const { deviceId, command, params } = data;

    try {
      // Save command to database
      const result = await pool.query(
        'INSERT INTO commands (device_id, command, params) VALUES ($1, $2, $3) RETURNING id',
        [deviceId, command, JSON.stringify(params || {})]
      );

      // Send to device via socket
      io.to(`device-${deviceId}`).emit('command', {
        id: result.rows[0].id,
        command,
        params: params || {},
        timestamp: new Date().toISOString()
      });

      socket.emit('command-sent', { commandId: result.rows[0].id });
      logger.info(`Command ${command} sent to device ${deviceId} by admin ${socket.user.username}`);
    } catch (error) {
      logger.error('Error sending command:', error);
      socket.emit('command-error', { error: 'Failed to save command' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Function to broadcast location updates to subscribed admins
const broadcastLocationUpdate = (deviceId, locationData) => {
  io.to(`locations-${deviceId}`).emit('location-update', {
    deviceId,
    ...locationData,
    timestamp: new Date().toISOString()
  });
};
app.post('/api/devices/register', [
  body('deviceId').isLength({ min: 10, max: 100 }).withMessage('Device ID must be 10-100 characters'),
  body('model').isLength({ min: 1, max: 100 }).withMessage('Model is required'),
  body('os').isLength({ min: 1, max: 100 }).withMessage('OS is required'),
  body('memberId').matches(/^YS-\d{6}$/).withMessage('Valid Member ID required (format: YS-XXXXXX)'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId, model, os, memberId } = req.body;

  try {
    // Verify member exists and payment is completed
    const member = await pool.query(
      'SELECT id, member_id, payment_status FROM members WHERE member_id = $1',
      [memberId]
    );
    if (member.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid Member ID' });
    }
    if (member.rows[0].payment_status !== 'completed') {
      return res.status(403).json({ success: false, error: 'Membership payment not completed' });
    }

    // Check if this member already has a device registered
    const existingDevice = await pool.query('SELECT id FROM devices WHERE member_id = $1', [memberId]);
    if (existingDevice.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'This Member ID is already linked to a device. Contact support if you need to reinstall.' });
    }

    await pool.query(
      'INSERT INTO devices (id, model, os, member_id, license_key) VALUES ($1, $2, $3, $4, $5)',
      [deviceId, model, os, memberId, memberId]
    );

    logger.info(`Device ${deviceId} registered with member ${memberId}`);
    res.json({ success: true, deviceId, memberId });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to register device' });
  }
});

// Location ping with validation and authentication
app.post('/api/devices/:deviceId/ping', [
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  body('accuracy').isFloat({ min: 0 }).withMessage('Invalid accuracy'),
  body('battery').isInt({ min: 0, max: 100 }).withMessage('Invalid battery level'),
  body('networkType').isIn(['wifi', 'cellular', 'none', 'unknown']).withMessage('Invalid network type'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId } = req.params;
  const { lat, lng, accuracy, battery, networkType, alert } = req.body;

  try {
    // Verify device exists and is active
    const device = await pool.query('SELECT status FROM devices WHERE id = $1', [deviceId]);
    if (device.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    if (device.rows[0].status !== 'active') {
      return res.status(403).json({ success: false, error: 'Device not active' });
    }

    const query = alert
      ? 'INSERT INTO location_pings (device_id, latitude, longitude, accuracy, battery, network_type, alert) VALUES ($1, $2, $3, $4, $5, $6, $7)'
      : 'INSERT INTO location_pings (device_id, latitude, longitude, accuracy, battery, network_type) VALUES ($1, $2, $3, $4, $5, $6)';

    const values = alert
      ? [deviceId, lat, lng, accuracy, battery, networkType, alert]
      : [deviceId, lat, lng, accuracy, battery, networkType];

    await pool.query(query, values);

    logger.info(`Location ping saved for device ${deviceId}`);
    res.json({ success: true });

    // Broadcast real-time update to subscribed admins
    broadcastLocationUpdate(deviceId, { lat, lng, accuracy, battery, networkType, alert });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to save location ping' });
  }
});

// Report device lost
app.post('/api/reports', async (req, res) => {
  const { deviceId, userInfo } = req.body; // userInfo is JSON with verification details

  try {
    const result = await pool.query(
      'INSERT INTO reports (device_id, user_info) VALUES ($1, $2) RETURNING id',
      [deviceId, JSON.stringify(userInfo)]
    );

    res.json({ success: true, reportId: result.rows[0].id });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin login with validation
app.post('/api/admin/login', [
  body('username').isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors
], async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];

    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update last login
    await pool.query('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [admin.id]);

    logger.info(`Admin ${username} logged in`);
    res.json({ success: true, token, user: { username: admin.username, role: admin.role } });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Get all devices for admin (protected)
app.get('/api/admin/devices', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, model, os, owner, member_id, status, created_at FROM devices ORDER BY created_at DESC'
    );
    res.json({ success: true, devices: result.rows });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch devices' });
  }
});

// Get location history (protected)
app.get('/api/admin/devices/:deviceId/locations', [
  authenticateToken,
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 100;

  try {
    const result = await pool.query(
      'SELECT * FROM location_pings WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [deviceId, limit]
    );
    res.json({ success: true, locations: result.rows });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch locations' });
  }
});

// Mark device as lost (protected)
app.post('/api/admin/devices/:deviceId/mark-lost', [
  authenticateToken,
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { deviceId } = req.params;

  try {
    const result = await pool.query(
      'UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['reported', deviceId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    logger.info(`Device ${deviceId} marked as lost by admin ${req.user.username}`);
    res.json({ success: true, message: 'Device marked as lost' });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to update device status' });
  }
});
// Send command to device (protected)
app.post('/api/admin/devices/:deviceId/command', [
  authenticateToken,
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  body('command').isIn(['alarm', 'camera', 'geofence']).withMessage('Invalid command'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { deviceId } = req.params;
  const { command, params } = req.body;

  // Validate geofence params
  if (command === 'geofence') {
    const { lat, lng, radius } = params || {};
    if (!lat || !lng || !radius || lat < -90 || lat > 90 || lng < -180 || lng > 180 || radius <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid geofence parameters' });
    }
  }

  try {
    const result = await pool.query(
      'INSERT INTO commands (device_id, command, params) VALUES ($1, $2, $3) RETURNING id',
      [deviceId, command, JSON.stringify(params || {})]
    );

    logger.info(`Command ${command} sent to device ${deviceId} by admin ${req.user.username}`);
    res.json({ success: true, commandId: result.rows[0].id });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to send command' });
  }
});
// Payment to reveal location
app.post('/api/payments/create-session', [
  authenticateToken,
  body('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId } = req.body;

  try {
    // Verify device exists
    const device = await pool.query('SELECT id FROM devices WHERE id = $1', [deviceId]);
    if (device.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Location Reveal - Device Tracking' },
          unit_amount: 1000, // $10.00
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.API_BASE_URL}/payment-success?device=${deviceId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.API_BASE_URL}/payment-cancel`,
      metadata: {
        deviceId: deviceId,
        userId: req.user.id
      }
    });

    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error('Payment error:', error);
    res.status(500).json({ success: false, error: 'Payment processing failed' });
  }
});

// Get latest location after payment (protected)
app.get('/api/devices/:deviceId/location', [
  authenticateToken,
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId } = req.params;

  try {
    // In production, verify payment status here
    const result = await pool.query(
      'SELECT latitude, longitude, accuracy, battery, timestamp FROM location_pings WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 1',
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No location data found' });
    }

    res.json({ success: true, location: result.rows[0] });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch location' });
  }
});

// Get device status
app.get('/api/devices/:deviceId/status', [
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId } = req.params;

  try {
    const result = await pool.query('SELECT status FROM devices WHERE id = $1', [deviceId]);
    const status = result.rows.length > 0 ? result.rows[0].status : 'installed';
    res.json({ success: true, status });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Get pending commands for device
app.get('/api/devices/:deviceId/commands', [
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, command, params, created_at FROM commands WHERE device_id = $1 AND executed = FALSE ORDER BY created_at DESC',
      [deviceId]
    );
    res.json({ success: true, commands: result.rows });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch commands' });
  }
});

// Mark command as executed
app.post('/api/commands/:commandId/executed', [
  param('commandId').isInt({ min: 1 }).withMessage('Invalid command ID'),
  handleValidationErrors
], async (req, res) => {
  const { commandId } = req.params;

  try {
    const result = await pool.query('UPDATE commands SET executed = TRUE WHERE id = $1', [commandId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Command not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to update command' });
  }
});

// Receive photo from device
app.post('/api/devices/:deviceId/photo', [
  param('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  body('photo').isLength({ min: 1 }).withMessage('Photo data required'),
  handleValidationErrors
], (req, res) => {
  const { deviceId } = req.params;
  const { photo } = req.body;

  // In production, save to secure file storage
  console.log(`Received photo from device ${deviceId}, size: ${photo.length} characters`);

  // Send email notification to admin
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'info@ysecurity.app',
    subject: `Camera capture from device ${deviceId}`,
    text: `A photo has been captured from device ${deviceId}. Check the admin dashboard for details.`,
    attachments: [{
      filename: `device-${deviceId}-photo.jpg`,
      content: Buffer.from(photo, 'base64'),
      encoding: 'base64'
    }]
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Email error:', error);
    } else {
      console.log('Photo notification sent:', info.response);
    }
  });

  res.json({ success: true });
});

// Report device lost with validation
app.post('/api/reports', [
  body('deviceId').isLength({ min: 10, max: 100 }).withMessage('Invalid device ID'),
  body('userInfo').isObject().withMessage('User info must be an object'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId, userInfo } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO reports (device_id, user_info) VALUES ($1, $2) RETURNING id',
      [deviceId, JSON.stringify(userInfo)]
    );

    logger.info(`Lost device report submitted for ${deviceId}`);
    res.json({ success: true, reportId: result.rows[0].id });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit report' });
  }
});

// ========================================
// Member ID & Payment System
// ========================================

// Generate unique member ID (YS-XXXXXX)
function generateMemberId() {
  const num = crypto.randomInt(100000, 999999);
  return `YS-${num}`;
}

// Generate secure password (12 chars)
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(crypto.randomInt(chars.length));
  }
  return password;
}

// ========================================
// DEV/TEST: Create member without payment (REMOVE BEFORE LAUNCH)
// ========================================
app.post('/api/dev/create-member', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  handleValidationErrors
], async (req, res) => {
  const { email } = req.body;
  try {
    const existing = await pool.query(
      'SELECT member_id FROM members WHERE email = $1 AND payment_status = $2',
      [email, 'completed']
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Email already has a membership: ' + existing.rows[0].member_id
      });
    }

    let memberId;
    let isUnique = false;
    while (!isUnique) {
      memberId = generateMemberId();
      const check = await pool.query('SELECT id FROM members WHERE member_id = $1', [memberId]);
      if (check.rows.length === 0) isUnique = true;
    }

    await pool.query(
      'INSERT INTO members (member_id, email, payment_status) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET member_id = $1, payment_status = $3',
      [memberId, email, 'completed']
    );

    logger.info(`[DEV] Test member created: ${memberId} for ${email}`);
    res.json({ success: true, memberId, email });
  } catch (error) {
    logger.error('[DEV] Create member error:', error);
    res.status(500).json({ success: false, error: 'Failed to create test member' });
  }
});

// Create Stripe checkout session for membership (PRODUCTION)
app.post('/api/members/create-checkout', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  handleValidationErrors
], async (req, res) => {
  const { email } = req.body;

  try {
    // Check if email already has a completed membership
    const existing = await pool.query(
      'SELECT member_id FROM members WHERE email = $1 AND payment_status = $2',
      [email, 'completed']
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'This email already has an active membership (Member ID: ' + existing.rows[0].member_id + '). Check your email for your Member ID.'
      });
    }

    // Generate unique member ID
    let memberId;
    let isUnique = false;
    while (!isUnique) {
      memberId = generateMemberId();
      const check = await pool.query('SELECT id FROM members WHERE member_id = $1', [memberId]);
      if (check.rows.length === 0) isUnique = true;
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_MEMBERSHIP_PRICE_ID,
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `${process.env.API_BASE_URL || 'https://ysecurity.app'}/payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.API_BASE_URL || 'https://ysecurity.app'}/payment`,
      metadata: {
        memberId: memberId
      }
    });

    // Save pending member record (no password needed)
    await pool.query(
      'INSERT INTO members (member_id, email, stripe_session_id, payment_status) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET member_id = $1, stripe_session_id = $3, payment_status = $4',
      [memberId, email, session.id, 'pending']
    );

    logger.info(`Checkout session created for ${email}, member ID: ${memberId}`);
    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error('Checkout creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

// Verify payment and return member ID
app.get('/api/members/verify-payment', async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 200) {
    return res.status(400).json({ success: false, error: 'Invalid session ID' });
  }

  try {
    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ success: false, error: 'Payment not completed' });
    }

    // Find member by stripe session ID
    const result = await pool.query(
      'SELECT member_id, email, payment_status FROM members WHERE stripe_session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Member record not found' });
    }

    const member = result.rows[0];

    // Update payment status if still pending
    if (member.payment_status !== 'completed') {
      await pool.query(
        'UPDATE members SET payment_status = $1, stripe_payment_id = $2 WHERE stripe_session_id = $3',
        ['completed', session.payment_intent, sessionId]
      );

      // Send Member ID email
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: member.email,
          subject: 'Your Ysecurity Member ID',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
              <h2 style="color:#1a73e8;">🛡️ Welcome to Ysecurity!</h2>
              <p>Your membership is now active. Here is your Member ID:</p>
              <div style="background:#f8f9fa;padding:20px;border-radius:8px;margin:20px 0;text-align:center;">
                <p style="margin:0 0 8px;font-size:0.9rem;color:#5f6368;"><strong>Your Member ID</strong></p>
                <p style="font-size:2rem;font-weight:bold;color:#1a73e8;margin:0;font-family:monospace;letter-spacing:2px;">${member.member_id}</p>
              </div>
              <p style="color:#ea4335;"><strong>⚠️ Important:</strong> Save your Member ID securely! It cannot be recovered if lost.</p>
              <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:20px 0;">
                <p style="margin:0 0 8px;font-weight:600;">📲 Next Steps:</p>
                <ol style="margin:0;padding-left:20px;color:#555;line-height:1.8;">
                  <li>Download the <strong>Ysecurity</strong> app on your device</li>
                  <li>Open the app and enter your <strong>Member ID</strong></li>
                  <li>Protection installs and stays dormant until needed</li>
                </ol>
              </div>
              <hr style="border:none;border-top:1px solid #e8eaed;margin:24px 0;">
              <p style="color:#5f6368;font-size:0.8rem;">Ysecurity - Smart Device Security<br>https://ysecurity.app</p>
            </div>
          `
        };
        transporter.sendMail(mailOptions);
      } catch (emailErr) {
        logger.error('Failed to send Member ID email:', emailErr);
      }
    }

    res.json({
      success: true,
      memberId: member.member_id,
      email: member.email
    });
  } catch (error) {
    logger.error('Payment verification error:', error);
    res.status(500).json({ success: false, error: 'Payment verification failed' });
  }
});

// ========================================
// Admin Dashboard API Endpoints
// ========================================

// Get all members (admin) - Member ID is NOT exposed for privacy
app.get('/api/admin/members', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  try {
    const result = await pool.query(
      'SELECT m.id, m.name, m.email, m.payment_status, m.created_at, d.id as device_id, d.status as device_status FROM members m LEFT JOIN devices d ON d.member_id = m.member_id ORDER BY m.created_at DESC'
    );
    res.json({ success: true, members: result.rows });
  } catch (error) {
    logger.error('Failed to fetch members:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch members' });
  }
});

// Activate device by Member ID (admin) - user must provide their Member ID to admin
app.post('/api/admin/devices/activate', [
  authenticateToken,
  body('memberId').matches(/^YS-\d{6}$/).withMessage('Valid Member ID required (format: YS-XXXXXX)'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { memberId } = req.body;

  try {
    // Find device linked to this member ID
    const device = await pool.query(
      'SELECT id, status FROM devices WHERE member_id = $1',
      [memberId]
    );
    if (device.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No device found for this Member ID. The member may not have installed the app yet.' });
    }
    if (device.rows[0].status === 'active') {
      return res.status(400).json({ success: false, error: 'Device is already active' });
    }

    await pool.query(
      'UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE member_id = $2',
      ['active', memberId]
    );

    logger.info(`Device ${device.rows[0].id} activated by admin ${req.user.username} using member ID ${memberId}`);
    res.json({ success: true, message: 'Device activated successfully', deviceId: device.rows[0].id });
  } catch (error) {
    logger.error('Activation error:', error);
    res.status(500).json({ success: false, error: 'Failed to activate device' });
  }
});

// Deactivate device by Member ID (admin)
app.post('/api/admin/devices/deactivate', [
  authenticateToken,
  body('memberId').matches(/^YS-\d{6}$/).withMessage('Valid Member ID required (format: YS-XXXXXX)'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { memberId } = req.body;

  try {
    const result = await pool.query(
      'UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE member_id = $2',
      ['installed', memberId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'No device found for this Member ID' });
    }
    logger.info(`Device deactivated by admin ${req.user.username} using member ID ${memberId}`);
    res.json({ success: true, message: 'Device deactivated' });
  } catch (error) {
    logger.error('Deactivation error:', error);
    res.status(500).json({ success: false, error: 'Failed to deactivate device' });
  }
});

// Delete member and their device (admin) - for when user loses their ID
app.delete('/api/admin/members/:memberId', [
  authenticateToken,
  param('memberId').matches(/^YS-\d{6}$/).withMessage('Valid Member ID required'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { memberId } = req.params;

  try {
    // Delete device first (cascades to location_pings, commands, etc.)
    const device = await pool.query('SELECT id FROM devices WHERE member_id = $1', [memberId]);
    if (device.rows.length > 0) {
      await pool.query('DELETE FROM devices WHERE member_id = $1', [memberId]);
      logger.info(`Device ${device.rows[0].id} deleted for member ${memberId}`);
    }

    // Delete member record
    const result = await pool.query('DELETE FROM members WHERE member_id = $1', [memberId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    logger.info(`Member ${memberId} and associated device deleted by admin ${req.user.username}`);
    res.json({ success: true, message: 'Member and device deleted. User can reinstall and create a new membership.' });
  } catch (error) {
    logger.error('Delete error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete member' });
  }
});

// Analytics endpoint (admin)
app.get('/api/admin/analytics', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  try {
    const [devicesResult, pingsResult, alertsResult, timelineResult, membersResult] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int as count FROM devices GROUP BY status`),
      pool.query(`SELECT COUNT(*)::int as total FROM location_pings`),
      pool.query(`SELECT COUNT(*)::int as total FROM location_pings WHERE alert IS NOT NULL AND timestamp::date = CURRENT_DATE`),
      pool.query(`SELECT date_trunc('hour', timestamp) as time, COUNT(*)::int as pings FROM location_pings WHERE timestamp > NOW() - INTERVAL '24 hours' GROUP BY date_trunc('hour', timestamp) ORDER BY time`),
      pool.query(`SELECT COUNT(*)::int as total FROM members WHERE payment_status = 'completed'`)
    ]);

    const statusCounts = {};
    let totalDevices = 0;
    devicesResult.rows.forEach(r => { statusCounts[r.status] = r.count; totalDevices += r.count; });

    res.json({
      success: true,
      analytics: {
        totalDevices,
        activeDevices: statusCounts['active'] || 0,
        dormantDevices: statusCounts['installed'] || 0,
        reportedDevices: statusCounts['reported'] || 0,
        totalMembers: membersResult.rows[0].total,
        locationPings: pingsResult.rows[0].total,
        alertsToday: alertsResult.rows[0].total,
        timeline: timelineResult.rows.map(r => ({ time: r.time, pings: r.pings }))
      }
    });
  } catch (error) {
    logger.error('Failed to fetch analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// Get all reports (admin)
app.get('/api/admin/reports', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  try {
    const result = await pool.query(
      `SELECT r.id, r.device_id, r.user_info, r.status, r.created_at,
       lp.alert as last_alert, lp.timestamp as alert_time
       FROM reports r
       LEFT JOIN LATERAL (
         SELECT alert, timestamp FROM location_pings
         WHERE device_id = r.device_id AND alert IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1
       ) lp ON true
       ORDER BY r.created_at DESC`
    );
    res.json({ success: true, reports: result.rows });
  } catch (error) {
    logger.error('Failed to fetch reports:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reports' });
  }
});

// Verify a report (admin)
app.post('/api/admin/reports/:reportId/verify', [
  authenticateToken,
  param('reportId').isInt({ min: 1 }).withMessage('Invalid report ID'),
  handleValidationErrors
], async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { reportId } = req.params;
  try {
    const result = await pool.query(
      'UPDATE reports SET status = $1 WHERE id = $2 RETURNING device_id',
      ['verified', reportId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    // Also update the device status to verified
    await pool.query(
      'UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['verified', result.rows[0].device_id]
    );
    logger.info(`Report ${reportId} verified by admin ${req.user.username}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to verify report:', error);
    res.status(500).json({ success: false, error: 'Failed to verify report' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler - serve homepage for non-API routes, JSON for API routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('Real-time features enabled via Socket.IO');
});