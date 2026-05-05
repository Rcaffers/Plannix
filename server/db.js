import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'sql');

function getConnectionString() {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.SUPABASE_POOLER_URL ||
    process.env.DATABASE_URL ||
    ''
  );
}

export function createDbPool() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    return null;
  }
  return new Pool({
    connectionString,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

export async function runMigrations(pool) {
  if (!pool) {
    throw new Error('Database not configured. Set SUPABASE_DB_URL or DATABASE_URL.');
  }
  const files = await fs.readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();
  for (const file of sqlFiles) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

export function mapClassRow(row) {
  return {
    id: row.id,
    name: row.name,
    frequency: row.frequency,
    cadence: row.cadence,
  };
}
