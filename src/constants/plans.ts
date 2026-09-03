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
  /**
   * Les vues que l'offre ouvre. **Absent = toutes** — c'est le cas des packs
   * généralistes, et c'est ce qui fait qu'ajouter une offre restreinte ne
   * touche à rien de ce qui existait. Une liste ferme tout le reste : la
   * barre latérale n'en dessine pas l'entrée, et le serveur refuse les
   * permissions qui s'y rattachent (voir `planAllowsPermission`).
   */
  modules?: PlanModule[];
  /**
   * Documents **émis** par mois pendant l'essai gratuit (les brouillons ne
   * comptent pas). Absent = pas de plafond. L'abonnement payé lève toujours
   * le plafond, quel que soit ce nombre — c'est précisément ce qu'on vend.
   */
  trialDocumentQuota?: number;
  /** Mise en avant sur la page de tarifs. */
  highlighted?: boolean;
  /**
   * L'offre n'est pas un barreau de l'échelle des sièges — c'est un autre
   * produit. La page de tarifs la place en tête et lui donne sa propre
   * couleur : quatre cartes identiques feraient lire « 30 DT » comme le pack
   * le moins cher, alors qu'elle ne vend pas la même chose.
   */
  standalone?: boolean;
  /** Offre retirée du catalogue : encore portée par des entreprises, plus vendue. */
  legacy?: boolean;
}

/**
 * Une vue de l'application, désignée par l'identifiant que porte déjà son
 * entrée de barre latérale (`mainNavItems` dans Sidebar.tsx) et la chaîne de
 * branches d'App.tsx. Le même mot des deux côtés : un troisième vocabulaire
 * pour dire « la page Cash » finirait par ne plus désigner la même page.
 */
export type PlanModule =
  | 'Dashboard' | 'Users' | 'Missions' | 'Clients' | 'Time Tracking'
  | 'Ressources' | 'Messages' | 'Cash' | 'HR' | 'Parrainage';

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

/**
 * Le pack Facturation ne promet pas le socle ci-dessus — il n'en ouvre qu'une
 * partie. Sa propre liste dit donc les deux chiffres qui le décident : ce que
 * l'essai gratuit autorise, et ce que l'abonnement lève.
 */
export const FACTURATION_FEATURES: string[] = [
  'Essai gratuit : 10 documents par mois (les brouillons ne comptent pas)',
  'Abonné : documents illimités — factures, devis, bons de livraison…',
  'Fichier clients : raison sociale, matricule fiscal, adresse',
  'Suivi trésorerie : règlements clients et brouillard de caisse',
  'Multidevises',
  'Export des données',
  'Signature intégrée',
];

export const PLANS: PlanMeta[] = [
  /**
   * L'offre facturation seule : un produit de facturation, pas le cabinet
   * complet. Elle ouvre Cash et le fichier clients qu'il faut bien pouvoir
   * facturer — pointage, RH, missions, ressources métier et tableau de bord
   * restent fermés, entrée de menu comprise. **Équipe non plus** : l'offre
   * est à un siège, il n'y a personne à gérer. Le mot de passe se change
   * alors par « mot de passe oublié », qui reste ouvert à toute offre.
   *
   * Elle est **en tête** de la liste et `standalone`, donc dessinée à part
   * sur la page de tarifs : elle ne se compare pas aux trois packs, qui sont
   * le même produit à trois tailles d'équipe.
   *
   * Son essai gratuit est plafonné à dix documents émis par mois : c'est le
   * plafond, et non une durée, que l'abonnement lève.
   */
  {
    id: 'FACTURATION',
    label: 'Facturation',
    tagline: "L'outil de facturation seul",
    priceDT: 30,
    seatLimit: 1,
    portalSeatLimit: 0,
    // Clients en tête, pas Cash : App.tsx retombe sur le premier module de
    // cette liste quand la section mémorisée est fermée par l'offre (le cas
    // par défaut d'une première connexion), et c'est le fichier clients
    // qu'on veut voir en arrivant — pas un formulaire de facture vide sans
    // dossier encore choisi.
    modules: ['Clients', 'Cash'],
    trialDocumentQuota: 10,
    features: FACTURATION_FEATURES,
    standalone: true,
  },
  /**
   * Un seul siège, ADMIN, gratuit **pour de bon** — pas un essai qui expire :
   * `POST /api/signup` la reconnaît et pose l'entreprise `ACTIVE` d'emblée,
   * sans `trialEndsAt`, pour qu'`expireTrialIfDue` n'ait jamais prise dessus
   * et que `documentQuotaFor()` rende `null` (aucun plafond de documents)
   * comme pour n'importe quel abonnement payé. Elle ouvre les mêmes vues que
   * les packs — `modules` absent — donc un indépendant seul y trouve tout le
   * cabinet, juste sans personne à ajouter (le siège unique fait déjà ce que
   * `seatLimitError()` ferait à la main).
   */
  {
    id: 'FREELANCER',
    label: 'Freelancer',
    tagline: 'Pour un indépendant, seul',
    priceDT: 0,
    seatLimit: 1,
    portalSeatLimit: 0,
    features: CORE_FEATURES,
  },
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

/**
 * À quelle vue se rattache chaque permission.
 *
 * C'est ce qui permet à une offre restreinte de fermer une vue *et* les
 * routes qui la servent, sans écrire la liste des permissions dans chaque
 * offre. La table est exhaustive à dessein : une permission absente est
 * **refusée** sur une offre restreinte (`planAllowsPermission`), donc une
 * permission ajoutée demain naît fermée pour ces offres-là plutôt que de
 * s'ouvrir en silence — la même règle de liste blanche que le portail client.
 */
export const PERMISSION_MODULE: Record<string, PlanModule> = {
  VIEW: 'Time Tracking', EDIT: 'Time Tracking', MODIFY: 'Time Tracking',
  DELETE: 'Time Tracking', ASSIGN_TASKS: 'Time Tracking',

  MANAGE_USERS: 'Users', MANAGE_PRESENCE_SETTINGS: 'Users',

  MANAGE_SERVICES: 'Missions',

  VIEW_CLIENTS: 'Clients', CREATE_CLIENTS: 'Clients', EDIT_CLIENTS: 'Clients',
  DELETE_CLIENTS: 'Clients', MANAGE_CLIENT_FIELDS: 'Clients',
  VIEW_CLIENT_FINANCIALS: 'Clients',

  VIEW_CASH: 'Cash', MANAGE_CASH: 'Cash',

  VIEW_HR: 'HR', CREATE_LEAVE_REQUEST: 'HR', MANAGE_LEAVE_REQUESTS: 'HR',
  CREATE_ABSENCE_AUTHORIZATION: 'HR', MANAGE_ABSENCE_AUTHORIZATIONS: 'HR',
  CREATE_LOAN_REQUEST: 'HR', MANAGE_LOANS_ADVANCES: 'HR',

  VIEW_RESOURCES: 'Ressources', MANAGE_RESOURCES: 'Ressources',
};

/** Les vues ouvertes par une offre — `null` quand elle les ouvre toutes. */
export const planModules = (planId: string | null | undefined): PlanModule[] | null =>
  planMeta(planId)?.modules ?? null;

/**
 * Une offre sans liste ouvre tout : c'est le cas des packs généralistes, et
 * c'est aussi le repli d'une offre inconnue — mieux vaut une entreprise qui
 * voit une vue de trop qu'une entreprise enfermée dehors par une fiche mal
 * remplie.
 */
export const planAllowsModule = (planId: string | null | undefined, module: PlanModule): boolean => {
  const modules = planModules(planId);
  return !modules || modules.includes(module);
};

/**
 * `ADMIN` n'est pas dans la table : ce n'est pas une vue mais le rôle
 * lui-même, utilisé comme garde de quelques routes. Il n'est jamais fermé
 * par une offre.
 */
export const planAllowsPermission = (planId: string | null | undefined, permission: string): boolean => {
  if (!planModules(planId)) return true;
  if (permission === 'ADMIN') return true;
  const module = PERMISSION_MODULE[permission];
  return !!module && planAllowsModule(planId, module);
};

/**
 * Le plafond mensuel de documents d'une entreprise : le nombre pour une
 * offre plafonnée encore en essai, `null` dès que l'abonnement est actif —
 * lever ce plafond est ce que paie l'abonnement.
 */
export const documentQuotaFor = (
  plan: string | null | undefined,
  status: string | null | undefined,
): number | null => {
  if (status === 'ACTIVE') return null;
  return planMeta(plan)?.trialDocumentQuota ?? null;
};

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
