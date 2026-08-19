/**
 * One-off migration: loads a JSON snapshot into an empty PostgreSQL database.
 *
 *   DATABASE_URL="postgresql://..." npm run db:import -- local.db.json
 *
 * Refuses to run against a database that already holds rows, so it can never
 * overwrite live data if you run it twice.
 */
import fs from 'node:fs';
import { importSnapshot } from '../src/server/db-postgres.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  console.error('  DATABASE_URL="postgresql://user:pass@host:5432/db" npm run db:import -- local.db.json');
  process.exit(1);
}

const file = process.argv[2] || 'local.db.json';
if (!fs.existsSync(file)) {
  console.error(`No such snapshot: ${file}`);
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`Importing ${file} -> ${new URL(url).host}`);

try {
  const counts = await importSnapshot(url, snapshot);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(24)} ${n}`);
  console.log('\nDone. Start the app with the same DATABASE_URL and verify before deleting the snapshot.');
} catch (e: any) {
  console.error(`\nImport failed: ${e.message}`);
  process.exit(1);
}
