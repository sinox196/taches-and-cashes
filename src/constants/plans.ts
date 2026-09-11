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
 *
 * **Pack 5/10/15 et l'ancien pack Facturation (30 DT, un siège) ont été
 * supprimés du catalogue, pas seulement retirés (`legacy: true`)** — décision
 * explicite de l'utilisateur au moment de basculer vers le nouveau catalogue
 * ci-dessous. Toute entreprise encore inscrite sous l'un de ces identifiants
 * verra `planMeta()` renvoyer `null` : `planLabel()` retombe sur l'id brut,
 * `planAllowsModule()`/`planAllowsPermission()` retombent sur « tout
 * ouvert » (le repli déjà en place pour une offre inconnue), et la console
 * plateforme garde son option `<select>` propre à une offre `legacy`
 * seulement — une fiche sur un id qui n'existe plus du tout n'a pas cette
 * option et retombe sur le premier choix du catalogue actuel au prochain
 * changement de plan.
 */

export interface PlanMeta {
  id: string;
  /** Libellé affiché (français). */
  label: string;
  tagline: string;
  /** Prix mensuel de base, en dinars — couvre `baseSeats` sièges. */
  priceDT: number;
  /**
   * Prix par utilisateur au-delà de `baseSeats`, en dinars/mois. Absent =
   * offre à prix plat, indépendant du nombre de sièges (Freelancer, ou une
   * offre retirée du catalogue) — c'est ce champ qui distingue une offre
   * « dynamique » d'une offre à un seul prix. Voir `planPriceForSeats()`.
   */
  pricePerExtraUserDT?: number;
  /**
   * Nombre de sièges couverts par `priceDT` avant que `pricePerExtraUserDT`
   * ne s'applique. N'a de sens que si `pricePerExtraUserDT` est renseigné ;
   * vaut alors 1 pour les trois offres dynamiques du catalogue actuel.
   */
  baseSeats?: number;
  /**
   * Comptes du back-office (collaborateurs, superviseurs, administrateurs).
   * Pour une offre dynamique, c'est une valeur de repli pour l'affichage
   * catalogue seul (égale à `baseSeats`) — le nombre réellement accordé à
   * une entreprise vit sur sa fiche (`company.seatLimit`), posé au nombre
   * demandé à l'inscription ou négocié depuis la console, jamais réécrit
   * depuis cette ligne pour une offre dynamique (voir `POST /api/signup` et
   * `POST /api/platform/companies/:id/confirm` dans server.ts).
   */
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
   * couleur : quatre cartes identiques feraient lire son prix comme le pack
   * le moins cher, alors qu'elle ne vend pas la même chose. Aucune offre du
   * catalogue actuel ne s'en sert — gardé pour la prochaine qui en aura
   * besoin plutôt que retiré du type.
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
  | 'Ressources' | 'Messages' | 'Cash' | 'HR' | 'Parrainage' | 'Payroll';

/**
 * Le socle du pack Complet, qui ouvre toutes les vues : écrit une fois, pas
 * copié dans chaque offre généraliste — une carte de tarifs qui promet moins
 * qu'une autre sur la même fonctionnalité est un bug commercial.
 */
export const CORE_FEATURES: string[] = [
  'Toutes les vues de l\'application, sans exception',
  'Nombre illimité de factures et de documents',
  'Clients et missions illimités',
  'Pointage : chronomètre, tâches assignées, coût employeur',
  'Cash : facturation, règlements clients, brouillard de caisse',
  'Ressources métier : modèles de documents, liens utiles, échéances',
  'RH : congés, autorisations, prêts, avances, présence',
  'Gestion des paies : bulletins mensuels et déductions fiscales',
  'Tableau de bord Direction : marge, rentabilité, alertes',
  'Messagerie interne et notifications',
  'Export Excel/CSV sur tous les tableaux',
];

/**
 * Le pack RH & Paie n'ouvre que trois vues (Équipe, RH, Gestion des paies) —
 * sa propre liste, pas `CORE_FEATURES`, qui promet des vues qu'il ne vend pas
 * (Cash, Pointage, Ressources métier…).
 */
export const RH_PAIE_FEATURES: string[] = [
  'Ressources humaines : congés, autorisations, prêts, avances, présence',
  'Calendrier des jours fériés',
  'Gestion des paies : bulletins mensuels, barème IRPP, CNSS, CSS',
  'Déductions fiscales complètes : marié(e), enfants, parents à charge, assurance vie, CEA',
  'Gestion de l\'équipe : rôles, permissions, comptes collaborateurs',
  'Export Excel/CSV',
];

/**
 * Le pack Facturation n'ouvre que trois vues (Équipe, Clients, Cash) — même
 * raison que `RH_PAIE_FEATURES` : sa propre liste, à la mesure de ce qu'il
 * vend réellement.
 */
export const FACTURATION_FEATURES: string[] = [
  'Facturation : factures légales, devis, avoirs, conformité TVA et timbre fiscal',
  'Fichier clients : raison sociale, matricule fiscal, solde et encaissements',
  'Trésorerie : règlements clients et brouillard de caisse',
  'Multidevises',
  'Export Excel/CSV',
  'Signature intégrée',
  'Gestion de l\'équipe : rôles, permissions, comptes collaborateurs',
];

export const PLANS: PlanMeta[] = [
  /**
   * Un seul siège, ADMIN, gratuit **pour de bon** — pas un essai qui expire :
   * `POST /api/signup` la reconnaît et pose l'entreprise `ACTIVE` d'emblée,
   * sans `trialEndsAt`, pour qu'`expireTrialIfDue` n'ait jamais prise dessus
   * et que `documentQuotaFor()` rende `null` (aucun plafond de documents)
   * comme pour n'importe quel abonnement payé. Elle ouvre les mêmes vues que
   * le pack Complet — `modules` absent — donc un indépendant seul y trouve
   * tout le cabinet, juste sans personne à ajouter (le siège unique fait déjà
   * ce que `seatLimitError()` ferait à la main). **En tête du catalogue** :
   * c'est la première carte de la page de tarifs.
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
  /**
   * Équipe + RH + Gestion des paies, rien d'autre : un cabinet qui veut piloter
   * ses collaborateurs (congés, présence, bulletins) sans le reste de
   * l'application. `modules` liste HR en tête — c'est l'écran de travail
   * quotidien de cette offre, Payroll et Users venant après (la paie se
   * génère moins souvent que les congés se posent, et Users est un écran de
   * réglage, pas un écran d'usage courant).
   */
  {
    id: 'RH_PAIE',
    label: 'RH & Paie',
    tagline: 'Ressources humaines et bulletins de paie',
    priceDT: 20,
    pricePerExtraUserDT: 10,
    baseSeats: 1,
    seatLimit: 1,
    portalSeatLimit: 0,
    modules: ['HR', 'Payroll', 'Users'],
    features: RH_PAIE_FEATURES,
  },
  /**
   * Équipe + Clients + Cash : facturer et suivre la trésorerie, avec une
   * équipe à plusieurs comptes (contrairement à l'ancien pack Facturation à
   * un siège qu'il remplace). Clients en tête du `modules` et non Cash :
   * App.tsx retombe sur le premier module de cette liste quand la section
   * mémorisée est fermée par l'offre (le cas par défaut d'une première
   * connexion), et c'est le fichier clients qu'on veut voir en arrivant —
   * pas un formulaire de facture vide sans dossier encore choisi. Users en
   * dernier, même raison que pour RH & Paie ci-dessus.
   */
  {
    id: 'FACTURATION',
    label: 'Facturation',
    tagline: 'Facturation, clients et trésorerie',
    priceDT: 20,
    pricePerExtraUserDT: 10,
    baseSeats: 1,
    seatLimit: 1,
    portalSeatLimit: 0,
    modules: ['Clients', 'Cash', 'Users'],
    features: FACTURATION_FEATURES,
  },
  /**
   * Le cabinet au complet — `modules` absent, donc toutes les vues, comme
   * Freelancer mais à plusieurs comptes. C'est le pack généraliste, offre
   * par défaut d'une inscription qui ne précise rien (`DEFAULT_PLAN_ID`).
   * `baseSeats: 5` : les 50 DT couvrent d'emblée cinq utilisateurs, pas un
   * seul — à la différence de RH & Paie et Facturation, qui partent d'un
   * seul siège. Un sixième coûte le même +10 DT/utilisateur que les deux
   * autres offres dynamiques ; `planPriceForSeats()` n'a rien à savoir de
   * cette différence, elle lit `baseSeats` comme pour n'importe quelle
   * offre.
   */
  {
    id: 'COMPLET',
    label: 'Complet',
    tagline: 'Le cabinet au complet, tous les modules',
    priceDT: 50,
    pricePerExtraUserDT: 10,
    baseSeats: 5,
    seatLimit: 5,
    portalSeatLimit: 0,
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
export const DEFAULT_PLAN_ID = 'COMPLET';

export const PLAN_SEAT_LIMITS: Record<string, number> =
  Object.fromEntries(PLANS.map(p => [p.id, p.seatLimit]));

export const PLAN_PORTAL_SEAT_LIMITS: Record<string, number> =
  Object.fromEntries(PLANS.map(p => [p.id, p.portalSeatLimit]));

/**
 * Garde-fou anti-abus sur le nombre de sièges qu'une inscription publique
 * peut demander pour une offre dynamique — pas une vraie limite commerciale
 * (au-delà, la page renvoie déjà vers « offre sur mesure »). Sans lui, un
 * nombre absurde dans le corps de la requête créerait une entreprise TRIAL
 * avec un `seatLimit` déraisonnable avant même qu'un humain ne l'ait vue.
 */
export const MAX_DYNAMIC_SEATS = 200;

/**
 * Le prix mensuel d'une offre pour un nombre de sièges donné : `priceDT` tel
 * quel si l'offre n'a pas de tarif par utilisateur supplémentaire, sinon
 * `priceDT` + le nombre de sièges au-delà de `baseSeats` ×
 * `pricePerExtraUserDT`, arrondi au millime comme le reste des montants de
 * l'app. **Unique implémentation** : le calculateur de la page Tarifs, la
 * modale d'inscription, le mail de RIB et la confirmation de paiement
 * l'appellent tous — sinon un montant annoncé au client et un montant
 * encaissé finiraient par diverger, exactement le piège que
 * `computeInvoiceTotals()` évite déjà côté facturation.
 */
export const planPriceForSeats = (meta: PlanMeta | null, seats: number | null | undefined): number => {
  if (!meta) return 0;
  if (!meta.pricePerExtraUserDT) return meta.priceDT;
  const base = meta.baseSeats ?? 1;
  const requested = Math.round(Number(seats));
  const extra = Math.max(0, (Number.isFinite(requested) ? requested : base) - base);
  return Math.round((meta.priceDT + extra * meta.pricePerExtraUserDT) * 1000) / 1000;
};

/**
 * Le nombre de sièges à retenir pour une offre donnée, à partir d'une valeur
 * saisie (page Tarifs, modale d'inscription, corps de `POST /api/signup`) —
 * jamais fait confiance telle quelle : une offre sans tarif dynamique
 * retombe toujours sur son `seatLimit` fixe (la saisie n'a aucun sens pour
 * elle), et une offre dynamique est bornée entre `baseSeats` et
 * `MAX_DYNAMIC_SEATS`.
 */
export const clampSeatsForPlan = (meta: PlanMeta | null, seats: any): number => {
  const base = meta?.baseSeats ?? 1;
  if (!meta?.pricePerExtraUserDT) return meta?.seatLimit ?? base;
  const n = Math.round(Number(seats));
  if (!Number.isFinite(n) || n < base) return base;
  return Math.min(n, MAX_DYNAMIC_SEATS);
};

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
  VIEW_CLIENT_FINANCIALS: 'Clients', ACCESS_CLIENT_PORTAL: 'Clients',

  VIEW_CASH: 'Cash', MANAGE_CASH: 'Cash',

  VIEW_HR: 'HR', CREATE_LEAVE_REQUEST: 'HR', MANAGE_LEAVE_REQUESTS: 'HR',
  CREATE_ABSENCE_AUTHORIZATION: 'HR', MANAGE_ABSENCE_AUTHORIZATIONS: 'HR',
  CREATE_LOAN_REQUEST: 'HR', MANAGE_LOANS_ADVANCES: 'HR',

  VIEW_RESOURCES: 'Ressources', MANAGE_RESOURCES: 'Ressources',

  VIEW_PAYROLL: 'Payroll', MANAGE_PAYROLL: 'Payroll',
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
