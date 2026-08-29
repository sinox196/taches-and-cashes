export type TaskStatus = 'COMPLETED' | 'RUNNING' | 'PAUSED';

export interface TimeEntry {
  id: string;
  userId?: number;
  userName?: string;
  date: string;
  client: string;
  clientId?: number;
  description: string;
  pole: string;
  serviceId?: number;
  /** Type de tâche within the mission, e.g. "Saisie des écritures comptables". */
  taskType?: string;
  taskTypeId?: number;
  heureDebut: string;
  heureFin: string;
  duree: string;
  dureeSeconds: number;
  coutCalcule: string;
  /** Employer hourly cost of the collaborator. null = not configured for them. */
  hourlyRate?: number | null;
  statut: TaskStatus;
  /**
   * Which 2h milestone of this task's duration the overtime alert has already
   * asked about — 1 once it has asked at 2h, 2 at 4h, and so on. Held on the
   * entry rather than in the browser so the prompt follows the task, not the
   * device, and so reopening the app never re-asks about a milestone already
   * answered.
   */
  overtimeAckCycle?: number;
  /**
   * The kind of device the task was *started* from, stamped server-side from
   * the request. Never rewritten — editing a task later from a laptop does
   * not change where it was started.
   */
  createdVia?: 'MOBILE' | 'DESKTOP';
  /**
   * Le travail est-il refacturable au client ? Figé à la création depuis
   * `client.nonFacturable`. Le coût employeur reste calculé — il est réel —
   * mais il ne sera couvert par aucun honoraire.
   */
  facturable?: boolean;
  /** The device, person and time of the most recent change to this entry. */
  lastEditedVia?: 'MOBILE' | 'DESKTOP';
  lastEditedBy?: number;
  /** Resolved server-side in enrichEntries, off the same user map as userName. */
  lastEditedByName?: string;
  lastEditedAt?: string;
}

export interface ActiveTimerState {
  id?: string;
  client: string;
  clientId?: number;
  task: string;
  pole: string;
  /** Type de tâche picked under the mission, when the mission defines any. */
  taskType?: string;
  serviceId?: number;
  startTime: string;
  elapsedSeconds: number;
  isRunning: boolean;
  /** Employer hourly cost, in DT/h. null when not configured for this user. */
  costRatePerHour: number | null;
}

export interface ClientOption {
  id: string | number;
  name: string;
}

export interface ServiceOption {
  id: string | number;
  name: string;
  pole?: string;
  clientId?: number | null;
}

/** A type de tâche belongs to exactly one mission (service). */
export interface TaskTypeOption {
  id: number;
  name: string;
  serviceId: number;
}

// HR Types
export type HRRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: number;
  userId: number;
  type: 'Congé annuel' | 'Congé maladie' | 'Congé exceptionnel' | 'Autre';
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  duration: number; // in days
  reason: string;
  status: HRRequestStatus;
  createdAt: string;
  updatedAt: string;
  approverId: number; // Selected approver
  approvedBy?: number; // Actual approver
  approvedAt?: string;
  approverComment?: string;
  rejectionReason?: string; // Keep for backward compatibility
}

export interface AbsenceAuthorization {
  id: number;
  userId: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  duration: number; // in hours
  reason: string;
  comment?: string;
  status: HRRequestStatus;
  createdAt: string;
  updatedAt: string;
  approverId: number; // Selected approver
  approvedBy?: number; // Actual approver
  approvedAt?: string;
  approverComment?: string;
  rejectionReason?: string; // Keep for backward compatibility
}

export interface LeaveBalance {
  userId: number;
  available: number;
  used: number;
}

