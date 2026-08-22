import pg from 'pg';
import bcrypt from 'bcryptjs';
import {
  Database,
  DEFAULT_LEAVE_ENTITLEMENT,
  defaultSettings,
  normalizeBalance,
  seedDefaults,
} from './db-types.js';

/**
 * PostgreSQL backend — the durable one, used whenever `DATABASE_URL` is set.
 *
 * ## Why documents rather than a column per field
 *
 * Every row is stored as `(id TEXT PRIMARY KEY, seq BIGSERIAL, data JSONB)`.
 * That is a deliberate choice, not laziness: the records are already
 * document-shaped (clients carry free-form `customFields`, users carry
 * JSON-stringified `permissions`, invoices carry a nested line array, dates are
 * stored as display strings in two different formats). Normalising all of that
 * into strict columns would mean rewriting how `server.ts` reads every one of
 * them, and the highest-risk code in the app — the invoice cascade and the
 * historical employer rates — would be in the blast radius for no gain.
 *
 * Keeping the record shape byte-identical means `server.ts` is untouched and
 * the import is a straight copy, while still buying the things the JSON file
 * could never give: atomic transactional writes (no more truncated-file data
 * loss), row-level updates instead of rewriting ~12 MB per mutation, real
 * concurrency across processes, and the platform's managed backups.
 *
 * JSONB is indexable, so hot lookups can get a GIN or expression index later
 * without touching any of this.
 *
 * ## Ordering
 *
 * The JSON store appended with `push` but used `unshift` for time entries and
 * invoices, so those two read back newest-first and the rest oldest-first.
 * `seq` reproduces that exactly — see ORDER in `collection()` below.
 */

const { Pool } = pg;

/** Collections stored as (id, seq, data). `desc` mirrors the old `unshift`. */
const COLLECTIONS: Record<string, { desc: boolean }> = {
  users: { desc: false },
  clients: { desc: false },
  services: { desc: false },
  task_types: { desc: false },
  invoices: { desc: true },
  leave_requests: { desc: false },
  absence_authorizations: { desc: false },
  time_entries: { desc: true },
  messages: { desc: false },
  task_assignments: { desc: true },
  notifications: { desc: true },
  resource_templates: { desc: false },
  resource_template_items: { desc: false },
  client_resource_instances: { desc: true },
  client_resource_item_statuses: { desc: false },
  useful_links: { desc: false },
  echeance_columns: { desc: false },
  echeance_statuses: { desc: false },
};

/** Snapshot key -> table name. The snapshot is the old `local.db.json` shape. */
const TABLE_FOR: Record<string, string> = {
  users: 'users',
  clients: 'clients',
  services: 'services',
  taskTypes: 'task_types',
  invoices: 'invoices',
  leaveRequests: 'leave_requests',
  absenceAuthorizations: 'absence_authorizations',
  timeEntries: 'time_entries',
  messages: 'messages',
  taskAssignments: 'task_assignments',
  notifications: 'notifications',
  resourceTemplates: 'resource_templates',
  resourceTemplateItems: 'resource_template_items',
  clientResourceInstances: 'client_resource_instances',
  clientResourceItemStatuses: 'client_resource_item_statuses',
  usefulLinks: 'useful_links',
  echeanceColumns: 'echeance_columns',
  echeanceStatuses: 'echeance_statuses',
};

function makePool(connectionString: string) {
  return new Pool({
    connectionString,
    // Managed Postgres on Render/Railway terminates TLS with a certificate the
    // Node bundle does not chain to. Verification is relaxed only for those
    // hosted URLs, never for a local one.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 10,
  });
}

/**
 * Idempotent: safe to run on every boot, which is what makes deploying against
 * a brand-new empty database work with no manual migration step.
 */
async function ensureSchema(pool: pg.Pool) {
  const q = (text: string, params: any[] = []) => pool.query(text, params);
  for (const table of Object.keys(COLLECTIONS)) {
    await q(`CREATE TABLE IF NOT EXISTS ${table} (
      id   TEXT PRIMARY KEY,
      seq  BIGSERIAL,
      data JSONB NOT NULL
    )`);
  }
  await q(`CREATE TABLE IF NOT EXISTS leave_balances (
    user_id     BIGINT PRIMARY KEY,
    entitlement DOUBLE PRECISION NOT NULL,
    used        DOUBLE PRECISION NOT NULL DEFAULT 0
  )`);
  // Settings is a singleton; the CHECK makes a second row impossible.
  await q(`CREATE TABLE IF NOT EXISTS settings (
    only_row        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (only_row),
    data            JSONB   NOT NULL,
    invoice_counter BIGINT  NOT NULL DEFAULT 0
  )`);
  await q(`INSERT INTO settings (only_row, data) VALUES (TRUE, $1)
           ON CONFLICT (only_row) DO NOTHING`, [JSON.stringify(defaultSettings())]);

  // Indexes for the lookups that run on every request.
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users ((data->>'username'))`);
  await q(`CREATE INDEX IF NOT EXISTS task_types_service_idx  ON task_types ((data->>'serviceId'))`);
  await q(`CREATE INDEX IF NOT EXISTS time_entries_user_idx   ON time_entries ((data->>'userId'))`);
  await q(`CREATE INDEX IF NOT EXISTS messages_to_idx         ON messages ((data->>'toUserId'))`);
  await q(`CREATE INDEX IF NOT EXISTS task_assignments_to_idx ON task_assignments ((data->>'assignedToUserId'))`);
  await q(`CREATE INDEX IF NOT EXISTS notifications_user_idx  ON notifications ((data->>'userId'))`);
  await q(`CREATE INDEX IF NOT EXISTS resource_template_items_template_idx ON resource_template_items ((data->>'templateId'))`);
  await q(`CREATE INDEX IF NOT EXISTS client_resource_instances_client_idx ON client_resource_instances ((data->>'clientId'))`);
  await q(`CREATE INDEX IF NOT EXISTS client_resource_item_statuses_instance_idx ON client_resource_item_statuses ((data->>'instanceId'))`);
  await q(`CREATE INDEX IF NOT EXISTS echeance_statuses_client_idx ON echeance_statuses ((data->>'clientId'))`);
  await q(`CREATE INDEX IF NOT EXISTS echeance_statuses_column_idx ON echeance_statuses ((data->>'columnId'))`);
}

export async function initPostgres(connectionString: string): Promise<Database> {
  const pool = makePool(connectionString);
  const q = async (text: string, params: any[] = []) => (await pool.query(text, params)).rows;
  await ensureSchema(pool);

  /**
   * Generic CRUD over one collection. The `id` column is TEXT so numeric and
   * string ids share one code path, but the id *inside* `data` keeps its
   * original JSON type — which is what lets `server.ts` keep comparing client
   * ids with `===` against numbers.
   */
  const collection = (table: string) => {
    const order = `ORDER BY seq ${COLLECTIONS[table].desc ? 'DESC' : 'ASC'}`;
    return {
      all: async () => (await q(`SELECT data FROM ${table} ${order}`)).map(r => r.data),
      byId: async (id: any) => {
        const rows = await q(`SELECT data FROM ${table} WHERE id = $1`, [String(id)]);
        return rows.length ? rows[0].data : undefined;
      },
      create: async (record: any) => {
        await q(`INSERT INTO ${table} (id, data) VALUES ($1, $2)`,
          [String(record.id), JSON.stringify(record)]);
        return record;
      },
      update: async (id: any, updates: any) => {
        // `||` is a shallow JSONB merge — the same semantics as { ...old, ...updates }.
        // Doing it in one statement makes read-modify-write atomic, so two
        // concurrent edits can no longer lose one another.
        const rows = await q(
          `UPDATE ${table} SET data = data || $2::jsonb WHERE id = $1 RETURNING data`,
          [String(id), JSON.stringify(updates)],
        );
        return rows.length ? rows[0].data : null;
      },
      remove: async (id: any) => {
        const res = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [String(id)]);
        return (res.rowCount ?? 0) > 0;
      },
    };
  };

  const users = collection('users');
  const clients = collection('clients');
  const services = collection('services');
  const taskTypes = collection('task_types');
  const invoices = collection('invoices');
  const leaveRequests = collection('leave_requests');
  const absences = collection('absence_authorizations');
  const timeEntries = collection('time_entries');
  const messages = collection('messages');
  const taskAssignments = collection('task_assignments');
  const notifications = collection('notifications');
  const resourceTemplates = collection('resource_templates');
  const resourceTemplateItems = collection('resource_template_items');
  const clientResourceInstances = collection('client_resource_instances');
  const clientResourceItemStatuses = collection('client_resource_item_statuses');
  const usefulLinks = collection('useful_links');
  const echeanceColumns = collection('echeance_columns');
  const echeanceStatuses = collection('echeance_statuses');

  const db: Database = {
    get: async (sql: string, param: any) => {
      if (sql.includes('WHERE username = ?')) {
        const rows = await q(`SELECT data FROM users WHERE data->>'username' = $1`, [String(param)]);
        return rows.length ? rows[0].data : undefined;
      }
      if (sql.includes('WHERE id = ?')) return users.byId(param);
      return null;
    },

    getAllUsers: users.all,
    createUser: users.create,
    updateUser: users.update,
    deleteUser: users.remove,

    getAllClients: clients.all,
    getClientById: clients.byId,
    createClient: clients.create,
    updateClient: clients.update,
    deleteClient: clients.remove,

    getAllServices: services.all,
    getServiceById: services.byId,
    createService: services.create,
    updateService: services.update,
    deleteService: async (id: number) => {
      // Cascade: a type de tâche has no meaning without its mission. One
      // transaction, so a crash can't leave orphaned types behind.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query('DELETE FROM services WHERE id = $1', [String(id)]);
        await client.query(`DELETE FROM task_types WHERE data->>'serviceId' = $1`, [String(id)]);
        await client.query('COMMIT');
        return (res.rowCount ?? 0) > 0;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    getAllTaskTypes: taskTypes.all,
    getTaskTypeById: taskTypes.byId,
    createTaskType: taskTypes.create,
    updateTaskType: taskTypes.update,
    deleteTaskType: taskTypes.remove,

    getAllInvoices: invoices.all,
    getInvoiceById: invoices.byId,
    createInvoice: invoices.create,
    updateInvoice: invoices.update,
    deleteInvoice: invoices.remove,
    /**
     * A single atomic increment. The JSON version read, added one and wrote
     * back, so two documents created at the same moment could take the same
     * legal number — the one thing a facture légale must never do.
     */
    nextInvoiceNumber: async () => {
      const rows = await q(
        `UPDATE settings SET invoice_counter = invoice_counter + 1
         WHERE only_row RETURNING invoice_counter`,
      );
      return String(rows[0].invoice_counter).padStart(4, '0');
    },

    getAllLeaveRequests: leaveRequests.all,
    getLeaveRequestById: leaveRequests.byId,
    createLeaveRequest: leaveRequests.create,
    updateLeaveRequest: leaveRequests.update,

    getAllAbsenceAuthorizations: absences.all,
    getAbsenceAuthorizationById: absences.byId,
    createAbsenceAuthorization: absences.create,
    updateAbsenceAuthorization: absences.update,

    // `available` stays derived — it is never a column.
    getAllLeaveBalances: async () =>
      (await q('SELECT user_id, entitlement, used FROM leave_balances ORDER BY user_id'))
        .map(r => normalizeBalance({ userId: Number(r.user_id), entitlement: r.entitlement, used: r.used })),
    getLeaveBalanceByUserId: async (userId: number) => {
      const rows = await q(
        `INSERT INTO leave_balances (user_id, entitlement, used) VALUES ($1, $2, 0)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING user_id, entitlement, used`,
        [userId, DEFAULT_LEAVE_ENTITLEMENT],
      );
      const r = rows[0];
      return normalizeBalance({ userId: Number(r.user_id), entitlement: r.entitlement, used: r.used });
    },
    updateLeaveBalance: async (userId: number, updates: any) => {
      // Both fields are nullable *parameters* so that an update touching only
      // `used` leaves `entitlement` alone. Passing the default instead of null
      // here would silently reset an admin-set allowance back to 20 every time
      // a leave request was approved.
      const rows = await q(
        // The ::float8 casts are required, not decorative: an untyped NULL
        // parameter is assumed to be text, and the insert fails outright.
        `INSERT INTO leave_balances (user_id, entitlement, used)
         VALUES ($1, COALESCE($2::float8, $4::float8), COALESCE($3::float8, 0))
         ON CONFLICT (user_id) DO UPDATE SET
           entitlement = COALESCE($2::float8, leave_balances.entitlement),
           used        = COALESCE($3::float8, leave_balances.used)
         RETURNING user_id, entitlement, used`,
        [
          userId,
          typeof updates.entitlement === 'number' ? updates.entitlement : null,
          typeof updates.used === 'number' ? updates.used : null,
          DEFAULT_LEAVE_ENTITLEMENT,
        ],
      );
      const r = rows[0];
      return normalizeBalance({ userId: Number(r.user_id), entitlement: r.entitlement, used: r.used });
    },

    getAllTimeEntries: timeEntries.all,
    getTimeEntryById: timeEntries.byId,
    createTimeEntry: timeEntries.create,
    updateTimeEntry: timeEntries.update,
    deleteTimeEntry: timeEntries.remove,

    getAllMessages: messages.all,
    createMessage: messages.create,
    markMessagesRead: async (readerId: number, fromUserId: number) => {
      const res = await pool.query(
        `UPDATE messages
            SET data = data || jsonb_build_object('readAt', $3::text)
          WHERE data->>'toUserId'   = $1
            AND data->>'fromUserId' = $2
            AND data->>'readAt' IS NULL`,
        [String(readerId), String(fromUserId), new Date().toISOString()],
      );
      return res.rowCount ?? 0;
    },

    getAllTaskAssignments: taskAssignments.all,
    getTaskAssignmentById: taskAssignments.byId,
    createTaskAssignment: taskAssignments.create,
    updateTaskAssignment: taskAssignments.update,
    deleteTaskAssignment: taskAssignments.remove,

    getAllNotifications: notifications.all,
    createNotification: notifications.create,
    updateNotification: notifications.update,

    getAllResourceTemplates: resourceTemplates.all,
    getResourceTemplateById: resourceTemplates.byId,
    createResourceTemplate: resourceTemplates.create,
    updateResourceTemplate: resourceTemplates.update,
    deleteResourceTemplate: async (id: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query('DELETE FROM resource_templates WHERE id = $1', [String(id)]);
        await client.query(`DELETE FROM resource_template_items WHERE data->>'templateId' = $1`, [String(id)]);
        await client.query('COMMIT');
        return (res.rowCount ?? 0) > 0;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    getAllResourceTemplateItems: resourceTemplateItems.all,
    createResourceTemplateItem: resourceTemplateItems.create,
    updateResourceTemplateItem: resourceTemplateItems.update,
    deleteResourceTemplateItem: resourceTemplateItems.remove,

    getAllClientResourceInstances: clientResourceInstances.all,
    getClientResourceInstanceById: clientResourceInstances.byId,
    createClientResourceInstance: clientResourceInstances.create,
    updateClientResourceInstance: clientResourceInstances.update,
    deleteClientResourceInstance: async (id: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query('DELETE FROM client_resource_instances WHERE id = $1', [String(id)]);
        await client.query(`DELETE FROM client_resource_item_statuses WHERE data->>'instanceId' = $1`, [String(id)]);
        await client.query('COMMIT');
        return (res.rowCount ?? 0) > 0;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    getAllClientResourceItemStatuses: clientResourceItemStatuses.all,
    createClientResourceItemStatus: clientResourceItemStatuses.create,
    updateClientResourceItemStatus: clientResourceItemStatuses.update,

    getAllUsefulLinks: usefulLinks.all,
    createUsefulLink: usefulLinks.create,
    updateUsefulLink: usefulLinks.update,
    deleteUsefulLink: usefulLinks.remove,

    getAllEcheanceColumns: echeanceColumns.all,
    createEcheanceColumn: echeanceColumns.create,
    updateEcheanceColumn: echeanceColumns.update,
    deleteEcheanceColumn: async (id: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query('DELETE FROM echeance_columns WHERE id = $1', [String(id)]);
        await client.query(`DELETE FROM echeance_statuses WHERE data->>'columnId' = $1`, [String(id)]);
        await client.query('COMMIT');
        return (res.rowCount ?? 0) > 0;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    getAllEcheanceStatuses: echeanceStatuses.all,
    createEcheanceStatus: echeanceStatuses.create,
    updateEcheanceStatus: echeanceStatuses.update,

    getSettings: async () => {
      const rows = await q('SELECT data, invoice_counter FROM settings WHERE only_row');
      // invoiceCounter lives in its own column so it can be incremented
      // atomically, but callers still see it on the settings object.
      return { ...rows[0].data, invoiceCounter: Number(rows[0].invoice_counter) };
    },
    updateSettings: async (updates: any) => {
      const { invoiceCounter, ...rest } = updates ?? {};
      const rows = await q(
        `UPDATE settings
            SET data = data || $1::jsonb,
                invoice_counter = COALESCE($2::bigint, invoice_counter)
          WHERE only_row RETURNING data, invoice_counter`,
        [JSON.stringify(rest), typeof invoiceCounter === 'number' ? invoiceCounter : null],
      );
      return { ...rows[0].data, invoiceCounter: Number(rows[0].invoice_counter) };
    },

    close: async () => { await pool.end(); },
  };

  await seedDefaults(db, bcrypt);
  return db;
}

/**
 * Loads a JSON snapshot (the old `local.db.json`) into an empty PostgreSQL
 * database. Used by `npm run db:import`; exported here so the schema and the
 * table names have exactly one definition.
 *
 * Refuses to touch a database that already holds data, so re-running it can
 * never overwrite live records.
 */
export async function importSnapshot(connectionString: string, snapshot: any) {
  const pool = makePool(connectionString);
  try {
    await ensureSchema(pool);

    // Anything already present means this database is in use, and importing
    // would duplicate or clobber it.
    for (const table of Object.values(TABLE_FOR)) {
      const n = Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
      if (n > 0) {
        throw new Error(
          `Refusing to import: "${table}" already holds ${n} row(s). ` +
          `The import only runs against an empty database.`,
        );
      }
    }

    const client = await pool.connect();
    const counts: Record<string, number> = {};
    try {
      await client.query('BEGIN');
      for (const [key, table] of Object.entries(TABLE_FOR)) {
        const rows: any[] = snapshot[key] ?? [];
        // `seq` is assigned by the sequence in insertion order, and the two
        // "newest first" collections are read back with ORDER BY seq DESC.
        // Their snapshot arrays are already newest-first, so they have to go in
        // backwards or the import would silently reverse the history.
        const ordered = COLLECTIONS[table].desc ? [...rows].reverse() : rows;
        for (const record of ordered) {
          await client.query(
            `INSERT INTO ${table} (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
            [String(record.id), JSON.stringify(record)],
          );
        }
        counts[table] = rows.length;
      }
      for (const b of snapshot.leaveBalances ?? []) {
        const n = normalizeBalance(b);
        await client.query(
          `INSERT INTO leave_balances (user_id, entitlement, used) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET entitlement = EXCLUDED.entitlement, used = EXCLUDED.used`,
          [n.userId, n.entitlement, n.used],
        );
      }
      counts['leave_balances'] = (snapshot.leaveBalances ?? []).length;
      if (snapshot.settings) {
        const { invoiceCounter, ...rest } = snapshot.settings;
        await client.query(
          `UPDATE settings SET data = $1::jsonb, invoice_counter = $2 WHERE only_row`,
          [JSON.stringify(rest), typeof invoiceCounter === 'number' ? invoiceCounter : 0],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return counts;
  } finally {
    await pool.end();
  }
}
