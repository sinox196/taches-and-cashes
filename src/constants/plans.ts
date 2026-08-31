/**
 * Single source of truth for the subscription plans.
 *
 * Lu des deux côtés comme `roles.ts` et `paymentModes.ts` : la page publique
 * dessine ses cartes de tarifs à partir d'ici, la console plateforme y prend
 * ses libellés et son prix, et `server.ts` y prend les limites de sièges et la
 * liste des offres qu'une inscription a le droit de demander. Changer un prix
 * ou un nombre de sièges, c'est éditer une ligne de ce fichier.
 *
 * **Les offres retirées restent dans la liste** (`legacy: true`). Une
 * entreprise inscrite sous l'ancien catalogue porte encore `FREELANCE`,
 * `EQUIPE` ou `CROISSANCE` dans sa fiche : les effacer lui ferait perdre son
 * libellé et sa limite de sièges du jour au lendemain. Elles ne sont
 * simplement plus proposées — ni sur la page publique, ni à l'inscription.
 * Même règle que `normalizeBalance()` : on récupère la forme ancienne, on ne
 * la réécrit pas.
 */

export interface PlanMeta {
  id: string;
  /** Libellé affiché (français). */
  label: string;
  tagline: string;
  /** Prix mensuel, en dinars. */
  priceDT: number;
  /** Comptes du back-office (collaborateurs, superviseurs, administrateurs). */
  seatLimit: number;
  /** Comptes du portail client — comptés à part, voir `POST /api/users`. */
  portalSeatLimit: number;
  /** Ce que l'offre inclut, en plus du socle commun ci-dessous. */
  features: string[];
  /** Mise en avant sur la page de tarifs. */
  highlighted?: boolean;
  /** Offre retirée du catalogue : encore portée par des entreprises, plus vendue. */
  legacy?: boolean;
}

/**
 * Le socle est identique dans les trois packs : ce qui change, c'est le
 * nombre de comptes. Écrit une fois — trois copies finiraient par diverger, et
 * une carte de tarifs qui promet moins qu'une autre sur la même
 * fonctionnalité est un bug commercial.
 */
export const CORE_FEATURES: string[] = [
  'Nombre illimité de factures et de documents',
  'Clients et missions illimités',
  'Pointage : chronomètre, tâches assignées, coût employeur',
  'Cash : facturation, règlements clients, brouillard de caisse',
  'Ressources métier : modèles de documents, liens utiles, échéances',
  'RH : congés, autorisations, prêts, avances, présence',
  'Tableau de bord Direction : marge, rentabilité, alertes',
  'Messagerie interne et notifications',
  'Export Excel/CSV sur tous les tableaux',
];

export const PLANS: PlanMeta[] = [
  {
    id: 'PACK_5',
    label: 'Pack 5',
    tagline: 'Pour une petite équipe',
    priceDT: 70,
    seatLimit: 5,
    portalSeatLimit: 50,
    features: CORE_FEATURES,
  },
  {
    id: 'PACK_10',
    label: 'Pack 10',
    tagline: 'Pour un cabinet qui grandit',
    priceDT: 100,
    seatLimit: 10,
    portalSeatLimit: 100,
    features: CORE_FEATURES,
    highlighted: true,
  },
  {
    id: 'PACK_15',
    label: 'Pack 15',
    tagline: 'Pour les cabinets établis',
    priceDT: 130,
    seatLimit: 15,
    portalSeatLimit: 150,
    features: CORE_FEATURES,
  },

  // ---- Offres retirées du catalogue ----
  // Conservées pour les entreprises qui les portent déjà : leur fiche doit
  // continuer à s'afficher avec un libellé et une limite de sièges justes.
  {
    id: 'FREELANCE',
    label: 'Freelance (offre retirée)',
    tagline: 'Ancienne offre',
    priceDT: 0,
    seatLimit: 1,
    portalSeatLimit: 0,
    features: [],
    legacy: true,
  },
  {
    id: 'EQUIPE',
    label: 'Équipe (offre retirée)',
    tagline: 'Ancienne offre',
    priceDT: 50,
    seatLimit: 5,
    portalSeatLimit: 0,
    features: [],
    legacy: true,
  },
  {
    id: 'CROISSANCE',
    label: 'Croissance (offre retirée)',
    tagline: 'Ancienne offre',
    priceDT: 80,
    seatLimit: 10,
    portalSeatLimit: 0,
    features: [],
    legacy: true,
  },
];

/** Les offres réellement proposées — page de tarifs, inscription, console. */
export const SELLABLE_PLANS: PlanMeta[] = PLANS.filter(p => !p.legacy);

export const planMeta = (id: string | null | undefined): PlanMeta | null =>
  PLANS.find(p => p.id === id) || null;

/** Le libellé d'une offre, y compris inconnue — jamais un écran vide. */
export const planLabel = (id: string | null | undefined): string =>
  planMeta(id)?.label || String(id || '—');

/** Une inscription ne peut demander qu'une offre encore vendue. */
export const isSellablePlan = (id: any): boolean =>
  SELLABLE_PLANS.some(p => p.id === id);

/** L'offre par défaut quand rien n'est demandé (ou qu'une offre inconnue l'est). */
export const DEFAULT_PLAN_ID = 'PACK_5';

export const PLAN_SEAT_LIMITS: Record<string, number> =
  Object.fromEntries(PLANS.map(p => [p.id, p.seatLimit]));

export const PLAN_PORTAL_SEAT_LIMITS: Record<string, number> =
  Object.fromEntries(PLANS.map(p => [p.id, p.portalSeatLimit]));

/** « 70 DT » — le prix seul, sans période, pour un tableau ou un e-mail. */
export const formatDT = (amount: number): string =>
  `${Number(amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} DT`;

/**
 * Remise de parrainage accordée au filleul sur son abonnement — voir le bloc
 * « Parrainage » de server.ts. Ici parce que le prix remisé se calcule des
 * deux côtés : l'e-mail de RIB côté serveur, la console côté navigateur.
 */
export const REFERRAL_DISCOUNT_PERCENT = 10;

/** Le prix mensuel après remise, arrondi au millime. */
export const discountedPriceDT = (priceDT: number, percent: number): number =>
  Math.round(priceDT * (1 - (percent || 0) / 100) * 1000) / 1000;
