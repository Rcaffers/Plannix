import 'dotenv/config';
import { createDbPool, runMigrations } from './db.js';

async function main() {
  const db = createDbPool();
  if (!db) {
    // eslint-disable-next-line no-console
    console.error('Missing SUPABASE_DB_URL (or DATABASE_URL).');
    process.exit(1);
  }
  try {
    await runMigrations(db);
    // eslint-disable-next-line no-console
    console.log('Migrations completed.');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', error);
  process.exit(1);
});
