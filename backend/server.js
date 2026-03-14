const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
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
require('dotenv').config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
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
  defaultMeta: { service: 'sercret-security-backend' },
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

const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
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
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
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
        status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'reported', 'verified', 'active', 'recovered')),
        license_key TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    `, ['admin', defaultPasswordHash, 'admin@sercret-security.com']);

    logger.info('Database tables initialized successfully');
  } catch (error) {
    logger.error('Error initializing database:', error);
    process.exit(1);
  }
}

// Initialize database on startup
initializeDatabase();

// Email transporter with environment variables
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  secure: true
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
  body('licenseKey').isLength({ min: 10, max: 50 }).withMessage('License key must be 10-50 characters'),
  handleValidationErrors
], async (req, res) => {
  const { deviceId, model, os, licenseKey } = req.body;

  try {
    // Check if license is valid and not used
    const existingDevice = await pool.query('SELECT id FROM devices WHERE license_key = $1', [licenseKey]);
    if (existingDevice.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'License already used' });
    }

    await pool.query(
      'INSERT INTO devices (id, model, os, license_key) VALUES ($1, $2, $3, $4)',
      [deviceId, model, os, licenseKey]
    );

    logger.info(`Device ${deviceId} registered successfully`);
    res.json({ success: true, deviceId });
  } catch (error) {
    logger.error('Database error:', error);
    res.status(500).json({ success: false, error: 'Failed to register device' });
  }
});
  });
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
      'SELECT id, model, os, owner, status, created_at FROM devices ORDER BY created_at DESC'
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
  });
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
    to: 'admin@sercret-security.com',
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('Real-time features enabled via Socket.IO');
});