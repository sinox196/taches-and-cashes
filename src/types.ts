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
  heureDebut: string;
  heureFin: string;
  duree: string;
  dureeSeconds: number;
  coutCalcule: string;
  hourlyRate?: number;
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
  costRatePerHour: number; // e.g. 5.812 DT / hr
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

