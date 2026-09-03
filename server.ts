// Loads .env before anything reads process.env. dotenv was already a
// dependency but never imported, so a local .env did nothing; VAPID keys are
// the first config a developer has to be able to set outside Railway. A
// no-op in production, where the container has no .env and the platform
// injects the variables directly.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDb, DEFAULT_LEAVE_ENTITLEMENT } from './src/server/database.js';
import { LEGACY_COMPANY_ID, TRIAL_DAYS, ADMIN_PERMISSIONS } from './src/server/db-types.js';
import {
  PLAN_SEAT_LIMITS, PLAN_PORTAL_SEAT_LIMITS, SELLABLE_PLANS, isSellablePlan, DEFAULT_PLAN_ID,
  planMeta, planLabel, formatDT, REFERRAL_DISCOUNT_PERCENT, discountedPriceDT,
  planAllowsPermission, documentQuotaFor, planAllowsModule, planModules, type PlanModule,
} from './src/constants/plans.js';
import { ROLES, STAFF_ROLES, DASHBOARD_ROLES, HR_APPROVER_ROLES, CLIENT_ROLE } from './src/constants/roles.js';
import { SECTEURS, RESOURCES_PERMISSIONS, companyHasResourcesModule, type Secteur } from './src/constants/secteurs.js';
import { missionsForSecteur, catalogueVersion } from './src/constants/sectorMissions.js';
import { toPaymentMode, isCashMode } from './src/constants/paymentModes.js';
import {
  normalizeDisbursementLines, sumDisbursements, DISBURSEMENT_LINES_MAX,
} from './src/constants/disbursements.js';
import {
  DEFAULT_AWAY_AFTER_MINUTES, OFFLINE_AFTER_MS, clampAwayMinutes, type PresenceState,
} from './src/constants/presence.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendMail } from './src/server/email.js';
import { initPush, pushEnabled, publicKey as pushPublicKey, sendPush } from './src/server/push.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-local-dev';

/**
 * Le fuseau du cabinet.
 *
 * **Le serveur ne doit jamais lire l'heure du système d'exploitation.**
 * `getHours()`/`getDate()` rendent l'heure locale *du processus* : en
 * production le conteneur tourne en UTC, donc une tâche démarrée à 08h42 à
 * Tunis était enregistrée « 07:42 ». Toutes les dates et heures civiles que le
 * serveur estampille passent donc par les helpers ci-dessous, qui nomment le
 * fuseau explicitement — le résultat ne dépend plus de la machine ni de son
 * `TZ`. C'est la contrepartie de la règle « le serveur possède `date`,
 * `heureDebut` et `heureFin` » : posséder l'horloge, c'est aussi posséder le
 * fuseau.
 *
 * Surchargeable pour un cabinet ailleurs, mais jamais devinée : une valeur
 * inconnue ferait lever `Intl`, et l'app ne démarrerait pas sans qu'on sache
 * pourquoi — on retombe donc sur Tunis en le disant.
 */
const APP_TIMEZONE = (() => {
  const wanted = process.env.APP_TIMEZONE || 'Africa/Tunis';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: wanted });
    return wanted;
  } catch {
    console.warn(`[time] fuseau « ${wanted} » inconnu — repli sur Africa/Tunis.`);
    return 'Africa/Tunis';
  }
})();

const civilFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/** L'heure murale du cabinet, décomposée — la seule lecture d'horloge du serveur. */
const civilParts = (d: Date) => {
  const parts: Record<string, string> = {};
  for (const p of civilFormatter.formatToParts(d)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour12: false` rend minuit « 24 » sur certains moteurs — 24:00 est le
    // même instant que 00:00 du jour déjà donné par `day`.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
};

/** DD/MM/YYYY — the format time entries are stored and grouped by. */
const formatDateFR = (d: Date) => {
  const c = civilParts(d);
  return `${String(c.day).padStart(2, '0')}/${String(c.month).padStart(2, '0')}/${c.year}`;
};

/** HH:mm, 24h. */
const formatTimeFR = (d: Date) => {
  const c = civilParts(d);
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
};

/**
 * L'échéance d'un abonnement mensuel : la date de départ plus N mois.
 *
 * `setUTCMonth` fait le gros du travail, mais rend le 31 mars + 1 mois =
 * 31 avril, c'est-à-dire le 1er mai — un jour d'abonnement offert par accident
 * chaque fois que le mois d'arrivée est plus court. On retombe donc sur le
 * dernier jour du mois visé, ce qu'un échéancier fait naturellement.
 */
const addMonthsISO = (from: Date, months: number) => {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTarget));
  return d.toISOString();
};

/** YYYY-MM-DD — la forme des dates RH et du pointage de présence. */
const formatDateISO = (d: Date) => {
  const c = civilParts(d);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
};

/** Le jour civil du cabinet, décalé de `days` jours. */
const isoDaysAgo = (days: number) => {
  const c = civilParts(new Date());
  // Arithmétique en UTC sur une date civile déjà résolue : pas de fuseau en
  // jeu, donc pas de saut d'heure d'été à traverser.
  const shifted = new Date(Date.UTC(c.year, c.month - 1, c.day) - days * 86400000);
  return shifted.toISOString().slice(0, 10);
};

/** Users are stored with `permissions` JSON-stringified; the API always returns an array. */
const publicUser = (u: any) => {
  const { password, permissions, ...rest } = u;
  return { ...rest, permissions: JSON.parse(permissions || '[]') };
};

// NaN must not pass: `typeof NaN === 'number'`, so an absent field read as
// Number(undefined) used to flow straight into the money cascade and turn
// totalNetToPay into NaN, stored as null — a document with no amount at all.
const num = (v: any, fallback: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/**
 * Un coût en dinars, mis en forme.
 *
 * Même règle que `formatCostTND` côté client : au-dessus de 100 DT l'entier
 * suffit, en dessous on garde les décimales. `Math.round()` seul — ce qu'il y
 * avait — affichait « 0 TND » pour tout montant inférieur à un demi-dinar,
 * donc pour toute tâche courte, et la carte du tableau de bord affirmait
 * gratuitement du travail qui avait bien un coût.
 */
const formatCostTND = (cost: number): string => {
  const val = cost || 0;
  if (val % 1 === 0 || val >= 100) return `${Math.round(val).toLocaleString('fr-FR')} TND`;
  return `${val.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} TND`;
};

/** Money is carried to the millime (3 decimals) at every step. */
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Attaches the admin-set annual leave allowance and its consumption to a user payload. */
const withLeaveBalance = (user: any, balances: any[]) => {
  const b = balances.find((x: any) => x.userId === user.id);
  const entitlement = b ? b.entitlement : DEFAULT_LEAVE_ENTITLEMENT;
  const used = b ? b.used : 0;
  return { ...user, soldeConge: entitlement, congesUtilises: used, congesRestants: entitlement - used };
};

/**
 * The employer hourly cost of a collaborator:
 *
 *   charges = salaireBrut * (CNSS + TFP + FOPROLOS + accident) / 100
 *   total   = salaireBrut + charges + primes non cotisables
 *   rate    = total / (regimeHoraire * 4.33)
 *
 * Percentages fall back to the global defaults when not overridden per user.
 * Returns `null` when the collaborator has no salary configured — callers must
 * NOT substitute a placeholder: an invented cost is worse than no cost.
 */
const employerHourlyRate = (user: any, settings: any): number | null => {
  if (!user) return null;
  if (typeof user.coutHoraireEmployeur === 'number' && user.coutHoraireEmployeur > 0) {
    return user.coutHoraireEmployeur;
  }
  const salaire = num(user.salaireBrut, 0);
  const regime = num(user.regimeHoraire, 0);
  if (salaire <= 0 || regime <= 0) return null;

  const g = settings?.employerCharges ?? {};
  const pct =
    num(user.cnss, num(g.cnss, 16.57)) +
    num(user.tfp, num(g.tfp, 2)) +
    num(user.foprolos, num(g.foprolos, 1)) +
    num(user.accidentTravail, num(g.accidentTravail, 0.5));

  const total = salaire + salaire * (pct / 100) + num(user.primesFraisNonCotisables, 0);
  const heuresMensuelles = regime * 4.33;
  return heuresMensuelles > 0 ? total / heuresMensuelles : null;
};

/** DD/MM/YYYY (how entries are stored) → epoch ms. */
const parseFrenchDateTs = (dateStr: string) => {
  if (!dateStr) return 0;
  const parts = dateStr.split('/');
  if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`).getTime();
  return 0;
};

/**
 * The dashboard's date / collaborator / client filters, in one place so the
 * summary endpoint and the per-client drill-down apply exactly the same rules.
 */
const filterKpiEntries = (entries: any[], body: any) => {
  const startTs = body?.startDate ? new Date(body.startDate).getTime() : 0;
  const endTs = body?.endDate ? new Date(body.endDate).getTime() + 86400000 - 1 : Infinity;
  const userIds: any[] = body?.filterUserIds || [];
  const clientIds: any[] = body?.filterClientIds || [];
  return entries.filter((t: any) => {
    const ts = parseFrenchDateTs(t.date);
    if (ts < startTs || ts > endTs) return false;
    if (userIds.length > 0 && !userIds.includes(t.userId)) return false;
    if (clientIds.length > 0 && !clientIds.includes(t.clientId)) return false;
    return true;
  });
};

/**
 * Un document compte-t-il dans le chiffre d'affaires du client ?
 *
 * Non pour un brouillon — il n'est pas émis, et le compter gonflerait les
 * honoraires de documents qui n'existent pas encore. Non pour un « autre
 * document (non facturable) », qui existe dans Cash mais n'est pas de la
 * facturation. Une seule définition, parce qu'elle sert au grand-livre client,
 * au tableau de bord et aux totaux de Cash : trois écrans qui prétendent
 * montrer le même chiffre.
 */
const countsAsBilled = (inv: any) =>
  inv.documentKind !== 'AUTRE_NON_FACTURABLE' && inv.status !== 'DRAFT';

/**
 * Le mois où un document a été **émis**, au format `YYYY-MM` et dans le
 * fuseau du cabinet.
 *
 * `issuedAt` d'abord : un brouillon préparé en janvier et émis en février est
 * un document de février — c'est à l'émission qu'il devient un document. Et
 * jamais `issueDate`, la date *portée* par le document : elle se saisit à la
 * main, donc un plafond mensuel adossé à elle se contournerait en la
 * reculant d'un mois.
 */
const documentMonth = (inv: any): string =>
  formatDateISO(new Date(inv.issuedAt || inv.createdAt)).slice(0, 7);

/**
 * Un document compte-t-il dans le plafond mensuel de l'offre ?
 *
 * Tout sauf un brouillon. C'est la règle telle qu'elle est vendue — on
 * prépare autant de brouillons qu'on veut — et elle est volontairement plus
 * large que `countsAsBilled` : un « autre document (non facturable) » ne fait
 * pas d'honoraires mais reste un document qu'on a émis.
 */
const countsAgainstQuota = (inv: any) => inv.status !== 'DRAFT';

/**
 * Le plafond de l'offre est-il atteint ? Rend le message à afficher, ou
 * `null` quand il reste de la place (ou qu'il n'y a pas de plafond).
 *
 * Une seule implémentation pour les trois appelants — la création, l'émission
 * d'un brouillon, et le compteur affiché dans Cash : un compteur qui
 * annoncerait « 3 restants » devant un refus serait pire que pas de compteur.
 */
const documentQuotaState = (company: any, allInvoices: any[]) => {
  const limit = documentQuotaFor(company?.plan, company?.status);
  if (!limit) return { limit: null as number | null, used: 0, remaining: null as number | null };
  const month = formatDateISO(new Date()).slice(0, 7);
  const used = allInvoices.filter(i => countsAgainstQuota(i) && documentMonth(i) === month).length;
  return { limit, used, remaining: Math.max(0, limit - used) };
};

const QUOTA_REACHED_ERROR = (limit: number) =>
  `Votre essai gratuit couvre ${limit} documents par mois — le plafond est atteint. `
  + 'Les brouillons restent illimités ; passez à l\'abonnement pour émettre sans plafond.';

/**
 * Les seuls chemins qu'un compte `CLIENT` peut atteindre.
 *
 * Liste blanche, jamais liste noire : ce qui n'y figure pas est refusé, donc
 * une route ajoutée plus tard naît fermée au portail. Chaque entrée ouverte
 * hors `/api/portal` porte son propre filtrage par utilisateur :
 *  - `/api/me`, `/api/logout` ne renvoient que le compte connecté ;
 *  - `/api/notifications*` est déjà indexé par `userId` ;
 *  - `/api/messages*` est filtré par participant, et sa liste de contacts est
 *    réduite aux collaborateurs du cabinet (voir la route) — sans quoi un
 *    client verrait tous les autres clients.
 */
const CLIENT_ALLOWED_EXACT = new Set(['/api/me', '/api/logout']);
const CLIENT_ALLOWED_PREFIXES = ['/api/portal/', '/api/notifications', '/api/messages'];
const clientPathAllowed = (path: string) =>
  CLIENT_ALLOWED_EXACT.has(path) || CLIENT_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p));

/**
 * À quelle vue appartient chaque route — pour les offres qui n'ouvrent pas
 * toutes les vues (le pack Facturation).
 *
 * `requirePermission` ne suffit pas : une bonne partie des routes ne portent
 * que `authenticate` (le catalogue des missions que lit le formulaire de
 * pointage, le solde de congés, le flux SSE…) et resteraient donc ouvertes à
 * une offre qui ne les vend pas — masquer l'entrée de menu ne ferme pas la
 * route. Le périmètre se décide donc ici, en un seul endroit, exactement
 * comme celui du portail client juste au-dessus.
 *
 * **Liste blanche, jamais liste noire** : une route qui ne correspond à
 * aucun préfixe est refusée aux offres restreintes, donc une route ajoutée
 * demain naît fermée pour elles plutôt que de s'ouvrir en silence. Le prix à
 * payer est qu'une nouvelle route doit être classée ici — c'est voulu.
 */
const PLAN_MODULE_ROUTES: [string, PlanModule][] = [
  ['/api/time-entries', 'Time Tracking'],
  ['/api/task-assignments', 'Time Tracking'],
  ['/api/kpi', 'Dashboard'],
  ['/api/dashboard', 'Dashboard'],
  ['/api/resources/portfolio', 'Dashboard'],

  ['/api/hr', 'HR'],
  ['/api/attendance', 'HR'],

  ['/api/services', 'Missions'],
  ['/api/task-types', 'Missions'],

  ['/api/clients', 'Clients'],

  ['/api/invoices', 'Cash'],
  ['/api/cash', 'Cash'],
  ['/api/cash-journal', 'Cash'],
  ['/api/cash-categories', 'Cash'],

  ['/api/resource-templates', 'Ressources'],
  ['/api/resource-template-items', 'Ressources'],
  ['/api/client-resources', 'Ressources'],
  ['/api/client-resource-items', 'Ressources'],
  ['/api/echeance-columns', 'Ressources'],
  ['/api/echeance-statuses', 'Ressources'],
  ['/api/echeance-status-options', 'Ressources'],
  ['/api/useful-links', 'Ressources'],

  ['/api/messages', 'Messages'],

  ['/api/users', 'Users'],
  ['/api/settings', 'Users'],

  ['/api/referral', 'Parrainage'],
];

/**
 * Ce qui ne relève d'aucune vue : se connaître, se déconnecter, la cloche,
 * les notifications poussées, le battement de présence, la réinitialisation
 * de mot de passe, et la console plateforme — qui appartient à
 * l'administrateur de la plateforme, pas à l'abonnement de l'entreprise.
 */
const PLAN_NEUTRAL_PREFIXES = [
  '/api/me', '/api/logout', '/api/notifications', '/api/push',
  '/api/presence', '/api/auth', '/api/platform',
];

/**
 * Un préfixe ne vaut que sur une **frontière de segment**.
 *
 * `startsWith()` seul faisait de `/api/me` le préfixe de `/api/messages` :
 * la messagerie entière passait pour une route neutre et restait ouverte à
 * une offre qui ne la vend pas — mesuré, `/api/messages/contacts` répondait
 * 200 au pack Facturation. Un chemin n'appartient à un préfixe que s'il lui
 * est égal ou s'il continue par `/` (ou `?`, une requête montée à la main).
 */
const pathUnderPrefix = (path: string, prefix: string) => {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === p || path.startsWith(p + '/') || path.startsWith(p + '?');
};

/** Le module d'un chemin : le préfixe le plus long l'emporte (`/api/cash-journal` avant `/api/cash`). */
const moduleForPath = (path: string): PlanModule | null => {
  let best: PlanModule | null = null;
  let bestLength = 0;
  for (const [prefix, module] of PLAN_MODULE_ROUTES) {
    if (pathUnderPrefix(path, prefix) && prefix.length > bestLength) {
      best = module;
      bestLength = prefix.length;
    }
  }
  return best;
};

/** Bucket key used to group entries by client (falls back to the stored name). */
const clientBucketKey = (t: any) =>
  t.clientId != null ? String(t.clientId) : `name:${t.client || 'Sans client'}`;

/** Seconds a task has accrued, including the currently-running stretch. */
const accruedSeconds = (t: any) => {
  let s = t.dureeSeconds || 0;
  if (t.statut === 'RUNNING' && t.lastStartedAt) {
    s += Math.floor((Date.now() - t.lastStartedAt) / 1000);
  }
  return s;
};

/**
 * Seeds the system resource library once: the SARL/SUARL formation
 * checklists and the bank-investment checklist from the cabinet's own
 * reference documents (not placeholder content), the cabinet's actual
 * useful links (each with its institution's logo, copied into
 * public/logos/), and the 28 échéance columns of the cabinet's own 2025
 * suivi mensuel sheet. Idempotent — checked by id, safe on every boot.
 *
 * The "Détail des frais administratifs" reference table from the SARL
 * document has no table of its own in the V1 data model (the spec defines
 * none for it); it is attached as an informational, non-blocking item on the
 * Patente checklist rather than inventing a new structure for one table.
 */
/**
 * La grille d'échéances d'un exercice, telle que le cabinet la tient : mois +
 * libellé précis, dans l'ordre où ils tombent. Écrite une fois, les autres
 * exercices s'en déduisent — les recopier à la main serait autant de listes à
 * corriger.
 *
 * `{PREV}` est **l'exercice déclaré, pas l'année de la colonne** : ce qu'on
 * dépose pendant une année porte sur la précédente. La déclaration mensuelle
 * de janvier couvre décembre d'avant, l'IS et les IRPP soldent l'exercice
 * clos, la déclaration employeur porte sur les salaires de l'an passé et le
 * bilan RNE sur les comptes de l'an passé. La grille 2028 s'écrit donc
 * « DM 12/2027 », « IS 2027 », « IRPP 2027-COMMERCE »… Les libellés sans
 * `{PREV}` (DM 1 à 11, CNSS TR, D SUSP TVA, Acompte) ne portent pas d'année
 * du tout et sont identiques d'un exercice à l'autre.
 *
 * Un jeton plutôt qu'une année en dur qu'on remplacerait : avec « 2025 »
 * écrit ici, le modèle était en fait celui de l'exercice 2026 et le décalage
 * d'un an restait invisible — c'est comme ça qu'il s'est glissé.
 */
const ECHEANCE_TEMPLATE: [number, string][] = [
  [1, 'DM 12/{PREV}'], [1, 'D SUSP TVA TR04'], [1, 'CNSS TR04'],
  [2, 'DM 1'],
  [3, 'DM 2'], [3, 'IS {PREV}'],
  [4, 'DM 3'], [4, 'D SUSP TVA TR01'], [4, 'CNSS TR01'], [4, 'IRPP {PREV}-COMMERCE'], [4, 'DEC EMPLOYEUR {PREV}'],
  [5, 'DM 4'], [5, 'IRPP {PREV}-SERVICE + FONC LIBERALE + REV FONCIER'],
  [6, 'DM 5'], [6, 'Acompte 1'],
  [7, 'DM 6'], [7, 'D SUSP TVA TR02'], [7, 'CNSS TR02'], [7, 'RNE Bilan {PREV}'],
  [8, 'DM 7'],
  [9, 'DM 8'], [9, 'Acompte 2'],
  [10, 'DM 9'], [10, 'D SUSP TVA TR03'], [10, 'CNSS TR03'],
  [11, 'DM 10'],
  [12, 'DM 11'], [12, 'Acompte 3'],
];

/**
 * Les exercices livrés d'office. Ajouter une année, c'est ajouter un nombre :
 * la pose est idempotente par id, donc les colonnes déjà présentes — et
 * surtout les cellules que le cabinet a remplies — ne bougent pas.
 */
const ECHEANCE_YEARS = [2025, 2026, 2027, 2028];

/**
 * `id` est la clé primaire de chaque table, **toutes entreprises confondues**.
 * Un id de semis fixe comme `tpl-seed-patente` ne peut donc appartenir qu'à
 * une seule entreprise : la première semée les prenait tous, et chacune des
 * suivantes butait sur un doublon de clé dès son premier modèle. Comme la
 * pose s'arrête là — avant la moindre colonne d'échéance — et que le drapeau
 * de version ne s'écrit qu'au succès, l'entreprise restait sans échéances,
 * sans modèles et sans liens, en rejouant la même erreur à chaque requête.
 *
 * Les ids de semis sont donc portés par l'entreprise. La forme non suffixée
 * reste celle de qui la détient déjà : ces lignes sont désignées par leur id
 * ailleurs — une cellule pointe sa colonne, un item son modèle — donc les
 * renommer orphelinerait le travail déjà saisi par le cabinet.
 */
const seedIdFor = (companyId: string, base: string) => `${base}--c${companyId}`;

const ownedSeedId = (existing: any[], companyId: string, base: string) =>
  existing.some((r: any) => r.id === base) ? base : seedIdFor(companyId, base);

/**
 * Le modèle décliné sur un exercice. `id` est ici l'id **de base** : c'est à
 * l'appelant de le porter sur son entreprise via `ownedSeedId`, pour que la
 * route « installer la grille type » et le semis livré d'office nomment
 * exactement les mêmes colonnes.
 */
const echeanceColumnsForYear = (year: number) =>
  ECHEANCE_TEMPLATE.map(([month, template], i) => ({
    id: `ec-seed-${year}-${i}`,
    year,
    month,
    label: template.replace(/\{PREV\}/g, String(year - 1)),
    // Un bloc d'ordre par exercice, pour que deux années ne s'entrelacent pas.
    sortOrder: (year - 2025) * 100 + i,
  }));

async function seedResourceLibrary(db: import('./src/server/db-types.js').Database, companyId: string) {
  const SECTOR_COMPTA = 'Expertise comptable';

  const existingTemplates = await db.getAllResourceTemplates(companyId);
  const seedChecklist = async (base: string, name: string, sector: string, items: string[]) => {
    const id = ownedSeedId(existingTemplates, companyId, base);
    if (existingTemplates.some((t: any) => t.id === id)) return;
    const template = await db.createResourceTemplate(companyId, {
      id, type: 'document_checklist', name, sector,
      isSequential: false, isActive: true, isSystem: true,
      sourceSystemTemplateId: null, createdAt: new Date().toISOString(),
    });
    let i = 0;
    for (const label of items) {
      await db.createResourceTemplateItem(companyId, { id: `${template.id}-item-${i}`, templateId: template.id, label, sortOrder: i });
      i++;
    }
  };

  await seedChecklist('tpl-seed-reservation-nom', 'Réservation de nom — SARL/SUARL', SECTOR_COMPTA, [
    'CIN du gérant (recto-verso)',
    'Carte bancaire (recto-verso) — frais de réservation 15 DT',
    "Adresse électronique (pour la notification du résultat de la réservation)",
    'Numéro de téléphone du gérant',
    'Forme juridique de la société à créer (SUARL, SARL, SA…)',
    "Proposition de dénomination — nom arabe et nom français (jusqu'à 3 choix)",
  ]);

  await seedChecklist('tpl-seed-patente', 'Patente — SARL/SUARL', SECTOR_COMPTA, [
    'CIN du gérant (4 copies)',
    'CIN des associés (4 copies)',
    'Attestation de réservation de nom (3 copies)',
    'Contrat de location, signature légalisée et enregistré (6 copies)',
    'Statut de la société daté, signatures de tous les associés non légalisées (8 copies)',
    'Attestation de compte bancaire indisponible — choix du promoteur (3 copies)',
    "Attestation de déclaration d'investissement — services, industrie, agricole (3 copies)",
    'Cahier des charges et/ou autorisation préalable — activités concernées (3 copies)',
  ]);

  await seedChecklist('tpl-seed-rne', 'RNE — SARL/SUARL', SECTOR_COMPTA, [
    "Formulaire de déclaration d'immatriculation",
    'Statut de la société daté (signatures de tous les associés, non légalisées)',
    'Déclaration de bénéficiaire effectif (associés détenant au moins 20% des parts sociales)',
    'Copie de la patente',
    'Mandat de 50 DT au nom du CNRE',
  ]);

  await seedChecklist('tpl-seed-code-douane', 'Code en douane — SARL/SUARL', SECTOR_COMPTA, [
    'Extrait RNE',
    'Copie conforme de la patente',
    "Copie conforme de la déclaration d'existence",
    'CIN du gérant',
    'Timbre fiscal 5 DT',
    "Formulaire de demande d'octroi d'un code en douane",
  ]);

  await seedChecklist('tpl-seed-compte-indisponible', 'Attestation de compte bancaire indisponible — SARL/SUARL', SECTOR_COMPTA, [
    'CIN du gérant',
    'CIN des associés',
    'Projet de statut de la société',
    'Copie du contrat de location',
    "Copie de l'attestation de réservation de nom",
  ]);

  await seedChecklist(
    'tpl-seed-banque-regularisation-investissement',
    "Demande d'autorisation — régularisation fiche investissement (dépassement des délais)",
    'Banque',
    [
      'Une lettre explicative',
      "Les documents juridiques de la société : extrait récent et détaillé du RNE, Patente, Statuts dûment " +
        "enregistrés, attestations de dépôt de déclaration délivrées par l'APII, cartes d'identification fiscale " +
        'et douanière, carte SINDA…',
      "Les justificatifs d'importation de devise : swifts, avis de crédit, attestation bancaire…",
      "Une copie intégrale et en couleur du passeport de l'associé non-résident (personne physique) : toutes les pages",
      "Extrait KBIS de l'associé non-résident (personne morale)",
      'Extrait récent des comptes ouverts au nom de la société',
      'Une attestation bancaire sur la nature des comptes ouverts au nom de la société',
    ],
  );

  const existingLinks = await db.getAllUsefulLinks(companyId);
  const seedLink = async (
    base: string, category: string, label: string, url: string,
    opts: { description?: string; icon?: string } = {},
  ) => {
    const id = ownedSeedId(existingLinks, companyId, base);
    if (existingLinks.some((l: any) => l.id === id)) return;
    await db.createUsefulLink(companyId, {
      id, category, label, url,
      description: opts.description || null,
      icon: opts.icon || null,
      sector: SECTOR_COMPTA, sortOrder: existingLinks.length, isActive: true, isSystem: true,
    });
  };
  await seedLink(
    'link-seed-cnss', 'Organismes sociaux', 'Télédéclaration des salaires & télépaiement des cotisations CNSS',
    'https://www.cnss.tn/', { description: 'Via Certificat ID-TRUST.', icon: '/logos/cnss.png' },
  );
  await seedLink(
    'link-seed-aneti-civp', 'Emploi', 'Contrat CIVP en ligne',
    'https://inscription.emploi.nat.tn/', { icon: '/logos/aneti.png' },
  );
  await seedLink(
    'link-seed-tej', 'Impôts', 'Plateforme TEJ de retenue à la source',
    'https://tej.finances.gov.tn/home', { icon: '/logos/tej.jpg' },
  );

  // Les 28 colonnes du suivi mensuel du cabinet — de vrais en-têtes (mois +
  // libellé précis), pas du remplissage — déclinées sur chaque exercice livré.
  // Les cellules, elles, restent vides : c'est au cabinet de les remplir.
  const existingColumns = await db.getAllEcheanceColumns(companyId);
  const seedColumn = async (base: string, year: number, month: number, label: string, sortOrder: number) => {
    const id = ownedSeedId(existingColumns, companyId, base);
    const existing = existingColumns.find((c: any) => c.id === id);
    if (existing) {
      // Une colonne déjà posée voit son libellé **corrigé**, pas seulement
      // sauté : c'est le seul chemin par lequel une correction du modèle
      // atteint une entreprise déjà servie, la signature de contenu ne
      // faisant que rejouer une pose qui, sans ça, ne ferait rien. Les
      // cellules ne bougent pas — elles désignent la colonne par son id, pas
      // par son intitulé. En contrepartie un libellé renommé à la main sur
      // une colonne semée est ramené au modèle : il n'y a rien sur la ligne
      // qui distingue une correction d'un renommage délibéré.
      if (existing.label !== label) await db.updateEcheanceColumn(companyId, id, { label });
      return;
    }
    await db.createEcheanceColumn(companyId, { id, year, month, label, sortOrder });
  };
  for (const year of ECHEANCE_YEARS) {
    for (const col of echeanceColumnsForYear(year)) {
      await seedColumn(col.id, col.year, col.month, col.label, col.sortOrder);
    }
  }

  // The status vocabulary a cell can be set to — admin-editable from here on,
  // this only seeds the starting set (and its colors) on first boot.
  const existingStatusOptions = await db.getAllEcheanceStatusOptions(companyId);
  const seedStatusOption = async (base: string, label: string, sortOrder: number, color: string) => {
    const id = ownedSeedId(existingStatusOptions, companyId, base);
    if (existingStatusOptions.some((o: any) => o.id === id)) return;
    await db.createEcheanceStatusOption(companyId, { id, label, sortOrder, color });
  };
  await seedStatusOption('ecs-opt-seed-0', 'Oui', 0, 'done');
  await seedStatusOption('ecs-opt-seed-1', "Client non concerné par l'échéance", 1, 'gray');
  await seedStatusOption('ecs-opt-seed-2', 'DEFAUT', 2, 'late');
  await seedStatusOption('ecs-opt-seed-3', 'Préparée (en attente de confirmation client)', 3, 'run');

  // Backfills a color on options created before this field existed (any
  // database that already ran this seed once) — same idea as
  // normalizeBalance() recovering a legacy shape, just for this collection.
  const colorKeys = ['done', 'late', 'run', 'pause', 'admin', 'collab', 'gray'];
  const allStatusOptions = await db.getAllEcheanceStatusOptions(companyId);
  for (let i = 0; i < allStatusOptions.length; i++) {
    if (!allStatusOptions[i].color) {
      await db.updateEcheanceStatusOption(companyId, allStatusOptions[i].id, { color: colorKeys[i % colorKeys.length] });
    }
  }
}

async function startServer() {
  const app = express();
  // Railway (and Render) assign the port at runtime and expect the app to bind
  // whatever they put in $PORT; a hardcoded one fails their health check and
  // the deploy never goes live. 3000 stays the local default.
  const PORT = Number(process.env.PORT) || 3000;

  // Default is 100kb. Raised for two authenticated, bounded uploads: the
  // signature image (400kb) and a parsed client spreadsheet (the import route
  // caps it at MAX_IMPORT_ROWS regardless, but the row data itself — a real
  // 163-row/29-column sheet ran ~120kb — has to fit through the parser first).
  app.use(express.json({ limit: '8mb' }));

  // Initialize SQLite database
  const db = await initDb();
  initPush();
  await seedResourceLibrary(db, LEGACY_COMPANY_ID);

  // The legacy cabinet's own admin doubles as the platform's operator (the
  // person selling Tâches & Cash itself, confirming other companies'
  // payments) — an orthogonal capability from any one company's ADMIN role,
  // so it lives as its own flag rather than folding into `role`. Idempotent:
  // only acts if the flag is missing, same "recover a legacy shape" idiom as
  // normalizeBalance().
  const legacyAdmin = await db.getUserById(LEGACY_COMPANY_ID, 1);
  if (legacyAdmin && !legacyAdmin.isPlatformAdmin) {
    await db.updateUser(LEGACY_COMPANY_ID, 1, { isPlatformAdmin: true });
  }

  // ---------------------------------------------------------
  // Auth & API Routes
  // ---------------------------------------------------------

  /**
   * A TRIAL company past `trialEndsAt` is expired lazily, the first time
   * anyone touches it, rather than on a cron — the same idiom this codebase
   * already uses for `available` (derived, never stored) and presence
   * (derived from missing heartbeats). Flips the row to EXPIRED so the check
   * is a plain equality after the first hit, not a date comparison forever.
   */
  const expireTrialIfDue = async (company: any) => {
    if (company && company.status === 'TRIAL' && company.trialEndsAt && new Date(company.trialEndsAt).getTime() < Date.now()) {
      await db.updateCompany(company.id, { status: 'EXPIRED' });
      company.status = 'EXPIRED';
    }
    return company;
  };

  // POST /api/login
  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await db.getUserByUsername(username);

      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const companyId = user.companyId || LEGACY_COMPANY_ID;
      const company = await expireTrialIfDue(await db.getCompanyById(companyId));
      // Le catalogue de missions du secteur est copié ici plutôt qu'à la seule
      // inscription : les entreprises déjà en base au moment où l'exploitant
      // l'importe doivent le recevoir elles aussi, et la connexion est le seul
      // moment où l'on tient déjà la fiche entreprise en main. Idempotent, et
      // court-circuité par un drapeau dès la première fois.
      await seedSectorMissions(company);
      // Suspendu et essai terminé bloquent tous les deux la connexion, mais ne
      // veulent pas dire la même chose : dans les deux cas les données restent
      // intactes, seul l'accès est fermé.
      if (company && company.status === 'SUSPENDED') {
        res.status(403).json({ error: "Votre accès a été suspendu. Contactez-nous pour le rétablir." });
        return;
      }
      if (company && company.status === 'EXPIRED') {
        res.status(403).json({ error: "Votre période d'essai est terminée. Contactez-nous pour activer un abonnement." });
        return;
      }

      const token = jwt.sign(
        // `clientId` voyage dans le jeton : le garde-fou de `authenticate` et
        // les routes du portail s'en servent à chaque requête, et le relire en
        // base à chaque appel n'apporterait rien — il ne change pas dans la
        // vie d'un compte (le rattachement se fait à la création).
        { id: user.id, role: user.role, companyId, clientId: user.clientId ?? null, isPlatformAdmin: !!user.isPlatformAdmin },
        JWT_SECRET, { expiresIn: '1d' },
      );

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          permissions: JSON.parse(user.permissions),
          salaireBrut: user.salaireBrut,
          regimeHoraire: user.regimeHoraire,
          clientId: user.clientId ?? null,
          isPlatformAdmin: !!user.isPlatformAdmin,
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Authentication Middleware. Also enforces the free-trial deadline on every
  // request, not just at login, so an account doesn't stay usable for the
  // rest of a still-valid JWT after its trial has run out mid-session.
  const authenticate = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const payload: any = jwt.verify(token, JWT_SECRET);
      // A JWT issued before the multi-tenant migration carries no companyId
      // claim — defaulting it here is what lets it keep resolving to the
      // legacy cabinet's data with zero forced re-login.
      payload.companyId = payload.companyId || LEGACY_COMPANY_ID;
      req.user = payload;

      // ---- Portail client : périmètre global, pas route par route --------
      //
      // Un compte `CLIENT` n'a aucune permission back-office, donc
      // `requirePermission` le refuse déjà partout où il est posé. Mais une
      // bonne partie des routes ne portent que `authenticate` (notifications,
      // messagerie, présence, RH « annuler ma demande »…) : elles lui
      // seraient ouvertes. Plutôt que d'ajouter un filtre à chacune — et
      // d'en oublier une le jour où on en ajoute une nouvelle, ce qui
      // exposerait les données d'un autre client — le périmètre est refusé
      // par défaut ici, en un seul endroit, et seul le préfixe `/api/portal`
      // (plus le strict nécessaire pour se connaître et discuter) est ouvert.
      // Une route ajoutée demain est donc fermée au client tant que
      // quelqu'un ne l'ouvre pas explicitement.
      if (payload.role === CLIENT_ROLE && !clientPathAllowed(req.path)) {
        res.status(403).json({ error: 'Accès réservé au portail client.' });
        return;
      }

      const company = await expireTrialIfDue(await db.getCompanyById(req.user.companyId));
      if (company && (company.status === 'EXPIRED' || company.status === 'SUSPENDED')) {
        res.status(403).json({ error: "Votre période d'essai est terminée. Contactez-nous pour activer un abonnement." });
        return;
      }
      // Le périmètre de l'offre, même principe que celui du portail client
      // ci-dessus : une offre qui n'ouvre pas toutes les vues (le pack
      // Facturation) voit ses routes refusées ici, une fois pour toutes,
      // plutôt que vue par vue. Une offre généraliste n'a pas de liste de
      // modules et ne traverse donc rien de tout ceci.
      if (planModules(company?.plan) && !PLAN_NEUTRAL_PREFIXES.some(p => pathUnderPrefix(req.path, p))) {
        const module = moduleForPath(req.path);
        if (!module || !planAllowsModule(company?.plan, module)) {
          res.status(403).json({ error: "Cette fonctionnalité n'est pas incluse dans votre offre." });
          return;
        }
      }

      // Le catalogue de missions du secteur, ici et pas seulement à la
      // connexion : un jeton vit 24 h, donc quelqu'un déjà connecté ne
      // repasse pas par /api/login et ne verrait jamais arriver le catalogue.
      // La fiche entreprise est déjà en main, et le drapeau court-circuite en
      // une comparaison dès la deuxième fois.
      await seedSectorMissions(company);
      // Même raison, même endroit : la fiche entreprise est déjà en main, et
      // la signature court-circuite dès la deuxième requête.
      await seedResourceLibraryFor(company);
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // GET /api/me
  app.get('/api/me', authenticate, async (req: any, res: any) => {
    try {
      const user = await db.getUserById(req.user.companyId, req.user.id);
      if (!user) {
         res.status(404).json({ error: 'User not found' });
         return;
      }
      const company = await db.getCompanyById(req.user.companyId);
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: JSON.parse(user.permissions),
        salaireBrut: user.salaireBrut,
        regimeHoraire: user.regimeHoraire,
        shiftStart: user.shiftStart || null,
        shiftEnd: user.shiftEnd || null,
        breakMinutes: user.breakMinutes ?? null,
        clientId: user.clientId ?? null,
        isPlatformAdmin: !!user.isPlatformAdmin,
        company: company ? { id: company.id, name: company.name, status: company.status, plan: company.plan, trialEndsAt: company.trialEndsAt, secteur: company.secteur ?? null } : null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // RBAC Middleware
  const requirePermission = (permission: string) => {
    return (req: any, res: any, next: any) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // We should check the database to get the freshest permissions
      db.getUserById(req.user.companyId, req.user.id).then(async (user: any) => {
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const hasPerm = user.role === 'ADMIN' || JSON.parse(user.permissions).includes(permission);
        if (!hasPerm) {
          return res.status(403).json({ error: 'Forbidden: Missing permission ' + permission });
        }

        // Une seule lecture de la fiche entreprise pour les deux gardes
        // ci-dessous : le secteur et l'offre y sont côte à côte, et cette
        // fonction tourne sur *chaque* requête.
        const company = await db.getCompanyById(req.user.companyId);

        // Ressources Métier is gated by the company's own secteur, ahead of
        // the ADMIN bypass above: its seed content (SARL formation
        // checklists, CNSS échéances...) is specific to accounting/tax
        // cabinets, so a company outside that secteur never gets it, admin
        // included.
        if (RESOURCES_PERMISSIONS.has(permission) && !companyHasResourcesModule(company?.secteur)) {
          return res.status(403).json({ error: 'Module Ressources Métier non disponible pour ce secteur' });
        }

        // Une offre restreinte (le pack Facturation) ferme les vues qu'elle
        // ne vend pas — ici comme dans la barre latérale, et **devant** le
        // court-circuit ADMIN ci-dessus : c'est l'abonnement de l'entreprise
        // qui décide, pas le rôle de la personne. Sans ce garde, masquer
        // l'entrée de menu laisserait les routes ouvertes à qui les appelle
        // directement.
        if (!planAllowsPermission(company?.plan, permission)) {
          return res.status(403).json({ error: "Cette fonctionnalité n'est pas incluse dans votre offre." });
        }

        next();
      }).catch(() => {
        res.status(500).json({ error: 'Internal server error' });
      });
    };
  };

  /**
   * The same check `requirePermission` makes, but asked *inside* a route
   * rather than in front of it — for a permission that decides which fields
   * a response carries instead of whether the route may be called at all.
   * Re-reads the user row for the same reason: a permission taken away has
   * to take effect on the next request, not on the next login.
   */
  const userCan = async (req: any, permission: string): Promise<boolean> => {
    const user = await db.getUserById(req.user.companyId, req.user.id);
    if (!user) return false;
    return user.role === 'ADMIN' || JSON.parse(user.permissions).includes(permission);
  };

  /**
   * The client ledger fields, stripped from a response when the viewer lacks
   * VIEW_CLIENT_FINANCIALS. Hiding the columns in the table is not enough —
   * without this the figures still ship over the wire, the same rule the
   * ADMIN-only cost on time entries already follows.
   */
  const LEDGER_FIELDS = ['soldeAnterieur', 'montantFacture', 'encaissements', 'resteAPayer', 'journalEncaissements'];
  const stripLedger = (client: any) => {
    const out = { ...client };
    for (const f of LEDGER_FIELDS) delete out[f];
    return out;
  };

  /**
   * Cross-tenant capability, orthogonal to `requirePermission` (which is
   * scoped to "within my own company"): confirming another company's
   * payment or reading the platform's own bank details has nothing to do
   * with any permission a company's own ADMIN can grant.
   */
  const requirePlatformAdmin = (req: any, res: any, next: any) => {
    if (!req.user?.isPlatformAdmin) return res.status(403).json({ error: 'Forbidden' });
    next();
  };

  // GET /api/settings
  app.get('/api/settings', authenticate, requirePermission('ADMIN'), async (req: any, res: any) => {
    try {
      const settings = await db.getSettings(req.user.companyId);
      res.json(settings || {});
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/settings
  app.put('/api/settings', authenticate, requirePermission('ADMIN'), async (req: any, res: any) => {
    try {
      const updates = req.body;
      const updated = await db.updateSettings(req.user.companyId, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * The issuer block printed at the foot of every document: who is invoicing,
   * where to pay, and the signature.
   *
   * Held in settings rather than snapshotted onto each invoice, so correcting a
   * typo in the IBAN fixes it everywhere at once. The trade-off is deliberate:
   * changing the bank details also changes them on documents already issued.
   * If that ever becomes a problem, snapshot it at creation the way `pole` is.
   */
  const companyBlock = (settings: any) => {
    // `banks` replaced the old single `bank` object. A row saved before this
    // change has no `banks` array — recovered here as a one-item list, the
    // same "recover a legacy shape" idiom `normalizeBalance()` already uses,
    // so every reader (this shaper is the only one) sees the new shape.
    let banks = Array.isArray(settings?.banks) ? settings.banks : null;
    if (!banks) {
      banks = (settings?.bank?.name || settings?.bank?.iban)
        ? [{ id: 'bank-1', name: String(settings.bank.name || ''), rib: '', iban: String(settings.bank.iban || ''), swift: '' }]
        : [];
    }
    banks = banks.map((b: any, i: number) => ({
      id: String(b?.id || `bank-${i + 1}`),
      name: String(b?.name || ''),
      rib: String(b?.rib || ''),
      iban: String(b?.iban || ''),
      swift: String(b?.swift || ''),
    }));
    const defaultBankId = banks.some((b: any) => b.id === settings?.defaultBankId)
      ? settings.defaultBankId
      : (banks[0]?.id || '');

    return {
      company: {
        name: String(settings?.company?.name || ''),
        address: String(settings?.company?.address || ''),
        taxId: String(settings?.company?.taxId || ''),
        email: String(settings?.company?.email || ''),
        phone: String(settings?.company?.phone || ''),
      },
      banks,
      defaultBankId,
      logo: typeof settings?.logo === 'string' ? settings.logo : '',
      signature: typeof settings?.signature === 'string' ? settings.signature : '',
      stamp: typeof settings?.stamp === 'string' ? settings.stamp : '',
      // Absent on a pre-existing row = show, matching the behavior before
      // this toggle existed (a configured signature always rendered).
      showSignature: settings?.showSignature !== false,
    };
  };

  /** A logo/signature is a small inline image — anything else is refused rather than stored and later rendered. */
  const validateInlineImage = (value: string, label: string) => {
    if (value === '') return null; // explicit removal
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(value)) {
      return `${label} doit être une image PNG, JPEG ou WEBP.`;
    }
    if (value.length > 400_000) {
      return `${label} trop lourd(e) (400 Ko maximum).`;
    }
    return null;
  };

  /** Readable by anyone who may see documents — they all carry this footer. */
  app.get('/api/cash/company', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      res.json(companyBlock(await db.getSettings(req.user.companyId)));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Writable with MANAGE_CASH — it is invoicing identity, not a global setting. */
  app.put('/api/cash/company', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const body = req.body || {};
      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);

      // A signature/logo/stamp is a small inline image. Anything else — a
      // remote URL, a script-bearing SVG — is refused rather than stored and
      // later rendered.
      let signature = typeof body.signature === 'string' ? body.signature : undefined;
      if (signature !== undefined) {
        const err = validateInlineImage(signature, 'La signature');
        if (err) return res.status(400).json({ error: err });
      }
      let stamp = typeof body.stamp === 'string' ? body.stamp : undefined;
      if (stamp !== undefined) {
        const err = validateInlineImage(stamp, 'Le cachet');
        if (err) return res.status(400).json({ error: err });
      }
      let logo = typeof body.logo === 'string' ? body.logo : undefined;
      if (logo !== undefined) {
        const err = validateInlineImage(logo, 'Le logo');
        if (err) return res.status(400).json({ error: err });
      }

      // Up to 10 accounts is generous for a single cabinet and keeps this
      // array from growing without bound from a scripted/repeated request.
      const banks = Array.isArray(body.banks)
        ? body.banks.slice(0, 10).map((b: any, i: number) => ({
            id: text(b?.id, 40) || genId('bank'),
            name: text(b?.name, 120),
            rib: text(b?.rib, 40),
            iban: text(b?.iban, 60),
            swift: text(b?.swift, 20),
          }))
        : undefined;

      const current = await db.getSettings(req.user.companyId);
      const resolvedBanks = banks !== undefined ? banks : (current?.banks ?? []);
      const defaultBankId = resolvedBanks.some((b: any) => b.id === body.defaultBankId)
        ? body.defaultBankId
        : (resolvedBanks[0]?.id ?? '');

      const updated = await db.updateSettings(req.user.companyId, {
        company: {
          name: text(body.company?.name, 120),
          address: text(body.company?.address, 300),
          taxId: text(body.company?.taxId, 60),
          email: text(body.company?.email, 120),
          phone: text(body.company?.phone, 40),
        },
        banks: resolvedBanks,
        defaultBankId,
        logo: logo !== undefined ? logo : (current?.logo ?? ''),
        signature: signature !== undefined ? signature : (current?.signature ?? ''),
        stamp: stamp !== undefined ? stamp : (current?.stamp ?? ''),
        showSignature: typeof body.showSignature === 'boolean' ? body.showSignature : (current?.showSignature !== false),
      });
      res.json(companyBlock(updated));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // User Management API Routes
  // ---------------------------------------------------------

  // GET /api/users
  app.get('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers(req.user.companyId);
      const balances = await db.getAllLeaveBalances(req.user.companyId);
      // Don't send passwords to client. Same shape as POST/PUT responses so the
      // list can be updated in place after a create/edit.
      const sorted = [...users].sort((a: any, b: any) => (a.username || '').localeCompare(b.username || ''));
      res.json(sorted.map((u: any) => withLeaveBalance(publicUser(u), balances)));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Les sièges se comptent en **deux paniers séparés** : le back-office
   * (collaborateurs, superviseurs, administrateurs) et le portail client.
   * Une offre « pack 5 utilisateurs + 50 comptes portail » n'a pas de sens si
   * les cinquante clients mangent les cinq sièges de l'équipe — c'est
   * exactement ce que faisait le comptage unique.
   *
   * Les limites viennent de la fiche entreprise si elle en porte (un cabinet
   * peut en négocier plus que son offre n'en donne), sinon de l'offre. Zéro
   * ou absent des deux côtés = illimité : c'est ce qui laisse l'entreprise
   * historique et toute fiche antérieure à ce champ fonctionner sans
   * migration.
   */
  const seatLimitError = async (company: any, users: any[], role: string): Promise<string | null> => {
    if (!company) return null;
    const portal = role === CLIENT_ROLE;
    // La fiche entreprise d'abord (un cabinet peut négocier plus que son
    // offre), l'offre ensuite, et **rien du tout en dernier**. Ce dernier cas
    // n'est pas un oubli : une entreprise restée sur une offre retirée — ou
    // l'entreprise historique, dont l'offre n'est pas au catalogue — n'a
    // jamais souscrit un quota de comptes portail, et lui en imposer un
    // aujourd'hui casserait un portail déjà en service. Un `0` écrit *sur la
    // fiche* veut bien dire zéro : c'est une valeur saisie, pas une absence.
    const sellablePlan = SELLABLE_PLANS.find(p => p.id === company.plan) || null;
    const stored = Number(portal ? company.portalSeatLimit : company.seatLimit);
    const limit = Number.isFinite(stored)
      ? stored
      : sellablePlan
        ? (portal ? sellablePlan.portalSeatLimit : sellablePlan.seatLimit)
        : null;
    if (limit === null) return null;

    const used = users.filter((u: any) => (u.role === CLIENT_ROLE) === portal).length;
    if (used < limit) return null;
    return portal
      ? `Limite de ${limit} compte(s) portail client atteinte pour votre offre.`
      : `Limite de ${limit} utilisateur(s) atteinte pour votre offre.`;
  };

  // POST /api/users
  app.post('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const { username, password, role, permissions, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge, shiftStart, shiftEnd, breakMinutes, clientId } = req.body;

      const existing = await db.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      const company = await db.getCompanyById(req.user.companyId);
      const seatError = await seatLimitError(company, await db.getAllUsers(req.user.companyId), role);
      if (seatError) return res.status(403).json({ error: seatError });

      const hashed = await bcrypt.hash(password, 10);

      const simSalaire = typeof salaireBrut === 'number' ? salaireBrut : 0;
      const simRegime = typeof regimeHoraire === 'number' ? regimeHoraire : 0;
      const totalChargesPct = (typeof cnss === 'number' ? cnss : 0) + 
                              (typeof tfp === 'number' ? tfp : 0) + 
                              (typeof foprolos === 'number' ? foprolos : 0) + 
                              (typeof accidentTravail === 'number' ? accidentTravail : 0);
      const montantsCharges = simSalaire * (totalChargesPct / 100);
      const simPrimes = typeof primesFraisNonCotisables === 'number' ? primesFraisNonCotisables : 0;
      const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
      const heuresMensuelles = simRegime * 4.33;
      const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

      const newUser = await db.createUser(req.user.companyId, {
        id: Date.now(),
        username,
        password: hashed,
        role,
        permissions: JSON.stringify(permissions || []),
        salaireBrut,
        regimeHoraire,
        cnss,
        tfp,
        foprolos,
        accidentTravail,
        primesFraisNonCotisables,
        coutTotalEmployeur,
        coutHoraireEmployeur,
        shiftStart: shiftStart || null,
        shiftEnd: shiftEnd || null,
        breakMinutes: typeof breakMinutes === 'number' && Number.isFinite(breakMinutes) ? breakMinutes : null,
        // Rattachement au dossier client. Porté par l'utilisateur et non
        // l'inverse (`clients.userId`) : plusieurs comptes peuvent viser le
        // même client — le gérant et son comptable — sans table pivot, et un
        // compte ne peut par construction en viser qu'un seul.
        clientId: role === CLIENT_ROLE && clientId != null ? Number(clientId) : null,
      });

      // The admin sets the annual leave allowance from this same form.
      await db.updateLeaveBalance(req.user.companyId, newUser.id, {
        entitlement: num(soldeConge, DEFAULT_LEAVE_ENTITLEMENT),
        used: 0,
      });

      res.json(withLeaveBalance(publicUser(newUser), await db.getAllLeaveBalances(req.user.companyId)));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // PUT /api/users/:id
  app.put('/api/users/:id', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { role, permissions, password, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge, shiftStart, shiftEnd, breakMinutes, clientId } = req.body;

      // Changer de panier — d'un compte du back-office vers le portail client
      // ou l'inverse — revient à prendre un siège dans l'autre panier. Sans ce
      // contrôle, la limite se contournait en créant un compte portail puis
      // en le repassant collaborateur.
      const existingUser = await db.getUserById(req.user.companyId, id);
      if (existingUser && role && role !== existingUser.role
          && (role === CLIENT_ROLE) !== (existingUser.role === CLIENT_ROLE)) {
        const others = (await db.getAllUsers(req.user.companyId)).filter((u: any) => u.id !== id);
        const seatError = await seatLimitError(await db.getCompanyById(req.user.companyId), others, role);
        if (seatError) return res.status(403).json({ error: seatError });
      }
      
      const simSalaire = typeof salaireBrut === 'number' ? salaireBrut : 0;
      const simRegime = typeof regimeHoraire === 'number' ? regimeHoraire : 0;
      const totalChargesPct = (typeof cnss === 'number' ? cnss : 0) + 
                              (typeof tfp === 'number' ? tfp : 0) + 
                              (typeof foprolos === 'number' ? foprolos : 0) + 
                              (typeof accidentTravail === 'number' ? accidentTravail : 0);
      const montantsCharges = simSalaire * (totalChargesPct / 100);
      const simPrimes = typeof primesFraisNonCotisables === 'number' ? primesFraisNonCotisables : 0;
      const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
      const heuresMensuelles = simRegime * 4.33;
      const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

      const updates: any = { 
        role, 
        permissions: JSON.stringify(permissions || []), 
        salaireBrut, 
        regimeHoraire, 
        cnss, 
        tfp, 
        foprolos, 
        accidentTravail,
        primesFraisNonCotisables,
        coutTotalEmployeur,
        coutHoraireEmployeur,
        shiftStart: shiftStart || null,
        shiftEnd: shiftEnd || null,
        breakMinutes: typeof breakMinutes === 'number' && Number.isFinite(breakMinutes) ? breakMinutes : null,
        // Rattachement au dossier client. Porté par l'utilisateur et non
        // l'inverse (`clients.userId`) : plusieurs comptes peuvent viser le
        // même client — le gérant et son comptable — sans table pivot, et un
        // compte ne peut par construction en viser qu'un seul.
        clientId: role === CLIENT_ROLE && clientId != null ? Number(clientId) : null,
      };

      if (password) {
        updates.password = await bcrypt.hash(password, 10);
      }
      
      const updatedUser = await db.updateUser(req.user.companyId, id, updates);
      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Changing the allowance never touches days already consumed.
      if (typeof soldeConge === 'number') {
        await db.updateLeaveBalance(req.user.companyId, id, { entitlement: soldeConge });
      }

      res.json(withLeaveBalance(publicUser(updatedUser), await db.getAllLeaveBalances(req.user.companyId)));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  // DELETE /api/users/:id
  app.delete('/api/users/:id', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await db.deleteUser(req.user.companyId, id);
      if (!success) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  // ---------------------------------------------------------
  // Clients API Routes
  // ---------------------------------------------------------

  /**
   * A client can be paid in several instalments, so `encaissements` is a
   * *list*, each entry carrying its own amount and date — the same shape the
   * old per-invoice payments feature used, just living on the client instead.
   */
  const normalizeEncaissements = (raw: any): any[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e: any) => ({
        id: String(e?.id || `enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        amount: round3(num(Number(e?.amount), 0)),
        date: String(e?.date || '').slice(0, 10),
        note: String(e?.note || '').trim(),
      }))
      .filter((e: any) => e.date && Number.isFinite(e.amount))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  };
  // A client saved before this list existed has `encaissements` stored as a
  // bare number — summed as-is rather than crashing/zeroing it out, so
  // existing data (including whatever is already in production) still reads
  // correctly until the admin re-enters it as dated entries.
  const sumEncaissements = (client: any): number => {
    const raw = client?.encaissements;
    if (Array.isArray(raw)) return round3(raw.reduce((s: number, e: any) => s + num(Number(e?.amount), 0), 0));
    return round3(num(Number(raw), 0));
  };

  /**
   * Brouillard de caisse rows that are encaissements for a client — an
   * `entree` on a row tied to one. They are NOT copied onto the client:
   * the journal stays the single record of the movement, and the client's
   * encaissements are the manual list *plus* these, merged on read. Copying
   * would mean two rows to keep in step every time the journal is edited.
   *
   * Keyed by the same `clientBucketKey()` the invoice totals use, so a row
   * tied only by free-text client name still lands on the right client.
   */
  const journalEncaissementsByClient = (entries: any[]) => {
    const byKey = new Map<string, any[]>();
    for (const row of entries) {
      const amount = round3(num(Number(row?.entree), 0));
      if (amount <= 0) continue;
      if (!row?.clientId && !row?.clientName) continue;
      const key = clientBucketKey({ clientId: row.clientId, client: row.clientName });
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push({
        id: row.id,
        amount,
        date: String(row.date || '').slice(0, 10),
        note: String(row.label || '').trim(),
        // What the Clients view keys off to render these differently from the
        // ones typed there by hand — and to keep them read-only, since the
        // journal owns them.
        source: 'BROUILLARD',
        paymentMethod: row.paymentMethod || '',
        bankAccount: row.bankAccount || '',
        reference: row.reference || '',
        // Whether this encaissement actually passed through the till. The
        // Clients view badges on this rather than on `source`: since the
        // mode de règlement exists, a virement is recorded in Cash exactly
        // like an espèce but never reaches the caisse, and badging every
        // journal-sourced row "caisse" would have mislabelled it.
        isCaisse: isCashMode(row.paymentMethod),
      });
    }
    for (const list of byKey.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return byKey;
  };

  /** The journal encaissements belonging to one client, from a prepared map. */
  const journalFor = (byKey: Map<string, any[]>, client: any) =>
    [...(byKey.get(String(client.id)) || []), ...(byKey.get(`name:${client.name}`) || [])]
      .sort((a, b) => a.date.localeCompare(b.date));

  const sumAmounts = (rows: any[]) => round3(rows.reduce((s, r) => s + num(Number(r.amount), 0), 0));

  /**
   * The client's running ledger — used by GET (batched, one invoice scan for
   * every returned row) and by POST/PUT below (a single client, so a direct
   * scan is cheap). Both must agree, since editing a client's own soldeAnterieur/
   * encaissements would otherwise show stale montantFacture/resteAPayer until
   * the list happened to reload.
   */
  const enrichClientLedger = async (companyId: string, client: any) => {
    const invoices = await db.getAllInvoices(companyId);
    let montantFacture = 0;
    for (const inv of invoices) {
      if (!countsAsBilled(inv)) continue;
      const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      if (key === String(client.id) || key === `name:${client.name}`) {
        montantFacture += num(Number(inv.totalNetToPay), 0);
      }
    }
    montantFacture = round3(montantFacture);
    const soldeAnterieur = num(Number(client.soldeAnterieur), 0);
    const journalEncaissements = journalFor(
      journalEncaissementsByClient(await db.getAllCashJournalEntries(companyId)),
      client,
    );
    const encaissements = round3(sumEncaissements(client) + sumAmounts(journalEncaissements));
    return {
      ...client,
      montantFacture,
      journalEncaissements,
      resteAPayer: round3(soldeAnterieur - encaissements + montantFacture),
    };
  };

  // GET /api/clients
  app.get('/api/clients', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      let clients = await db.getAllClients(req.user.companyId);

      // Whether this viewer gets the ledger at all. Decided once here because
      // it governs three things, not just the response body: sorting and
      // filtering by a ledger field would otherwise let someone without the
      // permission read the figures back out of the row order.
      const seesLedger = await userCan(req, 'VIEW_CLIENT_FINANCIALS');

      // Parse filters
      let filters: Record<string, string> = {};
      if (req.query.filters) {
        try {
          filters = JSON.parse(req.query.filters);
        } catch (e) {
          // ignore
        }
      }
      if (!seesLedger) for (const f of LEDGER_FIELDS) delete filters[f];

      // 1. Global Search (q)
      const q = (req.query.q || '').toLowerCase();
      if (q) {
        clients = clients.filter((c: any) => {
          return (
            (c.name && c.name.toLowerCase().includes(q)) ||
            (c.email && c.email.toLowerCase().includes(q)) ||
            (c.phone && c.phone.toLowerCase().includes(q)) ||
            (c.city && c.city.toLowerCase().includes(q)) ||
            (c.taxId && c.taxId.toLowerCase().includes(q))
          );
        });
      }

      // 2. Column Filters
      for (const [key, value] of Object.entries(filters)) {
        if (!value) continue;
        const lowerVal = value.toString().toLowerCase();
        
        clients = clients.filter((c: any) => {
          let fieldVal = c[key];
          
          // Check custom fields if not found directly
          if (fieldVal === undefined && c.customFields) {
            fieldVal = c.customFields[key];
          }

          if (fieldVal === undefined || fieldVal === null) return false;

          // exact match for status or type, otherwise partial match
          if (key === 'status' || key === 'type') {
             return fieldVal.toString().toLowerCase() === lowerVal;
          }

          return fieldVal.toString().toLowerCase().includes(lowerVal);
        });
      }

      // 2b. Multiple specific clients at once (a picker, not free-text search)
      if (req.query.clientIds) {
        const idSet = new Set(
          String(req.query.clientIds).split(',').map((s: string) => Number(s.trim())).filter(Number.isFinite),
        );
        if (idSet.size > 0) clients = clients.filter((c: any) => idSet.has(c.id));
      }

      // 3. Sorting. Callers with their own sort UI (ClientsManagement) always
      // pass both params explicitly; this default only affects callers that
      // don't (the debounced client-search autocomplete used across Pointage/
      // assignment forms), where alphabetical is the more useful order.
      const requestedSort = req.query.sortField || 'name';
      const sortField = !seesLedger && LEDGER_FIELDS.includes(requestedSort) ? 'name' : requestedSort;
      const sortDir = req.query.sortDir || 'asc';

      clients.sort((a, b) => {
        let valA = a[sortField];
        if (valA === undefined && a.customFields) valA = a.customFields[sortField];
        
        let valB = b[sortField];
        if (valB === undefined && b.customFields) valB = b.customFields[sortField];

        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return sortDir === 'asc' ? -1 : 1;
        if (valB === undefined || valB === null) return sortDir === 'asc' ? 1 : -1;

        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      // 4. Pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100; // default to 100, or maybe we just return all if no pagination passed?

      // "Montant de facture" — the sum of a client's own invoices, computed
      // once per request (a single scan over every invoice, then O(1)
      // per-client lookups) rather than one invoice query per client row.
      // An invoice typed with a free-text client name (never linked via the
      // search dropdown) has no `clientId` — matched here by name instead,
      // same fallback `clientBucketKey()` already uses for the KPI dashboard,
      // so a document like that isn't silently dropped from the total.
      const allInvoices = await db.getAllInvoices(req.user.companyId);
      const montantFactureByClient = new Map<string, number>();
      for (const inv of allInvoices) {
        if (!countsAsBilled(inv)) continue;
        const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
        montantFactureByClient.set(key, round3((montantFactureByClient.get(key) || 0) + num(Number(inv.totalNetToPay), 0)));
      }
      // Enriched over every client matching the current search/filters, not
      // just the current page — the "Total Général" row needs the ledger
      // figures of clients that aren't currently visible too.
      // Same single-scan treatment as the invoices above: the brouillard is
      // read once for the whole request, then looked up per client.
      const journalByClient = journalEncaissementsByClient(await db.getAllCashJournalEntries(req.user.companyId));
      const enrichedAll = clients.map((c: any) => {
        const montantFacture = round3(
          (montantFactureByClient.get(String(c.id)) || 0) +
          (montantFactureByClient.get(`name:${c.name}`) || 0),
        );
        const soldeAnterieur = num(Number(c.soldeAnterieur), 0);
        const journalEncaissements = journalFor(journalByClient, c);
        const encaissements = round3(sumEncaissements(c) + sumAmounts(journalEncaissements));
        return {
          ...c,
          montantFacture,
          journalEncaissements,
          resteAPayer: round3(soldeAnterieur - encaissements + montantFacture),
        };
      });

      // If client didn't explicitly request pagination, maybe return array to preserve backward compatibility?
      // The user wants "Do not load the entire Clients database... Use pagination".
      // We will ALWAYS return pagination wrapper if page/limit is provided, else we return array.
      const startIndex = (page - 1) * limit;
      const rows = req.query.page ? enrichedAll.slice(startIndex, startIndex + limit) : enrichedAll;

      // Without VIEW_CLIENT_FINANCIALS the ledger never leaves the server:
      // no per-row figures and no "Total Général", which is those same
      // figures summed.
      const page_ = seesLedger ? rows : rows.map(stripLedger);

      if (req.query.page) {
        // Sums across the whole filtered set, not the page — this is what the
        // Clients table's frozen "Total Général" row displays, and it must
        // stay correct regardless of which page is currently showing.
        const totals = enrichedAll.reduce((acc: any, c: any) => {
          acc.soldeAnterieur = round3(acc.soldeAnterieur + num(Number(c.soldeAnterieur), 0));
          acc.montantFacture = round3(acc.montantFacture + num(Number(c.montantFacture), 0));
          // c.journalEncaissements is already attached above — reuse it rather
          // than re-deriving, so the total can never drift from the rows.
          acc.encaissements = round3(acc.encaissements + sumEncaissements(c) + sumAmounts(c.journalEncaissements || []));
          acc.resteAPayer = round3(acc.resteAPayer + num(Number(c.resteAPayer), 0));
          return acc;
        }, { soldeAnterieur: 0, montantFacture: 0, encaissements: 0, resteAPayer: 0 });
        res.json({ data: page_, total: clients.length, page, limit, ...(seesLedger ? { totals } : {}) });
      } else {
        res.json(page_);
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/clients/fields
  app.get('/api/clients/fields', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const clients = await db.getAllClients(req.user.companyId);
      const customFieldKeys = new Set<string>();
      clients.forEach((c: any) => {
        if (c.customFields) {
          Object.keys(c.customFields).forEach(k => customFieldKeys.add(k));
        }
      });
      res.json(Array.from(customFieldKeys).sort((a, b) => a.localeCompare(b)));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Les colonnes personnalisées se renomment et se suppriment **pour tous les
   * clients à la fois**, depuis le sélecteur de colonnes. Une telle colonne
   * n'existe nulle part ailleurs qu'en clé de `customFields` sur chaque
   * fiche : la corriger fiche par fiche voudrait dire ouvrir chaque client,
   * et laisserait deux colonnes dans le tableau tant que le tour n'est pas
   * fini. C'est aussi pour ça que les deux opérations sont côté serveur et
   * pas une boucle de PUT depuis le navigateur — un onglet fermé au milieu
   * laisserait le cabinet avec « Tel » sur la moitié des fiches et
   * « Téléphone » sur l'autre.
   *
   * Ne touche que les champs personnalisés : les colonnes natives (nom,
   * email, matricule…) se masquent, elles ne se renomment pas.
   */
  const NATIVE_CLIENT_FIELDS = new Set([
    'id', 'companyid', 'name', 'type', 'email', 'phone', 'taxid', 'address', 'city',
    'country', 'status', 'notes', 'customfields', 'soldeanterieur', 'encaissements',
    'nonfacturable', 'userid', 'createdat',
  ]);

  /** Même normalisation que l'import : un en-tête de tableur arrive avec des
   *  espaces en trop, et « Tel  » ne doit pas devenir une deuxième colonne. */
  const normalizeFieldName = (v: any) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

  const clientCustomFieldKeys = async (companyId: string) => {
    const clients = await db.getAllClients(companyId);
    const keys = new Set<string>();
    clients.forEach((c: any) => {
      if (c.customFields) Object.keys(c.customFields).forEach(k => keys.add(k));
    });
    return keys;
  };

  // PUT /api/clients/fields  { from, to }
  app.put('/api/clients/fields', authenticate, requirePermission('MANAGE_CLIENT_FIELDS'), async (req: any, res: any) => {
    try {
      const from = String(req.body?.from ?? '');
      const to = normalizeFieldName(req.body?.to);
      if (!from || !to) return res.status(400).json({ error: 'Nom de colonne requis.' });

      const keys = await clientCustomFieldKeys(req.user.companyId);
      if (!keys.has(from)) return res.status(404).json({ error: 'Cette colonne n\'existe pas.' });
      if (to === from) return res.json({ from, to, updated: 0 });

      // Refusé plutôt que fusionné : deux colonnes rabattues l'une sur
      // l'autre perdraient une valeur par fiche, sans dire laquelle.
      if ([...keys].some(k => k !== from && k.toLowerCase() === to.toLowerCase())) {
        return res.status(409).json({ error: `La colonne « ${to} » existe déjà.` });
      }
      // Une colonne personnalisée qui porte le nom d'un champ natif est
      // inatteignable : le filtre et le tri ne retombent sur customFields que
      // lorsque la propriété de premier niveau est absente.
      if (NATIVE_CLIENT_FIELDS.has(to.toLowerCase())) {
        return res.status(409).json({ error: `« ${to} » est un champ natif de la fiche client.` });
      }

      const updated = await db.renameClientCustomField(req.user.companyId, from, to);
      res.json({ from, to, updated });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/clients/fields?name=...
  app.delete('/api/clients/fields', authenticate, requirePermission('MANAGE_CLIENT_FIELDS'), async (req: any, res: any) => {
    try {
      // Le nom voyage en query et non dans le chemin : un en-tête de tableur
      // contient volontiers « / » ou « . ».
      const name = String(req.query?.name ?? '');
      if (!name) return res.status(400).json({ error: 'Nom de colonne requis.' });

      const keys = await clientCustomFieldKeys(req.user.companyId);
      if (!keys.has(name)) return res.status(404).json({ error: 'Cette colonne n\'existe pas.' });

      const updated = await db.deleteClientCustomField(req.user.companyId, name);
      res.json({ name, updated });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * The distinct values a given field actually holds, so the Clients filter
   * can offer real choices instead of a blind free-text box. Works for a
   * native column or a customFields key — same lookup order the list
   * endpoint's own filtering uses. Capped: this feeds a picker, not an export.
   */
  app.get('/api/clients/field-values', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const field = String(req.query.field || '');
      if (!field) return res.json([]);
      const q = String(req.query.q || '').toLowerCase();
      const clients = await db.getAllClients(req.user.companyId);

      const values = new Set<string>();
      for (const c of clients) {
        const raw = c[field] !== undefined && c[field] !== null && c[field] !== ''
          ? c[field]
          : c.customFields?.[field];
        if (raw === undefined || raw === null) continue;
        const value = String(raw).trim();
        if (!value) continue;
        if (q && !value.toLowerCase().includes(q)) continue;
        values.add(value);
      }
      res.json(Array.from(values).sort((a, b) => a.localeCompare(b)).slice(0, 50));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/clients/:id
  app.get('/api/clients/:id', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const client = await db.getClientById(req.user.companyId, id);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      res.json((await userCan(req, 'VIEW_CLIENT_FINANCIALS')) ? client : stripLedger(client));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/clients
  
// --- KPI DASHBOARD ENDPOINT ---

// --- KPI SEARCH ENDPOINTS ---
app.get('/api/kpi/users/search', authenticate, async (req: any, res: any) => {
  if (!DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const q = (req.query.q || '').toLowerCase();
  let users = await db.getAllUsers(req.user.companyId);
  // Un administrateur pointe du temps et a désormais sa ligne dans le tableau
  // de performance : il doit pouvoir filtrer dessus. Les autres lecteurs du
  // tableau de bord ne le voient toujours pas — même règle que Pointage.
  if (req.user.role !== 'ADMIN') {
    users = users.filter((u: any) => u.role !== 'ADMIN');
  }
  if (q) {
    users = users.filter((u: any) => 
      u.username.toLowerCase().includes(q) || 
      (u.fullName && u.fullName.toLowerCase().includes(q))
    );
  }
  // limit to 10 for autocomplete
  const sorted = [...users].sort((a: any, b: any) => (a.fullName || a.username).localeCompare(b.fullName || b.username));
  res.json(sorted.slice(0, 10).map((u: any) => ({ id: u.id, name: u.fullName || u.username, role: u.role })));
});

app.get('/api/kpi/clients/search', authenticate, async (req: any, res: any) => {
  if (!DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const q = (req.query.q || '').toLowerCase();
  let clients = await db.getAllClients(req.user.companyId);
  if (q) {
    clients = clients.filter((c: any) => c.name.toLowerCase().includes(q));
  }
  // limit to 10
  const sortedClients = [...clients].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
  res.json(sortedClients.slice(0, 10).map((c: any) => ({ id: c.id, name: c.name })));
});

/**
 * Tasks behind one client's row on the dashboard, under the same filters.
 * Loaded on expand so the summary payload stays small no matter how many
 * clients and entries exist.
 */
app.post('/api/kpi/client-tasks', authenticate, async (req: any, res: any) => {
  try {
    // Open to everyone, scoped the same way /api/kpi/dashboard is: a viewer
    // without a team role is pinned to their own id server-side, so the
    // personal dashboard can drill into a client and still only ever see its
    // own tasks — sending someone else's filterUserIds changes nothing.
    const isTeamViewer = DASHBOARD_ROLES.includes(req.user.role);
    if (!isTeamViewer) req.body.filterUserIds = [req.user.id];

    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'A client key is required' });

    const isAdminViewer = req.user.role === 'ADMIN';
    const allUsers = await db.getAllUsers(req.user.companyId);
    const usersById = new Map<number, any>(allUsers.map((u: any) => [u.id, u]));

    const entries = filterKpiEntries(await db.getAllTimeEntries(req.user.companyId) || [], req.body)
      .filter((t: any) => clientBucketKey(t) === String(key))
      .sort((a: any, b: any) => accruedSeconds(b) - accruedSeconds(a));

    const LIMIT = 200;
    const truncated = Math.max(0, entries.length - LIMIT);

    const tasks = entries.slice(0, LIMIT).map((t: any) => {
      const secs = accruedSeconds(t);
      const rate = typeof t.hourlyRate === 'number' ? t.hourlyRate : null;
      const user = usersById.get(t.userId);
      const row: any = {
        id: t.id,
        date: t.date,
        userName: user ? (user.fullName || user.username) : 'Inconnu',
        description: t.description || '',
        mission: t.pole || '',
        taskType: t.taskType || '',
        statut: t.statut,
        dureeSeconds: secs,
        dureeFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
      };
      if (isAdminViewer) row.cost = rate === null ? null : (secs / 3600) * rate;
      return row;
    });

    res.json({ tasks, total: entries.length, truncated });
  } catch (error) {
    console.error('KPI client-tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Tasks behind one collaborator, under the dashboard filters. Loaded on open. */
app.post('/api/kpi/employee-tasks', authenticate, async (req: any, res: any) => {
  try {
    if (!DASHBOARD_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.body?.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'A userId is required' });

    const isAdminViewer = req.user.role === 'ADMIN';

    // Les tâches d'un administrateur ne sont pas montrées aux autres — même
    // règle que `visibleEntriesFor()` dans Pointage. Le tableau de performance
    // n'offre la ligne qu'à un ADMIN, mais cette route s'appelle avec un
    // userId quelconque : le refus appartient au serveur, pas à l'absence de
    // bouton.
    if (!isAdminViewer) {
      const target = await db.getUserById(req.user.companyId, userId);
      if (target?.role === 'ADMIN' && userId !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const clients = await db.getAllClients(req.user.companyId) || [];
    const clientsById = new Map<number, any>(clients.map((c: any) => [c.id, c]));

    const entries = filterKpiEntries(await db.getAllTimeEntries(req.user.companyId) || [], req.body)
      .filter((t: any) => t.userId === userId)
      .sort((a: any, b: any) => accruedSeconds(b) - accruedSeconds(a));

    const LIMIT = 200;
    const truncated = Math.max(0, entries.length - LIMIT);

    const tasks = entries.slice(0, LIMIT).map((t: any) => {
      const secs = accruedSeconds(t);
      const rate = typeof t.hourlyRate === 'number' ? t.hourlyRate : null;
      const row: any = {
        id: t.id,
        date: t.date,
        clientId: t.clientId ?? null,
        client: (t.clientId != null ? clientsById.get(t.clientId)?.name : null) || t.client || 'Sans client',
        description: t.description || '',
        pole: t.pole || '',
        taskType: t.taskType || '',
        statut: t.statut,
        heureDebut: t.heureDebut || '',
        heureFin: t.heureFin || '',
        dureeSeconds: secs,
        dureeFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
      };
      if (isAdminViewer) row.cost = rate === null ? null : (secs / 3600) * rate;
      return row;
    });

    res.json({ tasks, total: entries.length, truncated });
  } catch (error) {
    console.error('KPI employee-tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/kpi/dashboard', authenticate, async (req: any, res: any) => {
  try {
    // ADMIN/SUPERVISEUR see the whole team dashboard. Everyone else (COLLABORATOR,
    // STAGIAIRE) gets the same endpoint but pinned to their own id server-side —
    // a collaborator sending a different filterUserIds in the body still only
    // ever gets their own data back.
    const isTeamViewer = DASHBOARD_ROLES.includes(req.user.role);
    if (!isTeamViewer) {
      req.body.filterUserIds = [req.user.id];
    }

    const { startDate, endDate, filterUserIds, filterClientIds } = req.body;

    const parseFrenchDate = (dateStr: string) => {
      // Date in DD/MM/YYYY
      if (!dateStr) return 0;
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`).getTime();
      }
      return 0;
    };

    const parseIsoDate = (dateStr: string) => {
      if (!dateStr) return 0;
      return new Date(dateStr).getTime();
    };

    const startTs = startDate ? parseIsoDate(startDate) : 0;
    const endTs = endDate ? parseIsoDate(endDate) + 86400000 - 1 : Infinity; // Include the whole end day

    // Get all base data
    const allUsers = await db.getAllUsers(req.user.companyId);
    let timeEntries = await db.getAllTimeEntries(req.user.companyId) || [];
    let leaveRequests = await db.getAllLeaveRequests(req.user.companyId) || [];
    let authorizations = await db.getAllAbsenceAuthorizations(req.user.companyId) || [];
    let clients = await db.getAllClients(req.user.companyId) || [];
    let leaveBalances = await db.getAllLeaveBalances(req.user.companyId) || [];
    let attendanceRecords = await db.getAllAttendanceRecords(req.user.companyId) || [];

    // Filter time entries (shared with the per-client drill-down endpoint)
    timeEntries = filterKpiEntries(timeEntries, req.body);

    // Filter pointage records the same way as leaves/authorizations — by
    // calendar date, since attendance has no start/end range of its own.
    attendanceRecords = attendanceRecords.filter((r: any) => {
      const ts = parseIsoDate(r.date);
      if (ts < startTs || ts > endTs) return false;
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(r.userId)) return false;
      return true;
    });

    // Filter leave requests
    leaveRequests = leaveRequests.filter((l: any) => {
      const tsStart = parseIsoDate(l.startDate);
      const tsEnd = parseIsoDate(l.endDate);
      // Overlap logic
      if (tsEnd < startTs || tsStart > endTs) return false;
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(l.userId)) return false;
      return true;
    });

    // Filter authorizations
    authorizations = authorizations.filter((a: any) => {
      const ts = parseIsoDate(a.date);
      if (ts < startTs || ts > endTs) return false;
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(a.userId)) return false;
      return true;
    });

    const employees = allUsers.filter((u: any) => STAFF_ROLES.includes(u.role));

    const kpiSettings = await db.getSettings(req.user.companyId);
    const isAdminViewer = req.user.role === 'ADMIN';

    /**
     * Qui apparaît dans le tableau de performance.
     *
     * L'effectif (`employees`) reste ce qu'il était : un administrateur est un
     * compte, pas une tête à compter, et le rentrer dans « Effectif »
     * changerait un chiffre déjà en place. Mais un administrateur pointe du
     * temps comme les autres, et ce temps entrait dans les totaux globaux sans
     * qu'aucune ligne ne dise qui l'avait fait.
     *
     * Visible du seul ADMIN : « les tâches d'un administrateur ne sont pas
     * montrées aux autres » vaut ici comme dans Pointage, sans quoi un
     * SUPERVISEUR lirait dans ce tableau ce que `visibleEntriesFor()` lui
     * refuse à l'écran d'à côté.
     */
    const performanceUsers = isAdminViewer
      ? allUsers.filter((u: any) => STAFF_ROLES.includes(u.role) || u.role === 'ADMIN')
      : employees;

    // Index once instead of scanning allUsers/clients per task. With thousands
    // of entries the repeated .find() calls were the dominant cost here.
    const usersById = new Map<number, any>(allUsers.map((u: any) => [u.id, u]));
    const clientsById = new Map<number, any>(clients.map((c: any) => [c.id, c]));
    const userLabel = (id: number) => {
      const u = usersById.get(id);
      return u ? (u.fullName || u.username) : 'Inconnu';
    };

    // Each task is costed at the rate snapshotted when it was created, so a
    // salary change only affects work logged after it.
    const taskRate = (t: any) => (typeof t.hourlyRate === 'number' ? t.hourlyRate : null);
    const taskCost = (t: any) => {
      const rate = taskRate(t);
      return rate === null ? null : (accruedSeconds(t) / 3600) * rate;
    };

    const globalDurationSeconds = timeEntries.reduce(
      (sum: number, t: any) => sum + accruedSeconds(t), 0);

    // Tasks logged while the collaborator had no employer cost configured are
    // excluded rather than priced at a guess; `tasksWithoutRate` says how many.
    let tasksWithoutRate = 0;
    const globalCost = timeEntries.reduce((sum: number, t: any) => {
      const c = taskCost(t);
      if (c === null) { tasksWithoutRate++; return sum; }
      return sum + c;
    }, 0);
    
    const gHours = Math.floor(globalDurationSeconds / 3600);
    const gMins = Math.floor((globalDurationSeconds % 3600) / 60);

    // Calculate global stats
    const globalStats = {
      totalCollaborators: employees.filter((u: any) => u.role === 'COLLABORATOR').length,
      totalSupervisors: employees.filter((u: any) => u.role === 'SUPERVISEUR').length,
      totalHeadcount: employees.length,
      // Headcount per role, so a newly added role shows up without a code change here.
      headcountByRole: STAFF_ROLES.reduce((acc: Record<string, number>, roleId: string) => {
        acc[roleId] = employees.filter((u: any) => u.role === roleId).length;
        return acc;
      }, {}),
      totalTasks: timeEntries.length,
      completedTasks: timeEntries.filter((t: any) => t.statut === 'COMPLETED').length,
      inProgressTasks: timeEntries.filter((t: any) => t.statut === 'RUNNING').length,
      pausedTasks: timeEntries.filter((t: any) => t.statut === 'PAUSED').length,
      clientsHandled: new Set(timeEntries.filter((t: any) => t.clientId).map((t: any) => t.clientId)).size,
      totalDurationSeconds: globalDurationSeconds,
      totalDurationFormatted: `${gHours}h${String(gMins).padStart(2, '0')}`,
      totalCost: globalCost,
      totalCostFormatted: formatCostTND(globalCost),
      tasksWithoutRate,
      // Combien de tâches ont réellement un taux. Sans ce compte, l'écran ne
      // peut pas distinguer « le coût est nul » de « on ne sait pas » : les
      // deux valent 0, et afficher 0 dans le second cas affirme gratuitement
      // que le travail n'a rien coûté.
      pricedTasks: timeEntries.length - tasksWithoutRate,
      activeLeaves: leaveRequests.filter((l: any) => l.status === 'APPROVED').length,
      activeAuthorizations: authorizations.filter((a: any) => a.status === 'APPROVED').length,
    };

    // Calculate per employee stats
    const employeeStats = performanceUsers.map((emp: any) => {
      if (filterUserIds && filterUserIds.length > 0 && !filterUserIds.includes(emp.id)) return null;

      const empTasks = timeEntries.filter((t: any) => t.userId === emp.id);
      const totalTasks = empTasks.length;
      const completedTasks = empTasks.filter((t: any) => t.statut === 'COMPLETED').length;
      const inProgressTasks = empTasks.filter((t: any) => t.statut === 'RUNNING').length;
      const pausedTasks = empTasks.filter((t: any) => t.statut === 'PAUSED').length;

      const totalDurationSeconds = empTasks.reduce(
        (sum: number, t: any) => sum + accruedSeconds(t), 0);

      // Sum of each task at its own historical rate — not this person's current
      // rate applied to all their hours.
      const empUnpricedTasks = empTasks.filter((t: any) => taskCost(t) === null).length;
      const empPricedTasks = empTasks.length - empUnpricedTasks;
      const totalCost = empTasks.reduce((sum: number, t: any) => sum + (taskCost(t) ?? 0), 0);
      // The rate in force *now* — what future tasks will be costed at.
      const currentRate = employerHourlyRate(emp, kpiSettings);
      
      const eHours = Math.floor(totalDurationSeconds / 3600);
      const eMins = Math.floor((totalDurationSeconds % 3600) / 60);
      const totalDurationFormatted = `${eHours}h${String(eMins).padStart(2, '0')}`;
      const totalCostFormatted = formatCostTND(totalCost);
      
      const empClients = new Set();
      const clientTasksCount: any = {};
      // Duration per client, summed alongside the count in the same pass —
      // the "Clients Traités" list needs both, and this is the loop that
      // already visits every one of this collaborator's tasks.
      const clientDurationSeconds: any = {};
      empTasks.forEach((t: any) => {
        if (t.clientId) {
          empClients.add(t.clientId);
          clientTasksCount[t.clientId] = (clientTasksCount[t.clientId] || 0) + 1;
          clientDurationSeconds[t.clientId] = (clientDurationSeconds[t.clientId] || 0) + accruedSeconds(t);
        }
      });
      
      const empLeaves = leaveRequests.filter((l: any) => l.userId === emp.id);
      const balance = leaveBalances.find((b: any) => b.userId === emp.id)
        || { entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0, available: DEFAULT_LEAVE_ENTITLEMENT };
      
      const empAuths = authorizations.filter((a: any) => a.userId === emp.id);
      const totalAuthDuration = empAuths
        .filter((a: any) => a.status === 'APPROVED')
        .reduce((sum: number, a: any) => sum + (a.duration || 0), 0);

      // Pointage: a check-in/checkout is only "on time" within the 15-minute
      // tolerance — beyond it counts against punctuality, feeding the
      // performance view the same way task completion does.
      const empAttendance = attendanceRecords.filter((r: any) => r.userId === emp.id);
      const checkins = empAttendance.filter((r: any) => r.checkinAt);
      const onTimeCheckins = checkins.filter((r: any) => (r.checkinLateMinutes ?? 0) <= PUNCTUALITY_TOLERANCE_MIN).length;
      const checkouts = empAttendance.filter((r: any) => r.checkoutAt);
      const onTimeCheckouts = checkouts.filter((r: any) => Math.abs(r.checkoutLateMinutes ?? 0) <= PUNCTUALITY_TOLERANCE_MIN).length;
      const viaPhoneCount = empAttendance.filter((r: any) => r.checkinViaPhone || r.checkoutViaPhone).length;

      const clientListDetails = Array.from(empClients).map((cid: any) => {
        const c = clientsById.get(cid);
        const secs = clientDurationSeconds[cid] || 0;
        return {
          id: cid,
          name: c ? c.name : 'Unknown',
          taskCount: clientTasksCount[cid],
          durationSeconds: secs,
          durationFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
        };
      }).sort((a: any, b: any) => b.durationSeconds - a.durationSeconds);

      // The per-task breakdown is NOT inlined: 40 collaborators × their history
      // is the bulk of this payload. The drill-down modal loads it from
      // /api/kpi/employee-tasks when it opens.
      return {
        id: emp.id,
        name: emp.fullName || emp.username,
        role: emp.role,
        department: emp.department || 'N/A',
        totalDurationSeconds,
        totalDurationFormatted,
        totalCost,
        totalCostFormatted,
        // Rate that will apply to *new* tasks; null = not configured.
        hourlyRate: currentRate,
        pricedTasks: empPricedTasks,
        unpricedTasks: empUnpricedTasks,
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          inProgress: inProgressTasks,
          paused: pausedTasks,
          late: 0,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
          totalDurationSeconds,
          totalDurationFormatted,
          totalCost,
          totalCostFormatted
        },
        clients: {
          totalHandled: empClients.size,
          list: clientListDetails
        },
        leaves: {
          totalRequests: empLeaves.length,
          approved: empLeaves.filter((l: any) => l.status === 'APPROVED').length,
          pending: empLeaves.filter((l: any) => l.status === 'PENDING').length,
          rejected: empLeaves.filter((l: any) => l.status === 'REJECTED').length,
          daysTaken: empLeaves.filter((l: any) => l.status === 'APPROVED').reduce((sum: number, l: any) => sum + (l.duration || 0), 0),
          balance: balance
        },
        authorizations: {
          total: empAuths.length,
          approved: empAuths.filter((a: any) => a.status === 'APPROVED').length,
          pending: empAuths.filter((a: any) => a.status === 'PENDING').length,
          rejected: empAuths.filter((a: any) => a.status === 'REJECTED').length,
          totalDuration: totalAuthDuration // in hours
        },
        attendance: {
          checkins: checkins.length,
          onTimeCheckins,
          lateCheckins: checkins.length - onTimeCheckins,
          checkouts: checkouts.length,
          onTimeCheckouts,
          viaPhone: viaPhoneCount,
          punctualityRate: checkins.length > 0 ? (onTimeCheckins / checkins.length) * 100 : null,
        }
      };
    }).filter(Boolean);

    // A non-team viewer's own row is the only one they may see — other
    // collaborators must not appear even as zero-value rows, since that would
    // leak coworker names to someone with no MANAGE_USERS permission.
    const scopedEmployeeStats = isTeamViewer
      ? employeeStats
      : employeeStats.filter((e: any) => e.id === req.user.id);

    // Company-wide headcount is a team-viewer figure; a personal dashboard
    // only ever needs its own totals, already reflected below.
    if (!isTeamViewer) {
      delete globalStats.totalHeadcount;
      delete globalStats.totalCollaborators;
      delete globalStats.totalSupervisors;
      delete globalStats.headcountByRole;
    }

    // ----- Per-client breakdown: cost, who worked on it, and what they did.
    // Built from the same already-filtered `timeEntries`, so it always reflects
    // the date / collaborator / client filters applied above.
    const clientBuckets = new Map<string, any[]>();
    timeEntries.forEach((t: any) => {
      const key = clientBucketKey(t);
      if (!clientBuckets.has(key)) clientBuckets.set(key, []);
      clientBuckets.get(key)!.push(t);
    });

    // ----- Invoicing per client, under the same filters.
    // Documents carry `clientName` where entries carry `client`, so they are
    // normalised onto the identical bucket key — otherwise a client tracked by
    // name on one side and by id on the other would split into two rows.
    const invoiceBuckets = new Map<string, { netToPay: number; count: number }>();
    const allInvoices = await db.getAllInvoices(req.user.companyId) || [];
    // One journal scan for the whole request, same as the invoice scan below.
    const dashboardJournalByClient = journalEncaissementsByClient(await db.getAllCashJournalEntries(req.user.companyId) || []);
    // "Montant de facture" is a lifetime running-balance figure (same one
    // shown on the Clients page), not scoped to the dashboard's date filter —
    // computed here from the unfiltered `allInvoices` fetched above. Keyed
    // the same way as `clientBuckets`/`invoiceBuckets` (id, or name when the
    // document was never linked to a real client record), so every entry
    // below can look itself up with the exact same `key` it already has.
    const montantFactureByClient = new Map<string, number>();
    for (const inv of allInvoices) {
      // "Autre document (non facturable)" is explicitly excluded from the
      // client's running balance and from the billing activity below — it
      // exists in Cash but isn't billing.
      if (!countsAsBilled(inv)) continue;
      const k = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      montantFactureByClient.set(k, round3((montantFactureByClient.get(k) || 0) + num(Number(inv.totalNetToPay), 0)));
      const ts = parseIsoDate(inv.issueDate);
      if (ts < startTs || ts > endTs) continue;
      if (filterClientIds && filterClientIds.length > 0 && !filterClientIds.includes(inv.clientId)) continue;
      const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      const acc = invoiceBuckets.get(key) || { netToPay: 0, count: 0 };
      acc.netToPay += num(Number(inv.totalNetToPay), 0);
      acc.count += 1;
      invoiceBuckets.set(key, acc);
      // A client invoiced in the period but with no tracked time still belongs
      // in the table: otherwise its billing would silently read as zero.
      if (!clientBuckets.has(key)) clientBuckets.set(key, []);
    }

    const clientStats = [...clientBuckets.entries()].map(([key, entries]) => {
      // A bucket with no entries came from an invoice; fall back to that
      // document for the client's identity.
      const invoiceSample = entries.length === 0
        ? allInvoices.find((i: any) =>
            clientBucketKey({ clientId: i.clientId, client: i.clientName }) === key)
        : null;
      const first = entries[0] ?? { clientId: invoiceSample?.clientId ?? null, client: invoiceSample?.clientName || 'Sans client' };
      const clientRecord = first.clientId != null ? clientsById.get(first.clientId) : null;

      const durationSeconds = entries.reduce((s: number, t: any) => s + accruedSeconds(t), 0);
      const unpricedTasks = entries.filter((t: any) => taskCost(t) === null).length;
      const totalCost = entries.reduce((s: number, t: any) => s + (taskCost(t) ?? 0), 0);

      // Who worked on this client, and how much each contributed.
      const byUser = new Map<number, any[]>();
      entries.forEach((t: any) => {
        if (!byUser.has(t.userId)) byUser.set(t.userId, []);
        byUser.get(t.userId)!.push(t);
      });
      const contributors = [...byUser.entries()].map(([userId, userEntries]) => {
        const secs = userEntries.reduce((s: number, t: any) => s + accruedSeconds(t), 0);
        const user = usersById.get(userId);
        return {
          userId,
          name: user ? (user.fullName || user.username) : 'Inconnu',
          role: user ? user.role : null,
          taskCount: userEntries.length,
          durationSeconds: secs,
          durationFormatted: `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`,
          cost: userEntries.reduce((s: number, t: any) => s + (taskCost(t) ?? 0), 0),
        };
      }).sort((a, b) => b.durationSeconds - a.durationSeconds);

      // The task list is deliberately NOT included here. With hundreds of
      // clients it would mean serialising the whole history on every dashboard
      // load; the rows below fetch it from /api/kpi/client-tasks on expand.
      const montantFacture = round3(montantFactureByClient.get(key) || 0);
      const soldeAnterieur = num(Number(clientRecord?.soldeAnterieur), 0);
      // Brouillard de caisse entrées count as encaissements on the Clients
      // page, so they have to count here too — this block promises the same
      // figures, and a dashboard that quietly disagreed with the ledger it
      // claims to mirror is worse than one that showed nothing.
      const encaissements = round3(
        sumEncaissements(clientRecord) +
        sumAmounts(clientRecord ? journalFor(dashboardJournalByClient, clientRecord) : (dashboardJournalByClient.get(key) || [])),
      );
      return {
        id: first.clientId ?? key,
        key,
        name: clientRecord ? clientRecord.name : (first.client || 'Sans client'),
        taskCount: entries.length,
        completedTasks: entries.filter((t: any) => t.statut === 'COMPLETED').length,
        durationSeconds,
        durationFormatted: `${Math.floor(durationSeconds / 3600)}h${String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, '0')}`,
        totalCost,
        totalCostFormatted: formatCostTND(totalCost),
        unpricedTasks,
        contributors,
        // Billing for the same client over the same period.
        invoiceCount: invoiceBuckets.get(key)?.count ?? 0,
        netToPay: round3(invoiceBuckets.get(key)?.netToPay ?? 0),
        // The client's running ledger — lifetime, not period-scoped (same
        // figures shown on the Clients page, so the two never disagree).
        soldeAnterieur,
        encaissements,
        montantFacture,
        resteAPayer: round3(soldeAnterieur - encaissements + montantFacture),
      };
    }).sort((a, b) => b.totalCost - a.totalCost || b.netToPay - a.netToPay || b.durationSeconds - a.durationSeconds);

    if (isAdminViewer) {
      return res.json({ globalStats, employeeStats, clientStats });
    }

    // Employer cost is admin-only. A supervisor still gets the whole dashboard,
    // just without any money figures — stripped server-side, not merely hidden.
    // Every money field, not just employer cost: what a client was invoiced
    // and has paid is exactly as confidential, and hiding it in the UI alone
    // would still ship it over the wire.
    const stripCost = ({
      totalCost, totalCostFormatted, hourlyRate, cost,
      netToPay, invoiceCount,
      soldeAnterieur, encaissements, montantFacture, resteAPayer,
      ...rest
    }: any) => rest;
    res.json({
      globalStats: stripCost({ ...globalStats, tasksWithoutRate: undefined }),
      employeeStats: scopedEmployeeStats.map((e: any) => ({
        ...stripCost(e),
        tasks: stripCost(e.tasks),
      })),
      clientStats: clientStats.map((c: any) => ({
        ...stripCost(c),
        contributors: c.contributors.map(stripCost),
      })),
    });
  } catch (error) {
    console.error('KPI error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ---------------------------------------------------------------------------
 * Tableau de bord Direction — agrégats exécutifs.
 * ---------------------------------------------------------------------------
 *
 * POST plutôt que GET, comme /api/kpi/dashboard juste au-dessus : les filtres
 * voyagent dans le corps, ce qui permet de réutiliser `filterKpiEntries()` tel
 * quel. Une seule implémentation des filtres pour le résumé et pour les
 * drill-downs — sinon un détail finit par contredire la ligne d'où l'on a
 * cliqué, et l'écran entier perd sa crédibilité.
 *
 * Ne renvoie QUE des agrégats, jamais de liste de tâches : le détail se charge
 * au clic via /api/kpi/client-tasks et /api/kpi/employee-tasks, qui existent
 * déjà. Inliner ces listes ici avait fait passer une charge utile de 219 Ko à
 * 3,2 Mo à 300 clients / 6000 entrées.
 */
app.post('/api/dashboard/executive', authenticate, async (req: any, res: any) => {
  try {
    if (!DASHBOARD_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const companyId = req.user.companyId;
    const isAdminViewer = req.user.role === 'ADMIN';

    const filterUserIds: number[] = req.body?.filterUserIds || [];
    const filterClientIds: number[] = req.body?.filterClientIds || [];

    /**
     * Un filtre collaborateur restreint le temps mais pas les factures : une
     * facture n'a pas d'auteur. Comparer les honoraires de tout le monde au
     * coût d'une seule personne produit une marge spectaculairement fausse et
     * parfaitement crédible — donc on ne la calcule pas du tout, et le client
     * grise les blocs financiers en le disant.
     */
    const financialsFiltered = filterUserIds.length > 0;
    const showMoney = isAdminViewer && !financialsFiltered;

    const dayMs = 86400000;
    const startTs = req.body?.startDate ? new Date(req.body.startDate).getTime() : 0;
    const endTs = req.body?.endDate ? new Date(req.body.endDate).getTime() + dayMs - 1 : Date.now();

    // Période précédente de MÊME DURÉE, immédiatement antérieure.
    const spanMs = Math.max(dayMs, endTs - startTs);
    const prevEndTs = startTs - 1;
    const prevStartTs = startTs - spanMs;
    const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);
    const prevBody = { startDate: iso(prevStartTs), endDate: iso(prevEndTs), filterUserIds, filterClientIds };

    const fmtTnd = (n: number) => formatCostTND(n);

    const [allUsers, allEntriesRaw, allInvoices, allClients, allLeaves, allJournal, echeanceCols, echeanceStatuses] =
      await Promise.all([
        db.getAllUsers(companyId),
        db.getAllTimeEntries(companyId),
        db.getAllInvoices(companyId),
        db.getAllClients(companyId),
        db.getAllLeaveRequests(companyId),
        db.getAllCashJournalEntries(companyId),
        db.getAllEcheanceColumns(companyId),
        db.getAllEcheanceStatuses(companyId),
      ]);

    const settings = (await db.getSettings(companyId)) || {};
    const employees = (allUsers || []).filter((u: any) => STAFF_ROLES.includes(u.role));

    const entries = filterKpiEntries(allEntriesRaw || [], req.body);
    const prevEntries = filterKpiEntries(allEntriesRaw || [], prevBody);

    // ---- Temps et coût -----------------------------------------------------
    /** Coût d'une tâche à SON taux historique, jamais au taux actuel. */
    const taskCost = (t: any): number | null => {
      const rate = typeof t.hourlyRate === 'number' ? t.hourlyRate : null;
      return rate === null ? null : (accruedSeconds(t) / 3600) * rate;
    };
    const hoursOf = (rows: any[]) => round3(rows.reduce((s, t) => s + accruedSeconds(t), 0) / 3600);
    /** Une tâche non chiffrée vaut `null`, pas zéro : elle est exclue du coût. */
    const costOf = (rows: any[]) => round3(rows.reduce((s, t) => s + (taskCost(t) ?? 0), 0));

    const heures = hoursOf(entries);
    const heuresPrev = hoursOf(prevEntries);
    /**
     * Facturable / non facturable, lu sur le champ figé de chaque tâche. Une
     * tâche antérieure à ce champ n'a pas de valeur : elle est comptée
     * facturable, ce qui était l'hypothèse implicite jusqu'ici.
     */
    const nonFacturables = entries.filter((t: any) => t.facturable === false);
    const heuresNonFacturables = hoursOf(nonFacturables);
    const heuresFacturables = round3(heures - heuresNonFacturables);
    const coutNonFacturable = costOf(nonFacturables);
    // Le nombre de tâches, à côté des heures : « 12 tâches » se relie à ce que
    // Pointage montre, là où « 30 h » ne se retrouve pas dans une liste.
    const tachesNonFacturables = nonFacturables.length;
    // Combien de clients sont à l'origine de ce temps — un seul client pro
    // bono et douze clients mal paramétrés ne se corrigent pas pareil.
    const clientsNonFacturables = new Set(
      nonFacturables.map((t: any) => clientBucketKey(t)),
    ).size;
    const coutTemps = costOf(entries);
    const coutTempsPrev = costOf(prevEntries);
    const unpriced = entries.filter((t: any) => taskCost(t) === null);
    const tachesSansTaux = unpriced.length;
    const collabsSansTaux = new Set(unpriced.map((t: any) => t.userId)).size;

    // ---- Honoraires --------------------------------------------------------
    // Une devise saisie librement ne s'additionne pas à la TND : on n'agrège
    // que la TND et on compte ce qui a été écarté, plutôt que de convertir à
    // un taux qu'on ne stocke pas (Q-07).
    const isBillable = countsAsBilled;
    const isTnd = (inv: any) => String(inv.currency || 'TND').toUpperCase() === 'TND';
    const invoiceTs = (inv: any) => (inv.issueDate ? new Date(inv.issueDate).getTime() : 0);

    let devisesExclues = 0;
    const invoicesInRange = (fromTs: number, toTs: number, countExcluded = false) =>
      (allInvoices || []).filter((inv: any) => {
        if (!isBillable(inv)) return false;
        const ts = invoiceTs(inv);
        if (ts < fromTs || ts > toTs) return false;
        if (filterClientIds.length > 0) {
          const cid = inv.clientId != null ? Number(inv.clientId) : null;
          if (cid === null || !filterClientIds.includes(cid)) return false;
        }
        if (!isTnd(inv)) { if (countExcluded) devisesExclues += 1; return false; }
        return true;
      });

    const periodInvoices = invoicesInRange(startTs, endTs, true);
    const prevInvoices = invoicesInRange(prevStartTs, prevEndTs);
    const sumNet = (rows: any[]) => round3(rows.reduce((s, i) => s + num(Number(i.totalNetToPay), 0), 0));
    const honoraires = sumNet(periodInvoices);
    const honorairesPrev = sumNet(prevInvoices);

    // ---- Capacité nette ----------------------------------------------------
    /**
     * `regimeHoraire` est un volume HEBDOMADAIRE (48 h par défaut) — la même
     * valeur que le coût horaire employeur multiplie par 4,33 pour un mois.
     * Ramenée ici au jour ouvré : regimeHoraire / 5.
     *
     * Q-05 non tranchée : les jours fériés ne sont pas modélisés. La capacité
     * est donc légèrement surévaluée sur un mois qui en contient, ce qui
     * sous-évalue le taux d'occupation. L'interface le dit.
     */
    const workingDaysBetween = (fromTs: number, toTs: number) => {
      let n = 0;
      for (let ts = fromTs; ts <= toTs; ts += dayMs) {
        const d = new Date(ts).getUTCDay();
        if (d !== 0 && d !== 6) n += 1;
      }
      return n;
    };
    const scopedEmployees = filterUserIds.length > 0
      ? employees.filter((u: any) => filterUserIds.includes(u.id))
      : employees;

    // Indexé une fois : un filter() par collaborateur serait un balayage par personne.
    const leavesByUser = new Map<number, any[]>();
    for (const l of (allLeaves || [])) {
      if (l.status !== 'APPROVED') continue;
      const arr = leavesByUser.get(l.userId) || [];
      arr.push(l);
      leavesByUser.set(l.userId, arr);
    }
    const absentDays = (userId: number, fromTs: number, toTs: number) =>
      (leavesByUser.get(userId) || []).reduce((sum: number, l: any) => {
        const s = Math.max(new Date(l.startDate).getTime(), fromTs);
        const e = Math.min(new Date(l.endDate).getTime(), toTs);
        return e >= s ? sum + workingDaysBetween(s, e) : sum;
      }, 0);

    const capacityOf = (u: any, fromTs: number, toTs: number) => {
      const weekly = num(Number(u.regimeHoraire), 0);
      if (weekly <= 0) return 0;
      const open = workingDaysBetween(fromTs, toTs) - absentDays(u.id, fromTs, toTs);
      return round3(Math.max(0, open) * (weekly / 5));
    };
    const capaciteNette = round3(scopedEmployees.reduce((s: number, u: any) => s + capacityOf(u, startTs, endTs), 0));
    const capaciteNettePrev = round3(scopedEmployees.reduce((s: number, u: any) => s + capacityOf(u, prevStartTs, prevEndTs), 0));

    // ---- Grand-livre client ------------------------------------------------
    // Mêmes chiffres que la page Clients, calculés de la même façon, pour que
    // les deux écrans ne puissent pas se contredire. C'est un stock, pas une
    // grandeur de période.
    const journalByClient = journalEncaissementsByClient(allJournal || []);
    const netAllTime = new Map<string, number>();
    for (const inv of (allInvoices || [])) {
      if (!isBillable(inv) || !isTnd(inv)) continue;
      const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      netAllTime.set(key, round3((netAllTime.get(key) || 0) + num(Number(inv.totalNetToPay), 0)));
    }
    let resteAEncaisser = 0;
    const resteByClientId = new Map<string, number>();
    for (const c of (allClients || [])) {
      const facture = round3((netAllTime.get(String(c.id)) || 0) + (netAllTime.get(`name:${c.name}`) || 0));
      const enc = round3(sumEncaissements(c) + sumAmounts(journalFor(journalByClient, c)));
      const reste = round3(num(Number(c.soldeAnterieur), 0) - enc + facture);
      resteByClientId.set(String(c.id), reste);
      if (reste > 0) resteAEncaisser = round3(resteAEncaisser + reste);
    }

    /**
     * Créances échues — un MAJORANT, pas un chiffre exact (Q-04 non tranchée).
     * Aucun règlement ne porte d'`invoiceId` : on ne sait pas si une facture
     * précise est soldée. On somme donc les factures dont `dueDate` est
     * dépassée, PLAFONNÉES au reste réellement dû par le client — sans ce
     * plafond, un client à jour dont les vieilles factures sont payées serait
     * compté comme en retard.
     */
    const today = Date.now();
    const overdueByClient = new Map<string, number>();
    for (const inv of (allInvoices || [])) {
      if (!isBillable(inv) || !isTnd(inv) || !inv.dueDate) continue;
      // Fin de journée : une facture due aujourd'hui n'est pas en retard.
      if (new Date(inv.dueDate).getTime() + dayMs - 1 >= today) continue;
      const key = String(inv.clientId ?? '');
      if (!key) continue;
      overdueByClient.set(key, round3((overdueByClient.get(key) || 0) + num(Number(inv.totalNetToPay), 0)));
    }
    let creancesEchues = 0;
    for (const [cid, overdue] of overdueByClient) {
      const reste = resteByClientId.get(cid) ?? 0;
      if (reste > 0) creancesEchues = round3(creancesEchues + Math.min(overdue, reste));
    }

    // ---- Rentabilité par client -------------------------------------------
    const clientAgg = new Map<string, any>();
    const bump = (key: string, name: string, clientId: number | null) => {
      let row = clientAgg.get(key);
      if (!row) {
        row = { key, clientId, name: name || 'Sans client', heures: 0, cout: 0, honoraires: 0,
                heuresPrev: 0, honorairesPrev: 0, tachesSansTaux: 0 };
        clientAgg.set(key, row);
      }
      if (row.clientId == null && clientId != null) row.clientId = clientId;
      return row;
    };
    for (const t of entries) {
      const row = bump(clientBucketKey(t), t.client, t.clientId ?? null);
      row.heures = round3(row.heures + accruedSeconds(t) / 3600);
      const c = taskCost(t);
      if (c === null) row.tachesSansTaux += 1; else row.cout = round3(row.cout + c);
    }
    for (const t of prevEntries) {
      bump(clientBucketKey(t), t.client, t.clientId ?? null).heuresPrev += accruedSeconds(t) / 3600;
    }
    for (const inv of periodInvoices) {
      const row = bump(clientBucketKey({ clientId: inv.clientId, client: inv.clientName }), inv.clientName, inv.clientId ?? null);
      row.honoraires = round3(row.honoraires + num(Number(inv.totalNetToPay), 0));
    }
    for (const inv of prevInvoices) {
      const row = bump(clientBucketKey({ clientId: inv.clientId, client: inv.clientName }), inv.clientName, inv.clientId ?? null);
      row.honorairesPrev = round3(row.honorairesPrev + num(Number(inv.totalNetToPay), 0));
    }

    const clientRows = Array.from(clientAgg.values()).map((r: any) => {
      const marge = round3(r.honoraires - r.cout);
      return {
        ...r,
        heuresPrev: round3(r.heuresPrev),
        marge,
        // Indéfini quand rien n'a été facturé : `null`, jamais 0 % ni −100 %.
        tauxMarge: r.honoraires > 0 ? round3(marge / r.honoraires) : null,
        honorairesParHeure: r.heures > 0 && r.honoraires > 0 ? round3(r.honoraires / r.heures) : null,
        coutParHeure: r.heures > 0 ? round3(r.cout / r.heures) : null,
        resteAPayer: r.clientId != null ? (resteByClientId.get(String(r.clientId)) ?? 0) : 0,
      };
    }).sort((a: any, b: any) => a.marge - b.marge);

    // ---- Concentration -----------------------------------------------------
    const byHon = clientRows.filter((r: any) => r.honoraires > 0).sort((a: any, b: any) => b.honoraires - a.honoraires);
    const totalHon = round3(byHon.reduce((s: number, r: any) => s + r.honoraires, 0));
    const share = (n: number) => (totalHon > 0 ? round3(n / totalHon) : 0);
    const concentration = {
      total: totalHon,
      top1: byHon[0] ? { name: byHon[0].name, part: share(byHon[0].honoraires) } : null,
      top5Part: share(byHon.slice(0, 5).reduce((s: number, r: any) => s + r.honoraires, 0)),
      rows: byHon.slice(0, 8).map((r: any) => ({ name: r.name, honoraires: r.honoraires, part: share(r.honoraires) })),
    };

    // ---- Collaborateurs ----------------------------------------------------
    const entriesByUser = new Map<number, any[]>();
    for (const t of entries) {
      const arr = entriesByUser.get(t.userId) || []; arr.push(t); entriesByUser.set(t.userId, arr);
    }
    const prevByUser = new Map<number, any[]>();
    for (const t of prevEntries) {
      const arr = prevByUser.get(t.userId) || []; arr.push(t); prevByUser.set(t.userId, arr);
    }
    const collaborateurs = scopedEmployees.map((u: any) => {
      const mine = entriesByUser.get(u.id) || [];
      const h = hoursOf(mine);
      const cap = capacityOf(u, startTs, endTs);
      return {
        userId: u.id,
        name: u.fullName || u.username,
        role: u.role,
        heures: h,
        heuresPrev: hoursOf(prevByUser.get(u.id) || []),
        capacite: cap,
        occupation: cap > 0 ? round3(h / cap) : null,
        cout: costOf(mine),
        clients: new Set(mine.map((t: any) => clientBucketKey(t))).size,
        sansTaux: mine.filter((t: any) => taskCost(t) === null).length,
        /**
         * Rendement moyen des clients servis, pondéré par les heures.
         * Ce n'est PAS « les honoraires de cette personne » : une facture n'a
         * pas d'auteur (Q-02). C'est le rendement des dossiers sur lesquels
         * elle a travaillé — utile pour l'affectation, pas pour la paie.
         */
        rendementClients: (() => {
          let hs = 0, vs = 0;
          for (const t of mine) {
            const row = clientAgg.get(clientBucketKey(t));
            const hph = row && row.heures > 0 && row.honoraires > 0 ? row.honoraires / row.heures : null;
            if (hph === null) continue;
            const th = accruedSeconds(t) / 3600;
            hs += th; vs += th * hph;
          }
          return hs > 0 ? round3(vs / hs) : null;
        })(),
      };
    }).sort((a: any, b: any) => b.heures - a.heures);

    // ---- Missions et types de tâche ----------------------------------------
    // Heures et coût uniquement — jamais de marge ni de rentabilité ici, parce
    // que rien ne relie une tâche à une facture : l'inventer serait exactement
    // ce que la règle des taux interdit ailleurs sur cet écran (Q-03).
    const missionAgg = new Map<string, any>();
    for (const t of entries) {
      const key = t.pole || 'Sans mission';
      let row = missionAgg.get(key);
      if (!row) {
        row = { pole: key, heures: 0, heuresPrev: 0, cout: 0, taches: 0, tachesSansTaux: 0,
                collaborateurs: new Set<number>(), clients: new Set<string>(), types: new Map<string, any>() };
        missionAgg.set(key, row);
      }
      const secs = accruedSeconds(t);
      row.heures += secs / 3600;
      row.taches += 1;
      row.collaborateurs.add(t.userId);
      row.clients.add(clientBucketKey(t));
      const c = taskCost(t);
      if (c === null) row.tachesSansTaux += 1; else row.cout += c;

      // Le type de tâche se lit *dans* sa mission (deux missions peuvent
      // légitimement avoir un type « Saisie », comme partout ailleurs dans
      // l'app où missionKey()/le catalogue le rappellent).
      const typeKey = t.taskType || 'Non précisé';
      let typeRow = row.types.get(typeKey);
      if (!typeRow) {
        typeRow = { name: typeKey, heures: 0, cout: 0, taches: 0, tachesSansTaux: 0 };
        row.types.set(typeKey, typeRow);
      }
      typeRow.heures += secs / 3600;
      typeRow.taches += 1;
      if (c === null) typeRow.tachesSansTaux += 1; else typeRow.cout += c;
    }
    for (const t of prevEntries) {
      const row = missionAgg.get(t.pole || 'Sans mission');
      if (row) row.heuresPrev += accruedSeconds(t) / 3600;
    }
    const missions = Array.from(missionAgg.values())
      .map((r: any) => ({
        pole: r.pole,
        heures: round3(r.heures),
        heuresPrev: round3(r.heuresPrev),
        taches: r.taches,
        tachesSansTaux: r.tachesSansTaux,
        collaborateurs: r.collaborateurs.size,
        clients: r.clients.size,
        dureeMoyenneH: r.taches > 0 ? round3(r.heures / r.taches) : 0,
        // Coût employeur — même garde que le reste du bandeau : jamais envoyé
        // à un non-ADMIN, pas seulement masqué à l'écran.
        ...(showMoney ? { cout: round3(r.cout) } : {}),
        taskTypes: Array.from(r.types.values())
          .map((tr: any) => ({
            name: tr.name,
            heures: round3(tr.heures),
            taches: tr.taches,
            tachesSansTaux: tr.tachesSansTaux,
            ...(showMoney ? { cout: round3(tr.cout) } : {}),
          }))
          .sort((a: any, b: any) => b.heures - a.heures),
      }))
      .sort((a: any, b: any) => b.heures - a.heures);

    // ---- Opérationnel ------------------------------------------------------
    // Le mois « courant » est celui du cabinet, pas celui du conteneur.
    const nowCivil = civilParts(new Date());
    const monthCols = (echeanceCols || []).filter(
      (c: any) => Number(c.year) === nowCivil.year && Number(c.month) === nowCivil.month
    );
    // Seuls les clients que le cabinet suit réellement dans la grille comptent :
    // multiplier par TOUS les clients produirait des milliers de « cellules
    // vides » qui ne correspondent à aucun travail attendu.
    const trackedClients = new Set((echeanceStatuses || []).map((s: any) => String(s.clientId)));
    const filledThisMonth = new Set(
      (echeanceStatuses || [])
        .filter((s: any) => monthCols.some((c: any) => String(c.id) === String(s.columnId)))
        .map((s: any) => `${s.clientId}|${s.columnId}`)
    ).size;
    const echeancesAttendues = monthCols.length * trackedClients.size;
    const echeancesVides = Math.max(0, echeancesAttendues - filledThisMonth);

    // Une tâche en pause avant l'ajout de `lastEditedAt` n'a pas de date de
    // dernière action : on ne peut rien affirmer, on ne la compte pas.
    const pausedLong = (allEntriesRaw || []).filter((t: any) =>
      t.statut === 'PAUSED' && t.lastEditedAt && (today - new Date(t.lastEditedAt).getTime()) > 7 * dayMs
    ).length;

    // ---- Alertes -----------------------------------------------------------
    // Les seuils viennent de `settings` : aucune constante en dur, même règle
    // que les statuts d'échéance et les objets de caisse, déjà éditables.
    const TH = {
      margeMin: 0.30, deriveHeures: 1.30, concentration: 0.20,
      surcharge: 0.95, sousCharge: 0.50, pauseJours: 7, echeanceJour: 25,
      ...((settings as any).alertThresholds || {}),
    };
    const alerts: any[] = [];

    if (showMoney) {
      for (const r of clientRows) {
        if (r.honoraires > 0 && r.marge < 0) {
          alerts.push({ key: `A1-${r.key}`, code: 'A1', level: 'CRITIQUE', entity: 'client', entityId: r.clientId, entityName: r.name,
            title: `${r.name} — marge négative`,
            detail: `${fmtTnd(r.honoraires)} facturés pour ${fmtTnd(r.cout)} de temps consommé.`,
            action: 'Arbitrer sous 7 jours : retarifer, plafonner le temps, ou sortir le client.' });
        } else if (r.tauxMarge !== null && r.tauxMarge >= 0 && r.tauxMarge < TH.margeMin) {
          alerts.push({ key: `A4-${r.key}`, code: 'A4', level: 'AVERTISSEMENT', entity: 'client', entityId: r.clientId, entityName: r.name,
            title: `${r.name} — marge de ${Math.round(r.tauxMarge * 100)} %`,
            detail: `Sous le seuil de ${Math.round(TH.margeMin * 100)} %. ${fmtTnd(r.honoraires)} facturés, ${r.heures} h consommées.`,
            action: 'Inscrire à la revue de portefeuille.' });
        }
        // Dérive : plus d'heures pour des honoraires qui ne suivent pas.
        // `honorairesPrev > 0` est nécessaire : sans facturation antérieure il
        // n'y a pas de base « constante » à comparer, et un client jamais
        // facturé relève d'un autre sujet (le travail non facturé, Q-03).
        if (r.honorairesPrev > 0 && r.heuresPrev > 0
            && r.heures > r.heuresPrev * TH.deriveHeures
            && r.honoraires <= r.honorairesPrev * 1.05) {
          alerts.push({ key: `A5-${r.key}`, code: 'A5', level: 'AVERTISSEMENT', entity: 'client', entityId: r.clientId, entityName: r.name,
            title: `${r.name} — temps en forte hausse`,
            detail: `${r.heures} h contre ${r.heuresPrev} h sur la période précédente, à honoraires stables.`,
            action: "Comprendre la cause avant qu'elle ne devienne structurelle." });
        }
      }
      if (concentration.top1 && concentration.top1.part > TH.concentration) {
        alerts.push({ key: 'A6', code: 'A6', level: 'AVERTISSEMENT', entity: 'client', entityId: null,
          title: `${concentration.top1.name} pèse ${Math.round(concentration.top1.part * 100)} % des honoraires`,
          detail: `Au-delà du seuil de ${Math.round(TH.concentration * 100)} %. Une perte de ce client serait difficile à absorber.`,
          action: 'Plan de prospection pour réduire la dépendance.' });
      }
    }

    for (const c of collaborateurs) {
      if (c.occupation === null) continue;
      if (c.occupation > TH.surcharge) {
        alerts.push({ key: `A7-${c.userId}`, code: 'A7', level: 'AVERTISSEMENT', entity: 'user', entityId: c.userId, entityName: c.name,
          title: `${c.name} — ${Math.round(c.occupation * 100)} % d'occupation`,
          detail: `${c.heures} h pointées pour ${c.capacite} h de capacité nette.`,
          action: 'Redistribuer la charge.' });
      } else if (c.occupation < TH.sousCharge && c.capacite > 0) {
        alerts.push({ key: `A8-${c.userId}`, code: 'A8', level: 'AVERTISSEMENT', entity: 'user', entityId: c.userId, entityName: c.name,
          title: `${c.name} — ${Math.round(c.occupation * 100)} % d'occupation`,
          detail: `${c.heures} h pointées sur ${c.capacite} h disponibles.`,
          action: "Vérifier d'abord le pointage, avant de conclure à la sous-charge." });
      }
    }

    if (collabsSansTaux > 0 && isAdminViewer) {
      alerts.push({ key: 'A11', code: 'A11', level: 'AVERTISSEMENT', entity: 'user', entityId: null,
        title: `${collabsSansTaux} collaborateur${collabsSansTaux > 1 ? 's' : ''} sans coût employeur configuré`,
        detail: `${tachesSansTaux} tâche${tachesSansTaux > 1 ? 's' : ''} exclue${tachesSansTaux > 1 ? 's' : ''} du coût — toutes les marges affichées sont surévaluées.`,
        action: 'Compléter la fiche dans Utilisateurs.' });
    }
    if (nowCivil.day >= TH.echeanceJour && echeancesVides > 0) {
      alerts.push({ key: 'A3', code: 'A3', level: 'CRITIQUE', entity: 'echeance', entityId: null,
        title: `${echeancesVides} échéance${echeancesVides > 1 ? 's' : ''} du mois non renseignée${echeancesVides > 1 ? 's' : ''}`,
        detail: `Nous sommes le ${nowCivil.day} du mois — risque de pénalité pour le client.`,
        action: 'Affecter immédiatement.' });
    }
    if (pausedLong > 0) {
      alerts.push({ key: 'A10', code: 'A10', level: 'INFO', entity: 'task', entityId: null,
        title: `${pausedLong} tâche${pausedLong > 1 ? 's' : ''} en pause depuis plus de ${TH.pauseJours} jours`,
        detail: "Une pause de plus d'une semaine est un oubli, pas une pause.",
        action: 'Clôturer ou reprendre — cela fiabilise tout le reste de l\'écran.' });
    }

    const RANK: Record<string, number> = { CRITIQUE: 0, AVERTISSEMENT: 1, INFO: 2 };
    alerts.sort((a, b) => RANK[a.level] - RANK[b.level]);

    // ---- Réponse -----------------------------------------------------------
    const ratio = (n: number, d: number) => (d > 0 ? round3(n / d) : null);
    const marge = round3(honoraires - coutTemps);
    const margePrev = round3(honorairesPrev - coutTempsPrev);

    const payload: any = {
      periode: { startDate: iso(startTs), endDate: iso(endTs), precedente: { startDate: prevBody.startDate, endDate: prevBody.endDate } },
      financialsFiltered,
      executive: {
        heures, heuresPrev,
        heuresFacturables, heuresNonFacturables,
        tachesNonFacturables, clientsNonFacturables,
        capaciteNette, capaciteNettePrev,
        // Le taux d'utilisation au sens des cabinets : le temps refacturable
        // rapporté à la capacité. Distinct du taux d'occupation — on peut être
        // occupé à 95 % et facturable à 40 %.
        utilisation: capaciteNette > 0 ? round3(heuresFacturables / capaciteNette) : null,
        occupation: ratio(heures, capaciteNette),
        occupationPrev: ratio(heuresPrev, capaciteNettePrev),
        tachesSansTaux, collabsSansTaux,
        clientsEnAlerte: new Set(alerts.filter(a => a.entity === 'client' && a.entityId != null).map(a => a.entityId)).size,
        alertesCritiques: alerts.filter(a => a.level === 'CRITIQUE').length,
        // Les montants sont retirés côté serveur pour un non-ADMIN, jamais
        // seulement masqués à l'écran — même règle que le coût employeur et
        // le grand-livre client.
        ...(showMoney ? {
          honoraires, honorairesPrev,
          coutTemps, coutTempsPrev,
          marge, margePrev,
          tauxMarge: honoraires > 0 ? round3(marge / honoraires) : null,
          tauxMargePrev: honorairesPrev > 0 ? round3(margePrev / honorairesPrev) : null,
          honorairesParHeure: ratio(honoraires, heures),
          coutParHeure: ratio(coutTemps, heures),
          resteAEncaisser, creancesEchues, devisesExclues,
          coutNonFacturable,
        } : {}),
      },
      alerts: alerts.slice(0, 10),
      alertsTotal: alerts.length,
      collaborateurs: collaborateurs.map((c: any) =>
        isAdminViewer ? c : { ...c, cout: undefined, rendementClients: undefined }),
      operationnel: { echeancesVides, echeancesAttendues, tachesEnPause: pausedLong },
      // Heures et compteurs sont visibles d'un SUPERVISEUR comme le reste de
      // l'écran ; `cout` est déjà retiré ligne par ligne ci-dessus (showMoney).
      missions,
    };
    if (showMoney) {
      payload.clients = clientRows;
      payload.concentration = concentration;
    }

    res.json(payload);
  } catch (error) {
    console.error('Dashboard executive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



  app.post('/api/clients', authenticate, requirePermission('CREATE_CLIENTS'), async (req: any, res: any) => {
    try {
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields, soldeAnterieur, encaissements, nonFacturable } = req.body;

      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Client name is required' });
      }

      const newClient = await db.createClient(req.user.companyId, {
        id: Date.now(),
        name: name.trim(),
        type: type || 'Company',
        email: email ? email.trim() : '',
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        city: city ? city.trim() : '',
        country: country ? country.trim() : '',
        taxId: taxId ? taxId.trim() : '',
        status: status || 'Active',
        notes: notes || '',
        customFields: customFields || {},
        // Le travail fait pour ce client n'est pas refacturé. Chaque tâche en
        // hérite à sa création, et le fige : changer d'avis plus tard ne
        // réécrit pas l'historique.
        nonFacturable: !!nonFacturable,
        soldeAnterieur: num(Number(soldeAnterieur), 0),
        encaissements: normalizeEncaissements(encaissements),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.id
      });

      const created = await enrichClientLedger(req.user.companyId, newClient);
      res.status(201).json((await userCan(req, 'VIEW_CLIENT_FINANCIALS')) ? created : stripLedger(created));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/clients/:id
  app.put('/api/clients/:id', authenticate, requirePermission('EDIT_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields, soldeAnterieur, encaissements, nonFacturable } = req.body;

      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Client name is required' });
      }

      // A caller who cannot see the ledger cannot overwrite it either: their
      // form never received soldeAnterieur/encaissements, so taking them from
      // the body would silently zero a client's balance every time someone
      // edited a phone number.
      const seesLedger = await userCan(req, 'VIEW_CLIENT_FINANCIALS');
      const current = seesLedger ? null : await db.getClientById(req.user.companyId, id);

      const updates = {
        name: name.trim(),
        type: type || 'Company',
        email: email ? email.trim() : '',
        phone: phone ? phone.trim() : '',
        address: address ? address.trim() : '',
        city: city ? city.trim() : '',
        country: country ? country.trim() : '',
        taxId: taxId ? taxId.trim() : '',
        status: status || 'Active',
        notes: notes || '',
        customFields: customFields || {},
        nonFacturable: !!nonFacturable,
        soldeAnterieur: seesLedger ? num(Number(soldeAnterieur), 0) : num(Number(current?.soldeAnterieur), 0),
        encaissements: seesLedger ? normalizeEncaissements(encaissements) : normalizeEncaissements(current?.encaissements),
        updatedAt: new Date().toISOString()
      };

      const updated = await db.updateClient(req.user.companyId, id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Client not found' });
      }

      const saved = await enrichClientLedger(req.user.companyId, updated);
      res.json(seesLedger ? saved : stripLedger(saved));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/clients/import — bulk creation from a spreadsheet.
   *
   * The file itself is parsed in the browser (SheetJS), not here: the server
   * only ever sees an already-mapped array of plain client rows, the same
   * shape a single POST /api/clients would send. That keeps this route from
   * needing a file-upload middleware, and means the row limit below is the
   * only thing standing between a spreadsheet and the database — validation
   * doesn't have to be duplicated between a "parse" step and an "import" step.
   *
   * Gated on CREATE_CLIENTS, the same permission a single creation needs:
   * bulk creation is still creation, not a distinct capability.
   */
  const MAX_IMPORT_ROWS = 5000;

  app.post('/api/clients/import', authenticate, requirePermission('CREATE_CLIENTS'), async (req: any, res: any) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: 'rows doit être un tableau.' });
      if (rows.length === 0) return res.status(400).json({ error: 'Aucune ligne à importer.' });
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ error: `Trop de lignes (${rows.length}). Maximum ${MAX_IMPORT_ROWS} par import.` });
      }
      const skipDuplicates = req.body?.skipDuplicates !== false;

      const existing = await db.getAllClients(req.user.companyId);
      // Case/whitespace-insensitive: "1399521M/A/M/000" and " 1399521m/a/m/000 "
      // are the same matricule fiscal to an accountant, not to a === check.
      const norm = (v: any) => String(v ?? '').trim().toLowerCase();
      const existingTaxIds = new Set(existing.map((c: any) => norm(c.taxId)).filter(Boolean));
      const existingNames = new Set(existing.map((c: any) => norm(c.name)).filter(Boolean));
      // Two rows in the same file with the same matricule fiscal must not both
      // become clients — the second is a duplicate of the first, not of
      // something already in the database.
      const seenTaxIds = new Set<string>();

      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
      // A fresh, larger-than-Date.now() base so every row in this batch gets a
      // distinct id even when created within the same millisecond — Date.now()
      // alone collides across a fast bulk loop, which single-client creation
      // never hits but hundreds of rows created together will.
      const idBase = Date.now() * 1000;

      const toCreate: any[] = [];
      const skipped: { row: number; reason: string; name: string }[] = [];
      const invalid: { row: number; reason: string }[] = [];

      rows.forEach((raw: any, i: number) => {
        const rowNum = i + 2; // header is row 1 in the sheet the user is looking at
        const name = text(raw?.name, 200);
        if (!name) { invalid.push({ row: rowNum, reason: 'Nom manquant' }); return; }

        const taxId = text(raw?.taxId, 60);
        const key = norm(taxId);
        if (skipDuplicates && key) {
          if (existingTaxIds.has(key) || seenTaxIds.has(key)) {
            skipped.push({ row: rowNum, reason: 'Matricule fiscal déjà existant', name });
            return;
          }
        } else if (skipDuplicates && !key && existingNames.has(norm(name))) {
          // No matricule fiscal to key on — fall back to an exact name match
          // rather than importing every re-run of the same file as new rows.
          skipped.push({ row: rowNum, reason: 'Nom déjà existant', name });
          return;
        }
        if (key) seenTaxIds.add(key);

        // Anything the client didn't map to a native field arrives as
        // customFields already — the same free-form column set the Clients
        // screen has always supported, so an imported sheet's extra columns
        // (RNE, gérant, CNSS…) show up exactly like a hand-added custom field.
        const customFields: Record<string, string> = {};
        if (raw?.customFields && typeof raw.customFields === 'object') {
          for (const [k, v] of Object.entries(raw.customFields)) {
            const cleanKey = text(k, 60);
            if (!cleanKey) continue;
            customFields[cleanKey] = text(v, 500);
          }
        }

        toCreate.push({
          id: idBase + toCreate.length,
          name,
          type: raw?.type === 'Individual' ? 'Individual' : 'Company',
          email: text(raw?.email, 200),
          phone: text(raw?.phone, 60),
          address: text(raw?.address, 300),
          city: text(raw?.city, 100),
          country: text(raw?.country, 100),
          taxId,
          status: 'Active',
          notes: text(raw?.notes, 1000),
          customFields,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: req.user.id,
        });
      });

      // Fired together rather than awaited one at a time: saveDb() coalesces
      // concurrent writes into a single trailing flush, so hundreds of rows
      // still cost roughly one file write, not hundreds.
      const results = await Promise.allSettled(toCreate.map((c) => db.createClient(req.user.companyId, c)));
      let created = 0;
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') created++;
        else invalid.push({ row: idx, reason: 'Échec d’enregistrement' });
      });

      res.status(201).json({
        created,
        skipped: skipped.length,
        invalid: invalid.length,
        skippedDetails: skipped.slice(0, 20),
        invalidDetails: invalid.slice(0, 20),
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/clients/:id
  app.delete('/api/clients/:id', authenticate, requirePermission('DELETE_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      // For now we'll do soft delete by marking as Inactive to preserve historical data
      const updated = await db.updateClient(req.user.companyId, id, { status: 'Inactive', updatedAt: new Date().toISOString() });
      if (!updated) {
        return res.status(404).json({ error: 'Client not found' });
      }
      res.json({ success: true, message: 'Client marked as Inactive' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Services API Routes
  // ---------------------------------------------------------

  /**
   * Clé de comparaison d'un nom de mission ou de type de tâche.
   *
   * Casse, espaces multiples et accents repliés : « Comptabilité »,
   * « comptabilite » et « Comptabilité  » sont la même mission pour un
   * cabinet, et ce sont exactement les trois façons dont le même intitulé
   * revient d'un tableur à l'autre. C'est la seule définition de « doublon »
   * dans ce module — la création, la modification, l'import et la copie du
   * catalogue de secteur l'utilisent toutes, sans quoi l'un accepterait ce
   * qu'un autre refuse.
   */
  /** Garde-fou d'intitulé, appliqué au catalogue livré comme à toute liste reçue. */
  const MAX_MISSION_NAME = 160;
  const MAX_TYPES_PER_MISSION = 100;

  /**
   * Met un catalogue sous sa forme canonique avant qu'il ne touche la base :
   * intitulés coupés, vides écartés, **et les doublons fusionnés plutôt que
   * dupliqués** — deux entrées « Comptabilité » sont une seule mission portant
   * l'union de leurs types, pas deux missions homonymes.
   */
  const normalizeMissionCatalogue = (rows: any[]): { name: string; taskTypes: string[] }[] => {
    const out: { name: string; taskTypes: string[] }[] = [];
    const index = new Map<string, { name: string; taskTypes: string[] }>();
    for (const raw of rows) {
      const name = String(raw?.name ?? '').trim().slice(0, MAX_MISSION_NAME);
      if (!name) continue;
      const key = missionKey(name);
      let entry = index.get(key);
      if (!entry) {
        entry = { name, taskTypes: [] };
        index.set(key, entry);
        out.push(entry);
      }
      const seen = new Set(entry.taskTypes.map(missionKey));
      for (const t of Array.isArray(raw?.taskTypes) ? raw.taskTypes : []) {
        const label = String(t ?? '').trim().slice(0, MAX_MISSION_NAME);
        const tKey = missionKey(label);
        if (!label || seen.has(tKey) || entry.taskTypes.length >= MAX_TYPES_PER_MISSION) continue;
        seen.add(tKey);
        entry.taskTypes.push(label);
      }
    }
    return out;
  };

  const missionKey = (v: any) =>
    String(v ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase().replace(/\s+/g, ' ');

  /**
   * Pourquoi l'écran Missions est vide.
   *
   * « Aucune mission pour le moment » ne dit pas si le catalogue livré
   * d'office n'est jamais arrivé, s'il est arrivé et a été vidé, ou si la
   * requête a échoué. Cette route rend l'état réel — secteur, signature du
   * catalogue attendue, signature posée, date — pour que l'écran vide
   * l'explique au lieu de le laisser deviner.
   */
  app.get('/api/services/catalogue-status', authenticate, async (req: any, res: any) => {
    try {
      const company = await db.getCompanyById(req.user.companyId);
      const catalogue = missionsForSecteur(company?.secteur);
      res.json({
        secteur: company?.secteur || 'CABINET',
        expectedVersion: catalogueVersion(catalogue),
        seededVersion: company?.sectorMissionsCatalogueVersion || null,
        seededAt: company?.sectorMissionsSeededAt || null,
        catalogueMissions: catalogue.length,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/services
  app.get('/api/services', authenticate, async (req: any, res: any) => {
    try {
      const services = await db.getAllServices(req.user.companyId);
      res.json([...services].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/services
  app.post('/api/services', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const { name, clientId } = req.body;
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Service name is required' });
      }

      const services = await db.getAllServices(req.user.companyId);
      if (services.some((s: any) => missionKey(s.name) === missionKey(name))) {
        return res.status(409).json({ error: `La mission « ${name.trim()} » existe déjà.` });
      }

      const newService = await db.createService(req.user.companyId, {
        id: Date.now(),
        name: name.trim(),
        clientId: clientId || null,
        createdAt: new Date().toISOString()
      });
      
      res.status(201).json(newService);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/services/:id
  app.put('/api/services/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, clientId } = req.body;
      
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Service name is required' });
      }

      // La mission elle-même est exclue : réenregistrer une fiche sans
      // toucher au nom ne doit pas se refuser comme son propre doublon.
      const services = await db.getAllServices(req.user.companyId);
      if (services.some((s: any) => s.id !== id && missionKey(s.name) === missionKey(name))) {
        return res.status(409).json({ error: `La mission « ${name.trim()} » existe déjà.` });
      }

      const updates = {
        name: name.trim(),
        clientId: clientId || null,
        updatedAt: new Date().toISOString()
      };
      
      const updated = await db.updateService(req.user.companyId, id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Service not found' });
      }

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/services/:id — removes the mission and its types de tâches
  app.delete('/api/services/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const removed = await db.deleteService(req.user.companyId, id);
      if (!removed) return res.status(404).json({ error: 'Service not found' });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Applique un catalogue de missions à une entreprise, sans jamais créer de
   * doublon.
   *
   * Une mission déjà présente n'est **pas** recréée ; ses types de tâches
   * manquants lui sont en revanche ajoutés. C'est strictement additif : rien
   * n'est renommé ni supprimé, et rejouer le même fichier ne change rien.
   */
  const applyMissionCatalogue = async (
    companyId: string,
    catalogue: { name: string; taskTypes: string[] }[],
  ) => {
    const services = await db.getAllServices(companyId);
    const allTypes = await db.getAllTaskTypes(companyId);
    const byKey = new Map<string, any>(services.map((s: any) => [missionKey(s.name), s]));

    // Une base d'id plus grande que Date.now() : une boucle rapide fait tenir
    // plusieurs créations dans la même milliseconde, ce qu'une création unitaire
    // ne rencontre jamais mais qu'un import rencontre toujours.
    let nextId = Date.now() * 1000;
    const now = new Date().toISOString();

    let missionsCreated = 0;
    let missionsSkipped = 0;
    let typesCreated = 0;

    for (const entry of catalogue) {
      const key = missionKey(entry.name);
      if (!key) continue;

      let service = byKey.get(key);
      if (service) {
        missionsSkipped++;
      } else {
        service = await db.createService(companyId, {
          id: nextId++, name: entry.name.trim(), clientId: null, createdAt: now,
        });
        byKey.set(key, service);
        missionsCreated++;
      }

      const existingTypeKeys = new Set(
        allTypes.filter((t: any) => t.serviceId === service.id).map((t: any) => missionKey(t.name)),
      );
      for (const rawType of entry.taskTypes) {
        const typeKey = missionKey(rawType);
        if (!typeKey || existingTypeKeys.has(typeKey)) continue;
        existingTypeKeys.add(typeKey);
        await db.createTaskType(companyId, {
          id: nextId++, name: String(rawType).trim(), serviceId: service.id, createdAt: now,
        });
        typesCreated++;
      }
    }

    return { missionsCreated, missionsSkipped, typesCreated };
  };

  /**
   * Copie le catalogue de missions du secteur dans une entreprise, une fois.
   *
   * C'est ce qui fait qu'« une entreprise du secteur Comptabilité trouve ses
   * missions déjà là » : le catalogue est importé une fois par l'exploitant,
   * et chaque entreprise du secteur en reçoit **une copie à elle** — pas une
   * référence. La copie est figée, exactement comme un modèle de ressource
   * affecté à un client : renommer ou supprimer une mission chez soi ne touche
   * pas le modèle, et corriger le modèle ne réécrit pas ce qu'une entreprise a
   * déjà adapté.
   *
   * `sectorMissionsSeededAt` garantit que ça n'arrive qu'une fois : sans lui,
   * une entreprise qui a délibérément supprimé une mission du catalogue la
   * verrait revenir à chaque connexion. Le drapeau n'est **pas** posé tant que
   * le catalogue est vide, sinon les entreprises déjà en base au moment du
   * premier import ne le recevraient jamais.
   *
   * Déclarée en `function` et non en `const` : elle est appelée par la route
   * de connexion, enregistrée bien plus haut dans `startServer()`, et une
   * déclaration est hissée sur tout le corps de la fonction.
   *
   * Ne lève jamais : un catalogue par défaut manquant ne doit pas empêcher
   * quelqu'un de se connecter.
   */
  /**
   * Pose la bibliothèque Ressources métier (modèles de documents, liens
   * utiles, colonnes d'échéances) pour une entreprise, une seule fois.
   *
   * Elle n'était semée que pour l'entreprise historique, au démarrage : une
   * entreprise inscrite par le formulaire public n'avait donc **aucune**
   * échéance, alors que le compte de démonstration en montrait vingt-huit.
   * Même mécanique que le catalogue de missions — signature de contenu plutôt
   * qu'un simple « déjà posé », pose en vol dédupliquée, drapeau écrit à la
   * fin pour qu'une pose interrompue se rejoue.
   *
   * Réservée aux secteurs qui voient le module : le gating existant le cache
   * aux « autres professions de services », et lui écrire des lignes qu'aucun
   * écran n'affiche serait du travail pour rien.
   */
  const resourceSeedInFlight = new Map<string, Promise<void>>();
  const RESOURCE_LIBRARY_VERSION = '6t-3l-4y-prev';

  async function seedResourceLibraryFor(company: any): Promise<void> {
    if (!company?.id) return;
    if (!companyHasResourcesModule(company.secteur)) return;
    if (company.resourceLibraryVersion === RESOURCE_LIBRARY_VERSION) return;

    const inFlight = resourceSeedInFlight.get(company.id);
    if (inFlight) return inFlight;

    const run = (async () => {
      try {
        await seedResourceLibrary(db, company.id);
        await db.updateCompany(company.id, {
          resourceLibraryVersion: RESOURCE_LIBRARY_VERSION,
          resourceLibrarySeededAt: new Date().toISOString(),
        });
        console.log(`[ressources] bibliothèque ${RESOURCE_LIBRARY_VERSION} posée pour ${company.name || company.id}`);
      } catch (e) {
        console.error('[ressources] pose de la bibliothèque échouée', e);
      } finally {
        resourceSeedInFlight.delete(company.id);
      }
    })();

    resourceSeedInFlight.set(company.id, run);
    return run;
  }

  const sectorSeedInFlight = new Map<string, Promise<void>>();

  async function seedSectorMissions(company: any): Promise<void> {
    if (!company?.id) return;

    const catalogue = missionsForSecteur(company.secteur);
    const version = catalogueVersion(catalogue);
    // La **signature du catalogue** plutôt qu'un simple « déjà posé » : un
    // drapeau posé à tort par une version antérieure, ou une pose partielle,
    // se répare de lui-même à la requête suivante au lieu de laisser une
    // entreprise devant un écran vide pour toujours.
    if (company.sectorMissionsCatalogueVersion === version) return;

    // Une seule pose en vol par entreprise. `authenticate` s'exécute sur
    // *chaque* requête, et l'application en tire plusieurs de front au
    // chargement d'une page : sans ça, toutes verraient la signature encore
    // absente et créeraient chacune les 8 missions. La signature seule ne
    // suffit pas — elle n'est écrite qu'à la fin.
    const inFlight = sectorSeedInFlight.get(company.id);
    if (inFlight) return inFlight;

    const run = (async () => {
      try {
        if (catalogue.length === 0) return;
        const applied = await applyMissionCatalogue(company.id, normalizeMissionCatalogue(catalogue));
        // Écrite **après** coup : une pose interrompue doit pouvoir se rejouer
        // à la requête suivante, et `applyMissionCatalogue` étant additif, la
        // rejouer ne duplique rien.
        await db.updateCompany(company.id, {
          sectorMissionsCatalogueVersion: version,
          sectorMissionsSeededAt: new Date().toISOString(),
        });
        // Une ligne dans le journal : c'est ce qui permet de répondre à
        // « pourquoi mon catalogue n'est pas arrivé » sans deviner.
        console.log(`[missions] catalogue ${version} (secteur ${company.secteur || 'CABINET'}) posé pour`
          + ` ${company.name || company.id} : ${applied.missionsCreated} mission(s),`
          + ` ${applied.typesCreated} type(s), ${applied.missionsSkipped} déjà présente(s)`);
      } catch (e) {
        console.error('[missions] pose du catalogue échouée', e);
      } finally {
        sectorSeedInFlight.delete(company.id);
      }
    })();

    sectorSeedInFlight.set(company.id, run);
    return run;
  }

  // ---------------------------------------------------------
  // Types de tâches — each belongs to a mission (service)
  // ---------------------------------------------------------

  // GET /api/task-types[?serviceId=]
  app.get('/api/task-types', authenticate, async (req: any, res: any) => {
    try {
      let taskTypes = await db.getAllTaskTypes(req.user.companyId);
      if (req.query.serviceId) {
        const sid = parseInt(req.query.serviceId, 10);
        taskTypes = taskTypes.filter((t: any) => t.serviceId === sid);
      }
      res.json([...taskTypes].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/task-types', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const { name, serviceId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Task type name is required' });
      }
      const sid = parseInt(serviceId, 10);
      if (!Number.isFinite(sid) || !(await db.getServiceById(req.user.companyId, sid))) {
        return res.status(400).json({ error: 'A valid mission is required' });
      }
      // Le doublon se juge **dans la mission**, pas dans tout le catalogue :
      // deux missions peuvent légitimement avoir un type « Saisie ».
      const siblings = (await db.getAllTaskTypes(req.user.companyId)).filter((t: any) => t.serviceId === sid);
      if (siblings.some((t: any) => missionKey(t.name) === missionKey(name))) {
        return res.status(409).json({ error: `Le type de tâche « ${name.trim()} » existe déjà dans cette mission.` });
      }
      const created = await db.createTaskType(req.user.companyId, {
        id: Date.now(),
        name: name.trim(),
        serviceId: sid,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(created);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/task-types/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, serviceId } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Task type name is required' });
      }
      const updates: any = { name: name.trim(), updatedAt: new Date().toISOString() };
      const allTypes = await db.getAllTaskTypes(req.user.companyId);
      const current = allTypes.find((t: any) => t.id === id);
      if (serviceId !== undefined) {
        const sid = parseInt(serviceId, 10);
        if (!Number.isFinite(sid) || !(await db.getServiceById(req.user.companyId, sid))) {
          return res.status(400).json({ error: 'A valid mission is required' });
        }
        updates.serviceId = sid;
      }
      // Contre les types de la mission d'arrivée — celle du corps si elle
      // change, sinon celle d'origine — et jamais contre soi-même.
      const targetService = updates.serviceId ?? current?.serviceId;
      if (allTypes.some((t: any) => t.id !== id && t.serviceId === targetService && missionKey(t.name) === missionKey(name))) {
        return res.status(409).json({ error: `Le type de tâche « ${name.trim()} » existe déjà dans cette mission.` });
      }
      const updated = await db.updateTaskType(req.user.companyId, id, updates);
      if (!updated) return res.status(404).json({ error: 'Task type not found' });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/task-types/:id', authenticate, requirePermission('MANAGE_SERVICES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const removed = await db.deleteTaskType(req.user.companyId, id);
      if (!removed) return res.status(404).json({ error: 'Task type not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Presence (actif / absent / inactif)
  // ---------------------------------------------------------

  /**
   * Deliberately in memory, not in the JSON database: presence is ephemeral and
   * every user heartbeats every 30s, which would rewrite the whole database file
   * dozens of times a minute. Losing it on restart is correct — everyone simply
   * shows as inactive until their next heartbeat lands.
   *
   * Keyed by `${companyId}:${userId}`, not bare userId: numeric ids are minted
   * independently per company, so two different companies' users can otherwise
   * collide on the same key and leak one company's presence into another's.
   */
  const presence = new Map<string, { lastSeenAt: number; lastActivityAt: number; device: 'MOBILE' | 'DESKTOP' }>();
  const presenceKey = (companyId: string, userId: number) => `${companyId}:${userId}`;

  /**
   * The server owns this decision. A client can report how long it has been
   * idle, but it cannot report that its own machine is off — that is only
   * visible here, as heartbeats that stopped arriving.
   *
   * The away threshold is configurable per company, and presence is evaluated
   * on every heartbeat from every user, so each company's value is cached
   * rather than re-read from the database each time. A few seconds of
   * staleness after an admin changes it is irrelevant to a 30-minute threshold.
   */
  const awayMsCache = new Map<string, { value: number; at: number }>();
  const awayAfterMs = async (companyId: string) => {
    const cached = awayMsCache.get(companyId);
    if (cached && Date.now() - cached.at < 10_000) return cached.value;
    const settings = await db.getSettings(companyId);
    const value = clampAwayMinutes(settings?.awayAfterMinutes ?? DEFAULT_AWAY_AFTER_MINUTES) * 60 * 1000;
    awayMsCache.set(companyId, { value, at: Date.now() });
    return value;
  };

  const presenceStateOf = (
    rec: { lastSeenAt: number; lastActivityAt: number } | undefined,
    awayMs: number,
  ): PresenceState => {
    if (!rec) return 'INACTIVE';
    const now = Date.now();
    if (now - rec.lastSeenAt > OFFLINE_AFTER_MS) return 'INACTIVE';
    if (now - rec.lastActivityAt >= awayMs) return 'AWAY';
    return 'ACTIVE';
  };

  const presenceFor = (companyId: string, userId: number, awayMs: number) => {
    const rec = presence.get(presenceKey(companyId, userId));
    const state = presenceStateOf(rec, awayMs);
    return {
      state,
      // Idle time is meaningless once we've lost contact.
      idleMs: rec && state !== 'INACTIVE' ? Date.now() - rec.lastActivityAt : null,
      lastSeenAt: rec ? new Date(rec.lastSeenAt).toISOString() : null,
      // Le poste depuis lequel bat le cœur, et `null` dès qu'on a perdu le
      // contact — pour la même raison que `idleMs` : « était sur son
      // téléphone » n'apprend rien sur quelqu'un dont on ne sait plus rien, et
      // se lirait comme une information à jour. Auto-déclaré par le navigateur
      // et falsifiable, comme le badge du pointage : ça se lit, ça ne décide
      // de rien.
      device: rec && state !== 'INACTIVE' ? rec.device : null,
    };
  };

  /** Heartbeat. `idleMs` = time since this user last touched mouse or keyboard. */
  app.post('/api/presence', authenticate, async (req: any, res: any) => {
    const now = Date.now();
    const awayMs = await awayAfterMs(req.user.companyId);
    const reported = Number(req.body?.idleMs);
    const idleMs = Number.isFinite(reported) && reported >= 0 ? Math.min(reported, awayMs * 6) : 0;
    presence.set(presenceKey(req.user.companyId, req.user.id), {
      lastSeenAt: now,
      lastActivityAt: now - idleMs,
      // Relu à chaque battement plutôt que mémorisé une fois : quelqu'un qui
      // passe de son poste à son téléphone doit changer d'icône, pas garder
      // celle de sa première connexion de la journée.
      device: deviceFromRequest(req),
    });
    res.json({ userId: req.user.id, ...presenceFor(req.user.companyId, req.user.id, awayMs) });
  });

  /**
   * The away threshold, readable by anyone (the browser needs it to show its
   * own badge without waiting for the next poll) and writable only with
   * MANAGE_PRESENCE_SETTINGS. The server still decides every state — this only
   * tells the client which threshold it is being judged against.
   */
  app.get('/api/presence/settings', authenticate, async (req: any, res: any) => {
    const settings = await db.getSettings(req.user.companyId);
    res.json({ awayAfterMinutes: clampAwayMinutes(settings?.awayAfterMinutes ?? DEFAULT_AWAY_AFTER_MINUTES) });
  });

  app.put('/api/presence/settings', authenticate, requirePermission('MANAGE_PRESENCE_SETTINGS'), async (req: any, res: any) => {
    const raw = req.body?.awayAfterMinutes;
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw))) {
      return res.status(400).json({ error: 'awayAfterMinutes doit être un nombre de minutes.' });
    }
    const awayAfterMinutes = clampAwayMinutes(raw);
    await db.updateSettings(req.user.companyId, { awayAfterMinutes });
    awayMsCache.set(req.user.companyId, { value: awayAfterMinutes * 60 * 1000, at: Date.now() });
    res.json({ awayAfterMinutes });
  });

  /** Sent on logout / tab close so the user drops to inactive immediately. */
  app.post('/api/presence/offline', authenticate, (req: any, res: any) => {
    presence.delete(presenceKey(req.user.companyId, req.user.id));
    res.json({ success: true });
  });

  /** Presence of every known user in this company, keyed by id. */
  app.get('/api/presence', authenticate, async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers(req.user.companyId);
      const awayMs = await awayAfterMs(req.user.companyId);
      const byUser: Record<string, any> = {};
      for (const u of users) byUser[u.id] = presenceFor(req.user.companyId, u.id, awayMs);
      res.json(byUser);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Cash / Facturation
  // ---------------------------------------------------------

  /**
   * The totals cascade from the cahier des charges. Computed server-side so a
   * stored document can never disagree with its own lines:
   *   (3)=(1)+(2)   (5)=(3)*(4)   (7)=(3)-(5)+(6)   (10)=(7)+(8)-(9)
   * Under "Suspension de TVA" no VAT is charged, so (2) is zero.
   */
  const computeInvoiceTotals = (invoice: any) => {
    const suspended = invoice.vatRegime === 'SUSPENSION';
    // Export sales also charge zero VAT, but — unlike suspension — carry no
    // attestation/bon-de-commande wording and no indicative-VAT breakdown.
    const zeroVat = suspended || invoice.vatRegime === 'EXPORT';
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];


    let totalHT = 0;
    const vatByRate = new Map<number, number>();
    // Suspension never charges VAT, but the line's own rate is still tracked
    // separately below — the document must still show what VAT *would* have
    // applied ("à titre indicatif"), it just isn't charged or paid.
    const indicativeByRate = new Map<number, number>();
    for (const line of lines) {
      const ht = num(Number(line.montantHT), 0);
      totalHT += ht;
      // "Non soumis" (out of VAT scope) always charges zero, same as suspension/export.
      const realRate = line.vatExempt ? 0 : num(Number(line.vatRate), 0);
      const chargedRate = zeroVat ? 0 : realRate;
      vatByRate.set(chargedRate, (vatByRate.get(chargedRate) || 0) + ht);
      indicativeByRate.set(realRate, (indicativeByRate.get(realRate) || 0) + ht);
    }

    const vatBreakdown = [...vatByRate.entries()]
      .filter(([rate]) => !suspended && rate > 0)
      .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
      .sort((a, b) => a.rate - b.rate);

    // Purely informational under suspension — never added to totalVAT/totalTTC.
    const indicativeVatBreakdown = suspended
      ? [...indicativeByRate.entries()]
          .filter(([rate]) => rate > 0)
          .map(([rate, base]) => ({ rate, base: round3(base), amount: round3(base * rate) }))
          .sort((a, b) => a.rate - b.rate)
      : [];
    const indicativeVatTotal = round3(indicativeVatBreakdown.reduce((s, v) => s + v.amount, 0));

    const totalHTr = round3(totalHT);
    const totalVAT = round3(vatBreakdown.reduce((s, v) => s + v.amount, 0));
    const totalTTC = round3(totalHTr + totalVAT);                                   // (3)
    const withholdingRate = num(Number(invoice.withholdingRate), 0);                // (4)
    // Masking the retenue on the document also drops it from the net-to-pay
    // math — it isn't just hidden, it stops being applied at all.
    const withholdingAmount = invoice.showWithholding === false ? 0 : round3(totalTTC * withholdingRate); // (5)
    // Masking the timbre fiscal on the document also drops it from the
    // net-to-pay math — same rule as the retenue à la source above.
    const stampDuty = invoice.showStampDuty === false ? 0 : num(Number(invoice.stampDuty), 0); // (6)
    const netToPay = round3(totalTTC - withholdingAmount + stampDuty);              // (7)
    // (8) — plusieurs lignes possibles ; le montant qui entre dans la cascade
    // est leur somme, jamais un champ saisi à part qui pourrait la contredire.
    // Un document d'avant cette version est relu comme une ligne unique.
    const disbursementsLines = normalizeDisbursementLines(invoice);
    const disbursements = sumDisbursements(disbursementsLines);                     // (8)
    const advances = num(Number(invoice.advances), 0);                              // (9)
    const totalNetToPay = round3(netToPay + disbursements - advances);              // (10)

    return {
      vatBreakdown,
      indicativeVatBreakdown,
      indicativeVatTotal,
      totalHT: totalHTr,
      totalVAT,
      totalTTC,
      withholdingRate,
      withholdingAmount,
      stampDuty,
      netToPay,
      disbursementsLines,
      disbursements,
      advances,
      totalNetToPay,
    };
  };

  /**
   * Refuse un lot de lignes de débours qui ne tient pas dans la cascade.
   *
   * Le normalisateur tronque au-delà de la limite ; le faire en silence
   * ferait disparaître un montant que l'utilisateur a bien saisi, et la
   * facture partirait pour moins que ce qui est dû. Mieux vaut refuser.
   */
  const disbursementsError = (body: any): string | null => {
    const raw = body?.disbursementsLines;
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw)) return 'Les débours doivent être une liste de lignes.';
    if (raw.length > DISBURSEMENT_LINES_MAX) {
      return `Pas plus de ${DISBURSEMENT_LINES_MAX} lignes de débours par document.`;
    }
    if (raw.some((l: any) => !Number.isFinite(Number(l?.amount)))) {
      return 'Chaque ligne de débours doit porter un montant.';
    }
    if (raw.some((l: any) => Number(l?.amount) < 0)) {
      return 'Un débours ne peut pas être négatif — utilisez « Moins avances perçues ».';
    }
    return null;
  };

  /**
   * Dates may not decrease along the legal sequence.
   *
   * Numbering and chronology have to agree: invoice n° 2 cannot be dated before
   * n° 1. Two invoices *may* share a date — only going backwards is refused.
   *
   * Both ends are checked, which is what creation alone could not do. A new
   * invoice always takes the highest number, so it only ever had a predecessor;
   * an *edit* sits in the middle of the sequence, and moving n° 2 later than
   * n° 3 breaks the ordering just as surely as moving it before n° 1.
   *
   * Pass `Infinity` as the number for a document being created, before its
   * number is reserved: it is by definition the last one.
   *
   * Returns an error message, or null when the date is acceptable.
   */
  const legalSequenceDateError = (
    allInvoices: any[],
    selfId: string | null,
    number: number,
    issueDate: string,
  ): string | null => {
    const others = allInvoices
      .filter((i: any) => i.documentKind === 'FACTURE_LEGALE' && i.id !== selfId && i.issueDate)
      .map((i: any) => ({ n: Number(i.number), label: String(i.number), date: String(i.issueDate) }))
      .filter((i: any) => Number.isFinite(i.n));

    const previous = others.filter(i => i.n < number).sort((a, b) => b.n - a.n)[0];
    if (previous && issueDate < previous.date) {
      return `La date ne peut pas précéder celle de la facture n° ${previous.label} (${previous.date}).`;
    }

    const following = others.filter(i => i.n > number).sort((a, b) => a.n - b.n)[0];
    if (following && issueDate > following.date) {
      return `La date ne peut pas suivre celle de la facture n° ${following.label} (${following.date}).`;
    }
    return null;
  };

  // ---------------------------------------------------------
  // Brouillard de caisse — the cash daybook. One row per movement:
  // `entree` (money in) or `sortie` (money out). A row with an `entree`
  // tied to a client is also that client's encaissement on the Clients
  // page — merged on read by journalEncaissementsByClient(), never copied
  // onto the client, so there is exactly one record of the movement.
  // ---------------------------------------------------------

  /** Shared by create and update, so a row can never be saved two ways. */
  const normalizeJournalEntry = (body: any) => {
    const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
    const entree = round3(num(Number(body?.entree), 0));
    const sortie = round3(num(Number(body?.sortie), 0));
    return {
      date: text(body?.date, 10),
      label: text(body?.label, 200),
      // Both are kept: the id links to a real client record, the name is what
      // the cabinet actually typed and is the fallback the ledger matches on
      // when a row was never linked to one (same rule invoices already use).
      clientId: body?.clientId ? Number(body.clientId) : null,
      clientName: text(body?.clientName, 160),
      // Free text, not an enum: the cabinet's own sheet already carries a
      // long, growing list (Transport, Loyer, Femme de ménage, STEG, …) and
      // a closed list would just mean a code change every time it grows.
      // The UI offers the known ones as suggestions.
      category: text(body?.category, 60),
      // Mode de règlement. Normalised to one of the known ids so the caisse
      // rule below can rely on it; a row saved before the field existed, or
      // one carrying free text from an older client, normalises to '' and
      // reads as cash — see isCashMode().
      paymentMethod: toPaymentMode(body?.paymentMethod),
      // Only meaningful for a non-cash mode: an Espèce règlement goes to the
      // till, not to an account, so the field is blanked rather than kept as
      // a stale value from before the mode was switched.
      bankAccount: isCashMode(toPaymentMode(body?.paymentMethod)) ? '' : text(body?.bankAccount, 80),
      reference: text(body?.reference, 60),
      entree: entree > 0 ? entree : 0,
      sortie: sortie > 0 ? sortie : 0,
    };
  };

  const validateJournalEntry = (row: any): string | null => {
    if (!row.date) return 'La date est obligatoire';
    if (!row.label && !row.clientName && !row.category) return 'Un libellé, une catégorie ou un client est obligatoire';
    // A row with no amount is deliberately allowed: the cabinet's own journal
    // records a bill received (STEG, OOREDOO, loyer…) before it is paid, and
    // the running balance simply carries through unchanged.
    // Both amounts at once is a different matter — a data-entry slip, since
    // one line cannot be a receipt and a payment.
    if (row.entree > 0 && row.sortie > 0) return 'Une ligne ne peut pas être à la fois une entrée et une sortie';
    return null;
  };

  /**
   * The objets a journal row can carry. Seeded on first read with the
   * cabinet's own list and extended by them from the picker — held as rows,
   * not a constant, precisely so adding one never needs a code change.
   */
  const SEED_CASH_CATEGORIES = [
    'Encaissement client',
    'Alimentation de caisse',
    'Femme de ménage',
    'Loyer',
    "Produits d'hygiène",
    'Fournitures de bureau',
    'Transport',
    'STEG',
    'SONEDE',
    'Télécommunications',
    'OOREDOO',
    'TELECOM',
    'Dépannage client',
    'Remboursement dépannage client',
    'Autres',
  ];

  app.get('/api/cash-categories', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      let rows = await db.getAllCashCategories(req.user.companyId);
      if (rows.length === 0) {
        for (const label of SEED_CASH_CATEGORIES) {
          await db.createCashCategory(req.user.companyId, { id: genId('cashcat'), label });
        }
        rows = await db.getAllCashCategories(req.user.companyId);
      }
      // Alphabetical, accent-aware — the picker shows them in this order.
      res.json(rows.slice().sort((a: any, b: any) => String(a.label).localeCompare(String(b.label), 'fr')));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/cash-categories', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const label = String(req.body?.label ?? '').trim().slice(0, 60);
      if (!label) return res.status(400).json({ error: "L'objet ne peut pas être vide" });

      const existing = await db.getAllCashCategories(req.user.companyId);
      // Case-insensitive: "transport" and "Transport" are one objet, not two
      // near-identical entries cluttering the list.
      const clash = existing.find((c: any) => String(c.label).toLowerCase() === label.toLowerCase());
      if (clash) return res.json(clash);

      res.status(201).json(await db.createCashCategory(req.user.companyId, { id: genId('cashcat'), label }));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/cash-categories/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteCashCategory(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      // Rows already carrying the deleted objet keep it: the label is stored
      // on the row, so history stays readable. Same rule as a deleted
      // échéance status option.
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/cash-journal', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const rows = (await db.getAllCashJournalEntries(req.user.companyId))
        .slice()
        .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/cash-journal', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const row = normalizeJournalEntry(req.body);
      const invalid = validateJournalEntry(row);
      if (invalid) return res.status(400).json({ error: invalid });

      const created = await db.createCashJournalEntry(req.user.companyId, {
        id: genId('caisse'),
        ...row,
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(created);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/cash-journal/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const existing = await db.getCashJournalEntryById(req.user.companyId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const row = normalizeJournalEntry({ ...existing, ...req.body });
      const invalid = validateJournalEntry(row);
      if (invalid) return res.status(400).json({ error: invalid });

      res.json(await db.updateCashJournalEntry(req.user.companyId, req.params.id, row));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/cash-journal/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteCashJournalEntry(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Ce qui reste du plafond mensuel, pour l'afficher **avant** d'y buter.
   * Même helper que les deux refus ci-dessous : un compteur qui annoncerait
   * une place restante devant un refus serait pire que pas de compteur.
   */
  app.get('/api/cash/document-quota', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const company = await db.getCompanyById(req.user.companyId);
      const all = await db.getAllInvoices(req.user.companyId);
      res.json(documentQuotaState(company, all));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/invoices', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const all = await db.getAllInvoices(req.user.companyId);
      const q = String(req.query.q || '').toLowerCase();
      const filtered = q
        ? all.filter((i: any) =>
            (i.number || '').toLowerCase().includes(q) ||
            (i.clientName || '').toLowerCase().includes(q) ||
            (i.title || '').toLowerCase().includes(q))
        : all;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
      const offset = parseInt(req.query.offset, 10) || 0;

      // Sums across the whole filtered set, not just the returned page — this
      // is what the Cash table's frozen "Total Général" row shows. Grouped by
      // currency because a document can be issued in USD/EUR: adding those to
      // dinars would produce a number that means nothing.
      const totalsByCurrency: Record<string, { totalHT: number; totalNetToPay: number; count: number }> = {};
      let draftCount = 0;
      for (const inv of filtered) {
        // Un brouillon figure dans la liste mais pas dans le total : il n'est
        // pas émis. Il est compté à part pour que le décompte de la ligne de
        // total ne semble pas se tromper.
        if (inv.status === 'DRAFT') { draftCount += 1; continue; }
        const currency = String(inv.currency || 'TND');
        const acc = totalsByCurrency[currency] || { totalHT: 0, totalNetToPay: 0, count: 0 };
        acc.totalHT = round3(acc.totalHT + num(Number(inv.totalHT), 0));
        acc.totalNetToPay = round3(acc.totalNetToPay + num(Number(inv.totalNetToPay), 0));
        acc.count += 1;
        totalsByCurrency[currency] = acc;
      }

      res.json({ data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset, totalsByCurrency, draftCount });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/invoices/:id', authenticate, requirePermission('VIEW_CASH'), async (req: any, res: any) => {
    try {
      const invoice = await db.getInvoiceById(req.user.companyId, req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Document introuvable' });
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Peek at the number the next document will get (display only; not reserved). */
  app.get('/api/invoices/meta/next-number', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const settings = await db.getSettings(req.user.companyId);
      const current = typeof settings.invoiceCounter === 'number' ? settings.invoiceCounter : 0;
      const all = await db.getAllInvoices(req.user.companyId);
      // Only the legal sequence carries the date rule, so only a *legal*
      // invoice can bound the next one. Returning the newest document of any
      // kind let an autre document — which is exempt — set a floor the server
      // would never have enforced.
      const lastLegal = all.find((i: any) => i.documentKind === 'FACTURE_LEGALE');
      res.json({
        nextNumber: String(current + 1).padStart(4, '0'),
        lastIssueDate: lastLegal ? lastLegal.issueDate : null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/invoices', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const body = req.body || {};
      if (!body.clientId && !body.clientName) {
        return res.status(400).json({ error: 'La raison sociale du client est obligatoire' });
      }
      if (!body.issueDate) {
        return res.status(400).json({ error: 'La date de création est obligatoire' });
      }
      if (!Array.isArray(body.lines) || body.lines.length === 0) {
        return res.status(400).json({ error: 'Au moins une ligne est requise' });
      }
      if (body.lines.some((l: any) => !String(l.designation || '').trim())) {
        return res.status(400).json({ error: 'Chaque ligne doit avoir une désignation' });
      }

      const kind = body.documentKind === 'AUTRE' ? 'AUTRE'
        : body.documentKind === 'AUTRE_NON_FACTURABLE' ? 'AUTRE_NON_FACTURABLE'
        : 'FACTURE_LEGALE';
      const all = await db.getAllInvoices(req.user.companyId);

      /**
       * Un brouillon n'est pas un document émis : il ne prend aucun numéro de
       * la séquence légale, n'est soumis à aucune règle de chronologie, et ne
       * compte nulle part comme honoraires. Il prendra son numéro à
       * l'émission, à sa place dans l'ordre — c'est tout l'intérêt : préparer
       * une facture sans percer un trou dans la numérotation ni gonfler le
       * chiffre d'affaires de documents qui n'existent pas encore.
       */
      const isDraft = body.status === 'DRAFT';

      // Le plafond de l'offre ne porte que sur les documents émis : un
      // brouillon passe toujours, c'est ce qui est vendu.
      if (!isDraft) {
        const company = await db.getCompanyById(req.user.companyId);
        const quota = documentQuotaState(company, all);
        if (quota.limit && quota.remaining === 0) {
          return res.status(402).json({ error: QUOTA_REACHED_ERROR(quota.limit) });
        }
      }

      // Only a legal invoice is bound to the sequence. Both "autre" kinds
      // carry a free reference (bon de livraison, reçu, note interne…), so
      // neither follows the sequence nor consumes a number from it — doing so
      // would punch gaps in the legal numbering.
      let number: string;
      if (isDraft) {
        // Numéro provisoire, jamais celui de la séquence — et unique, pour
        // que deux brouillons ne se marchent pas dessus.
        number = `BR-${Date.now()}`;
      } else if (kind !== 'FACTURE_LEGALE') {
        number = String(body.number ?? '').trim();
        if (!number) {
          return res.status(400).json({ error: 'Le numéro du document est obligatoire' });
        }
        if (all.some((i: any) => i.number === number)) {
          return res.status(400).json({ error: `Le numéro « ${number} » est déjà utilisé.` });
        }
      } else {
        // The ordering rule belongs to the sequence, so it applies to legal
        // invoices only. A new one is always last, hence Infinity.
        const dateError = legalSequenceDateError(all, null, Infinity, body.issueDate);
        if (dateError) return res.status(400).json({ error: dateError });
      }

      const debError = disbursementsError(body);
      if (debError) return res.status(400).json({ error: debError });

      const totals = computeInvoiceTotals(body);
      if (kind === 'FACTURE_LEGALE' && !isDraft) number = await db.nextInvoiceNumber(req.user.companyId);

      const invoice = await db.createInvoice(req.user.companyId, {
        id: `inv-${Date.now()}`,
        number,
        status: isDraft ? 'DRAFT' : 'ISSUED',
        documentKind: kind,
        title: String(body.title || 'Facture').trim(),
        billingMode: body.billingMode === 'DETAILLEE' ? 'DETAILLEE' : 'FORFAIT',
        vatRegime: body.vatRegime === 'SUSPENSION' ? 'SUSPENSION' : body.vatRegime === 'EXPORT' ? 'EXPORT' : 'DROIT_COMMUN',
        // Free text beyond TND — the user types their own currency (USD, GBP…)
        // rather than picking from a fixed list.
        currency: String(body.currency || 'TND').trim().toUpperCase().slice(0, 12) || 'TND',
        clientId: body.clientId ?? null,
        clientName: body.clientName || '',
        clientTaxId: body.clientTaxId || '',
        clientAddress: body.clientAddress || '',
        customFields: body.customFields && typeof body.customFields === 'object' ? body.customFields : {},
        issueDate: body.issueDate,
        dueDate: body.dueDate || '',
        showDueDate: body.showDueDate !== false,
        bankId: body.bankId || null,
        // Only meaningful under "Suspension de TVA" — printed under the
        // invoice number, but always stored so switching régime back and
        // forth doesn't lose what was typed.
        attestationNumber: String(body.attestationNumber || '').trim(),
        attestationDate: body.attestationDate ? String(body.attestationDate).slice(0, 10) : '',
        bonCommandeNumber: String(body.bonCommandeNumber || '').trim(),
        // Le libellé unique d'avant les lignes multiples. Vidé sur tout
        // document écrit par cette version : `disbursementsLines` est le seul
        // porteur désormais, et laisser les deux garnis ferait deux copies de
        // la même information à tenir d'accord.
        disbursementsLabel: '',
        // Masks the Retenue à la source / Timbre fiscal lines on the printed
        // document — and, unlike showDueDate, also drops them from the actual
        // net-to-pay math (see computeInvoiceTotals).
        showWithholding: body.showWithholding !== false,
        showStampDuty: body.showStampDuty !== false,
        lines: body.lines.map((l: any) => ({
          designation: String(l.designation || '').trim(),
          quantity: num(Number(l.quantity), 1),
          unitPrice: num(Number(l.unitPrice), 0),
          vatRate: num(Number(l.vatRate), 0),
          vatExempt: !!l.vatExempt,
          montantHT: num(Number(l.montantHT), 0),
        })),
        ...totals,
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json(invoice);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/invoices/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const existing = await db.getInvoiceById(req.user.companyId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable' });

      const merged = { ...existing, ...req.body };

      // Le statut ne se change pas par une simple modification : on émet un
      // brouillon par /issue, qui seul sait attribuer un numéro.
      merged.status = existing.status || 'ISSUED';
      const editingDraft = merged.status === 'DRAFT';

      // A legal invoice's number belongs to the sequence and is never
      // reassigned; a free document's may be corrected.
      if (editingDraft) {
        merged.number = existing.number;
      } else if (merged.documentKind !== 'FACTURE_LEGALE') {
        const wanted = String(req.body?.number ?? existing.number ?? '').trim();
        if (!wanted) {
          return res.status(400).json({ error: 'Le numéro du document est obligatoire' });
        }
        const all = await db.getAllInvoices(req.user.companyId);
        if (all.some((i: any) => i.id !== existing.id && i.number === wanted)) {
          return res.status(400).json({ error: `Le numéro « ${wanted} » est déjà utilisé.` });
        }
        merged.number = wanted;
      } else {
        merged.number = existing.number;
      }

      if (!merged.clientId && !merged.clientName) {
        return res.status(400).json({ error: 'La raison sociale du client est obligatoire' });
      }
      if (!merged.issueDate) {
        return res.status(400).json({ error: 'La date de création est obligatoire' });
      }
      if (!Array.isArray(merged.lines) || merged.lines.length === 0) {
        return res.status(400).json({ error: 'Au moins une ligne est requise' });
      }
      if (merged.lines.some((l: any) => !String(l.designation || '').trim())) {
        return res.status(400).json({ error: 'Chaque ligne doit avoir une désignation' });
      }
      // Editing bypassed the ordering rule entirely, so a legal invoice created
      // in order could be moved to any date afterwards.
      if (merged.documentKind === 'FACTURE_LEGALE' && !editingDraft) {
        const dateError = legalSequenceDateError(
          await db.getAllInvoices(req.user.companyId), existing.id, Number(merged.number), merged.issueDate,
        );
        if (dateError) return res.status(400).json({ error: dateError });
      }
      const debError = disbursementsError(req.body);
      if (debError) return res.status(400).json({ error: debError });
      const totals = computeInvoiceTotals(merged);

      const updated = await db.updateInvoice(req.user.companyId, req.params.id, {
        ...merged,
        ...totals,
        // Le libellé unique d'avant les lignes multiples, vidé dès qu'un
        // document passe par cette version pour qu'il ne reste qu'un porteur.
        // Après computeInvoiceTotals, jamais avant : c'est lui qui relit ce
        // libellé pour en faire la ligne unique d'un document hérité, et le
        // vider d'abord effacerait l'indication en modifiant une vieille
        // facture à laquelle on ne touchait pas les débours.
        disbursementsLabel: '',
        updatedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Émettre un brouillon : c'est ici, et seulement ici, qu'il prend son numéro.
   *
   * Le numéro est attribué au moment de l'émission, donc à sa vraie place dans
   * la séquence — un brouillon préparé lundi et émis vendredi ne réserve pas
   * un numéro toute la semaine, et ne laisse pas de trou s'il est abandonné.
   */
  app.post('/api/invoices/:id/issue', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const existing = await db.getInvoiceById(req.user.companyId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable' });
      if (existing.status !== 'DRAFT') {
        return res.status(409).json({ error: 'Ce document est déjà émis.' });
      }

      const all = await db.getAllInvoices(req.user.companyId);

      // Émettre, c'est faire naître le document — donc c'est ici que le
      // brouillon consomme sa place, et pas à sa préparation.
      const company = await db.getCompanyById(req.user.companyId);
      const quota = documentQuotaState(company, all);
      if (quota.limit && quota.remaining === 0) {
        return res.status(402).json({ error: QUOTA_REACHED_ERROR(quota.limit) });
      }

      let number = existing.number;

      if (existing.documentKind === 'FACTURE_LEGALE') {
        // Même règle qu'à la création : une facture émise maintenant est la
        // dernière de la séquence, donc Infinity.
        const dateError = legalSequenceDateError(all, existing.id, Infinity, existing.issueDate);
        if (dateError) return res.status(400).json({ error: dateError });
        number = await db.nextInvoiceNumber(req.user.companyId);
      } else {
        // Un autre document porte une référence libre : elle est demandée à
        // l'émission si le brouillon n'en portait pas encore de vraie.
        const wanted = String(req.body?.number ?? '').trim();
        if (!wanted) {
          return res.status(400).json({ error: 'Le numéro du document est obligatoire pour l\'émettre.' });
        }
        if (all.some((i: any) => i.id !== existing.id && i.number === wanted)) {
          return res.status(400).json({ error: `Le numéro « ${wanted} » est déjà utilisé.` });
        }
        number = wanted;
      }

      res.json(await db.updateInvoice(req.user.companyId, existing.id, {
        status: 'ISSUED',
        number,
        issuedAt: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Issue invoice error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Transformer un autre document en facture légale.
   *
   * Le document prend le prochain numéro de la séquence légale — il ne garde
   * pas sa référence libre, qui n'appartient pas à la séquence — et se place
   * donc en dernier. La règle de chronologie s'applique dès cet instant : une
   * facture légale ne peut pas porter une date antérieure à celle qui la
   * précède, quelle que soit la façon dont elle est née.
   */
  app.post('/api/invoices/:id/convert-to-legal', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const existing = await db.getInvoiceById(req.user.companyId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Document introuvable' });
      if (existing.documentKind === 'FACTURE_LEGALE') {
        return res.status(409).json({ error: 'Ce document est déjà une facture légale.' });
      }
      if (existing.status === 'DRAFT') {
        return res.status(409).json({ error: 'Émettez le brouillon en facture légale plutôt que de le convertir.' });
      }

      const all = await db.getAllInvoices(req.user.companyId);
      const dateError = legalSequenceDateError(all, existing.id, Infinity, existing.issueDate);
      if (dateError) {
        return res.status(400).json({
          error: `${dateError} Corrigez la date du document avant de le convertir.`,
        });
      }

      const number = await db.nextInvoiceNumber(req.user.companyId);
      // La cascade est recalculée : passer en facture légale peut changer la
      // retenue et le timbre, donc le net à payer.
      const totals = computeInvoiceTotals({ ...existing, documentKind: 'FACTURE_LEGALE' });
      const updated = await db.updateInvoice(req.user.companyId, existing.id, {
        documentKind: 'FACTURE_LEGALE',
        number,
        // Garde la trace de ce qu'il était : la référence libre d'origine
        // reste retrouvable, sans quoi le document devient introuvable pour
        // qui le connaissait sous son ancien numéro.
        convertedFromNumber: existing.number,
        convertedAt: new Date().toISOString(),
        ...totals,
      });
      console.warn(`[cash] document ${existing.number} converti en facture légale n° ${number}, par ${req.user.username}`);
      res.json(updated);
    } catch (error) {
      console.error('Convert invoice error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/invoices/:id', authenticate, requirePermission('MANAGE_CASH'), async (req: any, res: any) => {
    try {
      const removed = await db.deleteInvoice(req.user.companyId, req.params.id);
      if (!removed) return res.status(404).json({ error: 'Document introuvable' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // HR API Routes
  // ---------------------------------------------------------

  // GET Approvers
  app.get('/api/hr/approvers', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers(req.user.companyId);
      // Allow ADMIN, MANAGER, SUPERVISOR to be approvers
      const approvers = users.filter((u: any) => HR_APPROVER_ROLES.includes(u.role));
      res.json(
        approvers
          .map((u: any) => ({ id: u.id, name: u.username, role: u.role }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      );
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Leave Requests
  app.get('/api/hr/leaves', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const leaves = await db.getAllLeaveRequests(req.user.companyId);
      let result = leaves;

      if (req.user.role !== 'ADMIN') {
        result = leaves.filter((l: any) => l.userId === req.user.id || l.approverId === req.user.id);
      }

      const users = await db.getAllUsers(req.user.companyId);
      result = result.map((l: any) => ({
        ...l,
        userName: users.find((u: any) => u.id === l.userId)?.username || 'Unknown',
        approverName: users.find((u: any) => u.id === l.approverId)?.username || 'Unknown',
        approvedByName: l.approvedBy ? users.find((u: any) => u.id === l.approvedBy)?.username : null
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Leave Request
  app.post('/api/hr/leaves', authenticate, requirePermission('CREATE_LEAVE_REQUEST'), async (req: any, res: any) => {
    try {
      const { type, startDate, endDate, duration, reason, approverId } = req.body;
      const leave = await db.createLeaveRequest(req.user.companyId, {
        id: Date.now(),
        userId: req.user.id,
        approverId: Number(approverId),
        type,
        startDate,
        endDate,
        duration: Number(duration),
        reason,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const requester = await db.getUserById(req.user.companyId, req.user.id);
      await notify(
        req.user.companyId,
        Number(approverId),
        'LEAVE_REQUEST',
        'Demande de congé à approuver',
        `${requester?.fullName || requester?.username || 'Un collaborateur'} a demandé un congé du ${startDate} au ${endDate}.`,
      );
      res.status(201).json(leave);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Approve Leave
  app.post('/api/hr/leaves/:id/approve', authenticate, requirePermission('MANAGE_LEAVE_REQUESTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leave = await db.getLeaveRequestById(req.user.companyId, id);
      if (!leave) return res.status(404).json({ error: 'Not found' });

      // Ensure the user is the assigned approver or an Admin
      if (leave.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }

      if (leave.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      // Deduct balance
      const balance = await db.getLeaveBalanceByUserId(req.user.companyId, leave.userId);
      if (balance.available < leave.duration) {
        return res.status(400).json({ error: 'Insufficient leave balance' });
      }

      // Only `used` moves; `available` is derived from the admin-set entitlement.
      await db.updateLeaveBalance(req.user.companyId, leave.userId, { used: balance.used + leave.duration });

      const updated = await db.updateLeaveRequest(req.user.companyId, id, {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString()
      });
      await notify(req.user.companyId, leave.userId, 'LEAVE_DECISION', 'Congé approuvé', `Votre demande de congé du ${leave.startDate} au ${leave.endDate} a été approuvée.`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Reject Leave
  app.post('/api/hr/leaves/:id/reject', authenticate, requirePermission('MANAGE_LEAVE_REQUESTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'Rejection reason required' });

      const leave = await db.getLeaveRequestById(req.user.companyId, id);
      if (!leave) return res.status(404).json({ error: 'Not found' });

      // Ensure the user is the assigned approver or an Admin
      if (leave.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }

      if (leave.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateLeaveRequest(req.user.companyId, id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString()
      });
      await notify(req.user.companyId, leave.userId, 'LEAVE_DECISION', 'Congé refusé', `Votre demande de congé du ${leave.startDate} au ${leave.endDate} a été refusée : ${comment}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Cancel Leave
  app.post('/api/hr/leaves/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const leave = await db.getLeaveRequestById(req.user.companyId, id);
      if (!leave) return res.status(404).json({ error: 'Not found' });

      const perms = JSON.parse(req.user.permissions || '[]');
      if (leave.userId !== req.user.id && !perms.includes('MANAGE_LEAVE_REQUESTS')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (leave.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });

      // If it was approved, we must restore the balance
      if (leave.status === 'APPROVED') {
        const balance = await db.getLeaveBalanceByUserId(req.user.companyId, leave.userId);
        await db.updateLeaveBalance(req.user.companyId, leave.userId, {
          used: Math.max(0, balance.used - leave.duration),
        });
      }

      const updated = await db.updateLeaveRequest(req.user.companyId, id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Absence Authorizations
  app.get('/api/hr/authorizations', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const auths = await db.getAllAbsenceAuthorizations(req.user.companyId);
      let result = auths;

      if (req.user.role !== 'ADMIN') {
        result = auths.filter((a: any) => a.userId === req.user.id || a.approverId === req.user.id);
      }

      const users = await db.getAllUsers(req.user.companyId);
      result = result.map((a: any) => ({
        ...a,
        userName: users.find((u: any) => u.id === a.userId)?.username || 'Unknown',
        approverName: users.find((u: any) => u.id === a.approverId)?.username || 'Unknown',
        approvedByName: a.approvedBy ? users.find((u: any) => u.id === a.approvedBy)?.username : null
      }));
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Absence Authorization
  app.post('/api/hr/authorizations', authenticate, requirePermission('CREATE_ABSENCE_AUTHORIZATION'), async (req: any, res: any) => {
    try {
      const { date, startTime, endTime, duration, reason, comment, approverId } = req.body;
      const auth = await db.createAbsenceAuthorization(req.user.companyId, {
        id: Date.now(),
        userId: req.user.id,
        approverId: Number(approverId),
        date,
        startTime,
        endTime,
        duration: Number(duration),
        reason,
        comment,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const requester = await db.getUserById(req.user.companyId, req.user.id);
      await notify(
        req.user.companyId,
        Number(approverId),
        'ABSENCE_REQUEST',
        "Demande d'autorisation d'absence",
        `${requester?.fullName || requester?.username || 'Un collaborateur'} a demandé une autorisation d'absence le ${date}.`,
      );
      res.status(201).json(auth);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Approve Auth
  app.post('/api/hr/authorizations/:id/approve', authenticate, requirePermission('MANAGE_ABSENCE_AUTHORIZATIONS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const auth = await db.getAbsenceAuthorizationById(req.user.companyId, id);
      if (!auth) return res.status(404).json({ error: 'Not found' });

      if (auth.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }

      if (auth.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAbsenceAuthorization(req.user.companyId, id, {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString()
      });
      await notify(req.user.companyId, auth.userId, 'ABSENCE_DECISION', "Autorisation d'absence approuvée", `Votre demande d'autorisation d'absence du ${auth.date} a été approuvée.`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Reject Auth
  app.post('/api/hr/authorizations/:id/reject', authenticate, requirePermission('MANAGE_ABSENCE_AUTHORIZATIONS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'Rejection reason required' });

      const auth = await db.getAbsenceAuthorizationById(req.user.companyId, id);
      if (!auth) return res.status(404).json({ error: 'Not found' });

      if (auth.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }

      if (auth.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAbsenceAuthorization(req.user.companyId, id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString()
      });
      await notify(req.user.companyId, auth.userId, 'ABSENCE_DECISION', "Autorisation d'absence refusée", `Votre demande d'autorisation d'absence du ${auth.date} a été refusée : ${comment}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Cancel Auth
  app.post('/api/hr/authorizations/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const auth = await db.getAbsenceAuthorizationById(req.user.companyId, id);
      if (!auth) return res.status(404).json({ error: 'Not found' });

      const perms = JSON.parse(req.user.permissions || '[]');
      if (auth.userId !== req.user.id && !perms.includes('MANAGE_ABSENCE_AUTHORIZATIONS')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (auth.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });

      const updated = await db.updateAbsenceAuthorization(req.user.companyId, id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---- Gestion des prêts et avances --------------------------------------
  // A collaborator-initiated request/approval workflow, same shape as
  // leaves/absences above: the requester (CREATE_LOAN_REQUEST) picks a
  // responsable from HR_APPROVER_ROLES (the same /api/hr/approvers list
  // leaves/absences already use), the request sits PENDING until that
  // approver (or an ADMIN) approves or rejects it via MANAGE_LOANS_ADVANCES,
  // and both sides get notified — the request and the decision are two
  // separate notifications, exactly like LEAVE_REQUEST/LEAVE_DECISION.

  app.get('/api/hr/loans', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const perms = JSON.parse(req.user.permissions || '[]');
      const canManage = req.user.role === 'ADMIN' || perms.includes('MANAGE_LOANS_ADVANCES');
      let loans = await db.getAllLoans(req.user.companyId);
      if (!canManage) loans = loans.filter((l: any) => l.userId === req.user.id || l.approverId === req.user.id);
      const users = await db.getAllUsers(req.user.companyId);
      res.json(loans.map((l: any) => ({
        ...l,
        userName: users.find((u: any) => u.id === l.userId)?.fullName || users.find((u: any) => u.id === l.userId)?.username || 'Inconnu',
        approverName: users.find((u: any) => u.id === l.approverId)?.fullName || users.find((u: any) => u.id === l.approverId)?.username || 'Inconnu',
      })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/loans', authenticate, requirePermission('CREATE_LOAN_REQUEST'), async (req: any, res: any) => {
    try {
      const { amount, monthlyDeduction, reason, dateGranted, approverId } = req.body;
      if (!approverId || !(Number(amount) > 0)) {
        return res.status(400).json({ error: 'Le responsable et un montant positif sont obligatoires.' });
      }
      const loan = await db.createLoan(req.user.companyId, {
        id: Date.now(),
        userId: req.user.id,
        approverId: Number(approverId),
        amount: Number(amount),
        monthlyDeduction: Number(monthlyDeduction) || 0,
        amountRepaid: 0,
        reason: String(reason || ''),
        dateGranted: dateGranted || formatDateISO(new Date()),
        status: 'PENDING',
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const requester = await db.getUserById(req.user.companyId, req.user.id);
      await notify(
        req.user.companyId, Number(approverId), 'LOAN_REQUEST', 'Demande de prêt à approuver',
        `${requester?.fullName || requester?.username || 'Un collaborateur'} a demandé un prêt de ${Number(amount).toLocaleString('fr-FR')} DT.`,
      );
      res.status(201).json(loan);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/loans/:id/approve', authenticate, requirePermission('MANAGE_LOANS_ADVANCES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const loan = await db.getLoanById(req.user.companyId, id);
      if (!loan) return res.status(404).json({ error: 'Not found' });
      if (loan.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }
      if (loan.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateLoan(req.user.companyId, id, {
        status: 'ACTIVE',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString(),
      });
      await notify(
        req.user.companyId, loan.userId, 'LOAN_DECISION', 'Prêt approuvé',
        `Votre demande de prêt de ${Number(loan.amount).toLocaleString('fr-FR')} DT a été approuvée.`,
      );
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/loans/:id/reject', authenticate, requirePermission('MANAGE_LOANS_ADVANCES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'Rejection reason required' });

      const loan = await db.getLoanById(req.user.companyId, id);
      if (!loan) return res.status(404).json({ error: 'Not found' });
      if (loan.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }
      if (loan.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateLoan(req.user.companyId, id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString(),
      });
      await notify(
        req.user.companyId, loan.userId, 'LOAN_DECISION', 'Prêt refusé',
        `Votre demande de prêt de ${Number(loan.amount).toLocaleString('fr-FR')} DT a été refusée : ${comment}`,
      );
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/loans/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const loan = await db.getLoanById(req.user.companyId, id);
      if (!loan) return res.status(404).json({ error: 'Not found' });

      const perms = JSON.parse(req.user.permissions || '[]');
      if (loan.userId !== req.user.id && !perms.includes('MANAGE_LOANS_ADVANCES') && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (loan.status !== 'PENDING' && loan.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Request cannot be cancelled' });
      }

      const updated = await db.updateLoan(req.user.companyId, id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/hr/loans/:id', authenticate, requirePermission('MANAGE_LOANS_ADVANCES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await db.getLoanById(req.user.companyId, id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      // Repayments only make sense once the request is approved and active —
      // PENDING/REJECTED/CANCELLED go through approve/reject/cancel instead.
      if (existing.status !== 'ACTIVE' && existing.status !== 'REPAID') {
        return res.status(400).json({ error: 'Loan is not active' });
      }

      const { amountRepaid, notes } = req.body;
      const updates: any = { updatedAt: new Date().toISOString() };
      if (amountRepaid !== undefined) updates.amountRepaid = Number(amountRepaid);
      if (notes !== undefined) updates.notes = String(notes);

      // A repayment that reaches the full amount closes the loan on its own.
      const nextRepaid = updates.amountRepaid ?? existing.amountRepaid;
      if (existing.amount > 0 && nextRepaid >= existing.amount) {
        updates.status = 'REPAID';
      }

      const updated = await db.updateLoan(req.user.companyId, id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/hr/advances', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const perms = JSON.parse(req.user.permissions || '[]');
      const canManage = req.user.role === 'ADMIN' || perms.includes('MANAGE_LOANS_ADVANCES');
      let advances = await db.getAllAdvances(req.user.companyId);
      if (!canManage) advances = advances.filter((a: any) => a.userId === req.user.id || a.approverId === req.user.id);
      const users = await db.getAllUsers(req.user.companyId);
      res.json(advances.map((a: any) => ({
        ...a,
        userName: users.find((u: any) => u.id === a.userId)?.fullName || users.find((u: any) => u.id === a.userId)?.username || 'Inconnu',
        approverName: users.find((u: any) => u.id === a.approverId)?.fullName || users.find((u: any) => u.id === a.approverId)?.username || 'Inconnu',
      })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/advances', authenticate, requirePermission('CREATE_LOAN_REQUEST'), async (req: any, res: any) => {
    try {
      const { amount, reason, dateGranted, approverId } = req.body;
      if (!approverId || !(Number(amount) > 0)) {
        return res.status(400).json({ error: 'Le responsable et un montant positif sont obligatoires.' });
      }
      const advance = await db.createAdvance(req.user.companyId, {
        id: Date.now(),
        userId: req.user.id,
        approverId: Number(approverId),
        amount: Number(amount),
        reason: String(reason || ''),
        dateGranted: dateGranted || formatDateISO(new Date()),
        status: 'PENDING',
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const requester = await db.getUserById(req.user.companyId, req.user.id);
      await notify(
        req.user.companyId, Number(approverId), 'ADVANCE_REQUEST', 'Demande d\'avance à approuver',
        `${requester?.fullName || requester?.username || 'Un collaborateur'} a demandé une avance de ${Number(amount).toLocaleString('fr-FR')} DT.`,
      );
      res.status(201).json(advance);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/advances/:id/approve', authenticate, requirePermission('MANAGE_LOANS_ADVANCES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const advance = await db.getAdvanceById(req.user.companyId, id);
      if (!advance) return res.status(404).json({ error: 'Not found' });
      if (advance.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to approve this request.' });
      }
      if (advance.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAdvance(req.user.companyId, id, {
        status: 'ACTIVE',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        approverComment: req.body.comment || '',
        updatedAt: new Date().toISOString(),
      });
      await notify(
        req.user.companyId, advance.userId, 'ADVANCE_DECISION', 'Avance approuvée',
        `Votre demande d'avance de ${Number(advance.amount).toLocaleString('fr-FR')} DT a été approuvée.`,
      );
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/advances/:id/reject', authenticate, requirePermission('MANAGE_LOANS_ADVANCES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { comment } = req.body;
      if (!comment) return res.status(400).json({ error: 'Rejection reason required' });

      const advance = await db.getAdvanceById(req.user.companyId, id);
      if (!advance) return res.status(404).json({ error: 'Not found' });
      if (advance.approverId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You are not authorized to reject this request.' });
      }
      if (advance.status !== 'PENDING') return res.status(400).json({ error: 'Request is not pending' });

      const updated = await db.updateAdvance(req.user.companyId, id, {
        status: 'REJECTED',
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        rejectionReason: comment,
        approverComment: comment,
        updatedAt: new Date().toISOString(),
      });
      await notify(
        req.user.companyId, advance.userId, 'ADVANCE_DECISION', 'Avance refusée',
        `Votre demande d'avance de ${Number(advance.amount).toLocaleString('fr-FR')} DT a été refusée : ${comment}`,
      );
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/hr/advances/:id/cancel', authenticate, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const advance = await db.getAdvanceById(req.user.companyId, id);
      if (!advance) return res.status(404).json({ error: 'Not found' });

      const perms = JSON.parse(req.user.permissions || '[]');
      if (advance.userId !== req.user.id && !perms.includes('MANAGE_LOANS_ADVANCES') && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (advance.status !== 'PENDING' && advance.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Request cannot be cancelled' });
      }

      const updated = await db.updateAdvance(req.user.companyId, id, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/hr/advances/:id', authenticate, requirePermission('MANAGE_LOANS_ADVANCES'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await db.getAdvanceById(req.user.companyId, id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (existing.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Advance is not active' });
      }

      const { notes } = req.body;
      const updates: any = { status: 'REPAID', updatedAt: new Date().toISOString() };
      if (notes !== undefined) updates.notes = String(notes);

      const updated = await db.updateAdvance(req.user.companyId, id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---- Pointage (présence quotidienne) -----------------------------------
  // Manual check-in / check-out against the admin-set shift (Équipe view) —
  // distinct from Time Tracking's task timers, which track what was worked
  // on, not whether the collaborator showed up. One row per (user, date).

  const PUNCTUALITY_TOLERANCE_MIN = 15;
  const attendanceToday = () => formatDateISO(new Date());
  const isPhoneRequest = (req: any) => /Mobi|Android|iPhone|iPad/i.test(req.headers['user-agent'] || '');

  /**
   * Minutes between an admin-set "HH:MM" shift boundary (today) and `at` —
   * positive means `at` is later.
   *
   * Comparaison d'heures **murales**, pas d'instants : l'horaire est saisi
   * comme « 08:00 » dans le fuseau du cabinet, et c'est à l'heure murale du
   * cabinet qu'il doit se comparer. `setHours()` posait la borne dans le
   * fuseau du processus — en UTC, « 08:00 » devenait 09h00 à Tunis et tout le
   * monde arrivait une heure en avance.
   */
  const minutesFromShift = (hhmm: string, at: Date) => {
    const [h, m] = hhmm.split(':').map(Number);
    const c = civilParts(at);
    return (c.hour * 60 + c.minute) - (h * 60 + m);
  };

  app.get('/api/attendance/today', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const me = await db.getUserById(req.user.companyId, req.user.id);
      const records = await db.getAllAttendanceRecords(req.user.companyId);
      const record = records.find((r: any) => r.userId === req.user.id && r.date === attendanceToday()) || null;
      res.json({
        shiftStart: me?.shiftStart || null,
        shiftEnd: me?.shiftEnd || null,
        breakMinutes: me?.breakMinutes ?? null,
        toleranceMinutes: PUNCTUALITY_TOLERANCE_MIN,
        record,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/attendance/checkin', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const date = attendanceToday();
      const records = await db.getAllAttendanceRecords(req.user.companyId);
      if (records.some((r: any) => r.userId === req.user.id && r.date === date)) {
        return res.status(400).json({ error: 'Arrivée déjà pointée aujourd\'hui.' });
      }

      const me = await db.getUserById(req.user.companyId, req.user.id);
      const now = new Date();
      const lateMinutes = me?.shiftStart ? minutesFromShift(me.shiftStart, now) : null;

      const record = await db.createAttendanceRecord(req.user.companyId, {
        id: Date.now(),
        userId: req.user.id,
        date,
        checkinAt: now.toISOString(),
        checkinViaPhone: isPhoneRequest(req),
        checkinLateMinutes: lateMinutes,
        checkoutAt: null,
        checkoutViaPhone: null,
        checkoutLateMinutes: null,
        shiftStart: me?.shiftStart || null,
        shiftEnd: me?.shiftEnd || null,
        breakMinutes: me?.breakMinutes ?? null,
      });
      res.status(201).json(record);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/attendance/checkout', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const date = attendanceToday();
      const records = await db.getAllAttendanceRecords(req.user.companyId);
      const existing = records.find((r: any) => r.userId === req.user.id && r.date === date);
      if (!existing) return res.status(400).json({ error: "Vous n'avez pas encore pointé votre arrivée." });
      if (existing.checkoutAt) return res.status(400).json({ error: 'Départ déjà pointé aujourd\'hui.' });

      // Pointage tracks presence, not task time — "checked out" while a task
      // timer keeps running would silently keep costing/billing an absent
      // collaborator's time. The client is expected to show this as a
      // reminder popup rather than a raw error.
      const entries = await db.getAllTimeEntries(req.user.companyId);
      const running = entries.find((e: any) => e.userId === req.user.id && e.statut === 'RUNNING');
      if (running) {
        return res.status(409).json({
          error: `Vous avez une tâche en cours (${running.pole || running.taskType || 'sans nom'}). Arrêtez-la avant de pointer votre départ.`,
          runningEntryId: running.id,
        });
      }

      const me = await db.getUserById(req.user.companyId, req.user.id);
      const now = new Date();
      const lateMinutes = me?.shiftEnd ? minutesFromShift(me.shiftEnd, now) : null;

      const record = await db.updateAttendanceRecord(req.user.companyId, existing.id, {
        checkoutAt: now.toISOString(),
        checkoutViaPhone: isPhoneRequest(req),
        checkoutLateMinutes: lateMinutes,
      });
      res.json(record);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Own history for anyone with VIEW_HR; DASHBOARD_ROLES (ADMIN/SUPERVISEUR,
  // same split the KPI dashboard already uses) see the whole team's log.
  app.get('/api/attendance', authenticate, requirePermission('VIEW_HR'), async (req: any, res: any) => {
    try {
      const canViewAll = DASHBOARD_ROLES.includes(req.user.role);
      let records = await db.getAllAttendanceRecords(req.user.companyId);
      if (!canViewAll) records = records.filter((r: any) => r.userId === req.user.id);

      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
      const cutoffStr = isoDaysAgo(days);
      records = records.filter((r: any) => r.date >= cutoffStr);

      const users = await db.getAllUsers(req.user.companyId);
      res.json(
        records
          .map((r: any) => ({
            ...r,
            userName: users.find((u: any) => u.id === r.userId)?.fullName || users.find((u: any) => u.id === r.userId)?.username || 'Inconnu',
          }))
          .sort((a: any, b: any) => b.date.localeCompare(a.date) || b.id - a.id),
      );
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---- Portail client -----------------------------------------------------
  //
  // La seule surface qu'un compte `CLIENT` peut atteindre (voir la liste
  // blanche de `authenticate`). Chaque route part de `portalClient(req)` :
  // le dossier est repris du jeton, jamais d'un paramètre de requête, donc
  // aucune de ces routes ne peut être détournée vers le dossier d'un autre
  // client en changeant une URL.

  /** Le dossier du client connecté, ou `null` si le compte n'est rattaché à rien. */
  const portalClient = async (req: any) => {
    if (req.user.role !== CLIENT_ROLE) return null;
    const id = req.user.clientId;
    if (id == null) return null;
    return (await db.getClientById(req.user.companyId, Number(id))) || null;
  };

  /** 403 explicite plutôt qu'un 500 : un compte client non rattaché est une erreur d'administration, pas une panne. */
  const requirePortalClient = async (req: any, res: any) => {
    const client = await portalClient(req);
    if (!client) {
      res.status(403).json({ error: "Votre compte n'est rattaché à aucun dossier client. Contactez le cabinet." });
      return null;
    }
    return client;
  };

  /** Les factures du dossier qui comptent comme des honoraires, triées par date. */
  const portalInvoicesFor = async (companyId: string, client: any) =>
    (await db.getAllInvoices(companyId))
      .filter((inv: any) => {
        if (!countsAsBilled(inv)) return false;
        const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
        return key === String(client.id) || key === `name:${client.name}`;
      })
      .sort((a: any, b: any) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')));

  /** Tous les encaissements du dossier : ceux saisis sur la fiche et ceux venus du brouillard. */
  const portalEncaissementsFor = async (companyId: string, client: any) => {
    const manual = normalizeEncaissements(client.encaissements).map((e: any) => ({ ...e, source: 'MANUEL' }));
    const fromJournal = journalFor(
      journalEncaissementsByClient(await db.getAllCashJournalEntries(companyId)),
      client,
    );
    return [...manual, ...fromJournal].sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  };

  app.get('/api/portal/summary', authenticate, async (req: any, res: any) => {
    try {
      const client = await requirePortalClient(req, res);
      if (!client) return;

      const invoices = await portalInvoicesFor(req.user.companyId, client);
      const encaissements = await portalEncaissementsFor(req.user.companyId, client);
      const montantFacture = round3(invoices.reduce((s: number, i: any) => s + num(Number(i.totalNetToPay), 0), 0));
      const totalEncaisse = round3(encaissements.reduce((s: number, e: any) => s + num(Number(e.amount), 0), 0));
      const soldeAnterieur = num(Number(client.soldeAnterieur), 0);

      res.json({
        client: { id: client.id, name: client.name, taxId: client.taxId || '', email: client.email || '' },
        soldeAnterieur,
        montantFacture,
        totalEncaisse,
        // Le même calcul que la page Clients du back-office, à la virgule près :
        // deux écrans qui annoncent un solde différent au client et au cabinet
        // seraient pires que pas de portail du tout.
        soldeGlobal: round3(soldeAnterieur - totalEncaisse + montantFacture),
        invoiceCount: invoices.length,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Relevé de compte : une ligne par facture ou par encaissement, dans l'ordre
   * chronologique, avec le solde qui court. Le solde antérieur ouvre le relevé
   * comme une ligne à part entière — sans elle le premier solde afficherait un
   * report sorti de nulle part.
   */
  app.get('/api/portal/statement', authenticate, async (req: any, res: any) => {
    try {
      const client = await requirePortalClient(req, res);
      if (!client) return;

      const invoices = await portalInvoicesFor(req.user.companyId, client);
      const encaissements = await portalEncaissementsFor(req.user.companyId, client);

      type StatementLine = {
        kind: 'FACTURE' | 'ENCAISSEMENT';
        date: string; label: string; reference: string;
        dueDate?: string | null; paymentMethod?: string;
        debit: number; credit: number; currency: string;
      };
      const lines: StatementLine[] = invoices.map((inv: any): StatementLine => ({
        kind: 'FACTURE',
        date: String(inv.issueDate || '').slice(0, 10),
        label: `Facture n° ${inv.number || inv.reference || '—'}`,
        reference: inv.number || inv.reference || '',
        dueDate: inv.dueDate || null,
        debit: round3(num(Number(inv.totalNetToPay), 0)),
        credit: 0,
        currency: inv.currency || 'TND',
      })).concat(encaissements.map((e: any): StatementLine => ({
        kind: 'ENCAISSEMENT',
        date: String(e.date || '').slice(0, 10),
        label: e.note || 'Règlement reçu',
        reference: e.reference || '',
        paymentMethod: e.paymentMethod || '',
        debit: 0,
        credit: round3(num(Number(e.amount), 0)),
        currency: 'TND',
      })));

      lines.sort((a, b) => String(a.date).localeCompare(String(b.date))
        // Une facture et son règlement le même jour se lisent facture d'abord :
        // l'inverse ferait passer le solde en négatif puis revenir, ce qui se
        // lit comme un trop-perçu qui n'a jamais existé.
        || (a.kind === b.kind ? 0 : a.kind === 'FACTURE' ? -1 : 1));

      const soldeAnterieur = num(Number(client.soldeAnterieur), 0);
      let running = soldeAnterieur;
      const withBalance = lines.map((l) => {
        running = round3(running + l.debit - l.credit);
        return { ...l, solde: running };
      });

      res.json({
        soldeAnterieur,
        lines: withBalance,
        soldeGlobal: running,
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * L'avancement des travaux, **sans temps ni coût**.
   *
   * Le filtrage est ici, dans la réponse, et pas dans l'interface : masquer une
   * colonne côté navigateur laisserait `dureeSeconds`, `hourlyRate` et `cost`
   * partir dans le JSON, lisibles par quiconque ouvre l'onglet réseau. Les
   * champs sont donc listés un par un — une liste blanche, pour qu'un champ
   * sensible ajouté demain à l'entrée ne se retrouve pas ici par défaut.
   */
  app.get('/api/portal/tasks', authenticate, async (req: any, res: any) => {
    try {
      const client = await requirePortalClient(req, res);
      if (!client) return;

      const users = await db.getAllUsers(req.user.companyId);
      const entries = (await db.getAllTimeEntries(req.user.companyId))
        .filter((t: any) => {
          const key = clientBucketKey(t);
          return key === String(client.id) || key === `name:${client.name}`;
        })
        // Une tâche en cours n'est pas une information que le client doit lire
        // en direct : elle apparaît une fois close, comme un travail livré.
        .filter((t: any) => t.statut === 'COMPLETED');

      res.json(entries.map((t: any) => ({
        id: t.id,
        date: t.date || '',
        libelle: t.description || t.taskType || t.pole || 'Travail',
        mission: t.pole || '',
        typeTache: t.taskType || '',
        statut: t.statut,
        responsable: users.find((u: any) => u.id === t.userId)?.fullName
          || users.find((u: any) => u.id === t.userId)?.username || '',
      })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Les livrables métier du dossier : où en est chaque modèle affecté au
   * client. On renvoie l'avancement (items résolus sur total) et le détail des
   * libellés, jamais qui a travaillé dessus ni combien de temps.
   */
  app.get('/api/portal/deliverables', authenticate, async (req: any, res: any) => {
    try {
      const client = await requirePortalClient(req, res);
      if (!client) return;

      const instances = (await db.getAllClientResourceInstances(req.user.companyId))
        .filter((i: any) => i.clientId === client.id);
      const allStatuses = await db.getAllClientResourceItemStatuses(req.user.companyId);

      res.json(instances.map((instance: any) => {
        const items = allStatuses
          .filter((s: any) => s.instanceId === instance.id)
          .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
        const done = items.filter((i: any) => i.done).length;
        return {
          id: instance.id,
          name: instance.name,
          type: instance.type,
          status: instance.status,
          createdAt: instance.createdAt,
          progress: { done, total: items.length },
          items: items.map((i: any) => ({ id: i.id, label: i.label, done: !!i.done })),
        };
      }));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET Leave Balance
  app.get('/api/hr/balance', authenticate, async (req: any, res: any) => {
    try {
      const balance = await db.getLeaveBalanceByUserId(req.user.companyId, req.user.id);
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Chat (direct messages) API Routes & SSE
  // ---------------------------------------------------------

  // Any authenticated user can message any other user in their own company —
  // this is a small internal team tool, not a permission-gated feature like
  // Clients or Cash. Connections are keyed by `${companyId}:${userId}` (not
  // bare userId — two companies' independently-minted ids can collide) so a
  // new message is only pushed to the two people involved, never broadcast
  // to everyone like the time-entries feed.
  const chatSseClients = new Map<string, Set<any>>();
  const chatKey = (companyId: string, userId: number) => `${companyId}:${userId}`;

  const sendToUser = (companyId: string, userId: number, payload: any) => {
    const conns = chatSseClients.get(chatKey(companyId, userId));
    if (!conns || conns.size === 0) return;
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of conns) res.write(frame);
  };

  // GET /api/messages/contacts — the roster to start a conversation with.
  // Deliberately open to every authenticated user (not gated on MANAGE_USERS),
  // since a collaborator needs to see who they can message.
  app.get('/api/messages/contacts', authenticate, async (req: any, res: any) => {
    try {
      const allUsers = await db.getAllUsers(req.user.companyId);
      const messages = await db.getAllMessages(req.user.companyId);
      // Un client n'a pas d'annuaire : il ne peut écrire qu'au cabinet. Sans
      // ce filtre la liste de contacts lui rendait *tous* les utilisateurs de
      // l'entreprise, y compris les autres clients — nom et rôle compris.
      const isClientViewer = req.user.role === CLIENT_ROLE;
      const contacts = allUsers
        .filter((u: any) => u.id !== req.user.id)
        .filter((u: any) => !isClientViewer || u.role !== CLIENT_ROLE)
        .map((u: any) => {
          // `!m.groupId` : un message de groupe porte bien un `fromUserId`,
          // mais pas de destinataire unique — sans ce filtre il remonterait
          // dans le fil direct de son auteur.
          const thread = messages.filter((m: any) => !m.groupId && (
            (m.fromUserId === req.user.id && m.toUserId === u.id) ||
            (m.fromUserId === u.id && m.toUserId === req.user.id)
          ));
          const last = thread[thread.length - 1];
          const unreadCount = thread.filter((m: any) => m.toUserId === req.user.id && m.fromUserId === u.id && !m.readAt).length;
          return {
            id: u.id,
            username: u.username,
            fullName: u.fullName || u.username,
            role: u.role,
            lastMessage: last ? { body: last.body, createdAt: last.createdAt, fromUserId: last.fromUserId } : null,
            unreadCount,
          };
        })
        .sort((a: any, b: any) => {
          const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
          const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
          if (ta !== tb) return tb - ta;
          return a.fullName.localeCompare(b.fullName);
        });
      res.json(contacts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Conversations de groupe
  // ---------------------------------------------------------
  //
  // Un groupe est une liste de membres et un nom ; un message de groupe porte
  // `groupId` au lieu de `toUserId`. La lecture s'y note dans `readBy` (un
  // tableau d'ids) et non dans `readAt` : un message direct a un lecteur, un
  // message de groupe en a N, et compresser les deux dans un seul horodatage
  // aurait fait passer le fil pour lu dès que le premier membre l'ouvre.
  //
  // **Les groupes sont internes au cabinet.** Un compte client n'en crée pas,
  // n'en voit aucun et ne peut y être ajouté : c'est le cas que le drapeau
  // `isInternal` sur les messages annonçait depuis le début — dans un fil à
  // plusieurs, l'appartenance au fil ne suffit plus à tenir une note interne
  // hors de portée. Refusé côté serveur, pas seulement absent de l'écran.

  /** Membres valides : de l'entreprise, jamais un compte portail, jamais deux fois. */
  const sanitizeGroupMembers = async (companyId: string, raw: any, ownerId: number) => {
    const wanted = Array.isArray(raw) ? raw : [];
    const users = await db.getAllUsers(companyId);
    const byId = new Map(users.map((u: any) => [u.id, u]));
    const ids = new Set<number>([ownerId]);
    for (const v of wanted) {
      const id = parseInt(v, 10);
      const u = byId.get(id);
      if (!u || u.role === CLIENT_ROLE) continue;
      ids.add(id);
    }
    return [...ids];
  };

  const isGroupMember = (group: any, userId: number) =>
    Array.isArray(group?.memberIds) && group.memberIds.includes(userId);

  /** La vue d'un groupe pour un membre : dernier message et non-lus compris. */
  const groupSummary = (group: any, messages: any[], usersById: Map<number, any>, meId: number) => {
    const thread = messages.filter((m: any) => String(m.groupId) === String(group.id));
    const last = thread[thread.length - 1];
    const unreadCount = thread.filter((m: any) =>
      m.fromUserId !== meId && !(Array.isArray(m.readBy) ? m.readBy : []).includes(meId)).length;
    return {
      id: group.id,
      name: group.name,
      memberIds: group.memberIds,
      members: (group.memberIds || []).map((id: number) => {
        const u = usersById.get(id);
        return { id, fullName: u?.fullName || u?.username || `#${id}`, role: u?.role || '' };
      }),
      createdBy: group.createdBy,
      lastMessage: last
        ? { body: last.body, createdAt: last.createdAt, fromUserId: last.fromUserId }
        : null,
      unreadCount,
    };
  };

  // GET /api/messages/groups — mes groupes.
  app.get('/api/messages/groups', authenticate, async (req: any, res: any) => {
    try {
      // Un client n'a pas de groupes : la liste vide, pas une erreur — l'écran
      // de messagerie lui reste ouvert pour ses échanges directs.
      if (req.user.role === CLIENT_ROLE) return res.json([]);
      const [groups, messages, users] = await Promise.all([
        db.getAllMessageGroups(req.user.companyId),
        db.getAllMessages(req.user.companyId),
        db.getAllUsers(req.user.companyId),
      ]);
      const usersById = new Map(users.map((u: any) => [u.id, u]));
      res.json(
        groups
          .filter((g: any) => isGroupMember(g, req.user.id))
          .map((g: any) => groupSummary(g, messages, usersById, req.user.id))
          .sort((a: any, b: any) => {
            const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
            const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
            if (ta !== tb) return tb - ta;
            return String(a.name).localeCompare(String(b.name));
          }),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/messages/groups — créer un groupe.
  app.post('/api/messages/groups', authenticate, async (req: any, res: any) => {
    try {
      if (req.user.role === CLIENT_ROLE) return res.status(403).json({ error: 'Réservé aux comptes du cabinet.' });
      const name = String(req.body?.name ?? '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'Le nom du groupe est requis.' });

      const memberIds = await sanitizeGroupMembers(req.user.companyId, req.body?.memberIds, req.user.id);
      if (memberIds.length < 2) {
        return res.status(400).json({ error: 'Un groupe demande au moins un autre participant.' });
      }

      const group = await db.createMessageGroup(req.user.companyId, {
        id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        memberIds,
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
      });

      const users = await db.getAllUsers(req.user.companyId);
      const usersById = new Map(users.map((u: any) => [u.id, u]));
      const summary = groupSummary(group, [], usersById, req.user.id);
      res.status(201).json(summary);
      // Les autres membres voient le groupe apparaître sans recharger.
      for (const id of memberIds) sendToUser(req.user.companyId, id, { type: 'groups' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/messages/groups/:id — renommer, ajouter ou retirer des membres.
  app.put('/api/messages/groups/:id', authenticate, async (req: any, res: any) => {
    try {
      const group = await db.getMessageGroupById(req.user.companyId, String(req.params.id));
      if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
      // N'importe quel membre peut modifier le groupe : c'est une conversation
      // d'équipe, pas la propriété de qui l'a ouverte.
      if (!isGroupMember(group, req.user.id)) return res.status(403).json({ error: 'Vous ne faites pas partie de ce groupe.' });

      const updates: any = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: 'Le nom du groupe est requis.' });
        updates.name = name;
      }
      if (req.body?.memberIds !== undefined) {
        // Le créateur reste membre : le retirer laisserait un groupe que plus
        // personne ne peut rattacher à son auteur.
        const memberIds = await sanitizeGroupMembers(req.user.companyId, req.body.memberIds, group.createdBy);
        if (memberIds.length < 2) return res.status(400).json({ error: 'Un groupe demande au moins deux participants.' });
        updates.memberIds = memberIds;
      }

      const updated = await db.updateMessageGroup(req.user.companyId, String(req.params.id), updates);
      const [messages, users] = await Promise.all([
        db.getAllMessages(req.user.companyId),
        db.getAllUsers(req.user.companyId),
      ]);
      const usersById = new Map(users.map((u: any) => [u.id, u]));
      res.json(groupSummary(updated, messages, usersById, req.user.id));
      // Les anciens membres aussi : c'est ce qui fait disparaître le groupe de
      // leur liste quand ils viennent d'en être retirés.
      for (const id of new Set([...(group.memberIds || []), ...(updated.memberIds || [])])) {
        sendToUser(req.user.companyId, id as number, { type: 'groups' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/messages/groups/:id — supprimer le groupe et ses messages.
  app.delete('/api/messages/groups/:id', authenticate, async (req: any, res: any) => {
    try {
      const group = await db.getMessageGroupById(req.user.companyId, String(req.params.id));
      if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
      // Supprimer efface la conversation pour tout le monde : réservé à qui l'a
      // créée, ou à un administrateur.
      if (group.createdBy !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Seul le créateur du groupe ou un administrateur peut le supprimer." });
      }
      await db.deleteMessageGroup(req.user.companyId, String(req.params.id));
      res.json({ success: true });
      for (const id of group.memberIds || []) sendToUser(req.user.companyId, id, { type: 'groups' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/group/:id — le fil d'un groupe, marqué lu au passage.
  app.get('/api/messages/group/:id', authenticate, async (req: any, res: any) => {
    try {
      const group = await db.getMessageGroupById(req.user.companyId, String(req.params.id));
      if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
      if (!isGroupMember(group, req.user.id)) return res.status(403).json({ error: 'Vous ne faites pas partie de ce groupe.' });

      const messages = await db.getAllMessages(req.user.companyId);
      const thread = messages
        .filter((m: any) => String(m.groupId) === String(req.params.id))
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const changed = await db.markGroupMessagesRead(req.user.companyId, String(req.params.id), req.user.id);
      if (changed > 0) {
        for (const id of group.memberIds || []) {
          if (id !== req.user.id) sendToUser(req.user.companyId, id, { type: 'groupRead', groupId: group.id, by: req.user.id });
        }
      }
      res.json(thread);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/unread-count — total across every conversation, for the sidebar badge.
  app.get('/api/messages/unread-count', authenticate, async (req: any, res: any) => {
    try {
      const messages = await db.getAllMessages(req.user.companyId);
      const direct = messages.filter((m: any) => m.toUserId === req.user.id && !m.readAt).length;
      // Les groupes comptent dans la même pastille : un badge qui ignore la
      // moitié des conversations ne veut plus rien dire. Un message de groupe
      // est lu quand mon id figure dans `readBy`.
      const groups = (await db.getAllMessageGroups(req.user.companyId))
        .filter((g: any) => isGroupMember(g, req.user.id))
        .map((g: any) => String(g.id));
      const grouped = groups.length === 0 ? 0 : messages.filter((m: any) =>
        m.groupId && groups.includes(String(m.groupId))
        && m.fromUserId !== req.user.id
        && !(Array.isArray(m.readBy) ? m.readBy : []).includes(req.user.id)).length;
      res.json({ count: direct + grouped });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/thread/:userId — the DM thread with one other user.
  // Marks their messages to me as read as a side effect, and tells their
  // live connections (if any) that I've read them.
  app.get('/api/messages/thread/:userId', authenticate, async (req: any, res: any) => {
    try {
      const otherId = parseInt(req.params.userId, 10);
      if (!Number.isFinite(otherId)) return res.status(400).json({ error: 'Invalid userId' });

      const messages = await db.getAllMessages(req.user.companyId);
      const thread = messages
        .filter((m: any) => !m.groupId)
        .filter((m: any) =>
          (m.fromUserId === req.user.id && m.toUserId === otherId) ||
          (m.fromUserId === otherId && m.toUserId === req.user.id)
        )
        // L'appartenance au fil suffit aujourd'hui à tenir les notes internes
        // hors de portée d'un client ; ce second filtre est la ceinture qui
        // survivra à un fil à plusieurs participants.
        .filter((m: any) => req.user.role !== CLIENT_ROLE || !m.isInternal)
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const changed = await db.markMessagesRead(req.user.companyId, req.user.id, otherId);
      if (changed > 0) {
        sendToUser(req.user.companyId, otherId, { type: 'read', by: req.user.id });
      }

      res.json(thread);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/messages — un message direct, ou un message de groupe si le
  // corps porte `groupId`. Une seule route pour les deux : la validation de la
  // taille, la diffusion en direct et la notification poussée sont les mêmes,
  // et les dédoubler aurait fait deux endroits à corriger.
  app.post('/api/messages', authenticate, async (req: any, res: any) => {
    try {
      const groupId = req.body?.groupId ? String(req.body.groupId) : '';
      const toUserId = parseInt(req.body?.toUserId, 10);
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!body) return res.status(400).json({ error: 'Message body is required' });
      if (body.length > 4000) return res.status(400).json({ error: 'Message too long' });

      if (groupId) {
        const group = await db.getMessageGroupById(req.user.companyId, groupId);
        if (!group) return res.status(404).json({ error: 'Groupe introuvable' });
        if (!isGroupMember(group, req.user.id)) {
          return res.status(403).json({ error: 'Vous ne faites pas partie de ce groupe.' });
        }

        const message = await db.createMessage(req.user.companyId, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fromUserId: req.user.id,
          toUserId: null,
          groupId,
          body,
          // Les groupes sont réservés aux comptes du cabinet, donc un message
          // de groupe est interne par construction — et le drapeau compte
          // vraiment ici : dans un fil à plusieurs, l'appartenance au fil ne
          // suffit plus à tenir la note hors de portée d'un client.
          isInternal: true,
          createdAt: new Date().toISOString(),
          readAt: null,
          // L'auteur a lu son propre message : sans ça il se compterait dans
          // ses propres non-lus au premier rechargement.
          readBy: [req.user.id],
        });

        res.status(201).json(message);
        for (const id of group.memberIds || []) {
          sendToUser(req.user.companyId, id, { type: 'message', message });
        }

        if (pushEnabled()) {
          (async () => {
            const targets = (group.memberIds || []).filter((id: number) => id !== req.user.id);
            if (!targets.length) return;
            const subs = (await db.getAllPushSubscriptionsForCompany(req.user.companyId))
              .filter((sub: any) => targets.includes(sub.userId));
            if (!subs.length) return;
            const sender = await db.getUserById(req.user.companyId, req.user.id);
            const senderName = sender?.fullName || sender?.username || 'Collaborateur';
            const payload = {
              title: `${group.name} — ${senderName}`,
              body: body.length > 120 ? body.slice(0, 117) + '…' : body,
              nav: 'Messages',
              // Une étiquette par groupe, comme `msg-<id>` pour un fil direct :
              // les messages d'un même groupe se remplacent au lieu de s'empiler.
              tag: `grp-${groupId}`,
            };
            for (const sub of subs) {
              const { expired } = await sendPush(sub, payload);
              if (expired) await db.deletePushSubscriptionByEndpoint(sub.endpoint);
            }
          })().catch((error) => console.error('[push] group fan-out failed:', error));
        }
        return;
      }

      if (!Number.isFinite(toUserId)) return res.status(400).json({ error: 'toUserId is required' });

      const recipient = await db.getUserById(req.user.companyId, toUserId);
      if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

      const message = await db.createMessage(req.user.companyId, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromUserId: req.user.id,
        toUserId,
        body,
        // Note interne au cabinet : jamais servie à un compte client (voir le
        // filtre du fil). Dans le modèle actuel — des messages directs à deux
        // — un échange entre collaborateurs est déjà hors de portée d'un
        // client, qui n'en est pas participant ; le drapeau est là pour que la
        // règle tienne encore le jour où un fil accueillera plusieurs
        // personnes, cas où l'appartenance au fil ne suffirait plus.
        isInternal: req.user.role !== CLIENT_ROLE && recipient.role !== CLIENT_ROLE ? true : false,
        createdAt: new Date().toISOString(),
        readAt: null,
      });

      res.status(201).json(message);
      sendToUser(req.user.companyId, toUserId, { type: 'message', message });
      sendToUser(req.user.companyId, req.user.id, { type: 'message', message });

      // Pushed straight from here rather than through notify(): a message
      // must not become a notification row — the bell derives its message
      // counts from the thread's own readAt, and a row per message would be
      // a second "is this read" record to keep in sync with it. Tag matches
      // the bell's own `msg-<senderId>` so the app-open and app-closed paths
      // collapse into one OS notification instead of stacking two.
      if (pushEnabled()) {
        (async () => {
          const subs = (await db.getAllPushSubscriptionsForCompany(req.user.companyId)).filter((s: any) => s.userId === toUserId);
          if (!subs.length) return;
          const sender = await db.getUserById(req.user.companyId, req.user.id);
          const senderName = sender?.fullName || sender?.username || 'Collaborateur';
          const payload = {
            title: `Nouveau message — ${senderName}`,
            body: body.length > 120 ? body.slice(0, 117) + '…' : body,
            nav: 'Messages',
            tag: `msg-${req.user.id}`,
          };
          for (const sub of subs) {
            const { expired } = await sendPush(sub, payload);
            if (expired) await db.deletePushSubscriptionByEndpoint(sub.endpoint);
          }
        })().catch((error) => console.error('[push] message fan-out failed:', error));
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/messages/stream — SSE. Pushes new messages and read receipts
  // that involve this user. Token comes from the query string, same reason
  // as the time-entries stream: EventSource can't set an Authorization header.
  app.get('/api/messages/stream', authenticate, (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const key = chatKey(req.user.companyId, req.user.id);
    if (!chatSseClients.has(key)) chatSseClients.set(key, new Set());
    chatSseClients.get(key)!.add(res);

    req.on('close', () => {
      const conns = chatSseClients.get(key);
      if (conns) {
        conns.delete(res);
        if (conns.size === 0) chatSseClients.delete(key);
      }
    });
  });

  // ---------------------------------------------------------
  // Time Tracking API Routes & SSE
  // ---------------------------------------------------------

  const sseClients = new Set<any>();

  /**
   * Adds the live elapsed time, the owner's name, and the cost of the task.
   *
   * The rate is the one **snapshotted on the entry when it was created**, never
   * the collaborator's current rate: raising a salary must not retroactively
   * re-price work already logged at the old salary.
   *
   * Cost is employer-confidential, so `hourlyRate`/`cost` are only included for
   * admins — stripping them in the UI alone would still leak them over the wire.
   */
  /**
   * An admin's own tasks are not shown to anybody else — they are management
   * work, not part of the team's shared activity feed.
   *
   * Enforced here rather than hidden in the UI, so the rows never reach a
   * non-admin client over the wire, and applied *before* pagination so the
   * page size and the `total` count both describe what the viewer can see.
   */
  const visibleEntriesFor = (entries: any[], viewerIsAdmin: boolean, adminIds: Set<number>) =>
    viewerIsAdmin ? entries : entries.filter((e: any) => !adminIds.has(e.userId));

  const adminUserIds = async (companyId: string) =>
    new Set<number>(
      (await db.getAllUsers(companyId)).filter((u: any) => u.role === 'ADMIN').map((u: any) => u.id),
    );

  const enrichEntries = async (companyId: string, entries: any[], forAdmin: boolean) => {
    const users = await db.getAllUsers(companyId);
    // Indexed once: a find() in here is a linear scan per task.
    const usersById = new Map<number, any>(users.map((u: any) => [u.id, u]));
    return entries.map((e: any) => {
      const secs = accruedSeconds(e);
      const base = {
        ...e,
        dureeSeconds: secs,
        userName: usersById.get(e.userId)?.username || 'Unknown',
        // Resolved off the same map as userName rather than with a second
        // lookup per row — the scale rules forbid a find() inside this loop.
        lastEditedByName: e.lastEditedBy ? (usersById.get(e.lastEditedBy)?.username || 'Unknown') : undefined,
      };
      if (!forAdmin) {
        delete base.hourlyRate;
        return base;
      }
      // null => no employer cost was configured for this person at the time
      const rate = typeof e.hourlyRate === 'number' ? e.hourlyRate : null;
      return { ...base, hourlyRate: rate, cost: rate === null ? null : (secs / 3600) * rate };
    });
  };

  /**
   * How many entries a client holds at once. Entries are stored newest-first,
   * and the UI is a recent-activity view, so a page of this size covers what is
   * on screen. Without a cap, every mutation would push the entire history to
   * every connected user — at dozens of users and thousands of entries that is
   * the single most expensive thing the server does.
   */
  const ENTRIES_PAGE_SIZE = 200;

  const doBroadcast = async () => {
    // Grouped by company so each company's data is fetched and its frames
    // built once — not once per subscriber, and never sent across a tenant
    // boundary. Within a company: two payloads only, admins get the cost
    // fields and every row, everyone else gets neither.
    const companyIds = new Set<string>();
    for (const c of sseClients) companyIds.add(c.companyId);

    for (const companyId of companyIds) {
      const raw = await db.getAllTimeEntries(companyId);
      const adminIds = await adminUserIds(companyId);
      const cache: Record<string, string> = {};
      for (const client of sseClients) {
        if (client.companyId !== companyId) continue;
        const key = client.isAdmin ? 'admin' : 'plain';
        if (!cache[key]) {
          const visible = visibleEntriesFor(raw, client.isAdmin, adminIds);
          const data = await enrichEntries(companyId, visible.slice(0, ENTRIES_PAGE_SIZE), client.isAdmin);
          cache[key] = `data: ${JSON.stringify({ data, total: visible.length })}\n\n`;
        }
        client.res.write(cache[key]);
      }
    }
  };

  // Coalesce bursts (pausing one task starts another, a save touches several
  // rows) into a single push instead of one per mutation.
  let broadcastTimer: NodeJS.Timeout | null = null;
  const broadcastTimeEntries = () => {
    if (broadcastTimer || sseClients.size === 0) return;
    broadcastTimer = setTimeout(async () => {
      broadcastTimer = null;
      try {
        await doBroadcast();
      } catch (e) {
        console.error('Error broadcasting time entries', e);
      }
    }, 120);
  };

  app.get('/api/time-entries/stream', authenticate, (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE

    const client = { res, isAdmin: req.user.role === 'ADMIN', companyId: req.user.companyId };
    sseClients.add(client);
    // Send this client its first frame immediately rather than waiting on the
    // coalescing timer.
    doBroadcast().catch(e => console.error('Error sending initial SSE frame', e));

    req.on('close', () => {
      sseClients.delete(client);
    });
  });

  /**
   * Pauses every other RUNNING entry belonging to `userId`, folding the elapsed
   * time into each one. Keeps the "at most one running task per person"
   * invariant no matter who triggered the change.
   */
  const pauseOtherRunningEntries = async (companyId: string, userId: number, keepId: string) => {
    const all = await db.getAllTimeEntries(companyId);
    for (const other of all) {
      if (other.userId !== userId || other.id === keepId || other.statut !== 'RUNNING') continue;
      const elapsed = other.lastStartedAt
        ? Math.floor((Date.now() - other.lastStartedAt) / 1000)
        : 0;
      await db.updateTimeEntry(companyId, other.id, {
        statut: 'PAUSED',
        dureeSeconds: (other.dureeSeconds || 0) + elapsed,
        lastStartedAt: null,
        heureFin: '',
      });
    }
  };

  app.get('/api/time-entries', authenticate, async (req: any, res: any) => {
    try {
      const isAdmin = req.user.role === 'ADMIN';
      const all = visibleEntriesFor(await db.getAllTimeEntries(req.user.companyId), isAdmin, await adminUserIds(req.user.companyId));
      const limit = Math.min(parseInt(req.query.limit, 10) || ENTRIES_PAGE_SIZE, 1000);
      const offset = parseInt(req.query.offset, 10) || 0;
      const data = await enrichEntries(req.user.companyId, all.slice(offset, offset + limit), isAdmin);
      res.json({ data, total: all.length, limit, offset });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * The caller's own current task — the RUNNING one, or failing that their
   * most recent PAUSED one so it can be resumed. Exists for the floating
   * chronometer, which is mounted on every page: the SSE stream only runs
   * while Pointage is open (it pushes a whole page of every user's entries,
   * far too much to hold open everywhere), so the widget polls this instead.
   * One row, own rows only — bounded no matter how large the history is.
   */
  app.get('/api/time-entries/active', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllTimeEntries(req.user.companyId))
        .filter((e: any) => e.userId === req.user.id);
      // Newest-first ordering is load-bearing here: createTimeEntry prepends,
      // so the first PAUSED row is the most recent one.
      const entry = mine.find((e: any) => e.statut === 'RUNNING')
        || mine.find((e: any) => e.statut === 'PAUSED');
      if (!entry) return res.json({ entry: null });
      const [enriched] = await enrichEntries(req.user.companyId, [entry], req.user.role === 'ADMIN');
      res.json({ entry: enriched });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Web Push — how an ordinary notification (task assigned, a leave
  // decision, a new message) reaches a device with the browser closed.
  //
  // The running chronometer used to be delivered here too: a 15-minute sweep
  // redrawing an ongoing notification with Pause / Arrêter on every device
  // whose owner had a task running, plus an unauthenticated
  // POST /api/push/timer-action for those buttons. All of it was removed at
  // the user's request — the app no longer puts the timer in front of
  // someone who has left the browser. The chronometer lives in the app: the
  // floating card on every page, and Pointage.
  // ---------------------------------------------------------

  /** Readable by any authenticated user: the browser needs it to subscribe. */
  app.get('/api/push/public-key', authenticate, (_req: any, res: any) => {
    res.json({ key: pushEnabled() ? pushPublicKey() : null });
  });

  app.post('/api/push/subscribe', authenticate, async (req: any, res: any) => {
    try {
      const { endpoint, keys } = req.body || {};
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Abonnement invalide' });
      }
      await db.createPushSubscription(req.user.companyId, {
        id: genId('push'),
        userId: req.user.id,
        endpoint: String(endpoint),
        keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
        createdAt: new Date().toISOString(),
      });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/push/unsubscribe', authenticate, async (req: any, res: any) => {
    try {
      await db.deletePushSubscriptionByEndpoint(String(req.body?.endpoint || ''));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * The one place a time entry is actually created — used by the normal
   * "démarrer une tâche" POST below and by starting an assigned task, so the
   * historical-rate snapshot, server-owned timestamps and the one-running-
   * task-per-person rule can't drift between the two paths.
   *
   * The caller supplies an id so it can insert optimistically, but it is never
   * *required*: a body without one used to be stored as a row with
   * `id: undefined`, which no route could then update or delete and which
   * broke React's keys in the table.
   */
  /**
   * Which kind of device a request came from — recorded on a time entry so
   * the team can see that a task was started or changed from a phone rather
   * than at a desk.
   *
   * `Sec-CH-UA-Mobile` is the browser telling us directly and is preferred
   * where it exists (Chromium, so most Android phones); the User-Agent regex
   * is the fallback that covers Safari/iOS and Firefox. Both are self-reported
   * by the browser and trivially spoofable — this is a convenience for
   * reading the timesheet, never evidence, and nothing is gated on it.
   */
  const deviceFromRequest = (req: any): 'MOBILE' | 'DESKTOP' => {
    const hint = String(req.headers?.['sec-ch-ua-mobile'] || '');
    if (hint === '?1') return 'MOBILE';
    if (hint === '?0') return 'DESKTOP';
    const ua = String(req.headers?.['user-agent'] || '');
    return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|Silk/i.test(ua) ? 'MOBILE' : 'DESKTOP';
  };

  const createRunningEntryForUser = async (companyId: string, userId: number, fields: any, via?: 'MOBILE' | 'DESKTOP') => {
    const userFull = await db.getUserById(companyId, userId);
    /**
     * Facturable ou non — figé ici, à la création, comme `pole` et
     * `hourlyRate` le sont déjà. Cocher « non facturable » sur un client plus
     * tard ne doit pas requalifier rétroactivement le travail déjà pointé, ni
     * le décocher rendre facturable ce qui ne l'était pas.
     */
    let facturable = true;
    if (fields.clientId != null) {
      const client = await db.getClientById(companyId, Number(fields.clientId));
      if (client?.nonFacturable) facturable = false;
    }
    const settings = await db.getSettings(companyId) || {};
    // Snapshot the author's employer cost. Reads resolve it live as well, so
    // this is only a record of the rate in force when the task was created.
    const hourlyRate = employerHourlyRate(userFull, settings);

    // Stamp date / heureDebut server-side so the recorded start time can't
    // drift from the client clock or locale. heureFin stays empty until the
    // task is actually completed.
    const now = new Date();
    const id = fields.id || `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const statut = fields.statut ?? 'RUNNING';
    if (statut === 'RUNNING') {
      await pauseOtherRunningEntries(companyId, userId, id);
    }
    return db.createTimeEntry(companyId, {
      ...fields,
      id,
      statut,
      date: formatDateFR(now),
      heureDebut: formatTimeFR(now),
      heureFin: '',
      userId,
      hourlyRate,
      lastStartedAt: Date.now(),
      facturable,
      // The device the task was started from. Never rewritten afterwards —
      // editing a task from a laptop doesn't change where it was started.
      ...(via ? { createdVia: via } : {}),
    });
  };

  app.post('/api/time-entries', authenticate, async (req: any, res: any) => {
    try {
      const entry = await createRunningEntryForUser(req.user.companyId, req.user.id, req.body, deviceFromRequest(req));
      res.json(entry);
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/time-entries/:id', authenticate, async (req: any, res: any) => {
    try {
      const entryId = req.params.id;
      const existing = await db.getTimeEntryById(req.user.companyId, entryId);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const perms = JSON.parse(req.user.permissions || '[]');
      if (existing.userId !== req.user.id && req.user.role !== 'ADMIN' && !perms.includes('MODIFY')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      let updates = { ...req.body };

      // Only a body that actually carries `statut` is a status transition.
      // Without this guard the `else if` below fired on *any* PUT that
      // omitted it — folding the elapsed time in and nulling `lastStartedAt`
      // on a task that stays RUNNING, which freezes its clock. Nothing hit it
      // while every caller happened to send the whole entry back, but
      // updating one field of a running task is a reasonable thing to do.
      const isStatusChange = req.body.statut !== undefined;

      if (isStatusChange && req.body.statut === 'RUNNING' && existing.statut !== 'RUNNING') {
         updates.lastStartedAt = Date.now();
         // Back in progress: an end time would be misleading.
         if (updates.heureFin === undefined) updates.heureFin = '';
      } else if (isStatusChange && req.body.statut !== 'RUNNING' && existing.statut === 'RUNNING') {
         // Stopping or pausing
         if (existing.lastStartedAt) {
            const added = Math.floor((Date.now() - existing.lastStartedAt) / 1000);
            updates.dureeSeconds = (existing.dureeSeconds || 0) + added;
         }
         updates.lastStartedAt = null;
      }

      // Only a completed task has an end time, and the server stamps it.
      if (req.body.statut === 'COMPLETED' && existing.statut !== 'COMPLETED' && !req.body.heureFin) {
         updates.heureFin = formatTimeFR(new Date());
      } else if (req.body.statut === 'PAUSED') {
         if (updates.heureFin === undefined) updates.heureFin = '';
      }

      // One running task per person. Resuming a task (including an admin
      // resuming someone else's) pauses whatever else that person had running.
      if (req.body.statut === 'RUNNING' && existing.statut !== 'RUNNING') {
        await pauseOtherRunningEntries(req.user.companyId, existing.userId, entryId);
      }

      // Who last touched this task, from what kind of device, and when.
      // `lastEditedBy` matters as much as the device: an admin pausing
      // someone else's task from a laptop must not read as that collaborator
      // having done it themselves.
      //
      // A write that only carries `overtimeAckCycle` is skipped — that is the
      // 2h popup recording itself, not somebody editing the task, and letting
      // it through would mark a task "modified" that nobody touched.
      const bodyKeys = Object.keys(req.body);
      const isSilentWrite = bodyKeys.length > 0 && bodyKeys.every(k => k === 'overtimeAckCycle' || k === 'id');
      if (!isSilentWrite) {
        updates.lastEditedVia = deviceFromRequest(req);
        updates.lastEditedBy = req.user.id;
        updates.lastEditedAt = new Date().toISOString();
      }

      const updated = await db.updateTimeEntry(req.user.companyId, entryId, updates);
      // GET /api/time-entries and the SSE broadcast both fold the live elapsed
      // stretch into `dureeSeconds` before responding — this is the one PUT
      // response that didn't. A write carrying only `overtimeAckCycle` (the 2h
      // popup recording itself, task still RUNNING) returned the raw, un-folded
      // DB value, and the client applies this response straight onto its
      // ticking local state — silently rewinding the on-screen duration back
      // to whatever it was at the last pause/resume, sometimes 0. `accruedSeconds`
      // is a no-op here for a task that just left RUNNING (already folded) or
      // just entered it (`lastStartedAt` is now ~`Date.now()`), so this only
      // changes the value for a still-RUNNING task, which is exactly the case
      // that was wrong.
      res.json({ ...updated, dureeSeconds: accruedSeconds(updated) });
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/time-entries/:id', authenticate, async (req: any, res: any) => {
    try {
      const entryId = req.params.id;
      const existing = await db.getTimeEntryById(req.user.companyId, entryId);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const perms = JSON.parse(req.user.permissions || '[]');
      if (existing.userId !== req.user.id && req.user.role !== 'ADMIN' && !perms.includes('DELETE')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await db.deleteTimeEntry(req.user.companyId, entryId);
      res.json({ success: true });
      broadcastTimeEntries(); // Broadcast update
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Notifications — new message, task assigned, HR requests/decisions.
  // ---------------------------------------------------------

  /**
   * Where clicking a pushed notification lands. Mirrors TYPE_META in
   * NotificationBell.tsx — the service worker has no access to that map, so
   * the destination has to travel inside the push payload itself.
   */
  const PUSH_NAV_FOR_TYPE: Record<string, string> = {
    TASK_ASSIGNED: 'Dashboard',
    TASK_REMINDER: 'Dashboard',
    LEAVE_REQUEST: 'HR',
    LEAVE_DECISION: 'HR',
    ABSENCE_REQUEST: 'HR',
    ABSENCE_DECISION: 'HR',
    LOAN_REQUEST: 'HR',
    LOAN_DECISION: 'HR',
    ADVANCE_REQUEST: 'HR',
    ADVANCE_DECISION: 'HR',
  };

  /**
   * The one place a notification is created. `type` picks where the bell
   * sends the user when they click it (see NOTIFICATION_LINK in the client).
   *
   * A `function` declaration, not a `const` arrow — it needs to be callable
   * from the HR routes above, which are defined earlier in this same
   * function body but registered before this point runs. Declarations are
   * hoisted through the whole scope; a `const` would not be.
   */
  async function notify(companyId: string, userId: number, type: string, title: string, body: string) {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.createNotification(companyId, { id, userId, type, title, body, readAt: null, createdAt: new Date().toISOString() });

    // Reaches a closed browser the same way the chronometer does — this is a
    // second, independent use of that same push infrastructure (subscribe/
    // sendPush/pushEnabled), not a competing one: one device subscription
    // already receives both kinds of push.
    //
    // Deliberately not awaited: the notification row is already durable and
    // the bell shows it either way, so a slow round-trip to the push service
    // must not sit in front of the HTTP response of whoever triggered this
    // (an approver clicking "Approuver" would otherwise wait on it).
    if (pushEnabled()) {
      (async () => {
        const subs = (await db.getAllPushSubscriptionsForCompany(companyId)).filter((s: any) => s.userId === userId);
        for (const sub of subs) {
          // Tag matches the one NotificationBell.tsx builds for this same row
          // — `notif-${n.id}`, and `id` here already starts with `notif-`
          // (see the id generated just above), so this is genuinely
          // `notif-notif-…`, not a typo. With the app open, the client's own
          // poll already draws this; the identical tag is what makes the two
          // collapse into one notification instead of stacking two.
          const { expired } = await sendPush(sub, { title, body, nav: PUSH_NAV_FOR_TYPE[type] || 'Dashboard', tag: `notif-${id}` });
          if (expired) await db.deletePushSubscriptionByEndpoint(sub.endpoint);
        }
      })().catch((error) => console.error('[push] notify() fan-out failed:', error));
    }
  }

  const NOTIFICATIONS_PAGE_SIZE = 50;

  app.get('/api/notifications', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllNotifications(req.user.companyId)).filter((n: any) => n.userId === req.user.id);
      const unreadCount = mine.filter((n: any) => !n.readAt).length;
      res.json({ items: mine.slice(0, NOTIFICATIONS_PAGE_SIZE), unreadCount });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/notifications/:id/read', authenticate, async (req: any, res: any) => {
    try {
      const existing = await db.getAllNotifications(req.user.companyId);
      const n = existing.find((x: any) => x.id === req.params.id);
      // Not found *or belongs to someone else* both read as 404 — a
      // notification id must never let one user probe another's inbox.
      if (!n || n.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
      const updated = await db.updateNotification(req.user.companyId, req.params.id, { readAt: n.readAt || new Date().toISOString() });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/notifications/read-all', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllNotifications(req.user.companyId)).filter((n: any) => n.userId === req.user.id && !n.readAt);
      const now = new Date().toISOString();
      await Promise.allSettled(mine.map((n: any) => db.updateNotification(req.user.companyId, n.id, { readAt: now })));
      res.json({ updated: mine.length });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Task assignments — admin hands a mission + type de tâche to a staff
  // member; it shows on their dashboard until started, then it is an
  // ordinary running time entry like any other.
  // ---------------------------------------------------------

  /** Staff an assignment can target — the picker in the assign-task dialog. */
  app.get('/api/users/assignable', authenticate, requirePermission('ASSIGN_TASKS'), async (req: any, res: any) => {
    try {
      const users = await db.getAllUsers(req.user.companyId);
      res.json(
        users
          .filter((u: any) => STAFF_ROLES.includes(u.role))
          .map((u: any) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      );
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Two distinct uses share this route: an admin/ASSIGN_TASKS holder handing
   * work to someone else, and "Planifier une tâche" — any user planning work
   * for themselves. Only the first needs the permission check, so it is done
   * inline here rather than in a blanket `requirePermission` middleware,
   * which would also block a plain user from planning their own tasks.
   */
  app.post('/api/task-assignments', authenticate, async (req: any, res: any) => {
    try {
      const { assignedToUserId, client, clientId, pole, serviceId, taskType, taskTypeId, description, scheduledDate, priority, reminderAt } = req.body;
      const targetId = Number(assignedToUserId);
      if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'assignedToUserId requis' });
      if (!String(pole || '').trim()) return res.status(400).json({ error: 'La mission est requise' });

      if (targetId !== req.user.id) {
        const requester = await db.getUserById(req.user.companyId, req.user.id);
        const canAssign = requester?.role === 'ADMIN' || JSON.parse(requester?.permissions || '[]').includes('ASSIGN_TASKS');
        if (!canAssign) return res.status(403).json({ error: 'Forbidden: Missing permission ASSIGN_TASKS' });
      }

      const target = await db.getUserById(req.user.companyId, targetId);
      if (!target) return res.status(404).json({ error: 'Collaborateur introuvable' });

      const PRIORITIES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'];
      const assigner = await db.getUserById(req.user.companyId, req.user.id);
      const isSelfPlanned = targetId === req.user.id;
      const assignment = await db.createTaskAssignment(req.user.companyId, {
        id: `assign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        assignedToUserId: targetId,
        assignedByUserId: req.user.id,
        assignedByName: assigner?.fullName || assigner?.username || 'Admin',
        client: client || '',
        clientId: clientId != null ? Number(clientId) : null,
        pole: String(pole).trim(),
        serviceId: serviceId != null ? Number(serviceId) : null,
        taskType: taskType || '',
        taskTypeId: taskTypeId != null ? Number(taskTypeId) : null,
        description: description || '',
        status: 'PENDING',
        timeEntryId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        scheduledDate: scheduledDate ? String(scheduledDate).slice(0, 10) : null,
        priority: PRIORITIES.includes(priority) ? priority : 'NORMALE',
        reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null,
        reminderFired: false,
      });

      if (!isSelfPlanned) {
        await notify(
          req.user.companyId,
          targetId,
          'TASK_ASSIGNED',
          'Nouvelle tâche assignée',
          `${assignment.assignedByName} vous a assigné « ${assignment.pole}${assignment.taskType ? ' · ' + assignment.taskType : ''} »` +
            (assignment.client ? ` pour ${assignment.client}` : ''),
        );
      }

      res.status(201).json(assignment);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Pending assignments for the logged-in user — the dashboard widget.
   *
   * Also where a "rappel" actually fires: there is no cron job in this app
   * (see presence/trial-expiry for the same idiom), so a due reminder is
   * lazily turned into a real notification the next time this endpoint is
   * hit — which is every time the dashboard housing AssignedTasksCard loads.
   * `reminderFired` keeps it from notifying twice.
   */
  app.get('/api/task-assignments/mine', authenticate, async (req: any, res: any) => {
    try {
      const mine = (await db.getAllTaskAssignments(req.user.companyId))
        .filter((a: any) => a.assignedToUserId === req.user.id && a.status === 'PENDING');

      const now = Date.now();
      for (const a of mine) {
        if (a.reminderAt && !a.reminderFired && new Date(a.reminderAt).getTime() <= now) {
          await db.updateTaskAssignment(req.user.companyId, a.id, { reminderFired: true });
          a.reminderFired = true;
          await notify(
            req.user.companyId,
            req.user.id,
            'TASK_REMINDER',
            'Rappel de tâche planifiée',
            `« ${a.pole}${a.taskType ? ' · ' + a.taskType : ''} »${a.client ? ` pour ${a.client}` : ''}`,
          );
        }
      }

      mine.sort((x: any, y: any) => {
        if (!x.scheduledDate && !y.scheduledDate) return 0;
        if (!x.scheduledDate) return 1;
        if (!y.scheduledDate) return -1;
        return x.scheduledDate.localeCompare(y.scheduledDate);
      });

      res.json(mine);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * The assignee starts it: this becomes exactly the same thing as clicking
   * "Démarrer" on a manually-created task, through the same helper — so it
   * obeys the one-running-task-per-person rule and appears in Pointage the
   * instant that page fetches, no special casing anywhere else in the app.
   */
  app.put('/api/task-assignments/:id/start', authenticate, async (req: any, res: any) => {
    try {
      const assignment = await db.getTaskAssignmentById(req.user.companyId, req.params.id);
      if (!assignment) return res.status(404).json({ error: 'Not found' });
      if (assignment.assignedToUserId !== req.user.id) {
        return res.status(403).json({ error: 'Cette tâche ne vous est pas assignée' });
      }
      if (assignment.status !== 'PENDING') {
        return res.status(409).json({ error: 'Cette tâche a déjà été démarrée ou annulée' });
      }

      const entry = await createRunningEntryForUser(req.user.companyId, req.user.id, {
        client: assignment.client,
        clientId: assignment.clientId,
        pole: assignment.pole,
        serviceId: assignment.serviceId,
        taskType: assignment.taskType,
        taskTypeId: assignment.taskTypeId,
        description: assignment.description,
        statut: 'RUNNING',
      }, deviceFromRequest(req));

      const updated = await db.updateTaskAssignment(req.user.companyId, assignment.id, {
        status: 'STARTED',
        timeEntryId: entry.id,
        startedAt: new Date().toISOString(),
      });

      res.json({ assignment: updated, entry });
      broadcastTimeEntries();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Cancels a pending assignment. A started one is real history — left alone.
   * The owner of a self-planned task ("Planifier une tâche") may cancel it
   * without ASSIGN_TASKS, same reasoning as the create route above; cancelling
   * someone else's assignment still requires the permission.
   */
  app.delete('/api/task-assignments/:id', authenticate, async (req: any, res: any) => {
    try {
      const assignment = await db.getTaskAssignmentById(req.user.companyId, req.params.id);
      if (!assignment) return res.status(404).json({ error: 'Not found' });
      if (assignment.status !== 'PENDING') {
        return res.status(400).json({ error: 'Seule une tâche en attente peut être annulée' });
      }
      if (assignment.assignedToUserId !== req.user.id) {
        const requester = await db.getUserById(req.user.companyId, req.user.id);
        const canAssign = requester?.role === 'ADMIN' || JSON.parse(requester?.permissions || '[]').includes('ASSIGN_TASKS');
        if (!canAssign) return res.status(403).json({ error: 'Forbidden: Missing permission ASSIGN_TASKS' });
      }
      await db.deleteTaskAssignment(req.user.companyId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Ressources Métier — documents à fournir, procédures, liens utiles et
  // échéances. Documents and procédures share one generic template/instance
  // engine (differentiated by `type`); links and deadlines are simpler,
  // separate models, per the cahier des charges.
  // ---------------------------------------------------------

  const genId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // --- Resource templates (documents à fournir / procédures) ---

  app.get('/api/resource-templates', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      let templates = await db.getAllResourceTemplates(req.user.companyId);
      if (req.query.type) templates = templates.filter((t: any) => t.type === req.query.type);
      res.json([...templates].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/resource-template-items', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      res.json(await db.getAllResourceTemplateItems(req.user.companyId));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/resource-templates', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { type, name, sector, isSequential } = req.body;
      if (!['document_checklist', 'procedure'].includes(type)) {
        return res.status(400).json({ error: 'Type de ressource invalide' });
      }
      if (!String(name || '').trim()) return res.status(400).json({ error: 'Le titre est requis' });
      const template = await db.createResourceTemplate(req.user.companyId, {
        id: genId('tpl'),
        type,
        name: String(name).trim(),
        sector: sector ? String(sector).trim() : null,
        isSequential: !!isSequential,
        isActive: true,
        isSystem: false,
        sourceSystemTemplateId: null,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/resource-templates/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const template = await db.getResourceTemplateById(req.user.companyId, req.params.id);
      if (!template) return res.status(404).json({ error: 'Not found' });
      const { name, sector, isSequential, isActive } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (sector !== undefined) updates.sector = sector ? String(sector).trim() : null;
      if (isSequential !== undefined) updates.isSequential = !!isSequential;
      if (isActive !== undefined) updates.isActive = !!isActive;
      const updated = await db.updateResourceTemplate(req.user.companyId, req.params.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/resource-templates/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const template = await db.getResourceTemplateById(req.user.companyId, req.params.id);
      if (!template) return res.status(404).json({ error: 'Not found' });
      await db.deleteResourceTemplate(req.user.companyId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/resource-template-items', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { templateId, label } = req.body;
      const template = await db.getResourceTemplateById(req.user.companyId, templateId);
      if (!template) return res.status(404).json({ error: 'Modèle introuvable' });
      if (!String(label || '').trim()) return res.status(400).json({ error: 'Le libellé est requis' });
      const existing = (await db.getAllResourceTemplateItems(req.user.companyId)).filter((i: any) => i.templateId === templateId);
      const item = await db.createResourceTemplateItem(req.user.companyId, {
        id: genId('tplitem'),
        templateId,
        label: String(label).trim(),
        sortOrder: existing.length,
      });
      res.status(201).json(item);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/resource-template-items/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { label, sortOrder } = req.body;
      const updates: any = {};
      if (label !== undefined) updates.label = String(label).trim();
      if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder);
      const updated = await db.updateResourceTemplateItem(req.user.companyId, req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/resource-template-items/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteResourceTemplateItem(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Client resource instances (assignment + suivi) ---

  /** §4.1 — affecte un modèle à un client. Frozen copy per §3.5. */
  app.post('/api/client-resources', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const { clientId, templateId, assignedTo } = req.body;
      if (clientId == null) return res.status(400).json({ error: 'Client requis' });
      const template = await db.getResourceTemplateById(req.user.companyId, templateId);
      if (!template) return res.status(404).json({ error: 'Modèle introuvable' });
      const client = await db.getClientById(req.user.companyId, Number(clientId));
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const instance = await db.createClientResourceInstance(req.user.companyId, {
        id: genId('inst'),
        clientId: Number(clientId),
        sourceTemplateId: template.id,
        name: template.name,
        type: template.type,
        isSequential: template.isSequential,
        status: 'en_cours',
        assignedTo: assignedTo != null ? Number(assignedTo) : null,
        createdAt: new Date().toISOString(),
        createdBy: req.user.id,
      });

      const items = (await db.getAllResourceTemplateItems(req.user.companyId))
        .filter((i: any) => i.templateId === template.id)
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
      for (const item of items) {
        await db.createClientResourceItemStatus(req.user.companyId, {
          id: genId('itemstatus'),
          instanceId: instance.id,
          sourceItemId: item.id,
          label: item.label,
          sortOrder: item.sortOrder,
          done: false,
          completedAt: null,
          completedBy: null,
        });
      }

      res.status(201).json(instance);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Instances for one client, with their item statuses — the "Suivi & Ressources" tab. */
  app.get('/api/client-resources', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const clientId = req.query.clientId != null ? Number(req.query.clientId) : null;
      if (clientId == null) return res.status(400).json({ error: 'clientId requis' });
      const instances = (await db.getAllClientResourceInstances(req.user.companyId)).filter((i: any) => i.clientId === clientId);
      const allStatuses = await db.getAllClientResourceItemStatuses(req.user.companyId);
      res.json(instances.map((instance: any) => ({
        ...instance,
        items: allStatuses
          .filter((s: any) => s.instanceId === instance.id)
          .sort((a: any, b: any) => a.sortOrder - b.sortOrder),
      })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/client-resources/:id', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteClientResourceInstance(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §4.2 — met à jour le statut d'un item. Quand l'instance est séquentielle,
   * un item ne peut passer à "terminé"/"non applicable" que si tous les items
   * qui le précèdent (sortOrder inférieur) sont déjà résolus.
   */
  app.put('/api/client-resource-items/:id', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const { done } = req.body;
      if (typeof done !== 'boolean') return res.status(400).json({ error: 'Statut invalide' });
      const allStatuses = await db.getAllClientResourceItemStatuses(req.user.companyId);
      const item = allStatuses.find((s: any) => s.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });

      if (done) {
        const instance = await db.getClientResourceInstanceById(req.user.companyId, item.instanceId);
        if (instance?.isSequential) {
          const blocked = allStatuses.some((s: any) =>
            s.instanceId === item.instanceId && s.sortOrder < item.sortOrder && !s.done,
          );
          if (blocked) return res.status(409).json({ error: 'Les étapes précédentes doivent être résolues d\'abord.' });
        }
      }

      const updated = await db.updateClientResourceItemStatus(req.user.companyId, req.params.id, {
        done,
        completedAt: done ? new Date().toISOString() : null,
        completedBy: done ? req.user.id : null,
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Admin-dashboard summary — per-client progress on documents/procédures,
   * separate from Pointage. Aggregates only (resolved/total counts), never
   * the item lists themselves, same "nothing unbounded crosses the wire"
   * rule the KPI dashboard already follows. Same team-viewer gate as the
   * échéances portfolio.
   */
  app.get('/api/resources/portfolio', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      if (!DASHBOARD_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const [instances, statuses, clients] = await Promise.all([
        db.getAllClientResourceInstances(req.user.companyId), db.getAllClientResourceItemStatuses(req.user.companyId), db.getAllClients(req.user.companyId),
      ]);
      const clientsById = new Map(clients.map((c: any) => [c.id, c]));
      const statusesByInstance = new Map<string, any[]>();
      for (const s of statuses) {
        if (!statusesByInstance.has(s.instanceId)) statusesByInstance.set(s.instanceId, []);
        statusesByInstance.get(s.instanceId)!.push(s);
      }
      res.json(instances.map((i: any) => {
        const items = statusesByInstance.get(i.id) ?? [];
        return {
          id: i.id,
          clientId: i.clientId,
          clientName: clientsById.get(i.clientId)?.name ?? 'Client supprimé',
          name: i.name,
          type: i.type,
          total: items.length,
          resolved: items.filter((x: any) => x.done).length,
          createdAt: i.createdAt,
        };
      }));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Liens utiles ---

  app.get('/api/useful-links', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const links = await db.getAllUsefulLinks(req.user.companyId);
      // Sorted by category then label so the client's `Object.entries()`
      // grouping (which preserves insertion order) reads alphabetically too.
      res.json([...links].sort((a: any, b: any) =>
        (a.category || '').localeCompare(b.category || '') || (a.label || '').localeCompare(b.label || '')));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/useful-links', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { category, label, url, sector, description, icon } = req.body;
      if (!String(category || '').trim() || !String(label || '').trim() || !String(url || '').trim()) {
        return res.status(400).json({ error: 'Catégorie, libellé et URL sont requis' });
      }
      const existing = await db.getAllUsefulLinks(req.user.companyId);
      const link = await db.createUsefulLink(req.user.companyId, {
        id: genId('link'),
        category: String(category).trim(),
        label: String(label).trim(),
        url: String(url).trim(),
        description: description ? String(description).trim() : null,
        icon: icon || null,
        sector: sector || null,
        sortOrder: existing.length,
        isActive: true,
        isSystem: false,
      });
      res.status(201).json(link);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/useful-links/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { category, label, url, description, isActive, sortOrder } = req.body;
      const updates: any = {};
      if (category !== undefined) updates.category = String(category).trim();
      if (label !== undefined) updates.label = String(label).trim();
      if (url !== undefined) updates.url = String(url).trim();
      if (description !== undefined) updates.description = description ? String(description).trim() : null;
      if (isActive !== undefined) updates.isActive = !!isActive;
      if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder);
      const updated = await db.updateUsefulLink(req.user.companyId, req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/useful-links/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteUsefulLink(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Échéances — suivi mensuel grid: a fixed set of named échéance
  // columns per year (month + précis label), one status cell per
  // (client, column). No recurrence engine, no generated instances — every
  // cell is set directly, the same shape as the cabinet's own spreadsheet.

  // ---- Échéances ---------------------------------------------------------
  //
  // **Lire la grille est ouvert à `VIEW_RESOURCES`, l'écrire reste
  // `MANAGE_RESOURCES`.** Le suivi mensuel dit qui doit quoi et quand : c'est
  // exactement ce qu'un collaborateur a besoin de consulter pour savoir où il
  // en est, et le lui refuser l'obligeait à demander à l'administrateur. Poser
  // une valeur dans une cellule, ajouter ou supprimer une colonne, renommer un
  // statut — tout ce qui change la grille — n'a pas bougé.

  app.get('/api/echeance-columns', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      let columns = await db.getAllEcheanceColumns(req.user.companyId);
      if (req.query.year) columns = columns.filter((c: any) => c.year === Number(req.query.year));
      res.json(columns.sort((a: any, b: any) => a.sortOrder - b.sortOrder));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Installe la grille type d'un exercice.
   *
   * Le même modèle que celui livré d'office, mais à la demande : c'est ce qui
   * permet de récupérer une année manquante — une entreprise dont la pose
   * initiale date d'avant l'ajout des exercices suivants, ou simplement
   * l'année prochaine quand elle arrivera — sans attendre une mise en service.
   * Idempotent par id : les colonnes déjà là et les cellules déjà remplies ne
   * bougent pas, et la réponse dit combien ont réellement été créées.
   */
  app.post('/api/echeance-columns/seed-year', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const year = parseInt(req.body?.year, 10);
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'Année invalide.' });
      }
      const existing = await db.getAllEcheanceColumns(req.user.companyId);
      let created = 0;
      let corrected = 0;
      for (const col of echeanceColumnsForYear(year)) {
        // Le même nommage que le semis livré d'office, faute de quoi un clic
        // ici reposerait des colonnes déjà présentes sous un autre id.
        const id = ownedSeedId(existing, req.user.companyId, col.id);
        const already = existing.find((c: any) => c.id === id);
        if (already) {
          // Réparer, pas seulement installer : un exercice posé par cette
          // route avant une correction du modèle garderait sinon ses vieux
          // libellés sans aucun moyen de les rattraper — le semis livré
          // d'office ne couvre que les exercices de `ECHEANCE_YEARS`.
          if (already.label !== col.label) {
            await db.updateEcheanceColumn(req.user.companyId, id, { label: col.label });
            corrected++;
          }
          continue;
        }
        await db.createEcheanceColumn(req.user.companyId, { ...col, id });
        created++;
      }
      res.status(201).json({ year, created, corrected, alreadyPresent: ECHEANCE_TEMPLATE.length - created });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/echeance-columns', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { year, month, label } = req.body;
      const y = Number(year), m = Number(month);
      if (!Number.isFinite(y)) return res.status(400).json({ error: 'Année invalide' });
      if (!Number.isFinite(m) || m < 1 || m > 12) return res.status(400).json({ error: 'Mois invalide (1-12)' });
      if (!String(label || '').trim()) return res.status(400).json({ error: 'Le libellé est requis' });
      const existing = (await db.getAllEcheanceColumns(req.user.companyId)).filter((c: any) => c.year === y);
      const column = await db.createEcheanceColumn(req.user.companyId, {
        id: genId('ec'), year: y, month: m, label: String(label).trim(), sortOrder: existing.length,
      });
      res.status(201).json(column);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/echeance-columns/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { month, label, sortOrder } = req.body;
      const updates: any = {};
      if (month !== undefined) {
        const m = Number(month);
        if (m < 1 || m > 12) return res.status(400).json({ error: 'Mois invalide (1-12)' });
        updates.month = m;
      }
      if (label !== undefined) updates.label = String(label).trim();
      if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder);
      const updated = await db.updateEcheanceColumn(req.user.companyId, req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Cascades to every client's status cell for this column. */
  app.delete('/api/echeance-columns/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteEcheanceColumn(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/echeance-statuses', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      let statuses = await db.getAllEcheanceStatuses(req.user.companyId);
      if (req.query.year) {
        const columnIds = new Set((await db.getAllEcheanceColumns(req.user.companyId)).filter((c: any) => c.year === Number(req.query.year)).map((c: any) => c.id));
        statuses = statuses.filter((s: any) => columnIds.has(s.columnId));
      }
      res.json(statuses);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Upserts a single cell — one call per edit, so a 900×30 grid never sends more than one changed cell at a time. */
  app.put('/api/echeance-statuses', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const { clientId, columnId, status } = req.body;
      if (clientId == null || !columnId) return res.status(400).json({ error: 'Client et colonne requis' });
      if (status !== null && status !== '') {
        const validLabels = (await db.getAllEcheanceStatusOptions(req.user.companyId)).map((o: any) => o.label);
        if (!validLabels.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
      }
      const normalizedStatus = status === '' ? null : status;
      const existing = (await db.getAllEcheanceStatuses(req.user.companyId))
        .find((s: any) => s.clientId === Number(clientId) && s.columnId === columnId);
      if (existing) {
        const updated = await db.updateEcheanceStatus(req.user.companyId, existing.id, { status: normalizedStatus });
        return res.json(updated);
      }
      const created = await db.createEcheanceStatus(req.user.companyId, {
        id: genId('ecs'), clientId: Number(clientId), columnId, status: normalizedStatus,
      });
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // The status vocabulary itself — admin-editable rather than a hardcoded
  // list, so the cabinet can rename, recolor, or drop a value without a code
  // change. Removing an option never touches cells already set to it; they
  // just no longer match a known option (rendered muted) until re-set from
  // the grid. Colors are a fixed set of keys into the app's own reserved
  // status-pill tokens (run/done/pause/late/admin/collab), never a raw hex —
  // the whole point of those tokens is that no screen invents its own color.
  const ECHEANCE_STATUS_COLORS = ['done', 'late', 'run', 'pause', 'admin', 'collab', 'gray'];

  app.get('/api/echeance-status-options', authenticate, requirePermission('VIEW_RESOURCES'), async (req: any, res: any) => {
    try {
      const options = await db.getAllEcheanceStatusOptions(req.user.companyId);
      res.json(options.sort((a: any, b: any) => a.sortOrder - b.sortOrder));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/echeance-status-options', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const label = String(req.body?.label || '').trim();
      if (!label) return res.status(400).json({ error: 'Le libellé est requis' });
      const existing = await db.getAllEcheanceStatusOptions(req.user.companyId);
      if (existing.some((o: any) => o.label === label)) return res.status(400).json({ error: 'Cette valeur existe déjà' });
      const color = ECHEANCE_STATUS_COLORS.includes(req.body?.color)
        ? req.body.color
        : ECHEANCE_STATUS_COLORS[existing.length % ECHEANCE_STATUS_COLORS.length];
      const option = await db.createEcheanceStatusOption(req.user.companyId, { id: genId('ecso'), label, color, sortOrder: existing.length });
      res.status(201).json(option);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/echeance-status-options/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const updates: any = {};
      if (req.body?.label !== undefined) {
        const label = String(req.body.label).trim();
        if (!label) return res.status(400).json({ error: 'Le libellé est requis' });
        const existing = await db.getAllEcheanceStatusOptions(req.user.companyId);
        if (existing.some((o: any) => o.label === label && o.id !== req.params.id)) {
          return res.status(400).json({ error: 'Cette valeur existe déjà' });
        }
        updates.label = label;
      }
      if (req.body?.color !== undefined) {
        if (!ECHEANCE_STATUS_COLORS.includes(req.body.color)) return res.status(400).json({ error: 'Couleur invalide' });
        updates.color = req.body.color;
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const updated = await db.updateEcheanceStatusOption(req.user.companyId, req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/echeance-status-options/:id', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      const ok = await db.deleteEcheanceStatusOption(req.user.companyId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Public landing page.
  // "Sur mesure" (>10 seats) stays a lead-capture request — a custom deal is
  // inherently a conversation, not a self-serve signup. The three standard
  // packs go through /api/signup below instead, which provisions a real
  // isolated company immediately.
  const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

  app.post('/api/orders', async (req: any, res: any) => {
    try {
      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
      // Honeypot: a field real visitors never see or fill. A bot that fills
      // every input on the form fills this too — accept silently, do nothing.
      if (text(req.body?.website, 200)) return res.status(201).json({ reference: null, emailSent: false });

      const contactName = text(req.body?.name, 120);
      const contactEmail = text(req.body?.email, 160);
      const companyName = text(req.body?.company, 160);
      const plan = text(req.body?.plan, 40);
      const message = text(req.body?.message, 1000);

      if (!contactName || !contactEmail || !companyName || !plan) {
        return res.status(400).json({ error: 'Nom, email, entreprise et offre sont requis' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return res.status(400).json({ error: 'Adresse email invalide' });
      }

      const existing = await db.getAllOrders();
      const reference = `TC-${civilParts(new Date()).year}-${String(existing.length + 1).padStart(4, '0')}`;

      await db.createOrder({
        id: genId('order'),
        plan, contactName, contactEmail, companyName, message,
        reference, status: 'PENDING', createdAt: new Date().toISOString(),
      });

      const { sent } = await sendMail({
        to: 'contact@taches-and-cash.com',
        subject: `Nouvelle demande — ${plan} (${reference})`,
        html: `
          <p><strong>Référence :</strong> ${escapeHtml(reference)}</p>
          <p><strong>Offre :</strong> ${escapeHtml(plan)}</p>
          <p><strong>Nom :</strong> ${escapeHtml(contactName)}</p>
          <p><strong>Email :</strong> ${escapeHtml(contactEmail)}</p>
          <p><strong>Entreprise :</strong> ${escapeHtml(companyName)}</p>
          ${message ? `<p><strong>Message :</strong> ${escapeHtml(message)}</p>` : ''}
        `,
      });

      res.status(201).json({ reference, emailSent: sent });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Real self-serve signup for the three standard packs: creates an isolated
   * company immediately (status TRIAL, full feature access, `TRIAL_DAYS`
   * free) and its first ADMIN user, then logs them straight in — the same
   * response shape as /api/login, so the client can call the same
   * `login(token, user)` either way.
   *
   * No payment happens here. The conversion flow is entirely a platform-admin
   * action later: `POST /api/platform/companies/:id/confirm` once a human has
   * called the client and payment is manually confirmed. If nobody confirms
   * before `trialEndsAt`, `expireTrialIfDue` (in `authenticate`/login) locks
   * the account out on its own — no cron job, the same lazy-expiry idiom the
   * rest of this codebase already uses for presence and leave balances.
   */
  // ---- Parrainage --------------------------------------------------------
  //
  // **Seule une entreprise dont l'abonnement est actif peut parrainer.** Un
  // compte en essai n'a encore rien payé ; lui laisser distribuer des mois
  // gratuits ferait du parrainage une machine à prolonger un essai avec de
  // faux comptes. Le lien n'existe donc pas tant que l'abonnement n'est pas
  // actif, et `/api/signup` revérifie le statut du parrain — le lien d'une
  // entreprise devenue inactive entre-temps ne vaut plus rien.
  //
  // **Rien n'est accordé à l'inscription.** Les deux récompenses tombent au
  // moment où le filleul paie, c'est-à-dire à la confirmation de paiement
  // dans la console plateforme :
  //  - le filleul obtient **10 % de remise** sur l'abonnement qu'il souscrit
  //    (`referralDiscountPercent`, posé sur sa fiche à l'inscription et
  //    consommé à la confirmation) ;
  //  - le parrain gagne **un mois gratuit**.
  //
  // Si le filleul ne souscrit jamais, personne ne gagne rien : la ligne de
  // `referrals` reste `PENDING` et aucun avoir n'est écrit. C'est ce qui rend
  // le dispositif inabusable par de fausses inscriptions — la version
  // précédente créditait dès la création du compte.
  //
  // **Ce que « un mois gratuit » veut dire dépend de l'état du parrain.** Par
  // la règle ci-dessus il est actif, donc `trialEndsAt: null` (la confirmation
  // de paiement l'efface) et sa facturation vit hors de l'app : la récompense
  // est un **avoir**, `referralCreditMonths`, que la console plateforme
  // affiche pour que l'admin l'applique à la prochaine échéance. La branche
  // « essai prolongé » ne sert plus qu'aux lignes écrites avant cette règle,
  // et reste là pour elles.
  //
  // Chaque parrainage écrit une ligne dans `referrals`, portée par le
  // parrain : jamais de double comptage, et une trace de ce qui a été accordé,
  // quand, et sous quelle forme.

  const REFERRAL_REWARD_DAYS = 30;

  /** Un lien de parrainage ne fonctionne que pour une entreprise abonnée. */
  const canRefer = (company: any) => company?.status === 'ACTIVE';

  /** Sans I, O, 0 ni 1 : le code se lit à voix haute et se recopie à la main. */
  const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const newReferralCode = () =>
    Array.from({ length: 8 }, () => REFERRAL_ALPHABET[Math.floor(Math.random() * REFERRAL_ALPHABET.length)]).join('');

  /**
   * Le code de parrainage de l'entreprise, créé à la première consultation
   * plutôt qu'à l'inscription : les entreprises déjà en base n'en ont pas, et
   * une migration pour un champ que personne n'a encore regardé serait du
   * travail pour rien. Unicité vérifiée contre les codes existants.
   */
  const referralCodeFor = async (company: any): Promise<string> => {
    if (company.referralCode) return company.referralCode;
    // Pas de code tant que l'abonnement n'est pas actif : un lien qu'on ne
    // peut pas encore utiliser n'a aucune raison d'être fabriqué, et il serait
    // partagé avant de valoir quoi que ce soit.
    if (!canRefer(company)) return '';
    const companies = await db.getAllCompanies();
    const taken = new Set(companies.map((c: any) => c.referralCode).filter(Boolean));
    let code = newReferralCode();
    for (let i = 0; i < 20 && taken.has(code); i++) code = newReferralCode();
    await db.updateCompany(company.id, { referralCode: code });
    return code;
  };

  /**
   * Journalise le parrainage à l'inscription du filleul, **sans rien
   * accorder**. La ligne naît `PENDING` : elle dit « quelqu'un s'est inscrit
   * avec votre lien », ce que le parrain a le droit de voir, et rien de plus.
   * La récompense attend le paiement (`settleReferralOnPayment`).
   */
  const recordPendingReferral = async (referrer: any, invitee: any) =>
    db.createReferral(referrer.id, {
      id: genId('ref'),
      referredCompanyId: invitee.id,
      referredCompanyName: invitee.name,
      referredContactEmail: invitee.contactEmail || '',
      status: 'PENDING',
      rewardMonths: 1,
      discountPercent: REFERRAL_DISCOUNT_PERCENT,
      createdAt: new Date().toISOString(),
    });

  /**
   * Le filleul vient de payer : c'est ici, et seulement ici, que les deux
   * récompenses tombent. Appelée par la confirmation de paiement.
   *
   * Idempotente par la ligne `referrals` : elle n'agit que sur une ligne
   * encore `PENDING`, donc reconfirmer une entreprise (ré-appuyer sur le
   * bouton, changer d'offre) ne crédite pas un deuxième mois.
   *
   * Ne renvoie jamais d'erreur à l'appelant : un parrainage perdu ne doit pas
   * faire échouer une activation d'abonnement déjà décidée.
   */
  const settleReferralOnPayment = async (invitee: any) => {
    try {
      if (!invitee?.referredByCompanyId) return null;
      const referrer = await db.getCompanyById(invitee.referredByCompanyId);
      if (!referrer) return null;

      const rows = await db.getAllReferrals(referrer.id);
      const row = rows.find((r: any) => String(r.referredCompanyId) === String(invitee.id));
      // Pas de ligne (parrainage antérieur à cette règle) ou déjà réglée :
      // ne rien faire plutôt que d'en inventer une seconde.
      if (!row || row.status !== 'PENDING') return null;

      // La branche « essai prolongé » ne peut plus se produire pour un
      // parrainage écrit sous la règle actuelle — un parrain est actif par
      // construction. Elle reste pour les fiches qui l'étaient encore quand
      // leur ligne a été créée.
      let rewardKind: 'TRIAL_EXTENDED' | 'CREDIT';
      if (referrer.status === 'TRIAL' && referrer.trialEndsAt) {
        // Depuis la fin d'essai en cours, pas depuis aujourd'hui : sinon un
        // parrainage en début d'essai ajouterait moins d'un mois.
        const base = new Date(referrer.trialEndsAt).getTime();
        const from = Number.isFinite(base) ? base : Date.now();
        await db.updateCompany(referrer.id, {
          trialEndsAt: new Date(from + REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        });
        rewardKind = 'TRIAL_EXTENDED';
      } else {
        await db.updateCompany(referrer.id, {
          referralCreditMonths: num(Number(referrer.referralCreditMonths), 0) + 1,
        });
        rewardKind = 'CREDIT';
      }

      await db.updateReferral(referrer.id, row.id, {
        status: 'CONFIRMED',
        rewardKind,
        confirmedAt: new Date().toISOString(),
      });
      return rewardKind;
    } catch (e) {
      console.error('referral settlement failed', e);
      return null;
    }
  };

  /**
   * La remise que porte encore une entreprise : 10 % obtenus par le lien d'un
   * parrain, tant qu'elle n'a pas été consommée par une première
   * confirmation de paiement. Zéro sinon — c'est une remise de bienvenue, pas
   * un tarif.
   */
  const pendingReferralDiscount = (company: any): number =>
    company?.referredByCompanyId && !company?.referralDiscountUsedAt
      ? num(Number(company.referralDiscountPercent), REFERRAL_DISCOUNT_PERCENT)
      : 0;

  /**
   * Le tableau de bord parrainage de l'entreprise connectée : son lien, ce
   * qu'elle a gagné, et qui s'est inscrit grâce à elle. Réservé à qui gère
   * l'entreprise — c'est son abonnement qui est en jeu.
   */
  app.get('/api/referral', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const company = await db.getCompanyById(req.user.companyId);
      if (!company) return res.status(404).json({ error: 'Entreprise introuvable' });

      const eligible = canRefer(company);
      const code = await referralCodeFor(company);
      const referrals = (await db.getAllReferrals(company.id))
        .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));

      res.json({
        // Sans abonnement actif il n'y a ni code ni lien : la page le dit et
        // n'affiche pas un lien qui serait refusé à l'inscription.
        eligible,
        code,
        // Construit côté serveur à partir de l'origine réellement appelée :
        // codée en dur, l'URL serait fausse en local comme sur un domaine
        // personnalisé, et le lien partagé ne mènerait nulle part.
        link: code ? `${req.protocol}://${req.get('host')}/?ref=${code}` : '',
        rewardDays: REFERRAL_REWARD_DAYS,
        discountPercent: REFERRAL_DISCOUNT_PERCENT,
        creditMonths: num(Number(company.referralCreditMonths), 0),
        status: company.status,
        trialEndsAt: company.trialEndsAt || null,
        referrals: referrals.map((r: any) => ({
          id: r.id,
          companyName: r.referredCompanyName,
          // Une ligne écrite avant cette règle n'a pas de `status` mais avait
          // déjà été payée : elle se lit CONFIRMED, sinon un parrainage acquis
          // repasserait « en attente » à l'écran.
          status: r.status || 'CONFIRMED',
          rewardKind: r.rewardKind,
          rewardMonths: r.rewardMonths,
          createdAt: r.createdAt,
          confirmedAt: r.confirmedAt || null,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/signup', async (req: any, res: any) => {
    try {
      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
      // Honeypot: a bot that fills every field on the form fills this too.
      if (text(req.body?.website, 200)) return res.status(400).json({ error: 'Invalid submission' });

      const companyName = text(req.body?.companyName, 160);
      const contactName = text(req.body?.contactName, 120);
      const contactEmail = text(req.body?.contactEmail, 160);
      const phone = text(req.body?.phone, 40);
      const password = String(req.body?.password ?? '');
      const confirmPassword = String(req.body?.confirmPassword ?? '');
      const plan = isSellablePlan(req.body?.plan) ? req.body.plan : DEFAULT_PLAN_ID;
      const secteur: Secteur = SECTEURS.some(s => s.id === req.body?.secteur) ? req.body.secteur : 'CABINET';

      if (!companyName || !contactName || !contactEmail || !phone) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return res.status(400).json({ error: 'Adresse email invalide' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Les mots de passe ne correspondent pas' });
      }

      // No separate username at signup — the email itself is the login
      // identifier, lowercased so a differently-cased retype at login still
      // matches (usernames are otherwise compared as typed everywhere else
      // in this app, but those are hand-picked short names, not emails).
      const username = contactEmail.toLowerCase();
      if (await db.getUserByUsername(username)) {
        return res.status(400).json({ error: 'Cette adresse email est déjà utilisée' });
      }

      // Parrainage : le code arrive du lien (`/?ref=CODE`) que le parrain a
      // partagé. Un code inconnu n'est pas une erreur — l'inscription doit
      // aboutir même si le lien a été tronqué en route ; elle se fait
      // simplement sans parrain.
      const referralCode = text(req.body?.referralCode, 16).toUpperCase();
      const allCompanies = referralCode ? await db.getAllCompanies() : [];
      const referrer = referralCode
        ? allCompanies.find((c: any) => (c.referralCode || '').toUpperCase() === referralCode) || null
        : null;
      // On ne se parraine pas soi-même : même adresse de contact, c'est le
      // même monde. Le garde-fou minimal, pas une politique anti-fraude.
      const selfReferral = !!referrer
        && String(referrer.contactEmail || '').toLowerCase() === contactEmail.toLowerCase();
      // Le statut est revérifié ici et pas seulement à la création du code :
      // un lien partagé reste valide indéfiniment, l'abonnement du parrain non.
      const validReferrer = referrer && !selfReferral && canRefer(referrer) ? referrer : null;

      // Le pack Freelancer est gratuit pour de bon, pas seulement pendant un
      // essai : l'entreprise part directement `ACTIVE` sans `trialEndsAt`,
      // pour qu'`expireTrialIfDue` (qui ne touche que `status === 'TRIAL'`)
      // n'ait jamais prise dessus et que `documentQuotaFor()` rende `null`
      // (aucun plafond) comme pour n'importe quel abonnement payé — c'est
      // précisément ce que « gratuit, sans période d'essai » veut dire.
      const isFreePlan = plan === 'FREELANCER';
      const trialEndsAt = isFreePlan ? null : new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const company = await db.createCompany({
        id: genId('company'),
        name: companyName,
        status: isFreePlan ? 'ACTIVE' : 'TRIAL',
        plan,
        seatLimit: PLAN_SEAT_LIMITS[plan] || 1,
        portalSeatLimit: PLAN_PORTAL_SEAT_LIMITS[plan] || 0,
        secteur,
        createdAt: new Date().toISOString(),
        trialEndsAt,
        contactName, contactEmail, phone,
        referredByCompanyId: validReferrer ? validReferrer.id : null,
        // La remise est *promise* ici, pas accordée : elle ne vaut que sur
        // l'abonnement effectivement souscrit, et c'est la confirmation de
        // paiement qui la consomme.
        referralDiscountPercent: validReferrer ? REFERRAL_DISCOUNT_PERCENT : 0,
      });

      // Le parrainage est seulement *journalisé* — la récompense attend que
      // le filleul paie. Écrit après la création de l'entreprise : une ligne
      // pointant sur une inscription qui échoue plus loin ne vaudrait rien.
      if (validReferrer) {
        try {
          await recordPendingReferral(validReferrer, company);
        } catch (e) {
          // Un parrainage perdu ne doit jamais faire échouer une inscription
          // déjà aboutie — l'entreprise et son compte existent à ce stade.
          console.error('referral record failed', e);
        }
      }

      // Les missions par défaut du secteur, tout de suite : la première
      // connexion se fait avec le jeton renvoyé ici, sans repasser par
      // /api/login, donc attendre la connexion suivante laisserait la première
      // séance devant un catalogue vide.
      await seedSectorMissions(company);
      await seedResourceLibraryFor(company);

      const hashed = await bcrypt.hash(password, 10);
      const user = await db.createUser(company.id, {
        id: Date.now(),
        username,
        password: hashed,
        role: 'ADMIN',
        permissions: JSON.stringify(ADMIN_PERMISSIONS),
        fullName: contactName,
        phone,
      });

      const token = jwt.sign(
        { id: user.id, role: user.role, companyId: company.id, isPlatformAdmin: false },
        JWT_SECRET, { expiresIn: '1d' },
      );

      // Best-effort — a lost signup notification never blocks account
      // creation; the platform admin panel remains the source of truth.
      sendMail({
        to: 'contact@taches-and-cash.com',
        subject: isFreePlan ? `Nouvelle inscription Freelancer (gratuit) — ${companyName}` : `Nouvel essai gratuit — ${companyName}`,
        html: `
          <p><strong>Entreprise :</strong> ${escapeHtml(companyName)}</p>
          <p><strong>Contact :</strong> ${escapeHtml(contactName)}</p>
          <p><strong>Email :</strong> ${escapeHtml(contactEmail)}</p>
          <p><strong>Téléphone :</strong> ${escapeHtml(phone)}</p>
          <p><strong>Offre visée :</strong> ${escapeHtml(plan)}</p>
          <p><strong>Fin de la période d'essai :</strong> ${trialEndsAt ? trialEndsAt.slice(0, 10) : 'Aucune — offre Freelancer gratuite'}</p>
        `,
      }).catch(() => {});

      res.status(201).json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          permissions: JSON.parse(user.permissions),
          isPlatformAdmin: false,
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Forgot password. The only email attached to a company is its own
   * `contactEmail` — the address entered once at signup; individual
   * collaborator accounts have no email of their own — so this always
   * resets that company's ADMIN account. Always responds the same way
   * whether or not the email matched anything, so it can't be used to
   * probe which addresses have an account.
   */
  app.post('/api/auth/forgot-password', async (req: any, res: any) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      if (email) {
        const companies = await db.getAllCompanies();
        const company = companies.find((c: any) => (c.contactEmail || '').toLowerCase() === email);
        if (company) {
          const users = await db.getAllUsers(company.id);
          const admin = users.find((u: any) => u.role === 'ADMIN');
          if (admin) {
            // `pwd` pins the token to the password hash it was issued against —
            // once the reset actually happens (or the password changes any
            // other way) the hash moves on and the same emailed link can't be
            // replayed for the rest of its 1h validity.
            const resetToken = jwt.sign(
              { purpose: 'password_reset', userId: admin.id, companyId: company.id, pwd: admin.password },
              JWT_SECRET, { expiresIn: '1h' },
            );
            const link = `https://taches-and-cash.com/?reset=${resetToken}`;
            // No `from` override here — the SMTP account is only authorized
            // to send as whatever SMTP_FROM/SMTP_USER is configured with
            // (support@taches-and-cash.com was rejected by the relay with a
            // 550 "sender address rejected"); every other transactional
            // email in this app already relies on that same default.
            await sendMail({
              to: company.contactEmail,
              fromName: 'Tâches & Cash — Support',
              replyTo: 'support@taches-and-cash.com',
              subject: 'Réinitialisation de votre mot de passe',
              html: `
                <p>Bonjour ${escapeHtml(company.contactName || '')},</p>
                <p>Vous avez demandé la réinitialisation de votre mot de passe Tâches &amp; Cash.</p>
                <p><a href="${link}">Cliquez ici pour choisir un nouveau mot de passe</a></p>
                <p>Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
                <p style="margin-top:24px;padding-top:16px;border-top:1px solid #E6E9EE;color:#8A93A0;font-size:12px;">
                  Tâches &amp; Cash — <a href="mailto:support@taches-and-cash.com">support@taches-and-cash.com</a>
                </p>
              `,
            }).catch(() => {});
          }
        }
      }
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/auth/reset-password', async (req: any, res: any) => {
    try {
      const token = String(req.body?.token ?? '');
      const password = String(req.body?.password ?? '');
      const confirmPassword = String(req.body?.confirmPassword ?? '');

      if (password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Les mots de passe ne correspondent pas' });
      }

      let payload: any;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch {
        return res.status(400).json({ error: 'Lien invalide ou expiré. Demandez un nouveau lien.' });
      }
      if (payload?.purpose !== 'password_reset') {
        return res.status(400).json({ error: 'Lien invalide ou expiré. Demandez un nouveau lien.' });
      }

      const user = await db.getUserById(payload.companyId, payload.userId);
      if (!user || payload.pwd !== user.password) {
        return res.status(400).json({ error: 'Lien invalide ou expiré. Demandez un nouveau lien.' });
      }

      const hashed = await bcrypt.hash(password, 10);
      await db.updateUser(payload.companyId, payload.userId, { password: hashed });

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Platform admin — cross-tenant. Confirming a company's payment, sending
  // the platform's own RIB, editing that RIB, and managing a company's own
  // users are the only actions here; everything else about a company's own
  // data stays reachable only through its own scoped routes above.
  // ---------------------------------------------------------

  /** Every real customer company (the legacy cabinet itself is excluded — it isn't one). */
  app.get('/api/platform/companies', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const companies = await db.getAllCompanies();
      res.json(
        companies
          .filter((c: any) => c.id !== LEGACY_COMPANY_ID)
          .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')),
      );
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Modifier une entreprise depuis la console plateforme.
   *
   * Liste blanche de champs : le corps ne peut pas écrire `id`, `createdAt`
   * ni quoi que ce soit d'autre. `status` et `plan` restent hors de portée —
   * ils se changent par les actions dédiées (confirmation de paiement), qui
   * portent leurs propres effets de bord ; les laisser modifiables ici
   * ouvrirait un second chemin capable d'activer un compte sans paiement.
   */
  app.put('/api/platform/companies/:id', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const id = String(req.params.id);
      if (id === LEGACY_COMPANY_ID) {
        return res.status(403).json({ error: "L'entreprise historique ne se modifie pas depuis cette console." });
      }
      const company = await db.getCompanyById(id);
      if (!company) return res.status(404).json({ error: 'Entreprise introuvable' });

      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
      const name = text(req.body?.name, 160);
      if (!name) return res.status(400).json({ error: "Le nom de l'entreprise est obligatoire" });

      const updates: any = {
        name,
        contactName: text(req.body?.contactName, 120),
        contactEmail: text(req.body?.contactEmail, 160),
        phone: text(req.body?.phone, 40),
        secteur: text(req.body?.secteur, 80) || company.secteur,
      };
      // Le nombre de sièges reste modifiable à la main : un cabinet peut en
      // négocier plus que son offre n'en donne. Absent du corps, on garde
      // l'existant plutôt que de le remettre à la valeur de l'offre.
      if (req.body?.seatLimit !== undefined && req.body.seatLimit !== '') {
        const seats = Number(req.body.seatLimit);
        if (!Number.isFinite(seats) || seats < 1) {
          return res.status(400).json({ error: 'Le nombre de sièges doit être un entier positif' });
        }
        updates.seatLimit = Math.floor(seats);
      }
      // Les comptes du portail client se négocient comme les sièges du
      // back-office, et se comptent dans un panier séparé — d'où un champ à
      // part plutôt qu'un total.
      if (req.body?.portalSeatLimit !== undefined && req.body.portalSeatLimit !== '') {
        const portalSeats = Number(req.body.portalSeatLimit);
        if (!Number.isFinite(portalSeats) || portalSeats < 0) {
          return res.status(400).json({ error: 'Le nombre de comptes portail doit être un entier positif ou nul' });
        }
        updates.portalSeatLimit = Math.floor(portalSeats);
      }
      // Prolonger ou raccourcir un essai.
      if (req.body?.trialEndsAt !== undefined) {
        const d = String(req.body.trialEndsAt || '').slice(0, 10);
        updates.trialEndsAt = d ? new Date(`${d}T23:59:59Z`).toISOString() : null;
      }
      // L'échéance de l'abonnement se repousse à la main à chaque règlement :
      // la facturation vit hors de l'app, donc c'est l'humain qui encaisse qui
      // sait jusqu'à quand le client est couvert. C'est aussi là qu'on applique
      // un mois offert gagné par parrainage.
      if (req.body?.subscriptionEndsAt !== undefined) {
        const d = String(req.body.subscriptionEndsAt || '').slice(0, 10);
        updates.subscriptionEndsAt = d ? new Date(`${d}T23:59:59Z`).toISOString() : null;
      }

      res.json(await db.updateCompany(id, updates));
    } catch (error) {
      console.error('Platform update company error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Ouvrir ou fermer l'accès d'une entreprise.
   *
   * Route à part, et pas un champ de plus dans le PUT : suspendre est une
   * décision d'exploitation, réactiver ne doit jamais pouvoir *créer* un
   * abonnement payé. On suspend en mémorisant le statut d'avant, et on le
   * restaure tel quel — un essai suspendu redevient un essai, pas un compte
   * actif.
   *
   * Aucune donnée n'est touchée : seule la connexion est refusée.
   */
  app.put('/api/platform/companies/:id/access', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const id = String(req.params.id);
      if (id === LEGACY_COMPANY_ID) {
        return res.status(403).json({ error: "L'entreprise historique ne peut pas être suspendue." });
      }
      const company = await db.getCompanyById(id);
      if (!company) return res.status(404).json({ error: 'Entreprise introuvable' });

      const active = req.body?.active !== false;
      if (active) {
        if (company.status !== 'SUSPENDED') return res.json(company);
        // Restaure ce qu'il y avait avant la suspension. À défaut (compte
        // suspendu avant que ce champ n'existe), on retombe sur EXPIRED :
        // c'est le statut qui ne donne aucun droit non payé, donc le seul
        // repli honnête.
        const restored = company.statusBeforeSuspension || 'EXPIRED';
        return res.json(await db.updateCompany(id, { status: restored, statusBeforeSuspension: null }));
      }
      if (company.status === 'SUSPENDED') return res.json(company);
      console.warn(`[platform] accès suspendu : ${company.name} (${id}), par ${req.user.username}`);
      res.json(await db.updateCompany(id, { status: 'SUSPENDED', statusBeforeSuspension: company.status }));
    } catch (error) {
      console.error('Platform access toggle error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Supprimer une entreprise et TOUTES ses données.
   *
   * Irréversible et sans corbeille : la confirmation est donc exigée dans la
   * requête elle-même (`confirmName` doit répondre au nom exact), et pas
   * seulement dans une boîte de dialogue du navigateur — une console
   * plateforme s'appelle aussi au curl.
   */
  app.delete('/api/platform/companies/:id', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const id = String(req.params.id);
      if (id === LEGACY_COMPANY_ID) {
        return res.status(403).json({ error: "L'entreprise historique ne peut pas être supprimée." });
      }
      const company = await db.getCompanyById(id);
      if (!company) return res.status(404).json({ error: 'Entreprise introuvable' });

      const confirmName = String(req.query.confirmName ?? req.body?.confirmName ?? '').trim();
      if (confirmName !== String(company.name || '').trim()) {
        return res.status(400).json({
          error: "Confirmation invalide : renvoyez le nom exact de l'entreprise dans `confirmName`.",
        });
      }

      const users = await db.getAllUsers(id);
      const ok = await db.deleteCompany(id);
      if (!ok) return res.status(404).json({ error: 'Entreprise introuvable' });

      console.warn(`[platform] entreprise supprimée : ${company.name} (${id}), ${users.length} utilisateur(s), par ${req.user.username}`);
      res.json({ success: true, deletedUsers: users.length });
    } catch (error) {
      console.error('Platform delete company error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/platform/settings', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      res.json(await db.getPlatformSettings());
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/platform/settings', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
      const updated = await db.updatePlatformSettings({
        bankName: text(req.body?.bankName, 120),
        iban: text(req.body?.iban, 60),
        rib: text(req.body?.rib, 60),
        swift: text(req.body?.swift, 30),
        instructions: text(req.body?.instructions, 1000),
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** The "j'envoie un mail avec le RIB" step — after the sales call, before payment. */
  app.post('/api/platform/companies/:id/send-rib', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const company = await db.getCompanyById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Not found' });
      const plan = isSellablePlan(req.body?.plan) ? req.body.plan : company.plan;
      const bank = await db.getPlatformSettings();

      // Le prix annoncé est celui de l'offre, remise de parrainage déduite si
      // l'entreprise en porte une : c'est le montant qu'on lui demande de
      // virer, donc c'est celui qui doit figurer dans le mail. L'annoncer plein
      // puis facturer moins (ou l'inverse) est la seule façon sûre de rater un
      // encaissement.
      const meta = planMeta(plan);
      const discount = pendingReferralDiscount(company);
      const net = meta ? discountedPriceDT(meta.priceDT, discount) : 0;
      const priceHtml = meta
        ? (discount > 0
          ? `<p><strong>Montant à régler :</strong> ${escapeHtml(formatDT(net))} / mois
               <span style="color:#8A93A0;"> (au lieu de ${escapeHtml(formatDT(meta.priceDT))} — remise parrainage de ${discount} % sur votre premier abonnement)</span></p>`
          : `<p><strong>Montant à régler :</strong> ${escapeHtml(formatDT(meta.priceDT))} / mois</p>`)
        : '';

      const { sent } = await sendMail({
        to: company.contactEmail,
        subject: `Coordonnées de paiement — ${planLabel(plan)}`,
        html: `
          <p>Bonjour ${escapeHtml(company.contactName || '')},</p>
          <p>Voici les coordonnées bancaires pour activer votre abonnement <strong>${escapeHtml(planLabel(plan))}</strong> :</p>
          ${priceHtml}
          <p>
            <strong>Banque :</strong> ${escapeHtml(bank.bankName || '')}<br/>
            <strong>RIB :</strong> ${escapeHtml(bank.rib || '')}<br/>
            <strong>IBAN :</strong> ${escapeHtml(bank.iban || '')}<br/>
            ${bank.swift ? `<strong>SWIFT :</strong> ${escapeHtml(bank.swift)}<br/>` : ''}
          </p>
          ${bank.instructions ? `<p>${escapeHtml(bank.instructions)}</p>` : ''}
          <p>Dès réception de votre paiement, nous confirmerons l'activation de votre abonnement.</p>
          <p style="margin-top:24px;padding-top:16px;border-top:1px solid #E6E9EE;color:#8A93A0;font-size:12px;">
            Tâches &amp; Cash — <a href="mailto:contact@taches-and-cash.com">contact@taches-and-cash.com</a>
          </p>
        `,
      });

      await db.updateCompany(company.id, { ribSentAt: new Date().toISOString(), pendingPlan: plan });
      res.json({ emailSent: sent });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * "Si paiement reçu (manuellement), je confirme le pack choisi." Flips the
   * company from TRIAL to ACTIVE on the chosen plan and clears the trial
   * deadline, so `expireTrialIfDue` never touches it again. No new
   * credentials are issued — the admin already chose their own username and
   * password at signup, and a password is never stored anywhere in a form
   * this route could re-send even if it wanted to. The confirmation email
   * only reminds them of their username and that the account is now active.
   */
  app.post('/api/platform/companies/:id/confirm', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const company = await db.getCompanyById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Not found' });
      const plan = isSellablePlan(req.body?.plan) ? req.body.plan : company.plan;
      const meta = planMeta(plan);

      // La remise de parrainage est consommée **ici**, au moment où le filleul
      // paie : c'est la première échéance qu'elle concerne, et le prix retenu
      // est figé sur la fiche (`subscriptionPriceDT`) pour que la console
      // n'ait pas à le recalculer plus tard, quand le catalogue aura bougé.
      const discount = pendingReferralDiscount(company);
      const price = meta ? discountedPriceDT(meta.priceDT, discount) : null;

      const updated = await db.updateCompany(company.id, {
        status: 'ACTIVE',
        plan,
        seatLimit: PLAN_SEAT_LIMITS[plan] || company.seatLimit,
        // Seule une offre encore vendue pose un quota de comptes portail.
        // L'écrire depuis une offre retirée (qui n'en donne aucun) fixerait un
        // zéro sur la fiche — donc « aucun compte portail » — là où
        // l'entreprise n'a jamais rien souscrit de tel.
        ...(meta && !meta.legacy ? { portalSeatLimit: meta.portalSeatLimit } : {}),
        trialEndsAt: null,
        confirmedAt: new Date().toISOString(),
        // L'échéance de l'abonnement, dérivée de l'offre : les trois packs
        // sont mensuels, donc un mois à compter d'aujourd'hui. Purement
        // **indicative** — rien dans l'app ne la surveille et rien ne se
        // ferme quand elle passe. Fermer un accès reste une décision prise à
        // la main, par la route dédiée : une coupure automatique le jour où
        // un virement traîne coûterait un client, et l'app ne sait pas ce qui
        // a été encaissé.
        subscriptionEndsAt: addMonthsISO(new Date(), 1),
        ...(price !== null ? { subscriptionPriceDT: price } : {}),
        ...(discount > 0 ? { referralDiscountUsedAt: new Date().toISOString() } : {}),
      });

      // Le parrain gagne son mois maintenant, et pas avant : c'est le paiement
      // du filleul qui déclenche la récompense. Ne lève jamais — une
      // activation déjà décidée ne doit pas échouer sur un parrainage.
      await settleReferralOnPayment(updated || company);

      const users = await db.getAllUsers(company.id);
      const admin = users.find((u: any) => u.role === 'ADMIN');

      const { sent } = await sendMail({
        to: company.contactEmail,
        subject: 'Votre abonnement Tâches & Cash est activé',
        html: `
          <p>Bonjour ${escapeHtml(company.contactName || '')},</p>
          <p>Votre paiement a bien été reçu — votre abonnement <strong>${escapeHtml(planLabel(plan))}</strong> est maintenant actif.</p>
          ${discount > 0 && price !== null
            ? `<p>La remise de parrainage de ${discount} % a bien été appliquée : <strong>${escapeHtml(formatDT(price))} / mois</strong>.</p>`
            : ''}
          <p>Connectez-vous avec votre identifiant habituel : <strong>${escapeHtml(admin?.username || '')}</strong> sur
             <a href="https://taches-and-cash.com">taches-and-cash.com</a>.</p>
          <p>Merci de votre confiance.</p>
          <p style="margin-top:24px;padding-top:16px;border-top:1px solid #E6E9EE;color:#8A93A0;font-size:12px;">
            Tâches &amp; Cash — <a href="mailto:contact@taches-and-cash.com">contact@taches-and-cash.com</a>
          </p>
        `,
      });

      res.json({ company: updated, emailSent: sent });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** Every user of one customer company — cross-tenant, so scoped through :id rather than the caller's own companyId. */
  app.get('/api/platform/companies/:id/users', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const company = await db.getCompanyById(req.params.id);
      if (!company) return res.status(404).json({ error: 'Not found' });
      const users = await db.getAllUsers(company.id);
      res.json(users.map(publicUser).sort((a: any, b: any) => a.username.localeCompare(b.username)));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/platform/companies/:id/users/:userId', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const user = await db.getUserById(req.params.id, userId);
      if (!user) return res.status(404).json({ error: 'Not found' });

      const updates: any = {};

      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : undefined;
      if (username && username !== user.username) {
        const existing = await db.getUserByUsername(username);
        if (existing) return res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" });
        updates.username = username;
      }

      if (typeof req.body?.role === 'string' && ROLES.some(r => r.id === req.body.role)) {
        updates.role = req.body.role;
      }

      if (typeof req.body?.password === 'string' && req.body.password) {
        if (req.body.password.length < 6) {
          return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
        }
        updates.password = await bcrypt.hash(req.body.password, 10);
      }

      const updated = await db.updateUser(req.params.id, userId, updates);
      res.json(publicUser(updated));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/platform/companies/:id/users/:userId', authenticate, requirePlatformAdmin, async (req: any, res: any) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const success = await db.deleteUser(req.params.id, userId);
      if (!success) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------------------------------------------------------
  // Vite Middleware & SPA serving
  // ---------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
