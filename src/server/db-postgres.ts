import pg from 'pg';
import bcrypt from 'bcryptjs';
import {
  Database,
  DEFAULT_LEAVE_ENTITLEMENT,
  defaultSettings,
  defaultPlatformSettings,
  normalizeBalance,
  seedDefaults,
  LEGACY_COMPANY_ID,
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
 *
 * ## Multi-tenant
 *
 * Every per-tenant table carries `companyId` inside its own `data` JSONB
 * blob — no schema change beyond an expression index — and every read/write
 * goes through `tenantCollection()`, which filters/stamps it the same way
 * `database.ts`'s JSON backend's `scoped()`/`findScoped()` do. `companies`
 * and `orders` are the only genuinely cross-tenant tables, using the plain
 * `collection()` helper with no companyId at all.
 */

const { Pool } = pg;

/** Collections stored as (id, seq, data). `desc` mirrors the old `unshift`. */
const COLLECTIONS: Record<string, { desc: boolean }> = {
  companies: { desc: false },
  users: { desc: false },
  clients: { desc: false },
  services: { desc: false },
  task_types: { desc: false },
  invoices: { desc: true },
  leave_requests: { desc: false },
  absence_authorizations: { desc: false },
  loans: { desc: false },
  advances: { desc: false },
  attendance_records: { desc: false },
  referrals: { desc: true },
  time_entries: { desc: true },
  messages: { desc: false },
  task_assignments: { desc: true },
  notifications: { desc: true },
  push_subscriptions: { desc: false },
  cash_journal_entries: { desc: false },
  cash_categories: { desc: false },
  resource_templates: { desc: false },
  resource_template_items: { desc: false },
  client_resource_instances: { desc: true },
  client_resource_item_statuses: { desc: false },
  useful_links: { desc: false },
  echeance_columns: { desc: false },
  echeance_statuses: { desc: false },
  echeance_status_options: { desc: false },
  orders: { desc: true },
  sector_missions: { desc: false },
};

/** Tables scoped by companyId — everything except the genuinely global ones. */
const GLOBAL_TABLES = new Set(['companies', 'orders', 'sector_missions']);
const TENANT_TABLES = new Set(Object.keys(COLLECTIONS).filter(t => !GLOBAL_TABLES.has(t)));

/** Snapshot key -> table name. The snapshot is the old `local.db.json` shape. */
const TABLE_FOR: Record<string, string> = {
  companies: 'companies',
  users: 'users',
  clients: 'clients',
  services: 'services',
  taskTypes: 'task_types',
  invoices: 'invoices',
  leaveRequests: 'leave_requests',
  absenceAuthorizations: 'absence_authorizations',
  loans: 'loans',
  advances: 'advances',
  attendanceRecords: 'attendance_records',
  referrals: 'referrals',
  timeEntries: 'time_entries',
  messages: 'messages',
  taskAssignments: 'task_assignments',
  notifications: 'notifications',
  pushSubscriptions: 'push_subscriptions',
  cashJournalEntries: 'cash_journal_entries',
  cashCategories: 'cash_categories',
  resourceTemplates: 'resource_templates',
  resourceTemplateItems: 'resource_template_items',
  clientResourceInstances: 'client_resource_instances',
  clientResourceItemStatuses: 'client_resource_item_statuses',
  usefulLinks: 'useful_links',
  echeanceColumns: 'echeance_columns',
  echeanceStatuses: 'echeance_statuses',
  echeanceStatusOptions: 'echeance_status_options',
  orders: 'orders',
  sectorMissions: 'sector_missions',
};

function makePool(connectionString: string) {
  return new Pool({
    connectionString,
    // Managed Postgres on Render/Railway terminates TLS with a certificate the
    // Node bundle does not chain to. Verification is relaxed only for those
    // hosted URLs, never for a local one.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    // Raised from 10 after a load test showed requests queuing behind the
    // pool (tail latency into the tens of seconds past ~25 concurrent
    // requests) well before CPU/RAM were remotely stressed on the current
    // Railway plan. Managed Postgres here defaults to 100 max_connections,
    // so 50 from this single app instance still leaves headroom.
    max: 50,
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

  // leave_balances: composite key (company_id, user_id) — two different
  // companies' independently-minted numeric user ids can otherwise collide.
  await q(`CREATE TABLE IF NOT EXISTS leave_balances (
    company_id  TEXT NOT NULL DEFAULT '${LEGACY_COMPANY_ID}',
    user_id     BIGINT NOT NULL,
    entitlement DOUBLE PRECISION NOT NULL,
    used        DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, user_id)
  )`);
  // Migrates a pre-multi-tenant table (old PK was bare user_id, no company_id
  // column at all) — a no-op once already migrated. The column has to be
  // added *before* the DO block below can back-fill or key on it; the
  // `CREATE TABLE IF NOT EXISTS` above never touches an already-existing
  // table, so on a legacy database this ADD COLUMN is the only thing that
  // ever creates it. The DEFAULT also back-fills every existing row in the
  // same statement, so the later UPDATE is normally a no-op.
  await q(`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '${LEGACY_COMPANY_ID}'`);
  await q(`DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'leave_balances' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'leave_balances_pkey'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage
        WHERE table_name = 'leave_balances' AND constraint_name = 'leave_balances_pkey' AND column_name = 'company_id'
      ) THEN
        ALTER TABLE leave_balances DROP CONSTRAINT leave_balances_pkey;
        UPDATE leave_balances SET company_id = '${LEGACY_COMPANY_ID}' WHERE company_id IS NULL;
        ALTER TABLE leave_balances ADD PRIMARY KEY (company_id, user_id);
      END IF;
    END $$;`);

  // settings: one row per company, keyed by company_id. Was a global
  // singleton (only_row BOOLEAN PRIMARY KEY CHECK(only_row)) — migrated in
  // place rather than dropped, so the legacy cabinet's own charges/company/
  // bank/logo/signature survive under company-1.
  await q(`CREATE TABLE IF NOT EXISTS settings (
    company_id      TEXT PRIMARY KEY,
    data            JSONB   NOT NULL,
    invoice_counter BIGINT  NOT NULL DEFAULT 0
  )`);
  await q(`DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'only_row') THEN
        ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_id TEXT;
        UPDATE settings SET company_id = '${LEGACY_COMPANY_ID}' WHERE company_id IS NULL;
        ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
        ALTER TABLE settings ALTER COLUMN company_id SET NOT NULL;
        ALTER TABLE settings ADD PRIMARY KEY (company_id);
        ALTER TABLE settings DROP COLUMN IF EXISTS only_row;
      END IF;
    END $$;`);
  // The legal sequence restarts at 0001 every calendar year. A row that
  // already exists (this app's own production included) must backfill the
  // *current* year here, not 0 — defaulting to 0 would make the very next
  // invoice think the year had changed and wrongly reset an in-progress
  // sequence back to 0001.
  await q(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_counter_year INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INT`);
  await q(`INSERT INTO settings (company_id, data) VALUES ($1, $2)
           ON CONFLICT (company_id) DO NOTHING`, [LEGACY_COMPANY_ID, JSON.stringify(defaultSettings())]);

  // The platform's own receiving bank details — a genuine global singleton,
  // distinct from any one company's Cash issuer settings above.
  await q(`CREATE TABLE IF NOT EXISTS platform_settings (
    only_row BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (only_row),
    data     JSONB   NOT NULL
  )`);
  await q(`INSERT INTO platform_settings (only_row, data) VALUES (TRUE, $1)
           ON CONFLICT (only_row) DO NOTHING`, [JSON.stringify(defaultPlatformSettings())]);

  // The legacy cabinet's own company row.
  await q(
    `INSERT INTO companies (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [LEGACY_COMPANY_ID, JSON.stringify({
      id: LEGACY_COMPANY_ID, name: 'Cabinet', status: 'ACTIVE', plan: 'LEGACY',
      seatLimit: 999, createdAt: new Date().toISOString(), trialEndsAt: null,
    })],
  );

  // One-time (idempotent) backfill: every pre-migration row in a tenant table
  // gets stamped with the legacy cabinet's companyId — a no-op once every row
  // already has one, so re-running it on every boot is always safe.
  for (const table of TENANT_TABLES) {
    await q(`UPDATE ${table} SET data = data || jsonb_build_object('companyId', $1::text) WHERE data->>'companyId' IS NULL`, [LEGACY_COMPANY_ID]);
  }

  // Indexes for the lookups that run on every request.
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users ((data->>'username'))`);
  await q(`CREATE INDEX IF NOT EXISTS task_types_service_idx  ON task_types ((data->>'serviceId'))`);
  await q(`CREATE INDEX IF NOT EXISTS time_entries_user_idx   ON time_entries ((data->>'userId'))`);
  await q(`CREATE INDEX IF NOT EXISTS messages_to_idx         ON messages ((data->>'toUserId'))`);
  await q(`CREATE INDEX IF NOT EXISTS task_assignments_to_idx ON task_assignments ((data->>'assignedToUserId'))`);
  await q(`CREATE INDEX IF NOT EXISTS notifications_user_idx  ON notifications ((data->>'userId'))`);
  // The endpoint identifies a push subscription everywhere: the upsert on
  // subscribe, the delete when the push service reports it gone, and the
  // lookup that authenticates a tap on a notification button.
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx ON push_subscriptions ((data->>'endpoint'))`);
  await q(`CREATE INDEX IF NOT EXISTS resource_template_items_template_idx ON resource_template_items ((data->>'templateId'))`);
  await q(`CREATE INDEX IF NOT EXISTS client_resource_instances_client_idx ON client_resource_instances ((data->>'clientId'))`);
  await q(`CREATE INDEX IF NOT EXISTS client_resource_item_statuses_instance_idx ON client_resource_item_statuses ((data->>'instanceId'))`);
  await q(`CREATE INDEX IF NOT EXISTS echeance_statuses_client_idx ON echeance_statuses ((data->>'clientId'))`);
  await q(`CREATE INDEX IF NOT EXISTS echeance_statuses_column_idx ON echeance_statuses ((data->>'columnId'))`);
  for (const table of TENANT_TABLES) {
    await q(`CREATE INDEX IF NOT EXISTS ${table}_company_idx ON ${table} ((data->>'companyId'))`);
  }
}

export async function initPostgres(connectionString: string): Promise<Database> {
  const pool = makePool(connectionString);
  const q = async (text: string, params: any[] = []) => (await pool.query(text, params)).rows;
  await ensureSchema(pool);

  /**
   * Generic CRUD over one *cross-tenant* collection (companies, orders) — no
   * companyId anywhere. The `id` column is TEXT so numeric and string ids
   * share one code path, but the id *inside* `data` keeps its original JSON
   * type — which is what lets `server.ts` keep comparing client ids with
   * `===` against numbers.
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

  /**
   * Generic CRUD over one *tenant-scoped* collection — every method takes
   * companyId and every query filters/stamps by it, mirroring
   * `database.ts`'s `scoped()`/`findScoped()`/`indexScoped()` for the JSON
   * backend. `byId`/`update`/`remove` filter by companyId in the same
   * statement as the id match, not as a separate check — a token from
   * company A can never touch a row from company B, full stop.
   */
  const tenantCollection = (table: string) => {
    const order = `ORDER BY seq ${COLLECTIONS[table].desc ? 'DESC' : 'ASC'}`;
    return {
      all: async (companyId: string) =>
        (await q(`SELECT data FROM ${table} WHERE data->>'companyId' = $1 ${order}`, [companyId])).map(r => r.data),
      byId: async (companyId: string, id: any) => {
        const rows = await q(`SELECT data FROM ${table} WHERE id = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
        return rows.length ? rows[0].data : undefined;
      },
      create: async (companyId: string, record: any) => {
        const row = { ...record, companyId };
        await q(`INSERT INTO ${table} (id, data) VALUES ($1, $2)`, [String(row.id), JSON.stringify(row)]);
        return row;
      },
      update: async (companyId: string, id: any, updates: any) => {
        const rows = await q(
          `UPDATE ${table} SET data = data || $3::jsonb WHERE id = $1 AND data->>'companyId' = $2 RETURNING data`,
          [String(id), companyId, JSON.stringify(updates)],
        );
        return rows.length ? rows[0].data : null;
      },
      remove: async (companyId: string, id: any) => {
        const res = await pool.query(`DELETE FROM ${table} WHERE id = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
        return (res.rowCount ?? 0) > 0;
      },
    };
  };

  const companies = collection('companies');
  const orders = collection('orders');
  const sectorMissions = collection('sector_missions');

  const users = tenantCollection('users');
  const clients = tenantCollection('clients');
  const services = tenantCollection('services');
  const taskTypes = tenantCollection('task_types');
  const invoices = tenantCollection('invoices');
  const leaveRequests = tenantCollection('leave_requests');
  const absences = tenantCollection('absence_authorizations');
  const loans = tenantCollection('loans');
  const advances = tenantCollection('advances');
  const attendance = tenantCollection('attendance_records');
  const referrals = tenantCollection('referrals');
  const timeEntries = tenantCollection('time_entries');
  const messages = tenantCollection('messages');
  const taskAssignments = tenantCollection('task_assignments');
  const notifications = tenantCollection('notifications');
  const pushSubscriptions = tenantCollection('push_subscriptions');
  const cashJournal = tenantCollection('cash_journal_entries');
  const cashCategories = tenantCollection('cash_categories');
  const resourceTemplates = tenantCollection('resource_templates');
  const resourceTemplateItems = tenantCollection('resource_template_items');
  const clientResourceInstances = tenantCollection('client_resource_instances');
  const clientResourceItemStatuses = tenantCollection('client_resource_item_statuses');
  const usefulLinks = tenantCollection('useful_links');
  const echeanceColumns = tenantCollection('echeance_columns');
  const echeanceStatuses = tenantCollection('echeance_statuses');
  const echeanceStatusOptions = tenantCollection('echeance_status_options');

  const db: Database = {
    // Case-insensitive: a self-serve signup's username is its email
    // (lowercased when stored), and login must still match it however the
    // visitor happens to capitalize it when typing it back in.
    getUserByUsername: async (username: string) => {
      const rows = await q(`SELECT data FROM users WHERE LOWER(data->>'username') = LOWER($1)`, [String(username)]);
      return rows.length ? rows[0].data : undefined;
    },
    getUserById: users.byId,

    getAllCompanies: companies.all,
    getCompanyById: companies.byId,
    createCompany: companies.create,
    updateCompany: companies.update,
    deleteCompany: async (id: string) => {
      // Une seule transaction : une purge à moitié faite laisserait un tenant
      // fantôme — des utilisateurs sans entreprise, ou l'inverse.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const table of TENANT_TABLES) {
          await client.query(`DELETE FROM ${table} WHERE data->>'companyId' = $1`, [id]);
        }
        // Ces deux-là ont leur propre colonne company_id, pas un champ JSON.
        await client.query('DELETE FROM leave_balances WHERE company_id = $1', [id]);
        await client.query('DELETE FROM settings WHERE company_id = $1', [id]);
        const res = await client.query('DELETE FROM companies WHERE id = $1', [id]);
        await client.query('COMMIT');
        return (res.rowCount ?? 0) > 0;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
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
    deleteService: async (companyId: string, id: number) => {
      // Cascade: a type de tâche has no meaning without its mission. One
      // transaction, so a crash can't leave orphaned types behind.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(`DELETE FROM services WHERE id = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
        await client.query(`DELETE FROM task_types WHERE data->>'serviceId' = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
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
     * A single atomic increment, per company. The JSON version read, added
     * one and wrote back, so two documents created at the same moment could
     * take the same legal number — the one thing a facture légale must
     * never do. The upsert ensures a settings row exists even for a company
     * created after boot, before its first Cash document.
     */
    nextInvoiceNumber: async (companyId: string) => {
      await q(
        `INSERT INTO settings (company_id, data, invoice_counter) VALUES ($1, $2, 0) ON CONFLICT (company_id) DO NOTHING`,
        [companyId, JSON.stringify(defaultSettings())],
      );
      // The sequence restarts at 0001 for a new calendar year — a single
      // atomic statement, so a company whose stored year has fallen behind
      // resets exactly once, with no race between the check and the write.
      const year = new Date().getFullYear();
      const rows = await q(
        `UPDATE settings
         SET invoice_counter = CASE WHEN invoice_counter_year = $2 THEN invoice_counter + 1 ELSE 1 END,
             invoice_counter_year = $2
         WHERE company_id = $1
         RETURNING invoice_counter`,
        [companyId, year],
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

    getAllLoans: loans.all,
    getLoanById: loans.byId,
    createLoan: loans.create,
    updateLoan: loans.update,

    getAllAdvances: advances.all,
    getAdvanceById: advances.byId,
    createAdvance: advances.create,
    updateAdvance: advances.update,

    getAllReferrals: referrals.all,
    createReferral: referrals.create,
    updateReferral: referrals.update,

    getAllAttendanceRecords: attendance.all,
    getAttendanceRecordById: attendance.byId,
    createAttendanceRecord: attendance.create,
    updateAttendanceRecord: attendance.update,

    // `available` stays derived — it is never a column.
    getAllLeaveBalances: async (companyId: string) =>
      (await q('SELECT user_id, entitlement, used FROM leave_balances WHERE company_id = $1 ORDER BY user_id', [companyId]))
        .map(r => normalizeBalance({ userId: Number(r.user_id), entitlement: r.entitlement, used: r.used })),
    getLeaveBalanceByUserId: async (companyId: string, userId: number) => {
      const rows = await q(
        `INSERT INTO leave_balances (company_id, user_id, entitlement, used) VALUES ($1, $2, $3, 0)
         ON CONFLICT (company_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING user_id, entitlement, used`,
        [companyId, userId, DEFAULT_LEAVE_ENTITLEMENT],
      );
      const r = rows[0];
      return normalizeBalance({ userId: Number(r.user_id), entitlement: r.entitlement, used: r.used });
    },
    updateLeaveBalance: async (companyId: string, userId: number, updates: any) => {
      // Both fields are nullable *parameters* so that an update touching only
      // `used` leaves `entitlement` alone. Passing the default instead of null
      // here would silently reset an admin-set allowance back to 20 every time
      // a leave request was approved.
      const rows = await q(
        // The ::float8 casts are required, not decorative: an untyped NULL
        // parameter is assumed to be text, and the insert fails outright.
        `INSERT INTO leave_balances (company_id, user_id, entitlement, used)
         VALUES ($1, $2, COALESCE($3::float8, $5::float8), COALESCE($4::float8, 0))
         ON CONFLICT (company_id, user_id) DO UPDATE SET
           entitlement = COALESCE($3::float8, leave_balances.entitlement),
           used        = COALESCE($4::float8, leave_balances.used)
         RETURNING user_id, entitlement, used`,
        [
          companyId,
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
    markMessagesRead: async (companyId: string, readerId: number, fromUserId: number) => {
      const res = await pool.query(
        `UPDATE messages
            SET data = data || jsonb_build_object('readAt', $4::text)
          WHERE data->>'companyId'  = $1
            AND data->>'toUserId'   = $2
            AND data->>'fromUserId' = $3
            AND data->>'readAt' IS NULL`,
        [companyId, String(readerId), String(fromUserId), new Date().toISOString()],
      );
      return res.rowCount ?? 0;
    },

    getAllTaskAssignments: taskAssignments.all,
    getTaskAssignmentById: taskAssignments.byId,
    createTaskAssignment: taskAssignments.create,
    updateTaskAssignment: taskAssignments.update,
    deleteTaskAssignment: taskAssignments.remove,

    getAllPushSubscriptionsForCompany: pushSubscriptions.all,
    getAllPushSubscriptions: async () => (await q(`SELECT data FROM push_subscriptions`)).map(r => r.data),
    createPushSubscription: async (companyId: string, subscription: any) => {
      const row = { ...subscription, companyId };
      // Upsert on the endpoint, not the id — same reason as the JSON backend.
      await q(
        `INSERT INTO push_subscriptions (id, data) VALUES ($1, $2)
         ON CONFLICT ((data->>'endpoint')) DO UPDATE SET data = EXCLUDED.data`,
        [String(row.id), JSON.stringify(row)],
      );
      return row;
    },
    deletePushSubscriptionByEndpoint: async (endpoint: string) => {
      const res = await pool.query(`DELETE FROM push_subscriptions WHERE data->>'endpoint' = $1`, [String(endpoint)]);
      return (res.rowCount ?? 0) > 0;
    },

    getAllCashJournalEntries: cashJournal.all,
    getCashJournalEntryById: cashJournal.byId,
    createCashJournalEntry: cashJournal.create,
    updateCashJournalEntry: cashJournal.update,
    deleteCashJournalEntry: cashJournal.remove,

    getAllCashCategories: cashCategories.all,
    createCashCategory: cashCategories.create,
    deleteCashCategory: cashCategories.remove,

    getAllNotifications: notifications.all,
    createNotification: notifications.create,
    updateNotification: notifications.update,

    getAllResourceTemplates: resourceTemplates.all,
    getResourceTemplateById: resourceTemplates.byId,
    createResourceTemplate: resourceTemplates.create,
    updateResourceTemplate: resourceTemplates.update,
    deleteResourceTemplate: async (companyId: string, id: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(`DELETE FROM resource_templates WHERE id = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
        await client.query(`DELETE FROM resource_template_items WHERE data->>'templateId' = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
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
    deleteClientResourceInstance: async (companyId: string, id: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(`DELETE FROM client_resource_instances WHERE id = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
        await client.query(`DELETE FROM client_resource_item_statuses WHERE data->>'instanceId' = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
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
    deleteEcheanceColumn: async (companyId: string, id: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(`DELETE FROM echeance_columns WHERE id = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
        await client.query(`DELETE FROM echeance_statuses WHERE data->>'columnId' = $1 AND data->>'companyId' = $2`, [String(id), companyId]);
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

    getAllEcheanceStatusOptions: echeanceStatusOptions.all,
    createEcheanceStatusOption: echeanceStatusOptions.create,
    updateEcheanceStatusOption: echeanceStatusOptions.update,
    deleteEcheanceStatusOption: echeanceStatusOptions.remove,

    getAllOrders: orders.all,
    createOrder: orders.create,

    getAllSectorMissions: sectorMissions.all,
    createSectorMission: sectorMissions.create,
    deleteSectorMission: sectorMissions.remove,

    getSettings: async (companyId: string) => {
      const rows = await q(
        `INSERT INTO settings (company_id, data, invoice_counter) VALUES ($1, $2::jsonb, 0)
         ON CONFLICT (company_id) DO UPDATE SET company_id = EXCLUDED.company_id
         RETURNING data, invoice_counter`,
        [companyId, JSON.stringify(defaultSettings())],
      );
      return { ...rows[0].data, invoiceCounter: Number(rows[0].invoice_counter) };
    },
    updateSettings: async (companyId: string, updates: any) => {
      const { invoiceCounter, ...rest } = updates ?? {};
      const initialData = JSON.stringify({ ...defaultSettings(), ...rest });
      const rows = await q(
        `INSERT INTO settings (company_id, data, invoice_counter) VALUES ($1, $2::jsonb, COALESCE($3::bigint, 0))
         ON CONFLICT (company_id) DO UPDATE SET
           data = settings.data || $4::jsonb,
           invoice_counter = COALESCE($3::bigint, settings.invoice_counter)
         RETURNING data, invoice_counter`,
        [companyId, initialData, typeof invoiceCounter === 'number' ? invoiceCounter : null, JSON.stringify(rest)],
      );
      return { ...rows[0].data, invoiceCounter: Number(rows[0].invoice_counter) };
    },

    getPlatformSettings: async () => {
      const rows = await q('SELECT data FROM platform_settings WHERE only_row');
      return rows[0].data;
    },
    updatePlatformSettings: async (updates: any) => {
      const rows = await q(
        `UPDATE platform_settings SET data = data || $1::jsonb WHERE only_row RETURNING data`,
        [JSON.stringify(updates)],
      );
      return rows[0].data;
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
        const companyId = b.companyId || LEGACY_COMPANY_ID;
        await client.query(
          `INSERT INTO leave_balances (company_id, user_id, entitlement, used) VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, user_id) DO UPDATE SET entitlement = EXCLUDED.entitlement, used = EXCLUDED.used`,
          [companyId, n.userId, n.entitlement, n.used],
        );
      }
      counts['leave_balances'] = (snapshot.leaveBalances ?? []).length;
      // Legacy single-settings snapshots land under company-1; newer
      // snapshots already carry `settingsByCompany`.
      const settingsRows = snapshot.settingsByCompany ?? (snapshot.settings ? [{ id: LEGACY_COMPANY_ID, ...snapshot.settings }] : []);
      for (const s of settingsRows) {
        const { id: companyId, invoiceCounter, ...rest } = s;
        await client.query(
          `INSERT INTO settings (company_id, data, invoice_counter) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (company_id) DO UPDATE SET data = $2::jsonb, invoice_counter = $3`,
          [companyId, JSON.stringify(rest), typeof invoiceCounter === 'number' ? invoiceCounter : 0],
        );
      }
      if (snapshot.platformSettings) {
        await client.query(
          `UPDATE platform_settings SET data = $1::jsonb WHERE only_row`,
          [JSON.stringify(snapshot.platformSettings)],
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
