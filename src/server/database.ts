import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import {
  Database,
  DEFAULT_LEAVE_ENTITLEMENT,
  defaultSettings,
  defaultPlatformSettings,
  emptyDb,
  normalizeBalance,
  seedDefaults,
  LEGACY_COMPANY_ID,
} from './db-types.js';
import { initPostgres } from './db-postgres.js';

export { DEFAULT_LEAVE_ENTITLEMENT } from './db-types.js';
export type { Database } from './db-types.js';

// Overridable so a deploy with an ephemeral root filesystem (e.g. Render
// without this path on a mounted persistent disk) can point it somewhere
// durable. Defaults to the previous behaviour when unset.
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'local.db.json');

// In-memory cache of the whole JSON file.
let db: any = emptyDb();

/**
 * Chooses the storage engine.
 *
 * PostgreSQL whenever DATABASE_URL is set — that is the deployed configuration,
 * and the only one with transactional writes and managed backups. The JSON file
 * remains for local development so `npm run dev` needs no database running; it
 * is not fit for a deployment and refuses to serve one.
 */
export async function initDb(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (url) {
    let host = '?';
    try { host = new URL(url).host; } catch { /* keep the URL out of the log either way */ }
    console.log('Database: PostgreSQL at ' + host);
    return initPostgres(url);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL is not set. Refusing to start in production against the JSON ' +
      'file: it has no backups and a crash mid-write loses everything. ' +
      'Provision a PostgreSQL database and set DATABASE_URL.',
    );
  }
  console.log('Database: JSON file at ' + DB_PATH + ' (development only — no backups)');
  return initJsonDb();
}

/**
 * Per-tenant collections that need a `companyId` backfilled on every row
 * that predates the multi-tenant migration — the exact same "recover a
 * legacy shape" idea as `normalizeBalance()`, just run once per collection
 * on every boot (a no-op once every row already has one).
 */
const TENANT_COLLECTIONS = [
  'users', 'clients', 'services', 'taskTypes', 'invoices', 'leaveRequests',
  'absenceAuthorizations', 'loans', 'advances', 'leaveBalances', 'timeEntries', 'messages',
  'taskAssignments', 'notifications', 'resourceTemplates', 'resourceTemplateItems',
  'clientResourceInstances', 'clientResourceItemStatuses', 'usefulLinks',
  'echeanceColumns', 'echeanceStatuses', 'echeanceStatusOptions',
];

async function initJsonDb(): Promise<Database> {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    db = JSON.parse(data);
    if (!db.companies) db.companies = [];
    if (!db.clients) db.clients = [];
    if (!db.services) db.services = [];
    if (!db.taskTypes) db.taskTypes = [];
    if (!db.invoices) db.invoices = [];
    if (!db.leaveRequests) db.leaveRequests = [];
    if (!db.absenceAuthorizations) db.absenceAuthorizations = [];
    if (!db.loans) db.loans = [];
    if (!db.advances) db.advances = [];
    if (!db.leaveBalances) db.leaveBalances = [];
    if (!db.timeEntries) db.timeEntries = [];
    if (!db.messages) db.messages = [];
    if (!db.taskAssignments) db.taskAssignments = [];
    if (!db.notifications) db.notifications = [];
    if (!db.resourceTemplates) db.resourceTemplates = [];
    if (!db.resourceTemplateItems) db.resourceTemplateItems = [];
    if (!db.clientResourceInstances) db.clientResourceInstances = [];
    if (!db.clientResourceItemStatuses) db.clientResourceItemStatuses = [];
    if (!db.usefulLinks) db.usefulLinks = [];
    if (!db.echeanceColumns) db.echeanceColumns = [];
    if (!db.echeanceStatuses) db.echeanceStatuses = [];
    if (!db.echeanceStatusOptions) db.echeanceStatusOptions = [];
    if (!db.orders) db.orders = [];
    if (!db.platformSettings) db.platformSettings = defaultPlatformSettings();

    // Legacy single-row settings -> one row per company, keyed like every
    // other collection. Wrap it as company-1's row rather than discard it.
    if (!db.settingsByCompany) {
      db.settingsByCompany = [];
      if (db.settings) {
        db.settingsByCompany.push({ id: LEGACY_COMPANY_ID, ...db.settings });
        delete db.settings;
      }
    }
    const legacySettings = db.settingsByCompany.find((s: any) => s.id === LEGACY_COMPANY_ID);
    if (legacySettings && !legacySettings.employerCharges) {
      legacySettings.employerCharges = defaultSettings().employerCharges;
    }

    // A settings row that predates the per-year invoice sequence has no
    // invoiceCounterYear yet. Treat an already-in-progress counter as
    // belonging to the current year rather than letting nextInvoiceNumber()
    // read the missing year as "stale" and wrongly reset it to 0001 — the
    // same backfill-not-reset care the Postgres migration takes.
    for (const row of db.settingsByCompany) {
      if (row.invoiceCounterYear === undefined && typeof row.invoiceCounter === 'number' && row.invoiceCounter > 0) {
        row.invoiceCounterYear = new Date().getFullYear();
      }
    }

    // Ensure the legacy cabinet's own company row exists before backfilling —
    // seedDefaults() also does this, but the backfill below needs it first.
    if (!db.companies.some((c: any) => c.id === LEGACY_COMPANY_ID)) {
      db.companies.push({
        id: LEGACY_COMPANY_ID, name: 'Cabinet', status: 'ACTIVE', plan: 'LEGACY',
        seatLimit: 999, createdAt: new Date().toISOString(), trialEndsAt: null,
      });
    }

    // One-time (idempotent) backfill: every pre-migration row gets stamped
    // with the legacy cabinet's companyId. Runs unconditionally on every
    // boot, same as the `if (!db.echeanceColumns) ...` lines above — a no-op
    // once every row already has one, so re-running it is always safe.
    for (const key of TENANT_COLLECTIONS) {
      for (const row of db[key] || []) {
        if (!row.companyId) row.companyId = LEGACY_COMPANY_ID;
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // No file yet: genuinely a first run.
      db = emptyDb();
      await saveDb();
    } else {
      // Anything else — above all a SyntaxError from a file truncated by a
      // crash mid-write — must stop the boot. The previous code swallowed it,
      // left `db` at its empty initial value, then saved that empty database
      // over the damaged one: silent, total, unrecoverable loss.
      throw new Error(
        'Refusing to start: ' + DB_PATH + ' exists but could not be read (' +
        error.message + '). Restore it from ' + DB_PATH + '.bak, or move it ' +
        'aside to start from an empty database.',
      );
    }
  }

  const scoped = <T extends { id: any; companyId?: string }>(collection: T[], companyId: string) =>
    collection.filter(r => r.companyId === companyId);

  const findScoped = <T extends { id: any; companyId?: string }>(collection: T[], companyId: string, id: any) =>
    collection.find(r => r.id === id && r.companyId === companyId);

  const indexScoped = <T extends { id: any; companyId?: string }>(collection: T[], companyId: string, id: any) =>
    collection.findIndex(r => r.id === id && r.companyId === companyId);

  const ensureCompanySettings = (companyId: string) => {
    let row = db.settingsByCompany.find((s: any) => s.id === companyId);
    if (!row) {
      row = { id: companyId, ...defaultSettings(), invoiceCounter: 0 };
      db.settingsByCompany.push(row);
    }
    return row;
  };

  const impl: Database = {
    // Case-insensitive: a self-serve signup's username is its email
    // (lowercased when stored), and login must still match it however the
    // visitor happens to capitalize it when typing it back in.
    getUserByUsername: async (username: string) =>
      db.users.find((u: any) => String(u.username).toLowerCase() === String(username).toLowerCase()),
    getUserById: async (companyId: string, id: number) => findScoped(db.users, companyId, id),

    getAllCompanies: async () => db.companies,
    getCompanyById: async (id: string) => db.companies.find((c: any) => c.id === id),
    createCompany: async (company: any) => {
      db.companies.push(company);
      await saveDb();
      return company;
    },
    updateCompany: async (id: string, updates: any) => {
      const index = db.companies.findIndex((c: any) => c.id === id);
      if (index === -1) return null;
      db.companies[index] = { ...db.companies[index], ...updates };
      await saveDb();
      return db.companies[index];
    },

    getAllUsers: async (companyId: string) => scoped(db.users, companyId),
    createUser: async (companyId: string, user: any) => {
      const row = { ...user, companyId };
      db.users.push(row);
      await saveDb();
      return row;
    },
    updateUser: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.users, companyId, id);
      if (index === -1) return null;
      db.users[index] = { ...db.users[index], ...updates };
      await saveDb();
      return db.users[index];
    },
    deleteUser: async (companyId: string, id: number) => {
      const index = indexScoped(db.users, companyId, id);
      if (index === -1) return false;
      db.users.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllClients: async (companyId: string) => scoped(db.clients, companyId),
    getClientById: async (companyId: string, id: number) => findScoped(db.clients, companyId, id),
    createClient: async (companyId: string, client: any) => {
      const row = { ...client, companyId };
      db.clients.push(row);
      await saveDb();
      return row;
    },
    updateClient: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.clients, companyId, id);
      if (index === -1) return null;
      db.clients[index] = { ...db.clients[index], ...updates };
      await saveDb();
      return db.clients[index];
    },
    deleteClient: async (companyId: string, id: number) => {
      const index = indexScoped(db.clients, companyId, id);
      if (index === -1) return false;
      db.clients.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllServices: async (companyId: string) => scoped(db.services, companyId),
    getServiceById: async (companyId: string, id: number) => findScoped(db.services, companyId, id),
    createService: async (companyId: string, service: any) => {
      const row = { ...service, companyId };
      db.services.push(row);
      await saveDb();
      return row;
    },
    updateService: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.services, companyId, id);
      if (index === -1) return null;
      db.services[index] = { ...db.services[index], ...updates };
      await saveDb();
      return db.services[index];
    },
    deleteService: async (companyId: string, id: number) => {
      const index = indexScoped(db.services, companyId, id);
      if (index === -1) return false;
      db.services.splice(index, 1);
      db.taskTypes = db.taskTypes.filter((t: any) => !(t.serviceId === id && t.companyId === companyId));
      await saveDb();
      return true;
    },

    getAllTaskTypes: async (companyId: string) => scoped(db.taskTypes, companyId),
    getTaskTypeById: async (companyId: string, id: number) => findScoped(db.taskTypes, companyId, id),
    createTaskType: async (companyId: string, taskType: any) => {
      const row = { ...taskType, companyId };
      db.taskTypes.push(row);
      await saveDb();
      return row;
    },
    updateTaskType: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.taskTypes, companyId, id);
      if (index === -1) return null;
      db.taskTypes[index] = { ...db.taskTypes[index], ...updates };
      await saveDb();
      return db.taskTypes[index];
    },
    deleteTaskType: async (companyId: string, id: number) => {
      const index = indexScoped(db.taskTypes, companyId, id);
      if (index === -1) return false;
      db.taskTypes.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllInvoices: async (companyId: string) => scoped(db.invoices, companyId),
    getInvoiceById: async (companyId: string, id: string) => findScoped(db.invoices, companyId, id),
    createInvoice: async (companyId: string, invoice: any) => {
      const row = { ...invoice, companyId };
      db.invoices.unshift(row); // newest first, like time entries
      await saveDb();
      return row;
    },
    updateInvoice: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.invoices, companyId, id);
      if (index === -1) return null;
      db.invoices[index] = { ...db.invoices[index], ...updates };
      await saveDb();
      return db.invoices[index];
    },
    deleteInvoice: async (companyId: string, id: string) => {
      const index = indexScoped(db.invoices, companyId, id);
      if (index === -1) return false;
      db.invoices.splice(index, 1);
      await saveDb();
      return true;
    },
    /**
     * Next document number in this company's own sequence, zero-padded to 4
     * digits. Reserved here so two concurrent creations can't collide.
     */
    nextInvoiceNumber: async (companyId: string) => {
      const settingsRow = ensureCompanySettings(companyId);
      const year = new Date().getFullYear();
      // The sequence restarts at 0001 for a new calendar year — a company
      // whose counter belongs to a past year gets reset rather than carried
      // forward.
      const current = settingsRow.invoiceCounterYear === year && typeof settingsRow.invoiceCounter === 'number'
        ? settingsRow.invoiceCounter
        : 0;
      const next = current + 1;
      settingsRow.invoiceCounter = next;
      settingsRow.invoiceCounterYear = year;
      await saveDb();
      return String(next).padStart(4, '0');
    },

    getAllLeaveRequests: async (companyId: string) => scoped(db.leaveRequests, companyId),
    getLeaveRequestById: async (companyId: string, id: number) => findScoped(db.leaveRequests, companyId, id),
    createLeaveRequest: async (companyId: string, leave: any) => {
      const row = { ...leave, companyId };
      db.leaveRequests.push(row);
      await saveDb();
      return row;
    },
    updateLeaveRequest: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.leaveRequests, companyId, id);
      if (index === -1) return null;
      db.leaveRequests[index] = { ...db.leaveRequests[index], ...updates };
      await saveDb();
      return db.leaveRequests[index];
    },

    getAllAbsenceAuthorizations: async (companyId: string) => scoped(db.absenceAuthorizations, companyId),
    getAbsenceAuthorizationById: async (companyId: string, id: number) => findScoped(db.absenceAuthorizations, companyId, id),
    createAbsenceAuthorization: async (companyId: string, auth: any) => {
      const row = { ...auth, companyId };
      db.absenceAuthorizations.push(row);
      await saveDb();
      return row;
    },
    updateAbsenceAuthorization: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.absenceAuthorizations, companyId, id);
      if (index === -1) return null;
      db.absenceAuthorizations[index] = { ...db.absenceAuthorizations[index], ...updates };
      await saveDb();
      return db.absenceAuthorizations[index];
    },

    getAllLoans: async (companyId: string) => scoped(db.loans, companyId),
    getLoanById: async (companyId: string, id: number) => findScoped(db.loans, companyId, id),
    createLoan: async (companyId: string, loan: any) => {
      const row = { ...loan, companyId };
      db.loans.push(row);
      await saveDb();
      return row;
    },
    updateLoan: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.loans, companyId, id);
      if (index === -1) return null;
      db.loans[index] = { ...db.loans[index], ...updates };
      await saveDb();
      return db.loans[index];
    },

    getAllAdvances: async (companyId: string) => scoped(db.advances, companyId),
    getAdvanceById: async (companyId: string, id: number) => findScoped(db.advances, companyId, id),
    createAdvance: async (companyId: string, advance: any) => {
      const row = { ...advance, companyId };
      db.advances.push(row);
      await saveDb();
      return row;
    },
    updateAdvance: async (companyId: string, id: number, updates: any) => {
      const index = indexScoped(db.advances, companyId, id);
      if (index === -1) return null;
      db.advances[index] = { ...db.advances[index], ...updates };
      await saveDb();
      return db.advances[index];
    },

    getAllLeaveBalances: async (companyId: string) => scoped(db.leaveBalances, companyId).map(normalizeBalance),
    getLeaveBalanceByUserId: async (companyId: string, userId: number) => {
      let raw = db.leaveBalances.find((b: any) => b.userId === userId && b.companyId === companyId);
      if (!raw) {
        raw = { userId, companyId, entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0 };
        db.leaveBalances.push(raw);
        await saveDb();
      }
      return normalizeBalance(raw);
    },
    /** Accepts `entitlement` (admin-set allowance) and/or `used` (consumed days). */
    updateLeaveBalance: async (companyId: string, userId: number, updates: any) => {
      let index = db.leaveBalances.findIndex((b: any) => b.userId === userId && b.companyId === companyId);
      if (index === -1) {
        db.leaveBalances.push({ userId, companyId, entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0 });
        index = db.leaveBalances.length - 1;
      }
      const current = normalizeBalance(db.leaveBalances[index]);
      // Rewrite the row wholesale so the legacy decrementing `available` field
      // is dropped rather than left behind to contradict the derived value.
      db.leaveBalances[index] = {
        userId,
        companyId,
        entitlement: typeof updates.entitlement === 'number' ? updates.entitlement : current.entitlement,
        used: typeof updates.used === 'number' ? updates.used : current.used,
      };
      await saveDb();
      return normalizeBalance(db.leaveBalances[index]);
    },

    getAllTimeEntries: async (companyId: string) => scoped(db.timeEntries, companyId),
    getTimeEntryById: async (companyId: string, id: string) => findScoped(db.timeEntries, companyId, id),
    createTimeEntry: async (companyId: string, entry: any) => {
      const row = { ...entry, companyId };
      db.timeEntries.unshift(row); // add to top
      await saveDb();
      return row;
    },
    updateTimeEntry: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.timeEntries, companyId, id);
      if (index === -1) return null;
      db.timeEntries[index] = { ...db.timeEntries[index], ...updates };
      await saveDb();
      return db.timeEntries[index];
    },
    deleteTimeEntry: async (companyId: string, id: string) => {
      const index = indexScoped(db.timeEntries, companyId, id);
      if (index === -1) return false;
      db.timeEntries.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllMessages: async (companyId: string) => scoped(db.messages, companyId),
    createMessage: async (companyId: string, message: any) => {
      const row = { ...message, companyId };
      db.messages.push(row);
      await saveDb();
      return row;
    },
    /** Marks every message from `fromUserId` to `readerId` as read. Returns how many changed. */
    markMessagesRead: async (companyId: string, readerId: number, fromUserId: number) => {
      let changed = 0;
      const now = new Date().toISOString();
      db.messages.forEach((m: any) => {
        if (m.companyId === companyId && m.toUserId === readerId && m.fromUserId === fromUserId && !m.readAt) {
          m.readAt = now;
          changed++;
        }
      });
      if (changed > 0) await saveDb();
      return changed;
    },

    getAllTaskAssignments: async (companyId: string) => scoped(db.taskAssignments, companyId),
    getTaskAssignmentById: async (companyId: string, id: string) => findScoped(db.taskAssignments, companyId, id),
    createTaskAssignment: async (companyId: string, assignment: any) => {
      const row = { ...assignment, companyId };
      db.taskAssignments.unshift(row);
      await saveDb();
      return row;
    },
    updateTaskAssignment: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.taskAssignments, companyId, id);
      if (index === -1) return null;
      db.taskAssignments[index] = { ...db.taskAssignments[index], ...updates };
      await saveDb();
      return db.taskAssignments[index];
    },
    deleteTaskAssignment: async (companyId: string, id: string) => {
      const index = indexScoped(db.taskAssignments, companyId, id);
      if (index === -1) return false;
      db.taskAssignments.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllNotifications: async (companyId: string) => scoped(db.notifications, companyId),
    createNotification: async (companyId: string, notification: any) => {
      const row = { ...notification, companyId };
      db.notifications.unshift(row);
      await saveDb();
      return row;
    },
    updateNotification: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.notifications, companyId, id);
      if (index === -1) return null;
      db.notifications[index] = { ...db.notifications[index], ...updates };
      await saveDb();
      return db.notifications[index];
    },

    getAllResourceTemplates: async (companyId: string) => scoped(db.resourceTemplates, companyId),
    getResourceTemplateById: async (companyId: string, id: string) => findScoped(db.resourceTemplates, companyId, id),
    createResourceTemplate: async (companyId: string, template: any) => {
      const row = { ...template, companyId };
      db.resourceTemplates.push(row);
      await saveDb();
      return row;
    },
    updateResourceTemplate: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.resourceTemplates, companyId, id);
      if (index === -1) return null;
      db.resourceTemplates[index] = { ...db.resourceTemplates[index], ...updates };
      await saveDb();
      return db.resourceTemplates[index];
    },
    deleteResourceTemplate: async (companyId: string, id: string) => {
      const index = indexScoped(db.resourceTemplates, companyId, id);
      if (index === -1) return false;
      db.resourceTemplates.splice(index, 1);
      db.resourceTemplateItems = db.resourceTemplateItems.filter((i: any) => !(i.templateId === id && i.companyId === companyId));
      await saveDb();
      return true;
    },

    getAllResourceTemplateItems: async (companyId: string) => scoped(db.resourceTemplateItems, companyId),
    createResourceTemplateItem: async (companyId: string, item: any) => {
      const row = { ...item, companyId };
      db.resourceTemplateItems.push(row);
      await saveDb();
      return row;
    },
    updateResourceTemplateItem: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.resourceTemplateItems, companyId, id);
      if (index === -1) return null;
      db.resourceTemplateItems[index] = { ...db.resourceTemplateItems[index], ...updates };
      await saveDb();
      return db.resourceTemplateItems[index];
    },
    deleteResourceTemplateItem: async (companyId: string, id: string) => {
      const index = indexScoped(db.resourceTemplateItems, companyId, id);
      if (index === -1) return false;
      db.resourceTemplateItems.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllClientResourceInstances: async (companyId: string) => scoped(db.clientResourceInstances, companyId),
    getClientResourceInstanceById: async (companyId: string, id: string) => findScoped(db.clientResourceInstances, companyId, id),
    createClientResourceInstance: async (companyId: string, instance: any) => {
      const row = { ...instance, companyId };
      db.clientResourceInstances.unshift(row);
      await saveDb();
      return row;
    },
    updateClientResourceInstance: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.clientResourceInstances, companyId, id);
      if (index === -1) return null;
      db.clientResourceInstances[index] = { ...db.clientResourceInstances[index], ...updates };
      await saveDb();
      return db.clientResourceInstances[index];
    },
    deleteClientResourceInstance: async (companyId: string, id: string) => {
      const index = indexScoped(db.clientResourceInstances, companyId, id);
      if (index === -1) return false;
      db.clientResourceInstances.splice(index, 1);
      db.clientResourceItemStatuses = db.clientResourceItemStatuses.filter((s: any) => !(s.instanceId === id && s.companyId === companyId));
      await saveDb();
      return true;
    },

    getAllClientResourceItemStatuses: async (companyId: string) => scoped(db.clientResourceItemStatuses, companyId),
    createClientResourceItemStatus: async (companyId: string, status: any) => {
      const row = { ...status, companyId };
      db.clientResourceItemStatuses.push(row);
      await saveDb();
      return row;
    },
    updateClientResourceItemStatus: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.clientResourceItemStatuses, companyId, id);
      if (index === -1) return null;
      db.clientResourceItemStatuses[index] = { ...db.clientResourceItemStatuses[index], ...updates };
      await saveDb();
      return db.clientResourceItemStatuses[index];
    },

    getAllUsefulLinks: async (companyId: string) => scoped(db.usefulLinks, companyId),
    createUsefulLink: async (companyId: string, link: any) => {
      const row = { ...link, companyId };
      db.usefulLinks.push(row);
      await saveDb();
      return row;
    },
    updateUsefulLink: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.usefulLinks, companyId, id);
      if (index === -1) return null;
      db.usefulLinks[index] = { ...db.usefulLinks[index], ...updates };
      await saveDb();
      return db.usefulLinks[index];
    },
    deleteUsefulLink: async (companyId: string, id: string) => {
      const index = indexScoped(db.usefulLinks, companyId, id);
      if (index === -1) return false;
      db.usefulLinks.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllEcheanceColumns: async (companyId: string) => scoped(db.echeanceColumns, companyId),
    createEcheanceColumn: async (companyId: string, column: any) => {
      const row = { ...column, companyId };
      db.echeanceColumns.push(row);
      await saveDb();
      return row;
    },
    updateEcheanceColumn: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.echeanceColumns, companyId, id);
      if (index === -1) return null;
      db.echeanceColumns[index] = { ...db.echeanceColumns[index], ...updates };
      await saveDb();
      return db.echeanceColumns[index];
    },
    deleteEcheanceColumn: async (companyId: string, id: string) => {
      const index = indexScoped(db.echeanceColumns, companyId, id);
      if (index === -1) return false;
      db.echeanceColumns.splice(index, 1);
      db.echeanceStatuses = db.echeanceStatuses.filter((s: any) => !(s.columnId === id && s.companyId === companyId));
      await saveDb();
      return true;
    },

    getAllEcheanceStatuses: async (companyId: string) => scoped(db.echeanceStatuses, companyId),
    createEcheanceStatus: async (companyId: string, status: any) => {
      const row = { ...status, companyId };
      db.echeanceStatuses.push(row);
      await saveDb();
      return row;
    },
    updateEcheanceStatus: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.echeanceStatuses, companyId, id);
      if (index === -1) return null;
      db.echeanceStatuses[index] = { ...db.echeanceStatuses[index], ...updates };
      await saveDb();
      return db.echeanceStatuses[index];
    },

    getAllEcheanceStatusOptions: async (companyId: string) => scoped(db.echeanceStatusOptions, companyId),
    createEcheanceStatusOption: async (companyId: string, option: any) => {
      const row = { ...option, companyId };
      db.echeanceStatusOptions.push(row);
      await saveDb();
      return row;
    },
    updateEcheanceStatusOption: async (companyId: string, id: string, updates: any) => {
      const index = indexScoped(db.echeanceStatusOptions, companyId, id);
      if (index === -1) return null;
      db.echeanceStatusOptions[index] = { ...db.echeanceStatusOptions[index], ...updates };
      await saveDb();
      return db.echeanceStatusOptions[index];
    },
    deleteEcheanceStatusOption: async (companyId: string, id: string) => {
      const index = indexScoped(db.echeanceStatusOptions, companyId, id);
      if (index === -1) return false;
      db.echeanceStatusOptions.splice(index, 1);
      await saveDb();
      return true;
    },

    getAllOrders: async () => db.orders,
    createOrder: async (order: any) => {
      db.orders.push(order);
      await saveDb();
      return order;
    },

    getSettings: async (companyId: string) => ensureCompanySettings(companyId),
    updateSettings: async (companyId: string, updates: any) => {
      const row = ensureCompanySettings(companyId);
      const index = db.settingsByCompany.findIndex((s: any) => s.id === companyId);
      db.settingsByCompany[index] = { ...row, ...updates, id: companyId };
      await saveDb();
      return db.settingsByCompany[index];
    },

    getPlatformSettings: async () => db.platformSettings,
    updatePlatformSettings: async (updates: any) => {
      db.platformSettings = { ...db.platformSettings, ...updates };
      await saveDb();
      return db.platformSettings;
    },
  };

  await seedDefaults(impl, bcrypt);
  return impl;
}

/**
 * Every mutation rewrites the whole JSON file, so a burst of writes (a timer
 * tick that pauses three tasks, a mission saved with ten types) would serialise
 * the entire database once per change. Writes are coalesced into one flush per
 * tick, and never run concurrently — with hundreds of clients and thousands of
 * entries that is the difference between one file write and dozens.
 *
 * Callers still `await saveDb()` and are guaranteed their change is on disk
 * when it resolves.
 */
let pendingWrite: Promise<void> | null = null;
let queuedWrite: Promise<void> | null = null;

async function flushDb() {
  // Serialise inside the flush so we always persist the latest state, not a
  // snapshot taken when the call was queued.
  const payload = JSON.stringify(db, null, 2);
  // rename() is atomic within a filesystem: a reader either sees the whole old
  // file or the whole new one, never a half-written one. Writing in place meant
  // a crash mid-write left truncated JSON, which used to be unrecoverable.
  const tmp = DB_PATH + '.tmp';
  await fs.writeFile(tmp, payload, 'utf-8');
  try {
    await fs.copyFile(DB_PATH, DB_PATH + '.bak');
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e; // first write: nothing to back up yet
  }
  await fs.rename(tmp, DB_PATH);
}

function saveDb(): Promise<void> {
  // A flush is already in flight: piggyback on a single trailing write that
  // will capture this change (and any other that lands before it starts).
  if (pendingWrite) {
    if (!queuedWrite) {
      queuedWrite = pendingWrite.then(async () => {
        queuedWrite = null;
        pendingWrite = flushDb().finally(() => { pendingWrite = null; });
        await pendingWrite;
      });
    }
    return queuedWrite;
  }
  pendingWrite = flushDb().finally(() => { pendingWrite = null; });
  return pendingWrite;
}
