import pg from 'pg';

const { Pool } = pg;

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

export function mapClassRow(row) {
  return {
    id: row.id,
    name: row.name,
    frequency: row.frequency,
    cadence: row.cadence,
  };
}
