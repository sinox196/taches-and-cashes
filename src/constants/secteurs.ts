/**
 * Secteur d'activité, picked once at self-serve signup (POST /api/signup).
 * Shared between the client (form + permission gating in AuthContext) and
 * the server (same gating in requirePermission) so the two can't drift —
 * the same reason roles.ts is a single list read by both sides.
 */
export type Secteur = 'CABINET' | 'AUTRE';

export const SECTEURS: { id: Secteur; label: string }[] = [
  { id: 'CABINET', label: 'Comptabilité, Fiscalité, Audit & Conseil aux entreprises' },
  { id: 'AUTRE', label: 'Autres professions de services' },
];

/**
 * Ressources Métier's own seed content (SARL/SUARL formation checklists,
 * CNSS échéances, ...) is specific to accounting/tax cabinets — so unlike
 * every other module, access to it is gated by the company's secteur, not
 * just by a user's permission. A company outside the cabinet's own secteur
 * never sees it, admin included.
 */
export const RESOURCES_PERMISSIONS = new Set(['VIEW_RESOURCES', 'MANAGE_RESOURCES']);

export function companyHasResourcesModule(secteur: string | null | undefined): boolean {
  return secteur !== 'AUTRE';
}
