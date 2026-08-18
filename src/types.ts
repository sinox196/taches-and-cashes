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
}

export interface ActiveTimerState {
  id?: string;
  client: string;
  clientId?: number;
  task: string;
  pole: string;
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
  type: 'Annual leave' | 'Sick leave' | 'Exceptional leave' | 'Other';
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

