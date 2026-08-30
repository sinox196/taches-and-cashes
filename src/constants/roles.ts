/**
 * Single source of truth for user roles.
 *
 * To add a new role, add one entry here — the user form, the role badges,
 * the dashboard headcount and the server-side checks all read from this list.
 */
export interface RoleDefinition {
  id: string;
  /** Label shown in the UI (French). */
  label: string;
  /** Counted in "Effectif" on the dashboard (i.e. an employee, not an account). */
  isStaff: boolean;
  /** Sees the admin dashboard and the KPI endpoints. */
  canViewDashboard: boolean;
  /** Can be picked as an approver for leave / absence requests. */
  canApproveHR: boolean;
  /** Tailwind classes for the role badge. */
  badgeClass: string;
  /** Show a shield icon next to the badge. */
  hasShield: boolean;
}

export const ROLES: RoleDefinition[] = [
  {
    id: 'ADMIN',
    label: 'Administrateur',
    isStaff: false,
    canViewDashboard: true,
    canApproveHR: true,
    badgeClass: 'bg-purple-100 text-purple-700',
    hasShield: true,
  },
  {
    id: 'SUPERVISEUR',
    label: 'Superviseur',
    isStaff: true,
    canViewDashboard: true,
    canApproveHR: true,
    badgeClass: 'bg-amber-100 text-amber-700',
    hasShield: true,
  },
  {
    id: 'COLLABORATOR',
    label: 'Collaborateur',
    isStaff: true,
    canViewDashboard: false,
    canApproveHR: false,
    badgeClass: 'bg-blue-100 text-blue-700',
    hasShield: false,
  },
  {
    id: 'STAGIAIRE',
    label: 'Stagiaire',
    isStaff: true,
    canViewDashboard: false,
    canApproveHR: false,
    badgeClass: 'bg-teal-100 text-teal-700',
    hasShield: false,
  },
  {
    // Le client du cabinet, pas un membre du cabinet. Il se connecte par le
    // même écran que les collaborateurs — c'est le rôle qui l'envoie sur le
    // portail au lieu du back-office — et ne voit que son propre dossier.
    // `isStaff: false` le tient hors de l'effectif et de la paie ; il n'a
    // aucune permission back-office et le garde-fou de `authenticate` lui
    // refuse toute route hors `/api/portal`.
    id: 'CLIENT',
    label: 'Client',
    isStaff: false,
    canViewDashboard: false,
    canApproveHR: false,
    badgeClass: 'bg-slate-100 text-slate-700',
    hasShield: false,
  },
];

export type Role = string;

/**
 * Le rôle qui bascule sur le portail client.
 *
 * Une constante plutôt qu'un littéral `'CLIENT'` recopié : elle sert des deux
 côtés (redirection de l'interface, périmètre du serveur) et un des deux
 * seulement corrigé serait exactement le trou que le portail ne doit pas avoir.
 */
export const CLIENT_ROLE = 'CLIENT';

/** Rôles internes au cabinet — tout sauf le client. */
export const STAFF_SIDE_ROLES: string[] = ROLES.filter((r) => r.id !== CLIENT_ROLE).map((r) => r.id);

const FALLBACK: RoleDefinition = {
  id: 'UNKNOWN',
  label: 'Inconnu',
  isStaff: false,
  canViewDashboard: false,
  canApproveHR: false,
  badgeClass: 'bg-gray-100 text-gray-600',
  hasShield: false,
};

export function roleMeta(role: string | undefined | null): RoleDefinition {
  return ROLES.find((r) => r.id === role) ?? FALLBACK;
}

export function roleLabel(role: string | undefined | null): string {
  return roleMeta(role).label;
}

/** Roles counted as headcount on the dashboard. */
export const STAFF_ROLES: string[] = ROLES.filter((r) => r.isStaff).map((r) => r.id);

/** Roles allowed to read the dashboard / KPI endpoints. */
export const DASHBOARD_ROLES: string[] = ROLES.filter((r) => r.canViewDashboard).map((r) => r.id);

/** Roles that can be selected as an HR approver. */
export const HR_APPROVER_ROLES: string[] = ROLES.filter((r) => r.canApproveHR).map((r) => r.id);
