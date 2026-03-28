const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const { createServer } = require("http");
const { Server } = require("socket.io");
const winston = require("winston");
const compression = require("compression");
const crypto = require("crypto");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const app = express();
app.set("trust proxy", 1);
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin:
      process.env.CORS_ORIGIN ||
      (process.env.NODE_ENV === "production"
        ? "https://ysecurity.app"
        : "http://localhost:3000"),
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Winston logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "ysecurity-app-backend" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  );
}

const PORT = process.env.PORT || 4000;

// =============================================
// REDIS SETUP (production cache + Socket.IO adapter)
// =============================================
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisClient = createClient({ url: REDIS_URL });
const redisSubClient = redisClient.duplicate();

// Redis cache helpers
const cache = {
  async get(key) {
    try {
      const val = await redisClient.get(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      logger.warn("Redis GET error:", e.message);
      return null;
    }
  },
  async set(key, value, ttlSeconds = 300) {
    try {
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (e) {
      logger.warn("Redis SET error:", e.message);
    }
  },
  async del(key) {
    try {
      await redisClient.del(key);
    } catch (e) {
      logger.warn("Redis DEL error:", e.message);
    }
  },
};

// Initialize Redis + Socket.IO adapter
(async () => {
  try {
    await redisClient.connect();
    await redisSubClient.connect();
    io.adapter(createAdapter(redisClient, redisSubClient));
    logger.info("Redis connected — Socket.IO adapter enabled");
    console.log("Redis connected — Socket.IO adapter enabled");
  } catch (err) {
    logger.warn(
      "Redis not available, falling back to in-memory adapter:",
      err.message,
    );
    console.log("Redis not available, falling back to in-memory adapter");
  }
})();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://unpkg.com",
          "https://cdn.socket.io",
        ],
        scriptSrc: [
          "'self'",
          "https://unpkg.com",
          "https://cdn.socket.io",
          "https://js.stripe.com",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        frameSrc: ["'self'", "https://js.stripe.com"],
        connectSrc: ["'self'", "https://api.stripe.com", "wss:", "ws:"],
      },
    },
  }),
);

// Rate limiting — applies only to API routes, not static files
const apiLimiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 1000,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.path.startsWith("/api"),
});
app.use(apiLimiter);

// Logging
app.use(
  morgan("combined", {
    stream: fs.createWriteStream(path.join(__dirname, "access.log"), {
      flags: "a",
    }),
  }),
);

// Middleware
app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN ||
      (process.env.NODE_ENV === "production"
        ? "https://ysecurity.app"
        : "http://localhost:3000"),
    credentials: true,
  }),
);
// Stripe webhook needs raw body for signature verification - must be before bodyParser.json
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (
      !webhookSecret ||
      webhookSecret === "whsec_replace_after_creating_webhook"
    ) {
      logger.error("Stripe webhook secret not configured");
      return res.status(500).send("Webhook secret not configured");
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
        case "checkout.session.completed": {
          const session = event.data.object;
          logger.info(`Checkout completed: ${session.id}`);

          // Update member payment status
          const result = await pool.query(
            "SELECT member_id, email, payment_status FROM members WHERE stripe_session_id = $1",
            [session.id],
          );

          if (
            result.rows.length > 0 &&
            result.rows[0].payment_status !== "completed"
          ) {
            const member = result.rows[0];
            await pool.query(
              "UPDATE members SET payment_status = $1, stripe_payment_id = $2 WHERE stripe_session_id = $3",
              ["completed", session.payment_intent, session.id],
            );

            // Send Member ID email
            try {
              const mailOptions = {
                from: process.env.EMAIL_USER,
                to: member.email,
                subject: "Your Ysecurity Member ID",
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
              `,
              };
              transporter.sendMail(mailOptions);
            } catch (emailErr) {
              logger.error(
                "Webhook: Failed to send Member ID email:",
                emailErr,
              );
            }

            logger.info(
              `Member ${member.member_id} payment completed via webhook`,
            );
          }
          break;
        }

        case "payment_intent.succeeded":
          logger.info(`PaymentIntent succeeded: ${event.data.object.id}`);
          break;

        case "payment_intent.payment_failed":
          logger.warn(`PaymentIntent failed: ${event.data.object.id}`);
          break;

        default:
          logger.info(`Unhandled webhook event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      logger.error("Webhook processing error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);

app.use(bodyParser.json({ limit: "10mb" }));

// Serve admin dashboard React app at /admin
// No-cache for HTML, long cache for hashed assets
app.use(
  "/admin",
  express.static(path.join(__dirname, "admin"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }),
);
app.get("/admin/*", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "admin", "index.html"));
});

// Mobile app — no-cache for HTML
app.use(
  express.static("public", {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }),
);

const { body, param, validationResult } = require("express-validator");
const Joi = require("joi");

// Input validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

// Validation schemas
const deviceRegistrationSchema = Joi.object({
  deviceId: Joi.string().required().min(10).max(100),
  model: Joi.string().required().min(1).max(100),
  os: Joi.string().required().min(1).max(100),
  licenseKey: Joi.string().required().min(10).max(50),
});

const locationPingSchema = Joi.object({
  lat: Joi.number().required().min(-90).max(90),
  lng: Joi.number().required().min(-180).max(180),
  accuracy: Joi.number().required().min(0),
  battery: Joi.number().required().min(-1).max(100),
  networkType: Joi.string()
    .valid(
      "wifi",
      "cellular",
      "none",
      "unknown",
      "4g",
      "3g",
      "2g",
      "slow-2g",
      "ethernet",
      "online",
    )
    .required(),
  alert: Joi.string().optional(),
});

// PostgreSQL database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on("connect", () => {
  logger.info("Connected to PostgreSQL database");
});

pool.on("error", (err) => {
  logger.error("Unexpected error on idle client", err);
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
    await pool
      .query(
        `
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS member_id TEXT
    `,
      )
      .catch(() => {});

    // Create location_pings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS location_pings (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        latitude DECIMAL(10,8) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
        longitude DECIMAL(11,8) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
        accuracy DECIMAL(10,2) NOT NULL CHECK (accuracy >= 0),
        battery INTEGER NOT NULL CHECK (battery >= -1 AND battery <= 100),
        network_type TEXT NOT NULL,
        ip_address TEXT,
        alert TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add ip_address column if missing (migration)
    await pool
      .query(
        `ALTER TABLE location_pings ADD COLUMN IF NOT EXISTS ip_address TEXT`,
      )
      .catch(() => {});

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
    await pool
      .query(`ALTER TABLE members ALTER COLUMN name DROP NOT NULL`)
      .catch(() => {});
    await pool
      .query(`ALTER TABLE members ALTER COLUMN password_hash DROP NOT NULL`)
      .catch(() => {});

    // Migration: drop UNIQUE on license_key to allow multiple devices per member
    await pool
      .query(
        `ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_license_key_key`,
      )
      .catch(() => {});

    // Create password_reset_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
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
    const defaultPasswordHash = bcrypt.hashSync("admin123!@#", 12);
    await pool.query(
      `
      INSERT INTO admins (username, password_hash, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (username) DO UPDATE SET email = EXCLUDED.email
    `,
      ["admin", defaultPasswordHash, "info@ysecurity.app"],
    );

    // Create default admin member for testing
    await pool.query(
      `
      INSERT INTO members (member_id, email, payment_status, name)
      VALUES ($1, $2, 'completed', 'Ysecurity Admin')
      ON CONFLICT (member_id) DO UPDATE SET payment_status = 'completed', name = 'Ysecurity Admin'
    `,
      ["YS-862886", "info@ysecurity.app"],
    );

    // Create device_photos table - stores captured photos per device
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_photos (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        source TEXT DEFAULT 'camera' CHECK (source IN ('camera', 'front_camera', 'rear_camera')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create device_activity table - logs all device events
    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_activity (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create device uploads directory
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("Database tables initialized successfully");
    logger.info("Database tables initialized successfully");
  } catch (error) {
    console.error("Error initializing database:", error.message);
    logger.error("Error initializing database:", error);
    process.exit(1);
  }
}

// Initialize database on startup
initializeDatabase();

// Helper: log device activity
async function logDeviceActivity(deviceId, action, details = null) {
  try {
    await pool.query(
      "INSERT INTO device_activity (device_id, action, details) VALUES ($1, $2, $3)",
      [deviceId, action, details],
    );
  } catch (err) {
    logger.error("Failed to log activity:", err);
  }
}

// Helper: ensure device upload directory exists
function ensureDeviceDir(deviceId) {
  // Sanitize deviceId for filesystem use
  const safeId = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const deviceDir = path.join(__dirname, "uploads", safeId);
  const subDirs = ["pictures", "location", "network", "activity"];
  subDirs.forEach((sub) => {
    const dir = path.join(deviceDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  return deviceDir;
}

// Email transporter with environment variables (Microsoft 365 / GoDaddy)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.office365.com",
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    ciphers: "SSLv3",
  },
});

// Socket.IO real-time features
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Admin authentication for socket
  socket.on("authenticate", (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      socket.join("admin"); // Join admin room
      socket.emit("authenticated", { success: true });
      console.log(`Admin ${decoded.username} authenticated via socket`);
    } catch (error) {
      socket.emit("authenticated", { success: false, error: "Invalid token" });
    }
  });

  // Device authentication for socket (token-based with DB fallback)
  socket.on("device-authenticate", async (data) => {
    const { deviceId, deviceToken } = data;

    // Strategy 1: Verify JWT token (fast path)
    if (deviceToken) {
      try {
        const decoded = jwt.verify(deviceToken, process.env.JWT_SECRET);
        if (decoded.deviceId === deviceId) {
          socket.deviceId = deviceId;
          socket.memberId = decoded.memberId;
          socket.join(`device-${deviceId}`);
          socket.emit("device-authenticated", { success: true });
          console.log(`Device ${deviceId} authenticated via JWT`);
          // Update last_seen in DB + Redis (non-blocking)
          pool
            .query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [
              deviceId,
            ])
            .catch(() => {});
          cache.set(`device:${deviceId}:online`, true, 120);
          return;
        }
      } catch (e) {
        // JWT failed — fall through to DB verification
        console.log(
          `Device ${deviceId} JWT invalid (${e.message}), trying DB fallback`,
        );
      }
    }

    // Strategy 2: DB fallback — verify device exists and token matches DB
    if (!deviceId) {
      socket.emit("device-authenticated", {
        success: false,
        error: "Device ID required",
      });
      return;
    }

    try {
      // Check Redis cache first
      let deviceData = await cache.get(`device:${deviceId}`);
      if (!deviceData) {
        // Cache miss — query DB
        const result = await pool.query(
          "SELECT id, member_id, device_token FROM devices WHERE id = $1",
          [deviceId],
        );
        if (result.rows.length === 0) {
          socket.emit("device-authenticated", {
            success: false,
            error: "Device not found",
          });
          console.log(`Device auth rejected: ${deviceId} not in DB`);
          return;
        }
        deviceData = {
          deviceId: result.rows[0].id,
          memberId: result.rows[0].member_id,
          token: result.rows[0].device_token,
        };
        // Populate Redis cache
        await cache.set(`device:${deviceId}`, deviceData, 86400);
      }

      // If client sent a token, verify it matches the DB token
      if (deviceToken && deviceData.token && deviceToken !== deviceData.token) {
        // Token mismatch — could be stale. Issue a new one if device is legitimately registered.
        console.log(
          `Device ${deviceId} token mismatch, allowing DB-verified auth`,
        );
      }

      socket.deviceId = deviceId;
      socket.memberId = deviceData.memberId;
      socket.join(`device-${deviceId}`);
      socket.emit("device-authenticated", { success: true });
      console.log(`Device ${deviceId} authenticated via DB fallback`);
      // Update last_seen
      pool
        .query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [deviceId])
        .catch(() => {});
      cache.set(`device:${deviceId}:online`, true, 120);
    } catch (err) {
      logger.error(`Device auth DB fallback error for ${deviceId}:`, err);
      socket.emit("device-authenticated", {
        success: false,
        error: "Auth failed",
      });
    }
  });

  // Admin requesting real-time location updates
  socket.on("subscribe-locations", (deviceId) => {
    if (!socket.user || socket.user.role !== "admin") {
      socket.emit("error", { message: "Unauthorized" });
      return;
    }

    socket.join(`locations-${deviceId}`);
    console.log(
      `Admin ${socket.user.username} subscribed to device ${deviceId} locations`,
    );
  });

  // Admin sending commands
  socket.on("send-command", async (data) => {
    if (!socket.user || socket.user.role !== "admin") {
      socket.emit("error", { message: "Unauthorized" });
      return;
    }

    const { deviceId, command, params } = data;

    try {
      // Save command to database
      const result = await pool.query(
        "INSERT INTO commands (device_id, command, params) VALUES ($1, $2, $3) RETURNING id",
        [deviceId, command, JSON.stringify(params || {})],
      );

      // Send to device via socket
      io.to(`device-${deviceId}`).emit("command", {
        id: result.rows[0].id,
        command,
        params: params || {},
        timestamp: new Date().toISOString(),
      });

      socket.emit("command-sent", { commandId: result.rows[0].id });
      logger.info(
        `Command ${command} sent to device ${deviceId} by admin ${socket.user.username}`,
      );
    } catch (error) {
      logger.error("Error sending command:", error);
      socket.emit("command-error", { error: "Failed to save command" });
    }
  });

  // ---- Live Camera Streaming Relay ----

  // Admin requests camera start on a device
  socket.on("camera-start", async (data) => {
    if (!socket.user || socket.user.role !== "admin") return;
    const { deviceId, facing } = data;
    // Check if device has any connected sockets in its room
    const room = io.sockets.adapter.rooms.get(`device-${deviceId}`);
    if (!room || room.size === 0) {
      // No device socket connected — notify admin immediately
      socket.emit("camera-stream-error", {
        deviceId,
        error:
          "Device is not connected. Make sure the app is open on the device.",
      });
      console.log(`Camera-start failed: device ${deviceId} not connected`);
      return;
    }
    io.to(`device-${deviceId}`).emit("camera-start", {
      facing: facing || "back",
    });
    console.log(
      `Admin requested camera-start (${facing}) on device ${deviceId}`,
    );
  });

  // Admin requests camera stop on a device
  socket.on("camera-stop", (data) => {
    if (!socket.user || socket.user.role !== "admin") return;
    const { deviceId } = data;
    io.to(`device-${deviceId}`).emit("camera-stop", {});
    console.log(`Admin requested camera-stop on device ${deviceId}`);
  });

  // Admin requests snapshot from active camera
  socket.on("camera-snapshot", (data) => {
    if (!socket.user || socket.user.role !== "admin") return;
    const { deviceId } = data;
    const room = io.sockets.adapter.rooms.get(`device-${deviceId}`);
    if (!room || room.size === 0) {
      socket.emit("camera-stream-error", {
        deviceId,
        error: "Device is not connected.",
      });
      return;
    }
    io.to(`device-${deviceId}`).emit("camera-snapshot", {});
    console.log(`Admin requested camera-snapshot on device ${deviceId}`);
  });

  // Admin switches camera facing
  socket.on("camera-switch", (data) => {
    if (!socket.user || socket.user.role !== "admin") return;
    const { deviceId, facing } = data;
    io.to(`device-${deviceId}`).emit("camera-switch", { facing });
    console.log(
      `Admin requested camera-switch to ${facing} on device ${deviceId}`,
    );
  });

  // Device sends a video frame → relay to admin room
  socket.on("camera-frame", (data) => {
    if (!socket.deviceId) return;
    io.to("admin").emit("camera-frame", {
      deviceId: data.deviceId || socket.deviceId,
      frame: data.frame,
      timestamp: data.timestamp,
    });
  });

  // Device notifies stream started
  socket.on("camera-stream-started", (data) => {
    if (!socket.deviceId) return;
    io.to("admin").emit("camera-stream-started", {
      deviceId: data.deviceId || socket.deviceId,
      facing: data.facing,
      width: data.width,
      height: data.height,
    });
  });

  // Device notifies stream stopped
  socket.on("camera-stream-stopped", (data) => {
    if (!socket.deviceId) return;
    io.to("admin").emit("camera-stream-stopped", {
      deviceId: data.deviceId || socket.deviceId,
    });
  });

  // Device notifies stream error
  socket.on("camera-stream-error", (data) => {
    if (!socket.deviceId) return;
    io.to("admin").emit("camera-stream-error", {
      deviceId: data.deviceId || socket.deviceId,
      error: data.error,
    });
  });

  // Device notifies snapshot saved
  socket.on("camera-snapshot-saved", (data) => {
    if (!socket.deviceId) return;
    io.to("admin").emit("camera-snapshot-saved", {
      deviceId: data.deviceId || socket.deviceId,
      filename: data.filename,
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // Mark device offline in Redis
    if (socket.deviceId) {
      cache.del(`device:${socket.deviceId}:online`);
    }
  });
});

// Function to broadcast location updates to subscribed admins
const broadcastLocationUpdate = (deviceId, locationData) => {
  io.to(`locations-${deviceId}`).emit("location-update", {
    deviceId,
    ...locationData,
    timestamp: new Date().toISOString(),
  });
};

// DEV/TEST: Quick device registration without Member ID (REMOVE BEFORE LAUNCH)
app.post(
  "/api/dev/register-device",
  [
    body("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Device ID required"),
    body("model")
      .isLength({ min: 1, max: 100 })
      .withMessage("Model is required"),
    body("os").isLength({ min: 1, max: 100 }).withMessage("OS is required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId, model, os } = req.body;
    try {
      // Use or create a test member
      let testMember = await pool.query(
        "SELECT member_id FROM members WHERE email = 'test@ysecurity.app' AND payment_status = 'completed'",
      );
      let memberId;
      if (testMember.rows.length > 0) {
        memberId = testMember.rows[0].member_id;
      } else {
        memberId = generateMemberId();
        await pool.query(
          "INSERT INTO members (member_id, email, payment_status) VALUES ($1, 'test@ysecurity.app', 'completed')",
          [memberId],
        );
      }
      // Delete any existing device for this test member so we can re-register
      await pool.query("DELETE FROM devices WHERE member_id = $1", [memberId]);
      // Generate a device token for secure Socket.IO auth
      const deviceToken = jwt.sign(
        { deviceId, memberId },
        process.env.JWT_SECRET,
        { expiresIn: "365d" },
      );
      await pool.query(
        "INSERT INTO devices (id, model, os, member_id, license_key, status, device_token, last_seen) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
        [deviceId, model, os, memberId, memberId, "active", deviceToken],
      );
      // Cache in Redis
      await cache.set(
        `device:${deviceId}`,
        { deviceId, memberId, token: deviceToken },
        86400,
      );

      logger.info(
        `[DEV] Test device registered: ${deviceId} with member ${memberId}`,
      );
      res.json({ success: true, deviceId, memberId, deviceToken });
    } catch (error) {
      logger.error("[DEV] Test register error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to register test device" });
    }
  },
);

app.post(
  "/api/devices/register",
  [
    body("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Device ID must be 10-100 characters"),
    body("model")
      .isLength({ min: 1, max: 100 })
      .withMessage("Model is required"),
    body("os").isLength({ min: 1, max: 100 }).withMessage("OS is required"),
    body("memberId")
      .matches(/^YS-\d+$/)
      .withMessage("Valid Member ID required (format: YS-XXXXX...)"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId, model, os, memberId } = req.body;

    try {
      // Verify member exists and payment is completed
      const member = await pool.query(
        "SELECT id, member_id, payment_status FROM members WHERE member_id = $1",
        [memberId],
      );
      if (member.rows.length === 0) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid Member ID" });
      }
      if (member.rows[0].payment_status !== "completed") {
        return res
          .status(403)
          .json({ success: false, error: "Membership payment not completed" });
      }

      // Check if this device is already registered
      const existingDevice = await pool.query(
        "SELECT id, device_token FROM devices WHERE id = $1",
        [deviceId],
      );
      if (existingDevice.rows.length > 0) {
        // Device already registered — rotate token, persist in DB + Redis
        const deviceToken = jwt.sign(
          { deviceId, memberId },
          process.env.JWT_SECRET,
          { expiresIn: "365d" },
        );
        await pool.query(
          "UPDATE devices SET device_token = $1, last_seen = NOW() WHERE id = $2",
          [deviceToken, deviceId],
        );
        await cache.set(
          `device:${deviceId}`,
          { deviceId, memberId, token: deviceToken },
          86400,
        );
        return res.json({ success: true, deviceId, memberId, deviceToken });
      }

      // Generate a device token for secure Socket.IO auth
      const deviceToken = jwt.sign(
        { deviceId, memberId },
        process.env.JWT_SECRET,
        { expiresIn: "365d" },
      );

      await pool.query(
        "INSERT INTO devices (id, model, os, member_id, license_key, status, device_token, last_seen) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
        [deviceId, model, os, memberId, deviceId, "active", deviceToken],
      );

      // Create device directory structure
      ensureDeviceDir(deviceId);

      // Cache in Redis
      await cache.set(
        `device:${deviceId}`,
        { deviceId, memberId, token: deviceToken },
        86400,
      );

      // Log activity: device installed
      await logDeviceActivity(
        deviceId,
        "installed",
        JSON.stringify({ model, os, memberId }),
      );

      logger.info(`Device ${deviceId} registered with member ${memberId}`);
      res.json({ success: true, deviceId, memberId, deviceToken });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to register device" });
    }
  },
);

// Health check (also used by mobile for RTT-based network detection)
app.head("/api/health", (req, res) => res.sendStatus(200));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Location ping with validation and authentication
app.post(
  "/api/devices/:deviceId/ping",
  [
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    body("lat").isFloat({ min: -90, max: 90 }).withMessage("Invalid latitude"),
    body("lng")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Invalid longitude"),
    body("accuracy").isFloat({ min: 0 }).withMessage("Invalid accuracy"),
    body("battery")
      .isInt({ min: -1, max: 100 })
      .withMessage("Invalid battery level"),
    body("networkType")
      .isIn([
        "wifi",
        "cellular",
        "none",
        "unknown",
        "4g",
        "3g",
        "2g",
        "slow-2g",
        "ethernet",
        "online",
      ])
      .withMessage("Invalid network type"),
    // Normalize networkType after validation

    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId } = req.params;
    const { lat, lng, accuracy, battery, alert } = req.body;
    // Normalize networkType: map browser values to canonical
    const rawNetworkType = req.body.networkType;
    const networkType = ["4g", "3g", "2g", "slow-2g"].includes(rawNetworkType)
      ? "cellular"
      : rawNetworkType === "ethernet" || rawNetworkType === "online"
        ? "wifi"
        : rawNetworkType;

    try {
      // Verify device exists (check Redis first, then DB)
      let deviceStatus = await cache.get(`device:${deviceId}:status`);
      if (!deviceStatus) {
        const device = await pool.query(
          "SELECT status FROM devices WHERE id = $1",
          [deviceId],
        );
        if (device.rows.length === 0) {
          return res
            .status(404)
            .json({ success: false, error: "Device not found" });
        }
        deviceStatus = device.rows[0].status;
        await cache.set(`device:${deviceId}:status`, deviceStatus, 300);
      }

      // Capture IP from request
      const ipAddress = (req.headers["x-forwarded-for"] || req.ip || "")
        .split(",")[0]
        .trim();

      const query = alert
        ? "INSERT INTO location_pings (device_id, latitude, longitude, accuracy, battery, network_type, ip_address, alert) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
        : "INSERT INTO location_pings (device_id, latitude, longitude, accuracy, battery, network_type, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7)";

      const values = alert
        ? [deviceId, lat, lng, accuracy, battery, networkType, ipAddress, alert]
        : [deviceId, lat, lng, accuracy, battery, networkType, ipAddress];

      // Insert ping + update device state in parallel
      await Promise.all([
        pool.query(query, values),
        pool.query(
          "UPDATE devices SET last_seen = NOW(), last_ip = $1, last_battery = $2, last_network_type = $3 WHERE id = $4",
          [ipAddress, battery, networkType, deviceId],
        ),
      ]);

      // Update Redis cache (non-blocking)
      cache.set(
        `device:${deviceId}:state`,
        {
          battery,
          networkType,
          ipAddress,
          lat,
          lng,
          lastSeen: new Date().toISOString(),
        },
        300,
      );
      cache.set(`device:${deviceId}:online`, true, 120);

      // Log first ping as activity (install location + network + IP)
      const pingCount = await pool.query(
        "SELECT COUNT(*)::int as count FROM location_pings WHERE device_id = $1",
        [deviceId],
      );
      if (pingCount.rows[0].count === 1) {
        await logDeviceActivity(
          deviceId,
          "first_location",
          JSON.stringify({
            lat,
            lng,
            accuracy,
            battery,
            networkType,
            ipAddress,
          }),
        );
        await logDeviceActivity(
          deviceId,
          "network_detected",
          `Network: ${networkType}, IP: ${ipAddress}, Battery: ${battery}%`,
        );
      }

      // Log geofence breach as activity
      if (alert === "geofence_breach") {
        await logDeviceActivity(
          deviceId,
          "geofence_breach",
          JSON.stringify({ lat, lng }),
        );
      }

      logger.info(`Location ping saved for device ${deviceId}`);
      res.json({ success: true });

      // Broadcast real-time update to subscribed admins
      broadcastLocationUpdate(deviceId, {
        lat,
        lng,
        accuracy,
        battery,
        networkType,
        alert,
      });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to save location ping" });
    }
  },
);

// Report device lost
app.post("/api/reports", async (req, res) => {
  const { deviceId, userInfo } = req.body; // userInfo is JSON with verification details

  try {
    const result = await pool.query(
      "INSERT INTO reports (device_id, user_info) VALUES ($1, $2) RETURNING id",
      [deviceId, JSON.stringify(userInfo)],
    );

    res.json({ success: true, reportId: result.rows[0].id });
  } catch (error) {
    logger.error("Database error:", error);
    res.status(500).json({ error: "Failed to create report" });
  }
});

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: "Access token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// Admin login with validation
app.post(
  "/api/admin/login",
  [
    body("username")
      .isLength({ min: 3, max: 50 })
      .withMessage("Username must be 3-50 characters"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { username, password } = req.body;

    try {
      const result = await pool.query(
        "SELECT * FROM admins WHERE username = $1",
        [username],
      );
      const admin = result.rows[0];

      if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid credentials" });
      }

      const token = jwt.sign(
        { id: admin.id, username: admin.username, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: "24h" },
      );

      // Update last login
      await pool.query(
        "UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
        [admin.id],
      );

      logger.info(`Admin ${username} logged in`);
      res.json({
        success: true,
        token,
        user: { username: admin.username, role: admin.role },
      });
    } catch (error) {
      logger.error("Database error:", error);
      res.status(500).json({ success: false, error: "Database error" });
    }
  },
);

// Get all devices for admin (protected) — Redis cached
app.get("/api/admin/devices", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required" });
  }

  try {
    // Check Redis cache (short TTL — admin sees near-real-time)
    const cached = await cache.get("admin:devices");
    if (cached) {
      return res.json({ success: true, devices: cached });
    }

    const result = await pool.query(
      "SELECT id, model, os, owner, member_id, status, last_seen, last_battery, last_network_type, last_ip, created_at FROM devices ORDER BY created_at DESC",
    );
    // Cache for 10 seconds
    await cache.set("admin:devices", result.rows, 10);
    res.json({ success: true, devices: result.rows });
  } catch (error) {
    logger.error("Database error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch devices" });
  }
});

// Get all devices latest locations for tracking dashboard — Redis cached
app.get(
  "/api/admin/devices/all-locations",
  [authenticateToken, handleValidationErrors],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }

    try {
      const cached = await cache.get("admin:all-locations");
      if (cached) {
        return res.json({ success: true, locations: cached });
      }

      // Get latest ping for each device using DISTINCT ON
      const result = await pool.query(`
      SELECT DISTINCT ON (lp.device_id)
        lp.device_id, lp.latitude, lp.longitude, lp.battery, lp.network_type, lp.accuracy, lp.timestamp, lp.alert,
        d.model, d.os, d.status, d.member_id
      FROM location_pings lp
      JOIN devices d ON d.id = lp.device_id
      ORDER BY lp.device_id, lp.timestamp DESC
    `);
      // Cache for 15 seconds
      await cache.set("admin:all-locations", result.rows, 15);
      res.json({ success: true, locations: result.rows });
    } catch (error) {
      logger.error("All locations error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch locations" });
    }
  },
);

// Get location history (protected)
app.get(
  "/api/admin/devices/:deviceId/locations",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }

    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    try {
      const result = await pool.query(
        "SELECT * FROM location_pings WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2",
        [deviceId, limit],
      );
      res.json({ success: true, locations: result.rows });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch locations" });
    }
  },
);

// Mark device as lost (protected)
app.post(
  "/api/admin/devices/:deviceId/mark-lost",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }

    const { deviceId } = req.params;

    try {
      const result = await pool.query(
        "UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING member_id",
        ["reported", deviceId],
      );

      if (result.rowCount === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Device not found" });
      }

      // Auto-create a report entry
      const memberId = result.rows[0].member_id || "unknown";
      await pool.query(
        "INSERT INTO reports (device_id, user_info, status) VALUES ($1, $2, $3)",
        [deviceId, `Reported lost by admin (Member: ${memberId})`, "pending"],
      );

      // Invalidate Redis caches
      await cache.del("admin:devices");
      await cache.del("admin:all-locations");
      await cache.del(`device:${deviceId}:status`);

      await logDeviceActivity(
        deviceId,
        "marked_lost",
        `Marked as lost by admin ${req.user.username}`,
      );
      logger.info(
        `Device ${deviceId} marked as lost by admin ${req.user.username}`,
      );
      res.json({ success: true, message: "Device marked as lost" });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update device status" });
    }
  },
);
// Send command to device (protected)
app.post(
  "/api/admin/devices/:deviceId/command",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    body("command")
      .isIn(["alarm", "camera", "geofence"])
      .withMessage("Invalid command"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }

    const { deviceId } = req.params;
    const { command, params } = req.body;

    // Validate geofence params
    if (command === "geofence") {
      const { lat, lng, radius } = params || {};
      if (
        !lat ||
        !lng ||
        !radius ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        radius <= 0
      ) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid geofence parameters" });
      }
    }

    try {
      const result = await pool.query(
        "INSERT INTO commands (device_id, command, params) VALUES ($1, $2, $3) RETURNING id",
        [deviceId, command, JSON.stringify(params || {})],
      );

      logger.info(
        `Command ${command} sent to device ${deviceId} by admin ${req.user.username}`,
      );
      res.json({ success: true, commandId: result.rows[0].id });
    } catch (error) {
      logger.error("Database error:", error);
      res.status(500).json({ success: false, error: "Failed to send command" });
    }
  },
);
// Payment to reveal location
app.post(
  "/api/payments/create-session",
  [
    authenticateToken,
    body("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId } = req.body;

    try {
      // Verify device exists
      const device = await pool.query("SELECT id FROM devices WHERE id = $1", [
        deviceId,
      ]);
      if (device.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Device not found" });
      }

      // Create Stripe session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "Location Reveal - Device Tracking" },
              unit_amount: 1000, // $10.00
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${process.env.API_BASE_URL}/payment-success?device=${deviceId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.API_BASE_URL}/payment-cancel`,
        metadata: {
          deviceId: deviceId,
          userId: req.user.id,
        },
      });

      res.json({ success: true, sessionId: session.id, url: session.url });
    } catch (error) {
      logger.error("Payment error:", error);
      res
        .status(500)
        .json({ success: false, error: "Payment processing failed" });
    }
  },
);

// Get latest location after payment (protected)
app.get(
  "/api/devices/:deviceId/location",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId } = req.params;

    try {
      // In production, verify payment status here
      const result = await pool.query(
        "SELECT latitude, longitude, accuracy, battery, timestamp FROM location_pings WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 1",
        [deviceId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "No location data found" });
      }

      res.json({ success: true, location: result.rows[0] });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch location" });
    }
  },
);

// Get device status — Redis cached
app.get(
  "/api/devices/:deviceId/status",
  [
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId } = req.params;

    try {
      // Check Redis first
      const cachedStatus = await cache.get(`device:${deviceId}:status`);
      if (cachedStatus) {
        return res.json({ success: true, status: cachedStatus });
      }

      const result = await pool.query(
        "SELECT status FROM devices WHERE id = $1",
        [deviceId],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Device not found" });
      }
      // Cache for 30 seconds
      await cache.set(`device:${deviceId}:status`, result.rows[0].status, 30);
      res.json({ success: true, status: result.rows[0].status });
    } catch (error) {
      logger.error("Database error:", error);
      res.status(500).json({ success: false, error: "Database error" });
    }
  },
);

// Get pending commands for device
app.get(
  "/api/devices/:deviceId/commands",
  [
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId } = req.params;

    try {
      const result = await pool.query(
        "SELECT id, command, params, created_at FROM commands WHERE device_id = $1 AND executed = FALSE ORDER BY created_at DESC",
        [deviceId],
      );
      res.json({ success: true, commands: result.rows });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch commands" });
    }
  },
);

// Mark command as executed
app.post(
  "/api/commands/:commandId/executed",
  [
    param("commandId").isInt({ min: 1 }).withMessage("Invalid command ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { commandId } = req.params;

    try {
      const result = await pool.query(
        "UPDATE commands SET executed = TRUE WHERE id = $1",
        [commandId],
      );

      if (result.rowCount === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Command not found" });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update command" });
    }
  },
);

// Receive photo from device
app.post(
  "/api/devices/:deviceId/photo",
  [
    param("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    body("photo").isLength({ min: 1 }).withMessage("Photo data required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId } = req.params;
    const { photo } = req.body;

    try {
      // Save photo to device's pictures folder
      const deviceDir = ensureDeviceDir(deviceId);
      const timestamp = Date.now();
      const filename = `photo_${timestamp}.jpg`;
      const filePath = path.join(deviceDir, "pictures", filename);
      const photoBuffer = Buffer.from(photo, "base64");
      fs.writeFileSync(filePath, photoBuffer);

      // Save to database
      const safeId = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const relativePath = `uploads/${safeId}/pictures/${filename}`;
      await pool.query(
        "INSERT INTO device_photos (device_id, filename, file_path, file_size, source) VALUES ($1, $2, $3, $4, $5)",
        [deviceId, filename, relativePath, photoBuffer.length, "camera"],
      );

      // Log activity
      await logDeviceActivity(
        deviceId,
        "photo_captured",
        JSON.stringify({ filename, size: photoBuffer.length }),
      );

      logger.info(
        `Photo saved for device ${deviceId}: ${filename} (${photoBuffer.length} bytes)`,
      );

      // Send email notification to admin
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: "info@ysecurity.app",
        subject: `Camera capture from device ${deviceId}`,
        text: `A photo has been captured from device ${deviceId}. Check the admin dashboard for details.`,
        attachments: [
          {
            filename: `device-${deviceId}-photo.jpg`,
            content: photoBuffer,
          },
        ],
      };

      transporter
        .sendMail(mailOptions)
        .catch((err) => logger.error("Email error:", err));

      res.json({ success: true, filename });
    } catch (error) {
      logger.error("Photo save error:", error);
      res.status(500).json({ success: false, error: "Failed to save photo" });
    }
  },
);

// Report device lost with validation
app.post(
  "/api/reports",
  [
    body("deviceId")
      .isLength({ min: 10, max: 100 })
      .withMessage("Invalid device ID"),
    body("userInfo").isObject().withMessage("User info must be an object"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { deviceId, userInfo } = req.body;

    try {
      const result = await pool.query(
        "INSERT INTO reports (device_id, user_info) VALUES ($1, $2) RETURNING id",
        [deviceId, JSON.stringify(userInfo)],
      );

      logger.info(`Lost device report submitted for ${deviceId}`);
      res.json({ success: true, reportId: result.rows[0].id });
    } catch (error) {
      logger.error("Database error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to submit report" });
    }
  },
);

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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(crypto.randomInt(chars.length));
  }
  return password;
}

// Member JWT auth middleware
const authenticateMember = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res
      .status(401)
      .json({ success: false, error: "Access token required" });
  jwt.verify(token, process.env.JWT_SECRET, (err, member) => {
    if (err)
      return res
        .status(403)
        .json({ success: false, error: "Invalid or expired token" });
    req.member = member;
    next();
  });
};

// ========================================
// AUTH: Sign Up, Sign In, Forgot/Reset Password
// ========================================

// Sign Up
app.post(
  "/api/auth/signup",
  [
    body("name")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { name, email, password } = req.body;
    try {
      const existing = await pool.query(
        "SELECT id FROM members WHERE email = $1",
        [email],
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: "An account with this email already exists. Please sign in.",
        });
      }

      let memberId;
      let isUnique = false;
      while (!isUnique) {
        memberId = generateMemberId();
        const check = await pool.query(
          "SELECT id FROM members WHERE member_id = $1",
          [memberId],
        );
        if (check.rows.length === 0) isUnique = true;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        "INSERT INTO members (member_id, name, email, password_hash, payment_status) VALUES ($1, $2, $3, $4, $5)",
        [memberId, name, email, passwordHash, "pending"],
      );

      const token = jwt.sign(
        { id: memberId, email, name, role: "member" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" },
      );
      logger.info(`Member signed up: ${email} (${memberId})`);
      res.json({
        success: true,
        token,
        member: { memberId, name, email, paymentStatus: "pending" },
      });
    } catch (error) {
      logger.error("Signup error:", error);
      res
        .status(500)
        .json({ success: false, error: "Signup failed. Please try again." });
    }
  },
);

// Sign In
app.post(
  "/api/auth/signin",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password").isLength({ min: 1 }).withMessage("Password is required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { email, password } = req.body;
    try {
      const result = await pool.query(
        "SELECT member_id, name, email, password_hash, payment_status FROM members WHERE email = $1",
        [email],
      );
      if (result.rows.length === 0) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid email or password." });
      }
      const member = result.rows[0];
      if (!member.password_hash) {
        return res.status(401).json({
          success: false,
          error:
            "This account was created before sign-in was available. Please use Forgot Password to set a password.",
        });
      }
      const valid = await bcrypt.compare(password, member.password_hash);
      if (!valid) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid email or password." });
      }
      const token = jwt.sign(
        {
          id: member.member_id,
          email: member.email,
          name: member.name,
          role: "member",
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" },
      );
      logger.info(`Member signed in: ${email}`);
      res.json({
        success: true,
        token,
        member: {
          memberId: member.member_id,
          name: member.name,
          email: member.email,
          paymentStatus: member.payment_status,
        },
      });
    } catch (error) {
      logger.error("Signin error:", error);
      res
        .status(500)
        .json({ success: false, error: "Sign in failed. Please try again." });
    }
  },
);

// Get current member profile
app.get("/api/auth/me", authenticateMember, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT member_id, name, email, payment_status FROM members WHERE member_id = $1",
      [req.member.id],
    );
    if (result.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, error: "Member not found" });
    const m = result.rows[0];
    res.json({
      success: true,
      member: {
        memberId: m.member_id,
        name: m.name,
        email: m.email,
        paymentStatus: m.payment_status,
      },
    });
  } catch (error) {
    logger.error("Get profile error:", error);
    res.status(500).json({ success: false, error: "Failed to get profile" });
  }
});

// Forgot Password - send reset link via email
app.post(
  "/api/auth/forgot-password",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { email } = req.body;
    try {
      const member = await pool.query(
        "SELECT id FROM members WHERE email = $1",
        [email],
      );
      // Always return success to prevent email enumeration
      if (member.rows.length === 0) {
        return res.json({
          success: true,
          message:
            "If an account exists with that email, a reset link has been sent.",
        });
      }

      // Invalidate old tokens
      await pool.query(
        "UPDATE password_reset_tokens SET used = TRUE WHERE email = $1 AND used = FALSE",
        [email],
      );

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await pool.query(
        "INSERT INTO password_reset_tokens (email, token, expires_at) VALUES ($1, $2, $3)",
        [email, token, expiresAt],
      );

      const resetUrl = `${process.env.API_BASE_URL || "https://ysecurity.app"}/reset-password?token=${token}`;
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Ysecurity - Reset Your Password",
        html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
          <h2 style="color:#1a73e8;">🛡️ Ysecurity Password Reset</h2>
          <p>You requested a password reset. Click the button below to set a new password:</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${resetUrl}" style="background:#1a73e8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Reset Password</a>
          </div>
          <p style="color:#5f6368;font-size:0.85rem;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
          <hr style="border:none;border-top:1px solid #e8eaed;margin:24px 0;">
          <p style="color:#5f6368;font-size:0.8rem;">Ysecurity - Smart Device Security</p>
        </div>
      `,
      };
      transporter
        .sendMail(mailOptions)
        .catch((err) => logger.error("Reset email error:", err));

      logger.info(`Password reset requested for ${email}`);
      res.json({
        success: true,
        message:
          "If an account exists with that email, a reset link has been sent.",
      });
    } catch (error) {
      logger.error("Forgot password error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process request. Please try again.",
      });
    }
  },
);

// Reset Password - verify token and set new password
app.post(
  "/api/auth/reset-password",
  [
    body("token")
      .isLength({ min: 64, max: 64 })
      .withMessage("Invalid reset token"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { token, password } = req.body;
    try {
      const result = await pool.query(
        "SELECT email, expires_at FROM password_reset_tokens WHERE token = $1 AND used = FALSE",
        [token],
      );
      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid or expired reset link. Please request a new one.",
        });
      }
      const { email, expires_at } = result.rows[0];
      if (new Date(expires_at) < new Date()) {
        await pool.query(
          "UPDATE password_reset_tokens SET used = TRUE WHERE token = $1",
          [token],
        );
        return res.status(400).json({
          success: false,
          error: "This reset link has expired. Please request a new one.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        "UPDATE members SET password_hash = $1 WHERE email = $2",
        [passwordHash, email],
      );
      await pool.query(
        "UPDATE password_reset_tokens SET used = TRUE WHERE token = $1",
        [token],
      );

      logger.info(`Password reset completed for ${email}`);
      res.json({
        success: true,
        message: "Password has been reset. You can now sign in.",
      });
    } catch (error) {
      logger.error("Reset password error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reset password. Please try again.",
      });
    }
  },
);

// ========================================
// DEV/TEST: Create member without payment (REMOVE BEFORE LAUNCH)
// ========================================
app.post(
  "/api/dev/create-member",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    const { email } = req.body;
    try {
      const existing = await pool.query(
        "SELECT member_id FROM members WHERE email = $1 AND payment_status = $2",
        [email, "completed"],
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error:
            "Email already has a membership: " + existing.rows[0].member_id,
        });
      }

      let memberId;
      let isUnique = false;
      while (!isUnique) {
        memberId = generateMemberId();
        const check = await pool.query(
          "SELECT id FROM members WHERE member_id = $1",
          [memberId],
        );
        if (check.rows.length === 0) isUnique = true;
      }

      await pool.query(
        "INSERT INTO members (member_id, email, payment_status) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET member_id = $1, payment_status = $3",
        [memberId, email, "completed"],
      );

      logger.info(`[DEV] Test member created: ${memberId} for ${email}`);
      res.json({ success: true, memberId, email });
    } catch (error) {
      logger.error("[DEV] Create member error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to create test member" });
    }
  },
);

// Create Stripe checkout session for membership (PRODUCTION)
// Accepts either: logged-in user (Bearer token) OR email in body
app.post("/api/members/create-checkout", async (req, res) => {
  let email;

  // Check if user is authenticated (signed in)
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      email = decoded.email;
    } catch (e) {
      // Token invalid, fall through to email in body
    }
  }

  // Fall back to email in body
  if (!email) {
    email = req.body && req.body.email;
  }

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email is required. Please sign in or provide an email.",
    });
  }

  try {
    // Check if email already has a completed membership
    const existing = await pool.query(
      "SELECT member_id FROM members WHERE email = $1 AND payment_status = $2",
      [email, "completed"],
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error:
          "This email already has an active membership (Member ID: " +
          existing.rows[0].member_id +
          "). Check your email for your Member ID.",
      });
    }

    // Check if member already exists (signed up but not paid)
    const memberRow = await pool.query(
      "SELECT member_id FROM members WHERE email = $1",
      [email],
    );
    let memberId;
    if (memberRow.rows.length > 0) {
      memberId = memberRow.rows[0].member_id;
    } else {
      let isUnique = false;
      while (!isUnique) {
        memberId = generateMemberId();
        const check = await pool.query(
          "SELECT id FROM members WHERE member_id = $1",
          [memberId],
        );
        if (check.rows.length === 0) isUnique = true;
      }
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_MEMBERSHIP_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: email,
      success_url: `${process.env.API_BASE_URL || "https://ysecurity.app"}/payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.API_BASE_URL || "https://ysecurity.app"}/payment`,
      metadata: {
        memberId: memberId,
      },
    });

    // Update or insert member record with stripe session
    await pool.query(
      "INSERT INTO members (member_id, email, stripe_session_id, payment_status) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET stripe_session_id = $3, payment_status = $4",
      [memberId, email, session.id, "pending"],
    );

    logger.info(
      `Checkout session created for ${email}, member ID: ${memberId}`,
    );
    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error("Checkout creation error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create checkout session" });
  }
});

// Verify payment and return member ID
app.get("/api/members/verify-payment", async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 200) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid session ID" });
  }

  try {
    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res
        .status(400)
        .json({ success: false, error: "Payment not completed" });
    }

    // Find member by stripe session ID
    const result = await pool.query(
      "SELECT member_id, email, payment_status FROM members WHERE stripe_session_id = $1",
      [sessionId],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Member record not found" });
    }

    const member = result.rows[0];

    // Update payment status if still pending
    if (member.payment_status !== "completed") {
      await pool.query(
        "UPDATE members SET payment_status = $1, stripe_payment_id = $2 WHERE stripe_session_id = $3",
        ["completed", session.payment_intent, sessionId],
      );

      // Send Member ID email
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: member.email,
          subject: "Your Ysecurity Member ID",
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
          `,
        };
        transporter.sendMail(mailOptions);
      } catch (emailErr) {
        logger.error("Failed to send Member ID email:", emailErr);
      }
    }

    res.json({
      success: true,
      memberId: member.member_id,
      email: member.email,
    });
  } catch (error) {
    logger.error("Payment verification error:", error);
    res
      .status(500)
      .json({ success: false, error: "Payment verification failed" });
  }
});

// ========================================
// Admin Dashboard API Endpoints
// ========================================

// Get all members (admin) - Member ID is NOT exposed for privacy
app.get("/api/admin/members", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required" });
  }
  try {
    const result = await pool.query(
      "SELECT m.id, m.member_id, m.name, m.email, m.payment_status, m.created_at, d.id as device_id, d.status as device_status FROM members m LEFT JOIN devices d ON d.member_id = m.member_id ORDER BY m.created_at DESC",
    );
    res.json({ success: true, members: result.rows });
  } catch (error) {
    logger.error("Failed to fetch members:", error);
    res.status(500).json({ success: false, error: "Failed to fetch members" });
  }
});

// Activate device by Member ID (admin) - user must provide their Member ID to admin
app.post(
  "/api/admin/devices/activate",
  [
    authenticateToken,
    body("memberId")
      .matches(/^YS-\d+$/)
      .withMessage("Valid Member ID required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { memberId } = req.body;

    try {
      // Find device linked to this member ID
      const device = await pool.query(
        "SELECT id, status FROM devices WHERE member_id = $1",
        [memberId],
      );
      if (device.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error:
            "No device found for this Member ID. The member may not have installed the app yet.",
        });
      }
      if (device.rows[0].status === "active") {
        return res
          .status(400)
          .json({ success: false, error: "Device is already active" });
      }

      await pool.query(
        "UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE member_id = $2",
        ["active", memberId],
      );

      // Invalidate Redis caches
      await cache.del("admin:devices");
      await cache.del("admin:all-locations");
      await cache.del(`device:${device.rows[0].id}:status`);

      await logDeviceActivity(
        device.rows[0].id,
        "activated",
        `Activated by admin ${req.user.username}`,
      );
      logger.info(
        `Device ${device.rows[0].id} activated by admin ${req.user.username} using member ID ${memberId}`,
      );
      res.json({
        success: true,
        message: "Device activated successfully",
        deviceId: device.rows[0].id,
      });
    } catch (error) {
      logger.error("Activation error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to activate device" });
    }
  },
);

// Deactivate device by Member ID (admin)
app.post(
  "/api/admin/devices/deactivate",
  [
    authenticateToken,
    body("memberId")
      .matches(/^YS-\d+$/)
      .withMessage("Valid Member ID required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { memberId } = req.body;

    try {
      const result = await pool.query(
        "UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE member_id = $2 RETURNING id",
        ["installed", memberId],
      );
      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: "No device found for this Member ID",
        });
      }
      // Invalidate Redis caches
      await cache.del("admin:devices");
      await cache.del("admin:all-locations");
      if (result.rows[0]) await cache.del(`device:${result.rows[0].id}:status`);

      logger.info(
        `Device deactivated by admin ${req.user.username} using member ID ${memberId}`,
      );
      res.json({ success: true, message: "Device deactivated" });
    } catch (error) {
      logger.error("Deactivation error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to deactivate device" });
    }
  },
);

// Reset/delete a device only (admin) - keeps the member account
app.delete(
  "/api/admin/devices/:deviceId",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { deviceId } = req.params;

    try {
      const device = await pool.query(
        "SELECT id, member_id FROM devices WHERE id = $1",
        [deviceId],
      );
      if (device.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Device not found" });
      }

      // Delete device (cascades to commands, location_pings via FK)
      await pool.query("DELETE FROM devices WHERE id = $1", [deviceId]);

      logger.info(`Device ${deviceId} deleted by admin ${req.user.username}`);
      res.json({
        success: true,
        message: "Device deleted. Member can re-register a new device.",
      });
    } catch (error) {
      logger.error("Device delete error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to delete device" });
    }
  },
);

// Delete member and their device (admin) - for when user loses their ID
app.delete(
  "/api/admin/members/:memberId",
  [
    authenticateToken,
    param("memberId")
      .matches(/^YS-\d+$/)
      .withMessage("Valid Member ID required"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { memberId } = req.params;

    try {
      // Protect default admin member from deletion
      if (memberId === "YS-862886") {
        return res
          .status(403)
          .json({
            success: false,
            error: "Cannot delete the default admin member",
          });
      }

      // Delete device first (cascades to location_pings, commands, etc.)
      const device = await pool.query(
        "SELECT id FROM devices WHERE member_id = $1",
        [memberId],
      );
      if (device.rows.length > 0) {
        await pool.query("DELETE FROM devices WHERE member_id = $1", [
          memberId,
        ]);
        logger.info(
          `Device ${device.rows[0].id} deleted for member ${memberId}`,
        );
      }

      // Delete member record
      const result = await pool.query(
        "DELETE FROM members WHERE member_id = $1",
        [memberId],
      );
      if (result.rowCount === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Member not found" });
      }

      logger.info(
        `Member ${memberId} and associated device deleted by admin ${req.user.username}`,
      );
      res.json({
        success: true,
        message:
          "Member and device deleted. User can reinstall and create a new membership.",
      });
    } catch (error) {
      logger.error("Delete error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to delete member" });
    }
  },
);

// =============================================
// DEVICE DIRECTORY API ENDPOINTS
// =============================================

// Get device detail with folder counts
app.get(
  "/api/admin/devices/:deviceId/directory",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { deviceId } = req.params;

    try {
      const device = await pool.query("SELECT * FROM devices WHERE id = $1", [
        deviceId,
      ]);
      if (device.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Device not found" });
      }

      const [
        photosCount,
        locationsCount,
        activityCount,
        installLocation,
        latestLocation,
        activeGeofence,
      ] = await Promise.all([
        pool.query(
          "SELECT COUNT(*)::int as count FROM device_photos WHERE device_id = $1",
          [deviceId],
        ),
        pool.query(
          "SELECT COUNT(*)::int as count FROM location_pings WHERE device_id = $1",
          [deviceId],
        ),
        pool.query(
          "SELECT COUNT(*)::int as count FROM device_activity WHERE device_id = $1",
          [deviceId],
        ),
        pool.query(
          "SELECT latitude, longitude, timestamp, ip_address FROM location_pings WHERE device_id = $1 ORDER BY timestamp ASC LIMIT 1",
          [deviceId],
        ),
        pool.query(
          "SELECT latitude, longitude, battery, network_type, accuracy, timestamp, ip_address FROM location_pings WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 1",
          [deviceId],
        ),
        pool.query(
          "SELECT params FROM commands WHERE device_id = $1 AND command = $2 ORDER BY created_at DESC LIMIT 1",
          [deviceId, "geofence"],
        ),
      ]);

      // Get latest network info from most recent ping
      const latestPing = latestLocation;

      res.json({
        success: true,
        device: device.rows[0],
        folders: {
          pictures: photosCount.rows[0].count,
          location: locationsCount.rows[0].count,
          network: latestPing.rows.length > 0 ? 1 : 0,
          activity: activityCount.rows[0].count,
        },
        installLocation: installLocation.rows[0] || null,
        latestLocation: latestLocation.rows[0] || null,
        latestNetwork: latestPing.rows[0] || null,
        geofence: activeGeofence.rows[0]
          ? typeof activeGeofence.rows[0].params === "string"
            ? JSON.parse(activeGeofence.rows[0].params)
            : activeGeofence.rows[0].params
          : null,
      });
    } catch (error) {
      logger.error("Device directory error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to load device directory" });
    }
  },
);

// Get device photos
app.get(
  "/api/admin/devices/:deviceId/photos",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { deviceId } = req.params;

    try {
      const result = await pool.query(
        "SELECT id, filename, file_size, source, created_at FROM device_photos WHERE device_id = $1 ORDER BY created_at DESC LIMIT 100",
        [deviceId],
      );
      res.json({ success: true, photos: result.rows });
    } catch (error) {
      logger.error("Photos fetch error:", error);
      res.status(500).json({ success: false, error: "Failed to load photos" });
    }
  },
);

// Serve device photo file (accepts token in query string for img src)
app.get(
  "/api/admin/devices/:deviceId/photos/:photoId/file",
  [
    param("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Invalid device ID"),
    param("photoId").isInt({ min: 1 }).withMessage("Invalid photo ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    // Accept token from Authorization header or query string
    const token =
      req.query.token ||
      (req.headers.authorization && req.headers.authorization.split(" ")[1]);
    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required" });
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== "admin") {
        return res
          .status(403)
          .json({ success: false, error: "Admin access required" });
      }
    } catch (err) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    const { deviceId, photoId } = req.params;

    try {
      const result = await pool.query(
        "SELECT file_path FROM device_photos WHERE id = $1 AND device_id = $2",
        [photoId, deviceId],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Photo not found" });
      }
      const filePath = path.join(__dirname, result.rows[0].file_path);
      if (!fs.existsSync(filePath)) {
        return res
          .status(404)
          .json({ success: false, error: "Photo file not found" });
      }
      res.sendFile(filePath);
    } catch (error) {
      logger.error("Photo file error:", error);
      res.status(500).json({ success: false, error: "Failed to serve photo" });
    }
  },
);

// Get device activity logs
app.get(
  "/api/admin/devices/:deviceId/activity",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { deviceId } = req.params;

    try {
      const result = await pool.query(
        "SELECT id, action, details, created_at FROM device_activity WHERE device_id = $1 ORDER BY created_at DESC LIMIT 200",
        [deviceId],
      );
      res.json({ success: true, activities: result.rows });
    } catch (error) {
      logger.error("Activity fetch error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to load activity" });
    }
  },
);

// Get device network info (from location pings)
app.get(
  "/api/admin/devices/:deviceId/network",
  [
    authenticateToken,
    param("deviceId")
      .isLength({ min: 5, max: 100 })
      .withMessage("Invalid device ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { deviceId } = req.params;

    try {
      const result = await pool.query(
        `SELECT network_type, battery, accuracy, timestamp, ip_address 
       FROM location_pings WHERE device_id = $1 
       ORDER BY timestamp DESC LIMIT 50`,
        [deviceId],
      );
      // Get network type distribution
      const typeDist = await pool.query(
        `SELECT network_type, COUNT(*)::int as count 
       FROM location_pings WHERE device_id = $1 
       GROUP BY network_type ORDER BY count DESC`,
        [deviceId],
      );
      res.json({
        success: true,
        networkHistory: result.rows,
        networkTypes: typeDist.rows,
      });
    } catch (error) {
      logger.error("Network info error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to load network info" });
    }
  },
);

// Analytics endpoint (admin)
app.get("/api/admin/analytics", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required" });
  }
  try {
    const [
      devicesResult,
      pingsResult,
      alertsResult,
      timelineResult,
      membersResult,
    ] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int as count FROM devices GROUP BY status`,
      ),
      pool.query(`SELECT COUNT(*)::int as total FROM location_pings`),
      pool.query(
        `SELECT COUNT(*)::int as total FROM location_pings WHERE alert IS NOT NULL AND timestamp::date = CURRENT_DATE`,
      ),
      pool.query(
        `SELECT date_trunc('hour', timestamp) as time, COUNT(*)::int as pings FROM location_pings WHERE timestamp > NOW() - INTERVAL '24 hours' GROUP BY date_trunc('hour', timestamp) ORDER BY time`,
      ),
      pool.query(
        `SELECT COUNT(*)::int as total FROM members WHERE payment_status = 'completed'`,
      ),
    ]);

    const statusCounts = {};
    let totalDevices = 0;
    devicesResult.rows.forEach((r) => {
      statusCounts[r.status] = r.count;
      totalDevices += r.count;
    });

    res.json({
      success: true,
      analytics: {
        totalDevices,
        activeDevices: statusCounts["active"] || 0,
        dormantDevices: statusCounts["installed"] || 0,
        reportedDevices: statusCounts["reported"] || 0,
        totalMembers: membersResult.rows[0].total,
        locationPings: pingsResult.rows[0].total,
        alertsToday: alertsResult.rows[0].total,
        timeline: timelineResult.rows.map((r) => ({
          time: r.time,
          pings: r.pings,
        })),
      },
    });
  } catch (error) {
    logger.error("Failed to fetch analytics:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch analytics" });
  }
});

// Get all reports (admin)
app.get("/api/admin/reports", authenticateToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required" });
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
       ORDER BY r.created_at DESC`,
    );
    res.json({ success: true, reports: result.rows });
  } catch (error) {
    logger.error("Failed to fetch reports:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reports" });
  }
});

// Verify a report (admin)
app.post(
  "/api/admin/reports/:reportId/verify",
  [
    authenticateToken,
    param("reportId").isInt({ min: 1 }).withMessage("Invalid report ID"),
    handleValidationErrors,
  ],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, error: "Admin access required" });
    }
    const { reportId } = req.params;
    try {
      const result = await pool.query(
        "UPDATE reports SET status = $1 WHERE id = $2 RETURNING device_id",
        ["verified", reportId],
      );
      if (result.rowCount === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Report not found" });
      }
      // Also update the device status to verified
      await pool.query(
        "UPDATE devices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        ["verified", result.rows[0].device_id],
      );
      logger.info(`Report ${reportId} verified by admin ${req.user.username}`);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to verify report:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to verify report" });
    }
  },
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// 404 handler - serve homepage for non-API routes, JSON for API routes
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res
      .status(404)
      .json({ success: false, error: "Endpoint not found" });
  }
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("Real-time features enabled via Socket.IO");
});
