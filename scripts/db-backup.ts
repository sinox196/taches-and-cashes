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
 * Multi-tenant: every per-tenant `getAllX()` method takes a companyId, so
 * this loops over every company and concatenates — each row already carries
 * its own `companyId` inside `data`, so the flattened arrays are exactly the
 * shape `db:import` already expects; nothing tenant-specific about the
 * snapshot format itself.
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
  const companies = await db.getAllCompanies();
  const companyIds = companies.map((c: any) => c.id);

  const allOf = async (fn: (companyId: string) => Promise<any[]>) => {
    const rows: any[] = [];
    for (const companyId of companyIds) rows.push(...await fn(companyId));
    return rows;
  };

  // Same key names and ordering as local.db.json, so the output is a drop-in
  // snapshot that db:import accepts unchanged.
  const snapshot = {
    companies,
    users: await allOf(cid => db.getAllUsers(cid)),
    clients: await allOf(cid => db.getAllClients(cid)),
    services: await allOf(cid => db.getAllServices(cid)),
    taskTypes: await allOf(cid => db.getAllTaskTypes(cid)),
    invoices: await allOf(cid => db.getAllInvoices(cid)),
    leaveRequests: await allOf(cid => db.getAllLeaveRequests(cid)),
    absenceAuthorizations: await allOf(cid => db.getAllAbsenceAuthorizations(cid)),
    leaveBalances: await allOf(cid => db.getAllLeaveBalances(cid)),
    timeEntries: await allOf(cid => db.getAllTimeEntries(cid)),
    messages: await allOf(cid => db.getAllMessages(cid)),
    taskAssignments: await allOf(cid => db.getAllTaskAssignments(cid)),
    notifications: await allOf(cid => db.getAllNotifications(cid)),
    resourceTemplates: await allOf(cid => db.getAllResourceTemplates(cid)),
    resourceTemplateItems: await allOf(cid => db.getAllResourceTemplateItems(cid)),
    clientResourceInstances: await allOf(cid => db.getAllClientResourceInstances(cid)),
    clientResourceItemStatuses: await allOf(cid => db.getAllClientResourceItemStatuses(cid)),
    usefulLinks: await allOf(cid => db.getAllUsefulLinks(cid)),
    echeanceColumns: await allOf(cid => db.getAllEcheanceColumns(cid)),
    echeanceStatuses: await allOf(cid => db.getAllEcheanceStatuses(cid)),
    echeanceStatusOptions: await allOf(cid => db.getAllEcheanceStatusOptions(cid)),
    orders: await db.getAllOrders(),
    settingsByCompany: await Promise.all(companyIds.map(async (cid: string) => ({ id: cid, ...(await db.getSettings(cid)) }))),
    platformSettings: await db.getPlatformSettings(),
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
