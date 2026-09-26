import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // A background/idle client error should never crash the whole process.
  console.error('[db] Unexpected error on idle client', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (process.env.LOG_QUERIES === 'true') {
    console.log('[db] query', { text, ms, rows: res.rowCount });
  }
  return res;
}
