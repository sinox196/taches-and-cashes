/**
 * The one data-access contract in the app.
 *
 * `server.ts` only ever talks to a `Database`, so the storage engine behind it
 * is swappable: a JSON file for local development, PostgreSQL once deployed.
 * Both implementations are declared to return this type, which is what stops
 * them drifting — a method added to one and forgotten in the other fails
 * `npm run lint` instead of failing in production.
 *
 * Multi-tenant: every per-tenant method takes `companyId` as its first
 * argument — a required positional parameter rather than an options bag,
 * deliberately, so a forgotten companyId at a call site is a `tsc --noEmit`
 * error instead of a silent cross-tenant leak. `companies`, and the two named
 * user lookups below, are the only genuinely cross-tenant surfaces.
 */
export interface Database {
  /** Global — needed pre-auth at login, before any companyId is known. Username uniqueness is global by design (see CLAUDE.md). */
  getUserByUsername(username: string): Promise<any | undefined>;
  /** Company-scoped — the single most important tenant-isolation guarantee: a token from company A can never resolve a user row from company B, even if ids collide. */
  getUserById(companyId: string, id: number): Promise<any | undefined>;

  getAllCompanies(): Promise<any[]>;
  getCompanyById(id: string): Promise<any | undefined>;
  createCompany(company: any): Promise<any>;
  updateCompany(id: string, updates: any): Promise<any | null>;
  /**
   * Supprime une entreprise ET tout ce qui lui appartient : utilisateurs,
   * clients, temps, factures, caisse, ressources, RH, paramètres. Irréversible.
   * `orders` n'est pas touché — une demande d'accès précède l'entreprise et ne
   * porte pas de companyId.
   */
  deleteCompany(id: string): Promise<boolean>;

  getAllUsers(companyId: string): Promise<any[]>;
  createUser(companyId: string, user: any): Promise<any>;
  updateUser(companyId: string, id: number, updates: any): Promise<any | null>;
  deleteUser(companyId: string, id: number): Promise<boolean>;

  getAllClients(companyId: string): Promise<any[]>;
  getClientById(companyId: string, id: number): Promise<any | undefined>;
  createClient(companyId: string, client: any): Promise<any>;
  updateClient(companyId: string, id: number, updates: any): Promise<any | null>;
  deleteClient(companyId: string, id: number): Promise<boolean>;

  getAllServices(companyId: string): Promise<any[]>;
  getServiceById(companyId: string, id: number): Promise<any | undefined>;
  createService(companyId: string, service: any): Promise<any>;
  updateService(companyId: string, id: number, updates: any): Promise<any | null>;
  /** Cascades to the mission's types de tâches. */
  deleteService(companyId: string, id: number): Promise<boolean>;

  getAllTaskTypes(companyId: string): Promise<any[]>;
  getTaskTypeById(companyId: string, id: number): Promise<any | undefined>;
  createTaskType(companyId: string, taskType: any): Promise<any>;
  updateTaskType(companyId: string, id: number, updates: any): Promise<any | null>;
  deleteTaskType(companyId: string, id: number): Promise<boolean>;

  getAllInvoices(companyId: string): Promise<any[]>;
  getInvoiceById(companyId: string, id: string): Promise<any | undefined>;
  createInvoice(companyId: string, invoice: any): Promise<any>;
  updateInvoice(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteInvoice(companyId: string, id: string): Promise<boolean>;
  /** Next legal-sequence number for this company, zero-padded to 4 digits. Reserved atomically. */
  nextInvoiceNumber(companyId: string): Promise<string>;

  getAllLeaveRequests(companyId: string): Promise<any[]>;
  getLeaveRequestById(companyId: string, id: number): Promise<any | undefined>;
  createLeaveRequest(companyId: string, leave: any): Promise<any>;
  updateLeaveRequest(companyId: string, id: number, updates: any): Promise<any | null>;

  getAllAbsenceAuthorizations(companyId: string): Promise<any[]>;
  getAbsenceAuthorizationById(companyId: string, id: number): Promise<any | undefined>;
  createAbsenceAuthorization(companyId: string, auth: any): Promise<any>;
  updateAbsenceAuthorization(companyId: string, id: number, updates: any): Promise<any | null>;

  getAllLoans(companyId: string): Promise<any[]>;
  getLoanById(companyId: string, id: number): Promise<any | undefined>;
  createLoan(companyId: string, loan: any): Promise<any>;
  updateLoan(companyId: string, id: number, updates: any): Promise<any | null>;

  getAllAdvances(companyId: string): Promise<any[]>;
  getAdvanceById(companyId: string, id: number): Promise<any | undefined>;
  createAdvance(companyId: string, advance: any): Promise<any>;
  updateAdvance(companyId: string, id: number, updates: any): Promise<any | null>;

  /** Parrainage — une ligne par filleul inscrit via le lien d'une entreprise. */
  getAllReferrals(companyId: string): Promise<any[]>;
  createReferral(companyId: string, referral: any): Promise<any>;
  /** La ligne passe de PENDING à CONFIRMED quand le filleul paie son abonnement. */
  updateReferral(companyId: string, id: string, updates: any): Promise<any | null>;

  /** Daily check-in/check-out (pointage), one row per (user, date). */
  getAllAttendanceRecords(companyId: string): Promise<any[]>;
  getAttendanceRecordById(companyId: string, id: number): Promise<any | undefined>;
  createAttendanceRecord(companyId: string, record: any): Promise<any>;
  updateAttendanceRecord(companyId: string, id: number, updates: any): Promise<any | null>;

  getAllLeaveBalances(companyId: string): Promise<any[]>;
  getLeaveBalanceByUserId(companyId: string, userId: number): Promise<any>;
  updateLeaveBalance(companyId: string, userId: number, updates: any): Promise<any>;

  getAllTimeEntries(companyId: string): Promise<any[]>;
  getTimeEntryById(companyId: string, id: string): Promise<any | undefined>;
  createTimeEntry(companyId: string, entry: any): Promise<any>;
  updateTimeEntry(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteTimeEntry(companyId: string, id: string): Promise<boolean>;

  getAllMessages(companyId: string): Promise<any[]>;
  createMessage(companyId: string, message: any): Promise<any>;
  markMessagesRead(companyId: string, readerId: number, fromUserId: number): Promise<number>;

  /** A mission + type de tâche an admin hands to a collaborator to work on. */
  getAllTaskAssignments(companyId: string): Promise<any[]>;
  getTaskAssignmentById(companyId: string, id: string): Promise<any | undefined>;
  createTaskAssignment(companyId: string, assignment: any): Promise<any>;
  updateTaskAssignment(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteTaskAssignment(companyId: string, id: string): Promise<boolean>;

  /** Generic per-user notifications — new message, task assigned, HR events. */
  /**
   * Web Push subscriptions, one row per device. `getAllPushSubscriptions` is
   * the one legitimately cross-tenant read in the interface: the chronometer
   * push job sweeps every company, then fans each push out to that
   * subscription's own owner.
   */
  getAllPushSubscriptionsForCompany(companyId: string): Promise<any[]>;
  getAllPushSubscriptions(): Promise<any[]>;
  createPushSubscription(companyId: string, subscription: any): Promise<any>;
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean>;

  /**
   * Brouillard de caisse — the cash daybook. Each row is one movement:
   * `entree` (money in) or `sortie` (money out). A row with an `entree` tied
   * to a client is what feeds that client's encaissements in the Clients
   * view, so the two are never entered twice.
   */
  getAllCashJournalEntries(companyId: string): Promise<any[]>;
  getCashJournalEntryById(companyId: string, id: string): Promise<any | undefined>;
  createCashJournalEntry(companyId: string, entry: any): Promise<any>;
  updateCashJournalEntry(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteCashJournalEntry(companyId: string, id: string): Promise<boolean>;

  /**
   * The picklist of "objets" in the brouillard (Transport, Loyer, STEG…).
   * A collection rather than a hardcoded array because the cabinet adds its
   * own — the same reason `echeanceStatusOption` is admin-editable.
   */
  getAllCashCategories(companyId: string): Promise<any[]>;
  createCashCategory(companyId: string, category: any): Promise<any>;
  deleteCashCategory(companyId: string, id: string): Promise<boolean>;

  getAllNotifications(companyId: string): Promise<any[]>;
  createNotification(companyId: string, notification: any): Promise<any>;
  updateNotification(companyId: string, id: string, updates: any): Promise<any | null>;

  // Ressources Métier — the reusable "template -> client instance" engine
  // shared by documents à fournir and procédures (differentiated by `type`).
  getAllResourceTemplates(companyId: string): Promise<any[]>;
  getResourceTemplateById(companyId: string, id: string): Promise<any | undefined>;
  createResourceTemplate(companyId: string, template: any): Promise<any>;
  updateResourceTemplate(companyId: string, id: string, updates: any): Promise<any | null>;
  /** Cascades to the template's items. */
  deleteResourceTemplate(companyId: string, id: string): Promise<boolean>;

  getAllResourceTemplateItems(companyId: string): Promise<any[]>;
  createResourceTemplateItem(companyId: string, item: any): Promise<any>;
  updateResourceTemplateItem(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteResourceTemplateItem(companyId: string, id: string): Promise<boolean>;

  /** A template affected to a client — a frozen copy, per §3.5 of the cahier des charges. */
  getAllClientResourceInstances(companyId: string): Promise<any[]>;
  getClientResourceInstanceById(companyId: string, id: string): Promise<any | undefined>;
  createClientResourceInstance(companyId: string, instance: any): Promise<any>;
  updateClientResourceInstance(companyId: string, id: string, updates: any): Promise<any | null>;
  /** Cascades to the instance's item statuses. */
  deleteClientResourceInstance(companyId: string, id: string): Promise<boolean>;

  getAllClientResourceItemStatuses(companyId: string): Promise<any[]>;
  createClientResourceItemStatus(companyId: string, status: any): Promise<any>;
  updateClientResourceItemStatus(companyId: string, id: string, updates: any): Promise<any | null>;

  getAllUsefulLinks(companyId: string): Promise<any[]>;
  createUsefulLink(companyId: string, link: any): Promise<any>;
  updateUsefulLink(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteUsefulLink(companyId: string, id: string): Promise<boolean>;

  /** Suivi mensuel des échéances — a named column (year, month, label) on the grid. */
  getAllEcheanceColumns(companyId: string): Promise<any[]>;
  createEcheanceColumn(companyId: string, column: any): Promise<any>;
  updateEcheanceColumn(companyId: string, id: string, updates: any): Promise<any | null>;
  /** Cascades to every client's status cell for this column. */
  deleteEcheanceColumn(companyId: string, id: string): Promise<boolean>;

  /** One status cell per (clientId, columnId); absent = vide. */
  getAllEcheanceStatuses(companyId: string): Promise<any[]>;
  createEcheanceStatus(companyId: string, status: any): Promise<any>;
  updateEcheanceStatus(companyId: string, id: string, updates: any): Promise<any | null>;

  /** The fixed-vocabulary options a status cell can be set to — admin-editable, not hardcoded. */
  getAllEcheanceStatusOptions(companyId: string): Promise<any[]>;
  createEcheanceStatusOption(companyId: string, option: any): Promise<any>;
  updateEcheanceStatusOption(companyId: string, id: string, updates: any): Promise<any | null>;
  deleteEcheanceStatusOption(companyId: string, id: string): Promise<boolean>;

  /** A "Créer un compte" / "Essai gratuit" lead from the public landing page — global, pre-account. */
  getAllOrders(): Promise<any[]>;
  createOrder(order: any): Promise<any>;

  /**
   * Le catalogue de missions par défaut d'un secteur — **global**, pas
   * rattaché à une entreprise : c'est le modèle dont chaque nouvelle
   * entreprise du secteur reçoit une copie. Une ligne par mission,
   * `{ id, secteur, name, taskTypes: string[], sortOrder }`.
   */
  getAllSectorMissions(): Promise<any[]>;
  createSectorMission(mission: any): Promise<any>;
  deleteSectorMission(id: string): Promise<boolean>;

  getSettings(companyId: string): Promise<any>;
  updateSettings(companyId: string, updates: any): Promise<any>;

  /** Platform's own receiving bank details, shown to a trial company deciding to pay — a global singleton, distinct from any company's own Cash issuer settings. */
  getPlatformSettings(): Promise<any>;
  updatePlatformSettings(updates: any): Promise<any>;

  /** Releases the connection pool. Only meaningful for the Postgres backend. */
  close?(): Promise<void>;
}

/** Annual leave allowance given to a user who has never been configured. */
export const DEFAULT_LEAVE_ENTITLEMENT = 20;

/**
 * Default employer charge rates — those a Tunisian services provider actually
 * pays. Per-user values in the Users form override them; this is the seed.
 */
export const defaultSettings = () => ({
  employerCharges: {
    cnss: 16.57,
    tfp: 2.0,
    foprolos: 1.0,
    accidentTravail: 0.5,
  },
});

export const defaultPlatformSettings = () => ({
  bankName: '',
  iban: '',
  rib: '',
  swift: '',
  instructions: '',
});

/** The one company that existed before multi-tenancy — every pre-migration row and the two seeded accounts belong to it. */
export const LEGACY_COMPANY_ID = 'company-1';

/** Free-trial length for a newly signed-up company, per the sales-call-then-convert flow. */
export const TRIAL_DAYS = 30;

/**
 * Les offres, leurs prix et leurs limites de sièges vivent dans
 * [src/constants/plans.ts](../constants/plans.ts) — une seule liste, lue par
 * la page publique, la console plateforme et le serveur. Ré-exportée ici pour
 * que le reste du serveur continue de l'importer d'un seul endroit.
 */
export { PLAN_SEAT_LIMITS, PLAN_PORTAL_SEAT_LIMITS } from '../constants/plans.js';

export const emptyDb = () => ({
  companies: [],
  users: [],
  clients: [],
  services: [],
  // Types de tâches — each belongs to a mission (service) via serviceId.
  taskTypes: [],
  // Cash / facturation documents.
  invoices: [],
  leaveRequests: [],
  absenceAuthorizations: [],
  // Gestion des prêts et avances — collaborator-initiated request/approval
  // workflow, same shape as leaves/absences.
  loans: [],
  advances: [],
  // Daily check-in/check-out (pointage), one row per (user, date).
  attendanceRecords: [],
  // Parrainage : une ligne par filleul inscrit, portée par le parrain.
  referrals: [],
  // Catalogue de missions par défaut d'un secteur — global, voir Database.
  sectorMissions: [],
  leaveBalances: [],
  timeEntries: [],
  // Direct messages between two users (chat).
  messages: [],
  // Mission + type de tâche handed by an admin to a collaborator.
  taskAssignments: [],
  // Per-user notifications: new message, task assigned, HR events.
  notifications: [],
  // Web Push subscriptions, one per device — how a running chronometer
  // reaches a phone whose browser is closed.
  pushSubscriptions: [],
  // Brouillard de caisse — one row per cash movement (entrée / sortie).
  cashJournalEntries: [],
  // The picklist of objets used by those rows.
  cashCategories: [],
  // Ressources Métier — see the interface comments above for what each holds.
  resourceTemplates: [],
  resourceTemplateItems: [],
  clientResourceInstances: [],
  clientResourceItemStatuses: [],
  usefulLinks: [],
  echeanceColumns: [],
  echeanceStatuses: [],
  echeanceStatusOptions: [],
  orders: [],
  settingsByCompany: [],
  platformSettings: defaultPlatformSettings(),
});

/**
 * A leave balance is stored as { entitlement, used }; `available` is always
 * derived, never stored. Older rows stored a decrementing `available` instead —
 * for those the annual allowance is recovered as available + used.
 */
export function normalizeBalance(b: any) {
  const used = typeof b.used === 'number' ? b.used : 0;
  const entitlement =
    typeof b.entitlement === 'number'
      ? b.entitlement
      : typeof b.available === 'number'
        ? b.available + used
        : DEFAULT_LEAVE_ENTITLEMENT;
  return { userId: b.userId, entitlement, used, available: entitlement - used };
}

export const ADMIN_PERMISSIONS = [
  'VIEW', 'EDIT', 'MODIFY', 'DELETE', 'MANAGE_USERS',
  'VIEW_CLIENTS', 'CREATE_CLIENTS', 'EDIT_CLIENTS', 'DELETE_CLIENTS',
  'MANAGE_CLIENT_FIELDS', 'MANAGE_SERVICES', 'VIEW_CASH', 'MANAGE_CASH',
  'MANAGE_PRESENCE_SETTINGS', 'ASSIGN_TASKS',
  'VIEW_HR', 'CREATE_LEAVE_REQUEST', 'MANAGE_LEAVE_REQUESTS',
  'CREATE_ABSENCE_AUTHORIZATION', 'MANAGE_ABSENCE_AUTHORIZATIONS',
  'CREATE_LOAN_REQUEST', 'MANAGE_LOANS_ADVANCES',
  'VIEW_RESOURCES', 'MANAGE_RESOURCES',
];

export const COLLAB_PERMISSIONS = [
  'VIEW', 'EDIT', 'MODIFY', 'DELETE', 'VIEW_CLIENTS',
  'VIEW_HR', 'CREATE_LEAVE_REQUEST', 'CREATE_ABSENCE_AUTHORIZATION',
  'CREATE_LOAN_REQUEST',
  'VIEW_RESOURCES',
];

/**
 * Seeds the legacy cabinet's company + its two default accounts if absent.
 *
 * `company-1` and the fixed user ids 1/2 are deliberate: this is what lets a
 * JWT issued before the multi-tenant migration keep resolving correctly
 * afterward (see `authenticate` in server.ts, which defaults a missing
 * `companyId` claim to `'company-1'`) — reseeding with fresh ids would
 * silently invalidate every issued token the same way `Date.now()` ids
 * always have here.
 *
 * An account that already exists is left completely alone — this must not
 * top up permissions on every boot, which would undo an admin's deliberate
 * revocation.
 */
export async function seedDefaults(
  db: Database,
  bcrypt: { hash(s: string, rounds: number): Promise<string> },
) {
  if (!(await db.getCompanyById(LEGACY_COMPANY_ID))) {
    await db.createCompany({
      id: LEGACY_COMPANY_ID,
      name: 'Cabinet',
      status: 'ACTIVE',
      plan: 'LEGACY',
      seatLimit: 999,
      createdAt: new Date().toISOString(),
      trialEndsAt: null,
    });
  }

  const ensure = async (
    id: number,
    username: string,
    password: string,
    role: string,
    permissions: string[],
  ) => {
    if (await db.getUserByUsername(username)) return;
    await db.createUser(LEGACY_COMPANY_ID, {
      id,
      companyId: LEGACY_COMPANY_ID,
      username,
      password: await bcrypt.hash(password, 10),
      role,
      permissions: JSON.stringify(permissions),
    });
    console.log(`Created default ${username} account (${username} / ${password})`);
  };

  await ensure(1, 'admin', 'admin123', 'ADMIN', ADMIN_PERMISSIONS);
  await ensure(2, 'collab', 'collab123', 'COLLABORATOR', COLLAB_PERMISSIONS);
}
