import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import {
  Database,
  DEFAULT_LEAVE_ENTITLEMENT,
  defaultSettings,
  emptyDb,
  normalizeBalance,
  seedDefaults,
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

async function initJsonDb(): Promise<Database> {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    db = JSON.parse(data);
    if (!db.clients) db.clients = [];
    if (!db.services) db.services = [];
    if (!db.taskTypes) db.taskTypes = [];
    if (!db.invoices) db.invoices = [];
    if (!db.leaveRequests) db.leaveRequests = [];
    if (!db.absenceAuthorizations) db.absenceAuthorizations = [];
    if (!db.leaveBalances) db.leaveBalances = [];
    if (!db.timeEntries) db.timeEntries = [];
    if (!db.messages) db.messages = [];
    if (!db.settings) db.settings = defaultSettings();
    if (!db.settings.employerCharges) db.settings.employerCharges = defaultSettings().employerCharges;
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

  const impl: Database = {
    get: async (sql: string, param: any) => {
      if (sql.includes('WHERE username = ?')) {
        return db.users.find((u: any) => u.username === param);
      }
      if (sql.includes('WHERE id = ?')) {
        return db.users.find((u: any) => u.id === param);
      }
      return null;
    },
    getAllUsers: async () => {
      return db.users;
    },
    createUser: async (user: any) => {
      db.users.push(user);
      await saveDb();
      return user;
    },
    updateUser: async (id: number, updates: any) => {
      const index = db.users.findIndex((u: any) => u.id === id);
      if (index !== -1) {
        db.users[index] = { ...db.users[index], ...updates };
        await saveDb();
        return db.users[index];
      }
      return null;
    },
    deleteUser: async (id: number) => {
      const index = db.users.findIndex((u: any) => u.id === id);
      if (index !== -1) {
        db.users.splice(index, 1);
        await saveDb();
        return true;
      }
      return false;
    },
    // Client CRUD
    getAllClients: async () => {
      return db.clients;
    },
    getClientById: async (id: number) => {
      return db.clients.find((c: any) => c.id === id);
    },
    createClient: async (client: any) => {
      db.clients.push(client);
      await saveDb();
      return client;
    },
    updateClient: async (id: number, updates: any) => {
      const index = db.clients.findIndex((c: any) => c.id === id);
      if (index !== -1) {
        db.clients[index] = { ...db.clients[index], ...updates };
        await saveDb();
        return db.clients[index];
      }
      return null;
    },
    deleteClient: async (id: number) => {
      const index = db.clients.findIndex((c: any) => c.id === id);
      if (index !== -1) {
        // Soft delete logic can be handled at API level, but we provide this just in case
        db.clients.splice(index, 1);
        await saveDb();
        return true;
      }
      return false;
    },
    // Service CRUD
    getAllServices: async () => {
      return db.services;
    },
    getServiceById: async (id: number) => {
      return db.services.find((s: any) => s.id === id);
    },
    createService: async (service: any) => {
      db.services.push(service);
      await saveDb();
      return service;
    },
    updateService: async (id: number, updates: any) => {
      const index = db.services.findIndex((s: any) => s.id === id);
      if (index !== -1) {
        db.services[index] = { ...db.services[index], ...updates };
        await saveDb();
        return db.services[index];
      }
      return null;
    },
    deleteService: async (id: number) => {
      const index = db.services.findIndex((s: any) => s.id === id);
      if (index === -1) return false;
      db.services.splice(index, 1);
      // Cascade: a type de tâche has no meaning without its mission.
      db.taskTypes = db.taskTypes.filter((t: any) => t.serviceId !== id);
      await saveDb();
      return true;
    },
    // Task type CRUD (types de tâches, scoped to a mission)
    getAllTaskTypes: async () => db.taskTypes,
    getTaskTypeById: async (id: number) => db.taskTypes.find((t: any) => t.id === id),
    createTaskType: async (taskType: any) => {
      db.taskTypes.push(taskType);
      await saveDb();
      return taskType;
    },
    updateTaskType: async (id: number, updates: any) => {
      const index = db.taskTypes.findIndex((t: any) => t.id === id);
      if (index === -1) return null;
      db.taskTypes[index] = { ...db.taskTypes[index], ...updates };
      await saveDb();
      return db.taskTypes[index];
    },
    deleteTaskType: async (id: number) => {
      const index = db.taskTypes.findIndex((t: any) => t.id === id);
      if (index === -1) return false;
      db.taskTypes.splice(index, 1);
      await saveDb();
      return true;
    },
    // Cash / facturation CRUD
    getAllInvoices: async () => db.invoices,
    getInvoiceById: async (id: string) => db.invoices.find((i: any) => i.id === id),
    createInvoice: async (invoice: any) => {
      db.invoices.unshift(invoice); // newest first, like time entries
      await saveDb();
      return invoice;
    },
    updateInvoice: async (id: string, updates: any) => {
      const index = db.invoices.findIndex((i: any) => i.id === id);
      if (index === -1) return null;
      db.invoices[index] = { ...db.invoices[index], ...updates };
      await saveDb();
      return db.invoices[index];
    },
    deleteInvoice: async (id: string) => {
      const index = db.invoices.findIndex((i: any) => i.id === id);
      if (index === -1) return false;
      db.invoices.splice(index, 1);
      await saveDb();
      return true;
    },
    /**
     * Next document number in the sequence, zero-padded to 4 digits.
     * Reserved atomically here so two concurrent creations can't collide.
     */
    nextInvoiceNumber: async () => {
      const current = typeof db.settings.invoiceCounter === 'number' ? db.settings.invoiceCounter : 0;
      const next = current + 1;
      db.settings.invoiceCounter = next;
      await saveDb();
      return String(next).padStart(4, '0');
    },
    // HR CRUD
    getAllLeaveRequests: async () => {
      return db.leaveRequests;
    },
    getLeaveRequestById: async (id: number) => {
      return db.leaveRequests.find((l: any) => l.id === id);
    },
    createLeaveRequest: async (leave: any) => {
      db.leaveRequests.push(leave);
      await saveDb();
      return leave;
    },
    updateLeaveRequest: async (id: number, updates: any) => {
      const index = db.leaveRequests.findIndex((l: any) => l.id === id);
      if (index !== -1) {
        db.leaveRequests[index] = { ...db.leaveRequests[index], ...updates };
        await saveDb();
        return db.leaveRequests[index];
      }
      return null;
    },
    getAllAbsenceAuthorizations: async () => {
      return db.absenceAuthorizations;
    },
    getAbsenceAuthorizationById: async (id: number) => {
      return db.absenceAuthorizations.find((a: any) => a.id === id);
    },
    createAbsenceAuthorization: async (auth: any) => {
      db.absenceAuthorizations.push(auth);
      await saveDb();
      return auth;
    },
    updateAbsenceAuthorization: async (id: number, updates: any) => {
      const index = db.absenceAuthorizations.findIndex((a: any) => a.id === id);
      if (index !== -1) {
        db.absenceAuthorizations[index] = { ...db.absenceAuthorizations[index], ...updates };
        await saveDb();
        return db.absenceAuthorizations[index];
      }
      return null;
    },
    getAllLeaveBalances: async () => (db.leaveBalances || []).map(normalizeBalance),
    getLeaveBalanceByUserId: async (userId: number) => {
      let raw = db.leaveBalances.find((b: any) => b.userId === userId);
      if (!raw) {
        raw = { userId, entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0 };
        db.leaveBalances.push(raw);
        await saveDb();
      }
      return normalizeBalance(raw);
    },
    /** Accepts `entitlement` (admin-set allowance) and/or `used` (consumed days). */
    updateLeaveBalance: async (userId: number, updates: any) => {
      let index = db.leaveBalances.findIndex((b: any) => b.userId === userId);
      if (index === -1) {
        db.leaveBalances.push({ userId, entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0 });
        index = db.leaveBalances.length - 1;
      }
      const current = normalizeBalance(db.leaveBalances[index]);
      // Rewrite the row wholesale so the legacy decrementing `available` field
      // is dropped rather than left behind to contradict the derived value.
      db.leaveBalances[index] = {
        userId,
        entitlement: typeof updates.entitlement === 'number' ? updates.entitlement : current.entitlement,
        used: typeof updates.used === 'number' ? updates.used : current.used,
      };
      await saveDb();
      return normalizeBalance(db.leaveBalances[index]);
    },

    // Time Tracking CRUD
    getAllTimeEntries: async () => {
      return db.timeEntries;
    },
    getTimeEntryById: async (id: string) => {
      return db.timeEntries.find((t: any) => t.id === id);
    },
    createTimeEntry: async (entry: any) => {
      db.timeEntries.unshift(entry); // add to top
      await saveDb();
      return entry;
    },
    updateTimeEntry: async (id: string, updates: any) => {
      const index = db.timeEntries.findIndex((t: any) => t.id === id);
      if (index !== -1) {
        db.timeEntries[index] = { ...db.timeEntries[index], ...updates };
        await saveDb();
        return db.timeEntries[index];
      }
      return null;
    },
    deleteTimeEntry: async (id: string) => {
      const index = db.timeEntries.findIndex((t: any) => t.id === id);
      if (index !== -1) {
        db.timeEntries.splice(index, 1);
        await saveDb();
        return true;
      }
      return false;
    },
    // Chat CRUD — flat list of DMs, filtered/grouped at the API layer the same
    // way KPI stats are: the collection here stays a dumb array.
    getAllMessages: async () => {
      return db.messages;
    },
    createMessage: async (message: any) => {
      db.messages.push(message);
      await saveDb();
      return message;
    },
    /** Marks every message from `fromUserId` to `readerId` as read. Returns how many changed. */
    markMessagesRead: async (readerId: number, fromUserId: number) => {
      let changed = 0;
      const now = new Date().toISOString();
      db.messages.forEach((m: any) => {
        if (m.toUserId === readerId && m.fromUserId === fromUserId && !m.readAt) {
          m.readAt = now;
          changed++;
        }
      });
      if (changed > 0) await saveDb();
      return changed;
    },
    // Settings CRUD
    getSettings: async () => {
      return db.settings;
    },
    updateSettings: async (updates: any) => {
      db.settings = { ...db.settings, ...updates };
      await saveDb();
      return db.settings;
    }
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

