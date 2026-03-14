const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// SQLite connection (for migration)
const sqliteDb = new sqlite3.Database('./database.db');

async function migrateData() {
  console.log('Starting database migration from SQLite to PostgreSQL...');

  try {
    // Migrate devices table
    console.log('Migrating devices...');
    const devices = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM devices', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const device of devices) {
      await pool.query(
        'INSERT INTO devices (id, model, os, owner, status, license_key, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
        [device.id, device.model, device.os, device.owner, device.status, device.license_key, device.created_at, device.updated_at]
      );
    }
    console.log(`Migrated ${devices.length} devices`);

    // Migrate location_pings table
    console.log('Migrating location pings...');
    const locationPings = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM location_pings', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const ping of locationPings) {
      await pool.query(
        'INSERT INTO location_pings (id, device_id, latitude, longitude, accuracy, battery, network_type, alert, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
        [ping.id, ping.device_id, ping.latitude, ping.longitude, ping.accuracy, ping.battery, ping.network_type, ping.alert, ping.timestamp]
      );
    }
    console.log(`Migrated ${locationPings.length} location pings`);

    // Migrate reports table
    console.log('Migrating reports...');
    const reports = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM reports', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const report of reports) {
      await pool.query(
        'INSERT INTO reports (id, device_id, user_info, status, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [report.id, report.device_id, report.user_info, report.status, report.created_at]
      );
    }
    console.log(`Migrated ${reports.length} reports`);

    // Migrate payments table
    console.log('Migrating payments...');
    const payments = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM payments', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const payment of payments) {
      await pool.query(
        'INSERT INTO payments (id, device_id, stripe_payment_id, amount, status, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [payment.id, payment.device_id, payment.stripe_payment_id, payment.amount, payment.status, payment.created_at]
      );
    }
    console.log(`Migrated ${payments.length} payments`);

    // Migrate commands table
    console.log('Migrating commands...');
    const commands = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM commands', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const command of commands) {
      await pool.query(
        'INSERT INTO commands (id, device_id, command, params, executed, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [command.id, command.device_id, command.command, command.params, command.executed, command.created_at]
      );
    }
    console.log(`Migrated ${commands.length} commands`);

    // Migrate admins table
    console.log('Migrating admins...');
    const admins = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM admins', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const admin of admins) {
      await pool.query(
        'INSERT INTO admins (id, username, password_hash, email, role, last_login, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (username) DO NOTHING',
        [admin.id, admin.username, admin.password_hash, admin.email, admin.role, admin.last_login, admin.created_at]
      );
    }
    console.log(`Migrated ${admins.length} admins`);

    console.log('Migration completed successfully!');

    // Close connections
    sqliteDb.close();
    await pool.end();

  } catch (error) {
    console.error('Migration failed:', error);
    sqliteDb.close();
    await pool.end();
    process.exit(1);
  }
}

// Run migration if this script is called directly
if (require.main === module) {
  migrateData();
}

module.exports = { migrateData };