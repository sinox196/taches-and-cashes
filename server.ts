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
import { LEGACY_COMPANY_ID, TRIAL_DAYS, PLAN_SEAT_LIMITS, ADMIN_PERMISSIONS } from './src/server/db-types.js';
import { ROLES, STAFF_ROLES, DASHBOARD_ROLES, HR_APPROVER_ROLES } from './src/constants/roles.js';
import { SECTEURS, RESOURCES_PERMISSIONS, companyHasResourcesModule, type Secteur } from './src/constants/secteurs.js';
import {
  DEFAULT_AWAY_AFTER_MINUTES, OFFLINE_AFTER_MS, clampAwayMinutes, type PresenceState,
} from './src/constants/presence.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendMail } from './src/server/email.js';
import { initPush, pushEnabled, publicKey as pushPublicKey, sendPush } from './src/server/push.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-local-dev';

/** DD/MM/YYYY — the format time entries are stored and grouped by. */
const formatDateFR = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** HH:mm, 24h. */
const formatTimeFR = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
async function seedResourceLibrary(db: import('./src/server/db-types.js').Database, companyId: string) {
  const SECTOR_COMPTA = 'Expertise comptable';

  const existingTemplates = await db.getAllResourceTemplates(companyId);
  const seedChecklist = async (id: string, name: string, sector: string, items: string[]) => {
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
    id: string, category: string, label: string, url: string,
    opts: { description?: string; icon?: string } = {},
  ) => {
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

  // The 28 échéance columns of the cabinet's own 2025 suivi mensuel sheet —
  // real column headers (month + précis label), not placeholder ones. Cell
  // values are left for the cabinet to fill in from the grid itself.
  const existingColumns = await db.getAllEcheanceColumns(companyId);
  const seedColumn = async (id: string, year: number, month: number, label: string, sortOrder: number) => {
    if (existingColumns.some((c: any) => c.id === id)) return;
    await db.createEcheanceColumn(companyId, { id, year, month, label, sortOrder });
  };
  const E2025: [number, string][] = [
    [1, 'DM 12/2025'], [1, 'D SUSP TVA TR04'], [1, 'CNSS TR04'],
    [2, 'DM 1'],
    [3, 'DM 2'], [3, 'IS 2025'],
    [4, 'DM 3'], [4, 'D SUSP TVA TR01'], [4, 'CNSS TR01'], [4, 'IRPP 2025-COMMERCE'], [4, 'DEC EMPLOYEUR 2025'],
    [5, 'DM 4'], [5, 'IRPP 2025-SERVICE + FONC LIBERALE + REV FONCIER'],
    [6, 'DM 5'], [6, 'Acompte 1'],
    [7, 'DM 6'], [7, 'D SUSP TVA TR02'], [7, 'CNSS TR02'], [7, 'RNE Bilan 2025'],
    [8, 'DM 7'],
    [9, 'DM 8'], [9, 'Acompte 2'],
    [10, 'DM 9'], [10, 'D SUSP TVA TR03'], [10, 'CNSS TR03'],
    [11, 'DM 10'],
    [12, 'DM 11'], [12, 'Acompte 3'],
  ];
  for (let i = 0; i < E2025.length; i++) {
    const [month, label] = E2025[i];
    await seedColumn(`ec-seed-2025-${i}`, 2025, month, label, i);
  }

  // The status vocabulary a cell can be set to — admin-editable from here on,
  // this only seeds the starting set (and its colors) on first boot.
  const existingStatusOptions = await db.getAllEcheanceStatusOptions(companyId);
  const seedStatusOption = async (id: string, label: string, sortOrder: number, color: string) => {
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
      if (company && (company.status === 'EXPIRED' || company.status === 'SUSPENDED')) {
        res.status(403).json({ error: "Votre période d'essai est terminée. Contactez-nous pour activer un abonnement." });
        return;
      }

      const token = jwt.sign(
        { id: user.id, role: user.role, companyId, isPlatformAdmin: !!user.isPlatformAdmin },
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

      const company = await expireTrialIfDue(await db.getCompanyById(req.user.companyId));
      if (company && (company.status === 'EXPIRED' || company.status === 'SUSPENDED')) {
        res.status(403).json({ error: "Votre période d'essai est terminée. Contactez-nous pour activer un abonnement." });
        return;
      }
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

        // Ressources Métier is gated by the company's own secteur, ahead of
        // the ADMIN bypass above: its seed content (SARL formation
        // checklists, CNSS échéances...) is specific to accounting/tax
        // cabinets, so a company outside that secteur never gets it, admin
        // included.
        if (RESOURCES_PERMISSIONS.has(permission)) {
          const company = await db.getCompanyById(req.user.companyId);
          if (!companyHasResourcesModule(company?.secteur)) {
            return res.status(403).json({ error: 'Module Ressources Métier non disponible pour ce secteur' });
          }
        }

        next();
      }).catch(() => {
        res.status(500).json({ error: 'Internal server error' });
      });
    };
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

  // POST /api/users
  app.post('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const { username, password, role, permissions, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge } = req.body;

      const existing = await db.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      const company = await db.getCompanyById(req.user.companyId);
      if (company?.seatLimit) {
        const currentSeats = (await db.getAllUsers(req.user.companyId)).length;
        if (currentSeats >= company.seatLimit) {
          return res.status(403).json({ error: `Limite de ${company.seatLimit} utilisateur(s) atteinte pour votre offre.` });
        }
      }

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
        coutHoraireEmployeur
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
      const { role, permissions, password, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables, soldeConge } = req.body;
      
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
        coutHoraireEmployeur
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
      // "Autre document (non facturable)" is explicitly excluded from the
      // client's running balance — it exists in Cash but isn't billing.
      if (inv.documentKind === 'AUTRE_NON_FACTURABLE') continue;
      const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
      if (key === String(client.id) || key === `name:${client.name}`) {
        montantFacture += num(Number(inv.totalNetToPay), 0);
      }
    }
    montantFacture = round3(montantFacture);
    const soldeAnterieur = num(Number(client.soldeAnterieur), 0);
    const encaissements = sumEncaissements(client);
    return { ...client, montantFacture, resteAPayer: round3(soldeAnterieur - encaissements + montantFacture) };
  };

  // GET /api/clients
  app.get('/api/clients', authenticate, requirePermission('VIEW_CLIENTS'), async (req: any, res: any) => {
    try {
      let clients = await db.getAllClients(req.user.companyId);

      // Parse filters
      let filters: Record<string, string> = {};
      if (req.query.filters) {
        try {
          filters = JSON.parse(req.query.filters);
        } catch (e) {
          // ignore
        }
      }

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
      const sortField = req.query.sortField || 'name';
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
        // "Autre document (non facturable)" is explicitly excluded from the
        // client's running balance — it exists in Cash but isn't billing.
        if (inv.documentKind === 'AUTRE_NON_FACTURABLE') continue;
        const key = clientBucketKey({ clientId: inv.clientId, client: inv.clientName });
        montantFactureByClient.set(key, round3((montantFactureByClient.get(key) || 0) + num(Number(inv.totalNetToPay), 0)));
      }
      // Enriched over every client matching the current search/filters, not
      // just the current page — the "Total Général" row needs the ledger
      // figures of clients that aren't currently visible too.
      const enrichedAll = clients.map((c: any) => {
        const montantFacture = round3(
          (montantFactureByClient.get(String(c.id)) || 0) +
          (montantFactureByClient.get(`name:${c.name}`) || 0),
        );
        const soldeAnterieur = num(Number(c.soldeAnterieur), 0);
        const encaissements = sumEncaissements(c);
        return { ...c, montantFacture, resteAPayer: round3(soldeAnterieur - encaissements + montantFacture) };
      });

      // If client didn't explicitly request pagination, maybe return array to preserve backward compatibility?
      // The user wants "Do not load the entire Clients database... Use pagination".
      // We will ALWAYS return pagination wrapper if page/limit is provided, else we return array.
      const startIndex = (page - 1) * limit;
      const page_ = req.query.page ? enrichedAll.slice(startIndex, startIndex + limit) : enrichedAll;

      if (req.query.page) {
        // Sums across the whole filtered set, not the page — this is what the
        // Clients table's frozen "Total Général" row displays, and it must
        // stay correct regardless of which page is currently showing.
        const totals = enrichedAll.reduce((acc: any, c: any) => {
          acc.soldeAnterieur = round3(acc.soldeAnterieur + num(Number(c.soldeAnterieur), 0));
          acc.montantFacture = round3(acc.montantFacture + num(Number(c.montantFacture), 0));
          acc.encaissements = round3(acc.encaissements + sumEncaissements(c));
          acc.resteAPayer = round3(acc.resteAPayer + num(Number(c.resteAPayer), 0));
          return acc;
        }, { soldeAnterieur: 0, montantFacture: 0, encaissements: 0, resteAPayer: 0 });
        res.json({ data: page_, total: clients.length, page, limit, totals });
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
      res.json(client);
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
  users = users.filter((u: any) => u.role !== 'ADMIN');
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

    // Filter time entries (shared with the per-client drill-down endpoint)
    timeEntries = filterKpiEntries(timeEntries, req.body);

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
      totalCostFormatted: `${Math.round(globalCost).toLocaleString('fr-FR')} TND`,
      tasksWithoutRate,
      activeLeaves: leaveRequests.filter((l: any) => l.status === 'APPROVED').length,
      activeAuthorizations: authorizations.filter((a: any) => a.status === 'APPROVED').length,
    };

    // Calculate per employee stats
    const employeeStats = employees.map((emp: any) => {
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
      const totalCostFormatted = `${Math.round(totalCost).toLocaleString('fr-FR')} TND`;
      
      const empClients = new Set();
      const clientTasksCount: any = {};
      empTasks.forEach((t: any) => {
        if (t.clientId) {
          empClients.add(t.clientId);
          clientTasksCount[t.clientId] = (clientTasksCount[t.clientId] || 0) + 1;
        }
      });
      
      const empLeaves = leaveRequests.filter((l: any) => l.userId === emp.id);
      const balance = leaveBalances.find((b: any) => b.userId === emp.id)
        || { entitlement: DEFAULT_LEAVE_ENTITLEMENT, used: 0, available: DEFAULT_LEAVE_ENTITLEMENT };
      
      const empAuths = authorizations.filter((a: any) => a.userId === emp.id);
      const totalAuthDuration = empAuths
        .filter((a: any) => a.status === 'APPROVED')
        .reduce((sum: number, a: any) => sum + (a.duration || 0), 0);

      const clientListDetails = Array.from(empClients).map((cid: any) => {
        const c = clientsById.get(cid);
        return {
          id: cid,
          name: c ? c.name : 'Unknown',
          taskCount: clientTasksCount[cid]
        };
      });

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
      if (inv.documentKind === 'AUTRE_NON_FACTURABLE') continue;
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
      const encaissements = sumEncaissements(clientRecord);
      return {
        id: first.clientId ?? key,
        key,
        name: clientRecord ? clientRecord.name : (first.client || 'Sans client'),
        taskCount: entries.length,
        completedTasks: entries.filter((t: any) => t.statut === 'COMPLETED').length,
        durationSeconds,
        durationFormatted: `${Math.floor(durationSeconds / 3600)}h${String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, '0')}`,
        totalCost,
        totalCostFormatted: `${Math.round(totalCost).toLocaleString('fr-FR')} TND`,
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


  app.post('/api/clients', authenticate, requirePermission('CREATE_CLIENTS'), async (req: any, res: any) => {
    try {
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields, soldeAnterieur, encaissements } = req.body;

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
        soldeAnterieur: num(Number(soldeAnterieur), 0),
        encaissements: normalizeEncaissements(encaissements),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: req.user.id
      });

      res.status(201).json(await enrichClientLedger(req.user.companyId, newClient));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/clients/:id
  app.put('/api/clients/:id', authenticate, requirePermission('EDIT_CLIENTS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, type, email, phone, address, city, country, taxId, status, notes, customFields, soldeAnterieur, encaissements } = req.body;

      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Client name is required' });
      }

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
        soldeAnterieur: num(Number(soldeAnterieur), 0),
        encaissements: normalizeEncaissements(encaissements),
        updatedAt: new Date().toISOString()
      };
      
      const updated = await db.updateClient(req.user.companyId, id, updates);
      if (!updated) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json(await enrichClientLedger(req.user.companyId, updated));
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
      if (serviceId !== undefined) {
        const sid = parseInt(serviceId, 10);
        if (!Number.isFinite(sid) || !(await db.getServiceById(req.user.companyId, sid))) {
          return res.status(400).json({ error: 'A valid mission is required' });
        }
        updates.serviceId = sid;
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
  const presence = new Map<string, { lastSeenAt: number; lastActivityAt: number }>();
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
    };
  };

  /** Heartbeat. `idleMs` = time since this user last touched mouse or keyboard. */
  app.post('/api/presence', authenticate, async (req: any, res: any) => {
    const now = Date.now();
    const awayMs = await awayAfterMs(req.user.companyId);
    const reported = Number(req.body?.idleMs);
    const idleMs = Number.isFinite(reported) && reported >= 0 ? Math.min(reported, awayMs * 6) : 0;
    presence.set(presenceKey(req.user.companyId, req.user.id), { lastSeenAt: now, lastActivityAt: now - idleMs });
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
    const disbursements = num(Number(invoice.disbursements), 0);                    // (8)
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
      disbursements,
      advances,
      totalNetToPay,
    };
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
      for (const inv of filtered) {
        const currency = String(inv.currency || 'TND');
        const acc = totalsByCurrency[currency] || { totalHT: 0, totalNetToPay: 0, count: 0 };
        acc.totalHT = round3(acc.totalHT + num(Number(inv.totalHT), 0));
        acc.totalNetToPay = round3(acc.totalNetToPay + num(Number(inv.totalNetToPay), 0));
        acc.count += 1;
        totalsByCurrency[currency] = acc;
      }

      res.json({ data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset, totalsByCurrency });
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

      // Only a legal invoice is bound to the sequence. Both "autre" kinds
      // carry a free reference (bon de livraison, reçu, note interne…), so
      // neither follows the sequence nor consumes a number from it — doing so
      // would punch gaps in the legal numbering.
      let number: string;
      if (kind !== 'FACTURE_LEGALE') {
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

      const totals = computeInvoiceTotals(body);
      if (kind === 'FACTURE_LEGALE') number = await db.nextInvoiceNumber(req.user.companyId);

      const invoice = await db.createInvoice(req.user.companyId, {
        id: `inv-${Date.now()}`,
        number,
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

      // A legal invoice's number belongs to the sequence and is never
      // reassigned; a free document's may be corrected.
      if (merged.documentKind !== 'FACTURE_LEGALE') {
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
      if (merged.documentKind === 'FACTURE_LEGALE') {
        const dateError = legalSequenceDateError(
          await db.getAllInvoices(req.user.companyId), existing.id, Number(merged.number), merged.issueDate,
        );
        if (dateError) return res.status(400).json({ error: dateError });
      }
      const totals = computeInvoiceTotals(merged);

      const updated = await db.updateInvoice(req.user.companyId, req.params.id, {
        ...merged,
        ...totals,
        updatedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (error) {
      console.error(error);
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
        dateGranted: dateGranted || new Date().toISOString().slice(0, 10),
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
        dateGranted: dateGranted || new Date().toISOString().slice(0, 10),
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
      const contacts = allUsers
        .filter((u: any) => u.id !== req.user.id)
        .map((u: any) => {
          const thread = messages.filter((m: any) =>
            (m.fromUserId === req.user.id && m.toUserId === u.id) ||
            (m.fromUserId === u.id && m.toUserId === req.user.id)
          );
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

  // GET /api/messages/unread-count — total across every conversation, for the sidebar badge.
  app.get('/api/messages/unread-count', authenticate, async (req: any, res: any) => {
    try {
      const messages = await db.getAllMessages(req.user.companyId);
      const count = messages.filter((m: any) => m.toUserId === req.user.id && !m.readAt).length;
      res.json({ count });
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
        .filter((m: any) =>
          (m.fromUserId === req.user.id && m.toUserId === otherId) ||
          (m.fromUserId === otherId && m.toUserId === req.user.id)
        )
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

  // POST /api/messages — send a DM.
  app.post('/api/messages', authenticate, async (req: any, res: any) => {
    try {
      const toUserId = parseInt(req.body?.toUserId, 10);
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!Number.isFinite(toUserId)) return res.status(400).json({ error: 'toUserId is required' });
      if (!body) return res.status(400).json({ error: 'Message body is required' });
      if (body.length > 4000) return res.status(400).json({ error: 'Message too long' });

      const recipient = await db.getUserById(req.user.companyId, toUserId);
      if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

      const message = await db.createMessage(req.user.companyId, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromUserId: req.user.id,
        toUserId,
        body,
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
  // Web Push — the running chronometer, delivered by the server so it
  // survives the browser being closed (nothing client-side runs then).
  // ---------------------------------------------------------

  const hhmmss = (total: number) => {
    const s = Math.max(0, Math.floor(total));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map(n => String(n).padStart(2, '0')).join(':');
  };

  /** What the service worker draws on the notification. */
  const pushPayloadFor = (entry: any) => ({
    entryId: entry.id,
    elapsed: hhmmss(accruedSeconds(entry)),
    client: entry.client || '',
    subtitle: [entry.pole, entry.taskType].filter((v: any) => v && v !== '-').join(' · '),
    running: entry.statut === 'RUNNING',
  });

  /**
   * Applies a status transition with the *same* rules as
   * `PUT /api/time-entries/:id` — folding the elapsed time in on the way out
   * of RUNNING, clearing `lastStartedAt`, stamping `heureFin` only on a real
   * completion, and enforcing one running task per person. Duplicating those
   * rules loosely here would let a task stopped from a notification bank a
   * different duration than the same task stopped from the app.
   */
  const applyEntryStatus = async (companyId: string, existing: any, statut: string) => {
    const updates: any = { statut };

    if (statut === 'RUNNING' && existing.statut !== 'RUNNING') {
      updates.lastStartedAt = Date.now();
      updates.heureFin = '';
    } else if (statut !== 'RUNNING' && existing.statut === 'RUNNING') {
      if (existing.lastStartedAt) {
        updates.dureeSeconds = (existing.dureeSeconds || 0) + Math.floor((Date.now() - existing.lastStartedAt) / 1000);
      }
      updates.lastStartedAt = null;
    }

    if (statut === 'COMPLETED' && existing.statut !== 'COMPLETED') {
      updates.heureFin = formatTimeFR(new Date());
    } else if (statut === 'PAUSED') {
      updates.heureFin = '';
    }

    if (statut === 'RUNNING' && existing.statut !== 'RUNNING') {
      await pauseOtherRunningEntries(companyId, existing.userId, existing.id);
    }

    const updated = await db.updateTimeEntry(companyId, existing.id, updates);
    broadcastTimeEntries();
    return updated;
  };

  /**
   * Redraws (or takes down) the pushed notification on one user's devices.
   * Called on every transition as well as from the interval below, so a task
   * stopped from the app doesn't leave a phone showing "en cours" forever.
   */
  const syncChronoPush = async (companyId: string, userId: number) => {
    if (!pushEnabled()) return;
    try {
      const subs = (await db.getAllPushSubscriptions()).filter((s: any) => s.userId === userId && s.companyId === companyId);
      if (!subs.length) return;
      const running = (await db.getAllTimeEntries(companyId))
        .find((e: any) => e.userId === userId && e.statut === 'RUNNING');
      const payload = running ? pushPayloadFor(running) : { closed: true };
      for (const sub of subs) {
        const { expired } = await sendPush(sub, payload);
        if (expired) await db.deletePushSubscriptionByEndpoint(sub.endpoint);
      }
    } catch (error) {
      // Never let a push failure break the mutation that triggered it.
      console.error('[push] sync failed:', error);
    }
  };

  /**
   * Every 15 minutes, refresh the notification on the devices of everyone
   * with a task running. This is the only thing keeping the figure current
   * once the browser is closed — so between two sweeps the displayed time is
   * simply up to 15 minutes stale, by design (see push.ts).
   *
   * Reads are grouped per company rather than per subscription, so this is
   * one entries scan per company with any subscribed device, not one per
   * device.
   */
  const CHRONO_PUSH_INTERVAL_MS = 15 * 60 * 1000;
  const pushRunningChronometers = async () => {
    if (!pushEnabled()) return;
    try {
      const subs = await db.getAllPushSubscriptions();
      if (!subs.length) return;

      const byCompany = new Map<string, any[]>();
      for (const sub of subs) {
        if (!byCompany.has(sub.companyId)) byCompany.set(sub.companyId, []);
        byCompany.get(sub.companyId)!.push(sub);
      }

      for (const [companyId, companySubs] of byCompany) {
        const runningByUser = new Map<number, any>();
        for (const entry of await db.getAllTimeEntries(companyId)) {
          if (entry.statut === 'RUNNING' && !runningByUser.has(entry.userId)) runningByUser.set(entry.userId, entry);
        }
        for (const sub of companySubs) {
          const entry = runningByUser.get(sub.userId);
          // Nothing running: stay silent rather than pushing "closed" on a
          // 15-minute drumbeat to every idle device.
          if (!entry) continue;
          const { expired } = await sendPush(sub, pushPayloadFor(entry));
          if (expired) await db.deletePushSubscriptionByEndpoint(sub.endpoint);
        }
      }
    } catch (error) {
      console.error('[push] sweep failed:', error);
    }
  };
  setInterval(pushRunningChronometers, CHRONO_PUSH_INTERVAL_MS);

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
   * Pause / Reprendre / Arrêter tapped on the pushed notification.
   *
   * Deliberately not behind `authenticate`: this is called by the service
   * worker, and with the browser closed there is no page and therefore no
   * access to the JWT in localStorage. The subscription endpoint is the
   * credential instead — a long unguessable URL minted by the push service,
   * known only to that one browser and to us, and revoked the moment the
   * subscription is dropped. It identifies the user; it can only ever act on
   * that user's own current task.
   */
  app.post('/api/push/timer-action', async (req: any, res: any) => {
    try {
      const endpoint = String(req.body?.endpoint || '');
      const action = String(req.body?.action || '');
      if (!['pause', 'resume', 'stop'].includes(action)) {
        return res.status(400).json({ error: 'Action inconnue' });
      }

      const subscription = (await db.getAllPushSubscriptions()).find((s: any) => s.endpoint === endpoint);
      if (!subscription) return res.status(404).json({ error: 'Abonnement introuvable' });

      const mine = (await db.getAllTimeEntries(subscription.companyId))
        .filter((e: any) => e.userId === subscription.userId);
      const entry = mine.find((e: any) => e.statut === 'RUNNING')
        || (action === 'resume' ? mine.find((e: any) => e.statut === 'PAUSED') : undefined);
      if (!entry) return res.json({ entry: null });

      const updated = await applyEntryStatus(subscription.companyId, entry, action === 'pause' ? 'PAUSED' : action === 'resume' ? 'RUNNING' : 'COMPLETED');
      // Answer with the new state so the worker can redraw the notification
      // immediately instead of waiting up to 15 minutes for the next sweep.
      res.json({ entry: updated && updated.statut !== 'COMPLETED' ? pushPayloadFor(updated) : null });
    } catch (error) {
      console.error(error);
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
  const createRunningEntryForUser = async (companyId: string, userId: number, fields: any) => {
    const userFull = await db.getUserById(companyId, userId);
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
    });
  };

  app.post('/api/time-entries', authenticate, async (req: any, res: any) => {
    try {
      const entry = await createRunningEntryForUser(req.user.companyId, req.user.id, req.body);
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

      if (req.body.statut === 'RUNNING' && existing.statut !== 'RUNNING') {
         updates.lastStartedAt = Date.now();
         // Back in progress: an end time would be misleading.
         if (updates.heureFin === undefined) updates.heureFin = '';
      } else if (req.body.statut !== 'RUNNING' && existing.statut === 'RUNNING') {
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

      const updated = await db.updateTimeEntry(req.user.companyId, entryId, updates);
      res.json(updated);
      broadcastTimeEntries(); // Broadcast update
      // Keep a closed browser's notification honest: stopping a task in the
      // app must take it down, not leave a phone showing "en cours".
      if (req.body.statut) syncChronoPush(req.user.companyId, existing.userId);
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
      });

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

  app.get('/api/echeance-columns', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
    try {
      let columns = await db.getAllEcheanceColumns(req.user.companyId);
      if (req.query.year) columns = columns.filter((c: any) => c.year === Number(req.query.year));
      res.json(columns.sort((a: any, b: any) => a.sortOrder - b.sortOrder));
    } catch (error) {
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

  app.get('/api/echeance-statuses', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
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

  app.get('/api/echeance-status-options', authenticate, requirePermission('MANAGE_RESOURCES'), async (req: any, res: any) => {
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
      const reference = `TC-${new Date().getFullYear()}-${String(existing.length + 1).padStart(4, '0')}`;

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
      const plan = ['FREELANCE', 'EQUIPE', 'CROISSANCE'].includes(req.body?.plan) ? req.body.plan : 'FREELANCE';
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

      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const company = await db.createCompany({
        id: genId('company'),
        name: companyName,
        status: 'TRIAL',
        plan,
        seatLimit: PLAN_SEAT_LIMITS[plan] || 1,
        secteur,
        createdAt: new Date().toISOString(),
        trialEndsAt,
        contactName, contactEmail, phone,
      });

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
        subject: `Nouvel essai gratuit — ${companyName}`,
        html: `
          <p><strong>Entreprise :</strong> ${escapeHtml(companyName)}</p>
          <p><strong>Contact :</strong> ${escapeHtml(contactName)}</p>
          <p><strong>Email :</strong> ${escapeHtml(contactEmail)}</p>
          <p><strong>Téléphone :</strong> ${escapeHtml(phone)}</p>
          <p><strong>Offre visée :</strong> ${escapeHtml(plan)}</p>
          <p><strong>Fin de la période d'essai :</strong> ${trialEndsAt.slice(0, 10)}</p>
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
      const plan = ['FREELANCE', 'EQUIPE', 'CROISSANCE'].includes(req.body?.plan) ? req.body.plan : company.plan;
      const bank = await db.getPlatformSettings();

      const { sent } = await sendMail({
        to: company.contactEmail,
        subject: `Coordonnées de paiement — ${plan}`,
        html: `
          <p>Bonjour ${escapeHtml(company.contactName || '')},</p>
          <p>Voici les coordonnées bancaires pour activer votre abonnement <strong>${escapeHtml(plan)}</strong> :</p>
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
      const plan = ['FREELANCE', 'EQUIPE', 'CROISSANCE'].includes(req.body?.plan) ? req.body.plan : company.plan;

      const updated = await db.updateCompany(company.id, {
        status: 'ACTIVE',
        plan,
        seatLimit: PLAN_SEAT_LIMITS[plan] || company.seatLimit,
        trialEndsAt: null,
        confirmedAt: new Date().toISOString(),
      });

      const users = await db.getAllUsers(company.id);
      const admin = users.find((u: any) => u.role === 'ADMIN');

      const { sent } = await sendMail({
        to: company.contactEmail,
        subject: 'Votre abonnement Tâches & Cash est activé',
        html: `
          <p>Bonjour ${escapeHtml(company.contactName || '')},</p>
          <p>Votre paiement a bien été reçu — votre abonnement <strong>${escapeHtml(plan)}</strong> est maintenant actif.</p>
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
