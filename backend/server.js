const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')('your-stripe-secret-key'); // Replace with actual key
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./sercret-security.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    model TEXT,
    os TEXT,
    owner TEXT,
    status TEXT DEFAULT 'installed', -- installed, reported, verified, active, recovered
    license_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS location_pings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    battery INTEGER,
    network_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    user_info TEXT, -- JSON string with verification info
    status TEXT DEFAULT 'pending', -- pending, verified, rejected
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    stripe_payment_id TEXT,
    amount INTEGER,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    command TEXT,
    params TEXT, -- JSON
    executed BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id)
  )`);

  db.run(`INSERT OR IGNORE INTO admins (username, password_hash, email) VALUES (?, ?, ?)`, 
    ['admin', bcrypt.hashSync('password', 10), 'admin@example.com']);

// Email transporter
const transporter = nodemailer.createTransporter({
  service: 'gmail', // or your email service
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-password'
  }
});

// Routes

// Device registration
app.post('/api/devices/register', (req, res) => {
  const { deviceId, model, os, licenseKey } = req.body;
  // Check if license is valid and not used
  db.get('SELECT * FROM devices WHERE license_key = ?', [licenseKey], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) return res.status(400).json({ error: 'License already used' });
    
    db.run('INSERT INTO devices (id, model, os, license_key) VALUES (?, ?, ?, ?)', 
      [deviceId, model, os, licenseKey], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, deviceId });
    });
  });
});

// Location ping
app.post('/api/devices/:deviceId/ping', (req, res) => {
  const { deviceId } = req.params;
  const { lat, lng, accuracy, battery, networkType } = req.body;
  
  db.get('SELECT status FROM devices WHERE id = ?', [deviceId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row || row.status !== 'active') return res.status(403).json({ error: 'Device not active' });
    
    db.run('INSERT INTO location_pings (device_id, latitude, longitude, accuracy, battery, network_type) VALUES (?, ?, ?, ?, ?, ?)',
      [deviceId, lat, lng, accuracy, battery, networkType], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// Report device lost
app.post('/api/reports', (req, res) => {
  const { deviceId, userInfo } = req.body; // userInfo is JSON with verification details
  db.run('INSERT INTO reports (device_id, user_info) VALUES (?, ?)', 
    [deviceId, JSON.stringify(userInfo)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, reportId: this.lastID });
  });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM admins WHERE username = ?', [username], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: row.id, username: row.username }, 'secret-key');
    res.json({ token });
  });
});

// Get all devices for admin
app.get('/api/admin/devices', (req, res) => {
  // Assume auth middleware
  db.all('SELECT * FROM devices', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get location history
app.get('/api/admin/devices/:deviceId/locations', (req, res) => {
  const { deviceId } = req.params;
  db.all('SELECT * FROM location_pings WHERE device_id = ? ORDER BY timestamp DESC', [deviceId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Mark device as lost (activate)
app.post('/api/admin/devices/:deviceId/mark-lost', (req, res) => {
  const { deviceId } = req.params;
  db.run('UPDATE devices SET status = ? WHERE id = ?', ['active', deviceId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    // Send activation signal to device (in real app, use push notification or polling)
    res.json({ success: true });
  });
});
// Send command to device
app.post('/api/admin/devices/:deviceId/command', (req, res) => {
  const { deviceId } = req.params;
  const { command, params } = req.body;
  db.run('INSERT INTO commands (device_id, command, params) VALUES (?, ?, ?)', 
    [deviceId, command, JSON.stringify(params || {})], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, commandId: this.lastID });
  });
});
// Payment to reveal location
app.post('/api/payments/create-session', (req, res) => {
  const { deviceId } = req.body;
  // Create Stripe session
  // This is simplified
  stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: 'Location Reveal' },
        unit_amount: 1000, // $10
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `http://localhost:3000/payment-success?device=${deviceId}`,
    cancel_url: 'http://localhost:3000/payment-cancel',
  }).then(session => {
    res.json({ sessionId: session.id });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// Get latest location after payment
app.get('/api/devices/:deviceId/location', (req, res) => {
  const { deviceId } = req.params;
  // Assume payment verified
  db.get('SELECT * FROM location_pings WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1', [deviceId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

// Get device status
app.get('/api/devices/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  db.get('SELECT status FROM devices WHERE id = ?', [deviceId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: row?.status || 'installed' });
  });
});

// Get pending commands for device
app.get('/api/devices/:deviceId/commands', (req, res) => {
  const { deviceId } = req.params;
  db.all('SELECT * FROM commands WHERE device_id = ? AND executed = FALSE ORDER BY created_at DESC', [deviceId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Mark command as executed
app.post('/api/commands/:commandId/executed', (req, res) => {
  const { commandId } = req.params;
  db.run('UPDATE commands SET executed = TRUE WHERE id = ?', [commandId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Receive photo from device
app.post('/api/devices/:deviceId/photo', (req, res) => {
  const { deviceId } = req.params;
  const { photo } = req.body;
  // In real app, save to file or database
  console.log(`Received photo from ${deviceId}, length: ${photo.length}`);
  // Send email or notify admin
  res.json({ success: true });
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});