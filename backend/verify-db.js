require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const res = await pool.query('SELECT NOW() as time');
    console.log('DB Connected:', res.rows[0].time);

    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    console.log('\nTables:', tables.rows.map(r => r.tablename).join(', '));

    const cols = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'members' ORDER BY ordinal_position");
    console.log('\nMembers columns:');
    cols.rows.forEach(r => console.log('  ', r.column_name, '-', r.data_type, r.is_nullable === 'YES' ? '(nullable)' : '(required)'));

    const dcols = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'devices' ORDER BY ordinal_position");
    console.log('\nDevices columns:');
    dcols.rows.forEach(r => console.log('  ', r.column_name, '-', r.data_type, r.is_nullable === 'YES' ? '(nullable)' : '(required)'));

    const mc = await pool.query('SELECT COUNT(*) as c FROM members');
    const dc = await pool.query('SELECT COUNT(*) as c FROM devices');
    console.log('\nMembers:', mc.rows[0].c, '| Devices:', dc.rows[0].c);

    const members = await pool.query('SELECT member_id, email, payment_status, created_at FROM members ORDER BY created_at DESC LIMIT 10');
    console.log('\nMembers list:');
    members.rows.forEach(r => console.log('  ', r.member_id, r.email, r.payment_status, r.created_at));

    await pool.end();
  } catch (e) {
    console.error('DB ERROR:', e.message);
  }
})();
