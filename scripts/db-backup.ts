/**
 * Dumps the whole database to a timestamped JSON snapshot.
 *
 *   DATABASE_URL="postgresql://..." npm run db:backup
 *   DATABASE_URL="postgresql://..." npm run db:backup -- ./backups
 *
 * This is a *second* line of defence, not the primary one — the hosting
 * platform's managed backups are. What it adds is an off-platform copy you
 * hold yourself, in the same shape `db:import` reads, so a snapshot taken from
 * Railway can be restored to a fresh database anywhere, including back into
 * `local.db.json` for local inspection.
 *
 * It needs no `pg_dump` binary installed, which is the point on Windows.
 *
 * To restore: create an empty database and
 *   DATABASE_URL="postgresql://...new..." npm run db:import -- backups/<file>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { initPostgres } from '../src/server/db-postgres.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const outDir = process.argv[2] || 'backups';
fs.mkdirSync(outDir, { recursive: true });

const db = await initPostgres(url);
try {
  // Same key names and ordering as local.db.json, so the output is a drop-in
  // snapshot that db:import accepts unchanged.
  const snapshot = {
    users: await db.getAllUsers(),
    clients: await db.getAllClients(),
    services: await db.getAllServices(),
    taskTypes: await db.getAllTaskTypes(),
    invoices: await db.getAllInvoices(),
    leaveRequests: await db.getAllLeaveRequests(),
    absenceAuthorizations: await db.getAllAbsenceAuthorizations(),
    leaveBalances: await db.getAllLeaveBalances(),
    timeEntries: await db.getAllTimeEntries(),
    messages: await db.getAllMessages(),
    taskAssignments: await db.getAllTaskAssignments(),
    notifications: await db.getAllNotifications(),
    resourceTemplates: await db.getAllResourceTemplates(),
    resourceTemplateItems: await db.getAllResourceTemplateItems(),
    clientResourceInstances: await db.getAllClientResourceInstances(),
    clientResourceItemStatuses: await db.getAllClientResourceItemStatuses(),
    usefulLinks: await db.getAllUsefulLinks(),
    echeanceColumns: await db.getAllEcheanceColumns(),
    echeanceStatuses: await db.getAllEcheanceStatuses(),
    echeanceStatusOptions: await db.getAllEcheanceStatusOptions(),
    orders: await db.getAllOrders(),
    settings: await db.getSettings(),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(outDir, `backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');

  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`Wrote ${file}  (${kb} KB)`);
  for (const [k, v] of Object.entries(snapshot)) {
    if (Array.isArray(v)) console.log(`  ${k.padEnd(24)} ${v.length}`);
  }
  console.warn('\nContains bcrypt password hashes and client data — store it somewhere private.');
} finally {
  await db.close?.();
}
