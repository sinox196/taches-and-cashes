/**
 * The one data-access contract in the app.
 *
 * `server.ts` only ever talks to a `Database`, so the storage engine behind it
 * is swappable: a JSON file for local development, PostgreSQL once deployed.
 * Both implementations are declared to return this type, which is what stops
 * them drifting — a method added to one and forgotten in the other fails
 * `npm run lint` instead of failing in production.
 */
export interface Database {
  /**
   * Fake SQL shim kept for the two login/auth call sites. Only recognises
   * `WHERE username = ?` and `WHERE id = ?` over users; anything else is null.
   */
  get(sql: string, param: any): Promise<any>;

  getAllUsers(): Promise<any[]>;
  createUser(user: any): Promise<any>;
  updateUser(id: number, updates: any): Promise<any | null>;
  deleteUser(id: number): Promise<boolean>;

  getAllClients(): Promise<any[]>;
  getClientById(id: number): Promise<any | undefined>;
  createClient(client: any): Promise<any>;
  updateClient(id: number, updates: any): Promise<any | null>;
  deleteClient(id: number): Promise<boolean>;

  getAllServices(): Promise<any[]>;
  getServiceById(id: number): Promise<any | undefined>;
  createService(service: any): Promise<any>;
  updateService(id: number, updates: any): Promise<any | null>;
  /** Cascades to the mission's types de tâches. */
  deleteService(id: number): Promise<boolean>;

  getAllTaskTypes(): Promise<any[]>;
  getTaskTypeById(id: number): Promise<any | undefined>;
  createTaskType(taskType: any): Promise<any>;
  updateTaskType(id: number, updates: any): Promise<any | null>;
  deleteTaskType(id: number): Promise<boolean>;

  getAllInvoices(): Promise<any[]>;
  getInvoiceById(id: string): Promise<any | undefined>;
  createInvoice(invoice: any): Promise<any>;
  updateInvoice(id: string, updates: any): Promise<any | null>;
  deleteInvoice(id: string): Promise<boolean>;
  /** Next legal-sequence number, zero-padded to 4 digits. Reserved atomically. */
  nextInvoiceNumber(): Promise<string>;

  getAllLeaveRequests(): Promise<any[]>;
  getLeaveRequestById(id: number): Promise<any | undefined>;
  createLeaveRequest(leave: any): Promise<any>;
  updateLeaveRequest(id: number, updates: any): Promise<any | null>;

  getAllAbsenceAuthorizations(): Promise<any[]>;
  getAbsenceAuthorizationById(id: number): Promise<any | undefined>;
  createAbsenceAuthorization(auth: any): Promise<any>;
  updateAbsenceAuthorization(id: number, updates: any): Promise<any | null>;

  getAllLeaveBalances(): Promise<any[]>;
  getLeaveBalanceByUserId(userId: number): Promise<any>;
  updateLeaveBalance(userId: number, updates: any): Promise<any>;

  getAllTimeEntries(): Promise<any[]>;
  getTimeEntryById(id: string): Promise<any | undefined>;
  createTimeEntry(entry: any): Promise<any>;
  updateTimeEntry(id: string, updates: any): Promise<any | null>;
  deleteTimeEntry(id: string): Promise<boolean>;

  getAllMessages(): Promise<any[]>;
  createMessage(message: any): Promise<any>;
  markMessagesRead(readerId: number, fromUserId: number): Promise<number>;

  /** A mission + type de tâche an admin hands to a collaborator to work on. */
  getAllTaskAssignments(): Promise<any[]>;
  getTaskAssignmentById(id: string): Promise<any | undefined>;
  createTaskAssignment(assignment: any): Promise<any>;
  updateTaskAssignment(id: string, updates: any): Promise<any | null>;
  deleteTaskAssignment(id: string): Promise<boolean>;

  /** Generic per-user notifications — new message, task assigned, HR events. */
  getAllNotifications(): Promise<any[]>;
  createNotification(notification: any): Promise<any>;
  updateNotification(id: string, updates: any): Promise<any | null>;

  // Ressources Métier — the reusable "template -> client instance" engine
  // shared by documents à fournir and procédures (differentiated by `type`).
  getAllResourceTemplates(): Promise<any[]>;
  getResourceTemplateById(id: string): Promise<any | undefined>;
  createResourceTemplate(template: any): Promise<any>;
  updateResourceTemplate(id: string, updates: any): Promise<any | null>;
  /** Cascades to the template's items. */
  deleteResourceTemplate(id: string): Promise<boolean>;

  getAllResourceTemplateItems(): Promise<any[]>;
  createResourceTemplateItem(item: any): Promise<any>;
  updateResourceTemplateItem(id: string, updates: any): Promise<any | null>;
  deleteResourceTemplateItem(id: string): Promise<boolean>;

  /** A template affected to a client — a frozen copy, per §3.5 of the cahier des charges. */
  getAllClientResourceInstances(): Promise<any[]>;
  getClientResourceInstanceById(id: string): Promise<any | undefined>;
  createClientResourceInstance(instance: any): Promise<any>;
  updateClientResourceInstance(id: string, updates: any): Promise<any | null>;
  /** Cascades to the instance's item statuses. */
  deleteClientResourceInstance(id: string): Promise<boolean>;

  getAllClientResourceItemStatuses(): Promise<any[]>;
  createClientResourceItemStatus(status: any): Promise<any>;
  updateClientResourceItemStatus(id: string, updates: any): Promise<any | null>;

  getAllUsefulLinks(): Promise<any[]>;
  createUsefulLink(link: any): Promise<any>;
  updateUsefulLink(id: string, updates: any): Promise<any | null>;
  deleteUsefulLink(id: string): Promise<boolean>;

  /** Suivi mensuel des échéances — a named column (year, month, label) on the grid. */
  getAllEcheanceColumns(): Promise<any[]>;
  createEcheanceColumn(column: any): Promise<any>;
  updateEcheanceColumn(id: string, updates: any): Promise<any | null>;
  /** Cascades to every client's status cell for this column. */
  deleteEcheanceColumn(id: string): Promise<boolean>;

  /** One status cell per (clientId, columnId); absent = vide. */
  getAllEcheanceStatuses(): Promise<any[]>;
  createEcheanceStatus(status: any): Promise<any>;
  updateEcheanceStatus(id: string, updates: any): Promise<any | null>;

  /** The fixed-vocabulary options a status cell can be set to — admin-editable, not hardcoded. */
  getAllEcheanceStatusOptions(): Promise<any[]>;
  createEcheanceStatusOption(option: any): Promise<any>;
  updateEcheanceStatusOption(id: string, updates: any): Promise<any | null>;
  deleteEcheanceStatusOption(id: string): Promise<boolean>;

  getSettings(): Promise<any>;
  updateSettings(updates: any): Promise<any>;

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

export const emptyDb = () => ({
  users: [],
  clients: [],
  services: [],
  // Types de tâches — each belongs to a mission (service) via serviceId.
  taskTypes: [],
  // Cash / facturation documents.
  invoices: [],
  leaveRequests: [],
  absenceAuthorizations: [],
  leaveBalances: [],
  timeEntries: [],
  // Direct messages between two users (chat).
  messages: [],
  // Mission + type de tâche handed by an admin to a collaborator.
  taskAssignments: [],
  // Per-user notifications: new message, task assigned, HR events.
  notifications: [],
  // Ressources Métier — see the interface comments above for what each holds.
  resourceTemplates: [],
  resourceTemplateItems: [],
  clientResourceInstances: [],
  clientResourceItemStatuses: [],
  usefulLinks: [],
  echeanceColumns: [],
  echeanceStatuses: [],
  echeanceStatusOptions: [],
  settings: defaultSettings(),
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
  'VIEW_RESOURCES', 'MANAGE_RESOURCES',
];

export const COLLAB_PERMISSIONS = [
  'VIEW', 'EDIT', 'MODIFY', 'DELETE', 'VIEW_CLIENTS',
  'VIEW_HR', 'CREATE_LEAVE_REQUEST', 'CREATE_ABSENCE_AUTHORIZATION',
  'VIEW_RESOURCES',
];

/**
 * Seeds the two default accounts if they are absent.
 *
 * Written against the `Database` interface rather than against one engine's
 * internals, so the JSON file and PostgreSQL seed identically and there is only
 * one copy of this logic to keep correct.
 *
 * The ids are fixed at 1 and 2 deliberately: with `Date.now()` ids, reseeding
 * silently invalidated every issued JWT and every request came back 401.
 *
 * An account that already exists is left completely alone. The previous code
 * topped up its permissions on every boot, which would undo an admin who had
 * deliberately revoked one from `collab` — it grew as one-off dev migrations
 * and has no purpose on a real deployment, where the accounts arrive already
 * populated from the import.
 */
export async function seedDefaults(
  db: Database,
  bcrypt: { hash(s: string, rounds: number): Promise<string> },
) {
  const ensure = async (
    id: number,
    username: string,
    password: string,
    role: string,
    permissions: string[],
  ) => {
    if (await db.get('SELECT * FROM users WHERE username = ?', username)) return;
    await db.createUser({
      id,
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
